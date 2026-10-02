/**
 * ecoScore.test.ts — EKO SÜRÜŞ PUANI KİLİTLERİ.
 *
 *   A · pencere ivmesi (akümülatör) — örnekleme hızından bağımsız fizik
 *   B · puan modeli — dürüstlük, oranlama, eğri çapaları
 *   C · haftalık özet — km ağırlığı, fark, engel nedeni
 *   D · gerçek servis yolu — kayıt `ecoDynamics` + metricsVersion 2 taşır
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Mock'lar (import'lardan ÖNCE) — D ailesi için ─────────────────────── */

vi.mock('../utils/safeStorage', () => ({
  isSafeStorageHydrated: () => true,
  safeGetRaw:   vi.fn(() => null),
  safeSetRaw:   vi.fn(),
  safeFlushKey: vi.fn(),
}));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

type LocationCb = (loc: import('../platform/gpsService').GPSLocation | null) => void;
let _gpsCb: LocationCb | null = null;

vi.mock('../platform/gpsService', () => ({
  onGPSLocation: vi.fn((cb: LocationCb) => {
    _gpsCb = cb;
    cb(null);
    return () => { _gpsCb = null; };
  }),
}));
vi.mock('../platform/obdService', () => ({
  onOBDData: vi.fn(() => () => {}),
}));

import {
  applySample, createAccumulator, rdeVaPosLimit,
  DYN_MIN_WINDOW_MS, SAMPLE_STALE_MS,
  type MetricSample, type TripMetricsAccumulator,
} from '../platform/trip/tripMetricsAccumulator';
import {
  tripEcoScore, buildEcoWeek, ecoBand, DYNAMIC_CURVE, ECO_WEIGHTS,
  MIN_PHASE_SEC,
} from '../platform/trip/ecoScoreModel';
import {
  startTripLog, stopTripLog, clearAllTrips, getTripSnapshot,
  TRIP_METRICS_VERSION, type TripRecord,
} from '../platform/tripLogService';

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

const T0 = 10_000;

function sample(at: number, speedKmh: number, source: 'GPS' | 'OBD' = 'GPS', fresh = true): MetricSample {
  return { perfNowMs: at, source, speedKmh, fresh };
}

/** Hız profilini verilen örnek aralığıyla (ms) sürer. `profile(tSec)` km/h döner. */
function drive(profile: (tSec: number) => number, durationMs: number, stepMs: number): TripMetricsAccumulator {
  let acc = createAccumulator();
  for (let t = 0; t <= durationMs; t += stepMs) acc = applySample(acc, sample(T0 + t, profile(t / 1000)));
  return acc;
}

type Dyn = NonNullable<TripRecord['ecoDynamics']>;

function trip(over: Partial<TripRecord> = {}, dyn: Partial<Dyn> | null = {}): TripRecord {
  return {
    id: over.id ?? 't1', startTime: 0, endTime: over.endTime ?? 1_000,
    distanceKm: 20, durationMin: 20, avgSpeedKmh: 60, maxSpeedKmh: 90,
    fuelConsumptionL: null, fuelCostTL: null, drivingScore: 100, harshEvents: 0,
    timeCoverage: 0.95, metricsVersion: 2,
    ...(dyn === null ? {} : {
      ecoDynamics: {
        accelSec: 200, accelOverSec: 0, decelSec: 200, decelHardSec: 0,
        movingSec: 1_200, over110Sec: 0, over130Sec: 0, ...dyn,
      },
    }),
    ...over,
  };
}

/* ══════════════════ A · PENCERE İVMESİ ══════════════════ */

describe('A · pencere ivmesi (akümülatör)', () => {
  it('A1. sabit hız ne hızlanma ne yavaşlama üretir', () => {
    const acc = drive(() => 60, 30_000, 1_000);
    expect(acc.accelMs).toBe(0);
    expect(acc.decelMs).toBe(0);
    expect(acc.movingMs).toBe(30_000);
  });

  it('A2. yüksek güçlü hızlanma (2,8 m/s² @ ~50 km/h) RDE sınırını aşar', () => {
    const acc = drive((t) => Math.min(80, 30 + 10 * t), 5_000, 1_000);
    expect(acc.accelMs).toBe(5_000);
    expect(acc.accelOverMs).toBe(5_000);
  });

  it('A3. kademeli hızlanma (0,28 m/s²) fazı sayılır ama sınırı AŞMAZ', () => {
    const acc = drive((t) => 50 + t, 20_000, 1_000);
    expect(acc.accelMs).toBe(20_000);
    expect(acc.accelOverMs).toBe(0);
  });

  it('A4. 🔒 örnekleme hızından BAĞIMSIZ: 5 Hz ile 1 Hz aynı oranı verir', () => {
    /* 10 sn kademeli (0,28 m/s²) + 5 sn güçlü (2,2 m/s²) → ~1/3 sınır üstü. */
    const profile = (t: number) => (t < 10 ? 40 + t : t < 15 ? 50 + 8 * (t - 10) : 90);
    const slow = drive(profile, 18_000, 1_000);
    const fast = drive(profile, 18_000, 200);
    const slowShare = slow.accelOverMs / slow.accelMs;
    expect(slowShare).toBeGreaterThan(0.25);
    expect(slowShare).toBeLessThan(0.45);
    expect(fast.accelOverMs / fast.accelMs).toBeCloseTo(slowShare, 1);
    /* Karşıt kanıt: eski örnek-farkı dedektörü 5 Hz'de bu sert hızlanmayı GÖRMEZ. */
    expect(fast.harshAccelCount).toBe(0);
  });

  it('A5. sert yavaşlama (−2,8 m/s²) sert kovaya, hafif yavaşlama yalnız faza gider', () => {
    const hard = drive((t) => Math.max(40, 90 - 10 * t), 5_000, 1_000);
    expect(hard.decelMs).toBe(5_000);
    expect(hard.decelHardMs).toBe(5_000);
    const soft = drive((t) => 90 - 2 * t, 10_000, 1_000);
    expect(soft.decelMs).toBe(10_000);
    expect(soft.decelHardMs).toBe(0);
  });

  it('A6. veri boşluğu ivme DEĞİLDİR (susan kaynağın dönüşü)', () => {
    let acc = createAccumulator();
    acc = applySample(acc, sample(T0, 90));
    acc = applySample(acc, sample(T0 + SAMPLE_STALE_MS + 2_000, 30));
    expect(acc.decelMs).toBe(0);
    expect(acc.decelHardMs).toBe(0);
  });

  it('A7. 🔒 GPS ↔ OBD iç içe akışta kaynak farkı SAHTE ivme üretmez', () => {
    let acc = createAccumulator();
    for (let t = 0; t <= 20_000; t += 500) {
      const gps = (t / 500) % 2 === 0;
      acc = applySample(acc, sample(T0 + t, gps ? 60 : 63, gps ? 'GPS' : 'OBD'));
    }
    expect(acc.accelMs).toBe(0);
    expect(acc.decelMs).toBe(0);
  });

  it('A8. fiziksel olarak imkânsız sıçrama (60→120 km/h, 1 sn) ölçüm SAYILMAZ', () => {
    let acc = createAccumulator();
    acc = applySample(acc, sample(T0, 60));
    acc = applySample(acc, sample(T0 + 1_000, 120));
    expect(acc.accelMs).toBe(0);
  });

  it('A9. düşük hız (pencere ort. < 10 km/h) ivme kovalarına girmez', () => {
    const acc = drive((t) => Math.min(8, 4 * t), 3_000, 1_000);
    expect(acc.accelMs).toBe(0);
  });

  it('A10. pencere dolmadan çapa korunur (ardışık 200 ms farkı ölçüm değildir)', () => {
    let acc = createAccumulator();
    acc = applySample(acc, sample(T0, 50));
    acc = applySample(acc, sample(T0 + 200, 55));
    expect(acc.accelMs).toBe(0);
    acc = applySample(acc, sample(T0 + DYN_MIN_WINDOW_MS, 55));
    expect(acc.accelMs).toBe(DYN_MIN_WINDOW_MS);
  });

  it('A11. bayat OBD örneği çapa/ivme üretmez', () => {
    let acc = createAccumulator();
    acc = applySample(acc, sample(T0, 50, 'OBD'));
    acc = applySample(acc, sample(T0 + 1_000, 90, 'OBD', false));
    expect(acc.accelMs).toBe(0);
    expect(acc.dynObdKmh).toBe(50);
  });

  it('A12. hız bantları hareket süresinden (duvar saati) sayılır', () => {
    const at120 = drive(() => 120, 10_000, 1_000);
    expect(at120.over110Ms).toBe(10_000);
    expect(at120.over130Ms).toBe(0);
    const at140 = drive(() => 140, 10_000, 1_000);
    expect(at140.over130Ms).toBe(10_000);
  });

  it('A13. RDE sınırı mevzuat formülüyle aynı (≈süreklilik 74,6 km/h)', () => {
    expect(rdeVaPosLimit(30)).toBeCloseTo(18.52, 2);
    expect(rdeVaPosLimit(100)).toBeCloseTo(26.386, 2);
    expect(Math.abs(rdeVaPosLimit(74.6) - rdeVaPosLimit(74.61))).toBeLessThan(0.1);
  });
});

/* ══════════════════ B · PUAN MODELİ ══════════════════ */

describe('B · yolculuk puanı', () => {
  it('B1. 🔒 kanıtsız (eski) kayıt puan ALMAZ — drivingScore 100 olsa bile', () => {
    const r = tripEcoScore(trip({ metricsVersion: 1 }, null));
    expect(r.status).toBe('NOT_RECORDED');
    expect(r.score).toBeNull();
    expect(r.band).toBeNull();
    expect(r.dimensions.every((d) => d.score === null)).toBe(true);
  });

  it('B2. bozuk kanıt (NaN/negatif) sıfır sayılmaz → NOT_RECORDED', () => {
    expect(tripEcoScore(trip({}, { accelSec: Number.NaN })).status).toBe('NOT_RECORDED');
    expect(tripEcoScore(trip({}, { decelHardSec: -1 })).status).toBe('NOT_RECORDED');
  });

  it('B3. kısa yolculuk ve düşük kapsama puanlanmaz', () => {
    expect(tripEcoScore(trip({}, { movingSec: 100 })).status).toBe('TOO_SHORT');
    expect(tripEcoScore(trip({ distanceKm: 0.6 })).status).toBe('TOO_SHORT');
    expect(tripEcoScore(trip({ timeCoverage: 0.4 })).status).toBe('LOW_COVERAGE');
    expect(tripEcoScore(trip({ timeCoverage: undefined })).status).toBe('LOW_COVERAGE');
  });

  it('B4. yalnız seyir hızıyla puan verilmez (davranış kanıtı şart)', () => {
    const r = tripEcoScore(trip({}, { accelSec: 5, decelSec: 5 }));
    expect(r.status).toBe('NOT_ENOUGH_SIGNAL');
    expect(r.score).toBeNull();
  });

  it('B5. sakin yolculuk 100 alır, odak yok', () => {
    const r = tripEcoScore(trip());
    expect(r.status).toBe('OK');
    expect(r.score).toBe(100);
    expect(r.band).toBe('excellent');
    expect(r.focus).toBeNull();
  });

  it('B6. RDE çapası: hızlanmanın %5\'i sınır üstü → Hızlanma 80', () => {
    const r = tripEcoScore(trip({}, { accelSec: 200, accelOverSec: 10 }));
    expect(r.dimensions[0].score).toBe(80);
    expect(r.dimensions[0].metricPct).toBe(5);
  });

  it('B7. 🔒 eğri monoton: sert an payı artınca puan ASLA artmaz', () => {
    let prev = Infinity;
    for (let over = 0; over <= 200; over += 5) {
      const s = tripEcoScore(trip({}, { accelSec: 200, accelOverSec: over })).score as number;
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
    for (let i = 1; i < DYNAMIC_CURVE.length; i++) {
      expect(DYNAMIC_CURVE[i][1]).toBeLessThan(DYNAMIC_CURVE[i - 1][1]);
    }
  });

  it('B8. 🔒 uzunluktan bağımsız: aynı oranlar, 10 kat yolculuk → aynı puan', () => {
    const short = tripEcoScore(trip({ distanceKm: 5 }, {
      accelSec: 60, accelOverSec: 6, decelSec: 60, decelHardSec: 3, movingSec: 300, over110Sec: 0,
    }));
    const long = tripEcoScore(trip({ distanceKm: 50 }, {
      accelSec: 600, accelOverSec: 60, decelSec: 600, decelHardSec: 30, movingSec: 3_000, over110Sec: 0,
    }));
    expect(long.score).toBe(short.score);
  });

  it('B9. seyir: 110–130 yarım, 130+ tam ağırlık; gösterim 110 üstü pay', () => {
    const mid = tripEcoScore(trip({}, { over110Sec: 1_200, over130Sec: 0 }));
    expect(mid.dimensions[2].score).toBe(62);
    expect(mid.dimensions[2].metricPct).toBe(100);
    const fast = tripEcoScore(trip({}, { over110Sec: 1_200, over130Sec: 1_200 }));
    expect(fast.dimensions[2].score).toBe(35);
  });

  it('B10. eksik boyutta ağırlıklar yeniden normalize edilir', () => {
    const r = tripEcoScore(trip({}, {
      accelSec: 200, accelOverSec: 20, decelSec: MIN_PHASE_SEC - 1, over110Sec: 600, over130Sec: 0,
    }));
    const a = r.dimensions[0].score as number;
    const c = r.dimensions[2].score as number;
    expect(r.dimensions[1].score).toBeNull();
    const expected = Math.round(
      (a * ECO_WEIGHTS.acceleration + c * ECO_WEIGHTS.cruise) / (ECO_WEIGHTS.acceleration + ECO_WEIGHTS.cruise),
    );
    expect(r.score).toBe(expected);
  });

  it('B11. odak en zayıf boyuttur (85 altı)', () => {
    const r = tripEcoScore(trip({}, { decelSec: 200, decelHardSec: 40 }));
    expect(r.focus).toBe('anticipation');
    expect(ecoBand(84)).toBe('good');
    expect(ecoBand(49)).toBe('poor');
  });
});

/* ══════════════════ C · HAFTALIK ÖZET ══════════════════ */

describe('C · haftalık özet', () => {
  const NOW = 100 * 24 * 3600_000;
  const DAY = 24 * 3600_000;

  it('C1. puan km ile ağırlıklıdır', () => {
    const w = buildEcoWeek([
      trip({ id: 'a', endTime: NOW - DAY, distanceKm: 90 }),                                            // 100
      trip({ id: 'b', endTime: NOW - DAY, distanceKm: 10 }, { accelSec: 100, accelOverSec: 50 }),       // düşük
    ], NOW);
    const low = tripEcoScore(trip({ distanceKm: 10 }, { accelSec: 100, accelOverSec: 50 })).score as number;
    expect(w.scoredTrips).toBe(2);
    expect(w.score).toBe(Math.round((100 * 90 + low * 10) / 100));
  });

  it('C2. geçen haftaya göre fark; 14 günden eski yolculuk sayılmaz', () => {
    const w = buildEcoWeek([
      trip({ id: 'a', endTime: NOW - DAY }),
      trip({ id: 'b', endTime: NOW - 8 * DAY }, { accelSec: 100, accelOverSec: 20 }),
      trip({ id: 'c', endTime: NOW - 20 * DAY }, { accelSec: 100, accelOverSec: 100 }),
    ], NOW);
    expect(w.trips).toBe(1);
    expect(w.lastWeekScore).not.toBeNull();
    expect(w.delta).toBe((w.score as number) - (w.lastWeekScore as number));
  });

  it('C3. 🔒 hiçbir yolculuk puanlanamazsa puan YOK, baskın neden var', () => {
    const w = buildEcoWeek([
      trip({ id: 'a', endTime: NOW - DAY, metricsVersion: 1 }, null),
      trip({ id: 'b', endTime: NOW - DAY, metricsVersion: 1 }, null),
      trip({ id: 'c', endTime: NOW - DAY, distanceKm: 0.5 }),
    ], NOW);
    expect(w.score).toBeNull();
    expect(w.band).toBeNull();
    expect(w.blocker).toBe('NOT_RECORDED');
    expect(w.dimensions.every((d) => d.score === null)).toBe(true);
  });
});

/* ══════════════════ D · GERÇEK SERVİS YOLU ══════════════════ */

function gpsFix(lat: number, speedKmh: number) {
  return {
    latitude: lat, longitude: 34.6,
    speed: speedKmh / 3.6, heading: 0, accuracy: 8,
    altitude: null, altitudeAccuracy: null, timestamp: Date.now(),
  };
}

describe('D · gerçek servis yolu', () => {
  let mono = 0;
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mono = 10_000;
    nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => mono);
    clearAllTrips();
    startTripLog();
  });

  afterEach(() => {
    stopTripLog();
    clearAllTrips();
    nowSpy.mockRestore();
  });

  it('D1. 🔒 kapanan yolculuk ecoDynamics + metricsVersion 2 taşır ve puanlanır', () => {
    let lat = 36.9;
    const push = (kmh: number) => {
      lat += (kmh / 3.6) / 111_000;       // 1 sn'de alınan yol (derece)
      _gpsCb!(gpsFix(lat, kmh));
      mono += 1_000;
    };
    for (let i = 0; i < 60; i++) push(60);             // 1 dk sakin seyir
    /* 10 döngü: güçlü hızlanma (+8 km/h/sn ≈ 2,2 m/s² @ ~70 → RDE sınırı üstü),
       seyir, sakin yavaşlama (−8 km/h/sn ≈ −2,2 m/s² → sert DEĞİL), seyir. */
    for (let c = 0; c < 10; c++) {
      for (let v = 68; v <= 84; v += 8) push(v);
      for (let i = 0; i < 10; i++) push(84);
      for (let v = 76; v >= 60; v -= 8) push(v);
      for (let i = 0; i < 10; i++) push(60);
    }

    stopTripLog();
    const rec = getTripSnapshot().history[0];
    expect(rec, 'yolculuk kaydedilmedi').toBeTruthy();
    expect(rec.metricsVersion).toBe(TRIP_METRICS_VERSION);
    expect(TRIP_METRICS_VERSION).toBe(2);
    const e = rec.ecoDynamics!;
    expect(e).toBeDefined();
    expect(e.accelSec).toBeGreaterThanOrEqual(MIN_PHASE_SEC);
    expect(e.accelOverSec).toBeGreaterThan(0);
    expect(e.decelSec).toBeGreaterThanOrEqual(MIN_PHASE_SEC);
    expect(e.decelHardSec).toBe(0);

    const r = tripEcoScore(rec);
    expect(r.status).toBe('OK');
    expect(r.dimensions[1].score).toBe(100);                    // öngörü kusursuz
    expect(r.dimensions[0].score as number).toBeLessThan(80);   // hızlanma zayıf
    expect(r.focus).toBe('acceleration');
  });
});
