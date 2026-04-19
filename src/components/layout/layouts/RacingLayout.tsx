/**
 * RacingLayout — Porsche / Redline — Track-day dominance.
 *
 * Structure:
 *   CENTER: Massive full-height speedometer (dominant)
 *   LEFT: RPM bar + temp/fuel strips (vertical instrument)
 *   RIGHT: Media + quick launch
 *   BOTTOM STRIP: Lap-timer style data bar
 */
import { memo } from 'react';
import { Play, Pause, SkipForward, SkipBack, Thermometer, Fuel } from 'lucide-react';
import { PremiumSpeedometer } from '../PremiumSpeedometer';
import { useMediaState, togglePlayPause, next, previous } from '../../../platform/mediaService';
import { useOBDRPM, useOBDEngineTemp, useOBDFuelLevel, useOBDConnectionState } from '../../../platform/obdService';
import type { LayoutProps } from './LayoutProps';

export const RacingLayout = memo(function RacingLayout({
  smart,
  appMap,
  handleLaunch,
}: LayoutProps) {
  const connState     = useOBDConnectionState();
  const obdOk         = connState === 'connected';
  const rpmRaw        = useOBDRPM();
  const engineTempRaw = useOBDEngineTemp();
  const fuelLevelRaw  = useOBDFuelLevel();
  const rpm           = obdOk ? rpmRaw        : 0;
  const engineTemp    = obdOk ? engineTempRaw : 0;
  const fuelLevel     = obdOk ? fuelLevelRaw  : 0;
  const { playing, track } = useMediaState();

  const accent    = `var(--pack-accent, #ef4444)`;
  const accentRgb = `var(--pack-accent-rgb, 239, 68, 68)`;

  const rpmPct = Math.min(100, (rpm / 8000) * 100);
  const tempPct = Math.min(100, ((engineTemp - 50) / 70) * 100);
  const fuelPct = Math.min(100, fuelLevel);

  return (
    <div className="flex gap-3 w-full h-full p-1 overflow-hidden">

      {/* ══ LEFT: Vertical instrument cluster ══ */}
      <div className="w-[110px] min-w-0 flex-shrink-0 flex flex-col gap-2.5 py-1">

        {/* RPM bar — vertical */}
        <div className="flex-1 min-h-0 rounded-[1.5rem] glass-card overflow-hidden shadow-xl flex flex-col relative"
          style={{ borderColor: `rgba(${accentRgb},0.35)` }}>
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: `linear-gradient(180deg, rgba(${accentRgb},0.08) 0%, transparent 60%)` }} />
          <div className="flex flex-col h-full px-3 py-4 gap-2 relative z-10">
            <span className="text-[8px] font-black uppercase tracking-[0.4em] opacity-60 text-white">RPM</span>
            {/* Vertical bar */}
            <div className="flex-1 relative flex items-end justify-center">
              <div className="absolute inset-x-0 bottom-0 rounded-full overflow-hidden" style={{ height: '100%', background: 'rgba(255,255,255,0.05)' }}>
                <div
                  className="absolute bottom-0 inset-x-0 rounded-full transition-all duration-300"
                  style={{
                    height: `${rpmPct}%`,
                    background: `linear-gradient(to top, rgba(${accentRgb},0.9), rgba(${accentRgb},0.4))`,
                    boxShadow: `0 0 20px rgba(${accentRgb},0.5)`,
                  }}
                />
              </div>
            </div>
            <span className="text-[11px] font-black text-white text-center leading-none">
              {rpm > 0 ? (rpm / 1000).toFixed(1) : '0.0'}
              <span className="text-[8px] opacity-50">k</span>
            </span>
          </div>
        </div>

        {/* Temp gauge — compact */}
        <RacingGauge
          icon={<Thermometer className="w-3 h-3" />}
          label="°C"
          value={engineTemp > 0 ? `${engineTemp}` : '—'}
          pct={tempPct}
          warn={engineTemp > 100}
          accentRgb={accentRgb}
        />

        {/* Fuel gauge — compact */}
        <RacingGauge
          icon={<Fuel className="w-3 h-3" />}
          label="%"
          value={fuelLevel > 0 ? `${Math.round(fuelLevel)}` : '—'}
          pct={fuelPct}
          warn={fuelLevel < 15}
          accentRgb={accentRgb}
          invert
        />
      </div>

      {/* ══ CENTER: Massive speedometer ══ */}
      <div className="flex-[2.2] min-w-0 min-h-0 rounded-[2.5rem] overflow-hidden relative group glass-card shadow-2xl"
        style={{ borderColor: `rgba(${accentRgb},0.35)`, borderTopWidth: 2 }}>

        {/* Racing grid background */}
        <div className="dynamic-road-grid opacity-40">
          <div className="grid-lines" />
          <div className="road-glow" />
        </div>

        {/* Top accent line */}
        <div className="absolute top-0 inset-x-0 h-0.5 pointer-events-none"
          style={{ background: `linear-gradient(90deg, transparent, rgba(${accentRgb},0.8), transparent)` }} />

        {/* Radial glow */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(ellipse at 50% 60%, rgba(${accentRgb},0.12) 0%, transparent 65%)` }} />

        <div className="flex-1 w-full h-full">
          <PremiumSpeedometer numSize="xl" />
        </div>

        {/* Bottom: speed label */}
        <div className="absolute bottom-3 inset-x-0 flex justify-center pointer-events-none">
          <div className="px-4 py-1 rounded-full"
            style={{ background: `rgba(${accentRgb},0.15)`, border: `1px solid rgba(${accentRgb},0.3)` }}>
            <span className="text-[10px] font-black uppercase tracking-[0.5em]" style={{ color: accent }}>HIZOMETRE</span>
          </div>
        </div>
      </div>

      {/* ══ RIGHT: Media + apps ══ */}
      <div className="flex-[0.95] min-w-0 min-h-0 flex flex-col gap-2.5">

        {/* Track info */}
        <div className="flex-1 min-h-0 rounded-[2.5rem] glass-card overflow-hidden shadow-xl relative px-5 py-4 flex flex-col justify-between"
          style={{ borderColor: `rgba(${accentRgb},0.28)` }}>
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: `linear-gradient(160deg, rgba(${accentRgb},0.10) 0%, transparent 55%)` }} />
          <div className="relative z-10">
            <span className="text-[8px] font-black uppercase tracking-[0.5em] opacity-60" style={{ color: accent }}>MEDYA</span>
            <div className="mt-2 text-white font-black text-sm leading-tight line-clamp-2">
              {track.title || <span className="opacity-30">Müzik Yok</span>}
            </div>
            <div className="text-[10px] uppercase tracking-widest mt-1 opacity-60 text-white truncate">
              {track.artist || ''}
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 relative z-10">
            <MediaBtn onClick={previous}><SkipBack className="w-4 h-4" /></MediaBtn>
            <button
              onClick={(e) => { e.stopPropagation(); togglePlayPause(); }}
              className="w-12 h-12 rounded-2xl flex items-center justify-center active:scale-90 transition-all shadow-lg"
              style={{
                background: `rgba(${accentRgb},0.22)`,
                border: `1px solid rgba(${accentRgb},0.45)`,
                boxShadow: `0 0 20px rgba(${accentRgb},0.20)`,
              }}
            >
              {playing
                ? <Pause className="w-5 h-5 text-white" />
                : <Play className="w-5 h-5 ml-0.5 text-white fill-white" />}
            </button>
            <MediaBtn onClick={next}><SkipForward className="w-4 h-4" /></MediaBtn>
          </div>
        </div>

        {/* Quick apps */}
        <div className="flex-shrink-0 rounded-[2rem] glass-card overflow-hidden shadow-xl"
          style={{ borderColor: `rgba(${accentRgb},0.22)` }}>
          <div className="grid grid-cols-2 gap-1 p-2">
            {smart.dockIds.slice(0, 4).map(id => {
              const app = appMap[id];
              if (!app) return null;
              return (
                <button
                  key={id}
                  onClick={() => handleLaunch(id)}
                  className="flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl active:scale-90 transition-all"
                  style={{ background: `rgba(${accentRgb},0.06)` }}
                >
                  <span className="text-xl">{app.icon}</span>
                  <span className="text-[8px] font-bold uppercase tracking-wide text-white opacity-70">{app.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});

function RacingGauge({
  icon, label, value, pct, warn, accentRgb, invert = false,
}: { icon: React.ReactNode; label: string; value: string; pct: number; warn?: boolean; accentRgb: string; invert?: boolean }) {
  const barColor = warn ? '239, 68, 68' : accentRgb;
  return (
    <div className="flex-shrink-0 h-[70px] rounded-[1.2rem] glass-card overflow-hidden shadow-lg relative px-3 py-2"
      style={{ borderColor: `rgba(${accentRgb},0.28)` }}>
      <div className="flex items-center justify-between mb-1.5">
        <span style={{ color: `rgba(${accentRgb},0.8)` }}>{icon}</span>
        <span className={`text-[10px] font-black leading-none ${warn ? 'text-red-400' : 'text-white'}`}>{value}<span className="text-[8px] opacity-50 ml-0.5">{label}</span></span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${invert ? pct : pct}%`,
            background: `linear-gradient(90deg, rgba(${barColor},0.6), rgba(${barColor},1))`,
            boxShadow: `0 0 8px rgba(${barColor},0.4)`,
          }}
        />
      </div>
    </div>
  );
}

function MediaBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-90 transition-all text-white/70 hover:text-white"
      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
    >
      {children}
    </button>
  );
}
