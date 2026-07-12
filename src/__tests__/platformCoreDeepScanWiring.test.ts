/**
 * platformCoreDeepScanWiring.test.ts — W5-1 Deep Scan Runtime Ownership Wiring kilitleri.
 *
 * Test izolasyonu: gerçek Deep Scan singleton'ları PAYLAŞILMAZ — fake runtime/persistence/
 * ignition + fake orchestrator fabrikası DI ile her test kendi izole zincirini kurar.
 * Odak: SAHİPLİK + hiçbir tarama/aktif sorgu ÇALIŞMADIĞI + fail-closed + cleanup invaryantları.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  startPlatformCoreDeepScanWiring,
  getDeepScanWiringStatus,
  type DeepScanWiringDeps,
  type OwnedOrchestrator,
} from '../platform/system/platformCoreDeepScanWiring';
import type { OrchestratorSnapshot, DeepScanOrchestratorDeps } from '../platform/deepScan';

/* ── Fake'ler ──────────────────────────────────────────────────────────────── */

function snap(over: Partial<OrchestratorSnapshot> = {}): OrchestratorSnapshot {
  return {
    status: 'idle', mode: null, currentPhase: null, currentPhaseIndex: 0, totalPhases: 12,
    progressPercent: 0, runtimeStatus: 'idle', reportSummary: null, warnings: [], ...over,
  };
}

interface FakeOrchestrator extends OwnedOrchestrator {
  readonly disposeCalls: number;
  readonly start: ReturnType<typeof vi.fn>;
  readonly run: ReturnType<typeof vi.fn>;
  readonly runNextPhase: ReturnType<typeof vi.fn>;
}
function createFakeOrchestrator(opts?: { snapshot?: OrchestratorSnapshot; getSnapshotThrows?: boolean }): FakeOrchestrator {
  let disposed = false;
  let disposeCalls = 0;
  return {
    subscribe: () => () => { /* no-op unsub */ },   // W5-2: OwnedOrchestrator artık subscribe içerir
    getSnapshot: () => { if (opts?.getSnapshotThrows) throw new Error('snap boom'); return opts?.snapshot ?? snap(); },
    dispose: () => { disposeCalls++; disposed = true; },
    get isDisposed() { return disposed; },
    get disposeCalls() { return disposeCalls; },
    start: vi.fn(),
    run: vi.fn(),
    runNextPhase: vi.fn(),
  };
}

interface FakeShared { dispose: ReturnType<typeof vi.fn>; }
function fakeRuntime(): FakeShared & { getSnapshot: () => unknown } {
  return { dispose: vi.fn(), getSnapshot: () => { throw new Error('runtime.getSnapshot çağrılmamalı'); } };
}
function fakePersistence(): FakeShared { return { dispose: vi.fn() }; }
function fakeIgnition(opts?: { confirmed?: boolean | null; throws?: boolean }): FakeShared & { getConfirmedValue: () => boolean | null } {
  return {
    dispose: vi.fn(),
    getConfirmedValue: () => { if (opts?.throws) throw new Error('ign boom'); return opts?.confirmed ?? null; },
  };
}

/** DI helper — fake'leri wiring tiplerine yapısal olarak geçirir. */
function mkDeps(over: Partial<{
  orchestrator: FakeOrchestrator;
  runtime: FakeShared;
  persistence: FakeShared;
  ignition: FakeShared & { getConfirmedValue: () => boolean | null };
  factory: (d: DeepScanOrchestratorDeps) => OwnedOrchestrator;
  factoryThrows: boolean;
  capturedDeps: { value: DeepScanOrchestratorDeps | null };
}> = {}): DeepScanWiringDeps {
  const orch = over.orchestrator ?? createFakeOrchestrator();
  const createOrchestrator = over.factory ?? ((d: DeepScanOrchestratorDeps) => {
    if (over.capturedDeps) over.capturedDeps.value = d;
    if (over.factoryThrows) throw new Error('factory boom');
    return orch;
  });
  return {
    runtime: (over.runtime ?? fakeRuntime()) as unknown as DeepScanWiringDeps['runtime'],
    persistence: (over.persistence ?? fakePersistence()) as unknown as DeepScanWiringDeps['persistence'],
    ignitionSource: (over.ignition ?? fakeIgnition()) as unknown as DeepScanWiringDeps['ignitionSource'],
    createOrchestrator,
    now: () => 1000,
  };
}

const SRC_DIR = join(process.cwd(), 'src');
const WIRING_SRC = readFileSync(join(SRC_DIR, 'platform', 'system', 'platformCoreDeepScanWiring.ts'), 'utf8');
const SYSTEMBOOT_SRC = readFileSync(join(SRC_DIR, 'platform', 'system', 'SystemBoot.ts'), 'utf8');

const _open: Array<() => void> = [];
function start(deps: DeepScanWiringDeps) {
  const c = startPlatformCoreDeepScanWiring(deps);
  _open.push(c);
  return c;
}
afterEach(() => { while (_open.length) { try { _open.pop()!(); } catch { /* */ } } });

/* ── Yaşam döngüsü & ownership ─────────────────────────────────────────────── */

describe('W5-1 Deep Scan wiring — yaşam döngüsü & ownership', () => {
  it('1) cleanup thunk döner', () => {
    expect(typeof start(mkDeps())).toBe('function');
  });

  it('2) orchestrator DI fabrikasıyla oluşturulur (bir kez)', () => {
    const factory = vi.fn((_d: DeepScanOrchestratorDeps) => createFakeOrchestrator());
    start(mkDeps({ factory }));
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('3) fabrikaya runtime/persistence/ignition geçer', () => {
    const captured = { value: null as DeepScanOrchestratorDeps | null };
    const runtime = fakeRuntime(); const persistence = fakePersistence(); const ignition = fakeIgnition();
    start(mkDeps({ runtime, persistence, ignition, capturedDeps: captured }));
    expect(captured.value?.runtime).toBe(runtime);
    expect(captured.value?.persistence).toBe(persistence);
    expect(captured.value?.ignitionSource).toBe(ignition);
  });

  it('4) fabrikaya HANDLER geçmez (W5-1 handler bağlamaz)', () => {
    const captured = { value: null as DeepScanOrchestratorDeps | null };
    start(mkDeps({ capturedDeps: captured }));
    expect(captured.value?.handlers).toBeUndefined();
  });

  it('5) TARAMA otomatik başlamaz: start/run/runNextPhase HİÇ çağrılmaz', () => {
    const orch = createFakeOrchestrator();
    start(mkDeps({ orchestrator: orch }));
    expect(orch.start).not.toHaveBeenCalled();
    expect(orch.run).not.toHaveBeenCalled();
    expect(orch.runNextPhase).not.toHaveBeenCalled();
  });

  it('6) aktif wiring status present=true, started=true', () => {
    start(mkDeps());
    const s = getDeepScanWiringStatus();
    expect(s.present).toBe(true);
    expect(s.started).toBe(true);
  });

  it('7) hasHandlers=false, activeHandlerCount=0', () => {
    start(mkDeps());
    const s = getDeepScanWiringStatus();
    expect(s.hasHandlers).toBe(false);
    expect(s.activeHandlerCount).toBe(0);
  });

  it('8) FAIL-CLOSED: ignitionConfirmed=null', () => {
    start(mkDeps({ ignition: fakeIgnition({ confirmed: null }) }));
    expect(getDeepScanWiringStatus().ignitionConfirmed).toBe(null);
  });

  it('9) runtimeState/scanState idle (tarama yürümüyor)', () => {
    start(mkDeps());
    const s = getDeepScanWiringStatus();
    expect(s.runtimeState).toBe('idle');
    expect(s.scanState).toBe('idle');
  });

  it('10) currentPhase=null, progress=0, warningCount=0', () => {
    start(mkDeps());
    const s = getDeepScanWiringStatus();
    expect(s.currentPhase).toBe(null);
    expect(s.progressPercent).toBe(0);
    expect(s.warningCount).toBe(0);
  });
});

/* ── Duplicate / tek-instance ─────────────────────────────────────────────── */

describe('W5-1 wiring — duplicate & tek-instance', () => {
  it('11) duplicate start İKİNCİ orchestrator OLUŞTURMAZ', () => {
    const factory = vi.fn((_d: DeepScanOrchestratorDeps) => createFakeOrchestrator());
    start(mkDeps({ factory }));
    start(mkDeps({ factory }));
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('12) duplicate start no-op cleanup döner (ilk zincir bozulmaz)', () => {
    start(mkDeps());
    const c2 = start(mkDeps());
    expect(() => c2()).not.toThrow();
    expect(getDeepScanWiringStatus().present).toBe(true);   // ilk hâlâ aktif
  });
});

/* ── Cleanup / ownership ──────────────────────────────────────────────────── */

describe('W5-1 wiring — cleanup & ownership', () => {
  it('13) cleanup owned orchestrator\'ı dispose eder', () => {
    const orch = createFakeOrchestrator();
    const c = start(mkDeps({ orchestrator: orch }));
    c();
    expect(orch.disposeCalls).toBe(1);
  });

  it('14) cleanup PAYLAŞILAN runtime\'ı dispose ETMEZ', () => {
    const runtime = fakeRuntime();
    const c = start(mkDeps({ runtime }));
    c();
    expect(runtime.dispose).not.toHaveBeenCalled();
  });

  it('15) cleanup PAYLAŞILAN persistence\'ı dispose ETMEZ', () => {
    const persistence = fakePersistence();
    const c = start(mkDeps({ persistence }));
    c();
    expect(persistence.dispose).not.toHaveBeenCalled();
  });

  it('16) cleanup PAYLAŞILAN ignition\'ı dispose ETMEZ', () => {
    const ignition = fakeIgnition();
    const c = start(mkDeps({ ignition }));
    c();
    expect(ignition.dispose).not.toHaveBeenCalled();
  });

  it('17) cleanup İDEMPOTENT', () => {
    const orch = createFakeOrchestrator();
    const c = start(mkDeps({ orchestrator: orch }));
    c(); c();
    expect(orch.disposeCalls).toBe(1);   // ikinci çağrı no-op
  });

  it('18) cleanup sonrası status present=false', () => {
    const c = start(mkDeps());
    c();
    expect(getDeepScanWiringStatus().present).toBe(false);
  });

  it('19) boot → shutdown → boot güvenli (ikinci orchestrator oluşur)', () => {
    const f1 = vi.fn((_d: DeepScanOrchestratorDeps) => createFakeOrchestrator());
    const c1 = start(mkDeps({ factory: f1 }));
    c1();
    const f2 = vi.fn((_d: DeepScanOrchestratorDeps) => createFakeOrchestrator());
    start(mkDeps({ factory: f2 }));
    expect(f2).toHaveBeenCalledTimes(1);
    expect(getDeepScanWiringStatus().present).toBe(true);
  });

  it('20) HMR/restart: dispose edilmiş orchestrator bayat kaydı yeni wiring\'i bloke ETMEZ', () => {
    const orch1 = createFakeOrchestrator();
    start(mkDeps({ orchestrator: orch1 }));   // cleanup çağrılmadan
    orch1.dispose();                          // dıştan dispose (HMR artığı simülasyonu)
    const f2 = vi.fn((_d: DeepScanOrchestratorDeps) => createFakeOrchestrator());
    start(mkDeps({ factory: f2 }));           // pruneStale → bayat serbest
    expect(f2).toHaveBeenCalledTimes(1);
  });
});

/* ── Fail-soft ────────────────────────────────────────────────────────────── */

describe('W5-1 wiring — fail-soft', () => {
  it('21) orchestrator fabrikası throw → wiring throw ETMEZ, lastErrorCode=init_failed', () => {
    let c: (() => void) | null = null;
    expect(() => { c = start(mkDeps({ factoryThrows: true })); }).not.toThrow();
    expect(typeof c).toBe('function');
    expect(getDeepScanWiringStatus().lastErrorCode).toBe('init_failed');
  });

  it('22) partial init: fabrika throw → _active bırakılmaz (present=false)', () => {
    start(mkDeps({ factoryThrows: true }));
    expect(getDeepScanWiringStatus().present).toBe(false);
  });

  it('23) orchestrator.getSnapshot throw → status IDLE döner (çökmez)', () => {
    start(mkDeps({ orchestrator: createFakeOrchestrator({ getSnapshotThrows: true }) }));
    expect(() => getDeepScanWiringStatus()).not.toThrow();
  });

  it('24) ignition.getConfirmedValue throw → ignitionConfirmed=null (çökmez)', () => {
    start(mkDeps({ ignition: fakeIgnition({ throws: true }) }));
    const s = getDeepScanWiringStatus();
    expect(s.ignitionConfirmed).toBe(null);
  });

  it('25) cleanup dispose throw → cleanup throw ETMEZ, lastErrorCode=cleanup_failed', () => {
    const orch = createFakeOrchestrator();
    orch.dispose = () => { throw new Error('dispose boom'); };
    const c = start(mkDeps({ orchestrator: orch }));
    expect(() => c()).not.toThrow();
    expect(getDeepScanWiringStatus().lastErrorCode).toBe('cleanup_failed');
  });

  it('26) public API throw ETMEZ (deps boş)', () => {
    // Not: deps boş → gerçek singleton'lar + gerçek createDeepScanOrchestrator kullanılır;
    // yan etkisiz (start/run çağrılmaz). Throw etmemeli, cleanup güvenli olmalı.
    expect(() => { const c = startPlatformCoreDeepScanWiring(); c(); }).not.toThrow();
    expect(() => getDeepScanWiringStatus()).not.toThrow();
  });
});

/* ── Status bounded/immutable ─────────────────────────────────────────────── */

describe('W5-1 wiring — bounded status', () => {
  it('27) status immutable (frozen)', () => {
    start(mkDeps());
    expect(Object.isFrozen(getDeepScanWiringStatus())).toBe(true);
  });

  it('28) kapalıyken status present=false, ignitionConfirmed=null', () => {
    const s = getDeepScanWiringStatus();
    expect(s.present).toBe(false);
    expect(s.ignitionConfirmed).toBe(null);
  });
});

/* ── Kapsam sınırı (kaynak-kilidi) ────────────────────────────────────────── */

describe('W5-1 wiring — kapsam sınırı', () => {
  it('29) start()/run()/runNextPhase() ÇAĞRISI YOK (kaynak)', () => {
    expect(WIRING_SRC).not.toMatch(/\.start\s*\(/);
    expect(WIRING_SRC).not.toMatch(/\.run\s*\(/);
    expect(WIRING_SRC).not.toMatch(/\.runNextPhase\s*\(/);
  });

  it('30) yeni timer/polling/rAF YOK', () => {
    expect(WIRING_SRC).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });

  it('31) Event Bus / Capability / Assistant / native-OBD-CAN import EDİLMEZ', () => {
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*eventBus/i);
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*capability/i);
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*assistant/i);
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*(obdService|canbus|nativePlugin)/i);
  });

  it('32) hot-path serileştirme YOK (JSON.stringify / structuredClone)', () => {
    expect(WIRING_SRC).not.toMatch(/JSON\.stringify|structuredClone/);
  });

  it('33) handler bağlama YOK (handlers geçilmez)', () => {
    expect(WIRING_SRC).not.toMatch(/handlers\s*:/);
  });
});

/* ── SystemBoot entegrasyon sıra kilidi ────────────────────────────────────── */

describe('W5-1 — SystemBoot sırası korunur', () => {
  it('34) deep scan wiring Capability bridge\'den SONRA, SystemOrchestrator\'dan ÖNCE', () => {
    const iCapBridge = SYSTEMBOOT_SRC.indexOf('startPlatformCoreCapabilityBridgeWiring(');
    const iDeep = SYSTEMBOOT_SRC.indexOf('startPlatformCoreDeepScanWiring(');
    const iOrch = SYSTEMBOOT_SRC.indexOf('startSystemOrchestrator(');
    expect(iCapBridge).toBeGreaterThan(0);
    expect(iDeep).toBeGreaterThan(iCapBridge);
    expect(iOrch).toBeGreaterThan(iDeep);
  });

  it('35) savunmacı try/catch (logError SystemBoot:deepScanWiring)', () => {
    expect(SYSTEMBOOT_SRC).toMatch(/logError\(['"]SystemBoot:deepScanWiring/);
  });

  it('36) `_reg` cleanup modeliyle kaydedilir (LIFO)', () => {
    expect(SYSTEMBOOT_SRC).toMatch(/this\._reg\(startPlatformCoreDeepScanWiring\(/);
  });

  it('37) mevcut Wave sırası (1→2→3→4) DEĞİŞMEDİ', () => {
    const i1 = SYSTEMBOOT_SRC.indexOf('await this._wave1()');
    const i2 = SYSTEMBOOT_SRC.indexOf('await this._wave2()');
    const i3 = SYSTEMBOOT_SRC.indexOf('await this._wave3()');
    const i4 = SYSTEMBOOT_SRC.indexOf('await this._wave4()');
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(i4).toBeGreaterThan(i3);
  });

  it('38) HAL/Capability/Event Bus wiring kayıtları HÂLÂ mevcut (değişmedi)', () => {
    expect(SYSTEMBOOT_SRC).toMatch(/this\._reg\(startPlatformCoreVehicleHalWiring\(/);
    expect(SYSTEMBOOT_SRC).toMatch(/this\._reg\(startPlatformCoreCapabilityWiring\(/);
    expect(SYSTEMBOOT_SRC).toMatch(/this\._reg\(startPlatformCoreCapabilityBridgeWiring\(/);
    expect(SYSTEMBOOT_SRC).toMatch(/startPlatformCoreEventBusWiring/);
  });
});
