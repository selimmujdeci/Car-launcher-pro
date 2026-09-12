/**
 * providerQueueContext.ts — MUSIC F7.6 · Sağlayıcı seçimi → kanonik kuyruk girdisi.
 *
 * `libraryQueueContext`in sağlayıcı karşılığıdır. Kanonik akış aynıdır:
 *   `Provider selection → ListeningIntent + QueueEntry[] → PlayQueue
 *      → ListeningSession → MediaCommandGateway → F0 playback authority`
 *
 * ÖLÇÜLEN KUSUR (F7.6 öncesi): sağlayıcı sırası `carosMediaLayer._queue`
 * içinde tutuluyordu — kanonik `PlayQueue`nun YANINDA ikinci bir mutable
 * sıra sahibi. UI/medya katmanı hem sırayı hem imleci kendi yazıyordu.
 *
 * ── SAME-PROVIDER KURALI (ürün kararı, 2026-09-02) ────────────────────────
 * Birleşik arama KARIŞIK sağlayıcı sonucu üretir (YouTube + Spotify + radyo).
 * Kanonik kuyruk TEK `SourceClass` taşır ve bu tur onu değiştirmez. Bu yüzden
 * kuyruk, SEÇİLEN parçanın kaynak sınıfıyla SINIRLANIR; başka sağlayıcıların
 * satırları kuyruğa ALINMAZ ve bu sessizce yapılmaz — `excludedIds` ile
 * sayılır ve LAB'da görünür.
 *
 * Sıralama/ranking gerçeği DEĞİŞTİRİLMEZ: kullanıcının gördüğü sıra korunur,
 * yalnız kuyruk KURULUM aşamasında sağlayıcı sınırı uygulanır.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOK.
 */

import type { SourceClass } from '../authority/sourceCapabilities';
import type { QueueEntry } from './playQueue';
import type { ListeningIntent } from './listeningSession';
import type { CanonicalMediaIdentity } from './mediaIdentityMatching';

/** Kuyruğa girebilecek en yalın sağlayıcı satırı — UI tipinden BAĞIMSIZ. */
export interface ProviderTrackInput {
  /** Sağlayıcı içi kararlı kimlik (UnifiedTrack.id). */
  readonly id: string;
  /** `carosMediaLayer` sağlayıcı kimliği (`youtube` · `spotify` · `radio` …). */
  readonly providerId: string;
  readonly title: string;
  readonly subtitle: string;
  readonly artwork?: string | undefined;
  readonly streamUrl?: string | undefined;
  readonly spotifyUri?: string | undefined;
  readonly spotifyDurationMs?: number | undefined;
}

export interface ProviderQueueContext {
  readonly source: SourceClass;
  readonly intent: ListeningIntent;
  readonly intentRef: string | null;
  readonly entries: readonly QueueEntry[];
  readonly startIndex: number;
  /** Sağlayıcı sınırı nedeniyle kuyruğa ALINMAYAN satırlar — sessizce düşürülmez. */
  readonly excludedIds: readonly string[];
}

/**
 * Sağlayıcı kimliği → kanonik kaynak sınıfı.
 *
 * Bilinmeyen sağlayıcı `null` döner ve kuyruk KURULMAZ — tanınmayan bir uca
 * "STREAM'dir herhâlde" demek uydurma bir kaynak iddiasıdır.
 */
export function providerSourceClassFor(providerId: string): SourceClass | null {
  switch (providerId) {
    case 'youtube': return 'YOUTUBE';
    case 'spotify': return 'SPOTIFY_CONNECT';
    /* Radyo AYRI semantiktir (canlı yayın, süre/seek yok) ve kendi kaynak
       sınıfını taşır — şarkı kuyruğuna karışmaması bu ayrımdan doğar. */
    case 'radio': return 'INTERNET_RADIO';
    case 'local': return 'LOCAL';
    case 'stream': case 'audius': case 'jamendo': case 'archive': return 'STREAM';
    default: return null;
  }
}

/** Sağlayıcı ad alanı — farklı sağlayıcıların id'leri KARŞILAŞTIRILMAZ. */
export function providerNamespaceFor(providerId: string): string {
  return providerId.toUpperCase();
}

/** Bu satırın çalınabilir bir tanımı var mı — yoksa kuyruğa girmez. */
export function isPlayableProviderTrack(t: ProviderTrackInput): boolean {
  return typeof t.spotifyUri === 'string' && t.spotifyUri.length > 0
    ? true
    : typeof t.streamUrl === 'string' && t.streamUrl.length > 0;
}

/** Kuyruk girdisinin taşıyacağı çalma URI'si (tek tanım). */
function contentUriOf(t: ProviderTrackInput): string | null {
  if (typeof t.spotifyUri === 'string' && t.spotifyUri.length > 0) return t.spotifyUri;
  if (typeof t.streamUrl === 'string' && t.streamUrl.length > 0) return t.streamUrl;
  return null;
}

const trimmedOrNull = (v: string | undefined): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

/**
 * Sağlayıcı satırı → kanonik kimlik. Bilinmeyen alan `null` KALIR, uydurulmaz:
 * sağlayıcı sonuçlarında albüm/parça no/disk no ve çoğu zaman süre YOKTUR.
 */
export function identityFromProviderTrack(t: ProviderTrackInput): CanonicalMediaIdentity {
  return Object.freeze({
    libraryId: null,
    providerId: t.id,
    providerNamespace: providerNamespaceFor(t.providerId),
    contentUri: contentUriOf(t),
    title: trimmedOrNull(t.title),
    artist: trimmedOrNull(t.subtitle),
    album: null,
    durationMs: typeof t.spotifyDurationMs === 'number' && t.spotifyDurationMs > 0
      ? t.spotifyDurationMs
      : null,
    trackNumber: null,
    discNumber: null,
  });
}

/**
 * Kuyruk girdisi. `libraryRef` DAİMA `null`dur: sağlayıcı satırının MusicIndex
 * karşılığı yoktur ve `playQueue`nun bayatlık denetimi yalnız `LIBRARY`
 * kökenli girdilere uygulanır (sağlayıcı satırı yanlışlıkla "bayat" sayılmaz).
 */
export function entryFromProviderTrack(t: ProviderTrackInput, ordinal: number): QueueEntry {
  return Object.freeze({
    entryId: `${t.providerId}:${t.id}#${ordinal}`,
    identity: identityFromProviderTrack(t),
    item: Object.freeze({
      id: t.id,
      uri: contentUriOf(t) ?? '',
      title: t.title || 'Parça',
      artist: t.subtitle || '',
      artworkUri: t.artwork,
    }),
    origin: 'PROVIDER' as const,
    libraryRef: null,
  });
}

/**
 * Seçilen sağlayıcı satırından kanonik kuyruk bağlamı üretir.
 *
 * `null` döner: seçilen satır çalınamıyorsa veya sağlayıcısı tanınmıyorsa.
 * Boş/uydurma bağlamla oturum başlatmak sahte bir dinleme gerçeği olurdu.
 *
 * @param tracks   kullanıcının GÖRDÜĞÜ sıra (yeniden sıralanmaz)
 * @param selected kuyruğun kurulacağı satır — kuyrukta bulunmasa bile başa alınır
 */
export function buildProviderQueueContext(
  selected: ProviderTrackInput,
  tracks: readonly ProviderTrackInput[] = [],
): ProviderQueueContext | null {
  if (!isPlayableProviderTrack(selected)) return null;
  const source = providerSourceClassFor(selected.providerId);
  if (source === null) return null;

  const excludedIds: string[] = [];
  const kept: ProviderTrackInput[] = [];
  const seen = new Set<string>();

  for (const t of tracks) {
    if (!isPlayableProviderTrack(t)) { excludedIds.push(t.id); continue; }
    /* SAME-PROVIDER: kaynak sınıfı seçilenle aynı olmalı. Farklı sağlayıcı
       satırları kuyruğa GİRMEZ — sıralama değişmez, yalnız dışarıda kalır. */
    if (providerSourceClassFor(t.providerId) !== source) { excludedIds.push(t.id); continue; }
    const key = `${t.providerId}:${t.id}`;
    if (seen.has(key)) continue;    // aynı satır iki kez listelendiyse tek girer
    seen.add(key);
    kept.push(t);
  }

  if (!seen.has(`${selected.providerId}:${selected.id}`)) kept.unshift(selected);

  const entries = kept.map((t, i) => entryFromProviderTrack(t, i));
  const startIndex = Math.max(
    0, kept.findIndex((t) => t.providerId === selected.providerId && t.id === selected.id),
  );

  return Object.freeze({
    source,
    /* Niyet UYDURULMAZ: bir arama sonucu listesinden çalmak `TRACKS`tır.
       Radyo canlı yayın semantiğidir ve `RADIO` niyetini taşır. */
    intent: (source === 'INTERNET_RADIO' ? 'RADIO' : 'TRACKS') as ListeningIntent,
    intentRef: null,
    entries: Object.freeze(entries),
    startIndex,
    excludedIds: Object.freeze(excludedIds),
  });
}
