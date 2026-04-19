import { memo } from 'react';
import {
  MapPin,
  SkipBack, SkipForward, Play, Pause,
} from 'lucide-react';
import {
  NAV_OPTIONS, MUSIC_OPTIONS,
  type NavOptionKey, type MusicOptionKey, type AppItem,
} from '../../data/apps';
import {
  useMediaState, togglePlayPause, next, previous,
} from '../../platform/mediaService';
import { openMusicDrawer } from '../../platform/mediaUi';
import { MiniMapWidget } from '../map/MiniMapWidget';

/* ── NavHero ─────────────────────────────────────────────── */

export const NavHero = memo(function NavHero({
  defaultNav, onOpenMap, offlineMap, fullMapOpen = false,
}: {
  defaultNav:   NavOptionKey;
  onLaunch?:    (id: string) => void;
  onOpenMap?:   () => void;
  offlineMap?:  boolean;
  /** FullMapView açıkken MiniMapWidget unmount edilir — GPU tasarrufu */
  fullMapOpen?: boolean;
}) {
  const nav = NAV_OPTIONS[defaultNav];

  if (offlineMap && onOpenMap) {
    return (
      <div className="min-h-0 w-full h-full transform transition-all duration-300 hover:scale-[1.002] active:scale-[0.995]">
        {/* fullMapOpen true iken MiniMap unmount — iki MapLibre instance birden çalışmaz */}
        {!fullMapOpen && <MiniMapWidget onFullScreenClick={onOpenMap} />}
      </div>
    );
  }

  return (
    <div
      className="nav-hero-card flex flex-col rounded-[2.5rem] border border-black/8 p-6 overflow-hidden relative min-h-0 w-full h-full group shadow-sm"
      style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(24px)' }}
    >
      <div className="flex items-center gap-4 mb-4 flex-shrink-0 relative z-10">
        <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0 shadow-sm">
          <span className="text-2xl leading-none">{nav.icon}</span>
        </div>
        <div>
          <div className="text-secondary font-black text-[9px] uppercase tracking-[0.5em] opacity-60">NAVİGASYON</div>
          <div className="text-primary text-lg font-black tracking-tight uppercase">{nav.name}</div>
        </div>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onOpenMap?.(); }}
        className="relative flex flex-col items-center justify-center rounded-[2rem] overflow-hidden active:scale-[0.98] transition-all duration-300 gap-4 min-h-0 flex-1 border border-blue-100 shadow-sm"
        style={{ background: 'rgba(239,246,255,0.90)' }}
      >
        <div className="relative flex flex-col items-center gap-3 pointer-events-none">
          <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center border border-blue-100 shadow-md">
            <MapPin className="w-8 h-8 text-primary drop-shadow-lg" />
          </div>
          <div className="text-primary text-xl font-black tracking-tight uppercase" style={{ textShadow: '0 2px 8px rgba(59,130,246,0.15)' }}>HARİTAYI AÇ</div>
        </div>
      </button>
    </div>
  );
});

/* ── MediaPanel — kompakt araba ekranı tasarımı ──────────── */

export const MediaPanel = memo(function MediaPanel({ defaultMusic }: { defaultMusic: MusicOptionKey }) {
  const { playing, track } = useMediaState();
  const progress = track.durationSec > 0 ? track.positionSec / track.durationSec : 0;
  const music = MUSIC_OPTIONS[defaultMusic];

  return (
    <div
      onClick={() => openMusicDrawer()}
      className="flex flex-col w-full h-full overflow-hidden relative cursor-pointer select-none"
      style={{ padding: '14px 18px 10px' }}
    >
      {/* Arkaplan albüm art blur */}
      {track.albumArt && (
        <div className="absolute inset-0 z-0 opacity-20 blur-3xl scale-150 pointer-events-none">
          <img src={track.albumArt} alt="" className="w-full h-full object-cover" />
        </div>
      )}

      {/* Info area — flex-1 min-h-0 ile küçük yükseklikte sıkışır, kontrollerin üstüne binmez */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col justify-center relative z-10 gap-2">
        {/* Üst satır: ikon + başlık + sanatçı */}
        <div className="flex items-center gap-3 min-w-0 flex-shrink-0">
          {/* Album art / ikon */}
          <div
            className="flex-shrink-0 rounded-xl overflow-hidden flex items-center justify-center border border-black/6 shadow-sm"
            style={{ width: 48, height: 48, background: 'rgba(0,0,0,0.05)' }}
          >
            {track.albumArt ? (
              <img src={track.albumArt} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xl leading-none opacity-70">{music.icon}</span>
            )}
          </div>

          {/* Başlık + sanatçı */}
          <div className="flex-1 min-w-0">
            <div className="text-[9px] font-black uppercase tracking-[0.4em] opacity-50 leading-none mb-1"
              style={{ color: music.color }}>ÇALIYOR</div>
            <div className="text-primary font-black text-base leading-tight truncate">
              {track.title || 'Müzik Seçilmedi'}
            </div>
            <div className="text-secondary text-[11px] font-bold truncate mt-0.5 tracking-wide opacity-70">
              {track.artist || 'Sanatçı'}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex-shrink-0 px-0.5">
          <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.08)' }}>
            <div
              className="h-full rounded-full transition-all duration-1000"
              style={{ width: `${(progress || 0) * 100}%`, background: music.color || 'rgba(255,255,255,0.8)', boxShadow: `0 0 8px ${music.color || '#fff'}` }}
            />
          </div>
        </div>
      </div>

      {/* Kontroller — flex-shrink-0 garantisi: info area küçülür, bunlar her zaman görünür */}
      <div className="flex items-center justify-center gap-4 flex-shrink-0 relative z-10 pt-2">
        <button
          onClick={(e) => { e.stopPropagation(); previous(); }}
          className="flex items-center justify-center rounded-xl border border-black/8 text-secondary hover:text-primary active:scale-90 transition-all"
          style={{ width: 36, height: 36, background: 'rgba(0,0,0,0.05)' }}
        >
          <SkipBack className="w-4 h-4" />
        </button>

        <button
          onClick={(e) => { e.stopPropagation(); togglePlayPause(); }}
          className="flex items-center justify-center rounded-2xl text-primary active:scale-90 shadow-md transition-all duration-200 border border-black/10"
          style={{
            width: 52, height: 52,
            background: music.color ? `${music.color}DD` : 'rgba(59,130,246,0.85)',
            boxShadow: `0 6px 20px ${music.color || '#fff'}40`,
          }}
        >
          {playing
            ? <Pause className="w-5 h-5 fill-white" />
            : <Play className="w-5 h-5 ml-0.5 fill-white" />
          }
        </button>

        <button
          onClick={(e) => { e.stopPropagation(); next(); }}
          className="flex items-center justify-center rounded-xl border border-black/8 text-secondary hover:text-primary active:scale-90 transition-all"
          style={{ width: 36, height: 36, background: 'rgba(0,0,0,0.05)' }}
        >
          <SkipForward className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
});

/* ── DockShortcuts — yatay tek sıra ─────────────────────── */

export const DockShortcuts = memo(function DockShortcuts({
  dockIds, onLaunch, appMap,
}: { dockIds: string[]; onLaunch: (id: string) => void; appMap: Record<string, AppItem> }) {
  const apps = dockIds.slice(0, 5).map((id) => ({ id, app: appMap[id] })).filter((x) => x.app);

  return (
    <div
      className="flex flex-col w-full h-full overflow-hidden relative"
      style={{ padding: '10px 14px 10px' }}
    >
      <div className="text-[9px] font-black uppercase tracking-[0.35em] opacity-50 mb-2 px-1 flex-shrink-0">Kısayollar</div>

      {/* Tek sıra yatay layout — her ekrana uyar */}
      <div className="flex items-center gap-2 flex-1 min-h-0">
        {apps.map(({ id, app }) => (
          <button
            key={id}
            onClick={() => onLaunch(id)}
            className="flex flex-col items-center justify-center gap-1 flex-1 rounded-2xl border border-black/7 active:scale-[0.93] transition-all duration-200 min-w-0 h-full"
            style={{ background: 'rgba(0,0,0,0.04)' }}
          >
            <span className="text-2xl leading-none">{app!.icon}</span>
            <span className="text-[9px] font-bold uppercase tracking-widest truncate w-full text-center px-1 opacity-60">
              {app!.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
});
