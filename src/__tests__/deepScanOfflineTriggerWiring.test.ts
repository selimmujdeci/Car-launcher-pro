/**
 * deepScanOfflineTriggerWiring.test.ts — W5-3b "Offline Pass Trigger + Runtime Wiring +
 * Minimal Diagnostics" kilitleri.
 *
 * KAPSAM: `runOfflinePass()` İLK kez üretim wiring'ine bağlanır — tek deterministik giriş
 * noktası (`triggerDeepScanOfflinePass`) hash/dedup guard'ıyla EN FAZLA bir kez pass başlatır.
 * HANDLER YOK → gerçek iş yapılmaz → üretim davranışı DEĞİŞMEZ; runtime idle→running→idle.
 *
 * Test izolasyonu: DI ile fake orchestrator (dedup/duplicate/cancel/timeout/diagnostics) VEYA
 * gerçek runtime+persistence+orchestrator (idle→running→idle, reset, aktif-kayıt yok). Her test
 * kendi wiring'ini kurar ve afterEach ile söker (modül singleton temizliği).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  startPlatformCoreDeepScanWiring,
  triggerDeepScanOfflinePass,
  cancelDeepScanOfflinePass,
  getDeepScanOfflinePassStatus,
  DEEP_SCAN_OFFLINE_TRIGGER_KEY,
  type DeepScanWiringDeps,
  type OwnedOrchestrator,
} from '../platform/system/platformCoreDeepScanWiring';
import {
  DeepScanRuntimeService,
  DeepScanPersistenceStore,
  type OrchestratorSnapshot,
  type OfflinePassInput,
  type OfflinePassSummary,
  type DeepScanOrchestratorDeps,
  type DeepScanStoreIO,
} from '../platform/deepScan';

const SRC_DIR = join(process.cwd(), 'src');
const WIRING_SRC = readFileSync(join(SRC_DIR, 'platform', 'system', 'platformCoreDeepScanWiring.ts'), 'utf8');
const SYSTEMBOOT_SRC = readFileSync(join(SRC_DIR, 'platform', 'system', 'SystemBoot.ts'), 'utf8');

/* ── Fake orchestrator (offline yüzey) ───────────────────────────────────────── */

function snap(over: Partial<OrchestratorSnapshot> = {}): OrchestratorSnapshot {
  return {
    status: 'idle', mode: null, currentPhase: null, currentPhaseIndex: 0, totalPhases: 12,
    progressPercent: 0, runtimeStatus: 'idle', reportSummary: null, warnings: [], ...over,
  };
}

function makeSummary(over: Partial<OfflinePassSummary> = {}): OfflinePassSummary {
  return Object.freeze({
    ran: true, blockedReason: null, mode: null, phaseCount: 6,
    successCount: 0, skippedCount: 6, errorCount: 0, cancelled: false,
    outcomes: Object.freeze([]), changedFirmware: false, changedEcu: false,
    warnings: Object.freeze([]), startedAt: 0, completedAt: 0, durationMs: 0, ...over,
  });
}

function fakeOrch(opts: {
  runImpl?: (i?: OfflinePassInput) => Promise<OfflinePassSummary>;
  snapshot?: OrchestratorSnapshot;
} = {}) {
  let disposed = false;
  let disposeCalls = 0;
  const runOfflinePass = vi.fn((i?: OfflinePassInput) =>
    opts.runImpl ? opts.runImpl(i) : Promise.resolve(makeSummary()));
  const cancelOfflinePass = vi.fn(() => { /* no-op */ });
  return {
    getSnapshot: () => opts.snapshot ?? snap(),
    runOfflinePass,
    cancelOfflinePass,
    dispose: () => { disposed = true; disposeCalls++; },
    get isDisposed() { return disposed; },
    get disposeCalls() { return disposeCalls; },
  };
}

function fakeShared() { return { dispose: vi.fn() }; }
function fakeIgnition() { return { dispose: vi.fn(), getConfirmedValue: () => null }; }

function mkDeps(over: {
  orchestrator?: ReturnType<typeof fakeOrch>;
  factory?: (d: DeepScanOrchestratorDeps) => OwnedOrchestrator;
  now?: () => number;
} = {}): DeepScanWiringDeps {
  const orch = over.orchestrator ?? fakeOrch();
  return {
    runtime: fakeShared() as unknown as DeepScanWiringDeps['runtime'],
    persistence: fakeShared() as unknown as DeepScanWiringDeps['persistence'],
    ignitionSource: fakeIgnition() as unknown as DeepScanWiringDeps['ignitionSource'],
    createOrchestrator: over.factory ?? ((_d: DeepScanOrchestratorDeps) => orch),
    now: over.now ?? (() => 1000),
  };
}

/* ── Gerçek zincir (runtime davranışı) ──────────────────────────────────────── */

function memIO() {
  const map = new Map<string, string>();
  const io: DeepScanStoreIO = {
    read: (k) => map.get(k) ?? null,
    write: (k, v) => { map.set(k, v); },
    remove: (k) => { map.delete(k); },
  };
  return { io, map };
}

function realDeps(now: () => number): { deps: DeepScanWiringDeps; runtime: DeepScanRuntimeService } {
  const runtime = new DeepScanRuntimeService({ now });
  const persistence = new DeepScanPersistenceStore('k-w53b', 16, 5000, memIO().io, now);
  // createOrchestrator verilmez → gerçek createDeepScanOrchestrator kullanılır.
  return { deps: { runtime, persistence, now }, runtime };
}

const _open: Array<() => void> = [];
function start(deps: DeepScanWiringDeps) {
  const c = startPlatformCoreDeepScanWiring(deps);
  _open.push(c);
  return c;
}
afterEach(() => { while (_open.length) { try { _open.pop()!(); } catch { /* */ } } });

/* ═══════════════════════════════════════════════════════════════════════
 * 1-4) Trigger · duplicate · hash guard · tek pass
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3b — trigger + dedup guard', () => {
  it('1) trigger runOfflinePass’i çağırır ve özet döner', async () => {
    const orch = fakeOrch();
    start(mkDeps({ orchestrator: orch }));

    const summary = await triggerDeepScanOfflinePass();

    expect(orch.runOfflinePass).toHaveBeenCalledTimes(1);
    expect(summary?.ran).toBe(true);
    const st = getDeepScanOfflinePassStatus();
    expect(st.started).toBe(true);
    expect(st.triggerCount).toBe(1);
  });

  it('2) DUPLICATE yok: aynı guard ikinci tetik pass BAŞLATMAZ (no-op null)', async () => {
    const orch = fakeOrch();
    start(mkDeps({ orchestrator: orch }));

    const first = await triggerDeepScanOfflinePass();
    const second = await triggerDeepScanOfflinePass();

    expect(orch.runOfflinePass).toHaveBeenCalledTimes(1);   // tek pass
    expect(first?.ran).toBe(true);
    expect(second).toBeNull();                               // dedup → no-op
    expect(getDeepScanOfflinePassStatus().triggerCount).toBe(1);
  });

  it('3) HASH GUARD: aynı anahtar dedup edilir; anahtar değişirse tekrar tetiklenebilir', async () => {
    const orch = fakeOrch();
    start(mkDeps({ orchestrator: orch }));

    await triggerDeepScanOfflinePass({ triggerKey: 'k1' });
    const dup = await triggerDeepScanOfflinePass({ triggerKey: 'k1' });   // aynı → dedup
    const other = await triggerDeepScanOfflinePass({ triggerKey: 'k2' }); // farklı → tetiklenir

    expect(dup).toBeNull();
    expect(other?.ran).toBe(true);
    expect(orch.runOfflinePass).toHaveBeenCalledTimes(2);
  });

  it('4) TEK PASS: varsayılan boot anahtarı ile tekrar tekrar tetik → tek çalışma', async () => {
    const orch = fakeOrch();
    start(mkDeps({ orchestrator: orch }));

    await triggerDeepScanOfflinePass();
    await triggerDeepScanOfflinePass();
    await triggerDeepScanOfflinePass({ triggerKey: DEEP_SCAN_OFFLINE_TRIGGER_KEY });

    expect(orch.runOfflinePass).toHaveBeenCalledTimes(1);
  });

  it('4b) SINGLE-FLIGHT: yürüyen pass varken ikinci tetik reddedilir', async () => {
    let release!: (s: OfflinePassSummary) => void;
    const gate = new Promise<OfflinePassSummary>((r) => { release = r; });
    const orch = fakeOrch({ runImpl: () => gate });
    start(mkDeps({ orchestrator: orch }));

    const p1 = triggerDeepScanOfflinePass({ triggerKey: 'x' });
    const p2 = await triggerDeepScanOfflinePass({ triggerKey: 'y' });   // yürüyor → null (farklı key olsa bile)
    expect(p2).toBeNull();
    release(makeSummary());
    await p1;
    expect(orch.runOfflinePass).toHaveBeenCalledTimes(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 5, 18) Runtime yaşam döngüsü — idle→running→idle · reset
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3b — runtime yaşam döngüsü', () => {
  it('5) idle → running → idle (gerçek runtime; pass sonunda reset)', async () => {
    const { deps, runtime } = realDeps(() => 5000);
    start(deps);

    expect(runtime.getSnapshot().status).toBe('idle');
    const summary = await triggerDeepScanOfflinePass();
    expect(summary?.ran).toBe(true);
    // Pass yürüdü (running) ve bitince reset ile idle'a döndü.
    expect(runtime.getSnapshot().status).toBe('idle');
  });

  it('5b) running bayrağı pass boyunca true, bitince false (wiring bookkeeping)', async () => {
    let release!: (s: OfflinePassSummary) => void;
    const gate = new Promise<OfflinePassSummary>((r) => { release = r; });
    const orch = fakeOrch({ runImpl: () => gate });
    start(mkDeps({ orchestrator: orch }));

    const p = triggerDeepScanOfflinePass();
    expect(getDeepScanOfflinePassStatus().running).toBe(true);
    release(makeSummary());
    await p;
    expect(getDeepScanOfflinePassStatus().running).toBe(false);
  });

  it('18) runtime RESET: pass sonrası scanId null, progress 0 (gerçek runtime)', async () => {
    const { deps, runtime } = realDeps(() => 7000);
    start(deps);
    await triggerDeepScanOfflinePass();

    const s = runtime.getSnapshot();
    expect(s.status).toBe('idle');
    expect(s.scanId).toBeNull();
    expect(s.progressPercent).toBe(0);
  });

  it('10) RESTART: dispose → yeniden start → trigger yine çalışır (guard sıfırlanır)', async () => {
    const orch1 = fakeOrch();
    const c1 = start(mkDeps({ orchestrator: orch1 }));
    await triggerDeepScanOfflinePass();
    expect(orch1.runOfflinePass).toHaveBeenCalledTimes(1);
    c1();   // shutdown

    const orch2 = fakeOrch();
    start(mkDeps({ orchestrator: orch2 }));
    const s = await triggerDeepScanOfflinePass();   // yeni boot → guard taze
    expect(s?.ran).toBe(true);
    expect(orch2.runOfflinePass).toHaveBeenCalledTimes(1);
    expect(getDeepScanOfflinePassStatus().triggerCount).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 6-8) Diagnostics — summary · immutable · bounded
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3b — diagnostics', () => {
  it('6) SUMMARY oluşuyor: summaryAvailable, lastResult, phaseCount, lastDuration dolar', async () => {
    let clock = 1000;
    const orch = fakeOrch({ runImpl: async () => { clock += 42; return makeSummary({ phaseCount: 6 }); } });
    start(mkDeps({ orchestrator: orch, now: () => clock }));

    await triggerDeepScanOfflinePass();

    const st = getDeepScanOfflinePassStatus();
    expect(st.summaryAvailable).toBe(true);
    expect(st.lastResult).toBe('ran');
    expect(st.phaseCount).toBe(6);
    expect(st.lastReason).toBeNull();
    expect(st.lastDuration).toBe(42);
    expect(typeof st.lastRun).toBe('number');
  });

  it('6b) blocked pass → lastResult=blocked + lastReason taşınır', async () => {
    const orch = fakeOrch({ runImpl: async () => makeSummary({ ran: false, blockedReason: 'runtime_not_idle', phaseCount: 0 }) });
    start(mkDeps({ orchestrator: orch }));

    await triggerDeepScanOfflinePass();
    const st = getDeepScanOfflinePassStatus();
    expect(st.lastResult).toBe('blocked');
    expect(st.lastReason).toBe('runtime_not_idle');
  });

  it('7) diagnostics IMMUTABLE (frozen)', async () => {
    start(mkDeps());
    await triggerDeepScanOfflinePass();
    expect(Object.isFrozen(getDeepScanOfflinePassStatus())).toBe(true);
    // Kapalıyken de frozen.
    _open.pop()!();
    expect(Object.isFrozen(getDeepScanOfflinePassStatus())).toBe(true);
  });

  it('8) diagnostics BOUNDED: yalnız sabit, primitive alanlar (dizi/nesne payload YOK)', async () => {
    start(mkDeps());
    await triggerDeepScanOfflinePass();
    const st = getDeepScanOfflinePassStatus();
    const keys = Object.keys(st).sort();
    expect(keys).toEqual([
      'active', 'cancelled', 'lastDuration', 'lastError', 'lastReason', 'lastResult',
      'lastRun', 'phaseCount', 'present', 'running', 'started', 'summaryAvailable', 'triggerCount',
    ]);
    for (const v of Object.values(st)) {
      const ok = v === null || ['number', 'boolean', 'string'].includes(typeof v);
      expect(ok).toBe(true);   // hiçbir alan dizi/nesne DEĞİL
    }
  });

  it('23) import yan etkisiz: hiç start edilmeden status IDLE (present=false)', () => {
    const st = getDeepScanOfflinePassStatus();
    expect(st.present).toBe(false);
    expect(st.started).toBe(false);
    expect(st.running).toBe(false);
    expect(st.triggerCount).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 9) Wiring dispose · ownership
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3b — dispose & ownership', () => {
  it('9) cleanup owned orchestrator’ı dispose eder; status present=false', async () => {
    const orch = fakeOrch();
    const c = start(mkDeps({ orchestrator: orch }));
    await triggerDeepScanOfflinePass();
    c();
    expect(orch.disposeCalls).toBe(1);
    expect(getDeepScanOfflinePassStatus().present).toBe(false);
  });

  it('17) OwnedOrchestrator yüzeyi start/run/runNextPhase GÖSTERMEZ (ownership korunur)', () => {
    const i = WIRING_SRC.indexOf('export interface OwnedOrchestrator');
    const iface = WIRING_SRC.slice(i, WIRING_SRC.indexOf('}', i));
    expect(iface).not.toContain('start(');
    expect(iface).not.toContain('run(');
    expect(iface).not.toContain('runNextPhase');
    expect(iface).toContain('runOfflinePass');   // offline yüzey görünür (aktif değil)
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 19-20) cancel · timeout iletimi
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3b — cancel & timeout', () => {
  it('19) cancelDeepScanOfflinePass yürüyen pass’i iptal eder (orchestrator.cancelOfflinePass + status.cancelled)', async () => {
    let release!: (s: OfflinePassSummary) => void;
    const gate = new Promise<OfflinePassSummary>((r) => { release = r; });
    const orch = fakeOrch({ runImpl: () => gate });
    start(mkDeps({ orchestrator: orch }));

    const p = triggerDeepScanOfflinePass();
    cancelDeepScanOfflinePass();
    expect(orch.cancelOfflinePass).toHaveBeenCalledTimes(1);
    expect(getDeepScanOfflinePassStatus().cancelled).toBe(true);

    release(makeSummary({ cancelled: true }));
    await p;
    expect(getDeepScanOfflinePassStatus().cancelled).toBe(true);
  });

  it('19b) cancel wiring/pass yokken güvenli no-op', () => {
    expect(() => cancelDeepScanOfflinePass()).not.toThrow();
  });

  it('20) phaseTimeoutMs pass’a AYNEN iletilir (timeout üst sınırı runOfflinePass’a düşer)', async () => {
    const orch = fakeOrch();
    start(mkDeps({ orchestrator: orch }));

    await triggerDeepScanOfflinePass({ phaseTimeoutMs: 1234 });
    expect(orch.runOfflinePass).toHaveBeenCalledTimes(1);
    const arg = orch.runOfflinePass.mock.calls[0][0] as OfflinePassInput | undefined;
    expect(arg?.phaseTimeoutMs).toBe(1234);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 12-13) Handler yok · aktif discovery yok
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3b — handler kapsamı / aktif discovery yok', () => {
  /**
   * W5-3c-3 GÜNCELLEMESİ (kilit kaldırılmadı — YENİ DOĞRU DAVRANIŞA taşındı):
   * Eskiden `handlers` HİÇ geçilmezdi (W5-3b: "handler yok"). Artık YALNIZ offline
   * `change_detection` handler'ı bağlanır. Kilidin koruduğu asıl invaryant değişmedi:
   * AKTİF faza (araca sorgu gönderen) handler BAĞLANMAZ.
   */
  it('12) trigger runOfflinePass’a YALNIZ change_detection handler’ı geçer (aktif faz YOK)', async () => {
    const orch = fakeOrch();
    start(mkDeps({ orchestrator: orch }));

    await triggerDeepScanOfflinePass();
    const arg = orch.runOfflinePass.mock.calls[0][0] as OfflinePassInput | undefined;
    const handlers = arg?.handlers as Record<string, unknown> | undefined;

    expect(handlers).toBeDefined();
    expect(Object.keys(handlers ?? {})).toEqual(['change_detection']);
    expect(typeof handlers?.change_detection).toBe('function');
    // Aktif fazlar (araca sorgu gönderir) ASLA bağlanmaz:
    for (const active of ['vehicle_identity', 'protocol_detection', 'ecu_discovery',
      'standard_pid_discovery', 'manufacturer_did_discovery', 'firmware_inventory']) {
      expect(handlers?.[active]).toBeUndefined();
    }
  });

  it('13) gerçek zincirde aktif-kayıt API’leri HİÇ çağrılmaz (aktif discovery yok)', async () => {
    const { deps, runtime } = realDeps(() => 9000);
    const ecu = vi.spyOn(runtime, 'recordEcuDiscovery');
    const pid = vi.spyOn(runtime, 'recordPidDiscovery');
    const did = vi.spyOn(runtime, 'recordDidDiscovery');
    const fw = vi.spyOn(runtime, 'recordFirmwareResult');
    start(deps);

    await triggerDeepScanOfflinePass();

    expect(ecu).not.toHaveBeenCalled();
    expect(pid).not.toHaveBeenCalled();
    expect(did).not.toHaveBeenCalled();
    expect(fw).not.toHaveBeenCalled();
    // Keşif sayımları sıfır kalır.
    expect(runtime.getSnapshot().discoveredEcuCount).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 21-22) Privacy · input immutable
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3b — privacy & input immutability', () => {
  it('21) status VIN/GPS/secret/ham CAN-OBD SIZDIRMAZ (yalnız enum/sayım/bayrak)', async () => {
    const orch = fakeOrch({ runImpl: async () => makeSummary() });
    start(mkDeps({ orchestrator: orch }));
    await triggerDeepScanOfflinePass({ triggerKey: 'WDD12345678901234' }); // guard anahtarı bile taşınmamalı

    const blob = JSON.stringify(getDeepScanOfflinePassStatus());
    expect(blob).not.toContain('WDD12345678901234');   // guard anahtarı/VIN benzeri
    expect(blob).not.toMatch(/\d{2}\.\d{4},\s?\d{2}\.\d{4}/); // koordinat
    expect(blob).not.toContain('sk-');                 // secret öneki
  });

  it('22) trigger GİRDİSİ mutate edilmez', async () => {
    start(mkDeps());
    const input = Object.freeze({ triggerKey: 'k9', phaseTimeoutMs: 77 });
    const keys = Object.keys(input);

    await triggerDeepScanOfflinePass(input);

    expect(input.triggerKey).toBe('k9');
    expect(input.phaseTimeoutMs).toBe(77);
    expect(Object.keys(input)).toEqual(keys);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 11, 14-16) SystemBoot entegrasyonu · kapsam kilitleri (kaynak)
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3b — SystemBoot entegrasyonu & kapsam (kaynak kilitleri)', () => {
  it('11) SystemBoot trigger’ı fire-and-forget çağırır (boot’u BLOKLAMAZ, fail-soft)', () => {
    // void + .catch → boot await etmez, throw kaçmaz (boot regresyonu yok).
    expect(SYSTEMBOOT_SRC).toContain('triggerDeepScanOfflinePass');
    expect(SYSTEMBOOT_SRC).toMatch(/void\s+triggerDeepScanOfflinePass\(\)/);
    expect(SYSTEMBOOT_SRC).toContain('SystemBoot:deepScanOfflineTrigger');
  });

  it('16) WAVE SIRASI: trigger, ownership wiring’den SONRA ve Wave 3 içinde', () => {
    const iWiring = SYSTEMBOOT_SRC.indexOf('startPlatformCoreDeepScanWiring(');
    const iTrigger = SYSTEMBOOT_SRC.indexOf('triggerDeepScanOfflinePass(');
    const iWave3 = SYSTEMBOOT_SRC.indexOf('Starting Wave 3');
    const iWave3Ready = SYSTEMBOOT_SRC.indexOf('Wave 3 ready');
    expect(iWiring).toBeGreaterThan(0);
    expect(iTrigger).toBeGreaterThan(iWiring);          // ownership ÖNCE (Wave 2), trigger SONRA
    expect(iTrigger).toBeGreaterThan(iWave3);           // Wave 3 içinde
    expect(iTrigger).toBeLessThan(iWave3Ready);
  });

  it('14) EventBus mimarisi değişmedi: wiring Event Bus import ETMEZ / publish YOK', () => {
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*eventBus/i);
    expect(WIRING_SRC).not.toContain('appEventBus');
    expect(WIRING_SRC).not.toContain('.publish(');
  });

  it('15) Capability/HAL/Assistant/native-OBD-CAN import EDİLMEZ', () => {
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*capability/i);
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*assistant/i);
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*vehicleHal/i);
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*(obdService|canbus|nativePlugin|supabase)/i);
  });

  it('kapsam: aktif tarama API’leri (start/run/runNextPhase/startScan) wiring KAYNAĞINDA çağrılmaz', () => {
    expect(WIRING_SRC).not.toMatch(/\.start\s*\(/);
    expect(WIRING_SRC).not.toMatch(/\.run\s*\(/);
    expect(WIRING_SRC).not.toMatch(/\.runNextPhase\s*\(/);
    expect(WIRING_SRC).not.toContain('.startScan(');
    // Yeni timer/polling YOK (offline pass timeout'u orchestrator'ın içinde, wiring'de değil).
    expect(WIRING_SRC).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });
});
