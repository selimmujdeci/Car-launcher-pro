/**
 * Premium Media Hub — araç içi medya merkezi.
 *
 * Tab: NOW PLAYING — büyük albüm kapağı, kontroller, progress, shuffle/repeat
 * Tab: KAYNAKLAR   — bilinen medya uygulamaları listesi, aktif kaynak seçimi
 *
 * Native: Android MediaSession üzerinden harici uygulama kontrolü
 * Web/Demo: mock track rotasyonu
 */
import { memo, useEffect, useCallback, useState, useRef, useSyncExternalStore } from 'react';
import {
  SkipBack, SkipForward, Play, Pause,
  Music2, Music, Bluetooth, Radio, Shuffle, Repeat, Repeat1,
  Heart, Layers, Check, ChevronRight, HardDrive, SlidersHorizontal,
  Search, Plus, Trash2, Globe, X, Video,
} from 'lucide-react';
import { LocalMusicBrowser } from './LocalMusicBrowser';
import { LocalVideoBrowser } from './LocalVideoBrowser';
import {
  useMediaState, togglePlayPause, next, previous, seek,
  fmtTime, startMediaHub, stopMediaHub, toggleShuffle, cycleRepeat,
  setMediaPreferredPackage, pollMediaNow, play,
  searchMedia, playMedia, ensureLocalLoaded,
  resumeLastMedia, previewLastMedia, getLastMedia,
  isSpotifyConnected, beginSpotifyLogin,
  PROVIDER_META, WORLDWIDE_SOURCES_ENABLED,
  ensureYouTubeReady, setYouTubeRegion, YOUTUBE_PKG,
  type UnifiedTrack, type ProviderId,
  type MediaSource,
} from '../../platform/media/carosMediaLayer';
import { STREAM_PKG } from '../../platform/streamMusicService';
import { isNative } from '../../platform/bridge';
import { useStore } from '../../store/useStore';
import type { CustomMusicSource } from '../../store/useStore';
import type { MusicOptionKey } from '../../data/apps';
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../../core/runtime/runtimeTypes';

/* SAFE_MODE subscription — disables heavy backdrop blurs */
function subscribeRuntime(cb: () => void) { return runtimeManager.subscribe(cb); }
function getRuntimeMode() { return runtimeManager.getMode(); }

/* ── AlbumArt — premium 4-layer shadow + texture + specular sweep ── */
// Per screens.jsx 247-277. oklch(56% 0.10 42) base when no cover.
function AlbumArt({ size, src }: { size: number; src?: string }) {
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
      {src && <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />}
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

/* ── Ana bileşen ─────────────────────────────────────────── */

interface Props {
  defaultMusic: MusicOptionKey;
}

export const MediaScreen = memo(function MediaScreen({ defaultMusic }: Props) {
  const [tab, setTab] = useState<Tab>('player');
  // YouTube parçasında video gösterilsin mi (varsayılan: kapak/ses). Kullanıcı butonla değiştirir.
  const [videoMode, setVideoMode] = useState(false);
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

  const media = useMediaState();
  const { playing, track, source, activeAppName, hasSession, shuffle, repeat } = media;

  const srcMeta     = SOURCE_META[source] ?? SOURCE_META.unknown;
  const displayName = activeAppName || srcMeta.label;
  const progressPct = track.durationSec > 0
    ? Math.min(100, (track.positionSec / track.durationSec) * 100)
    : 0;

  const handleSelectSource = useCallback((src: KnownSource) => {
    updateSettings({
      activeMediaSourceKey: src.key,
      ...(src.musicKey ? { defaultMusic: src.musicKey } : {}),
    });
    // Boş pkg (local_files, bluetooth) → tercih sıfırlanır; her durumda çağrılır.
    setMediaPreferredPackage(src.pkg);
  }, [updateSettings]);

  // Stream (özel internet kaynağı) / YouTube aktif mi — web'de de kontroller açık olsun
  const isStream  = media.activePackage === STREAM_PKG;
  const isYouTube = media.activePackage === YOUTUBE_PKG;

  // Birleşik çalma — arama sonucu (her kaynak) → katman doğru backend'e yönlendirir.
  // Tüm sonuç listesi kuyruk olarak geçer → sonraki/önceki bu liste üzerinde çalışır.
  const handlePlayResult = useCallback((t: UnifiedTrack, queue: UnifiedTrack[]) => {
    playMedia(t, queue);
    setTab('player');
  }, []);

  // Büyük oynat tuşu (aktif oturum yokken): son çalınan parçadan devam et; yoksa native play.
  const handleBigPlay = useCallback(() => {
    if (!resumeLastMedia()) play();
  }, []);

  // Özel kaynağı (Kaynaklar sekmesi) çal — katman üzerinden, harici uygulamaya gitmez
  const handlePlayStream = useCallback((src: CustomMusicSource) => {
    playMedia({ id: `stream-${src.id}`, providerId: 'stream', title: src.name, subtitle: 'İnternet akışı', streamUrl: src.url });
    setTab('player');
  }, []);

  /* ── İçerik ─────────────────────────────────────────────── */
  return (
    <div className="h-full flex flex-col overflow-hidden bg-transparent">
      {/* ── Aktif sayfa ─────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'player' && (
          <PlayerView
            hasSession={hasSession}
            playing={playing}
            track={track}
            source={source}
            srcMeta={srcMeta}
            displayName={displayName}
            progressPct={progressPct}
            shuffle={shuffle}
            repeat={repeat}
            isStream={isStream}
            isYouTube={isYouTube}
            canResume={canResume}
            videoMode={videoMode}
            onToggleVideo={() => setVideoMode((v) => !v)}
            activeSourceKey={activeMediaSourceKey}
            onTabSources={() => setTab('sources')}
            onPlay={handleBigPlay}
          />
        )}
        {tab === 'search' && (
          <SearchView
            onPlay={handlePlayResult}
            onAddSource={() => setTab('sources')}
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
        {tab === 'library' && <LocalMusicBrowser />}
        {tab === 'video'   && <LocalVideoBrowser />}
      </div>

      {/* ── Tab bar ─────────────────────────────────────────── */}
      {/* Zemin token tabanlı: tema + güneş moduyla senkron (güneşte beyaz/yüksek kontrast).
          Önceki 'var(--panel-bg-secondary)' geçersiz bir className'di → şerit zeminsiz kalıyordu. */}
      <div
        className="flex-shrink-0 flex border-t rounded-b-[32px] overflow-hidden"
        style={{
          background:           'var(--oem-surface-0, rgba(20,24,32,0.85))',
          borderColor:          'var(--oem-line, rgba(255,255,255,0.10))',
          backdropFilter:       'blur(var(--oem-glass-blur, 12px))',
          WebkitBackdropFilter: 'blur(var(--oem-glass-blur, 12px))',
        }}
      >
        <TabBtn active={tab === 'player'}  icon={<Music2     className="w-5 h-5" />} label="Çalıyor"   onClick={() => setTab('player')}  />
        <TabBtn active={tab === 'search'}  icon={<Search     className="w-5 h-5" />} label="Ara"       onClick={() => setTab('search')}  />
        <TabBtn active={tab === 'library'} icon={<HardDrive  className="w-5 h-5" />} label="Cihaz"     onClick={() => setTab('library')} />
        <TabBtn active={tab === 'video'}   icon={<Video      className="w-5 h-5" />} label="Video"     onClick={() => setTab('video')}   />
        <TabBtn active={tab === 'sources'} icon={<Layers     className="w-5 h-5" />} label="Kaynaklar" onClick={() => setTab('sources')} />
      </div>
    </div>
  );
});

/* ── Tab buton ───────────────────────────────────────────── */

function TabBtn({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 flex flex-col items-center justify-center gap-1.5 py-4 transition-all duration-300"
      style={{ color: active ? 'var(--oem-accent, #E0A23C)' : 'var(--oem-ink-3, var(--text-dim, rgba(255,255,255,0.5)))' }}
    >
      <div className={active ? 'scale-110 transition-all' : 'transition-all'}
        style={active ? { filter: 'drop-shadow(0 0 8px var(--oem-accent-glow, rgba(224,162,60,0.55)))' } : undefined}>
        {icon}
      </div>
      <span className="text-[10px] font-black uppercase tracking-[0.2em] transition-colors">{label}</span>
      {active && <div className="absolute bottom-0 w-12 h-1 rounded-t-full" style={{ background: 'var(--oem-accent, #E0A23C)', boxShadow: '0 0 10px var(--oem-accent-glow, rgba(224,162,60,0.8))' }} />}
    </button>
  );
}

/* ── Player view ──────────────────────────────────────────── */

interface PlayerViewProps {
  hasSession:      boolean;
  playing:         boolean;
  track:           ReturnType<typeof useMediaState>['track'];
  source:          MediaSource;
  srcMeta:         typeof SOURCE_META[MediaSource];
  displayName:     string;
  progressPct:     number;
  shuffle:         boolean;
  repeat:          'off' | 'one' | 'all';
  isStream:        boolean;
  isYouTube:       boolean;
  canResume:       boolean;
  videoMode:       boolean;
  onToggleVideo:   () => void;
  activeSourceKey: string;
  onTabSources:    () => void;
  onPlay:          () => void;
}

function PlayerView({
  hasSession, playing, track, srcMeta, displayName, progressPct,
  shuffle, repeat, isStream, isYouTube, canResume, videoMode, onToggleVideo, onTabSources, onPlay,
}: PlayerViewProps) {
  const progressRef = useRef<HTMLDivElement>(null);
  const artRef      = useRef<HTMLDivElement>(null);

  // YouTube videosunu albüm-kapağı alanına hizala (rAF ile sürekli senkron);
  // player sekmesinden çıkınca köşeye küçülür (mini oynatıcı, ses devam eder).
  useEffect(() => {
    if (!isYouTube) return;
    let raf = 0;
    const sync = () => {
      const el = artRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        setYouTubeRegion({ left: r.left, top: r.top, width: r.width, height: r.height }, videoMode);
      }
      raf = requestAnimationFrame(sync);
    };
    raf = requestAnimationFrame(sync);
    return () => { cancelAnimationFrame(raf); setYouTubeRegion(null); };
  }, [isYouTube, videoMode]);

  // Progress bar'a dokununca/sürükleyince konuma atla (stream/Spotify/cihaz).
  const handleSeek = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = progressRef.current;
    if (!el || track.durationSec <= 0) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seek(frac * track.durationSec);
  }, [track.durationSec]);

  // SAFE_MODE → disable heavy backdrop blur (GPU safety, CLAUDE.md §3)
  const runtimeMode = useSyncExternalStore(subscribeRuntime, getRuntimeMode, getRuntimeMode);
  const isSafeMode = runtimeMode === RuntimeMode.SAFE_MODE;

  // Oturum yoksa bile çalma ekranı düzeni gösterilir (placeholder kapak + başlık).
  // Boş "kaynak bulunamadı" durumu kaldırıldı — büyük oynat butonu arka planda çalmayı başlatır.
  return (
    <div className="relative h-full flex flex-col overflow-hidden bg-transparent">

      {/* Ambient backdrop — heavily blurred, low-opacity album art fills entire view */}
      <div className="absolute inset-0 pointer-events-none z-0">
        {track.albumArt ? (
          <div
            key={track.albumArt}
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${track.albumArt})`,
              backgroundSize:     'cover',
              backgroundPosition: 'center',
              opacity:            0.30,
              // SAFE_MODE: 0px blur → GPU spared; otherwise blur-3xl ≈ 64px
              filter:             isSafeMode ? 'none' : 'blur(64px)',
              transform:          'scale(1.5)',
              transition:         'opacity 0.6s ease',
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
        <div className="flex items-center justify-between flex-shrink-0 mb-6">
          <div className="flex items-center gap-2.5 px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] glass-card"
            style={{ color: srcMeta.color, borderColor: `${srcMeta.color}40` }}>
            <srcMeta.Icon className="w-4 h-4" />
            {displayName}
            {playing && <span className="w-2 h-2 rounded-full animate-pulse ml-0.5 shadow-[0_0_8px_currentColor]" style={{ backgroundColor: srcMeta.color }} />}
          </div>
          {/* Kaynak/ayar kısayolu → Kaynaklar sekmesi */}
          <button
            onClick={onTabSources}
            aria-label="Kaynak ayarları"
            className="flex-shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center text-secondary hover:text-primary glass-card active:scale-90 transition-all">
            <SlidersHorizontal className="w-5 h-5" />
          </button>
        </div>

        {/* Albüm kapağı — premium AlbumArt with texture + specular + 4-layer shadow */}
        <div className="flex-1 flex items-center justify-center min-h-0 py-4">
          <div ref={artRef} className="relative group" style={{ width: 'min(280px, 70vw)', aspectRatio: '1 / 1' }}>
            <AlbumArt size={280} src={track.albumArt ?? undefined} />
            {playing && !isSafeMode && (
              <div
                aria-hidden
                className="absolute -inset-3 rounded-[3rem] pointer-events-none animate-pulse"
                style={{
                  background: `radial-gradient(circle, ${srcMeta.color}22 0%, transparent 70%)`,
                  filter: 'blur(20px)',
                }}
              />
            )}
          </div>
        </div>

        {/* Şarkı bilgisi + beğeni */}
        <div className="flex-shrink-0 flex items-center justify-between mt-6 mb-4 px-1">
          <div className="flex-1 min-w-0 pr-4">
            <div className="text-primary font-black text-2xl leading-tight truncate tracking-tight drop-shadow-md">
              {track.title || (hasSession ? 'Bilinmeyen parça' : 'Müzik başlat')}
            </div>
            <div className="text-secondary font-bold text-base truncate mt-1 tracking-wide uppercase text-[10px] opacity-80">
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
            <button
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-secondary hover:text-red-500 glass-card active:scale-90 transition-all">
              <Heart className="w-6 h-6 transition-all" />
            </button>
          </div>
        </div>

        {/* Cinematic thin progress meter with subtle glow at current position */}
        <div className="flex-shrink-0 mb-6 px-1">
          {/* Geniş dokunma alanı (py-3 -my-3) — 3px çubuğu kolayca hedeflemek için */}
          <div className="relative w-full py-3 -my-3 cursor-pointer"
            style={{ touchAction: 'none' }}
            onPointerDown={handleSeek}>
          <div ref={progressRef}
            className="relative w-full rounded-full overflow-visible"
            style={{
              height: 3,
              background: 'var(--oem-line-strong, rgba(255,240,210,0.18))',
              boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.35)',
            }}>
            {/* Fill */}
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
              style={{
                width: `${progressPct}%`,
                background: 'linear-gradient(90deg, oklch(72% 0.11 55), oklch(86% 0.10 70))',
                boxShadow: '0 0 14px var(--oem-amber-glow, rgba(255,200,120,0.45))',
              }}
            />
            {/* Glow head — subtle marker at current position */}
            {progressPct > 0 && progressPct < 100 && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: `calc(${progressPct}% - 6px)`,
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
            <span>{fmtTime(track.positionSec)}</span>
            <span>{fmtTime(track.durationSec)}</span>
          </div>
        </div>

        {/* Kontrol butonları — cinematic premium */}
        <div className="flex-shrink-0 flex items-center justify-between mb-4">
          {/* Shuffle — glass ghost */}
          <button onClick={toggleShuffle} disabled={!isNative}
            aria-label="Karıştır"
            className="w-12 h-12 rounded-full flex items-center justify-center active:scale-90 transition-all disabled:opacity-30"
            style={shuffle
              ? {
                  background: 'transparent',
                  border: '1px solid var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))',
                  color: 'var(--oem-amber, oklch(80% 0.13 60))',
                  boxShadow: '0 0 18px var(--oem-amber-glow, transparent), inset 0 1px 0 rgba(255,240,210,0.06)',
                }
              : {
                  background: 'transparent',
                  border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
                  color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
                  boxShadow: 'inset 0 1px 0 rgba(255,240,210,0.04)',
                }}>
            <Shuffle className="w-5 h-5" />
          </button>

          {/* Prev — glass ghost (larger) */}
          <button onClick={previous} disabled={!isNative && !isStream && !isYouTube}
            aria-label="Önceki"
            className="w-16 h-16 rounded-full flex items-center justify-center active:scale-90 transition-all disabled:opacity-30"
            style={{
              background: 'transparent',
              border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
              color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
              boxShadow: 'inset 0 1px 0 rgba(255,240,210,0.06)',
            }}>
            <SkipBack className="w-7 h-7" />
          </button>

          {/* Premium Play Button — cinematic amber gradient + heavy shadows.
              Oturum yokken oynat → arka planda çalmayı başlatır (uygulamayı öne almaz).
              Stream (özel kaynak) web'de de kontrol edilebilir. */}
          <button onClick={hasSession ? togglePlayPause : onPlay} disabled={!isNative && !isStream && !isYouTube && !canResume}
            aria-label={playing ? 'Duraklat' : 'Çal'}
            className="w-20 h-20 rounded-full flex items-center justify-center active:scale-95 transition-all relative disabled:opacity-40"
            style={{
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
          <button onClick={next} disabled={!isNative && !isStream && !isYouTube}
            aria-label="Sonraki"
            className="w-16 h-16 rounded-full flex items-center justify-center active:scale-90 transition-all disabled:opacity-30"
            style={{
              background: 'transparent',
              border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
              color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
              boxShadow: 'inset 0 1px 0 rgba(255,240,210,0.06)',
            }}>
            <SkipForward className="w-7 h-7" />
          </button>

          {/* Repeat — glass ghost */}
          <button onClick={cycleRepeat} disabled={!isNative}
            aria-label="Tekrarla"
            className="w-12 h-12 rounded-full flex items-center justify-center active:scale-90 transition-all disabled:opacity-30"
            style={repeat !== 'off'
              ? {
                  background: 'transparent',
                  border: '1px solid var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))',
                  color: 'var(--oem-amber, oklch(80% 0.13 60))',
                  boxShadow: '0 0 18px var(--oem-amber-glow, transparent), inset 0 1px 0 rgba(255,240,210,0.06)',
                }
              : {
                  background: 'transparent',
                  border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
                  color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
                  boxShadow: 'inset 0 1px 0 rgba(255,240,210,0.04)',
                }}>
            {repeat === 'one' ? <Repeat1 className="w-5 h-5" /> : <Repeat className="w-5 h-5" />}
          </button>
        </div>

      </div>
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
    <div className="h-full overflow-y-auto scrollbar-none px-5 pt-5 pb-3">
      <div className="mb-5">
        <div className="text-primary font-black text-base tracking-tight">Medya Kaynakları</div>
        <div className="text-secondary text-xs mt-0.5 font-bold uppercase tracking-wider">Tercih ettiğiniz uygulamayı seçin</div>
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
          <div className="text-secondary text-[10px] font-black uppercase tracking-[0.25em] mb-3 px-1">{label}</div>
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
                    <div className={`font-black text-sm tracking-tight ${isActive ? 'text-primary' : 'text-secondary group-hover:text-primary'}`}>
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
                      <Check className="w-5 h-5 text-primary" />
                    </div>
                  ) : (
                    <ChevronRight className="w-5 h-5 text-secondary group-hover:text-secondary transition-colors" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <p className="text-secondary text-[10px] font-bold text-center leading-relaxed pb-6 uppercase tracking-widest">
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
        <div className="text-secondary text-[10px] font-black uppercase tracking-[0.25em]">Eklenen Kaynaklar</div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-card text-[10px] font-black uppercase tracking-widest text-blue-400 active:scale-95 transition-all">
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
            className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-primary text-sm outline-none focus:border-blue-400/50"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Akış URL'si (https://... .mp3 / .m3u8 / radyo)"
            inputMode="url"
            className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-primary text-sm outline-none focus:border-blue-400/50"
          />
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="mt-1 px-4 py-2.5 rounded-xl font-black text-sm uppercase tracking-widest transition-all active:scale-95 disabled:opacity-30"
            style={{ background: 'rgba(59,130,246,0.22)', border: '1.5px solid rgba(59,130,246,0.55)', color: '#60a5fa' }}>
            Ekle
          </button>
          <div className="text-secondary text-[10px] leading-relaxed opacity-70">
            Doğrudan ses akışı / internet radyosu URL'si. Uygulama içinde çalar, harici uygulamaya gidilmez.
          </div>
        </div>
      )}

      {/* Liste */}
      {customSources.length === 0 ? (
        !adding && (
          <div className="text-secondary text-xs px-1 opacity-60">Henüz kaynak yok. "Kaynak Ekle" ile internet radyosu/akış ekleyin.</div>
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
                  <div className="font-black text-sm tracking-tight text-primary truncate">{src.name}</div>
                  <div className="text-secondary text-[10px] font-bold uppercase tracking-widest truncate">İnternet akışı</div>
                </div>
                <Play className="w-5 h-5 flex-shrink-0" style={{ color: src.color }} />
              </button>
              <button
                onClick={() => onRemoveCustomSource(src.id)}
                aria-label="Kaynağı sil"
                className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-secondary hover:text-red-400 active:scale-90 transition-all">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Arama view ───────────────────────────────────────────── */

interface SearchViewProps {
  onPlay:      (t: UnifiedTrack, queue: UnifiedTrack[]) => void;
  onAddSource: () => void;
}

/** Kaynak ikonu — kapak resmi yoksa sağlayıcıya göre. */
function ProviderIcon({ id }: { id: ProviderId }) {
  if (id === 'radio')  return <Radio  className="w-5 h-5" />;
  if (id === 'stream') return <Globe  className="w-5 h-5" />;
  if (id === 'local')  return <Music  className="w-5 h-5" />;
  return <Music2 className="w-5 h-5" />; // spotify / audius
}

/** Kapak resmi — yüklenemezse (ör. ağ/COEP) kaynak ikonuna düşer. */
function Artwork({ src, id }: { src?: string; id: ProviderId }) {
  const [err, setErr] = useState(false);
  if (!src || err) return <ProviderIcon id={id} />;
  return <img src={src} alt="" loading="lazy" onError={() => setErr(true)} className="w-full h-full object-cover" />;
}

function SearchView({ onPlay, onAddSource }: SearchViewProps) {
  const [query, setQuery]         = useState('');
  const [filter, setFilter]       = useState<string>('all');
  const [results, setResults]     = useState<UnifiedTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [spotifyConnected]        = useState(isSpotifyConnected());
  const customSources = useStore((s) => s.settings.customMusicSources);

  // Cihaz müzik listesini hazırla (native)
  useEffect(() => { ensureLocalLoaded(); }, []);

  // Birleşik arama — tüm kaynaklar tek katmandan (carosMediaLayer), 200ms debounce.
  // Yazarken anlık öneri: "ib" → İbrahim... gibi sonuçlar gelir.
  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await searchMedia(query, filter);
      if (!cancelled) { setResults(r); setSearching(false); }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, filter]);

  const chips: { key: string; label: string }[] = [
    { key: 'all',     label: 'Tümü' },
    { key: 'youtube', label: 'YouTube' },
    { key: 'spotify', label: 'Spotify' },
    // Yabancı/global kataloglar — Türkiye odağında gizli (WORLDWIDE_SOURCES_ENABLED)
    ...(WORLDWIDE_SOURCES_ENABLED ? [
      { key: 'audius',  label: 'Audius' },
      { key: 'jamendo', label: 'Jamendo' },
      { key: 'archive', label: 'Archive' },
    ] : []),
    { key: 'radio',   label: 'Radyo' },
    { key: 'local',   label: 'Cihaz' },
    ...customSources.map((s) => ({ key: s.id, label: s.name })),
  ];

  const showSpotifyConnect = (filter === 'all' || filter === 'spotify') && !spotifyConnected;
  const nothing = results.length === 0 && !searching && !showSpotifyConnect;
  const shown = results.slice(0, 80);

  return (
    <div className="h-full flex flex-col overflow-hidden px-5 pt-5">
      {/* Arama kutusu */}
      <div className="flex items-center gap-2 px-4 py-3 rounded-2xl glass-card flex-shrink-0">
        <Search className="w-5 h-5 text-secondary flex-shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Şarkı, sanatçı veya kaynak ara…"
          className="flex-1 bg-transparent text-primary text-sm outline-none placeholder:text-secondary"
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Temizle" className="text-secondary active:scale-90">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Kaynak seç chip'leri */}
      <div className="flex gap-2 overflow-x-auto scrollbar-none flex-shrink-0 mt-3 pb-1">
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={() => setFilter(c.key)}
            className={`flex-shrink-0 px-3.5 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
              filter === c.key ? 'text-blue-400' : 'text-secondary'
            }`}
            style={{
              background:  filter === c.key ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.04)',
              border:      `1px solid ${filter === c.key ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.08)'}`,
            }}>
            {c.label}
          </button>
        ))}
      </div>

      {/* Sonuçlar */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none mt-3 pb-3">
        {/* Spotify bağlan istemi */}
        {showSpotifyConnect && (
          <button
            onClick={() => { void beginSpotifyLogin(); }}
            className="flex items-center gap-4 w-full p-4 mb-3 rounded-2xl glass-card text-left active:scale-[0.98] transition-all"
            style={{ background: 'rgba(29,185,84,0.12)', borderColor: 'rgba(29,185,84,0.45)' }}>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(29,185,84,0.25)', color: '#1db954' }}>
              <Music2 className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-black text-sm text-primary">Spotify'a Bağlan</div>
              <div className="text-secondary text-[11px]">Catalog'da ara, arka planda çal</div>
            </div>
            <ChevronRight className="w-5 h-5 text-secondary flex-shrink-0" />
          </button>
        )}

        {searching && results.length === 0 && (
          <div className="text-secondary text-xs px-1 py-2 opacity-70">Aranıyor…</div>
        )}

        {/* Birleşik sonuç listesi — her kaynak tek liste, rozette kaynağı görünür */}
        {shown.length > 0 && (
          <div className="flex flex-col gap-2">
            {shown.map((t) => {
              const meta = PROVIDER_META[t.providerId];
              return (
                <button
                  key={t.id}
                  onClick={() => onPlay(t, shown)}
                  className="flex items-center gap-4 p-3.5 rounded-2xl glass-card text-left active:scale-[0.98] transition-all"
                  style={{ borderColor: `${meta.color}33` }}>
                  <div className="w-11 h-11 rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0"
                    style={{ background: `${meta.color}22`, color: meta.color }}>
                    <Artwork src={t.artwork} id={t.providerId} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-black text-sm text-primary truncate">{t.title}</div>
                    <div className="text-secondary text-[11px] truncate">{t.subtitle}</div>
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-widest flex-shrink-0" style={{ color: meta.color }}>{meta.name}</span>
                  <Play className="w-4 h-4 flex-shrink-0" style={{ color: meta.color }} />
                </button>
              );
            })}
          </div>
        )}

        {/* Boş durum */}
        {nothing && (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-6">
            <Search className="w-10 h-10 text-secondary opacity-40" />
            <div className="text-secondary text-sm font-medium leading-relaxed max-w-[280px]">
              {query.trim()
                ? 'Sonuç bulunamadı.'
                : 'Şarkı veya sanatçı yazın — Spotify, Audius, radyo ve cihazda aransın.'}
            </div>
            <button
              onClick={onAddSource}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl glass-card text-blue-400 text-xs font-black uppercase tracking-widest active:scale-95 transition-all">
              <Plus className="w-4 h-4" /> Kaynak Ekle
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


