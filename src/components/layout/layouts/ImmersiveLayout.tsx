/**
 * ImmersiveLayout — Galaxy / Midnight / Night-City / Ambient
 *
 * Full-screen atmospheric experience. NO hard grid.
 * Floating glass panels over a vivid background.
 *
 * Structure:
 *   BACKGROUND: Atmospheric full-screen gradient (uses --pack-bg)
 *   FLOATING CENTER: Speedometer — large and centered
 *   FLOATING LEFT: Speed/OBD data — translucent vertical card
 *   FLOATING RIGHT: Media — floating glass card
 *   FLOATING BOTTOM: App shortcuts row
 */
import { memo } from 'react';
import { Play, Pause, SkipForward, SkipBack } from 'lucide-react';
import { PremiumSpeedometer } from '../PremiumSpeedometer';
import { useMediaState, togglePlayPause, next, previous } from '../../../platform/mediaService';
import { useOBDSpeed, useOBDEngineTemp, useOBDFuelLevel, useOBDConnectionState } from '../../../platform/obdService';
import type { LayoutProps } from './LayoutProps';

export const ImmersiveLayout = memo(function ImmersiveLayout({
  smart,
  appMap,
  handleLaunch,
}: LayoutProps) {
  const connState     = useOBDConnectionState();
  const obdOk         = connState === 'connected';
  const speedRaw      = useOBDSpeed();
  const engineTempRaw = useOBDEngineTemp();
  const fuelLevelRaw  = useOBDFuelLevel();
  const speed         = obdOk ? speedRaw      : 0;
  const engineTemp    = obdOk ? engineTempRaw : 0;
  const fuelLevel     = obdOk ? fuelLevelRaw  : 0;
  const { playing, track } = useMediaState();

  const accent    = `var(--pack-accent, #a78bfa)`;
  const accentRgb = `var(--pack-accent-rgb, 167, 139, 250)`;

  return (
    <div className="relative w-full h-full overflow-hidden">

      {/* ── Atmospheric particle effect overlay ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute w-[600px] h-[600px] rounded-full -top-[200px] -left-[100px] opacity-25"
          style={{ background: `radial-gradient(circle, rgba(${accentRgb},0.4) 0%, transparent 65%)`, animation: 'blob-pulse 8s ease-in-out infinite' }} />
        <div className="absolute w-[400px] h-[400px] rounded-full -bottom-[100px] -right-[50px] opacity-20"
          style={{ background: `radial-gradient(circle, rgba(${accentRgb},0.3) 0%, transparent 65%)`, animation: 'blob-pulse 10s ease-in-out infinite reverse' }} />
      </div>

      {/* ── LEFT: Compact data card ── */}
      <div
        className="absolute left-3 top-3 bottom-[90px] w-[120px] rounded-[2rem] flex flex-col gap-3 px-4 py-5 z-10"
        style={{
          background: `rgba(0,0,0,0.38)`,
          backdropFilter: 'blur(20px)',
          border: `1px solid rgba(${accentRgb},0.25)`,
          boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 30px rgba(${accentRgb},0.08)`,
        }}
      >
        <DataPill label="HIZ" value={`${speed}`} unit="km/h" accent={accent} accentRgb={accentRgb} />
        <div className="w-full h-px opacity-10" style={{ background: accent }} />
        <DataPill
          label="MOTOR"
          value={engineTemp > 0 ? `${engineTemp}` : '—'}
          unit="°C"
          accent={accent}
          accentRgb={accentRgb}
          warn={engineTemp > 100}
        />
        <div className="w-full h-px opacity-10" style={{ background: accent }} />
        <DataPill
          label="YAKIT"
          value={fuelLevel > 0 ? `${Math.round(fuelLevel)}` : '—'}
          unit="%"
          accent={accent}
          accentRgb={accentRgb}
          warn={fuelLevel < 15}
        />

        {/* Fuel bar */}
        <div className="mt-auto">
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, fuelLevel)}%`,
                background: fuelLevel < 15
                  ? 'rgba(239,68,68,0.8)'
                  : `linear-gradient(90deg, rgba(${accentRgb},0.6), rgba(${accentRgb},1))`,
                boxShadow: `0 0 8px rgba(${accentRgb},0.4)`,
              }}
            />
          </div>
        </div>
      </div>

      {/* ── CENTER: Massive speedometer ── */}
      <div className="absolute inset-0 flex items-center justify-center z-10"
        style={{ left: 138, right: 200 }}>
        <div className="w-full h-full max-w-[420px] relative">
          {/* Glow ring behind speedo */}
          <div className="absolute inset-0 pointer-events-none rounded-full"
            style={{
              background: `radial-gradient(circle, rgba(${accentRgb},0.10) 0%, transparent 70%)`,
              filter: 'blur(30px)',
            }} />
          <PremiumSpeedometer numSize="xl" />
        </div>
      </div>

      {/* ── RIGHT: Media floating card ── */}
      <div
        className="absolute right-3 top-3 w-[185px] rounded-[2rem] flex flex-col gap-3 px-4 py-5 z-10"
        style={{
          background: `rgba(0,0,0,0.42)`,
          backdropFilter: 'blur(22px)',
          border: `1px solid rgba(${accentRgb},0.28)`,
          boxShadow: `0 8px 40px rgba(0,0,0,0.45), 0 0 30px rgba(${accentRgb},0.10)`,
        }}
      >
        <span className="text-[8px] font-black uppercase tracking-[0.5em] opacity-50 text-white">Müzik</span>

        <div className="flex-1 min-h-0">
          <div className="text-white font-black text-sm leading-tight line-clamp-2">
            {track.title || <span className="opacity-20">Seçilmedi</span>}
          </div>
          <div className="text-[10px] uppercase tracking-wider mt-1 opacity-50 truncate text-white">
            {track.artist || ''}
          </div>
        </div>

        {/* Animated waveform placeholder */}
        <div className="flex items-end gap-0.5 h-6 justify-center">
          {[0.4, 0.7, 1, 0.6, 0.9, 0.5, 0.8, 0.45, 0.7, 1].map((h, i) => (
            <div
              key={i}
              className="w-1 rounded-full flex-shrink-0"
              style={{
                height: `${h * 100}%`,
                background: `rgba(${accentRgb},${playing ? 0.8 : 0.25})`,
                animation: playing ? `wave ${0.5 + i * 0.1}s ease-in-out infinite alternate` : 'none',
              }}
            />
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between gap-1">
          <button onClick={(e) => { e.stopPropagation(); previous(); }}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-white/60 hover:text-white transition-colors active:scale-90"
            style={{ background: 'rgba(255,255,255,0.05)' }}>
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); togglePlayPause(); }}
            className="w-11 h-11 rounded-2xl flex items-center justify-center active:scale-90 transition-all shadow-lg"
            style={{
              background: `rgba(${accentRgb},0.22)`,
              border: `1px solid rgba(${accentRgb},0.45)`,
              boxShadow: `0 0 20px rgba(${accentRgb},0.25)`,
            }}
          >
            {playing
              ? <Pause className="w-4 h-4 text-white" />
              : <Play className="w-4 h-4 ml-0.5 text-white fill-white" />}
          </button>
          <button onClick={(e) => { e.stopPropagation(); next(); }}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-white/60 hover:text-white transition-colors active:scale-90"
            style={{ background: 'rgba(255,255,255,0.05)' }}>
            <SkipForward className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── BOTTOM: App shortcuts floating row ── */}
      <div
        className="absolute bottom-2 left-[138px] right-[200px] rounded-[1.8rem] flex items-center justify-around px-6 py-3 z-10"
        style={{
          background: `rgba(0,0,0,0.40)`,
          backdropFilter: 'blur(18px)',
          border: `1px solid rgba(${accentRgb},0.20)`,
          boxShadow: `0 4px 24px rgba(0,0,0,0.4)`,
        }}
      >
        {smart.dockIds.slice(0, 5).map(id => {
          const app = appMap[id];
          if (!app) return null;
          return (
            <button
              key={id}
              onClick={() => handleLaunch(id)}
              className="flex flex-col items-center gap-1 active:scale-90 transition-all px-3 py-1.5 rounded-2xl"
              style={{ background: `rgba(${accentRgb},0.07)` }}
            >
              <span className="text-2xl">{app.icon}</span>
              <span className="text-[8px] font-bold uppercase tracking-wide text-white opacity-60">{app.name}</span>
            </button>
          );
        })}
      </div>

    </div>
  );
});

function DataPill({
  label, value, unit, warn = false,
}: { label: string; value: string; unit: string; accent?: string; accentRgb?: string; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[7px] font-black uppercase tracking-[0.4em] opacity-50 text-white">{label}</span>
      <div className="flex items-baseline gap-1">
        <span className={`text-lg font-black leading-none ${warn ? 'text-red-400' : 'text-white'}`}>{value}</span>
        <span className="text-[8px] opacity-50 text-white">{unit}</span>
      </div>
    </div>
  );
}
