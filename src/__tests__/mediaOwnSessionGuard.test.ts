/**
 * mediaOwnSessionGuard.test.ts — CarOS'un kendi native oturumu uygulama-içi
 * kaynağı (YouTube IFrame / stream) 'mediaChanged' yolunda EZMEZ.
 *
 * Saha 2026-09-23 (telefon): YouTube çalarken WebView'ın başlıksız oturumu
 * (com.cockpitos.pro, playing:false) grace sonrası hasSession:false yazıyordu →
 * ~5 sn'de video butonu ve kontroller kayboluyordu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const handlers: Record<string, (info: Record<string, unknown>) => void> = {};

vi.mock('../platform/bridge', () => ({ isNative: true, bridge: {} }));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    addListener: vi.fn(async (event: string, fn: (info: Record<string, unknown>) => void) => {
      handlers[event] = fn;
      return { remove: vi.fn() };
    }),
    getMediaInfo: vi.fn(async () => ({ packageName: '', title: '', artist: '', playing: false })),
    checkNotificationAccess: vi.fn(async () => ({ granted: true })),
  },
}));
vi.mock('../platform/media/authority/mediaAuthorityRuntime', () => ({ startMediaAuthority: vi.fn() }));

type Svc = typeof import('../platform/mediaService');
let svc: Svc;

const OWN_EMPTY = { packageName: 'com.cockpitos.pro', appName: 'Caros Pro', title: '', artist: '', playing: false, positionMs: 0, durationMs: 0 };

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  for (const k of Object.keys(handlers)) delete handlers[k];
  svc = await import('../platform/mediaService');
  await svc.startMediaHub();
});

afterEach(() => { vi.useRealTimers(); });

describe('kendi oturumumuz uygulama-içi kaynağı ezmez', () => {
  it('🔒 YouTube çalarken başlıksız com.cockpitos.pro olayı oturumu KAPATMAZ', () => {
    svc.updateMediaState({ hasSession: true, playing: true, source: 'youtube', activePackage: 'com.cockpitos.pro.youtube' });
    handlers.mediaChanged?.(OWN_EMPTY);
    vi.advanceTimersByTime(10_000);
    expect(svc.getMediaState()).toMatchObject({ hasSession: true, playing: true, source: 'youtube', activePackage: 'com.cockpitos.pro.youtube' });
  });

  it('gerçek harici uygulamanın oturumu yine geçer', () => {
    svc.updateMediaState({ hasSession: true, playing: true, source: 'youtube', activePackage: 'com.cockpitos.pro.youtube' });
    handlers.mediaChanged?.({ ...OWN_EMPTY, packageName: 'com.spotify.music', appName: 'Spotify', title: 'Şarkı', artist: 'X', playing: true });
    expect(svc.getMediaState()).toMatchObject({ activePackage: 'com.spotify.music', source: 'spotify' });
  });
});
