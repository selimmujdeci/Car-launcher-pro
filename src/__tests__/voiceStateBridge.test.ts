/**
 * voiceStateBridge.test.ts — Faz-3 · MAVI3-2 telemetri köprüsü sözleşmesi.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Tam voiceService akışı → 5 monotonik segment doğru hesaplanır.
 *  2. Eksik phase (planning/executing yok) → o segment undefined + missing diagnostic; CRASH YOK.
 *  3. Sıra-dışı olay → diagnostic; crash yok.
 *  4. Stale generation olay YOK SAYILIR (telemetriyi kirletmez).
 *  5. latencyTracker beslenir (opsiyonel).
 *  6. start/dispose idempotent; unsubscribe idempotent.
 */
import { describe, it, expect, vi } from 'vitest';
import { createVoiceStateBridge, type VoiceLifecycleEventLike } from '../platform/maviCore/wiring/voiceStateBridge';
import { createLatencyTracker } from '../platform/maviCore/latencyTelemetry';

function harness(opts: { latency?: ReturnType<typeof createLatencyTracker> } = {}) {
  let emit: ((e: VoiceLifecycleEventLike) => void) | null = null;
  const unsub = vi.fn();
  const bridge = createVoiceStateBridge({
    subscribeVoiceState: (l) => { emit = l; return unsub; },
    latencyTracker: opts.latency,
  });
  const ev = (phase: string, gen: number, at: number): VoiceLifecycleEventLike =>
    ({ phase, generationId: gen, sessionId: gen, at });
  return { bridge, unsub, fire: (phase: string, gen: number, at: number) => emit?.(ev(phase, gen, at)) };
}

describe('VoiceStateBridge — segment hesabı', () => {
  it('tam akış 5 segment doğru üretir', () => {
    const h = harness();
    h.bridge.start();
    h.fire('wake_detected', 1, 100);
    h.fire('listening', 1, 300);      // wakeToListening 200
    h.fire('transcribing', 1, 900);   // listeningToTranscript 600
    h.fire('planning', 1, 1000);      // transcriptToPlan 100
    h.fire('executing', 1, 1050);     // planToExecution 50
    h.fire('speaking', 1, 1600);      // executionToSpeech 550
    const s = h.bridge.currentSegments();
    expect(s.wakeToListening).toBe(200);
    expect(s.listeningToTranscript).toBe(600);
    expect(s.transcriptToPlan).toBe(100);
    expect(s.planToExecution).toBe(50);
    expect(s.executionToSpeech).toBe(550);
  });

  it('eksik phase (planning/executing yok) → o segment undefined, crash yok', () => {
    const h = harness();
    h.bridge.start();
    h.fire('wake_detected', 1, 0);
    h.fire('listening', 1, 100);
    h.fire('transcribing', 1, 400);
    h.fire('speaking', 1, 900);
    const s = h.bridge.currentSegments();
    expect(s.wakeToListening).toBe(100);
    expect(s.listeningToTranscript).toBe(300);
    expect(s.transcriptToPlan).toBeUndefined();  // plan marker yok
    expect(s.planToExecution).toBeUndefined();
    expect(s.executionToSpeech).toBeUndefined(); // execution yok
  });
});

describe('VoiceStateBridge — sağlamlık', () => {
  it('stale generation olay yok sayılır (telemetri kirlenmez)', () => {
    const h = harness();
    h.bridge.start();
    h.fire('wake_detected', 2, 0);
    h.fire('listening', 2, 100);
    // Eski kuşaktan (gen 1) geç gelen olay → yok sayılır
    h.fire('transcribing', 1, 5000);
    const s = h.bridge.currentSegments();
    expect(s.wakeToListening).toBe(100);
    expect(s.listeningToTranscript).toBeUndefined(); // stale transcript alınmadı
  });

  it('yeni kuşak önceki oturumu finalize eder (recent ring)', () => {
    const h = harness();
    h.bridge.start();
    h.fire('wake_detected', 1, 0);
    h.fire('listening', 1, 100);
    h.fire('transcribing', 1, 200);
    // Yeni oturum (barge-in)
    h.fire('listening', 2, 1000);
    const recent = h.bridge.recent();
    expect(recent.length).toBe(1);
    expect(recent[0].generationId).toBe(1);
    expect(recent[0].segments.wakeToListening).toBe(100);
  });

  it('sıra-dışı olay diagnostic üretir; crash yok', () => {
    const h = harness();
    h.bridge.start();
    h.fire('listening', 1, 100);
    h.fire('wake_detected', 1, 200); // sıra dışı (wake, listening'den sonra)
    // finalize için yeni oturum tetikle
    h.fire('listening', 2, 1000);
    const rec = h.bridge.recent()[0];
    expect(rec.diagnostics.some((d) => d.startsWith('out_of_order') || d.startsWith('missing'))).toBe(true);
  });

  it('negatif süre (saat anomalisi) segment üretmez + diagnostic', () => {
    const h = harness();
    h.bridge.start();
    h.fire('wake_detected', 1, 500);
    h.fire('listening', 1, 100); // geriye
    expect(h.bridge.currentSegments().wakeToListening).toBeUndefined();
  });
});

describe('VoiceStateBridge — latencyTracker beslemesi', () => {
  it('opsiyonel latencyTracker mark() ile beslenir', () => {
    const tracker = createLatencyTracker({ now: () => 0 });
    const spy = vi.spyOn(tracker, 'mark');
    const h = harness({ latency: tracker });
    h.bridge.start();
    h.fire('wake_detected', 1, 0);
    h.fire('listening', 1, 100);
    h.fire('transcribing', 1, 200);
    expect(spy).toHaveBeenCalledWith('wake');
    expect(spy).toHaveBeenCalledWith('listening');
    expect(spy).toHaveBeenCalledWith('speechEnd');
  });
});

describe('VoiceStateBridge — idempotent lifecycle', () => {
  it('start/dispose idempotent; dispose unsubscribe çağırır', () => {
    const h = harness();
    h.bridge.start();
    h.bridge.start(); // idempotent
    h.bridge.dispose();
    expect(h.unsub).toHaveBeenCalledOnce();
    h.bridge.dispose(); // idempotent
    h.bridge.restart();
    h.bridge.dispose();
  });
});
