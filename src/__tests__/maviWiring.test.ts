/**
 * maviWiring.test.ts — Mavi Çekirdeği Faz-2 · Saf composition (createMaviWiring) sözleşmesi.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. SHADOW (varsayılan): eşleşen komut turu çalışır ama GERÇEK pilot servis portu ÇAĞRILMAZ
 *     (no-op) → çifte yürütme yok; feedback yine üretilir.
 *  2. TAKEOVER: gerçek pilot servis portu ÇAĞRILIR (createPilotHandlers).
 *  3. onFeedback tüketicisi typed event alır.
 *  4. start/dispose idempotent.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMaviWiring } from '../platform/maviCore/wiring/maviWiring';
import type { PilotHandlerDeps } from '../platform/maviCore/wiring/maviPilotHandlers';
import type { ParsedCommandLike } from '../platform/maviCore/wiring/maviVoiceBridge';
import type { MaviFeedback } from '../platform/maviCore/wiring/maviFeedback';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function makePilotDeps(): { deps: PilotHandlerDeps; setTheme: ReturnType<typeof vi.fn> } {
  const setTheme = vi.fn();
  const deps: PilotHandlerDeps = {
    setTheme: setTheme as never,
    openScreen: () => true,
    mediaPlay: vi.fn() as never, mediaPause: vi.fn() as never, mediaNext: vi.fn() as never,
    setVolume: vi.fn() as never,
    navigateTo: vi.fn() as never, openNavScreen: () => true, cancelNavigation: vi.fn() as never,
    readHealth: () => ({ dtcCount: 0, criticalCount: 0, summary: 'temiz' }),
  };
  return { deps, setTheme };
}

function harness(mode: 'shadow' | 'takeover') {
  let captured: ((cmd: ParsedCommandLike) => void) | null = null;
  const { deps, setTheme } = makePilotDeps();
  const fb: MaviFeedback[] = [];
  const handle = createMaviWiring({
    pilotDeps: deps,
    registerCommandHandler: (fn) => { captured = fn; return () => {}; },
    ttsCancel: vi.fn(),
    mode,
    onFeedback: (f) => fb.push(f),
  });
  return { handle, setTheme, fb, fire: (c: ParsedCommandLike) => captured?.(c) };
}

describe('createMaviWiring — mod seçimi', () => {
  it('SHADOW: gerçek pilot servis ÇAĞRILMAZ ama feedback üretilir', async () => {
    const h = harness('shadow');
    h.handle.start();
    expect(h.handle.mode).toBe('shadow');
    h.fire({ type: 'theme_night' });
    await flush();
    expect(h.setTheme).not.toHaveBeenCalled();       // no-op handler → çifte yürütme yok
    expect(h.fb.map((f) => f.code)).toContain('action_ok');
  });

  it('TAKEOVER: gerçek pilot servis ÇAĞRILIR', async () => {
    const h = harness('takeover');
    h.handle.start();
    expect(h.handle.mode).toBe('takeover');
    h.fire({ type: 'theme_night' });
    await flush();
    expect(h.setTheme).toHaveBeenCalledWith('night');
  });

  it('varsayılan mod shadow', () => {
    const { deps } = makePilotDeps();
    const handle = createMaviWiring({
      pilotDeps: deps, registerCommandHandler: () => () => {}, ttsCancel: () => {},
    });
    expect(handle.mode).toBe('shadow');
  });
});

describe('createMaviWiring — idempotent lifecycle', () => {
  it('start/dispose tekrar çağrılınca güvenli', () => {
    const h = harness('shadow');
    h.handle.start();
    h.handle.start(); // idempotent
    h.handle.dispose();
    h.handle.dispose(); // idempotent
    expect(h.handle.bridge.mode).toBe('shadow');
  });

  it('dispose sonrası feedback aboneliği susar', async () => {
    const h = harness('shadow');
    h.handle.start();
    h.handle.dispose();
    h.fire({ type: 'theme_night' }); // köprü dispose edildi → tur yok
    await flush();
    expect(h.fb.length).toBe(0);
  });
});
