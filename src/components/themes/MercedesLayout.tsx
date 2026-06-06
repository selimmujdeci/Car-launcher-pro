import { memo, useState, lazy, Suspense, useEffect } from 'react';
import { DockBar } from '../layout/DockBar';

const VoiceAssistant = lazy(() => import('../modals/VoiceAssistant').then(m => ({ default: m.VoiceAssistant })));
import {
  Search, Grid3X3, SkipBack, SkipForward, Play, Pause,
  Gauge, Thermometer, Fuel, Settings, Star,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useMediaState, togglePlayPause, next, previous, startMediaHub, stopMediaHub } from '../../platform/mediaService';
import { useOBDState } from '../../platform/obdService';
import { useGPSLocation, resolveSpeedKmh } from '../../platform/gpsService';
import { useClock } from '../../hooks/useClock';
import { useDeviceStatus } from '../../platform/deviceApi';
import { MiniMapWidget } from '../map/MiniMapWidget';
import { APP_MAP, type AppItem } from '../../data/apps';
import type { SmartSnapshot } from '../../platform/smartEngine';
import { MagicContextCard } from '../common/MagicContextCard';

/* ══════════════════════════════════════════
   MERCEDES THEME — MBUX Hyperscreen Style
   Siyah + Amber (#E0A23C) — tek OEM aksanı
   ══════════════════════════════════════════ */

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

/* Tema renkleri CSS custom property — index.css [data-theme="mercedes"] */
const M_BG     = 'var(--bg-primary, #0e0e0e)';
const M_GOLD   = 'var(--accent, #E0A23C)';
const M_CARD   = 'var(--bg-card, rgba(16,14,14,0.97))';
const M_BORDER = 'var(--border-color, rgba(224,162,60,0.13))';
const M_TEXT   = 'var(--text, #F5F0EB)';
const M_DIM    = 'var(--text-dim, #9E9893)';
const M_DIM2   = 'var(--text-dim2, #B5B0AB)';

/* ─── MERCEDES HEADER ─────────────────────────────────────────── */
const MercedesHeader = memo(function MercedesHeader({ onOpenApps, onOpenSettings, onVoice }: { onOpenApps: () => void; onOpenSettings: () => void; onVoice: () => void }) {
  const use24Hour = useStore(s => s.settings.use24Hour);
  const { time, date } = useClock(use24Hour, false);
  const device = useDeviceStatus();
  const obd = useOBDState();
  const fuelRange = obd.fuelLevel != null && obd.fuelLevel >= 0
    ? Math.round((obd.fuelLevel / 100) * 750)
    : null;

  return (
    <div className="flex items-center justify-between px-6 flex-shrink-0"
      style={{
        height: 56,
        background: 'rgba(6,5,5,0.99)',
        borderBottom: `1px solid ${M_BORDER}`,
        boxShadow: `0 1px 0 rgba(224,162,60,0.07), 0 4px 20px rgba(0,0,0,0.55)`,
      }}>

      {/* Sol: Mercedes yıldızı + saat */}
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, rgba(224,162,60,0.18), rgba(224,162,60,0.07))',
            border: `1px solid rgba(224,162,60,0.28)`,
            boxShadow: `0 3px 12px rgba(224,162,60,0.12)`,
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
        <MStatus label="MENZIL" value={fuelRange != null ? `${fuelRange} km` : '— km'} />
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
            background: 'linear-gradient(135deg, rgba(224,162,60,0.18), rgba(224,162,60,0.08))',
            border: `1px solid rgba(224,162,60,0.32)`,
            color: M_GOLD,
            boxShadow: `0 3px 14px rgba(224,162,60,0.08)`,
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
      style={{ background: M_CARD, border: `1px solid ${M_BORDER}`, borderRadius: 24, boxShadow: `0 8px 40px rgba(0,0,0,0.70), 0 2px 10px rgba(0,0,0,0.45), inset 0 1px 0 rgba(224,162,60,0.07)` }}>

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
          ? <div className="w-full h-full flex items-center justify-center bg-[#080808]">
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
          style={{ background: 'rgba(224,162,60,0.07)', border: `1px solid rgba(224,162,60,0.16)` }}>
          <div className="font-light" style={{ fontSize: 9, color: M_DIM, letterSpacing: '0.1em' }}>ETA</div>
          <div className="font-normal tabular-nums mt-0.5" style={{ fontSize: 13, color: M_GOLD }}>--:--</div>
          </div>
          </div>
          </div>
          );
          });

          /* ─── MERCEDES SPEED ─────────────────────────────────────────── */
          const MercedesSpeed = memo(function MercedesSpeed() {
          const obd = useOBDState();
          const gps = useGPSLocation();
          const speedKmh = resolveSpeedKmh(gps, obd.speed ?? 0);
          const rpm  = obd.rpm        ?? 0;
          const temp = obd.engineTemp ?? 0;
          const fuelRaw = obd.fuelLevel; const fuel = (fuelRaw != null && fuelRaw > 0) ? Math.max(0, fuelRaw) : null;
  const tempWarn = temp > 100;
  const fuelWarn = fuel != null && fuel > 0 && fuel < 15;
  const obdReady = obd.connectionState === 'connected' || obd.source === 'mock';
  const hasData  = obdReady || speedKmh > 0;

  // Referans DriveCoreCard geometrisi — 240° yay (-210°→+30°), volumetrik gauge
  const SPEED_MAX = 240;
  const cxG = 240, cyG = 240, arcR = 218;
  const startA = -210, endA = 30;
  const v = Math.max(0, Math.min(1, speedKmh / SPEED_MAX));
  const sweep = (endA - startA) * v;
  const polar = (deg: number, r: number): [number, number] => {
    const a = (deg - 90) * Math.PI / 180;
    return [cxG + r * Math.cos(a), cyG + r * Math.sin(a)];
  };
  const [sx, sy] = polar(startA, arcR);
  const [ex, ey] = polar(startA + sweep, arcR);
  const [tStartX, tStartY] = polar(startA, arcR);
  const [tEndX, tEndY] = polar(endA, arcR);
  const largeArc = sweep > 180 ? 1 : 0;
  const gTicks = Array.from({ length: 10 }).map((_, i) => {
    const a = startA + (endA - startA) * (i / 9);
    const [x1, y1] = polar(a, arcR - 14);
    const [x2, y2] = polar(a, arcR - 4);
    return { x1, y1, x2, y2, major: i % 2 === 0 };
  });
  const [limX, limY] = polar(startA + (endA - startA) * (80 / SPEED_MAX), arcR - 34);

  return (
    <div className="flex flex-col h-full overflow-hidden"
      style={{ background: M_CARD, border: `1px solid ${M_BORDER}`, borderRadius: 24, boxShadow: `0 8px 40px rgba(0,0,0,0.70), 0 2px 10px rgba(0,0,0,0.45), inset 0 1px 0 rgba(224,162,60,0.07)` }}>

      <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${M_GOLD}, transparent)`, flexShrink: 0, borderRadius: '24px 24px 0 0', opacity: 0.70 }} />

      <div className="flex-shrink-0 px-4 pt-3 pb-2.5"
        style={{ borderBottom: `1px solid ${M_BORDER}` }}>
        <div className="uppercase font-medium" style={{ fontSize: 10, color: M_GOLD, letterSpacing: '0.32em' }}>MERCEDES-AMG</div>
        <div className="font-light mt-0.5" style={{ fontSize: 13, color: M_TEXT }}>Dijital Gösterge</div>
      </div>

      <div className="flex-1 flex items-center justify-center relative min-h-0 px-2">
        {/* Referans DriveCoreCard — volumetrik amber gauge (Tesla/MBUX kalitesi) */}
        <div style={{ position: 'relative', width: 'min(94%, 360px)', aspectRatio: '1 / 1' }}>
          {/* Volumetrik glow yığını — hacim hissi */}
          <div className="absolute" style={{ inset: '4%', borderRadius: '999px',
            background: 'radial-gradient(circle, rgba(224,162,60,0.16), transparent 60%)', filter: 'blur(24px)' }} />
          <div className="absolute" style={{ inset: '20%', borderRadius: '999px',
            background: 'radial-gradient(circle, rgba(224,162,60,0.10), transparent 65%)', filter: 'blur(12px)' }} />

          <svg width="100%" height="100%" viewBox="0 0 480 480" style={{ position: 'absolute', inset: 0 }}>
            <defs>
              <linearGradient id="mSpeedArc" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0" stopColor="#C9831A" />
                <stop offset="0.6" stopColor="#E8B86A" />
                <stop offset="1" stopColor="#F6E2B8" />
              </linearGradient>
              <filter id="mArcGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" />
              </filter>
            </defs>

            {/* Tick'ler */}
            {gTicks.map((tk, i) => (
              <line key={i} x1={tk.x1} y1={tk.y1} x2={tk.x2} y2={tk.y2}
                stroke="rgba(232,224,208,0.22)" strokeWidth={tk.major ? 2 : 1} strokeLinecap="round" />
            ))}

            {/* Track yay */}
            <path d={`M ${tStartX} ${tStartY} A ${arcR} ${arcR} 0 1 1 ${tEndX} ${tEndY}`}
              fill="none" stroke="rgba(232,224,208,0.08)" strokeWidth="6" strokeLinecap="round" />

            {/* Dolum yayı — çift stroke (blur glow + keskin) */}
            {v > 0.01 && (
              <>
                <path d={`M ${sx} ${sy} A ${arcR} ${arcR} 0 ${largeArc} 1 ${ex} ${ey}`}
                  fill="none" stroke="url(#mSpeedArc)" strokeWidth="14" strokeLinecap="round"
                  filter="url(#mArcGlow)" opacity="0.45" />
                <path d={`M ${sx} ${sy} A ${arcR} ${arcR} 0 ${largeArc} 1 ${ex} ${ey}`}
                  fill="none" stroke="url(#mSpeedArc)" strokeWidth="6" strokeLinecap="round" />
              </>
            )}

            {/* Hız limiti işareti — 80 km/h */}
            <g>
              <circle cx={limX} cy={limY} r="15" fill="rgba(20,24,32,0.85)" stroke="#E0A23C" strokeWidth="2" />
              <text x={limX} y={limY + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="#F2C277" fontFamily="Inter, system-ui">80</text>
            </g>
          </svg>

          {/* Merkez okuma — devasa ince sayı */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="tabular-nums" style={{ fontSize: 'clamp(64px, 17vh, 124px)', fontWeight: 200, lineHeight: 1, letterSpacing: '-0.05em', color: M_TEXT, textShadow: '0 0 32px rgba(244,206,134,0.18)' }}>
              {Math.round(speedKmh)}
            </div>
            <div className="uppercase" style={{ fontSize: 12, letterSpacing: '0.36em', color: M_GOLD, marginTop: 4, fontWeight: 600 }}>
              KM · SAAT
            </div>
            <div className="flex items-center gap-1.5 mt-3 px-2.5 py-1 rounded-full"
              style={{
                background: hasData ? 'rgba(52,211,153,0.10)' : 'rgba(224,162,60,0.08)',
                border: `1px solid ${hasData ? 'rgba(52,211,153,0.28)' : 'rgba(224,162,60,0.20)'}`,
              }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: hasData ? '#34D399' : 'rgba(224,162,60,0.7)',
                boxShadow: hasData ? '0 0 6px rgba(52,211,153,0.8)' : 'none',
              }} />
              <span className="uppercase font-medium" style={{ fontSize: 8, letterSpacing: '0.18em', color: hasData ? '#34D399' : M_DIM }}>
                {hasData ? 'OBD-II Canlı' : 'Sinyal bekleniyor'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Veri */}
      <div className="flex gap-2 px-4 pb-4 flex-shrink-0">
        <MDataCell Icon={Gauge}       label="TORK"  value={hasData ? `${rpm.toLocaleString()}` : '--'}     warn={false} />
        <MDataCell Icon={Thermometer} label="MOTOR" value={hasData ? `${Math.round(temp)}°C` : '--'}       warn={tempWarn} />
        <MDataCell Icon={Fuel}        label="YAKIT" value={fuel != null ? `${Math.round(fuel)}%` : '—'}       warn={fuelWarn} />
      </div>
    </div>
  );
});

function MDataCell({ Icon, label, value, warn }: { Icon: typeof Gauge; label: string; value: string; warn: boolean }) {
  return (
    <div className="flex-1 rounded-2xl p-3.5 text-center"
      style={{
        background: warn ? 'rgba(204,50,50,0.07)' : 'rgba(224,162,60,0.04)',
        border: `1px solid ${warn ? 'rgba(204,50,50,0.18)' : 'rgba(224,162,60,0.09)'}`,
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

  useEffect(() => {
    startMediaHub();
    return () => stopMediaHub();
  }, []);
  const ids = ['maps', 'phone', 'youtube', 'settings'];
  const apps = ids.map(id => ({ id, app: appMap[id] ?? APP_MAP[id] })).filter(x => x.app);

  return (
    <div className="flex flex-col gap-2.5 h-full min-h-0">

      {/* Müzik */}
      <div className="overflow-hidden flex-shrink-0"
        style={{ background: M_CARD, border: `1px solid ${M_BORDER}`, borderRadius: 24, boxShadow: `0 4px 24px rgba(0,0,0,0.60), 0 1px 6px rgba(0,0,0,0.40), inset 0 1px 0 rgba(224,162,60,0.07)` }}>
        <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${M_GOLD}, transparent)`, borderRadius: '24px 24px 0 0', opacity: 0.70 }} />
        <div className="p-3.5">
          <div className="uppercase font-medium mb-3" style={{ fontSize: 10, color: M_GOLD, letterSpacing: '0.32em' }}>BURMESTER MÜZİK</div>
          <div className="flex items-center gap-3 mb-3.5">
            <div className="rounded-2xl flex-shrink-0 flex items-center justify-center overflow-hidden"
              style={{
                width: 'var(--lp-album, 52px)', height: 'var(--lp-album, 52px)',
                background: 'linear-gradient(135deg, rgba(224,162,60,0.13), rgba(224,162,60,0.05))',
                border: `1px solid rgba(224,162,60,0.18)`,
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
                background: 'linear-gradient(135deg, rgba(224,162,60,0.22), rgba(224,162,60,0.10))',
                border: `1px solid rgba(224,162,60,0.32)`,
                boxShadow: `0 4px 14px rgba(224,162,60,0.16)`,
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
        style={{ background: M_CARD, border: `1px solid ${M_BORDER}`, borderRadius: 24, boxShadow: `0 4px 24px rgba(0,0,0,0.60), 0 1px 6px rgba(0,0,0,0.40), inset 0 1px 0 rgba(224,162,60,0.07)` }}>
        <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${M_GOLD}, transparent)`, borderRadius: '24px 24px 0 0', opacity: 0.70 }} />
        <div className="p-3.5">
          <div className="uppercase font-medium mb-3" style={{ fontSize: 10, color: M_GOLD, letterSpacing: '0.32em' }}>MBUX UYGULAMALAR</div>
          <div className="grid grid-cols-2 gap-2">
            {apps.map(({ id, app }) => (
              <button key={id} onClick={() => onLaunch(id)}
                className="flex flex-col items-center gap-1.5 py-3.5 rounded-2xl active:scale-90 transition-all"
                style={{
                  background: 'rgba(224,162,60,0.04)',
                  border: `1px solid rgba(224,162,60,0.09)`,
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


/* ─── MERCEDES LAYOUT ─────────────────────────────────────────── */
export const MercedesLayout = memo(function MercedesLayout({
  onOpenMap, onOpenApps, onOpenSettings, onLaunch, appMap, dockIds, fullMapOpen, smart,
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
            gridTemplateColumns: 'var(--l-grid-cols, minmax(0,1fr) minmax(0,1fr) minmax(0,0.85fr))',
            padding: 'var(--lp-space-sm, 8px)',
            paddingLeft: 'calc(var(--lp-space-sm, 8px) + var(--lp-side-pad, 0px))',
            paddingRight: 'calc(var(--lp-space-sm, 8px) + var(--lp-side-pad, 0px))',
          }}>
          <MercedesMap onOpenMap={onOpenMap} fullMapOpen={fullMapOpen} />
          <MercedesSpeed />
          <MercedesSide appMap={appMap} onLaunch={onLaunch} />
        </div>

        {smart && smart.predictions.length > 0 && (
          <div className="px-2.5 pb-1.5">
            <MagicContextCard smart={smart} variant="mercedes" onLaunch={onLaunch} onOpenMap={onOpenMap} />
          </div>
        )}

        <div style={{ height: 'var(--lp-dock-h, 68px)', flexShrink: 0 }} />
        <DockBar appMap={appMap} dockIds={dockIds} onLaunch={onLaunch} onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onVoice={() => setVoiceOpen(true)} />
      </div>
    </div>
  );
});
