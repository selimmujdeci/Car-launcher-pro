import { memo, useState, lazy, Suspense, useEffect, useMemo, useRef, createContext, useContext } from 'react';
import {
  Navigation, Music2, Mic, Wind, Settings, Car, Bell,
  Plus, Minus, SkipBack, SkipForward, Play, Pause, MoreVertical,
  Bluetooth, Wifi, Volume2, ChevronRight, Maximize2, CornerUpRight,
  BatteryCharging, Fuel,
  Phone, Cloud, AlertTriangle, Camera, Route, ShieldAlert, Shield, Tv2, Zap, LayoutGrid,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useMediaState, togglePlayPause, next, previous, startMediaHub, stopMediaHub } from '../../platform/mediaService';
import { useOBDState } from '../../platform/obdService';
import { useGPSLocation, resolveSpeedKmh } from '../../platform/gpsService';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import { useClock } from '../../hooks/useClock';
import { useNotificationState } from '../../platform/notificationService';
import { openDrawer } from '../../platform/drawerBus';
import { openMusicDrawer } from '../../platform/mediaUi';
import { MiniMapWidget } from '../map/MiniMapWidget';
import { type AppItem } from '../../data/apps';
import type { SmartSnapshot } from '../../platform/smartEngine';
import { MagicContextCard } from '../common/MagicContextCard';
import emblemUrl from '../../assets/expedition/emblem.png';
import roverUrl from '../../assets/expedition/rover.png';

const VoiceAssistant = lazy(() => import('../modals/VoiceAssistant').then(m => ({ default: m.VoiceAssistant })));

/* ══════════════════════════════════════════════════════════════════════
   CarOS EXPEDITION — bolted-metal cockpit (Claude Design entegrasyonu)
   İki rejim:  Day (kum/kağıt)  ·  Night (pas/dövme metal — kanonik).
   Palet settings.dayNightMode ile seçilir → useDayNightManager saate göre
   day/night çevirir → otomatik eşleşme; manuel seçim de çalışır.
   Tokenlar expedition.css'ten birebir alındı. Mali-400: blur yok, hafif
   SVG noise (tek katman), kontrollü gölge, canlı veri korunur.
   ══════════════════════════════════════════════════════════════════════ */

// hafif grayscale fractal-noise (worn-metal dokusu) — expedition.css --rust-fine
const NOISE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.55' numOctaves='3' stitchTiles='stitch' seed='4'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23f)'/%3E%3C/svg%3E\")";

interface Pal {
  night: boolean;
  accent: string; accentDeep: string; accentGlow: string;
  ink: string; ink2: string; ink3: string;
  plate: string; plateRaised: string; plateSunk: string;
  edge: string; edgeLight: string; hairline: string;
  rivetL: string; rivetD: string;
  plateTex: string; plateBlend: string; plateShadow: string; bevel: string;
  desk: string;
}

const DAY: Pal = {
  night: false,
  accent: '#E07B14', accentDeep: '#B65F0C', accentGlow: 'rgba(255,154,46,0.45)',
  ink: '#2A2620', ink2: '#6E665A', ink3: '#A79E90',
  plate: '#F4F0E8', plateRaised: '#FBF8F2', plateSunk: '#EBE5DA',
  edge: '#B3AA99', edgeLight: 'rgba(255,255,255,.85)', hairline: 'rgba(60,48,28,.12)',
  rivetL: '#EDE7DA', rivetD: '#8A8276',
  plateTex: `radial-gradient(70% 60% at 25% 12%, rgba(255,255,255,.5), transparent 60%), ${NOISE}, linear-gradient(165deg,#FBF7EF,#ECE5D7)`,
  plateBlend: 'normal, soft-light, normal',
  plateShadow: '0 8px 22px rgba(54,40,18,.16), 0 2px 5px rgba(54,40,18,.12)',
  bevel: 'inset 0 2px 0 rgba(255,255,255,.85), inset 0 1px 6px rgba(0,0,0,.10), inset 0 -3px 7px rgba(60,48,28,.18)',
  desk: 'radial-gradient(140% 120% at 30% 0%, #FBF7EF, #E7DECF 55%, #DED3C0)',
};

const NIGHT: Pal = {
  night: true,
  accent: '#F2871C', accentDeep: '#B65F0C', accentGlow: 'rgba(242,135,28,0.5)',
  ink: '#EDE4D2', ink2: '#AE9C7E', ink3: '#6E6049',
  plate: '#1c1610', plateRaised: '#251d12', plateSunk: '#100c07',
  edge: '#4a3820', edgeLight: 'rgba(176,134,76,.40)', hairline: 'rgba(176,134,76,.16)',
  rivetL: '#93724a', rivetD: '#0c0905',
  plateTex: `radial-gradient(62% 52% at 20% 4%, rgba(200,148,68,.26), transparent 56%), ${NOISE}, linear-gradient(162deg,#2c2216 0%,#1b1310 50%,#0f0c09 100%)`,
  plateBlend: 'soft-light, overlay, normal',
  plateShadow: '0 14px 30px rgba(0,0,0,.62), 0 3px 8px rgba(0,0,0,.55)',
  bevel: 'inset 0 2px 0 rgba(176,134,76,.40), inset 0 2px 10px rgba(0,0,0,.45), inset 0 -4px 12px rgba(0,0,0,.78)',
  desk: 'radial-gradient(160% 140% at 50% -8%, #16130e 0%, #0c0a07 60%, #060508 100%)',
};

const PalCtx = createContext<Pal>(NIGHT);
const usePal = () => useContext(PalCtx);

const KEYFRAMES = `
  @keyframes exPulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  .ex-btn { transition: transform .13s ease; }
  .ex-btn:active { transform: scale(0.93); }
  .ex-dock-scroll::-webkit-scrollbar { display: none; }
  .ex-dock-btn { transition: color .15s ease; }
`;
let _exInjected = false;
function injectEx() {
  if (_exInjected || typeof document === 'undefined') return;
  _exInjected = true;
  const el = document.createElement('style');
  el.textContent = KEYFRAMES;
  document.head.appendChild(el);
}

/* ─── PLAKA (cıvatalı dövme metal) ───────────────────────────────── */
function plateStyle(p: Pal): React.CSSProperties {
  return {
    position: 'relative',
    minWidth: 0,          // grid/flex hücresinde içeriğe göre küçülebilsin (taşma önlenir)
    overflow: 'hidden',   // içerik plakayı aşarsa kırp (kart dışarı taşmaz)
    borderRadius: 20,
    backgroundColor: p.plate,
    backgroundImage: p.plateTex,
    backgroundBlendMode: p.plateBlend,
    border: `1px solid ${p.edge}`,
    boxShadow: `${p.plateShadow}, ${p.bevel}`,
  };
}
const Plate = memo(function Plate({ children, style, className, onClick }: { children: React.ReactNode; style?: React.CSSProperties; className?: string; onClick?: () => void }) {
  const p = usePal();
  return (
    <div className={className} onClick={onClick} style={{ ...plateStyle(p), ...style }}>
      <Rivets />
      {children}
    </div>
  );
});
function Rivets() {
  const p = usePal();
  const rv = (pos: React.CSSProperties) => (
    <span style={{ position: 'absolute', width: 11, height: 11, borderRadius: '50%', zIndex: 4, background: `radial-gradient(circle at 34% 28%, ${p.rivetL}, ${p.rivetD} 72%)`, boxShadow: '0 1px 2px rgba(0,0,0,.6), 0 0 0 1px rgba(0,0,0,.4), inset 0 0 1px rgba(255,220,160,.4)', ...pos }} />
  );
  return <>{rv({ top: 13, left: 13 })}{rv({ top: 13, right: 13 })}{rv({ bottom: 13, left: 13 })}{rv({ bottom: 13, right: 13 })}</>;
}
function Label({ children }: { children: React.ReactNode }) {
  const p = usePal();
  return <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: p.ink2 }}>{children}</div>;
}

/* ─── HEADER (brand seal + status) ───────────────────────────────── */
const Header = memo(function Header() {
  const p = usePal();
  const use24Hour = useStore(s => s.settings.use24Hour);
  const { time } = useClock(use24Hour, false);
  const ambient = useUnifiedVehicleStore(s => s.canAmbientTemp);
  const n = useNotificationState();
  return (
    <div className="flex items-center justify-between flex-shrink-0" style={{ height: 50, padding: '0 16px' }}>
      <div className="flex items-center" style={{ gap: 12 }}>
        <img src={emblemUrl} alt="CarOS" style={{ width: 38, height: 38, objectFit: 'contain', filter: p.night ? 'drop-shadow(0 2px 4px rgba(0,0,0,.55))' : 'none' }} />
        <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '0.22em', color: p.ink2 }}>CAR<b style={{ color: p.ink }}>OS</b></div>
      </div>
      <div className="flex items-center" style={{ gap: 16, color: p.ink2 }}>
        <button onClick={() => openDrawer('notifications')} className="ex-btn relative" style={{ background: 'none', border: 'none', cursor: 'pointer', color: p.ink2, display: 'flex' }}>
          <Bell className="w-[18px] h-[18px]" />
          {n.unreadCount > 0 && <span style={{ position: 'absolute', top: -4, right: -5, minWidth: 14, height: 14, background: p.accent, color: '#1a0f02', fontSize: 8, fontWeight: 900, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 2px' }}>{n.unreadCount > 9 ? '9+' : n.unreadCount}</span>}
        </button>
        <Bluetooth className="w-4 h-4" />
        <div className="flex items-end" style={{ gap: 2, height: 15 }}>
          {[5, 8, 11, 14].map((h, i) => <div key={i} style={{ width: 3, height: h, background: p.ink2, borderRadius: 1 }} />)}
        </div>
        <Wifi className="w-[18px] h-[18px]" />
        <Volume2 className="w-[18px] h-[18px]" />
        <span style={{ fontWeight: 700, fontSize: 17, color: p.ink, fontVariantNumeric: 'tabular-nums' }}>{ambient != null ? `${Math.round(ambient)}°C` : '—'}</span>
        <span style={{ width: 1, height: 18, background: p.hairline }} />
        <span style={{ fontWeight: 700, fontSize: 17, color: p.ink, fontVariantNumeric: 'tabular-nums' }}>{time}</span>
      </div>
    </div>
  );
});

/* ─── SPEED PLATE (saat + gösterge + D/4WD) ──────────────────────── */
const SpeedPlate = memo(function SpeedPlate() {
  const p = usePal();
  const use24Hour = useStore(s => s.settings.use24Hour);
  const { time, date } = useClock(use24Hour, false);
  const obd = useOBDState();
  const gps = useGPSLocation();
  const speed = Math.round(resolveSpeedKmh(gps, obd.speed ?? 0));
  // 270° yay (r=100, çevre 628 → görünür 471); dolum = hız/200
  const offset = useMemo(() => 471 - Math.min(speed / 200, 1) * 471, [speed]);
  return (
    <Plate style={{ padding: '22px 20px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 46, lineHeight: 0.95, color: p.ink, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.01em' }}>{time}</div>
        <div style={{ marginTop: 5, color: p.ink2, fontSize: 14, fontWeight: 500 }}>{date}</div>
      </div>
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', position: 'relative', marginTop: 6, minHeight: 0 }}>
        <div style={{ position: 'relative', width: 'min(210px, 80%)', aspectRatio: '1' }}>
          <svg viewBox="0 0 232 232" width="100%" height="100%" style={{ transform: 'rotate(135deg)' }}>
            <circle cx="116" cy="116" r="100" fill="none" stroke={p.plateSunk} strokeWidth="16" strokeLinecap="round" strokeDasharray="471 628" />
            <circle cx="116" cy="116" r="100" fill="none" stroke={p.accent} strokeWidth="16" strokeLinecap="round" strokeDasharray="471 628" strokeDashoffset={offset} style={{ filter: `drop-shadow(0 0 6px ${p.accentGlow})`, transition: 'stroke-dashoffset .5s ease' }} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <div style={{ fontWeight: 800, fontSize: 76, lineHeight: 0.8, color: p.ink, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{speed}</div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: p.ink2 }}>KM/H</div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center" style={{ gap: 14, marginTop: 4 }}>
        <div style={{ width: 58, height: 58, borderRadius: '50%', display: 'grid', placeItems: 'center', background: p.plateSunk, border: `1px solid ${p.edge}`, boxShadow: `inset 0 3px 6px rgba(0,0,0,.5), inset 0 -1px 0 ${p.edgeLight}`, fontWeight: 800, fontSize: 28, color: p.ink, fontVariantNumeric: 'tabular-nums' }}>D</div>
        <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: '0.12em', color: p.accent }}>4WD</div>
      </div>
    </Plate>
  );
});

/* ─── RANGE / FUEL PLATE ─────────────────────────────────────────── */
const RangePlate = memo(function RangePlate() {
  const p = usePal();
  const obd = useOBDState();
  const lvl = obd.fuelLevel != null && obd.fuelLevel >= 0 ? obd.fuelLevel : null;
  const range = lvl != null ? Math.round((lvl / 100) * 750) : null;
  const seg = lvl != null ? Math.round(lvl / 10) : 0;
  return (
    <Plate style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14 }}>
      <div className="flex items-center" style={{ gap: 12 }}>
        <Fuel className="w-[26px] h-[26px]" style={{ color: p.ink2 }} />
        <span style={{ fontWeight: 800, fontSize: 32, color: p.ink, fontVariantNumeric: 'tabular-nums' }}>{range ?? '—'} <small style={{ fontSize: 17, color: p.ink2, fontWeight: 600 }}>km</small></span>
        <span style={{ marginLeft: 'auto' }}><Label>Menzil</Label></span>
      </div>
      <div className="flex items-center" style={{ gap: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: p.ink2 }}>E</span>
        <div className="flex" style={{ flex: 1, gap: 4 }}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} style={{ flex: 1, height: 14, borderRadius: 3, background: i < seg ? p.accent : p.plateSunk, boxShadow: i < seg ? `0 0 6px ${p.accentGlow}` : 'inset 0 1px 2px rgba(0,0,0,.55)' }} />
          ))}
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: p.ink2 }}>F</span>
      </div>
    </Plate>
  );
});

/* ─── MAP PLATE (canlı harita + expedition overlay) ──────────────── */
const MapPlate = memo(function MapPlate({ onOpenMap, fullMapOpen }: { onOpenMap: () => void; fullMapOpen?: boolean }) {
  const p = usePal();
  const chip: React.CSSProperties = { background: p.night ? 'rgba(16,12,7,0.82)' : 'rgba(250,244,232,0.9)', border: `1px solid ${p.edge}`, borderRadius: 13 };
  return (
    <Plate style={{ padding: 0, overflow: 'hidden', flex: 1, minWidth: 0, minHeight: 0 }} onClick={onOpenMap}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 20, overflow: 'hidden', cursor: 'pointer' }}>
        {fullMapOpen
          ? <div className="w-full h-full flex items-center justify-center" style={{ background: p.plateSunk }}><Navigation className="w-10 h-10" style={{ color: p.accent }} /></div>
          : <MiniMapWidget onFullScreenClick={onOpenMap} />}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: 20, boxShadow: p.night ? 'inset 0 0 90px rgba(0,0,0,.65), inset 0 2px 0 rgba(176,134,76,.30)' : 'inset 0 0 60px rgba(0,0,0,.4), inset 0 2px 0 rgba(255,255,255,.6)' }} />
      </div>
      <div className="absolute flex items-start justify-between" style={{ top: 14, left: 14, right: 14, pointerEvents: 'none' }}>
        <div style={{ ...chip, padding: '9px 13px', pointerEvents: 'auto' }}>
          <div className="flex items-center" style={{ gap: 12 }}>
            <div className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: 11, background: p.accent, boxShadow: `0 6px 16px ${p.accentGlow}` }}><CornerUpRight className="w-5 h-5" style={{ color: '#fff' }} /></div>
            <div>
              <div style={{ fontSize: 21, fontWeight: 800, color: p.ink, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>2.4 <span style={{ fontSize: 12, fontWeight: 600, color: p.ink2 }}>km</span></div>
              <div style={{ fontSize: 12, fontWeight: 500, color: p.ink2, marginTop: 2 }}>Sahil Yolu Cd.</div>
            </div>
          </div>
        </div>
        <div className="flex items-center" style={{ gap: 8, pointerEvents: 'auto' }}>
          <div className="flex items-center" style={{ gap: 6, padding: '6px 10px', borderRadius: 999, ...chip }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.accent, animation: 'exPulse 2s infinite' }} />
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: p.accent }}>Online</span>
          </div>
          <div className="flex items-center justify-center" style={{ width: 34, height: 34, ...chip }}><Maximize2 className="w-4 h-4" style={{ color: p.ink2 }} /></div>
        </div>
      </div>
      <div className="absolute flex flex-col" style={{ right: 14, top: '50%', transform: 'translateY(-50%)', gap: 8 }} onClick={e => e.stopPropagation()}>
        {[Plus, Minus].map((Ic, i) => <button key={i} className="ex-btn flex items-center justify-center" style={{ width: 34, height: 34, ...chip, cursor: 'pointer' }}><Ic className="w-4 h-4" style={{ color: p.ink2 }} /></button>)}
      </div>
      <div className="absolute flex items-center" style={{ bottom: 14, left: 14, pointerEvents: 'none' }}>
        <div className="flex items-center" style={{ gap: 14, padding: '8px 15px', ...chip, pointerEvents: 'auto' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: p.ink }}>23 dk</span>
          <span style={{ fontSize: 12, color: p.ink3 }}>· 19:56</span>
          <span style={{ width: 1, height: 14, background: p.hairline }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: p.ink2 }}>18 km</span>
          <span style={{ width: 1, height: 14, background: p.hairline }} />
          <div className="flex items-center" style={{ gap: 6 }}><BatteryCharging className="w-4 h-4" style={{ color: p.accent }} /><span style={{ fontSize: 12, fontWeight: 600, color: p.ink2 }}>EV kullanımı</span></div>
        </div>
      </div>
    </Plate>
  );
});

/* ─── MUSIC PLATE ────────────────────────────────────────────────── */
const MusicPlate = memo(function MusicPlate() {
  const p = usePal();
  const { playing, track } = useMediaState();
  useEffect(() => { startMediaHub(); return () => stopMediaHub(); }, []);
  const total = track.durationSec || 0;
  const elapsed = track.positionSec || 0;
  const pct = total > 0 ? Math.min((elapsed / total) * 100, 100) : 36;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const playBtn: React.CSSProperties = p.night
    ? { background: 'transparent', color: p.accent, border: `2.5px solid ${p.accent}`, boxShadow: `0 0 18px ${p.accentGlow}` }
    : { background: p.accent, color: '#1a0f02', border: 'none', boxShadow: `0 6px 16px ${p.accentGlow}, inset 0 2px 0 rgba(255,255,255,.35)` };
  return (
    <Plate style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="flex items-center" style={{ gap: 14 }}>
        <button onClick={() => openMusicDrawer()} style={{ width: 64, height: 64, borderRadius: 10, flexShrink: 0, border: `1px solid ${p.edge}`, boxShadow: '0 3px 8px rgba(0,0,0,.5)', overflow: 'hidden', background: p.plateSunk, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
          {track.albumArt ? <img src={track.albumArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music2 className="w-7 h-7" style={{ color: p.accent }} />}
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 23, lineHeight: 1.05, color: p.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title || 'Çalmıyor'}</div>
          <div style={{ color: p.ink2, fontSize: 14, fontWeight: 500, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist || 'Oynatmak için dokun'}</div>
        </div>
        <button onClick={() => openMusicDrawer()} style={{ background: 'none', border: 'none', cursor: 'pointer', color: p.ink3, alignSelf: 'flex-start' }}><MoreVertical className="w-5 h-5" /></button>
      </div>
      <div className="flex items-center justify-center" style={{ flex: 1, gap: 30, minHeight: 0 }}>
        <button onClick={() => previous()} className="ex-btn" style={{ background: 'none', border: 'none', cursor: 'pointer', color: p.ink }}><SkipBack className="w-7 h-7" style={{ fill: 'currentColor' }} /></button>
        <button onClick={() => togglePlayPause()} className="ex-btn" style={{ width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center', cursor: 'pointer', ...playBtn }}>
          {playing ? <Pause className="w-7 h-7" style={{ fill: 'currentColor' }} /> : <Play className="w-7 h-7 ml-0.5" style={{ fill: 'currentColor' }} />}
        </button>
        <button onClick={() => next()} className="ex-btn" style={{ background: 'none', border: 'none', cursor: 'pointer', color: p.ink }}><SkipForward className="w-7 h-7" style={{ fill: 'currentColor' }} /></button>
      </div>
      <div className="flex items-center" style={{ gap: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: p.ink2, fontVariantNumeric: 'tabular-nums' }}>{total > 0 ? fmt(elapsed) : '0:00'}</span>
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: p.plateSunk, boxShadow: 'inset 0 1px 2px rgba(0,0,0,.55)', position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 3, background: p.accent }} />
          <div style={{ position: 'absolute', left: `${pct}%`, top: '50%', width: 14, height: 14, borderRadius: '50%', background: p.accent, transform: 'translate(-50%,-50%)', boxShadow: `0 0 6px ${p.accent}` }} />
        </div>
        <span style={{ fontWeight: 600, fontSize: 14, color: p.ink2, fontVariantNumeric: 'tabular-nums' }}>{total > 0 ? fmt(total) : '--:--'}</span>
      </div>
    </Plate>
  );
});

/* ─── VEHICLE PLATE (CarOS Rover + canlı metrikler) ──────────────── */
const VehiclePlate = memo(function VehiclePlate({ onOpenSettings }: { onOpenSettings: () => void }) {
  const p = usePal();
  const obd = useOBDState();
  const gps = useGPSLocation();
  const volt = useUnifiedVehicleStore(s => s.canBatteryVolt);
  const speed = Math.round(resolveSpeedKmh(gps, obd.speed ?? 0));
  const motor = obd.engineTemp != null ? Math.round(obd.engineTemp) : null;
  return (
    <Plate style={{ padding: '18px 20px 0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={onOpenSettings}>
      <div className="flex items-baseline justify-between">
        <Label>Araç Durumu</Label>
        <div className="flex items-center" style={{ gap: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 28, lineHeight: 1, color: p.ink }}>Normal</span>
          <ChevronRight className="w-4 h-4" style={{ color: p.ink3 }} />
        </div>
      </div>
      {/* Rover görseli — dekor (canlı metrikler altında) */}
      <div style={{ flex: 1, position: 'relative', margin: '6px -20px 0', minHeight: 0 }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${roverUrl})`, backgroundPosition: 'center 58%', backgroundSize: '112%', backgroundRepeat: 'no-repeat', filter: p.night ? 'none' : 'brightness(1.04)' }} />
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `linear-gradient(to bottom, transparent 44%, ${p.plate} 96%)` }} />
      </div>
      <div className="flex" style={{ borderTop: `1px solid ${p.hairline}`, position: 'relative', zIndex: 2 }} onClick={e => e.stopPropagation()}>
        <Metric k="Motor" v={motor != null ? `${motor}` : '—'} unit="°C" />
        <Metric k="Akü"  v={volt != null ? volt.toFixed(1) : '—'} unit="V" border />
        <Metric k="Hız"  v={`${speed}`} unit=" km/h" border />
      </div>
    </Plate>
  );
});
function Metric({ k, v, unit, border }: { k: string; v: string; unit: string; border?: boolean }) {
  const p = usePal();
  return (
    <div style={{ flex: 1, padding: border ? '12px 4px 16px 16px' : '12px 4px 16px', borderLeft: border ? `1px solid ${p.hairline}` : undefined }}>
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', color: p.ink2, textTransform: 'uppercase' }}>{k}</div>
      <div style={{ fontWeight: 700, fontSize: 24, marginTop: 2, color: p.ink, fontVariantNumeric: 'tabular-nums' }}>{v}<small style={{ fontSize: 14, color: p.ink2, fontWeight: 600 }}>{unit}</small></div>
    </div>
  );
}

/* ─── DOCK (sürekli metal şerit + pusula) ────────────────────────── */
function DockBtn({ Icon, cap, active, onClick, badge }: { Icon: typeof Navigation; cap: string; active?: boolean; onClick: () => void; badge?: number }) {
  const p = usePal();
  // flex 0 0 33.333% → her zaman 3 buton görünür; fazlası yatay kaydırmayla gelir.
  return (
    <button onClick={onClick} className="ex-dock-btn flex flex-col items-center justify-center flex-shrink-0" style={{ flexBasis: '33.333%', minWidth: 0, scrollSnapAlign: 'start', background: 'transparent', border: 'none', cursor: 'pointer', gap: 9, color: active ? p.accent : p.ink2, borderRight: `1px solid ${p.hairline}`, position: 'relative' }}>
      {active && !p.night
        ? <span style={{ width: 46, height: 46, borderRadius: '50%', background: p.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: `0 4px 14px ${p.accentGlow}` }}><Icon className="w-6 h-6" /></span>
        : <Icon className="w-8 h-8" style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.5))' }} />}
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{cap}</span>
      {!!badge && <span style={{ position: 'absolute', top: 8, right: '22%', minWidth: 16, height: 16, background: p.accent, color: '#1a120a', fontSize: 9, fontWeight: 900, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{badge > 9 ? '9+' : badge}</span>}
    </button>
  );
}

const Compass = memo(function Compass({ onClick }: { onClick: () => void }) {
  const p = usePal();
  return (
    <button onClick={onClick} className="ex-btn" style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 150, height: 150, zIndex: 3, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'repeating-conic-gradient(from 0deg,#15151a 0 3deg,#3c3c44 3deg 6deg)', boxShadow: '0 12px 26px rgba(0,0,0,.6), inset 0 0 0 2px rgba(0,0,0,.55)' }} />
      <div style={{ position: 'absolute', inset: 11, borderRadius: '50%', background: 'conic-gradient(#8e8e96,#34343a,#6a6a72,#26262b,#8e8e96)', boxShadow: 'inset 0 2px 4px rgba(255,255,255,.25), inset 0 -3px 7px rgba(0,0,0,.75)' }} />
      <div style={{ position: 'absolute', inset: 20, borderRadius: '50%', background: 'radial-gradient(circle at 50% 36%, #232228, #0f0e12 78%)', boxShadow: `inset 0 3px 9px rgba(0,0,0,.85), inset 0 0 0 2px ${p.accent}66`, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
        <span style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', fontSize: 12, fontWeight: 700, color: '#f0e7d6' }}>N</span>
        <span style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', fontSize: 12, fontWeight: 700, color: '#cdc6ba' }}>S</span>
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 12, fontWeight: 700, color: '#cdc6ba' }}>E</span>
        <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 12, fontWeight: 700, color: '#cdc6ba' }}>W</span>
        {/* iğne */}
        <span style={{ position: 'absolute', left: '50%', top: '15%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderBottom: `40px solid ${p.accent}`, filter: `drop-shadow(0 0 6px ${p.accentGlow})` }} />
        <span style={{ position: 'absolute', left: '50%', bottom: '16%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '36px solid #5b5b63' }} />
        {/* hub — CarOS amblem */}
        <span style={{ position: 'absolute', left: '50%', top: '50%', width: 30, height: 30, transform: 'translate(-50%,-50%)', borderRadius: '50%', background: 'radial-gradient(circle at 38% 32%, #7a7a82, #18181c)', boxShadow: '0 0 0 2px rgba(0,0,0,.55), inset 0 1px 2px rgba(255,255,255,.3)', display: 'grid', placeItems: 'center', zIndex: 3 }}>
          <img src={emblemUrl} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
        </span>
        <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', pointerEvents: 'none', boxShadow: `inset 0 0 26px ${p.accentGlow}`, opacity: p.night ? 1 : 0.5 }} />
      </div>
    </button>
  );
});

/* Yatay kaydırma bölgesi — dokunmatik native; fare için tekerlek→yatay + sürükle-kaydır
   (head unit dokunmatik; ama masaüstü/fare ile de kaysın diye drag+wheel köprüsü). */
const DockScrollZone = memo(function DockScrollZone({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef({ down: false, startX: 0, startLeft: 0, moved: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (d !== 0) { el.scrollLeft += d; e.preventDefault(); }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return; // dokunmatikte native scroll
    drag.current = { down: true, startX: e.clientX, startLeft: ref.current?.scrollLeft ?? 0, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.down || !ref.current) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 5) d.moved = true;
    ref.current.scrollLeft = d.startLeft - dx;
  };
  const onPointerUp = () => { drag.current.down = false; };
  // Sürükleme sonrası yanlışlıkla buton tıklamasını bastır
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current.moved) { e.stopPropagation(); e.preventDefault(); drag.current.moved = false; }
  };
  return (
    <div ref={ref} className="ex-dock-scroll"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} onClickCapture={onClickCapture}
      style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'stretch', overflowX: 'auto', overflowY: 'hidden', scrollSnapType: 'x mandatory', scrollbarWidth: 'none', msOverflowStyle: 'none', cursor: 'grab', touchAction: 'pan-x' }}>
      {children}
    </div>
  );
});

const ExpeditionDock = memo(function ExpeditionDock({ onOpenMap, onOpenApps, onOpenSettings, onVoice }: {
  onOpenMap: () => void; onOpenApps: () => void; onOpenSettings: () => void; onVoice: () => void;
}) {
  const p = usePal();
  const n = useNotificationState();
  // İki yan grup yatay kaydırılabilir; her birinde 3 buton görünür (toplam 6),
  // kaydırınca diğerleri gelir. Ortadaki pusula ve metal şerit aynen korunur.
  return (
    <div style={{ position: 'relative', flex: '0 0 auto', height: 126 }}>
      <div style={{ ...plateStyle(p), position: 'absolute', inset: 0, display: 'flex', alignItems: 'stretch', overflow: 'hidden' }}>
        <Rivets />
        {/* Sol grup — kaydırılabilir */}
        <DockScrollZone>
          <DockBtn Icon={Navigation} cap="Navigasyon" active onClick={onOpenMap} />
          <DockBtn Icon={Music2}     cap="Müzik"      onClick={() => openMusicDrawer()} />
          <DockBtn Icon={Mic}        cap="Asistan"    onClick={onVoice} />
          <DockBtn Icon={Phone}      cap="Telefon"    onClick={() => openDrawer('phone')} />
          <DockBtn Icon={Bell}       cap="Bildirim"   onClick={() => openDrawer('notifications')} badge={n.unreadCount} />
          <DockBtn Icon={LayoutGrid} cap="Menü"       onClick={onOpenApps} />
        </DockScrollZone>
        {/* Pusula boşluğu */}
        <div style={{ flex: '0 0 168px' }} />
        {/* Sağ grup — kaydırılabilir */}
        <DockScrollZone>
          <DockBtn Icon={Wind}          cap="Klima"    onClick={() => openDrawer('climate')} />
          <DockBtn Icon={Car}           cap="Araç"     onClick={() => openDrawer('vehicle-reminder')} />
          <DockBtn Icon={Settings}      cap="Ayarlar"  onClick={onOpenSettings} />
          <DockBtn Icon={Cloud}         cap="Hava"     onClick={() => openDrawer('weather')} />
          <DockBtn Icon={AlertTriangle} cap="Trafik"   onClick={() => openDrawer('traffic')} />
          <DockBtn Icon={Camera}        cap="Dashcam"  onClick={() => openDrawer('dashcam')} />
          <DockBtn Icon={Route}         cap="Seyir"    onClick={() => openDrawer('triplog')} />
          <DockBtn Icon={ShieldAlert}   cap="Arıza"    onClick={() => openDrawer('dtc')} />
          <DockBtn Icon={Shield}        cap="Güvenlik" onClick={() => openDrawer('security')} />
          <DockBtn Icon={Tv2}           cap="Eğlence"  onClick={() => openDrawer('entertainment')} />
          <DockBtn Icon={Zap}           cap="Sport"    onClick={() => openDrawer('sport')} />
        </DockScrollZone>
      </div>
      <Compass onClick={onOpenApps} />
    </div>
  );
});

/* ─── ROOT ───────────────────────────────────────────────────────── */
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

export const ExpeditionLayout = memo(function ExpeditionLayout(props: Props) {
  const { onOpenMap, onOpenApps, onOpenSettings, onLaunch, fullMapOpen, smart } = props;
  injectEx();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const dayNightMode = useStore(s => s.settings.dayNightMode);
  const pal = dayNightMode === 'day' ? DAY : NIGHT;

  return (
    <PalCtx.Provider value={pal}>
      <div className="relative w-full h-full overflow-hidden" style={{ background: pal.desk, transition: 'background .5s ease', color: pal.ink, display: 'flex', flexDirection: 'column', padding: 16, gap: 14 }}>
        {voiceOpen && <Suspense fallback={null}><VoiceAssistant onClose={() => setVoiceOpen(false)} minimal /></Suspense>}

        <Header />

        <div style={{ flex: '1 1 auto', minHeight: 0, display: 'grid', gridTemplateColumns: 'clamp(200px,24vw,330px) minmax(0,1fr) clamp(230px,27vw,360px)', gap: 14 }}>
          {/* Sol ray */}
          <div style={{ display: 'grid', gap: 14, minWidth: 0, minHeight: 0, gridTemplateRows: '1fr clamp(120px,18vh,160px)' }}>
            <SpeedPlate />
            <RangePlate />
          </div>
          {/* Orta */}
          <div style={{ position: 'relative', minWidth: 0, minHeight: 0, display: 'flex' }}>
            <MapPlate onOpenMap={onOpenMap} fullMapOpen={fullMapOpen} />
            {smart && smart.predictions.length > 0 && (
              <div className="absolute" style={{ bottom: 64, left: 14, right: 14, zIndex: 20 }}>
                <MagicContextCard smart={smart} variant="tesla" onLaunch={onLaunch} onOpenMap={onOpenMap} />
              </div>
            )}
          </div>
          {/* Sağ ray */}
          <div style={{ display: 'grid', gap: 14, minWidth: 0, minHeight: 0, gridTemplateRows: '1fr 1fr' }}>
            <MusicPlate />
            <VehiclePlate onOpenSettings={onOpenSettings} />
          </div>
        </div>

        <ExpeditionDock onOpenMap={onOpenMap} onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onVoice={() => setVoiceOpen(true)} />
      </div>
    </PalCtx.Provider>
  );
});
