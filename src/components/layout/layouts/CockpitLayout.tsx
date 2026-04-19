/**
 * CockpitLayout — BMW / Audi / Porsche / Redline — Glass Edition
 */
import { memo } from 'react';
import { SkipBack, SkipForward, Play, Pause, Gauge, Thermometer, Fuel } from 'lucide-react';
import { PremiumSpeedometer } from '../PremiumSpeedometer';
import { MiniMapWidget } from '../../map/MiniMapWidget';
import { useMediaState, togglePlayPause, next, previous } from '../../../platform/mediaService';
import { useOBDRPM, useOBDEngineTemp, useOBDFuelLevel, useOBDConnectionState } from '../../../platform/obdService';
import type { LayoutProps } from './LayoutProps';
import type { MusicOptionKey } from '../../../data/apps';
import { MUSIC_OPTIONS } from '../../../data/apps';

export const CockpitLayout = memo(function CockpitLayout({
  settings,
  smart,
  appMap,
  handleLaunch,
  setFullMapOpen,
  fullMapOpen,
}: LayoutProps) {
  const connState      = useOBDConnectionState();
  const obdOk          = connState === 'connected';
  const rpmRaw         = useOBDRPM();
  const engineTempRaw  = useOBDEngineTemp();
  const fuelLevelRaw   = useOBDFuelLevel();
  const rpm            = obdOk ? rpmRaw        : 0;
  const engineTemp     = obdOk ? engineTempRaw : 0;
  const fuelLevel      = obdOk ? fuelLevelRaw  : 0;
  const { playing, track } = useMediaState();
  const music = MUSIC_OPTIONS[settings.defaultMusic as MusicOptionKey];

  return (
    <div className="flex gap-3 w-full h-full p-1 overflow-hidden">

      {/* ══ LEFT: Instrument cluster ══ */}
      <div className="flex-[1.2] min-w-0 min-h-0 flex flex-col gap-3">

        {/* OBD data strip */}
        <div className="flex-shrink-0 flex items-center justify-around px-6 py-3 rounded-[2rem] glass-card shadow-xl relative overflow-hidden"
          style={{ borderColor: 'rgba(var(--pack-accent-rgb,59,130,246),0.30)' }}>
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: 'linear-gradient(90deg, rgba(var(--pack-accent-rgb,59,130,246),0.06) 0%, transparent 60%)' }} />
          <OBDMetric icon={<Gauge className="w-4 h-4" />} label="RPM" value={rpm.toLocaleString()} />
          <div className="w-px h-8 bg-white/10" />
          <OBDMetric
            icon={<Thermometer className="w-4 h-4" />}
            label="MOTOR"
            value={`${engineTemp}°C`}
            warn={engineTemp > 100}
          />
          <div className="w-px h-8 bg-white/10" />
          <OBDMetric
            icon={<Fuel className="w-4 h-4" />}
            label="YAKIT"
            value={`${Math.round(fuelLevel)}%`}
            warn={fuelLevel < 15}
          />
        </div>

        {/* Speedometer */}
        <div className="flex-1 min-h-0 rounded-[2.5rem] glass-card overflow-hidden relative group shadow-2xl"
          style={{ borderColor: 'rgba(var(--pack-accent-rgb,59,130,246),0.28)' }}>
          <div className="absolute inset-0 bg-gradient-to-b from-[rgba(var(--pack-accent-rgb,59,130,246),0.06)] to-transparent pointer-events-none" />
          <div className="dynamic-road-grid opacity-30">
            <div className="grid-lines" />
            <div className="road-glow" />
          </div>
          <PremiumSpeedometer numSize="xl" />
        </div>
      </div>

      {/* ══ RIGHT: Map + Media ══ */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-3">

        {/* Mini map */}
        <div className="flex-[1.4] min-h-0 rounded-[2.5rem] overflow-hidden glass-card relative shadow-2xl"
          style={{ borderColor: 'rgba(var(--pack-accent-rgb,59,130,246),0.22)' }}>
          {!fullMapOpen && <MiniMapWidget onFullScreenClick={() => setFullMapOpen(true)} />}
          {/* Map overlay label */}
          <div className="absolute top-3 left-4 px-3 py-1.5 rounded-xl pointer-events-none z-10"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(12px)' }}>
            <span className="text-[10px] font-black uppercase tracking-[0.3em]"
              style={{ color: 'var(--pack-accent,#3b82f6)' }}>Harita</span>
          </div>
        </div>

        {/* Media panel */}
        <div className="flex-1 min-h-0 rounded-[2.5rem] glass-card overflow-hidden shadow-2xl relative"
          style={{ borderColor: 'rgba(var(--pack-accent-rgb,59,130,246),0.22)' }}>
          {/* Subtle accent gradient */}
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: 'linear-gradient(135deg, rgba(var(--pack-accent-rgb,59,130,246),0.08) 0%, transparent 55%)' }} />
          <div className="flex flex-col h-full px-5 py-3 gap-2 relative z-10">
            <div className="flex-1 min-h-0 flex items-center gap-3">
              <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ background: music.color }} />
              <div className="min-w-0">
                <div className="text-[9px] font-black uppercase tracking-[0.4em] mb-0.5"
                  style={{ color: music.color, opacity: 0.85 }}>MÜZİK</div>
                <div className="text-primary font-black text-lg leading-tight truncate drop-shadow-md">
                  {track.title || 'Müzik Seçilmedi'}
                </div>
                <div className="text-secondary text-[10px] font-black uppercase tracking-[0.2em] truncate mt-0.5 opacity-70">
                  {track.artist || 'Sanatçı'}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-center gap-3 flex-shrink-0 pb-1">
              <button onClick={(e) => { e.stopPropagation(); previous(); }}
                className="w-9 h-9 flex items-center justify-center rounded-xl text-secondary hover:text-primary active:scale-90 transition-all border"
                style={{ background: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.12)' }}>
                <SkipBack className="w-4 h-4" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); togglePlayPause(); }}
                className="w-12 h-12 flex items-center justify-center rounded-2xl text-primary active:scale-90 transition-all border border-white/20 shadow-lg"
                style={{ background: music.color, boxShadow: `0 6px 20px -4px ${music.color}80` }}>
                {playing ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 ml-0.5 fill-white" />}
              </button>
              <button onClick={(e) => { e.stopPropagation(); next(); }}
                className="w-9 h-9 flex items-center justify-center rounded-xl text-secondary hover:text-primary active:scale-90 transition-all border"
                style={{ background: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.12)' }}>
                <SkipForward className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Quick-launch shortcuts */}
        <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-[2rem] glass-card shadow-xl"
          style={{ borderColor: 'rgba(var(--pack-accent-rgb,59,130,246),0.20)' }}>
          {smart.dockIds.slice(0, 5).map((id) => {
            const app = appMap[id];
            if (!app) return null;
            return (
              <button
                key={id}
                onClick={() => handleLaunch(id)}
                className="flex flex-col items-center gap-1.5 flex-1 py-2 rounded-2xl active:scale-90 transition-all group"
                style={{ background: 'rgba(var(--pack-accent-rgb,59,130,246),0.08)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(var(--pack-accent-rgb,59,130,246),0.16)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(var(--pack-accent-rgb,59,130,246),0.08)')}
              >
                <span className="text-2xl leading-none group-hover:scale-110 transition-transform">{app.icon}</span>
                <span className="text-[8px] font-black uppercase tracking-widest text-secondary group-hover:text-primary truncate w-full text-center px-1 transition-colors">{app.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});

/* ── OBD Metric chip ── */
const OBDMetric = memo(function OBDMetric({
  icon, label, value, warn = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 relative z-10">
      <span className={warn ? 'text-red-400' : 'text-secondary'}>{icon}</span>
      <div className="flex flex-col">
        <span className="text-[8px] font-black uppercase tracking-widest text-secondary opacity-60">{label}</span>
        <span className={`text-sm font-black tabular-nums leading-none ${warn ? 'text-red-400' : 'text-primary'}`}>
          {value}
        </span>
      </div>
    </div>
  );
});
