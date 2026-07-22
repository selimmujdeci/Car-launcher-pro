/**
 * Saha Doğrulama Modu (Validation Mode) — birim + regresyon testleri.
 *
 * Kilitlenen davranışlar:
 *  1. Şalter VARSAYILAN KAPALI (fail-closed) ve yalnız tam "true" açar.
 *  2. Oturum kapalıyken KAYIT YOK — "sıfır ek yük" sözleşmesi.
 *  3. Ring buffer'lar BOUNDED (bellek şişmez).
 *  4. Karar katmanı SAF: ölçülmedi → `skip` (uydurma yok), tek `fail` → genel `fail`.
 *  5. Export gizlilik kapısı: ham VIN / MAC / koordinat / token ÇIKMAZ.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  VALIDATION_LOCAL_FLAG,
  isValidationModeEnabled,
  setValidationModeEnabled,
} from '../platform/validation/validationFlag';
import {
  MAX_LOG_ENTRIES,
  MAX_MAVI_RECORDS,
  _resetValidationRecorderForTest,
  getValidationSnapshot,
  isValidationActive,
  meanOrNull,
  recordDataAge,
  recordFpsSample,
  recordLivePacket,
  recordLog,
  recordMaviRun,
  recordMemorySample,
  recordObdMetrics,
  recordPerfCounters,
  registerValidationDisposer,
  startValidationSession,
  stopValidationSession,
  subscribeValidation,
} from '../platform/validation/validationRecorder';
import {
  evaluateValidation,
  evaluateMaviTests,
  FPS_OK,
  MEM_WARN_MB,
  PID_OK_MIN,
  POLL_OK_MS,
} from '../platform/validation/validationVerdict';
import {
  buildValidationReport,
  maskSensitiveText,
  maskVin,
  sanitizeValue,
  serializeValidationReport,
} from '../platform/validation/validationExport';
import {
  OBD_METRICS_TEMPLATE,
  PERF_METRICS_TEMPLATE,
  type MaviValidationInput,
  type ValidationSnapshot,
} from '../platform/validation/validationTypes';

/* ── Yardımcılar ───────────────────────────────────────────────────────────── */

const MAVI_INPUT: MaviValidationInput = {
  intentKind: 'operator_task',
  operatorTask: 'health_check',
  plannerUsed: true,
  toolCalls: 2,
  mechanicUsed: true,
  knowledgeUsed: false,
  memoryUsed: false,
  vehicleContextUsed: true,
  durationMs: 1_200,
  ok: true,
  errorKind: null,
};

function snapshotWith(patch: Partial<ValidationSnapshot>): ValidationSnapshot {
  return {
    sessionId: 'val-test',
    startedWallMs: 1_700_000_000_000,
    durationMs: 10_000,
    active: true,
    obd: OBD_METRICS_TEMPLATE,
    perf: PERF_METRICS_TEMPLATE,
    mavi: [],
    log: [],
    ...patch,
  };
}

beforeEach(() => {
  try { localStorage.removeItem(VALIDATION_LOCAL_FLAG); } catch { /* yoksay */ }
  _resetValidationRecorderForTest();
});

afterEach(() => {
  _resetValidationRecorderForTest();
  try { localStorage.removeItem(VALIDATION_LOCAL_FLAG); } catch { /* yoksay */ }
});

/* ── 1) Şalter ─────────────────────────────────────────────────────────────── */

describe('validationFlag — fail-closed şalter', () => {
  it('varsayılan KAPALI', () => {
    expect(isValidationModeEnabled()).toBe(false);
  });

  it('YALNIZ tam "true" açar — "1"/"yes"/bozuk değer AÇMAZ', () => {
    for (const bad of ['1', 'yes', 'TRUE', 'true ', '', '{}']) {
      localStorage.setItem(VALIDATION_LOCAL_FLAG, bad);
      expect(isValidationModeEnabled()).toBe(false);
    }
    localStorage.setItem(VALIDATION_LOCAL_FLAG, 'true');
    expect(isValidationModeEnabled()).toBe(true);
  });

  it('setter yerel kaldıracı yazar ve siler', () => {
    setValidationModeEnabled(true);
    expect(isValidationModeEnabled()).toBe(true);
    setValidationModeEnabled(false);
    expect(isValidationModeEnabled()).toBe(false);
  });
});

/* ── 2) Sıfır ek yük ───────────────────────────────────────────────────────── */

describe('validationRecorder — oturum kapalıyken SIFIR ek yük', () => {
  it('oturum başlamadan hiçbir kayıt tutulmaz', () => {
    expect(isValidationActive()).toBe(false);

    recordLog('obd', 'info', 'düşmeli');
    recordObdMetrics({ pidCount: 42 });
    recordLivePacket();
    recordDataAge(100);
    recordFpsSample(60);
    recordMemorySample(120);
    recordPerfCounters(5, 3);
    recordMaviRun(MAVI_INPUT);

    const snap = getValidationSnapshot();
    expect(snap.log).toHaveLength(0);
    expect(snap.mavi).toHaveLength(0);
    expect(snap.obd.pidCount).toBe(0);
    expect(snap.perf.liveDataSamples).toBe(0);
    expect(snap.perf.avgFps).toBeNull();
    expect(snap.perf.timeoutCount).toBe(0);
  });

  it('oturum durdurulunca yeni kayıt kabul edilmez, toplanan veri OKUNABİLİR kalır', () => {
    startValidationSession();
    recordObdMetrics({ pidCount: 12 });
    stopValidationSession();

    recordObdMetrics({ pidCount: 99 });
    const snap = getValidationSnapshot();
    expect(snap.obd.pidCount).toBe(12);       // durdurma sonrası yazım YOK
    expect(snap.active).toBe(false);
  });

  it('stopValidationSession kayıtlı disposer\'ları çalıştırır (zero-leak)', () => {
    startValidationSession();
    let disposed = false;
    registerValidationDisposer(() => { disposed = true; });
    stopValidationSession();
    expect(disposed).toBe(true);
  });
});

/* ── 3) Kayıt davranışı ────────────────────────────────────────────────────── */

describe('validationRecorder — kayıt ve sınırlar', () => {
  it('oturum açıkken kaydeder ve aboneyi tetikler', () => {
    let hits = 0;
    const off = subscribeValidation(() => { hits++; });

    startValidationSession();
    recordLog('obd', 'warn', 'test satırı');
    recordMaviRun(MAVI_INPUT);

    const snap = getValidationSnapshot();
    expect(snap.active).toBe(true);
    expect(snap.sessionId).toMatch(/^val-/);
    expect(snap.log.some((e) => e.message === 'test satırı')).toBe(true);
    expect(snap.mavi).toHaveLength(1);
    expect(snap.mavi[0].id).toBe('mavi-0');
    expect(hits).toBeGreaterThan(0);

    off();
  });

  it('kütük ve Mavi kayıtları BOUNDED (ring buffer taşmaz)', () => {
    startValidationSession();
    for (let i = 0; i < MAX_LOG_ENTRIES + 50; i++) recordLog('system', 'info', `satır ${i}`);
    for (let i = 0; i < MAX_MAVI_RECORDS + 20; i++) recordMaviRun(MAVI_INPUT);

    const snap = getValidationSnapshot();
    expect(snap.log).toHaveLength(MAX_LOG_ENTRIES);
    expect(snap.mavi).toHaveLength(MAX_MAVI_RECORDS);
  });

  it('imkânsız örnekler REDDEDİLİR (sensor resiliency)', () => {
    startValidationSession();
    recordDataAge(-5);
    recordFpsSample(0);
    recordFpsSample(Number.NaN);
    recordMemorySample(-1);

    const snap = getValidationSnapshot();
    expect(snap.perf.avgLiveLatencyMs).toBeNull();
    expect(snap.perf.avgFps).toBeNull();
    expect(snap.perf.memoryUsedMb).toBeNull();
  });

  it('meanOrNull: örnek yoksa null (uydurma yok)', () => {
    expect(meanOrNull(0, 0)).toBeNull();
    expect(meanOrNull(300, 3)).toBe(100);
  });

  it('recordMaviRun kullanıcı metni taşımaz — yalnız jeton ve sayılar', () => {
    startValidationSession();
    recordMaviRun({ ...MAVI_INPUT, ok: false, errorKind: 'timeout' });
    const rec = getValidationSnapshot().mavi[0];

    // Alan kümesi SABİT (hidden class kararlılığı + sızıntı kapısı):
    // yeni bir alan eklenirse bu kilit düşer ve gizlilik gözden geçirilir.
    expect(Object.keys(rec).sort()).toEqual([
      'durationMs', 'errorKind', 'id', 'intentKind', 'knowledgeUsed',
      'mechanicUsed', 'memoryUsed', 'ok', 'operatorTask', 'plannerUsed',
      'toolCalls', 'tsMonoMs', 'vehicleContextUsed',
    ]);

    expect(rec).not.toHaveProperty('prompt');
    expect(rec).not.toHaveProperty('userText');
    expect(rec).not.toHaveProperty('text');
    expect(rec.errorKind).toBe('timeout');
  });
});

/* ── 4) Karar katmanı (SAF) ────────────────────────────────────────────────── */

describe('validationVerdict — saf karar', () => {
  it('hiç ölçüm yoksa yargı YOK: ölçülemeyenler skip', () => {
    const summary = evaluateValidation(snapshotWith({}));
    const byId = Object.fromEntries(summary.tests.map((t) => [t.id, t]));

    expect(byId.obd_connection.status).toBe('skip');
    expect(byId.obd_ecu.status).toBe('skip');
    expect(byId.obd_dtc.status).toBe('skip');
    expect(byId.perf_poll.status).toBe('skip');
    expect(byId.perf_fps.status).toBe('skip');
    expect(byId.mavi_success.status).toBe('skip');
  });

  it('DTC=0 okuması BAŞARIDIR (kod yok ≠ okuma yapılmadı)', () => {
    const s = snapshotWith({ obd: { ...OBD_METRICS_TEMPLATE, dtcCount: 0 } });
    const t = evaluateValidation(s).tests.find((x) => x.id === 'obd_dtc');
    expect(t?.status).toBe('pass');
  });

  it('PID eşiği: >=PID_OK_MIN pass · 1..N-1 warn · 0 fail', () => {
    const grade = (pidCount: number) =>
      evaluateValidation(snapshotWith({ obd: { ...OBD_METRICS_TEMPLATE, pidCount } }))
        .tests.find((t) => t.id === 'obd_pid')?.status;

    expect(grade(PID_OK_MIN)).toBe('pass');
    expect(grade(PID_OK_MIN - 1)).toBe('warn');
    expect(grade(0)).toBe('fail');
  });

  it('polling ve bellek eşikleri sınırda doğru sınıflanır', () => {
    const poll = evaluateValidation(snapshotWith({
      perf: { ...PERF_METRICS_TEMPLATE, avgPollIntervalMs: POLL_OK_MS, liveDataSamples: 10 },
    })).tests.find((t) => t.id === 'perf_poll');
    expect(poll?.status).toBe('pass');

    const mem = evaluateValidation(snapshotWith({
      perf: { ...PERF_METRICS_TEMPLATE, memoryPeakMb: MEM_WARN_MB + 1 },
    })).tests.find((t) => t.id === 'perf_memory');
    expect(mem?.status).toBe('fail');

    const fps = evaluateValidation(snapshotWith({
      perf: { ...PERF_METRICS_TEMPLATE, avgFps: FPS_OK, minFps: FPS_OK },
    })).tests.find((t) => t.id === 'perf_fps');
    expect(fps?.status).toBe('pass');
  });

  it('genel karar FAIL-CLOSED: tek bir fail bütün raporu düşürür', () => {
    const s = snapshotWith({
      obd: { ...OBD_METRICS_TEMPLATE, pidCount: 0, dtcCount: 3, vinPresent: true },
    });
    const summary = evaluateValidation(s);
    expect(summary.failed).toBeGreaterThan(0);
    expect(summary.overall).toBe('fail');
  });

  it('Mavi başarı oranı ve süre ortalamadan türer', () => {
    const base = { id: 'mavi-0', tsMonoMs: 0, intentKind: 'operator_task', operatorTask: 'health_check',
      plannerUsed: true, toolCalls: 0, mechanicUsed: false, knowledgeUsed: false,
      memoryUsed: false, vehicleContextUsed: false, errorKind: null };
    const s = snapshotWith({
      mavi: [
        { ...base, durationMs: 1_000, ok: true },
        { ...base, id: 'mavi-1', durationMs: 3_000, ok: true },
      ],
    });
    const tests = evaluateMaviTests(s);
    expect(tests.find((t) => t.id === 'mavi_success')?.status).toBe('pass');
    expect(tests.find((t) => t.id === 'mavi_latency')?.status).toBe('pass');
    expect(tests.find((t) => t.id === 'mavi_latency')?.detail).toContain('2000');
  });

  it('sayaçlar toplamı test sayısına eşittir (sessiz kayıp yok)', () => {
    const summary = evaluateValidation(snapshotWith({}));
    expect(summary.passed + summary.warned + summary.failed + summary.skipped)
      .toBe(summary.tests.length);
  });
});

/* ── 5) Export gizlilik kapısı ─────────────────────────────────────────────── */

describe('validationExport — gizlilik kapısı', () => {
  it('ham VIN maskelenir (yalnız WMI açık)', () => {
    expect(maskVin('VF1FL000012345678')).toBe('VF1**************');
    expect(maskVin(null)).toBeNull();
    expect(maskVin('ABC')).toBe('***');
    // idempotent — maskeli değer tekrar maskelenince bozulmaz
    expect(maskVin(maskVin('VF1FL000012345678'))).toBe('VF1**************');
  });

  it('metindeki VIN / MAC / koordinat / token maskelenir', () => {
    const s = maskSensitiveText(
      'VIN WAUZZZ8V1JA123456 MAC AA:BB:CC:DD:EE:FF konum 41.01234,28.98765 api_key=SECRET123',
    );
    expect(s).not.toContain('WAUZZZ8V1JA123456');
    expect(s).not.toContain('AA:BB:CC:DD:EE:FF');
    expect(s).not.toContain('41.01234,28.98765');
    expect(s).not.toContain('SECRET123');
  });

  it('deny-list anahtarları HER derinlikte düşer', () => {
    const out = sanitizeValue({
      keep: 1,
      vin: 'WAUZZZ8V1JA123456',
      nested: { address: 'AA:BB:CC:DD:EE:FF', prompt: 'kullanıcı metni', ok: true },
      list: [{ token: 'abc', fine: 2 }],
    }) as Record<string, unknown>;

    expect(out.keep).toBe(1);
    expect(out).not.toHaveProperty('vin');
    expect(out.nested).not.toHaveProperty('address');
    expect(out.nested).not.toHaveProperty('prompt');
    expect((out.nested as Record<string, unknown>).ok).toBe(true);
    expect((out.list as Array<Record<string, unknown>>)[0]).not.toHaveProperty('token');
  });

  it('rapor ham VIN taşımaz ve serileştirilebilir', () => {
    const snap = snapshotWith({
      obd: { ...OBD_METRICS_TEMPLATE, vinPresent: true, vinMasked: 'WAUZZZ8V1JA123456' },
      log: [{ id: 'vlog-0', tsMonoMs: 1, tsWallMs: 2, channel: 'obd', level: 'info',
              message: 'adaptör AA:BB:CC:DD:EE:FF bağlandı' }],
    });
    const report = buildValidationReport(snap, evaluateValidation(snap), { generatedAtWallMs: 1 });
    const json = serializeValidationReport(report);

    expect(json).not.toContain('WAUZZZ8V1JA123456');
    expect(json).not.toContain('AA:BB:CC:DD:EE:FF');
    expect(json).toContain('caros.validation.v1');
    expect(JSON.parse(json).obd.vinPresent).toBe(true);
  });

  it('bozuk/döngüsel girdide ASLA throw etmez', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => sanitizeValue(cyclic)).not.toThrow();
    expect(() => serializeValidationReport({ bad: BigInt(1) as unknown as number })).not.toThrow();
  });
});
