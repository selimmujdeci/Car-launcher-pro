/**
 * tripComputerConsistency.test — SAHA 2026-09-25 yolculuk bilgisayarı ekranı:
 * 6,2 km · 15 dk yolculukta ortalama "42 km/s" ve kovalar 8+2+3 = 13 dk idi.
 * Ekrandaki sayılar birbirini tutmalı.
 */
import { describe, it, expect } from 'vitest';
import { fromActiveTrip, timeComposition, type ActiveTripView } from '../components/cockpit/tripComputerModel';

const field = (over: Partial<ActiveTripView> = {}): ActiveTripView => ({
  startTime: 1, liveDistanceKm: 6.2, liveDurationMin: 15, maxSpeedKmh: 79,
  speedSum: 42 * 50, speedCount: 50,                       // örnek ortalaması 42
  gpsDistanceKm: 6.2, obdDistanceKm: 0,
  metrics: {
    harshBrakeCount: 4, harshAccelCount: 2,
    movingMs: 8 * 60_000, idleMs: 2 * 60_000, unknownMs: 3 * 60_000,
    stopCount: 5, maxRpm: null, maxEngineTempC: null,
    fuelAtStartPct: null, fuelAtEndPct: null, refuelSuspected: false, obdContinuityBroken: false,
  } as unknown as ActiveTripView['metrics'],
  price: { unitPrice: null, currency: null, source: 'DEFAULT_FALLBACK' },
  ...over,
});

describe('yolculuk bilgisayarı tutarlılığı', () => {
  it('🔒 ortalama hız = yol / süre (6,2 km / 15 dk ≈ 25), örnek ortalaması (42) DEĞİL', () => {
    expect(fromActiveTrip(field(), { tankL: null }).metrics.averageSpeedKmh.value).toBe(25);
  });
  it('🔒 süre kovalarının toplamı yolculuk süresine eşit; sınıflanmamış süre "ölçülemeyen"e gider', () => {
    const c = timeComposition(fromActiveTrip(field(), { tankL: null }).metrics);
    expect(c.movingMin + c.idleMin + c.unknownMin).toBe(15);
    expect(c.unknownMin).toBe(5);
    expect(c.totalMin).toBe(15);
  });
  it('kovalar süreyi aşmıyorsa değiştirilmez', () => {
    const c = timeComposition(fromActiveTrip(field({ liveDurationMin: 13 }), { tankL: null }).metrics);
    expect(c.unknownMin).toBe(3);
  });
});
