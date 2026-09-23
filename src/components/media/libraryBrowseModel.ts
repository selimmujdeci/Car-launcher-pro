/**
 * libraryBrowseModel — yerel kütüphanede ALBÜM · SANATÇI · KLASÖR · TÜR gezinmesi (SAF).
 *
 * ÖLÇÜLEN KUSUR: kütüphane ekranı düz bir parça listesi + aramaydı; keşif
 * ekranındaki albüm/sanatçı/klasör bölümleri en fazla 20 öğe gösteriyor ve
 * dokununca İÇİNE GİRMEDEN çalıyordu. Büyük bir USB kütüphanesinde "şu albümün
 * 5. parçası" seçilemiyordu.
 *
 * Bu model yalnız MusicIndex anlık görüntüsünden PROJEKSİYON üretir:
 *   · koleksiyonlar MusicIndex'in kendi albüm/sanatçı/klasör kayıtlarıdır
 *     (yeniden türetilmez); tür, parça alanından türetilir (koleksiyonu yoktur),
 *   · yalnız ERİŞİLEBİLİR parçalar sayılır ve gösterilir (STALE çalınmaz),
 *   · detay sırası KANONİK kuyruk sırasıdır (`buildLibraryQueueContext`):
 *     ekranda görülen sıra, dokununca kuyruğa girecek sıranın AYNISIDIR.
 * Sürüşte liste kısalır ve klasörler gizlenir — mevcut dikkat politikasıyla
 * aynı ilke (`discoveryModel`), yeni bir sürüş otoritesi kurulmaz.
 */

import type { MusicLibrarySnapshot, MusicTrack } from '../../platform/media/musicIndex';
import {
  buildLibraryQueueContext, type LibrarySelection,
} from '../../platform/media/session/libraryQueueContext';
import type { DrivingMode } from './nowPlayingModel';

export type BrowseTab = 'TRACKS' | 'ALBUMS' | 'ARTISTS' | 'FOLDERS' | 'GENRES';

export const BROWSE_TAB_LABEL: Readonly<Record<BrowseTab, string>> = {
  TRACKS: 'Parçalar', ALBUMS: 'Albümler', ARTISTS: 'Sanatçılar', FOLDERS: 'Klasörler', GENRES: 'Türler',
};

/** Sayıdan sonra tekil birim — Türkçede "2 klasör" (çoğul eki almaz). */
export const BROWSE_TAB_UNIT: Readonly<Record<BrowseTab, string>> = {
  TRACKS: 'parça', ALBUMS: 'albüm', ARTISTS: 'sanatçı', FOLDERS: 'klasör', GENRES: 'tür',
};

/** Sürüşte gösterilen azami satır — kütüphane parça listesiyle AYNI değer. */
export const DRIVING_BROWSE_LIMIT = 30;
/** Duruşta azami satır; aşan liste GİZLENMEZ, "daraltmak için ara" denir. */
export const BROWSE_LIMIT = 300;

export interface BrowseRow {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly trackCount: number;
  readonly artworkIdentity: string | null;
  readonly selection: LibrarySelection;
}

export interface BrowseList {
  readonly rows: readonly BrowseRow[];
  /** Filtre sonrası GERÇEK toplam (kesilmeden önce). */
  readonly total: number;
  readonly truncated: boolean;
}

export interface BrowseDetail {
  readonly title: string;
  readonly subtitle: string;
  readonly artworkIdentity: string | null;
  /** Kanonik kuyruk sırasıyla erişilebilir parçalar. */
  readonly tracks: readonly MusicTrack[];
  readonly selection: LibrarySelection;
}

const UNKNOWN_ALBUM = 'Bilinmeyen albüm';
const UNKNOWN_ARTIST = 'Bilinmeyen sanatçı';

const collator = new Intl.Collator('tr-TR', { sensitivity: 'base', numeric: true });
const norm = (s: string): string => s.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu, '');
const folderName = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;
const parentPath = (path: string): string => path.split('/').filter(Boolean).slice(0, -1).join('/');
const genreKey = (g: string): string => `genre:${norm(g.trim())}`;

function availableIds(snapshot: MusicLibrarySnapshot): Set<string> {
  return new Set(snapshot.tracks.filter((t) => t.availability === 'AVAILABLE').map((t) => t.id));
}

/** Görünür sekmeler: tür verisi yoksa Türler, sürüşte Klasörler GİZLENİR. */
export function availableBrowseTabs(snapshot: MusicLibrarySnapshot, drivingMode: DrivingMode): BrowseTab[] {
  const tabs: BrowseTab[] = ['TRACKS', 'ALBUMS', 'ARTISTS'];
  if (drivingMode !== 'driving') tabs.push('FOLDERS');
  if (snapshot.tracks.some((t) => t.availability === 'AVAILABLE' && t.genre && t.genre.trim())) tabs.push('GENRES');
  return tabs;
}

function genreRows(snapshot: MusicLibrarySnapshot): BrowseRow[] {
  const groups = new Map<string, { name: string; tracks: MusicTrack[] }>();
  for (const t of snapshot.tracks) {
    if (t.availability !== 'AVAILABLE' || !t.genre || !t.genre.trim()) continue;
    const key = genreKey(t.genre);
    const g = groups.get(key) ?? { name: t.genre.trim(), tracks: [] };
    g.tracks.push(t);
    groups.set(key, g);
  }
  return [...groups.entries()].map(([key, g]) => {
    const ordered = [...g.tracks].sort((a, b) =>
      collator.compare(a.artist ?? '', b.artist ?? '')
      || collator.compare(a.album ?? '', b.album ?? '')
      || (a.discNumber ?? 0) - (b.discNumber ?? 0)
      || (a.trackNumber ?? 0) - (b.trackNumber ?? 0)
      || collator.compare(a.title ?? '', b.title ?? ''));
    return {
      id: key, title: g.name, subtitle: '', trackCount: ordered.length, artworkIdentity: null,
      selection: { kind: 'TRACKS' as const, trackIds: ordered.map((t) => t.id) },
    };
  });
}

/** Bir sekmenin satırları — sıralı, filtreli, sürüşe göre kısaltılmış. */
export function buildBrowseList(
  snapshot: MusicLibrarySnapshot, tab: Exclude<BrowseTab, 'TRACKS'>, query: string, drivingMode: DrivingMode,
): BrowseList {
  const avail = availableIds(snapshot);
  const countOf = (ids: readonly string[]): number => ids.reduce((n, id) => (avail.has(id) ? n + 1 : n), 0);
  let rows: BrowseRow[];
  switch (tab) {
    case 'ALBUMS':
      rows = snapshot.albums.map((a) => ({
        id: a.id, title: a.title ?? UNKNOWN_ALBUM, subtitle: a.artist ?? UNKNOWN_ARTIST,
        trackCount: countOf(a.trackIds), artworkIdentity: a.artworkIdentity,
        selection: { kind: 'ALBUM' as const, albumId: a.id },
      }));
      break;
    case 'ARTISTS':
      rows = snapshot.artists.map((a) => ({
        id: a.id, title: a.name ?? UNKNOWN_ARTIST,
        subtitle: a.albumIds.length > 0 ? `${a.albumIds.length} albüm` : '',
        trackCount: countOf(a.trackIds), artworkIdentity: null,
        selection: { kind: 'ARTIST' as const, artistId: a.id },
      }));
      break;
    case 'FOLDERS':
      if (drivingMode === 'driving') return { rows: [], total: 0, truncated: false };
      rows = snapshot.folders.map((f) => ({
        id: f.id, title: folderName(f.path), subtitle: parentPath(f.path),
        trackCount: countOf(f.trackIds), artworkIdentity: null,
        selection: { kind: 'FOLDER' as const, folderId: f.id },
      }));
      break;
    case 'GENRES':
      rows = genreRows(snapshot);
      break;
  }
  const q = norm(query.trim());
  const filtered = rows
    .filter((r) => r.trackCount > 0)
    .filter((r) => !q || norm(r.title).includes(q) || norm(r.subtitle).includes(q))
    .sort((a, b) => collator.compare(a.title, b.title));
  const limit = drivingMode === 'driving' ? DRIVING_BROWSE_LIMIT : BROWSE_LIMIT;
  return { rows: filtered.slice(0, limit), total: filtered.length, truncated: filtered.length > limit };
}

/** Detay görünümü — parçalar kuyruğa girecekleri KANONİK sırayla. */
export function buildBrowseDetail(snapshot: MusicLibrarySnapshot, row: BrowseRow): BrowseDetail | null {
  const byId = new Map(snapshot.tracks.map((t) => [t.id, t]));
  let ids: readonly string[];
  if (row.selection.kind === 'TRACKS') {
    ids = row.selection.trackIds;
  } else {
    const ctx = buildLibraryQueueContext(row.selection);
    if (!ctx) return null;
    ids = ctx.entries.map((e) => e.libraryRef?.id ?? '').filter(Boolean);
  }
  const tracks = ids.map((id) => byId.get(id)).filter((t): t is MusicTrack => !!t && t.availability === 'AVAILABLE');
  if (tracks.length === 0) return null;
  return {
    title: row.title,
    subtitle: [row.subtitle, `${tracks.length} parça`].filter(Boolean).join(' · '),
    artworkIdentity: row.artworkIdentity,
    tracks,
    selection: row.selection,
  };
}

/** Detaydan belirli parçayla başlayan seçim (kanonik sıra korunur). */
export function selectionStartingAt(selection: LibrarySelection, trackId: string): LibrarySelection {
  return { ...selection, startTrackId: trackId };
}
