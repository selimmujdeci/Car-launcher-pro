/**
 * Premium Media Hub — araç içi medya merkezi.
 *
 * Tab: NOW PLAYING — büyük albüm kapağı, kontroller, progress, shuffle/repeat
 * Tab: KAYNAKLAR   — bilinen medya uygulamaları listesi, aktif kaynak seçimi
 *
 * Native: Android MediaSession üzerinden harici uygulama kontrolü
 * Web/Demo: mock track rotasyonu
 */
import { memo, useEffect, useCallback, useState, useRef } from 'react';
import {
  SkipBack, SkipForward, Play, Pause, ExternalLink,
  Music2, Bluetooth, Radio, Shuffle, Repeat, Repeat1,
  Heart, Layers, Check, ChevronRight, Bell,
} from 'lucide-react';
import {
  useMediaState, togglePlayPause, next, previous,
  fmtTime, startMediaHub, toggleShuffle, cycleRepeat,
  setMediaPreferredPackage, openMediaPermissionSettings, pollMediaNow,
} from '../../platform/mediaService';
import type { MediaSource } from '../../platform/mediaService';
import { isNative } from '../../platform/bridge';
import { CarLauncher } from '../../platform/nativePlugin';
import { useStore } from '../../store/useStore';
import type { MusicOptionKey } from '../../data/apps';

/* ── Kaynak meta ─────────────────────────────────────────── */

const SOURCE_META: Record<MediaSource, { label: string; color: string; Icon: React.ComponentType<{ className?: string }> }> = {
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

type Tab = 'player' | 'sources';

/* ── Ana bileşen ─────────────────────────────────────────── */

interface Props {
  defaultMusic: MusicOptionKey;
}

export const MediaScreen = memo(function MediaScreen({ defaultMusic }: Props) {
  const [tab, setTab] = useState<Tab>('player');
  const { settings, updateSettings } = useStore();
  const activeSourceKey = settings.activeMediaSourceKey ?? defaultMusic;

  useEffect(() => {
    startMediaHub();
    // Mevcut aktif kaynak paketini MediaHub'a bildir
    const src = KNOWN_SOURCES.find((s) => s.key === activeSourceKey);
    if (src?.pkg) setMediaPreferredPackage(src.pkg);
    // Drawer açılınca anında poll — 5s beklemesin
    pollMediaNow();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const media = useMediaState();
  const { playing, track, source, activeAppName, hasSession, shuffle, repeat, permissionRequired } = media;

  const srcMeta     = SOURCE_META[source] ?? SOURCE_META.unknown;
  const displayName = activeAppName || srcMeta.label;
  const progressPct = track.durationSec > 0
    ? Math.min(100, (track.positionSec / track.durationSec) * 100)
    : 0;

  const handleOpenInApp = useCallback(() => {
    if (!isNative) return; // browser/demo modda harici sekme açma
    const src = KNOWN_SOURCES.find((s) => s.key === activeSourceKey);
    if (!src?.pkg) return;
    CarLauncher.launchApp({ packageName: src.pkg }).catch(() => {
      // Uygulama yüklü değil — Play Store'a yönlendir
      CarLauncher.launchApp({
        action: 'android.intent.action.VIEW',
        data: `market://details?id=${src.pkg}`,
      }).catch(() => {
        // Play Store da yoksa web'e git
        window.open(`https://play.google.com/store/apps/details?id=${src.pkg}`, '_blank');
      });
    });
  }, [activeSourceKey]);

  const handleSelectSource = useCallback((src: KnownSource) => {
    // Varsayılan müzik kaynağını kaydet (musicKey varsa defaultMusic da güncelle)
    updateSettings({
      activeMediaSourceKey: src.key,
      ...(src.musicKey ? { defaultMusic: src.musicKey } : {}),
    });
    // MediaHub'a tercih bildir — getMediaInfo() bu paketi önceliklendirir
    if (src.pkg) setMediaPreferredPackage(src.pkg);
    // Native'de kaynak seçince uygulamayı direkt aç
    if (src.pkg && isNative) {
      CarLauncher.launchApp({ packageName: src.pkg }).catch(() => {
        // Yüklü değil — Play Store'a yönlendir
        CarLauncher.launchApp({
          action: 'android.intent.action.VIEW',
          data: `market://details?id=${src.pkg}`,
        }).catch(() => {
          window.open(`https://play.google.com/store/apps/details?id=${src.pkg}`, '_blank');
        });
      });
    }
  }, [updateSettings]);

  /* ── İçerik ─────────────────────────────────────────────── */
  return (
    <div className="h-full flex flex-col overflow-hidden bg-transparent">
      {/* ── Aktif sayfa ─────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'player'
          ? <PlayerView
              hasSession={hasSession}
              permissionRequired={permissionRequired}
              playing={playing}
              track={track}
              source={source}
              srcMeta={srcMeta}
              displayName={displayName}
              progressPct={progressPct}
              shuffle={shuffle}
              repeat={repeat}
              activeSourceKey={activeSourceKey}
              onOpenInApp={handleOpenInApp}
              onTabSources={() => setTab('sources')}
            />
          : <SourcesView
              activeSourceKey={activeSourceKey}
              activeSession={hasSession ? source : null}
              onSelectSource={handleSelectSource}
            />
        }
      </div>

      {/* ── Tab bar ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex border-t border-white/10 var(--panel-bg-secondary) backdrop-blur-md rounded-b-[32px] overflow-hidden">
        <TabBtn active={tab === 'player'}  icon={<Music2 className="w-5 h-5" />}  label="Çalıyor"   onClick={() => setTab('player')}  />
        <TabBtn active={tab === 'sources'} icon={<Layers className="w-5 h-5" />} label="Kaynaklar" onClick={() => setTab('sources')} />
      </div>
    </div>
  );
});

/* ── Tab buton ───────────────────────────────────────────── */

function TabBtn({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center justify-center gap-1.5 py-4 transition-all duration-300 ${
        active ? 'text-blue-400 var(--panel-bg-secondary)' : 'text-secondary hover:text-secondary'
      }`}
    >
      <div className={`${active ? 'drop-shadow-[0_0_8px_rgba(59,130,246,0.6)] scale-110' : ''} transition-all`}>
        {icon}
      </div>
      <span className={`text-[10px] font-black uppercase tracking-[0.2em] transition-colors ${active ? 'text-blue-400' : 'text-secondary'}`}>{label}</span>
      {active && <div className="absolute bottom-0 w-12 h-1 rounded-t-full bg-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.8)]" />}
    </button>
  );
}

/* ── Player view ──────────────────────────────────────────── */

interface PlayerViewProps {
  hasSession:         boolean;
  permissionRequired: boolean;
  playing:        boolean;
  track:          ReturnType<typeof useMediaState>['track'];
  source:         MediaSource;
  srcMeta:        typeof SOURCE_META[MediaSource];
  displayName:    string;
  progressPct:    number;
  shuffle:        boolean;
  repeat:         'off' | 'one' | 'all';
  activeSourceKey:string;
  onOpenInApp:    () => void;
  onTabSources:   () => void;
}

function PlayerView({
  hasSession, permissionRequired, playing, track, srcMeta, displayName, progressPct,
  shuffle, repeat, activeSourceKey, onOpenInApp, onTabSources,
}: PlayerViewProps) {
  const progressRef = useRef<HTMLDivElement>(null);

  if (permissionRequired) return <PermissionView />;
  if (!hasSession) return <NoSessionView onTabSources={onTabSources} onOpenInApp={onOpenInApp} activeSourceKey={activeSourceKey} />;

  return (
    <div className="relative h-full flex flex-col overflow-hidden bg-transparent">

      {/* Ultra Premium Blur Arka Plan */}
      <div className="absolute inset-0 pointer-events-none z-0">
        {track.albumArt ? (
          <div className="absolute inset-0"
            style={{
              backgroundImage: `url(${track.albumArt})`,
              backgroundSize: 'cover', backgroundPosition: 'center',
              opacity: 0.25, filter: 'blur(100px)', transform: 'scale(1.5)',
            }}
          />
        ) : (
          <div className="absolute inset-0 opacity-20"
            style={{ background: `radial-gradient(circle at center, ${srcMeta.color}, transparent 80%)` }}
          />
        )}
        <div className="absolute inset-0 var(--panel-bg-secondary) backdrop-blur-sm" />
      </div>

      <div className="relative z-10 flex-1 flex flex-col px-8 pt-6 pb-4 min-h-0">

        {/* Üst: kaynak badge + open in app */}
        <div className="flex items-center justify-between flex-shrink-0 mb-6">
          <div className="flex items-center gap-2.5 px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] glass-card"
            style={{ color: srcMeta.color, borderColor: `${srcMeta.color}40` }}>
            <srcMeta.Icon className="w-4 h-4" />
            {displayName}
            {playing && <span className="w-2 h-2 rounded-full animate-pulse ml-0.5 shadow-[0_0_8px_currentColor]" style={{ backgroundColor: srcMeta.color }} />}
          </div>
          <button onClick={onOpenInApp}
            className="flex items-center gap-2 px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-[0.1em] text-secondary glass-card hover:text-primary hover:var(--panel-bg-secondary) active:scale-95 transition-all">
            <ExternalLink className="w-4 h-4" />
            Uygulamada Aç
          </button>
        </div>

        {/* Albüm kapağı */}
        <div className="flex-1 flex items-center justify-center min-h-0 py-4">
          {track.albumArt ? (
            <div className="relative group">
              <img
                key={track.albumArt}
                src={track.albumArt}
                alt="Albüm"
                className="w-full max-w-[280px] aspect-square rounded-[3rem] object-cover border border-white/20 shadow-2xl transition-transform duration-500 group-hover:scale-105"
                style={{ boxShadow: `0 30px 100px -20px ${srcMeta.color}60, 0 20px 50px -10px rgba(0,0,0,0.5)` }}
              />
              <div className="absolute inset-0 rounded-[3rem] bg-gradient-to-tr from-black/20 to-transparent pointer-events-none" />
            </div>
          ) : (
            <div className="w-full max-w-[280px] aspect-square rounded-[3rem] flex items-center justify-center border border-white/10 glass-card"
              style={{ boxShadow: `0 30px 100px -20px ${srcMeta.color}30` }}>
              <Music2 className="w-24 h-24 opacity-20" style={{ color: srcMeta.color }} />
            </div>
          )}
        </div>

        {/* Şarkı bilgisi + beğeni */}
        <div className="flex-shrink-0 flex items-center justify-between mt-6 mb-4 px-1">
          <div className="flex-1 min-w-0 pr-4">
            <div className="text-primary font-black text-2xl leading-tight truncate tracking-tight drop-shadow-md">
              {track.title || 'Müzik başlat'}
            </div>
            <div className="text-secondary font-bold text-base truncate mt-1 tracking-wide uppercase text-[10px] opacity-80">
              {track.artist || 'Sanatçı bilinmiyor'}
            </div>
          </div>
          <button
            className="flex-shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center text-secondary hover:text-red-500 glass-card active:scale-90 transition-all">
            <Heart className="w-6 h-6 transition-all" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex-shrink-0 mb-6 px-1">
          <div ref={progressRef} className="w-full h-2 var(--panel-bg-secondary) rounded-full overflow-hidden cursor-pointer backdrop-blur-md border border-white/5">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out shadow-[0_0_15px_currentColor]"
              style={{ width: `${progressPct}%`, background: `linear-gradient(90deg, ${srcMeta.color}80, ${srcMeta.color})`, color: srcMeta.color }}
            />
          </div>
          <div className="flex justify-between text-secondary text-[11px] mt-2.5 font-black uppercase tracking-widest tabular-nums">
            <span>{fmtTime(track.positionSec)}</span>
            <span>{fmtTime(track.durationSec)}</span>
          </div>
        </div>

        {/* Kontrol butonları */}
        <div className="flex-shrink-0 flex items-center justify-between mb-4">
          <button onClick={toggleShuffle} disabled={!isNative}
            className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all active:scale-90 glass-card disabled:opacity-30 ${
              shuffle ? 'text-blue-400 border-blue-400/40 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'text-secondary hover:text-primary'
            }`}>
            <Shuffle className="w-5 h-5" />
          </button>

          <button onClick={previous} disabled={!isNative}
            className="w-16 h-16 rounded-3xl glass-card flex items-center justify-center text-secondary active:scale-90 transition-all disabled:opacity-30">
            <SkipBack className="w-7 h-7" />
          </button>

          <button onClick={togglePlayPause} disabled={!isNative}
            className="w-20 h-20 rounded-[2rem] flex items-center justify-center text-primary active:scale-90 transition-all border-none relative group disabled:opacity-40"
            style={{
              background: `linear-gradient(135deg, ${srcMeta.color}, ${srcMeta.color}dd)`,
              boxShadow: `0 15px 45px -10px ${srcMeta.color}80`,
            }}>
            <div className="absolute inset-0 rounded-[2rem] bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
            {playing
              ? <Pause className="w-9 h-9 fill-white" />
              : <Play  className="w-9 h-9 fill-white ml-1" />
            }
          </button>

          <button onClick={next} disabled={!isNative}
            className="w-16 h-16 rounded-3xl glass-card flex items-center justify-center text-secondary active:scale-90 transition-all disabled:opacity-30">
            <SkipForward className="w-7 h-7" />
          </button>

          <button onClick={cycleRepeat} disabled={!isNative}
            className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all active:scale-90 glass-card disabled:opacity-30 ${
              repeat !== 'off' ? 'text-blue-400 border-blue-400/40 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'text-secondary hover:text-primary'
            }`}>
            {repeat === 'one' ? <Repeat1 className="w-5 h-5" /> : <Repeat className="w-5 h-5" />}
          </button>
        </div>

      </div>
    </div>
  );
}

/* ── Bildirim izni gerekli ───────────────────────────────── */

function PermissionView() {
  const [showManual, setShowManual] = useState(false);

  const handleGrant = useCallback(() => {
    openMediaPermissionSettings();
    // Android 13+ sideloaded apps may show "Kısıtlanmış Ayar" dialog.
    // Show manual instructions after a short delay so the user has fallback guidance.
    setTimeout(() => setShowManual(true), 1500);
  }, []);

  useEffect(() => {
    const onFocus = () => { pollMediaNow(); };
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('focus', onFocus); };
  }, []);

  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 px-8 text-center bg-transparent overflow-y-auto py-6">
      <div className="w-20 h-20 rounded-[2rem] flex items-center justify-center glass-card border-amber-500/30 flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(245,158,11,0.05))' }}>
        <Bell className="w-9 h-9 text-amber-400 drop-shadow-[0_0_15px_rgba(245,158,11,0.5)]" />
      </div>

      <div>
        <div className="text-primary text-xl font-black mb-2 tracking-tight">Bildirim Erişimi Gerekli</div>
        <div className="text-secondary text-sm leading-relaxed max-w-[320px] font-medium">
          Müzik bilgilerini göstermek için
          <span className="text-amber-400 font-black"> Bildirim Erişimi </span>
          izni gerekli.
        </div>
      </div>

      <button
        onClick={handleGrant}
        className="up-button flex items-center gap-3 px-7 py-3.5 !rounded-2xl !text-sm shadow-[0_10px_40px_-5px_#d9770660] !bg-gradient-to-br from-amber-400 to-amber-600 flex-shrink-0">
        <Bell className="w-5 h-5" />
        Ayarları Aç
      </button>

      {/* Android 13+ "Kısıtlanmış Ayar" — manual guide */}
      {showManual && (
        <div className="rounded-2xl p-5 text-left max-w-[340px] flex-shrink-0"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
          <div className="text-amber-400 text-xs font-black uppercase tracking-widest mb-3">
            ⚠️ Kısıtlanmış Ayar mı çıktı?
          </div>
          <div className="text-secondary text-xs leading-relaxed space-y-1.5">
            <div>Android 13+ güvenlik kısıtlaması. Manuel olarak izin verin:</div>
            <div className="text-primary font-bold">
              1. Telefon Ayarları → Uygulamalar
            </div>
            <div className="text-primary font-bold">
              2. CockpitOS → Özel uygulama erişimi
            </div>
            <div className="text-primary font-bold">
              3. Bildirim erişimi → Aç ✓
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Oturum yok — premium boş durum ─────────────────────── */

function NoSessionView({
  onTabSources,
  onOpenInApp,
  activeSourceKey,
}: {
  onTabSources: () => void;
  onOpenInApp:  () => void;
  activeSourceKey: string;
}) {
  const src      = KNOWN_SOURCES.find((s) => s.key === activeSourceKey);
  const srcColor = src?.color ?? '#3b82f6';
  const srcEmoji = src?.emoji ?? '🎵';
  const srcName  = src?.name  ?? 'Müzik';
  const hasLaunchableApp = !!src?.pkg && isNative;
  const isLocalOrBt = !src?.pkg; // local_files / bluetooth — başlatılabilir uygulama yok

  return (
    <div className="h-full flex flex-col items-center justify-center gap-8 px-10 bg-transparent">
      {/* Dev İkon */}
      <div
        className="w-32 h-32 rounded-[3rem] flex items-center justify-center text-6xl glass-card border-white/20 relative group"
        style={{ background: `${srcColor}15`, boxShadow: `0 30px 60px -15px ${srcColor}30` }}
      >
        <div className="absolute inset-0 rounded-[3rem] var(--panel-bg-secondary) animate-pulse" />
        <span className="relative z-10 group-hover:scale-110 transition-transform duration-500">{srcEmoji}</span>
      </div>

      <div className="text-center">
        <div className="text-primary text-2xl font-black mb-2 tracking-tight">{srcName} Hazır</div>
        <div className="text-secondary text-sm leading-relaxed max-w-[280px] font-medium">
          {isLocalOrBt
            ? 'Telefondaki müzik uygulamasından çalmaya başla. Kontroller burada belirecek.'
            : hasLaunchableApp
            ? 'Uygulamayı aç, bir şarkı başlat — kontroller burada belirecek.'
            : 'Uygulamayı Android cihazda aç. Çalan parça bilgileri burada belirecek.'
          }
        </div>
      </div>

      {/* CTA — sadece native + pkg olan kaynaklarda */}
      {hasLaunchableApp && (
        <button
          onClick={onOpenInApp}
          className="up-button flex items-center gap-4 px-10 py-5 !rounded-3xl !text-lg !font-black !tracking-tight"
          style={{
            background: `linear-gradient(135deg, ${srcColor}, ${srcColor}aa)`,
            boxShadow: `0 20px 50px -10px ${srcColor}60`
          }}
        >
          <span className="text-2xl leading-none drop-shadow-md">{srcEmoji}</span>
          Uygulamayı Aç
        </button>
      )}

      {/* Kaynak değiştir */}
      <button
        onClick={onTabSources}
        className={`flex items-center gap-2 text-secondary text-xs font-black uppercase tracking-[0.2em] hover:text-secondary transition-all ${isLocalOrBt ? '' : 'mt-4'}`}>
        <Layers className="w-4 h-4" />
        Kaynak Değiştir
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

/* ── Kaynaklar view ───────────────────────────────────────── */

interface SourcesViewProps {
  activeSourceKey:  string;
  activeSession:    MediaSource | null;
  onSelectSource:   (src: KnownSource) => void;
}

const CATEGORY_LABELS = {
  streaming:  'Yayın Servisleri',
  local:      'Yerel & Offline',
  bluetooth:  'Bağlantı',
};

function SourcesView({ activeSourceKey, activeSession, onSelectSource }: SourcesViewProps) {
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


