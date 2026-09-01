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
      _endTrip();
      return;   // _endTrip zaten durum yayınlar
    }
  }
  _notify();
}

function _startTrip(speedKmh: number, fuelLevel: number): void {
  if (_active) return;
  const perfNow = performance.now();
  _active = {
    startTime:   Date.now(),
    startPerfMs: perfNow,
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

  _setState({ active: true });
}

function _endTrip(): void {
  if (!_active) return;

  const durationMs  = performance.now() - _active.startPerfMs;
  const durationMin = Math.round(durationMs / 60_000);

  // 1 dakika veya 100m altındaki yolculukları kaydetme
  if (durationMin < 1 || _active.distanceKm < 0.1) {
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

  const record: TripRecord = {
    id:               generateTripId(),
    startTime:        _active.startTime,
    endTime:          Date.now(),
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

  const speedKmh = loc.speed != null ? loc.speed * 3.6 : 0;

  // Trip başlat (GPS hızıyla)
  if (speedKmh > TRIP_START_SPEED_KMH) {
    if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }

    if (!_active) {
      _startTrip(speedKmh, _lastObdFuel);
    }
  } else if (_active && speedKmh < 1) {
    // Durdu — idle timer
    if (!_idleTimer) {
      _idleTimer = setTimeout(() => {
        _idleTimer = null;
        /* P2: duruş penceresi DOLDU → düzgün kapanış (confidence kanıtı). */
        if (_active) _active.cleanClose = true;
        _endTrip();
      }, TRIP_END_IDLE_MS);
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
  try {
    _active.metrics = applySample(_active.metrics, {
      perfNowMs: performance.now(),
      source: 'GPS',
      speedKmh: speedKmh > 0 ? speedKmh : (loc.speed != null ? 0 : null),
      fresh: true,   // GPS fix'i buraya geldiyse gpsService kapılarını geçmiştir
    });
  } catch { /* metrik birikimi trip akışını ASLA bozmaz */ }

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

  if (fuelLevel >= 0) _lastObdFuel = fuelLevel;

  // GPS yoksa OBD hızını trip tespiti için kullan
  const activeSnap = _active;
  const gpsRecent = activeSnap !== null &&
    activeSnap.lastGPSTs !== null &&
    (performance.now() - activeSnap.lastGPSTs) < 5_000;

  if (speedKmh > TRIP_START_SPEED_KMH) {
    if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
    if (!_active) _startTrip(speedKmh, fuelLevel);
  } else if (_active && speedKmh === 0) {
    if (!_idleTimer) {
      _idleTimer = setTimeout(() => {
        _idleTimer = null;
        /* P2: duruş penceresi DOLDU → düzgün kapanış (confidence kanıtı). */
        if (_active) _active.cleanClose = true;
        _endTrip();
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
  try {
    trip.metrics = applySample(trip.metrics, {
      perfNowMs: performance.now(),
      source: 'OBD',
      speedKmh: data.speed,
      fresh: data.dataFresh !== false,
      rpm: data.rpm,
      engineTempC: data.engineTemp,
      fuelPercent: data.fuelLevel,
      transportConnected: data.transportConnected,
    });
  } catch { /* metrik birikimi trip akışını ASLA bozmaz */ }
}

/* ── Public API ──────────────────────────────────────────── */

let _gpsUnsub: (() => void) | null = null;
let _obdUnsub: (() => void) | null = null;

export function startTripLog(): void {
  if (_started) return;
  _started = true;

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
  _endTrip();
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

export function useTripState(): TripState {
  const [s, setS] = useState<TripState>({ ..._state, history: [..._state.history], current: null });
  useEffect(() => onTripState(setS), []);
  return s;
}
