import { memo, useState, lazy, Suspense, useRef, useCallback } from 'react';
import {
  Search, Grid3X3, Navigation,
  SkipBack, SkipForward, Play, Pause, MapPin,
  Gauge, Thermometer, Fuel, Zap, Mic,
  Phone, Music2, Bell, LayoutGrid, SlidersHorizontal,
  ChevronUp, ChevronDown, Cloud, AlertTriangle, Camera,
  Route, ShieldAlert, Wrench, Shield, Tv2,
} from 'lucide-react';
import { openMusicDrawer } from '../../platform/mediaUi';
import { openDrawer } from '../../platform/drawerBus';
import { useNotificationState } from '../../platform/notificationService';
const VoiceAssistant = lazy(() => import('../modals/VoiceAssistant').then(m => ({ default: m.VoiceAssistant })));
import { useStore } from '../../store/useStore';
import { useMediaState, togglePlayPause, next, previous } from '../../platform/mediaService';
import { useOBDState } from '../../platform/obdService';
import { useGPSLocation, resolveSpeedKmh } from '../../platform/gpsService';
import { useClock } from '../../hooks/useClock';
import { useDeviceStatus } from '../../platform/deviceApi';
import { MiniMapWidget } from '../map/MiniMapWidget';
import { APP_MAP, type AppItem } from '../../data/apps';
import { useCarTheme, baseOf } from '../../store/useCarTheme';
import { resolveAndNavigate } from '../../platform/addressNavigationEngine';
import { TeslaLayout } from '../themes/TeslaLayout';
import { AudiLayout } from '../themes/AudiLayout';
import { MercedesLayout } from '../themes/MercedesLayout';
import { CockpitLayout } from '../themes/CockpitLayout';
import { ProLayout } from '../themes/ProLayout';
import type { SmartSnapshot } from '../../platform/smartEngine';

/* ══════════════════════════════════════════
   ULTRA PREMIUM — Lüks Araba Kokpiti
   Renk paleti: Derin lacivert + platin beyaz + mavi vurgu
   ══════════════════════════════════════════ */

const BG = 'linear-gradient(160deg, #06101f 0%, #0a1628 35%, #091320 65%, #05101d 100%)';

const GLASS_CARD: React.CSSProperties = {
  background: 'rgba(14,24,44,0.82)',
  backdropFilter: 'blur(28px) saturate(1.4)',
  WebkitBackdropFilter: 'blur(28px) saturate(1.4)',
  border: '1px solid rgba(96,165,250,0.18)',
  boxShadow: '0 8px 40px rgba(0,0,0,0.70), 0 2px 10px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.07)',
  borderRadius: 28,
};

interface Props {
  onOpenMap:       () => void;
  onOpenApps:      () => void;
  onOpenSettings:  () => void;
  onLaunch:        (id: string) => void;
  appMap:          Record<string, AppItem>;
  dockIds:         string[];
  fullMapOpen?:    boolean;
  onOpenRearCam?:  () => void;
  onOpenDashcam?:  () => void;
  smart?:          SmartSnapshot;
}

/* ─── HEADER ─────────────────────────────────────────────────── */
const Header = memo(function Header({ onOpenApps, onOpenSettings }: { onOpenApps: () => void; onOpenSettings: () => void }) {
  const { settings } = useStore();
  const { time, date } = useClock(settings.use24Hour, false);
  const device = useDeviceStatus();

  return (
    <div className="flex items-center justify-between px-5 py-3 flex-shrink-0"
      style={{
        background: 'rgba(4,8,18,0.96)',
        backdropFilter: 'blur(32px)',
        WebkitBackdropFilter: 'blur(32px)',
        borderBottom: '1px solid rgba(96,165,250,0.12)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.40)',
      }}>

      {/* Sol: Logo + Saat */}
      <div className="flex items-center gap-4">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#1d4ed8,#4338ca)', boxShadow: '0 4px 20px rgba(29,78,216,0.50)' }}>
          <Navigation className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="font-black tabular-nums leading-none" style={{ fontSize: 28, color: '#ffffff', letterSpacing: '-1px', textShadow: '0 0 40px rgba(96,165,250,0.30)' }}>{time}</div>
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] mt-0.5" style={{ color: '#7A8899' }}>{date}</div>
        </div>
      </div>

      {/* Orta: Durum hapları */}
      <div className="flex items-center gap-2">
        <HPill emoji="☀️" value="21°C" label="Güneşli" />
        <HPill emoji="🔋" value={device.ready ? `${device.battery}%` : '—'} label="Batarya" />
        <HPill emoji="⛽" value="420 km" label="Menzil" />
      </div>

      {/* Sağ: Eylem butonları */}
      <div className="flex items-center gap-2">
        <HBtn onClick={onOpenSettings}><Search className="w-4.5 h-4.5 text-slate-300" /></HBtn>
        <HBtn onClick={onOpenApps}><Grid3X3 className="w-4.5 h-4.5 text-slate-300" /></HBtn>
      </div>
    </div>
  );
});

function HPill({ emoji, value, label }: { emoji: string; value: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' }}>
      <span className="text-sm leading-none">{emoji}</span>
      <div>
        <div className="text-sm font-black tabular-nums leading-none" style={{ color: '#ffffff' }}>{value}</div>
        <div className="text-[10px] font-bold leading-none mt-0.5 uppercase tracking-wide" style={{ color: '#7A8899' }}>{label}</div>
      </div>
    </div>
  );
}

function HBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="w-10 h-10 rounded-2xl flex items-center justify-center active:scale-95 transition-all"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
      {children}
    </button>
  );
}

/* ─── NAV CARD ───────────────────────────────────────────────── */
const NavCard = memo(function NavCard({ onOpenMap, fullMapOpen, onVoice }: { onOpenMap: () => void; fullMapOpen?: boolean; onVoice: () => void }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const gps = useGPSLocation();

  const handleSubmit = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    const loc = gps?.latitude != null ? { lat: gps.latitude, lng: gps.longitude! } : undefined;
    resolveAndNavigate(q, loc);
    setQuery('');
    inputRef.current?.blur();
  }, [query, gps]);

  return (
    <div className="flex flex-col h-full overflow-hidden relative"
      style={{ borderRadius: 28, border: '1px solid rgba(96,165,250,0.16)', boxShadow: '0 16px 56px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.35)' }}>

      {/* Harita — tam doldur */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {fullMapOpen
          ? <div className="w-full h-full flex flex-col items-center justify-center gap-3"
              style={{ background: 'linear-gradient(160deg,#06101f,#0d1e38)' }}>
              <MapPin className="w-12 h-12" style={{ color: '#1d4ed8' }} />
              <span className="text-sm font-bold" style={{ color: '#7A8899' }}>Harita açık</span>
            </div>
          : <MiniMapWidget onFullScreenClick={onOpenMap} />
        }
      </div>

      {/* Alt bar: Arama + Mikrofon + ETA */}
      <div className="flex-shrink-0 flex flex-col gap-2 p-2.5"
        style={{ background: 'rgba(4,8,18,0.90)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(96,165,250,0.10)' }}>
        <div className="flex items-center gap-2">
          {/* Metin giriş alanı */}
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#7A8899' }} />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
              placeholder="Nereye gidiyorsunuz?"
              className="flex-1 bg-transparent outline-none text-sm font-medium"
              style={{ color: query ? '#e2e8f0' : '#7A8899' }}
            />
            {query.length > 0 && (
              <button onClick={handleSubmit} className="flex-shrink-0 active:scale-90 transition-all">
                <Navigation className="w-3.5 h-3.5" style={{ color: '#60a5fa' }} />
              </button>
            )}
          </div>
          {/* Mikrofon butonu */}
          <button
            onClick={onVoice}
            className="flex items-center justify-center rounded-xl transition-all active:scale-95 flex-shrink-0"
            style={{
              width: 'var(--lp-tile-h, 40px)', height: 'var(--lp-tile-h, 40px)',
              background: 'rgba(96,165,250,0.13)',
              border: '1px solid rgba(96,165,250,0.28)',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(96,165,250,0.26)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(96,165,250,0.13)')}
          >
            <Mic className="w-4 h-4" style={{ color: '#60a5fa' }} />
          </button>
        </div>
        <div className="flex gap-1.5">
          <ETACell label="Varış" value="--:--" sub="--:--" />
          <ETACell label="Mesafe" value="128" sub="km" />
        </div>
      </div>
    </div>
  );
});

function ETACell({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex-1 rounded-xl px-3 py-2"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="text-[9px] font-bold uppercase tracking-wide" style={{ color: '#7A8899' }}>{label}</div>
      <div className="font-black leading-tight tabular-nums" style={{ fontSize: 16, color: '#ffffff' }}>
        {value} <span style={{ fontSize: 11, color: '#7A8899', fontWeight: 700 }}>{sub}</span>
      </div>
    </div>
  );
}

/* ─── SPEED CARD ─────────────────────────────────────────────── */
const SpeedCard = memo(function SpeedCard() {
  const obd = useOBDState();
  const gps = useGPSLocation();

  const speedKmh = resolveSpeedKmh(gps, obd.speed ?? 0);
  const rpm  = obd.rpm        ?? 929;
  const temp = obd.engineTemp ?? 88;
  const fuel = obd.fuelLevel  ?? 68;

  const R = 90, cx = 115, cy = 120;
  const start = 135, span = 270;
  const pct = Math.min(speedKmh / 200, 1);
  const rad = (d: number) => (d * Math.PI) / 180;
  const pt  = (a: number) => ({ x: cx + R * Math.cos(rad(a)), y: cy + R * Math.sin(rad(a)) });
  const arc = (a1: number, a2: number) => {
    const s = pt(a1), e = pt(a2), large = a2 - a1 > 180 ? 1 : 0;
    return `M${s.x} ${s.y} A${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`;
  };
  const fillAngle = start + pct * span;
  const arcColor = speedKmh < 60 ? '#22c55e' : speedKmh < 100 ? '#eab308' : speedKmh < 140 ? '#f97316' : '#ef4444';
  const tempWarn = temp > 100;
  const fuelWarn = fuel < 15;

  return (
    <div className="flex flex-col h-full overflow-hidden relative"
      style={{ ...GLASS_CARD, background: 'linear-gradient(160deg,#070e1c 0%,#0d1e38 40%,#091628 80%,#060d1a 100%)' }}>

      {/* Top shimmer */}
      <div className="absolute top-0 left-8 right-8 pointer-events-none" style={{ height: 1, background: 'linear-gradient(90deg,transparent,rgba(96,165,250,0.40),transparent)' }} />
      {/* Ambient center glow */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(37,99,235,0.12) 0%, transparent 60%)' }} />

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0 relative z-10"
        style={{ borderBottom: '1px solid rgba(96,165,250,0.08)' }}>
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.38em]" style={{ color: '#60a5fa' }}>SÜRÜŞ BİLGİLERİ</div>
          <div className="text-sm font-black mt-0.5" style={{ color: '#ffffff' }}>CANLI VERİLER</div>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
          style={{ background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.22)' }}>
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[10px] font-black tracking-widest" style={{ color: '#4ade80' }}>CANLI</span>
        </div>
      </div>

      {/* Speedo */}
      <div className="flex-1 flex items-center justify-center relative z-10">
        <div style={{ width: 'var(--lp-speedo, 175px)', height: 'var(--lp-speedo, 175px)', position: 'relative' }}>
          <svg width="100%" height="100%" viewBox="0 0 230 240" style={{ overflow: 'visible' }}>
            {/* Outer glow ring */}
            <circle cx="115" cy="120" r="108" fill="none" stroke={arcColor} strokeWidth="1" opacity="0.10" />
            {/* Track */}
            <path d={arc(start, start + span)} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="12" strokeLinecap="round" />
            {/* Fill */}
            {pct > 0.01 && (
              <path d={arc(start, fillAngle)} fill="none" stroke={arcColor} strokeWidth="12" strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 10px ${arcColor}) drop-shadow(0 0 20px ${arcColor}60)` }} />
            )}
          </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ paddingTop: 10 }}>
            <div className="font-black tabular-nums leading-none"
              style={{ fontSize: 'var(--lp-speed-font, 58px)', color: '#ffffff', letterSpacing: '-2px', textShadow: `0 0 60px ${arcColor}, 0 4px 12px rgba(0,0,0,0.80)` }}>
              {Math.round(speedKmh || 0)}
            </div>
            <div className="font-black tracking-[0.5em] mt-1.5" style={{ fontSize: 10, color: arcColor, textShadow: `0 0 20px ${arcColor}` }}>
              KM/H
            </div>
          </div>
        </div>
      </div>

      {/* Data row */}
      <div className="flex gap-2 px-4 pb-4 flex-shrink-0 relative z-10">
        <DataChip Icon={Gauge}       label="RPM"      value={Math.round(rpm).toLocaleString()}      color="#60a5fa" warn={false} />
        <DataChip Icon={Thermometer} label="SICAKLIK" value={`${Math.round(temp)}°C`}  color={tempWarn ? '#ef4444' : '#fb923c'} warn={tempWarn} />
        <DataChip Icon={Fuel}        label="YAKIT"    value={`${Math.round(fuel)}%`}   color={fuelWarn ? '#ef4444' : '#34d399'} warn={fuelWarn} />
      </div>
    </div>
  );
});

function DataChip({ Icon, label, value, color, warn }: {
  Icon: typeof Gauge; label: string; value: string; color: string; warn: boolean;
}) {
  return (
    <div className="flex-1 rounded-2xl p-3.5 text-center"
      style={{
        background: warn ? 'rgba(239,68,68,0.10)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${warn ? 'rgba(239,68,68,0.28)' : 'rgba(255,255,255,0.07)'}`,
      }}>
      <div className="flex items-center justify-center mb-2">
        <Icon className="w-4 h-4" style={{ color, opacity: 0.80 }} />
      </div>
      <div className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: '#7A8899' }}>{label}</div>
      <div className="font-black tabular-nums" style={{ color, fontSize: 15, textShadow: `0 0 20px ${color}60` }}>{value}</div>
    </div>
  );
}

/* ─── MUSIC CARD ─────────────────────────────────────────────── */
const MusicCard = memo(function MusicCard() {
  const { playing, track } = useMediaState();

  return (
    <div className="flex flex-col overflow-hidden h-full relative" style={GLASS_CARD}>
      {/* Shimmer */}
      <div className="absolute top-0 left-8 right-8 pointer-events-none" style={{ height: 1, background: 'linear-gradient(90deg,transparent,rgba(168,85,247,0.30),transparent)' }} />

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(168,85,247,0.10)' }}>
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.38em]" style={{ color: '#a855f7' }}>MÜZİK</div>
          <div className="text-base font-black mt-0.5 tracking-tight truncate max-w-[130px]" style={{ color: '#ffffff' }}>
            {track.title ? (track.artist || 'Bilinmeyen') : 'SEÇİLMEDİ'}
          </div>
        </div>
        <Zap className="w-4 h-4 opacity-40" style={{ color: '#a855f7' }} />
      </div>

      {/* Album art */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 min-h-0 px-4">
        <div className="rounded-3xl overflow-hidden flex-shrink-0 flex items-center justify-center relative"
          style={{
            width: 'var(--lp-album, 52px)', height: 'var(--lp-album, 52px)',
            background: 'linear-gradient(135deg,#7c3aed,#1d4ed8)',
            boxShadow: '0 16px 40px rgba(124,58,237,0.50), 0 4px 12px rgba(0,0,0,0.40)',
          }}>
          {track.albumArt
            ? <img src={track.albumArt} className="w-full h-full object-cover" alt="" />
            : <span style={{ fontSize: 'var(--lp-font-xl, 22px)' }}>🎵</span>
          }
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(135deg,rgba(255,255,255,0.18) 0%,transparent 55%)' }} />
        </div>

        <div className="text-center w-full px-2">
          <div className="font-black leading-tight truncate" style={{ fontSize: 15, color: '#ffffff' }}>
            {track.title || 'Harika bir gün!'}
          </div>
          <div className="text-xs mt-0.5 truncate font-medium" style={{ color: '#7A8899' }}>
            {track.artist || 'En sevdiğin müzikleri dinle'}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 flex-shrink-0 pb-4 px-4">
        <button onClick={() => previous()}
          className="w-10 h-10 rounded-2xl flex items-center justify-center active:scale-90 transition-all"
          style={{ background: 'rgba(168,85,247,0.10)', border: '1px solid rgba(168,85,247,0.20)' }}>
          <SkipBack className="w-4 h-4" style={{ color: '#c084fc' }} />
        </button>
        <button onClick={() => togglePlayPause()}
          className="w-14 h-14 rounded-2xl flex items-center justify-center active:scale-90 transition-all"
          style={{
            background: 'linear-gradient(135deg,#7c3aed,#2563eb)',
            boxShadow: '0 8px 24px rgba(124,58,237,0.55), 0 2px 8px rgba(0,0,0,0.30)',
          }}>
          {playing
            ? <Pause className="w-6 h-6 fill-white" style={{ color: '#ffffff' }} />
            : <Play  className="w-6 h-6 fill-white ml-0.5" style={{ color: '#ffffff' }} />
          }
        </button>
        <button onClick={() => next()}
          className="w-10 h-10 rounded-2xl flex items-center justify-center active:scale-90 transition-all"
          style={{ background: 'rgba(168,85,247,0.10)', border: '1px solid rgba(168,85,247,0.20)' }}>
          <SkipForward className="w-4 h-4" style={{ color: '#c084fc' }} />
        </button>
      </div>
    </div>
  );
});

/* ─── QUICK ACCESS ───────────────────────────────────────────── */
const QuickAccess = memo(function QuickAccess({ appMap, onLaunch }: { appMap: Record<string, AppItem>; onLaunch: (id: string) => void }) {
  const ids = ['maps', 'phone', 'youtube', 'settings'];
  const apps = ids.map(id => ({ id, app: appMap[id] ?? APP_MAP[id] })).filter(x => x.app);

  return (
    <div className="flex-shrink-0 overflow-hidden relative" style={{ ...GLASS_CARD, padding: 'var(--lp-space-lg, 16px)' }}>
      <div className="absolute top-0 left-8 right-8 pointer-events-none" style={{ height: 1, background: 'linear-gradient(90deg,transparent,rgba(6,182,212,0.25),transparent)' }} />
      <div className="text-[9px] font-black uppercase tracking-[0.40em] mb-0.5" style={{ color: '#22d3ee' }}>HIZLI ERİŞİM</div>
      <div className="text-sm font-black mb-3 tracking-tight" style={{ color: '#ffffff' }}>KISAYOLLAR</div>
      <div className="grid grid-cols-4 gap-2.5">
        {apps.map(({ id, app }) => (
          <button key={id} onClick={() => onLaunch(id)}
            className="flex flex-col items-center gap-2 py-2.5 rounded-2xl active:scale-90 transition-all"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.07)', boxShadow: '0 4px 12px rgba(0,0,0,0.30)' }}>
              <span className="text-2xl leading-none">{app!.icon}</span>
            </div>
            <span className="text-[10px] font-bold text-center leading-tight px-1" style={{ color: '#7A8899' }}>{app!.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
});


/* ─── DOCK ───────────────────────────────────────────────────── */
const Dock = memo(function Dock({ appMap, dockIds, onLaunch, onOpenApps, onOpenSettings }: {
  appMap: Record<string, AppItem>;
  dockIds: string[];
  onLaunch: (id: string) => void;
  onOpenApps: () => void;
  onOpenSettings: () => void;
}) {
  const { unreadCount } = useNotificationState();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const BTN_W = 90, BTN_H = 90, BTN_R = 20, ICON = 28;

  function DockBtn({ fn, label, color, children, badge }: {
    fn: () => void; label: string; color: string;
    children: React.ReactNode; badge?: number;
  }) {
    return (
      <button onClick={fn}
        className="flex flex-col items-center justify-center gap-2 flex-shrink-0 active:scale-90 transition-all relative"
        style={{ width: BTN_W, height: BTN_H, borderRadius: BTN_R, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
        <div style={{ color, width: ICON, height: ICON, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {children}
        </div>
        <span className="font-bold uppercase tracking-wider leading-none" style={{ fontSize: 10, color: '#7A8899' }}>{label}</span>
        {!!badge && (
          <span className="absolute top-2 right-2 min-w-4 h-4 bg-blue-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>
    );
  }

  return (
    <>
      {voiceOpen && (
        <Suspense fallback={null}>
          <VoiceAssistant onClose={() => setVoiceOpen(false)} minimal />
        </Suspense>
      )}

      {/* Secondary "Daha" panel */}
      {moreOpen && (
        <div className="flex-shrink-0 flex items-center justify-center gap-4 px-4 py-2 overflow-x-auto no-scrollbar"
          style={{ background: 'rgba(4,8,18,0.98)', borderTop: '1px solid rgba(96,165,250,0.08)' }}>
          {([
            { label: 'Hava',     color: '#38bdf8', icon: <Cloud    size={22} />, fn: () => { openDrawer('weather');      setMoreOpen(false); } },
            { label: 'Trafik',   color: '#fb923c', icon: <AlertTriangle size={22} />, fn: () => { openDrawer('traffic'); setMoreOpen(false); } },
            { label: 'Dashcam',  color: '#f87171', icon: <Camera   size={22} />, fn: () => { openDrawer('dashcam');      setMoreOpen(false); } },
            { label: 'Seyir',    color: '#34d399', icon: <Route    size={22} />, fn: () => { openDrawer('triplog');      setMoreOpen(false); } },
            { label: 'Arıza',    color: '#fbbf24', icon: <ShieldAlert size={22} />, fn: () => { openDrawer('dtc');       setMoreOpen(false); } },
            { label: 'Bakım',    color: '#94a3b8', icon: <Wrench   size={22} />, fn: () => { openDrawer('vehicle-reminder'); setMoreOpen(false); } },
            { label: 'Güvenlik', color: '#34d399', icon: <Shield   size={22} />, fn: () => { openDrawer('security');    setMoreOpen(false); } },
            { label: 'Eğlence',  color: '#60a5fa', icon: <Tv2     size={22} />, fn: () => { openDrawer('entertainment'); setMoreOpen(false); } },
          ] as const).map((item, i) => (
            <button key={i} onClick={item.fn}
              className="flex flex-col items-center gap-1.5 flex-shrink-0 active:scale-90 transition-all px-3 py-2 rounded-2xl"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ color: item.color }}>{item.icon}</div>
              <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: '#7A8899' }}>{item.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Ana dock satırı */}
      <div className="flex-shrink-0"
        style={{
          background: 'rgba(4,8,18,0.97)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          borderTop: '1px solid rgba(96,165,250,0.10)',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.50)',
        }}>
        <div className="flex items-center justify-center gap-4 overflow-x-auto no-scrollbar px-4 py-3"
          style={{ overflowX: 'auto' }}>

          {/* Dinamik app kısayolları (dockIds'den ilk 2) */}
          {dockIds.slice(0, 2).map(id => {
            const app = appMap[id] ?? APP_MAP[id];
            if (!app) return null;
            return (
              <DockBtn key={id} fn={() => onLaunch(id)} label={app.name} color="#60a5fa">
                <span style={{ fontSize: ICON }}>{app.icon}</span>
              </DockBtn>
            );
          })}

          <DockBtn fn={() => openDrawer('phone')}         label="Telefon"  color="#60a5fa"><Phone           size={ICON} /></DockBtn>
          <DockBtn fn={() => openMusicDrawer()}           label="Müzik"    color="#34d399"><Music2          size={ICON} /></DockBtn>
          <DockBtn fn={() => openDrawer('notifications')} label="Bildirim" color="#60a5fa" badge={unreadCount}><Bell size={ICON} /></DockBtn>
          <DockBtn fn={onOpenApps}                        label="Menü"     color="#60a5fa"><LayoutGrid      size={ICON} /></DockBtn>
          <DockBtn fn={onOpenSettings}                    label="Ayarlar"  color="#94a3b8"><SlidersHorizontal size={ICON} /></DockBtn>

          {/* Ses (mikrofon) */}
          <button onClick={() => setVoiceOpen(true)}
            className="flex flex-col items-center justify-center gap-2 flex-shrink-0 active:scale-90 transition-all"
            style={{ width: BTN_W, height: BTN_H, borderRadius: BTN_R, background: 'linear-gradient(135deg,rgba(29,78,216,0.30),rgba(59,130,246,0.15))', border: '1px solid rgba(96,165,250,0.30)' }}>
            <Mic size={ICON} style={{ color: '#60a5fa' }} />
            <span className="font-bold uppercase tracking-wider" style={{ fontSize: 10, color: '#60a5fa' }}>Ses</span>
          </button>

          {/* Daha */}
          <button onClick={() => setMoreOpen(o => !o)}
            className="flex flex-col items-center justify-center gap-2 flex-shrink-0 active:scale-90 transition-all"
            style={{ width: BTN_W, height: BTN_H, borderRadius: BTN_R, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {moreOpen ? <ChevronDown size={ICON} style={{ color: '#94a3b8' }} /> : <ChevronUp size={ICON} style={{ color: '#94a3b8' }} />}
            <span className="font-bold uppercase tracking-wider" style={{ fontSize: 10, color: '#94a3b8' }}>{moreOpen ? 'Kapat' : 'Daha'}</span>
          </button>
        </div>
      </div>
    </>
  );
});

/* ─── LAYOUT ─────────────────────────────────────────────────── */
export const NewHomeLayout = memo(function NewHomeLayout({
  onOpenMap, onOpenApps, onOpenSettings, onLaunch, appMap, dockIds, fullMapOpen,
  onOpenRearCam, onOpenDashcam, smart,
}: Props) {
  const { theme } = useCarTheme();
  const [voiceOpenFallback, setVoiceOpenFallback] = useState(false);

  const base = baseOf(theme);

  if (base === 'tesla') {
    return <TeslaLayout onOpenMap={onOpenMap} onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onLaunch={onLaunch} appMap={appMap} dockIds={dockIds} fullMapOpen={fullMapOpen} smart={smart} />;
  }
  if (base === 'audi') {
    return <AudiLayout onOpenMap={onOpenMap} onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onLaunch={onLaunch} appMap={appMap} dockIds={dockIds} fullMapOpen={fullMapOpen} smart={smart} />;
  }
  if (base === 'mercedes') {
    return <MercedesLayout onOpenMap={onOpenMap} onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onLaunch={onLaunch} appMap={appMap} dockIds={dockIds} fullMapOpen={fullMapOpen} smart={smart} />;
  }
  if (base === 'cockpit') {
    return <CockpitLayout onOpenMap={onOpenMap} onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onLaunch={onLaunch} appMap={appMap} dockIds={dockIds} fullMapOpen={fullMapOpen} smart={smart} />;
  }
  if (base === 'pro') {
    return <ProLayout onOpenMap={onOpenMap} onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onLaunch={onLaunch} appMap={appMap} dockIds={dockIds} fullMapOpen={fullMapOpen} onOpenRearCam={onOpenRearCam} onOpenDashcam={onOpenDashcam} smart={smart} />;
  }
  if (base === 'oled') {
    return <ProLayout onOpenMap={onOpenMap} onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onLaunch={onLaunch} appMap={appMap} dockIds={dockIds} fullMapOpen={fullMapOpen} onOpenRearCam={onOpenRearCam} onOpenDashcam={onOpenDashcam} smart={smart} />;
  }

  // fallback — original dark premium layout
  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: BG }}>
      {voiceOpenFallback && (
        <Suspense fallback={null}>
          <VoiceAssistant onClose={() => setVoiceOpenFallback(false)} minimal />
        </Suspense>
      )}
      {/* Dekoratif blob'lar — ambient-blobs ile sağlanıyor, burada gereksiz */}
      <div className="relative z-10 flex flex-col h-full">
        <Header onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} />
        <div className="flex-1 min-h-0 grid gap-3 p-3 overflow-hidden" style={{ gridTemplateColumns: '0.90fr 1.20fr 0.90fr' }}>
          <NavCard onOpenMap={onOpenMap} fullMapOpen={fullMapOpen} onVoice={() => setVoiceOpenFallback(true)} />
          <SpeedCard />
          <div className="flex flex-col gap-3 min-h-0 overflow-hidden">
            <div className="flex-1 min-h-0"><MusicCard /></div>
            <QuickAccess appMap={appMap} onLaunch={onLaunch} />
          </div>
        </div>
        <Dock appMap={appMap} dockIds={dockIds} onLaunch={onLaunch} onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} />
      </div>
    </div>
  );
});
