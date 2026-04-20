import { memo, useState, lazy, Suspense } from 'react';

const VoiceAssistant = lazy(() => import('../modals/VoiceAssistant').then(m => ({ default: m.VoiceAssistant })));
import {
  Search, Grid3X3, SkipBack, SkipForward, Play, Pause,
  Gauge, Thermometer, Fuel, Settings, Star,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useMediaState, togglePlayPause, next, previous } from '../../platform/mediaService';
import { useOBDState } from '../../platform/obdService';
import { useGPSLocation, resolveSpeedKmh } from '../../platform/gpsService';
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

/* Tema renkleri CSS custom property — index.css [data-theme="mercedes"] */
const M_BG     = 'var(--bg-primary, #0e0e0e)';
const M_GOLD   = 'var(--accent, #C8A96E)';
const M_CARD   = 'var(--bg-card, rgba(16,14,14,0.97))';
const M_BORDER = 'var(--border-color, rgba(200,169,110,0.13))';
const M_TEXT   = 'var(--text, #F5F0EB)';
const M_DIM    = 'var(--text-dim, #9E9893)';
const M_DIM2   = 'var(--text-dim2, #B5B0AB)';

/* ─── MERCEDES HEADER ─────────────────────────────────────────── */
const MercedesHeader = memo(function MercedesHeader({ onOpenApps, onOpenSettings, onVoice }: { onOpenApps: () => void; onOpenSettings: () => void; onVoice: () => void }) {
  const { settings } = useStore();
  const { time, date } = useClock(settings.use24Hour, false);
  const device = useDeviceStatus();

  return (
    <div className="flex items-center justify-between px-6 flex-shrink-0"
      style={{
        height: 56,
        background: 'rgba(6,5,5,0.99)',
        borderBottom: `1px solid ${M_BORDER}`,
        boxShadow: `0 1px 0 rgba(200,169,110,0.07), 0 4px 20px rgba(0,0,0,0.55)`,
      }}>

      {/* Sol: Mercedes yıldızı + saat */}
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, rgba(200,169,110,0.18), rgba(200,169,110,0.07))',
            border: `1px solid rgba(200,169,110,0.28)`,
            boxShadow: `0 3px 12px rgba(200,169,110,0.12)`,
          }}>
          <Star className="w-4.5 h-4.5" style={{ color: M_GOLD, fill: M_GOLD }} />
        </div>
        <div>
          <div className="font-extralight tabular-nums" style={{ fontSize: 'var(--lp-font-2xl, 32px)', color: M_TEXT, letterSpacing: '0.3px' }}>{time}</div>
          <div className="uppercase tracking-[0.3em] font-light mt-0.5" style={{ fontSize: 9, color: M_DIM }}>{date}</div>
        </div>
      </div>

      {/* Orta: Durum — COMPACT'ta gizlenir */}
      <div data-mbux-status data-header-center className="flex items-center gap-5">
        <MStatus label="MENZIL" value="450 km" />
        <div className="w-px h-5" style={{ background: M_BORDER }} />
        <MStatus label="ENERJI" value={device.ready ? `${device.battery}%` : '—'} />
        <div className="w-px h-5" style={{ background: M_BORDER }} />
        <MStatus label="AMBIYANS" value="🌙 Gece" />
      </div>

      {/* Sağ */}
      <div className="flex items-center gap-1.5">
        <MIconBtn onClick={onOpenSettings}><Settings className="w-4 h-4" style={{ color: M_DIM2 }} /></MIconBtn>
        <MIconBtn onClick={onOpenApps}><Grid3X3 className="w-4 h-4" style={{ color: M_DIM2 }} /></MIconBtn>
        <button onClick={onVoice}
          className="px-4 h-11 rounded-2xl font-light tracking-widest active:scale-95 transition-all uppercase"
          style={{
            fontSize: 11,
            background: 'linear-gradient(135deg, rgba(200,169,110,0.18), rgba(200,169,110,0.08))',
            border: `1px solid rgba(200,169,110,0.32)`,
            color: M_GOLD,
            boxShadow: `0 3px 14px rgba(200,169,110,0.08)`,
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
      <div className="font-medium tabular-nums" style={{ fontSize: 13, color: M_TEXT }}>{value}</div>
      <div className="uppercase font-medium mt-0.5" style={{ fontSize: 10, color: M_DIM, letterSpacing: '0.22em' }}>{label}</div>
    </div>
  );
}

function MIconBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="w-11 h-11 rounded-2xl flex items-center justify-center active:scale-95 transition-all"
      style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${M_BORDER}` }}>
      {children}
    </button>
  );
}

/* ─── MERCEDES MAP ────────────────────────────────────────────── */
const MercedesMap = memo(function MercedesMap({ onOpenMap, fullMapOpen }: { onOpenMap: () => void; fullMapOpen?: boolean }) {
  return (
    <div className="flex flex-col h-full overflow-hidden"
      style={{ background: M_CARD, border: `1px solid ${M_BORDER}`, borderRadius: 24, boxShadow: `0 8px 40px rgba(0,0,0,0.70), 0 2px 10px rgba(0,0,0,0.45), inset 0 1px 0 rgba(200,169,110,0.07)` }}>

      {/* Altın üst çizgi */}
      <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${M_GOLD}, transparent)`, flexShrink: 0, borderRadius: '24px 24px 0 0', opacity: 0.70 }} />

      {/* Başlık */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2.5 flex items-center justify-between"
        style={{ borderBottom: `1px solid ${M_BORDER}` }}>
        <div>
          <div className="uppercase font-medium" style={{ fontSize: 10, color: M_GOLD, letterSpacing: '0.32em' }}>MBUX NAVİGASYON</div>
          <div className="font-light mt-0.5" style={{ fontSize: 13, color: M_TEXT }}>Harita</div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden relative">
        {fullMapOpen
          ? <div className="w-full h-full flex items-center justify-center" style={{ background: '#080808' }}>
              <span className="font-light" style={{ fontSize: 13, color: M_DIM }}>Harita açık</span>
            </div>
          : <MiniMapWidget onFullScreenClick={onOpenMap} />
        }
      </div>

      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2.5"
        style={{ background: 'rgba(4,4,4,0.95)', borderTop: `1px solid ${M_BORDER}` }}>
        <button onClick={onOpenMap}
          className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-2xl active:scale-[0.99] transition-all"
          style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${M_BORDER}` }}>
          <Search className="w-3.5 h-3.5" style={{ color: M_DIM }} />
          <span className="font-extralight" style={{ fontSize: 13, color: M_DIM }}>Hedef belirle...</span>
        </button>
        <div className="rounded-2xl px-3 py-2.5 text-center"
          style={{ background: 'rgba(200,169,110,0.07)', border: `1px solid rgba(200,169,110,0.16)` }}>
          <div className="font-light" style={{ fontSize: 9, color: M_DIM, letterSpacing: '0.1em' }}>ETA</div>
          <div className="font-normal tabular-nums mt-0.5" style={{ fontSize: 13, color: M_GOLD }}>18:45</div>
        </div>
      </div>
    </div>
  );
});

/* ─── MERCEDES SPEED / COCKPIT ────────────────────────────────── */
const MercedesCockpit = memo(function MercedesCockpit() {
  const obd = useOBDState();
  const gps = useGPSLocation();
  const speedKmh = resolveSpeedKmh(gps, obd.speed ?? 0);
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
      style={{ background: M_CARD, border: `1px solid ${M_BORDER}`, borderRadius: 24, boxShadow: `0 8px 40px rgba(0,0,0,0.70), 0 2px 10px rgba(0,0,0,0.45), inset 0 1px 0 rgba(200,169,110,0.07)` }}>

      <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${M_GOLD}, transparent)`, flexShrink: 0, borderRadius: '24px 24px 0 0', opacity: 0.70 }} />

      <div className="flex-shrink-0 px-4 pt-3 pb-2.5"
        style={{ borderBottom: `1px solid ${M_BORDER}` }}>
        <div className="uppercase font-medium" style={{ fontSize: 10, color: M_GOLD, letterSpacing: '0.32em' }}>MERCEDES-AMG</div>
        <div className="font-light mt-0.5" style={{ fontSize: 13, color: M_TEXT }}>Dijital Gösterge</div>
      </div>

      <div className="flex-1 flex items-center justify-center relative min-h-0">
        <div style={{ width: 'var(--lp-speedo, 175px)', height: 'var(--lp-speedo, 175px)', position: 'relative' }}>
          <svg width="100%" height="100%" viewBox="0 0 240 260">
            {/* Dekoratif halkalar */}
            <circle cx="120" cy="130" r="112" fill="none" stroke="rgba(200,169,110,0.04)" strokeWidth="1" />
            <circle cx="120" cy="130" r="106" fill="none" stroke="rgba(200,169,110,0.07)" strokeWidth="0.5" />
            {/* Track */}
            <path d={arc(135, 405)} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="12" strokeLinecap="round" />
            {/* Altın fill */}
            {pct > 0.01 && (
              <path d={arc(135, fillAngle)} fill="none"
                stroke="url(#goldGrad)" strokeWidth="12" strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 7px rgba(200,169,110,0.45))` }} />
            )}
            <defs>
              <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#C8A96E" />
                <stop offset="100%" stopColor="#E8C98E" />
              </linearGradient>
            </defs>
            {/* Merkezi daire */}
            <circle cx="120" cy="130" r="52" fill="rgba(0,0,0,0.82)" stroke="rgba(200,169,110,0.10)" strokeWidth="1" />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ paddingTop: 10 }}>
            <div className="font-extralight tabular-nums leading-none"
              style={{ fontSize: 'var(--lp-speed-font, 58px)', color: M_TEXT, letterSpacing: '-1px', textShadow: '0 0 20px rgba(255,255,255,0.15), 0 2px 6px rgba(0,0,0,0.50)' }}>
              {speedKmh}
            </div>
            <div className="font-light uppercase mt-1.5" style={{ fontSize: 10, color: M_GOLD, letterSpacing: '0.45em' }}>
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
    <div className="flex-1 rounded-2xl p-3.5 text-center"
      style={{
        background: warn ? 'rgba(204,50,50,0.07)' : 'rgba(200,169,110,0.04)',
        border: `1px solid ${warn ? 'rgba(204,50,50,0.18)' : 'rgba(200,169,110,0.09)'}`,
      }}>
      <Icon className="w-4 h-4 mx-auto mb-2" style={{ color: warn ? '#EF4444' : M_GOLD }} />
      <div className="uppercase font-medium mb-1" style={{ fontSize: 10, color: M_DIM, letterSpacing: '0.10em' }}>{label}</div>
      <div className="font-medium tabular-nums" style={{ fontSize: 14, color: warn ? '#EF4444' : M_TEXT }}>{value}</div>
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
        style={{ background: M_CARD, border: `1px solid ${M_BORDER}`, borderRadius: 24, boxShadow: `0 4px 24px rgba(0,0,0,0.60), 0 1px 6px rgba(0,0,0,0.40), inset 0 1px 0 rgba(200,169,110,0.07)` }}>
        <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${M_GOLD}, transparent)`, borderRadius: '24px 24px 0 0', opacity: 0.70 }} />
        <div className="p-3.5">
          <div className="uppercase font-medium mb-3" style={{ fontSize: 10, color: M_GOLD, letterSpacing: '0.32em' }}>BURMESTER MÜZİK</div>
          <div className="flex items-center gap-3 mb-3.5">
            <div className="rounded-2xl flex-shrink-0 flex items-center justify-center overflow-hidden"
              style={{
                width: 'var(--lp-album, 52px)', height: 'var(--lp-album, 52px)',
                background: 'linear-gradient(135deg, rgba(200,169,110,0.13), rgba(200,169,110,0.05))',
                border: `1px solid rgba(200,169,110,0.18)`,
              }}>
              {track.albumArt
                ? <img src={track.albumArt} className="w-full h-full object-cover" alt="" />
                : <span style={{ fontSize: 'var(--lp-font-xl, 22px)' }}>🎵</span>
              }
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-normal leading-tight truncate" style={{ fontSize: 13, color: M_TEXT }}>
                {track.title || 'Seçili parça yok'}
              </div>
              <div className="font-light mt-0.5 truncate" style={{ fontSize: 11, color: M_DIM }}>
                {track.artist || 'Burmester Surround'}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-5">
            <button onClick={() => previous()} className="active:scale-90 transition-all p-2">
              <SkipBack className="w-4.5 h-4.5" style={{ color: M_DIM2 }} />
            </button>
            <button onClick={() => togglePlayPause()}
              className="w-11 h-11 rounded-2xl flex items-center justify-center active:scale-90 transition-all"
              style={{
                background: 'linear-gradient(135deg, rgba(200,169,110,0.22), rgba(200,169,110,0.10))',
                border: `1px solid rgba(200,169,110,0.32)`,
                boxShadow: `0 4px 14px rgba(200,169,110,0.16)`,
              }}>
              {playing
                ? <Pause className="w-5 h-5" style={{ color: M_GOLD }} />
                : <Play  className="w-5 h-5 ml-0.5" style={{ color: M_GOLD }} />
              }
            </button>
            <button onClick={() => next()} className="active:scale-90 transition-all p-2">
              <SkipForward className="w-4.5 h-4.5" style={{ color: M_DIM2 }} />
            </button>
          </div>
        </div>
      </div>

      {/* Uygulamalar */}
      <div className="flex-1 overflow-hidden"
        style={{ background: M_CARD, border: `1px solid ${M_BORDER}`, borderRadius: 24, boxShadow: `0 4px 24px rgba(0,0,0,0.60), 0 1px 6px rgba(0,0,0,0.40), inset 0 1px 0 rgba(200,169,110,0.07)` }}>
        <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${M_GOLD}, transparent)`, borderRadius: '24px 24px 0 0', opacity: 0.70 }} />
        <div className="p-3.5">
          <div className="uppercase font-medium mb-3" style={{ fontSize: 10, color: M_GOLD, letterSpacing: '0.32em' }}>MBUX UYGULAMALAR</div>
          <div className="grid grid-cols-2 gap-2">
            {apps.map(({ id, app }) => (
              <button key={id} onClick={() => onLaunch(id)}
                className="flex flex-col items-center gap-1.5 py-3.5 rounded-2xl active:scale-90 transition-all"
                style={{
                  background: 'rgba(200,169,110,0.04)',
                  border: `1px solid rgba(200,169,110,0.09)`,
                }}>
                <span className="text-xl leading-none">{app!.icon}</span>
                <span className="font-light" style={{ fontSize: 10, color: M_DIM }}>{app!.name}</span>
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
        boxShadow: `0 -1px 0 rgba(200,169,110,0.07)`,
      }}>
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar px-4 py-2.5">
        {apps.map(({ id, app }) => (
          <button key={id} onClick={() => onLaunch(id)}
            className="flex flex-col items-center gap-1.5 flex-shrink-0 px-3 py-2.5 rounded-2xl active:scale-90 transition-all"
            style={{ minWidth: 'var(--lp-tile-w, 56px)' }}>
            <span className="text-xl leading-none">{app!.icon}</span>
            <span className="font-medium truncate w-full text-center" style={{ fontSize: 10, color: M_DIM }}>{app!.name}</span>
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
          <VoiceAssistant onClose={() => setVoiceOpen(false)} minimal />
        </Suspense>
      )}

      <div className="relative z-10 flex flex-col h-full">
        <MercedesHeader onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onVoice={() => setVoiceOpen(true)} />

        <div className="flex-1 min-h-0 grid gap-2.5 overflow-hidden"
          style={{
            gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,0.85fr)',
            padding: 'var(--lp-space-sm, 8px)',
            paddingLeft: 'calc(var(--lp-space-sm, 8px) + var(--lp-side-pad, 0px))',
            paddingRight: 'calc(var(--lp-space-sm, 8px) + var(--lp-side-pad, 0px))',
          }}>
          <MercedesMap onOpenMap={onOpenMap} fullMapOpen={fullMapOpen} />
          <MercedesCockpit />
          <MercedesSide appMap={appMap} onLaunch={onLaunch} />
        </div>

        <MercedesDock appMap={appMap} dockIds={dockIds} onLaunch={onLaunch} />
      </div>
    </div>
  );
});
