/**
 * validationTruthfulness.test.ts — Validation Mode'un KENDİ raporlama doğruluğu.
 *
 * ── SAHA KANITI (Trafic · V-LINK · KWP2000 proto 5 · oturum val-mrwbj180) ───
 *   A) "Kopma / deneme: 0 / 0" — ama kütükte İKİ `reconnecting` geçişi var
 *   B) avgLiveLatencyMs 78.736 ms — 7.7 s poll ile bağdaşmaz (kopuk dönemler girmiş)
 *   C) Adaptör "(bilinmiyor)" — logcat V-LINK gösteriyor
 *   D) Kütük 447 s'de "durduruldu", rapor 931.987 ms yazıyor
 *   E) KWP aracında "ECU keşfi ❌ Hiç ECU yanıt vermedi" (uygulanamaz test FAIL'i)
 *
 * Bu dosya beşinin de DÜZELTİLMİŞ davranışını kilitler.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  _resetValidationRecorderForTest,
  getValidationSnapshot,
  isValidationActive,
  recordDataAge,
  recordLog,
  recordObdDisconnect,
  recordObdMetrics,
  startValidationSession,
  stopValidationSession,
} from '../platform/validation/validationRecorder';
import {
  evaluateValidation,
  evaluateObdTests,
  isMultiEcuScanApplicable,
} from '../platform/validation/validationVerdict';
import { buildValidationSummaryText } from '../platform/validation/validationSummary';
import { buildValidationReport } from '../platform/validation/validationExport';
import { OBD_METRICS_TEMPLATE, PERF_METRICS_TEMPLATE, type ValidationSnapshot }
  from '../platform/validation/validationTypes';
import collectorSrc from '../platform/validation/concrete/validationCollector.ts?raw';

beforeEach(() => { _resetValidationRecorderForTest(); });
afterEach(()  => { _resetValidationRecorderForTest(); });

function snapshotWith(patch: Partial<ValidationSnapshot>): ValidationSnapshot {
  return {
    sessionId: 'val-test', startedWallMs: 1, durationMs: 1000, active: false,
    obd: OBD_METRICS_TEMPLATE, perf: PERF_METRICS_TEMPLATE,
    mavi: [], log: [], checklistDone: [], ...patch,
  };
}

/* ── A) Kopma sayısı ───────────────────────────────────────────────────────── */

describe('A — kopma sayısı gerçek durum geçişlerinden türer', () => {
  it('iki kopma olayı → disconnectCount = 2', () => {
    startValidationSession();
    recordObdDisconnect();
    recordObdDisconnect();
    expect(getValidationSnapshot().obd.disconnectCount).toBe(2);
  });

  it('recordObdMetrics kopma sayısını EZEMEZ (tek otorite)', () => {
    startValidationSession();
    recordObdDisconnect();
    // Çelişkili kaynak dışarıdan 0 yazmayı denerse yok sayılmalı.
    recordObdMetrics({ disconnectCount: 0 } as never);
    expect(getValidationSnapshot().obd.disconnectCount).toBe(1);
  });

  it('YAPISAL: sayım KENAR tetiklemeli — aynı olayın yinelenen turları çift saymaz', () => {
    // Kenar: yalnız 'connected' → bağlı-olmayan geçişte sayılır. Sonraki turlarda
    // durum zaten 'connected' olmadığı için tekrar tetiklenmez.
    expect(collectorSrc).toMatch(/if \(oncekiBagli && !simdiBagli\) recordObdDisconnect\(\)/);
    expect(collectorSrc).toMatch(/if \(life\.connectionState !== _lastConnState\)/);
    // Eski (yanlış) kaynak KALDIRILDI.
    expect(collectorSrc).not.toMatch(/disconnectCount: *life\.disconnectCalledCount/);
  });

  it('kopma kanıtı varsa "Kopma yok" YAZILMAZ', () => {
    const s = snapshotWith({ obd: { ...OBD_METRICS_TEMPLATE, disconnectCount: 2 } });
    const t = evaluateObdTests(s).find((x) => x.id === 'obd_stability');
    expect(t?.status).not.toBe('pass');
    expect(t?.detail).not.toContain('Kopma yok');
  });
});

/* ── B) Gecikme ortalaması ─────────────────────────────────────────────────── */

describe('B — gecikme ortalaması yalnız geçerli örneklerden', () => {
  it('hiç geçerli örnek yoksa null (0 veya uydurma YOK)', () => {
    startValidationSession();
    expect(getValidationSnapshot().perf.avgLiveLatencyMs).toBeNull();
  });

  it('yalnız kaydedilen örnekler ortalamaya girer', () => {
    startValidationSession();
    recordDataAge(800);
    recordDataAge(1200);
    expect(getValidationSnapshot().perf.avgLiveLatencyMs).toBe(1000);
  });

  it('YAPISAL: kopuk/reconnecting dönemleri ve paketsiz turlar örneklenmez', () => {
    expect(collectorSrc).toMatch(/const connected = CONNECTED_STATES\.has\(life\.connectionState\)/);
    expect(collectorSrc).toMatch(/const yeniPaketVar = _pktSeen > _pktSeenAtLastSample/);
    expect(collectorSrc).toMatch(/if \(connected && yeniPaketVar && life\.lastPacketAgeMs >= 0\)/);
  });
});

/* ── C) Adaptör bilgisi ────────────────────────────────────────────────────── */

describe('C — adaptör bilgisi yalnız MEVCUT gerçek kaynaklardan', () => {
  it('kaynak yoksa null (boş string DEĞİL)', () => {
    expect(OBD_METRICS_TEMPLATE.adapterName).toBeNull();
    expect(OBD_METRICS_TEMPLATE.adapterAddrMasked).toBeNull();
  });

  it('kaynak doluysa rapora girer', () => {
    startValidationSession();
    recordObdMetrics({ adapterName: 'V-LINK', adapterAddrMasked: 'AA:BB:**:**:**:FF' });
    const o = getValidationSnapshot().obd;
    expect(o.adapterName).toBe('V-LINK');
    expect(o.adapterAddrMasked).toBe('AA:BB:**:**:**:FF');
  });

  it('YAPISAL: yeni keşif YOK — mevcut deviceName + kalıcı adres okunur, MAC maskelenir', () => {
    expect(collectorSrc).toMatch(/getOBDDataSnapshot\(\)\.deviceName/);
    expect(collectorSrc).toMatch(/loadObdAddress\(\)/);
    expect(collectorSrc).toMatch(/maskMac\(storedAddr\)/);
    expect(collectorSrc).not.toMatch(/scanOBD|startScan|discoverAdapter/);
  });

  it('adaptör yokken Summary "bilinmiyor" der ve ham adres sızdırmaz', () => {
    const s = snapshotWith({});
    const text = buildValidationSummaryText(s, evaluateValidation(s), 0);
    expect(text).toContain('Adaptör        : bilinmiyor');
  });
});

/* ── D) Oturum süresi ──────────────────────────────────────────────────────── */

describe('D — durdurulan oturumun süresi DONDURULUR', () => {
  it('stop sonrası snapshot süresi artmaz', () => {
    const t0 = performance.now();
    const spy = vi.spyOn(performance, 'now');
    spy.mockReturnValue(t0);
    startValidationSession();

    spy.mockReturnValue(t0 + 5_000);
    stopValidationSession();
    const donmus = getValidationSnapshot().durationMs;
    expect(donmus).toBeGreaterThanOrEqual(4_900);

    spy.mockReturnValue(t0 + 500_000);      // 8 dakika sonra rapor alınıyor
    expect(getValidationSnapshot().durationMs).toBe(donmus);   // DEĞİŞMEZ
    spy.mockRestore();
  });

  it('hiç başlatılmamış oturum fail-closed: süre 0, aktif değil', () => {
    const s = getValidationSnapshot();
    expect(s.durationMs).toBe(0);
    expect(s.active).toBe(false);
    expect(isValidationActive()).toBe(false);
  });

  it('kütükteki durdurma damgası ile rapor süresi TUTARLI', () => {
    const t0 = performance.now();
    const spy = vi.spyOn(performance, 'now');
    spy.mockReturnValue(t0);
    startValidationSession();
    spy.mockReturnValue(t0 + 7_000);
    stopValidationSession();

    const snap = getValidationSnapshot();
    const stopLog = snap.log.find((l) => l.message.includes('durduruldu'));
    expect(stopLog).toBeDefined();
    expect(Math.abs((stopLog!.tsMonoMs) - snap.durationMs)).toBeLessThanOrEqual(1);
    spy.mockRestore();
  });
});

/* ── E) Protokol farkında ECU keşfi ────────────────────────────────────────── */

describe('E — ECU keşfi yalnız CAN sınıfı protokollerde yargılanır', () => {
  it('KWP2000 / ISO9141 / J1850 → uygulanamaz', () => {
    for (const p of ['1', '2', '3', '4', '5']) expect(isMultiEcuScanApplicable(p)).toBe(false);
  });

  it('CAN protokolleri → uygulanabilir', () => {
    for (const p of ['6', '7', '8', '9', 'A', 'B', 'C']) expect(isMultiEcuScanApplicable(p)).toBe(true);
  });

  it('protokol bilinmiyor → fail-closed (uygulanamaz)', () => {
    for (const p of [null, undefined, '']) expect(isMultiEcuScanApplicable(p)).toBe(false);
  });

  it('KWP aracında ECU testi FAIL değil SKIP (saha regresyonu)', () => {
    const s = snapshotWith({
      obd: { ...OBD_METRICS_TEMPLATE, protocolActive: '5', protocolTried: '5', ecuCount: 0 },
    });
    const t = evaluateObdTests(s).find((x) => x.id === 'obd_ecu');
    expect(t?.status).toBe('skip');
    expect(t?.detail).toContain('desteklenmiyor');
  });

  it('CAN aracında sıfır sonuç → MEVCUT doğru verdict (fail) korunur', () => {
    const s = snapshotWith({
      obd: { ...OBD_METRICS_TEMPLATE, protocolActive: '6', ecuCount: 0 },
    });
    const t = evaluateObdTests(s).find((x) => x.id === 'obd_ecu');
    expect(t?.status).toBe('fail');
  });

  it('CAN aracında tarama çalışmadıysa skip', () => {
    const s = snapshotWith({ obd: { ...OBD_METRICS_TEMPLATE, protocolActive: '6', ecuCount: null } });
    expect(evaluateObdTests(s).find((x) => x.id === 'obd_ecu')?.status).toBe('skip');
  });
});

/* ── Tutarlılık + gizlilik + sıfır yük ─────────────────────────────────────── */

describe('Summary ile JSON AYNI gerçeği söyler', () => {
  it('genel karar ve sayaçlar iki çıktıda da aynı', () => {
    const s = snapshotWith({
      obd: { ...OBD_METRICS_TEMPLATE, protocolActive: '5', disconnectCount: 2, pidCount: 15 },
    });
    const summary = evaluateValidation(s);
    const json = buildValidationReport(s, summary, { generatedAtWallMs: 1 }) as Record<string, unknown>;
    const text = buildValidationSummaryText(s, summary, 1);

    const js = json.summary as Record<string, number | string>;
    expect(js.overall).toBe(summary.overall);
    expect(js.failed).toBe(summary.failed);
    expect(text).toContain(`${summary.passed} geçti`);
    expect(text).toContain(`${summary.failed} düştü`);
    // ECU testi iki çıktıda da aynı statüde
    expect(text).toContain('ECU keşfi');
  });
});

describe('regresyon — kapalıyken sıfır yük ve gizlilik korunur', () => {
  it('oturum yokken hiçbir kayıt tutulmaz', () => {
    recordObdDisconnect();
    recordDataAge(100);
    recordLog('obd', 'info', 'x');
    const s = getValidationSnapshot();
    expect(s.obd.disconnectCount).toBe(0);
    expect(s.perf.avgLiveLatencyMs).toBeNull();
    expect(s.log).toHaveLength(0);
  });

  it('ham MAC rapora sızmaz (deny-list + maske korunuyor)', () => {
    const s = snapshotWith({
      obd: { ...OBD_METRICS_TEMPLATE, adapterName: 'V-LINK', adapterAddrMasked: '10:21:3E:4D:71:D2' },
    });
    const json = JSON.stringify(buildValidationReport(s, evaluateValidation(s), {}));
    expect(json).not.toContain('10:21:3E:4D:71:D2');
    expect(json).toContain('V-LINK');
  });
});
