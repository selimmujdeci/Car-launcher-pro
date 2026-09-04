/**
 * musicPlaylistAuthority.ts — MUSIC F15 · TEK playlist otoritesi.
 *
 * SAHİPLİK (CLAUDE.md §ONE DOMAIN = ONE AUTHORITY):
 *   SAHİP OLUR: playlist oluşturma/silme/yeniden adlandırma · öğe ekleme/
 *   çıkarma · sıralama · kalıcılık · kimlik/provenance · koleksiyon
 *   projeksiyonu.
 *   SAHİP OLMAZ: playback truth (F0) · PlayQueue (F3) · ListeningSession (F3) ·
 *   MusicIndex (F2) · arama sıralaması (F5) · sağlayıcı devri (F7.6) ·
 *   favori üyeliği (F13 — AYRI otorite, AYRI kalıcı anahtar, BİRBİRİNE
 *   dönüşmez). "Playlist'te olmak = çalıyor olmak DEĞİLDİR."
 *
 * OYNATMA: `resolvePlaybackTarget`/`resolvePlaylistStartPlan` yalnız VERİ
 * döner — kendisi ASLA dispatch etmez. Gerçek dispatch ÇAĞIRANDA olur (F9
 * router / UI seçim akışı); PROVIDER başlangıcı F7.6'nın KENDİ same-provider
 * kuyruk kurucusuna (`carosMediaLayer.playMedia` → `buildProviderQueueContext`)
 * devredilir — burada İKİNCİ bir kuyruk kurucu İCAT EDİLMEZ.
 *
 * KALICILIK: `safeStorage.getItem/setItem` — F13 `musicCollectionAuthority`
 * ile AYNI desen, AYRI anahtar (`caros.music.f15.playlists.v1`).
 *
 * PERFORMANS: playlist/öğe sorgusu `Map` üzerinde O(1)/O(playlist boyutu)'dur;
 * render hot-path'inde tarama YOKTUR. Timer/polling YOK — yalnız mutasyon-
 * tetiklemeli `notify()` + O(1) eşitlik için revizyon sayacı.
 */

import { safeStorage } from '../../../utils/safeStorage';
import { getMusicLibrarySnapshot } from '../musicIndex';
import type { CanonicalMediaIdentity } from '../session/mediaIdentityMatching';
import type { SourceClass } from '../authority/sourceCapabilities';
import type { ProviderId } from '../providers';
import {
  PLAYLIST_SCHEMA_VERSION, MAX_PLAYLISTS, MAX_ITEMS_PER_PLAYLIST,
  playlistItemKeyFor, makePlaylistItemEntry, parsePlaylist, sanitizePlaylistName,
  type Playlist, type PlaylistItemEntry, type PlaylistMutationResult,
} from './musicPlaylistEntry';
import {
  noteCollectionMutation, notePersistWriteFailure, notePersistLoadRejectedRecord,
  noteUnresolvedLocalLookup, noteProjectionLatency, noteCollectionSize,
} from './musicPlaylistTelemetry';

const STORAGE_KEY = 'caros.music.f15.playlists.v1';

let playlists = new Map<string, Playlist>();
let loaded = false;
let revision = 0;
const subs = new Set<() => void>();

function notify(): void { revision += 1; subs.forEach((fn) => fn()); }

/** Ucuz, kararlı mutasyon sayacı — bkz. F13 `getFavoritesRevision` ile AYNI ilke. */
export function getPlaylistsRevision(): number { ensureLoaded(); return revision; }

function noteSizeSnapshot(): void {
  let items = 0; let local = 0; let provider = 0;
  playlists.forEach((p) => {
    items += p.items.length;
    for (const it of p.items) { if (it.kind === 'LOCAL') local += 1; else provider += 1; }
  });
  noteCollectionSize(playlists.size, items, local, provider);
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  let raw: unknown = null;
  try { raw = safeStorage.getItem(STORAGE_KEY); } catch { raw = null; }
  if (typeof raw !== 'string' || !raw) { noteSizeSnapshot(); return; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { noteSizeSnapshot(); return; }
  const list = parsed && typeof parsed === 'object' ? (parsed as { playlists?: unknown }).playlists : null;
  if (!Array.isArray(list)) { noteSizeSnapshot(); return; }
  const next = new Map<string, Playlist>();
  for (const item of list) {
    const pl = parsePlaylist(item, () => notePersistLoadRejectedRecord());
    if (pl === null) { notePersistLoadRejectedRecord(); continue; }
    next.set(pl.id, pl);
  }
  playlists = next;
  noteSizeSnapshot();
}

function persist(): void {
  try {
    const body = { schemaVersion: PLAYLIST_SCHEMA_VERSION, playlists: Array.from(playlists.values()) };
    safeStorage.setItem(STORAGE_KEY, JSON.stringify(body));
  } catch {
    /* Kalıcılık başarısız olsa da oynatma ETKİLENMEZ (fail-soft). */
    notePersistWriteFailure();
  }
}

function genPlaylistId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return `pl-${c.randomUUID()}`;
  } catch { /* fail-soft */ }
  return `pl-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

/* ── Sorgu ─────────────────────────────────────────────────────────────── */

export function subscribePlaylists(listener: () => void): () => void {
  ensureLoaded();
  subs.add(listener);
  return () => subs.delete(listener);
}

/** En son değiştirilen ÖNCE — kullanıcının az önce dokunduğu liste üstte. */
export function getPlaylists(): readonly Playlist[] {
  ensureLoaded();
  return Array.from(playlists.values()).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export function getPlaylist(playlistId: string): Playlist | null {
  ensureLoaded();
  return playlists.get(playlistId) ?? null;
}

export function getPlaylistsCount(): { readonly total: number; readonly items: number } {
  ensureLoaded();
  let items = 0;
  playlists.forEach((p) => { items += p.items.length; });
  return { total: playlists.size, items };
}

/**
 * Ad EŞLEŞMESİ (Mavi disambiguation için) — büyük/küçük harf ve baştaki/
 * sondaki boşluktan bağımsız TAM eşleşme önce denenir; yoksa alt-dizge
 * eşleşmesi. Sıfır/çoklu eşleşme çağırana AMBIGUOUS/NOT_FOUND kararını
 * BIRAKIR — burada tahmin YAPILMAZ.
 */
export function findPlaylistsByName(query: string): readonly Playlist[] {
  ensureLoaded();
  const q = query.trim().toLocaleLowerCase('tr-TR');
  if (q.length === 0) return Object.freeze([]);
  const all = getPlaylists();
  const exact = all.filter((p) => p.name.trim().toLocaleLowerCase('tr-TR') === q);
  if (exact.length > 0) return Object.freeze(exact);
  return Object.freeze(all.filter((p) => p.name.toLocaleLowerCase('tr-TR').includes(q)));
}

/* ── Playlist mutasyonu ────────────────────────────────────────────────── */

export function createPlaylist(name: string): PlaylistMutationResult {
  ensureLoaded();
  const clean = sanitizePlaylistName(name);
  if (clean === null) {
    noteCollectionMutation('REJECTED_NAME_EMPTY', Date.now());
    return { status: 'REJECTED_NAME_EMPTY', playlistId: null, itemKey: null };
  }
  if (playlists.size >= MAX_PLAYLISTS) {
    noteCollectionMutation('REJECTED_PLAYLIST_LIMIT', Date.now());
    return { status: 'REJECTED_PLAYLIST_LIMIT', playlistId: null, itemKey: null };
  }
  const now = Date.now();
  const id = genPlaylistId();
  const pl: Playlist = Object.freeze({
    schemaVersion: PLAYLIST_SCHEMA_VERSION, id, name: clean,
    items: Object.freeze([]), createdAtMs: now, updatedAtMs: now,
  });
  const next = new Map(playlists);
  next.set(id, pl);
  playlists = next;
  persist();
  noteSizeSnapshot();
  noteCollectionMutation('CREATED', now);
  notify();
  return { status: 'CREATED', playlistId: id, itemKey: null };
}

export function deletePlaylist(playlistId: string): PlaylistMutationResult {
  ensureLoaded();
  if (!playlists.has(playlistId)) {
    noteCollectionMutation('REJECTED_NOT_FOUND', Date.now());
    return { status: 'REJECTED_NOT_FOUND', playlistId: null, itemKey: null };
  }
  const next = new Map(playlists);
  next.delete(playlistId);
  playlists = next;
  persist();
  noteSizeSnapshot();
  noteCollectionMutation('DELETED', Date.now());
  notify();
  return { status: 'DELETED', playlistId, itemKey: null };
}

export function renamePlaylist(playlistId: string, newName: string): PlaylistMutationResult {
  ensureLoaded();
  const existing = playlists.get(playlistId);
  if (!existing) {
    noteCollectionMutation('REJECTED_NOT_FOUND', Date.now());
    return { status: 'REJECTED_NOT_FOUND', playlistId: null, itemKey: null };
  }
  const clean = sanitizePlaylistName(newName);
  if (clean === null) {
    noteCollectionMutation('REJECTED_NAME_EMPTY', Date.now());
    return { status: 'REJECTED_NAME_EMPTY', playlistId, itemKey: null };
  }
  const now = Date.now();
  const next = new Map(playlists);
  next.set(playlistId, Object.freeze({ ...existing, name: clean, updatedAtMs: now }));
  playlists = next;
  persist();
  noteCollectionMutation('RENAMED', now);
  notify();
  return { status: 'RENAMED', playlistId, itemKey: null };
}

export function addItemToPlaylist(
  playlistId: string, identity: CanonicalMediaIdentity, sourceClass: SourceClass,
): PlaylistMutationResult {
  ensureLoaded();
  const existing = playlists.get(playlistId);
  if (!existing) {
    noteCollectionMutation('REJECTED_NOT_FOUND', Date.now());
    return { status: 'REJECTED_NOT_FOUND', playlistId: null, itemKey: null };
  }
  const key = playlistItemKeyFor(identity);
  if (key === null) {
    noteCollectionMutation('REJECTED_NO_IDENTITY', Date.now());
    return { status: 'REJECTED_NO_IDENTITY', playlistId, itemKey: null };
  }
  if (existing.items.some((it) => it.key === key)) {
    noteCollectionMutation('ITEM_ALREADY_PRESENT', Date.now());
    return { status: 'ITEM_ALREADY_PRESENT', playlistId, itemKey: key };
  }
  if (existing.items.length >= MAX_ITEMS_PER_PLAYLIST) {
    noteCollectionMutation('REJECTED_ITEM_LIMIT', Date.now());
    return { status: 'REJECTED_ITEM_LIMIT', playlistId, itemKey: null };
  }
  const now = Date.now();
  const entry = makePlaylistItemEntry(identity, sourceClass, now);
  if (entry === null) {
    noteCollectionMutation('REJECTED_NO_IDENTITY', Date.now());
    return { status: 'REJECTED_NO_IDENTITY', playlistId, itemKey: null };
  }
  const next = new Map(playlists);
  next.set(playlistId, Object.freeze({
    ...existing, items: Object.freeze([...existing.items, entry]), updatedAtMs: now,
  }));
  playlists = next;
  persist();
  noteSizeSnapshot();
  noteCollectionMutation('ITEM_ADDED', now);
  notify();
  return { status: 'ITEM_ADDED', playlistId, itemKey: entry.key };
}

export function removeItemFromPlaylist(playlistId: string, itemKey: string): PlaylistMutationResult {
  ensureLoaded();
  const existing = playlists.get(playlistId);
  if (!existing) {
    noteCollectionMutation('REJECTED_NOT_FOUND', Date.now());
    return { status: 'REJECTED_NOT_FOUND', playlistId: null, itemKey: null };
  }
  if (!existing.items.some((it) => it.key === itemKey)) {
    noteCollectionMutation('ITEM_ALREADY_ABSENT', Date.now());
    return { status: 'ITEM_ALREADY_ABSENT', playlistId, itemKey };
  }
  const now = Date.now();
  const next = new Map(playlists);
  next.set(playlistId, Object.freeze({
    ...existing, items: Object.freeze(existing.items.filter((it) => it.key !== itemKey)), updatedAtMs: now,
  }));
  playlists = next;
  persist();
  noteSizeSnapshot();
  noteCollectionMutation('ITEM_REMOVED', now);
  notify();
  return { status: 'ITEM_REMOVED', playlistId, itemKey };
}

/** Kimlikten çıkarma — Now Playing/Mavi'nin "bunu listeden çıkar" akışı için. */
export function removeIdentityFromPlaylist(
  playlistId: string, identity: CanonicalMediaIdentity,
): PlaylistMutationResult {
  const key = playlistItemKeyFor(identity);
  if (key === null) {
    noteCollectionMutation('REJECTED_NO_IDENTITY', Date.now());
    return { status: 'REJECTED_NO_IDENTITY', playlistId, itemKey: null };
  }
  return removeItemFromPlaylist(playlistId, key);
}

/**
 * Öğeyi yeni bir dizin konumuna taşır (sürükle-bırak/oklarla sıralama).
 * Dizinin KENDİSİ sıralamadır — ikinci bir "sortIndex" alanı YOK.
 */
export function moveItemInPlaylist(
  playlistId: string, itemKey: string, toIndex: number,
): PlaylistMutationResult {
  ensureLoaded();
  const existing = playlists.get(playlistId);
  if (!existing) {
    noteCollectionMutation('REJECTED_NOT_FOUND', Date.now());
    return { status: 'REJECTED_NOT_FOUND', playlistId: null, itemKey: null };
  }
  const fromIndex = existing.items.findIndex((it) => it.key === itemKey);
  if (fromIndex === -1) {
    noteCollectionMutation('ITEM_ALREADY_ABSENT', Date.now());
    return { status: 'ITEM_ALREADY_ABSENT', playlistId, itemKey };
  }
  const clampedTo = Math.max(0, Math.min(existing.items.length - 1, Math.trunc(toIndex)));
  const items = existing.items.slice();
  const [moved] = items.splice(fromIndex, 1);
  items.splice(clampedTo, 0, moved!);
  const now = Date.now();
  const next = new Map(playlists);
  next.set(playlistId, Object.freeze({ ...existing, items: Object.freeze(items), updatedAtMs: now }));
  playlists = next;
  persist();
  noteCollectionMutation('REORDERED', now);
  notify();
  return { status: 'REORDERED', playlistId, itemKey };
}

/* ── Görüntü projeksiyonu (fail-closed — sahte metadata ÜRETİLMEZ) ───────── */

export interface PlaylistItemDisplay {
  readonly key: string;
  readonly kind: PlaylistItemEntry['kind'];
  readonly title: string | null;
  readonly artist: string | null;
  readonly artworkIdentity: string | null;
  /** `false` → içerik artık çözülemiyor (silinmiş/taşınmış yerel dosya). */
  readonly resolved: boolean;
}

export function resolvePlaylistItemDisplays(
  items: readonly PlaylistItemEntry[],
): readonly PlaylistItemDisplay[] {
  const startedAt = Date.now();
  const snapshot = getMusicLibrarySnapshot();
  const byId = new Map(snapshot.tracks.map((t) => [t.id, t] as const));
  const result = items.map((entry): PlaylistItemDisplay => {
    if (entry.kind === 'LOCAL') {
      const track = entry.libraryId ? byId.get(entry.libraryId) : undefined;
      if (!track || track.availability !== 'AVAILABLE') {
        noteUnresolvedLocalLookup();
        return { key: entry.key, kind: 'LOCAL', title: null, artist: null, artworkIdentity: null, resolved: false };
      }
      return {
        key: entry.key, kind: 'LOCAL', title: track.title, artist: track.artist,
        artworkIdentity: track.artworkIdentity, resolved: true,
      };
    }
    return {
      key: entry.key, kind: 'PROVIDER', title: entry.displayTitle, artist: entry.displayArtist,
      artworkIdentity: entry.displayArtwork, resolved: true,
    };
  });
  noteProjectionLatency(Date.now() - startedAt);
  return result;
}

/* ── Oynatma hedefi (VERİ SÖZLEŞMESİ — dispatch BURADA YAPILMAZ) ─────────── */

export interface PlaylistPlaybackTarget {
  readonly kind: PlaylistItemEntry['kind'];
  readonly libraryId: string | null;
  readonly provider: ProviderId | null;
  readonly contentUri: string | null;
  readonly sourceClass: SourceClass;
  readonly playable: boolean;
}

export function resolvePlaybackTarget(entry: PlaylistItemEntry): PlaylistPlaybackTarget {
  if (entry.kind === 'LOCAL') {
    const snapshot = getMusicLibrarySnapshot();
    const track = entry.libraryId
      ? snapshot.tracks.find((t) => t.id === entry.libraryId && t.availability === 'AVAILABLE')
      : undefined;
    return {
      kind: 'LOCAL', libraryId: entry.libraryId, provider: null,
      contentUri: track?.contentUri ?? null, sourceClass: entry.sourceClass, playable: track !== undefined,
    };
  }
  return {
    kind: 'PROVIDER', libraryId: null, provider: entry.provider, contentUri: entry.contentUri,
    sourceClass: entry.sourceClass, playable: entry.contentUri !== null && entry.provider !== null,
  };
}

/**
 * "X listemden çal" başlangıç planı — belirli bir öğeden BAŞLAR (yoksa ilk
 * ÇÖZÜLEBİLEN öğeden). Karma-sağlayıcı playlist'te başlangıç öğesinin
 * kaynağıyla AYNI sınıftaki öğeler döner (F7.6 same-provider kuralıyla
 * AYNI ilke) — dispatch YİNE ÇAĞIRANDADIR, bu yalnız VERİ planı üretir.
 */
export interface PlaylistStartPlan {
  /** LOCAL başlangıçta bu listenin TÜMÜ aynı kaynak sınıfındandır (F3 TRACKS). */
  readonly localLibraryIds: readonly string[];
  readonly startLibraryId: string | null;
  /** PROVIDER başlangıçta yalnız başlangıç öğesiyle AYNI sağlayıcı sınıfı. */
  readonly providerEntries: readonly PlaylistItemEntry[];
  readonly startProviderKey: string | null;
}

export function resolvePlaylistStartPlan(
  playlist: Playlist, startItemKey?: string,
): PlaylistStartPlan | null {
  const startEntry = startItemKey
    ? playlist.items.find((it) => it.key === startItemKey) ?? null
    : playlist.items.find((it) => resolvePlaybackTarget(it).playable) ?? null;
  if (startEntry === null) return null;
  const target = resolvePlaybackTarget(startEntry);
  if (!target.playable) return null;

  if (startEntry.kind === 'LOCAL') {
    const localIds = playlist.items
      .filter((it) => it.kind === 'LOCAL' && resolvePlaybackTarget(it).playable)
      .map((it) => it.libraryId!);
    return {
      localLibraryIds: Object.freeze(localIds), startLibraryId: startEntry.libraryId,
      providerEntries: Object.freeze([]), startProviderKey: null,
    };
  }

  /* PROVIDER: yalnız AYNI sağlayıcı sınıfı — `carosMediaLayer.playMedia`nın
     kendi `buildProviderQueueContext`ı zaten bunu uygular, burada TEKRAR
     edilir çünkü çağıranın `UnifiedTrack[]` inşa etmeden ÖNCE hangi
     öğeleri teklif edeceğini bilmesi gerekir (ikinci bir kuyruk kurucu
     İCAT EDİLMEDİ — yalnız aynı filtre burada ÖNİZLENİR). */
  const sameProvider = playlist.items.filter(
    (it) => it.kind === 'PROVIDER' && it.sourceClass === startEntry.sourceClass
      && resolvePlaybackTarget(it).playable,
  );
  return {
    localLibraryIds: Object.freeze([]), startLibraryId: null,
    providerEntries: Object.freeze(sameProvider), startProviderKey: startEntry.key,
  };
}

export function _resetMusicPlaylistAuthorityForTest(): void {
  playlists = new Map();
  loaded = false;
  revision = 0;
  subs.clear();
  try { safeStorage.removeItem(STORAGE_KEY); } catch { /* test ortamı — yoksay */ }
}
