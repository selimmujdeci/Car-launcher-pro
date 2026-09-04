/**
 * musicPlaylistEntry.ts — MUSIC F15 · Playlist kimliği + kayıt şeması (SAF).
 *
 * ── ÖLÇÜLEN GERÇEK (F15 denetimi) ──────────────────────────────────────────
 * Repo'da "playlist" kelimesi F5/F9'da yalnız SAĞLAYICI-BARINDIRILAN bir
 * arama kavramıydı (`PLAY_PLAYLIST` → `runSearch`, "Spotify'daki X listesini
 * bul ve çal"). CarOS'un KENDİ kalıcı, düzenlenebilir koleksiyonu HİÇ YOKTU —
 * bu dosya o gerçek boşluğu kapatır. F13'ün favori kimlik deseniyle KASITLI
 * OLARAK AYNIDIR (aynı `CanonicalMediaIdentity`, aynı LOCAL/PROVIDER ayrımı,
 * aynı fail-closed ayrıştırma) — ama Favorites ve Playlist birbirine
 * DÖNÜŞMEZ: favoriler tekil kanıtlanmış bir KÜMEdir, playlist kullanıcının
 * SIRALADIĞI adlı bir LİSTEdir. İkisi kalıcıda AYRI anahtar altında yaşar.
 *
 * KİMLİK KURALI (F13 ile BİREBİR): başlık/sanatçı ASLA anahtarın parçası
 * değildir. LOCAL → F2 MusicIndex kimliği (`libraryId`). PROVIDER →
 * `providerNamespace + providerId` (F7.6 ad alanı kuralıyla AYNI). İkisi de
 * yoksa öğe playlist'e EKLENMEZ.
 *
 * SIRALAMA: dizinin KENDİSİ sıralamadır — ayrı bir "sortIndex" alanı
 * TUTULMAZ (ikinci bir sıra gerçeği doğurmaz, F3 PlayQueue'nun kendi
 * "kanonik kuyruk = tek dizi" ilkesiyle AYNI).
 *
 * YİNELENEN EKLEME (deterministik): AYNI kimlik AYNI playlist'e ikinci kez
 * eklenemez (F13 favorileriyle AYNI idempotent kural) — "playlist'te üç kez
 * aynı şarkı" belirsizliği (hangi kopya taşınıyor/siliniyor) böylece hiç
 * doğmaz; kullanıcı isterse aynı parçayı BAŞKA bir playlist'e ekleyebilir.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

import type { CanonicalMediaIdentity } from '../session/mediaIdentityMatching';
import type { SourceClass } from '../authority/sourceCapabilities';
import type { ProviderId } from '../providers';
import { providerIdFromSourceClass, favoriteKeyFor as identityKeyFor } from '../collection/musicCollectionEntry';

export const PLAYLIST_SCHEMA_VERSION = 1;
/** Sınırsız büyüme YOK. */
export const MAX_PLAYLISTS = 200;
export const MAX_ITEMS_PER_PLAYLIST = 2000;
export const MAX_PLAYLIST_NAME_LENGTH = 80;

export type PlaylistItemKind = 'LOCAL' | 'PROVIDER';

/**
 * Tek playlist öğesi. Alan seti F13 `FavoriteEntry` ile AYNI ilkeyi izler:
 * LOCAL yalnız `libraryId` taşır (başlık/sanatçı MusicIndex'ten CANLI
 * çözülür); PROVIDER bounded görüntü metadata'sı taşır (kanonik sağlayıcı
 * dizini YOK). Sorgu/sesli-komut metni/konum ASLA YOKTUR.
 */
export interface PlaylistItemEntry {
  readonly key: string;
  readonly kind: PlaylistItemKind;
  readonly sourceClass: SourceClass;
  readonly libraryId: string | null;
  readonly providerId: string | null;
  readonly providerNamespace: string | null;
  readonly contentUri: string | null;
  readonly provider: ProviderId | null;
  readonly displayTitle: string | null;
  readonly displayArtist: string | null;
  readonly displayArtwork: string | null;
  readonly addedAtMs: number;
}

export interface Playlist {
  readonly schemaVersion: typeof PLAYLIST_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly items: readonly PlaylistItemEntry[];
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export type PlaylistMutationStatus =
  | 'CREATED' | 'RENAMED' | 'DELETED'
  | 'ITEM_ADDED' | 'ITEM_ALREADY_PRESENT' | 'ITEM_REMOVED' | 'ITEM_ALREADY_ABSENT'
  | 'REORDERED'
  | 'REJECTED_NO_IDENTITY'
  | 'REJECTED_NOT_FOUND'
  | 'REJECTED_NAME_EMPTY'
  | 'REJECTED_PLAYLIST_LIMIT'
  | 'REJECTED_ITEM_LIMIT';

export interface PlaylistMutationResult {
  readonly status: PlaylistMutationStatus;
  readonly playlistId: string | null;
  readonly itemKey: string | null;
}

/* ── Kimlik → anahtar — F13'ün KENDİ fonksiyonunu TEKRAR ETMEZ, yeniden verir ── */

/** F13 `favoriteKeyFor` ile AYNI kararlı fonksiyon — ikinci bir kimlik kuralı İCAT EDİLMEZ. */
export const playlistItemKeyFor = identityKeyFor;

export function sanitizePlaylistName(raw: string): string | null {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_PLAYLIST_NAME_LENGTH
    ? trimmed.slice(0, MAX_PLAYLIST_NAME_LENGTH).trim()
    : trimmed;
}

/**
 * Kimlikten kalıcı öğe kaydı üretir. `null` döner: kanıtsız kimlik VEYA
 * PROVIDER için oynatılamayacak (contentUri/desteklenen provider yok) satır —
 * F13 `makeFavoriteEntry` ile AYNI fail-closed ilke.
 */
export function makePlaylistItemEntry(
  identity: CanonicalMediaIdentity, sourceClass: SourceClass, nowMs: number,
): PlaylistItemEntry | null {
  const key = playlistItemKeyFor(identity);
  if (key === null) return null;

  if (key.startsWith('local:')) {
    return Object.freeze({
      key, kind: 'LOCAL' as const, sourceClass,
      libraryId: identity.libraryId,
      providerId: null, providerNamespace: null, contentUri: null, provider: null,
      displayTitle: null, displayArtist: null, displayArtwork: null,
      addedAtMs: nowMs,
    });
  }

  const provider = providerIdFromSourceClass(sourceClass);
  const contentUri = identity.contentUri?.trim() || null;
  if (provider === null || provider === 'local' || contentUri === null) return null;

  return Object.freeze({
    key, kind: 'PROVIDER' as const, sourceClass,
    libraryId: null,
    providerId: identity.providerId, providerNamespace: identity.providerNamespace,
    contentUri, provider,
    displayTitle: identity.title?.trim() || null,
    displayArtist: identity.artist?.trim() || null,
    displayArtwork: null,
    addedAtMs: nowMs,
  });
}

function parsePlaylistItemEntry(raw: unknown): PlaylistItemEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.key !== 'string' || r.key.length === 0) return null;
  if (r.kind !== 'LOCAL' && r.kind !== 'PROVIDER') return null;
  if (typeof r.sourceClass !== 'string') return null;
  if (typeof r.addedAtMs !== 'number' || !Number.isFinite(r.addedAtMs)) return null;

  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

  if (r.kind === 'LOCAL') {
    const libraryId = str(r.libraryId);
    if (!libraryId) return null;
    return Object.freeze({
      key: r.key, kind: 'LOCAL' as const, sourceClass: r.sourceClass as SourceClass,
      libraryId, providerId: null, providerNamespace: null, contentUri: null, provider: null,
      displayTitle: null, displayArtist: null, displayArtwork: null,
      addedAtMs: r.addedAtMs,
    });
  }

  const providerId = str(r.providerId);
  const providerNamespace = str(r.providerNamespace);
  const contentUri = str(r.contentUri);
  const provider = str(r.provider) as ProviderId | null;
  if (!providerId || !providerNamespace || !contentUri || !provider) return null;

  return Object.freeze({
    key: r.key, kind: 'PROVIDER' as const, sourceClass: r.sourceClass as SourceClass,
    libraryId: null, providerId, providerNamespace, contentUri, provider,
    displayTitle: str(r.displayTitle), displayArtist: str(r.displayArtist), displayArtwork: str(r.displayArtwork),
    addedAtMs: r.addedAtMs,
  });
}

/**
 * PROVIDER öğesini `carosMediaLayer.playMedia` girdisine (`UnifiedTrack`
 * ile AYNI şekil) çevirir — F7.6 ile AYNI dönüşüm. TEK yerde tanımlıdır;
 * router ve UI çalıştırma katmanları (discoveryRuntime vb.) BUNU TEKRAR
 * ETMEZ.
 */
export function playlistItemToUnifiedTrack(e: PlaylistItemEntry): {
  readonly id: string; readonly providerId: ProviderId; readonly title: string;
  readonly subtitle: string; readonly artwork?: string;
  readonly streamUrl?: string; readonly spotifyUri?: string;
} {
  return {
    id: e.providerId ?? e.key,
    providerId: e.provider ?? 'stream',
    title: e.displayTitle ?? 'Bilinmeyen parça',
    subtitle: e.displayArtist ?? '',
    artwork: e.displayArtwork ?? undefined,
    ...(e.contentUri?.startsWith('spotify:')
      ? { spotifyUri: e.contentUri }
      : { streamUrl: e.contentUri ?? undefined }),
  };
}

/**
 * Kalıcı JSON'dan tek bir playlist'i ayrıştırır. Şema uyuşmazlığı/eksik
 * zorunlu alan → `null` (fail-closed; bozuk kayıt UYDURULMAZ). Bozuk tekil
 * ÖĞE bütün playlist'i düşürmez — yalnız o öğe atlanır (`onRejectedItem`).
 */
export function parsePlaylist(raw: unknown, onRejectedItem?: () => void): Playlist | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== PLAYLIST_SCHEMA_VERSION) return null;
  if (typeof r.id !== 'string' || r.id.length === 0) return null;
  if (typeof r.name !== 'string' || r.name.trim().length === 0) return null;
  if (!Array.isArray(r.items)) return null;
  if (typeof r.createdAtMs !== 'number' || !Number.isFinite(r.createdAtMs)) return null;
  if (typeof r.updatedAtMs !== 'number' || !Number.isFinite(r.updatedAtMs)) return null;

  const seen = new Set<string>();
  const items: PlaylistItemEntry[] = [];
  for (const raw2 of r.items) {
    const item = parsePlaylistItemEntry(raw2);
    if (item === null) { onRejectedItem?.(); continue; }
    if (seen.has(item.key)) continue; // bozuk kalıcı veri iki kez taşımasın (dedup fail-safe)
    seen.add(item.key);
    items.push(item);
  }

  return Object.freeze({
    schemaVersion: PLAYLIST_SCHEMA_VERSION,
    id: r.id, name: r.name, items: Object.freeze(items),
    createdAtMs: r.createdAtMs, updatedAtMs: r.updatedAtMs,
  });
}
