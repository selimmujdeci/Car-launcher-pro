import { memo, useState, lazy, Suspense, useRef, useCallback, useMemo } from 'react';
import {
  Search, Grid3X3, Navigation,
  SkipBack, SkipForward, Play, Pause, MapPin,
  Gauge, Thermometer, Fuel, Zap, Mic,
} from 'lucide-react';
import { DockBar } from './DockBar';
import { HeaderBar } from './HeaderBar';;
const VoiceAssistant = lazy(() => import('../modals/VoiceAssistant').then(m => ({ default: m.VoiceAssistant })));
import { useStore } from '../../store/useStore';
import { useMediaState, togglePlayPause, next, previous } from '../../platform/mediaService';
import { useOBDState } from '../../platform/obdService';
import { useGPSLocation } from '../../platform/gpsService';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer';
import { useClock } from '../../hooks/useClock';
import { useDeviceStatus } from '../../platform/deviceApi';
import { MiniMapWidget } from '../map/MiniMapWidget';
import { type AppItem } from '../../data/apps';
import { useCarTheme, baseOf } from '../../store/useCarTheme';
import { resolveAndNavigate } from '../../platform/addressNavigationEngine';
import { useRouteState } from '../../platform/routingService';
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
  background: 'rgba(22,26,36,0.97)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  border: '1px solid rgba(96,165,250,0.22)',
  boxShadow: '0 4px 24px rgba(0,0,0,0.55), 0 1px 6px rgba(0,0,0,0.35)',
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
  const use24Hour = useStore(s => s.settings.use24Hour);
  const { time, date } = useClock(use24Hour, false);
  const device = useDeviceStatus();
  const obd = useOBDState();
  const fuelRange = obd.fuelLevel != null && obd.fuelLevel >= 0
    ? Math.round((obd.fuelLevel / 100) * 750)
    : null;

  return (
    <div className="flex items-center justify-between px-5 py-3 flex-shrink-0"
      style={{
        background: 'rgba(20,20,20,0.97)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderBottom: '1px solid rgba(96,165,250,0.16)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.30)',
      }}>

      {/* Sol: Logo + Saat */}
      <div className="flex items-center gap-4">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#1d4ed8,#4338ca)', boxShadow: '0 4px 20px rgba(29,78,216,0.50)' }}>
          <Navigation className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="font-black tabular-nums leading-none" style={{ fontSize: 28, color: '#ffffff', letterSpacing: '-1px', textShadow: '0 0 40px rgba(96,165,250,0.30)' }}>{time}</div>
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] mt-0.5" style={{ color: '#c0ccd8' }}>{date}</div>
        </div>
      </div>

      {/* Orta: Durum hapları */}
      <div className="flex items-center gap-2">
        <HPill emoji="☀️" value="21°C" label="Güneşli" />
        <HPill emoji="🔋" value={device.ready ? `${device.battery}%` : '—'} label="Batarya" />
        <HPill emoji="⛽" value={fuelRange != null ? `${fuelRange} km` : '— km'} label="Menzil" />
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
      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.13)' }}>
      <span className="text-sm leading-none">{emoji}</span>
      <div>
        <div className="text-sm font-black tabular-nums leading-none" style={{ color: '#ffffff' }}>{value}</div>
        <div className="text-[10px] font-bold leading-none mt-0.5 uppercase tracking-wide" style={{ color: '#c0ccd8' }}>{label}</div>
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
  const route = useRouteState();

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

      {/* Harita — tam doldur; iç header gizli (NavCard zaten kompakt panel) */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {fullMapOpen
          ? <div className="w-full h-full flex flex-col items-center justify-center gap-3"
              style={{ background: 'linear-gradient(160deg,#06101f,#0d1e38)' }}>
              <MapPin className="w-12 h-12" style={{ color: '#1d4ed8' }} />
              <span className="text-sm font-bold" style={{ color: '#a8b8c8' }}>Harita açık</span>
            </div>
          : <MiniMapWidget onFullScreenClick={onOpenMap} hideHeader={true} hideOverlay={true} />
        }
        {/* Floating fullscreen butonu — header gizli olduğu için harita üstüne yerleştir */}
        {!fullMapOpen && (
          <button
            onClick={onOpenMap}
            className="absolute top-2 right-2 w-8 h-8 rounded-lg flex items-center justify-center active:scale-90 transition-all z-20"
            style={{
              background: 'rgba(0,0,0,0.55)',
              border:     '1px solid rgba(96,165,250,0.35)',
              backdropFilter: 'blur(4px)',
            }}
            title="Tam ekran"
          >
            <Navigation className="w-4 h-4" style={{ color: '#60a5fa' }} />
          </button>
        )}
      </div>

      {/* Alt bar: Arama + Mikrofon + ETA — daha kompakt (haritaya daha çok yer) */}
      <div className="flex-shrink-0 flex flex-col gap-1.5 p-1.5"
        style={{ background: 'rgba(20,20,20,0.96)', backdropFilter: 'blur(8px)', borderTop: '1px solid rgba(96,165,250,0.14)' }}>
        <div className="flex items-center gap-1.5">
          {/* Metin giriş alanı */}
          <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <Search className="w-3 h-3 flex-shrink-0" style={{ color: '#a8b8c8' }} />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
              placeholder="Nereye gidiyorsunuz?"
              className="flex-1 bg-transparent outline-none text-xs font-medium min-w-0"
              style={{ color: query ? '#e2e8f0' : '#a8b8c8' }}
            />
            {query.length > 0 && (
              <button onClick={handleSubmit} className="flex-shrink-0 active:scale-90 transition-all">
                <Navigation className="w-3 h-3" style={{ color: '#60a5fa' }} />
              </button>
            )}
          </div>
          {/* Mikrofon butonu — daha küçük */}
          <button
            onClick={onVoice}
            className="flex items-center justify-center rounded-lg transition-all active:scale-95 flex-shrink-0 w-8 h-8"
            style={{
              background: 'rgba(96,165,250,0.13)',
              border:     '1px solid rgba(96,165,250,0.28)',
            }}
          >
            <Mic className="w-3.5 h-3.5" style={{ color: '#60a5fa' }} />
          </button>
        </div>
        {/* ETA satırı: route varsa göster, yoksa gizle (boş "--:--" verisi yerine harita yer kazanır) */}
        {route.totalDistanceMeters > 0 && (
          <div className="flex gap-1.5">
            <ETACell label="Varış" value="--:--" sub="" />
            <ETACell
              label="Mesafe"
              value={String(Math.round(route.totalDistanceMeters / 1000))}
              sub="km"
            />
          </div>
        )}
      </div>
    </div>
  );
});

function ETACell({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex-1 rounded-xl px-3 py-2"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#c0ccd8' }}>{label}</div>
      <div className="font-black leading-tight tabular-nums" style={{ fontSize: 16, color: '#ffffff' }}>
        {value} <span style={{ fontSize: 11, color: '#a8b8c8', fontWeight: 700 }}>{sub}</span>
      </div>
    </div>
  );
}

/* ─── SPEED CARD ─────────────────────────────────────────────── */
const SpeedCard = memo(function SpeedCard() {
  const obd = useOBDState();

  const rawSpeed = useUnifiedVehicleStore((s) => s.speed);
  const speedKmh = rawSpeed ?? 0;

  const rpmDisplay  = obd.rpm        < 0 ? '--' : Math.round(obd.rpm).toLocaleString();
  const tempDisplay = obd.engineTemp < 0 ? '--' : `${Math.round(obd.engineTemp)}°C`;
  const fuelDisplay = obd.fuelLevel  < 0 ? '--' : `${Math.round(obd.fuelLevel)}%`;
  const tempWarnVal = obd.engineTemp >= 0 && obd.engineTemp > 100;
  const fuelWarnVal = obd.fuelLevel  >= 0 && obd.fuelLevel  < 15;

  const R = 90, cx = 115, cy = 120;
  const start = 135, span = 270;

  // SVG arc hesapları memoize — gereksiz Math.cos/sin önleme
  const { arcTrack, arcFill, arcColor } = useMemo(() => {
    const pct = Math.min(speedKmh / 200, 1);
    const rad = (d: number) => (d * Math.PI) / 180;
    const pt  = (a: number) => ({ x: cx + R * Math.cos(rad(a)), y: cy + R * Math.sin(rad(a)) });
    const buildArc = (a1: number, a2: number) => {
      const s = pt(a1), e = pt(a2), large = a2 - a1 > 180 ? 1 : 0;
      return `M${s.x} ${s.y} A${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`;
    };
    return {
      arcTrack: buildArc(start, start + span),
      arcFill:  pct > 0.01 ? buildArc(start, start + pct * span) : null,
      arcColor: speedKmh < 60 ? '#22c55e' : speedKmh < 100 ? '#eab308' : speedKmh < 140 ? '#f97316' : '#ef4444',
    };
  }, [speedKmh, cx, R, start, span]);


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
            <path d={arcTrack} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="12" strokeLinecap="round" />
            {/* Fill */}
            {arcFill && (
              <path d={arcFill} fill="none" stroke={arcColor} strokeWidth="12" strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 10px ${arcColor}) drop-shadow(0 0 20px ${arcColor}60)` }} />
            )}
          </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ paddingTop: 10 }}>
            <div className="font-black tabular-nums leading-none"
              style={{ fontSize: 'var(--lp-speed-font, 58px)', color: '#ffffff', letterSpacing: '-2px', textShadow: `0 0 60px ${arcColor}, 0 4px 12px rgba(0,0,0,0.80)` }}>
              {rawSpeed == null ? '--' : Math.round(speedKmh)}
            </div>
            <div className="font-black tracking-[0.5em] mt-1.5" style={{ fontSize: 10, color: arcColor, textShadow: `0 0 20px ${arcColor}` }}>
              KM/H
            </div>
          </div>
        </div>
      </div>

      {/* Data row */}
      <div className="flex gap-2 px-4 pb-4 flex-shrink-0 relative z-10">
        <DataChip Icon={Gauge}       label="RPM"      value={rpmDisplay}  color="#60a5fa"                                    warn={false} />
        <DataChip Icon={Thermometer} label="SICAKLIK" value={tempDisplay} color={tempWarnVal ? '#ef4444' : '#fb923c'} warn={tempWarnVal} />
        <DataChip Icon={Fuel}        label="YAKIT"    value={fuelDisplay} color={fuelWarnVal ? '#ef4444' : '#34d399'} warn={fuelWarnVal} />
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
      <div className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: '#c0ccd8' }}>{label}</div>
      <div className="font-black tabular-nums" style={{ color, fontSize: 15, textShadow: `0 0 20px ${color}60` }}>{value}</div>
    </div>
  );
}

/* ─── MUSIC CARD ─────────────────────────────────────────────── */
const MusicCard = memo(function MusicCard() {
  const { playing, track, permissionRequired } = useMediaState();

  return (
    <div className="flex flex-col overflow-hidden h-full relative" style={GLASS_CARD}>
      {/* Shimmer */}
      <div className="absolute top-0 left-8 right-8 pointer-events-none" style={{ height: 1, background: 'linear-gradient(90deg,transparent,rgba(168,85,247,0.30),transparent)' }} />

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(168,85,247,0.10)' }}>
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.38em]" style={{ color: '#a855f7' }}>MÜZİK</div>
          <div className="text-base font-black mt-0.5 tracking-tight truncate max-w-[130px]" style={{ color: permissionRequired ? '#f87171' : '#ffffff' }}>
            {permissionRequired ? 'İZİN GEREKLİ' : track.title ? (track.artist || 'Bilinmeyen') : 'SEÇİLMEDİ'}
          </div>
        </div>
        <Zap className="w-4 h-4 opacity-40" style={{ color: '#a855f7' }} />
      </div>

      {/* Album art */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 min-h-0 px-4">
        <div className="rounded-3xl overflow-hidden flex-shrink-0 flex items-center justify-center relative"
          style={{
            width: 'var(--lp-album, 120px)', height: 'var(--lp-album, 120px)',
            background: 'linear-gradient(135deg,#7c3aed,#1d4ed8)',
            boxShadow: '0 16px 40px rgba(124,58,237,0.50), 0 4px 12px rgba(0,0,0,0.40)',
          }}>
          {track.albumArt
            ? <img src={track.albumArt} className="w-full h-full object-cover" alt="" />
            : <span style={{ fontSize: 'var(--lp-font-xl, 48px)' }}>🎵</span>
          }
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(135deg,rgba(255,255,255,0.18) 0%,transparent 55%)' }} />
        </div>

        <div className="text-center w-full px-2">
          <div className="font-black leading-tight truncate" style={{ fontSize: 15, color: '#ffffff' }}>
            {track.title || 'Harika bir gün!'}
          </div>
          <div className="text-xs mt-0.5 truncate font-medium" style={{ color: '#a8b8c8' }}>
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
        {smart
          ? <HeaderBar smart={smart} onLaunch={onLaunch} onOpenMap={onOpenMap} />
          : <Header onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} />
        }
        <div className="flex-1 min-h-0 grid gap-3 p-3 overflow-hidden" style={{ gridTemplateColumns: '0.90fr 1.20fr 0.90fr' }}>
          <NavCard onOpenMap={onOpenMap} fullMapOpen={fullMapOpen} onVoice={() => setVoiceOpenFallback(true)} />
          <SpeedCard />
          <div className="flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 min-h-0"><MusicCard /></div>
          </div>
        </div>
        <div style={{ height: 'var(--dock-h, 72px)', flexShrink: 0 }} />
        <DockBar appMap={appMap} dockIds={dockIds} onLaunch={onLaunch} onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} />
      </div>
    </div>
  );
});
