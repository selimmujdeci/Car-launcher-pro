/**
 * SportLayout — Cyberpunk / Galaxy / Electric / Carbon / Night-City — Glass Edition
 */
import { memo } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { PremiumSpeedometer } from '../PremiumSpeedometer';
import { useMediaState, togglePlayPause, next, previous } from '../../../platform/mediaService';
import { useOBDState } from '../../../platform/obdService';
import type { LayoutProps } from './LayoutProps';
import type { AppItem } from '../../../data/apps';

export const SportLayout = memo(function SportLayout({
  smart,
  appMap,
  handleLaunch,
}: LayoutProps) {
  const { playing, track } = useMediaState();
  const { rpm: rpmRaw, engineTemp: engineTempRaw, fuelLevel: fuelLevelRaw, connectionState } = useOBDState();
  const obdOk = connectionState === 'connected';
  const rpm        = obdOk ? rpmRaw        : 0;
  const engineTemp = obdOk ? engineTempRaw : 0;
  const fuelLevel  = obdOk ? fuelLevelRaw  : 0;
  const apps = smart.dockIds.slice(0, 4).map((id) => ({ id, app: appMap[id] })).filter((x) => x.app);

  return (
    <div className="flex gap-3 w-full h-full p-1 overflow-hidden">

      {/* ══ LEFT: Stripped media ══ */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col justify-between px-5 py-6 rounded-[2rem] glass-card shadow-2xl relative overflow-hidden"
        style={{ borderColor: 'rgba(var(--pack-accent-rgb,167,139,250),0.35)', borderTopWidth: 2 }}>
        {/* Accent gradient overlay */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(160deg, rgba(var(--pack-accent-rgb,167,139,250),0.10) 0%, transparent 50%)' }} />
        {/* Track info */}
        <div className="flex flex-col gap-2 relative z-10">
          <div className="text-[10px] font-black uppercase tracking-[0.4em]"
            style={{ color: 'var(--pack-accent,#a78bfa)', opacity: 0.9 }}>
            MEDYA
          </div>
          <div className="text-primary text-lg font-black leading-tight line-clamp-2 drop-shadow-md">
            {track.title || <span className="opacity-30">Müzik Yok</span>}
          </div>
          <div className="text-secondary text-[11px] font-black uppercase tracking-widest truncate mt-1 opacity-70">
            {track.artist || <span className="opacity-50">—</span>}
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-4 relative z-10">
          <div className="flex items-center justify-center gap-3">
            <SportBtn onClick={previous}><SkipBack className="w-5 h-5" /></SportBtn>
            <button
              onClick={(e) => { e.stopPropagation(); togglePlayPause(); }}
              className="w-14 h-14 rounded-2xl flex items-center justify-center glass-card border-white/20 active:scale-90 transition-all shadow-xl"
              style={{ background: 'rgba(var(--pack-accent-rgb,167,139,250),0.20)' }}
            >
              {playing ? <Pause className="w-6 h-6 text-primary" /> : <Play className="w-6 h-6 ml-1 text-primary fill-white" />}
            </button>
            <SportBtn onClick={next}><SkipForward className="w-5 h-5" /></SportBtn>
          </div>
        </div>
      </div>

      {/* ══ CENTER: MASSIVE gauge ══ */}
      <div className="flex-[2.2] min-w-0 min-h-0 flex flex-col relative group">
        <div className="dynamic-road-grid opacity-30 group-hover:opacity-40 transition-opacity pointer-events-none">
          <div className="grid-lines" />
          <div className="road-glow" />
        </div>

        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center 45%, rgba(59, 130, 246, 0.1) 0%, transparent 70%)',
          }}
        />
        <div className="flex-1 min-h-0">
          <PremiumSpeedometer numSize="xl" />
        </div>

        <div className="flex-shrink-0 flex items-center justify-center gap-8 pb-4">
          <SportOBDChip label="RPM" value={rpm.toLocaleString()} />
          <SportOBDChip label="SICAKLIK" value={`${engineTemp}°C`} warn={engineTemp > 100} />
          <SportOBDChip label="YAKIT" value={`${Math.round(fuelLevel)}%`} warn={fuelLevel < 15} />
        </div>
      </div>

      {/* ══ RIGHT: Stripped shortcuts ══ */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-3 px-3 py-6 rounded-[2rem] glass-card shadow-2xl relative overflow-hidden"
        style={{ borderColor: 'rgba(var(--pack-accent-rgb,167,139,250),0.35)', borderTopWidth: 2 }}>
        {/* Accent gradient overlay */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(200deg, rgba(var(--pack-accent-rgb,167,139,250),0.10) 0%, transparent 50%)' }} />
        <div className="text-[10px] font-black uppercase tracking-[0.4em] px-2 mb-2 relative z-10"
          style={{ color: 'var(--pack-accent,#a78bfa)', opacity: 0.9 }}>
          HIZLI ERİŞİM
        </div>
        <div className="flex-1 grid grid-rows-4 gap-2 min-h-0 relative z-10">
          {apps.map(({ id, app }) => (
            <button
              key={id}
              onClick={() => handleLaunch(id)}
              className="flex items-center gap-3 px-4 rounded-2xl glass-card active:scale-[0.97] transition-all overflow-hidden group"
              style={{ borderColor: 'rgba(var(--pack-accent-rgb,167,139,250),0.18)' }}
            >
              <span className="text-2xl leading-none flex-shrink-0 group-hover:scale-110 transition-transform">{(app as AppItem).icon}</span>
              <span className="text-[10px] font-black uppercase tracking-[0.15em] truncate transition-colors group-hover:text-primary"
                style={{ color: 'var(--text-secondary,#94a3b8)' }}>{(app as AppItem).name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

function SportBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="w-9 h-9 rounded-xl flex items-center justify-center border border-white/20 text-secondary hover:text-primary hover:bg-white/20 active:scale-90 transition-all"
      style={{ background: 'rgba(var(--pack-accent-rgb,167,139,250),0.12)' }}
    >
      {children}
    </button>
  );
}

const SportOBDChip = memo(function SportOBDChip({
  label, value, warn = false,
}: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[7px] font-black uppercase tracking-widest text-secondary">{label}</span>
      <span className={`text-xs font-black tabular-nums leading-none ${warn ? 'text-red-400' : 'text-secondary'}`}>{value}</span>
    </div>
  );
});


