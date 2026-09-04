/**
 * searchResult.ts — F5 · Kanonik arama sonucu modeli (SAF tipler + kurucular).
 *
 * PAZARLIKSIZ SINIR: arama BİRLEŞİK TRUTH OTORİTESİ DEĞİLDİR.
 * `LOCAL` gerçeği `musicIndex`'ten, sağlayıcı sonucu ilgili sağlayıcı
 * kanıtından gelir. Bu modül yalnız bu iki kaynağı AYNI ŞEKLE sokar ve her
 * sonucun NEREDEN geldiğini (provenance) taşır. Playback · library · provider
 * gerçeği ÜRETMEZ.
 *
 * DÜRÜSTLÜK: olmayan metadata UYDURULMAZ — bilinmeyen alan `null` kalır.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */
import type { SourceClass } from '../authority/sourceCapabilities';
import type { CanonicalMediaIdentity } from '../session/mediaIdentityMatching';
import type { ProviderId } from '../providers';

export type SearchResultKind =
  | 'TRACK' | 'ALBUM' | 'ARTIST' | 'PLAYLIST' | 'FOLDER' | 'STATION';

export const SEARCH_KIND_LABEL: Readonly<Record<SearchResultKind, string>> = {
  TRACK: 'Parça', ALBUM: 'Albüm', ARTIST: 'Sanatçı',
  PLAYLIST: 'Liste', FOLDER: 'Klasör', STATION: 'Radyo',
} as const;

/** Sonucun ŞU AN çalınabilirliği — "var" ile "erişilebilir" aynı şey değildir. */
export type SearchAvailability = 'AVAILABLE' | 'STALE' | 'UNKNOWN';

/** Sonucun hangi kanıttan doğduğu. Uydurulmaz, tahmin edilmez. */
export interface SearchProvenance {
  /** Kanıt sınıfı: yerel kütüphane mi, sağlayıcı yanıtı mı. */
  readonly origin: 'LOCAL_INDEX' | 'PROVIDER';
  readonly providerId: ProviderId;
  /** Çalma bu sonuç seçilirse hangi kaynak sınıfından ilerler. */
  readonly sourceClass: SourceClass;
  /** Kanıtın alındığı an — tazelik buradan okunur. */
  readonly observedAtMs: number;
  /** `LOCAL_INDEX` için üretildiği kütüphane revizyonu; sağlayıcıda `null`. */
  readonly libraryRevision: number | null;
}

/** Sıralamanın NEDEN böyle olduğunun okunabilir kanıtı (LAB'da incelenir). */
export interface SearchMatchEvidence {
  readonly score: number;
  /** Hangi sinyaller katkı verdi — sıralama açıklanabilir olmalıdır. */
  readonly signals: readonly string[];
  /** En güçlü eşleşme türü. */
  readonly matchKind:
    | 'EXACT_TITLE' | 'TITLE_PREFIX' | 'ARTIST_TITLE' | 'ALBUM_CONTEXT'
    | 'TOKEN_MATCH' | 'SUBSTRING' | 'NONE';
}

export interface SearchResult {
  /** Kararlı, kaynak-nitelikli kimlik (React anahtarı ve dedup girdisi). */
  readonly resultId: string;
  readonly kind: SearchResultKind;
  readonly title: string;
  readonly artist: string | null;
  readonly album: string | null;
  /** Kapak KİMLİĞİ — bileşen bunu ArtworkCache'e verir, kendisi çözmez. */
  readonly artworkIdentity: string | null;
  /** F3 kimlik modeli — dedup ve oturum yolu bunu kullanır. */
  readonly identity: CanonicalMediaIdentity;
  /** Yerel sonuçta `musicIndex` parça kimliği; sağlayıcıda `null`. */
  readonly libraryTrackId: string | null;
  readonly availability: SearchAvailability;
  readonly provenance: SearchProvenance;
  readonly evidence: SearchMatchEvidence;
  /**
   * Aynı içerik başka kaynaklarda da bulunduysa onların provenance'ları.
   * Birleştirme YALNIZ güçlü kimlik kanıtıyla yapılır (bkz. `searchDedup`).
   */
  readonly alternates: readonly SearchProvenance[];
}

export const NO_EVIDENCE: SearchMatchEvidence = Object.freeze({
  score: 0, signals: Object.freeze([] as readonly string[]), matchKind: 'NONE' as const,
});

/** Sağlayıcı kimliğinden kaynak sınıfı — bilinmeyen sağlayıcı UYDURULMAZ. */
export function sourceClassForProvider(providerId: ProviderId): SourceClass | null {
  switch (providerId) {
    case 'local':   return 'LOCAL';
    case 'spotify': return 'SPOTIFY_CONNECT';
    case 'youtube': return 'YOUTUBE';
    case 'radio':   return 'INTERNET_RADIO';
    case 'stream': case 'audius': case 'jamendo': case 'archive': return 'STREAM';
    default:        return null;
  }
}

export function makeProvenance(input: {
  readonly origin: SearchProvenance['origin'];
  readonly providerId: ProviderId;
  readonly sourceClass: SourceClass;
  readonly observedAtMs: number;
  readonly libraryRevision?: number | null;
}): SearchProvenance {
  return Object.freeze({
    origin: input.origin,
    providerId: input.providerId,
    sourceClass: input.sourceClass,
    observedAtMs: input.observedAtMs,
    libraryRevision: input.libraryRevision ?? null,
  });
}

/** Sonuç kimliği — kaynak nitelikli olduğu için farklı kaynaklar ÇAKIŞMAZ. */
export function resultIdFor(providerId: ProviderId, rawId: string): string {
  return `${providerId}:${rawId}`;
}
