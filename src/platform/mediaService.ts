/**
 * Media Service — central state for music playback.
 *
 * Demo:  mock track, play/pause/next/prev update local state.
 * Native:
 *   - updateMediaState() called from a Capacitor MediaSession listener
 *   - play/pause/next/prev send media key events via CarLauncherPlugin.sendMediaAction()
 *   - Android side: MediaControllerCompat or AudioManager.dispatchMediaKeyEvent()
 */
import { useState, useEffect } from 'react';
import { isNative } from './bridge';
import { CarLauncher } from './nativePlugin';
import type { NativeMediaInfo } from './nativePlugin';
import { logError } from './crashLogger';

/* ── Types ───────────────────────────────────────────────── */

export interface TrackInfo {
  title: string;
  artist: string;
  albumArt?: string; // URL or base64
  durationSec: number;
  positionSec: number;
}

export type MediaSource =
  | 'spotify'
  | 'youtube'
  | 'youtube_music'
  | 'local'
  | 'bluetooth'
  | 'unknown';

export interface MediaState {
  playing:       boolean;
  source:        MediaSource;
  track:         TrackInfo;
  activePackage: string;   // native'de tespit edilen paket adı
  activeAppName: string;   // kullanıcıya görünen uygulama adı
  hasSession:    boolean;  // aktif medya oturumu var mı (pasif mod için)
}

/* ── Demo data ───────────────────────────────────────────── */

const DEMO_TRACKS: TrackInfo[] = [
  { 
    title: 'Blinding Lights',   
    artist: 'The Weeknd',       
    durationSec: 200, 
    positionSec: 84,
    albumArt: 'https://i.scdn.co/image/ab67616d0000b273c5113d961e6992d9e03d7c4b'
  },
  { 
    title: 'As It Was',         
    artist: 'Harry Styles',     
    durationSec: 167, 
    positionSec: 12,
    albumArt: 'https://i.scdn.co/image/ab67616d0000b273b46f74097655d7f353caab14'
  },
  { 
    title: 'Starboy',           
    artist: 'The Weeknd',       
    durationSec: 230, 
    positionSec: 0,
    albumArt: 'https://i.scdn.co/image/ab67616d0000b2734718e2b124f79258be7bc39d'
  },
];

let _demoIndex = 0;

/* ── Module-level state ──────────────────────────────────── */

let _current: MediaState = {
  playing:       false,
  source:        'spotify',
  track:         { ...DEMO_TRACKS[0] },
  activePackage: '',
  activeAppName: 'Spotify',
  // Web/demo modda demo track her zaman görünür; native'de ilk poll'a kadar pasif
  hasSession:    !isNative,
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

export function getMediaState(): MediaState {
  return _current;
}

export function setSource(source: MediaSource): void {
  updateMediaState({ source });
}

/* ── Playback controls ───────────────────────────────────── */

export function play(): void {
  if (isNative) {
    CarLauncher.sendMediaAction({ action: 'play' }).catch(() => {
      // Fallback on error
      updateMediaState({ playing: true });
    });
    return;
  }
  updateMediaState({ playing: true });
}

export function pause(): void {
  if (isNative) {
    CarLauncher.sendMediaAction({ action: 'pause' }).catch(() => {
      // Fallback on error
      updateMediaState({ playing: false });
    });
    return;
  }
  updateMediaState({ playing: false });
}

export function togglePlayPause(): void {
  _current.playing ? pause() : play();
}

export function next(): void {
  if (isNative) {
    CarLauncher.sendMediaAction({ action: 'next' }).catch(() => {
      // Fallback: cycle through demo tracks
      _demoIndex = (_demoIndex + 1) % DEMO_TRACKS.length;
      updateMediaState({ playing: _current.playing, track: { ...DEMO_TRACKS[_demoIndex] } });
    });
    return;
  }
  _demoIndex = (_demoIndex + 1) % DEMO_TRACKS.length;
  updateMediaState({ playing: _current.playing, track: { ...DEMO_TRACKS[_demoIndex] } });
}

export function previous(): void {
  if (isNative) {
    CarLauncher.sendMediaAction({ action: 'previous' }).catch(() => {
      // Fallback: cycle through demo tracks
      _demoIndex = (_demoIndex - 1 + DEMO_TRACKS.length) % DEMO_TRACKS.length;
      updateMediaState({ playing: _current.playing, track: { ...DEMO_TRACKS[_demoIndex] } });
    });
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
  }, [setState]);

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

/* ── Media Hub — aktif medya oturumu tespiti ─────────────── */

const PACKAGE_SOURCE: Record<string, MediaSource> = {
  'com.spotify.music':                      'spotify',
  'com.google.android.youtube':             'youtube',
  'com.google.android.apps.youtube.music':  'youtube_music',
  'com.vanced.android.youtube':             'youtube',
  'app.revanced.android.youtube':           'youtube',
  'com.soundcloud.android':                 'local',
  'com.amazon.music':                       'local',
  'com.deezer.android.app':                 'local',
  'com.tidal.android':                      'local',
  'com.apple.android.music':                'local',
};

const PACKAGE_LABEL: Record<string, string> = {
  'com.spotify.music':                      'Spotify',
  'com.google.android.youtube':             'YouTube',
  'com.google.android.apps.youtube.music':  'YT Music',
  'com.vanced.android.youtube':             'YouTube',
  'app.revanced.android.youtube':           'YouTube',
  'com.soundcloud.android':                 'SoundCloud',
  'com.amazon.music':                       'Amazon Müzik',
  'com.deezer.android.app':                 'Deezer',
  'com.tidal.android':                      'Tidal',
  'com.apple.android.music':                'Apple Music',
};

function applyNativeMediaInfo(info: NativeMediaInfo): void {
  try {
    // Guard against malformed plugin data
    if (!info || typeof info !== 'object') return;

    const pkg    = info.packageName ?? '';
    const source: MediaSource = PACKAGE_SOURCE[pkg]
      ?? (pkg.toLowerCase().includes('bluetooth') ? 'bluetooth' : 'unknown');
    const appName   = PACKAGE_LABEL[pkg] || info.appName || 'Medya';
    // Gerçek oturum var: başlık, sanatçı veya oynatma durumundan en az biri dolu
    const hasSession = !!(info.title || info.artist || info.playing);

    // Skip update if key fields unchanged — prevents unnecessary listener churn
    const incomingTitle  = info.title  || _current.track.title;
    const incomingArtist = info.artist || _current.track.artist;
    if (
      incomingTitle  === _current.track.title   &&
      incomingArtist === _current.track.artist  &&
      info.playing   === _current.playing       &&
      hasSession     === _current.hasSession
    ) return;

    updateMediaState({
      hasSession,
      playing:       info.playing,
      source,
      activePackage: pkg,
      activeAppName: appName,
      track: {
        title:       incomingTitle,
        artist:      incomingArtist,
        albumArt:    info.albumArt    ?? _current.track.albumArt,
        durationSec: info.durationMs  > 0 ? Math.round(info.durationMs / 1000)  : _current.track.durationSec,
        positionSec: info.positionMs  > 0 ? Math.round(info.positionMs / 1000)  : _current.track.positionSec,
      },
    });
  } catch (e) {
    logError('Media:ApplyInfo', e);
    // Degrade gracefully — don't crash the poll loop
    try { updateMediaState({ hasSession: false }); } catch { /* ignore */ }
  }
}

let _hubTimer:        ReturnType<typeof setInterval> | null = null;
let _hubListenerStop: (() => void) | null = null;
let _hubStarted       = false;

export async function startMediaHub(): Promise<void> {
  // Guard against duplicate calls
  if (_hubStarted) return;
  _hubStarted = true;

  if (isNative) {
    // Gerçek zamanlı event dinle
    try {
      const handle = await CarLauncher.addListener('mediaChanged', applyNativeMediaInfo);
      _hubListenerStop = () => { try { handle.remove(); } catch { /* ignore */ } };
    } catch (e) {
      logError('Media:Listener', e);
      /* plugin bu eventi desteklemiyor — poll only mode */
    }

    // Poll to fill gaps between events
    const poll = async () => {
      try {
        const info = await CarLauncher.getMediaInfo();
        applyNativeMediaInfo(info);
      } catch {
        // Aktif medya oturumu yok → pasif moda geç
        updateMediaState({ hasSession: false });
      }
    };

    void poll();
    if (_hubTimer) clearInterval(_hubTimer);
    _hubTimer = setInterval(() => { void poll(); }, 5000);
    return;
  }

  // Web: navigator.mediaSession varsa oku
  const pollWeb = () => {
    try {
      const ms = navigator.mediaSession;
      if (!ms?.metadata) return;
      const m = ms.metadata;
      updateMediaState({
        playing:       ms.playbackState === 'playing',
        source:        'unknown',
        activePackage: '',
        activeAppName: 'Tarayıcı',
        track: {
          title:       m.title  || _current.track.title,
          artist:      m.artist || _current.track.artist,
          albumArt:    m.artwork?.[0]?.src ?? _current.track.albumArt,
          durationSec: _current.track.durationSec,
          positionSec: _current.track.positionSec,
        },
      });
    } catch (e) {
      logError('Media:PollWeb', e);
    }
  };

  pollWeb();
  if (_hubTimer) clearInterval(_hubTimer);
  _hubTimer = setInterval(pollWeb, 5000);
}

export function stopMediaHub(): void {
  _hubStarted = false;
  if (_hubTimer) { clearInterval(_hubTimer); _hubTimer = null; }
  if (_hubListenerStop) {
    const stop = _hubListenerStop;
    _hubListenerStop = null; // null first to prevent double-call
    try { stop(); } catch (e) { logError('Media:StopHub', e); }
  }
}

/**
 * Anında tek seferlik media poll — uygulama resume olduğunda çağrılır.
 * MediaHub'ın 5s poll beklememesini sağlar; launcher'a dönünce şarkı
 * bilgisi hemen güncellenir.
 */
export function pollMediaNow(): void {
  if (!isNative || !_hubStarted) return;
  void CarLauncher.getMediaInfo()
    .then(applyNativeMediaInfo)
    .catch(() => {
      // Aktif oturum yok — pasif moda geç
      updateMediaState({ hasSession: false });
    });
}
