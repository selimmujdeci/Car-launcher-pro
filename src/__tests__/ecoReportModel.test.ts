/**
 * ecoReportModel.test — Yakıt & CO₂ karnesi: ölçülmeyen yazılmaz, kıyas adildir.
 */
import { describe, it, expect } from 'vitest';
import type { TripRecord } from '../platform/tripLogService';
import {
  tripEco, buildEcoReport, fuelTypeFromVehicle, CO2_KG_PER_L,
} from '../platform/trip/ecoReportModel';

const DAY = 24 * 3600_000;
const NOW = Date.parse('2026-09-25T12:00:00Z');
let seq = 0;
function trip(over: Partial<TripRecord> = {}): TripRecord {
  seq++;
  return {
    id: `t${seq}`, startTime: NOW - DAY, endTime: NOW - DAY + 1800_000,
    distanceKm: 20, durationMin: 30, avgSpeedKmh: 40, maxSpeedKmh: 80,
    fuelConsumptionL: 1.4, fuelCostTL: null, drivingScore: 90, harshEvents: 0,
    harshAccelCount: 0, harshBrakeCount: 0, idleMin: 2, fuelSource: 'MEASURED',
    ...over,
  } as TripRecord;
}

describe('yakıt tipi', () => {
  it('araç tipinden eşlenir; bilinmeyen "unknown"', () => {
    expect(fuelTypeFromVehicle('ice')).toBe('petrol');
    expect(fuelTypeFromVehicle('diesel')).toBe('diesel');
    expect(fuelTypeFromVehicle('ev')).toBe('ev');
    expect(fuelTypeFromVehicle(undefined)).toBe('unknown');
  });
});

describe('yolculuk karnesi — dürüstlük', () => {
  it('ölçülmüş yakıttan L/100 ve CO₂', () => {
    const e = tripEco(trip({ fuelConsumptionL: 1.4, distanceKm: 20 }), [], 'petrol');
    expect(e.l100).toBe(7);
    expect(e.co2Kg).toBeCloseTo(1.4 * CO2_KG_PER_L.petrol, 2);
    expect(e.co2Status).toBe('OK');
  });
  it('🔒 TAHMİNİ yakıt → CO₂ ve L/100 YOK', () => {
    const e = tripEco(trip({ fuelSource: 'ESTIMATED' }), [], 'petrol');
    expect(e.co2Kg).toBeNull();
    expect(e.l100).toBeNull();
    expect(e.co2Status).toBe('FUEL_NOT_MEASURED');
  });
  it('🔒 yakıt tipi bilinmiyorsa CO₂ uydurulmaz', () => {
    expect(tripEco(trip(), [], 'unknown').co2Status).toBe('FUEL_TYPE_UNKNOWN');
    expect(tripEco(trip(), [], 'unknown').co2Kg).toBeNull();
  });
  it('🔒 elektrikli araçta CO₂ yok (şebeke bilinmiyor)', () => {
    expect(tripEco(trip(), [], 'ev').co2Status).toBe('EV_GRID_UNKNOWN');
  });
  it('rölanti bedeli TAHMİN aralığıdır; rölanti bilinmiyorsa yok', () => {
    expect(tripEco(trip({ idleMin: 30 }), [], 'petrol').idleFuelL).toEqual({ min: 0.3, max: 0.5 });
    expect(tripEco(trip({ idleMin: undefined }), [], 'petrol').idleFuelL).toBeNull();
  });
});

describe('sürüş tarzı kıyası — adil', () => {
  const calmCity = [0, 1, 2].map(() => trip({ avgSpeedKmh: 35, fuelConsumptionL: 1.4 }));   // 7.0 L/100
  const calmHighway = [0, 1, 2].map(() => trip({ avgSpeedKmh: 100, distanceKm: 100, fuelConsumptionL: 5.5 }));

  it('🔒 benzer hızdaki sakin yolculuklarla kıyaslar', () => {
    const t = trip({ avgSpeedKmh: 40, fuelConsumptionL: 1.68, harshAccelCount: 6 });   // 8.4 L/100
    const e = tripEco(t, [...calmCity, ...calmHighway, t], 'petrol');
    expect(e.baseline).toEqual({ l100: 7, trips: 3 });
    expect(e.styleDeltaPct).toBe(20);
  });
  it('🔒 şehir içi yolculuk otoyolla KIYASLANMAZ → yeterli geçmiş yok', () => {
    const t = trip({ avgSpeedKmh: 40 });
    const e = tripEco(t, calmHighway, 'petrol');
    expect(e.styleStatus).toBe('NOT_ENOUGH_HISTORY');
    expect(e.styleDeltaPct).toBeNull();
  });
  it('kısa yolculuk kıyaslanmaz (soğuk motor)', () => {
    expect(tripEco(trip({ distanceKm: 3, fuelConsumptionL: 0.3 }), calmCity, 'petrol').styleStatus).toBe('TOO_SHORT');
  });
});

describe('haftalık karne', () => {
  it('bu hafta / geçen hafta ve ölçülmüş tüketim değişimi', () => {
    const history = [
      trip({ endTime: NOW - 1 * DAY, fuelConsumptionL: 1.2 }),              // 6.0
      trip({ endTime: NOW - 9 * DAY, fuelConsumptionL: 1.6 }),              // 8.0
    ];
    const r = buildEcoReport(history, 'petrol', NOW);
    expect(r.thisWeek.trips).toBe(1);
    expect(r.lastWeek.trips).toBe(1);
    expect(r.l100ChangePct).toBe(-25);
    expect(r.insights.some((i) => i.kind === 'trend' && i.text.includes('%25 düştü'))).toBe(true);
  });
  it('🔒 ölçülemeyen yolculuk oranı gizlenmez', () => {
    const history = [
      trip({ fuelSource: 'UNAVAILABLE', fuelConsumptionL: null }),
      trip({ fuelSource: 'UNAVAILABLE', fuelConsumptionL: null }),
      trip(),
    ];
    const r = buildEcoReport(history, 'petrol', NOW);
    expect(r.thisWeek.measuredTrips).toBe(1);
    expect(r.insights.find((i) => i.kind === 'coverage')?.text).toContain('%67');
  });
  it('🔒 veri yokken sahte 0 CO₂ yok', () => {
    const r = buildEcoReport([trip({ fuelSource: 'UNAVAILABLE', fuelConsumptionL: null })], 'petrol', NOW);
    expect(r.thisWeek.co2Kg).toBeNull();
  });
  it('rölanti önerisi tahmin olarak söylenir', () => {
    const r = buildEcoReport([trip({ idleMin: 12 })], 'diesel', NOW);
    expect(r.insights.find((i) => i.kind === 'idle')?.text).toMatch(/tahminen .* L/);
  });
});
