/**
 * discoveryRuntime.ts — F5.1 · Keşif girdilerinin kanonik TOPLAYICISI.
 *
 * Bileşenler iş mantığı taşımaz: hangi kanıtın var olduğu ve nasıl çözüleceği
 * BURADA karara bağlanır, `discoveryModel` (saf) onu bölümlere çevirir.
 *
 * SINIRLAR:
 *   · Kütüphane gerçeği `musicIndex`'ten OKUNUR; yazılmaz.
 *   · Geçmiş kaydı yalnız KİMLİK taşır; başlık/sanatçı kanonik kütüphaneden
 *     çözülür — çözülemeyen satır GÖSTERİLMEZ (silinmiş parça uydurulmaz).
 *   · Dinleme bağlamı F3 projeksiyonundan okunur; kalıcı kayıt CANLI çalma
 *     iddiası ÜRETMEZ.
 *   · Bu modül çalma BAŞLATMAZ — seçim kanonik F3 yolundan gider.
 */
import { getMusicLibrarySnapshot } from '../musicIndex';
import { getListeningSession } from '../session/listeningSession';
import { startLibraryListening, type StartListeningResult } from '../session/listeningSessionRuntime';
import { getRecentlyPlayed } from './recentlyPlayed';
import {
  buildDiscovery, type DiscoveryItem, type DiscoveryPresentation,
} from './discoveryModel';
import { noteDiscoveryProjection } from './searchTelemetry';
import type { DrivingMode } from '../../../components/media/nowPlayingModel';
import {
  getFavoritesSnapshot, resolveFavoriteDisplays, resolvePlaybackTarget,
} from '../collection/musicCollectionAuthority';
import {
  getPlaylists, getPlaylistsRevision, getPlaylist, resolvePlaylistStartPlan,
} from '../playlist/musicPlaylistAuthority';
import { playlistItemToUnifiedTrack } from '../playlist/musicPlaylistEntry';
import type { UnifiedTrack } from '../providers';

/**
 * Keşif projeksiyonunu üretir.
 *
 * Kütüphane revizyonu + sürüş kipi + geçmiş uzunluğu aynı kaldığı sürece sonuç
 * ÖNBELLEKTEN döner: 5.000+ parçalık kütüphanede her render'da yeniden gruplama
 * yapılmaz (`musicIndex` zaten albüm/sanatçı/klasör projeksiyonlarını tutar).
 */
let cache: { key: string; value: DiscoveryPresentation } | null = null;

export function getDiscovery(drivingMode: DrivingMode): DiscoveryPresentation {
  const library = getMusicLibrarySnapshot();
  const history = getRecentlyPlayed();
  const session = getListeningSession();
  const favoriteEntries = getFavoritesSnapshot();

  const key = [
    library.revision, library.availability, drivingMode,
    history.length, history[0]?.libraryTrackId ?? history[0]?.providerRef ?? '',
    session?.sessionId ?? '', session?.currentItem?.title ?? '',
    favoriteEntries.length, favoriteEntries[0]?.key ?? '',
    getPlaylistsRevision(),
  ].join('|');
  if (cache?.key === key) return cache.value;

  const startedAt = performance.now();

  /* Geçmiş kimliklerini KANONİK kütüphaneden çöz. Çözülemeyen kayıt atlanır —
     kütüphaneden silinmiş bir parça için satır UYDURULMAZ. */
  const recentlyPlayedTracks = history
    .map((entry) => {
      if (!entry.libraryTrackId) return null;
      const track = library.tracks.find(
        (t) => t.id === entry.libraryTrackId && t.availability === 'AVAILABLE',
      );
      return track
        ? Object.freeze({
          trackId: track.id,
          title: track.title ?? 'Bilinmeyen parça',
          artist: track.artist,
          artworkIdentity: track.artworkIdentity,
        })
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  /* Sürmekte olan dinleme bağlamı: oturumun GÖZLENEN geçerli öğesi. Bu bir
     "çalıyor" iddiası DEĞİLDİR — yalnız bağlamın var olduğunu söyler. */
  const continueListening = session && session.currentItem
    ? Object.freeze({
      title: session.currentItem.title ?? 'Bilinmeyen parça',
      artist: session.currentItem.artist,
      artworkIdentity: null,
    })
    : null;

  /* MUSIC F13 · yalnız GERÇEKTEN çözülen favoriler geçer — silinmiş/taşınmış
     yerel dosya için satır UYDURULMAZ (aynı fail-closed kural, F5.1 geçmişiyle
     birebir aynı desen). */
  const favorites = resolveFavoriteDisplays(favoriteEntries)
    .filter((d) => d.resolved)
    .map((d) => Object.freeze({ key: d.key, title: d.title, artist: d.artist, artworkIdentity: d.artworkIdentity }));

  /* MUSIC F15 · playlist özetleri — parça adı/URI taşımaz, yalnız ad+adet. */
  const playlists = getPlaylists().map((p) => Object.freeze({
    id: p.id, name: p.name, itemCount: p.items.length,
  }));

  const value = buildDiscovery({
    library,
    continueListening,
    lastPlayed: null,
    recentlyPlayedTracks,
    favorites,
    playlists,
    drivingMode,
  });
  noteDiscoveryProjection({
    elapsedMs: performance.now() - startedAt,
    sections: value.sections.length,
    rows: value.sections.reduce((n, s) => n + s.items.length, 0),
    suppressed: countSuppressed(library.availability === 'READY', value),
  });
  cache = { key, value };
  return value;
}

/** Kanıt yokluğu nedeniyle ÜRETİLMEYEN bölüm sayısı — LAB teşhisi. */
function countSuppressed(libraryReady: boolean, out: DiscoveryPresentation): number {
  const possible = libraryReady ? 8 : 4;   // tüm bölüm kimlikleri (F13: + FAVORITES, F15: + PLAYLISTS)
  return Math.max(0, possible - out.sections.length);
}

/**
 * Keşif öğesi seçimi — KANONİK F3 yolundan çalar.
 *
 * `RESUME` bu katmandan çalma BAŞLATMAZ: kaldığı yerden devam, kullanıcı
 * eyleminin F0/F3 kanonik yolundan geçmesini gerektirir ve çağırana bırakılır.
 */
export async function selectDiscoveryItem(
  item: DiscoveryItem,
): Promise<StartListeningResult | null> {
  switch (item.selection.kind) {
    case 'ALBUM':
      return startLibraryListening({ kind: 'ALBUM', albumId: item.selection.albumId });
    case 'ARTIST':
      return startLibraryListening({ kind: 'ARTIST', artistId: item.selection.artistId });
    case 'FOLDER':
      return startLibraryListening({ kind: 'FOLDER', folderId: item.selection.folderId });
    case 'TRACK':
      return startLibraryListening({
        kind: 'TRACKS', trackIds: [item.selection.trackId], startTrackId: item.selection.trackId,
      });
    case 'FAVORITE': {
      /* MUSIC F13 · yalnız LOCAL favori burada çözülür (F3 yolundan). PROVIDER
         favorisi bu yoldan GİTMEZ — çağıran `resolveFavoriteProviderTrack`ı
         kullanır (bkz. `searchSelection.ts`'in PROVIDER_PATH deseni: bu katman
         sağlayıcıya doğrudan komut vermez, ikinci bir çalma otoritesi kurmaz). */
      const favoriteKey = item.selection.favoriteKey;
      const entry = getFavoritesSnapshot().find((e) => e.key === favoriteKey) ?? null;
      if (!entry || entry.kind !== 'LOCAL' || !entry.libraryId) return null;
      return startLibraryListening({
        kind: 'TRACKS', trackIds: [entry.libraryId], startTrackId: entry.libraryId,
      });
    }
    case 'PLAYLIST_OPEN':
      /* MUSIC F15 · bu bir OYNATMA değil, bir GEZİNME sinyalidir — detay
         paneli çağıranda açılır (UI presentation state, Cross-Domain §14). */
      return null;
    default:
      return null;   // RESUME → çağıranın kanonik devam yolu
  }
}

/**
 * MUSIC F13 · PROVIDER türü bir favoriyi `UnifiedTrack`e çevirir — dispatch
 * BURADA yapılmaz (bu katman playback otoritesi DEĞİLDİR); çağıran (UI) bunu
 * kanonik medya katmanına (`playMedia`) devreder — `UnifiedSearchView`nin
 * `PROVIDER_PATH` deseniyle BİREBİR aynı sınır. Çözülemiyorsa (favori artık
 * yok/oynatılamaz) `null` — sahte bir track UYDURULMAZ.
 */
export function resolveFavoriteProviderTrack(favoriteKey: string): UnifiedTrack | null {
  const entry = getFavoritesSnapshot().find((e) => e.key === favoriteKey) ?? null;
  if (!entry || entry.kind !== 'PROVIDER') return null;
  const target = resolvePlaybackTarget(entry);
  if (!target.playable || !target.provider || !target.contentUri) return null;
  return {
    id: entry.providerId ?? entry.key,
    providerId: target.provider,
    title: entry.displayTitle ?? 'Bilinmeyen parça',
    subtitle: entry.displayArtist ?? '',
    artwork: entry.displayArtwork ?? undefined,
    ...(target.contentUri.startsWith('spotify:')
      ? { spotifyUri: target.contentUri }
      : { streamUrl: target.contentUri }),
  };
}

/**
 * MUSIC F15 · Playlist'ten belirli bir öğeden (veya ilk çözülebilen
 * öğeden) başlangıç planı — VERİ SÖZLEŞMESİ, dispatch BURADA YAPILMAZ.
 * LOCAL için `TRACKS` kanonik F3 parametreleri, PROVIDER için `UnifiedTrack`
 * + tek-sağlayıcı kuyruk (F7.6'nın `buildProviderQueueContext`ıyla AYNI
 * sınır — çağıran kanonik medya katmanına devreder).
 */
export type PlaylistStartResolution =
  | { readonly kind: 'LOCAL'; readonly trackIds: readonly string[]; readonly startTrackId: string }
  | { readonly kind: 'PROVIDER'; readonly track: UnifiedTrack; readonly queue: readonly UnifiedTrack[] }
  | { readonly kind: 'UNAVAILABLE' };

export function resolvePlaylistStart(playlistId: string, itemKey?: string): PlaylistStartResolution {
  const pl = getPlaylist(playlistId);
  if (!pl) return { kind: 'UNAVAILABLE' };
  const plan = resolvePlaylistStartPlan(pl, itemKey);
  if (!plan) return { kind: 'UNAVAILABLE' };
  if (plan.startLibraryId) {
    const trackIds = plan.localLibraryIds.length > 0 ? plan.localLibraryIds : [plan.startLibraryId];
    return { kind: 'LOCAL', trackIds, startTrackId: plan.startLibraryId };
  }
  if (plan.providerEntries.length > 0 && plan.startProviderKey) {
    const queue = plan.providerEntries.map(playlistItemToUnifiedTrack) as UnifiedTrack[];
    const startIdx = plan.providerEntries.findIndex((e) => e.key === plan.startProviderKey);
    const track = queue[Math.max(0, startIdx)] ?? queue[0];
    if (!track) return { kind: 'UNAVAILABLE' };
    return { kind: 'PROVIDER', track, queue };
  }
  return { kind: 'UNAVAILABLE' };
}

export function _resetDiscoveryCacheForTest(): void { cache = null; }
