/**
 * Local Music Service — cihaz depolamasındaki müzikleri MediaPlayer ile çalar.
 *
 * - getMusicTracks()  → native MediaStore sorgusu
 * - playAtIndex()     → parça çal, mediaService state'ini güncelle
 * - localPause/Resume/Next/Prev/Seek
 * - MediaHub'a entegrasyon: yerel çalarken updateMediaState() → kart güncellenir
 */
import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { CarLauncher } from './nativePlugin';
import type { LocalMusicTrack } from './nativePlugin';
import { isNative } from './bridge';
import { updateMediaState, getMediaState } from './mediaService';
import { logError } from './crashLogger';

/** content:// URI'yi WebView'de yüklenebilir URL'e çevirir */
function toWebUri(uri: string | undefined): string | undefined {
  if (!uri || !isNative) return undefined;
  try { return Capacitor.convertFileSrc(uri); } catch { return undefined; }
}

/* ── State ───────────────────────────────────────────────── */

export interface LocalMusicState {
  tracks:       LocalMusicTrack[];
  currentIndex: number;
  playing:      boolean;
  positionMs:   number;
  durationMs:   number;
  loading:      boolean;
  error:        string | null;
  initialized:  boolean;
}

let _state: LocalMusicState = {
  tracks:       [],
  currentIndex: -1,
  playing:      false,
  positionMs:   0,
  durationMs:   0,
  loading:      false,
  error:        null,
  initialized:  false,
};

const _subs = new Set<() => void>();
function _notify() { _subs.forEach((fn) => fn()); }
function _set(partial: Partial<LocalMusicState>) {
  _state = { ..._state, ...partial };
  _notify();
}

export function useLocalMusic(): LocalMusicState {
  return useSyncExternalStore(
    (cb) => { _subs.add(cb); return () => _subs.delete(cb); },
    () => _state,
    () => _state,
  );
}

export function getLocalMusicState(): LocalMusicState { return _state; }

/* ── Event listener handles ─────────────────────────────── */

type RemoveFn = () => void;
let _progressStop: RemoveFn | null = null;
let _startedStop:  RemoveFn | null = null;
let _completedStop:RemoveFn | null = null;
let _errorStop:    RemoveFn | null = null;

/* ── Init / destroy ─────────────────────────────────────── */

export async function initLocalMusic(): Promise<void> {
  if (!isNative || _state.initialized) return;
  _set({ initialized: true });

  try {
    const h1 = await CarLauncher.addListener('localMusicProgress', (data) => {
      _set({ positionMs: data.positionMs, durationMs: data.durationMs, playing: data.playing });
      // mediaService state güncelle — MediaHub progress bar senkronu
      const cur = _state.currentIndex >= 0 ? _state.tracks[_state.currentIndex] : null;
      if (cur) {
        updateMediaState({
          playing: data.playing,
          track: {
            ...getMediaState().track,
            positionSec: data.positionMs / 1000,
            durationSec: data.durationMs / 1000,
          },
        });
      }
    });
    _progressStop = () => h1.remove();

    const h2 = await CarLauncher.addListener('localMusicStarted', (data) => {
      _set({ playing: true, durationMs: data.durationMs });
    });
    _startedStop = () => h2.remove();

    const h3 = await CarLauncher.addListener('localMusicCompleted', () => {
      _set({ playing: false, positionMs: 0 });
      updateMediaState({ playing: false });
      // Sonraki parçaya geç
      if (_state.currentIndex < _state.tracks.length - 1) {
        void playAtIndex(_state.currentIndex + 1);
      }
    });
    _completedStop = () => h3.remove();

    const h4 = await CarLauncher.addListener('localMusicError', (data) => {
      logError('LocalMusic:Error', new Error(data.error));
      _set({ playing: false, error: data.error });
    });
    _errorStop = () => h4.remove();
  } catch (e) {
    logError('LocalMusic:Init', e);
  }
}

export function destroyLocalMusic(): void {
  _progressStop?.();
  _startedStop?.();
  _completedStop?.();
  _errorStop?.();
  _progressStop = _startedStop = _completedStop = _errorStop = null;
  _set({ initialized: false });
  if (isNative) CarLauncher.stopLocalTrack().catch(() => {});
}

/* ── Track listesi ─────────────────────────────────────── */

export async function loadMusicTracks(): Promise<void> {
  if (!isNative) return;
  _set({ loading: true, error: null });
  try {
    const { tracks } = await CarLauncher.getMusicTracks();
    _set({ tracks, loading: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Müzik listesi alınamadı';
    _set({ loading: false, error: msg });
    logError('LocalMusic:Load', e);
  }
}

/* ── Playback controls ─────────────────────────────────── */

export async function playAtIndex(index: number): Promise<void> {
  if (!isNative || index < 0 || index >= _state.tracks.length) return;
  const track = _state.tracks[index];
  _set({ currentIndex: index, playing: false, positionMs: 0 });

  // Çakışma önleme: başka native kaynak çalıyorsa MediaSession'ı durdur
  const { playing: nativePlaying, activePackage: nativePkg } = getMediaState();
  if (nativePlaying && nativePkg && nativePkg !== 'com.cockpitos.pro') {
    CarLauncher.sendMediaAction({ action: 'pause' }).catch(() => {});
  }

  // mediaService state'i hemen güncelle → MediaHub kart bilgisi
  updateMediaState({
    playing:       false,
    hasSession:    true,
    source:        'local',
    activePackage: 'com.cockpitos.pro',
    activeAppName: 'Cihaz Müziği',
    track: {
      title:       track.title   || track.uri.split('/').pop() || 'Bilinmeyen Parça',
      artist:      track.artist  || track.album || 'Bilinmeyen Sanatçı',
      albumArt:    toWebUri(track.albumArtUri),
      durationSec: track.durationMs / 1000,
      positionSec: 0,
    },
  });

  try {
    await CarLauncher.playLocalTrack({ uri: track.uri });
    _set({ playing: true });
    updateMediaState({ playing: true });
  } catch (e) {
    logError('LocalMusic:Play', e);
    _set({ error: e instanceof Error ? e.message : 'Çalma hatası' });
  }
}

export function localTogglePlayPause(): void {
  if (!isNative) return;
  if (_state.playing) {
    CarLauncher.pauseLocalTrack().catch((e) => logError('LocalMusic:Pause', e));
    _set({ playing: false });
    updateMediaState({ playing: false });
  } else {
    CarLauncher.resumeLocalTrack().catch((e) => logError('LocalMusic:Resume', e));
    _set({ playing: true });
    updateMediaState({ playing: true });
  }
}

export function localNext(): void {
  if (_state.currentIndex < _state.tracks.length - 1) {
    void playAtIndex(_state.currentIndex + 1);
  }
}

export function localPrev(): void {
  // 3 saniye geçtiyse aynı parçanın başına dön
  if (_state.positionMs > 3000) {
    CarLauncher.seekLocalTrack({ positionMs: 0 }).catch(() => {});
    _set({ positionMs: 0 });
    updateMediaState({ track: { ...getMediaState().track, positionSec: 0 } });
  } else if (_state.currentIndex > 0) {
    void playAtIndex(_state.currentIndex - 1);
  }
}

export function localSeek(positionMs: number): void {
  if (!isNative) return;
  CarLauncher.seekLocalTrack({ positionMs }).catch((e) => logError('LocalMusic:Seek', e));
  _set({ positionMs });
  updateMediaState({ track: { ...getMediaState().track, positionSec: positionMs / 1000 } });
}

export function stopLocalMusic(): void {
  if (!isNative) return;
  CarLauncher.stopLocalTrack().catch(() => {});
  _set({ playing: false, currentIndex: -1, positionMs: 0 });
  updateMediaState({ playing: false, hasSession: false });
}

/** Şu an yerel müzik çalıyor mu? */
export function isLocalMusicActive(): boolean {
  return _state.playing || (_state.currentIndex >= 0 && getMediaState().activePackage === 'com.cockpitos.pro');
}
