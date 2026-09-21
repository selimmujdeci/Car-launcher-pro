/**
 * tripSessionService — SEYAHAT OTURUMU runtime katmanı.
 *
 * Saf modeli (`core/tripSessionModel`) mevcut TEK mesafe/süre sahibine bağlar:
 * `tripLogService`. Bu dosya HİÇBİR ŞEY ÖLÇMEZ ve HİÇBİR ŞEY YAZMAZ.
 *
 * ── SAHİPLİK (pazarlıksız) ────────────────────────────────────────────────
 *  · Kat edilen mesafe   → `tripLogService.distanceKm` (GPS haversine + OBD yedeği)
 *  · Hareket/rölanti/bilinmeyen süre → `tripMetricsAccumulator` kovaları
 *  · Anlık duruş         → `tripMetricsAccumulator.stopSincePerfMs`
 * İkinci bir mesafe ya da süre sahibi DOĞMAZ; ölü hesaplama (PR-451a) mesafesi
 * ve odometre bu yola HİÇ girmez (çifte sayım imkânsız).
 *
 * ── ZAMANLAYICI ───────────────────────────────────────────────────────────
 * YENİ TIMER YOK. Örnekler `tripLogService`'in MEVCUT `onTripState` yayınından
 * gelir (aktif yolculukta 5 sn'lik canlı tick, ayrıca her durum değişiminde).
 * Süren mola ve geçen süre OKUMA ANINDA türetilir (`projectTripSession`) —
 * bu yüzden yolculuklar arasında hiçbir şey koşmasa da sayılar doğrudur.
 */

import {
  onTripState, TRIP_DISCARD_MIN_DURATION_MIN, TRIP_DISCARD_MIN_DISTANCE_KM,
  type TripState,
} from '../tripLogService';
/* NAVİGASYON NİYETİ — İNCE KAPI (çalışma zamanı bağımlılığı YOK).
   Bu servis navigasyona hiçbir şey YAZMAZ, abone OLMAZ, oturum AÇMAZ ve
   navigasyonu IMPORT ETMEZ; yalnız "hedef var mı / varış mührü" sorularını
   okuma anında sorar. Niyetin sahibi navigasyon otoritesidir; kapı yalnız
   NİYET taşır — mesafe, ETA, rota ve hedef BURADAN GEÇMEZ. */
import { readNavIntent } from './navIntentPort';
import { _registerTripSessionReader } from './tripSessionAccess';
import {
  emptyTripSession, advanceTripSession, projectTripSession,
  serializeTripSession, deserializeTripSession,
  type TripSession, type TripSessionSegment, type TripSessionProjection,
  type SessionRestoreRejection,
} from './core/tripSessionModel';
/* Yakıt hükmünün KANONİK sahibi — burada yeniden yazılmaz, çağrılır. */
import { evaluateFuelMeasurement } from './tripMetricsAccumulator';
import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../utils/safeStorage';

export type { TripSessionProjection, TripStopPeriod } from './core/tripSessionModel';

/** Monotonik saat — duvar saati yolculuk süresi için OTORİTE DEĞİLDİR. */
function _mono(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

let _session: TripSession = emptyTripSession();
let _unsub: (() => void) | null = null;
let _started = false;

/* ══════════════════════════════════════════════════════════════════════════
 * KALICILIK — süreç ölümünden sonra AYNI oturumu sürdürmek
 * ════════════════════════════════════════════════════════════════════════
 *
 * Yeni bir depolama sistemi KURULMAZ: `nav_crash_state`in kullandığı
 * `safeStorage` ham anahtar yolu ve 4 saatlik tazelik penceresi birebir
 * tekrarlanır. Karar mantığının tamamı saf modeldedir; burada yalnız I/O,
 * araç kimliği ve tek seferlik geri yükleme vardır.
 */

const SESSION_PERSIST_KEY = 'trip_session_state';

/** Aktif araç kimliği — sahibi ayar deposudur, burada KOPYASI TUTULMAZ. */
let _vehicleId: string | null = null;
/** Son geri yükleme hükmü (gözlem/teşhis; LAB okur). */
let _lastRestore: SessionRestoreRejection | 'RESTORED' | 'NOT_ATTEMPTED' = 'NOT_ATTEMPTED';
let _restoreAttempted = false;

/**
 * Aktif aracı bildir — kompozisyon kökü çağırır (ikinci araç otoritesi YOK).
 *
 * ARAÇ DEĞİŞİMİ oturumu TAŞIMAZ: A aracının açık yolculuğu B'ye devredilemez,
 * bu yüzden değişimde bellekteki oturum bırakılır ve diskteki kayıt SİLİNMEZ
 * (A'ya geri dönülürse kendi yolculuğunu bulur).
 */
export function setTripSessionVehicle(vehicleId: string | null): void {
  const next = typeof vehicleId === 'string' && vehicleId.length > 0 ? vehicleId : null;
  if (next === _vehicleId) return;
  _vehicleId = next;
  /* Araç değişti: bellekteki oturum (varsa) başka bir araca/bilinmeyen araca
     aitti — ekranda/bağlamda GÖRÜNMEZ. Yeni aracın kendi kaydı HEMEN denenir
     (servis ayaktaysa); ilk örneğe bırakmak o örneğin yeni oturum açması
     demekti. Araç kimliği profil deposundan servisten SONRA gelirse de
     (hydration sırası) bu yol devralmayı kurtarır. */
  _session = emptyTripSession();
  _restoreAttempted = false;
  _lastRestore = 'NOT_ATTEMPTED';
  if (_started) _restoreOnce();
}

/** Oturumu diske yaz — FAIL-SOFT, ASLA throw etmez. */
function _persist(): void {
  try {
    const payload = serializeTripSession(_session, _mono(), Date.now(), _vehicleId);
    if (payload === null) {
      /* Hedefe VARILDI: kalıcı kayıt kalmamalı, yoksa biten yolculuk
         yeniden dirilir. Oturum HİÇ AÇILMADIYSA kayda DOKUNULMAZ — diskte
         duran kayıt başka aracın meşru yolculuğu olabilir (VEHICLE_MISMATCH
         ile reddedilip yerinde bırakılmıştır). */
      if (_session.completion === 'DESTINATION_REACHED') safeRemoveRaw(SESSION_PERSIST_KEY);
      return;
    }
    safeSetRaw(SESSION_PERSIST_KEY, JSON.stringify(payload));
  } catch { /* kalıcılık yolculuk akışını ASLA bozmaz */ }
}

/**
 * Diskteki oturumu bir kez geri yükle — FAIL-CLOSED.
 *
 * Reddedilen kayıt SİLİNİR ve temiz kayıt durumuna geçilir. Reddetmek
 * "yolculuk tamamlandı" DEMEK DEĞİLDİR: tamamlanma yalnız mühürlenmiş
 * varıştan gelir ve tamamlanmış oturum zaten diske yazılmaz.
 */
function _restoreOnce(): void {
  if (_restoreAttempted) return;
  _restoreAttempted = true;
  try {
    const raw = safeGetRaw(SESSION_PERSIST_KEY);
    if (raw === null) { _lastRestore = 'NO_RECORD'; return; }
    let parsed: unknown = null;
    try { parsed = JSON.parse(raw); } catch {
      /* Ayrıştırılamayan kayıt BOZUKTUR — "kayıt yok" değil. Silinir. */
      _lastRestore = 'BAD_SHAPE';
      safeRemoveRaw(SESSION_PERSIST_KEY);
      return;
    }
    const result = deserializeTripSession(parsed, _mono(), Date.now(), _vehicleId);
    if (result.restored) {
      _session = result.session;
      _lastRestore = 'RESTORED';
      return;
    }
    _lastRestore = result.reason;
    /* Araç uyuşmazlığı BOZUKLUK DEĞİLDİR: kayıt öteki aracın meşru
       yolculuğudur, silinmez. Diğer gerekçeler kullanılamaz kayıttır. */
    if (result.reason !== 'VEHICLE_MISMATCH') safeRemoveRaw(SESSION_PERSIST_KEY);
  } catch {
    _lastRestore = 'BAD_SHAPE';
  }
}

/** Son geri yükleme hükmü — gözlem yüzeyi (LAB/teşhis). */
export function getTripSessionRestoreVerdict(): string {
  return _lastRestore;
}

/**
 * `TripState.current` → model segmenti.
 *
 * `current` `ActiveTrip`i olduğu gibi yayar; bu yüzden hiçbir yeni alan
 * eklemeye gerek YOKTUR — kümülatif değerler doğrudan sahibinden okunur.
 *
 * ── YAKIT HÜKMÜ BURADA VERİLMEZ ──────────────────────────────────────────
 * `evaluateFuelMeasurement` kanonik sahibidir ve yalnız ÇAĞRILIR: kapılar
 * (başlangıç/bitiş okuması · yakıt alma şüphesi · OBD sürekliliği · makullük)
 * burada tekrarlanmaz. Yüzde taşınır, LİTRE taşınmaz — litreye çevirmek depo
 * hacmini bilen sunum katmanının işidir (`fuelPercentToLitres`).
 */
function _toSegment(s: TripState): TripSessionSegment | null {
  const c = s.current;
  if (!c) return null;
  const m = c.metrics;
  /* FAIL-SOFT: hüküm düşerse yakıt BİLİNMİYOR kalır (uydurma sayı yok). */
  let fuelUsedPct: number | null = null;
  try {
    if (m) {
      const verdict = evaluateFuelMeasurement(m, c.distanceKm);
      if (verdict.measured) fuelUsedPct = verdict.usedPercent;
    }
  } catch { /* ölçüm yoksa null kalır */ }

  return {
    key:           c.startPerfMs,
    startedMonoMs: c.startPerfMs,
    startedWallMs: c.startTime,
    movingMs:      m ? m.movingMs  : 0,
    idleMs:        m ? m.idleMs    : 0,
    unknownMs:     m ? m.unknownMs : 0,
    /* km → m. Mesafe KAT EDİLENDİR; kalan rota mesafesiyle ilgisi yoktur. */
    distanceM:     c.distanceKm * 1000,
    stoppedSinceMonoMs: m ? m.stopSincePerfMs : null,

    /* ── Segmentin KANONİK ölçümleri — hepsi sahibinden, hiçbiri yeniden
       hesaplanmadan. Sert manevra sayaçları 9d78b68e ile tek otorite olan
       akümülatörden gelir; ikinci bir dedektör YOKTUR. */
    gpsDistanceM:    c.gpsDistanceKm * 1000,
    obdDistanceM:    c.obdDistanceKm * 1000,
    maxSpeedKmh:     c.maxSpeedKmh,
    speedSum:        c.speedSum,
    speedCount:      c.speedCount,
    stopCount:       m ? m.stopCount : 0,
    harshBrakeCount: m ? m.harshBrakeCount : 0,
    harshAccelCount: m ? m.harshAccelCount : 0,
    maxRpm:          m ? m.maxRpm : null,
    maxEngineTempC:  m ? m.maxEngineTempC : null,
    fuelUsedPct,
    /* Fiyat ölçüm değil BAĞLAMDIR — olduğu gibi taşınır, türetilmez. */
    priceUnit:     c.price ? c.price.unitPrice : null,
    priceCurrency: c.price ? c.price.currency : null,
    priceSource:   c.price && c.price.source !== 'UNAVAILABLE' ? c.price.source : null,
  };
}

function _onState(s: TripState): void {
  try {
    const intent = readNavIntent();
    _session = advanceTripSession(_session, {
      monoMs:  _mono(),
      wallMs:  Date.now(),
      segment: _toSegment(s),
      lat:     s.current ? s.current.lastGPSLat : null,
      lon:     s.current ? s.current.lastGPSLng : null,
      routeActive: intent.routeActive,
      arrivalSeq:  intent.arrivalSeq,
    });
    /* Her örnekte yaz: yazma `safeStorage` tarafından debounce edilir, yeni
       zamanlayıcı KURULMAZ. Süreç beklenmedik biçimde ölse bile son
       mühürlenmiş gerçek diskte durur. */
    _persist();
  } catch { /* oturum katmanı yolculuk akışını ASLA bozmaz */ }
}

/* ── Yaşam döngüsü ────────────────────────────────────────── */

/** İdempotent. `tripLogService`'e TEK abonelik kurar (yeni timer YOK). */
export function startTripSession(): void {
  if (_started) return;
  _started = true;
  /* ÖNCE geri yükle, SONRA abone ol: ilk örnek geldiğinde devralınan oturum
     yerinde olsun — aksi halde o örnek YENİ bir oturum açardı. */
  _restoreOnce();
  try {
    _unsub = onTripState(_onState);
  } catch { /* fail-soft — abonelik kurulamazsa oturum boş kalır */ }
  /* Tüketiciler (Mavi bağlamı) oturumu İNCE kapıdan okur — böylece bu servis
     onların statik modül grafiğine GİRMEZ (bkz. tripSessionAccess). */
  try { _registerTripSessionReader(getTripSessionSnapshot); } catch { /* fail-soft */ }
}

/** Aboneliği söker. Zero-leak. */
export function stopTripSession(): void {
  if (!_started) return;
  _started = false;
  /* Kapanışta son hâli mühürle: uygulama kapanması TAMAMLANMA DEĞİLDİR,
     bir sonraki açılış aynı yolculuğu devralmalıdır. */
  _persist();
  if (_unsub) { try { _unsub(); } catch { /* ignore */ } _unsub = null; }
  /* Kaydı da geri al: sökülmüş servis bayat okuma sunmasın. */
  try { _registerTripSessionReader(null); } catch { /* ignore */ }
}

/* ── Okuma ────────────────────────────────────────────────── */

/**
 * Bu tek segment "yolculuk sayılır mı" — `tripLogService`nin TripRecord
 * üretme eşiğiyle AYNI (§ tanım). Farklı bir eşik kullanılırsa iki otorite
 * ayrışır: biri "geçersiz" derken öteki "yoldayız" der.
 */
function _isNegligibleSingleSegment(p: TripSessionProjection): boolean {
  return p.segmentCount === 1
    && p.distanceMeters / 1000 < TRIP_DISCARD_MIN_DISTANCE_KM
    && p.movingMs < TRIP_DISCARD_MIN_DURATION_MIN * 60_000;
}

/**
 * Senkron anlık görüntü — ASLA throw etmez.
 * Süren mola ve geçen süre bu çağrının ANINA göre türetilir.
 *
 * ── ÖLÇÜLEN KUSUR (gerçek cihaz — FIELD-2, 2026-09-12) ──────────────────
 * GPS gürültüsünden açılıp aniden kapanan bir "trip" (mesafe ≈ 0, hareket
 * < 1 dk) `tripLogService`de `DISCARDED_TOO_SHORT` sayılır — ama session
 * bunu HİÇ ÖĞRENMEZ: segment mühürlenip `STOPPED` (mola) durumuna geçer ve
 * `SESSION_MAX_BREAK_MS` (45 dk) dolana kadar "Yola çıkıldı" göstermeye
 * DEVAM eder. Sonuç: Mavi "6 dakikadır yoldayız" diyordu — kullanıcı hiç
 * hareket etmemişken.
 *
 * Yalnız `STOPPED` + TEK segment + değersiz (yukarıdaki eşik) durumunda
 * projeksiyon BOŞA döner. Bu, iç durumu (`_session`) DEĞİŞTİRMEZ — salt
 * OKUMA anında bir filtredir: gerçek bir ikinci hareket gelirse
 * (`segmentCount` artarsa) session normal şekilde görünür kalır.
 */
export function getTripSessionSnapshot(): TripSessionProjection {
  try {
    const p = projectTripSession(_session, _mono());
    if (p.state === 'STOPPED' && _isNegligibleSingleSegment(p)) {
      return projectTripSession(emptyTripSession(), 0);
    }
    return p;
  } catch {
    return projectTripSession(emptyTripSession(), 0);
  }
}

/** Abonelik ayakta mı — gözlem yüzeyi için (LAB). */
export function isTripSessionRunning(): boolean {
  return _started;
}

/** @internal testler için — modül durumunu sıfırlar. */
export function _resetTripSessionForTest(): void {
  _session = emptyTripSession();
  _vehicleId = null;
  _restoreAttempted = false;
  _lastRestore = 'NOT_ATTEMPTED';
  try { safeRemoveRaw(SESSION_PERSIST_KEY); } catch { /* ignore */ }
}

/** @internal testler için — gerçek aboneliğe girmeden geri yüklemeyi dener. */
export function _restoreTripSessionForTest(): void {
  _restoreOnce();
}

/**
 * @internal testler için — SÜREÇ ÖLÜMÜNÜ taklit eder: bellek durumu sıfırlanır,
 * DİSK (safeStorage) DOKUNULMAZ. `_resetTripSessionForTest` kaydı da siler;
 * yeniden başlatma sürekliliği tam olarak kaydın KALMASINI sınar.
 */
export function _simulateProcessRestartForTest(): void {
  _session = emptyTripSession();
  _vehicleId = null;
  _restoreAttempted = false;
  _lastRestore = 'NOT_ATTEMPTED';
}

/** @internal testler için — gerçek aboneliğe girmeden örnek besler. */
export function _feedTripStateForTest(s: TripState): void {
  _onState(s);
}
