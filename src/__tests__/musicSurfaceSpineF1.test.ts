import { describe, expect, it } from 'vitest';
import type { MediaState } from '../platform/mediaService';
import type { NativeAuthoritySnapshot } from '../platform/nativePlugin';
import { createMusicViewModel } from '../components/media/MusicViewModel';
import { musicSurfaceVisibilityModel } from '../components/media/musicSurfaceVisibilityModel';

const media = (overrides: Partial<MediaState> = {}): MediaState => ({
  playing: false, source: 'local', activePackage: 'com.cockpitos.pro', activeAppName: 'Cihaz Müziği',
  hasSession: true, shuffle: false, repeat: 'off', permissionRequired: false, albumAccentRgb: '1, 2, 3',
  track: { title: 'Parça', artist: 'Sanatçı', albumArt: undefined, positionSec: 12, durationSec: 120 },
  ...overrides,
});

const snapshot = (overrides: Partial<NativeAuthoritySnapshot> = {}): NativeAuthoritySnapshot => ({
  authorityAvailable: true, activeSource: 'LOCAL', focusState: 'GAIN', audioRoute: 'SPEAKER',
  playing: false, renderingVerified: false, queueLength: 1, ...overrides,
});

describe('F1 MusicViewModel canonical projection', () => {
  it('only presents PLAYING when canonical audible truth is verified', () => {
    expect(createMusicViewModel(media({ playing: true }), snapshot({ playing: true, renderingVerified: false })).transport).toBe('UNKNOWN');
    expect(createMusicViewModel(media({ playing: true }), snapshot({ playing: true, renderingVerified: true })).transport).toBe('PLAYING');
  });

  it('keeps paused and unknown transport distinct', () => {
    expect(createMusicViewModel(media(), snapshot()).transport).toBe('PAUSED');
    expect(createMusicViewModel(media({ source: 'spotify', playing: true }), snapshot({ authorityAvailable: false, activeSource: 'NONE' })).transport).toBe('UNKNOWN');
  });

  it('does not invent duration or artwork', () => {
    const vm = createMusicViewModel(media({ track: { title: '', artist: '', durationSec: 0, positionSec: 0 } }), snapshot({ activeSource: 'INTERNET_RADIO' }));
    expect(vm.progress).toBeNull();
    expect(vm.artworkUrl).toBeNull();
    expect(vm.title).toBe('Bilinmeyen parça');
  });

  it('exposes only capabilities of the canonical source', () => {
    const vm = createMusicViewModel(media({ source: 'bluetooth' }), snapshot({ authorityAvailable: false, activeSource: 'NONE' }));
    expect(vm.capabilities?.supportsQueue).toBe(false);
    expect(vm.capabilities?.supportsSeek).toBe(false);
  });

  it('projects a source switch from the next canonical snapshot without retained UI state', () => {
    const before = createMusicViewModel(media({ source: 'local' }), snapshot({ activeSource: 'LOCAL', renderingVerified: true, playing: true }));
    const after = createMusicViewModel(media({ source: 'spotify', activeAppName: 'Spotify', track: { title: 'Yeni parça', artist: 'Yeni sanatçı', durationSec: 200, positionSec: 4 } }), snapshot({ authorityAvailable: false, activeSource: 'NONE' }));
    expect(before.title).toBe('Parça');
    expect(after.title).toBe('Yeni parça');
    expect(after.sourceLabel).toBe('Spotify');
  });

  it('does not create a phantom restore surface from metadata alone', () => {
    const vm = createMusicViewModel(media({ hasSession: false, track: { title: 'Eski parça', artist: 'Eski sanatçı', durationSec: 120, positionSec: 0 } }), snapshot({ authorityAvailable: false, queueLength: 0, activeSource: 'NONE' }));
    expect(vm.hasListeningContext).toBe(false);
  });
});

describe('F1 mini player visibility policy', () => {
  const active = createMusicViewModel(media(), snapshot());
  it('allows the map/navigation shell and suppresses drawers plus critical surfaces', () => {
    expect(musicSurfaceVisibilityModel(active, { drawerOpen: false, nowPlayingOpen: false, criticalSurfaceOpen: false })).toBe(true);
    expect(musicSurfaceVisibilityModel(active, { drawerOpen: true, nowPlayingOpen: false, criticalSurfaceOpen: false })).toBe(false);
    expect(musicSurfaceVisibilityModel(active, { drawerOpen: false, nowPlayingOpen: false, criticalSurfaceOpen: true })).toBe(false);
  });
});
