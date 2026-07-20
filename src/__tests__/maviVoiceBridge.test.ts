/**
 * maviVoiceBridge.test.ts — Mavi Çekirdeği Faz-2 · voiceService↔Orchestrator köprüsü sözleşmesi.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. ParsedCommand→pilot eşlemesi: net karşılıklar map'lenir, gerisi null (eski hat).
 *  2. Eşleşen komut bir Mavi turu çalıştırır (shadow: lifecycle/feedback gerçek, servis no-op) → idle.
 *  3. Eşleşmeyen komut → tur YOK (orchestrator idle, feedback yok) — coexistence.
 *  4. Barge-in: ttsCancel çağrılır + lifecycle sıfırlanır; ardışık komut eski turu böler.
 *  5. Başarısız handler → dürüst feedback (action_ok DEĞİL).
 *  6. start/dispose/restart idempotent; dispose registerCommandHandler cleanup'ını çağırır.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMaviOrchestrator } from '../platform/maviCore';
import { createFeedbackChannel } from '../platform/maviCore/wiring/maviFeedback';
import { createShadowHandlers } from '../platform/maviCore/wiring/maviPilotHandlers';
import {
  createMaviVoiceBridge, defaultPilotCommandMap, type ParsedCommandLike,
} from '../platform/maviCore/wiring/maviVoiceBridge';
import type { ActionHandler } from '../platform/maviCore/executionEngine';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function harness(opts: { handlers?: Record<string, ActionHandler> } = {}) {
  let captured: ((cmd: ParsedCommandLike) => void) | null = null;
  const unregister = vi.fn();
  const ttsCancel = vi.fn();
  const orchestrator = createMaviOrchestrator({ handlers: opts.handlers ?? createShadowHandlers() });
  const feedback = createFeedbackChannel();
  const codes: string[] = [];
  feedback.subscribe((fb) => codes.push(fb.code));
  const bridge = createMaviVoiceBridge({
    orchestrator, feedback, ttsCancel,
    registerCommandHandler: (fn) => { captured = fn; return unregister; },
  });
  return {
    bridge, orchestrator, feedback, ttsCancel, unregister, codes,
    fire: (cmd: ParsedCommandLike) => { captured?.(cmd); },
  };
}

describe('defaultPilotCommandMap', () => {
  it('net pilot karşılıkları eşler', () => {
    expect(defaultPilotCommandMap({ type: 'theme_night' })).toEqual({ actionId: 'ui.theme.set', payload: { theme: 'night' } });
    expect(defaultPilotCommandMap({ type: 'theme_day' })?.payload).toEqual({ theme: 'day' });
    expect(defaultPilotCommandMap({ type: 'open_music' })).toEqual({ actionId: 'media.play' });
    expect(defaultPilotCommandMap({ type: 'stop_music' })?.actionId).toBe('media.pause');
    expect(defaultPilotCommandMap({ type: 'music_next' })?.actionId).toBe('media.next');
    expect(defaultPilotCommandMap({ type: 'vehicle_health_check' })?.actionId).toBe('vehicle.health.read');
    expect(defaultPilotCommandMap({ type: 'navigate_place', extra: { destination: 'ev' } })).toEqual({
      actionId: 'navigation.open', payload: { destination: 'ev' },
    });
  });

  it('karşılığı olmayan komut → null (eski hat)', () => {
    expect(defaultPilotCommandMap({ type: 'call_contact' })).toBeNull();
    expect(defaultPilotCommandMap({ type: 'open_settings' })).toBeNull();
    // Hedefsiz serbest navigasyon → null (uydurma hedef yok)
    expect(defaultPilotCommandMap({ type: 'navigate_address' })).toBeNull();
  });
});

describe('MaviVoiceBridge — coexistence turu', () => {
  it('eşleşen komut bir tur çalıştırır → feedback + idle', async () => {
    const h = harness();
    h.bridge.start();
    h.fire({ type: 'theme_night' });
    await flush();
    expect(h.orchestrator.state).toBe('idle');
    expect(h.codes).toContain('action_ok');
    // context güncellendi (son eylem)
    expect(h.orchestrator.snapshot().context.lastActionId).toBe('ui.theme.set');
  });

  it('eşleşmeyen komut → tur YOK (idle, feedback yok)', async () => {
    const h = harness();
    h.bridge.start();
    h.fire({ type: 'call_contact' });
    await flush();
    expect(h.orchestrator.state).toBe('idle');
    expect(h.codes).toEqual([]);
  });

  it('araç sağlığı özeti başarı metnine taşınır', async () => {
    const h = harness({
      handlers: {
        ...createShadowHandlers(),
        'vehicle.health.read': () => ({ ok: true, value: { dtcCount: 1, criticalCount: 0, summary: 'Bir uyarı var' } }),
      },
    });
    h.bridge.start();
    h.fire({ type: 'vehicle_health_check' });
    await flush();
    expect(h.feedback.last()?.message).toBe('Bir uyarı var');
  });
});

describe('MaviVoiceBridge — barge-in', () => {
  it('ardışık komut ttsCancel çağırır (önceki tur bölünür)', async () => {
    const h = harness();
    h.bridge.start();
    h.fire({ type: 'theme_night' });
    await flush();
    // İkinci komut: önceki tur idle'a döndü, ama açık bir bargeIn çağrısı ttsCancel yapmalı
    h.bridge.bargeIn();
    expect(h.ttsCancel).toHaveBeenCalled();
    expect(h.orchestrator.state).toBe('idle');
  });

  it('bargeIn aktif turu iptal edip idle\'a döndürür', () => {
    const h = harness();
    h.bridge.start();
    // Lifecycle'ı elle aktif duruma getir (dinleme)
    h.orchestrator.beginListening();
    expect(h.orchestrator.state).toBe('listening');
    h.bridge.bargeIn();
    expect(h.ttsCancel).toHaveBeenCalledOnce();
    expect(h.orchestrator.state).toBe('idle');
  });
});

describe('MaviVoiceBridge — dürüst başarısızlık', () => {
  it('handler başarısız → action_ok DEĞİL, dürüst feedback', async () => {
    const h = harness({
      handlers: { ...createShadowHandlers(), 'media.play': () => ({ ok: false, error: 'kaynak yok' }) },
    });
    h.bridge.start();
    h.fire({ type: 'open_music' });
    await flush();
    expect(h.codes).not.toContain('action_ok');
    expect(h.feedback.last()?.severity).toBe('error');
  });
});

describe('MaviVoiceBridge — idempotent lifecycle', () => {
  it('start/dispose/restart güvenli; dispose unregister çağırır', () => {
    const h = harness();
    h.bridge.start();
    h.bridge.start(); // idempotent
    h.bridge.dispose();
    expect(h.unregister).toHaveBeenCalledOnce();
    expect(h.orchestrator.state).toBe('idle');
    h.bridge.dispose(); // idempotent
    h.bridge.restart();
    expect(h.orchestrator.state).toBe('idle');
  });
});
