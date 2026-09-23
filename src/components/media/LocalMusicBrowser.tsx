/**
 * LocalMusicBrowser.tsx — F12 · Cihaz kütüphanesi tarayıcısı (SALT PROJEKSİYON).
 *
 * MediaScreen içinde "Cihaz" sekmesi olarak gösterilir.
 *
 * F12 ÖLÇÜMÜ (düzeltildi): bu ekran CarOS'un geri kalanından (MediaScreen ·
 * Discovery · Search — hepsi `--oem-*` sıcak amber/koyu paleti kullanıyor)
 * KOPUK, mavi (Tailwind `blue-400`/`rgb(59,130,246)`) bir vurgu rengi
 * kullanıyordu — sıradan bir Android müzik uygulaması gibi görünmesinin tek
 * ve en görünür nedeni buydu. Artık aynı OEM tonlarını kullanır.
 *
 * SINIRLAR (değişmedi):
 *   · Kapak YALNIZ ArtworkCache üzerinden gelir; native köprü ÇAĞRILMAZ.
 *   · Çalma isteği yalnız MusicIndex kimliklerinden F3 (`startLibraryListening`)
 *     yoluyla üretilir; component doğrudan native/local player çağırmaz.
 *   · `searchMusicLibrary` sınırlı sonuç döndürür (kanonik davranış — F2);
 *     bu ekran o sınırı SESSİZCE gizlemez, gerçek toplamı gösterir.
 */
import { memo, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Music2, Search, Play, Pause, Loader2, AlertCircle, ChevronUp, ChevronLeft, ChevronRight,
  Disc3, User, Folder, Tag, Shuffle,
} from 'lucide-react';
import {
  useLocalMusic,
  loadMusicTracks,
  localTogglePlayPause,
  initLocalMusic,
} from '../../platform/localMusicService';
import { fmtTime } from '../../platform/mediaService';
import { resolveMusicRef, searchMusicLibrary, useMusicLibrary, type MusicTrack } from '../../platform/media/musicIndex';
import { reportArtworkLoadFailure, resolveArtwork } from '../../platform/media/artworkCache';
import { startLibraryListening } from '../../platform/media/session/listeningSessionRuntime';
import { setShuffle } from '../../platform/media/authority/mediaCommandGateway';
import type { DrivingMode } from './nowPlayingModel';
import {
  availableBrowseTabs, buildBrowseDetail, buildBrowseList, selectionStartingAt, BROWSE_TAB_LABEL,
  type BrowseRow, type BrowseTab,
} from './libraryBrowseModel';

/* ── Yardımcı: saniye formatı ────────────────────────────── */
function fmtMs(ms: number): string {
  return fmtTime(ms / 1000);
}

/**
 * F12 · Görüntülenen sonuç sınırı — `searchMusicLibrary`nin KENDİ kanonik
 * sınırıdır (F2), burada TEKRARLANMAZ. Sürüşte daha da daralır: derin
 * alfabetik gezinme yüksek dikkat ister (mevcut sürüş politikasıyla AYNI ilke,
 * bkz. `discoveryModel.DRIVING_ROW_LIMIT`) — ikinci bir sürüş otoritesi
 * KURULMAZ, yalnız var olan `drivingMode` prop'u yorumlanır.
 */
const RESULT_LIMIT = 100;
const DRIVING_RESULT_LIMIT = 30;
/** Dokunma hedefi tabanı — F11'deki `MIN_TOUCH_TARGET_PX` ile AYNI değer. */
const MIN_TOUCH_TARGET_PX = 48;

/* ── Lazy album art ───────────────────────────────────────
 * Kapak YALNIZ ArtworkCache üzerinden gelir; UI native köprüyü ÇAĞIRMAZ.
 *
 * IntersectionObserver KORUNDU (kilit: memoryCacheStorageF5 · E3): 1000+ parçalık
 * bir listede görünmeyen satırlar için decode İSTENMEZ. Çözümleyici zincirin
 * (bellek → disk → native sampled decode) ucuz olması bu kilidi gereksiz KILMAZ —
 * en ucuz decode, hiç yapılmayandır.
 */
function AlbumArtImg({
  uri,
  className,
  fallback,
}: {
  uri:       string | undefined;
  className: string;
  fallback:  React.ReactNode;
}) {
  const [src, setSrc] = useState<string | undefined>(undefined);
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current || visible) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        obs.disconnect();
      }
    }, { rootMargin: '200px' });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [visible]);

  useEffect(() => {
    setSrc(undefined);
    if (!visible || !uri) return;
    let cancelled = false;
    void resolveArtwork(uri, 'thumbnail').then((out) => { if (!cancelled) setSrc(out.url ?? undefined); });
    return () => { cancelled = true; };
  }, [visible, uri]);

  /* Cache dosyası OS tarafından silinmiş olabilir: kırık görsel göstermek yerine
     girdi düşürülür ve bir sonraki istek yeniden decode eder. Kapak hatası
     kütüphane veya çalma gerçeğini ETKİLEMEZ. */
  const handleError = useCallback(() => {
    if (uri) reportArtworkLoadFailure(uri, 'thumbnail');
    setSrc(undefined);
  }, [uri]);

  return (
    <div ref={ref} className={className}>
      {src ? <img src={src} alt="" className="w-full h-full object-cover" onError={handleError} /> : fallback}
    </div>
  );
}

interface Props {
  /** F12 · mevcut sürüş otoritesinden GELİR — yeni bir otorite KURULMAZ. */
  readonly drivingMode?: DrivingMode;
}

/* ── Ana bileşen ─────────────────────────────────────────── */

export const LocalMusicBrowser = memo(function LocalMusicBrowser({ drivingMode = 'idle' }: Props) {
  const { tracks, currentIndex, playing, loading, error } = useLocalMusic();
  const library = useMusicLibrary();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<BrowseTab>('TRACKS');
  const [detailRow, setDetailRow] = useState<BrowseRow | null>(null);
  const tabs = useMemo(() => availableBrowseTabs(library, drivingMode), [library, drivingMode]);
  const collection = useMemo(
    () => (tab === 'TRACKS' ? null : buildBrowseList(library, tab, query, drivingMode)),
    [library, tab, query, drivingMode],
  );
  const detail = useMemo(() => (detailRow ? buildBrowseDetail(library, detailRow) : null), [library, detailRow]);

  /* Sürüşe geçince gizlenen sekmede (Klasörler) kalınmaz; detayın parçaları
     erişilemez olduysa (USB çıkarıldı) listeye dönülür — boş detay gösterilmez. */
  useEffect(() => {
    if (!tabs.includes(tab)) { setTab('TRACKS'); setDetailRow(null); }
  }, [tabs, tab]);
  useEffect(() => {
    if (detailRow && !detail) setDetailRow(null);
  }, [detailRow, detail]);

  const openTab = useCallback((next: BrowseTab) => { setTab(next); setDetailRow(null); setQuery(''); }, []);

  /* Çal = kanonik sırayla (karıştırma kapatılır) · Karıştır = rastgele parçadan
     başlar, sonra karıştırma açılır. İkisi de F3 kanonik giriş yolundan geçer. */
  const playDetail = useCallback((shuffle: boolean) => {
    if (!detail) return;
    if (shuffle) {
      const start = detail.tracks[Math.floor(Math.random() * detail.tracks.length)];
      if (!start) return;
      void startLibraryListening(selectionStartingAt(detail.selection, start.id)).then(() => setShuffle(true));
    } else {
      void setShuffle(false).then(() => startLibraryListening(detail.selection));
    }
  }, [detail]);

  useEffect(() => {
    void initLocalMusic();
    void loadMusicTracks();
  }, []);

  const limit = drivingMode === 'driving' ? DRIVING_RESULT_LIMIT : RESULT_LIMIT;
  const filtered = useMemo(() => {
    // Revision is the library authority's invalidation token.
    void library.revision;
    return searchMusicLibrary(query, limit).map(resolveMusicRef).filter((track): track is MusicTrack => track !== null);
  }, [library.revision, query, limit]);

  /* F12 · Kanonik sınır SESSİZCE gizlenmez: kullanıcı gerçek kütüphane
     büyüklüğünü ve yalnız bir kısmını gördüğünü BİLİR. "100 parça" yazıp
     arkada 5000 tane olması bir dürüstlük ihlalidir. */
  const availableTotal = useMemo(
    () => library.tracks.reduce((n, t) => (t.availability === 'AVAILABLE' ? n + 1 : n), 0),
    [library.tracks],
  );
  const isTruncated = filtered.length < availableTotal && filtered.length >= limit;

  /* F3: UI yalnız MusicIndex kimliklerinden niyet/DesiredQueue girdisi üretir.
     Çalma isteği runtime → MediaCommandGateway → F0 canonical authority yolundan
     gider; component doğrudan native/local player çağırmaz. */
  const handlePlay = useCallback((track: MusicTrack) => {
    const trackIds = library.tracks
      .filter((candidate) => candidate.availability === 'AVAILABLE')
      .map((candidate) => candidate.id);
    if (!trackIds.includes(track.id)) return;
    void startLibraryListening({ kind: 'TRACKS', trackIds, startTrackId: track.id });
  }, [library.tracks]);

  /* ── Yükleniyor ── */
  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin" aria-hidden style={{ color: 'var(--oem-amber, #e0a23c)', opacity: 0.75 }} />
        <span className="text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--oem-ink-2)' }}>
          Müzikler Taranıyor…
        </span>
      </div>
    );
  }

  /* ── Hata ── */
  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-8 text-center">
        <AlertCircle className="w-10 h-10" aria-hidden style={{ color: '#ff4444', opacity: 0.75 }} />
        <div className="text-sm font-medium leading-relaxed" style={{ color: 'var(--oem-ink-2)' }}>{error}</div>
        <button
          onClick={() => void loadMusicTracks()}
          className="rounded-xl glass-card px-6 text-sm font-black active:scale-95 transition-all"
          style={{ minHeight: MIN_TOUCH_TARGET_PX, color: 'var(--oem-amber, #e0a23c)' }}
        >
          Tekrar Dene
        </button>
      </div>
    );
  }

  /* ── Boş kütüphane ── */
  if (!loading && tracks.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 px-8 text-center">
        <div className="w-20 h-20 rounded-3xl glass-card flex items-center justify-center">
          <Music2 className="w-10 h-10" aria-hidden style={{ color: 'var(--oem-ink-3)', opacity: 0.6 }} />
        </div>
        <div>
          <div className="font-black text-lg" style={{ color: 'var(--oem-ink)' }}>Müzik Bulunamadı</div>
          <div className="text-sm mt-1.5 leading-relaxed max-w-[260px]" style={{ color: 'var(--oem-ink-2)' }}>
            Cihaz depolamasında müzik dosyası yok. Dosyaları ekledikten sonra yenile.
          </div>
        </div>
        <button
          onClick={() => void loadMusicTracks()}
          className="rounded-xl glass-card px-6 text-sm font-black active:scale-95 transition-all"
          style={{ minHeight: MIN_TOUCH_TARGET_PX, color: 'var(--oem-amber, #e0a23c)' }}
        >
          Yenile
        </button>
      </div>
    );
  }

  const currentTrack = currentIndex >= 0 ? tracks[currentIndex] : null;
  const tabIcon = (t: BrowseTab) => (t === 'ALBUMS' ? Disc3 : t === 'ARTISTS' ? User : t === 'FOLDERS' ? Folder : t === 'GENRES' ? Tag : Music2);
  const placeholder = tab === 'TRACKS' ? 'Parça veya sanatçı ara…' : `${BROWSE_TAB_LABEL[tab]} içinde ara…`;
  const DetailIcon = tabIcon(tab);

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Şu an çalıyor — mini çubuk */}
      {currentTrack && (
        <div
          className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b"
          style={{ background: 'var(--oem-accent-soft, rgba(224,162,60,0.08))', borderColor: 'var(--oem-line, rgba(255,255,255,0.08))' }}
        >
          <AlbumArtImg
            uri={currentTrack.albumArtUri}
            className="w-9 h-9 rounded-xl glass-card overflow-hidden flex items-center justify-center flex-shrink-0"
            fallback={<Music2 className="w-4 h-4" aria-hidden style={{ color: 'var(--oem-amber, #e0a23c)' }} />}
          />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-black truncate" style={{ color: 'var(--oem-ink)' }}>{currentTrack.title}</div>
            <div className="text-[10px] truncate" style={{ color: 'var(--oem-ink-2)' }}>{currentTrack.artist}</div>
          </div>
          <button
            onClick={localTogglePlayPause}
            aria-label={playing ? 'Duraklat' : 'Çal'}
            className="rounded-xl flex items-center justify-center active:scale-90 transition-all"
            style={{ width: MIN_TOUCH_TARGET_PX, height: MIN_TOUCH_TARGET_PX, background: 'var(--oem-amber, #e0a23c)', color: '#111' }}
          >
            {playing
              ? <Pause className="w-5 h-5" fill="currentColor" />
              : <Play  className="w-5 h-5 ml-0.5" fill="currentColor" />
            }
          </button>
          <ChevronUp className="w-4 h-4 flex-shrink-0" aria-hidden style={{ color: 'var(--oem-ink-3)', opacity: 0.6 }} />
        </div>
      )}

      {detail && detailRow ? (
        <div className="flex-1 flex flex-col overflow-hidden" data-testid="library-detail">
          <div className="flex-shrink-0 px-4 pt-2 pb-3">
            <button
              onClick={() => setDetailRow(null)}
              aria-label={`Geri — ${BROWSE_TAB_LABEL[tab]}`}
              className="flex items-center gap-1 text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
              style={{ minHeight: MIN_TOUCH_TARGET_PX, color: 'var(--oem-amber, #e0a23c)' }}
            >
              <ChevronLeft className="w-4 h-4" aria-hidden /> {BROWSE_TAB_LABEL[tab]}
            </button>
            <div className="flex items-center gap-4">
              <AlbumArtImg
                uri={detail.artworkIdentity ?? undefined}
                className="w-20 h-20 rounded-2xl glass-card overflow-hidden flex items-center justify-center flex-shrink-0"
                fallback={<DetailIcon className="w-8 h-8" aria-hidden style={{ color: 'var(--oem-amber, #e0a23c)' }} />}
              />
              <div className="flex-1 min-w-0">
                <div className="text-lg font-black truncate" style={{ color: 'var(--oem-ink)' }}>{detail.title}</div>
                <div className="text-xs truncate mt-0.5" style={{ color: 'var(--oem-ink-2)' }}>{detail.subtitle}</div>
                <div className="flex gap-2 mt-2.5">
                  <button
                    onClick={() => playDetail(false)}
                    data-testid="library-detail-play"
                    className="flex items-center gap-1.5 rounded-xl px-4 text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
                    style={{ minHeight: MIN_TOUCH_TARGET_PX, background: 'var(--oem-amber, #e0a23c)', color: '#111' }}
                  >
                    <Play className="w-4 h-4" fill="currentColor" aria-hidden /> Çal
                  </button>
                  <button
                    onClick={() => playDetail(true)}
                    data-testid="library-detail-shuffle"
                    className="flex items-center gap-1.5 rounded-xl glass-card px-4 text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
                    style={{ minHeight: MIN_TOUCH_TARGET_PX, color: 'var(--oem-amber, #e0a23c)' }}
                  >
                    <Shuffle className="w-4 h-4" aria-hidden /> Karıştır
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-none px-4 pb-4">
            <div className="flex flex-col gap-1">
              {detail.tracks.map((track, i) => {
                const isActive = currentTrack?.id === track.id;
                return (
                  <button
                    key={track.id}
                    onClick={() => void startLibraryListening(selectionStartingAt(detail.selection, track.id))}
                    aria-label={`${track.title ?? 'Parça'}${track.artist ? ` — ${track.artist}` : ''}`}
                    className="flex items-center gap-3 px-3 rounded-2xl text-left transition-all active:scale-[0.98]"
                    style={{
                      minHeight: MIN_TOUCH_TARGET_PX,
                      background: isActive ? 'var(--oem-accent-soft, rgba(224,162,60,0.15))' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${isActive ? 'var(--oem-line-warm, rgba(224,162,60,0.35))' : 'var(--oem-line, rgba(255,255,255,0.06))'}`,
                    }}
                  >
                    <div className="w-7 flex-shrink-0 text-center text-xs font-black tabular-nums"
                      style={{ color: isActive ? 'var(--oem-amber, #e0a23c)' : 'var(--oem-ink-3)' }}>
                      {isActive && playing
                        ? <Pause className="w-4 h-4 mx-auto" fill="currentColor" aria-hidden />
                        : (tab === 'ALBUMS' && track.trackNumber ? track.trackNumber : i + 1)}
                    </div>
                    <div className="flex-1 min-w-0 py-2">
                      <div className="text-sm font-black truncate"
                        style={{ color: isActive ? 'var(--oem-amber, #e0a23c)' : 'var(--oem-ink)' }}>
                        {track.title ?? 'Adsız parça'}
                      </div>
                      {tab !== 'ALBUMS' && (
                        <div className="text-[11px] truncate mt-0.5 font-medium" style={{ color: 'var(--oem-ink-2)' }}>
                          {[track.artist, track.album].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-[11px] font-black tabular-nums" style={{ color: 'var(--oem-ink-3)' }}>
                      {fmtMs(track.durationMs ?? 0)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (<>
      {/* Arama */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2">
        <div className="flex items-center gap-2.5 glass-card rounded-xl px-3 border"
          style={{ minHeight: MIN_TOUCH_TARGET_PX, borderColor: 'var(--oem-line, rgba(255,255,255,0.10))' }}>
          <Search className="w-4 h-4 flex-shrink-0" aria-hidden style={{ color: 'var(--oem-ink-3)' }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label="Cihaz müziğinde ara"
            className="flex-1 bg-transparent text-sm outline-none font-medium"
            style={{ color: 'var(--oem-ink)' }}
          />
        </div>
        {/* Gezinme sekmeleri — sürüşte Klasörler yok (dikkat politikası). */}
        <div className="flex gap-1.5 mt-2.5 overflow-x-auto scrollbar-none" role="tablist" aria-label="Kütüphane görünümü">
          {tabs.map((t) => {
            const Icon = tabIcon(t);
            const active = t === tab;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={active}
                data-testid={`library-tab-${t}`}
                onClick={() => openTab(t)}
                className="flex items-center gap-1.5 rounded-xl px-3 text-[11px] font-black uppercase tracking-widest whitespace-nowrap active:scale-95 transition-all"
                style={{
                  minHeight: MIN_TOUCH_TARGET_PX - 8,
                  background: active ? 'var(--oem-amber, #e0a23c)' : 'rgba(255,255,255,0.04)',
                  color: active ? '#111' : 'var(--oem-ink-2)',
                  border: `1px solid ${active ? 'transparent' : 'var(--oem-line, rgba(255,255,255,0.08))'}`,
                }}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden /> {BROWSE_TAB_LABEL[t]}
              </button>
            );
          })}
        </div>
        {/* F12 · gerçek toplam GİZLENMEZ: kanonik sınır (F2) sessizce
            "kütüphanede bu kadar var" sanısı UYANDIRMAZ. */}
        <div className="text-[10px] font-bold uppercase tracking-widest mt-2 px-0.5" style={{ color: 'var(--oem-ink-3)' }}>
          {collection
            ? (collection.truncated
              ? `İlk ${collection.rows.length} / ${collection.total} — daraltmak için ara`
              : `${collection.total} ${BROWSE_TAB_LABEL[tab].toLocaleLowerCase('tr-TR')}`)
            : isTruncated
              ? `İlk ${filtered.length} / ${availableTotal} parça — daraltmak için ara`
              : `${filtered.length} parça`}
        </div>
      </div>

      {/* Liste */}
      <div className="flex-1 overflow-y-auto scrollbar-none px-4 pb-4">
        {collection ? (
          collection.rows.length === 0 ? (
            <div className="text-sm text-center mt-8" style={{ color: 'var(--oem-ink-3)' }}>
              {query ? 'Aramayla eşleşen sonuç yok.' : `Kütüphanede ${BROWSE_TAB_LABEL[tab].toLocaleLowerCase('tr-TR')} bilgisi yok.`}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {collection.rows.map((row) => (
                <button
                  key={row.id}
                  onClick={() => setDetailRow(row)}
                  aria-label={`${row.title} — ${row.trackCount} parça`}
                  className="flex items-center gap-3 p-2.5 rounded-2xl text-left transition-all active:scale-[0.98]"
                  style={{ minHeight: MIN_TOUCH_TARGET_PX + 8, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--oem-line, rgba(255,255,255,0.06))' }}
                >
                  <AlbumArtImg
                    uri={tab === 'ALBUMS' ? (row.artworkIdentity ?? undefined) : undefined}
                    className="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0"
                    fallback={
                      <div className="w-full h-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
                        <DetailIcon className="w-5 h-5" aria-hidden style={{ color: 'var(--oem-ink-3)' }} />
                      </div>
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-black truncate" style={{ color: 'var(--oem-ink)' }}>{row.title}</div>
                    <div className="text-[11px] truncate mt-0.5 font-medium" style={{ color: 'var(--oem-ink-2)' }}>
                      {[row.subtitle, `${row.trackCount} parça`].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 flex-shrink-0" aria-hidden style={{ color: 'var(--oem-ink-3)' }} />
                </button>
              ))}
            </div>
          )
        ) : (
        <div className="flex flex-col gap-1">
          {filtered.map((track) => {
            const realIdx = tracks.findIndex((t) => t.id === track.id);
            const isActive = realIdx === currentIndex;
            return (
              <button
                key={track.id}
                onClick={() => handlePlay(track)}
                aria-label={`${track.title}${track.artist ? ` — ${track.artist}` : ''}`}
                className="flex items-center gap-3 p-3 rounded-2xl text-left transition-all active:scale-[0.98] group"
                style={{
                  minHeight: MIN_TOUCH_TARGET_PX,
                  background:  isActive ? 'var(--oem-accent-soft, rgba(224,162,60,0.15))' : 'rgba(255,255,255,0.02)',
                  borderWidth: 1,
                  borderColor: isActive ? 'var(--oem-line-warm, rgba(224,162,60,0.35))' : 'var(--oem-line, rgba(255,255,255,0.06))',
                  borderStyle: 'solid',
                }}
              >
                {/* Album art / çalıyor göstergesi */}
                <div className="relative flex-shrink-0">
                  <AlbumArtImg
                    uri={track.artworkIdentity ?? undefined}
                    className="w-10 h-10 rounded-xl overflow-hidden"
                    fallback={
                      <div
                        className="w-full h-full flex items-center justify-center"
                        style={{ background: isActive ? 'var(--oem-accent-soft, rgba(224,162,60,0.25))' : 'rgba(255,255,255,0.05)' }}
                      >
                        <Music2 className="w-4 h-4" aria-hidden
                          style={{ color: isActive ? 'var(--oem-amber, #e0a23c)' : 'var(--oem-ink-3)', opacity: isActive ? 1 : 0.6 }} />
                      </div>
                    }
                  />
                  {isActive && playing && (
                    <div className="absolute inset-0 rounded-xl flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }}>
                      <Pause className="w-4 h-4" fill="currentColor" aria-hidden style={{ color: 'var(--oem-amber, #e0a23c)' }} />
                    </div>
                  )}
                </div>

                {/* Bilgi */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-black truncate"
                    style={{ color: isActive ? 'var(--oem-amber, #e0a23c)' : 'var(--oem-ink)' }}>
                    {track.title}
                  </div>
                  <div className="text-[11px] truncate mt-0.5 font-medium" style={{ color: 'var(--oem-ink-2)' }}>
                    {track.artist}
                    {track.album ? ` · ${track.album}` : ''}
                  </div>
                </div>

                {/* Süre */}
                <div className="flex-shrink-0 text-[11px] font-black tabular-nums" style={{ color: 'var(--oem-ink-3)' }}>
                  {fmtMs(track.durationMs ?? 0)}
                </div>
              </button>
            );
          })}
        </div>
        )}
      </div>
      </>)}
    </div>
  );
});
