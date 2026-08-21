/**
 * predictionRuntime.test.ts — V-09 Öngörü Motoru koşucusu KİLİTLERİ.
 *
 * ── KAPATILAN KUSUR ────────────────────────────────────────────────────────
 * Anayasanın 6. kapısı ("5 dk sonra ne olacak?") fiilen KAPALIYDI: 164 satırlık
 * trend/öngörü motoru yazılmış ama **tek tüketicisi kendi testiydi** — üretimde
 * 0 çağrı. Bu dosya koşucunun gerçekten bağlandığını ve motorun fail-closed
 * kararını BOZMADIĞINI kilitler.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stripComments } from './helpers';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/* OBD anlık görüntüsü mock'lanır: koşucu tik gövdesini doğrudan koştururuz. */
const snapshotMock = vi.fn();
vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: () => snapshotMock(),
}));

/* Zamanlayıcı tekerine gerçek kayıt yapılmasın. */
const scheduleMock = vi.fn(() => () => {});
vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: { scheduleTask: (t: unknown) => scheduleMock(t as never) },
}));

const BASE = {
  connectionState: 'connected', source: 'real', vehicleType: 'ice',
  dataFresh: true, lastSeenMs: 0,
  engineTemp: 90, batteryVoltage: 12.6,
};

async function mod() {
  return import('../platform/obd/predictionRuntime');
}

describe('predictionRuntime › örneklem dürüstlüğü', () => {
  beforeEach(async () => {
    (await mod())._resetPredictionRuntimeForTest();
    snapshotMock.mockReset();
    scheduleMock.mockClear();
  });

  it('BAYAT veri örneklenmez — duran sayı sahte "trend yok" üretirdi', async () => {
    const m = await mod();
    snapshotMock.mockReturnValue({ ...BASE, dataFresh: false, lastSeenMs: Date.now() });
    m._tickForTest();
    const s = m.getPredictionSnapshot();
    expect(s.skippedStale).toBe(1);
    expect(Object.values(s.sampleCounts).every((n) => n === 0)).toBe(true);
  });

  it('ÇOK ESKİ damga da örneklenmez (ikinci savunma katmanı)', async () => {
    const m = await mod();
    snapshotMock.mockReturnValue({
      ...BASE, dataFresh: true, lastSeenMs: Date.now() - (m.MAX_SAMPLE_AGE_MS + 5_000),
    });
    m._tickForTest();
    expect(m.getPredictionSnapshot().skippedStale).toBe(1);
  });

  it('sensör okunamazsa örnek ALINMAZ — sahte 0 bir ÖLÇÜM DEĞİLDİR', async () => {
    const m = await mod();
    /* -1 sentinel ve undefined: ikisi de "yok" demektir. */
    snapshotMock.mockReturnValue({ ...BASE, engineTemp: -1, batteryVoltage: undefined });
    m._tickForTest();
    const s = m.getPredictionSnapshot();
    expect(s.sampleCounts['overheat']).toBe(0);
    expect(s.skippedMissing).toBeGreaterThan(0);
  });

  it('taze ve geçerli veri örneklenir', async () => {
    const m = await mod();
    snapshotMock.mockReturnValue({ ...BASE });
    m._tickForTest();
    m._tickForTest();
    const s = m.getPredictionSnapshot();
    expect(s.sampleCounts['overheat']).toBe(2);
    expect(s.tickCount).toBe(2);
  });

  it('ARAÇ DEĞİŞİNCE tampon SIFIRLANIR — iki aracın değeri aynı doğruya uydurulamaz', async () => {
    const m = await mod();
    snapshotMock.mockReturnValue({ ...BASE });
    m._tickForTest(); m._tickForTest();
    expect(m.getPredictionSnapshot().sampleCounts['overheat']).toBe(2);

    snapshotMock.mockReturnValue({ ...BASE, vehicleType: 'ev' });
    m._tickForTest();
    const s = m.getPredictionSnapshot();
    expect(s.clearCount).toBe(1);
    expect(s.sampleCounts['overheat']).toBe(1);   // temizlik sonrası yeni örnek
  });

  it('halka tampon TAVANI aşmaz', async () => {
    const m = await mod();
    snapshotMock.mockReturnValue({ ...BASE });
    for (let i = 0; i < m.MAX_SAMPLES + 20; i++) m._tickForTest();
    expect(m.getPredictionSnapshot().sampleCounts['overheat']).toBe(m.MAX_SAMPLES);
  });

  it('anlık görüntü PATLARSA koşucu ölmez (fail-soft)', async () => {
    const m = await mod();
    snapshotMock.mockImplementation(() => { throw new Error('boom'); });
    expect(() => m._tickForTest()).not.toThrow();
  });
});

describe('predictionRuntime › motorun fail-closed kararı korunur', () => {
  beforeEach(async () => {
    (await mod())._resetPredictionRuntimeForTest();
    snapshotMock.mockReset();
  });

  it('yetersiz örneklemde TAHMİN ÜRETİLMEZ', async () => {
    const m = await mod();
    snapshotMock.mockReturnValue({ ...BASE });
    m._tickForTest();   // 1 örnek — MIN_TREND_SAMPLES (5) altında
    expect(Object.keys(m.getPredictionSnapshot().predictions)).toHaveLength(0);
  });

  it('SOĞUYAN motor için "aşırı ısınma" DENMEZ (yön kapısı)', async () => {
    const m = await mod();
    let t = 100;
    for (let i = 0; i < 10; i++) {
      snapshotMock.mockReturnValue({ ...BASE, engineTemp: t });
      m._tickForTest();
      t -= 2;   // düşüyor
    }
    expect(m.getPredictionSnapshot().predictions['overheat']).toBeUndefined();
  });

  it('kaynağı OLMAYAN kural sayaçta yer tutmaz ve AÇIKÇA bildirilir', async () => {
    const m = await mod();
    snapshotMock.mockReturnValue({ ...BASE });
    m._tickForTest();
    const s = m.getPredictionSnapshot();
    expect(s.rulesWithoutSource).toContain('oil_pressure_drop');
    expect(s.sampleCounts['oil_pressure_drop']).toBeUndefined();
    /* Kaynağı olmayan kural "eksik ölçüm" sayacını da şişirmemeli. */
    expect(s.predictions['oil_pressure_drop']).toBeUndefined();
  });
});

describe('predictionRuntime › bütçe ve kablo', () => {
  beforeEach(async () => {
    (await mod())._resetPredictionRuntimeForTest();
    scheduleMock.mockClear();
  });

  it('görev SAFETY kritikliğinde kaydedilir — düşük-uçta yavaşlatılmaz', async () => {
    const m = await mod();
    m.startPredictionRuntime();
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    const task = scheduleMock.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(task.criticality).toBe('SAFETY');
    expect(task.id).toBe(m.PREDICTION_TASK_ID);
    expect(task.periodMs).toBe(m.SAMPLE_PERIOD_MS);
    /* Güvenlik uyarısı "boşta kalınca" ERTELENMEZ. */
    expect(task.deferIdle).toBeUndefined();
  });

  it('periyot HOT-PATH değil soğuk yoldur (≥ 5 sn)', async () => {
    const m = await mod();
    expect(m.SAMPLE_PERIOD_MS).toBeGreaterThanOrEqual(5_000);
  });

  it('İDEMPOTENT: ikinci start ikinci görev kaydetmez', async () => {
    const m = await mod();
    m.startPredictionRuntime();
    m.startPredictionRuntime();
    expect(scheduleMock).toHaveBeenCalledTimes(1);
  });

  it('stop görevi wheel\'den kaldırır (zero-leak)', async () => {
    const unschedule = vi.fn();
    scheduleMock.mockReturnValueOnce(unschedule as never);
    const m = await mod();
    m.startPredictionRuntime();
    m.stopPredictionRuntime();
    expect(unschedule).toHaveBeenCalled();
    expect(m.getPredictionSnapshot().running).toBe(false);
  });

  it('SystemBoot koşucuyu başlatır ve temizliğini kaydeder', () => {
    const boot = read('src/platform/system/SystemBoot.ts');
    expect(boot).toContain("import { startPredictionRuntime } from '../obd/predictionRuntime'");
    expect(boot).toMatch(/this\._reg\(startPredictionRuntime\(\)\)/);
  });

  it('koşucu MOTORU değiştirmez — yalnız çağırır', () => {
    const rt = stripComments(read('src/platform/obd/predictionRuntime.ts'));
    expect(rt).toMatch(/predict\(buf, DEFAULT_PREDICTION_RULES\[kind\], value\)/);
    /* Eşikleri yeniden tanımlamak ikinci otorite olurdu. */
    expect(rt).not.toMatch(/MIN_FIT_QUALITY\s*=/);
    expect(rt).not.toMatch(/threshold:\s*\d/);
  });
});

describe('predictionRuntime › LAB gözlem ekranı (V-09 ZORUNLU)', () => {
  it('katalog AVAILABLE ve gerçek ekran eşlemesi var', async () => {
    const { getCarosLabTool } = await import('../platform/devtools/carosLabCatalog');
    const { renderAvailableTool } = await import('../components/devtools/carosLabScreenMap');
    expect(getCarosLabTool('prediction-engine')?.status).toBe('AVAILABLE');
    expect(renderAvailableTool('prediction-engine')).not.toBeNull();
  });

  it('üç durum AYRI sınıflandırılır', async () => {
    const { buildRuleRows } = await import('../platform/devtools/predictionModel');
    const rules = [
      { kind: 'overheat', severity: 'critical', threshold: 110, horizonMin: 10, direction: 'up', unit: '°C', title: 'Aşırı ısınma' },
      { kind: 'oil_pressure_drop', severity: 'critical', threshold: 100, horizonMin: 10, direction: 'down', unit: 'kPa', title: 'Yağ basıncı' },
    ];
    const rows = buildRuleRows({
      runtime: {
        running: true, taskId: 'x', periodMs: 15000, criticality: 'SAFETY',
        minSamples: 5, maxSamples: 40, tickCount: 3, lastTickAtMs: 1,
        sampleCounts: { overheat: 2 },
        predictions: {},
        skippedStale: 0, skippedMissing: 0, clearCount: 0,
        rulesWithoutSource: ['oil_pressure_drop'],
      },
      rules, minSamples: 5, minFitQuality: 0.6, nowMs: 2,
    } as never);

    expect(rows.find((r) => r.kind === 'overheat')?.state).toBe('INSUFFICIENT');
    expect(rows.find((r) => r.kind === 'oil_pressure_drop')?.state).toBe('NO_SOURCE');
  });

  it('koşucu okunamazsa "çalışmıyor" ile KARIŞTIRILMAZ', async () => {
    const { derivePredictionVerdict, buildRuntimeFields } =
      await import('../platform/devtools/predictionModel');
    const input = { runtime: null, rules: [], minSamples: 5, minFitQuality: 0.6, nowMs: 1 };
    expect(derivePredictionVerdict(input as never)).toBe('UNAVAILABLE');
    expect(buildRuntimeFields(input as never)[0].note).toMatch(/KARIŞTIRILMAZ/);
  });

  it('ekran ve saf model sözleşmesi korunur', () => {
    const model = stripComments(read('src/platform/devtools/predictionModel.ts'));
    expect(model).not.toMatch(/Date\.now\(/);
    expect(model).not.toMatch(/setInterval|setTimeout/);

    const screen = read('src/components/devtools/screens/PredictionEngineScreen.tsx');
    expect(screen).not.toMatch(/setInterval\(/);
    expect(screen).toContain('mountedRef');
    /* Ekran koşucuya DOKUNAMAZ. */
    expect(stripComments(screen)).not.toMatch(/startPredictionRuntime|stopPredictionRuntime|_tickForTest/);
  });
});
