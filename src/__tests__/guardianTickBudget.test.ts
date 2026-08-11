/**
 * guardianTickBudget.test.ts — GUARDIAN-AI-G16 · #494 BÜTÇE ÖLÇÜMÜ.
 *
 * Kütük #494 kabul ölçütü: *"`low` tier'da tek koşum < 16 ms ölçülür"*.
 * Bu dosya TAHMİN ETMEZ — ÖLÇER ve sayıyı konsola BASAR.
 *
 * ── ÖLÇÜMÜN DÜRÜST SINIRI (pazarlıksız) ─────────────────────────────────────
 * Buradaki sayı GELİŞTİRME MAKİNESİNDE alınır. Head unit sonucu SAYILMAZ —
 * #494 ancak gerçek düşük-uç cihazda (LAB → Guardian Runtime ekranındaki p95 /
 * "tavan aşımı" alanları) doğrulanınca 🟢'ye taşınır. Kütük tek otoritedir.
 *
 * Bu yüzden test iki şey birden yapar:
 *   1. Sert kilit: p95 < 16 ms (kabul ölçütünün kendisi).
 *   2. Regresyon kilidi: p95 < 2 ms (host'ta bugünkü gerçeğe yakın tavan —
 *      boru hattına pahalı bir iş sızarsa bu düşer, 16 ms'i beklemeye gerek
 *      kalmaz).
 * Ayrıca **kaç kat yavaş bir cihazın 16 ms'i aşacağını** hesaplayıp basar;
 * "cihazda da geçer" iddiası bu çarpanla AÇIKÇA ölçeklenebilir hale gelir.
 *
 * ── EN KÖTÜ DURUM ───────────────────────────────────────────────────────────
 * Ölçüm 8 kuralın TAMAMI girdili ve HEPSİ olay üretirken yapılır — bugün
 * üründe yalnız 1 kural bağlıdır (`vehicle-health`), yani gerçek maliyet
 * ölçülenden DÜŞÜKtür. Bütçeyi gelecekteki tam bağlanmaya göre savunuyoruz.
 */
import { describe, it, expect, vi } from 'vitest';

const env = vi.hoisted(() => ({ tier: 'low' as 'low' | 'mid' | 'high' }));
vi.mock('../platform/deviceCapabilities', () => ({ getDeviceTier: () => env.tier }));
vi.mock('../utils/detectWeakGpu', () => ({ hasWeakGpu: () => true, getGpuRenderer: () => 'Mali-400' }));
vi.mock('../utils/safeStorage', () => ({
  safeStorage:  { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  safeFlushKey: () => {},
  safeGetRaw:   () => null,
  safeSetRaw:   () => {},
}));

const obd = vi.hoisted(() => ({ snapshot: null as null | { engineTemp?: number; batteryVoltage?: number } }));
vi.mock('../platform/obdService', () => ({ getOBDDataSnapshot: () => obd.snapshot }));

import { buildGuardianRegistryInput } from '../platform/navigation/guardian/adapters/guardianAdapterRegistry';
import type { GuardianRawPlatformData } from '../platform/navigation/guardian/adapters/guardianAdapterRegistry';
import { buildGuardianRuleResults } from '../platform/navigation/guardian/guardianRuleRegistry';
import { runGuardian } from '../platform/navigation/guardian/guardianEngine';
import {
  GUARDIAN_TICK_HARD_LIMIT_MS, GUARDIAN_TICK_BUDGET_MS,
} from '../platform/navigation/guardian/runtime/guardianTickPolicy';
import {
  startGuardianRuntime, getGuardianRuntimeSnapshot,
  _resetGuardianRuntimeForTest, _runGuardianTickOnceForTest,
} from '../platform/navigation/guardian/runtime/guardianRuntime';

/* ── EN KÖTÜ DURUM fixture'ı — 8 kural da girdili ve olay üretiyor ─────────── */

const CURVE_POLICY = { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 };
const SPEED_POLICY = { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50, overspeedToleranceKph: 2 };
const ROAD_POLICY = { warningLeadTimeSeconds: 8, minimumWarningDistanceMeters: 50 };
const GRADE_THRESHOLDS = { low: 8, medium: 12, high: 16, critical: 20 };
const WEATHER_POLICY = { severityByCondition: { dry: 'NONE', wet: 'LOW', snow: 'HIGH', ice: 'CRITICAL' } } as const;
const VH_POLICY = {
  thresholds: { coolant: { high: 100, critical: 115 }, oilPressure: { low: 100, critical: 50 }, batteryVoltage: { low: 12, critical: 11 } },
  booleanSeverities: { brakeWarning: 'HIGH', engineWarningLamp: 'LOW', transmissionWarning: 'HIGH' },
} as const;
const HAZARD_POLICY = { severityByHazard: { accident: 'HIGH' } } as const;
const FATIGUE_POLICY = {
  thresholds: {
    continuousDriving: { elevatedMinutes: 90, highMinutes: 120, criticalMinutes: 180 },
    breakAge:          { elevatedMinutes: 120, highMinutes: 180, criticalMinutes: 240 },
    tripDuration:      { elevatedMinutes: 180, highMinutes: 300, criticalMinutes: 420 },
  },
  nightDriving: { startHour: 22, endHour: 6, severity: 'MEDIUM' },
  booleanSeverities: { lowAttentionSignal: 'MEDIUM', repeatedLaneCorrectionSignal: 'HIGH', microsleepSuspectedSignal: 'CRITICAL' },
  minimumConfidence: 0.3,
} as const;
const CAMERA_POLICY = { severityByCameraType: { average_speed: 'HIGH' }, minimumConfidence: 0.3 } as const;

function worstCaseRaw(): GuardianRawPlatformData {
  return {
    curve:         { id: 'curve-1', distanceMeters: 100, direction: 'left', advisorySpeedKph: 60, confidence: 0.8, currentSpeedKph: 90, policy: CURVE_POLICY },
    speedLimit:    { id: 'seg-1', distanceMeters: 100, postedSpeedLimitKph: 100, confidence: 0.8, currentSpeedKph: 130, policy: SPEED_POLICY },
    roadProfile:   { id: 'downhill-1', distanceMeters: 40, downhillGradePercent: 22, confidence: 0.8, currentSpeedKph: 80, policy: ROAD_POLICY, gradeThresholds: GRADE_THRESHOLDS },
    weather:       { surfaceCondition: 'ice', source: 'osm', confidence: 0.9, policy: WEATHER_POLICY },
    vehicleHealth: { coolantTemperatureC: 120, batteryVoltage: 10.5, oilPressureKpa: 20, brakeWarning: true, engineWarningLamp: true, transmissionWarning: true, policy: VH_POLICY },
    roadHazard:    { id: 'hz-1', hazardType: 'accident', distanceMeters: 400, confidence: 0.9, policy: HAZARD_POLICY },
    driverFatigue: { continuousDrivingMinutes: 200, minutesSinceLastMeaningfulBreak: 250, tripDurationMinutes: 430, localHour: 3, lowAttentionSignal: true, repeatedLaneCorrectionSignal: true, microsleepSuspectedSignal: true, confidence: 0.9, policy: FATIGUE_POLICY },
    speedCamera:   { id: 'cam-1', cameraType: 'average_speed', distanceMeters: 500, confidence: 0.9, policy: CAMERA_POLICY },
  };
}

/* ── Ölçüm yardımcıları ───────────────────────────────────────────────────── */

interface Stats { p50: number; p95: number; p99: number; max: number; min: number; mean: number; n: number }

function stats(samples: number[]): Stats {
  const s = [...samples].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
  return {
    p50: at(50), p95: at(95), p99: at(99), max: s[s.length - 1], min: s[0],
    mean: s.reduce((a, b) => a + b, 0) / s.length, n: s.length,
  };
}

function fmt(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(1)} µs` : `${ms.toFixed(3)} ms`;
}

function report(title: string, st: Stats): void {
  const factor = GUARDIAN_TICK_HARD_LIMIT_MS / st.p95;
  console.info(
    `\n[#494 ÖLÇÜM] ${title}\n` +
    `  örnek=${st.n}  min=${fmt(st.min)}  p50=${fmt(st.p50)}  p95=${fmt(st.p95)}  p99=${fmt(st.p99)}  max=${fmt(st.max)}  ort=${fmt(st.mean)}\n` +
    `  bütçe=${GUARDIAN_TICK_BUDGET_MS} ms · #494 tavanı=${GUARDIAN_TICK_HARD_LIMIT_MS} ms\n` +
    `  → tavanı aşmak için cihazın bu makineden ~${factor.toFixed(0)}× DAHA YAVAŞ olması gerekir (p95 üzerinden).\n` +
    `  ⚠️ max, HOST ZAMANLAYICISININ kesmesini de içerir (tam paket koşumunda 500+ test\n` +
    `     dosyası paralel çalışır) — bu yüzden KİLİT p99 üzerinedir, max yalnız RAPORLANIR.\n` +
    `  ⚠️ Bu ölçüm HOST'a aittir; head unit kanıtı DEĞİLDİR (kütük #539).`,
  );
}

/** Sıcak yol ölçümü: ısınma (JIT) sonrası N örnek. */
function measure(fn: () => void, warmup: number, n: number): Stats {
  for (let i = 0; i < warmup; i++) fn();
  const samples: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    fn();
    samples[i] = performance.now() - t0;
  }
  return stats(samples);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1) EN KÖTÜ DURUM — 8 kural da bağlı
 * ══════════════════════════════════════════════════════════════════════════ */

describe('#494 — Guardian tek koşum bütçesi (EN KÖTÜ DURUM: 8 kural)', () => {
  it('boru hattı gerçekten 8 kuralı çalıştırıyor (ölçüm boş işi ölçmüyor)', () => {
    const results = buildGuardianRuleResults(buildGuardianRegistryInput(worstCaseRaw()));
    expect(results.length).toBe(8);
    const out = runGuardian({ ruleResults: results });
    expect(out.riskEvents.length).toBeGreaterThanOrEqual(8);
    expect(out.highestSeverity).toBe('CRITICAL');
  });

  it('p95 koşum süresi #494 tavanının (16 ms) ALTINDA — ölçülen sayı raporlanır', () => {
    const raw = worstCaseRaw();
    const st = measure(() => {
      const input = buildGuardianRegistryInput(raw);
      const results = buildGuardianRuleResults(input);
      runGuardian({ ruleResults: results });
    }, 200, 2000);

    report('EN KÖTÜ DURUM · adaptör→8 kural→motor', st);

    expect(st.p99).toBeLessThan(GUARDIAN_TICK_HARD_LIMIT_MS);   // #494 kabul ölçütü
    expect(st.p95).toBeLessThan(2);                              // regresyon kilidi
    /* max ÜZERİNE kilit KURULMAZ: tek örneklik tepe, ölçtüğümüz Guardian'ın
       maliyetini değil host'un o anki kesmesini (GC · paralel test işçisi · OS
       zamanlayıcı) yansıtır. Yine de FELAKET kilidi kalır — bir mertebe
       atlaması buradan kaçamaz. */
    expect(st.max).toBeLessThan(200);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) ÜRÜNDEKİ GERÇEK YOL — bugün fiilen bağlı olan tik
 * ══════════════════════════════════════════════════════════════════════════ */

describe('#494 — üründeki GERÇEK tik (low tier · yalnız vehicle-health bağlı)', () => {
  it('gerçek tik gövdesi bütçe içinde kalır ve bütçe sayaçları temiz olur', () => {
    _resetGuardianRuntimeForTest();
    obd.snapshot = { engineTemp: 118, batteryVoltage: 11.4 };
    startGuardianRuntime();

    const st = measure(() => _runGuardianTickOnceForTest(), 200, 2000);
    report('ÜRÜN TİKİ · sağlayıcı→adaptör→vehicle-health→motor', st);

    const snap = getGuardianRuntimeSnapshot();
    expect(snap.tickCount).toBeGreaterThanOrEqual(2200);
    expect(snap.errorCount).toBe(0);
    expect(snap.evaluatedRuleCount).toBe(1);

    /* Aşım ORANI kilitlenir, mutlak 0 DEĞİL: tam paket koşumunda host bu
       süreci keser ve tek bir tik yapay olarak uzayabilir. Guardian'ın
       maliyeti değişseydi oran binde birde kalmazdı. Mutlak 0 kilidi GERÇEK
       CİHAZDA, LAB ekranındaki sayaç üzerinden aranır (#539). */
    expect(snap.overHardLimitCount / snap.tickCount).toBeLessThan(0.005);
    expect(snap.overBudgetCount / snap.tickCount).toBeLessThan(0.005);

    expect(st.p99).toBeLessThan(GUARDIAN_TICK_HARD_LIMIT_MS);
    expect(st.p95).toBeLessThan(GUARDIAN_TICK_BUDGET_MS);
    expect(st.p95).toBeLessThan(1);               // regresyon kilidi (gerçek yol daha ucuz)

    _resetGuardianRuntimeForTest();
  });

  it('runtime\'ın KENDİ ölçtüğü p95, testin ölçtüğü mertebeyle tutarlıdır', () => {
    _resetGuardianRuntimeForTest();
    obd.snapshot = { engineTemp: 118 };
    startGuardianRuntime();
    for (let i = 0; i < 300; i++) _runGuardianTickOnceForTest();

    const snap = getGuardianRuntimeSnapshot();
    expect(snap.p95DurationMs).not.toBeNull();
    expect(snap.p50DurationMs).not.toBeNull();
    expect(snap.maxDurationMs).not.toBeNull();
    expect(snap.p95DurationMs!).toBeLessThan(GUARDIAN_TICK_HARD_LIMIT_MS);
    console.info(
      `\n[#494 ÖLÇÜM] RUNTIME DEFTERİ (son ${snap.durationSampleCount} örnek)\n` +
      `  p50=${fmt(snap.p50DurationMs!)}  p95=${fmt(snap.p95DurationMs!)}  max=${fmt(snap.maxDurationMs!)}\n` +
      `  bütçe aşımı=${snap.overBudgetCount}  tavan aşımı=${snap.overHardLimitCount}`,
    );

    _resetGuardianRuntimeForTest();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) Bütçe muhasebesinin kendisi doğru mu (sayaç yalan söylemesin)
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Bütçe muhasebesi', () => {
  it('süre halkası SABİT boyutludur — sınırsız defter büyümez', () => {
    _resetGuardianRuntimeForTest();
    obd.snapshot = { engineTemp: 90 };
    startGuardianRuntime();
    for (let i = 0; i < 500; i++) _runGuardianTickOnceForTest();

    const snap = getGuardianRuntimeSnapshot();
    expect(snap.tickCount).toBe(500);
    expect(snap.durationSampleCount).toBe(64);   // GUARDIAN_DURATION_SAMPLE_SIZE
    _resetGuardianRuntimeForTest();
  });
});
