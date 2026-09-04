/**
 * searchSources.ts — F5 · Gerçek kaynak portlarının kaydı.
 *
 * Her port kanonik sahibinden okur ve sonucu ortak `SearchResult` şekline sokar:
 *   · `LOCAL`    → F2 `musicIndex` (+ türetilmiş arama indeksi)
 *   · sağlayıcı  → `providers.ts` altındaki mevcut `MediaProvider`'lar
 *
 * PAZARLIKSIZ: burada yeni bir sağlayıcı EKLENMEZ ve mevcut sağlayıcı yeniden
 * yazılmaz — var olan `search(query, signal)` sözleşmesi sarmalanır. Port
 * kullanılabilirliği GÖZLENİR (Spotify oturumu, native varlığı); varsayılmaz.
 */
import { getMusicLibrarySnapshot, resolveMusicRef, type MusicTrack } from '../musicIndex';
import { identityFromTrack } from '../session/libraryQueueContext';
import type { CanonicalMediaIdentity } from '../session/mediaIdentityMatching';
import type { MediaProvider, ProviderId, UnifiedTrack } from '../providers';
import { lookupLocalIndex } from './localSearchIndex';
import { scoreResult } from './searchRanking';
import {
  makeProvenance, resultIdFor, sourceClassForProvider,
  type SearchAvailability, type SearchResult, type SearchResultKind,
} from './searchResult';
import type { SearchSourcePort } from './musicSearchCoordinator';

/** Yerel adayların üst sınırı — 5.000+ parçalık kütüphanede bounded tarama. */
export const LOCAL_CANDIDATE_LIMIT = 300;

/* ── LOCAL ───────────────────────────────────────────────────────────────── */

function localResultOf(track: MusicTrack, query: string, nowMs: number, revision: number): SearchResult {
  const availability: SearchAvailability = track.availability === 'AVAILABLE' ? 'AVAILABLE' : 'STALE';
  return Object.freeze({
    resultId: resultIdFor('local', track.id),
    kind: 'TRACK' as SearchResultKind,
    title: track.title ?? 'Bilinmeyen parça',
    artist: track.artist,
    album: track.album,
    artworkIdentity: track.artworkIdentity,
    identity: identityFromTrack(track),
    libraryTrackId: track.id,
    availability,
    provenance: makeProvenance({
      origin: 'LOCAL_INDEX', providerId: 'local', sourceClass: 'LOCAL',
      observedAtMs: nowMs, libraryRevision: revision,
    }),
    evidence: scoreResult(query, {
      title: track.title ?? '', artist: track.artist, album: track.album, availability,
    }),
    alternates: Object.freeze([]),
  });
}

/**
 * Yerel kütüphane portu. Kütüphane gerçeği `musicIndex`'te kalır: burada yalnız
 * türetilmiş indeksten aday çekilir ve adaylar KANONİK anlık görüntüden çözülür.
 */
export function createLocalSearchPort(): SearchSourcePort {
  return {
    providerId: 'local',
    sourceClass: 'LOCAL',
    isAvailable(): boolean {
      try { return getMusicLibrarySnapshot().availability === 'READY'; } catch { return false; }
    },
    async search(query: string): Promise<readonly SearchResult[]> {
      const snapshot = getMusicLibrarySnapshot();
      if (snapshot.availability !== 'READY') return [];
      const nowMs = Date.now();
      const hits = lookupLocalIndex(query, LOCAL_CANDIDATE_LIMIT);
      const out: SearchResult[] = [];
      hits.forEach((hit) => {
        const track = snapshot.tracks.find((t) => t.id === hit.trackId);
        // Kanonik anlık görüntüde yoksa sonuç ÜRETİLMEZ (bayat indeks satırı).
        if (track) out.push(localResultOf(track, query, nowMs, snapshot.revision));
      });
      return out;
    },
  };
}

/* ── Sağlayıcılar ────────────────────────────────────────────────────────── */

/** `UnifiedTrack` → kanonik kimlik. Bilinmeyen alan `null` kalır, UYDURULMAZ. */
export function identityFromUnifiedTrack(t: UnifiedTrack): CanonicalMediaIdentity {
  const providerRef = t.spotifyUri ?? t.streamUrl ?? null;
  return Object.freeze({
    libraryId: null,
    providerId: t.id || null,
    providerNamespace: t.providerId,
    contentUri: providerRef,
    title: t.title || null,
    // `subtitle` sağlayıcıya göre sanatçı VEYA açıklama olabilir; sanatçı
    // olduğunu KANITLAYAMADIĞIMIZ için ayrı bir alan uydurmayız.
    artist: t.subtitle || null,
    album: null,
    durationMs: typeof t.spotifyDurationMs === 'number' && t.spotifyDurationMs > 0
      ? t.spotifyDurationMs : null,
    trackNumber: null,
    discNumber: null,
  });
}

const KIND_FOR_PROVIDER: Partial<Record<ProviderId, SearchResultKind>> = {
  radio: 'STATION',
};

export function resultFromUnifiedTrack(
  t: UnifiedTrack, query: string, nowMs: number,
): SearchResult | null {
  const sourceClass = sourceClassForProvider(t.providerId);
  // Tanınmayan sağlayıcı için kaynak sınıfı UYDURULMAZ — sonuç düşürülür.
  if (!sourceClass) return null;
  return Object.freeze({
    resultId: resultIdFor(t.providerId, t.id),
    kind: KIND_FOR_PROVIDER[t.providerId] ?? 'TRACK',
    title: t.title || 'Bilinmeyen parça',
    artist: t.subtitle || null,
    album: null,
    artworkIdentity: t.artwork ?? null,
    identity: identityFromUnifiedTrack(t),
    libraryTrackId: null,
    /* Sağlayıcı sonucunun ŞU AN çalınabilirliği doğrulanmış değildir: katalogda
       görünmek çalınabilmek demek değil. Dürüst cevap `UNKNOWN`. */
    availability: 'UNKNOWN',
    provenance: makeProvenance({
      origin: 'PROVIDER', providerId: t.providerId, sourceClass, observedAtMs: nowMs,
    }),
    evidence: scoreResult(query, {
      title: t.title || '', artist: t.subtitle || null, album: null, availability: 'UNKNOWN',
    }),
    alternates: Object.freeze([]),
  });
}

/**
 * Mevcut bir `MediaProvider`'ı arama portuna sarar.
 *
 * @param isAvailable gözlenen kullanılabilirlik (ör. Spotify oturumu). Verilmezse
 *        sağlayıcı her zaman denenebilir sayılır — bu bir varsayım değil, ağ
 *        sağlayıcısının doğal durumudur (hata `FAILED` olarak görünür).
 */
export function createProviderSearchPort(
  provider: MediaProvider,
  options: { readonly isAvailable?: () => boolean; readonly timeoutMs?: number } = {},
): SearchSourcePort {
  const sourceClass = sourceClassForProvider(provider.id);
  return {
    providerId: provider.id,
    sourceClass: sourceClass ?? 'STREAM',
    timeoutMs: options.timeoutMs,
    isAvailable(): boolean {
      if (!options.isAvailable) return true;
      try { return options.isAvailable() === true; } catch { return false; }
    },
    async search(query: string, signal: AbortSignal): Promise<readonly SearchResult[]> {
      const nowMs = Date.now();
      const raw = await provider.search(query, signal);
      const out: SearchResult[] = [];
      raw.forEach((t) => {
        const result = resultFromUnifiedTrack(t, query, nowMs);
        if (result) out.push(result);
      });
      return out;
    },
  };
}

/* ── Spotify ─────────────────────────────────────────────────────────────── */

/**
 * Spotify katalog arama portu.
 *
 * `searchSpotifyTracks` `UnifiedTrack` DEĞİL kendi tipini döner; burada kanonik
 * `SearchResult`'a çevrilir. Süre bilgisi Spotify'dan GELİR ve tekilleştirmenin
 * kimlik kanıtını güçlendirir.
 *
 * KULLANILABİLİRLİK GÖZLENİR: oturum yoksa port `isAvailable() === false` döner
 * ve koordinatör ona sorgu GÖNDERMEZ — bu `SKIPPED_UNAVAILABLE` olarak görünür,
 * "boş sonuç" olarak DEĞİL (aksi hâlde COMPLETE hükmünü yanlış etkilerdi).
 */
export function createSpotifySearchPort(deps: {
  readonly isConnected: () => boolean;
  readonly search: (query: string, limit?: number) => Promise<readonly {
    readonly id: string; readonly uri: string; readonly title: string;
    readonly artist: string; readonly albumArt?: string; readonly durationMs: number;
  }[]>;
  readonly timeoutMs?: number;
}): SearchSourcePort {
  return {
    providerId: 'spotify',
    sourceClass: 'SPOTIFY_CONNECT',
    timeoutMs: deps.timeoutMs,
    isAvailable(): boolean {
      try { return deps.isConnected() === true; } catch { return false; }
    },
    async search(query: string): Promise<readonly SearchResult[]> {
      const nowMs = Date.now();
      const tracks = await deps.search(query);
      return tracks.map((t) => Object.freeze({
        resultId: resultIdFor('spotify', t.id),
        kind: 'TRACK' as SearchResultKind,
        title: t.title || 'Bilinmeyen parça',
        artist: t.artist || null,
        // Spotify arama yanıtı albüm ADINI taşımıyor — UYDURULMAZ.
        album: null,
        artworkIdentity: t.albumArt ?? null,
        identity: Object.freeze({
          libraryId: null,
          providerId: t.id || null,
          providerNamespace: 'SPOTIFY',
          contentUri: t.uri || null,
          title: t.title || null,
          artist: t.artist || null,
          album: null,
          durationMs: t.durationMs > 0 ? t.durationMs : null,
          trackNumber: null,
          discNumber: null,
        }) as CanonicalMediaIdentity,
        libraryTrackId: null,
        /* Katalogda görünmek çalınabilmek değildir (Connect cihazı/Premium
           gerekebilir): dürüst cevap UNKNOWN. */
        availability: 'UNKNOWN' as SearchAvailability,
        provenance: makeProvenance({
          origin: 'PROVIDER', providerId: 'spotify', sourceClass: 'SPOTIFY_CONNECT',
          observedAtMs: nowMs,
        }),
        evidence: scoreResult(query, {
          title: t.title || '', artist: t.artist || null, album: null, availability: 'UNKNOWN',
        }),
        alternates: Object.freeze([]),
      }));
    },
  };
}

/* ── Seçim → kanonik yol ─────────────────────────────────────────────────── */

/**
 * Yerel sonucun kütüphanede HÂLÂ var olduğunu doğrular ve kanonik parçayı döner.
 * Bayat `MediaRef` reddedilir — arama sonucu bir çalma garantisi DEĞİLDİR.
 */
export function resolveLocalSelection(result: SearchResult): MusicTrack | null {
  if (result.provenance.origin !== 'LOCAL_INDEX' || !result.libraryTrackId) return null;
  const contentUri = result.identity.contentUri;
  if (!contentUri) return null;
  return resolveMusicRef({
    id: result.libraryTrackId, contentUri, provenance: 'MEDIASTORE_EXTERNAL',
  });
}
