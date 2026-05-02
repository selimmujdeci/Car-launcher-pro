/**
 * MapFocusLayout — Tesla / Tesla-X-Night
 *
 * Tree:
 *   full-screen map background
 *   └─ floating speed gauge (bottom-left)
 *   └─ floating media mini (bottom-right)
 *   └─ floating OBD pill (top-center)
 */
import { memo } from 'react';
import { Play, Pause, SkipBack, SkipForward, Maximize2 } from 'lucide-react';
import { MiniMapWidget } from '../../map/MiniMapWidget';
import { PremiumSpeedometer } from '../PremiumSpeedometer';
import { useMediaState, togglePlayPause, next, previous } from '../../../platform/mediaService';
import { useOBDSpeed, useOBDEngineTemp, useOBDFuelLevel, useOBDConnectionState } from '../../../platform/obdService';
import type { LayoutProps } from './LayoutProps';

export const MapFocusLayout = memo(function MapFocusLayout({
  settings,
  smart,
  appMap,
  handleLaunch,
  setFullMapOpen,
  fullMapOpen,
}: LayoutProps) {
  const { playing, track } = useMediaState();
  // Dar seçici hook'lar — yalnızca ilgili alan değişince re-render tetikler
  const connState      = useOBDConnectionState();
  const obdOk          = connState === 'connected';
  const speedRaw       = useOBDSpeed();
  const engineTempRaw  = useOBDEngineTemp();
  const fuelLevelRaw   = useOBDFuelLevel();
  const speed          = obdOk ? speedRaw      : 0;
  const engineTemp     = obdOk ? engineTempRaw : 0;
  const fuelLevel      = obdOk ? fuelLevelRaw  : 0;

  return (
    <div className="relative w-full h-full overflow-hidden rounded-[2.5rem]">

      {/* ── LAYER 0: Full-screen map — fullMapOpen true iken unmount (zombi önleme) ── */}
      <div className="absolute inset-0">
        {!fullMapOpen && <MiniMapWidget onFullScreenClick={() => setFullMapOpen(true)} />}
      </div>

      {/* ── LAYER 1: subtle vignette edges ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.4) 100%)',
        }}
      />
      <div
        className="absolute bottom-0 inset-x-0 h-64 pointer-events-none"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)' }}
      />

      {/* ── LAYER 2: top OBD data pill — kompakt ── */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-4 px-5 py-2 rounded-full glass-card border-white/8 pointer-events-none shadow-lg">
        <Pill label="HIZ" value={`${Math.round(speed || 0)}`} unit="km/h" />
        <div className="w-px h-6 bg-white/10" />
        <Pill label="MOTOR" value={`${engineTemp}`} unit="°C" warn={engineTemp > 100} />
        <div className="w-px h-6 bg-white/10" />
        <Pill label="YAKIT" value={`${Math.round(fuelLevel)}`} unit="%" warn={fuelLevel < 15} />
      </div>

      {/* ── LAYER 3: bottom-left — speed gauge ── */}
      {settings.widgetVisible.obd !== false && (
        <div className="absolute bottom-4 left-4 rounded-[2rem] glass-card border-blue-500/15 overflow-hidden shadow-xl"
          style={{ width: 176, height: 176 }}>
          <div className="absolute inset-0 bg-blue-500/5 pointer-events-none" />
          <PremiumSpeedometer compact numSize="sm" />
        </div>
      )}

      {/* ── LAYER 4: bottom-right — mini media card ── */}
      {settings.widgetVisible.media !== false && (
        <MediaMini playing={playing} track={track} />
      )}

      {/* ── LAYER 5: top-right controls (full-map + quick apps) ── */}
      <div className="absolute top-6 right-6 flex items-center gap-3">
        {/* Quick app icons */}
        {smart.dockIds.slice(0, 3).map((id) => {
          const app = appMap[id];
          if (!app) return null;
          return (
            <button
              key={id}
              onClick={() => handleLaunch(id)}
              title={app.name}
              className="w-12 h-12 rounded-2xl flex items-center justify-center glass-card border-white/10 hover:border-white/30 active:scale-90 transition-all shadow-xl"
            >
              <span className="text-2xl leading-none transition-transform duration-300 group-hover:scale-110">{app.icon}</span>
            </button>
          );
        })}
        {/* Full map */}
        <button
          onClick={() => setFullMapOpen(true)}
          className="w-12 h-12 rounded-2xl flex items-center justify-center glass-card border-white/10 transition-all active:scale-90 hover:border-white/30 shadow-xl"
        >
          <Maximize2 className="w-5 h-5 text-secondary" />
        </button>
      </div>
    </div>
  );
});

/* ── Tiny helpers ───────────────────────────────────────── */

const Pill = memo(function Pill({
  label, value, unit, warn = false,
}: { label: string; value: string; unit: string; warn?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[8px] font-black uppercase tracking-widest text-secondary">{label}</span>
      <span className={`text-sm font-black tabular-nums leading-none ${warn ? 'text-red-400' : 'text-primary'}`}>
        {value}<span className="text-[9px] font-semibold opacity-50 ml-0.5">{unit}</span>
      </span>
    </div>
  );
});

const MediaMini = memo(function MediaMini({
  playing,
  track,
}: {
  playing: boolean;
  track: { title: string; artist: string };
}) {
  return (
    <div
      className="absolute bottom-4 right-4 flex items-center gap-3 px-4 py-3 rounded-2xl border border-white/[0.10] backdrop-blur-2xl"
      style={{ background: 'rgba(0,0,0,0.55)', maxWidth: 260 }}
    >
      <div className="flex-1 min-w-0">
        <div className="text-primary text-sm font-bold truncate leading-tight">{track.title}</div>
        <div className="text-secondary text-xs truncate">{track.artist}</div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); previous(); }}
          className="w-8 h-8 flex items-center justify-center rounded-xl var(--panel-bg-secondary) hover:bg-white/15 active:scale-90 transition-all"
        >
          <SkipBack className="w-3.5 h-3.5 text-secondary" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); togglePlayPause(); }}
          className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/20 hover:var(--panel-bg-secondary) active:scale-90 transition-all"
          style={{ background: 'var(--pack-accent, rgba(255,255,255,0.12))' }}
        >
          {playing
            ? <Pause className="w-4 h-4 text-primary" />
            : <Play className="w-4 h-4 ml-0.5 text-primary fill-white" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); next(); }}
          className="w-8 h-8 flex items-center justify-center rounded-xl var(--panel-bg-secondary) hover:bg-white/15 active:scale-90 transition-all"
        >
          <SkipForward className="w-3.5 h-3.5 text-secondary" />
        </button>
      </div>
    </div>
  );
});


