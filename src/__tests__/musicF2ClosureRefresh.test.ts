/**
 * F2 FINAL CLOSURE — refresh executor, multi-volume identity, storage/permission
 * lifecycle and persisted per-volume state.
 *
 * These are behaviour locks, not coverage: each one pins a claim we are NOT allowed
 * to break later (zero-query UNCHANGED, no invented deletions, no state advance on a
 * failed scan, library staleness never becoming playback truth).
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('../platform/bridge', () => ({ isNative: true }));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: { getMediaStoreVolumeFacts: vi.fn(), queryMusicTracks: vi.fn() },
}));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

import { CarLauncher } from '../platform/nativePlugin';
const native = CarLauncher as unknown as {
  getMediaStoreVolumeFacts: ReturnType<typeof vi.fn>;
  queryMusicTracks: ReturnType<typeof vi.fn>;
};

import {
  refreshMusicLibrary, getLastMusicRefreshOutcome, getMusicRefreshCounters, _resetMusicRefreshForTest,
} from '../platform/media/mediaStoreRefreshExecutor';
import {
  _resetMusicIndexForTest, getMusicLibrarySnapshot, resolveMusicRef, type MediaRef,
} from '../platform/media/musicIndex';
import { loadRefreshState, clearRefreshState } from '../platform/media/mediaStoreRefreshState';
import { evaluateStorageLifecycle } from '../platform/media/storageVolumeLifecycle';
import { mediaTrackId, migrateLegacyMediaTrackId, parseMediaTrackId } from '../platform/media/mediaIdentity';
import { safeFlushAll } from '../../src/utils/safeStorage';

type Vol = { name: string; version: string | null; generation: number | null; available: boolean; storageKind: 'INTERNAL_SHARED' | 'REMOVABLE' | 'UNKNOWN' };
const vol = (name: string, generation: number | null, available = true, version = 'v1'): Vol =>
  ({ name, version, generation, available, storageKind: name === 'external_primary' ? 'INTERNAL_SHARED' : 'REMOVABLE' });

const facts = (volumes: Vol[], permissionGranted = true, supportsGeneration = true) =>
  ({ permissionGranted, supportsGeneration, volumes });

const track = (id: string, volumeName: string, title = `Parça ${id}`, generation = 1) => ({
  id, uri: `content://media/${volumeName}/audio/media/${id}`, title, artist: 'Sanatçı', album: 'Albüm',
  albumArtUri: `content://media/${volumeName}/audio/albumart/9`, durationMs: 180000,
  volumeName, storageKind: 'INTERNAL_SHARED' as const, generationModified: generation,
});

/** Deterministic monotonic clock — the executor never reads the wall clock itself. */
let tick = 1_000;
const now = () => (tick += 1000);

beforeEach(() => {
  vi.clearAllMocks();
  _resetMusicIndexForTest();
  _resetMusicRefreshForTest();
  clearRefreshState();
  safeFlushAll();
  localStorage.clear();
  tick = 1_000;
});

describe('F2 · refresh executor — decision → provider → index', () => {
  it('first scan is FULL and persists the observed generation', async () => {
    native.getMediaStoreVolumeFacts.mockResolvedValue(facts([vol('external_primary', 7)]));
    native.queryMusicTracks.mockResolvedValue({ tracks: [track('1', 'external_primary')], volumes: [], queriedVolumes: ['external_primary'], mode: 'FULL' });

    const outcome = await refreshMusicLibrary(now);

    expect(outcome.decision).toBe('FULL_RECONCILE');
    expect(outcome.status).toBe('APPLIED');
    expect(outcome.trackQueries).toBe(1);
    expect(getMusicLibrarySnapshot().tracks).toHaveLength(1);
    expect(loadRefreshState()?.volumes[0]).toMatchObject({ volumeName: 'external_primary', generation: 7 });
  });

  it('UNCHANGED performs ZERO track queries and does not bump the library revision', async () => {
    native.getMediaStoreVolumeFacts.mockResolvedValue(facts([vol('external_primary', 7)]));
    native.queryMusicTracks.mockResolvedValue({ tracks: [track('1', 'external_primary')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    await refreshMusicLibrary(now);
    const revisionAfterFull = getMusicLibrarySnapshot().revision;
    native.queryMusicTracks.mockClear();

    const outcome = await refreshMusicLibrary(now);

    expect(outcome.decision).toBe('UNCHANGED');
    expect(outcome.trackQueries).toBe(0);
    expect(native.queryMusicTracks).not.toHaveBeenCalled();
    expect(getMusicLibrarySnapshot().revision).toBe(revisionAfterFull);
  });

  it('an advanced generation runs DELTA against only the changed volume', async () => {
    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', 7), vol('sdcard', 3)]));
    native.queryMusicTracks.mockResolvedValueOnce({ tracks: [track('1', 'external_primary'), track('9', 'sdcard')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    await refreshMusicLibrary(now);

    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', 8), vol('sdcard', 3)]));
    native.queryMusicTracks.mockResolvedValueOnce({
      tracks: [track('2', 'external_primary', 'Yeni', 8)], volumes: [], queriedVolumes: ['external_primary'], mode: 'DELTA',
      identities: { external_primary: ['1', '2'] },
    });

    const outcome = await refreshMusicLibrary(now);

    expect(outcome.decision).toBe('DELTA');
    expect(outcome.status).toBe('APPLIED');
    expect(native.queryMusicTracks).toHaveBeenLastCalledWith(expect.objectContaining({
      volumes: ['external_primary'], mode: 'DELTA', sinceGeneration: { external_primary: 7 }, identityVolumes: ['external_primary'],
    }));
    expect(getMusicLibrarySnapshot().tracks.map((t) => t.id).sort()).toEqual([
      'media:external_primary:1', 'media:external_primary:2', 'media:sdcard:9',
    ]);
  });

  it('applies deletions ONLY from the enumerated identity set, never from the delta itself', async () => {
    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', 7)]));
    native.queryMusicTracks.mockResolvedValueOnce({ tracks: [track('1', 'external_primary'), track('2', 'external_primary')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    await refreshMusicLibrary(now);

    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', 9)]));
    native.queryMusicTracks.mockResolvedValueOnce({
      tracks: [], volumes: [], queriedVolumes: ['external_primary'], mode: 'DELTA',
      identities: { external_primary: ['2'] },
    });

    const outcome = await refreshMusicLibrary(now);

    expect(outcome.prunedVolumes).toEqual(['external_primary']);
    expect(getMusicLibrarySnapshot().tracks.map((t) => t.id)).toEqual(['media:external_primary:2']);
  });

  it('does not guess deletions when the provider returned no identity set', async () => {
    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', 7)]));
    native.queryMusicTracks.mockResolvedValueOnce({ tracks: [track('1', 'external_primary'), track('2', 'external_primary')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    await refreshMusicLibrary(now);

    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', 9)]));
    native.queryMusicTracks.mockResolvedValueOnce({ tracks: [], volumes: [], queriedVolumes: ['external_primary'], mode: 'DELTA' });

    const outcome = await refreshMusicLibrary(now);

    expect(outcome.prunedVolumes).toEqual([]);
    expect(getMusicLibrarySnapshot().tracks).toHaveLength(2);
  });

  it('falls back to FULL when version changes, generation regresses or generation is unsupported', async () => {
    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', 7)]));
    native.queryMusicTracks.mockResolvedValueOnce({ tracks: [track('1', 'external_primary')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    await refreshMusicLibrary(now);

    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', 9, true, 'v2')]));
    native.queryMusicTracks.mockResolvedValueOnce({ tracks: [track('1', 'external_primary')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    expect((await refreshMusicLibrary(now)).decision).toBe('FULL_RECONCILE');

    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', null)]));
    native.queryMusicTracks.mockResolvedValueOnce({ tracks: [track('1', 'external_primary')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    expect((await refreshMusicLibrary(now)).decision).toBe('FULL_RECONCILE');
  });

  it('a failed scan never advances the persisted generation', async () => {
    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', 7)]));
    native.queryMusicTracks.mockResolvedValueOnce({ tracks: [track('1', 'external_primary')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    await refreshMusicLibrary(now);
    expect(loadRefreshState()?.volumes[0]?.generation).toBe(7);

    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', 12)]));
    native.queryMusicTracks.mockRejectedValueOnce(new Error('MEDIA_QUERY_FAILED'));

    const outcome = await refreshMusicLibrary(now);

    expect(outcome.status).toBe('FAILED');
    expect(outcome.failureCode).toBe('TRACK_QUERY_FAILED');
    expect(loadRefreshState()?.volumes[0]?.generation).toBe(7);
  });

  it('reports the provider being unreachable as FAILED instead of an empty library', async () => {
    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', 7)]));
    native.queryMusicTracks.mockResolvedValueOnce({ tracks: [track('1', 'external_primary')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    await refreshMusicLibrary(now);

    native.getMediaStoreVolumeFacts.mockRejectedValueOnce(new Error('boom'));
    const outcome = await refreshMusicLibrary(now);

    expect(outcome.status).toBe('FAILED');
    expect(outcome.failureCode).toBe('VOLUME_FACTS_FAILED');
    expect(getMusicLibrarySnapshot().tracks).toHaveLength(1);
  });
});

describe('F2 · multi-volume identity', () => {
  it('keeps the same MediaStore id on two volumes apart', async () => {
    native.getMediaStoreVolumeFacts.mockResolvedValue(facts([vol('external_primary', 1), vol('sdcard', 1)]));
    native.queryMusicTracks.mockResolvedValue({
      tracks: [track('42', 'external_primary', 'İç depo'), track('42', 'sdcard', 'Kart')],
      volumes: [], queriedVolumes: [], mode: 'FULL',
    });

    await refreshMusicLibrary(now);
    const ids = getMusicLibrarySnapshot().tracks.map((t) => t.id).sort();

    expect(ids).toEqual(['media:external_primary:42', 'media:sdcard:42']);
    expect(getMusicLibrarySnapshot().tracks).toHaveLength(2);
  });

  it('migrates a legacy `media:<id>` ref deterministically and still fails stale refs closed', async () => {
    expect(migrateLegacyMediaTrackId('media:42')).toBe('media:external_primary:42');
    expect(parseMediaTrackId('media:sdcard:42')).toEqual({ volumeIdentity: 'sdcard', mediaStoreId: '42' });
    expect(mediaTrackId('SDCARD', 42)).toBe('media:sdcard:42');

    native.getMediaStoreVolumeFacts.mockResolvedValue(facts([vol('external_primary', 1)]));
    native.queryMusicTracks.mockResolvedValue({ tracks: [track('42', 'external_primary')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    await refreshMusicLibrary(now);

    const legacyRef: MediaRef = { id: 'media:42', contentUri: 'content://media/external_primary/audio/media/42', provenance: 'MEDIASTORE_EXTERNAL' };
    expect(resolveMusicRef(legacyRef)?.id).toBe('media:external_primary:42');

    const unknownRef: MediaRef = { id: 'media:999', contentUri: 'content://media/external_primary/audio/media/999', provenance: 'MEDIASTORE_EXTERNAL' };
    expect(resolveMusicRef(unknownRef)).toBeNull();
  });
});

describe('F2 · storage + permission lifecycle', () => {
  it('detach marks the volume STALE without deleting it or touching other volumes', async () => {
    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', 1), vol('sdcard', 1)]));
    native.queryMusicTracks.mockResolvedValueOnce({ tracks: [track('1', 'external_primary'), track('9', 'sdcard')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    await refreshMusicLibrary(now);

    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', 1)]));
    native.queryMusicTracks.mockResolvedValueOnce({ tracks: [track('1', 'external_primary')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    const detached = await refreshMusicLibrary(now);

    expect(detached.decision).toBe('FULL_RECONCILE');
    expect(detached.staleVolumes).toContain('sdcard');
    const sdTrack = getMusicLibrarySnapshot().tracks.find((t) => t.volumeIdentity === 'sdcard');
    expect(sdTrack?.availability).toBe('STALE');
    expect(getMusicLibrarySnapshot().tracks.find((t) => t.volumeIdentity === 'external_primary')?.availability).toBe('AVAILABLE');
    // Library staleness is not playback truth: the ref simply stops resolving as present.
    expect(resolveMusicRef(sdTrack!)).toBeNull();
  });

  it('reattach reconciles the volume back to AVAILABLE', async () => {
    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', 1), vol('sdcard', 1)]));
    native.queryMusicTracks.mockResolvedValueOnce({ tracks: [track('1', 'external_primary'), track('9', 'sdcard')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    await refreshMusicLibrary(now);

    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', 1), vol('sdcard', 1, false)]));
    native.queryMusicTracks.mockResolvedValueOnce({ tracks: [track('1', 'external_primary')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    await refreshMusicLibrary(now);
    expect(getMusicLibrarySnapshot().tracks.find((t) => t.volumeIdentity === 'sdcard')?.availability).toBe('STALE');

    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', 1), vol('sdcard', 1)]));
    native.queryMusicTracks.mockResolvedValueOnce({ tracks: [track('1', 'external_primary'), track('9', 'sdcard')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    const reattached = await refreshMusicLibrary(now);

    expect(reattached.decision).toBe('FULL_RECONCILE');
    // The planner already fails closed on a topology change; no escalation is needed.
    expect(reattached.reason).toBe('volume_attach_detach');
    expect(getMusicLibrarySnapshot().tracks.find((t) => t.volumeIdentity === 'sdcard')?.availability).toBe('AVAILABLE');
  });

  it('permission revoke goes STALE and permission restore forces FULL_RECONCILE', async () => {
    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', 4)]));
    native.queryMusicTracks.mockResolvedValueOnce({ tracks: [track('1', 'external_primary')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    await refreshMusicLibrary(now);

    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([], false));
    native.queryMusicTracks.mockClear();
    const revoked = await refreshMusicLibrary(now);

    expect(revoked.status).toBe('SKIPPED');
    expect(revoked.reason).toBe('permission_denied');
    expect(native.queryMusicTracks).not.toHaveBeenCalled();
    expect(getMusicLibrarySnapshot().tracks[0]?.availability).toBe('STALE');
    expect(loadRefreshState()?.permissionGranted).toBe(false);
    // The persisted generation is frozen at the last SUCCESSFUL scan.
    expect(loadRefreshState()?.volumes[0]?.generation).toBe(4);

    native.getMediaStoreVolumeFacts.mockResolvedValueOnce(facts([vol('external_primary', 4)]));
    native.queryMusicTracks.mockResolvedValueOnce({ tracks: [track('1', 'external_primary')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    const restored = await refreshMusicLibrary(now);

    expect(restored.permission).toBe('RESTORED');
    expect(restored.decision).toBe('FULL_RECONCILE');
    expect(getMusicLibrarySnapshot().tracks[0]?.availability).toBe('AVAILABLE');
  });

  it('the lifecycle model classifies attach, detach, reattach and permission transitions purely', () => {
    const previous = { schema: 1 as const, permissionGranted: true, volumes: [
      { volumeName: 'external_primary', version: 'v1', generation: 1, available: true },
      { volumeName: 'sdcard', version: 'v1', generation: 1, available: false },
    ] };
    const result = evaluateStorageLifecycle(previous, [
      { volumeName: 'external_primary', version: 'v1', generation: 1, available: true },
      { volumeName: 'sdcard', version: 'v1', generation: 1, available: true },
      { volumeName: 'usb', version: 'v1', generation: 1, available: true },
    ], true);

    expect(result.reattached).toEqual(['sdcard']);
    expect(result.attached).toEqual(['usb']);
    expect(result.detached).toEqual([]);
    expect(result.requiresFullReconcile).toBe(true);
    expect(evaluateStorageLifecycle(previous, [], false).permission).toBe('DENIED');
  });
});

describe('F2 · persisted refresh state survives a restart', () => {
  it('reloads version/generation from storage so the next round can be UNCHANGED', async () => {
    native.getMediaStoreVolumeFacts.mockResolvedValue(facts([vol('external_primary', 11)]));
    native.queryMusicTracks.mockResolvedValue({ tracks: [track('1', 'external_primary')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    await refreshMusicLibrary(now);
    safeFlushAll();

    const persisted = loadRefreshState();
    expect(persisted).toMatchObject({ schema: 1, permissionGranted: true });
    expect(persisted?.volumes[0]?.lastSuccessfulRefreshAt).toBeGreaterThan(0);

    // Simulated restart: the index is cold, the persisted state is not.
    _resetMusicIndexForTest();
    const outcome = await refreshMusicLibrary(now);
    // No READY baseline after a restart → a full reconcile, never a blind delta.
    expect(outcome.decision).toBe('FULL_RECONCILE');
    expect(outcome.reason).toBe('no_ready_library_baseline');
  });

  it('counts rounds and provider queries for CAROS LAB without leaking any content', async () => {
    native.getMediaStoreVolumeFacts.mockResolvedValue(facts([vol('external_primary', 2)]));
    native.queryMusicTracks.mockResolvedValue({ tracks: [track('1', 'external_primary')], volumes: [], queriedVolumes: [], mode: 'FULL' });
    await refreshMusicLibrary(now);
    await refreshMusicLibrary(now);

    const counters = getMusicRefreshCounters();
    expect(counters.rounds).toBe(2);
    expect(counters.trackQueries).toBe(1);
    expect(JSON.stringify(getLastMusicRefreshOutcome())).not.toContain('Parça');
  });
});
