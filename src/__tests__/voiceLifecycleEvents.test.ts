/**
 * voiceLifecycleEvents.test.ts — Faz-3 · MAVI3-1 voiceService.subscribeVoiceState sözleşmesi.
 *
 * KİLİTLENEN SÖZLEŞME (ADDITIVE — mevcut davranış değişmez):
 *  1. subscribeVoiceState typed VoiceLifecycleEvent yayar (generationId/sessionId/at içerir).
 *  2. VoiceStatus geçişleri doğru phase'e map'lenir (listening/transcribing/speaking/error/idle).
 *  3. notifyWakeDetected → 'wake_detected' + yeni oturum; sonraki listening AYNI kuşak.
 *  4. Buton (wake'siz) idle→listening → yeni oturum kuşağı artar.
 *  5. Ardışık aynı-phase dedup (transcribing hariç).
 *  6. Unsubscribe idempotent; listener hatası voiceService'i bozmaz.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  subscribeVoiceState, notifyWakeDetected, stopListening,
  _resetVoiceServiceForTest, _setVoiceStatusForTest,
  type VoiceLifecycleEvent, type VoiceLifecyclePhase,
} from '../platform/voiceService';

function collect(): { events: VoiceLifecycleEvent[]; phases: () => VoiceLifecyclePhase[]; off: () => void } {
  const events: VoiceLifecycleEvent[] = [];
  const off = subscribeVoiceState((e) => events.push(e));
  return { events, phases: () => events.map((e) => e.phase), off };
}

beforeEach(() => { _resetVoiceServiceForTest(); });

describe('subscribeVoiceState — phase map', () => {
  it('idle→listening→processing→success→idle doğru phase üretir', () => {
    const c = collect();
    _setVoiceStatusForTest('listening');
    _setVoiceStatusForTest('processing');
    _setVoiceStatusForTest('success');
    _setVoiceStatusForTest('idle');
    expect(c.phases()).toEqual(['listening', 'transcribing', 'speaking', 'idle']);
    c.off();
  });

  it('her event generationId/sessionId/at taşır (at monotonik sayı)', () => {
    const c = collect();
    _setVoiceStatusForTest('listening');
    const e = c.events[0];
    expect(e.sessionId).toBe(1);
    expect(e.generationId).toBe(1);
    expect(typeof e.at).toBe('number');
    c.off();
  });

  it('error phase error event üretir', () => {
    const c = collect();
    _setVoiceStatusForTest('error');
    expect(c.phases()).toEqual(['error']);
    c.off();
  });
});

describe('subscribeVoiceState — oturum kuşağı', () => {
  it('buton dinlemesi (idle→listening) yeni oturum kuşağı artırır', () => {
    const c = collect();
    _setVoiceStatusForTest('listening');
    _setVoiceStatusForTest('idle');
    _setVoiceStatusForTest('listening'); // ikinci oturum
    const sessions = c.events.filter((e) => e.phase === 'listening').map((e) => e.sessionId);
    expect(sessions).toEqual([1, 2]);
    c.off();
  });

  it('wake_detected yeni oturum açar; sonraki listening AYNI kuşak', () => {
    const c = collect();
    notifyWakeDetected();
    _setVoiceStatusForTest('listening'); // wake sonrası → aynı oturum
    const wake = c.events.find((e) => e.phase === 'wake_detected')!;
    const listen = c.events.find((e) => e.phase === 'listening')!;
    expect(wake.sessionId).toBe(1);
    expect(listen.sessionId).toBe(1);       // kuşak tekrar artmadı
    expect(listen.generationId).toBe(1);
    c.off();
  });
});

describe('subscribeVoiceState — dedup + transcript', () => {
  it('ardışık aynı phase bastırılır (idle iki kez → tek event)', () => {
    const c = collect();
    _setVoiceStatusForTest('listening');
    _setVoiceStatusForTest('idle');
    _setVoiceStatusForTest('idle'); // ardışık aynı → bastırılır (status değişmez zaten)
    expect(c.phases().filter((p) => p === 'idle').length).toBe(1);
    c.off();
  });

  it('cancelled: stopListening açık iptal event üretir', () => {
    const c = collect();
    _setVoiceStatusForTest('listening');
    stopListening();
    expect(c.phases()).toContain('cancelled');
    c.off();
  });
});

describe('subscribeVoiceState — sağlamlık', () => {
  it('unsubscribe idempotent (ikinci çağrı zararsız)', () => {
    const c = collect();
    _setVoiceStatusForTest('listening');
    c.off();
    c.off(); // idempotent
    _setVoiceStatusForTest('processing');
    expect(c.phases()).toEqual(['listening']); // off sonrası duymaz
  });

  it('listener hatası voiceService\'i bozmaz; diğer listener çalışır', () => {
    const good: VoiceLifecyclePhase[] = [];
    const offBad = subscribeVoiceState(() => { throw new Error('kötü listener'); });
    const offGood = subscribeVoiceState((e) => good.push(e.phase));
    expect(() => _setVoiceStatusForTest('listening')).not.toThrow();
    expect(good).toEqual(['listening']);
    offBad(); offGood();
  });

  it('geçersiz listener güvenli no-op unsubscribe döner', () => {
    const off = subscribeVoiceState(undefined as never);
    expect(() => off()).not.toThrow();
  });
});
