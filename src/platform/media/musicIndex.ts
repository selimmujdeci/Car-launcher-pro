/** F2 library truth. Inventory/projections only; it never owns playback or native scanning. */
import { useSyncExternalStore } from 'react';
import type { LocalMusicTrack } from '../nativePlugin';
import { beginMusicIndexMeasure, recordMusicIndexRefresh, recordMusicSearch } from './musicIndexPerf';
import { mediaTrackId, migrateLegacyMediaTrackId, normalizeVolumeIdentity } from './mediaIdentity';

export type MusicIndexRevision = number;
export type MusicAvailability = 'AVAILABLE' | 'STALE';
export interface MediaRef { readonly id: string; readonly contentUri: string; readonly provenance: 'MEDIASTORE_EXTERNAL'; }
export interface MusicTrack extends MediaRef {
  readonly title: string | null; readonly artist: string | null; readonly album: string | null; readonly albumArtist: string | null;
  readonly durationMs: number | null; readonly trackNumber: number | null; readonly discNumber: number | null;
  readonly folder: string | null; readonly mimeType: string | null; readonly codec: string | null;
  readonly volumeName: string | null; readonly volumeIdentity: string; readonly storageKind: 'INTERNAL_SHARED' | 'REMOVABLE' | 'UNKNOWN'; readonly generationModified: number | null;
  readonly artworkIdentity: string | null; readonly availability: MusicAvailability;
  /* MUSIC F10.1 — kütüphane metadata'sı (F2 truth'unun parçası). Sağlayıcı
     sütunu boşsa `null` KALIR: "Bilinmeyen Tür"/sahte yıl ÜRETİLMEZ. Karakter
     katmanı bunu YALNIZ OKUR ve MusicIndex'i asla mutate etmez. */
  readonly genre: string | null; readonly year: number | null;
}
export interface MusicAlbum { readonly id: string; readonly title: string | null; readonly artist: string | null; readonly artworkIdentity: string | null; readonly trackIds: readonly string[]; }
export interface MusicArtist { readonly id: string; readonly name: string | null; readonly albumIds: readonly string[]; readonly trackIds: readonly string[]; }
export interface MusicFolder { readonly id: string; readonly path: string; readonly trackIds: readonly string[]; }
export interface MusicLibrarySnapshot {
  readonly revision: MusicIndexRevision; readonly tracks: readonly MusicTrack[]; readonly albums: readonly MusicAlbum[];
  readonly artists: readonly MusicArtist[]; readonly folders: readonly MusicFolder[]; readonly availability: 'READY' | 'UNAVAILABLE';
}
/** Which volumes the supplied inventory fully covers; anything outside is retained, never silently dropped. */
export interface ReconcileOptions { readonly scopeVolumes?: readonly string[]; readonly staleVolumes?: readonly string[]; }
const EMPTY: MusicLibrarySnapshot = Object.freeze({ revision: 0, tracks: Object.freeze([]), albums: Object.freeze([]), artists: Object.freeze([]), folders: Object.freeze([]), availability: 'UNAVAILABLE' });
let state = EMPTY; const subs = new Set<() => void>();
const norm = (v: string | null | undefined) => (v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').trim();
const id = (kind: string, value: string | null) => `${kind}:${norm(value)}`;
function toTrack(t: LocalMusicTrack): MusicTrack { const volumeIdentity = normalizeVolumeIdentity(t.volumeName); return Object.freeze({ id: mediaTrackId(volumeIdentity, t.id), contentUri: t.uri, provenance: 'MEDIASTORE_EXTERNAL', title: t.title || null, artist: t.artist || null, album: t.album || null, albumArtist: t.albumArtist ?? null, durationMs: t.durationMs > 0 ? t.durationMs : null, trackNumber: typeof t.trackNumber === 'number' && t.trackNumber > 0 ? t.trackNumber % 1000 : null, discNumber: typeof t.trackNumber === 'number' && t.trackNumber >= 1000 ? Math.floor(t.trackNumber / 1000) : (t.discNumber ?? null), folder: t.relativePath ?? null, mimeType: t.mimeType ?? null, codec: null, volumeName: t.volumeName ?? null, volumeIdentity, storageKind: t.storageKind ?? 'UNKNOWN', generationModified: t.generationModified ?? null, artworkIdentity: t.albumArtUri || null, availability: 'AVAILABLE', genre: (t.genre ?? null) || null, year: typeof t.year === 'number' && t.year > 0 ? t.year : null }); }
function sameTrack(a: MusicTrack, b: MusicTrack): boolean { return a.contentUri === b.contentUri && a.title === b.title && a.artist === b.artist && a.album === b.album && a.albumArtist === b.albumArtist && a.durationMs === b.durationMs && a.trackNumber === b.trackNumber && a.discNumber === b.discNumber && a.artworkIdentity === b.artworkIdentity && a.mimeType === b.mimeType && a.folder === b.folder && a.volumeName === b.volumeName && a.volumeIdentity === b.volumeIdentity && a.generationModified === b.generationModified && a.availability === b.availability && a.genre === b.genre && a.year === b.year; }
const withAvailability = (t: MusicTrack, availability: MusicAvailability): MusicTrack => t.availability === availability ? t : Object.freeze({ ...t, availability });
function project(tracks: readonly MusicTrack[]): Pick<MusicLibrarySnapshot, 'albums' | 'artists' | 'folders'> {
  const albums = new Map<string, { title: string | null; artist: string | null; artworkIdentity: string | null; trackIds: string[] }>();
  const artists = new Map<string, { name: string | null; albumIds: Set<string>; trackIds: string[] }>();
  const folders = new Map<string, string[]>();
  for (const t of tracks) {
    if (t.album !== null) { const k = id('album', `${t.album}\u0000${t.albumArtist ?? t.artist ?? ''}`); const a = albums.get(k) ?? { title: t.album, artist: t.albumArtist ?? t.artist, artworkIdentity: t.artworkIdentity, trackIds: [] }; a.trackIds.push(t.id); albums.set(k, a); }
    if (t.artist !== null) { const k = id('artist', t.artist); const a = artists.get(k) ?? { name: t.artist, albumIds: new Set(), trackIds: [] }; if (t.album !== null) a.albumIds.add(id('album', `${t.album}\u0000${t.albumArtist ?? t.artist ?? ''}`)); a.trackIds.push(t.id); artists.set(k, a); }
    if (t.folder !== null) { const a = folders.get(t.folder) ?? []; a.push(t.id); folders.set(t.folder, a); }
  }
  return { albums: Object.freeze([...albums].map(([albumId, a]) => Object.freeze({ id: albumId, title: a.title, artist: a.artist, artworkIdentity: a.artworkIdentity, trackIds: Object.freeze(a.trackIds) }))), artists: Object.freeze([...artists].map(([artistId, a]) => Object.freeze({ id: artistId, name: a.name, albumIds: Object.freeze([...a.albumIds]), trackIds: Object.freeze(a.trackIds) }))), folders: Object.freeze([...folders].map(([path, trackIds]) => Object.freeze({ id: id('folder', path), path, trackIds: Object.freeze(trackIds) }))) };
}
function commit(tracks: MusicTrack[], startedAt: number): MusicLibrarySnapshot {
  tracks.sort((a, b) => norm(a.title).localeCompare(norm(b.title), 'tr-TR'));
  state = Object.freeze({ revision: state.revision + 1, tracks: Object.freeze(tracks), ...project(tracks), availability: 'READY' });
  recordMusicIndexRefresh(startedAt); subs.forEach((fn) => fn()); return state;
}
/**
 * Reconciles a MediaStore response incrementally by stable media identity.
 *
 * Without `scopeVolumes` the response is the WHOLE library (legacy single-volume
 * path). With it, only the listed volumes are replaced; items on other volumes are
 * retained — and marked STALE when that volume is listed in `staleVolumes` — because
 * "I could not read this volume" is not evidence that the files were deleted.
 */
export function reconcileMusicIndex(input: readonly LocalMusicTrack[], options?: ReconcileOptions): MusicLibrarySnapshot {
  const startedAt = beginMusicIndexMeasure();
  const scope = options?.scopeVolumes ? new Set(options.scopeVolumes.map(normalizeVolumeIdentity)) : null;
  const stale = new Set((options?.staleVolumes ?? []).map(normalizeVolumeIdentity));
  const prior = new Map(state.tracks.map((t) => [t.id, t])); const next: MusicTrack[] = [];
  for (const raw of input) { const candidate = toTrack(raw); const old = prior.get(candidate.id); prior.delete(candidate.id); next.push(old && sameTrack(old, candidate) ? old : candidate); }
  if (scope) for (const t of prior.values()) if (!scope.has(t.volumeIdentity)) next.push(withAvailability(t, stale.has(t.volumeIdentity) ? 'STALE' : t.availability));
  return commit(next, startedAt);
}
/**
 * Applies an add/modify-only delta. Returns `null` when there is no READY baseline
 * to merge onto, which forces the caller to escalate to a full reconcile instead of
 * inventing a library out of a partial answer.
 */
export function applyMusicIndexDelta(upserts: readonly LocalMusicTrack[]): MusicLibrarySnapshot | null {
  if (state.availability !== 'READY') return null;
  const startedAt = beginMusicIndexMeasure();
  const merged = new Map(state.tracks.map((t) => [t.id, t]));
  for (const raw of upserts) { const candidate = toTrack(raw); const old = merged.get(candidate.id); merged.set(candidate.id, old && sameTrack(old, candidate) ? old : candidate); }
  return commit([...merged.values()], startedAt);
}
/**
 * Deletion reconciliation for one volume. MediaStore emits no tombstones, so a
 * delta round can never prove a removal; the caller supplies the volume's CURRENT
 * full identity set and everything else on that volume is dropped. Other volumes
 * are untouched — an unreadable volume must not delete another volume's items.
 */
export function pruneMusicVolume(volumeIdentity: string, presentTrackIds: readonly string[]): MusicLibrarySnapshot {
  if (state.availability !== 'READY') return state;
  const startedAt = beginMusicIndexMeasure();
  const volume = normalizeVolumeIdentity(volumeIdentity);
  const present = new Set(presentTrackIds);
  const kept = state.tracks.filter((t) => t.volumeIdentity !== volume || present.has(t.id));
  if (kept.length === state.tracks.length) { recordMusicIndexRefresh(startedAt); return state; }
  return commit(kept, startedAt);
}
/** Detach/permission loss: items stay addressable but stop claiming to be present. */
export function markMusicVolumeStale(volumeIdentities: readonly string[]): MusicLibrarySnapshot {
  const startedAt = beginMusicIndexMeasure();
  const stale = new Set(volumeIdentities.map(normalizeVolumeIdentity));
  if (!stale.size || state.availability !== 'READY') { recordMusicIndexRefresh(startedAt); return state; }
  return commit(state.tracks.map((t) => stale.has(t.volumeIdentity) ? withAvailability(t, 'STALE') : t), startedAt);
}
export function markMusicIndexUnavailable(): void { state = EMPTY; subs.forEach((fn) => fn()); }
export function getMusicLibrarySnapshot(): MusicLibrarySnapshot { return state; }
export function subscribeMusicLibrary(listener: () => void): () => void { subs.add(listener); return () => subs.delete(listener); }
export function useMusicLibrary(): MusicLibrarySnapshot { return useSyncExternalStore(subscribeMusicLibrary, getMusicLibrarySnapshot, getMusicLibrarySnapshot); }
export function searchMusicLibrary(query: string, limit = 100): readonly MediaRef[] { const startedAt = beginMusicIndexMeasure(); const q = norm(query); const result = !q ? state.tracks.slice(0, limit) : state.tracks.filter((t) => norm(t.title).includes(q) || norm(t.artist).includes(q) || norm(t.album).includes(q)).slice(0, limit); recordMusicSearch(startedAt); return result; }
/** Legacy `media:<id>` refs are migrated deterministically; STALE and unknown refs fail closed. */
export function resolveMusicRef(ref: MediaRef): MusicTrack | null { const wanted = migrateLegacyMediaTrackId(ref.id); const t = state.tracks.find((x) => x.id === wanted && x.contentUri === ref.contentUri); return t?.availability === 'AVAILABLE' ? t : null; }
export function _resetMusicIndexForTest(): void { state = EMPTY; subs.clear(); }
