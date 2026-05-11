/**
 * Local Video Service — cihaz depolamasındaki videoları native VideoView ile oynatır.
 * VideoView, Activity'nin DecorView'una overlay olarak eklenir — dışarıya çıkılmaz.
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
  playing:     boolean;
  loading:     boolean;
  error:       string | null;
  initialized: boolean;
}

let _state: LocalVideoState = {
  videos:      [],
  activeUri:   null,
  playing:     false,
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

type RemoveFn = () => void;
let _startedStop:   RemoveFn | null = null;
let _completedStop: RemoveFn | null = null;
let _errorStop:     RemoveFn | null = null;
let _closedStop:    RemoveFn | null = null;

/* ── Init / destroy ─────────────────────────────────────── */

export async function initLocalVideo(): Promise<void> {
  if (!isNative || _state.initialized) return;
  _set({ initialized: true });

  try {
    const h1 = await CarLauncher.addListener('videoStarted', () => {
      _set({ playing: true });
    });
    _startedStop = () => h1.remove();

    const h2 = await CarLauncher.addListener('videoCompleted', () => {
      _set({ playing: false, activeUri: null });
    });
    _completedStop = () => h2.remove();

    const h3 = await CarLauncher.addListener('videoError', (data) => {
      logError('LocalVideo:Error', new Error(data.error));
      _set({ playing: false, error: data.error, activeUri: null });
    });
    _errorStop = () => h3.remove();

    const h4 = await CarLauncher.addListener('videoClosed', () => {
      _set({ playing: false, activeUri: null });
    });
    _closedStop = () => h4.remove();
  } catch (e) {
    logError('LocalVideo:Init', e);
  }
}

export function destroyLocalVideo(): void {
  _startedStop?.();
  _completedStop?.();
  _errorStop?.();
  _closedStop?.();
  _startedStop = _completedStop = _errorStop = _closedStop = null;
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
  _set({ activeUri: uri, playing: false, error: null });
  try {
    await CarLauncher.playVideoNative({ uri, title });
  } catch (e) {
    logError('LocalVideo:Play', e);
    _set({ error: e instanceof Error ? e.message : 'Video oynatılamadı', activeUri: null });
  }
}

export async function closeVideo(): Promise<void> {
  if (!isNative) return;
  try {
    await CarLauncher.closeVideoNative();
  } catch (e) {
    logError('LocalVideo:Close', e);
  }
  _set({ playing: false, activeUri: null });
}
