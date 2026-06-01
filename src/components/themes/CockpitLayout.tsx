import { memo, useState, lazy, Suspense, useEffect } from 'react';
import { DockBar } from '../layout/DockBar';
import {
  SkipBack, SkipForward,
  Settings, Mic, LayoutGrid,
  Music2, Activity,
  Gauge, Cpu, Compass as CompassIcon,
} from 'lucide-react';

const VoiceAssistant = lazy(() => import('../modals/VoiceAssistant').then(m => ({ default: m.VoiceAssistant })));
import { useStore } from '../../store/useStore';
import { useMediaState, togglePlayPause, next, previous, startMediaHub, stopMediaHub } from '../../platform/mediaService';
import { useOBDState } from '../../platform/obdService';
import { useGPSLocation, resolveSpeedKmh } from '../../platform/gpsService';
import { useClock } from '../../hooks/useClock';
import { useDeviceStatus } from '../../platform/deviceApi';
import { MiniMapWidget } from '../map/MiniMapWidget';
import { type AppItem } from '../../data/apps';
import type { SmartSnapshot } from '../../platform/smartEngine';
import { MagicContextCard } from '../common/MagicContextCard';

/* ══════════════════════════════════════════════════════════════
   HYPER-GT DIGITAL COCKPIT — Professional Redesign
   Inspired by Porsche Taycan & Audi Virtual Cockpit
   Colors: Carbon Black, Neon Cyan (#00E5FF), Racing Amber (#FF9800)
   ══════════════════════════════════════════════════════════════ */

interface Props {
  onOpenMap:      () => void;
  onOpenApps:     () => void;
  onOpenSettings: () => void;
  onLaunch:       (id: string) => void;
  appMap:         Record<string, AppItem>;
  dockIds:        string[];
  fullMapOpen?:   boolean;
  smart?:         SmartSnapshot;
}

const C_ACCENT  = '#00E5FF';   // Cockpit tek sinyatür aksanı (Neon Cyan)
const C_RED     = '#FF3B30';   // semantik uyarı (rpm/fuel/temp/voltage)

/* ── Keyframes (Injected via Style Tag) ───────────────────── */
const STYLE_ID = 'hyper-gt-styles';
const injectStyles = () => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.innerHTML = `
    @keyframes gt-mic-pulse {
      0% { box-shadow: 0 0 0 0 rgba(0, 229, 255, 0.4); }
      70% { box-shadow: 0 0 0 10px rgba(0, 229, 255, 0); }
      100% { box-shadow: 0 0 0 0 rgba(0, 229, 255, 0); }
    }
    @keyframes gt-scanline {
      0% { transform: translateY(-100%); }
      100% { transform: translateY(100%); }
    }
    @keyframes gt-glow {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 0.8; }
    }
    .gt-glass {
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .gt-glow-text {
      text-shadow: 0 0 15px rgba(0,229,255,0.5);
    }
  `;
  document.head.appendChild(style);
};

/* ── Common Components ─────────────────────────────────────── */
const Panel = memo(({ children, title, icon: Icon, accent = C_ACCENT }: { children: React.ReactNode; title: string; icon: any; accent?: string }) => (
  <div className="gt-glass flex flex-col h-full rounded-xl overflow-hidden relative shadow-2xl">
    <div className="flex items-center justify-between px-4 py-3 bg-white/[0.02] border-b border-white/5">
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
        <span className="text-[10px] font-black tracking-[0.2em] uppercase text-white/40">{title}</span>
      </div>
      <div className="w-1.5 h-1.5 rounded-full" style={{ background: accent, boxShadow: `0 0 8px ${accent}` }} />
    </div>
    <div className="flex-1 min-h-0 relative">
      {children}
    </div>
  </div>
));

/* ── GT_Glareshield (Header) ──────────────────────────────── */
const GT_Glareshield = memo(({ onOpenApps, onOpenSettings, onVoice }: { onOpenApps: () => void; onOpenSettings: () => void; onVoice: () => void }) => {
  const use24Hour = useStore(s => s.settings.use24Hour);
  const { time, date } = useClock(use24Hour, true);
  void useDeviceStatus();

  return (
    <div className="flex items-center justify-between px-6 py-3 bg-black/40 border-b border-white/5 backdrop-blur-md z-50">
      <div className="flex items-center gap-6">
        <div className="flex flex-col">
          <span className="text-[14px] font-black tracking-widest text-white leading-none">HYPER-GT</span>
          <span className="text-[8px] font-bold text-white/30 tracking-[0.3em] uppercase mt-1">Digital Ecosystem</span>
        </div>
        
        <div className="flex items-center gap-3 ml-4 bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
          <Cpu className="w-3 h-3 text-cyan-400" />
          <div className="flex gap-1">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className={`w-1 h-3 rounded-full ${i <= 3 ? 'bg-cyan-400' : 'bg-white/10'}`} />
            ))}
          </div>
          <span className="text-[9px] font-bold text-cyan-400/80 uppercase">Core Optimal</span>
        </div>
      </div>

      <div className="flex flex-col items-center">
        <span className="text-2xl font-black tracking-tighter tabular-nums text-white gt-glow-text">{time}</span>
        <span className="text-[9px] font-bold text-white/20 tracking-[0.5em] uppercase -mt-1">{date}</span>
      </div>

      <div className="flex items-center gap-4">
        <button onClick={onVoice} className="relative group">
          <div className="absolute inset-0 bg-cyan-500/20 rounded-full blur-md opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center relative z-10 animate-[gt-mic-pulse_2s_infinite]">
            <Mic className="w-5 h-5 text-cyan-400" />
          </div>
        </button>

        <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl">
          <button onClick={onOpenSettings} className="p-2 hover:bg-white/5 rounded-lg transition-colors">
            <Settings className="w-4 h-4 text-white/40" />
          </button>
          <button onClick={onOpenApps} className="p-2 hover:bg-white/5 rounded-lg transition-colors">
            <LayoutGrid className="w-4 h-4 text-white/40" />
          </button>
        </div>
      </div>
    </div>
  );
});

/* ── GT_Cluster (Center) ─────────────────────────────────── */
const GT_Cluster = memo(() => {
  const obd = useOBDState();
  const gps = useGPSLocation();
  const speedKmh = Math.round(resolveSpeedKmh(gps, obd.speed ?? 0));
  const rpm = obd.rpm ?? 0;
  
  const rpmPct = Math.min(rpm / 7000, 1);

  return (
    <Panel title="Performance" icon={Gauge}>
      <div className="flex items-center justify-center h-full relative p-6">
        {/* Dynamic RPM Ring */}
        <div className="relative w-64 h-64">
          <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90">
            <circle cx="100" cy="100" r="90" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="8" />
            <circle 
              cx="100" cy="100" r="90" 
              fill="none" 
              stroke={rpmPct > 0.85 ? C_RED : C_ACCENT} 
              strokeWidth="8" 
              strokeDasharray="565"
              strokeDashoffset={565 - (rpmPct * 420)} // 270 deg span
              className="transition-all duration-300 ease-out"
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 12px ${rpmPct > 0.85 ? C_RED : C_ACCENT}40)` }}
            />
          </svg>
          
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10rem] font-black leading-none tracking-tighter text-white gt-glow-text">
              {speedKmh}
            </span>
            <span className="text-sm font-black text-cyan-400 tracking-[0.8em] uppercase -mt-4">KM/H</span>
          </div>
        </div>

        {/* Side Metrics */}
        <div className="absolute bottom-4 left-6 flex flex-col gap-1">
          <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Power</span>
          <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-cyan-400 shadow-[0_0_8px_#00e5ff]" style={{ width: `${Math.min(speedKmh/2, 100)}%` }} />
          </div>
        </div>
        
        <div className="absolute bottom-4 right-6 flex flex-col items-end gap-1">
          <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">RPM x1000</span>
          <span className="text-xl font-black text-white">{(rpm/1000).toFixed(1)}</span>
        </div>
      </div>
    </Panel>
  );
});

/* ── GT_Navigation (Left) ─────────────────────────────────── */
const GT_Navigation = memo(({ onOpenMap, fullMapOpen }: { onOpenMap: () => void; fullMapOpen?: boolean }) => {
  const gps = useGPSLocation();
  const heading = Math.round(gps?.heading ?? 0);

  return (
    <Panel title="Navigation" icon={CompassIcon} accent={C_ACCENT}>
      <div className="w-full h-full relative overflow-hidden rounded-b-xl">
        {fullMapOpen ? (
          <div className="w-full h-full flex items-center justify-center bg-black/40">
            <span className="text-xs font-bold text-white/20 uppercase tracking-widest">Map Active on Main</span>
          </div>
        ) : (
          <MiniMapWidget onFullScreenClick={onOpenMap} />
        )}
        
        {/* HUD Overlay */}
        <div className="absolute top-4 left-4 right-4 pointer-events-none flex justify-between items-start">
          <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/5 flex flex-col items-center">
            <span className="text-[18px] font-black text-amber-500 tabular-nums leading-none">{heading}°</span>
            <span className="text-[8px] font-bold text-amber-500/40 uppercase tracking-widest mt-1">Heading</span>
          </div>
          
          <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/5">
            <Navigation className="w-4 h-4 text-white/40" />
          </div>
        </div>
      </div>
    </Panel>
  );
});

/* ── GT_Performance (Right) ───────────────────────────────── */
const GT_Performance = memo(({ appMap: _appMap, onLaunch: _onLaunch }: { appMap: Record<string, AppItem>; onLaunch: (id: string) => void }) => {
  const obd = useOBDState();
  const { playing, track } = useMediaState();
  
  const fuel = Math.max(0, Math.round(obd.fuelLevel ?? 0));
  const temp = Math.round(obd.engineTemp ?? 0);
  const voltage = obd.batteryVoltage ?? null;

  useEffect(() => {
    startMediaHub();
    return () => stopMediaHub();
  }, []);

  return (
    <div className="flex flex-col gap-3 h-full">
      <Panel title="Vehicle Stats" icon={Activity} accent={C_ACCENT}>
        <div className="p-5 flex flex-col gap-4">
          <MetricBar label="Fuel" value={`${fuel}%`} percent={fuel} color={fuel < 15 ? C_RED : C_ACCENT} />
          <MetricBar label="Temp" value={`${temp}°C`} percent={Math.min(temp, 100)} color={temp > 105 ? C_RED : C_ACCENT} />
          <MetricBar label="Energy" value={voltage != null ? `${voltage.toFixed(1)}V` : '—'} percent={voltage != null ? Math.min(((voltage - 11) / 4) * 100, 100) : 0} color={voltage != null && voltage < 12 ? C_RED : C_ACCENT} />
        </div>
      </Panel>

      <Panel title="Media Core" icon={Music2}>
        <div className="p-4 h-full flex flex-col justify-center">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-xl bg-white/5 border border-white/10 overflow-hidden flex-shrink-0 relative group">
              {track.albumArt ? (
                <img src={track.albumArt} className="w-full h-full object-cover" alt="" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-cyan-500/20 to-cyan-500/5">
                  <Music2 className="w-6 h-6 text-white/20" />
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                 <button onClick={togglePlayPause} className="text-white">
                    {playing ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current" />}
                 </button>
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-black text-white truncate uppercase tracking-wider">{track.title || 'System Standby'}</div>
              <div className="text-[10px] font-bold text-white/30 truncate uppercase mt-0.5 tracking-widest">{track.artist || 'Media Hub'}</div>
            </div>
          </div>
          
          <div className="flex items-center justify-center gap-6">
            <button onClick={previous} className="p-2 hover:bg-white/5 rounded-full transition-colors text-white/40 hover:text-white">
              <SkipBack className="w-5 h-5" />
            </button>
            <button onClick={togglePlayPause} className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 hover:bg-cyan-500/20 transition-all">
              {playing ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
            </button>
            <button onClick={next} className="p-2 hover:bg-white/5 rounded-full transition-colors text-white/40 hover:text-white">
              <SkipForward className="w-5 h-5" />
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
});

const MetricBar = ({ label, value, percent, color }: { label: string; value: string; percent: number; color: string }) => (
  <div className="flex flex-col gap-1.5">
    <div className="flex justify-between items-end">
      <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30">{label}</span>
      <span className="text-[11px] font-black text-white tabular-nums">{value}</span>
    </div>
    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
      <div 
        className="h-full rounded-full transition-all duration-700 ease-out" 
        style={{ width: `${percent}%`, background: color, boxShadow: `0 0 10px ${color}60` }} 
      />
    </div>
  </div>
);


/* ── MAIN LAYOUT ─────────────────────────────────────────── */
export const CockpitLayout = memo(function CockpitLayout({
  onOpenMap, onOpenApps, onOpenSettings, onLaunch, appMap, dockIds, fullMapOpen, smart,
}: Props) {
  const [voiceOpen, setVoiceOpen] = useState(false);
  
  useEffect(() => {
    injectStyles();
  }, []);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-[#05070a] font-sans selection:bg-cyan-500/30">
      {voiceOpen && (
        <Suspense fallback={null}>
          <VoiceAssistant onClose={() => setVoiceOpen(false)} minimal />
        </Suspense>
      )}

      {/* Modern Carbon Background with Grid */}
      <div className="absolute inset-0 pointer-events-none opacity-20" style={{
        backgroundImage: `radial-gradient(circle at 2px 2px, rgba(255,255,255,0.05) 1px, transparent 0)`,
        backgroundSize: '32px 32px'
      }} />
      
      {/* Dynamic Scanline Overlay */}
      <div className="absolute inset-0 pointer-events-none z-[100] overflow-hidden opacity-[0.03]">
        <div className="w-full h-20 bg-gradient-to-b from-transparent via-cyan-400 to-transparent animate-[gt-scanline_4s_linear_infinite]" />
      </div>

      <div className="relative z-10 flex flex-col h-full">
        <GT_Glareshield onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onVoice={() => setVoiceOpen(true)} />

        <div className="flex-1 min-h-0 grid grid-cols-[1fr_1.4fr_1fr] gap-4 p-4">
          <GT_Navigation onOpenMap={onOpenMap} fullMapOpen={fullMapOpen} />
          <GT_Cluster />
          <GT_Performance appMap={appMap} onLaunch={onLaunch} />
        </div>

        {smart && smart.predictions.length > 0 && (
          <div className="px-4 pb-2">
            <MagicContextCard smart={smart} variant="cockpit" onLaunch={onLaunch} onOpenMap={onOpenMap} />
          </div>
        )}

        <div style={{ height: 'var(--dock-h, 72px)', flexShrink: 0 }} />
        <DockBar appMap={appMap} dockIds={dockIds} onLaunch={onLaunch} onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onVoice={() => setVoiceOpen(true)} />
      </div>
    </div>
  );
});

/* Helper Icons */
const Play = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const Pause = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);
const Navigation = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="3 11 22 2 13 21 11 13 3 11" />
  </svg>
);
