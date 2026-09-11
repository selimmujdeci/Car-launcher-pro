/**
 * maviForensicModel.test.ts — Mavi çapraz-kesen anomali tespiti + olay zaman
 * çizelgesi kilitleri (P0-MAVI-FORENSIC · §9/§10-I).
 *
 * Kilitler:
 *  1) kanıt YOKSA anomali listesi BOŞ döner (uydurma tespit YOK — "sağlıklı"
 *     iddia edilmez, yalnız susma).
 *  2) her anomali sınıfı GERÇEK bir eşik/sayaçla tetiklenir.
 *  3) zaman çizelgesi wake+action kayıtlarını en-yeni-başta birleştirir.
 *  4) model SAF: yalnız yapısal girdi alır, I/O yok.
 */

import { describe, it, expect } from 'vitest';
import {
  detectMaviAnomalies, buildMaviEventTimeline, type MaviAnomalyId,
} from '../platform/devtools/maviForensicModel';
import type { MaviRawSnapshot } from '../platform/devtools/maviConsoleModel';

function snap(over: Partial<MaviRawSnapshot> = {}): MaviRawSnapshot {
  return {
    readAt: 1,
    voice: null, diag: null, aiHealth: null, quota: null, proactive: null,
    speech: null, ttsEngine: null, turn: null, workload: null,
    proactivePolicy: null, surface: null, bargeIn: null, runtime: null,
    wakeForensics: null, latency: null, actionTrace: null,
    ...over,
  };
}

function ids(records: readonly { id: MaviAnomalyId }[]): MaviAnomalyId[] {
  return records.map((r) => r.id);
}

describe('detectMaviAnomalies — kanıt yoksa susar (uydurma yok)', () => {
  it('boş/null snapshot → boş liste (0 anomali "sağlıklı" İDDİASI DEĞİLDİR)', () => {
    expect(detectMaviAnomalies(null)).toEqual([]);
    expect(detectMaviAnomalies(snap())).toEqual([]);
  });
});

describe('detectMaviAnomalies — her sınıf GERÇEK bir sayaçla tetiklenir', () => {
  it('TTS_DONE_BEFORE_LAST_SEGMENT: suspectInstantDone > 0', () => {
    const r = detectMaviAnomalies(snap({
      ttsEngine: {
        requested: 3, engineDone: 3, engineError: 0, noEngineReport: 0,
        suspectInstantDone: 1, saturated: false, lastCause: null, lastEvidence: null,
        lastTransport: null, lastDurationMs: null, lastMinPlausibleMs: null, lastCharCount: null,
      },
    }));
    expect(ids(r)).toContain('TTS_DONE_BEFORE_LAST_SEGMENT');
  });

  it('TTS_ENGINE_SILENT: noEngineReport > 0', () => {
    const r = detectMaviAnomalies(snap({
      ttsEngine: {
        requested: 2, engineDone: 0, engineError: 0, noEngineReport: 2,
        suspectInstantDone: 0, saturated: false, lastCause: null, lastEvidence: null,
        lastTransport: null, lastDurationMs: null, lastMinPlausibleMs: null, lastCharCount: null,
      },
    }));
    expect(ids(r)).toContain('TTS_ENGINE_SILENT');
  });

  it('WAKE_ACCEPTED_INTENT_NOT_REACHED: acceptedNoIntent > 0 veya bekleyen kabul var', () => {
    const r1 = detectMaviAnomalies(snap({
      wakeForensics: {
        counts: {}, total: 5, evicted: 0, intentReached: 2, acceptedNoIntent: 3,
        pendingAcceptAgeMs: null, lastReason: 'ACCEPTED', lastPath: 'GRAMMAR',
      },
    }));
    expect(ids(r1)).toContain('WAKE_ACCEPTED_INTENT_NOT_REACHED');

    const r2 = detectMaviAnomalies(snap({
      wakeForensics: {
        counts: {}, total: 1, evicted: 0, intentReached: 0, acceptedNoIntent: 0,
        pendingAcceptAgeMs: 21_000, lastReason: 'ACCEPTED', lastPath: 'GRAMMAR',
      },
    }));
    expect(ids(r2)).toContain('WAKE_ACCEPTED_INTENT_NOT_REACHED');
    expect(r2.find((a) => a.id === 'WAKE_ACCEPTED_INTENT_NOT_REACHED')?.severity).toBe('critical');
  });

  it('AI_PROVIDER_CIRCUIT_BLOCKED: healthy=false veya blockedForMs > 0', () => {
    const r = detectMaviAnomalies(snap({
      aiHealth: { healthy: false, consecFails: 3, consecTimeouts: 0, blockedForMs: 5_000 },
    }));
    expect(ids(r)).toContain('AI_PROVIDER_CIRCUIT_BLOCKED');
  });

  it('STALE_GENERATION_CALLBACK: guard GERÇEKTEN bir şey yakaladıysa (bilgi amaçlı)', () => {
    const r = detectMaviAnomalies(snap({
      turn: {
        activeTurnId: 9, activeState: 'active', turnsStarted: 10, turnsCompleted: 8,
        turnsSuperseded: 1, staleProviderResultsDropped: 1, staleActionsPrevented: 0,
        staleFeedbackSuppressed: 0, countersSaturated: false,
      },
    }));
    const hit = r.find((a) => a.id === 'STALE_GENERATION_CALLBACK');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('info');
  });

  it('TTS_CAPTURE_OPEN_UNPROTECTED: mikrofon TTS sırasında açık VE echo referansı KANITLANMAMIŞ', () => {
    const r = detectMaviAnomalies(snap({
      bargeIn: {
        duplexClass: 'UNSUPPORTED', captureOpenDuringTts: true, aecCountsForDuplex: false,
        echoReferenceWired: false, proposals: 0, accepted: 0, lastReason: null,
        reasons: {}, evidenceKinds: {}, lastTtsStopRequestMs: -1, maxTtsStopRequestMs: -1,
        ttsStopSamples: 0, lastListenOpenMs: -1, maxListenOpenMs: -1, listenSamples: 0,
        countersSaturated: false,
      },
    }));
    expect(ids(r)).toContain('TTS_CAPTURE_OPEN_UNPROTECTED');
  });

  it('echo referansı KANITLANMIŞSA aynı capture-open durumu anomali SAYILMAZ', () => {
    const r = detectMaviAnomalies(snap({
      bargeIn: {
        duplexClass: 'AEC_GATED_DUPLEX', captureOpenDuringTts: true, aecCountsForDuplex: true,
        echoReferenceWired: true, proposals: 0, accepted: 0, lastReason: null,
        reasons: {}, evidenceKinds: {}, lastTtsStopRequestMs: -1, maxTtsStopRequestMs: -1,
        ttsStopSamples: 0, lastListenOpenMs: -1, maxListenOpenMs: -1, listenSamples: 0,
        countersSaturated: false,
      },
    }));
    expect(ids(r)).not.toContain('TTS_CAPTURE_OPEN_UNPROTECTED');
  });

  it('FIRST_AUDIO_TOO_SLOW: bir SLA sınıfı kendi p95 hedefini AŞTI', () => {
    const r = detectMaviAnomalies(snap({
      latency: {
        enabled: true, traceCount: 5, completed: 5, verdict: 'CONFIRMED',
        slaClasses: [
          { slaClass: 'LOCAL', targetP95Ms: 1000, p95Ms: 1800, meetsTarget: false, evidence: 'CONFIRMED' },
          { slaClass: 'CLOUD', targetP95Ms: 2000, p95Ms: 1200, meetsTarget: true, evidence: 'CONFIRMED' },
        ],
        byOutcome: {}, byFirstAudio: {}, orphanMarks: 0, duplicateMarks: 0, invalidMarks: 0,
      },
    }));
    const hit = r.find((a) => a.id === 'FIRST_AUDIO_TOO_SLOW');
    expect(hit).toBeDefined();
    expect(hit?.evidence).toContain('slaClass=LOCAL');
    // CLOUD hedefi tuttu → ikinci bir FIRST_AUDIO_TOO_SLOW ÜRETİLMEZ.
    expect(r.filter((a) => a.id === 'FIRST_AUDIO_TOO_SLOW')).toHaveLength(1);
  });

  it('meetsTarget=null (örnek yok) İDDİA ÜRETMEZ — PASS de FAIL de DENMEZ', () => {
    const r = detectMaviAnomalies(snap({
      latency: {
        enabled: true, traceCount: 0, completed: 0, verdict: 'NO_TRACES',
        slaClasses: [
          { slaClass: 'LOCAL', targetP95Ms: 1000, p95Ms: null, meetsTarget: null, evidence: 'NONE' },
        ],
        byOutcome: {}, byFirstAudio: {}, orphanMarks: 0, duplicateMarks: 0, invalidMarks: 0,
      },
    }));
    expect(ids(r)).not.toContain('FIRST_AUDIO_TOO_SLOW');
  });

  it('ACTION_DISPATCH_NO_RESULT: kapı allowed dedi ama zincirde result YOK', () => {
    const r = detectMaviAnomalies(snap({
      actionTrace: {
        recorded: 4, dropped: 0, capacity: 120, saturated: false,
        dispatchWithoutResult: 1, byStage: { gate: 2, result: 1 },
      },
    }));
    expect(ids(r)).toContain('ACTION_DISPATCH_NO_RESULT');
  });
});

describe('buildMaviEventTimeline — SAF birleştirme, en yeni BAŞTA', () => {
  it('wake + action kayıtlarını tek zaman ekseninde birleştirir', () => {
    const rows = buildMaviEventTimeline(
      [{ atMs: 100, reason: 'ACCEPTED', path: 'GRAMMAR' }],
      [{ atMs: 200, stage: 'gate', status: 'allowed', reason: '', turnId: 3 }],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].atMs).toBe(200);   // en yeni BAŞTA
    expect(rows[0].source).toBe('action');
    expect(rows[1].source).toBe('wake');
  });

  it('null/eksik girdi güvenle boş satır üretir (throw etmez)', () => {
    expect(buildMaviEventTimeline(null, null)).toEqual([]);
    expect(buildMaviEventTimeline(undefined, [{ atMs: 1, stage: 'gate', status: 'allowed', reason: '', turnId: null }])).toHaveLength(1);
  });

  it('limit tavanı uygulanır (bounded — sessiz bellek büyümesi yok)', () => {
    const wake = Array.from({ length: 50 }, (_, i) => ({ atMs: i, reason: 'ACCEPTED', path: 'GRAMMAR' }));
    const rows = buildMaviEventTimeline(wake, null, 10);
    expect(rows).toHaveLength(10);
    expect(rows[0].atMs).toBe(49); // en yeni korunur, en eskiler düşer
  });

  it('geçersiz atMs taşıyan kayıt sessizce atlanır (NaN kronoloji üretmez)', () => {
    const rows = buildMaviEventTimeline(
      [{ atMs: Number.NaN, reason: 'ACCEPTED', path: 'GRAMMAR' }, { atMs: 5, reason: 'ACCEPTED', path: 'GRAMMAR' }],
      null,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].atMs).toBe(5);
  });
});
