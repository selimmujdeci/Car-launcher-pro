/**
 * platformCoreDeepScanBridgeWiring.test.ts — W5-2 Deep Scan → Event Bus bridge kilitleri.
 *
 * Test izolasyonu: gerçek orchestrator/appEventBus singleton'ları PAYLAŞILMAZ — fake
 * orchestrator (subscribable) + fake bus DI ile her test kendi izole zincirini kurar.
 * Odak: olay eşlemesi + küçük/sanitize payload + tarama BAŞLAMADAN 0 event + ownership + fail-soft.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  startPlatformCoreDeepScanBridgeWiring,
  getDeepScanBridgeStatus,
  type DeepScanBridgeWiringDeps,
  type DeepScanBridgePublishTarget,
} from '../platform/system/platformCoreDeepScanBridgeWiring';
import type { DeepScanOrchestratorSubscribable } from '../platform/system/platformCoreDeepScanWiring';
import type { OrchestratorEvent, OrchestratorEventType, OrchestratorSnapshot } from '../platform/deepScan';

/* ── Fake'ler ──────────────────────────────────────────────────────────────── */

function orchSnap(): OrchestratorSnapshot {
  return {
    status: 'idle', mode: null, currentPhase: null, currentPhaseIndex: 0, totalPhases: 12,
    progressPercent: 0, runtimeStatus: 'idle', reportSummary: null, warnings: [],
  };
}
function evt(type: OrchestratorEventType, over: Partial<OrchestratorEvent> = {}): OrchestratorEvent {
  return { type, at: 1000, phase: null, progressPercent: 0, status: 'running', reason: null, reportSummary: null, ...over };
}
function report(over: Record<string, unknown> = {}) {
  return {
    mode: 'FULL_SCAN', ecuCount: 3, pidCount: 10, didCount: 5, newDiscoveriesCount: 2,
    firmwareCheckedCount: 1, changedFirmware: false, changedEcu: false, warningCount: 0,
    durationMs: 5000, note: 'RAW_SECRET_NOTE_SHOULD_NOT_LEAK', ...over,
  } as OrchestratorEvent['reportSummary'];
}

interface PubInput { name: string; payload?: unknown; domain?: string; source?: string; transient?: boolean; retained?: boolean }
interface FakeBus extends DeepScanBridgePublishTarget {
  readonly events: PubInput[];
  readonly disposeCalls: number;
  dispose: () => void;
}
function createFakeBus(opts?: { throwOnPublish?: boolean; dropAll?: boolean }): FakeBus {
  const events: PubInput[] = [];
  let disposeCalls = 0;
  return {
    events,
    publish(i) { if (opts?.throwOnPublish) throw new Error('bus boom'); events.push(i as PubInput); return opts?.dropAll ? null : ({ name: i.name } as never); },
    dispose() { disposeCalls++; },
    get disposeCalls() { return disposeCalls; },
  };
}

interface FakeOrch extends DeepScanOrchestratorSubscribable {
  emit: (ev: OrchestratorEvent) => void;
  readonly subscribed: boolean;
  readonly unsubCalls: number;
  readonly disposeCalls: number;
  dispose: () => void;
}
function createFakeOrch(opts?: { subscribeThrows?: boolean }): FakeOrch {
  let listener: ((ev: OrchestratorEvent) => void) | null = null;
  let unsubCalls = 0;
  let disposeCalls = 0;
  return {
    subscribe(l) { if (opts?.subscribeThrows) throw new Error('subscribe boom'); listener = l; return () => { unsubCalls++; listener = null; }; },
    getSnapshot: () => orchSnap(),
    emit: (ev) => { listener?.(ev); },
    get subscribed() { return listener !== null; },
    get unsubCalls() { return unsubCalls; },
    dispose() { disposeCalls++; },
    get disposeCalls() { return disposeCalls; },
  };
}

const names = (bus: FakeBus) => bus.events.map((e) => e.name);

const SRC_DIR = join(process.cwd(), 'src');
const WIRING_SRC = readFileSync(join(SRC_DIR, 'platform', 'system', 'platformCoreDeepScanBridgeWiring.ts'), 'utf8');
const SYSTEMBOOT_SRC = readFileSync(join(SRC_DIR, 'platform', 'system', 'SystemBoot.ts'), 'utf8');

const _open: Array<() => void> = [];
function start(deps: DeepScanBridgeWiringDeps) {
  const c = startPlatformCoreDeepScanBridgeWiring(deps);
  _open.push(c);
  return c;
}
afterEach(() => { while (_open.length) { try { _open.pop()!(); } catch { /* */ } } });

/* ── Yaşam döngüsü & event eşlemesi ────────────────────────────────────────── */

describe('W5-2 Deep Scan bridge — yaşam döngüsü & event eşlemesi', () => {
  it('1) cleanup thunk döner + orchestrator subscribe edilir', () => {
    const orch = createFakeOrch();
    const c = start({ orchestrator: orch, bus: createFakeBus() });
    expect(typeof c).toBe('function');
    expect(orch.subscribed).toBe(true);
  });

  it('2) scan_started → deep_scan.scan.started', () => {
    const orch = createFakeOrch(); const bus = createFakeBus();
    start({ orchestrator: orch, bus });
    orch.emit(evt('scan_started', { status: 'running' }));
    expect(names(bus)).toContain('deep_scan.scan.started');
  });

  it('3) phase_started/completed/failed → deep_scan.phase.*', () => {
    const orch = createFakeOrch(); const bus = createFakeBus();
    start({ orchestrator: orch, bus });
    orch.emit(evt('phase_started', { phase: 'ecu_discovery' }));
    orch.emit(evt('phase_completed', { phase: 'ecu_discovery' }));
    orch.emit(evt('phase_failed', { phase: 'protocol_detection', reason: 'waiting_for_ignition' }));
    expect(names(bus)).toEqual(expect.arrayContaining(['deep_scan.phase.started', 'deep_scan.phase.completed', 'deep_scan.phase.failed']));
  });

  it('4) report_ready → deep_scan.report.ready', () => {
    const orch = createFakeOrch(); const bus = createFakeBus();
    start({ orchestrator: orch, bus });
    orch.emit(evt('report_ready', { phase: 'report_generation', reportSummary: report() }));
    expect(names(bus)).toContain('deep_scan.report.ready');
  });

  it('5) scan_completed/failed/cancelled → deep_scan.scan.*', () => {
    const orch = createFakeOrch(); const bus = createFakeBus();
    start({ orchestrator: orch, bus });
    orch.emit(evt('scan_completed', { status: 'completed', reportSummary: report() }));
    orch.emit(evt('scan_failed', { status: 'failed', reason: 'protocol_error' }));
    orch.emit(evt('scan_cancelled', { status: 'cancelled', reason: 'user_cancel' }));
    expect(names(bus)).toEqual(expect.arrayContaining(['deep_scan.scan.completed', 'deep_scan.scan.failed', 'deep_scan.scan.cancelled']));
  });

  it('6) progress_changed EŞLENMEZ (katalog yok → event UYDURULMAZ)', () => {
    const orch = createFakeOrch(); const bus = createFakeBus();
    start({ orchestrator: orch, bus });
    orch.emit(evt('progress_changed', { progressPercent: 42 }));
    expect(bus.events.length).toBe(0);
  });

  it('7) bilinmeyen event tipi fail-soft (publish yok, throw yok)', () => {
    const orch = createFakeOrch(); const bus = createFakeBus();
    start({ orchestrator: orch, bus });
    expect(() => orch.emit(evt('bogus_event' as OrchestratorEventType))).not.toThrow();
    expect(bus.events.length).toBe(0);
  });

  it('8) event domain=deep_scan, source=deep_scan', () => {
    const orch = createFakeOrch(); const bus = createFakeBus();
    start({ orchestrator: orch, bus });
    orch.emit(evt('scan_started'));
    expect(bus.events[0].domain).toBe('deep_scan');
    expect(bus.events[0].source).toBe('deep_scan');
  });

  it('9) phase.* TRANSIENT, scan.*/report HISTORY-ELIGIBLE (transient=false), retained hiçbiri', () => {
    const orch = createFakeOrch(); const bus = createFakeBus();
    start({ orchestrator: orch, bus });
    orch.emit(evt('phase_started', { phase: 'ecu_discovery' }));
    orch.emit(evt('scan_completed', { status: 'completed' }));
    const phaseEv = bus.events.find((e) => e.name === 'deep_scan.phase.started')!;
    const scanEv = bus.events.find((e) => e.name === 'deep_scan.scan.completed')!;
    expect(phaseEv.transient).toBe(true);
    expect(scanEv.transient).toBe(false);
    expect(bus.events.every((e) => e.retained !== true)).toBe(true);
  });
});

/* ── Payload / privacy ─────────────────────────────────────────────────────── */

describe('W5-2 bridge — payload & privacy', () => {
  it('10) küçük bounded payload (state/progress/at + reportSummary sayımları)', () => {
    const orch = createFakeOrch(); const bus = createFakeBus();
    start({ orchestrator: orch, bus });
    orch.emit(evt('report_ready', { phase: 'report_generation', reportSummary: report() }));
    const p = bus.events[0].payload as Record<string, unknown>;
    expect(p.state).toBeDefined();
    expect(p.ecuCount).toBe(3);
    expect(p.newDiscoveriesCount).toBe(2);
    expect(p.durationMs).toBe(5000);
  });

  it('11) full report body / note TAŞINMAZ', () => {
    const orch = createFakeOrch(); const bus = createFakeBus();
    start({ orchestrator: orch, bus });
    orch.emit(evt('report_ready', { reportSummary: report() }));
    const p = bus.events[0].payload as Record<string, unknown>;
    expect(p).not.toHaveProperty('note');
    expect(JSON.stringify(bus.events)).not.toContain('RAW_SECRET_NOTE_SHOULD_NOT_LEAK');
  });

  it('12) VIN/MAC/koordinat/ham veri sızmaz', () => {
    const orch = createFakeOrch(); const bus = createFakeBus();
    start({ orchestrator: orch, bus });
    orch.emit(evt('scan_started'));
    orch.emit(evt('report_ready', { reportSummary: report() }));
    const json = JSON.stringify(bus.events);
    expect(json).not.toMatch(/\b[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}\b/);       // MAC
    expect(json).not.toMatch(/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/);     // koordinat
    expect(json).not.toMatch(/\b[A-HJ-NPR-Z0-9]{17}\b/);                       // VIN
  });

  it('13) reason sanitize + bounded (≤96)', () => {
    const orch = createFakeOrch(); const bus = createFakeBus();
    start({ orchestrator: orch, bus });
    orch.emit(evt('scan_failed', { status: 'failed', reason: 'x'.repeat(500) }));
    const p = bus.events[0].payload as Record<string, unknown>;
    expect(typeof p.reason).toBe('string');
    expect((p.reason as string).length).toBeLessThanOrEqual(96);
  });
});

/* ── Duplicate / dedup ─────────────────────────────────────────────────────── */

describe('W5-2 bridge — dedup & duplicate', () => {
  it('14) ARDIŞIK aynı event duplicate publish üretmez', () => {
    const orch = createFakeOrch(); const bus = createFakeBus();
    start({ orchestrator: orch, bus });
    orch.emit(evt('phase_started', { phase: 'ecu_discovery' }));
    orch.emit(evt('phase_started', { phase: 'ecu_discovery' }));   // aynı
    expect(names(bus).filter((n) => n === 'deep_scan.phase.started').length).toBe(1);
  });

  it('15) scan reset sonrası tekrar scan_started YANLIŞ elenmez', () => {
    const orch = createFakeOrch(); const bus = createFakeBus();
    start({ orchestrator: orch, bus });
    orch.emit(evt('scan_started'));
    orch.emit(evt('scan_completed', { status: 'completed' }));
    orch.emit(evt('scan_started'));   // yeni tarama — araya scan_completed girdi
    expect(names(bus).filter((n) => n === 'deep_scan.scan.started').length).toBe(2);
  });

  it('16) duplicate wiring İKİNCİ abonelik açmaz', () => {
    const orch = createFakeOrch();
    start({ orchestrator: orch, bus: createFakeBus() });
    start({ orchestrator: createFakeOrch(), bus: createFakeBus() });   // duplicate
    // ilk orch tek abonelik; ikinci hiç subscribe edilmez
    expect(orch.subscribed).toBe(true);
  });
});

/* ── Ownership / cleanup ──────────────────────────────────────────────────── */

describe('W5-2 bridge — ownership & cleanup', () => {
  it('17) cleanup aboneliği söker: sonraki event publish edilmez', () => {
    const orch = createFakeOrch(); const bus = createFakeBus();
    const c = start({ orchestrator: orch, bus });
    c();
    expect(orch.subscribed).toBe(false);
    expect(orch.unsubCalls).toBe(1);
    orch.emit(evt('scan_started'));
    expect(bus.events.length).toBe(0);
  });

  it('18) cleanup orchestrator\'ı dispose ETMEZ', () => {
    const orch = createFakeOrch();
    const c = start({ orchestrator: orch, bus: createFakeBus() });
    c();
    expect(orch.disposeCalls).toBe(0);
  });

  it('19) cleanup bus\'ı dispose ETMEZ', () => {
    const bus = createFakeBus();
    const c = start({ orchestrator: createFakeOrch(), bus });
    c();
    expect(bus.disposeCalls).toBe(0);
  });

  it('20) cleanup İDEMPOTENT', () => {
    const c = start({ orchestrator: createFakeOrch(), bus: createFakeBus() });
    c();
    expect(() => c()).not.toThrow();
  });

  it('21) boot → shutdown → boot güvenli (ikinci abonelik canlı)', () => {
    const o1 = createFakeOrch();
    const c1 = start({ orchestrator: o1, bus: createFakeBus() });
    c1();
    const o2 = createFakeOrch(); const bus2 = createFakeBus();
    start({ orchestrator: o2, bus: bus2 });
    o2.emit(evt('scan_started'));
    expect(bus2.events.length).toBe(1);
  });
});

/* ── Fail-soft ────────────────────────────────────────────────────────────── */

describe('W5-2 bridge — fail-soft', () => {
  it('22) orchestrator YOK → no-op cleanup, throw yok', () => {
    let c: (() => void) | null = null;
    expect(() => { c = start({ orchestrator: null, bus: createFakeBus() }); }).not.toThrow();
    expect(() => c!()).not.toThrow();
    expect(getDeepScanBridgeStatus().present).toBe(false);
  });

  it('23) bus YOK → no-op cleanup, throw yok', () => {
    expect(() => { const c = start({ orchestrator: createFakeOrch(), bus: null }); c(); }).not.toThrow();
  });

  it('24) subscribe hatası fail-soft', () => {
    expect(() => start({ orchestrator: createFakeOrch({ subscribeThrows: true }), bus: createFakeBus() })).not.toThrow();
  });

  it('25) publish hatası fail-soft → droppedCount artar, lifecycle etkilenmez', () => {
    const orch = createFakeOrch(); const bus = createFakeBus({ throwOnPublish: true });
    start({ orchestrator: orch, bus });
    expect(() => orch.emit(evt('scan_started'))).not.toThrow();
    expect((getDeepScanBridgeStatus().droppedCount)).toBeGreaterThan(0);
  });

  it('26) bus null-döndürürse (limit) droppedCount, publishedCount doğru', () => {
    const orch = createFakeOrch(); const bus = createFakeBus({ dropAll: true });
    start({ orchestrator: orch, bus });
    orch.emit(evt('scan_started'));
    const s = getDeepScanBridgeStatus();
    expect(s.droppedCount).toBe(1);
    expect(s.publishedCount).toBe(0);
  });

  it('27) publishedCount doğru sayılır', () => {
    const orch = createFakeOrch(); const bus = createFakeBus();
    start({ orchestrator: orch, bus });
    orch.emit(evt('scan_started'));
    orch.emit(evt('phase_started', { phase: 'ecu_discovery' }));
    expect(getDeepScanBridgeStatus().publishedCount).toBe(2);
  });

  it('28) public API throw ETMEZ', () => {
    expect(() => { const c = startPlatformCoreDeepScanBridgeWiring({ orchestrator: undefined, bus: undefined }); c(); }).not.toThrow();
    expect(() => getDeepScanBridgeStatus()).not.toThrow();
  });
});

/* ── Bounded status ───────────────────────────────────────────────────────── */

describe('W5-2 bridge — bounded status', () => {
  it('29) scan yoksa event 0 (publishedCount 0, status present=true frozen)', () => {
    start({ orchestrator: createFakeOrch(), bus: createFakeBus() });
    const s = getDeepScanBridgeStatus();
    expect(s.present).toBe(true);
    expect(s.started).toBe(true);
    expect(s.activeSubscriptionCount).toBe(1);
    expect(s.publishedCount).toBe(0);
    expect(Object.isFrozen(s)).toBe(true);
  });

  it('30) lastEventName/lastEventAt publish sonrası dolar', () => {
    const orch = createFakeOrch(); const bus = createFakeBus();
    start({ orchestrator: orch, bus });
    orch.emit(evt('scan_started'));
    const s = getDeepScanBridgeStatus();
    expect(s.lastEventName).toBe('deep_scan.scan.started');
    expect(typeof s.lastEventAt).toBe('number');
  });

  it('31) kapalıyken present=false', () => {
    expect(getDeepScanBridgeStatus().present).toBe(false);
  });
});

/* ── Kapsam sınırı (kaynak-kilidi) ────────────────────────────────────────── */

describe('W5-2 bridge — kapsam sınırı', () => {
  it('32) İKİNCİ bus ÜRETİLMEZ (getAppEventBus tüketilir, createPlatformEventBus YOK)', () => {
    expect(WIRING_SRC).not.toMatch(/createPlatformEventBus\s*\(/);
    expect(WIRING_SRC).toMatch(/getAppEventBus\s*\(/);
  });

  it('33) scan YÜRÜTME API\'si çağrılmaz (run/runNextPhase YOK)', () => {
    // Not: bu adlar "NE YAPMAZ" doc-comment'inde geçer → kelime değil ÇAĞRI (.foo() ) kontrol edilir.
    expect(WIRING_SRC).not.toMatch(/\.runNextPhase\s*\(/);
    expect(WIRING_SRC).not.toMatch(/\.run\s*\(/);
  });

  it('34) handler bağlama YOK', () => {
    expect(WIRING_SRC).not.toMatch(/handlers\s*:/);
  });

  it('35) Capability / Assistant / native-OBD-CAN import EDİLMEZ', () => {
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*capability/i);
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*assistant/i);
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*(obdService|canbus|nativePlugin)/i);
  });

  it('36) yeni timer/polling/rAF YOK', () => {
    expect(WIRING_SRC).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });
});

/* ── SystemBoot entegrasyon ────────────────────────────────────────────────── */

describe('W5-2 — SystemBoot sırası korunur', () => {
  it('37) bridge Deep Scan ownership\'ten SONRA, SystemOrchestrator\'dan ÖNCE', () => {
    const iOwn = SYSTEMBOOT_SRC.indexOf('startPlatformCoreDeepScanWiring(');
    const iBridge = SYSTEMBOOT_SRC.indexOf('startPlatformCoreDeepScanBridgeWiring(');
    const iOrch = SYSTEMBOOT_SRC.indexOf('startSystemOrchestrator(');
    expect(iOwn).toBeGreaterThan(0);
    expect(iBridge).toBeGreaterThan(iOwn);
    expect(iOrch).toBeGreaterThan(iBridge);
  });

  it('38) savunmacı try/catch (logError SystemBoot:deepScanBridgeWiring)', () => {
    expect(SYSTEMBOOT_SRC).toMatch(/logError\(['"]SystemBoot:deepScanBridgeWiring/);
  });

  it('39) `_reg` cleanup modeliyle kaydedilir', () => {
    expect(SYSTEMBOOT_SRC).toMatch(/this\._reg\(startPlatformCoreDeepScanBridgeWiring\(/);
  });

  it('40) mevcut Wave sırası (1→2→3→4) DEĞİŞMEDİ', () => {
    const i1 = SYSTEMBOOT_SRC.indexOf('await this._wave1()');
    const i2 = SYSTEMBOOT_SRC.indexOf('await this._wave2()');
    const i3 = SYSTEMBOOT_SRC.indexOf('await this._wave3()');
    const i4 = SYSTEMBOOT_SRC.indexOf('await this._wave4()');
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(i4).toBeGreaterThan(i3);
  });
});
