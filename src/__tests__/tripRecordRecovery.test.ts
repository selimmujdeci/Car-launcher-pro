/**
 * tripRecordRecovery.test — silinmiş seyir defteri ham günlükten dürüstçe kurulur.
 */
import { describe, it, expect } from 'vitest';
import { rebuildTripSummary, RECOVERED_FROM_JOURNAL } from '../platform/trip/tripRecordRecovery';
import { encodeRouteTrace, readTripJournalRecord } from '../platform/trip/tripJournalModel';

const score = (max: number, harsh: number) => 100 - harsh * 8 - (max > 120 ? 4 : 0);
// ~0,009° enlem ≈ 1 km kuzeye, 60 sn'de, 3 örnek
const route = encodeRouteTrace([
  { lat: 36.900, lon: 34.870, tOffsetMs: 0, speedKmh: 30 },
  { lat: 36.9045, lon: 34.870, tOffsetMs: 30_000, speedKmh: 60 },
  { lat: 36.909, lon: 34.870, tOffsetMs: 60_000, speedKmh: null },
]);
const journal = (over: Record<string, unknown> = {}) => readTripJournalRecord({
  schemaVersion: 1, tripId: 'trip-a', startedAtMs: 1_000_000, endedAtMs: 1_000_000 + 10 * 60_000,
  endReason: 'IDLE_WINDOW', startLocation: null, endLocation: null, startArea: null, endArea: null,
  route, stops: [{ startOffsetMs: 0, endOffsetMs: 90_000, durationMs: 90_000 }],
  motionEvidence: { sampleCount: 3, spanMs: 60_000, sourceCount: 1 },
  events: [{ kind: 'HARSH_BRAKE', atOffsetMs: 10, magnitude: 15 }, { kind: 'STOP', atOffsetMs: 0, magnitude: null }],
  ...over,
})!;

describe('rebuildTripSummary', () => {
  it('izden mesafe/süre/hız/olay; aynı kimlik', () => {
    const r = rebuildTripSummary(journal(), score)!;
    expect(r.id).toBe('trip-a');
    expect(r.distanceKm).toBe(1);
    expect(r.durationMin).toBe(10);
    expect(r.maxSpeedKmh).toBe(60);
    expect(r.avgSpeedKmh).toBe(45);          // bilinmeyen hız ortalamaya girmez
    expect(r.harshBrakeCount).toBe(1);
    expect(r.idleMin).toBe(1.5);
    expect(r.drivingScore).toBe(92);         // canlı yolculukla aynı fonksiyon
  });
  it('🔒 yakıt/maliyet uydurulmaz; kaynak dürüstçe işaretli', () => {
    const r = rebuildTripSummary(journal(), score)!;
    expect(r.fuelConsumptionL).toBeNull();
    expect(r.fuelCostTL).toBeNull();
    expect(r.fuelSource).toBe('UNAVAILABLE');
    expect(r.distanceSource).toBe('DERIVED');
    expect(r.confidenceLimitedBy).toBe(RECOVERED_FROM_JOURNAL);
  });
  it('🔒 izi olmayan ya da kapanmamış yolculuk kurulmaz', () => {
    expect(rebuildTripSummary(journal({ route: null }), score)).toBeNull();
    expect(rebuildTripSummary(journal({ endedAtMs: null }), score)).toBeNull();
  });
});
