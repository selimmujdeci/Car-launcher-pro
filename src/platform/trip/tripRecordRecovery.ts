/**
 * tripRecordRecovery — silinmiş seyir defteri özetini ham yolculuk günlüğünden
 * yeniden kurar (SAF: IO yok).
 *
 * SAHA 2026-09-25: seyir defteri (TripRecord listesi) açılış sırası kusuru ve
 * LRU temizliği yüzünden siliniyordu; aynı `tripId` ile tutulan ham günlük
 * (`tripJournalStore`) ise duruyordu. Özetin tek sahibi yine `TripRecord`'dur;
 * burası YALNIZ özeti eksik olan yolculuk için kanıttan türetir.
 *
 * Dürüstlük:
 *  · Yakıt/maliyet ölçülmedi → `null` + `UNAVAILABLE` (uydurma litre yok).
 *  · Mesafe örneklenmiş GPS izinden → `DERIVED`, güven `LOW`.
 *  · İzi olmayan ya da kapanmamış yolculuk KURULMAZ (mesafe bilinmiyor).
 *  · Puan, canlı yolculukla AYNI fonksiyondan gelir (çağıran verir).
 */
import type { TripRecord } from '../tripLogService';
import { decodeRouteTrace, haversineMeters, type TripJournalRecord } from './tripJournalModel';
import { averageSpeedKmh } from './core/averageSpeed';

export type ScoreFn = (maxSpeedKmh: number, harshEvents: number, avgSpeedKmh: number) => number;

export const RECOVERED_FROM_JOURNAL = 'RECOVERED_FROM_JOURNAL';

export function rebuildTripSummary(j: TripJournalRecord, score: ScoreFn): TripRecord | null {
  if (j.endedAtMs === null || j.endedAtMs <= j.startedAtMs) return null;
  const pts = decodeRouteTrace(j.route);
  if (pts.length < 2) return null;

  let meters = 0;
  for (let i = 1; i < pts.length; i++) {
    meters += haversineMeters(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
  }
  const speeds = pts.map((p) => p.speedKmh).filter((v): v is number => typeof v === 'number' && v >= 0);
  const avgSpeedKmh = speeds.length > 0 ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length) : 0;
  const maxSpeedKmh = speeds.length > 0 ? Math.round(Math.max(...speeds)) : 0;
  const harshBrakeCount = j.events.filter((e) => e.kind === 'HARSH_BRAKE').length;
  const harshAccelCount = j.events.filter((e) => e.kind === 'HARSH_ACCEL').length;
  const harshEvents = harshBrakeCount + harshAccelCount;
  const idleMs = j.stops.reduce((s, x) => s + (Number.isFinite(x.durationMs) ? x.durationMs : 0), 0);
  const durationMs = j.endedAtMs - j.startedAtMs;

  return {
    id: j.tripId,
    startTime: j.startedAtMs,
    endTime: j.endedAtMs,
    distanceKm: Math.round((meters / 1000) * 10) / 10,
    durationMin: Math.max(1, Math.round(durationMs / 60_000)),
    avgSpeedKmh: averageSpeedKmh(meters, durationMs, speeds.length > 0) ?? avgSpeedKmh,
    maxSpeedKmh,
    fuelConsumptionL: null,
    fuelCostTL: null,
    drivingScore: score(maxSpeedKmh, harshEvents, avgSpeedKmh),
    harshEvents,
    harshBrakeCount,
    harshAccelCount,
    idleMin: Math.round((idleMs / 60_000) * 10) / 10,
    stopCount: j.stops.length,
    fuelSource: 'UNAVAILABLE',
    costSource: 'UNAVAILABLE',
    distanceSource: 'DERIVED',
    confidence: 'LOW',
    confidenceLimitedBy: RECOVERED_FROM_JOURNAL,
    speedSampleCount: speeds.length,
  };
}
