import { memo, useState, lazy, Suspense, useEffect, useMemo, useRef, createContext, useContext } from 'react';
import type { ReactNode, PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import {
  Navigation, Music2, Mic, Wind, Settings, Car, Bell,
  Plus, Minus, SkipBack, SkipForward, Play, Pause,
  Bluetooth, Wifi, ChevronRight, Maximize2, CornerUpRight,
  Thermometer, BatteryCharging, Gauge, Fuel,
  Phone, Cloud, AlertTriangle, Camera, Route, ShieldAlert, Shield, Tv2, Zap,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useDayNightAttr } from '../../hooks/useDayNightAttr';
import { useMediaState, togglePlayPause, startMediaHub, stopMediaHub } from '../../platform/mediaService';
import { next, previous, resumeLastMedia, previewLastMedia } from '../../platform/media/carosMediaLayer';
import { ensureYouTubeReady } from '../../platform/youtubeService';
import { getPerformanceMode } from '../../platform/performanceMode';
import { isLowEndDevice } from '../../platform/headUnitCompat';
import { useOBDState } from '../../platform/obdService';
import { useGPSLocation, resolveSpeedKmh } from '../../platform/gpsService';
import { useLivingThemeState } from '../../hooks/useLivingThemeState';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import { useClock } from '../../hooks/useClock';
import { useDeviceStatus } from '../../platform/deviceApi';
import { useNotificationState } from '../../platform/notificationService';
import { openDrawer } from '../../platform/drawerBus';
import { openMusicDrawer } from '../../platform/mediaUi';
import { MiniMapWidget } from '../map/MiniMapWidget';
import { type AppItem } from '../../data/apps';
import type { SmartSnapshot } from '../../platform/smartEngine';
import { MagicContextCard } from '../common/MagicContextCard';

const VoiceAssistant = lazy(() => import('../modals/VoiceAssistant').then(m => ({ default: m.VoiceAssistant })));

/* ══════════════════════════════════════════════════════════════════════
   TESLA TEMASI → OVERLAND / 4x4 EXPEDITION (dual gündüz/gece)
   Day = Sand (kum) · Night = Lava (koyu pas-metal). Palet settings.dayNightMode
   ile seçilir → useDayNightManager saate göre çevirir (otomatik gün/gece);
   manuel de seçilebilir. Mali-400: blur yok, hafif SVG topo, kontrollü gölge.
   ══════════════════════════════════════════════════════════════════════ */

interface Pal {
  night: boolean;
  accent: string; accent2: string; accentSoft: string; accentGlow: string;
  inkCritical: string; ink: string; ink2: string; ink3: string;
  card: string; cardSolid: string; cardBorder: string; cardShadow: string;
  tile: string;
  plate: string; plateActive: string; plateBorder: string; plateShadow: string;
  metal: string; metalBorder: string;
  good: string;
  screw: string; screwHi: string;
  bg: string; topo: string; topoOpacity: number; vignette: string;
  glass: string; glassBorder: string;
}

const SAND: Pal = {
  night: false,
  accent: '#E0822E', accent2: '#B85C16', accentSoft: 'rgba(224,130,46,0.16)', accentGlow: 'rgba(224,130,46,0.30)',
  inkCritical: '#160F06', ink: '#2A2014', ink2: 'rgba(42,32,20,0.66)', ink3: 'rgba(42,32,20,0.45)',
  card: 'linear-gradient(155deg,#fbf5e9 0%,#efe3cf 100%)', cardSolid: '#f6efe0',
  cardBorder: '1px solid rgba(120,92,52,0.26)',
  cardShadow: '0 6px 16px -8px rgba(90,68,38,0.34), inset 0 1px 0 rgba(255,255,255,0.75)',
  tile: 'rgba(120,92,52,0.10)',
  plate: 'linear-gradient(180deg,#f4ead7 0%,#e2d3b8 100%)', plateActive: 'linear-gradient(180deg,#f2a24c 0%,#e0822e 100%)',
  plateBorder: '1px solid rgba(120,92,52,0.32)', plateShadow: 'inset 0 1px 0 rgba(255,255,255,0.8), 0 2px 4px rgba(90,68,38,0.20)',
  metal: 'linear-gradient(180deg,#e9dcc4 0%,#d3c0a0 60%,#c2ad89 100%)', metalBorder: '1px solid rgba(120,92,52,0.4)',
  good: '#5E8A34',
  screw: '#b29a73', screwHi: 'rgba(255,255,255,0.7)',
  bg: 'radial-gradient(120% 100% at 50% -10%, #f1e6d0 0%, #e6d6ba 45%, #d8c6a2 100%)',
  topo: '#c7b083', topoOpacity: 0.5,
  vignette: 'radial-gradient(120% 92% at 50% 42%, transparent 45%, rgba(120,90,50,0.18) 100%)',
  glass: 'rgba(250,244,232,0.88)', glassBorder: '1px solid rgba(120,92,52,0.22)',
};

const LAVA: Pal = {
  night: true,
  accent: '#E0822E', accent2: '#F4A24E', accentSoft: 'rgba(224,130,46,0.14)', accentGlow: 'rgba(224,130,46,0.45)',
  inkCritical: '#FDFAF3', ink: '#F2ECE0', ink2: 'rgba(242,236,224,0.60)', ink3: 'rgba(242,236,224,0.34)',
  // CarOS Night Collection — Tesla = koyu ESPRESSO / sıcak kahve. Olive yeşilden
  // espresso kahveye çekildi (Expedition'ın yeşilinden NET ayrışır); çok hafif amber
  // yansıma, premium ve sakin. Accent/ink/plateActive korunur; yalnız zemin/yüzey hue.
  card: 'rgba(48,40,31,0.92)', cardSolid: 'rgba(40,33,25,0.97)',
  cardBorder: '1px solid rgba(224,130,46,0.18)',
  cardShadow: '0 14px 32px -16px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05)',
  tile: 'rgba(255,255,255,0.05)',
  plate: 'linear-gradient(180deg,#332a1f 0%,#201a12 100%)', plateActive: 'linear-gradient(180deg,#f2a24c 0%,#e0822e 100%)',
  plateBorder: '1px solid rgba(224,130,46,0.20)', plateShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 6px rgba(0,0,0,0.5)',
  metal: 'linear-gradient(180deg,#42352a 0%,#2a2218 55%,#1a140d 100%)', metalBorder: '1px solid rgba(0,0,0,0.5)',
  good: '#9DB857',
  screw: '#52453a', screwHi: 'rgba(255,255,255,0.12)',
  bg: 'radial-gradient(120% 100% at 50% -8%, #2f2619 0%, #221b13 46%, #16100b 100%)',
  topo: '#5c4c38', topoOpacity: 0.45,
  vignette: 'radial-gradient(120% 92% at 50% 42%, transparent 38%, rgba(0,0,0,0.5) 100%)',
  glass: 'rgba(0,0,0,0.5)', glassBorder: '1px solid rgba(255,255,255,0.08)',
};

const PalCtx = createContext<Pal>(LAVA);
const usePal = () => useContext(PalCtx);

const KEYFRAMES = `
  @keyframes exPulse { 0%,100%{opacity:1} 50%{opacity:.35} }
  .ex-btn { transition: transform .13s ease; }
  .ex-btn:active { transform: scale(0.93); }
`;
let _exStyleInjected = false;
function injectExStyles() {
  if (_exStyleInjected || typeof document === 'undefined') return;
  _exStyleInjected = true;
  const el = document.createElement('style');
  el.textContent = KEYFRAMES;
  document.head.appendChild(el);
}

/* ─── vida detayı ────────────────────────────────────────────────── */
function Screws({ inset = 7 }: { inset?: number }) {
  const p = usePal();
  const dot = (pos: React.CSSProperties) => (
    <span style={{ position: 'absolute', width: 6, height: 6, borderRadius: 4, background: `radial-gradient(circle at 38% 32%, ${p.screwHi}, ${p.screw} 70%)`, boxShadow: p.night ? 'inset 0 0 0 0.5px rgba(0,0,0,0.5)' : 'inset 0 0 0 0.5px rgba(120,90,50,0.5)', ...pos }} />
  );
  return <>{dot({ top: inset, left: inset })}{dot({ top: inset, right: inset })}{dot({ bottom: inset, left: inset })}{dot({ bottom: inset, right: inset })}</>;
}

function card(p: Pal, opts?: { solid?: boolean; pad?: number | string }): React.CSSProperties {
  return {
    position: 'relative',
    minWidth: 0,          // grid/flex hücresinde küçülebilsin (taşma önlenir)
    overflow: 'hidden',   // içerik kartı aşarsa kırp
    background: opts?.solid ? p.cardSolid : p.card,
    border: p.cardBorder,
    borderRadius: 18,
    boxShadow: p.cardShadow,
    padding: opts?.pad as React.CSSProperties['padding'],
  };
}
function Label({ children }: { children: React.ReactNode }) {
  const p = usePal();
  return <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.13em', textTransform: 'uppercase', color: p.ink2 }}>{children}</div>;
}

/* ─── TOPOĞRAFİK ARKA PLAN ───────────────────────────────────────── */
const TopoBackground = memo(function TopoBackground() {
  const p = usePal();
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, background: p.bg }} />
      <svg width="100%" height="100%" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, opacity: p.topoOpacity }}>
        <g fill="none" stroke={p.topo} strokeWidth="1.1" opacity="0.6">
          {Array.from({ length: 8 }).map((_, i) => <ellipse key={'a' + i} cx={300} cy={520} rx={56 + i * 48} ry={38 + i * 31} transform="rotate(-16 300 520)" />)}
          {Array.from({ length: 9 }).map((_, i) => <ellipse key={'b' + i} cx={1000} cy={170} rx={48 + i * 50} ry={32 + i * 34} transform="rotate(14 1000 170)" />)}
          {Array.from({ length: 6 }).map((_, i) => <path key={'c' + i} d={`M-40 ${120 + i * 95} C 220 ${70 + i * 95}, 520 ${190 + i * 95}, 760 ${120 + i * 95} S 1180 ${60 + i * 95}, 1340 ${140 + i * 95}`} />)}
        </g>
      </svg>
      <div style={{ position: 'absolute', inset: 0, background: p.vignette }} />
    </div>
  );
});

/* ─── STATUS CLUSTER ─────────────────────────────────────────────── */
const StatusCluster = memo(function StatusCluster() {
  const p = usePal();
  const device = useDeviceStatus();
  const n = useNotificationState();
  const ambient = useUnifiedVehicleStore(s => s.canAmbientTemp);
  // Living theme — bağlantı: online yeşil nabız (.lt-pulse, static tier'da durur), offline soluk.
  const online = useLivingThemeState().conn === 'online';
  return (
    <div className="flex items-center gap-3" style={{ color: p.ink2 }}>
      <span className={online ? 'lt-pulse' : undefined} aria-label={online ? 'Çevrimiçi' : 'Çevrimdışı'}
        style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: online ? '#34d399' : 'currentColor', opacity: online ? 1 : 0.4 }} />
      <button onClick={() => openDrawer('notifications')} className="ex-btn relative flex items-center justify-center" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: p.ink2 }}>
        <Bell className="w-4 h-4" />
        {n.unreadCount > 0 && (
          <span style={{ position: 'absolute', top: -4, right: -5, minWidth: 14, height: 14, background: p.accent, color: '#1a120a', fontSize: 8, fontWeight: 900, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 2px' }}>
            {n.unreadCount > 9 ? '9+' : n.unreadCount}
          </span>
        )}
      </button>
      <Bluetooth className="w-3.5 h-3.5" />
      <div className="flex items-end gap-[2px] h-3.5">
        {[4, 7, 10, 13].map((h, i) => <div key={i} style={{ width: 2.5, height: h, background: p.ink2, borderRadius: 1 }} />)}
      </div>
      <Wifi className="w-3.5 h-3.5" />
      <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: p.ink }}>{device.ready ? `${device.battery}%` : '—'}</span>
      <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: p.ink }}>{ambient != null ? `${Math.round(ambient)}°C` : '—'}</span>
    </div>
  );
});

/* ─── CLOCK CARD ─────────────────────────────────────────────────── */
const ClockCard = memo(function ClockCard() {
  const p = usePal();
  const use24Hour = useStore(s => s.settings.use24Hour);
  const { time, date } = useClock(use24Hour, false);
  return (
    <div style={{ ...card(p, { pad: '13px 16px' }) }} className="flex-shrink-0">
      <Screws />
      <div style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, color: p.ink, letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' }}>{time}</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: p.ink2, marginTop: 6 }}>{date}</div>
    </div>
  );
});

/* ─── SPEED GAUGE (4WD) ──────────────────────────────────────────── */
const SpeedGauge = memo(function SpeedGauge() {
  const p = usePal();
  const obd = useOBDState();
  const gps = useGPSLocation();
  const speed = Math.round(resolveSpeedKmh(gps, obd.speed ?? 0));
  const R = 52, cx = 64, cy = 64, START = 135, SPAN = 270;
  const arc = useMemo(() => {
    const rad = (d: number) => (d * Math.PI) / 180;
    const pt = (a: number) => ({ x: cx + R * Math.cos(rad(a)), y: cy + R * Math.sin(rad(a)) });
    const build = (a1: number, a2: number) => { const s = pt(a1), e = pt(a2), large = a2 - a1 > 180 ? 1 : 0; return `M${s.x} ${s.y} A${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`; };
    const pct = Math.min(speed / 200, 1);
    return { track: build(START, START + SPAN), fill: pct > 0.01 ? build(START, START + pct * SPAN) : null };
  }, [speed]);
  return (
    <div style={{ ...card(p, { pad: 14 }) }} className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3">
      <Screws />
      <div style={{ position: 'relative', width: 128, height: 128 }}>
        <svg viewBox="0 0 128 128" width="128" height="128" style={{ overflow: 'visible' }}>
          <path d={arc.track} fill="none" stroke={p.night ? 'rgba(255,255,255,0.08)' : 'rgba(120,92,52,0.18)'} strokeWidth="9" strokeLinecap="round" />
          {arc.fill && <path d={arc.fill} fill="none" stroke={p.accent} strokeWidth="9" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 6px ${p.accentGlow})` }} />}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span style={{ fontSize: 52, fontWeight: 800, color: p.inkCritical, lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-1px' }}>{speed}</span>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.22em', color: p.ink3, marginTop: 3 }}>KM/H</span>
        </div>
      </div>
      <div className="w-full flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl" style={{ background: p.tile }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: p.accent2 }}>D</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.12em', color: p.ink2 }}>AUTO</span>
        </div>
        <div className="px-2.5 py-1.5 rounded-xl" style={{ background: p.accentSoft, border: `1px solid ${p.accent}55` }}>
          <span style={{ fontSize: 14.5, fontWeight: 900, letterSpacing: '0.06em', color: p.accent2 }}>4WD</span>
        </div>
      </div>
    </div>
  );
});

/* ─── FUEL / MENZİL + KİLOMETRE CARD ─────────────────────────────────
   İki ayrı etiketli okuma tek panelde: Menzil (yakıt → OBD) + Kilometre
   (odometre, GPS'ten beslenir, OBD'siz de çalışır). Ayrı tam kart dar/kısa
   kolonu taşırıyordu → tek panel + ince ayraç (sığma garantili). */
const FuelCard = memo(function FuelCard() {
  const p = usePal();
  const obd = useOBDState();
  const odometer = useUnifiedVehicleStore(s => s.odometer);
  const lvl = obd.fuelLevel != null && obd.fuelLevel >= 0 ? obd.fuelLevel : null;
  const range = lvl != null ? Math.round((lvl / 100) * 750) : null;
  const seg = lvl != null ? Math.round(lvl / 10) : 0;
  return (
    <div style={{ ...card(p, { pad: '12px 14px' }) }} className="flex-shrink-0">
      <Screws inset={6} />
      <div className="flex items-center gap-2">
        <Fuel className="w-5 h-5" style={{ color: p.accent2 }} />
        <span style={{ fontSize: 24, fontWeight: 800, color: p.ink, fontVariantNumeric: 'tabular-nums' }}>{range ?? '—'}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: p.ink2 }}>km</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: p.ink3, marginLeft: 'auto' }}>MENZİL</span>
      </div>
      <div className="flex gap-1 mt-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} style={{ flex: 1, height: 6, borderRadius: 2, background: i < seg ? p.accent : p.tile }} />
        ))}
      </div>
      <div className="flex items-center gap-2" style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${p.tile}` }}>
        <Gauge className="w-5 h-5" style={{ color: p.accent2 }} />
        <span style={{ fontSize: 24, fontWeight: 800, color: p.ink, fontVariantNumeric: 'tabular-nums' }}>{Math.round(odometer)}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: p.ink2 }}>km</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: p.ink3, marginLeft: 'auto' }}>KİLOMETRE</span>
      </div>
    </div>
  );
});

/* ─── MAP CARD ───────────────────────────────────────────────────── */
const MapCard = memo(function MapCard({ onOpenMap, fullMapOpen }: { onOpenMap: () => void; fullMapOpen?: boolean }) {
  const p = usePal();
  return (
    <div onClick={onOpenMap} className="relative overflow-hidden cursor-pointer flex-1 min-h-0 min-w-0" style={{ borderRadius: 18, border: p.cardBorder, boxShadow: p.cardShadow }}>
      <div className="absolute inset-0">
        {fullMapOpen
          ? <div className="w-full h-full flex items-center justify-center" style={{ background: p.night ? '#10140c' : '#e6d6ba' }}><Navigation className="w-10 h-10" style={{ color: p.accent }} /></div>
          : <MiniMapWidget onFullScreenClick={onOpenMap} />}
      </div>
      <div className="absolute top-3 left-3 right-3 flex items-start justify-between pointer-events-none">
        <div className="pointer-events-auto" style={{ background: p.glass, border: p.glassBorder, borderRadius: 14, padding: '9px 13px', boxShadow: p.cardShadow }}>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center rounded-xl" style={{ width: 36, height: 36, background: p.accent, boxShadow: `0 6px 16px ${p.accentGlow}` }}>
              <CornerUpRight className="w-5 h-5" style={{ color: '#fff' }} />
            </div>
            <div>
              <div style={{ fontSize: 21, fontWeight: 800, color: p.ink, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>2.4 <span style={{ fontSize: 12, fontWeight: 600, color: p.ink2 }}>km</span></div>
              <div style={{ fontSize: 11.5, fontWeight: 500, color: p.ink2, marginTop: 2 }}>Sahil Yolu Cd.</div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full" style={{ background: p.glass, border: p.glassBorder }}>
            <span className="rounded-full" style={{ width: 6, height: 6, background: p.good, animation: 'exPulse 2s infinite' }} />
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: p.good }}>Online</span>
          </div>
          <div className="flex items-center justify-center rounded-xl" style={{ width: 34, height: 34, background: p.glass, border: p.glassBorder }}>
            <Maximize2 className="w-4 h-4" style={{ color: p.ink2 }} />
          </div>
        </div>
      </div>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-2 pointer-events-auto" onClick={e => e.stopPropagation()}>
        {[Plus, Minus].map((Ic, i) => (
          <button key={i} className="ex-btn flex items-center justify-center rounded-xl" style={{ width: 34, height: 34, background: p.glass, border: p.glassBorder, cursor: 'pointer' }}>
            <Ic className="w-4 h-4" style={{ color: p.ink2 }} />
          </button>
        ))}
      </div>
      <div className="absolute bottom-3 left-3 right-3 flex items-center pointer-events-none">
        <div className="flex items-center gap-3.5 pointer-events-auto" style={{ background: p.glass, border: p.glassBorder, borderRadius: 14, padding: '8px 15px' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: p.ink }}>23 dk</span>
          <span style={{ fontSize: 11.5, color: p.ink3 }}>· 19:56</span>
          <div style={{ width: 1, height: 14, background: p.night ? 'rgba(255,255,255,0.12)' : 'rgba(120,92,52,0.25)' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: p.ink2 }}>18 km</span>
          <div style={{ width: 1, height: 14, background: p.night ? 'rgba(255,255,255,0.12)' : 'rgba(120,92,52,0.25)' }} />
          <div className="flex items-center gap-1.5">
            <BatteryCharging className="w-4 h-4" style={{ color: p.good }} />
            <span style={{ fontSize: 11.5, fontWeight: 600, color: p.ink2 }}>EV kullanımı</span>
          </div>
        </div>
      </div>
    </div>
  );
});

/* ─── MUSIC CARD ─────────────────────────────────────────────────── */
const MusicCard = memo(function MusicCard() {
  const p = usePal();
  const { playing, track, hasSession } = useMediaState();
  useEffect(() => {
    startMediaHub();
    previewLastMedia();
    if (getPerformanceMode() === 'lite') {
      const id = window.setTimeout(() => { void ensureYouTubeReady().catch(() => {}); }, 4000);
      return () => { window.clearTimeout(id); stopMediaHub(); };
    }
    void ensureYouTubeReady().catch(() => {});
    return () => stopMediaHub();
  }, []);
  const handlePlay = () => {
    if (hasSession) togglePlayPause();
    else if (!resumeLastMedia()) openMusicDrawer();
  };
  return (
    <div style={{ ...card(p, { pad: 14 }) }} className="flex-shrink-0 flex items-center gap-3">
      <Screws />
      <button onClick={() => openMusicDrawer()} className="rounded-2xl overflow-hidden flex items-center justify-center flex-shrink-0" style={{ width: 66, height: 66, background: p.accentSoft, border: `1px solid ${p.accent}33`, cursor: 'pointer' }}>
        {track.albumArt ? <img src={track.albumArt} className="w-full h-full object-cover" alt="" /> : <Music2 className="w-7 h-7" style={{ color: p.accent }} />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: 17, fontWeight: 800, color: p.ink }}>{track.title || 'Çalmıyor'}</div>
        <div className="truncate" style={{ fontSize: 14, color: p.ink2, marginTop: 3 }}>{track.artist || 'Oynatmak için dokun'}</div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <button onClick={() => previous()} className="ex-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: p.ink2 }}><SkipBack className="w-6 h-6" /></button>
        <button onClick={() => handlePlay()} className="ex-btn flex items-center justify-center rounded-full" style={{ width: 48, height: 48, background: p.accent, boxShadow: `0 5px 16px ${p.accentGlow}`, border: 'none', cursor: 'pointer' }}>
          {playing ? <Pause className="w-6 h-6" style={{ color: '#fff' }} /> : <Play className="w-6 h-6 ml-0.5" style={{ color: '#fff' }} />}
        </button>
        <button onClick={() => next()} className="ex-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: p.ink2 }}><SkipForward className="w-6 h-6" /></button>
      </div>
    </div>
  );
});

/* ─── RUGGED SUV (markasız) ──────────────────────────────────────── */
const RuggedSUV = memo(function RuggedSUV() {
  const p = usePal();
  const wheels = [80, 228];
  const body1 = p.night ? '#dccd9f' : '#cdb88a';
  const body2 = p.night ? '#c0b07f' : '#b09a6b';
  const body3 = p.night ? '#897c52' : '#7c6c45';
  const dark = p.night ? '#15170f' : '#3a3424';
  return (
    <svg viewBox="0 0 300 140" width="100%" height="100%" style={{ maxWidth: 280 }}>
      <defs>
        <linearGradient id="exBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={body1} /><stop offset="42%" stopColor={body2} /><stop offset="100%" stopColor={body3} />
        </linearGradient>
        <linearGradient id="exGlass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.night ? '#566a72' : '#8fa6ad'} /><stop offset="100%" stopColor={p.night ? '#222a30' : '#52656c'} />
        </linearGradient>
        <radialGradient id="exRim" cx="42%" cy="38%" r="65%">
          <stop offset="0%" stopColor="#b7bcc2" /><stop offset="55%" stopColor="#717880" /><stop offset="100%" stopColor="#3c4148" />
        </radialGradient>
        <radialGradient id="exGnd" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000" stopOpacity={p.night ? 0.45 : 0.25} /><stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="150" cy="126" rx="126" ry="8" fill="url(#exGnd)" />
      <path d="M44 98 L44 80 L52 72 L96 72 L104 48 L110 44 L190 44 L210 72 L256 72 L266 84 L266 98 Z" fill="url(#exBody)" stroke={p.night ? '#6f6442' : '#5a4f33'} strokeWidth="0.6" />
      <rect x="106" y="37" width="88" height="6" rx="2" fill={dark} />
      {Array.from({ length: 7 }).map((_, i) => <line key={i} x1={114 + i * 11} y1="37" x2={114 + i * 11} y2="43" stroke={p.night ? '#2c3122' : '#4a4430'} strokeWidth="2" />)}
      <rect x="190" y="39" width="14" height="4" rx="2" fill={p.accent} opacity="0.9" />
      <path d="M200 72 L200 46 Q200 42 204 42 L207 42 L207 72 Z" fill={dark} stroke="#0e1009" strokeWidth="0.5" />
      <path d="M112 68 L116 51 L145 51 L145 68 Z" fill="url(#exGlass)" />
      <path d="M150 68 L150 51 L184 51 L197 68 Z" fill="url(#exGlass)" />
      <path d="M52 100 A30 30 0 0 1 108 100" fill="none" stroke={dark} strokeWidth="9" strokeLinecap="round" />
      <path d="M200 100 A30 30 0 0 1 256 100" fill="none" stroke={dark} strokeWidth="9" strokeLinecap="round" />
      <rect x="106" y="95" width="96" height="6" rx="2" fill={dark} />
      <rect x="106" y="92.5" width="96" height="2" rx="1" fill={p.accent} opacity="0.65" />
      <line x1="150" y1="72" x2="150" y2="95" stroke={p.night ? '#6f6442' : '#5a4f33'} strokeWidth="0.8" />
      <rect x="158" y="64" width="9" height="2.4" rx="1" fill={p.night ? '#5c5238' : '#4a4230'} />
      <rect x="252" y="74" width="10" height="7" rx="2" fill="#ffe9bf" stroke="#caa86a" strokeWidth="0.5" />
      {Array.from({ length: 4 }).map((_, i) => <line key={i} x1={255 + i * 3} y1="83" x2={255 + i * 3} y2="90" stroke={dark} strokeWidth="1.4" />)}
      <path d="M244 90 L266 90 L266 99 L246 99 Z" fill={dark} />
      <rect x="250" y="95" width="16" height="4" rx="1" fill={p.night ? '#3a4030' : '#544c34'} />
      <rect x="45" y="76" width="6" height="9" rx="1.5" fill="#c0492a" />
      <path d="M40 90 L56 90 L56 99 L40 99 Z" fill={dark} />
      {wheels.map((wx) => (
        <g key={wx}>
          <circle cx={wx} cy="108" r="26" fill="#13150e" />
          <circle cx={wx} cy="108" r="24" fill="none" stroke="#0d0f08" strokeWidth="5" strokeDasharray="3 5" />
          <circle cx={wx} cy="108" r="13.5" fill="url(#exRim)" stroke="#0c0e08" strokeWidth="1" />
          <g stroke="#3a4048" strokeWidth="1.4">
            {Array.from({ length: 5 }).map((_, i) => { const a = (i * 72 - 90) * Math.PI / 180; return <line key={i} x1={wx} y1="108" x2={wx + Math.cos(a) * 11} y2={108 + Math.sin(a) * 11} />; })}
          </g>
          <circle cx={wx} cy="108" r="3.6" fill="#2a2e22" />
        </g>
      ))}
    </svg>
  );
});

/* ─── VEHICLE STATUS CARD ────────────────────────────────────────── */
const VehicleCard = memo(function VehicleCard({ onOpenSettings }: { onOpenSettings: () => void }) {
  const p = usePal();
  const obd = useOBDState();
  const gps = useGPSLocation();
  const volt = useUnifiedVehicleStore(s => s.canBatteryVolt);
  const speed = Math.round(resolveSpeedKmh(gps, obd.speed ?? 0));
  const motor = obd.engineTemp != null ? `${Math.round(obd.engineTemp)}°C` : '—';
  const aku = volt != null ? `${volt.toFixed(1)}V` : '—';
  return (
    <div style={{ ...card(p, { solid: true, pad: 15 }) }} className="flex-1 min-h-0 flex flex-col" onClick={onOpenSettings}>
      <Screws />
      <div className="flex items-center gap-2">
        <Label>Araç Durumu</Label>
        <ChevronRight className="w-3.5 h-3.5" style={{ color: p.ink3 }} />
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: p.ink, marginTop: 4 }}>Normal</div>
      <div className="flex-1 min-h-0 flex items-center justify-center my-1"><RuggedSUV /></div>
      <div className="flex items-stretch gap-2" onClick={e => e.stopPropagation()}>
        <Stat icon={<Thermometer className="w-5 h-5" style={{ color: p.accent2 }} />} value={motor} label="Motor" />
        <Stat icon={<BatteryCharging className="w-5 h-5" style={{ color: p.good }} />} value={aku} label="Akü" />
        <Stat icon={<Gauge className="w-5 h-5" style={{ color: p.ink2 }} />} value={`${speed}`} label="Hız" />
      </div>
    </div>
  );
});
function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  const p = usePal();
  return (
    <div className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl" style={{ background: p.tile }}>
      {icon}
      <div style={{ fontSize: 17, fontWeight: 800, color: p.ink, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.04em', color: p.ink2 }}>{label}</div>
    </div>
  );
}

/* ─── DOCK — segmentli metal plaka + pusula ──────────────────────── */
function DockPlate({ Icon, label, onClick, active }: { Icon: typeof Navigation; label: string; onClick: () => void; active?: boolean }) {
  const p = usePal();
  return (
    <button onClick={onClick} className="ex-btn relative flex items-center justify-center flex-shrink-0" style={{ flex: '0 0 31%', minWidth: 0, scrollSnapAlign: 'start', height: 108, borderRadius: 18, background: active ? p.plateActive : p.plate, border: active ? `1px solid ${p.accent}` : p.plateBorder, boxShadow: p.plateShadow, gap: 13, padding: '0 15px', cursor: 'pointer' }}>
      <Icon className="w-[37px] h-[37px] flex-shrink-0" style={{ color: active ? '#241405' : p.accent2 }} />
      <span className="uppercase truncate" style={{ fontSize: 18, fontWeight: 800, letterSpacing: '0.05em', color: active ? (p.night ? '#FBC892' : '#241405') : p.ink2 }}>{label}</span>
    </button>
  );
}

/* MARKA SAATİ (Tesla imzası) — minimalist analog madalyon.
   Expedition'dan ayrışır: altın/sunburst YOK; tek ince aksan halka,
   monokrom akrepler, turuncu saniye, sade "CAROS PRO". Çok temiz/ferah.
   Day = kum kadran + koyu akrep · Night = kömür kadran + krem akrep. */
const TeslaClock = memo(function TeslaClock({ onClick }: { onClick: () => void }) {
  const p = usePal();
  // Zayıf GPU (PowerVR/Mali sınıfı): her saniye re-render = her tik ~60ms tam
  // boyama (saha ölçümü, %100 jank ana etkeni). Düşük cihazda saniye ibresi
  // çizilmez, saat 30 sn'de bir tazelenir (dakika hassasiyeti korunur).
  const lowEnd = isLowEndDevice();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), lowEnd ? 30_000 : 1000);
    return () => clearInterval(id);
  }, [lowEnd]);
  const m = now.getMinutes();
  const s = now.getSeconds();
  const hourDeg = (now.getHours() % 12) * 30 + m * 0.5;
  const minDeg  = m * 6 + s * 0.1;
  const secDeg  = s * 6;

  // Night Collection — Tesla gece saati: ESPRESSO kadran (tema kahve). Merkez
  // radial hafif açık → iç parlaklık (glow değil); krem akrep + turuncu saniye pop.
  const face = p.night
    ? 'radial-gradient(circle at 50% 34%, #2f2519 0%, #120d08 84%)'
    : 'radial-gradient(circle at 50% 34%, #faf4e6 0%, #e2d4ba 84%)';
  const ink = p.night ? '#F2ECE0' : '#2A2014';
  const dim = p.night ? 'rgba(242,236,224,0.34)' : 'rgba(42,32,20,0.32)';
  const hubRing = p.night ? '#120d08' : '#e2d4ba';

  const ticks = [];
  for (let i = 0; i < 12; i++) {
    const mj = i % 3 === 0;
    ticks.push(
      <span key={i} style={{
        position: 'absolute', left: '50%', top: '50%',
        width: mj ? 2.4 : 1.5, height: mj ? 9 : 5,
        background: mj ? ink : dim, borderRadius: 1,
        transform: `translate(-50%,-50%) rotate(${i * 30}deg) translateY(-44px)`,
        transformOrigin: 'center',
      }} />,
    );
  }

  return (
    <button onClick={onClick} className="ex-btn" aria-label="Saat — Menü" style={{ position: 'relative', width: 110, height: 110, borderRadius: '50%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, outline: 'none', WebkitTapHighlightColor: 'transparent', contain: 'paint' }}>
      {/* tek ince aksan halka + kadran */}
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: '50%', background: face, border: `2px solid ${p.accent}`, boxShadow: p.night ? `0 6px 18px -8px rgba(0,0,0,0.7), inset 0 2px 7px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,236,205,0.10)` : `0 5px 16px -5px rgba(90,68,38,0.5), inset 0 2px 6px rgba(255,255,255,0.6)` }} />
      {/* ince iç hairline */}
      <div style={{ position: 'absolute', top: 7, right: 7, bottom: 7, left: 7, borderRadius: '50%', border: `1px solid ${dim}`, pointerEvents: 'none' }} />
      {ticks}
      {/* marka — 12 altı */}
      <span style={{ position: 'absolute', top: 30, left: '50%', transform: 'translateX(-50%)', fontSize: 9.5, fontWeight: 800, letterSpacing: '0.12em', color: ink, whiteSpace: 'nowrap' }}>CAROS</span>
      <span style={{ position: 'absolute', top: 42, left: '50%', transform: 'translateX(-50%)', fontSize: 6, fontWeight: 700, letterSpacing: '0.36em', textIndent: '0.36em', color: p.accent, whiteSpace: 'nowrap' }}>PRO</span>
      {/* akrepler */}
      <div style={{ position: 'absolute', left: '50%', bottom: '50%', width: 3.4, height: 24, background: ink, borderRadius: 3, transformOrigin: '50% 100%', transform: `translateX(-50%) rotate(${hourDeg}deg)`, boxShadow: '0 1px 2px rgba(0,0,0,.4)' }} />
      <div style={{ position: 'absolute', left: '50%', bottom: '50%', width: 2.2, height: 35, background: ink, borderRadius: 3, transformOrigin: '50% 100%', transform: `translateX(-50%) rotate(${minDeg}deg)`, boxShadow: '0 1px 2px rgba(0,0,0,.4)' }} />
      {!lowEnd && <div style={{ position: 'absolute', left: '50%', bottom: '50%', width: 1.3, height: 39, background: p.accent, borderRadius: 2, transformOrigin: '50% 100%', transform: `translateX(-50%) rotate(${secDeg}deg)`, filter: `drop-shadow(0 0 3px ${p.accentGlow})` }} />}
      {/* merkez */}
      <span style={{ position: 'absolute', left: '50%', top: '50%', width: 9, height: 9, transform: 'translate(-50%,-50%)', borderRadius: '50%', background: p.accent, boxShadow: `0 0 0 2.5px ${hubRing}`, zIndex: 2 }} />
    </button>
  );
});

/* Yatay kaydırma bölgesi — DİĞER TEMALARIN (Expedition/Pro) KANITLI MANTIĞI:
   dokunmatik native scroll; fare için tekerlek→yatay + sürükle-kaydır. Sayfa/snap
   pager YOK → serbest sürekli kaydırma. */
const DockScrollZone = memo(function DockScrollZone({ children }: { children: ReactNode }) {
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
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse') return; // dokunmatikte native scroll
    drag.current = { down: true, startX: e.clientX, startLeft: ref.current?.scrollLeft ?? 0, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d.down || !ref.current) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 5) d.moved = true;
    ref.current.scrollLeft = d.startLeft - dx;
  };
  const onPointerUp = () => { drag.current.down = false; };
  // Sürükleme sonrası yanlışlıkla buton tıklamasını bastır
  const onClickCapture = (e: ReactMouseEvent) => {
    if (drag.current.moved) { e.stopPropagation(); e.preventDefault(); drag.current.moved = false; }
  };
  return (
    <div ref={ref} className="no-scrollbar"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} onClickCapture={onClickCapture}
      style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'stretch', gap: 8, overflowX: 'auto', overflowY: 'hidden', scrollSnapType: 'x proximity', scrollbarWidth: 'none', msOverflowStyle: 'none', cursor: 'grab', touchAction: 'pan-x', WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain' }}>
      {children}
    </div>
  );
});

const ExpeditionDock = memo(function ExpeditionDock({ onOpenMap, onOpenApps, onOpenSettings, onVoice }: {
  onOpenMap: () => void; onOpenApps: () => void; onOpenSettings: () => void; onVoice: () => void;
}) {
  const p = usePal();
  // Expedition mantığı: iki BAĞIMSIZ sürekli-kaydırma bölgesi, ortada her zaman
  // görünür saat (kaydırma kabı DIŞINDA overlay). Sol/sağ grup serbest kaydırılır →
  // tüm fonksiyonlara ulaşılır (pager/snap-sayfa kilidi yok).
  return (
    <div className="relative w-full" style={{ background: p.metal, borderRadius: 22, border: p.metalBorder, boxShadow: p.night ? '0 12px 30px -12px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -3px 8px rgba(0,0,0,0.55)' : '0 8px 22px -10px rgba(90,68,38,0.45), inset 0 1px 0 rgba(255,255,255,0.7), inset 0 -3px 7px rgba(120,92,52,0.25)', padding: '14px 18px 20px', minHeight: 138, zIndex: 30 }}>
      <Screws inset={9} />

      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {/* Sol grup — sürekli kaydırılabilir */}
        <DockScrollZone>
          <DockPlate Icon={Navigation} label="Navigasyon" active onClick={onOpenMap} />
          <DockPlate Icon={Music2}     label="Müzik"      onClick={() => openMusicDrawer()} />
          <DockPlate Icon={Mic}        label="Asistan"    onClick={onVoice} />
          <DockPlate Icon={Phone}      label="Telefon"    onClick={() => openDrawer('phone')} />
          <DockPlate Icon={Bell}       label="Bildirim"   onClick={() => openDrawer('notifications')} />
        </DockScrollZone>

        {/* Saat boşluğu */}
        <div style={{ flex: '0 0 140px' }} />

        {/* Sağ grup — sürekli kaydırılabilir */}
        <DockScrollZone>
          <DockPlate Icon={Wind}          label="Klima"    onClick={() => openDrawer('climate')} />
          <DockPlate Icon={Car}           label="Araç"     onClick={() => openDrawer('vehicle-reminder')} />
          <DockPlate Icon={Settings}      label="Ayarlar"  onClick={onOpenSettings} />
          <DockPlate Icon={Cloud}         label="Hava"     onClick={() => openDrawer('weather')} />
          <DockPlate Icon={AlertTriangle} label="Trafik"   onClick={() => openDrawer('traffic')} />
          <DockPlate Icon={Camera}        label="Dashcam"  onClick={() => openDrawer('dashcam')} />
          <DockPlate Icon={Route}         label="Seyir"    onClick={() => openDrawer('triplog')} />
          <DockPlate Icon={ShieldAlert}   label="Arıza"    onClick={() => openDrawer('dtc')} />
          <DockPlate Icon={Shield}        label="Güvenlik" onClick={() => openDrawer('security')} />
          <DockPlate Icon={Tv2}           label="Eğlence"  onClick={() => openDrawer('entertainment')} />
          <DockPlate Icon={Zap}           label="Sport"    onClick={() => openDrawer('sport')} />
        </DockScrollZone>
      </div>

      {/* SAAT — dış overlay (kaydırma kabı DIŞINDA → kırpılmaz, her zaman görünür) */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 3 }}>
        <div style={{ pointerEvents: 'auto', transform: 'translateY(-14px) scale(1.26)' }}>
          <TeslaClock onClick={onOpenApps} />
        </div>
      </div>
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

export const TeslaLayout = memo(function TeslaLayout(props: Props) {
  const { onOpenMap, onOpenApps, onOpenSettings, onLaunch, fullMapOpen, smart } = props;
  injectExStyles();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const dayNightMode = useDayNightAttr(); // kanonik (data-day-night) → kartlar+saat senkron
  const pal = dayNightMode === 'day' ? SAND : LAVA;

  return (
    <PalCtx.Provider value={pal}>
      <div className="relative w-full h-full overflow-hidden" style={{ background: pal.night ? '#161b11' : '#e6d6ba', transition: 'background 0.4s ease' }}>
        <TopoBackground />
        {voiceOpen && <Suspense fallback={null}><VoiceAssistant onClose={() => setVoiceOpen(false)} minimal /></Suspense>}
        <div className="relative flex flex-col w-full h-full">
          <div className="flex items-center justify-end px-5 pt-2.5 pb-1 flex-shrink-0">
            <StatusCluster />
          </div>
          <div className="flex-1 min-h-0 flex" style={{ gap: 12, padding: '4px 14px 8px' }}>
            <div className="flex flex-col min-h-0" style={{ gap: 12, width: 'clamp(150px, 15vw, 198px)', flexShrink: 0 }}>
              <ClockCard />
              <SpeedGauge />
              <FuelCard />
            </div>
            <div className="flex flex-col min-h-0 min-w-0 flex-1 relative" style={{ gap: 12 }}>
              <MapCard onOpenMap={onOpenMap} fullMapOpen={fullMapOpen} />
              {smart && smart.predictions.length > 0 && (
                <div className="absolute" style={{ bottom: 64, left: 12, right: 12, zIndex: 20 }}>
                  <MagicContextCard smart={smart} variant="tesla" onLaunch={onLaunch} onOpenMap={onOpenMap} />
                </div>
              )}
            </div>
            <div className="flex flex-col min-h-0" style={{ gap: 12, width: 'clamp(280px, 28vw, 358px)', flexShrink: 0 }}>
              <MusicCard />
              <VehicleCard onOpenSettings={onOpenSettings} />
            </div>
          </div>
          <div className="flex-shrink-0" style={{ padding: '6px 16px 14px' }}>
            <ExpeditionDock onOpenMap={onOpenMap} onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onVoice={() => setVoiceOpen(true)} />
          </div>
        </div>
      </div>
    </PalCtx.Provider>
  );
});
