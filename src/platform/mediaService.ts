/**
 * Media Service — central state for music playback.
 *
 * Demo:  mock track, play/pause/next/prev update local state.
 * Native migration:
 *   - updateMediaState() called from a Capacitor MediaSession listener
 *   - play/pause/next/prev send media key events via CarLauncherPlugin.sendMediaAction()
 *   - Android side: MediaControllerCompat or AudioManager.dispatchMediaKeyEvent()
 */
import { useState, useEffect } from 'react';
import { isNative } from './bridge';

/* ── Types ───────────────────────────────────────────────── */

export interface TrackInfo {
  title: string;
  artist: string;
  durationSec: number;
  positionSec: number;
}

export interface MediaState {
  playing: boolean;
  track: TrackInfo;
}

/* ── Demo data ───────────────────────────────────────────── */

const DEMO_TRACKS: TrackInfo[] = [
  { title: 'Blinding Lights',   artist: 'The Weeknd',       durationSec: 200, positionSec: 84  },
  { title: 'As It Was',         artist: 'Harry Styles',     durationSec: 167, positionSec: 12  },
  { title: 'Starboy',           artist: 'The Weeknd',       durationSec: 230, positionSec: 0   },
];

let _demoIndex = 0;

/* ── Module-level state ──────────────────────────────────── */

let _current: MediaState = {
  playing: false,
  track: { ...DEMO_TRACKS[0] },
};
const _listeners = new Set<(s: MediaState) => void>();

/* ── Push API (native bridge calls this) ─────────────────── */

/**
 * Push a state update from any source — demo logic or native MediaSession listener.
 * `track` is merged shallowly so partial track updates are safe.
 */
export function updateMediaState(partial: Partial<MediaState>): void {
  _current = {
    ..._current,
    ...partial,
    track: partial.track ? { ..._current.track, ...partial.track } : _current.track,
  };
  _listeners.forEach((fn) => fn(_current));
}

/* ── Playback controls ───────────────────────────────────── */

export function play(): void {
  if (isNative) {
    // TODO: CarLauncher.sendMediaAction({ action: 'play' });
    return;
  }
  updateMediaState({ playing: true });
}

export function pause(): void {
  if (isNative) {
    // TODO: CarLauncher.sendMediaAction({ action: 'pause' });
    return;
  }
  updateMediaState({ playing: false });
}

export function togglePlayPause(): void {
  _current.playing ? pause() : play();
}

export function next(): void {
  if (isNative) {
    // TODO: CarLauncher.sendMediaAction({ action: 'next' });
    return;
  }
  _demoIndex = (_demoIndex + 1) % DEMO_TRACKS.length;
  updateMediaState({ playing: _current.playing, track: { ...DEMO_TRACKS[_demoIndex] } });
}

export function previous(): void {
  if (isNative) {
    // TODO: CarLauncher.sendMediaAction({ action: 'previous' });
    return;
  }
  _demoIndex = (_demoIndex - 1 + DEMO_TRACKS.length) % DEMO_TRACKS.length;
  updateMediaState({ playing: _current.playing, track: { ...DEMO_TRACKS[_demoIndex] } });
}

/* ── React hook ──────────────────────────────────────────── */

export function useMediaState(): MediaState {
  const [state, setState] = useState<MediaState>(_current);

  useEffect(() => {
    setState(_current);
    _listeners.add(setState);
    return () => { _listeners.delete(setState); };
  }, []);

  return state;
}

/* ── Utility ─────────────────────────────────────────────── */

/** Format seconds → "m:ss" */
export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
