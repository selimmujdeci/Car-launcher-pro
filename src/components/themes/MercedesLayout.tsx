import { memo, useState, lazy, Suspense } from 'react';

const VoiceAssistant = lazy(() => import('../modals/VoiceAssistant').then(m => ({ default: m.VoiceAssistant })));
import {
  Search, Grid3X3, SkipBack, SkipForward, Play, Pause,
  Gauge, Thermometer, Fuel, Settings, Star,
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
   MERCEDES THEME — MBUX Hyperscreen Style
   Siyah + Altın (#C8A96E) + Rosé Gold
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

const M_BG     = 'linear-gradient(135deg, #090909 0%, #0e0e0e 40%, #0b0b0b 70%, #080808 100%)';
const M_GOLD   = '#C8A96E';
const M_CARD   = 'rgba(16,14,14,0.97)';
const M_BORDER = 'rgba(200,169,110,0.12)';
const M_TEXT   = '#F5F0EB';
const M_DIM    = '#6B6560';
const M_DIM2   = '#9B9590';

/* ─── MERCEDES HEADER ─────────────────────────────────────────── */
const MercedesHeader = memo(function MercedesHeader({ onOpenApps, onOpenSettings, onVoice }: { onOpenApps: () => void; onOpenSettings: () => void; onVoice: () => void }) {
  const { settings } = useStore();
  const { time, date } = useClock(settings.use24Hour, false);
  const device = useDeviceStatus();

  return (
    <div className="flex items-center justify-between px-6 py-3 flex-shrink-0"
      style={{
        background: 'rgba(6,5,5,0.99)',
        borderBottom: `1px solid ${M_BORDER}`,
        boxShadow: `0 1px 0 rgba(200,169,110,0.08), 0 4px 20px rgba(0,0,0,0.60)`,
      }}>

      {/* Sol: Mercedes yıldızı + saat */}
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, rgba(200,169,110,0.20), rgba(200,169,110,0.08))',
            border: `1px solid rgba(200,169,110,0.30)`,
            boxShadow: `0 4px 16px rgba(200,169,110,0.15), inset 0 1px 0 rgba(255,255,255,0.05)`,
          }}>
          <Star className="w-5 h-5" style={{ color: M_GOLD, fill: M_GOLD }} />
        </div>
        <div>
          <div className="font-extralight tabular-nums" style={{ fontSize: 30, color: M_TEXT, letterSpacing: '0.5px' }}>{time}</div>
          <div className="text-[9px] uppercase tracking-[0.35em] font-light mt-0.5" style={{ color: M_DIM }}>{date}</div>
        </div>
      </div>

      {/* Orta: Durum */}
      <div className="flex items-center gap-6">
        <MStatus label="MENZIL" value="450 km" />
        <div className="w-px h-5" style={{ background: M_BORDER }} />
        <MStatus label="ENERJI" value={device.ready ? `${device.battery}%` : '—'} />
        <div className="w-px h-5" style={{ background: M_BORDER }} />
        <MStatus label="AMBIYANS" value="🌙 Gece" />
      </div>

      {/* Sağ */}
      <div className="flex items-center gap-2">
        <MIconBtn onClick={onOpenSettings}><Settings className="w-4 h-4" style={{ color: M_DIM2 }} /></MIconBtn>
        <MIconBtn onClick={onOpenApps}><Grid3X3 className="w-4 h-4" style={{ color: M_DIM2 }} /></MIconBtn>
        <button onClick={onVoice} className="px-4 py-2 rounded-2xl text-[11px] font-light tracking-widest active:scale-95 transition-all uppercase"
          style={{
            background: 'linear-gradient(135deg, rgba(200,169,110,0.20), rgba(200,169,110,0.10))',
            border: `1px solid rgba(200,169,110,0.35)`,
            color: M_GOLD,
            boxShadow: `0 4px 16px rgba(200,169,110,0.10)`,
          }}>
          HEY MERCEDES
        </button>
      </div>
    </div>
  );
});

function MStatus({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-sm font-light" style={{ color: M_TEXT }}>{value}</div>
      <div className="text-[8px] uppercase tracking-[0.3em] mt-0.5 font-light" style={{ color: M_DIM }}>{label}</div>
    </div>
  );
}

function MIconBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="w-9 h-9 rounded-2xl flex items-center justify-center active:scale-95 transition-all"
      style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${M_BORDER}` }}>
      {children}
    </button>
  );
}

/* ─── MERCEDES MAP ────────────────────────────────────────────── */
const MercedesMap = memo(function MercedesMap({ onOpenMap, fullMapOpen }: { onOpenMap: () => void; fullMapOpen?: boolean }) {
  return (
    <div className="flex flex-col h-full overflow-hidden"
      style={{ background: M_CARD, border: `1px solid ${M_BORDER}`, borderRadius: 24, boxShadow: `0 8px 40px rgba(0,0,0,0.60), inset 0 1px 0 rgba(200,169,110,0.06)` }}>

      {/* Altın üst çizgi */}
      <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${M_GOLD}, transparent)`, flexShrink: 0, borderRadius: '24px 24px 0 0' }} />

      {/* Başlık */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2 flex items-center justify-between"
        style={{ borderBottom: `1px solid ${M_BORDER}` }}>
        <div>
          <div className="text-[8px] uppercase tracking-[0.45em] font-light" style={{ color: M_GOLD }}>MBUX NAVİGASYON</div>
          <div className="text-sm font-light mt-0.5" style={{ color: M_TEXT }}>Harita</div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden relative">
        {fullMapOpen
          ? <div className="w-full h-full flex items-center justify-center" style={{ background: '#080808' }}>
              <span className="text-sm font-light" style={{ color: M_DIM }}>Harita açık</span>
            </div>
          : <MiniMapWidget onFullScreenClick={onOpenMap} />
        }
      </div>

      <div className="flex-shrink-0 flex items-center gap-2 p-3"
        style={{ background: 'rgba(4,4,4,0.95)', borderTop: `1px solid ${M_BORDER}` }}>
        <button onClick={onOpenMap}
          className="flex-1 flex items-center gap-2 px-3 py-2 rounded-2xl active:scale-[0.99] transition-all"
          style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${M_BORDER}` }}>
          <Search className="w-3.5 h-3.5" style={{ color: M_DIM }} />
          <span className="text-sm font-extralight" style={{ color: M_DIM }}>Hedef belirle...</span>
        </button>
        <div className="rounded-2xl px-3 py-2 text-center"
          style={{ background: 'rgba(200,169,110,0.08)', border: `1px solid rgba(200,169,110,0.18)` }}>
          <div className="text-[9px] font-light" style={{ color: M_DIM }}>ETA</div>
          <div className="text-sm font-light tabular-nums" style={{ color: M_GOLD }}>18:45</div>
        </div>
      </div>
    </div>
  );
});

/* ─── MERCEDES SPEED / COCKPIT ────────────────────────────────── */
const MercedesCockpit = memo(function MercedesCockpit() {
  const obd = useOBDState();
  const gps = useGPSLocation();
  const speedKmh = gps?.speed != null && gps.speed > 0 ? Math.round(gps.speed * 3.6) : (obd.speed ?? 0);
  const rpm  = obd.rpm        ?? 929;
  const temp = obd.engineTemp ?? 88;
  const fuel = obd.fuelLevel  ?? 68;
  const tempWarn = temp > 100;
  const fuelWarn = fuel < 15;

  const R = 95, cx = 120, cy = 130;
  const pct = Math.min(speedKmh / 280, 1);
  const rad = (d: number) => (d * Math.PI) / 180;
  const pt  = (a: number) => ({ x: cx + R * Math.cos(rad(a)), y: cy + R * Math.sin(rad(a)) });
  const arc = (a1: number, a2: number) => {
    const s = pt(a1), e = pt(a2), large = a2 - a1 > 180 ? 1 : 0;
    return `M${s.x} ${s.y} A${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`;
  };
  const fillAngle = 135 + pct * 270;

  return (
    <div className="flex flex-col h-full overflow-hidden"
      style={{ background: M_CARD, border: `1px solid ${M_BORDER}`, borderRadius: 24, boxShadow: `0 8px 40px rgba(0,0,0,0.60), inset 0 1px 0 rgba(200,169,110,0.06)` }}>

      <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${M_GOLD}, transparent)`, flexShrink: 0, borderRadius: '24px 24px 0 0' }} />

      <div className="flex-shrink-0 px-4 pt-3 pb-2"
        style={{ borderBottom: `1px solid ${M_BORDER}` }}>
        <div className="text-[8px] uppercase tracking-[0.45em] font-light" style={{ color: M_GOLD }}>MERCEDES-AMG</div>
        <div className="text-sm font-light mt-0.5" style={{ color: M_TEXT }}>Dijital Gösterge</div>
      </div>

      <div className="flex-1 flex items-center justify-center relative min-h-0">
        <div style={{ width: 240, height: 240, position: 'relative' }}>
          <svg width="240" height="260" viewBox="0 0 240 260">
            {/* Dış dekoratif halkalar */}
            <circle cx="120" cy="130" r="112" fill="none" stroke="rgba(200,169,110,0.05)" strokeWidth="1" />
            <circle cx="120" cy="130" r="106" fill="none" stroke="rgba(200,169,110,0.08)" strokeWidth="0.5" />
            {/* Track */}
            <path d={arc(135, 405)} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="12" strokeLinecap="round" />
            {/* Altın fill */}
            {pct > 0.01 && (
              <path d={arc(135, fillAngle)} fill="none"
                stroke={`url(#goldGrad)`} strokeWidth="12" strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 8px rgba(200,169,110,0.50))` }} />
            )}
            <defs>
              <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#C8A96E" />
                <stop offset="100%" stopColor="#E8C98E" />
              </linearGradient>
            </defs>
            {/* Merkezi daire */}
            <circle cx="120" cy="130" r="52" fill="rgba(0,0,0,0.85)" stroke="rgba(200,169,110,0.12)" strokeWidth="1" />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ paddingTop: 10 }}>
            <div className="font-thin tabular-nums leading-none"
              style={{ fontSize: 54, color: M_TEXT, letterSpacing: '-1px' }}>
              {speedKmh}
            </div>
            <div className="text-[10px] font-light tracking-[0.5em] mt-1" style={{ color: M_GOLD, textTransform: 'uppercase' }}>
              km/h
            </div>
          </div>
        </div>
      </div>

      {/* Veri */}
      <div className="flex gap-2 px-4 pb-4 flex-shrink-0">
        <MDataCell Icon={Gauge}       label="TORK"  value={`${rpm.toLocaleString()}`} warn={false} />
        <MDataCell Icon={Thermometer} label="MOTOR" value={`${Math.round(temp)}°C`}  warn={tempWarn} />
        <MDataCell Icon={Fuel}        label="YAKIT" value={`${Math.round(fuel)}%`}   warn={fuelWarn} />
      </div>
    </div>
  );
});

function MDataCell({ Icon, label, value, warn }: { Icon: typeof Gauge; label: string; value: string; warn: boolean }) {
  return (
    <div className="flex-1 rounded-2xl p-3 text-center"
      style={{
        background: warn ? 'rgba(204,50,50,0.08)' : 'rgba(200,169,110,0.04)',
        border: `1px solid ${warn ? 'rgba(204,50,50,0.20)' : 'rgba(200,169,110,0.10)'}`,
      }}>
      <Icon className="w-3.5 h-3.5 mx-auto mb-1.5" style={{ color: warn ? '#EF4444' : M_GOLD }} />
      <div className="text-[8px] uppercase tracking-widest mb-1 font-light" style={{ color: M_DIM }}>{label}</div>
      <div className="font-light text-sm tabular-nums" style={{ color: warn ? '#EF4444' : M_TEXT }}>{value}</div>
    </div>
  );
}

/* ─── MERCEDES SAĞ PANEL (Müzik + Uygulamalar) ───────────────── */
const MercedesSide = memo(function MercedesSide({ appMap, onLaunch }: { appMap: Record<string, AppItem>; onLaunch: (id: string) => void }) {
  const { playing, track } = useMediaState();
  const ids = ['maps', 'phone', 'youtube', 'settings'];
  const apps = ids.map(id => ({ id, app: appMap[id] ?? APP_MAP[id] })).filter(x => x.app);

  return (
    <div className="flex flex-col gap-2.5 h-full min-h-0">

      {/* Müzik */}
      <div className="overflow-hidden flex-shrink-0"
        style={{ background: M_CARD, border: `1px solid ${M_BORDER}`, borderRadius: 24, boxShadow: `0 8px 40px rgba(0,0,0,0.50), inset 0 1px 0 rgba(200,169,110,0.06)` }}>
        <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${M_GOLD}, transparent)`, borderRadius: '24px 24px 0 0' }} />
        <div className="p-3">
          <div className="text-[8px] uppercase tracking-[0.45em] font-light mb-2.5" style={{ color: M_GOLD }}>BURMESTER MÜZİK</div>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-14 h-14 rounded-2xl flex-shrink-0 flex items-center justify-center overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(200,169,110,0.15), rgba(200,169,110,0.05))',
                border: `1px solid rgba(200,169,110,0.20)`,
              }}>
              {track.albumArt
                ? <img src={track.albumArt} className="w-full h-full object-cover" alt="" />
                : <span className="text-2xl">🎵</span>
              }
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-light text-sm leading-tight truncate" style={{ color: M_TEXT }}>
                {track.title || 'Seçili parça yok'}
              </div>
              <div className="text-xs font-light mt-0.5 truncate" style={{ color: M_DIM }}>
                {track.artist || 'Burmester Surround'}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-5">
            <button onClick={() => previous()} className="active:scale-90 transition-all p-1.5">
              <SkipBack className="w-4 h-4" style={{ color: M_DIM2 }} />
            </button>
            <button onClick={() => togglePlayPause()}
              className="w-11 h-11 rounded-2xl flex items-center justify-center active:scale-90 transition-all"
              style={{
                background: 'linear-gradient(135deg, rgba(200,169,110,0.25), rgba(200,169,110,0.12))',
                border: `1px solid rgba(200,169,110,0.35)`,
                boxShadow: `0 4px 16px rgba(200,169,110,0.20)`,
              }}>
              {playing
                ? <Pause className="w-5 h-5" style={{ color: M_GOLD }} />
                : <Play  className="w-5 h-5 ml-0.5" style={{ color: M_GOLD }} />
              }
            </button>
            <button onClick={() => next()} className="active:scale-90 transition-all p-1.5">
              <SkipForward className="w-4 h-4" style={{ color: M_DIM2 }} />
            </button>
          </div>
        </div>
      </div>

      {/* Uygulamalar */}
      <div className="flex-1 overflow-hidden"
        style={{ background: M_CARD, border: `1px solid ${M_BORDER}`, borderRadius: 24, boxShadow: `0 8px 40px rgba(0,0,0,0.50), inset 0 1px 0 rgba(200,169,110,0.06)` }}>
        <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${M_GOLD}, transparent)`, borderRadius: '24px 24px 0 0' }} />
        <div className="p-3">
          <div className="text-[8px] uppercase tracking-[0.45em] font-light mb-2.5" style={{ color: M_GOLD }}>MBUX UYGULAMALAR</div>
          <div className="grid grid-cols-2 gap-2">
            {apps.map(({ id, app }) => (
              <button key={id} onClick={() => onLaunch(id)}
                className="flex flex-col items-center gap-1.5 py-3 rounded-2xl active:scale-90 transition-all"
                style={{
                  background: 'rgba(200,169,110,0.04)',
                  border: `1px solid rgba(200,169,110,0.09)`,
                }}>
                <span className="text-xl leading-none">{app!.icon}</span>
                <span className="text-[9px] font-light" style={{ color: M_DIM }}>{app!.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

/* ─── MERCEDES DOCK ───────────────────────────────────────────── */
const MercedesDock = memo(function MercedesDock({ appMap, dockIds, onLaunch }: { appMap: Record<string, AppItem>; dockIds: string[]; onLaunch: (id: string) => void }) {
  const apps = dockIds.slice(0, 12).map(id => ({ id, app: appMap[id] ?? APP_MAP[id] })).filter(x => x.app);
  return (
    <div className="flex-shrink-0"
      style={{
        background: 'rgba(4,4,4,0.99)',
        borderTop: `1px solid ${M_BORDER}`,
        boxShadow: `0 -1px 0 rgba(200,169,110,0.08)`,
      }}>
      <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar px-4 py-2">
        {apps.map(({ id, app }) => (
          <button key={id} onClick={() => onLaunch(id)}
            className="flex flex-col items-center gap-1 flex-shrink-0 px-2.5 py-1.5 rounded-2xl active:scale-90 transition-all min-w-[52px]">
            <span className="text-xl leading-none">{app!.icon}</span>
            <span className="text-[8px] font-light truncate w-full text-center" style={{ color: M_DIM }}>{app!.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

/* ─── MERCEDES LAYOUT ─────────────────────────────────────────── */
export const MercedesLayout = memo(function MercedesLayout({
  onOpenMap, onOpenApps, onOpenSettings, onLaunch, appMap, dockIds, fullMapOpen,
}: Props) {
  const [voiceOpen, setVoiceOpen] = useState(false);
  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: M_BG }}>
      {voiceOpen && (
        <Suspense fallback={null}>
          <VoiceAssistant onClose={() => setVoiceOpen(false)} autoStart />
        </Suspense>
      )}
      {/* Ambient gold glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
        <div style={{ position: 'absolute', top: '-30%', left: '20%', width: '60vw', height: '60vw', borderRadius: '50%', background: 'radial-gradient(circle,rgba(200,169,110,0.04) 0%,transparent 70%)', filter: 'blur(80px)' }} />
      </div>

      <div className="relative z-10 flex flex-col h-full">
        <MercedesHeader onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onVoice={() => setVoiceOpen(true)} />

        <div className="flex-1 min-h-0 grid gap-2.5 p-2.5 overflow-hidden"
          style={{ gridTemplateColumns: '1fr 1fr 0.85fr' }}>
          <MercedesMap onOpenMap={onOpenMap} fullMapOpen={fullMapOpen} />
          <MercedesCockpit />
          <MercedesSide appMap={appMap} onLaunch={onLaunch} />
        </div>

        <MercedesDock appMap={appMap} dockIds={dockIds} onLaunch={onLaunch} />
      </div>
    </div>
  );
});
