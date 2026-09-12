/**
 * musicCollectionAuthority.ts — MUSIC F13 · TEK favori/koleksiyon otoritesi.
 *
 * SAHİPLİK (CLAUDE.md §ONE DOMAIN = ONE AUTHORITY):
 *   SAHİP OLUR: favori üyeliği · ekleme/çıkarma/toggle · kalıcılık ·
 *   kimlik/provenance · bounded görüntü metadata'sı · koleksiyon projeksiyonu.
 *   SAHİP OLMAZ: playback truth (F0) · PlayQueue (F3) · ListeningSession (F3) ·
 *   MusicIndex (F2) · arama sıralaması (F5) · sağlayıcı devri (F7.6) ·
 *   öneri/F8 · trait/F10. "Favori olmak = çalıyor olmak DEĞİLDİR. Favori
 *   olmak = öneri kanıtı DEĞİLDİR."
 *
 * OYNATMA: `resolvePlaybackTarget` yalnız VERİ döndürür — kendisi ASLA
 * dispatch etmez (native çağrı/`playMedia` YOK). Gerçek dispatch ÇAĞIRANDA
 * olur (F9 router / Discovery seçim akışı); bu, "favoriler playback
 * otoritesi olamaz" ve "karışık-sağlayıcı favori listesi ≠ karışık-sağlayıcı
 * PlayQueue" kısıtlarının YAPISAL güvencesidir — her dispatch tek-öğe
 * tek-sağlayıcı bir kuyruk kurar.
 *
 * KALICILIK: `safeStorage.getItem/setItem` (F8 `preferenceEvidence` / F5.1
 * `recentlyPlayed` ile AYNI desen) — disk yazımı `safeStorage`'ın kendi
 * debounce/idle katmanına TABİDİR (burada TEKRARLANMAZ). Mavi'nin "favorilere
 * ekledim" iddiası buna rağmen dürüsttür: iddianın dayandığı kanıt kalıcı
 * diskin ANLIK durumu değil, bu modülün TEK doğruluk kaynağı olan bellek-içi
 * `favorites` Map'inin SENKRON güncellenmesidir — `isFavorite`/`getFavoritesSnapshot`
 * her zaman bu Map'i okur, asla diski değil (spec §7).
 *
 * PERFORMANS: üyelik sorgusu (`isFavorite`) bir `Map` üzerinde O(1)'dir;
 * render hot-path'inde tarama/sıralama YOKTUR. Timer/polling/global
 * zamanlayıcı YOKTUR — yalnız mutasyon-tetiklemeli `notify()`.
 */

import { safeStorage } from '../../../utils/safeStorage';
import { getMusicLibrarySnapshot } from '../musicIndex';
import type { CanonicalMediaIdentity } from '../session/mediaIdentityMatching';
import type { SourceClass } from '../authority/sourceCapabilities';
import type { ProviderId } from '../providers';
import {
  COLLECTION_SCHEMA_VERSION, MAX_FAVORITES,
  favoriteKeyFor, makeFavoriteEntry, parseFavoriteEntry,
  type FavoriteEntry, type FavoriteMutationResult,
} from './musicCollectionEntry';
import {
  noteCollectionMutation, noteCollectionToggle, notePersistWriteFailure,
  notePersistLoadRejectedRecord, noteUnresolvedLocalLookup,
  noteProjectionLatency, noteCollectionSize,
} from './musicCollectionTelemetry';

const STORAGE_KEY = 'caros.music.f13.favorites.v1';

let favorites = new Map<string, FavoriteEntry>();
let loaded = false;
let revision = 0;
const subs = new Set<() => void>();

function notify(): void { revision += 1; subs.forEach((fn) => fn()); }

/**
 * Ucuz, kararlı mutasyon sayacı — `useSyncExternalStore` gibi tüketiciler
 * her render'da yeni dizi ayırmadan (bkz. `getFavoritesSnapshot`) değişikliği
 * fark edebilsin diye (§10 performans: render hot-path'inde tarama YOK).
 */
export function getFavoritesRevision(): number { ensureLoaded(); return revision; }

function noteSizeSnapshot(): void {
  let local = 0; let provider = 0;
  favorites.forEach((e) => { if (e.kind === 'LOCAL') local += 1; else provider += 1; });
  noteCollectionSize(local, provider);
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  let raw: unknown = null;
  try { raw = safeStorage.getItem(STORAGE_KEY); } catch { raw = null; }
  if (typeof raw !== 'string' || !raw) { noteSizeSnapshot(); return; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { noteSizeSnapshot(); return; }
  const entries = parsed && typeof parsed === 'object' ? (parsed as { entries?: unknown }).entries : null;
  if (!Array.isArray(entries)) { noteSizeSnapshot(); return; }
  const next = new Map<string, FavoriteEntry>();
  for (const item of entries) {
    const entry = parseFavoriteEntry(item);
    /* Bozuk/şema-uyumsuz kayıt sessizce UYDURULMAZ — atlanır, sayılır. */
    if (entry === null) { notePersistLoadRejectedRecord(); continue; }
    next.set(entry.key, entry);
  }
  favorites = next;
  noteSizeSnapshot();
}

function persist(): void {
  try {
    const body = { schemaVersion: COLLECTION_SCHEMA_VERSION, entries: Array.from(favorites.values()) };
    safeStorage.setItem(STORAGE_KEY, JSON.stringify(body));
  } catch {
    /* Kalıcılık başarısız olsa da oynatma ETKİLENMEZ (fail-soft, §13). */
    notePersistWriteFailure();
  }
}

/* ── Sorgu (O(1) üyelik) ──────────────────────────────────────────────── */

export function isFavorite(identity: CanonicalMediaIdentity): boolean {
  ensureLoaded();
  const key = favoriteKeyFor(identity);
  return key !== null && favorites.has(key);
}

export function subscribeFavorites(listener: () => void): () => void {
  ensureLoaded();
  subs.add(listener);
  return () => subs.delete(listener);
}

export function getFavoritesSnapshot(): readonly FavoriteEntry[] {
  ensureLoaded();
  return Array.from(favorites.values()).sort((a, b) => b.addedAtMs - a.addedAtMs);
}

export function getFavoritesCount(): { readonly total: number; readonly local: number; readonly provider: number } {
  ensureLoaded();
  let local = 0; let provider = 0;
  favorites.forEach((e) => { if (e.kind === 'LOCAL') local += 1; else provider += 1; });
  return { total: favorites.size, local, provider };
}

/* ── Mutasyon ──────────────────────────────────────────────────────────── */

export function addFavorite(identity: CanonicalMediaIdentity, sourceClass: SourceClass): FavoriteMutationResult {
  ensureLoaded();
  const key = favoriteKeyFor(identity);
  if (key === null) {
    noteCollectionMutation('REJECTED_NO_IDENTITY', Date.now());
    return { status: 'REJECTED_NO_IDENTITY', key: null, entry: null };
  }
  const existing = favorites.get(key);
  if (existing) {
    noteCollectionMutation('ALREADY_PRESENT', Date.now());
    return { status: 'ALREADY_PRESENT', key, entry: existing };
  }
  if (favorites.size >= MAX_FAVORITES) {
    noteCollectionMutation('REJECTED_COLLECTION_FULL', Date.now());
    return { status: 'REJECTED_COLLECTION_FULL', key, entry: null };
  }
  const entry = makeFavoriteEntry(identity, sourceClass, Date.now());
  if (entry === null) {
    noteCollectionMutation('REJECTED_NO_IDENTITY', Date.now());
    return { status: 'REJECTED_NO_IDENTITY', key: null, entry: null };
  }
  const next = new Map(favorites);
  next.set(entry.key, entry);
  favorites = next;
  persist();
  noteSizeSnapshot();
  noteCollectionMutation('ADDED', Date.now());
  notify();
  return { status: 'ADDED', key: entry.key, entry };
}

export function removeFavorite(identity: CanonicalMediaIdentity): FavoriteMutationResult {
  ensureLoaded();
  const key = favoriteKeyFor(identity);
  if (key === null) {
    noteCollectionMutation('REJECTED_NO_IDENTITY', Date.now());
    return { status: 'REJECTED_NO_IDENTITY', key: null, entry: null };
  }
  const existing = favorites.get(key);
  if (!existing) {
    noteCollectionMutation('ALREADY_ABSENT', Date.now());
    return { status: 'ALREADY_ABSENT', key, entry: null };
  }
  const next = new Map(favorites);
  next.delete(key);
  favorites = next;
  persist();
  noteSizeSnapshot();
  noteCollectionMutation('REMOVED', Date.now());
  notify();
  return { status: 'REMOVED', key, entry: existing };
}

export function toggleFavorite(identity: CanonicalMediaIdentity, sourceClass: SourceClass): FavoriteMutationResult {
  ensureLoaded();
  noteCollectionToggle();
  const key = favoriteKeyFor(identity);
  if (key !== null && favorites.has(key)) return removeFavorite(identity);
  return addFavorite(identity, sourceClass);
}

/* ── Görüntü projeksiyonu (fail-closed — sahte metadata ÜRETİLMEZ) ───────── */

export interface FavoriteDisplay {
  readonly key: string;
  readonly kind: FavoriteEntry['kind'];
  readonly title: string | null;
  readonly artist: string | null;
  readonly artworkIdentity: string | null;
  /** `false` → içerik artık çözülemiyor (silinmiş/taşınmış yerel dosya). */
  readonly resolved: boolean;
}

export function resolveFavoriteDisplays(entries: readonly FavoriteEntry[]): readonly FavoriteDisplay[] {
  const startedAt = Date.now();
  const snapshot = getMusicLibrarySnapshot();
  const byId = new Map(snapshot.tracks.map((t) => [t.id, t] as const));
  const result = entries.map((entry): FavoriteDisplay => {
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

export interface FavoritePlaybackTarget {
  readonly kind: FavoriteEntry['kind'];
  readonly libraryId: string | null;
  readonly provider: ProviderId | null;
  readonly contentUri: string | null;
  readonly sourceClass: SourceClass;
  readonly playable: boolean;
}

export function resolvePlaybackTarget(entry: FavoriteEntry): FavoritePlaybackTarget {
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
 * "Favorilerimden bir şey çal" — en son eklenen ÇÖZÜLEBİLEN favori.
 * Sıralama/öneri motoru İCAT EDİLMEZ (spec §7 — F8/F9 önerisiyle karıştırma).
 */
export function resolveMostRecentPlayableFavorite(): FavoriteEntry | null {
  for (const entry of getFavoritesSnapshot()) {
    if (resolvePlaybackTarget(entry).playable) return entry;
  }
  return null;
}

export function _resetMusicCollectionForTest(): void {
  favorites = new Map();
  loaded = false;
  revision = 0;
  subs.clear();
  /* `safeStorage`in kendi debounce arabelleği (`_writeBuffer`) bu çağrıyla
     TEMİZLENMEZSE bir önceki testin yazdığı kayıt `ensureLoaded()` içinde
     "Stage 1" olarak GERİ OKUNUR — modül state'i sıfırlanmış görünür ama
     ilk gerçek okuma STALE veriyle DOLAR. Reset bu yüzden kalıcılığı da
     temizler; çağıran `safeStorage` iç detayını BİLMEK ZORUNDA KALMAZ. */
  try { safeStorage.removeItem(STORAGE_KEY); } catch { /* test ortamı — yoksay */ }
}
