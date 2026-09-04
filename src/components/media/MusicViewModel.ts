/**
 * F1 music read model. This is deliberately a projection: it owns no timer,
 * no provider connection, no playback state and emits no transport command.
 */
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { getMediaState, subscribeMediaState, useMediaState, type MediaState, type MediaSource, type TrackInfo } from '../../platform/mediaService';
import { getMusicCanonicalSnapshot, subscribeMusicCanonicalSnapshot } from '../../platform/media/authority/musicCanonicalSnapshot';
import type { NativeAuthoritySnapshot } from '../../platform/nativePlugin';
import { getSource, type SourceCapabilities, type SourceClass } from '../../platform/media/authority/sourceCapabilities';
import { recordMusicProjection } from '../../platform/media/musicUiPerf';

export type MusicTransportPresentation = 'PLAYING' | 'PAUSED' | 'UNKNOWN' | 'IDLE';

export interface MusicViewModel {
  readonly hasListeningContext: boolean;
  readonly transport: MusicTransportPresentation;
  /** True only when the canonical authority can confirm audible playback. */
  readonly isAudiblyPlaying: boolean;
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  readonly artworkUrl: string | null;
  readonly sourceLabel: string;
  readonly sourceClass: SourceClass | null;
  readonly capabilities: SourceCapabilities | null;
  readonly progress: Readonly<{ positionSec: number; durationSec: number }> | null;
  /** Compatibility fields for the existing source/library surface; still canonical projection data. */
  readonly track: TrackInfo;
  readonly source: MediaSource;
  readonly hasSession: boolean;
  readonly shuffle: boolean;
  readonly repeat: 'off' | 'one' | 'all';
}

const SOURCE_LABEL: Record<MediaSource, string> = {
  spotify: 'Spotify', youtube: 'YouTube', youtube_music: 'YouTube Music',
  local: 'Cihaz Müziği', bluetooth: 'Bluetooth', unknown: 'Müzik',
};

function classFor(media: MediaState, snap: NativeAuthoritySnapshot): SourceClass | null {
  if (snap.authorityAvailable && snap.activeSource in {
    LOCAL: true, STREAM: true, INTERNET_RADIO: true, YOUTUBE: true, SPOTIFY_CONNECT: true,
    EXTERNAL_MEDIA_SESSION: true, BLUETOOTH_EXTERNAL: true, VIDEO: true,
  }) return snap.activeSource as SourceClass;
  if (!media.hasSession) return null;
  switch (media.source) {
    case 'local': return 'LOCAL';
    case 'youtube': case 'youtube_music': return 'YOUTUBE';
    case 'spotify': return 'SPOTIFY_CONNECT';
    case 'bluetooth': return 'BLUETOOTH_EXTERNAL';
    default: return 'EXTERNAL_MEDIA_SESSION';
  }
}

/** Pure canonical-state projection; safe to unit test without React or native I/O. */
export function createMusicViewModel(media: MediaState, snap: NativeAuthoritySnapshot): MusicViewModel {
  const projectionStartedAt = performance.now();
  const sourceClass = classFor(media, snap);
  const capabilities = sourceClass ? getSource(sourceClass).capabilities : null;
  const hasListeningContext = media.hasSession || (snap.authorityAvailable && (snap.queueLength ?? 0) > 0);
  let transport: MusicTransportPresentation = hasListeningContext ? 'UNKNOWN' : 'IDLE';

  if (snap.authorityAvailable && sourceClass && getSource(sourceClass).backend === 'native_authority') {
    if (snap.renderingVerified) transport = 'PLAYING';
    else if (snap.playing) transport = 'UNKNOWN'; // transport intent is not audible truth
    else if ((snap.queueLength ?? 0) > 0) transport = 'PAUSED';
  } else if (hasListeningContext && media.playing === false) {
    // A canonical paused observation is safe to render; PLAYING is never inferred.
    transport = 'PAUSED';
  } else if (
    hasListeningContext
    && media.playing === true
    && sourceClass !== null
    && getSource(sourceClass).backend === 'youtube_iframe'
  ) {
    /* MUSIC F7.5 · ÖLÇÜLEN KUSUR: gömülü IFrame kaynağında `transport` HİÇBİR
     * ZAMAN `PLAYING` olmuyordu (rendering verification bu backend'de mümkün
     * değil) → duraklat düğmesi hep "çal" gösteriyor ve basınca `play`
     * gönderiyordu: **YouTube duraklatılamıyordu**.
     *
     * Bu dal bir TAHMİN DEĞİLDİR: `playing` bayrağı IFrame oynatıcısının
     * KENDİ `PLAYING` olayından (`youtubeService._onState`) gelir — bu
     * backend için ulaşılabilir EN YÜKSEK kanıt düzeyidir
     * (`maxVerificationFor('YOUTUBE') === 'OBSERVED_STARTED'`).
     *
     * Diğer kaynaklar (native · Spotify · harici oturum) DEĞİŞMEDİ: orada
     * "komut kabul edildi" ile "ses çıkıyor" ayrımı aynen korunur. */
    transport = 'PLAYING';
  }

  const durationSec = media.track.durationSec;
  const progress = capabilities?.supportsPosition && Number.isFinite(durationSec) && durationSec > 0
    ? { positionSec: Math.max(0, media.track.positionSec), durationSec }
    : null;

  const viewModel = {
    hasListeningContext,
    transport,
    isAudiblyPlaying: transport === 'PLAYING',
    title: media.track.title || (hasListeningContext ? 'Bilinmeyen parça' : 'Müzik'),
    artist: media.track.artist || (hasListeningContext ? 'Sanatçı bilinmiyor' : 'Oturum yok'),
    album: null,
    artworkUrl: media.track.albumArt || null,
    sourceLabel: media.activeAppName || SOURCE_LABEL[media.source],
    sourceClass,
    capabilities,
    progress,
    track: media.track,
    source: media.source,
    hasSession: media.hasSession,
    shuffle: media.shuffle,
    repeat: media.repeat,
  };
  recordMusicProjection(projectionStartedAt);
  return viewModel;
}

export function useMusicViewModel(): MusicViewModel {
  const media = useMediaState();
  const snapshot = useSyncExternalStore(subscribeMusicCanonicalSnapshot, getMusicCanonicalSnapshot, getMusicCanonicalSnapshot);
  return createMusicViewModel(media, snapshot);
}

/** Mini player deliberately ignores position-only updates: progress is not rendered there. */
export function useMiniMusicViewModel(): MusicViewModel {
  const cache = useRef<{ key: string; value: MusicViewModel } | null>(null);
  const subscribeBoth = useCallback((listener: () => void) => {
    const stopMedia = subscribeMediaState(listener);
    const stopCanonical = subscribeMusicCanonicalSnapshot(listener);
    return () => { stopMedia(); stopCanonical(); };
  }, []);
  const getMiniSnapshot = useCallback(() => {
    const media = getMediaState();
    const snap = getMusicCanonicalSnapshot();
    const key = [media.hasSession, media.playing, media.source, media.activeAppName, media.track.title, media.track.artist,
      media.track.albumArt, snap.authorityAvailable, snap.activeSource, snap.playing, snap.renderingVerified, snap.queueLength].join('|');
    if (cache.current?.key === key) return cache.current.value;
    const value = createMusicViewModel(media, snap);
    cache.current = { key, value };
    return value;
  }, []);
  return useSyncExternalStore(subscribeBoth, getMiniSnapshot, getMiniSnapshot);
}
