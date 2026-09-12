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
import { _registerTripSessionReader } from './tripSessionAccess';
import {
  emptyTripSession, advanceTripSession, projectTripSession,
  type TripSession, type TripSessionSegment, type TripSessionProjection,
} from './core/tripSessionModel';

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

/**
 * `TripState.current` → model segmenti.
 *
 * `current` `ActiveTrip`i olduğu gibi yayar; bu yüzden hiçbir yeni alan
 * eklemeye gerek YOKTUR — kümülatif değerler doğrudan sahibinden okunur.
 */
function _toSegment(s: TripState): TripSessionSegment | null {
  const c = s.current;
  if (!c) return null;
  const m = c.metrics;
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
  };
}

function _onState(s: TripState): void {
  try {
    _session = advanceTripSession(_session, {
      monoMs:  _mono(),
      wallMs:  Date.now(),
      segment: _toSegment(s),
      lat:     s.current ? s.current.lastGPSLat : null,
      lon:     s.current ? s.current.lastGPSLng : null,
    });
  } catch { /* oturum katmanı yolculuk akışını ASLA bozmaz */ }
}

/* ── Yaşam döngüsü ────────────────────────────────────────── */

/** İdempotent. `tripLogService`'e TEK abonelik kurar (yeni timer YOK). */
export function startTripSession(): void {
  if (_started) return;
  _started = true;
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
}

/** @internal testler için — gerçek aboneliğe girmeden örnek besler. */
export function _feedTripStateForTest(s: TripState): void {
  _onState(s);
}
