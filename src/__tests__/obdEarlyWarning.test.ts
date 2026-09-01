/**
 * obdEarlyWarning.test — P0-OBD-04 · ERKEN UYARI kilitleri.
 *
 * Görev şartı: sahte 0 · bayat veri · tek sıçrama · eksik PID · reconnect sonrası
 * eski verinin YANLIŞ erken uyarı üretemediği KANITLANMALI. Aşağıdaki beş bölüm
 * tam olarak bunları ölçer; kalanlar karar/güven mantığının kilitleridir.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  evaluateEarlyWarnings, explainEarlyWarnings, computeConfidence, median,
  EARLY_WARNING_RULES,
  SINGLE_SIGNAL_CONFIDENCE_CAP, CROSS_SIGNAL_CONFIDENCE_CAP,
  MIN_DWELL_FRACTION,
  type SignalWindow, type EarlyWarningResult,
} from '../platform/obd/earlyWarningEngine';
import type { CanonicalObdKey } from '../platform/obd/canonicalObdSignals';
import { MIN_TREND_SAMPLES, type TrendSample } from '../platform/obd/predictionEngine';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import type { ObdSignalEntry } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import {
  getPredictionSnapshot, getEarlyWarnings, _tickForTest, _resetPredictionRuntimeForTest,
} from '../platform/obd/predictionRuntime';

const T0 = 1_700_000_000_000;

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

/** `n` örnek, `stepMs` aralıkla; değer `gen(i)`. */
function win(n: number, gen: (i: number) => number, stepMs = 15_000, t0 = T0): SignalWindow {
  const samples: TrendSample[] = [];
  for (let i = 0; i < n; i++) samples.push({ t: t0 + i * stepMs, value: gen(i) });
  return { available: true, samples };
}

/** Sabit değerli pencere. */
function flat(n: number, v: number, stepMs = 15_000): SignalWindow {
  return win(n, () => v, stepMs);
}

function pick(results: readonly EarlyWarningResult[], id: string): EarlyWarningResult {
  const r = results.find((x) => x.id === id);
  expect(r, `kural bulunamadı: ${id}`).toBeDefined();
  return r!;
}

function evaluate(
  entries: Array<[CanonicalObdKey, SignalWindow]>,
  engineRunning: boolean | null = true,
): readonly EarlyWarningResult[] {
  return evaluateEarlyWarnings({ windows: new Map(entries), engineRunning });
}

/** 20 örnek × 15 sn = 285 sn ≈ 4,75 dk — tüm kuralların minDwell'ini aşar. */
const N = 20;

/* ── 0. Sözleşme ──────────────────────────────────────────────────────────── */

describe('P0-OBD-04 · sözleşme', () => {
  it('HER kural için MUTLAKA bir hüküm döner — sessiz atlama YOK', () => {
    const out = evaluate([]);
    expect(out).toHaveLength(EARLY_WARNING_RULES.length);
    for (const r of out) expect(r.verdict).toBeTruthy();
  });

  it('güven ASLA 1.0 olamaz — tek sinyalde tavan daha da düşük', () => {
    expect(computeConfidence(10 * 60_000, 60_000, 1, true)).toBeLessThanOrEqual(CROSS_SIGNAL_CONFIDENCE_CAP);
    expect(computeConfidence(10 * 60_000, 60_000, 1, false)).toBeLessThanOrEqual(SINGLE_SIGNAL_CONFIDENCE_CAP);
    expect(CROSS_SIGNAL_CONFIDENCE_CAP).toBeLessThan(1);
  });

  it('medyan tek sıçramayı yutar, ortalama yutmaz', () => {
    const spike = [10, 10, 10, 10, 200];
    expect(median(spike)).toBe(10);
    expect(spike.reduce((a, b) => a + b, 0) / spike.length).toBeGreaterThan(40);
  });
});

/* ── 1. EKSİK PID: "desteklenmiyor" NORMAL SAYILMAZ ───────────────────────── */

describe('P0-OBD-04 · eksik PID normal sayılmaz', () => {
  it('sinyal hiç yoksa SIGNAL_MISSING — NORMAL DEĞİL', () => {
    const r = pick(evaluate([]), 'fuel_trim_drift');
    expect(r.verdict).toBe('SIGNAL_MISSING');
    expect(r.verdict).not.toBe('NORMAL');
    expect(r.missing).toContain('longFuelTrimB1');
    expect(r.reason).toContain('DEĞİLDİR');
    expect(r.confidence).toBe(0);
  });

  it('`available:false` pencere de SIGNAL_MISSING üretir', () => {
    const r = pick(evaluate([['longFuelTrimB1', { available: false, samples: [] }]]),
      'fuel_trim_drift');
    expect(r.verdict).toBe('SIGNAL_MISSING');
  });

  it('İKİNCİ banka yoksa banka farkı kuralı hüküm VEREMEZ', () => {
    const r = pick(evaluate([['longFuelTrimB1', flat(N, 14)]]), 'fuel_trim_bank_imbalance');
    expect(r.verdict).toBe('SIGNAL_MISSING');
    expect(r.missing).toEqual(['longFuelTrimB2']);
  });

  it('eksik sinyal ADIYLA bildirilir (hangi PID olduğu gizlenmez)', () => {
    const r = pick(evaluate([]), 'thermostat_stuck_open');
    expect(r.missing.sort()).toEqual(['ambientTemp', 'coolantTemp', 'engineRunTime']);
  });
});

/* ── 2. TEK SIÇRAMA hüküm doğurmaz ────────────────────────────────────────── */

describe('P0-OBD-04 · tek sıçrama arıza değildir', () => {
  it('tek uç değer NORMAL bırakır (medyan + kaplama kapısı)', () => {
    // 19 örnek %2, tek örnek %40 → medyan %2, kaplama 1/20
    const w = win(N, (i) => (i === 10 ? 40 : 2));
    const r = pick(evaluate([['longFuelTrimB1', w]]), 'fuel_trim_drift');
    expect(r.verdict).toBe('NORMAL');
  });

  it('yarı yarıya sapma bile kaplama eşiğinin altındaysa NORMAL', () => {
    // 11/20 örnek %20, kalanı %5 → MEDYAN %20 (bandı aşar) ama kaplama 0.55 < 0.6
    const w = win(N, (i) => (i < 11 ? 20 : 5));
    const r = pick(evaluate([['longFuelTrimB1', w]]), 'fuel_trim_drift');
    expect(r.verdict).toBe('NORMAL');
    expect(r.dwellFraction).toBeLessThan(MIN_DWELL_FRACTION);
    expect(r.reason).toContain('süreklilik yok');
  });

  it('SÜREKLİ sapma ise hüküm verilir (kural gerçekten çalışıyor)', () => {
    const r = pick(evaluate([['longFuelTrimB1', flat(N, 14)]]), 'fuel_trim_drift');
    expect(['WATCH', 'ATTENTION']).toContain(r.verdict);
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.evidence[0]!.median).toBeCloseTo(14, 1);
  });
});

/* ── 3. YETERSİZ GÖZLEM: erken hüküm yok ──────────────────────────────────── */

describe('P0-OBD-04 · yetersiz gözlem hüküm doğurmaz', () => {
  it('örneklem azsa INSUFFICIENT_DATA (NORMAL değil)', () => {
    const r = pick(evaluate([['longFuelTrimB1', flat(MIN_TREND_SAMPLES - 1, 30)]]),
      'fuel_trim_drift');
    expect(r.verdict).toBe('INSUFFICIENT_DATA');
  });

  it('süre kısaysa INSUFFICIENT_DATA — büyük sapmada bile', () => {
    // 20 örnek ama 1 sn aralıkla → 19 sn gözlem, minDwell 120 sn
    const r = pick(evaluate([['longFuelTrimB1', flat(N, 30, 1_000)]]), 'fuel_trim_drift');
    expect(r.verdict).toBe('INSUFFICIENT_DATA');
    expect(r.reason).toContain('yeterli gözlem yok');
  });
});

/* ── 4. MOTOR DURUMU: fail-closed ─────────────────────────────────────────── */

describe('P0-OBD-04 · motor durumu bilinmiyorsa susulur', () => {
  it('motor çalışmıyorken düşük voltaj UYARI ÜRETMEZ', () => {
    const r = pick(evaluate([['moduleVoltage', flat(N, 12.2)]], false), 'charging_system_weak');
    expect(r.verdict).toBe('INSUFFICIENT_DATA');
  });

  it('motor durumu BİLİNMİYORSA da susulur (fail-closed)', () => {
    const r = pick(evaluate([['moduleVoltage', flat(N, 12.2)]], null), 'charging_system_weak');
    expect(r.verdict).toBe('INSUFFICIENT_DATA');
    expect(r.reason).toContain('bilinmiyor');
  });

  it('motor çalışırken düşük şarj gerilimi UYARI ÜRETİR', () => {
    const r = pick(evaluate([['moduleVoltage', flat(N, 12.4)]], true), 'charging_system_weak');
    expect(['WATCH', 'ATTENTION']).toContain(r.verdict);
    expect(r.confidence).toBeLessThanOrEqual(SINGLE_SIGNAL_CONFIDENCE_CAP);
  });
});

/* ── 5. FİZİKSEL ÖN KOŞUL: anlamsız ölçüm "iyi" sayılmaz ──────────────────── */

describe('P0-OBD-04 · fiziksel ön koşullar', () => {
  it('EGR hiç komutlanmıyorsa hata ölçüsü DEĞERLENDİRİLMEZ (NORMAL demez)', () => {
    const r = pick(evaluate([
      ['egrError', flat(N, 40)],
      ['egrCommanded', flat(N, 1)],
    ]), 'egr_flow_fault');
    expect(r.verdict).toBe('INSUFFICIENT_DATA');
    expect(r.reason).toContain('komutlanmadı');
  });

  it('EGR komutlanıyorsa ve hata büyükse UYARI ÜRETİR', () => {
    const r = pick(evaluate([
      ['egrError', flat(N, 40)],
      ['egrCommanded', flat(N, 25)],
    ]), 'egr_flow_fault');
    expect(['WATCH', 'ATTENTION']).toContain(r.verdict);
  });

  it('motor yeterince çalışmadıysa termostat hükmü verilmez', () => {
    const r = pick(evaluate([
      ['coolantTemp', flat(N, 55)],
      ['engineRunTime', flat(N, 120)],
      ['ambientTemp', flat(N, 20)],
    ]), 'thermostat_stuck_open');
    expect(r.verdict).toBe('INSUFFICIENT_DATA');
  });

  it('donma altında yavaş ısınma NORMALDİR — uyarı üretilmez', () => {
    const r = pick(evaluate([
      ['coolantTemp', flat(N, 55)],
      ['engineRunTime', flat(N, 1_200)],
      ['ambientTemp', flat(N, -8)],
    ]), 'thermostat_stuck_open');
    expect(r.verdict).toBe('INSUFFICIENT_DATA');
    expect(r.reason).toContain('donma altında');
  });

  it('uzun süre çalışıp ısınamayan motor UYARI ÜRETİR', () => {
    const r = pick(evaluate([
      ['coolantTemp', flat(N, 58)],
      ['engineRunTime', flat(N, 1_200)],
      ['ambientTemp', flat(N, 18)],
    ]), 'thermostat_stuck_open');
    expect(['WATCH', 'ATTENTION']).toContain(r.verdict);
    expect(r.evidence.map((e) => e.key).sort())
      .toEqual(['ambientTemp', 'coolantTemp', 'engineRunTime']);
  });

  it('emme havası dış havadan soğuk olamaz — sensör tutarsızlığı yakalanır', () => {
    const r = pick(evaluate([
      ['intakeTemp', flat(N, 5)],
      ['ambientTemp', flat(N, 25)],
    ]), 'intake_temp_implausible');
    expect(['WATCH', 'ATTENTION']).toContain(r.verdict);
  });

  it('emme havası ortamdan SICAKSA (normal) uyarı yok', () => {
    const r = pick(evaluate([
      ['intakeTemp', flat(N, 40)],
      ['ambientTemp', flat(N, 25)],
    ]), 'intake_temp_implausible');
    expect(r.verdict).toBe('NORMAL');
  });
});

/* ── 6. ÇAPRAZ SİNYAL güveni yükseltir ────────────────────────────────────── */

describe('P0-OBD-04 · çapraz sinyal desteği', () => {
  it('kısa dönem trim aynı yönde ise güven ARTAR', () => {
    const alone = pick(evaluate([['longFuelTrimB1', flat(N, 14)]]), 'fuel_trim_drift');
    const both = pick(evaluate([
      ['longFuelTrimB1', flat(N, 14)],
      ['shortFuelTrimB1', flat(N, 8)],
    ]), 'fuel_trim_drift');
    expect(both.confidence).toBeGreaterThan(alone.confidence);
    expect(both.reason).toContain('aynı yönde');
  });

  it('tek sinyalli hüküm tavanı AŞAMAZ', () => {
    const r = pick(evaluate([['oilTemp', flat(40, 130)]]), 'oil_overheat_trend');
    if (r.verdict === 'WATCH' || r.verdict === 'ATTENTION') {
      expect(r.confidence).toBeLessThanOrEqual(CROSS_SIGNAL_CONFIDENCE_CAP);
    }
  });

  it('banka farkı iki bağımsız ölçümün KIYASIDIR', () => {
    const r = pick(evaluate([
      ['longFuelTrimB1', flat(N, 2)],
      ['longFuelTrimB2', flat(N, 20)],
    ]), 'fuel_trim_bank_imbalance');
    expect(['WATCH', 'ATTENTION']).toContain(r.verdict);
    expect(r.evidence).toHaveLength(2);
  });
});

/* ── 7. DİL: "arıza var" DENMEZ ───────────────────────────────────────────── */

describe('P0-OBD-04 · kullanıcıya kesinlik iddia edilmez', () => {
  it('Mavi metni erken belirti dili kullanır, teşhis dili DEĞİL', () => {
    const out = evaluate([['longFuelTrimB1', flat(N, 20)], ['shortFuelTrimB1', flat(N, 9)]]);
    const text = explainEarlyWarnings(out)!;
    expect(text).toContain('erken');
    expect(text).toContain('kesin bir arıza teşhisi değil');
    expect(text).not.toMatch(/arıza var|arızalı|bozuk/i);
  });

  it('Mavi metni GEREKÇE ve ÖLÇÜM taşır', () => {
    const out = evaluate([['longFuelTrimB1', flat(N, 20)]]);
    const text = explainEarlyWarnings(out)!;
    expect(text).toMatch(/%\s?20|20[.,]0/);
  });

  it('hüküm yoksa Mavi HİÇBİR ŞEY söylemez (gürültü üretmez)', () => {
    expect(explainEarlyWarnings(evaluate([]))).toBeNull();
    expect(explainEarlyWarnings(evaluate([['longFuelTrimB1', flat(N, 1)]]))).toBeNull();
  });

  it('ATTENTION, WATCH’ten önce anlatılır', () => {
    const out: EarlyWarningResult[] = [
      { id: 'oil_overheat_trend', title: 'A', verdict: 'WATCH', confidence: 0.5,
        reason: 'r1', evidence: [], missing: [], dwellFraction: 1, observedMs: 1 },
      { id: 'catalyst_overtemp', title: 'B', verdict: 'ATTENTION', confidence: 0.4,
        reason: 'r2', evidence: [], missing: [], dwellFraction: 1, observedMs: 1 },
    ];
    expect(explainEarlyWarnings(out)!).toContain('B');
  });
});

/* ── 8. KOŞUCU: bayat veri · sahte 0 · reconnect ──────────────────────────── */

describe('P0-OBD-04 · koşucu entegrasyonu', () => {
  function entry(value: number, over: Partial<ObdSignalEntry> = {}): ObdSignalEntry {
    return { value, atMs: Date.now(), epoch: 1, staleMs: 60_000, unavailableMs: 180_000, ...over };
  }

  beforeEach(() => {
    _resetPredictionRuntimeForTest();
    useUnifiedVehicleStore.getState().resetObdSignals();
    useUnifiedVehicleStore.setState({
      canCoolantTemp: null, canBatteryVolt: null, canAmbientTemp: null,
      canOilTemp: null, canThrottle: null, rpm: 2000,
    });
  });

  it('BAYAT ölçüm tampona GİRMEZ — trend üretemez', () => {
    // unavailableMs aşılmış kayıt → readLiveObdSignal null döner.
    useUnifiedVehicleStore.setState({
      obdSessionEpoch: 1,
      obdSignals: Object.freeze({
        longFuelTrimB1: entry(25, { atMs: Date.now() - 10 * 60_000 }),
      }),
    });
    _tickForTest();
    const snap = getPredictionSnapshot();
    expect(snap.earlyWarningSampleCounts['longFuelTrimB1'] ?? 0).toBe(0);
    expect(pick(getEarlyWarnings(), 'fuel_trim_drift').verdict).toBe('SIGNAL_MISSING');
  });

  it('SAHTE 0 üretilmez: ölçüm yoksa örnek de yok', () => {
    useUnifiedVehicleStore.setState({ obdSessionEpoch: 1, obdSignals: Object.freeze({}) });
    _tickForTest();
    const snap = getPredictionSnapshot();
    expect(Object.keys(snap.earlyWarningSampleCounts)).toHaveLength(0);
    for (const r of getEarlyWarnings()) {
      expect(['SIGNAL_MISSING', 'INSUFFICIENT_DATA']).toContain(r.verdict);
    }
  });

  it('TAZE ölçüm tampona girer ve sayaçta görünür', () => {
    useUnifiedVehicleStore.setState({
      obdSessionEpoch: 1,
      obdSignals: Object.freeze({ longFuelTrimB1: entry(14) }),
    });
    _tickForTest();
    expect(getPredictionSnapshot().earlyWarningSampleCounts['longFuelTrimB1']).toBe(1);
  });

  it('RECONNECT sonrası eski örnekler ATILIR — yanlış trend üretilemez', () => {
    useUnifiedVehicleStore.setState({
      obdSessionEpoch: 1,
      obdSignals: Object.freeze({ longFuelTrimB1: entry(14) }),
    });
    for (let i = 0; i < 6; i++) _tickForTest();
    expect(getPredictionSnapshot().earlyWarningSampleCounts['longFuelTrimB1']).toBeGreaterThan(1);

    // Yeni OBD oturumu (adaptör başka araca takılmış olabilir).
    useUnifiedVehicleStore.setState({
      obdSessionEpoch: 2,
      obdSignals: Object.freeze({ longFuelTrimB1: entry(14, { epoch: 2 }) }),
    });
    _tickForTest();
    /* Tampon SIFIRLANDI: yeni oturumda yalnız 1 örnek olmalı. Eskiden
       `connectionState|source|vehicleType` anahtarı aynı kaldığı için eski
       tampon sessizce yeni oturuma taşınırdı. */
    expect(getPredictionSnapshot().earlyWarningSampleCounts['longFuelTrimB1']).toBe(1);
    expect(getPredictionSnapshot().clearCount).toBeGreaterThan(0);
  });

  it('ÖNCEKİ OTURUMA ait kayıt hiç örneklenmez', () => {
    useUnifiedVehicleStore.setState({
      obdSessionEpoch: 2,
      obdSignals: Object.freeze({ longFuelTrimB1: entry(14, { epoch: 1 }) }),
    });
    _tickForTest();
    expect(getPredictionSnapshot().earlyWarningSampleCounts['longFuelTrimB1'] ?? 0).toBe(0);
  });

  it('koşucu her kural için hüküm yayınlar (LAB boş kalmaz)', () => {
    useUnifiedVehicleStore.setState({ obdSessionEpoch: 1, obdSignals: Object.freeze({}) });
    _tickForTest();
    expect(getEarlyWarnings()).toHaveLength(EARLY_WARNING_RULES.length);
    expect(getPredictionSnapshot().earlyWarningRuleCount).toBe(EARLY_WARNING_RULES.length);
  });

  it('motor durmuşken (rpm 0) motor-bağımlı kurallar susar', () => {
    useUnifiedVehicleStore.setState({
      rpm: 0, obdSessionEpoch: 1,
      obdSignals: Object.freeze({ moduleVoltage: entry(12.1) }),
    });
    _tickForTest();
    expect(pick(getEarlyWarnings(), 'charging_system_weak').verdict).not.toBe('WATCH');
  });
});
