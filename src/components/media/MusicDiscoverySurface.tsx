/**
 * MusicDiscoverySurface.tsx — F5.1 · Keşif yüzeyi (SALT PROJEKSİYON).
 *
 * SINIRLAR:
 *   · İş mantığı YOK: bölümler `discoveryRuntime`den gelir, seçim kanonik F3
 *     yolundan yürür. Bileşen kütüphane taramaz, sağlayıcı çağırmaz, çalma
 *     otoritesi tutmaz.
 *   · Kanıt yoksa bölüm ÇİZİLMEZ — boş başlık gösterilmez.
 *   · "Senin için / Önerilen / Bunu sevebilirsin" gibi çıkarım iddiası YOKTUR.
 */
import { memo, useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { Music2, Play, Plus } from 'lucide-react';

import { subscribeMusicLibrary, getMusicLibrarySnapshot } from '../../platform/media/musicIndex';
import { subscribeFavorites, getFavoritesRevision } from '../../platform/media/collection/musicCollectionAuthority';
import { subscribePlaylists, getPlaylistsRevision, createPlaylist } from '../../platform/media/playlist/musicPlaylistAuthority';
import {
  getDiscovery, selectDiscoveryItem, resolveFavoriteProviderTrack,
} from '../../platform/media/search/discoveryRuntime';
import type { DiscoveryItem, DiscoverySection } from '../../platform/media/search/discoveryModel';
import type { UnifiedTrack } from '../../platform/media/providers';
import type { DrivingMode } from './nowPlayingModel';
import { MusicIntelligenceCard } from './MusicIntelligenceCard';
import { PlaylistDetailPanel } from './PlaylistDetailPanel';

/** Kritik dokunma hedefi tabanı — 800×480 aftermarket ekran. */
const MIN_TOUCH_TARGET_PX = 48;

interface Props {
  readonly drivingMode: DrivingMode;
  /** "Kaldığın yerden devam" — kanonik devam yolu ÇAĞIRANDA kalır. */
  readonly onResume: () => void;
  readonly onStarted?: () => void;
  /**
   * MUSIC F13 · PROVIDER favorisi seçildiğinde çağrılır — bu bileşen
   * sağlayıcıya DOĞRUDAN komut vermez; devir `UnifiedSearchView`nin
   * `PROVIDER_PATH` deseniyle AYNI sınırdan, çağırana bırakılır. Verilmezse
   * PROVIDER favorileri sessizce çalınamaz (yeni bir otorite İCAT EDİLMEZ).
   */
  readonly onPlayProviderResult?: (track: UnifiedTrack, queue: UnifiedTrack[]) => void;
}

/** Sürüşte bölüm sayısı sınırlanır — uzun carousel zinciri kurulmaz. */
const DRIVING_SECTION_LIMIT = 3;

const Card = memo(function Card({
  item, onSelect,
}: {
  readonly item: DiscoveryItem;
  readonly onSelect: (item: DiscoveryItem) => void;
}) {
  const isResume = item.selection.kind === 'RESUME';
  return (
    <li className="flex-shrink-0" style={{ width: 152 }}>
      <button
        type="button"
        onClick={() => onSelect(item)}
        aria-label={`${item.title}${item.subtitle ? ` — ${item.subtitle}` : ''}`}
        className="flex w-full flex-col gap-2 rounded-2xl border-0 bg-transparent p-1 text-left"
        style={{ minHeight: 200 }}
      >
        <span
          className="relative flex items-center justify-center overflow-hidden rounded-xl"
          style={{ width: 144, height: 144, background: 'var(--oem-surface-2, #292d35)' }}
        >
          {item.artworkIdentity
            ? <img src={item.artworkIdentity} alt="" loading="lazy" className="h-full w-full object-cover" />
            : <Music2 aria-hidden className="h-7 w-7" style={{ color: 'var(--oem-ink-3)' }} />}
          {isResume && (
            <span
              aria-hidden
              className="absolute bottom-2 right-2 flex items-center justify-center rounded-full"
              style={{ width: 40, height: 40, background: 'var(--oem-amber, #e0a23c)', color: '#111' }}
            >
              <Play className="ml-0.5 h-5 w-5" fill="currentColor" />
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold" style={{ color: 'var(--oem-ink, #fff)' }}>
            {item.title}
          </span>
          {item.subtitle && (
            <span className="block truncate text-xs" style={{ color: 'var(--oem-ink-2, #b9bec8)' }}>
              {item.subtitle}
            </span>
          )}
        </span>
      </button>
    </li>
  );
});

const Section = memo(function Section({
  section, onSelect,
}: {
  readonly section: DiscoverySection;
  readonly onSelect: (item: DiscoveryItem) => void;
}) {
  return (
    <section data-discovery-section={section.id} className="flex-shrink-0">
      <h3
        className="px-1 pb-2 text-[10px] font-black uppercase tracking-[0.25em]"
        style={{ color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}
      >
        {section.title}
      </h3>
      <ul
        className="flex gap-3 overflow-x-auto scrollbar-none pb-2"
        style={{ overscrollBehavior: 'contain' }}
      >
        {section.items.map((item) => (
          <Card key={`${section.id}:${item.id}`} item={item} onSelect={onSelect} />
        ))}
      </ul>
    </section>
  );
});

export function MusicDiscoverySurface({ drivingMode, onResume, onStarted, onPlayProviderResult }: Props) {
  // Kütüphane değişince projeksiyon tazelenir; bileşen kendi taramasını YAPMAZ.
  const librarySnapshot = useSyncExternalStore(subscribeMusicLibrary, getMusicLibrarySnapshot, getMusicLibrarySnapshot);
  // MUSIC F13 · favori mutasyonu bölümü tazeler — bileşen kendi favori state'ini TUTMAZ.
  const favoritesRevision = useSyncExternalStore(subscribeFavorites, getFavoritesRevision, getFavoritesRevision);
  // MUSIC F15 · playlist mutasyonu bölümü tazeler — bileşen kendi playlist state'ini TUTMAZ.
  const playlistsRevision = useSyncExternalStore(subscribePlaylists, getPlaylistsRevision, getPlaylistsRevision);
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  /* `librarySnapshot`/`favoritesRevision`/`playlistsRevision` deps'e GİRER:
     onlarsız `useMemo` yeniden render'ı görür ama `drivingMode` değişmediği
     sürece ESKİ keşfi döndürürdü — abonelik sessizce ETKİSİZ kalırdı. */
  /* getDiscovery() modül-seviyesi otoriteyi (musicIndex/musicCollectionAuthority/
     musicPlaylistAuthority) OKUR; deps kasıtlı bir GEÇERSİZ KILMA
     tetikleyicisidir, doğrudan çağrı argümanı DEĞİLDİR. */
  const discovery = useMemo(
    () => getDiscovery(drivingMode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drivingMode, librarySnapshot.revision, favoritesRevision, playlistsRevision],
  );

  const sections = drivingMode === 'driving'
    ? discovery.sections.slice(0, DRIVING_SECTION_LIMIT)
    : discovery.sections;

  const handleSelect = useCallback((item: DiscoveryItem) => {
    if (item.selection.kind === 'RESUME') { onResume(); return; }
    if (item.selection.kind === 'PLAYLIST_OPEN') {
      /* MUSIC F15 · bu bir OYNATMA değil, GEZİNMEDİR — detay paneli açılır. */
      setOpenPlaylistId(item.selection.playlistId);
      return;
    }
    if (item.selection.kind === 'FAVORITE') {
      /* PROVIDER favorisi F3 yolundan gitmez — kanonik medya katmanına devir. */
      const providerTrack = resolveFavoriteProviderTrack(item.selection.favoriteKey);
      if (providerTrack) {
        onPlayProviderResult?.(providerTrack, [providerTrack]);
        onStarted?.();
        return;
      }
    }
    void selectDiscoveryItem(item).then((result) => {
      if (result?.started) onStarted?.();
    });
  }, [onResume, onStarted, onPlayProviderResult]);

  const confirmCreate = useCallback(() => {
    if (nameDraft.trim()) createPlaylist(nameDraft);
    setNameDraft('');
    setCreating(false);
  }, [nameDraft]);

  /* MUSIC F15 · "Yeni Playlist" — kanıtsız isim UYDURULMAZ, kullanıcı YAZAR.
     Sürüşte GİZLİDİR (karmaşık düzenleme sadeleştirme kuralı). */
  const canCreate = drivingMode !== 'driving';

  return (
    <div
      data-music-surface="discovery"
      className="relative flex flex-1 flex-col gap-5 overflow-y-auto scrollbar-none pb-4 pt-4"
      style={{ overscrollBehavior: 'contain' }}
    >
      {canCreate && (
        <div data-discovery-create-playlist="true" className="flex-shrink-0 px-1">
          {creating ? (
            <div className="flex items-center gap-2 rounded-2xl px-3" style={{ minHeight: MIN_TOUCH_TARGET_PX, background: 'var(--oem-surface-2, #292d35)' }}>
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Playlist adı (ör. Yol Müzikleri)"
                aria-label="Yeni playlist adı"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                style={{ color: 'var(--oem-ink, #fff)', height: MIN_TOUCH_TARGET_PX }}
              />
              <button
                type="button"
                onClick={confirmCreate}
                aria-label="Playlist'i oluştur"
                className="flex flex-shrink-0 items-center justify-center rounded-full font-black text-xs uppercase tracking-widest"
                style={{ height: MIN_TOUCH_TARGET_PX, padding: '0 16px', color: 'var(--oem-amber, #e0a23c)' }}
              >
                Oluştur
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              aria-label="Yeni playlist oluştur"
              className="flex w-full items-center gap-3 rounded-2xl border px-3"
              style={{
                minHeight: MIN_TOUCH_TARGET_PX,
                borderColor: 'var(--oem-line, rgba(255,255,255,.14))',
                color: 'var(--oem-ink-2, #b9bec8)',
              }}
            >
              <Plus aria-hidden className="h-5 w-5 flex-shrink-0" />
              <span className="text-sm font-bold">Yeni Playlist</span>
            </button>
          )}
        </div>
      )}

      {sections.length === 0 ? (
        <p
          data-discovery-empty="true"
          className="flex flex-1 items-center justify-center px-6 text-center text-sm"
          style={{ color: 'var(--oem-ink-2, #b9bec8)' }}
        >
          {discovery.emptyReason ?? 'Gösterilecek müzik yok.'}
        </p>
      ) : (
        <>
          {/* MUSIC F8 · Sürüş-farkında TEK öneri satırı. Kanıt yoksa HİÇBİR ŞEY
              çizmez; keşif bölümlerinin sırasına ve içeriğine KARIŞMAZ (F5 sahibi
              keşfin kendisidir — F8 yalnız üstüne bir satır koyar). */}
          <MusicIntelligenceCard
            revision={`${discovery.sections.length}:${drivingMode}`}
            onStarted={onStarted}
          />
          {sections.map((section) => (
            <Section key={section.id} section={section} onSelect={handleSelect} />
          ))}
        </>
      )}

      <PlaylistDetailPanel
        playlistId={openPlaylistId}
        onClose={() => setOpenPlaylistId(null)}
        drivingMode={drivingMode}
        onStarted={onStarted}
        onPlayProviderResult={onPlayProviderResult}
      />
    </div>
  );
}
