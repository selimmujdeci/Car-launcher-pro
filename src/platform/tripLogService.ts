/**
 * Trip Log Service — GPS-primary, OBD-secondary journey recording.
 *
 * Architecture:
 *  - PRIMARY km source: GPS haversine distance between consecutive fixes
 *    → accurate, independent of OBD connection
 *  - SECONDARY: OBD speed×time integration when GPS unavailable
 *  - Trip detection: speed > 5 km/h (GPS or OBD) → start; 60s idle → end
 *  - Live UI clock: 1s interval (not 10s)
 *  - Persists last 100 trips to localStorage
 */

import { useState, useEffect } from 'react';
import { onOBDData }       from './obdService';
import { DEFAULT_FUEL_L_PER_100KM } from './vehicleAssumptions';
import { onGPSLocation }   from './gpsService';
import type { GPSLocation } from './gpsService';
import type { OBDData }    from './obdTypes';
import { safeSetRaw, safeGetRaw } from '../utils/safeStorage';
/* ARCH-05 — yıkıcı depolama işlemi `STORAGE_ADMIN` yetkisi ister. Normal ayar
   yazımı bu yetkiyi ASLA vermez (`SETTINGS_WRITE` ≠ `STORAGE_ADMIN`). */
import { authorizeStorageAdmin } from './security/enforcement';
import type { SecurityPrincipalClass } from './security/enforcement';
import { useStore }        from '../store/useStore';
/* P2 metrikleri: SAF yardımcılar (abonelik/timer/durum SAHİPLENMEZ).
   Bu modül TEK trip otoritesi olarak KALIR; yalnız hesap mantığı test
   edilebilir olsun diye dışarı alındı. */
import {
  createAccumulator, applySample, sealAccumulator,
  evaluateFuelMeasurement, fuelPercentToLitres, buildCoverageReport,
  type TripMetricsAccumulator,
} from './trip/tripMetricsAccumulator';
import {
  capturePriceSnapshot, computeTripCost, deriveEvidenceConfidence,
  type PriceSnapshot,
} from './trip/tripCostModel';
/* SEYİR DEFTERİ: hareket kanıtı kapısı + ham kanıt kaydı. İkisi de SAF/ince
   yardımcılardır; trip başlatma/bitirme hükmü BU DOSYADA kalır. */
import {
  observeMotion, hasMotionEvidence, emptyMotionEvidence, deriveTripJournalState,
  type MotionEvidence, type TripEndReason, type TripJournalState,
} from './trip/tripJournalModel';
import {
  beginJournal, finalizeJournal, recordJournalFix,
  recordJournalStopState, recordJournalEvent, recoverOpenJournal,
} from './trip/tripJournalStore';

/* ── Types ───────────────────────────────────────────────── */

export interface TripRecord {
  id:               string;
  startTime:        number;
  endTime:          number;
  distanceKm:       number;
  durationMin:      number;
  avgSpeedKmh:      number;
  maxSpeedKmh:      number;
  fuelConsumptionL: number;
  fuelCostTL:       number;
  drivingScore:     number;
  harshEvents:      number;

  /* ── P2 METRİKLERİ (hepsi OPSİYONEL — geriye uyum) ────────────────────
     Eski kayıtlarda bu alanlar YOKTUR; `undefined` okunur ve kanonik
     katmanda `UNAVAILABLE`'a düşer. **Var olmayan metrik `0` DEĞİLDİR.** */

  /** Sert fren sayısı — artık KALICI (eskiden RAM'de kayboluyordu). */
  harshBrakeCount?:   number;
  /** Ani hızlanma sayısı — artık KALICI. */
  harshAccelCount?:   number;

  /** Hareket / rölanti / bilinmeyen süre (dakika). Bilinmeyen idle SAYILMAZ. */
  movingMin?:         number;
  idleMin?:           number;
  unknownMin?:        number;
  /** Debounce'lu gerçek duruş sayısı (GPS jitter'ı sayılmaz). */
  stopCount?:         number;

  /** Tepe değerler — YALNIZ taze+geçerli OBD'den. Yoksa alan YOK. */
  maxRpm?:            number;
  maxEngineTempC?:    number;

  /** ÖLÇÜLEN yakıt tüketimi (yüzde puan). Yalnız tüm kapılar geçtiyse. */
  fuelUsedPercent?:   number;
  /** Yakıt ölçüm hükmü: `MEASURED` mi `ESTIMATED` mi. */
  fuelSource?:        'MEASURED' | 'DERIVED' | 'ESTIMATED' | 'UNAVAILABLE';
  /** Ölçüm reddedildiyse gerekçe (LAB/rapor için). */
  fuelRejectReason?:  string;

  /** Maliyet kaynağı + fiyat SNAPSHOT'ı (sonradan fiyat değişse maliyet DEĞİŞMEZ). */
  costSource?:        'MEASURED' | 'DERIVED' | 'ESTIMATED' | 'UNAVAILABLE';
  fuelUnitPrice?:     number;
  currency?:          string;
  priceSource?:       string;
  priceCapturedAtMs?: number;

  /** Mesafenin gerçek kaynağı: GPS haversine → MEASURED, OBD Euler → DERIVED. */
  distanceSource?:    'MEASURED' | 'DERIVED' | 'ESTIMATED' | 'UNAVAILABLE';

  /** Kanıta dayalı güven + hangi kanıtın sınırladığı. */
  confidence?:        'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  confidenceLimitedBy?: string;
  /* Kapsama kanıtı — LAB gözlemi ve confidence denetimi için. */
  speedSampleCount?:  number;
  obdCoverage?:       number;
  timeCoverage?:      number;
  dataGapCount?:      number;
  sourceSwitchCount?: number;

  /** Metrik şeması sürümü — alan kümesi değişirse artırılır. */
  metricsVersion?:    number;
}

/**
 * METRİK ŞEMA SÜRÜMÜ.
 *
 * P2 alan kümesi = 1. Yeni metrik eklenir veya bir alanın anlamı değişirse
 * ARTIRILMALIDIR; aksi halde eski ve yeni kayıtlar aynı sanılır.
 */
export const TRIP_METRICS_VERSION = 1;

interface ActiveTrip {
  /**
   * Yolculuk kimliği — artık BAŞLANGIÇTA üretilir (eskiden kapanışta).
   *
   * Seyir defteri ham kanıdı yolculuk SÜRERKEN yazılır ve türetilmiş özetle
   * (`TripRecord`) aynı anahtar üzerinden birleşir. Kimliği kapanışta üretmek,
   * sürerken yazılan kanıdın hangi yolculuğa ait olduğunu bilinmez kılardı.
   */
  tripId:      string;
  startTime:   number;   // Date.now()        — display/storage timestamp only
  startPerfMs: number;   // performance.now() — monotonic trip duration source
  distanceKm:  number;
  maxSpeedKmh: number;
  speedSum:    number;
  speedCount:  number;
  fuelAtStart: number;
  lastPerfMs:  number;   // monotonic — for OBD fallback distance calc
  lastSpeed:   number;   // for harsh-event detection
  harshEvents: number;
  /* Driver DNA (canlı, RAM): sert manevra sayacı YÖNE göre ayrıştırılır.
     `harshEvents` TOPLAM olarak korunur (drivingScore/TripRecord sözleşmesi
     DEĞİŞMEZ); aşağıdaki iki alan yalnız aktif yolculukta yaşar ve KALICI
     TripRecord'a YAZILMAZ — geçmiş kayıt biçimi bozulmasın. */
  harshBrakeEvents: number;   // hız ani DÜŞTÜ  (sert fren)
  harshAccelEvents: number;   // hız ani ARTTI  (ani hızlanma)
  // GPS primary distance tracking
  lastGPSLat:  number | null;
  lastGPSLng:  number | null;
  lastGPSTs:   number | null;   // performance.now() of last GPS fix used

  /**
   * HERHANGİ bir örneğin (GPS veya OBD) geldiği son monotonik an.
   *
   * Duruş penceresi (`_idleTimer`) YALNIZ callback gövdesinin içinde kurulur;
   * araç park edip GPS ve OBD tamamen SUSARSA hiçbir callback gelmez ve
   * yolculuk saatlerce açık kalırdı (Mavi "3 saattir yoldayız" derken gerçek
   * 40 dakikaydı). Bu damga, veri sessizliğinin ÖLÇÜLEBİLİR olmasını sağlar;
   * değerlendirme mevcut `_liveClock` tick'inde yapılır — YENİ timer YOK.
   */
  lastSamplePerfMs: number;

  /* ── P2 ─────────────────────────────────────────────────────────────
     Mesafenin GPS (haversine) ve OBD (Euler) payları AYRI tutulur:
     kaynak sınıfı ancak böyle dürüstçe belirlenir. */
  gpsDistanceKm: number;
  obdDistanceKm: number;
  /** Saf birikim (süre kovaları, tepe değerler, yakıt, olaylar, kapsama). */
  metrics: TripMetricsAccumulator;
  /** Trip BAŞINDA alınan fiyat anlık görüntüsü — sonradan DEĞİŞMEZ. */
  price: PriceSnapshot;
  /** Kapanış düzgün mü (idle penceresi doldu) yoksa kesildi mi. */
  cleanClose: boolean;
}

export interface TripState {
  active:          boolean;
  current:         (ActiveTrip & { liveDurationMin: number; liveDistanceKm: number }) | null;
  history:         TripRecord[];
  totalDistanceKm: number;
  totalTrips:      number;
}

/* ── Config ──────────────────────────────────────────────── */

const STORAGE_KEY          = 'car-launcher-trip-log';
const MAX_STORED_TRIPS     = 100;
const TRIP_START_SPEED_KMH = 5;
const TRIP_END_IDLE_MS     = 60_000;
/**
 * "Bu bir yolculuk SAYILIR mı" eşiği — TEK OTORİTE.
 *
 * `_endTrip` bu eşiğin altındaki trip'i `TripRecord`'a çevirmez (özet
 * ÜRETİLMEZ, yalnız ham kanıt `DISCARDED_TOO_SHORT` ile mühürlenir).
 *
 * `tripSessionService` de AYNI eşiği okur — export edilmemiş olsaydı
 * (gerçek cihaz kusuru, FIELD-2 2026-09-12) session bu sınıra HİÇ
 * bakmadan segment'i "yolculuğa çıkıldı" sayardı: GPS gürültüsünden açılıp
 * anında kapanan (mesafe ≈ 0) bir sahte trip bile Mavi'ye "6 dakikadır
 * yoldayız" DEDİRTİYORDU çünkü session'ın MOLA'ya (STOPPED) geçmiş olması
 * onu KAPATMIYOR — mola süresi `SESSION_MAX_BREAK_MS` (45 dk) dolana kadar
 * "yola çıkıldı" gösterime DEVAM eder. İki otorite AYNI eşiği paylaşmazsa
 * biri "geçersiz" derken öteki "yoldayız" der.
 */
export const TRIP_DISCARD_MIN_DURATION_MIN = 1;
export const TRIP_DISCARD_MIN_DISTANCE_KM  = 0.1;
/**
 * VERİ SESSİZLİĞİ kapanış eşiği — duruş eşiğinden AYRI ve bilinçli olarak ÇOK
 * DAHA UZUN.
 *
 * `TRIP_END_IDLE_MS` "aracın DURDUĞUNU GÖRDÜK" demektir (hız örneği geldi ve
 * sıfırdı). Bu eşik ise "HİÇBİR ŞEY GÖRMÜYORUZ" demektir — ikisi aynı kanıt
 * değildir. Sessizliği 60 sn'de kapatmak uzun bir tünelde (GPS yok, OBD yok)
 * sürüşü ortadan bölerdi: Ovit ~14,3 km ≈ 11 dk. 15 dk o tavanın üstünde,
 * gerçek bir parkın ise çok altındadır.
 *
 * Kapanış `cleanClose: false` ile işaretlenir: duruşu GÖZLEMEDİK, kanıtı
 * KAYBETTİK — bunu "düzgün kapanış" saymak sahte güven üretirdi.
 */
const TRIP_SILENCE_END_MS  = 15 * 60_000;
const FUEL_L_PER_100KM     = DEFAULT_FUEL_L_PER_100KM;  // E-05: tek otorite
const FUEL_PRICE_TL_PER_L  = 45;

// GPS mesafe filtreleri
const GPS_MIN_ACCURACY_M   = 50;   // 50m'den kötü fix mesafeye eklenmez
const GPS_MAX_JUMP_M       = 300;  // tek seferde 300m'den fazla sıçrama → atlat
const GPS_MIN_DIST_M       = 5;    // 5m'den küçük delta → gürültü, atlat

/* ── Haversine ───────────────────────────────────────────── */

function _haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 6_371_000;
  const dL = ((lat2 - lat1) * Math.PI) / 180;
  const dG = ((lng2 - lng1) * Math.PI) / 180;
  const a  = Math.sin(dL / 2) ** 2 +
             Math.cos((lat1 * Math.PI) / 180) *
             Math.cos((lat2 * Math.PI) / 180) *
             Math.sin(dG / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Trip ID ─────────────────────────────────────────────── */

let _tripSeq = performance.now();
function generateTripId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `trip-${crypto.randomUUID()}`;
  }
  _tripSeq += 1;
  return `trip-${Math.floor(_tripSeq)}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ── Persistence ─────────────────────────────────────────── */

function _load(): TripRecord[] {
  try {
    const raw = safeGetRaw(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TripRecord[]) : [];
  } catch {
    return [];
  }
}

function _save(records: TripRecord[]): void {
  safeSetRaw(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_STORED_TRIPS)));
}

/* ── Module state ────────────────────────────────────────── */

const _history = _load();

function _sumDistance(records: TripRecord[]): number {
  return Math.round(records.reduce((s, r) => s + r.distanceKm, 0) * 10) / 10;
}

let _state: TripState = {
  active:          false,
  current:         null,
  history:         _history,
  totalDistanceKm: _sumDistance(_history),
  totalTrips:      _history.length,
};

const _listeners = new Set<(s: TripState) => void>();
let _active:    ActiveTrip | null = null;
let _idleTimer: ReturnType<typeof setTimeout>  | null = null;
let _liveClock: ReturnType<typeof setInterval> | null = null;
let _started  = false;

/**
 * BİRİKEN HAREKET KANITI — yolculuk açılmadan ÖNCE.
 *
 * ÖLÇÜLEN KUSUR: tek bir GPS fix'i 5 km/h'i aştığı anda yolculuk açılıyordu.
 * Park hâlindeki araçta tek bozuk fix (otopark yansıması, soğuk başlangıç hız
 * sıçraması) sahte yolculuk üretir — ve o sahte yolculuk sonradan buluta
 * yüklenip Fleet mesafesini kirletir. **Konum bilmek hareket etmek DEĞİLDİR.**
 * Kapı `tripJournalModel`'dedir (saf, test edilebilir); burada yalnız birikim
 * tutulur.
 */
let _motion: MotionEvidence = emptyMotionEvidence();

/** Son yolculuğun kapanış gerekçesi — LAB gözlemi (sahte "başarı" YOK). */
let _lastEndReason: TripEndReason | null = null;
/** Son KAPANMIŞ yolculuğun kimliği — tamamlandı kartı tek atış kilidi. */
let _lastCompletedTripId: string | null = null;

/**
 * HERHANGİ bir örneğin (GPS veya OBD) geldiği son monotonik an — trip AKTİF
 * OLMASA BİLE.
 *
 * ── ÖLÇÜLEN KUSUR (gerçek cihaz — FIELD-2, 2026-09-12) ──────────────────
 * `getTripJournalGlance()` "son örnek anı"nı yalnız `_active.lastSamplePerfMs`
 * üzerinden okuyordu. `_active` HİÇ yolculuk yokken (araç park hâlinde,
 * GPS/OBD sağlıklı akıyor) her zaman `null`dur — dolayısıyla bu alan da
 * her zaman `null` gönderiliyordu. `deriveTripJournalState` "kanıt yok" ile
 * "kanıt bayat" ayrımını YAPAMAZ hâle geliyor ve `active=false` dalında
 * `PARKED`'a ULAŞMASI YAPISAL OLARAK İMKÂNSIZ oluyordu: sistem GPS fix'i
 * varken bile sürekli `UNKNOWN_DEGRADED` gösteriyordu (gerçek cihazda LAB
 * ekranında doğrulandı). Bu alan trip yaşam döngüsünden BAĞIMSIZDIR —
 * yalnız "veri akışı var mı" sorusunu, trip'ten önce de sonra da cevaplar.
 */
let _lastAnySampleMonoMs: number | null = null;

// Son OBD verisini cache'le — GPS olmadığında fallback için
let _lastObdFuel = -1;

/* ── Driving score ───────────────────────────────────────── */

function _calcScore(maxSpeed: number, harshEvents: number, avgSpeed: number): number {
  let score = 100;
  score -= Math.min(harshEvents * 8, 40);
  if      (maxSpeed > 180) score -= 25;
  else if (maxSpeed > 150) score -= 15;
  else if (maxSpeed > 130) score -= 8;
  else if (maxSpeed > 120) score -= 4;
  if      (avgSpeed > 100) score -= 10;
  else if (avgSpeed > 80)  score -= 5;
  return Math.max(0, Math.round(score));
}

/* ── Notify ──────────────────────────────────────────────── */

/** Canlı anlık görüntü — aktif trip'in süre/mesafesi performance.now ile hesaplanır. */
function _computeSnapshot(): TripState {
  return {
    ..._state,
    history: [..._state.history],
    current: _active
      ? {
          ..._active,
          liveDurationMin: Math.floor((performance.now() - _active.startPerfMs) / 60_000),
          liveDistanceKm:  Math.round(_active.distanceKm * 100) / 100,
        }
      : null,
  };
}

function _notify(): void {
  const snap = _computeSnapshot();
  _listeners.forEach((fn) => fn(snap));
}

function _setState(partial: Partial<TripState>): void {
  _state = { ..._state, ...partial };
  _notify();
}

/* ── P2: araç profili okumaları (fail-soft) ──────────────── */

/**
 * Aktif araç profilinden DEPO KAPASİTESİ (litre).
 *
 * Bu bir **kullanıcı girdisidir**, üretici verisi DEĞİL — bu yüzden litre
 * dönüşümü daima `DERIVED`'dır, `MEASURED` olamaz. Profil yoksa `null`
 * ve litre ÜRETİLMEZ.
 */
function _readTankCapacityL(): number | null {
  try {
    const { settings } = useStore.getState();
    const p = settings.activeVehicleProfileId
      ? settings.vehicleProfiles.find((x) => x.id === settings.activeVehicleProfileId)
      : undefined;
    const t = p?.fuelTankL;
    return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : null;
  } catch { return null; }
}

/**
 * Yakıt birim fiyatı anlık görüntüsü.
 *
 * ⚠️ Bugün **kullanıcı ayarı YOK** — araç profilinde veya ayarlarda birim
 * fiyat alanı bulunamadı (kod taraması). Bu yüzden varsayılan fallback
 * kullanılır ve maliyet **daima `ESTIMATED`** olur. Kullanıcı fiyat alanı
 * eklendiğinde burası `USER_DEFINED` döner ve maliyet `DERIVED`'a yükselir
 * — hesap mantığı DEĞİŞMEZ.
 */
function _capturePrice(): PriceSnapshot {
  return capturePriceSnapshot({ userUnitPrice: null, nowMs: Date.now() });
}

/* ── Trip lifecycle ──────────────────────────────────────── */

/**
 * Canlı tick — 5 sn'de bir. İKİ iş yapar:
 *   1. Veri sessizliğini DEĞERLENDİRİR (aşağıya bkz.)
 *   2. Dinleyicilere haber verir (eski davranış, birebir)
 *
 * NEDEN BURADA: kapanış zamanlayıcısı yalnız `_onGPS`/`_onOBD` gövdesinde
 * kuruluyordu. Örnek HİÇ gelmezse o gövdeler çalışmaz → yolculuk kapanmaz.
 * Tick zaten VAR ve zaten koşuyor; değerlendirmeyi buraya bağlamak YENİ bir
 * zamanlayıcı doğurmaz (tek sahiplik korunur).
 *
 * `_endTrip` kendi içinde `_liveClock`'u temizler → tick kendi kendini durdurur.
 */
function _liveTick(): void {
  const trip = _active;
  if (trip) {
    const silentMs = performance.now() - trip.lastSamplePerfMs;
    if (silentMs >= TRIP_SILENCE_END_MS) {
      if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
      /* Duruşu GÖRMEDİK, kanıtı kaybettik → `cleanClose` FALSE kalır. */
      _endTrip('DATA_SILENCE');
      return;   // _endTrip zaten durum yayınlar
    }
  }
  _notify();
}

/**
 * Hareket kanıtını işle; YETERSE yolculuğu aç.
 *
 * Kapı geçilmeden yolculuk AÇILMAZ ve kanıt eşiğin altındaki ilk örnekte
 * SIFIRLANIR (`observeMotion` hükmü) — birikmiş kanıt bir kalkışı anlatmıyorsa
 * saklanmaz.
 */
function _considerStart(speedKmh: number, source: 'GPS' | 'OBD', fuelLevel: number): void {
  _motion = observeMotion(_motion, {
    monoMs: performance.now(),
    speedKmh,
    source,
    thresholdKmh: TRIP_START_SPEED_KMH,
  });
  if (_active) return;
  if (!hasMotionEvidence(_motion)) return;
  _startTrip(speedKmh, fuelLevel, _motion);
}

function _startTrip(speedKmh: number, fuelLevel: number, evidence: MotionEvidence): void {
  if (_active) return;
  const perfNow = performance.now();
  /* Yolculuk İLK kanıtın anında başlamıştır, kapının geçildiği anda değil —
     aksi halde kalkışın ilk saniyeleri süreden düşerdi. */
  const startPerfMs = evidence.firstMonoMs !== null
    && Number.isFinite(evidence.firstMonoMs)
    && evidence.firstMonoMs <= perfNow
      ? evidence.firstMonoMs
      : perfNow;
  const startWallMs = Date.now() - Math.round(perfNow - startPerfMs);
  _active = {
    tripId:      generateTripId(),
    startTime:   startWallMs,
    startPerfMs,
    distanceKm:  0,
    maxSpeedKmh: speedKmh,
    speedSum:    speedKmh,
    speedCount:  1,
    fuelAtStart: fuelLevel,
    lastPerfMs:  perfNow,
    lastSpeed:   speedKmh,
    harshEvents: 0,
    harshBrakeEvents: 0,
    harshAccelEvents: 0,
    lastGPSLat:  null,
    lastGPSLng:  null,
    lastGPSTs:   null,
    lastSamplePerfMs: perfNow,
    gpsDistanceKm: 0,
    obdDistanceKm: 0,
    metrics: createAccumulator(),
    /* Fiyat SNAPSHOT'ı trip BAŞINDA alınır: trip bittikten sonra kullanıcı
       fiyatı değiştirse geçmiş trip maliyeti sessizce değişmesin (§4). */
    price: _capturePrice(),
    cleanClose: false,
  };

  // Live clock: 5s — 1s'de pil tüketimi artıyor, 5s yeterli görünürlük sağlar
  if (_liveClock) clearInterval(_liveClock);
  _liveClock = setInterval(_liveTick, 5_000);

  /* Ham kanıt defterini aç. Depo hatası yolculuğu BOZMAZ (fail-soft): özet
     yine üretilir, yalnız rota izi eksik kalır. */
  beginJournal({
    tripId: _active.tripId,
    startedAtMs: startWallMs,
    startMonoMs: startPerfMs,
    startLocation: null,
    motionEvidence: {
      sampleCount: evidence.count,
      spanMs: evidence.firstMonoMs !== null && evidence.lastMonoMs !== null
        ? Math.max(0, evidence.lastMonoMs - evidence.firstMonoMs) : 0,
      sourceCount: evidence.sourceCount,
    },
  });

  _setState({ active: true });
}

/**
 * Örnek sonrası defter kaydı — duruş geçişi + adaptif rota noktası.
 *
 * Duruş hükmü `tripMetricsAccumulator`'ındır; burada yalnız GEÇİŞ gözlenir
 * (aynı duruş iki kez mühürlenmesin).
 */
function _journalSample(
  trip: ActiveTrip,
  prevStopSincePerfMs: number | null,
  monoMs: number,
  lat: number | null,
  lon: number | null,
  speedKmh: number | null,
): void {
  try {
    const stopped = trip.metrics.stopSincePerfMs !== null;
    if (stopped !== (prevStopSincePerfMs !== null)) {
      recordJournalStopState(monoMs, stopped);
    }
    recordJournalFix({ monoMs, lat, lon, speedKmh, stopped });
  } catch { /* kanıt kaydı yolculuk akışını ASLA bozmaz */ }
}

/**
 * Yolculuğu kapat.
 *
 * `reason` KAPANIŞIN KANITIDIR ve uydurulmaz: duruş penceresi dolduysa
 * `IDLE_WINDOW`, veri kesildiyse `DATA_SILENCE`, uygulama kapandıysa
 * `SERVICE_STOPPED`. Yalnız `IDLE_WINDOW` düzgün kapanış sayılır
 * (`cleanClose`) — kanıtı kaybetmek bir bitiş kanıtı DEĞİLDİR.
 */
function _endTrip(reason: TripEndReason = 'UNKNOWN'): void {
  if (!_active) return;

  const endPerfMs   = performance.now();
  const durationMs  = endPerfMs - _active.startPerfMs;
  const durationMin = Math.round(durationMs / 60_000);
  const endLocation = _active.lastGPSLat !== null && _active.lastGPSLng !== null
    ? { lat: _active.lastGPSLat, lon: _active.lastGPSLng }
    : null;

  // 1 dakika veya 100m altındaki yolculukları kaydetme
  if (durationMin < TRIP_DISCARD_MIN_DURATION_MIN
    || _active.distanceKm < TRIP_DISCARD_MIN_DISTANCE_KM) {
    /* Özet ÜRETİLMEZ ama ham kanıt gerekçesiyle mühürlenir: "kaydedilmedi"
       ile "hiç olmadı" aynı şey değildir. */
    try {
      finalizeJournal({
        tripId: _active.tripId, endedAtMs: Date.now(), endMonoMs: endPerfMs,
        endLocation, endReason: 'DISCARDED_TOO_SHORT',
      });
    } catch { /* fail-soft */ }
    _lastEndReason = 'DISCARDED_TOO_SHORT';
    _motion = emptyMotionEvidence();
    _active = null;
    if (_liveClock) { clearInterval(_liveClock); _liveClock = null; }
    _setState({ active: false, current: null });
    return;
  }

  const avgSpeed     = _active.speedCount > 0 ? Math.round(_active.speedSum / _active.speedCount) : 0;
  const drivingScore = _calcScore(_active.maxSpeedKmh, _active.harshEvents, avgSpeed);
  const distanceKm   = Math.round(_active.distanceKm * 10) / 10;

  /* ── P2 METRİK ÜRETİMİ ─────────────────────────────────────────────────
     Buradaki her adım FAIL-SOFT: metrik üretimi düşse bile trip KAYDEDİLİR
     (eski davranış korunur), yalnız yeni alanlar eksik kalır. */
  let p2: Partial<TripRecord> = {};
  try {
    const acc = sealAccumulator(_active.metrics, performance.now());
    const coverage = buildCoverageReport(acc);

    /* Mesafe kaynağı: GPS payı baskınsa ÖLÇÜM, OBD Euler baskınsa TÜRETME.
       "Çoğunlukla GPS" demek için %70 eşiği; altı dürüstçe DERIVED. */
    const totalD = _active.gpsDistanceKm + _active.obdDistanceKm;
    const distanceSource: TripRecord['distanceSource'] =
      totalD <= 0 ? 'UNAVAILABLE'
      : _active.gpsDistanceKm / totalD >= 0.7 ? 'MEASURED'
      : 'DERIVED';

    /* ── YAKIT (§3): yüzde ölçümü → litre DÖNÜŞÜMÜ ── */
    const verdict = evaluateFuelMeasurement(acc, distanceKm);
    let fuelL: number | null = null;
    let fuelSource: TripRecord['fuelSource'] = 'UNAVAILABLE';
    let fuelRejectReason: string | undefined;

    if (verdict.measured) {
      const litres = fuelPercentToLitres(verdict.usedPercent, _readTankCapacityL());
      if (litres !== null) {
        /* Ölçülen yüzde + KULLANICI GİRDİSİ depo → dönüşüm DERIVED'dır. */
        fuelL = litres;
        fuelSource = 'DERIVED';
      } else {
        /* Depo kapasitesi yok/güvenilmez → litre ÜRETİLMEZ. Yüzde ölçümü
           saklanır; litre alanı sabit varsayıma DÜŞER (ESTIMATED). */
        fuelL = Math.round((distanceKm / 100) * FUEL_L_PER_100KM * 10) / 10;
        fuelSource = 'ESTIMATED';
        fuelRejectReason = 'NO_TANK_CAPACITY';
      }
      p2 = { ...p2, fuelUsedPercent: verdict.usedPercent };
    } else {
      /* Ölçüm kapıları geçilmedi → mevcut 8,5 L/100km SABİTİ kullanılır ama
         `ESTIMATED` etiketiyle; gerçek ölçüm gibi SUNULMAZ. */
      fuelL = Math.round((distanceKm / 100) * FUEL_L_PER_100KM * 10) / 10;
      fuelSource = 'ESTIMATED';
      fuelRejectReason = verdict.reason;
    }

    /* ── MALİYET (§4): fiyat SNAPSHOT'ı ile ── */
    const cost = computeTripCost({
      fuelUsedL: fuelL,
      /* Bu noktada `fuelSource` daima DERIVED veya ESTIMATED'dır (yukarıdaki
         iki dal); tip daralması bunu zaten garantiliyor. */
      fuelSource,
      price: _active.price,
    });

    /* ── CONFIDENCE (§9): kanıta dayalı ── */
    const conf = deriveEvidenceConfidence({
      coverage,
      distanceSource: distanceSource === 'UNAVAILABLE' ? 'UNAVAILABLE' : distanceSource,
      durationSource: 'MEASURED',   // monotonik saat
      cleanClose: _active.cleanClose,
      durationMs: durationMs,
    });

    p2 = {
      ...p2,
      harshBrakeCount: acc.harshBrakeCount,
      harshAccelCount: acc.harshAccelCount,
      movingMin:  Math.round(acc.movingMs / 60_000),
      idleMin:    Math.round(acc.idleMs / 60_000),
      unknownMin: Math.round(acc.unknownMs / 60_000),
      stopCount:  acc.stopCount,
      /* Tepe değerler: ölçülmediyse alan KONMAZ (0 yazılmaz). */
      ...(acc.maxRpm !== null ? { maxRpm: acc.maxRpm } : {}),
      ...(acc.maxEngineTempC !== null ? { maxEngineTempC: acc.maxEngineTempC } : {}),
      fuelSource,
      ...(fuelRejectReason !== undefined ? { fuelRejectReason } : {}),
      costSource: cost.source === 'MEASURED' ? 'DERIVED' : cost.source,
      ...(_active.price.unitPrice !== null ? { fuelUnitPrice: _active.price.unitPrice } : {}),
      ...(_active.price.currency !== null ? { currency: _active.price.currency } : {}),
      priceSource: _active.price.source,
      ...(_active.price.capturedAtMs !== null
        ? { priceCapturedAtMs: _active.price.capturedAtMs } : {}),
      distanceSource,
      confidence: conf.overall,
      confidenceLimitedBy: conf.limitedBy,
      speedSampleCount: coverage.speedSampleCount,
      ...(coverage.obdCoverage !== null ? { obdCoverage: coverage.obdCoverage } : {}),
      ...(coverage.timeCoverage !== null ? { timeCoverage: coverage.timeCoverage } : {}),
      dataGapCount: coverage.dataGapCount,
      sourceSwitchCount: coverage.sourceSwitchCount,
      metricsVersion: TRIP_METRICS_VERSION,
    };

    /* Litre ve maliyet ESKİ alanlara da yazılır (geriye uyum) — ama artık
       yanlarında kaynak etiketi var. */
    if (fuelL !== null) p2 = { ...p2, fuelConsumptionL: fuelL };
    if (cost.cost !== null) p2 = { ...p2, fuelCostTL: cost.cost };
  } catch {
    /* FAIL-SOFT: P2 metrikleri üretilemezse trip yine kaydedilir. */
    p2 = {};
  }

  /* Eski sözleşme: P2 üretilemediyse sabit varsayım kullanılır (DEĞİŞMEDİ). */
  const legacyFuelL = Math.round((distanceKm / 100) * FUEL_L_PER_100KM * 10) / 10;

  const endedAtMs = Date.now();

  const record: TripRecord = {
    /* Kimlik BAŞLANGIÇTA üretildi — ham kanıt defteri bu anahtarla yazıldı. */
    id:               _active.tripId,
    startTime:        _active.startTime,
    endTime:          endedAtMs,
    distanceKm,
    durationMin,
    avgSpeedKmh:      avgSpeed,
    maxSpeedKmh:      Math.round(_active.maxSpeedKmh),
    fuelConsumptionL: legacyFuelL,
    fuelCostTL:       Math.round(legacyFuelL * FUEL_PRICE_TL_PER_L),
    drivingScore,
    harshEvents:      _active.harshEvents,
    ...p2,
  };

  /* Ham kanıdı özetle AYNI anahtar altında mühürle. */
  try {
    finalizeJournal({
      tripId: _active.tripId, endedAtMs, endMonoMs: endPerfMs,
      endLocation, endReason: reason,
    });
  } catch { /* fail-soft */ }
  _lastEndReason = reason;
  _lastCompletedTripId = record.id;
  _motion = emptyMotionEvidence();

  _active = null;
  if (_liveClock) { clearInterval(_liveClock); _liveClock = null; }

  const newHistory = [record, ..._state.history];
  _save(newHistory);

  _setState({
    active:          false,
    current:         null,
    history:         newHistory,
    totalDistanceKm: _sumDistance(newHistory),
    totalTrips:      newHistory.length,
  });
}

/* ── GPS handler (primary km source) ────────────────────── */

function _onGPS(loc: GPSLocation | null): void {
  if (!loc) return;

  /* Seyir durumu kanıtı: trip AKTİF OLMASA BİLE "veri akıyor" damgası
     yazılır — PARKED'ın türetilebilmesi buna bağlıdır (bkz. tanım). */
  _lastAnySampleMonoMs = performance.now();

  const speedKmh = loc.speed != null ? loc.speed * 3.6 : 0;

  // Trip başlat (GPS hızıyla) — TEK fix yetmez, hareket kanıtı birikmelidir.
  if (speedKmh > TRIP_START_SPEED_KMH) {
    if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
    _considerStart(speedKmh, 'GPS', _lastObdFuel);
  } else if (speedKmh < 1) {
    /* Eşik altı örnek birikmiş kanıtı sıfırlar (park hâlindeki sıçramalar
       gün boyu toplanıp sahte yolculuk açmasın). */
    _motion = observeMotion(_motion, {
      monoMs: performance.now(), speedKmh, source: 'GPS',
      thresholdKmh: TRIP_START_SPEED_KMH,
    });
    if (_active) {
      // Durdu — idle timer
      if (!_idleTimer) {
        _idleTimer = setTimeout(() => {
          _idleTimer = null;
          /* P2: duruş penceresi DOLDU → düzgün kapanış (confidence kanıtı). */
          if (_active) _active.cleanClose = true;
          _endTrip('IDLE_WINDOW');
        }, TRIP_END_IDLE_MS);
      }
    }
  }

  if (!_active) return;

  /* Sessizlik damgası: örnek GELDİ. Mesafe/tazelik kapılarından ÖNCE yazılır —
     kalitesiz bir fix de "veri akıyor" kanıtıdır (sessizlik ≠ kötü veri). */
  _active.lastSamplePerfMs = performance.now();

  // ── GPS haversine mesafe ─────────────────────────────────
  const hasGoodAccuracy = loc.accuracy > 0 && loc.accuracy <= GPS_MIN_ACCURACY_M;

  if (
    hasGoodAccuracy &&
    _active.lastGPSLat !== null &&
    _active.lastGPSLng !== null
  ) {
    const distM = _haversineMeters(
      _active.lastGPSLat, _active.lastGPSLng,
      loc.latitude,       loc.longitude,
    );

    // Gürültü ve GPS sıçramalarını filtrele
    if (distM >= GPS_MIN_DIST_M && distM <= GPS_MAX_JUMP_M) {
      _active.distanceKm += distM / 1000;
      /* P2: GPS payı AYRI sayılır — mesafe kaynağı sınıfı buna bakar. */
      _active.gpsDistanceKm += distM / 1000;
    }
  }

  /* ── P2: örneği saf birikime ver (fail-soft) ────────────────────────── */
  const _prevStopGps = _active.metrics.stopSincePerfMs;
  const _sampleMonoGps = performance.now();
  try {
    _active.metrics = applySample(_active.metrics, {
      perfNowMs: _sampleMonoGps,
      source: 'GPS',
      speedKmh: speedKmh > 0 ? speedKmh : (loc.speed != null ? 0 : null),
      fresh: true,   // GPS fix'i buraya geldiyse gpsService kapılarını geçmiştir
    });
  } catch { /* metrik birikimi trip akışını ASLA bozmaz */ }

  /* SEYİR DEFTERİ: duruş geçişi + adaptif rota noktası. Koordinat yalnız
     kabul edilebilir doğrulukta yazılır — kötü fix rota izini bozar. */
  _journalSample(
    _active, _prevStopGps, _sampleMonoGps,
    hasGoodAccuracy ? loc.latitude : null,
    hasGoodAccuracy ? loc.longitude : null,
    loc.speed != null ? speedKmh : null,
  );

  // Sonraki delta için bu fix'i kaydet
  if (hasGoodAccuracy) {
    _active.lastGPSLat = loc.latitude;
    _active.lastGPSLng = loc.longitude;
    _active.lastGPSTs  = performance.now();
  }

  // Max hız ve ortalama hız güncelle
  if (speedKmh > 0) {
    _active.maxSpeedKmh = Math.max(_active.maxSpeedKmh, speedKmh);
    _active.speedSum   += speedKmh;
    _active.speedCount += 1;

    // Sert manevra tespiti (≥15 km/h delta). Driver DNA için YÖN de ayrıştırılır:
    // delta negatif → sert fren, pozitif → ani hızlanma. Toplam sayaç DEĞİŞMEDİ.
    const speedDelta = speedKmh - _active.lastSpeed;
    if (Math.abs(speedDelta) > 15) {
      _active.harshEvents += 1;
      if (speedDelta < 0) _active.harshBrakeEvents += 1;
      else                _active.harshAccelEvents += 1;
      /* Defterde olay ZAMANI ve ŞİDDETİ durur; KONUM durmaz (§ olay
         koordinat taşımaz — rota izi ayrı ve yalnız yereldir). */
      recordJournalEvent(
        _sampleMonoGps,
        speedDelta < 0 ? 'HARSH_BRAKE' : 'HARSH_ACCEL',
        Math.round(Math.abs(speedDelta)),
      );
    }
    _active.lastSpeed = speedKmh;
  }

  // OBD fallback zaman damgasını güncelle — GPS gelince Euler sayacını sıfırla
  _active.lastPerfMs = performance.now();
}

/* ── OBD handler (secondary — yakıt + harsh events + fallback km) ── */

function _onOBD(data: OBDData): void {
  const speedKmh  = data.speed;
  const fuelLevel = data.fuelLevel;
  if (speedKmh < 0 || speedKmh > 300) return;
  if (fuelLevel < -1 || fuelLevel > 100) return;

  /* Seyir durumu kanıtı: trip AKTİF OLMASA BİLE (bkz. GPS yolu, aynı gerekçe). */
  _lastAnySampleMonoMs = performance.now();

  if (fuelLevel >= 0) _lastObdFuel = fuelLevel;

  // GPS yoksa OBD hızını trip tespiti için kullan
  const activeSnap = _active;
  const gpsRecent = activeSnap !== null &&
    activeSnap.lastGPSTs !== null &&
    (performance.now() - activeSnap.lastGPSTs) < 5_000;

  if (speedKmh > TRIP_START_SPEED_KMH) {
    if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
    _considerStart(speedKmh, 'OBD', fuelLevel);
  } else if (speedKmh === 0) {
    /* Eşik altı örnek birikmiş kanıtı sıfırlar (bkz. GPS yolu). */
    _motion = observeMotion(_motion, {
      monoMs: performance.now(), speedKmh, source: 'OBD',
      thresholdKmh: TRIP_START_SPEED_KMH,
    });
    if (_active && !_idleTimer) {
      _idleTimer = setTimeout(() => {
        _idleTimer = null;
        /* P2: duruş penceresi DOLDU → düzgün kapanış (confidence kanıtı). */
        if (_active) _active.cleanClose = true;
        _endTrip('IDLE_WINDOW');
      }, TRIP_END_IDLE_MS);
    }
  }

  const trip = _active;
  if (!trip) return;

  /* Sessizlik damgası: OBD örneği GELDİ (bayat ECU verisi de akış kanıtıdır). */
  trip.lastSamplePerfMs = performance.now();

  // GPS güncel değilse OBD speed×time fallback (Euler integration)
  if (!gpsRecent && speedKmh > TRIP_START_SPEED_KMH) {
    const perfNow = performance.now();
    const dtHours = (perfNow - trip.lastPerfMs) / 3_600_000;
    const deltKm  = speedKmh * dtHours;

    // Makul delta (< 1 km per OBD tick) — resume/background koruması
    if (deltKm >= 0 && deltKm < 1) {
      trip.distanceKm += deltKm;
      /* P2: OBD Euler payı AYRI sayılır — bu pay baskınsa mesafe kaynağı
         MEASURED değil DERIVED'dır (hız×zaman viraj/rampa hatası biriktirir). */
      trip.obdDistanceKm += deltKm;
    }
    trip.lastPerfMs = perfNow;
    _notify();
  }

  /* ── P2: OBD örneğini saf birikime ver (fail-soft) ──────────────────
     Tazelik kapısı `data.dataFresh`tir: bayat ECU verisi tepe değer,
     yakıt okuması veya sert olay ÜRETMEZ. */
  const _prevStopObd = trip.metrics.stopSincePerfMs;
  const _sampleMonoObd = performance.now();
  try {
    trip.metrics = applySample(trip.metrics, {
      perfNowMs: _sampleMonoObd,
      source: 'OBD',
      speedKmh: data.speed,
      fresh: data.dataFresh !== false,
      rpm: data.rpm,
      engineTempC: data.engineTemp,
      fuelPercent: data.fuelLevel,
      transportConnected: data.transportConnected,
    });
  } catch { /* metrik birikimi trip akışını ASLA bozmaz */ }

  /* SEYİR DEFTERİ: OBD örneği KONUM TAŞIMAZ → rota noktası üretmez, yalnız
     duruş geçişi mühürlenir (duruş kanıtı GPS'e bağlı değildir). */
  _journalSample(trip, _prevStopObd, _sampleMonoObd, null, null, data.speed);
}

/* ── Public API ──────────────────────────────────────────── */

let _gpsUnsub: (() => void) | null = null;
let _obdUnsub: (() => void) | null = null;

export function startTripLog(): void {
  if (_started) return;
  _started = true;

  /* ÇÖKME KURTARMA: diskte mühürlenmemiş bir taslak kaldıysa `UNKNOWN`
     gerekçesiyle kapatılır. Bunu YAPMAMAK, çökmeden önceki yolculuğun
     kanıtını sessizce kaybetmek olurdu. Yolculuk AÇMAZ, kanıt ÜRETMEZ. */
  try { recoverOpenJournal(); } catch { /* fail-soft */ }

  // GPS primary — haversine mesafe
  _gpsUnsub = onGPSLocation((loc) => {
    try { _onGPS(loc); } catch { /* trip log must never crash */ }
  });

  // OBD secondary — yakıt + fallback km
  _obdUnsub = onOBDData((data) => {
    try { _onOBD(data); } catch { /* trip log must never crash */ }
  });
}

export function stopTripLog(): void {
  if (!_started) return;
  _started = false;
  if (_gpsUnsub) { try { _gpsUnsub(); } catch { /* ignore */ } _gpsUnsub = null; }
  if (_obdUnsub) { try { _obdUnsub(); } catch { /* ignore */ } _obdUnsub = null; }
  if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
  if (_liveClock) { clearInterval(_liveClock); _liveClock = null; }
  _endTrip('SERVICE_STOPPED');
}

export function deleteTrip(id: string): void {
  const newHistory = _state.history.filter((t) => t.id !== id);
  _save(newHistory);
  _setState({
    history:         newHistory,
    totalDistanceKm: _sumDistance(newHistory),
    totalTrips:      newHistory.length,
  });
}

/**
 * TÜM seyahat geçmişini siler — GERİ DÖNDÜRÜLEMEZ.
 *
 * ARCH-05: çağıran `STORAGE_ADMIN` yetkisine sahip DEĞİLSE hiçbir şey
 * silinmez ve `false` döner — kısmi silme, sessiz başarı ya da "sildim"
 * iddiası YOKTUR. Varsayılan principal `LOCAL_UI`dir: bu ekran yalnız baş
 * ünitenin başındaki kullanıcıya açıktır; Mavi ve telefon KENDİ sınıflarını
 * vermek zorundadır ve o sınıfların bu yetkisi yoktur.
 *
 * @returns silme GERÇEKTEN yapıldıysa `true`.
 */
export function clearAllTrips(principal: SecurityPrincipalClass = 'LOCAL_UI'): boolean {
  const authz = authorizeStorageAdmin({
    principalClass: principal, operation: 'CLEAR_TRIP_HISTORY',
    operationId: `storage.trips.clear:${Date.now()}`,
  });
  if (!authz.allowed) return false;
  _save([]);
  _setState({ history: [], totalDistanceKm: 0, totalTrips: 0 });
  return true;
}

export function onTripState(fn: (s: TripState) => void): () => void {
  _listeners.add(fn);
  fn({ ..._state, history: [..._state.history], current: null });
  return () => { _listeners.delete(fn); };
}

/**
 * Senkron anlık görüntü — aktif trip'in CANLI süre/mesafesiyle. companion
 * bağlam enjeksiyonu (World View) prompt kurarken bunu okur: onTripState'in
 * immediate-emit'i `current: null` gönderdiği için tek-atış subscribe canlı
 * yolculuk verisini vermez; bu getter hesaplı current döndürür.
 */
export function getTripSnapshot(): TripState {
  return _computeSnapshot();
}

/* ── Kanonik seyir durumu (PROJEKSİYON — yeni otorite DEĞİL) ─────────── */

export interface TripJournalGlance {
  /** Kanonik seyir durumu — `tripJournalModel` hükmü. */
  readonly state: TripJournalState;
  /** Açık yolculuğun kimliği; yoksa `null`. */
  readonly tripId: string | null;
  /** Son KAPANMIŞ yolculuğun kimliği — tamamlandı kartı tek atış anahtarı. */
  readonly lastCompletedTripId: string | null;
  readonly lastEndReason: TripEndReason | null;
  /** Hareket kanıtı yolculuk açmaya yeter mi (kapı durumu). */
  readonly motionEvidenceReady: boolean;
  readonly motionSampleCount: number;
  /** Kapanış penceresi işliyor mu. */
  readonly endPending: boolean;
}

/**
 * Seyir durumunun TEK okuma noktası — Mavi · UI · LAB buradan okur.
 *
 * PROJEKSİYONDUR: hiçbir şey ölçmez, başlatmaz, kapatmaz. Durum, bu dosyanın
 * ZATEN sahip olduğu gerçeklerden (aktif yolculuk · son örnek anı · duruş ·
 * kapanış penceresi) saf bir fonksiyonla türetilir. ASLA fırlatmaz.
 */
export function getTripJournalGlance(): TripJournalGlance {
  try {
    const trip = _active;
    return {
      state: deriveTripJournalState({
        monoMs: performance.now(),
        active: trip !== null,
        /* Aktif trip varken TRİP'İN kendi damgası (daha kesin — kalitesiz
           fix de sayılır); trip yokken GENEL veri akışı damgası. İkisi de
           yoksa (hiç örnek gelmedi) `null` kalır → dürüstçe UNKNOWN_DEGRADED. */
        lastSampleMonoMs: trip !== null ? trip.lastSamplePerfMs : _lastAnySampleMonoMs,
        stopSinceMonoMs: trip !== null ? trip.metrics.stopSincePerfMs : null,
        endPending: _idleTimer !== null,
        justCompleted: false,
      }),
      tripId: trip !== null ? trip.tripId : null,
      lastCompletedTripId: _lastCompletedTripId,
      lastEndReason: _lastEndReason,
      motionEvidenceReady: hasMotionEvidence(_motion),
      motionSampleCount: _motion.count,
      endPending: _idleTimer !== null,
    };
  } catch {
    return {
      state: 'UNKNOWN_DEGRADED', tripId: null, lastCompletedTripId: null,
      lastEndReason: null, motionEvidenceReady: false, motionSampleCount: 0,
      endPending: false,
    };
  }
}

export function useTripState(): TripState {
  const [s, setS] = useState<TripState>({ ..._state, history: [..._state.history], current: null });
  useEffect(() => onTripState(setS), []);
  return s;
}
