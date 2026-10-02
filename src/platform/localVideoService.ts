/**
 * Local Video Service — cihaz depolamasındaki videoları native donanım çözücüyle oynatır.
 * Video yüzeyi CarOS arayüzünün ARKASINDA çizilir (WebView şeffaf olur); oynatıcı
 * kontrolleri CarOS'ta (VideoPlayerOverlay) — dışarıya/başka uygulamaya çıkılmaz.
 */
import { useSyncExternalStore } from 'react';
import { CarLauncher } from './nativePlugin';
import type { LocalVideoTrack } from './nativePlugin';
import { isNative } from './bridge';
import { logError } from './crashLogger';

/* ── State ───────────────────────────────────────────────── */

export interface LocalVideoState {
  videos:      LocalVideoTrack[];
  activeUri:   string | null;
  activeTitle: string | null;
  /** Çözücü hazır ve ilk kare için oynatma başladı (videoStarted). */
  ready:       boolean;
  playing:     boolean;
  /** Bilinmiyorsa null — sahte 0 üretilmez. */
  positionMs:  number | null;
  durationMs:  number | null;
  loading:     boolean;
  error:       string | null;
  initialized: boolean;
}

const IDLE: Pick<LocalVideoState, 'activeUri' | 'activeTitle' | 'ready' | 'playing' | 'positionMs' | 'durationMs'> = {
  activeUri: null, activeTitle: null, ready: false, playing: false, positionMs: null, durationMs: null,
};

let _state: LocalVideoState = {
  videos:      [],
  ...IDLE,
  loading:     false,
  error:       null,
  initialized: false,
};

const _subs = new Set<() => void>();
function _notify() { _subs.forEach((fn) => fn()); }
function _set(partial: Partial<LocalVideoState>) {
  _state = { ..._state, ...partial };
  _notify();
}

export function useLocalVideo(): LocalVideoState {
  return useSyncExternalStore(
    (cb) => { _subs.add(cb); return () => _subs.delete(cb); },
    () => _state,
    () => _state,
  );
}

export function getLocalVideoState(): LocalVideoState { return _state; }

/* ── Event listener handles ─────────────────────────────── */

let _removers: Array<() => void> = [];

/* ── Init / destroy ─────────────────────────────────────── */

export async function initLocalVideo(): Promise<void> {
  if (!isNative || _state.initialized) return;
  _set({ initialized: true });

  try {
    const hs = await Promise.all([
      CarLauncher.addListener('videoStarted', (d) => {
        _set({ ready: true, playing: true, durationMs: d.durationMs > 0 ? d.durationMs : null });
      }),
      CarLauncher.addListener('videoProgress', (d) => {
        if (!_state.activeUri) return;
        _set({
          playing:    d.playing,
          positionMs: d.positionMs >= 0 ? d.positionMs : null,
          durationMs: d.durationMs > 0 ? d.durationMs : _state.durationMs,
        });
      }),
      CarLauncher.addListener('videoCompleted', () => { _set({ ...IDLE }); }),
      CarLauncher.addListener('videoError', (data) => {
        logError('LocalVideo:Error', new Error(data.error));
        _set({ ...IDLE, error: data.error });
      }),
      CarLauncher.addListener('videoClosed', () => { _set({ ...IDLE }); }),
    ]);
    _removers = hs.map((h) => () => h.remove());
  } catch (e) {
    logError('LocalVideo:Init', e);
  }
}

export function destroyLocalVideo(): void {
  _removers.forEach((r) => r());
  _removers = [];
  _set({ initialized: false });
}

/* ── Video listesi ─────────────────────────────────────── */

export async function loadVideoTracks(): Promise<void> {
  if (!isNative) return;
  _set({ loading: true, error: null });
  try {
    const { videos } = await CarLauncher.getVideoTracks();
    _set({ videos, loading: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Video listesi alınamadı';
    _set({ loading: false, error: msg });
    logError('LocalVideo:Load', e);
  }
}

/* ── Playback controls ─────────────────────────────────── */

export async function playVideo(uri: string, title?: string): Promise<void> {
  if (!isNative) return;
  _set({ ...IDLE, activeUri: uri, activeTitle: title ?? null, error: null });
  try {
    await CarLauncher.playVideoNative({ uri, title });
  } catch (e) {
    logError('LocalVideo:Play', e);
    _set({ ...IDLE, error: e instanceof Error ? e.message : 'Video oynatılamadı' });
  }
}

export async function pauseVideo(): Promise<void> {
  if (!isNative || !_state.ready) return;
  _set({ playing: false });
  try { await CarLauncher.pauseVideoNative(); } catch (e) { logError('LocalVideo:Pause', e); }
}

export async function resumeVideo(): Promise<void> {
  if (!isNative || !_state.ready) return;
  _set({ playing: true });
  try { await CarLauncher.resumeVideoNative(); } catch (e) { logError('LocalVideo:Resume', e); }
}

export async function seekVideo(positionMs: number): Promise<void> {
  if (!isNative || !_state.ready) return;
  const max = _state.durationMs ?? positionMs;
  const pos = Math.max(0, Math.min(Math.round(positionMs), max));
  _set({ positionMs: pos });
  try { await CarLauncher.seekVideoNative({ positionMs: pos }); } catch (e) { logError('LocalVideo:Seek', e); }
}

export async function closeVideo(): Promise<void> {
  if (!isNative) return;
  try {
    await CarLauncher.closeVideoNative();
  } catch (e) {
    logError('LocalVideo:Close', e);
  }
  _set({ ...IDLE });
}
