/**
 * F2 FINAL CLOSURE — artwork tiers.
 *
 * Locks the resolver chain (memory → disk → native sampled decode), the bounded
 * persistent LRU (deterministic key, byte cap, eviction, invalidation, corrupt
 * recovery, restart reuse), the per-usage target sizes, and the rule that artwork
 * transport is a local file URL rather than base64 on the main path.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('../platform/bridge', () => ({ isNative: true }));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: { getMediaArtDataUri: vi.fn(), resolveArtworkFile: vi.fn(), deleteArtworkFiles: vi.fn() },
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { convertFileSrc: (p: string) => `capfile://${p}`, isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({}),
}));

import {
  resolveArtwork, invalidateArtwork, reportArtworkLoadFailure, artworkTargetPx,
  getArtworkCacheSnapshot, _resetArtworkCacheForTest, _setArtworkFilePortForTest,
} from '../platform/media/artworkCache';
import {
  ARTWORK_DISK_MAX_BYTES, ARTWORK_DISK_MAX_ENTRIES, artworkCacheKey, getArtworkDiskSnapshot,
  hydrateArtworkDiskIndex, lookupArtworkDisk, _resetArtworkDiskForTest, _rehydrateArtworkDiskForTest,
  type ArtworkFilePort, type ArtworkFileRef,
} from '../platform/media/artworkDiskCache';
import { safeFlushAll } from '../utils/safeStorage';

const removed: string[] = [];
const resolveCalls: Array<{ identity: string; targetPx: number }> = [];

/** Fake native tier: records the requested target and hands back a deterministic file. */
function makePort(bytes = 1024, missing = new Set<string>()): ArtworkFilePort {
  return {
    async resolve(identity, targetPx): Promise<ArtworkFileRef | null> {
      resolveCalls.push({ identity, targetPx });
      if (missing.has(identity)) return null;
      const key = `k_${identity}_${targetPx}`;
      return { key, path: `/cache/${key}.jpg`, url: `capfile:///cache/${key}.jpg`, bytes, width: targetPx, height: targetPx, sampleSize: 4 };
    },
    async remove(keys) { removed.push(...keys); },
  };
}

beforeEach(() => {
  removed.length = 0; resolveCalls.length = 0;
  localStorage.clear();
  _resetArtworkDiskForTest();
  _resetArtworkCacheForTest();
  _setArtworkFilePortForTest(makePort());
});

describe('F2 · artwork resolver chain', () => {
  it('goes native once, then serves memory, then disk after a memory reset', async () => {
    const first = await resolveArtwork('content://art/1', 'thumbnail');
    expect(first.source).toBe('NATIVE');
    expect(first.url).toBe('capfile:///cache/k_content://art/1_96.jpg');

    expect((await resolveArtwork('content://art/1', 'thumbnail')).source).toBe('MEMORY');
    expect(resolveCalls).toHaveLength(1);

    _resetArtworkCacheForTest();
    _setArtworkFilePortForTest(makePort());
    resolveCalls.length = 0;
    expect((await resolveArtwork('content://art/1', 'thumbnail')).source).toBe('DISK');
    expect(resolveCalls).toHaveLength(0);
  });

  it('hands the UI a local file URL, never base64, on the main path', async () => {
    const out = await resolveArtwork('content://art/1', 'now-playing');
    expect(out.url?.startsWith('capfile://')).toBe(true);
    expect(out.url?.startsWith('data:')).toBe(false);
  });

  it('separates the three usages by target size and by cache key', async () => {
    expect(artworkTargetPx('thumbnail')).toBe(96);
    expect(artworkTargetPx('mini-player')).toBe(160);
    expect(artworkTargetPx('now-playing')).toBe(640);

    await resolveArtwork('content://art/1', 'thumbnail');
    await resolveArtwork('content://art/1', 'mini-player');
    await resolveArtwork('content://art/1', 'now-playing');

    expect(resolveCalls.map((c) => c.targetPx)).toEqual([96, 160, 640]);
    expect(getArtworkDiskSnapshot().entries).toBe(3);
    expect(artworkCacheKey('content://art/1', 'thumbnail')).not.toBe(artworkCacheKey('content://art/1', 'mini-player'));
  });

  it('coalesces concurrent requests for the same artwork into one decode', async () => {
    const [a, b, c] = await Promise.all([
      resolveArtwork('content://art/9', 'thumbnail'),
      resolveArtwork('content://art/9', 'thumbnail'),
      resolveArtwork('content://art/9', 'thumbnail'),
    ]);
    expect(resolveCalls).toHaveLength(1);
    expect([a.source, b.source, c.source]).toEqual(['NATIVE', 'NATIVE', 'NATIVE']);
    expect(getArtworkCacheSnapshot().inFlight).toBe(0);
  });

  it('reports a missing cover as MISSING without caching anything', async () => {
    _setArtworkFilePortForTest(makePort(1024, new Set(['content://art/none'])));
    const out = await resolveArtwork('content://art/none', 'thumbnail');
    expect(out.source).toBe('MISSING');
    expect(out.url).toBeNull();
    expect(getArtworkDiskSnapshot().entries).toBe(0);
  });

  it('never lets an artwork failure escape: a throwing native tier degrades, it does not reject', async () => {
    _setArtworkFilePortForTest({
      async resolve() { throw new Error('native gone'); },
      async remove() { /* noop */ },
    });
    const out = await resolveArtwork('content://art/1', 'thumbnail');
    expect(['MISSING', 'FALLBACK_BASE64']).toContain(out.source);
    expect(getArtworkCacheSnapshot().nativeFileTier).toBe(false);
  });
});

describe('F2 · artwork disk LRU', () => {
  it('evicts the least recently used entry past the byte bound and deletes its file', async () => {
    const big = Math.ceil(ARTWORK_DISK_MAX_BYTES / 2) + 1;
    _setArtworkFilePortForTest(makePort(big));

    await resolveArtwork('a', 'thumbnail');
    await resolveArtwork('b', 'thumbnail');
    await resolveArtwork('c', 'thumbnail');

    const snap = getArtworkDiskSnapshot();
    expect(snap.bytes).toBeLessThanOrEqual(ARTWORK_DISK_MAX_BYTES);
    expect(snap.entries).toBeLessThan(3);
    expect(removed.length).toBeGreaterThan(0);
    expect(lookupArtworkDisk('c', 'thumbnail')).not.toBeNull();
  });

  it('keeps the entry bound too', async () => {
    _setArtworkFilePortForTest(makePort(8));
    for (let i = 0; i < ARTWORK_DISK_MAX_ENTRIES + 5; i += 1) await resolveArtwork(`x${i}`, 'thumbnail');
    expect(getArtworkDiskSnapshot().entries).toBeLessThanOrEqual(ARTWORK_DISK_MAX_ENTRIES);
  });

  it('reuses the disk index after a restart', async () => {
    await resolveArtwork('content://art/restart', 'thumbnail');
    safeFlushAll();
    _resetArtworkCacheForTest();
    _setArtworkFilePortForTest(makePort());
    resolveCalls.length = 0;

    _rehydrateArtworkDiskForTest();
    expect(getArtworkDiskSnapshot().entries).toBe(1);
    expect((await resolveArtwork('content://art/restart', 'thumbnail')).source).toBe('DISK');
    expect(resolveCalls).toHaveLength(0);
  });

  it('discards a corrupt persisted index instead of trusting half of it', () => {
    localStorage.setItem('music-artwork-disk', '{"schema":1,"entries":[{"cacheKey":"broken"}]}');
    _rehydrateArtworkDiskForTest();
    expect(getArtworkDiskSnapshot().entries).toBe(0);

    localStorage.setItem('music-artwork-disk', 'not json at all');
    _resetArtworkDiskForTest();
    _setArtworkFilePortForTest(makePort());
    localStorage.setItem('music-artwork-disk', 'not json at all');
    hydrateArtworkDiskIndex();
    expect(getArtworkDiskSnapshot().entries).toBe(0);
  });

  it('drops a foreign cache schema whole', () => {
    localStorage.setItem('music-artwork-disk', JSON.stringify({ schema: 99, entries: [] }));
    _rehydrateArtworkDiskForTest();
    expect(getArtworkDiskSnapshot().schema).toBe(1);
    expect(getArtworkDiskSnapshot().entries).toBe(0);
  });

  it('recovers from a vanished cache file by dropping the entry and decoding again', async () => {
    const first = await resolveArtwork('content://art/gone', 'thumbnail');
    expect(first.source).toBe('NATIVE');

    reportArtworkLoadFailure('content://art/gone', 'thumbnail');
    expect(getArtworkDiskSnapshot().entries).toBe(0);
    expect(removed).toContain('k_content://art/gone_96');

    expect((await resolveArtwork('content://art/gone', 'thumbnail')).source).toBe('NATIVE');
    expect(resolveCalls).toHaveLength(2);
  });

  it('invalidates every usage of one identity across both tiers', async () => {
    await resolveArtwork('content://art/inv', 'thumbnail');
    await resolveArtwork('content://art/inv', 'now-playing');
    await resolveArtwork('content://art/keep', 'thumbnail');
    expect(getArtworkDiskSnapshot().entries).toBe(3);

    invalidateArtwork('content://art/inv');

    expect(getArtworkDiskSnapshot().entries).toBe(1);
    expect(lookupArtworkDisk('content://art/keep', 'thumbnail')).not.toBeNull();
    expect(removed).toHaveLength(2);
    expect(getArtworkCacheSnapshot().entries).toBe(1);
  });
});
