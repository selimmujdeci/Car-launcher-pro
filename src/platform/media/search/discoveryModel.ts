/**
 * discoveryModel.ts — F5 · Deterministik keşif yüzeyi (SAF).
 *
 * PAZARLIKSIZ: **AI önerisi YOKTUR.** "Senin için", "beğenebileceklerin",
 * tahmin edilmiş liste ÜRETİLMEZ. Burada yalnız elde GERÇEKTEN olan kanıtlar
 * bölümlere çevrilir: kütüphanedeki albümler/sanatçılar/klasörler, sürmekte olan
 * dinleme bağlamı, kaydedilmiş son parça.
 *
 * KANIT YOKSA BÖLÜM YOK: boş bir "Son çalınanlar" başlığı, kullanıcıya sistemin
 * bir şey bildiğini ama gösteremediğini düşündürür. Kanıtı olmayan bölüm hiç
 * render edilmez.
 *
 * Arama geçmişi bu modele GİRMEZ — geçmiş bir öneri otoritesi değildir.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */
import type { MusicLibrarySnapshot } from '../musicIndex';
import type { DrivingMode } from '../../../components/media/nowPlayingModel';

export type DiscoverySectionId =
  | 'FAVORITES' | 'PLAYLISTS' | 'CONTINUE_LISTENING' | 'RECENTLY_PLAYED' | 'RECENTLY_ADDED'
  | 'ALBUMS' | 'ARTISTS' | 'FOLDERS';

export interface DiscoveryItem {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly artworkIdentity: string | null;
  /** Seçilince hangi kütüphane bağlamı açılacak. */
  readonly selection:
    | { readonly kind: 'ALBUM'; readonly albumId: string }
    | { readonly kind: 'ARTIST'; readonly artistId: string }
    | { readonly kind: 'FOLDER'; readonly folderId: string }
    | { readonly kind: 'TRACK'; readonly trackId: string }
    | { readonly kind: 'RESUME' }
    /** MUSIC F13 · LOCAL veya PROVIDER olabilir — çözüm çağıranda yapılır. */
    | { readonly kind: 'FAVORITE'; readonly favoriteKey: string }
    /** MUSIC F15 · AÇAR (çalmaz) — detay panelini gösterir, çağıran karar verir. */
    | { readonly kind: 'PLAYLIST_OPEN'; readonly playlistId: string };
}

export interface DiscoverySection {
  readonly id: DiscoverySectionId;
  readonly title: string;
  readonly items: readonly DiscoveryItem[];
}

export interface DiscoveryInput {
  readonly library: MusicLibrarySnapshot;
  /** Sürmekte olan dinleme bağlamı — VARSA "devam et" bölümü doğar. */
  readonly continueListening: Readonly<{
    readonly title: string; readonly artist: string | null;
    readonly artworkIdentity: string | null;
  }> | null;
  /** Kaydedilmiş son parça (kalıcı kayıt) — CANLI çalma iddiası DEĞİLDİR. */
  readonly lastPlayed: Readonly<{
    readonly title: string; readonly subtitle: string | null;
    readonly artworkIdentity: string | null;
  }> | null;
  /**
   * F5.1 · Sınırlı yerel geçmişten ÇÖZÜLMÜŞ parçalar. Çözülemeyen kayıt buraya
   * GELMEZ (kütüphaneden silinmiş parça için satır uydurulmaz).
   */
  readonly recentlyPlayedTracks: readonly Readonly<{
    readonly trackId: string; readonly title: string;
    readonly artist: string | null; readonly artworkIdentity: string | null;
  }>[];
  /**
   * MUSIC F13 · yalnız GERÇEKTEN çözülmüş favoriler (LOCAL veya PROVIDER).
   * Çözülemeyen/kanıtsız favori bu listeye ASLA girmez — burada tekrar
   * filtrelenmez, üreten katman (`discoveryRuntime`) zaten filtreler.
   */
  readonly favorites: readonly Readonly<{
    readonly key: string; readonly title: string | null;
    readonly artist: string | null; readonly artworkIdentity: string | null;
  }>[];
  /** MUSIC F15 · yalnız GERÇEKTEN var olan playlist'ler (boş dizi → bölüm yok). */
  readonly playlists: readonly Readonly<{
    readonly id: string; readonly name: string; readonly itemCount: number;
  }>[];
  readonly drivingMode: DrivingMode;
}

/**
 * "Son eklenenler" için gereken KANIT eşiği.
 *
 * MediaStore `dateAdded` bu katmanda yoktur; elimizdeki tek sıralanabilir kanıt
 * `generationModified`'dır ve o da "eklendi" değil "değişti" der. Bu yüzden bölüm
 * ancak kütüphanenin ÇOĞUNDA bu kanıt varsa üretilir — azınlıkta bir kanıtla
 * "son eklenenler" demek, sıralamayı uydurmak olurdu.
 */
export const RECENTLY_ADDED_EVIDENCE_RATIO = 0.5;

/** Bir bölümde gösterilen üst sınır — sürüşte daha da azalır. */
export const DISCOVERY_ROW_LIMIT = 20;
const DRIVING_ROW_LIMIT = 8;

export interface DiscoveryPresentation {
  readonly sections: readonly DiscoverySection[];
  /** Hiç kanıt yoksa neden — sahte bölüm yerine dürüst tek satır. */
  readonly emptyReason: string | null;
}

export function buildDiscovery(input: DiscoveryInput): DiscoveryPresentation {
  const { library, continueListening, lastPlayed, drivingMode } = input;
  const limit = drivingMode === 'driving' ? DRIVING_ROW_LIMIT : DISCOVERY_ROW_LIMIT;
  const sections: DiscoverySection[] = [];

  /* MUSIC F13 · Favoriler — YALNIZ gerçek favori varsa (kanıt yoksa bölüm
     yok, F5'in kendi pazarlıksız kuralı burada da geçerli). */
  if (input.favorites.length > 0) {
    sections.push(Object.freeze({
      id: 'FAVORITES' as const,
      title: 'Favoriler',
      items: Object.freeze(input.favorites.slice(0, limit).map((f) => Object.freeze({
        id: f.key,
        title: f.title ?? 'Bilinmeyen parça',
        subtitle: f.artist,
        artworkIdentity: f.artworkIdentity,
        selection: { kind: 'FAVORITE' as const, favoriteKey: f.key },
      }))),
    }));
  }

  /* MUSIC F15 · Playlist'ler — YALNIZ gerçek playlist varsa. Boş bir "0
     parça" carousel'i UYDURULMAZ; itemCount yalnız GÖSTERİM içindir. */
  if (input.playlists.length > 0) {
    sections.push(Object.freeze({
      id: 'PLAYLISTS' as const,
      title: 'Playlist\'lerim',
      items: Object.freeze(input.playlists.slice(0, limit).map((p) => Object.freeze({
        id: p.id,
        title: p.name,
        subtitle: `${p.itemCount} parça`,
        artworkIdentity: null,
        selection: { kind: 'PLAYLIST_OPEN' as const, playlistId: p.id },
      }))),
    }));
  }

  if (continueListening) {
    sections.push(Object.freeze({
      id: 'CONTINUE_LISTENING' as const,
      title: 'Dinlemeye devam et',
      items: Object.freeze([Object.freeze({
        id: 'continue',
        title: continueListening.title,
        subtitle: continueListening.artist,
        artworkIdentity: continueListening.artworkIdentity,
        selection: { kind: 'RESUME' as const },
      })]),
    }));
  } else if (input.recentlyPlayedTracks.length > 0) {
    /* Gerçek geçmiş kanıtı: yalnız kütüphanede HÂLÂ çözülebilen parçalar.
       Bu bir öneri değil, kullanıcının kendi geçmişidir. */
    sections.push(Object.freeze({
      id: 'RECENTLY_PLAYED' as const,
      title: 'Son çalınanlar',
      items: Object.freeze(input.recentlyPlayedTracks.slice(0, limit).map((t) => Object.freeze({
        id: t.trackId,
        title: t.title,
        subtitle: t.artist,
        artworkIdentity: t.artworkIdentity,
        selection: { kind: 'TRACK' as const, trackId: t.trackId },
      }))),
    }));
  } else if (lastPlayed) {
    /* Kalıcı kayıt CANLI gözlem değildir (Cross-Domain §13): başlık "çalıyor"
       demez, yalnız kaldığı yeri hatırlatır. */
    sections.push(Object.freeze({
      id: 'RECENTLY_PLAYED' as const,
      title: 'Son çalınan',
      items: Object.freeze([Object.freeze({
        id: 'last-played',
        title: lastPlayed.title,
        subtitle: lastPlayed.subtitle,
        artworkIdentity: lastPlayed.artworkIdentity,
        selection: { kind: 'RESUME' as const },
      })]),
    }));
  }

  // Kütüphane hazır değilse koleksiyon bölümü ÜRETİLMEZ (boş liste gösterilmez).
  if (library.availability === 'READY') {
    /* Son eklenenler — YALNIZ generation kanıtı kütüphanenin çoğunda varsa. */
    const withGeneration = library.tracks.filter((t) => t.generationModified !== null);
    if (library.tracks.length > 0
      && withGeneration.length / library.tracks.length >= RECENTLY_ADDED_EVIDENCE_RATIO) {
      const newest = withGeneration
        .slice()
        .sort((a, b) => (b.generationModified ?? 0) - (a.generationModified ?? 0))
        .slice(0, limit);
      if (newest.length > 0) {
        sections.push(Object.freeze({
          id: 'RECENTLY_ADDED' as const,
          title: 'Son eklenenler',
          items: Object.freeze(newest.map((t) => Object.freeze({
            id: t.id,
            title: t.title ?? 'Bilinmeyen parça',
            subtitle: t.artist,
            artworkIdentity: t.artworkIdentity,
            selection: { kind: 'TRACK' as const, trackId: t.id },
          }))),
        }));
      }
    }

    if (library.albums.length > 0) {
      sections.push(Object.freeze({
        id: 'ALBUMS' as const,
        title: 'Albümler',
        items: Object.freeze(library.albums.slice(0, limit).map((a) => Object.freeze({
          id: a.id,
          title: a.title ?? 'Bilinmeyen albüm',
          subtitle: a.artist,
          artworkIdentity: a.artworkIdentity,
          selection: { kind: 'ALBUM' as const, albumId: a.id },
        }))),
      }));
    }
    if (library.artists.length > 0) {
      sections.push(Object.freeze({
        id: 'ARTISTS' as const,
        title: 'Sanatçılar',
        items: Object.freeze(library.artists.slice(0, limit).map((a) => Object.freeze({
          id: a.id,
          title: a.name ?? 'Bilinmeyen sanatçı',
          subtitle: `${a.trackIds.length} parça`,
          artworkIdentity: null,
          selection: { kind: 'ARTIST' as const, artistId: a.id },
        }))),
      }));
    }
    /* Klasörler sürüşte GÖSTERİLMEZ: derin dosya gezintisi sürüş sırasında
       yüksek dikkat isteyen bir etkileşimdir (attention policy). */
    if (library.folders.length > 0 && drivingMode !== 'driving') {
      sections.push(Object.freeze({
        id: 'FOLDERS' as const,
        title: 'Klasörler',
        items: Object.freeze(library.folders.slice(0, limit).map((f) => Object.freeze({
          id: f.id,
          title: f.path.split('/').filter(Boolean).pop() ?? f.path,
          subtitle: `${f.trackIds.length} parça`,
          artworkIdentity: null,
          selection: { kind: 'FOLDER' as const, folderId: f.id },
        }))),
      }));
    }
  }

  return Object.freeze({
    sections: Object.freeze(sections),
    emptyReason: sections.length > 0 ? null
      : library.availability === 'READY'
        ? 'Kütüphanede gösterilecek koleksiyon yok.'
        : 'Cihaz müziği henüz taranmadı.',
  });
}
