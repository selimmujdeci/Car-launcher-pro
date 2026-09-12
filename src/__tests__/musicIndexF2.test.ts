import { describe, expect, it, beforeEach } from 'vitest';
import { _resetMusicIndexForTest, reconcileMusicIndex, resolveMusicRef, searchMusicLibrary } from '../platform/media/musicIndex';
import { _resetArtworkCacheForTest, _seedArtworkCacheForTest, getArtworkCacheSnapshot, invalidateArtwork, resolveArtwork } from '../platform/media/artworkCache';
import type { LocalMusicTrack } from '../platform/nativePlugin';
const t = (id: string, title = 'Şarkı', artist = 'Sanatçı', album = 'Albüm'): LocalMusicTrack => ({ id, uri: `content://media/external/audio/media/${id}`, title, artist, album, albumArtUri: `content://art/${album}`, durationMs: 180000 });
beforeEach(() => { _resetMusicIndexForTest(); _resetArtworkCacheForTest(); });
describe('F2 MusicIndex', () => {
  it('models an empty library without invented metadata', () => { const s = reconcileMusicIndex([]); expect(s.tracks).toHaveLength(0); expect(s.artists).toHaveLength(0); });
  it('uses MediaStore id plus content URI as stable identity and preserves duplicate metadata', () => { const s = reconcileMusicIndex([t('1', 'A'), t('2', 'A')]); expect(s.tracks.map(x => x.id)).toEqual(['media:external_primary:1', 'media:external_primary:2']); expect(s.tracks).toHaveLength(2); });
  it('builds artist, album and unavailable-folder projections without fabricating folders', () => { const s = reconcileMusicIndex([t('1', 'A', 'X', 'Y'), t('2', 'B', 'X', 'Y')]); expect(s.artists[0]?.trackIds).toHaveLength(2); expect(s.albums[0]?.trackIds).toHaveLength(2); expect(s.folders).toHaveLength(0); });
  it('reconciles add/remove/change with a new revision and fails stale refs closed', () => { const one = reconcileMusicIndex([t('1')]); const stale = one.tracks[0]!; const two = reconcileMusicIndex([t('2', 'Yeni')]); expect(two.revision).toBeGreaterThan(one.revision); expect(resolveMusicRef(stale)).toBeNull(); expect(two.tracks[0]?.title).toBe('Yeni'); });
  it('normalizes Turkish title artist and album search', () => { reconcileMusicIndex([t('1', 'IŞIK', 'Çığlık', 'Öykü')]); expect(searchMusicLibrary('isik')).toHaveLength(1); expect(searchMusicLibrary('ciglik')).toHaveLength(1); expect(searchMusicLibrary('oyku')).toHaveLength(1); });
  it('handles a 5k synthetic inventory deterministically', () => { const many = Array.from({ length: 5000 }, (_, i) => t(String(i), `Parça ${i}`, `Sanatçı ${i % 50}`, `Albüm ${i % 100}`)); const s = reconcileMusicIndex(many); expect(s.tracks).toHaveLength(5000); expect(searchMusicLibrary('parca 49')).not.toHaveLength(0); });
});
describe('F2 ArtworkCache', () => {
  it('returns a cache hit, invalidates deterministically, and keeps missing artwork cheap', async () => { _seedArtworkCacheForTest('content://art/a', 'thumbnail', 'data:image/x;base64,AA'); expect((await resolveArtwork('content://art/a', 'thumbnail')).source).toBe('MEMORY'); invalidateArtwork('content://art/a'); expect(getArtworkCacheSnapshot().entries).toBe(0); expect((await resolveArtwork(null, 'thumbnail')).source).toBe('MISSING'); });
  it('evicts when bounded memory is exceeded', () => { for (let i = 0; i < 20; i += 1) _seedArtworkCacheForTest(`a${i}`, 'thumbnail', 'x'.repeat(300000)); expect(getArtworkCacheSnapshot().bytes).toBeLessThanOrEqual(getArtworkCacheSnapshot().maxBytes); });
});
