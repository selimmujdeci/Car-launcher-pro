/**
 * maviEvidence.test.ts — MAVİ ÇEKİRDEĞİ · PR-DIAG-1 kanıt deposu sözleşmesi.
 *
 * KİLİTLENEN ANAYASAL KURAL: **RAPOR KARAR VERMEZ.** Hiçbir yerde PASS/FAIL/"çalışıyor" üretilmez;
 * yalnız OBSERVED / NOT_OBSERVED / NOT_TESTED / NO_SOURCE. Ledger'a YAZILMAZ.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildMaviEvidenceReport, aggregateSegments,
  recordLifecycleEvent, recordTakeoverDecision, recordMediaNext, recordBargeIn,
  recordSafety, recordLegacyExecution, recordLifecyclePhase, adjustRegistration,
  _resetMaviEvidenceForTest,
  SEGMENT_KEYS, PHASES_WITHOUT_SOURCE, MAX_DECISIONS, MAX_LIFECYCLE_EVENTS,
  type TakeoverDecisionRecord, type MediaNextRecord, type EvidenceVerdict,
} from '../platform/maviCore/wiring/maviEvidence';
import type { VoiceSessionTiming } from '../platform/maviCore/wiring/voiceStateBridge';
import type { TakeoverArbiterStats } from '../platform/maviCore/wiring/takeoverArbiter';

const ALLOWED_VERDICTS: readonly EvidenceVerdict[] = ['OBSERVED', 'NOT_OBSERVED', 'NOT_TESTED', 'NO_SOURCE'];

function decision(over: Partial<TakeoverDecisionRecord> = {}): TakeoverDecisionRecord {
  return {
    atMs: 1_000, generationId: 1, sessionId: 1,
    commandType: 'music_next', commandId: 'music_next#abc',
    resolvedAction: 'media.next',
    legacyCandidate: true, maviCandidate: true,
    flagState: 'takeover', allowlisted: true, ownershipDecision: true,
    claimOutcome: 'claimed', executedBy: 'mavi',
    executionResult: 'ok', releaseReason: 'completed', errorReason: null,
    ...over,
  };
}

function media(over: Partial<MediaNextRecord> = {}): MediaNextRecord {
  return {
    atMs: 1_000, cancelAssistantDuckCalled: true,
    hasQueue: true, hasSession: false, nextCalled: true,
    serviceResult: 'ok', typedFeedback: 'action_ok', errorReason: null,
    ...over,
  };
}

function timing(segments: Record<string, number>, diagnostics: string[] = []): VoiceSessionTiming {
  return { generationId: 1, sessionId: 1, segments, diagnostics, at: 0 } as VoiceSessionTiming;
}

beforeEach(() => { _resetMaviEvidenceForTest(); });

/* ── 1. Anayasal kural: rapor karar vermez ───────────────── */

describe('maviEvidence — rapor ASLA karar vermez', () => {
  it('boş rapor bile geçerli sözleşme + ledgerUpdated:false döner', () => {
    const r = buildMaviEvidenceReport();
    expect(r.contract).toBe('evidence-only');
    expect(r.ledgerUpdated).toBe(false);
  });

  it('TÜM verdict değerleri yalnız 4 izinli değerden biridir (PASS/FAIL YOK)', () => {
    recordTakeoverDecision(decision());
    recordMediaNext(media());
    const r = buildMaviEvidenceReport({ ownership: null });
    for (const it of [...r.checklist, ...r.phaseCoverage]) {
      expect(ALLOWED_VERDICTS).toContain(it.verdict);
    }
  });

  it('serileştirilmiş raporda PASS/FAIL/"çalışıyor" karar sözcüğü GEÇMEZ', () => {
    recordLifecycleEvent({ phase: 'listening', atMs: 1, atMono: 1, generationId: 1, sessionId: 1 });
    recordTakeoverDecision(decision());
    recordMediaNext(media());
    recordSafety({ atMs: 1, actionId: 'media.next', decision: 'allowed', readOnly: true, reason: null });
    const json = JSON.stringify(buildMaviEvidenceReport({ ownership: null }));
    for (const banned of ['"PASS"', '"FAIL"', 'passed', 'çalışıyor', 'başarılı', 'SUCCESS']) {
      expect(json).not.toContain(banned);
    }
  });

  it('hiçbir kayıt fonksiyonu ledger döndürmez / yazmaz (ledgerUpdated sabit false)', () => {
    recordTakeoverDecision(decision());
    expect(buildMaviEvidenceReport().ledgerUpdated).toBe(false);
  });
});

/* ── 2. NOT_TESTED vs NOT_OBSERVED vs NO_SOURCE ──────────── */

describe('maviEvidence — üç-değerli gözlem ayrımı', () => {
  it('hiç deneme yoksa NOT_TESTED (asla NOT_OBSERVED)', () => {
    const r = buildMaviEvidenceReport();
    const ids = ['takeover.decisions', 'media.precondition', 'bargein.stale', 'lifecycle.noLeak', 'telemetry.segments'];
    for (const id of ids) {
      expect(r.checklist.find((c) => c.id === id)?.verdict).toBe('NOT_TESTED');
    }
  });

  it('deneme VAR ama kanıt yoksa NOT_OBSERVED', () => {
    // Ön-koşul yokken next çağrılmış → ihlal.
    recordMediaNext(media({ hasQueue: false, hasSession: false, nextCalled: true }));
    const r = buildMaviEvidenceReport();
    expect(r.checklist.find((c) => c.id === 'media.precondition')?.verdict).toBe('NOT_OBSERVED');
  });

  it('emit edilmeyen fazlar NO_SOURCE (NOT_OBSERVED DEĞİL — yanıltmaz)', () => {
    recordLifecycleEvent({ phase: 'listening', atMs: 1, atMono: 1, generationId: 1, sessionId: 1 });
    const r = buildMaviEvidenceReport();
    for (const phase of PHASES_WITHOUT_SOURCE) {
      const it = r.phaseCoverage.find((p) => p.id === `phase.${phase}`);
      expect(it?.verdict).toBe('NO_SOURCE');
      expect(it?.reason).toContain('ölçüm kanalı yok');
    }
  });

  it('gözlenen faz OBSERVED, hiç gelmeyen faz (başkaları varken) NOT_OBSERVED', () => {
    recordLifecycleEvent({ phase: 'listening', atMs: 1, atMono: 1, generationId: 1, sessionId: 1 });
    const r = buildMaviEvidenceReport();
    expect(r.phaseCoverage.find((p) => p.id === 'phase.listening')?.verdict).toBe('OBSERVED');
    expect(r.phaseCoverage.find((p) => p.id === 'phase.timeout')?.verdict).toBe('NOT_OBSERVED');
  });
});

/* ── 3. Çift yürütme tespiti (KRİTİK) ────────────────────── */

describe('maviEvidence — çift yürütme kritik hata üretir', () => {
  it('aynı anahtar hem Mavi hem legacy tarafından çalıştırılmışsa KRİTİK', () => {
    recordTakeoverDecision(decision({ executedBy: 'mavi' }));
    recordTakeoverDecision(decision({ executedBy: 'legacy', ownershipDecision: false, claimOutcome: null }));
    const r = buildMaviEvidenceReport();
    expect(r.criticalFindings.some((f) => f.includes('ÇİFT YÜRÜTME'))).toBe(true);
    expect(r.checklist.find((c) => c.id === 'takeover.singlePath')?.verdict).toBe('NOT_OBSERVED');
  });

  it('sahiplik kararı false iken Mavi yürütmüşse KRİTİK', () => {
    recordTakeoverDecision(decision({ ownershipDecision: false, executedBy: 'mavi' }));
    const r = buildMaviEvidenceReport();
    expect(r.criticalFindings.some((f) => f.includes('sahiplik kararı false'))).toBe(true);
  });

  it('media.next hem Mavi hem eski hatta sayılmışsa KRİTİK', () => {
    recordTakeoverDecision(decision({ executedBy: 'mavi' }));
    recordLegacyExecution('mediaNext');
    const r = buildMaviEvidenceReport();
    expect(r.criticalFindings.some((f) => f.includes('tek hat garantisi'))).toBe(true);
    expect(r.mediaNextTotals.maviExecuted).toBe(1);
    expect(r.mediaNextTotals.legacyExecuted).toBe(1);
  });

  it('tek hat çalıştıysa KRİTİK BULGU YOK ve singlePath OBSERVED', () => {
    recordTakeoverDecision(decision({ executedBy: 'mavi' }));
    const r = buildMaviEvidenceReport();
    expect(r.criticalFindings).toHaveLength(0);
    expect(r.checklist.find((c) => c.id === 'takeover.singlePath')?.verdict).toBe('OBSERVED');
  });
});

/* ── 4. Segment toplaması (mevcut kaynaktan türetilir) ───── */

describe('maviEvidence — segment istatistikleri', () => {
  it('min/max/ortalama/adet doğru hesaplanır', () => {
    const stats = aggregateSegments([
      timing({ wakeToListening: 100 }),
      timing({ wakeToListening: 300 }),
      timing({ wakeToListening: 200 }),
    ]);
    expect(stats.wakeToListening).toEqual({ count: 3, minMs: 100, maxMs: 300, avgMs: 200 });
  });

  it('örnek yoksa count:0 (uydurma değer YOK)', () => {
    const stats = aggregateSegments([]);
    for (const k of SEGMENT_KEYS) expect(stats[k]).toEqual({ count: 0, minMs: 0, maxMs: 0, avgMs: 0 });
  });

  it('geçersiz/negatif süre yok sayılır (ölçüm kirlenmez)', () => {
    const stats = aggregateSegments([
      timing({ wakeToListening: -5 }),
      timing({ wakeToListening: Number.NaN }),
      timing({ wakeToListening: 50 }),
    ]);
    expect(stats.wakeToListening.count).toBe(1);
    expect(stats.wakeToListening.avgMs).toBe(50);
  });

  it('5 segmentin tamamı ölçülmüşse OBSERVED, eksikse NOT_OBSERVED + eksik liste', () => {
    const full = Object.fromEntries(SEGMENT_KEYS.map((k) => [k, 10]));
    let r = buildMaviEvidenceReport({ timings: [timing(full)] });
    expect(r.checklist.find((c) => c.id === 'telemetry.segments')?.verdict).toBe('OBSERVED');

    _resetMaviEvidenceForTest();
    r = buildMaviEvidenceReport({ timings: [timing({ wakeToListening: 10 })] });
    const it = r.checklist.find((c) => c.id === 'telemetry.segments');
    expect(it?.verdict).toBe('NOT_OBSERVED');
    expect(it?.reason).toContain('planToExecution');
  });

  it('telemetri güvenilirlik notları (eksik/sıra-dışı) raporda tekilleştirilir', () => {
    const r = buildMaviEvidenceReport({
      timings: [timing({ wakeToListening: 1 }, ['out_of_order:plan']), timing({ wakeToListening: 2 }, ['out_of_order:plan'])],
    });
    expect(r.telemetryDiagnostics).toEqual(['out_of_order:plan']);
  });
});

/* ── 5. Ownership (mevcut arbiter.stats() okunur) ────────── */

describe('maviEvidence — sahiplik yaşam döngüsü', () => {
  const stats = (over: Partial<TakeoverArbiterStats> = {}): TakeoverArbiterStats => ({
    active: true, mode: 'takeover', claimed: 2, duplicates: 1, staleRejected: 1,
    notEligible: 0, released: 2, timedOut: 0, superseded: 0,
    maxGeneration: 3, ownedActionId: null, ...over,
  });

  it('claim>0 ise OBSERVED ve tüm sayaçlar kanıta girer', () => {
    const r = buildMaviEvidenceReport({ ownership: stats() });
    const it = r.checklist.find((c) => c.id === 'ownership.lifecycle');
    expect(it?.verdict).toBe('OBSERVED');
    expect(it?.evidence).toMatchObject({ claimed: 2, duplicates: 1, staleRejected: 1, released: 2 });
  });

  it('released < claimed ise NOT_OBSERVED (açık sahiplik kalmış olabilir)', () => {
    const r = buildMaviEvidenceReport({ ownership: stats({ claimed: 3, released: 1 }) });
    const it = r.checklist.find((c) => c.id === 'ownership.released');
    expect(it?.verdict).toBe('NOT_OBSERVED');
    expect(it?.reason).toContain('released < claimed');
  });

  it('hiç claim yoksa NOT_TESTED (başarısız DEĞİL)', () => {
    const r = buildMaviEvidenceReport({ ownership: stats({ claimed: 0, released: 0 }) });
    expect(r.checklist.find((c) => c.id === 'ownership.lifecycle')?.verdict).toBe('NOT_TESTED');
  });
});

/* ── 6. Lifecycle sızıntısı ──────────────────────────────── */

describe('maviEvidence — lifecycle sızıntı tespiti', () => {
  it('tek kayıt → OBSERVED', () => {
    recordLifecyclePhase('start');
    adjustRegistration('commandListener', 1);
    adjustRegistration('voiceStateSubscription', 1);
    adjustRegistration('guard', 1);
    expect(buildMaviEvidenceReport().checklist.find((c) => c.id === 'lifecycle.noLeak')?.verdict).toBe('OBSERVED');
  });

  it('çift kayıt → NOT_OBSERVED + sızıntı gerekçesi', () => {
    recordLifecyclePhase('start');
    adjustRegistration('commandListener', 2);
    const it = buildMaviEvidenceReport().checklist.find((c) => c.id === 'lifecycle.noLeak');
    expect(it?.verdict).toBe('NOT_OBSERVED');
    expect(it?.reason).toContain('sızıntı');
  });

  it('dispose sonrası sayaç düşer (negatife inmez)', () => {
    adjustRegistration('commandListener', 1);
    adjustRegistration('commandListener', -1);
    adjustRegistration('commandListener', -1); // fazladan sökme
    expect(buildMaviEvidenceReport().lifecycleCounters.commandListeners).toBe(0);
  });
});

/* ── 7. Safety ───────────────────────────────────────────── */

describe('maviEvidence — güvenlik kayıtları', () => {
  it('araç eylemi Mavi tarafından yürütülmüşse NOT_OBSERVED', () => {
    recordTakeoverDecision(decision({ resolvedAction: 'vehicle.health.read', executedBy: 'mavi' }));
    expect(buildMaviEvidenceReport().checklist.find((c) => c.id === 'safety.noVehicleTakeover')?.verdict).toBe('NOT_OBSERVED');
  });

  it('yalnız media.next yürütülmüşse OBSERVED', () => {
    recordTakeoverDecision(decision({ executedBy: 'mavi' }));
    expect(buildMaviEvidenceReport().checklist.find((c) => c.id === 'safety.noVehicleTakeover')?.verdict).toBe('OBSERVED');
  });

  it('hard_forbidden kararları sayılır', () => {
    recordSafety({ atMs: 1, actionId: 'ecu.write', decision: 'hard_forbidden', readOnly: false, reason: 'scope' });
    const it = buildMaviEvidenceReport().checklist.find((c) => c.id === 'safety.gate');
    expect(it?.verdict).toBe('OBSERVED');
    expect(it?.evidence).toMatchObject({ hardForbidden: 1 });
  });
});

/* ── 8. Bounded + fail-soft + yan etki yok ───────────────── */

describe('maviEvidence — bounded / fail-soft / yan etkisiz', () => {
  it('ring tavanları aşılmaz (sınırsız büyüme yok)', () => {
    for (let i = 0; i < MAX_DECISIONS + 25; i++) recordTakeoverDecision(decision({ commandId: `c${i}` }));
    for (let i = 0; i < MAX_LIFECYCLE_EVENTS + 40; i++) {
      recordLifecycleEvent({ phase: 'listening', atMs: i, atMono: i, generationId: 1, sessionId: 1 });
    }
    const r = buildMaviEvidenceReport();
    expect(r.takeoverDecisions.length).toBe(MAX_DECISIONS);
    expect(r.lifecycleEvents.length).toBe(MAX_LIFECYCLE_EVENTS);
    expect(r.takeoverDecisions[r.takeoverDecisions.length - 1]?.commandId).toBe(`c${MAX_DECISIONS + 24}`);
  });

  it('bozuk girdi kayıt fonksiyonlarını ÇÖKERTMEZ', () => {
    expect(() => recordTakeoverDecision(null as never)).not.toThrow();
    expect(() => recordMediaNext(undefined as never)).not.toThrow();
    expect(() => adjustRegistration('guard', Number.NaN)).not.toThrow();
    expect(() => buildMaviEvidenceReport()).not.toThrow();
  });

  it('import yan etkisi yok: temiz depo boş rapor üretir', () => {
    const r = buildMaviEvidenceReport();
    expect(r.lifecycleEvents).toHaveLength(0);
    expect(r.takeoverDecisions).toHaveLength(0);
    expect(r.mediaNext).toHaveLength(0);
    expect(r.bargeIns).toHaveLength(0);
    expect(r.safety).toHaveLength(0);
    expect(r.criticalFindings).toHaveLength(0);
  });

  it('barge-in kaydı stale kararını raporlar', () => {
    recordBargeIn({ atMs: 1, oldGeneration: 1, newGeneration: 2, staleDecision: true, cancelledExecution: true, releaseReason: 'stale' });
    const r = buildMaviEvidenceReport();
    expect(r.checklist.find((c) => c.id === 'bargein.stale')?.verdict).toBe('OBSERVED');
    expect(r.bargeIns[0]?.releaseReason).toBe('stale');
  });
});
