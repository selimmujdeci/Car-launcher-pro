/**
 * maviEvidenceSection.test.ts — MAVİ ÇEKİRDEĞİ · PR-DIAG-3 rapor bölümü sözleşmesi.
 *
 * KİLİTLENEN KURALLAR:
 *  - Bölüm YALNIZ DIAG-1/DIAG-2 verisini serileştirir; YENİ KARAR üretmez, ledger'a yazmaz.
 *  - Durum yalnız OBSERVED/NOT_OBSERVED/NOT_TESTED/NO_SOURCE. NO_SOURCE ↔ NOT_OBSERVED çevrilmez.
 *  - Serileştirilmiş çıktıda YASAKLI yorum sözcükleri (PASS/FAIL/… + Türkçe) GEÇMEZ.
 *  - Boş örneklemde 0 ms yerine null; kaynak yoksa firstAt/lastAt üretilmez.
 *  - Çift yürütmenin ÜÇ bağımsız işareti ayrı ayrı görünür; biri varsa takeover.singlePath NOT_OBSERVED.
 *  - Fail-soft: serileştirme patlarsa ana rapor düşmez; olgusal unavailable kaydı döner.
 *  - Gizlilik: ham transkript/wake adı/token/anahtar sızmaz.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildMaviEvidenceSection, collectMaviEvidenceSection,
  setMaviVoiceTimingsSource, _resetMaviEvidenceSectionForTest,
  neutralizeCode, BANNED_WORDS,
  type MaviEvidenceSection,
} from '../platform/maviCore/wiring/maviEvidenceSection';
import {
  recordLifecycleEvent, recordTakeoverDecision, recordMediaNext, recordBargeIn,
  recordSafety, recordLegacyExecution, recordLifecyclePhase, adjustRegistration,
  _resetMaviEvidenceForTest, commandCorrelationId,
  type TakeoverDecisionRecord, type MediaNextRecord,
} from '../platform/maviCore/wiring/maviEvidence';
import type { VoiceSessionTiming } from '../platform/maviCore/wiring/voiceStateBridge';
import type { TakeoverArbiterStats } from '../platform/maviCore/wiring/takeoverArbiter';

const ALLOWED = ['OBSERVED', 'NOT_OBSERVED', 'NOT_TESTED', 'NO_SOURCE'];

function decision(over: Partial<TakeoverDecisionRecord> = {}): TakeoverDecisionRecord {
  const generationId = over.generationId ?? 1;
  const sessionId = over.sessionId ?? 1;
  const commandId = over.commandId ?? 'music_next#abc';
  return {
    atMs: 1_000, generationId, sessionId,
    commandType: 'music_next', commandId,
    correlationId: commandCorrelationId(generationId, sessionId, commandId),
    resolvedAction: 'media.next',
    legacyCandidate: true, maviCandidate: true,
    flagState: 'takeover', allowlisted: true, ownershipDecision: true,
    claimOutcome: 'claimed', owner: 'mavi', executedBy: 'mavi',
    executionResult: 'ok', releaseReason: 'completed', errorReason: null,
    ...over,
  };
}

function media(over: Partial<MediaNextRecord> = {}): MediaNextRecord {
  return {
    atMs: 1_000, correlationId: 'g1.s1#music_next#abc', port: 'mavi', nextCallCount: 1,
    cancelAssistantDuckCalled: true,
    hasQueue: true, hasSession: false, nextCalled: true,
    serviceResult: 'ok', typedFeedback: 'action_ok', errorReason: null,
    ...over,
  };
}

function timing(segments: Record<string, number>, diagnostics: string[] = []): VoiceSessionTiming {
  return { generationId: 1, sessionId: 1, segments, diagnostics, at: 0 } as VoiceSessionTiming;
}

function ownershipStats(over: Partial<TakeoverArbiterStats> = {}): TakeoverArbiterStats {
  return {
    active: true, mode: 'takeover', claimed: 2, duplicates: 1, staleRejected: 1,
    notEligible: 0, released: 2, timedOut: 0, superseded: 0,
    maxGeneration: 3, ownedActionId: null, ...over,
  };
}

/** Bölümdeki tüm status alanlarını dolaşır (sözleşme sınırı). */
function allStatuses(s: MaviEvidenceSection): string[] {
  const out: string[] = [
    s.summary.takeoverSinglePath, s.commandDecisions.status, s.mediaNext.status,
    s.legacyExecutions.status, s.ownership.status, s.bargeIn.status,
    s.lifecycleRegistrations.status, s.safety.status,
  ];
  for (const p of s.lifecycle) out.push(p.status);
  for (const seg of s.latencySegments) out.push(seg.status);
  for (const g of s.knownMeasurementGaps) out.push(g.status);
  return out;
}

beforeEach(() => {
  _resetMaviEvidenceForTest();
  _resetMaviEvidenceSectionForTest();
});

/* ══════════════════════════════════════════════════════════════
 * A. Boş depolar — dürüst NOT_TESTED / NO_SOURCE, sahte 0 ms yok
 * ══════════════════════════════════════════════════════════════ */

describe('A · boş depo', () => {
  it('bölüm oluşur, sözleşme evidence-only, ledgerUpdated:false', () => {
    const s = buildMaviEvidenceSection();
    expect(s.contract).toBe('evidence-only');
    expect(s.ledgerUpdated).toBe(false);
    expect(s.unavailable).toBeUndefined();
  });

  it('tüm durumlar yalnız 4 izinli değerden biri', () => {
    const s = buildMaviEvidenceSection();
    for (const st of allStatuses(s)) expect(ALLOWED).toContain(st);
  });

  it('MAVI-INSTRUMENTATION-1: planning/executing/execution_result/speech_end artık kaynaklı — boş depoda diğerleri gibi NOT_TESTED', () => {
    const s = buildMaviEvidenceSection();
    const st = (p: string) => s.lifecycle.find((x) => x.phase === p)?.status;
    expect(st('planning')).toBe('NOT_TESTED');
    expect(st('executing')).toBe('NOT_TESTED');
    expect(st('execution_result')).toBe('NOT_TESTED');
    expect(st('speech_end')).toBe('NOT_TESTED');
    expect(st('listening')).toBe('NOT_TESTED');
    expect(st('wake_detected')).toBe('NOT_TESTED');
  });

  it('boş segmentte min/max/average = null (sahte 0 ms YOK), firstAt/lastAt üretilmez', () => {
    const s = buildMaviEvidenceSection();
    for (const seg of s.latencySegments) {
      expect(seg.count).toBe(0);
      expect(seg.minMs).toBeNull();
      expect(seg.maxMs).toBeNull();
      expect(seg.averageMs).toBeNull();
    }
    for (const p of s.lifecycle) {
      expect(p.count).toBe(0);
      expect(p).not.toHaveProperty('firstAtMs');
      expect(p).not.toHaveProperty('lastAtMs');
    }
  });

  it('safety kaynağı yok → NO_SOURCE; knownMeasurementGaps dürüst doludur', () => {
    const s = buildMaviEvidenceSection();
    expect(s.safety.status).toBe('NO_SOURCE');
    expect(s.knownMeasurementGaps.some((g) => g.area === 'safety.gate' && g.status === 'NO_SOURCE')).toBe(true);
    expect(s.knownMeasurementGaps.length).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════
 * B. Lifecycle kayıtları — OBSERVED + count + firstAt/lastAt + correlation
 * ══════════════════════════════════════════════════════════════ */

describe('B · lifecycle kayıtları', () => {
  it('OBSERVED faz count + firstAt/lastAt (min/max) doğru', () => {
    for (const at of [100, 300, 200]) {
      recordLifecycleEvent({ phase: 'listening', atMs: at, atMono: at, generationId: 1, sessionId: 1, correlationId: 'g1.s1' });
    }
    const s = buildMaviEvidenceSection();
    const listening = s.lifecycle.find((p) => p.phase === 'listening');
    expect(listening?.status).toBe('OBSERVED');
    expect(listening?.count).toBe(3);
    expect(listening?.firstAtMs).toBe(100);
    expect(listening?.lastAtMs).toBe(300);
    expect(s.summary.observedPhaseCount).toBe(1);
  });

  it('karar kaydında correlationId olduğu gibi korunur', () => {
    recordTakeoverDecision(decision({ generationId: 7, sessionId: 9, commandId: 'k' }));
    const s = buildMaviEvidenceSection();
    expect(s.commandDecisions.records[0].correlationId).toBe(commandCorrelationId(7, 9, 'k'));
  });
});

/* ══════════════════════════════════════════════════════════════
 * C. Segment istatistikleri — min/max/average/count + monotoniklik
 * ══════════════════════════════════════════════════════════════ */

describe('C · segment istatistikleri', () => {
  it('kaynağı olan segment OBSERVED + doğru istatistik; MAVI-INSTRUMENTATION-1 sonrası ölçülmeyen segment NOT_OBSERVED (NO_SOURCE değil)', () => {
    const s = buildMaviEvidenceSection({
      timings: [
        timing({ wakeToListening: 100, listeningToTranscript: 50 }),
        timing({ wakeToListening: 300 }),
        timing({ wakeToListening: 200 }),
      ],
    });
    const seg = (k: string) => s.latencySegments.find((x) => x.segment === k);
    expect(seg('wakeToListening')).toMatchObject({ status: 'OBSERVED', count: 3, minMs: 100, maxMs: 300, averageMs: 200 });
    expect(seg('listeningToTranscript')?.status).toBe('OBSERVED');
    // planToExecution artık KAYNAKLI (planning/executing gerçekten emit edilir) — bu örneklemde
    // yalnız ölçülmediği için NOT_OBSERVED, NO_SOURCE DEĞİL.
    expect(seg('planToExecution')?.status).toBe('NOT_OBSERVED');
    expect(seg('planToExecution')?.minMs).toBeNull();
    expect(s.summary.measuredSegmentCount).toBe(2);
  });

  it('kaynağı olan ama ölçülmeyen segment (oturum var) NOT_OBSERVED', () => {
    const s = buildMaviEvidenceSection({ timings: [timing({ wakeToListening: 10 })] });
    expect(s.latencySegments.find((x) => x.segment === 'listeningToTranscript')?.status).toBe('NOT_OBSERVED');
  });

  it('monotoniklik ihlali (out_of_order/neg) kritik bulgu üretir', () => {
    const s = buildMaviEvidenceSection({ timings: [timing({ wakeToListening: 10 }, ['out_of_order:plan'])] });
    expect(s.criticalFindings.some((f) => f.includes('MONOTONİKLİK') && f.includes('out_of_order:plan'))).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════
 * D. Tek yol Mavi yürütmesi — çift yürütme işareti YOK
 * ══════════════════════════════════════════════════════════════ */

describe('D · tek yol Mavi', () => {
  it('Mavi 1 / legacy 0 → hiçbir çift-yürütme işareti yok, singlePath OBSERVED', () => {
    recordTakeoverDecision(decision({ executedBy: 'mavi' }));
    const s = buildMaviEvidenceSection();
    expect(s.summary.dualExecutionSignals).toEqual({
      dualExecutionSameKey: false, maviExecutedWhileNotOwned: false, mediaNextOnBothPaths: false,
    });
    expect(s.summary.takeoverSinglePath).toBe('OBSERVED');
    expect(s.criticalFindings).toHaveLength(0);
    expect(s.commandDecisions.records[0].executedBy).toBe('mavi');
  });
});

/* ══════════════════════════════════════════════════════════════
 * E. Tek yol legacy yürütmesi — çift yürütme işareti YOK
 * ══════════════════════════════════════════════════════════════ */

describe('E · tek yol legacy', () => {
  it('legacy 1 / Mavi 0 → hiçbir çift-yürütme işareti yok', () => {
    recordLegacyExecution({ generationId: 2, sessionId: 2, commandId: 'k', resolvedAction: 'media.next', atMs: 1 });
    const s = buildMaviEvidenceSection();
    expect(s.summary.dualExecutionSignals).toEqual({
      dualExecutionSameKey: false, maviExecutedWhileNotOwned: false, mediaNextOnBothPaths: false,
    });
    expect(s.legacyExecutions.records).toHaveLength(1);
    expect(s.commandDecisions.count).toBe(0);
    expect(s.criticalFindings).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════
 * F. Çift yürütme — ÜÇ bağımsız işaret ayrı ayrı
 * ══════════════════════════════════════════════════════════════ */

describe('F · çift yürütme (üç bağımsız işaret)', () => {
  it('işaret 1: aynı correlationId hem Mavi hem legacy', () => {
    recordTakeoverDecision(decision({ generationId: 3, sessionId: 3, commandId: 'k', executedBy: 'mavi' }));
    recordLegacyExecution({ generationId: 3, sessionId: 3, commandId: 'k', resolvedAction: 'media.next', atMs: 1 });
    const s = buildMaviEvidenceSection();
    expect(s.summary.dualExecutionSignals.dualExecutionSameKey).toBe(true);
    expect(s.criticalFindings.some((f) => f.includes('ÇİFT YÜRÜTME'))).toBe(true);
    expect(s.summary.takeoverSinglePath).toBe('NOT_OBSERVED');
  });

  it('işaret 2: ownershipDecision false iken Mavi yürütmesi', () => {
    recordTakeoverDecision(decision({ ownershipDecision: false, executedBy: 'mavi' }));
    const s = buildMaviEvidenceSection();
    expect(s.summary.dualExecutionSignals.maviExecutedWhileNotOwned).toBe(true);
    expect(s.criticalFindings.some((f) => f.includes('sahiplik kararı false'))).toBe(true);
    expect(s.summary.takeoverSinglePath).toBe('NOT_OBSERVED');
  });

  it('işaret 3: media.next iki hatta da sayıldı', () => {
    recordTakeoverDecision(decision({ commandId: 'mavi-key', executedBy: 'mavi' }));
    recordLegacyExecution({ generationId: 2, sessionId: 2, commandId: 'legacy-key', resolvedAction: 'media.next', atMs: 1 });
    const s = buildMaviEvidenceSection();
    expect(s.summary.dualExecutionSignals.mediaNextOnBothPaths).toBe(true);
    expect(s.criticalFindings.some((f) => f.includes('tek hat garantisi'))).toBe(true);
    expect(s.summary.takeoverSinglePath).toBe('NOT_OBSERVED');
  });
});

/* ══════════════════════════════════════════════════════════════
 * G. NO_SOURCE ayrımı — kaynak gelmeden NOT_OBSERVED yapılmaz
 * ══════════════════════════════════════════════════════════════ */

describe('G · NO_SOURCE ayrımı', () => {
  it('MAVI-INSTRUMENTATION-1: başka fazlar gözlenince, gözlenmeyen planning/executing/speech_end NOT_OBSERVED olur (NO_SOURCE değil — artık kaynaklı)', () => {
    recordLifecycleEvent({ phase: 'listening', atMs: 1, atMono: 1, generationId: 1, sessionId: 1, correlationId: 'g1.s1' });
    recordLifecycleEvent({ phase: 'speaking', atMs: 2, atMono: 2, generationId: 1, sessionId: 1, correlationId: 'g1.s1' });
    const s = buildMaviEvidenceSection();
    for (const p of ['planning', 'executing', 'speech_end']) {
      const st = s.lifecycle.find((x) => x.phase === p)?.status;
      expect(st).toBe('NOT_OBSERVED');
      expect(st).not.toBe('NO_SOURCE');
    }
  });

  it('safety verisi olsa bile üretici yoksa NO_SOURCE; veri gelince OBSERVED', () => {
    let s = buildMaviEvidenceSection();
    expect(s.safety.status).toBe('NO_SOURCE');
    recordSafety({ atMs: 1, actionId: 'media.next', decision: 'allowed', readOnly: true, reason: null });
    s = buildMaviEvidenceSection();
    expect(s.safety.status).toBe('OBSERVED');
  });
});

/* ══════════════════════════════════════════════════════════════
 * H. Yasaklı sözcük — bütün bölüm serileştirilip taranır
 * ══════════════════════════════════════════════════════════════ */

describe('H · yasaklı yorum sözcüğü yok', () => {
  it("ham StepStatus 'failed' bölümde nötrleştirilir (not_ok)", () => {
    expect(neutralizeCode('failed')).toBe('not_ok');
    recordTakeoverDecision(decision({ executionResult: 'failed', errorReason: 'failed', releaseReason: 'error' }));
    const s = buildMaviEvidenceSection();
    expect(s.commandDecisions.records[0].executionResult).toBe('not_ok');
  });

  it('yoğun dolu bölümün serileştirmesinde hiçbir yasaklı sözcük (EN+TR) geçmez', () => {
    recordLifecycleEvent({ phase: 'listening', atMs: 1, atMono: 1, generationId: 1, sessionId: 1, correlationId: 'g1.s1' });
    recordTakeoverDecision(decision({ executionResult: 'failed', errorReason: 'failed' }));
    recordTakeoverDecision(decision({ commandId: 'x2', executedBy: 'legacy', ownershipDecision: false, claimOutcome: null }));
    recordMediaNext(media());
    recordMediaNext(media({ serviceResult: 'throw', nextCallCount: 2, correlationId: 'g1.s1#dup' }));
    recordLegacyExecution({ generationId: 1, sessionId: 1, commandId: 'dup', resolvedAction: 'media.next', atMs: 1 });
    recordLegacyExecution({ generationId: 1, sessionId: 1, commandId: 'dup', resolvedAction: 'media.next', atMs: 2 });
    recordBargeIn({ atMs: 1, oldGeneration: 1, newGeneration: 2, staleDecision: true, cancelledExecution: true, releaseReason: 'stale' });
    recordSafety({ atMs: 1, actionId: 'ecu.write', decision: 'hard_forbidden', readOnly: false, reason: 'scope' });
    recordLifecyclePhase('start');
    adjustRegistration('commandListener', 2);
    const s = buildMaviEvidenceSection({
      timings: [timing({ wakeToListening: 5 }, ['out_of_order:plan', 'neg:planToExecution'])],
      ownership: ownershipStats(),
    });
    const json = JSON.stringify(s);
    const lowered = [json.toLowerCase(), json.toLocaleLowerCase('tr')];
    for (const banned of BANNED_WORDS) {
      for (const lc of lowered) {
        expect(lc.includes(banned), `yasaklı sözcük bulundu: ${banned}`).toBe(false);
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════
 * I. Fail-soft — ana rapor düşmez
 * ══════════════════════════════════════════════════════════════ */

describe('I · fail-soft', () => {
  it('now() throw → throw etmez, olgusal unavailable döner', () => {
    let s: MaviEvidenceSection | undefined;
    expect(() => { s = buildMaviEvidenceSection({ now: () => { throw new Error('boom'); } }); }).not.toThrow();
    expect(s?.unavailable).toBe(true);
    expect(s?.errorCategory).toBe('evidence_serialization_error');
    expect(s?.ledgerUpdated).toBe(false);
  });

  it('bozuk timings girdisi bölümü ÇÖKERTMEZ', () => {
    const malformed = [null, { segments: null }, { segments: { wakeToListening: Number.NaN } }] as unknown as VoiceSessionTiming[];
    let s: MaviEvidenceSection | undefined;
    expect(() => { s = buildMaviEvidenceSection({ timings: malformed }); }).not.toThrow();
    expect(s?.contract).toBe('evidence-only');
  });

  it('timings kaynağı throw etse bile collect() throw etmez (kaynak hatası yutulur)', () => {
    setMaviVoiceTimingsSource(() => { throw new Error('source-down'); });
    let s: MaviEvidenceSection | undefined;
    expect(() => { s = collectMaviEvidenceSection(); }).not.toThrow();
    expect(s?.contract).toBe('evidence-only');
  });
});

/* ══════════════════════════════════════════════════════════════
 * J. Gizlilik — ham transkript / wake adı / token sızmaz
 * ══════════════════════════════════════════════════════════════ */

describe('J · gizlilik & bounded', () => {
  it('serileştirilmiş bölümde token/transkript/kimlik alanı bulunmaz', () => {
    recordTakeoverDecision(decision());
    recordMediaNext(media());
    const json = JSON.stringify(buildMaviEvidenceSection({ ownership: ownershipStats() })).toLowerCase();
    // NOT: 'transcript' taranmaz — meşru segment adları (listeningToTranscript/transcriptToPlan)
    // bunu içerir; sızıntı testi ham İÇERİK/kimlik-bilgisi işaretlerini hedefler.
    for (const leak of ['wakeword', 'password', 'token=', 'api_key', 'apikey', 'bearer', 'secret', 'latitude', 'longitude']) {
      expect(json.includes(leak), `sızıntı alanı bulundu: ${leak}`).toBe(false);
    }
  });

  it('commandId yalnız hash/enum taşır (ham metin kopyalanmaz)', () => {
    recordTakeoverDecision(decision({ commandId: 'music_next#deadbeef' }));
    const s = buildMaviEvidenceSection();
    expect(s.commandDecisions.records[0].commandId).toBe('music_next#deadbeef');
  });

  it('kayıt tavanı bounded — ring aşımı truncated ile OLGUSAL bildirilir', () => {
    for (let i = 0; i < 30; i++) recordMediaNext(media({ correlationId: `g1.s1#c${i}` }));
    const s = buildMaviEvidenceSection();
    expect(s.mediaNext.records.length).toBeLessThanOrEqual(20);
  });
});
