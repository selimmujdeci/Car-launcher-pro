/**
 * tripSessionNegligibleSegment.test.ts — SEYAHAT OTURUMU "DEĞERSİZ SEGMENT"
 * KİLİDİ.
 *
 * ── ÖLÇÜLEN KUSUR (gerçek cihaz — FIELD-2, 2026-09-12) ──────────────────
 * GPS gürültüsünden (iç mekân sinyal sıçraması) açılıp aniden kapanan bir
 * "trip" (mesafe ≈ 0, hareket < 1 dk) `tripLogService`de `DISCARDED_TOO_SHORT`
 * sayılır ve `TripRecord` ÜRETİLMEZ — ama `tripSessionService` bunu HİÇ
 * ÖĞRENMİYORDU: segment mühürlenip `STOPPED` (mola) durumuna geçiyor ve
 * `SESSION_MAX_BREAK_MS` (45 dk) dolana kadar "Yola çıkıldı" göstermeye
 * DEVAM ediyordu. Gerçek cihazda gözlemlendi: Mavi "6 dakikadır yoldayız"
 * dedi — kullanıcı hiç hareket etmemişken.
 *
 * Kilit: aynı eşik (`TRIP_DISCARD_MIN_DURATION_MIN`/`_DISTANCE_KM`) iki
 * otoritede de (tripLogService'in TripRecord kararı + tripSessionService'in
 * session görünürlüğü) TUTARLI uygulanıyor mu.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../utils/safeStorage', () => ({
  safeGetRaw: vi.fn(() => null),
  safeSetRaw: vi.fn(),
  safeFlushKey: vi.fn(),
}));

vi.mock('../platform/gpsService', () => ({ onGPSLocation: vi.fn(() => () => {}) }));
vi.mock('../platform/obdService', () => ({ onOBDData: vi.fn(() => () => {}) }));

import {
  startTripSession, stopTripSession, getTripSessionSnapshot,
  _resetTripSessionForTest, _feedTripStateForTest,
} from '../platform/trip/tripSessionService';
import type { TripState, TripRecord } from '../platform/tripLogService';

/** `_toSegment` yalnız bu alanları okur; geri kalanı ActiveTrip'in tip
 * uyumluluğu için doldurulur (test dışı hiçbir anlamı yoktur). */
function activeSegment(over: {
  startPerfMs: number; startTime: number;
  distanceKm: number; movingMs: number; stopSincePerfMs: number | null;
}) {
  return {
    startPerfMs: over.startPerfMs,
    startTime: over.startTime,
    distanceKm: over.distanceKm,
    maxSpeedKmh: 8,
    speedSum: 8,
    speedCount: 1,
    fuelAtStart: 50,
    lastPerfMs: over.startPerfMs,
    lastSpeed: 8,
    harshEvents: 0,
    harshBrakeEvents: 0,
    harshAccelEvents: 0,
    lastGPSLat: 36.9,
    lastGPSLng: 34.6,
    lastGPSTs: over.startPerfMs,
    lastSamplePerfMs: over.startPerfMs,
    gpsDistanceKm: over.distanceKm,
    obdDistanceKm: 0,
    metrics: {
      movingMs: over.movingMs, idleMs: 0, unknownMs: 0,
      lastClassPerfMs: over.startPerfMs,
      stopCount: 0, stopSincePerfMs: over.stopSincePerfMs, currentStopCounted: false,
      maxRpm: null, maxEngineTempC: null,
      fuelAtStartPct: null, fuelAtEndPct: null,
      refuelSuspected: false, obdContinuityBroken: false,
      harshBrakeCount: 0, harshAccelCount: 0, lastHarshPerfMs: null,
      speedSampleCount: 1, obdSampleCount: 0, gpsSampleCount: 1,
      dataGapCount: 0, totalGapMs: 0, sourceSwitchCount: 0,
      lastSource: 'GPS' as const, lastSpeedKmh: 8, lastSpeedPerfMs: over.startPerfMs,
    },
    price: { unitPrice: null, currency: null, source: null, capturedAtMs: null },
    cleanClose: false,
    liveDurationMin: 0,
    liveDistanceKm: over.distanceKm,
  };
}

function state(current: ReturnType<typeof activeSegment> | null, history: TripRecord[] = []): TripState {
  return {
    active: current !== null, current, history,
    totalDistanceKm: 0, totalTrips: history.length,
  } as unknown as TripState;
}

beforeEach(() => {
  stopTripSession();
  _resetTripSessionForTest();
});

describe('değersiz tek segment — session görünürlüğü', () => {
  it('GPS gürültüsünden açılıp anında kapanan sahte trip Mavi\'ye "yoldayız" DEDİRTMEZ', () => {
    startTripSession();

    // 1) Segment açılır (GPS gürültüsü — mesafe ≈ 0, hareket süresi çok kısa).
    _feedTripStateForTest(state(activeSegment({
      startPerfMs: 1_000, startTime: 1_700_000_000_000,
      distanceKm: 0.01, movingMs: 2_000, stopSincePerfMs: null,
    })));

    // 2) Trip KAPANDI (tripLogService bunu DISCARDED_TOO_SHORT sayar,
    //    TripRecord üretmez → history DEĞİŞMEZ, `current: null`).
    _feedTripStateForTest(state(null));

    const snap = getTripSessionSnapshot();
    expect(snap.sessionId).toBeNull();
    expect(snap.state).toBe('NOT_STARTED');
  });

  it('YETERLİ mesafe/süre biriken segment session\'ı NORMAL gösterir', () => {
    startTripSession();

    _feedTripStateForTest(state(activeSegment({
      startPerfMs: 1_000, startTime: 1_700_000_000_000,
      distanceKm: 0.5, movingMs: 90_000, stopSincePerfMs: null,
    })));
    _feedTripStateForTest(state(null));

    const snap = getTripSessionSnapshot();
    expect(snap.sessionId).not.toBeNull();
    expect(snap.state).toBe('STOPPED');
  });

  it('AKTİF trip henüz eşiği geçmemiş olsa bile GİZLENMEZ (canlı gösterge bozulmaz)', () => {
    startTripSession();

    // Trip HÂLÂ AÇIK (current !== null) — henüz 100m/1dk geçmemiş olabilir,
    // ama "Daha yeni yola çıktık" göstermek MEŞRUDUR; bu filtre yalnız
    // KAPANMIŞ (STOPPED) oturumlar için geçerlidir.
    _feedTripStateForTest(state(activeSegment({
      startPerfMs: 1_000, startTime: 1_700_000_000_000,
      distanceKm: 0.01, movingMs: 2_000, stopSincePerfMs: null,
    })));

    const snap = getTripSessionSnapshot();
    expect(snap.sessionId).not.toBeNull();
    expect(snap.state).toBe('MOVING');
  });

  it('İKİNCİ (gerçek) segment gelirse oturum tekrar GÖRÜNÜR olur', () => {
    startTripSession();

    // Değersiz ilk segment, kapanır.
    _feedTripStateForTest(state(activeSegment({
      startPerfMs: 1_000, startTime: 1_700_000_000_000,
      distanceKm: 0.01, movingMs: 2_000, stopSincePerfMs: null,
    })));
    _feedTripStateForTest(state(null));
    expect(getTripSessionSnapshot().sessionId).toBeNull();

    // Kısa süre sonra GERÇEK bir hareket başlar (farklı segment key'i).
    _feedTripStateForTest(state(activeSegment({
      startPerfMs: 5_000, startTime: 1_700_000_004_000,
      distanceKm: 1.2, movingMs: 120_000, stopSincePerfMs: null,
    })));

    const snap = getTripSessionSnapshot();
    expect(snap.sessionId).not.toBeNull();
    expect(snap.state).toBe('MOVING');
  });
});
