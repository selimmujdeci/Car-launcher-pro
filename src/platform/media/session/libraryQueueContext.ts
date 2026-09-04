/**
 * libraryQueueContext.ts — F3 · Kütüphane seçimi → dinleme niyeti + kuyruk girdileri.
 *
 * Kanonik akış burada başlar:
 *   `Library selection → ListeningIntent + MediaRefs → PlayQueue → MediaCommandGateway`
 *
 * SINIR: MusicIndex kütüphane truth'u olarak KALIR; bu modül ondan YALNIZ okur ve
 * PlayQueue authority'si OLMAZ — yalnız kuyruğun girdisini üretir.
 *
 * NİYET UYDURULMAZ: albüm görünümünden başlatılan `ALBUM`, klasörden başlatılan
 * `FOLDER`, düz listeden başlatılan `TRACKS`'tir. Metadata'ya bakıp "bu bir albüm
 * olmalı" diye tahmin YAPILMAZ.
 */

import { getMusicLibrarySnapshot, type MusicTrack } from '../musicIndex';
import type { QueueEntry } from './playQueue';
import type { ListeningIntent } from './listeningSession';
import type { CanonicalMediaIdentity } from './mediaIdentityMatching';

/** MediaStore kökenli girdiler için sağlayıcı ad alanı. */
export const MEDIASTORE_NAMESPACE = 'MEDIASTORE';

export type LibrarySelection =
  | { readonly kind: 'ALBUM'; readonly albumId: string; readonly startTrackId?: string }
  | { readonly kind: 'ARTIST'; readonly artistId: string; readonly startTrackId?: string }
  | { readonly kind: 'FOLDER'; readonly folderId: string; readonly startTrackId?: string }
  | { readonly kind: 'TRACKS'; readonly trackIds: readonly string[]; readonly startTrackId?: string };

export interface LibraryQueueContext {
  readonly intent: ListeningIntent;
  readonly intentRef: string | null;
  readonly entries: readonly QueueEntry[];
  readonly startIndex: number;
}

/** MusicTrack → kanonik kimlik. Bilinmeyen alan `null` kalır, uydurulmaz. */
export function identityFromTrack(t: MusicTrack): CanonicalMediaIdentity {
  return Object.freeze({
    libraryId: t.id,
    providerId: t.id,
    providerNamespace: MEDIASTORE_NAMESPACE,
    contentUri: t.contentUri,
    title: t.title,
    artist: t.artist,
    album: t.album,
    durationMs: t.durationMs,
    trackNumber: t.trackNumber,
    discNumber: t.discNumber,
  });
}

/**
 * Kuyruk girdisi üretir.
 *
 * `item.id` KANONİK kütüphane kimliğidir (`media:<volume>:<mediaStoreId>`), ham
 * MediaStore `_ID` DEĞİL: iki volume'da aynı sayısal id meşru biçimde bulunabilir
 * ve ham id kullanmak kuyrukta iki farklı parçayı AYNI öğe yapardı.
 */
export function entryFromTrack(t: MusicTrack, ordinal: number): QueueEntry {
  return Object.freeze({
    entryId: `${t.id}#${ordinal}`,
    identity: identityFromTrack(t),
    item: Object.freeze({
      id: t.id,
      uri: t.contentUri,
      title: t.title || 'Bilinmeyen Parça',
      artist: t.artist || 'Bilinmeyen Sanatçı',
      artworkUri: t.artworkIdentity ?? undefined,
    }),
    origin: 'LIBRARY' as const,
    libraryRef: Object.freeze({ id: t.id, contentUri: t.contentUri, provenance: t.provenance }),
  });
}

const byText = (a: string | null, b: string | null): number =>
  (a ?? '').localeCompare(b ?? '', 'tr-TR');

/** Albüm sırası: disk → parça no → başlık. Numarası olmayanlar SONA gider. */
function albumOrder(a: MusicTrack, b: MusicTrack): number {
  const da = a.discNumber ?? Number.MAX_SAFE_INTEGER;
  const db = b.discNumber ?? Number.MAX_SAFE_INTEGER;
  if (da !== db) return da - db;
  const ta = a.trackNumber ?? Number.MAX_SAFE_INTEGER;
  const tb = b.trackNumber ?? Number.MAX_SAFE_INTEGER;
  if (ta !== tb) return ta - tb;
  return byText(a.title, b.title);
}

/** Sanatçı sırası: albüm → albüm içi sıra. */
function artistOrder(a: MusicTrack, b: MusicTrack): number {
  const album = byText(a.album, b.album);
  return album !== 0 ? album : albumOrder(a, b);
}

/** Yalnız ERİŞİLEBİLİR parçalar kuyruğa girer — STALE girdi çalınmaz. */
const available = (t: MusicTrack): boolean => t.availability === 'AVAILABLE';

function pick(ids: readonly string[]): MusicTrack[] {
  const snapshot = getMusicLibrarySnapshot();
  const byId = new Map(snapshot.tracks.map((t) => [t.id, t]));
  const out: MusicTrack[] = [];
  for (const id of ids) {
    const t = byId.get(id);
    if (t && available(t)) out.push(t);
  }
  return out;
}

/**
 * Seçimden deterministik kuyruk bağlamı üretir.
 *
 * `null` döner: seçim kütüphanede yoksa veya erişilebilir hiçbir parça
 * kalmadıysa. Boş kuyrukla oturum başlatmak sahte bağlam üretmek olurdu.
 */
export function buildLibraryQueueContext(selection: LibrarySelection): LibraryQueueContext | null {
  const snapshot = getMusicLibrarySnapshot();
  let tracks: MusicTrack[] = [];
  let intent: ListeningIntent;
  let intentRef: string | null = null;

  switch (selection.kind) {
    case 'ALBUM': {
      const album = snapshot.albums.find((a) => a.id === selection.albumId);
      if (!album) return null;
      intent = 'ALBUM'; intentRef = album.id;
      tracks = pick(album.trackIds).sort(albumOrder);
      break;
    }
    case 'ARTIST': {
      const artist = snapshot.artists.find((a) => a.id === selection.artistId);
      if (!artist) return null;
      intent = 'ARTIST'; intentRef = artist.id;
      tracks = pick(artist.trackIds).sort(artistOrder);
      break;
    }
    case 'FOLDER': {
      const folder = snapshot.folders.find((f) => f.id === selection.folderId);
      if (!folder) return null;
      intent = 'FOLDER'; intentRef = folder.id;
      tracks = pick(folder.trackIds).sort((a, b) => byText(a.title, b.title));
      break;
    }
    case 'TRACKS': {
      intent = 'TRACKS'; intentRef = null;
      // Kullanıcının GÖRDÜĞÜ sıra korunur — yeniden sıralanmaz.
      tracks = pick(selection.trackIds);
      break;
    }
    default:
      return null;
  }

  if (tracks.length === 0) return null;

  const entries = tracks.map((t, i) => entryFromTrack(t, i));
  const wanted = selection.startTrackId
    ? entries.findIndex((e) => e.libraryRef?.id === selection.startTrackId)
    : -1;

  return Object.freeze({
    intent,
    intentRef,
    entries: Object.freeze(entries),
    startIndex: wanted >= 0 ? wanted : 0,
  });
}
