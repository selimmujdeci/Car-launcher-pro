/**
 * deepScanCompletionTruth.test.ts — DEEP SCAN COMPLETION TRUTH / COVERAGE LEDGER kilitleri.
 *
 * DÜZELTİLEN HATA: handler'ı olmayan faz `{ status:'skipped' }` üretiyor, `skipped`
 * başarı EŞDEĞERİ sayılıyor ve pipeline sonuna ulaşan tarama `completeScan()` çağırıp
 * `hasCompletedFullScan = true` yazabiliyordu → GERÇEK KAPSAM OLMADAN "tam tarandı".
 *
 * YENİ SÖZLEŞME (bu testler zayıflatılamaz/silinemez — CLAUDE.md regresyon kasası):
 *  - `full` kararını YALNIZ saf `evaluateDeepScanCompletion(ledger)` verir (tek otorite).
 *  - skipped · handler_unavailable · timeout · budget_exhausted · failed · partial ·
 *    cancelled · unknown · denenmemiş zorunlu faz · safety/ignition kapısı ·
 *    persistence finalize hatası → HİÇBİRİ full completion ÜRETEMEZ.
 *  - Terminal olmak ≠ tam tamamlanmak. Terminal ama eksik tarama `partial`dır.
 *  - Eksik tarama baseline/change-detection uygunluğu ÜRETMEZ.
 *  - Bilinmeyen faz durumu FAIL-CLOSED'dur.
 *
 * Gerçek OBD/native/SQL YOK — enjekte runtime/persistence/ignition + kontrollü saat.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildDeepScanCoverageLedger,
  createDeepScanIgnitionSource,
  createDeepScanOrchestrator,
  evaluateDeepScanCompletion,
  missingCompletionOutcome,
  ALL_DEEP_SCAN_PHASES,
  DEEP_SCAN_PHASE_SEQUENCE,
  DeepScanPersistenceStore,
  DeepScanRuntimeService,
  type DeepScanCompletionOutcome,
  type DeepScanPersistInput,
  type DeepScanPhase,
  type DeepScanRecord,
  type DeepScanSnapshot,
  type DeepScanStoreIO,
  type PhaseHandler,
  type PhaseResult,
} from '../platform/deepScan';
import {
  createChangeBaselineAdapter,
  type ChangeBaselineDeps,
} from '../platform/deepScan/changeBaselineAdapter';
import { createOfflineChangeDetectionHandler } from '../platform/deepScan/offlineChangeDetectionHandler';
import type { VehicleFingerprint } from '../platform/vehicleFingerprintService';

const NOW = 4_000_000;
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

function allSuccessHandlers(
  over: Partial<Record<DeepScanPhase, PhaseHandler>> = {},
): Partial<Record<DeepScanPhase, PhaseHandler>> {
  const h: Partial<Record<DeepScanPhase, PhaseHandler>> = {};
  for (const phase of DEEP_SCAN_PHASE_SEQUENCE) h[phase] = () => ({ status: 'success' as const });
  return { ...h, ...over };
}

/** Handler'sız bırakmak istenen fazı haritadan SİLER (gerçek "handler yok" durumu). */
function withoutHandler(phase: DeepScanPhase): Partial<Record<DeepScanPhase, PhaseHandler>> {
  const h = allSuccessHandlers();
  delete h[phase];
  return h;
}

interface HarnessOpts {
  handlers?: Partial<Record<DeepScanPhase, PhaseHandler>>;
  ignitionOn?: boolean;
  persistence?: DeepScanPersistenceStore;
}

function harness(opts: HarnessOpts = {}) {
  const runtime = new DeepScanRuntimeService({ now });
  const io = memIO();
  const persistence = opts.persistence ?? new DeepScanPersistenceStore('k-truth', 16, 5000, io.io, now);
  const ignition = createDeepScanIgnitionSource({ now, allowManualOverride: true });
  if (opts.ignitionOn !== false) ignition.setManualOverride(true);
  const orch = createDeepScanOrchestrator({
    runtime, persistence, ignitionSource: ignition,
    handlers: opts.handlers as Partial<Record<string, PhaseHandler>> | undefined,
    now,
  });
  return { runtime, persistence, ignition, orch };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Tam kapsam — TEK geçerli "full" yolu
 * ════════════════════════════════════════════════════════════════════════ */

describe('1) bütün zorunlu fazlar gerçek handler ile başarılı', () => {
  it('finalVerdict=full · hasCompletedFullScan=true · kayıt da full yazar', async () => {
    const { orch, persistence } = harness({ handlers: allSuccessHandlers() });
    const snap = await orch.run({ vehicleFingerprintHash: HASH });

    expect(snap.status).toBe('completed');
    expect(snap.completion.finalVerdict).toBe('full');
    expect(snap.completion.completionEligibility).toBe('eligible');
    expect(snap.completion.hasCompletedFullScan).toBe(true);
    expect(snap.completion.incompleteReasons).toEqual([]);
    expect(snap.completion.coverage.completedCount).toBe(DEEP_SCAN_PHASE_SEQUENCE.length);

    const rec = persistence.load(HASH)!;
    expect(rec.hasCompletedFullScan).toBe(true);
    expect(rec.lastFinalVerdict).toBe('full');
    expect(rec.lastScanTerminal).toBe(true);
    expect(rec.completedScanCount).toBe(1);
    expect(rec.partialScanCount).toBe(0);
    expect(rec.lastCoverage!.requiredCount).toBe(DEEP_SCAN_PHASE_SEQUENCE.length);
  });

  it('kütük tüm fazları "attempted + completed" olarak taşır', async () => {
    const { orch } = harness({ handlers: allSuccessHandlers() });
    await orch.run({ vehicleFingerprintHash: HASH });
    const ledger = orch.getCoverageLedger();
    expect([...ledger.attemptedPhases].sort()).toEqual([...DEEP_SCAN_PHASE_SEQUENCE].sort());
    expect(ledger.completedPhases).toHaveLength(DEEP_SCAN_PHASE_SEQUENCE.length);
    expect(ledger.skippedPhases).toEqual([]);
    expect(ledger.unavailablePhases).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2-7, 11 · Zorunlu fazın her başarısız/eksik hâli full'ü ENGELLER
 * ════════════════════════════════════════════════════════════════════════ */

describe('2-7,11) zorunlu faz kusurları full completion üretemez', () => {
  it('2) bir zorunlu fazın handler’ı YOK → full değil, reason handler_unavailable', async () => {
    const { orch, persistence } = harness({ handlers: withoutHandler('capability_analysis') });
    const snap = await orch.run({ vehicleFingerprintHash: HASH });

    expect(snap.status).not.toBe('completed');
    expect(snap.completion.finalVerdict).not.toBe('full');
    expect(snap.completion.hasCompletedFullScan).toBe(false);
    expect(snap.completion.incompleteReasons).toContain('required_phase_handler_unavailable');
    expect(orch.getCoverageLedger().unavailablePhases).toContain('capability_analysis');
    expect(persistence.load(HASH)!.hasCompletedFullScan).toBe(false);
  });

  it('2b) HİÇ handler yok (üretim varsayılanı) → tüm fazlar handler_unavailable, full DEĞİL', async () => {
    const { orch, persistence } = harness();                 // handlers verilmedi
    const snap = await orch.run({ vehicleFingerprintHash: HASH });

    expect(snap.status).toBe('partial');
    expect(snap.completion.finalVerdict).toBe('incomplete');   // tek bir faz bile tamamlanmadı
    expect(snap.completion.hasCompletedFullScan).toBe(false);
    expect(snap.completion.coverage.unavailableCount).toBe(DEEP_SCAN_PHASE_SEQUENCE.length);
    expect(persistence.load(HASH)!.hasCompletedFullScan).toBe(false);
    expect(persistence.resolveMode(HASH)).toBe('FULL_SCAN');   // sonraki bağlantı YİNE tam tarama
  });

  it('3) bir zorunlu faz skipped → full değil', async () => {
    const { orch } = harness({ handlers: allSuccessHandlers({ knowledge_update: () => ({ status: 'skipped' as const }) }) });
    const snap = await orch.run({ vehicleFingerprintHash: HASH });

    expect(snap.completion.finalVerdict).not.toBe('full');
    expect(snap.completion.hasCompletedFullScan).toBe(false);
    expect(snap.completion.incompleteReasons).toContain('required_phase_skipped');
  });

  it('4) timeout → full değil; neden PERSIST edilir', async () => {
    const { orch, persistence } = harness({ handlers: allSuccessHandlers({ evidence_update: () => ({ status: 'timeout' as const }) }) });
    const snap = await orch.run({ vehicleFingerprintHash: HASH });

    expect(snap.completion.hasCompletedFullScan).toBe(false);
    expect(snap.completion.incompleteReasons).toContain('required_phase_timeout');
    const rec = persistence.load(HASH)!;
    expect(rec.hasCompletedFullScan).toBe(false);
    expect(rec.lastIncompleteReasons).toContain('required_phase_timeout');
    expect(rec.lastFinalVerdict).toBe('partial');
  });

  it('5) budget_exhausted → full değil', async () => {
    const { orch, persistence } = harness({
      handlers: allSuccessHandlers({ standard_pid_discovery: () => ({ status: 'budget_exhausted' as const, errorCode: 'pid_budget' }) }),
    });
    const snap = await orch.run({ vehicleFingerprintHash: HASH });

    expect(snap.completion.hasCompletedFullScan).toBe(false);
    expect(snap.completion.incompleteReasons).toContain('required_phase_budget_exhausted');
    expect(persistence.load(HASH)!.lastIncompleteReasons).toContain('required_phase_budget_exhausted');
  });

  it('6) failed (error) faz → full değil', async () => {
    const { orch } = harness({ handlers: allSuccessHandlers({ ecu_discovery: () => ({ status: 'error' as const, errorCode: 'boom' }) }) });
    const snap = await orch.run({ vehicleFingerprintHash: HASH });

    expect(snap.completion.hasCompletedFullScan).toBe(false);
    expect(snap.completion.incompleteReasons).toContain('required_phase_failed');
  });

  it('7) partial faz sonucu → full değil', async () => {
    const { orch, persistence } = harness({
      handlers: allSuccessHandlers({ firmware_inventory: () => ({ status: 'partial' as const, reason: 'kismi' }) }),
    });
    const snap = await orch.run({ vehicleFingerprintHash: HASH });

    expect(snap.completion.hasCompletedFullScan).toBe(false);
    expect(snap.completion.incompleteReasons).toContain('required_phase_partial');
    expect(persistence.load(HASH)!.lastFinalVerdict).toBe('partial');
  });

  it('11) BİLİNMEYEN faz durumu → fail-closed, full OLAMAZ', async () => {
    const bogus = (): PhaseResult => ({ status: 'yeni_bilinmeyen_durum' } as unknown as PhaseResult);
    const { orch } = harness({ handlers: allSuccessHandlers({ report_generation: bogus }) });
    const snap = await orch.run({ vehicleFingerprintHash: HASH });

    expect(snap.completion.hasCompletedFullScan).toBe(false);
    expect(snap.completion.incompleteReasons).toContain('required_phase_unknown_status');
    expect(orch.getCoverageLedger().unknownPhases).toContain('report_generation');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8-10 · İptal · güvenlik kapısı · terminal ≠ tam
 * ════════════════════════════════════════════════════════════════════════ */

describe('8-10) iptal, güvenlik kapısı, terminal ≠ tam', () => {
  it('8) iptal edilmiş tarama → full değil (verdict cancelled)', async () => {
    const { orch, persistence } = harness({
      handlers: allSuccessHandlers({ ecu_discovery: () => ({ status: 'cancelled' as const, reason: 'abort' }) }),
    });
    const snap = await orch.run({ vehicleFingerprintHash: HASH });

    expect(snap.status).toBe('cancelled');
    expect(snap.completion.finalVerdict).toBe('cancelled');
    expect(snap.completion.hasCompletedFullScan).toBe(false);
    const rec = persistence.load(HASH)!;
    expect(rec.hasCompletedFullScan).toBe(false);
    expect(rec.lastFinalVerdict).toBe('cancelled');
    expect(rec.lastIncompleteReasons).toContain('scan_cancelled');
    expect(rec.completedScanCount).toBe(0);
  });

  it('8b) kullanıcı cancel() → full değil', async () => {
    const { orch } = harness({ handlers: allSuccessHandlers() });
    orch.start({ vehicleFingerprintHash: HASH });
    await orch.runNextPhase();
    orch.cancel('user');
    expect(orch.getSnapshot().status).toBe('cancelled');
    expect(orch.getCompletionOutcome().hasCompletedFullScan).toBe(false);
  });

  it('9) kontak BİLİNMİYOR (safety blocked) → full değil, tarama ilerlemez', async () => {
    const { orch, persistence } = harness({ ignitionOn: false, handlers: allSuccessHandlers() });
    const snap = await orch.run({ vehicleFingerprintHash: HASH });

    expect(snap.status).toBe('waiting_for_ignition');
    const outcome = orch.getCompletionOutcome();
    expect(outcome.finalVerdict).not.toBe('full');
    expect(outcome.hasCompletedFullScan).toBe(false);
    expect(outcome.incompleteReasons).toContain('safety_blocked');
    expect(outcome.incompleteReasons).toContain('required_phase_not_attempted');
    expect(persistence.hasCompletedFullScan(HASH)).toBe(false);
  });

  it('10) bütün fazlar terminale ulaşsa da biri skipped → terminal EVET, full HAYIR', async () => {
    const { orch, persistence } = harness({
      handlers: allSuccessHandlers({ change_detection: () => ({ status: 'skipped' as const }) }),
    });
    const snap = await orch.run({ vehicleFingerprintHash: HASH });

    expect(snap.currentPhaseIndex).toBe(DEEP_SCAN_PHASE_SEQUENCE.length);   // sıra bitti
    expect(snap.runtimeStatus).toBe('completed');                            // state machine terminal
    expect(snap.status).toBe('partial');                                     // ama kapsam eksik
    const rec = persistence.load(HASH)!;
    expect(rec.lastScanTerminal).toBe(true);
    expect(rec.hasCompletedFullScan).toBe(false);
    expect(rec.partialScanCount).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 12-13, 17-18 · Persistence sözleşmesi
 * ════════════════════════════════════════════════════════════════════════ */

function completedSnapshot(over: Partial<DeepScanSnapshot> = {}): DeepScanSnapshot {
  return {
    scanId: 'scan-1', vehicleFingerprintHash: HASH, status: 'completed', mode: 'FULL_SCAN',
    phase: 'report_generation', progressPercent: 100, startedAt: NOW - 100, updatedAt: NOW,
    completedAt: NOW, isFirstScan: true, ignitionRequired: true, ignitionConfirmed: true,
    discoveredEcuCount: 0, discoveredPidCount: 0, discoveredDidCount: 0, newDiscoveriesCount: 0,
    changedFirmware: false, changedEcu: false, warnings: [], errorCode: null, reportSummary: null,
    ...over,
  };
}

function fullCompletion(scanId: string): DeepScanCompletionOutcome {
  return evaluateDeepScanCompletion(buildDeepScanCoverageLedger({
    scanId,
    entries: ALL_DEEP_SCAN_PHASES.map((phase) => ({ phase, status: 'completed' as const })),
    persistenceFinalized: true,
  }));
}

function partialCompletion(scanId: string): DeepScanCompletionOutcome {
  return evaluateDeepScanCompletion(buildDeepScanCoverageLedger({
    scanId,
    entries: ALL_DEEP_SCAN_PHASES.map((phase, i) => ({
      phase, status: i === 0 ? ('skipped' as const) : ('completed' as const),
    })),
    persistenceFinalized: true,
  }));
}

describe('12-13,17-18) persistence yükseltme kapısı', () => {
  it('12) kısmi sonuç hasCompletedFullScan=false YAZAR (nedenlerle birlikte)', () => {
    const s = new DeepScanPersistenceStore('k-p1', 16, 5000, memIO().io, now);
    const rec = s.completeScan({ snapshot: completedSnapshot(), completion: partialCompletion('scan-1') })!;

    expect(rec.hasCompletedFullScan).toBe(false);
    expect(rec.lastFinalVerdict).toBe('partial');
    expect(rec.lastIncompleteReasons).toContain('required_phase_skipped');
    expect(rec.lastScanTerminal).toBe(true);
    expect(rec.completedScanCount).toBe(0);
    expect(rec.partialScanCount).toBe(1);
    expect(s.resolveMode(HASH)).toBe('FULL_SCAN');     // kısmi tarama change_check AÇMAZ
  });

  it('12b) KANIT YOK → fail-closed (completion_evidence_missing), yükseltme YOK', () => {
    const s = new DeepScanPersistenceStore('k-p2', 16, 5000, memIO().io, now);
    const rec = s.completeScan({ snapshot: completedSnapshot() })!;   // completion verilmedi

    expect(rec.hasCompletedFullScan).toBe(false);
    expect(rec.lastFinalVerdict).toBe('incomplete');
    expect(rec.lastIncompleteReasons).toContain('completion_evidence_missing');
    expect(rec.completedScanCount).toBe(0);
  });

  it('12c) SAHTE kanıt (verdict full ama nedenler dolu) REDDEDİLİR', () => {
    const s = new DeepScanPersistenceStore('k-p3', 16, 5000, memIO().io, now);
    const forged = {
      ...partialCompletion('scan-1'),
      finalVerdict: 'full' as const,
      hasCompletedFullScan: true,
      completionEligibility: 'eligible' as const,
    };
    const rec = s.completeScan({ snapshot: completedSnapshot(), completion: forged })!;

    expect(rec.hasCompletedFullScan).toBe(false);      // tutarsız çift → iddia düşürülür
    expect(rec.lastFinalVerdict).toBe('incomplete');
  });

  it('13) full sayaç YALNIZ gerçek full taramada artar', () => {
    const s = new DeepScanPersistenceStore('k-p4', 16, 5000, memIO().io, now);
    s.completeScan({ snapshot: completedSnapshot({ scanId: 'p-1' }), completion: partialCompletion('p-1') });
    s.completeScan({ snapshot: completedSnapshot({ scanId: 'p-2' }), completion: partialCompletion('p-2') });
    expect(s.load(HASH)!.completedScanCount).toBe(0);
    expect(s.load(HASH)!.partialScanCount).toBe(2);
    expect(s.load(HASH)!.hasCompletedFullScan).toBe(false);

    s.completeScan({ snapshot: completedSnapshot({ scanId: 'f-1' }), completion: fullCompletion('f-1') });
    expect(s.load(HASH)!.completedScanCount).toBe(1);
    expect(s.load(HASH)!.hasCompletedFullScan).toBe(true);
    expect(s.resolveMode(HASH)).toBe('CHANGE_CHECK');
  });

  it('17) aynı scan iki kez finalize edilse bile sayaç İKİ KEZ ARTMAZ (idempotent)', async () => {
    const { orch, persistence } = harness({ handlers: allSuccessHandlers() });
    await orch.run({ vehicleFingerprintHash: HASH });
    await orch.run();                                   // terminal → ikinci finalize no-op
    await orch.runNextPhase();                          // yine no-op

    const rec = persistence.load(HASH)!;
    expect(rec.completedScanCount).toBe(1);
    expect(rec.hasCompletedFullScan).toBe(true);

    // Persistence katmanı da tek başına idempotenttir (aynı scanId iki kez).
    const scanId = rec.lastCompletedScanId!;
    persistence.completeScan({ snapshot: completedSnapshot({ scanId }), completion: fullCompletion(scanId) });
    expect(persistence.load(HASH)!.completedScanCount).toBe(1);
  });

  it('18) persistence THROW → full başarı İLAN EDİLMEZ', async () => {
    const throwing = {
      hasCompletedFullScan: () => false,
      saveSnapshot: (_i: DeepScanPersistInput): DeepScanRecord | null => { throw new Error('disk boom'); },
      completeScan: (_i: DeepScanPersistInput): DeepScanRecord | null => { throw new Error('disk boom'); },
    } as unknown as DeepScanPersistenceStore;
    const { orch } = harness({ handlers: allSuccessHandlers(), persistence: throwing });
    const snap = await orch.run({ vehicleFingerprintHash: HASH });

    expect(snap.status).not.toBe('completed');
    expect(snap.completion.hasCompletedFullScan).toBe(false);
    expect(snap.completion.incompleteReasons).toContain('persistence_not_finalized');
  });

  it('18b) parmak izi YOKSA kayıt oluşmaz → full başarı İLAN EDİLMEZ', async () => {
    const { orch } = harness({ handlers: allSuccessHandlers() });
    const snap = await orch.run();                      // vehicleFingerprintHash verilmedi

    expect(snap.completion.hasCompletedFullScan).toBe(false);
    expect(snap.completion.incompleteReasons).toContain('persistence_not_finalized');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 14-15 · Baseline / change-detection koruması
 * ════════════════════════════════════════════════════════════════════════ */

function fp(over: Partial<VehicleFingerprint> = {}): VehicleFingerprint {
  return {
    hash: 'aaaaaaaabbbbbbbb',
    vin: 'WVWZZZ1JZXW000001',
    protocol: 'CAN_11B_500K',
    ecuAddresses: ['7E0', '7E8'],
    supportedPidBitmap: 'BE1FA813',
    metadata: { adapterMac: null, name: null, profileHint: null } as VehicleFingerprint['metadata'],
    firstSeen: 1000,
    lastSeen: 2000,
    ...over,
  };
}

function baselineRecord(over: Partial<DeepScanRecord> = {}): DeepScanRecord {
  return {
    schemaVersion: 1,
    vehicleFingerprintHash: 'aaaaaaaabbbbbbbb',
    lastScanId: 'scan-1', lastMode: 'FULL_SCAN', lastStatus: 'completed',
    firstScanAt: 100, lastScanStartedAt: 100, lastScanCompletedAt: 200, lastUpdatedAt: 200,
    hasCompletedFullScan: true, completedScanCount: 1, changeCheckCount: 0,
    lastProgressPercent: 100,
    discoveredEcus: ['7E0', '7E8'], discoveredPids: [], discoveredDids: [],
    firmwareInventory: [], capabilitySummary: null, newDiscoveriesCount: 0,
    changedFirmware: false, changedEcu: false, warnings: [], reportSummary: null,
    lastCompletedScanId: 'scan-1',
    lastScanTerminal: true, lastFinalVerdict: 'full', lastIncompleteReasons: [],
    lastCoverage: null, partialScanCount: 0,
    ...over,
  } as DeepScanRecord;
}

function baselineDeps(record: DeepScanRecord | null): ChangeBaselineDeps {
  return {
    fingerprintStore: { list: () => [fp()] } as unknown as ChangeBaselineDeps['fingerprintStore'],
    persistence: { load: () => record } as unknown as ChangeBaselineDeps['persistence'],
  };
}

describe('14-15) baseline / change-detection koruması', () => {
  it('14) EKSİK tarama kaydı baseline uygunluğu ÜRETMEZ → no_baseline', () => {
    const partialRec = baselineRecord({
      hasCompletedFullScan: false, lastFinalVerdict: 'partial', partialScanCount: 1,
    });
    const resolution = createChangeBaselineAdapter(baselineDeps(partialRec)).resolve();
    expect(resolution.kind).toBe('no_baseline');       // "değişiklik yok" DİYEMEZ
  });

  it('14b) eksik tarama sonrası handler "unchanged" DEMEZ (no_baseline)', async () => {
    const partialRec = baselineRecord({ hasCompletedFullScan: false, lastFinalVerdict: 'incomplete' });
    const handler = createOfflineChangeDetectionHandler({
      baseline: createChangeBaselineAdapter(baselineDeps(partialRec)),
    });
    const result = await handler({
      phase: 'change_detection', mode: 'FULL_SCAN',
      snapshot: { vehicleFingerprintHash: null } as unknown as DeepScanSnapshot,
      isCancelled: () => false,
    });
    expect(result.reason).toBe('no_baseline');
    expect(result.changedEcu).toBeUndefined();
    expect(result.changedFirmware).toBeUndefined();
  });

  it('15) TAM taranmış kayıt baseline olmaya devam eder (mevcut davranış bozulmaz)', async () => {
    const handler = createOfflineChangeDetectionHandler({
      baseline: createChangeBaselineAdapter(baselineDeps(baselineRecord())),
    });
    const result = await handler({
      phase: 'change_detection', mode: 'FULL_SCAN',
      snapshot: { vehicleFingerprintHash: null } as unknown as DeepScanSnapshot,
      isCancelled: () => false,
    });
    expect(result.status).toBe('success');
    expect(result.reason).toBe('unchanged_offline');
  });

  it('15b) offline pass HÂLÂ hiçbir completion/sayaç üretmez', async () => {
    const { orch, persistence, runtime } = harness({ ignitionOn: false });
    const rtComplete = vi.spyOn(runtime, 'completeScan');
    const psComplete = vi.spyOn(persistence, 'completeScan');

    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH });

    expect(summary.ran).toBe(true);
    expect(summary.skippedCount).toBe(6);              // offline `skipped` semantiği KORUNDU
    expect(rtComplete).not.toHaveBeenCalled();
    expect(psComplete).not.toHaveBeenCalled();
    expect(persistence.hasCompletedFullScan(HASH)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 16 · Mevcut iptal / devam davranışı bozulmadı
 * ════════════════════════════════════════════════════════════════════════ */

describe('16) mevcut iptal ve devam davranışı korunur', () => {
  it('kontak sonradan gelince tarama kaldığı yerden ilerler ve full olur', async () => {
    const { orch, ignition } = harness({ ignitionOn: false, handlers: allSuccessHandlers() });
    await orch.run({ vehicleFingerprintHash: HASH });
    expect(orch.getSnapshot().status).toBe('waiting_for_ignition');
    expect(orch.getSnapshot().currentPhaseIndex).toBe(0);       // aktif faz açılmadı

    ignition.setManualOverride(true);
    const snap = await orch.run();
    expect(snap.status).toBe('completed');
    expect(snap.completion.finalVerdict).toBe('full');          // güvenlik bayrağı temizlendi
  });

  it('cancel sonrası tarama devam ETMEZ ve full olmaz', async () => {
    const { orch } = harness({ handlers: allSuccessHandlers() });
    orch.start({ vehicleFingerprintHash: HASH });
    await orch.runNextPhase();
    orch.cancel('user');
    await orch.run();
    expect(orch.getSnapshot().status).toBe('cancelled');
    expect(orch.getCompletionOutcome().hasCompletedFullScan).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 19-20 · Saf değerlendiricinin kenar durumları (tek karar otoritesi)
 * ════════════════════════════════════════════════════════════════════════ */

describe('19-20) evaluateDeepScanCompletion — saf, deterministik, fail-closed', () => {
  it('19) BOŞ zorunlu faz kümesi → fail-closed (full DEĞİL)', () => {
    const outcome = evaluateDeepScanCompletion(buildDeepScanCoverageLedger({
      scanId: 's', requiredPhases: [], persistenceFinalized: true,
      entries: ALL_DEEP_SCAN_PHASES.map((phase) => ({ phase, status: 'completed' as const })),
    }));
    expect(outcome.finalVerdict).toBe('incomplete');
    expect(outcome.hasCompletedFullScan).toBe(false);
    expect(outcome.incompleteReasons).toContain('no_required_phases');
  });

  it('20) OPSİYONEL faz atlanması full’ü bozmaz; ZORUNLU faz atlanması bozar', () => {
    const required: DeepScanPhase[] = ['vehicle_identity', 'protocol_detection'];

    // 'knowledge_update' zorunlu kümede DEĞİL (opsiyonel) → skipped olsa da full.
    const okOutcome = evaluateDeepScanCompletion(buildDeepScanCoverageLedger({
      scanId: 's', requiredPhases: required, persistenceFinalized: true,
      entries: [
        { phase: 'vehicle_identity', status: 'completed' },
        { phase: 'protocol_detection', status: 'completed' },
        { phase: 'knowledge_update', status: 'skipped' },
      ],
    }));
    expect(okOutcome.finalVerdict).toBe('full');
    expect(okOutcome.hasCompletedFullScan).toBe(true);

    // Aynı senaryoda ZORUNLU bir faz skipped → full DEĞİL.
    const badOutcome = evaluateDeepScanCompletion(buildDeepScanCoverageLedger({
      scanId: 's', requiredPhases: required, persistenceFinalized: true,
      entries: [
        { phase: 'vehicle_identity', status: 'completed' },
        { phase: 'protocol_detection', status: 'skipped' },
      ],
    }));
    expect(badOutcome.finalVerdict).toBe('partial');
    expect(badOutcome.hasCompletedFullScan).toBe(false);
    expect(badOutcome.incompleteReasons).toContain('required_phase_skipped');
  });

  it('denenmemiş zorunlu faz → required_phase_not_attempted', () => {
    const outcome = evaluateDeepScanCompletion(buildDeepScanCoverageLedger({
      requiredPhases: ['vehicle_identity', 'protocol_detection'], persistenceFinalized: true,
      entries: [{ phase: 'vehicle_identity', status: 'completed' }],
    }));
    expect(outcome.hasCompletedFullScan).toBe(false);
    expect(outcome.incompleteReasons).toContain('required_phase_not_attempted');
  });

  it('aynı faz iki kez raporlanırsa EN KÖTÜ durum kazanır (fail-closed birleştirme)', () => {
    const outcome = evaluateDeepScanCompletion(buildDeepScanCoverageLedger({
      requiredPhases: ['vehicle_identity'], persistenceFinalized: true,
      entries: [
        { phase: 'vehicle_identity', status: 'completed' },
        { phase: 'vehicle_identity', status: 'timeout' },
      ],
    }));
    expect(outcome.hasCompletedFullScan).toBe(false);
    expect(outcome.incompleteReasons).toContain('required_phase_timeout');
  });

  it('deterministik + saf: aynı kütük aynı sonucu verir, girdi mutate edilmez', () => {
    const ledger = buildDeepScanCoverageLedger({
      scanId: 's', persistenceFinalized: true,
      entries: ALL_DEEP_SCAN_PHASES.map((phase) => ({ phase, status: 'completed' as const })),
    });
    const a = evaluateDeepScanCompletion(ledger);
    const b = evaluateDeepScanCompletion(ledger);
    expect(a).toEqual(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(ledger)).toBe(true);
    expect(ledger.completedPhases).toHaveLength(ALL_DEEP_SCAN_PHASES.length);
  });

  it('kanıt yokluğu sonucu (missingCompletionOutcome) asla full değildir', () => {
    const m = missingCompletionOutcome('s');
    expect(m.hasCompletedFullScan).toBe(false);
    expect(m.finalVerdict).toBe('incomplete');
    expect(m.incompleteReasons).toEqual(['completion_evidence_missing']);
  });

  it('model faz kümesi orchestrator faz sırası ile AYNI (sınıflandırılmamış faz yok)', () => {
    expect([...ALL_DEEP_SCAN_PHASES]).toEqual([...DEEP_SCAN_PHASE_SEQUENCE]);
  });
});
