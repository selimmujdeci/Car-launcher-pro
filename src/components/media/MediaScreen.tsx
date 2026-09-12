/**
 * Premium Media Hub — araç içi medya merkezi.
 *
 * Tab: NOW PLAYING — büyük albüm kapağı, kontroller, progress, shuffle/repeat
 * Tab: KAYNAKLAR   — bilinen medya uygulamaları listesi, aktif kaynak seçimi
 *
 * Native: Android MediaSession üzerinden harici uygulama kontrolü
 * Web/Demo: mock track rotasyonu
 */
import { memo, useEffect, useCallback, useMemo, useState, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  SkipBack, SkipForward, Play, Pause,
  Music2, Music, Bluetooth, Radio, Shuffle, Repeat, Repeat1,
  Layers, Check, ChevronRight, HardDrive, SlidersHorizontal,
  Search, Plus, Trash2, Globe, X, Video, Download, Loader2,
  ListMusic, Heart, Captions,
} from 'lucide-react';
import { LocalMusicBrowser } from './LocalMusicBrowser';
import { LocalVideoBrowser } from './LocalVideoBrowser';
import { useFavoriteStatus } from './useFavoriteStatus';
import { AddToPlaylistSheet } from './AddToPlaylistSheet';
import { LyricsPanel } from './LyricsPanel';
import {
  getLyricsPanelVisible, setLyricsPanelVisible, subscribeLyricsPanelVisible,
} from '../../platform/media/lyricsPanelVisibility';
import {
  fmtTime, startMediaHub, stopMediaHub,
  setMediaPreferredPackage, pollMediaNow, play,
  playMedia, ensureLocalLoaded,
  resumeLastMedia, previewLastMedia, getLastMedia,
  ensureYouTubeReady, setYouTubeRegion,
  /* MUSIC F7.3 · sonraki/önceki KUYRUK-FARKINDA tek girişten geçer: sıra
     backend'in (native timeline) veya üst katmanın (arama sonucu listesi)
     olabilir. Kapıya doğrudan gitmek, YouTube gibi kuyruksuz backend'lerde
     komutu `unsupported_capability` ile düşürüyordu. */
  next as queueAwareNext, previous as queueAwarePrevious, hasQueue,
  type UnifiedTrack,
  type MediaSource,
} from '../../platform/media/carosMediaLayer';
/* MUSIC F8 · karar okuma + kanonik uygulama. Bu ekran kendi zekâ durumunu
   TUTMAZ; karar `musicIntelligenceRuntime`den gelir. */
import {
  applyIntelligenceCandidate, evaluateMusicIntelligence,
} from '../../platform/media/intelligence/musicIntelligenceRuntime';
import { useMusicViewModel } from './MusicViewModel';
import { NowPlayingSurface } from './NowPlayingSurface';
import { QueuePanel } from './QueuePanel';
import {
  buildNowPlayingPresentation, type DrivingMode, type NowPlayingPresentation,
} from './nowPlayingModel';
/* F11 · Now Playing yerleşimi ÖLÇÜLEN ekran boyutundan + sürüş durumundan
   saf bir hesap üretir (bkz. dosya başlığı). İkinci bir sürüş/ekran otoritesi
   KURULMAZ — `useScreenSense` mevcut ResizeObserver kancasıdır. */
import { computeNowPlayingLayout, type NowPlayingLayout } from './nowPlayingLayoutModel';
import { useScreenSense } from '../../hooks/useScreenSense';
import { markQueueInteraction } from '../../platform/media/musicUiPerf';
import { useNowPlayingArtwork } from './useNowPlayingArtwork';
import { UnifiedSearchView } from './UnifiedSearchView';
import { setMapHeavyNeighbor } from '../../platform/mapSourceManager';
import { isNative } from '../../platform/bridge';
import { useStore } from '../../store/useStore';
import type { CustomMusicSource } from '../../store/useStore';
import type { MusicOptionKey } from '../../data/apps';
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { getRuntimeConfig } from '../../core/runtime/runtimeConfig';
import { isLowEndDevice } from '../../platform/headUnitCompat';
import { getCurrentYouTubeVideoId } from '../../platform/youtubeService';
import { getVideoMode, toggleVideoMode, subscribeVideoMode } from '../../platform/media/videoModeStore';
/* MUSIC F7.2 · sürüşte video görüntüsü kapalıdır — karar SAF politika modülünün,
   bu ekran yalnız uygular ve gerekçeyi GÖSTERİR (sessiz engelleme yasak). */
import type { TrackInfo } from '../../platform/mediaService';
import { pause, play as commandPlay, seek, setRepeat, setShuffle } from '../../platform/media/authority/mediaCommandGateway';
import type { SourceCapabilities } from '../../platform/media/authority/sourceCapabilities';
import { markMusicArtworkReady } from '../../platform/media/musicUiPerf';
import { useListeningProjection, type ListeningProjection } from '../../platform/media/session/sessionProjection';

/* SAFE_MODE subscription — disables heavy backdrop blurs */
function subscribeRuntime(cb: () => void) { return runtimeManager.subscribe(cb); }
function getRuntimeMode() { return runtimeManager.getMode(); }

/* ──────────────────────────────────────────────────────────────────────────
 * YouTube indir butonu — SADECE dev/kişisel build (VITE_ENABLE_YT_DOWNLOAD).
 *
 * YT_DL build-time'da statik sabite indirgenir; release build'de (bayrak yok)
 * `false` olur → buton JSX'i + ytDownloadService dinamik import'u ölü-kod olarak
 * ELENİR (bundle'da indirme kodu bulunmaz). ytDownloadService ASLA statik import
 * edilmez — yalnız tık anında dinamik import. Bkz. docs/FEATURE_FLAGS.md.
 * ────────────────────────────────────────────────────────────────────────── */
const YT_DL = import.meta.env.VITE_ENABLE_YT_DOWNLOAD === 'true';

type YtDlState = 'idle' | 'busy' | 'done' | 'error';

function YtDownloadButton({
  title, artist, variant = 'panel', style,
}: { title: string; artist: string; variant?: 'panel' | 'overlay'; style?: React.CSSProperties }) {
  const [state, setState] = useState<YtDlState>('idle');
  const [pct, setPct] = useState(0);

  // Mount'ta: bu video daha önce indirildi mi? (dinamik import — flag'li yolda)
  useEffect(() => {
    let alive = true;
    void (async () => {
      const vid = getCurrentYouTubeVideoId();
      if (!vid) return;
      const svc = await import('../../platform/media/ytDownloadService');
      if (alive && svc.isDownloaded(vid)) setState('done');
    })();
    return () => { alive = false; };
  }, []);

  const onClick = useCallback(async () => {
    if (state === 'busy' || state === 'done') return;
    const videoId = getCurrentYouTubeVideoId();
    if (!videoId) { setState('error'); return; }
    setState('busy'); setPct(0);
    try {
      const { downloadYouTube } = await import('../../platform/media/ytDownloadService');
      await downloadYouTube({ videoId, title, artist }, (loaded, total) => {
        if (total) setPct(Math.round((loaded / total) * 100));
      });
      setState('done');
    } catch {
      setState('error');
      window.setTimeout(() => setState('idle'), 2500);
    }
  }, [state, title, artist]);

  const color =
    state === 'done'  ? '#22c55e' :
    state === 'error' ? '#ef4444' :
    variant === 'overlay' ? '#fff' : 'var(--oem-ink-2, rgba(240,235,224,0.74))';

  // Video üstü (overlay) varyant: koyu cam zemin (ctrlBtn ile uyumlu); panel varyant: glass-card.
  const overlayStyle: React.CSSProperties = {
    width: 48, height: 48, borderRadius: 9999, border: 'none', color,
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    background: 'rgba(8,10,14,0.5)',
    backdropFilter: 'blur(calc(var(--rt-blur, 1) * 10px))', WebkitBackdropFilter: 'blur(calc(var(--rt-blur, 1) * 10px))',
    WebkitTapHighlightColor: 'transparent', position: 'relative',
  };

  return (
    <button
      onClick={onClick}
      disabled={state === 'busy'}
      aria-label={state === 'done' ? 'İndirildi' : 'Cihaza indir'}
      title={state === 'done' ? 'İndirildi (çevrimdışı çalınabilir)' : state === 'error' ? 'İndirilemedi' : 'Cihaza indir'}
      className={variant === 'overlay'
        ? 'active:scale-90 transition-all'
        : 'w-12 h-12 rounded-2xl flex items-center justify-center glass-card active:scale-90 transition-all relative'}
      style={variant === 'overlay' ? { ...overlayStyle, ...style } : { color, ...style }}
    >
      {state === 'busy'
        ? <><Loader2 className="w-6 h-6 animate-spin" />{pct > 0 && <span className="absolute -bottom-1 text-[9px] font-black tabular-nums">{pct}%</span>}</>
        : state === 'done'
          ? <Check className="w-6 h-6" />
          : <Download className="w-6 h-6" />}
    </button>
  );
}

/* ── AlbumArt — premium 4-layer shadow + texture + specular sweep ── */
// Per screens.jsx 247-277. oklch(56% 0.10 42) base when no cover.
function AlbumArt({ size, src, motionEnabled = true }: {
  size: number; src?: string; motionEnabled?: boolean;
}) {
  return (
    <div style={{
      width: size, height: size,
      borderRadius: Math.max(12, size * 0.10),
      flex: 'none',
      /* Best-of OEM: sakin graphite + hafif amber hint (turuncu oklch kaldırıldı,
         home MusicCard ile tutarlı). */
      background: src
        ? 'var(--oem-surface-0, #0d0d12)'
        : 'radial-gradient(120% 80% at 50% 16%, var(--oem-accent-soft, rgba(224,162,60,0.14)), transparent 58%),' +
          ' linear-gradient(140deg, var(--oem-surface-2, #2b303c) 0%, var(--oem-surface-0, #14171f) 100%)',
      position: 'relative',
      overflow: 'hidden',
      boxShadow:
        '0 1px 0 rgba(255,240,210,0.18) inset,' +
        ' 0 -1px 0 rgba(0,0,0,0.30) inset,' +
        ' 0 12px 32px rgba(0,0,0,0.55),' +
        ' 0 2px 6px rgba(0,0,0,0.30)',
      border: '1px solid rgba(0,0,0,0.3)',
    }}>
      {/* Kapak değişimi CROSSFADE ile yerleşir: sert flash/jump olmaz. Anahtar
          kaynağa bağlıdır, böylece yeni görsel kendi geçişini yapar. */}
      {src && (
        <img
          key={src}
          src={src}
          alt=""
          onLoad={markMusicArtworkReady}
          className="absolute inset-0 w-full h-full object-cover"
          style={motionEnabled
            ? { animation: 'caros-art-in 260ms ease-out both' }
            : undefined}
        />
      )}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 12px, transparent 12px 28px)',
      }} />
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'linear-gradient(135deg, rgba(255,240,210,0.18) 0%, transparent 35%)',
      }} />
      {!src && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ color: 'rgba(255,255,255,0.55)' }}>
          <Music style={{ width: size * 0.32, height: size * 0.32, strokeWidth: 1.2 }} />
        </div>
      )}
    </div>
  );
}

/* ── Kaynak meta ─────────────────────────────────────────── */

const SOURCE_META: Record<MediaSource, { label: string; color: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }> = {
  spotify:       { label: 'Spotify',   color: '#1db954', Icon: Music2    },
  youtube:       { label: 'YouTube',   color: '#ff4444', Icon: Radio     },
  youtube_music: { label: 'YT Music',  color: '#ff0000', Icon: Music2    },
  local:         { label: 'Müzik',     color: '#3b82f6', Icon: Music2    },
  bluetooth:     { label: 'Bluetooth', color: '#8b5cf6', Icon: Bluetooth },
  unknown:       { label: 'Medya',     color: '#64748b', Icon: Radio     },
};

/* ── Bilinen medya kaynakları ────────────────────────────── */

interface KnownSource {
  key:      string;
  name:     string;
  pkg:      string;
  color:    string;
  emoji:    string;
  category: 'streaming' | 'local' | 'bluetooth';
  musicKey?: MusicOptionKey;
}

const KNOWN_SOURCES: KnownSource[] = [
  { key: 'spotify',       name: 'Spotify',       pkg: 'com.spotify.music',                           color: '#1db954', emoji: '🎵', category: 'streaming', musicKey: 'spotify'  },
  { key: 'youtube_music', name: 'YouTube Music', pkg: 'com.google.android.apps.youtube.music',       color: '#ff0000', emoji: '▶️', category: 'streaming', musicKey: 'youtube'  },
  { key: 'poweramp',      name: 'Poweramp',      pkg: 'com.maxmpz.audioplayer',                      color: '#e53935', emoji: '🔊', category: 'local'      },
  { key: 'vlc',           name: 'VLC',           pkg: 'org.videolan.vlc',                            color: '#ff8800', emoji: '📻', category: 'local'      },
  { key: 'soundcloud',    name: 'SoundCloud',    pkg: 'com.soundcloud.android',                      color: '#ff5500', emoji: '🌐', category: 'streaming'  },
  { key: 'amazon',        name: 'Amazon Music',  pkg: 'com.amazon.music',                            color: '#00a8e1', emoji: '📦', category: 'streaming'  },
  { key: 'deezer',        name: 'Deezer',        pkg: 'com.deezer.android.app',                      color: '#a238ff', emoji: '🎧', category: 'streaming'  },
  { key: 'tidal',         name: 'Tidal',         pkg: 'com.tidal.android',                           color: '#00ffff', emoji: '🌊', category: 'streaming'  },
  { key: 'ymusic',        name: 'YMusic',        pkg: 'com.kapp.youtube.music',                      color: '#ff3d3d', emoji: '🎶', category: 'streaming'  },
  { key: 'local_files',   name: 'Yerel Müzik',   pkg: '',                                            color: '#3b82f6', emoji: '📁', category: 'local'      },
  { key: 'bluetooth',     name: 'Bluetooth Ses', pkg: '',                                            color: '#8b5cf6', emoji: '📡', category: 'bluetooth'  },
];

/* ── Tab tipi ─────────────────────────────────────────────── */

type Tab = 'player' | 'search' | 'sources' | 'library' | 'video';

function requestPlayPause(isAudiblyPlaying: boolean): void {
  void (isAudiblyPlaying ? pause(undefined, 'now_playing') : commandPlay(undefined, 'now_playing'));
}

/* ── Ana bileşen ─────────────────────────────────────────── */

interface Props {
  defaultMusic: MusicOptionKey;
  /**
   * F4 · Sürüş dikkat düzeyi. MEVCUT `smartEngine` otoritesinden kabuk aracılığıyla
   * gelir; bu ekran hız okumaz ve yeni bir sürüş-durumu otoritesi KURMAZ.
   * Verilmezse en muhafazakâr değer olan `idle` kullanılır (kısıtlama uygulanmaz).
   */
  drivingMode?: DrivingMode;
}

export const MediaScreen = memo(function MediaScreen({ defaultMusic, ...props }: Props) {
  const [tab, setTab] = useState<Tab>('player');
  // YouTube parçasında video gösterilsin mi (varsayılan: kapak/ses). Buton VEYA sesli
  // komut ("video moduna al") değiştirir → global videoModeStore (UI dışından tetiklenir).
  const videoMode = useSyncExternalStore(subscribeVideoMode, getVideoMode, getVideoMode);
  // Devam ettirilebilir son parça var mı (play tuşunu oturumsuzken de etkinleştirir)
  const [canResume, setCanResume] = useState(false);
  const updateSettings = useStore(s => s.updateSettings);
  const activeMediaSourceKey = useStore(s => s.settings.activeMediaSourceKey) ?? defaultMusic;
  const customSources         = useStore(s => s.settings.customMusicSources);
  const addCustomMusicSource  = useStore(s => s.addCustomMusicSource);
  const removeCustomMusicSource = useStore(s => s.removeCustomMusicSource);

  useEffect(() => {
    startMediaHub();
    // YouTube IFrame oynatıcısını önceden hazırla → ilk çalmada user-gesture kaybolmasın
    void ensureYouTubeReady().catch(() => {});
    // Cihaz müzik listesini önceden yükle → "son parçadan devam" anında hazır olsun
    ensureLocalLoaded();
    // Aktif oturum yoksa son çalınan parçayı göster (play tuşu ondan devam eder)
    previewLastMedia();
    setCanResume(!!getLastMedia());
    // Mevcut aktif kaynak paketini MediaHub'a bildir
    const src = KNOWN_SOURCES.find((s) => s.key === activeMediaSourceKey);
    if (src?.pkg) setMediaPreferredPackage(src.pkg);
    // Drawer açılınca anında poll — 5s beklemesin
    pollMediaNow();
    return () => stopMediaHub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const music = useMusicViewModel();
  const listening = useListeningProjection();
  /* F4 · Sürüş dikkat girdisi MEVCUT otoriteden (smartEngine) prop olarak
     gelir; bu ekran yeni bir sürüş-durumu otoritesi KURMAZ. */
  const drivingMode: DrivingMode = props.drivingMode ?? 'idle';
  /* F11 · Drawer'ın gerçek içerik alanı — `DrawerShell` sabit kenar boşluğu
     (24+24 yatay · 12+24 dikey) + sürükle tutacağı (~31px) çıkarılır. Kesin
     piksel eşleşmesi GEREKMEZ: yerleşim modeli bir eşik sınıflandırmasıdır,
     birkaç pikseli ıskalamak yoğunluğu DEĞİŞTİRMEZ. */
  const screen = useScreenSense();
  const nowPlayingLayout: NowPlayingLayout = useMemo(
    () => computeNowPlayingLayout(screen.width - 48, screen.height - 67, drivingMode),
    [screen.width, screen.height, drivingMode],
  );
  const [queueOpen, setQueueOpen] = useState(false);
  const runtimeModeTop = useSyncExternalStore(subscribeRuntime, getRuntimeMode, getRuntimeMode);
  /* Sakin hareket bütçesi: düşük runtime modunda ve zayıf GPU'da animasyon
     kapanır — hareket kararı tek yerde verilir, bileşenlere dağıtılmaz. */
  const reducedMotion = !getRuntimeConfig(runtimeModeTop).enableBlur || isLowEndDevice();
  const { track, source, hasSession, shuffle, repeat } = music;
  // F1: `PLAYING` only means native audible truth. Unverified transport never
  // renders an optimistic playing surface.
  const playing = music.isAudiblyPlaying;

  const srcMeta     = SOURCE_META[source] ?? SOURCE_META.unknown;
  const displayName = music.sourceLabel || srcMeta.label;

  /* F4 · Now Playing sunum modeli. Hangi kontrolün çizileceği, ilerlemenin
     gösterilebilir olup olmadığı ve sürekliliğin kullanıcı dilindeki karşılığı
     TEK saf hesaptan gelir; bileşen bu kararları dağıtık şekilde vermez. */
  const nowPlaying = useMemo(() => buildNowPlayingPresentation({
    music,
    listening: listening.hasSession ? {
      hasSession: listening.hasSession,
      continuity: listening.continuity,
      queuePosition: listening.queuePosition,
      queueEditable: listening.queueEditable,
      restored: listening.restored,
    } : null,
    drivingMode,
    reducedMotion,
    /* MUSIC F7.3 · üst katman sırası GERÇEKTEN var mı — uydurulmaz, ölçülür.
       Backend timeline'ı olmayan kaynaklarda (YouTube) atlama meşruiyeti
       buradan gelir. */
    upperQueueAvailable: hasQueue(),
  }), [music, listening, drivingMode, reducedMotion]);

  const handleSelectSource = useCallback((src: KnownSource) => {
    updateSettings({
      activeMediaSourceKey: src.key,
      ...(src.musicKey ? { defaultMusic: src.musicKey } : {}),
    });
    // Boş pkg (local_files, bluetooth) → tercih sıfırlanır; her durumda çağrılır.
    setMediaPreferredPackage(src.pkg);
  }, [updateSettings]);

  // Stream (özel internet kaynağı) / YouTube aktif mi — web'de de kontroller açık olsun
  const isStream  = music.sourceClass === 'STREAM';
  const isYouTube = music.sourceClass === 'YOUTUBE';

  // Birleşik çalma — arama sonucu (her kaynak) → katman doğru backend'e yönlendirir.
  // Tüm sonuç listesi kuyruk olarak geçer → sonraki/önceki bu liste üzerinde çalışır.
  const handlePlayResult = useCallback((t: UnifiedTrack, queue: UnifiedTrack[]) => {
    playMedia(t, queue);
    setTab('player');
  }, []);

  /* Büyük oynat tuşu (aktif oturum yokken).
   *
   * MUSIC F8: kullanıcı "çal" dedi — NE çalınacağı sürüş bağlamından
   * gelebilir. F8 adayı YALNIZ `AUTO_RESUME` kararında kullanılır (kanıtlı
   * bağlam + yolculuk başlangıcı + tekrarlanan alışkanlık); her başka
   * durumda davranış DEĞİŞMEZ: son çalınandan devam, o da yoksa native play.
   * Aday uygulanamazsa sessizce eski yola düşülür — sahte başarı yok. */
  const handleBigPlay = useCallback(() => {
    const decision = evaluateMusicIntelligence();
    if (decision.action === 'AUTO_RESUME' && decision.candidate !== null) {
      void applyIntelligenceCandidate(decision.candidate).then((ok) => {
        if (!ok && !resumeLastMedia()) play();
      });
      return;
    }
    if (!resumeLastMedia()) play();
  }, []);

  // Özel kaynağı (Kaynaklar sekmesi) çal — katman üzerinden, harici uygulamaya gitmez
  const handlePlayStream = useCallback((src: CustomMusicSource) => {
    playMedia({ id: `stream-${src.id}`, providerId: 'stream', title: src.name, subtitle: 'İnternet akışı', streamUrl: src.url });
    setTab('player');
  }, []);

  /* ── İçerik ─────────────────────────────────────────────── */
  return (
    <div data-theme-surface="media" data-editable="media.screen" data-editable-type="panel"
      className="h-full flex flex-col overflow-hidden bg-transparent">
      {/* ── Aktif sayfa ─────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'player' && (
          <NowPlayingSurface>
          <PlayerView
            hasSession={hasSession}
            playing={playing}
            track={track}
            source={source}
            srcMeta={srcMeta}
            displayName={displayName}
            shuffle={shuffle}
            repeat={repeat}
            capabilities={music.capabilities}
            isStream={isStream}
            isYouTube={isYouTube}
            canResume={canResume}
            videoMode={videoMode}
            onToggleVideo={() => toggleVideoMode()}
            activeSourceKey={activeMediaSourceKey}
            onTabSources={() => setTab('sources')}
            onPlay={handleBigPlay}
            nowPlaying={nowPlaying}
            layout={nowPlayingLayout}
            alignment={listening.alignment}
            queueOpen={queueOpen}
            onOpenQueue={() => { markQueueInteraction(); setQueueOpen(true); }}
            onCloseQueue={() => setQueueOpen(false)}
          />
          </NowPlayingSurface>
        )}
        {tab === 'search' && (
          /* F5 · Birleşik arama. Kullanıcı "önce kaynak seç" modeline
             zorlanmaz; sağlayıcı sonucu kanonik medya katmanına devredilir,
             yerel sonuç F3 oturum yolundan çalar. */
          <UnifiedSearchView
            onPlayProviderResult={handlePlayResult}
            drivingMode={drivingMode}
            onResume={handleBigPlay}
            onStarted={() => setTab('player')}
          />
        )}
        {tab === 'sources' && (
          <SourcesView
            activeSourceKey={activeMediaSourceKey}
            activeSession={hasSession ? source : null}
            onSelectSource={handleSelectSource}
            customSources={customSources}
            onAddCustomSource={addCustomMusicSource}
            onRemoveCustomSource={removeCustomMusicSource}
            onPlayStream={handlePlayStream}
          />
        )}
        {tab === 'library' && <LocalMusicBrowser drivingMode={drivingMode} />}
        {tab === 'video'   && <LocalVideoBrowser />}
      </div>

      {/* ── Tab bar ─────────────────────────────────────────── */}
      {/* Zemin token tabanlı: tema + güneş moduyla senkron (güneşte beyaz/yüksek kontrast).
          Önceki 'var(--panel-bg-secondary)' geçersiz bir className'di → şerit zeminsiz kalıyordu. */}
      <div
        data-editable="media.tabbar" data-editable-type="dock"
        className="flex-shrink-0 flex border-t rounded-b-[32px] overflow-hidden"
        style={{
          background:           'var(--oem-surface-0, rgba(20,24,32,0.85))',
          borderColor:          'var(--oem-line, rgba(255,255,255,0.10))',
          // --rt-blur=0 (Mali-400 / düşük mod) → 0px → GPU stall yok; aksi halde 12px
          backdropFilter:       'blur(calc(var(--rt-blur, 1) * 12px))',
          WebkitBackdropFilter: 'blur(calc(var(--rt-blur, 1) * 12px))',
        }}
      >
        <TabBtn compact={nowPlayingLayout.tabBarCompact} active={tab === 'player'}  icon={<Music2     className="w-5 h-5" />} label="Çalıyor"   onClick={() => setTab('player')}  />
        <TabBtn compact={nowPlayingLayout.tabBarCompact} active={tab === 'search'}  icon={<Search     className="w-5 h-5" />} label="Ara"       onClick={() => setTab('search')}  />
        <TabBtn compact={nowPlayingLayout.tabBarCompact} active={tab === 'library'} icon={<HardDrive  className="w-5 h-5" />} label="Cihaz"     onClick={() => setTab('library')} />
        <TabBtn compact={nowPlayingLayout.tabBarCompact} active={tab === 'video'}   icon={<Video      className="w-5 h-5" />} label="Video"     onClick={() => setTab('video')}   />
        <TabBtn compact={nowPlayingLayout.tabBarCompact} active={tab === 'sources'} icon={<Layers     className="w-5 h-5" />} label="Kaynaklar" onClick={() => setTab('sources')} />
      </div>
    </div>
  );
});

/* ── Tab buton ───────────────────────────────────────────── */

/**
 * F11 · `compact` YALNIZ küçük/düşük yükseklikli ekranlarda veya sürüşte
 * `true` olur (bkz. `nowPlayingLayoutModel`). Etiket DOM'dan KALKMAZ —
 * `sr-only` ile ekran okuyucuda kalır, yalnız görsel olarak gizlenir; buton
 * yüksekliği `MIN_TOUCH_TARGET_PX`in altına asla İNMEZ.
 */
function TabBtn({
  active, icon, label, onClick, compact = false,
}: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void; compact?: boolean }) {
  return (
    <button
      data-editable="media.tab-button" data-editable-type="dock"
      onClick={onClick}
      aria-label={compact ? label : undefined}
      className={`flex-1 flex flex-col items-center justify-center gap-1.5 transition-all duration-300 ${compact ? 'py-2' : 'py-4'}`}
      style={{
        color: active ? 'var(--oem-accent, #E0A23C)' : 'var(--oem-ink-3, var(--text-dim, rgba(255,255,255,0.5)))',
        minHeight: compact ? 56 : undefined,
      }}
    >
      <div className={active ? 'scale-110 transition-all' : 'transition-all'}
        style={active ? { filter: 'drop-shadow(0 0 8px var(--oem-accent-glow, rgba(224,162,60,0.55)))' } : undefined}>
        {icon}
      </div>
      {/* COMPACT'ta etiket DOM'da kalır (erişilebilirlik) ama görsel olarak
          gizlenir — sürüşte/küçük ekranda gezinme şeridi hafifler. */}
      <span className={compact ? 'sr-only' : 'text-[10px] font-black uppercase tracking-[0.2em] transition-colors'}>
        {label}
      </span>
      {active && <div className="absolute bottom-0 w-12 h-1 rounded-t-full" style={{ background: 'var(--oem-accent, #E0A23C)', boxShadow: '0 0 10px var(--oem-accent-glow, rgba(224,162,60,0.8))' }} />}
    </button>
  );
}

/* ── Player view ──────────────────────────────────────────── */

interface PlayerViewProps {
  hasSession:      boolean;
  playing:         boolean;
  track:           TrackInfo;
  source:          MediaSource;
  srcMeta:         typeof SOURCE_META[MediaSource];
  displayName:     string;
  shuffle:         boolean;
  repeat:          'off' | 'one' | 'all';
  capabilities:    SourceCapabilities | null;
  isStream:        boolean;
  isYouTube:       boolean;
  canResume:       boolean;
  videoMode:       boolean;
  onToggleVideo:   () => void;
  activeSourceKey: string;
  onTabSources:    () => void;
  onPlay:          () => void;
  /** F4 · tek saf sunum kaynağı. */
  nowPlaying:      NowPlayingPresentation;
  /** F11 · ölçülen ekran + sürüş durumundan gelen yerleşim değerleri. */
  layout:          NowPlayingLayout;
  alignment:       ListeningProjection['alignment'];
  queueOpen:       boolean;
  onOpenQueue:     () => void;
  onCloseQueue:    () => void;
}

/**
 * Tam ekran YouTube video kontrol katmanı.
 *
 * Video host'u (#yt-player-host, body'ye bağlı, z-index 2147483000) videoMode'da
 * tüm viewport'u kaplar; bu chrome onun ÜSTÜNE gelir (body portal, z-index
 * 2147483600). Ekrana dokununca kontroller belirir (kapat + önceki/oynat/sonraki +
 * başlık), 3 sn sonra otomatik gizlenir → temiz izleme. Tekrar dokununca geri gelir.
 *
 * Katman düzeni: altta tüm ekranı kaplayan dokunma-yakalayıcı (kontrolleri aç/kapat),
 * üstünde kontroller (container pointer-events:none; boş alana dokunma yakalayıcıya
 * düşer → gizler; butonlar pointer-events:auto → çalışır). Video host pointer-events:
 * none olduğundan oynatma hep API ile yönetilir; YouTube'un kendi kontrolleri kapalı.
 */
function VideoFullscreenChrome({
  title, artist, playing, positionSec, durationSec, onClose,
}: { title: string; artist: string; playing: boolean; positionSec: number; durationSec: number; onClose: () => void }) {
  const [show, setShow] = useState(true);
  const hideTimer = useRef<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShow(false), 3500);
  }, []);

  // İlk açılışta kontroller görünür, 3.5 sn sonra gizlenir.
  useEffect(() => {
    scheduleHide();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [scheduleHide]);

  // Ekrana dokunma → kontrolleri GÖSTER + gizleme sayacını yeniden kur.
  // (Toggle DEĞİL: saha hatası "auto-hide sonrası dokununca geri gelmiyor". Standart
  // video-player davranışı: dokunma her zaman gösterir, gizleme yalnız 3.5s timer'la
  // olur. Ayrıca onPointerDown+onClick ile çift tetiklense de idempotent — güvenli.)
  const onBgTap = useCallback(() => {
    setShow(true);
    scheduleHide();
  }, [scheduleHide]);

  // Bir butona basınca kontroller görünür kalsın + sayacı sıfırla.
  const wake = useCallback(() => { setShow(true); scheduleHide(); }, [scheduleHide]);

  // İlerleme çubuğuna dokunma → konuma atla (YouTube seek).
  const onSeek = useCallback((e: React.PointerEvent) => {
    const el = barRef.current;
    if (!el || durationSec <= 0) return;
    const r = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    seek(frac * durationSec);
    wake();
  }, [durationSec, wake]);

  const progPct = durationSec > 0 ? Math.min(100, (positionSec / durationSec) * 100) : 0;

  // Kontroller gizliyken (show=false) butonlar da tıklanamaz olmalı.
  const ctrlBtn = (size: number): React.CSSProperties => ({
    flexShrink: 0, width: size, height: size, borderRadius: 9999, pointerEvents: show ? 'auto' : 'none', border: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    background: 'rgba(8,10,14,0.5)',
    backdropFilter: 'blur(calc(var(--rt-blur, 1) * 10px))', WebkitBackdropFilter: 'blur(calc(var(--rt-blur, 1) * 10px))',
    color: '#fff', WebkitTapHighlightColor: 'transparent',
  });

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 2147483600 }}>
      {/* Dokunma yakalayıcı — tüm ekran; dokununca kontrolleri gösterir. onClick +
          onPointerDown BİRLİKTE: bazı head unit WebView'lerinde onPointerDown touch'ta
          tetiklenmiyor (butonlar onClick kullandığı için çalışıyordu, yakalayıcı değil →
          "geri gelmiyor" kök nedeni). onClick her yerde çalışır; ikisi birlikte güvenli. */}
      <div onPointerDown={onBgTap} onClick={onBgTap} style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }} />

      {/* HER ZAMAN görünür KAPAT — auto-hide'a TABİ DEĞİL. SAHA (Duster head unit
          2026-07-19): kontroller 3.5s sonra gizlenince "ekrana dokun → reveal" bazı head
          unit WebView'lerinde çalışmıyor → kullanıcı tam ekran videoda KİLİTLİ kalıyor,
          video çalıyor ama çıkamıyor. Çözüm: Kapat asla gizlenmez + pointer-events:auto
          HER ZAMAN → çıkış garanti (dokunma-reveal'e bağımlı değil). Merkez/alt kontroller
          eskisi gibi auto-hide (temiz izleme). */}
      <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 16px)', left: 24, zIndex: 1 }}>
        <button
          onClick={onClose}
          aria-label="Tam ekranı kapat"
          style={{
            ...ctrlBtn(52), pointerEvents: 'auto', width: 'auto', padding: '0 22px', gap: 9, borderRadius: 9999,
            opacity: show ? 1 : 0.72, transition: 'opacity 0.25s ease',
          }}
        >
          <X className="w-6 h-6" />
          <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: '0.02em' }}>Kapat</span>
        </button>
      </div>

      {/* Kontroller — show'a göre fade; container pointer-events:none (boş alan alttaki yakalayıcıya düşer) */}
      <div
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          opacity: show ? 1 : 0, transition: 'opacity 0.25s ease',
        }}
      >
        {/* Üst gradyan + başlık (sol) + indir & kapat (sağ) */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 132,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)',
        }} />
        {/* Başlık satırı — Kapat artık HER ZAMAN görünür ayrı katmanda (yukarıda);
            burada yalnız başlık + indir kaldı. Sol offset kalıcı Kapat'ı geçmesin diye. */}
        <div style={{
          position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 16px)', left: 172, right: 20,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              color: '#fff', fontWeight: 900, fontSize: 22, lineHeight: 1.15,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: '0 2px 8px rgba(0,0,0,0.6)',
            }}>{title || 'YouTube'}</div>
            {artist && (
              <div style={{
                color: 'rgba(255,255,255,0.78)', fontWeight: 700, fontSize: 13, marginTop: 4,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{artist}</div>
            )}
          </div>
          {/* İndir — tam ekranda da görünür (dev/kişisel build) */}
          {YT_DL && (
            <YtDownloadButton title={title} artist={artist} variant="overlay" style={{ pointerEvents: show ? 'auto' : 'none' }} />
          )}
        </div>

        {/* ORTADA büyük kontroller — sürücü kolay erişsin: Önceki / Oynat / Sonraki */}
        <div style={{
          position: 'absolute', top: '50%', left: 0, right: 0, transform: 'translateY(-50%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 44,
        }}>
          <button onClick={() => { queueAwarePrevious('video_fullscreen'); wake(); }} aria-label="Önceki" style={ctrlBtn(76)}>
            <SkipBack className="w-9 h-9" />
          </button>
          <button
            onClick={() => { requestPlayPause(playing); wake(); }}
            aria-label={playing ? 'Duraklat' : 'Çal'}
            style={{ ...ctrlBtn(108), background: 'rgba(255,255,255,0.96)', color: '#0b0d12', boxShadow: '0 10px 34px rgba(0,0,0,0.5)' }}
          >
            {playing ? <Pause className="w-12 h-12" /> : <Play className="w-12 h-12 ml-1" />}
          </button>
          <button onClick={() => { queueAwareNext('video_fullscreen'); wake(); }} aria-label="Sonraki" style={ctrlBtn(76)}>
            <SkipForward className="w-9 h-9" />
          </button>
        </div>

        {/* ALTTA ilerleme çubuğu + süre */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, pointerEvents: 'none',
          padding: '48px 28px calc(env(safe-area-inset-bottom, 0px) + 20px)',
          background: 'linear-gradient(to top, rgba(0,0,0,0.66), transparent)',
        }}>
          {/* Geniş dokunma alanı (py-3) — ince çubuğu kolayca hedeflemek için */}
          <div
            onPointerDown={onSeek}
            style={{ position: 'relative', width: '100%', padding: '12px 0', margin: '-12px 0', touchAction: 'none', pointerEvents: show ? 'auto' : 'none', cursor: 'pointer' }}
          >
            <div ref={barRef} style={{ position: 'relative', width: '100%', height: 5, borderRadius: 9999, background: 'rgba(255,255,255,0.22)', overflow: 'visible' }}>
              <div style={{ position: 'absolute', insetBlock: 0, left: 0, width: `${progPct}%`, borderRadius: 9999, background: '#ff3b3b', boxShadow: '0 0 12px rgba(255,59,59,0.6)' }} />
              {progPct > 0 && progPct < 100 && (
                <div style={{ position: 'absolute', left: `calc(${progPct}% - 7px)`, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, borderRadius: '50%', background: '#fff', boxShadow: '0 0 0 3px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.5)' }} />
              )}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 12, fontWeight: 800, letterSpacing: '0.05em', color: 'rgba(255,255,255,0.75)', fontVariantNumeric: 'tabular-nums' }}>
            <span>{fmtTime(positionSec)}</span>
            <span>{fmtTime(durationSec)}</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PlayerView({
  hasSession, playing, track, srcMeta, displayName,
  shuffle, repeat, isStream, isYouTube, canResume, videoMode, onToggleVideo, onTabSources, onPlay,
  nowPlaying, layout, alignment, queueOpen, onOpenQueue, onCloseQueue,
}: PlayerViewProps) {
  const progress = nowPlaying.progress;
  const controls = nowPlaying.controls;
  /* Kapak F2 ArtworkCache'ten `now-playing` boyutunda gelir; bileşen kendi
     native çözümünü YAPMAZ. Çözülene kadar önceki kapak durur. */
  const artwork = useNowPlayingArtwork(nowPlaying.artworkIdentity);
  const progressRef = useRef<HTMLDivElement>(null);
  const artRef      = useRef<HTMLDivElement>(null);
  /* SAHA BUGFIX (2026-09-03) · ÜRÜN KARARI DEĞİŞTİ: CarOS artık hız/hareket
   * nedeniyle videoyu otomatik engellemez. F7.2'nin `useVideoSafety` kapısı
   * BURADAN kaldırıldı — video görünürlüğü artık YALNIZ kullanıcının açık
   * `videoMode` seçimine bağlıdır. `videoSafetyPolicy`/`useVideoSafety` SİLİNMEDİ:
   * saf sınıflandırma hâlâ mevcuttur (LAB gözlemi + gelecekte ülke/mevzuat
   * gerektirirse opt-in bir politikaya bağlanabilir) ama bugün hiçbir yerde
   * playback/görüntü/ses reddi ÜRETMEZ. */
  /* MUSIC F13 · gerçek favori otoritesinin projeksiyonu — kimlik yoksa
     `available: false`, düğme HİÇ ÇİZİLMEZ (aşağıda kullanılıyor). */
  const favorite = useFavoriteStatus();
  // MUSIC F15 · "Playlist'e ekle" seçici — presentation state, playlist gerçeği DEĞİLDİR.
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  /* MUSIC F16 · Sözler paneli görünürlüğü — `videoModeStore` ile AYNI desen,
     Mavi UI DIŞINDAN `setLyricsPanelVisible` ile açabilir (bkz. F9 router
     `runLyrics`). Panelin KENDİSİ presentation state'tir, lyrics İÇERİĞİ
     `musicLyricsAuthority`dedir (Cross-Domain §14). */
  const lyricsOpen = useSyncExternalStore(subscribeLyricsPanelVisible, getLyricsPanelVisible, getLyricsPanelVisible);

  // YouTube video konumlandırma:
  //  • videoMode KAPALI → host gizli (kapak/ses gösterilir).
  //  • videoMode AÇIK   → host TAM EKRAN (tüm viewport). Küçük kapak alanı yerine
  //    sürücünün gerçekten izleyebileceği tam ekran video. Üstüne kapat/oynat
  //    kontrolleri VideoFullscreenChrome (body portal, host'tan üst z-index) gelir.
  useEffect(() => {
    if (!isYouTube) return;
    /* Video görünürlüğü YALNIZ kullanıcının `videoMode` seçimine bağlıdır —
       hareket/hız bunu REDDEDEMEZ (ürün kararı, 2026-09-03). */
    if (!videoMode) {
      // Kapak modu — host gizli (rAF gerekmez). Albüm kapağını React gösterir.
      // Ses-only: harita normal (navigasyon akıcılığı korunur) → komşu kilidi kapalı.
      setYouTubeRegion(null);
      setMapHeavyNeighbor(false);
      return;
    }
    // Tam ekran — viewport'u kapla. Resize'da (nadiren) güncelle.
    const applyFullscreen = () =>
      setYouTubeRegion({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }, true);
    applyFullscreen();
    // Tam ekran video harita üstünü tamamen kaplar → harita arkada boşuna WebGL
    // render etmesin: raster'a kilitle (video decode + vektör harita Mali-400'de
    // çakışmasın). Kapanışta düşük-uç HARİÇ kilit açılır (düşük-uç zaten kalıcı raster).
    setMapHeavyNeighbor(true);
    window.addEventListener('resize', applyFullscreen);
    return () => {
      window.removeEventListener('resize', applyFullscreen);
      setYouTubeRegion(null);
      setMapHeavyNeighbor(false);
    };
  }, [isYouTube, videoMode]);

  /* Konum değiştirme YALNIZ kaynak gerçekten destekliyorsa bağlanır. Sürüşte
     dokunma hedefi büyütülür (aşağıdaki dolgu); yanlış dokunma riski azalır. */
  const handleSeek = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = progressRef.current;
    if (!el || !progress?.seekable) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seek(frac * progress.durationSec);
  }, [progress]);

  // Ağır blur GPU koruması (CLAUDE.md §3): enableBlur=false olan TÜM düşük modlarda
  // (BASIC_JS / POWER_SAVE / SAFE_MODE — yani Mali-400 sınıfı GPU'lar) kapat.
  // Önceden yalnızca SAFE_MODE kontrol ediliyordu; BASIC_JS'de blur(64px) açık
  // kalıp head unit'i kilitliyordu.
  const runtimeMode = useSyncExternalStore(subscribeRuntime, getRuntimeMode, getRuntimeMode);
  // Düşük runtime modu VEYA head-unit/compat (zayıf GPU): ağır filter:blur'u kapat.
  // filter:blur backdrop kill CSS'ine takılmaz (o yalnızca backdrop-filter), bu yüzden
  // burada ayrıca gate edilir.
  const blurOff = !getRuntimeConfig(runtimeMode).enableBlur || isLowEndDevice();

  // Oturum yoksa bile çalma ekranı düzeni gösterilir (placeholder kapak + başlık).
  // Boş "kaynak bulunamadı" durumu kaldırıldı — büyük oynat butonu arka planda çalmayı başlatır.
  return (
    <div data-editable="media.player" data-editable-type="panel"
      className="relative h-full flex flex-col overflow-hidden bg-transparent">

      {/* Tam ekran video kontrol katmanı — video host'u (body, tam ekran) üstüne biner */}
      {isYouTube && videoMode && (
        <VideoFullscreenChrome
          title={track.title}
          artist={track.artist}
          playing={playing}
          positionSec={track.positionSec}
          durationSec={track.durationSec}
          onClose={onToggleVideo}
        />
      )}


      {/* Ambient backdrop — heavily blurred, low-opacity album art fills entire view */}
      <div className="absolute inset-0 pointer-events-none z-0">
        {artwork.url ? (
          <div
            key={artwork.url}
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${artwork.url})`,
              backgroundSize:     'cover',
              backgroundPosition: 'center',
              /* Kapak rengi zemine SINIRLI sızar (bounded): üstteki vignette ile
                 birlikte metin kontrastı her kapakta korunur. Kapak rengi UI
                 renk otoritesine DÖNÜŞTÜRÜLMEZ. */
              opacity:            0.30,
              // Düşük mod (Mali-400 vb.): 0px blur → GPU korunur; aksi halde ≈ 64px
              filter:             blurOff ? 'none' : 'blur(64px)',
              transform:          'scale(1.5)',
              transition:         nowPlaying.motionEnabled ? 'opacity 0.6s ease' : 'none',
            }}
          />
        ) : (
          <div className="absolute inset-0 opacity-30"
            style={{ background: `radial-gradient(circle at center, ${srcMeta.color}, transparent 80%)` }}
          />
        )}
        {/* Vignette tint */}
        <div className="absolute inset-0"
          style={{ background: 'radial-gradient(80% 60% at 50% 50%, transparent 30%, color-mix(in srgb, var(--oem-bg, #14171F) 72%, transparent) 100%)' }}
        />
      </div>

      <div className="relative z-10 flex-1 flex flex-col px-8 pt-6 pb-4 min-h-0">

        {/* Üst: kaynak badge + ayar/kaynak kısayolu */}
        <div className="flex items-center justify-between flex-shrink-0"
          style={{ marginBottom: layout.sectionGapPx }}>
          <div data-editable="media.source-badge" data-editable-type="card"
            className="flex items-center gap-2.5 px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] glass-card"
            style={{ color: srcMeta.color, borderColor: `${srcMeta.color}40` }}>
            <srcMeta.Icon className="w-4 h-4" />
            {displayName}
            {playing && (
              <span aria-hidden
                className={`w-2 h-2 rounded-full ml-0.5 shadow-[0_0_8px_currentColor]${nowPlaying.motionEnabled ? ' animate-pulse' : ''}`}
                style={{ backgroundColor: srcMeta.color }} />
            )}
          </div>
          {/* Komut kabul edildi ama ses kanıtı YOK — sakin, dürüst ipucu.
              "Çalıyor" İDDİA EDİLMEZ (F0 playbackTruth sözleşmesi). */}
          {nowPlaying.awaitingConfirmation && (
            <span data-music-awaiting="true" className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>
              Başlatılıyor
            </span>
          )}
          {/* Kaynak/ayar kısayolu → Kaynaklar sekmesi */}
          <button
            onClick={onTabSources}
            aria-label="Kaynak ayarları"
            className="flex-shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center glass-card active:scale-90 transition-all"
            style={{ color: 'var(--oem-ink-2)' }}>
            <SlidersHorizontal className="w-5 h-5" />
          </button>
        </div>

        {/* Albüm kapağı — premium AlbumArt with texture + specular + 4-layer shadow.
            F11: kenar ÖLÇÜLEN genişlik+yükseklik bütçesinden gelir (yalnız
            genişliğe göre ölçeklenen eski `min(280px,70vw)` düşük ekranlarda
            kendi hücresinden TAŞIYORDU — bkz. nowPlayingLayoutModel başlığı). */}
        <div className="flex-1 flex items-center justify-center min-h-0 py-4">
          <div ref={artRef} data-editable="media.album-art" data-editable-type="card"
            className="relative group" style={{ width: layout.artworkPx, aspectRatio: '1 / 1' }}>
            <AlbumArt size={layout.artworkPx} src={artwork.url ?? undefined}
              motionEnabled={nowPlaying.motionEnabled} />
            {/* F11: sonsuz döngüde nabız atan (animate-pulse) bulanık kapak
                halesi KALDIRILDI — bilgi taşımayan salt süs animasyondu, GPU
                maliyeti vardı (blur+pulse üst üste) ve "oyuncak" okunuyordu.
                Kompozisyonun kalitesi artık kapağın kendisinden (doku +
                specular + 4 katman gölge, bkz. AlbumArt) ve arka plan
                projeksiyonundan (üstteki ambient backdrop) geliyor. */}
          </div>
        </div>

        {/* Şarkı bilgisi + ikincil eylemler (yalnız gerçekten çalışanlar) */}
        <div data-editable="media.track-info" data-editable-type="card"
          className="flex-shrink-0 flex items-center justify-between px-1"
          style={{ marginTop: layout.sectionGapPx, marginBottom: layout.sectionGapPx * 0.8 }}>
          <div className="flex-1 min-w-0 pr-4">
            <div className="font-black leading-tight truncate tracking-tight drop-shadow-md"
              style={{ color: 'var(--oem-ink)', fontSize: layout.titleFontPx }}>
              {track.title || (hasSession ? 'Bilinmeyen parça' : 'Müzik başlat')}
            </div>
            <div className="font-bold truncate mt-1 tracking-wide uppercase opacity-80"
              style={{ color: 'var(--oem-ink-2)', fontSize: layout.artistFontPx }}>
              {track.artist || (hasSession ? 'Sanatçı bilinmiyor' : 'Oynat\'a dokun')}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isYouTube && (
              <button
                onClick={onToggleVideo}
                aria-label={videoMode ? 'Kapağa dön' : 'Videoyu göster'}
                className="w-12 h-12 rounded-2xl flex items-center justify-center glass-card active:scale-90 transition-all"
                style={videoMode
                  ? { color: '#ff4444', borderColor: 'rgba(255,68,68,0.5)', boxShadow: '0 0 16px rgba(255,68,68,0.35)' }
                  : { color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
                <Video className="w-6 h-6" />
              </button>
            )}
            {/* İndir — yalnız dev/kişisel build (YT_DL) + YouTube oynatılırken.
                Release build'de YT_DL statik false → bu blok elenir. */}
            {YT_DL && isYouTube && (
              <YtDownloadButton title={track.title} artist={track.artist} />
            )}
            {/* MUSIC F13 · gerçek favori otoritesi (musicCollectionAuthority)
                ile geri geldi. F11'de KALDIRILAN onClick'siz süs düğmenin
                yerini alır — burada artık GERÇEK state var: kimlik kanıtsızsa
                (`favorite.available === false`) düğme HİÇ ÇİZİLMEZ; iyimser
                sahte state YOK, `toggle()` senkron doğrulanmış sonucu
                yansıtır. */}
            {favorite.available && (
              <button
                onClick={() => { favorite.toggle(); }}
                aria-label={favorite.isFavorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                aria-pressed={favorite.isFavorite}
                data-music-favorite-toggle="true"
                className="w-12 h-12 rounded-2xl flex items-center justify-center glass-card active:scale-90 transition-all"
                style={favorite.isFavorite
                  ? { color: 'var(--oem-amber, oklch(80% 0.13 60))', borderColor: 'var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))' }
                  : { color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
                <Heart className="w-6 h-6" fill={favorite.isFavorite ? 'currentColor' : 'none'} />
              </button>
            )}
            {/* MUSIC F15 · "Playlist'e ekle" — heart düğmesiyle AYNI kimlik
                kapısını (`favorite.available`) KULLANIR (F13'ün favori
                DEĞİL, yalnız "çözülebilir bir mevcut öğe var mı" sinyalini
                paylaşır — iki otorite BİRBİRİNE karışmaz). */}
            {favorite.available && (
              <button
                onClick={() => setAddToPlaylistOpen(true)}
                aria-label="Playlist'e ekle"
                data-music-add-to-playlist="true"
                className="w-12 h-12 rounded-2xl flex items-center justify-center glass-card active:scale-90 transition-all"
                style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
                <ListMusic className="w-6 h-6" />
              </button>
            )}
            {/* MUSIC F16 · "Sözler" — heart/playlist düğmeleriyle AYNI kimlik
                kapısını (`favorite.available`) KULLANIR (yalnız "çözülebilir
                bir mevcut öğe var mı" sinyali paylaşılır, lyrics İÇERİĞİ
                otoritesi F13/F15'ten TAMAMEN AYRIDIR). */}
            {favorite.available && (
              <button
                onClick={() => setLyricsPanelVisible(!lyricsOpen)}
                aria-label={lyricsOpen ? 'Sözleri kapat' : 'Sözleri göster'}
                aria-pressed={lyricsOpen}
                data-music-lyrics-toggle="true"
                className="w-12 h-12 rounded-2xl flex items-center justify-center glass-card active:scale-90 transition-all"
                style={lyricsOpen
                  ? { color: 'var(--oem-amber, oklch(80% 0.13 60))', borderColor: 'var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))' }
                  : { color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
                <Captions className="w-6 h-6" />
              </button>
            )}
          </div>
        </div>

        <AddToPlaylistSheet open={addToPlaylistOpen} onClose={() => setAddToPlaylistOpen(false)} />
        <LyricsPanel
          open={lyricsOpen}
          onClose={() => setLyricsPanelVisible(false)}
          drivingMode={nowPlaying.drivingMode}
          positionSec={progress?.positionSec ?? 0}
        />

        {/* İlerleme — YALNIZ kaynak konum+süre bildirebiliyorsa çizilir.
            Süre yoksa sahte "0:00", sahte slider ve sahte yüzde ÜRETİLMEZ:
            boşluk, yanlış bilgiden iyidir. */}
        {progress && (
        <div data-editable="media.progress" data-editable-type="card"
          data-music-progress="true" className="flex-shrink-0 px-1"
          style={{ marginBottom: layout.sectionGapPx }}>
          {/* Geniş dokunma alanı — 3px çubuğu sürüşte de hedeflemek için */}
          <div className="relative w-full py-3 -my-3"
            style={{ touchAction: 'none', cursor: progress.seekable ? 'pointer' : 'default' }}
            onPointerDown={progress.seekable ? handleSeek : undefined}
            role={progress.seekable ? 'slider' : 'progressbar'}
            aria-label="Parça konumu"
            aria-valuemin={0}
            aria-valuemax={Math.round(progress.durationSec)}
            aria-valuenow={Math.round(progress.positionSec)}
            aria-valuetext={`${progress.positionLabel} / ${progress.durationLabel}`}
            tabIndex={progress.seekable ? 0 : -1}>
          <div ref={progressRef}
            className="relative w-full rounded-full overflow-visible"
            style={{
              height: 3,
              background: 'var(--oem-line-strong, rgba(255,240,210,0.18))',
              boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.35)',
            }}>
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${progress.percent}%`,
                background: 'linear-gradient(90deg, oklch(72% 0.11 55), oklch(86% 0.10 70))',
                boxShadow: '0 0 14px var(--oem-amber-glow, rgba(255,200,120,0.45))',
                /* Sakin hareket: düşük performans/sürüşte geçiş animasyonu kapanır. */
                transition: nowPlaying.motionEnabled ? 'width 700ms ease-out' : 'none',
              }}
            />
            {progress.percent > 0 && progress.percent < 100 && (
              <div
                aria-hidden
                className="absolute pointer-events-none"
                style={{
                  left: `calc(${progress.percent}% - 6px)`,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 12, height: 12, borderRadius: '50%',
                  background: 'oklch(92% 0.05 90)',
                  boxShadow:
                    '0 0 0 2px rgba(0,0,0,0.35),' +
                    ' 0 0 18px var(--oem-amber-glow, oklch(80% 0.13 60 / 0.55)),' +
                    ' 0 2px 6px rgba(0,0,0,0.45)',
                }}
              />
            )}
          </div>
          </div>
          <div className="flex justify-between text-[11px] mt-2.5 font-black uppercase tracking-widest tabular-nums"
            style={{ color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>
            <span>{progress.positionLabel}</span>
            <span>{progress.durationLabel}</span>
          </div>
        </div>
        )}

        {/* Kontrol butonları — cinematic premium.
            F11: çap ÖLÇÜLEN yerleşimden gelir; hiçbir yoğunlukta
            MIN_TOUCH_TARGET_PX (48) altına İNMEZ (bkz. nowPlayingLayoutModel). */}
        <div data-editable="media.transport" data-editable-type="card"
          className="flex-shrink-0 flex items-center justify-between"
          style={{ marginBottom: layout.sectionGapPx * 0.8 }}>
          {/* Shuffle — glass ghost */}
          {controls.shuffle && <button onClick={() => void setShuffle(!shuffle)} disabled={!isNative}
            aria-label="Karıştır"
            className="rounded-full flex items-center justify-center active:scale-90 transition-all disabled:opacity-30"
            style={shuffle
              ? {
                  width: layout.transportTertiaryPx, height: layout.transportTertiaryPx,
                  background: 'transparent',
                  border: '1px solid var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))',
                  color: 'var(--oem-amber, oklch(80% 0.13 60))',
                  boxShadow: '0 0 18px var(--oem-amber-glow, transparent), inset 0 1px 0 rgba(255,240,210,0.06)',
                }
              : {
                  width: layout.transportTertiaryPx, height: layout.transportTertiaryPx,
                  background: 'transparent',
                  border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
                  color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
                  boxShadow: 'inset 0 1px 0 rgba(255,240,210,0.04)',
                }}>
            <Shuffle className="w-5 h-5" />
          </button>}

          {/* Prev — glass ghost (larger) */}
          {controls.previous && <button onClick={() => { queueAwarePrevious('now_playing'); }} disabled={!isNative && !isStream && !isYouTube}
            aria-label="Önceki"
            className="rounded-full flex items-center justify-center active:scale-90 transition-all disabled:opacity-30"
            style={{
              width: layout.transportSecondaryPx, height: layout.transportSecondaryPx,
              background: 'transparent',
              border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
              color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
              boxShadow: 'inset 0 1px 0 rgba(255,240,210,0.06)',
            }}>
            <SkipBack className="w-7 h-7" />
          </button>}

          {/* Premium Play Button — cinematic amber gradient + heavy shadows.
              Oturum yokken oynat → arka planda çalmayı başlatır (uygulamayı öne almaz).
              Stream (özel kaynak) web'de de kontrol edilebilir. */}
          <button onClick={hasSession ? () => requestPlayPause(playing) : onPlay} disabled={!isNative && !isStream && !isYouTube && !canResume}
            aria-label={playing ? 'Duraklat' : 'Çal'}
            className="rounded-full flex items-center justify-center active:scale-95 transition-all relative disabled:opacity-40"
            style={{
              width: layout.transportPrimaryPx, height: layout.transportPrimaryPx,
              background: 'linear-gradient(180deg, oklch(96% 0.02 80), oklch(78% 0.04 60))',
              color: '#0a0a0a',
              border: '1px solid oklch(78% 0.04 60)',
              boxShadow:
                '0 1px 0 rgba(255,255,255,0.55) inset,' +
                ' 0 -1px 0 rgba(0,0,0,0.15) inset,' +
                ' 0 10px 28px rgba(0,0,0,0.50),' +
                ' 0 0 36px var(--oem-amber-glow, oklch(80% 0.05 60 / 0.18))',
            }}>
            {playing
              ? <Pause className="w-9 h-9" style={{ color: '#0a0a0a', fill: '#0a0a0a' }} />
              : <Play  className="w-9 h-9 ml-1" style={{ color: '#0a0a0a', fill: '#0a0a0a' }} />
            }
          </button>

          {/* Next — glass ghost (larger) */}
          {controls.next && <button onClick={() => { queueAwareNext('now_playing'); }} disabled={!isNative && !isStream && !isYouTube}
            aria-label="Sonraki"
            className="rounded-full flex items-center justify-center active:scale-90 transition-all disabled:opacity-30"
            style={{
              width: layout.transportSecondaryPx, height: layout.transportSecondaryPx,
              background: 'transparent',
              border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
              color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
              boxShadow: 'inset 0 1px 0 rgba(255,240,210,0.06)',
            }}>
            <SkipForward className="w-7 h-7" />
          </button>}

          {/* Repeat — glass ghost */}
          {controls.repeat && <button onClick={() => void setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')} disabled={!isNative}
            aria-label="Tekrarla"
            className="rounded-full flex items-center justify-center active:scale-90 transition-all disabled:opacity-30"
            style={repeat !== 'off'
              ? {
                  width: layout.transportTertiaryPx, height: layout.transportTertiaryPx,
                  background: 'transparent',
                  border: '1px solid var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))',
                  color: 'var(--oem-amber, oklch(80% 0.13 60))',
                  boxShadow: '0 0 18px var(--oem-amber-glow, transparent), inset 0 1px 0 rgba(255,240,210,0.06)',
                }
              : {
                  width: layout.transportTertiaryPx, height: layout.transportTertiaryPx,
                  background: 'transparent',
                  border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
                  color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
                  boxShadow: 'inset 0 1px 0 rgba(255,240,210,0.04)',
                }}>
            {repeat === 'one' ? <Repeat1 className="w-5 h-5" /> : <Repeat className="w-5 h-5" />}
          </button>}
        </div>

        {/* F4 · Bağlam şeridi. Teknik durum adları (CARRIED · PROVIDER_DRIFT)
            kullanıcıya GÖSTERİLMEZ — onlar CAROS LAB'a aittir; burada yalnız
            insan dilinde tek satır ve kuyruğa TEK dokunuşluk geçiş vardır. */}
        {(nowPlaying.canOpenQueue || nowPlaying.continuity.visible) && (
          <div className="flex-shrink-0 mt-1 flex items-center gap-3">
            {nowPlaying.canOpenQueue && (
              <button
                type="button"
                onClick={onOpenQueue}
                data-music-open-queue="true"
                aria-label={`Sırayı aç — ${nowPlaying.queueSummary ?? ''}`}
                className="flex flex-1 items-center gap-3 rounded-2xl border-0 px-4 text-left"
                style={{
                  minHeight: 56,
                  background: 'rgba(255,255,255,0.035)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}>
                <ListMusic aria-hidden className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--oem-ink-2)' }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold" style={{ color: 'var(--oem-ink)' }}>Sırada</span>
                  {nowPlaying.continuity.visible && (
                    <span className="block truncate text-xs" style={{ color: 'var(--oem-ink-2)' }}>
                      {nowPlaying.continuity.message}
                    </span>
                  )}
                </span>
                <span className="flex-shrink-0 text-xs font-black tabular-nums"
                  style={{ color: 'var(--oem-ink-3)' }}>
                  {nowPlaying.queueSummary}
                </span>
              </button>
            )}
            {!nowPlaying.canOpenQueue && nowPlaying.continuity.visible && (
              <p data-music-continuity="true" className="flex-1 truncate text-xs px-1"
                style={{ color: nowPlaying.continuity.tone === 'WARN' ? 'var(--oem-warn, #e0a23c)' : 'var(--oem-ink-2)' }}>
                {nowPlaying.continuity.message}
              </p>
            )}
          </div>
        )}

      </div>

      {/* F4 · Kuyruk yüzeyi — Now Playing'in ÜSTÜNE gelir; durum yeniden kurulmaz. */}
      <QueuePanel
        open={queueOpen}
        onClose={onCloseQueue}
        alignment={alignment}
        sourceLabel={displayName}
        drivingMode={nowPlaying.drivingMode}
        motionEnabled={nowPlaying.motionEnabled}
      />
    </div>
  );
}

/* ── Kaynaklar view ───────────────────────────────────────── */

interface SourcesViewProps {
  activeSourceKey:  string;
  activeSession:    MediaSource | null;
  onSelectSource:   (src: KnownSource) => void;
  customSources:    CustomMusicSource[];
  onAddCustomSource:    (src: CustomMusicSource) => void;
  onRemoveCustomSource: (id: string) => void;
  onPlayStream:     (src: CustomMusicSource) => void;
}

const CATEGORY_LABELS = {
  streaming:  'Yayın Servisleri',
  local:      'Yerel & Offline',
  bluetooth:  'Bağlantı',
};

const SOURCE_COLOR_PALETTE = ['#22d3ee', '#f59e0b', '#a855f7', '#34d399', '#fb7185', '#60a5fa'];

function SourcesView({
  activeSourceKey, activeSession, onSelectSource,
  customSources, onAddCustomSource, onRemoveCustomSource, onPlayStream,
}: SourcesViewProps) {
  const groups = (['streaming', 'local', 'bluetooth'] as const).map((cat) => ({
    cat,
    label: CATEGORY_LABELS[cat],
    sources: KNOWN_SOURCES.filter((s) => s.category === cat),
  })).filter((g) => g.sources.length > 0);

  return (
    <div data-editable="media.sources-page" data-editable-type="panel"
      className="h-full overflow-y-auto scrollbar-none px-5 pt-5 pb-3">
      <div className="mb-5">
        <div className="font-black text-base tracking-tight" style={{ color: 'var(--oem-ink)' }}>Medya Kaynakları</div>
        <div className="text-xs mt-0.5 font-bold uppercase tracking-wider" style={{ color: 'var(--oem-ink-2)' }}>Tercih ettiğiniz uygulamayı seçin</div>
      </div>

      {/* ── Özel kaynaklar (kullanıcı eklemeli internet akışı / radyo) ── */}
      <CustomSourcesSection
        customSources={customSources}
        onAddCustomSource={onAddCustomSource}
        onRemoveCustomSource={onRemoveCustomSource}
        onPlayStream={onPlayStream}
      />

      {groups.map(({ cat, label, sources }) => (
        <div key={cat} className="mb-6">
          <div className="text-[10px] font-black uppercase tracking-[0.25em] mb-3 px-1" style={{ color: 'var(--oem-ink-3)' }}>{label}</div>
          <div className="flex flex-col gap-2">
            {sources.map((src) => {
              const isActive    = src.key === activeSourceKey;
              const isPlaying   = activeSession && (
                (src.key === 'spotify'       && activeSession === 'spotify')       ||
                (src.key === 'youtube_music' && activeSession === 'youtube_music') ||
                (src.key === 'bluetooth'     && activeSession === 'bluetooth')     ||
                (src.key === 'local_files'   && activeSession === 'local')
              );
              return (
                <button
                  key={src.key}
                  onClick={() => { onSelectSource(src); }}
                  data-editable="media.source-card" data-editable-type="card"
                  className="flex items-center gap-4 p-4 rounded-2xl glass-card text-left transition-all active:scale-[0.98] group"
                  style={{
                    backgroundColor: isActive ? `${src.color}20` : 'rgba(255,255,255,0.03)',
                    borderColor:     isActive ? `${src.color}50` : 'rgba(255,255,255,0.08)',
                  }}
                >
                  {/* Emoji/ikon */}
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl transition-transform duration-500 group-hover:scale-110"
                    style={{ background: isActive ? `${src.color}30` : 'rgba(255,255,255,0.05)' }}>
                    {src.emoji}
                  </div>

                  {/* İsim + durum */}
                  <div className="flex-1 min-w-0">
                    <div className="font-black text-sm tracking-tight" style={{ color: isActive ? 'var(--oem-ink)' : 'var(--oem-ink-2)' }}>
                      {src.name}
                    </div>
                    {isPlaying && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="w-2 h-2 rounded-full animate-pulse shadow-[0_0_8px_currentColor]" style={{ backgroundColor: src.color }} />
                        <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: src.color }}>Çalıyor</span>
                      </div>
                    )}
                  </div>

                  {/* Aktif işareti */}
                  {isActive ? (
                    <div className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center shadow-lg"
                      style={{ background: src.color, boxShadow: `0 0 15px ${src.color}60` }}>
                      <Check className="w-5 h-5" style={{ color: 'var(--oem-accent-ink, #fff)' }} />
                    </div>
                  ) : (
                    <ChevronRight className="w-5 h-5 transition-colors" style={{ color: 'var(--oem-ink-3)' }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <p className="text-[10px] font-bold text-center leading-relaxed pb-6 uppercase tracking-widest" style={{ color: 'var(--oem-ink-3)' }}>
        Uygulama arka planda çalışırken kontroller aktif olur.
      </p>
    </div>
  );
}

/* ── Özel kaynaklar bölümü (Kaynak Ekle) ─────────────────── */

interface CustomSourcesSectionProps {
  customSources:        CustomMusicSource[];
  onAddCustomSource:    (src: CustomMusicSource) => void;
  onRemoveCustomSource: (id: string) => void;
  onPlayStream:         (src: CustomMusicSource) => void;
}

function CustomSourcesSection({
  customSources, onAddCustomSource, onRemoveCustomSource, onPlayStream,
}: CustomSourcesSectionProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName]     = useState('');
  const [url, setUrl]       = useState('');

  const canSave = name.trim().length > 0 && /^https?:\/\//i.test(url.trim());

  const handleSave = () => {
    if (!canSave) return;
    const id = (globalThis.crypto?.randomUUID?.() ?? `src-${Date.now()}`);
    onAddCustomSource({
      id,
      name:    name.trim(),
      kind:    'stream',
      url:     url.trim(),
      color:   SOURCE_COLOR_PALETTE[customSources.length % SOURCE_COLOR_PALETTE.length],
      addedAt: Date.now(),
    });
    setName(''); setUrl(''); setAdding(false);
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="text-[10px] font-black uppercase tracking-[0.25em]" style={{ color: 'var(--oem-ink-3)' }}>Eklenen Kaynaklar</div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-card text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all"
          style={{ color: 'var(--oem-info, #60a5fa)' }}>
          {adding ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {adding ? 'İptal' : 'Kaynak Ekle'}
        </button>
      </div>

      {/* Ekleme formu */}
      {adding && (
        <div className="flex flex-col gap-2 mb-3 p-4 rounded-2xl glass-card">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Kaynak adı (örn. Radyo Fenomen)"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-colors"
            style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)', color: 'var(--oem-ink)' }}
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Akış URL'si (https://... .mp3 / .m3u8 / radyo)"
            inputMode="url"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-colors"
            style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)', color: 'var(--oem-ink)' }}
          />
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="mt-1 px-4 py-2.5 rounded-xl font-black text-sm uppercase tracking-widest transition-all active:scale-95 disabled:opacity-30"
            style={{ background: 'rgba(59,130,246,0.22)', border: '1.5px solid rgba(59,130,246,0.55)', color: '#60a5fa' }}>
            Ekle
          </button>
          <div className="text-[10px] leading-relaxed opacity-70" style={{ color: 'var(--oem-ink-2)' }}>
            Doğrudan ses akışı / internet radyosu URL'si. Uygulama içinde çalar, harici uygulamaya gidilmez.
          </div>
        </div>
      )}

      {/* Liste */}
      {customSources.length === 0 ? (
        !adding && (
          <div className="text-xs px-1 opacity-60" style={{ color: 'var(--oem-ink-2)' }}>Henüz kaynak yok. "Kaynak Ekle" ile internet radyosu/akış ekleyin.</div>
        )
      ) : (
        <div className="flex flex-col gap-2">
          {customSources.map((src) => (
            <div key={src.id}
              className="flex items-center gap-4 p-4 rounded-2xl glass-card group"
              style={{ backgroundColor: `${src.color}14`, borderColor: `${src.color}40` }}>
              <button
                onClick={() => onPlayStream(src)}
                className="flex items-center gap-4 flex-1 min-w-0 text-left active:scale-[0.98] transition-all">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${src.color}30`, color: src.color }}>
                  <Globe className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-black text-sm tracking-tight truncate" style={{ color: 'var(--oem-ink)' }}>{src.name}</div>
                  <div className="text-[10px] font-bold uppercase tracking-widest truncate" style={{ color: 'var(--oem-ink-2)' }}>İnternet akışı</div>
                </div>
                <Play className="w-5 h-5 flex-shrink-0" style={{ color: src.color }} />
              </button>
              <button
                onClick={() => onRemoveCustomSource(src.id)}
                aria-label="Kaynağı sil"
                className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center active:scale-90 transition-all"
                style={{ color: 'var(--oem-ink-3)' }}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
