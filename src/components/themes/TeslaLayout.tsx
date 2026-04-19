import { memo, useState, lazy, Suspense } from 'react';

const VoiceAssistant = lazy(() => import('../modals/VoiceAssistant').then(m => ({ default: m.VoiceAssistant })));
import {
  Search, Grid3X3, SkipBack, SkipForward, Play, Pause,
  Gauge, Thermometer, Fuel, Mic, Settings,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useMediaState, togglePlayPause, next, previous } from '../../platform/mediaService';
import { useOBDState } from '../../platform/obdService';
import { useGPSLocation } from '../../platform/gpsService';
import { useClock } from '../../hooks/useClock';
import { useDeviceStatus } from '../../platform/deviceApi';
import { MiniMapWidget } from '../map/MiniMapWidget';
import { APP_MAP, type AppItem } from '../../data/apps';

/* ══════════════════════════════════════════
   TESLA THEME — Model S Plaid Cockpit
   Siyah + beyaz + kırmızı vurgu
   ══════════════════════════════════════════ */

interface Props {
  onOpenMap:      () => void;
  onOpenApps:     () => void;
  onOpenSettings: () => void;
  onLaunch:       (id: string) => void;
  appMap:         Record<string, AppItem>;
  dockIds:        string[];
  fullMapOpen?:   boolean;
}

const T_BG    = '#000000';
const T_RED   = '#E31937';
const T_CARD  = 'rgba(18,18,18,0.95)';
const T_CARD2 = 'rgba(24,24,24,0.90)';
const T_BORDER = 'rgba(255,255,255,0.06)';
const T_TEXT  = '#FFFFFF';
const T_DIM   = '#6B7280';
const T_DIM2  = '#9CA3AF';

/* ─── TESLA HEADER ────────────────────────────────────────────── */
const TeslaHeader = memo(function TeslaHeader({ onOpenApps, onOpenSettings, onVoice }: { onOpenApps: () => void; onOpenSettings: () => void; onVoice: () => void }) {
  const { settings } = useStore();
  const { time } = useClock(settings.use24Hour, false);
  const device = useDeviceStatus();

  return (
    <div className="flex items-center justify-between px-6 py-3 flex-shrink-0"
      style={{
        background: 'rgba(0,0,0,0.98)',
        borderBottom: `1px solid ${T_BORDER}`,
      }}>

      {/* Sol: Tesla logo + saat */}
      <div className="flex items-center gap-5">
        <svg width="36" height="16" viewBox="0 0 342 140" fill={T_RED}>
          <path d="M0 0h342v14c-28 0-56-7-84-7-28 0-56 7-84 7s-56-7-84-7C62 7 34 14 0 14V0z"/>
          <path d="M100 14h142v112l-71 14-71-14V14z"/>
        </svg>
        <div className="font-light tabular-nums" style={{ fontSize: 32, color: T_TEXT, letterSpacing: '-1px' }}>{time}</div>
      </div>

      {/* Orta: Durum */}
      <div className="flex items-center gap-3">
        <TSlot label="MENZIL" value="420 km" />
        <TSlot label="BATARYA" value={device.ready ? `${device.battery}%` : '—'} />
        <TSlot label="ISIL" value="21°C" />
      </div>

      {/* Sağ: Aksiyonlar */}
      <div className="flex items-center gap-2">
        <TIconBtn onClick={onOpenSettings}><Settings className="w-4 h-4" style={{ color: T_DIM2 }} /></TIconBtn>
        <TIconBtn onClick={onOpenApps}><Grid3X3 className="w-4 h-4" style={{ color: T_DIM2 }} /></TIconBtn>
        <TIconBtn onClick={onVoice}><Mic className="w-4 h-4" style={{ color: T_RED }} /></TIconBtn>
      </div>
    </div>
  );
});

function TSlot({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center px-3">
      <div className="text-xs font-light tabular-nums" style={{ color: T_TEXT }}>{value}</div>
      <div className="text-[9px] uppercase tracking-widest mt-0.5" style={{ color: T_DIM }}>{label}</div>
    </div>
  );
}

function TIconBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95 transition-all"
      style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${T_BORDER}` }}>
      {children}
    </button>
  );
}

/* ─── TESLA MAP PANEL ─────────────────────────────────────────── */
const TeslaMap = memo(function TeslaMap({ onOpenMap, fullMapOpen }: { onOpenMap: () => void; fullMapOpen?: boolean }) {
  return (
    <div className="flex flex-col h-full overflow-hidden relative"
      style={{ background: T_CARD, border: `1px solid ${T_BORDER}`, borderRadius: 16 }}>

      <div className="flex-1 min-h-0 overflow-hidden relative">
        {fullMapOpen
          ? <div className="w-full h-full flex flex-col items-center justify-center gap-3"
              style={{ background: '#0a0a0a' }}>
              <div className="text-sm font-light" style={{ color: T_DIM }}>Harita açık</div>
            </div>
          : <MiniMapWidget onFullScreenClick={onOpenMap} />
        }
      </div>

      {/* Tesla nav bar */}
      <div className="flex-shrink-0 flex items-center gap-2 p-3"
        style={{ background: 'rgba(0,0,0,0.90)', borderTop: `1px solid ${T_BORDER}` }}>
        <button onClick={onOpenMap}
          className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl active:scale-[0.99] transition-all"
          style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${T_BORDER}` }}>
          <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: T_DIM }} />
          <span className="text-sm font-light" style={{ color: T_DIM }}>Nereye gidiyorsunuz?</span>
        </button>
        <div className="px-3 py-2 rounded-xl" style={{ background: `rgba(227,25,55,0.12)`, border: `1px solid rgba(227,25,55,0.25)` }}>
          <div className="text-[10px] font-light" style={{ color: T_DIM }}>ETA</div>
          <div className="text-sm font-medium tabular-nums" style={{ color: T_TEXT }}>18:45</div>
        </div>
      </div>
    </div>
  );
});

/* ─── TESLA SPEED ─────────────────────────────────────────────── */
const TeslaSpeed = memo(function TeslaSpeed() {
  const obd = useOBDState();
  const gps = useGPSLocation();
  const speedKmh = gps?.speed != null && gps.speed > 0 ? Math.round(gps.speed * 3.6) : (obd.speed ?? 0);
  const rpm  = obd.rpm        ?? 929;
  const temp = obd.engineTemp ?? 88;
  const fuel = obd.fuelLevel  ?? 68;
  const tempWarn = temp > 100;
  const fuelWarn = fuel < 15;

  const R = 78, cx = 100, cy = 105;
  const pct = Math.min(speedKmh / 200, 1);
  const rad = (d: number) => (d * Math.PI) / 180;
  const pt  = (a: number) => ({ x: cx + R * Math.cos(rad(a)), y: cy + R * Math.sin(rad(a)) });
  const arc = (a1: number, a2: number) => {
    const s = pt(a1), e = pt(a2), large = a2 - a1 > 180 ? 1 : 0;
    return `M${s.x} ${s.y} A${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`;
  };
  const fillAngle = 135 + pct * 270;

  return (
    <div className="flex flex-col h-full overflow-hidden"
      style={{ background: T_CARD, border: `1px solid ${T_BORDER}`, borderRadius: 16 }}>

      {/* Hız göstergesi */}
      <div className="flex-1 flex items-center justify-center relative">
        <div style={{ width: 200, height: 200, position: 'relative' }}>
          <svg width="200" height="210" viewBox="0 0 200 210">
            <path d={arc(135, 405)} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" strokeLinecap="round" />
            {pct > 0.01 && (
              <path d={arc(135, fillAngle)} fill="none" stroke={T_RED} strokeWidth="10" strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 8px ${T_RED}80)` }} />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ paddingTop: 8 }}>
            <div className="font-thin tabular-nums leading-none" style={{ fontSize: 64, color: T_TEXT, letterSpacing: '-3px' }}>
              {speedKmh}
            </div>
            <div className="font-light tracking-[0.5em] mt-1" style={{ fontSize: 10, color: T_DIM, textTransform: 'uppercase' }}>
              km/h
            </div>
          </div>
        </div>
      </div>

      {/* Veri çubukları */}
      <div className="flex flex-shrink-0 gap-px pb-3 px-3">
        <TDataRow Icon={Gauge}       label="RPM"   value={rpm.toLocaleString()} warn={false} />
        <TDataRow Icon={Thermometer} label="ISIL"  value={`${Math.round(temp)}°`} warn={tempWarn} />
        <TDataRow Icon={Fuel}        label="YAKIT" value={`${Math.round(fuel)}%`} warn={fuelWarn} />
      </div>
    </div>
  );
});

function TDataRow({ Icon, label, value, warn }: { Icon: typeof Gauge; label: string; value: string; warn: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center py-2.5 rounded-xl"
      style={{ background: warn ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${warn ? 'rgba(239,68,68,0.20)' : T_BORDER}` }}>
      <Icon className="w-3 h-3 mb-1" style={{ color: warn ? '#EF4444' : T_DIM }} />
      <div className="text-[8px] uppercase tracking-widest mb-0.5" style={{ color: T_DIM }}>{label}</div>
      <div className="font-medium text-sm tabular-nums" style={{ color: warn ? '#EF4444' : T_TEXT }}>{value}</div>
    </div>
  );
}

/* ─── TESLA MUSIC ─────────────────────────────────────────────── */
const TeslaMusic = memo(function TeslaMusic() {
  const { playing, track } = useMediaState();
  return (
    <div className="flex flex-col h-full overflow-hidden"
      style={{ background: T_CARD, border: `1px solid ${T_BORDER}`, borderRadius: 16 }}>

      <div className="px-4 pt-4 pb-2 flex-shrink-0"
        style={{ borderBottom: `1px solid ${T_BORDER}` }}>
        <div className="text-[9px] uppercase tracking-[0.4em] font-light" style={{ color: T_DIM }}>ÇAL</div>
      </div>

      <div className="flex-1 flex items-center gap-3 px-4 min-h-0">
        <div className="w-14 h-14 rounded-2xl flex-shrink-0 flex items-center justify-center overflow-hidden"
          style={{ background: 'rgba(227,25,55,0.15)', border: `1px solid rgba(227,25,55,0.25)` }}>
          {track.albumArt
            ? <img src={track.albumArt} className="w-full h-full object-cover" alt="" />
            : <span className="text-2xl">🎵</span>
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium leading-tight truncate" style={{ fontSize: 14, color: T_TEXT }}>
            {track.title || 'Seçili şarkı yok'}
          </div>
          <div className="text-xs font-light mt-0.5 truncate" style={{ color: T_DIM }}>
            {track.artist || 'Müzik çalmıyor'}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4 flex-shrink-0 py-3">
        <button onClick={() => previous()} className="active:scale-90 transition-all p-2">
          <SkipBack className="w-5 h-5" style={{ color: T_DIM2 }} />
        </button>
        <button onClick={() => togglePlayPause()}
          className="w-12 h-12 rounded-2xl flex items-center justify-center active:scale-90 transition-all"
          style={{ background: T_RED, boxShadow: `0 6px 20px rgba(227,25,55,0.40)` }}>
          {playing
            ? <Pause className="w-5 h-5" style={{ color: '#ffffff' }} />
            : <Play  className="w-5 h-5 ml-0.5" style={{ color: '#ffffff' }} />
          }
        </button>
        <button onClick={() => next()} className="active:scale-90 transition-all p-2">
          <SkipForward className="w-5 h-5" style={{ color: T_DIM2 }} />
        </button>
      </div>
    </div>
  );
});

/* ─── TESLA QUICK APPS ────────────────────────────────────────── */
const TeslaApps = memo(function TeslaApps({ appMap, onLaunch }: { appMap: Record<string, AppItem>; onLaunch: (id: string) => void }) {
  const ids = ['maps', 'phone', 'youtube', 'settings'];
  const apps = ids.map(id => ({ id, app: appMap[id] ?? APP_MAP[id] })).filter(x => x.app);
  return (
    <div className="flex-shrink-0 flex gap-2 px-3 pb-2">
      {apps.map(({ id, app }) => (
        <button key={id} onClick={() => onLaunch(id)}
          className="flex-1 flex flex-col items-center gap-1.5 py-3 rounded-2xl active:scale-90 transition-all"
          style={{ background: T_CARD2, border: `1px solid ${T_BORDER}` }}>
          <span className="text-2xl leading-none">{app!.icon}</span>
          <span className="text-[9px] font-light" style={{ color: T_DIM }}>{app!.name}</span>
        </button>
      ))}
    </div>
  );
});

/* ─── TESLA DOCK ──────────────────────────────────────────────── */
const TeslaDock = memo(function TeslaDock({ appMap, dockIds, onLaunch }: { appMap: Record<string, AppItem>; dockIds: string[]; onLaunch: (id: string) => void }) {
  const apps = dockIds.slice(0, 12).map(id => ({ id, app: appMap[id] ?? APP_MAP[id] })).filter(x => x.app);
  return (
    <div className="flex-shrink-0"
      style={{
        background: 'rgba(0,0,0,0.98)',
        borderTop: `1px solid ${T_BORDER}`,
      }}>
      <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar px-4 py-2">
        {apps.map(({ id, app }) => (
          <button key={id} onClick={() => onLaunch(id)}
            className="flex flex-col items-center gap-1 flex-shrink-0 px-2.5 py-1.5 rounded-xl active:scale-90 transition-all min-w-[52px]">
            <span className="text-xl leading-none">{app!.icon}</span>
            <span className="text-[8px] font-light truncate w-full text-center" style={{ color: T_DIM }}>{app!.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

/* ─── TESLA LAYOUT ────────────────────────────────────────────── */
export const TeslaLayout = memo(function TeslaLayout({
  onOpenMap, onOpenApps, onOpenSettings, onLaunch, appMap, dockIds, fullMapOpen,
}: Props) {
  const [voiceOpen, setVoiceOpen] = useState(false);
  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: T_BG }}>
      {voiceOpen && (
        <Suspense fallback={null}>
          <VoiceAssistant onClose={() => setVoiceOpen(false)} autoStart />
        </Suspense>
      )}
      <TeslaHeader onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onVoice={() => setVoiceOpen(true)} />

      <div className="flex-1 min-h-0 flex gap-2.5 p-2.5 overflow-hidden">

        {/* Sol — Harita (büyük) */}
        <div className="flex-[1.8] min-w-0 min-h-0">
          <TeslaMap onOpenMap={onOpenMap} fullMapOpen={fullMapOpen} />
        </div>

        {/* Sağ — Hız + Müzik */}
        <div className="flex flex-col gap-2.5 min-h-0" style={{ width: 220, flexShrink: 0 }}>
          <div className="flex-1 min-h-0">
            <TeslaSpeed />
          </div>
          <div style={{ height: 180, flexShrink: 0 }}>
            <TeslaMusic />
          </div>
        </div>
      </div>

      <TeslaApps appMap={appMap} onLaunch={onLaunch} />
      <TeslaDock appMap={appMap} dockIds={dockIds} onLaunch={onLaunch} />
    </div>
  );
});
