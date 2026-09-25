/**
 * performanceRuns.test — Performans 2.0: ölçüm damgasından enterpole süre,
 * geçerlilik (seyrek veri / bırakma / simüle), sürücüye göre rekor kıyası.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../platform/obdService', () => ({
  onOBDData: () => () => {}, getObdSpeedFresh: () => null,
  getObdFieldObservedAt: () => ({ speedMs: 0 }), getOBDDataSnapshot: () => ({ source: 'real' }),
}));
vi.mock('../platform/gpsService', () => ({ getGPSState: () => ({ location: null }) }));
vi.mock('../store/useStore', () => ({
  useStore: { getState: () => ({ settings: { activeDriverProfileId: 'drv-a' } }) },
}));

import {
  analyzeRun, bestRun, feedRunSample, getRunState, loadRunHistory, _armRunForTest,
  type SpeedSample, type RunRecord,
} from '../platform/perf/performanceRuns';

/** Sabit ivmeli hızlanma: v(t) = a·t (km/s), her `stepMs`te örnek. */
function ramp(fromKmh: number, toKmh: number, kmhPerS: number, stepMs: number, t0 = 1000): SpeedSample[] {
  const out: SpeedSample[] = [];
  const dur = ((toKmh - fromKmh) / kmhPerS) * 1000;
  for (let t = 0; t <= dur + stepMs; t += stepMs) {
    const v = fromKmh + (kmhPerS * t) / 1000;
    out.push({ t: t0 + t, kmh: Math.round(Math.min(v, toKmh + 5)) });
  }
  return out;
}

describe('analyzeRun', () => {
  it('0-100: 10 km/s/sn ivmede ~10 sn, örnek aralığından hassas', () => {
    const s = [{ t: 0, kmh: 0 }, { t: 700, kmh: 0 }, ...ramp(0, 100, 10, 300, 1000).slice(1)];
    const a = analyzeRun('0-100', s)!;
    expect(a.timeMs).toBeGreaterThan(9700);
    expect(a.timeMs).toBeLessThan(10100);
    expect(a.valid).toBe(true);
    expect(a.precisionMs).toBe(225);   // (600 + 300) / 4 — uçlardaki örnek aralığından
  });
  it('100-0: süre, mesafe ve ortalama yavaşlama', () => {
    const s: SpeedSample[] = [];
    for (let t = 0; t <= 3600; t += 200) s.push({ t, kmh: Math.max(0, Math.round(105 - (t / 1000) * 30)) });
    const a = analyzeRun('100-0', s)!;
    expect(a.timeMs).toBeGreaterThan(3100);
    expect(a.timeMs).toBeLessThan(3400);
    expect(a.distanceM).toBeGreaterThan(40);
    expect(a.distanceM).toBeLessThan(50);
    expect(a.avgDecelG).toBeGreaterThan(0.8);
  });
  it('🔒 seyrek veri geçersiz', () => {
    const a = analyzeRun('60-100', [{ t: 0, kmh: 50 }, { t: 1000, kmh: 62 }, { t: 3000, kmh: 80 }, { t: 5000, kmh: 101 }])!;
    expect(a.valid).toBe(false);
    expect(a.invalidReasons).toContain('SPARSE_DATA');
  });
  it('🔒 gaz bırakılırsa geçersiz', () => {
    const s = ramp(50, 100, 8, 250).map((p) => (p.kmh === 80 ? { ...p, kmh: 72 } : p));
    expect(analyzeRun('60-100', s)!.invalidReasons).toContain('LIFTED');
  });
  it('🔒 simüle OBD geçersiz; belirgin eğim uyarı', () => {
    const s = ramp(0, 100, 10, 300).map((p, i) => ({ ...p, altM: 100 - i }));
    const a = analyzeRun('0-100', [{ t: 0, kmh: 0, altM: 101 }, ...s.slice(1)], true)!;
    expect(a.invalidReasons).toContain('SIMULATED');
    expect(a.warnings).toContain('SLOPE');
  });
  it('eşik geçilmediyse null', () => {
    expect(analyzeRun('0-100', [{ t: 0, kmh: 0 }, { t: 500, kmh: 40 }])).toBeNull();
  });
});

describe('bestRun', () => {
  const r = (id: string, timeMs: number, over: Partial<RunRecord> = {}): RunRecord => ({
    id, kind: '0-100', timeMs, precisionMs: 50, distanceM: 150, avgDecelG: null, maxGapMs: 300,
    valid: true, invalidReasons: [], warnings: [], at: 0, driverId: 'drv-a', ...over,
  });
  it('🔒 yalnız aynı sürücü ve geçerli koşular', () => {
    const h = [r('1', 9000), r('2', 8000, { valid: false }), r('3', 7000, { driverId: 'drv-b' }), r('4', 8500)];
    expect(bestRun(h, '0-100', 'drv-a')?.id).toBe('4');
  });
});

describe('kayıt makinesi', () => {
  beforeEach(() => { localStorage.clear(); });
  it('dur → kalk → 100: sonuç kaydedilir ve önceki en iyiyle kıyaslanır', () => {
    const drive = (kmhPerS: number) => {
      _armRunForTest('0-100');
      let t = 10_000;
      feedRunSample({ t, kmh: 0 }); t += 300;
      feedRunSample({ t, kmh: 0 });
      expect(getRunState().phase).toBe('ready');
      for (let v = 0; v <= 105; v += kmhPerS * 0.3) { t += 300; feedRunSample({ t, kmh: Math.round(v) }); if (getRunState().phase === 'done') break; }
      return getRunState();
    };
    const first = drive(10);
    expect(first.phase).toBe('done');
    expect(first.result?.valid).toBe(true);
    expect(first.deltaVsBestMs).toBeNull();
    const second = drive(12.5);
    expect(second.deltaVsBestMs).toBeLessThan(-1500);
    expect(loadRunHistory()).toHaveLength(2);
  });
  it('🔒 kalkıştan sonra durursa ölçüm iptal, hazır durumuna döner', () => {
    _armRunForTest('0-100');
    feedRunSample({ t: 1, kmh: 0 });
    feedRunSample({ t: 300, kmh: 5 });
    expect(getRunState().phase).toBe('recording');
    feedRunSample({ t: 600, kmh: 0 });
    expect(getRunState().phase).toBe('ready');
    expect(loadRunHistory()).toHaveLength(0);
  });
});
