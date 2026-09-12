/**
 * deepScanOrchestrator.test.ts — Deep Scan Orchestration birim testleri.
 *
 * Kapsam: normal akış · full_scan/change_check · ignition yok → waiting · fingerprint
 * fail (fail-soft devam) · persistence fail (report yine üretilir) · timeout (kritik→fail,
 * kritik-değil→devam) · cancel · event sırası · progress monotonik · immutability ·
 * dispose zero-leak · duplicate start · bounded keşif birikimi · handler hata izolasyonu.
 *
 * ⚠️ COMPLETION TRUTH GÜNCELLEMESİ: "tarama sonuna geldi" ARTIK "tam tarandı" DEMEK
 * DEĞİLDİR. Handler'ı olmayan faz `handler_unavailable` üretir ve tarama `partial`
 * biter. Bu yüzden `completed` bekleyen testler artık GERÇEK handler kümesi
 * (`allSuccessHandlers()`) ile koşar — eski hâli, düzeltilen hatanın ta kendisiydi.
 *
 * Not: gerçek OBD/native YOK — enjekte edilmiş runtime/persistence/ignition + no-op/mock
 * handler'lar + kontrollü saat.
 */

import { describe, it, expect } from 'vitest';
import {
  buildDeepScanCoverageLedger,
  createDeepScanOrchestrator,
  evaluateDeepScanCompletion,
  DEEP_SCAN_PHASE_SEQUENCE,
  DeepScanRuntimeService,
  DeepScanPersistenceStore,
  createDeepScanIgnitionSource,
  type DeepScanCompletionOutcome,
  type DeepScanPhase,
  type PhaseHandler,
  type OrchestratorEvent,
  type DeepScanStoreIO,
  type DeepScanPersistInput,
  type DeepScanRecord,
} from '../platform/deepScan';
// Kaynak-metin kilidi (flake bağışık).
import orchestratorSource from '../platform/deepScan/deepScanOrchestrator.ts?raw';

const NOW = 2_000_000;
const now = () => NOW;
const HASH = 'a1b2c3d4e5f60718';

function memIO() {
  const map = new Map<string, string>();
  const io: DeepScanStoreIO = {
    read: (k) => map.get(k) ?? null,
    write: (k, v) => { map.set(k, v); },
    remove: (k) => { map.delete(k); },
  };
  return { io, map };
}

/** Her zorunlu faz için GERÇEK (başarılı) handler — tam kapsam üretir. */
function allSuccessHandlers(
  over: Partial<Record<DeepScanPhase, PhaseHandler>> = {},
): Partial<Record<DeepScanPhase, PhaseHandler>> {
  const h: Partial<Record<DeepScanPhase, PhaseHandler>> = {};
  for (const phase of DEEP_SCAN_PHASE_SEQUENCE) h[phase] = () => ({ status: 'success' as const });
  return { ...h, ...over };
}

/** Gerçek bir `full` kapsam kanıtı üretir (persistence tohumlaması için). */
function fullCompletion(scanId: string): DeepScanCompletionOutcome {
  return evaluateDeepScanCompletion(buildDeepScanCoverageLedger({
    scanId,
    entries: DEEP_SCAN_PHASE_SEQUENCE.map((phase) => ({ phase, status: 'completed' as const })),
    persistenceFinalized: true,
  }));
}

interface HarnessOpts {
  handlers?: Partial<Record<string, PhaseHandler>>;
  ignitionOn?: boolean;
  persistence?: DeepScanPersistenceStore;
  seedCompletedFullScan?: boolean;
}

function harness(opts: HarnessOpts = {}) {
  const runtime = new DeepScanRuntimeService({ now });
  const io = memIO();
  const persistence = opts.persistence ?? new DeepScanPersistenceStore('k-orch', 16, 5000, io.io, now);
  const ignition = createDeepScanIgnitionSource({ now, allowManualOverride: true });
  if (opts.ignitionOn) ignition.setManualOverride(true);

  if (opts.seedCompletedFullScan && !opts.persistence) {
    // Tamamlanmış full_scan kaydı tohumla → change_check beklensin.
    persistence.completeScan({
      snapshot: {
        scanId: 'seed', vehicleFingerprintHash: HASH, status: 'completed', mode: 'FULL_SCAN',
        phase: 'report_generation', progressPercent: 100, startedAt: NOW - 1000, updatedAt: NOW,
        completedAt: NOW, isFirstScan: true, ignitionRequired: true, ignitionConfirmed: true,
        discoveredEcuCount: 0, discoveredPidCount: 0, discoveredDidCount: 0, newDiscoveriesCount: 0,
        changedFirmware: false, changedEcu: false, warnings: [], errorCode: null, reportSummary: null,
      },
      completion: fullCompletion('seed'),   // ★ kapsam kanıtı olmadan yükseltme YOK
    });
  }

  const orch = createDeepScanOrchestrator({
    runtime, persistence, ignitionSource: ignition,
    handlers: opts.handlers as Partial<Record<string, PhaseHandler>> | undefined, now,
  });
  const events: OrchestratorEvent[] = [];
  orch.subscribe((e) => events.push(e));
  return { runtime, persistence, ignition, orch, events, io };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Normal akış / mod
 * ════════════════════════════════════════════════════════════════════════ */

describe('normal akış ve mod', () => {
  it('1) normal akış — ignition on + TÜM fazlar gerçek handler → completed, progress 100', async () => {
    const { orch, runtime } = harness({ ignitionOn: true, handlers: allSuccessHandlers() });
    const snap = await orch.run({ vehicleFingerprintHash: HASH });
    expect(snap.status).toBe('completed');
    expect(snap.completion.finalVerdict).toBe('full');
    expect(snap.progressPercent).toBe(100);
    expect(runtime.getSnapshot().status).toBe('completed');
  });

  it('2) full_scan — daha önce tamamlanmamış araç', async () => {
    const { orch } = harness({ ignitionOn: true });
    orch.start({ vehicleFingerprintHash: HASH });
    expect(orch.getSnapshot().mode).toBe('FULL_SCAN');
  });

  it('3) change_check — tamamlanmış full_scan kaydı olan araç', async () => {
    const { orch } = harness({ ignitionOn: true, seedCompletedFullScan: true });
    orch.start({ vehicleFingerprintHash: HASH });
    expect(orch.getSnapshot().mode).toBe('CHANGE_CHECK');
  });

  it('4) keşif sonuçları runtime + persistence\'a yansır', async () => {
    const handlers = allSuccessHandlers({
      ecu_discovery: () => ({ status: 'success' as const, ecus: ['7E0', '7E8'] }),
      standard_pid_discovery: () => ({ status: 'success' as const, pids: [{ pidOrDid: '0C' }, { pidOrDid: '0D' }] }),
      manufacturer_did_discovery: () => ({ status: 'success' as const, dids: [{ pidOrDid: 'F190' }] }),
    });
    const { orch, runtime, persistence } = harness({ ignitionOn: true, handlers });
    await orch.run({ vehicleFingerprintHash: HASH });
    const rt = runtime.getSnapshot();
    expect(rt.discoveredEcuCount).toBe(2);
    expect(rt.discoveredPidCount).toBe(2);
    expect(rt.discoveredDidCount).toBe(1);
    const rec = persistence.load(HASH);
    expect(rec?.discoveredEcus).toEqual(['7E0', '7E8']);
    expect(rec?.hasCompletedFullScan).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Ignition güvenliği
 * ════════════════════════════════════════════════════════════════════════ */

describe('ignition güvenliği', () => {
  it('5) ignition yok → waiting_for_ignition, aktif faz İLERLEMEZ', async () => {
    const { orch } = harness({ ignitionOn: false });
    await orch.run({ vehicleFingerprintHash: HASH });
    const snap = orch.getSnapshot();
    expect(snap.status).toBe('waiting_for_ignition');
    expect(snap.currentPhaseIndex).toBe(0);        // ilk aktif faz (identity) açılmadı
    expect(snap.currentPhase).toBe('vehicle_identity');
  });

  it('6) ignition sonradan gelince tarama ilerler', async () => {
    const { orch, ignition } = harness({ ignitionOn: false, handlers: allSuccessHandlers() });
    await orch.run({ vehicleFingerprintHash: HASH });
    expect(orch.getSnapshot().status).toBe('waiting_for_ignition');
    ignition.setManualOverride(true);              // kontak doğrulandı
    const snap = await orch.run();                 // devam
    expect(snap.status).toBe('completed');
    expect(snap.completion.finalVerdict).toBe('full');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Fail-soft zinciri
 * ════════════════════════════════════════════════════════════════════════ */

describe('fail-soft', () => {
  it('7) fingerprint fail → zincir DEVAM eder ama tarama full SAYILMAZ (partial)', async () => {
    const handlers = allSuccessHandlers({ fingerprint_update: () => ({ status: 'error' as const, errorCode: 'fp_boom' }) });
    const { orch, events } = harness({ ignitionOn: true, handlers });
    const snap = await orch.run({ vehicleFingerprintHash: HASH });
    // knowledge/persistence/report yine çalıştı → terminal + rapor var…
    expect(events.some((e) => e.type === 'phase_failed' && e.phase === 'fingerprint_update')).toBe(true);
    expect(events.some((e) => e.type === 'scan_completed')).toBe(true);
    // …ama kapsam eksik → "tam tarandı" İDDİASI YOK.
    expect(snap.status).toBe('partial');
    expect(snap.completion.finalVerdict).toBe('partial');
    expect(snap.completion.incompleteReasons).toContain('required_phase_failed');
  });

  it('8) persistence fail → report yine üretilir; ama full BAŞARI İLAN EDİLMEZ', async () => {
    const throwingPersistence = {
      hasCompletedFullScan: () => false,
      saveSnapshot: (_i: DeepScanPersistInput): DeepScanRecord | null => { throw new Error('disk boom'); },
      completeScan: (_i: DeepScanPersistInput): DeepScanRecord | null => { throw new Error('disk boom'); },
    } as unknown as DeepScanPersistenceStore;
    const { orch, events } = harness({ ignitionOn: true, handlers: allSuccessHandlers(), persistence: throwingPersistence });
    const snap = await orch.run({ vehicleFingerprintHash: HASH });
    expect(events.some((e) => e.type === 'report_ready')).toBe(true);
    expect(events.some((e) => e.type === 'scan_completed')).toBe(true);
    // Fazların hepsi başarılı ama kalıcılaştırma DÜŞTÜ → full DEĞİL (fail-closed).
    expect(snap.status).not.toBe('completed');
    expect(snap.completion.hasCompletedFullScan).toBe(false);
    expect(snap.completion.incompleteReasons).toContain('persistence_not_finalized');
  });

  it('9) kritik-değil timeout → devam (partial); KRİTİK (protocol) timeout → failed', async () => {
    const cont = harness({ ignitionOn: true, handlers: allSuccessHandlers({ ecu_discovery: () => ({ status: 'timeout' as const }) }) });
    const contSnap = await cont.orch.run({ vehicleFingerprintHash: HASH });
    expect(contSnap.status).toBe('partial');                         // zincir kırılmadı
    expect(contSnap.completion.incompleteReasons).toContain('required_phase_timeout');

    const crit = harness({ ignitionOn: true, handlers: allSuccessHandlers({ protocol_detection: () => ({ status: 'timeout' as const, errorCode: 'proto_to' }) }) });
    const snap = await crit.orch.run({ vehicleFingerprintHash: HASH });
    expect(snap.status).toBe('failed');
    expect(snap.completion.finalVerdict).toBe('failed');
    expect(crit.events.some((e) => e.type === 'scan_failed')).toBe(true);
  });

  it('10) handler exception izole → hata olarak işlenir, servis çökmez (partial)', async () => {
    const handlers = allSuccessHandlers({ ecu_discovery: () => { throw new Error('handler patladı'); } });
    const { orch } = harness({ ignitionOn: true, handlers });
    const snap = await orch.run({ vehicleFingerprintHash: HASH });
    // ecu_discovery kritik değil → fail-soft devam → terminal, ama full DEĞİL
    expect(snap.status).toBe('partial');
    expect(snap.completion.hasCompletedFullScan).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Cancel / event / progress
 * ════════════════════════════════════════════════════════════════════════ */

describe('cancel, event, progress', () => {
  it('11) cancel → cancelled + scan_cancelled', async () => {
    const { orch, events } = harness({ ignitionOn: true });
    orch.start({ vehicleFingerprintHash: HASH });
    await orch.runNextPhase();                      // identity
    orch.cancel('user');
    expect(orch.getSnapshot().status).toBe('cancelled');
    expect(events.some((e) => e.type === 'scan_cancelled')).toBe(true);
  });

  it('12) handler cancelled sonucu → tarama iptal', async () => {
    const handlers = { ecu_discovery: () => ({ status: 'cancelled' as const, reason: 'abort' }) };
    const { orch } = harness({ ignitionOn: true, handlers });
    const snap = await orch.run({ vehicleFingerprintHash: HASH });
    expect(snap.status).toBe('cancelled');
  });

  it('13) event sırası: scan_started ilk, scan_completed son, report_ready önce', async () => {
    const { orch, events } = harness({ ignitionOn: true });
    await orch.run({ vehicleFingerprintHash: HASH });
    expect(events[0].type).toBe('scan_started');
    expect(events[events.length - 1].type).toBe('scan_completed');
    const rIdx = events.findIndex((e) => e.type === 'report_ready');
    const cIdx = events.findIndex((e) => e.type === 'scan_completed');
    expect(rIdx).toBeGreaterThan(0);
    expect(rIdx).toBeLessThan(cIdx);
    // Her faz completed emit etti (12 faz)
    expect(events.filter((e) => e.type === 'phase_completed')).toHaveLength(DEEP_SCAN_PHASE_SEQUENCE.length);
  });

  it('14) progress monotonik artar, 100\'de biter, sahte yüzde yok', async () => {
    const { orch, events } = harness({ ignitionOn: true });
    await orch.run({ vehicleFingerprintHash: HASH });
    const progresses = events.filter((e) => e.type === 'progress_changed').map((e) => e.progressPercent);
    for (let i = 1; i < progresses.length; i++) expect(progresses[i]).toBeGreaterThanOrEqual(progresses[i - 1]);
    expect(orch.getSnapshot().progressPercent).toBe(100);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Immutability / yaşam döngüsü / bounded / yalıtım
 * ════════════════════════════════════════════════════════════════════════ */

describe('immutability, yaşam döngüsü, bounded, yalıtım', () => {
  it('15) snapshot ve event immutable (frozen)', async () => {
    const { orch, events } = harness({ ignitionOn: true });
    await orch.run({ vehicleFingerprintHash: HASH });
    expect(Object.isFrozen(orch.getSnapshot())).toBe(true);
    expect(Object.isFrozen(events[0])).toBe(true);
  });

  it('16) duplicate start → no-op (ikinci start durumu değiştirmez)', () => {
    const { orch } = harness({ ignitionOn: true });
    orch.start({ vehicleFingerprintHash: HASH });
    const s1 = orch.getSnapshot();
    orch.start({ vehicleFingerprintHash: 'deadbeefdeadbeef' }); // ikinci start
    const s2 = orch.getSnapshot();
    expect(s2.mode).toBe(s1.mode);
    expect(s2.currentPhaseIndex).toBe(s1.currentPhaseIndex);
  });

  it('17) bounded — çok sayıda ECU keşfi persistence tavanını aşmaz', async () => {
    const many = Array.from({ length: 300 }, (_, i) => i.toString(16).padStart(4, '0'));
    const handlers = { ecu_discovery: () => ({ status: 'success' as const, ecus: many }) };
    const { orch, persistence } = harness({ ignitionOn: true, handlers });
    await orch.run({ vehicleFingerprintHash: HASH });
    const rec = persistence.load(HASH);
    expect(rec!.discoveredEcus.length).toBeLessThanOrEqual(128);
  });

  it('18) dispose zero-leak — listener temizlenir, sonrası no-op', async () => {
    const { orch } = harness({ ignitionOn: true });
    orch.subscribe(() => { /* */ });
    orch.start({ vehicleFingerprintHash: HASH });
    orch.dispose();
    expect(orch.listenerCount).toBe(0);
    expect(orch.isDisposed).toBe(true);
    await expect(orch.runNextPhase()).resolves.toBeDefined(); // güvenli no-op
  });

  it('19) subscribe/unsubscribe + duplicate listener yok + hata izolasyonu', async () => {
    const { orch } = harness({ ignitionOn: true });
    let good = 0;
    const fn = () => { good++; };
    orch.subscribe(fn);
    orch.subscribe(fn);                             // duplicate → tek
    orch.subscribe(() => { throw new Error('kötü'); });
    orch.start({ vehicleFingerprintHash: HASH });   // scan_started → good +1
    expect(good).toBe(1);
  });

  it('20) reset → yeni tarama başlatılabilir (kapsam kütüğü de sıfırlanır)', async () => {
    const { orch } = harness({ ignitionOn: true, handlers: allSuccessHandlers() });
    await orch.run({ vehicleFingerprintHash: HASH });
    expect(orch.getSnapshot().status).toBe('completed');
    orch.reset();
    expect(orch.getSnapshot().status).toBe('idle');
    expect(orch.getCoverageLedger().attemptedPhases).toHaveLength(0);   // kütük devretmedi
    const snap = await orch.run({ vehicleFingerprintHash: HASH });
    expect(snap.status).toBe('completed');
  });

  it('21) kaynak SystemBoot IMPORT etmez (wiring yok), import yan etkisiz', () => {
    expect(/from\s+['"][^'"]*SystemBoot['"]/.test(orchestratorSource)).toBe(false);
    // Deep Scan katmanlarını import eder ama SystemBoot'a bağlanmaz.
    expect(/from\s+['"]\.\/deepScanRuntimeService['"]/.test(orchestratorSource)).toBe(true);
  });
});
