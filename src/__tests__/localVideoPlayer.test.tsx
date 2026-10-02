/**
 * localVideoPlayer.test.tsx — video CarOS arayüzünde oynar (saha 2026-10-02).
 *
 * Eskiden native siyah tam ekran overlay + native "KAPAT" vardı; kullanıcı
 * "cihazın kendi oynatıcısı açıldı" sanıyordu. Artık video yüzeyi WebView'ın
 * arkasında, kontroller CarOS'ta; kök şeffaf (html.caros-video-native).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { handlers, native } = vi.hoisted(() => {
  const handlers: Record<string, (d: any) => void> = {};
  const native = {
    addListener: vi.fn(async (ev: string, h: (d: any) => void) => { handlers[ev] = h; return { remove: vi.fn() }; }),
    getVideoTracks: vi.fn(async () => ({ videos: [] })),
    playVideoNative: vi.fn(async () => undefined),
    pauseVideoNative: vi.fn(async () => undefined),
    resumeVideoNative: vi.fn(async () => undefined),
    seekVideoNative: vi.fn(async () => undefined),
    closeVideoNative: vi.fn(async () => undefined),
  };
  return { handlers, native };
});
vi.mock('../platform/nativePlugin', () => ({ CarLauncher: native }));
vi.mock('../platform/bridge', () => ({ isNative: true }));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

import {
  initLocalVideo, destroyLocalVideo, playVideo, seekVideo, closeVideo, getLocalVideoState,
} from '../platform/localVideoService';
import { VideoPlayerOverlay } from '../components/media/VideoPlayerOverlay';

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null; host = null;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await closeVideo();
  destroyLocalVideo();
  Object.values(native).forEach((f) => (f as any).mockClear?.());
  await initLocalVideo();
});

describe('localVideoService', () => {
  it('hazır olana dek konum/süre bilinmiyor (null), videoStarted ile hazır', async () => {
    await playVideo('content://v/1', 'Demo');
    expect(getLocalVideoState()).toMatchObject({ activeUri: 'content://v/1', ready: false, positionMs: null, durationMs: null });
    act(() => handlers.videoStarted({ durationMs: 42000 }));
    expect(getLocalVideoState()).toMatchObject({ ready: true, playing: true, durationMs: 42000 });
    act(() => handlers.videoProgress({ positionMs: 5000, durationMs: 42000, playing: true }));
    expect(getLocalVideoState().positionMs).toBe(5000);
  });

  it('sarma süre sınırına kıstırılır', async () => {
    await playVideo('content://v/1', 'Demo');
    act(() => handlers.videoStarted({ durationMs: 42000 }));
    await seekVideo(99_000);
    expect(native.seekVideoNative).toHaveBeenLastCalledWith({ positionMs: 42000 });
    await seekVideo(-5);
    expect(native.seekVideoNative).toHaveBeenLastCalledWith({ positionMs: 0 });
  });

  it('hata → boşta + hata metni', async () => {
    await playVideo('content://v/1', 'Demo');
    act(() => handlers.videoError({ error: 'x' }));
    expect(getLocalVideoState()).toMatchObject({ activeUri: null, ready: false, error: 'x' });
  });
});

describe('VideoPlayerOverlay', () => {
  it('video açıkken kök şeffaf moda geçer; Geri native kapatır ve modu kaldırır', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<VideoPlayerOverlay />));
    expect(document.documentElement.classList.contains('caros-video-native')).toBe(false);
    await act(async () => { await playVideo('content://v/1', 'Demo'); });
    expect(document.documentElement.classList.contains('caros-video-native')).toBe(true);
    expect(document.body.textContent).toContain('Video hazırlanıyor');
    const back = document.querySelector('[aria-label="Videoyu kapat"]') as HTMLButtonElement;
    await act(async () => { back.click(); });
    expect(native.closeVideoNative).toHaveBeenCalled();
    expect(document.documentElement.classList.contains('caros-video-native')).toBe(false);
  });
});
