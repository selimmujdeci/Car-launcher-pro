/**
 * libraryBrowseModel.test.ts — albüm · sanatçı · klasör · tür gezinmesi.
 *
 * Kilitler: Türkçe alfabetik sıra · yalnız erişilebilir parça · sürüşte kısa liste
 * ve gizli klasörler · detay sırası = KANONİK kuyruk sırası · kesilen liste gizlenmez.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  _resetMusicIndexForTest, getMusicLibrarySnapshot, reconcileMusicIndex,
} from '../platform/media/musicIndex';
import type { LocalMusicTrack } from '../platform/localMusicService';
import { buildLibraryQueueContext } from '../platform/media/session/libraryQueueContext';
import {
  availableBrowseTabs, buildBrowseDetail, buildBrowseList, selectionStartingAt,
  DRIVING_BROWSE_LIMIT,
} from '../components/media/libraryBrowseModel';

let seq = 0;
const t = (over: Partial<LocalMusicTrack>): LocalMusicTrack => {
  seq += 1;
  return {
    id: seq, uri: `content://media/external/audio/media/${seq}`, title: `Parça ${seq}`,
    artist: 'Sanatçı', album: 'Albüm', durationMs: 180_000, trackNumber: 1,
    volumeName: 'external_primary', relativePath: 'Music/Genel/', ...over,
  } as LocalMusicTrack;
};

beforeEach(() => { _resetMusicIndexForTest(); seq = 0; });

describe('koleksiyon listeleri', () => {
  it('🔒 albümler Türkçe alfabeyle sıralanır (Ç, C\'den sonra; İ, I\'dan ayrı)', () => {
    reconcileMusicIndex([
      t({ album: 'Çiçek', artist: 'A' }), t({ album: 'Cam', artist: 'A' }),
      t({ album: 'Dağ', artist: 'A' }), t({ album: 'Bahar', artist: 'A' }),
    ]);
    const list = buildBrowseList(getMusicLibrarySnapshot(), 'ALBUMS', '', 'idle');
    expect(list.rows.map((r) => r.title)).toEqual(['Bahar', 'Cam', 'Çiçek', 'Dağ']);
  });

  it('sanatçı satırı albüm ve parça sayısını taşır; arama Türkçe duyarsızdır', () => {
    reconcileMusicIndex([
      t({ artist: 'Şebnem Ferah', album: 'Can Kırıkları' }),
      t({ artist: 'Şebnem Ferah', album: 'Perdeler' }),
      t({ artist: 'Teoman', album: 'O' }),
    ]);
    const all = buildBrowseList(getMusicLibrarySnapshot(), 'ARTISTS', '', 'idle');
    const sebnem = all.rows.find((r) => r.title === 'Şebnem Ferah')!;
    expect(sebnem.trackCount).toBe(2);
    expect(sebnem.subtitle).toBe('2 albüm');
    expect(buildBrowseList(getMusicLibrarySnapshot(), 'ARTISTS', 'sebnem', 'idle').rows.map((r) => r.title))
      .toEqual(['Şebnem Ferah']);
  });

  it('klasör adı son yol parçasıdır, üst yol alt başlıktır', () => {
    reconcileMusicIndex([t({ relativePath: 'USB/Yolculuk/Rock/' })]);
    const [row] = buildBrowseList(getMusicLibrarySnapshot(), 'FOLDERS', '', 'idle').rows;
    expect(row!.title).toBe('Rock');
    expect(row!.subtitle).toBe('USB/Yolculuk');
  });

  it('türler yalnız tür verisi varsa sekme olur ve parçalardan türetilir', () => {
    reconcileMusicIndex([t({})]);
    expect(availableBrowseTabs(getMusicLibrarySnapshot(), 'idle')).not.toContain('GENRES');
    reconcileMusicIndex([t({ genre: 'Rock' }), t({ genre: 'rock ' }), t({ genre: 'Pop' })]);
    expect(availableBrowseTabs(getMusicLibrarySnapshot(), 'idle')).toContain('GENRES');
    const rows = buildBrowseList(getMusicLibrarySnapshot(), 'GENRES', '', 'idle').rows;
    expect(rows.map((r) => [r.title, r.trackCount])).toEqual([['Pop', 1], ['Rock', 2]]);
  });
});

describe('sürüş politikası', () => {
  it('🔒 sürüşte klasör sekmesi yok, liste kısa ve kesilme GİZLENMEZ', () => {
    reconcileMusicIndex(Array.from({ length: 40 }, (_, i) => t({ album: `Albüm ${i + 1}` })));
    const snap = getMusicLibrarySnapshot();
    expect(availableBrowseTabs(snap, 'driving')).not.toContain('FOLDERS');
    expect(buildBrowseList(snap, 'FOLDERS', '', 'driving').rows).toHaveLength(0);
    const list = buildBrowseList(snap, 'ALBUMS', '', 'driving');
    expect(list.rows).toHaveLength(DRIVING_BROWSE_LIMIT);
    expect(list.total).toBe(40);
    expect(list.truncated).toBe(true);
    expect(buildBrowseList(snap, 'ALBUMS', '', 'idle').rows).toHaveLength(40);
  });
});

describe('detay', () => {
  it('🔒 detay sırası kanonik kuyruk sırasıdır (disk → parça no → başlık)', () => {
    reconcileMusicIndex([
      t({ title: 'Üç', trackNumber: 3 }), t({ title: 'Bir', trackNumber: 1 }), t({ title: 'İki', trackNumber: 2 }),
    ]);
    const row = buildBrowseList(getMusicLibrarySnapshot(), 'ALBUMS', '', 'idle').rows[0]!;
    const detail = buildBrowseDetail(getMusicLibrarySnapshot(), row)!;
    expect(detail.tracks.map((x) => x.title)).toEqual(['Bir', 'İki', 'Üç']);
    const ctx = buildLibraryQueueContext(row.selection)!;
    expect(ctx.entries.map((e) => e.libraryRef?.id)).toEqual(detail.tracks.map((x) => x.id));
    expect(detail.subtitle).toBe('Sanatçı · 3 parça');
  });

  it('parçaya dokunmak kuyruğu o parçadan başlatır', () => {
    reconcileMusicIndex([t({ title: 'Bir', trackNumber: 1 }), t({ title: 'İki', trackNumber: 2 })]);
    const row = buildBrowseList(getMusicLibrarySnapshot(), 'ALBUMS', '', 'idle').rows[0]!;
    const detail = buildBrowseDetail(getMusicLibrarySnapshot(), row)!;
    const second = detail.tracks[1]!;
    const ctx = buildLibraryQueueContext(selectionStartingAt(row.selection, second.id))!;
    expect(ctx.startIndex).toBe(1);
  });

  it('erişilemeyen (STALE) parça ne sayılır ne gösterilir', () => {
    reconcileMusicIndex([t({ title: 'Kalıcı', volumeName: 'external_primary' })]);
    reconcileMusicIndex([t({ title: 'USB', volumeName: 'abcd-1234' })], {
      scopeVolumes: ['abcd-1234'],
    });
    reconcileMusicIndex([], { scopeVolumes: ['abcd-1234'], staleVolumes: ['abcd-1234'] });
    const rows = buildBrowseList(getMusicLibrarySnapshot(), 'ALBUMS', '', 'idle').rows;
    expect(rows[0]!.trackCount).toBe(1);
    const detail = buildBrowseDetail(getMusicLibrarySnapshot(), rows[0]!)!;
    expect(detail.tracks.map((x) => x.title)).toEqual(['Kalıcı']);
  });
});
