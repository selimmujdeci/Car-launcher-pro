import { memo, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useLayout } from '../../context/LayoutContext';
import {
  SkipBack, SkipForward, Pause, Play,
  Thermometer, Fuel, Camera, Maximize2, User, Monitor,
  Star, Clock, Bluetooth, Wifi, MapPin, Phone, Settings,
  Music2, Bell, LayoutGrid, SlidersHorizontal,
  ChevronUp, ChevronDown, Cloud, AlertTriangle,
  Route, ShieldAlert, Wrench, Shield, Tv2,
} from 'lucide-react';
import { openMusicDrawer } from '../../platform/mediaUi';
import { openDrawer } from '../../platform/drawerBus';
import { useNotificationState } from '../../platform/notificationService';
import { useStore } from '../../store/useStore';
import { useClock } from '../../hooks/useClock';
import { useDeviceStatus } from '../../platform/deviceApi';
import { useOBDState } from '../../platform/obdService';
import { useGPSLocation, resolveSpeedKmh } from '../../platform/gpsService';
import { useMediaState, togglePlayPause, next, previous } from '../../platform/mediaService';
import { MiniMapWidget } from '../map/MiniMapWidget';
import { APP_MAP, type AppItem } from '../../data/apps';
import type { SmartSnapshot } from '../../platform/smartEngine';
import { MagicContextCard } from '../common/MagicContextCard';

/* ════════════════════════════════════════════════════════════
   PRO LAYOUT — Dark Automotive Dashboard
   Exact replica of the premium car infotainment design
   ════════════════════════════════════════════════════════════ */

// Sidebar genişliği profilden — dockIconSize × 2.8, COMPACT'ta gizlenir
const getSidebarW = (iconSize: number) => Math.max(iconSize * 2.8 | 0, 50);

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

/* ─── SIDEBAR ─────────────────────────────────────────────────── */
/* ─── RPM BAR ──────────────────────────────────────────────────── */
const RPM_MAX = 7000;

const RpmBar = memo(function RpmBar({ width = 64 }: { width?: number }) {
  const { t } = useTranslation();
  const obd = useOBDState();
  const rpm = obd.rpm >= 0 ? obd.rpm : 0;
  const throttle = obd.throttle >= 0 ? obd.throttle : 0;

  /* Smooth lerp toward target RPM */
  const [displayRpm, setDisplayRpm] = useState(rpm);
  useEffect(() => {
    let frame: number;
    const step = () => {
      setDisplayRpm(prev => {
        const diff = rpm - prev;
        if (Math.abs(diff) < 8) return rpm;
        return prev + diff * 0.14;
      });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [rpm]);

  const pct = Math.min(displayRpm / RPM_MAX, 1);
  const isRedline = pct > 0.82;
  const isHot     = pct > 0.55;

  /* Liquid color gradient stops */
  const liquidTop    = isRedline ? '#ff3b30' : isHot ? '#f59e0b' : '#00e5ff';
  const liquidBottom = isRedline ? '#b91c1c' : isHot ? '#b45309' : '#0284c7';
  const glowColor    = isRedline ? 'rgba(239,68,68,0.55)' : isHot ? 'rgba(245,158,11,0.4)' : 'rgba(0,229,255,0.35)';

  /* Fill height % from bottom */
  const fillPct = pct * 100;

  return (
    <div
      data-pro-rpmbar
      style={{
        width,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        flexShrink: 0,
        background: 'linear-gradient(180deg, rgba(5,7,13,0.98) 0%, rgba(8,10,18,0.98) 100%)',
        borderRight: '1px solid rgba(255,255,255,0.04)',
        padding: '14px 0 10px',
        position: 'relative',
        gap: 6,
      }}
    >
      {/* RPM label */}
      <div style={{
        fontFamily: '"Orbitron", monospace',
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: '0.14em',
        color: 'rgba(255,255,255,0.28)',
      }}>{t('common.rpm')}</div>

      {/* 7k marker */}
      <div style={{
        fontFamily: '"Orbitron", monospace',
        fontSize: 7,
        color: 'rgba(239,68,68,0.6)',
        letterSpacing: '0.06em',
        marginBottom: -2,
      }}>7k</div>

      {/* Glass tube */}
      <div style={{
        position: 'relative',
        width: 22,
        flex: 1,
        borderRadius: 11,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.10)',
        boxShadow: `inset 0 0 12px rgba(0,0,0,0.6), 0 0 16px ${glowColor}`,
        overflow: 'hidden',
        transition: 'box-shadow 0.3s ease',
      }}>
        {/* Liquid fill — rises from bottom */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: `${fillPct}%`,
          background: `linear-gradient(180deg, ${liquidTop} 0%, ${liquidBottom} 100%)`,
          transition: 'height 0.12s ease-out, background 0.4s ease',
          borderRadius: '0 0 10px 10px',
        }}>
          {/* Wave at surface */}
          <div style={{
            position: 'absolute',
            top: -4,
            left: -8,
            right: -8,
            height: 8,
            borderRadius: '50%',
            background: `${liquidTop}cc`,
            animation: 'rpmWave 1.8s ease-in-out infinite',
          }} />
          {/* Inner shine */}
          <div className="absolute inset-y-0 left-[3px] w-1 rounded-sm" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.35) 0%, transparent 100%)' }} />
        </div>

        {/* Tick marks */}
        {[0.25, 0.5, 0.75].map(t => (
          <div key={t} style={{
            position: 'absolute',
            bottom: `${t * 100}%`,
            left: 0, right: 0,
            height: 1,
            background: 'rgba(255,255,255,0.08)',
            pointerEvents: 'none',
          }} />
        ))}

        {/* Glass glare overlay */}
        <div className="absolute inset-y-0 left-px w-1.5 rounded-tl-[6px] rounded-bl-[6px] pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 60%)' }} />
      </div>

      {/* 0 marker */}
      <div style={{
        fontFamily: '"Orbitron", monospace',
        fontSize: 7,
        color: 'rgba(0,229,255,0.45)',
        letterSpacing: '0.06em',
        marginTop: -2,
      }}>0</div>

      {/* RPM value */}
      <div style={{
        fontFamily: '"Orbitron", monospace',
        fontSize: 9,
        fontWeight: 700,
        color: isRedline ? '#ff3b30' : 'rgba(255,255,255,0.65)',
        letterSpacing: '0.03em',
        textShadow: isRedline ? '0 0 10px rgba(255,59,48,0.9)' : 'none',
        transition: 'color 0.25s, text-shadow 0.25s',
        textAlign: 'center',
        lineHeight: 1.2,
      }}>
        {(Math.round(displayRpm / 100) * 100).toLocaleString()}
      </div>

      {/* Throttle label + bar */}
      <div className="w-full flex flex-col items-center gap-[3px] pb-0.5">
        <div style={{ fontSize: 7, fontFamily: '"Orbitron", monospace', color: 'rgba(255,255,255,0.18)', letterSpacing: '0.1em' }}>GZ</div>
        <div style={{
          width: 28, height: 3, borderRadius: 2,
          background: 'rgba(255,255,255,0.06)',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${throttle}%`,
            background: `linear-gradient(90deg, ${liquidBottom}, ${liquidTop})`,
            borderRadius: 2,
            transition: 'width 0.12s ease',
            boxShadow: `0 0 4px ${liquidTop}`,
          }} />
        </div>
      </div>
    </div>
  );
});

/* ─── TOP BAR ──────────────────────────────────────────────────── */
const TopBar = memo(function TopBar({ headerH = 64, font2xl = 28, fontSm = 11 }: { headerH?: number; font2xl?: number; fontSm?: number }) {
  const { settings } = useStore();
  const { time, date } = useClock(settings.use24Hour, false);
  const device = useDeviceStatus();

  // Sun progress (Adaptive sun calculation - mock fallbacks removed)
  const [sunPct, setSunPct] = useState(0);
  useEffect(() => {
    const calc = () => {
      const now = new Date();
      const cur = now.getHours() * 60 + now.getMinutes();
      const rise = 6 * 60;  // 06:00 avg
      const set_ = 19 * 60; // 19:00 avg
      setSunPct(Math.max(0, Math.min(100, ((cur - rise) / (set_ - rise)) * 100)));
    };
    calc();
    const id = setInterval(calc, 60000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      data-pro-topbar
      className="flex items-center flex-shrink-0"
      style={{
        height: headerH,
        background: 'var(--header-bg, #0a0c10)',
        borderBottom: '1px solid var(--divider-color, rgba(255,255,255,0.05))',
        transition: 'background 0.4s ease',
        padding: '0 20px',
        gap: 0,
      }}
    >
      {/* Time + Date */}
      <div className="flex-shrink-0">
        <div
          style={{
            fontFamily: '"Orbitron", monospace',
            fontSize: font2xl,
            fontWeight: 700,
            color: '#fff',
            lineHeight: 1,
            letterSpacing: 2,
          }}
        >
          {time}
        </div>
        <div style={{ fontSize: fontSm, color: 'rgba(255,255,255,0.45)', marginTop: 2, fontWeight: 400 }}>
          {date}
        </div>
      </div>

      {/* Sun progress — center — COMPACT'ta gizlenir */}
      <div data-sun-bar data-header-center className="flex flex-col items-center gap-1 flex-1">
        <div className="flex items-center gap-3 text-xs text-white/55">
          <span className="flex items-center gap-1"><span>☀️</span><span>--:--</span></span>
          <div className="relative w-[clamp(120px,15vw,200px)] h-1 bg-white/10 rounded-sm overflow-visible">
            <div
              className="h-full rounded-sm relative"
              style={{ width: `${sunPct}%`, background: 'linear-gradient(90deg, #ff9800, #ffeb3b, #4fc3f7)' }}
            >
              <div className="absolute -right-[5px] -top-[3px] w-2.5 h-2.5 bg-[#ffeb3b] rounded-full" style={{ boxShadow: '0 0 8px #ffeb3b' }} />
            </div>
          </div>
          <span className="flex items-center gap-1"><span>🌙</span><span>--:--</span></span>
        </div>
      </div>

      {/* Status icons */}
      <div data-header-status className="flex items-center gap-4 flex-shrink-0">
        <Bluetooth className="w-4 h-4 text-white/65" />

        {/* Signal bars */}
        <div className="flex items-end gap-0.5 h-4">
          {[4, 7, 10, 14].map((h, i) => (
            <div key={i} style={{ width: 3, height: h, background: 'rgba(255,255,255,0.7)', borderRadius: 1 }} />
          ))}
        </div>

        <Wifi className="w-4 h-4 text-white/65" />

        <span className="text-[14px] text-[#4fc3f7] font-semibold" style={{ fontFamily: '"Orbitron", monospace' }}>
          {device.ready ? `${device.battery}%` : '--°C'}
        </span>
      </div>
    </div>
  );
});

/* ─── SPEED CARD ───────────────────────────────────────────────── */
const SpeedCard = memo(function SpeedCard({ gaugeSize = 260, spaceMd = 10 }: { gaugeSize?: number; spaceMd?: number }) {
  const { t } = useTranslation();
  const obd = useOBDState();
  const gps = useGPSLocation();
  const speedKmh = resolveSpeedKmh(gps, obd.speed ?? 0);
  const temp = obd.engineTemp ?? 0;
  const fuel = obd.fuelLevel ?? 0;
  const fuelRange = Math.round((fuel / 100) * 750);

  // Gauge arc
  const MAX = 240;
  const R = 100, cx = 130, cy = 130;
  const START_DEG = 135, SPAN_DEG = 270;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const ptOnArc = (deg: number) => ({
    x: cx + R * Math.cos(toRad(deg)),
    y: cy + R * Math.sin(toRad(deg)),
  });
  const arcPath = (a1: number, a2: number) => {
    const s = ptOnArc(a1), e = ptOnArc(a2);
    const large = a2 - a1 > 180 ? 1 : 0;
    return `M${s.x} ${s.y} A${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`;
  };
  const pct = Math.min(speedKmh / MAX, 1);
  const fillAngle = START_DEG + pct * SPAN_DEG;

  return (
    <div
      className="relative overflow-hidden flex-1"
      style={{
        borderRadius: 'var(--radius-card, 16px)',
        border: '1px solid var(--border-color, rgba(255,255,255,0.06))',
        boxShadow: '0 4px 32px rgba(0,0,0,0.6)',
        background: `
          linear-gradient(180deg, rgba(10,12,16,0.15) 0%, rgba(10,12,16,0.35) 55%, rgba(10,12,16,0.88) 100%),
          radial-gradient(ellipse 80% 40% at 50% 100%, #c8680a 0%, transparent 55%),
          radial-gradient(ellipse 120% 60% at 50% 85%, #7b3000 0%, transparent 50%),
          linear-gradient(180deg, #1a0a2e 0%, #2d1b4e 15%, #4a2060 25%, #6b3a1f 40%, #8b5a0a 50%, #5c3d0a 60%, #2a1a0a 75%, #0a0806 100%)
        `,
      }}
    >
      {/* Mountain silhouettes */}
      <svg
        className="absolute bottom-[60px] inset-x-0 w-full pointer-events-none"
        viewBox="0 0 870 180"
        preserveAspectRatio="none"
      >
        <defs>
          <radialGradient id="proSkyGlow" cx="50%" cy="80%" r="60%">
            <stop offset="0%" stopColor="#c85a00" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#2d1b4e" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="870" height="180" fill="url(#proSkyGlow)" />
        <path d="M0,150 L80,70 L140,100 L200,40 L260,80 L320,20 L380,60 L440,10 L500,50 L560,30 L620,70 L680,20 L740,60 L800,40 L870,80 L870,180 L0,180Z" fill="#1a0a2e" opacity="0.95" />
        <path d="M0,165 L60,120 L120,145 L180,100 L240,130 L300,90 L360,120 L420,80 L480,110 L540,92 L600,120 L660,95 L720,125 L780,105 L870,135 L870,180 L0,180Z" fill="#0d0618" opacity="0.98" />
      </svg>

      {/* Road */}
      <svg
        className="absolute bottom-0 inset-x-0 w-full pointer-events-none"
        viewBox="0 0 870 130"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="proRoad" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor="#1a1008" />
            <stop offset="100%" stopColor="#0a0806" />
          </linearGradient>
          <linearGradient id="proLane" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor="#6ad4ff" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#4fc3f7" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        <path d="M320,0 L550,0 L870,130 L0,130Z" fill="url(#proRoad)" />
        <path d="M430,0 L440,0 L480,130 L460,130Z" fill="#c85a00" opacity="0.25" />
        <path d="M320,0 L340,0 L60,130 L0,100Z" fill="#7b2fff" opacity="0.10" />
      </svg>

      {/* Car silhouette */}
      <svg
        className="absolute bottom-[58px] left-1/2 -translate-x-1/2 w-[130px] pointer-events-none"
        viewBox="0 0 130 58"
      >
        <defs>
          <linearGradient id="proCarBody" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#2a2a3a" />
            <stop offset="100%" stopColor="#0d0d14" />
          </linearGradient>
        </defs>
        <path d="M10,40 L10,30 C10,30 22,10 38,8 L92,8 C104,8 118,22 120,30 L120,40 Z" fill="url(#proCarBody)" />
        <path d="M30,8 L38,2 L92,2 L98,8Z" fill="#1a1a28" />
        <path d="M32,8 L39,3 L64,3 L64,8Z" fill="rgba(79,195,247,0.18)" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
        <path d="M66,3 L90,3 L96,8 L66,8Z" fill="rgba(79,195,247,0.18)" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
        <circle cx="30" cy="42" r="10" fill="#111" stroke="#2a2a3a" strokeWidth="2" />
        <circle cx="30" cy="42" r="6" fill="#1a1a28" />
        <circle cx="100" cy="42" r="10" fill="#111" stroke="#2a2a3a" strokeWidth="2" />
        <circle cx="100" cy="42" r="6" fill="#1a1a28" />
        <path d="M106,34 L120,36 L120,40 L105,39 Z" fill="rgba(200,220,255,0.5)" />
        <rect x="7" y="28" width="4" height="8" rx="2" fill="#c0392b" opacity="0.85" />
        <ellipse cx="65" cy="53" rx="50" ry="5" fill="rgba(79,195,247,0.06)" />
      </svg>

      {/* Content overlay */}
      <div className="absolute inset-0 flex flex-col p-5">
        {/* Top row */}
        <div className="flex justify-between items-start">
          {/* Speed limit */}
          <div className="flex flex-col items-center gap-1 z-[2]">
            <div
              className="rounded-full border-[3px] border-[#f44336] flex items-center justify-center bg-[rgba(244,67,54,0.12)]"
              style={{
                width: Math.max(gaugeSize * 0.2, 36),
                height: Math.max(gaugeSize * 0.2, 36),
                boxShadow: '0 0 16px rgba(244,67,54,0.4)',
              }}
            >
              <span
                className="font-bold text-[#f44336]"
                style={{ fontFamily: '"Orbitron", monospace', fontSize: Math.max(gaugeSize * 0.074, 13) }}
              >90</span>
            </div>
            <span className="text-center text-white/55" style={{ fontSize: spaceMd - 1 }}>{t('common.limit')}</span>
          </div>

          {/* Drive mode */}
          <div className="text-right z-[2]">
            <div className="text-[28px] font-bold text-white" style={{ fontFamily: '"Orbitron", monospace' }}>D</div>
            <div className="text-[11px] text-white/50 tracking-[2px]">NORMAL</div>
          </div>
        </div>

        {/* Gauge — center */}
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -52%)', width: gaugeSize, height: gaugeSize, zIndex: 3 }}>
          <svg viewBox="0 0 260 260" className="overflow-visible">
            <defs>
              <linearGradient id="proArcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#4fc3f7" />
                <stop offset="50%" stopColor="#7c4dff" />
                <stop offset="100%" stopColor="#f44336" />
              </linearGradient>
            </defs>
            {/* Track */}
            <path d={arcPath(START_DEG, START_DEG + SPAN_DEG)} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8" strokeLinecap="round" />
            {/* Fill */}
            {pct > 0.01 && (
              <path
                d={arcPath(START_DEG, fillAngle)}
                fill="none"
                stroke="url(#proArcGrad)"
                strokeWidth="8"
                strokeLinecap="round"
                style={{ filter: 'drop-shadow(0 0 8px rgba(79,195,247,0.6))' }}
              />
            )}
          </svg>
          {/* Speed number */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
            <span style={{
              fontFamily: '"Orbitron", monospace',
              fontSize: Math.round(gaugeSize * 0.29),
              fontWeight: 900,
              color: '#fff',
              lineHeight: 1,
              letterSpacing: -2,
              textShadow: '0 0 40px rgba(255,255,255,0.25)',
            }}>{speedKmh}</span>
            <span style={{
              fontFamily: '"Orbitron", monospace',
              fontSize: 13,
              color: 'rgba(255,255,255,0.55)',
              letterSpacing: 3,
              marginTop: -2,
            }}>km/h</span>
          </div>
        </div>

        {/* Bottom info */}
        <div className="absolute bottom-3.5 left-5 right-5 flex justify-between items-center z-[5]">
          <div className="flex items-center gap-1.5 text-[13px] text-white/70">
            <Fuel className="w-4 h-4 opacity-70" />
            <span>{fuelRange} km</span>
          </div>
          <div className="flex items-center gap-1.5 text-[13px] text-white/70">
            <Thermometer className="w-4 h-4 opacity-70" />
            <span>{Math.round(temp)}°C</span>
          </div>
        </div>
      </div>

      {/* Bottom glow line */}
      <div
        className="absolute bottom-0 inset-x-0 h-0.5"
        style={{ background: 'linear-gradient(90deg, transparent, #4fc3f7, transparent)', boxShadow: '0 0 12px #4fc3f7' }}
      />
    </div>
  );
});

/* ─── MUSIC CARD ───────────────────────────────────────────────── */
const MusicCard = memo(function MusicCard({ width = 300 }: { width?: number }) {
  const { t } = useTranslation();
  const { playing, track } = useMediaState();
  const [elapsed, setElapsed] = useState(92); // 1:32
  const total = 228; // 3:48

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setElapsed(e => (e + 1) % total), 1000);
    return () => clearInterval(id);
  }, [playing]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div
      className="flex flex-col overflow-hidden flex-shrink-0"
      style={{
        width,
        borderRadius: 'var(--radius-card, 16px)',
        border: '1px solid var(--border-color, rgba(255,255,255,0.06))',
        background: 'var(--bg-card, #12151d)',
        boxShadow: '0 4px 32px rgba(0,0,0,0.6)',
        transition: 'background 0.4s ease',
      }}
    >
      {/* Vinyl section */}
      <div
        className="relative flex items-center justify-center overflow-hidden flex-1 min-h-0"
        style={{ background: 'var(--bg-primary, #0d0d16)', transition: 'background 0.4s ease' }}
      >
        {/* EQ icon */}
        <div className="absolute top-3 left-3 w-8 h-8 bg-white/[0.08] rounded-lg flex items-center justify-center z-[5]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="2">
            <path d="M9 19V5m6 11V3M3 17V9m18 4V9" />
          </svg>
        </div>

        {/* Vinyl record */}
        <div className="relative flex items-center justify-center">
          <div style={{
            width: 180, height: 180, borderRadius: '50%',
            background: 'radial-gradient(circle at center, #1a1a1a 0%, #0d0d0d 30%, #1a1a1a 31%, #111 35%, #1a1a1a 36%, #111 50%, #1a1a1a 51%, #0d0d0d 100%)',
            boxShadow: '0 0 30px rgba(0,0,0,0.8)',
            animation: playing ? 'proVinylSpin 4s linear infinite' : 'none',
          }}>
            {/* Album label */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70px] h-[70px] rounded overflow-hidden" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.6)' }}>
              {track.albumArt
                ? <img src={track.albumArt} className="w-full h-full object-cover" alt="" />
                : (
                  <div className="w-full h-full" style={{ background: 'linear-gradient(135deg, #4a1942 0%, #8b4513 30%, #c0392b 50%, #e67e22 70%, #f39c12 100%)' }} />
                )
              }
            </div>
          </div>

          {/* Tonearm */}
          <svg className="absolute right-2.5 -top-2.5 w-[60px] h-[100px] pointer-events-none" viewBox="0 0 60 100">
            <line x1="50" y1="5" x2="20" y2="82" stroke="rgba(255,220,100,0.75)" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="50" cy="5" r="5" fill="#333" stroke="rgba(255,220,100,0.6)" strokeWidth="1.5" />
            <circle cx="50" cy="5" r="3" fill="rgba(255,220,100,0.8)" />
          </svg>
        </div>
      </div>

      {/* Music info */}
      <div className="px-4 py-3.5" style={{ background: 'var(--bg-surface, #12151d)', transition: 'background 0.4s ease' }}>
        <div className="text-[17px] font-bold text-white mb-0.5">
          {track.title || t('common.not_playing')}
        </div>
        <div className="text-[13px] text-white/45 mb-2.5">
          {track.artist || t('common.no_signal')}
        </div>

        {/* Progress */}
        <div className="mb-2">
          <div className="h-[3px] bg-white/10 rounded-sm overflow-hidden mb-1">
            <div style={{
              height: '100%',
              width: `${(elapsed / total) * 100}%`,
              background: 'linear-gradient(90deg, #f44336, #e91e63)',
              borderRadius: 2,
              transition: 'width 1s linear',
            }} />
          </div>
          <div className="flex justify-between text-[11px] text-white/[0.38]" style={{ fontFamily: '"Orbitron", monospace' }}>
            <span>{fmt(elapsed)}</span>
            <span>{fmt(total)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-6">
          <button onClick={() => previous()}
            className="flex items-center justify-center active:scale-90 transition-all bg-transparent border-none cursor-pointer text-white/55 p-1.5">
            <SkipBack className="w-5 h-5" />
          </button>
          <button onClick={() => togglePlayPause()}
            className="flex items-center justify-center active:scale-90 transition-all w-12 h-12 rounded-full bg-white/[0.12] border-2 border-white/20 cursor-pointer text-white">
            {playing
              ? <Pause className="w-5 h-5 fill-white" />
              : <Play className="w-5 h-5 fill-white ml-0.5" />
            }
          </button>
          <button onClick={() => next()}
            className="flex items-center justify-center active:scale-90 transition-all bg-transparent border-none cursor-pointer text-white/55 p-1.5">
            <SkipForward className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
});

/* ─── MINI CARD WRAPPER ────────────────────────────────────────── */
function MiniCard({ children, onClick, spaceMd = 10 }: { children: React.ReactNode; onClick?: () => void; spaceMd?: number }) {
  return (
    <div
      data-mini-card
      onClick={onClick}
      className={`relative overflow-hidden flex flex-col flex-1 min-w-0 transition-all active:scale-[0.99] ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
      style={{
        borderRadius: 'var(--radius-card, 16px)',
        border: '1px solid var(--border-color, rgba(255,255,255,0.06))',
        background: 'var(--bg-card, #12151d)',
        padding: spaceMd + 4,
        boxShadow: '0 2px 16px rgba(0,0,0,0.4)',
        transition: 'background 0.4s ease, border-color 0.4s ease',
      }}
    >
      {children}
    </div>
  );
}

/* ─── NAV MINI CARD ────────────────────────────────────────────── */
const NavMiniCard = memo(function NavMiniCard({ onOpenMap, fullMapOpen }: { onOpenMap: () => void; fullMapOpen?: boolean }) {
  return (
    <div
      className="flex-1 overflow-hidden relative cursor-pointer"
      style={{
        borderRadius: 'var(--radius-card, 16px)',
        border: '1px solid var(--border-color, rgba(255,255,255,0.06))',
        background: 'var(--bg-card, #0e1119)',
        boxShadow: '0 2px 16px rgba(0,0,0,0.4)',
        transition: 'background 0.4s ease, border-color 0.4s ease',
      }}
      onClick={onOpenMap}
    >
      {fullMapOpen ? (
        <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(160deg,#06101f,#0d1e38)' }}>
          <MapPin className="w-8 h-8 opacity-50 text-[#4fc3f7]" />
        </div>
      ) : (
        <MiniMapWidget onFullScreenClick={onOpenMap} />
      )}
      {/* Expand button overlay */}
      <div
        className="absolute top-2 right-2 z-10 w-7 h-7 bg-black/55 rounded-lg flex items-center justify-center pointer-events-none"
      >
        <Maximize2 className="w-3.5 h-3.5 text-white/70" />
      </div>
    </div>
  );
});

/* ─── PHONE MINI CARD ──────────────────────────────────────────── */
const PhoneMiniCard = memo(function PhoneMiniCard({ onLaunch, spaceMd }: { onLaunch: (id: string) => void; spaceMd?: number }) {
  const { t } = useTranslation();
  return (
    <MiniCard spaceMd={spaceMd} onClick={() => onLaunch('phone')}>
      <div className="text-[13px] font-semibold text-white/80 mb-1">{t('common.phone')}</div>
      <div className="flex items-center gap-1.5 mb-1">
        <div className="w-[7px] h-[7px] rounded-full bg-[#4caf50]" style={{ boxShadow: '0 0 8px #4caf50', animation: 'proPulse 2s infinite' }} />
        <span className="text-xs text-[#4caf50] font-semibold">{t('common.connected')}</span>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'rgba(76,175,80,0.12)', border: '2px solid rgba(76,175,80,0.35)', boxShadow: '0 0 20px rgba(76,175,80,0.25)' }}>
          <Phone className="w-6 h-6 text-[#4caf50]" />
        </div>
      </div>
      <div className="flex justify-around pt-2 border-t border-white/[0.06]"
        onClick={e => e.stopPropagation()}>
        {[User, Star, Clock].map((Icon, i) => (
          <button key={i} onClick={() => onLaunch('phone')} className="w-8 h-8 rounded-lg bg-white/[0.05] border-none cursor-pointer flex items-center justify-center">
            <Icon className="w-4 h-4 text-white/45" />
          </button>
        ))}
      </div>
    </MiniCard>
  );
});

/* ─── WEATHER MINI CARD ────────────────────────────────────────── */
const WeatherMiniCard = memo(function WeatherMiniCard({ spaceMd }: { spaceMd?: number }) {
  const { t } = useTranslation();
  return (
    <MiniCard spaceMd={spaceMd}>
      {/* Sunset bg */}
      <div
        className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{ background: 'linear-gradient(135deg, rgba(180,80,20,0.32) 0%, rgba(120,40,60,0.28) 40%, rgba(20,20,40,0.88) 100%)' }}
      />
      <div className="relative z-[2] h-full flex flex-col">
        <div className="text-[13px] font-semibold text-white/80 mb-1.5">{t('common.weather')}</div>
        <div className="flex items-center gap-2 mb-0.5">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5">
            <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z" />
          </svg>
          <span className="text-[26px] font-bold text-white" style={{ fontFamily: '"Orbitron", monospace' }}>--°C</span>
        </div>
        <div className="text-[11px] text-white/55 mb-px">{t('common.weather')}</div>
        <div className="text-[11px] text-white/35 mb-2">Konum belirleniyor...</div>
        <div className="flex justify-between mt-auto pt-2 border-t border-white/[0.06]">
          {[
            { t: '12:00', icon: '☀️', temp: '--°' },
            { t: '15:00', icon: '🌤️', temp: '--°' },
            { t: '18:00', icon: '☁️', temp: '--°' },
          ].map((f, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-white/[0.38]">{f.t}</span>
              <span className="text-sm">{f.icon}</span>
              <span className="text-[11px] text-white/75 font-semibold">{f.temp}</span>
            </div>
          ))}
        </div>
      </div>
    </MiniCard>
  );
});

/* ─── APPS MINI CARD ───────────────────────────────────────────── */
const AppsMiniCard = memo(function AppsMiniCard({ onLaunch, spaceMd }: { onLaunch: (id: string) => void; spaceMd?: number }) {
  const { t } = useTranslation();
  const apps = [
    { id: 'youtube', icon: '▶️', label: 'YouTube', bg: '#ff0000' },
    { id: 'spotify', icon: '🎵', label: 'Spotify', bg: '#1db954' },
    { id: 'chrome', icon: '🌐', label: 'Chrome', bg: '#fff' },
    { id: 'maps', icon: '🗺️', label: 'Haritalar', bg: 'linear-gradient(135deg,#34a853,#4285f4)' },
    { id: 'playstore', icon: '▶', label: 'Play Store', bg: 'linear-gradient(135deg,#01875f,#34a853)' },
    { id: 'news', icon: '📰', label: 'Haberler', bg: '#1565c0' },
  ];

  return (
    <MiniCard spaceMd={spaceMd}>
      <div className="text-[13px] font-semibold text-white/80 mb-2">{t('common.apps')}</div>
      <div className="grid grid-cols-3 gap-2 flex-1">
        {apps.map((app) => {
          const nativeApp = APP_MAP[app.id];
          return (
            <button
              key={app.id}
              onClick={() => onLaunch(app.id)}
              className="flex flex-col items-center gap-1 rounded-lg active:scale-90 transition-all bg-transparent border-none cursor-pointer px-0.5 py-1"
            >
              <div
                className="w-[34px] h-[34px] rounded-lg flex items-center justify-center text-base"
                style={{ background: app.bg }}
              >
                <span>{nativeApp?.icon || app.icon}</span>
              </div>
              <span className="text-[9px] text-white/45 text-center leading-tight">
                {nativeApp?.name || app.label}
              </span>
            </button>
          );
        })}
      </div>
    </MiniCard>
  );
});

/* ─── VEHICLE MINI CARD ────────────────────────────────────────── */
const VehicleMiniCard = memo(function VehicleMiniCard({
  onOpenSettings, onOpenRearCam, onLaunch, spaceMd,
}: { onOpenSettings: () => void; onOpenRearCam?: () => void; onLaunch: (id: string) => void; spaceMd?: number }) {
  const vehicleBtns = [
    { Icon: Camera,   action: onOpenRearCam ?? onOpenSettings },
    { Icon: User,     action: onOpenSettings },
    { Icon: Monitor,  action: () => onLaunch('youtube') },
    { Icon: Settings, action: onOpenSettings },
  ];
  return (
    <MiniCard spaceMd={spaceMd} onClick={onOpenSettings}>
      <div className="flex justify-between items-start mb-0.5">
        <div>
          <div className="text-[13px] font-semibold text-white/80 leading-tight">
            Araç Durumu <span className="text-white/28 text-[11px]">›</span>
          </div>
          <div className="text-xs text-[#4caf50] font-semibold">Mükemmel</div>
        </div>
      </div>

      {/* Car illustration */}
      <div className="flex-1 flex items-center justify-center">
        <svg viewBox="0 0 200 90" width="190" height="80">
          <defs>
            <linearGradient id="proVehBody" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#2a2a3e" />
              <stop offset="100%" stopColor="#0d0d14" />
            </linearGradient>
            <radialGradient id="proGndRefl" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(79,195,247,0.12)" />
              <stop offset="100%" stopColor="rgba(79,195,247,0)" />
            </radialGradient>
          </defs>
          <ellipse cx="100" cy="82" rx="80" ry="7" fill="url(#proGndRefl)" />
          <path d="M15,62 L15,50 C15,50 28,28 48,24 L152,24 C170,24 185,42 185,50 L185,62 Z" fill="url(#proVehBody)" />
          <path d="M15,60 L185,60 L188,68 L12,68 Z" fill="#111118" />
          <path d="M55,24 L65,10 L135,10 L145,24 Z" fill="#1a1a28" />
          <path d="M58,24 L67,12 L100,12 L100,24 Z" fill="rgba(79,195,247,0.18)" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />
          <path d="M100,24 L100,12 L133,12 L143,24 Z" fill="rgba(79,195,247,0.18)" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />
          <line x1="100" y1="24" x2="100" y2="60" stroke="rgba(255,255,255,0.07)" strokeWidth="0.8" />
          <rect x="70" y="46" width="12" height="2.5" rx="1.2" fill="rgba(255,255,255,0.14)" />
          <rect x="118" y="46" width="12" height="2.5" rx="1.2" fill="rgba(255,255,255,0.14)" />
          <path d="M168,42 L183,46 L183,52 L166,49 Z" fill="rgba(200,220,255,0.5)" />
          <ellipse cx="185" cy="47" rx="4" ry="2" fill="rgba(200,220,255,0.35)" />
          <path d="M17,42 L16,50 L20,52 L22,44 Z" fill="#c0392b" opacity="0.8" />
          <circle cx="50" cy="68" r="13" fill="#0a0a12" stroke="#222" strokeWidth="2.5" />
          <circle cx="50" cy="68" r="8" fill="#111120" />
          <circle cx="50" cy="68" r="4" fill="#1a1a28" />
          <g stroke="rgba(255,255,255,0.14)" strokeWidth="1.2">
            <line x1="50" y1="61" x2="50" y2="75" /><line x1="43" y1="68" x2="57" y2="68" />
            <line x1="45" y1="63" x2="55" y2="73" /><line x1="45" y1="73" x2="55" y2="63" />
          </g>
          <circle cx="150" cy="68" r="13" fill="#0a0a12" stroke="#222" strokeWidth="2.5" />
          <circle cx="150" cy="68" r="8" fill="#111120" />
          <circle cx="150" cy="68" r="4" fill="#1a1a28" />
          <g stroke="rgba(255,255,255,0.14)" strokeWidth="1.2">
            <line x1="150" y1="61" x2="150" y2="75" /><line x1="143" y1="68" x2="157" y2="68" />
            <line x1="145" y1="63" x2="155" y2="73" /><line x1="145" y1="73" x2="155" y2="63" />
          </g>
          <path d="M22,44 L168,44" stroke="rgba(79,195,247,0.22)" strokeWidth="0.8" />
        </svg>
      </div>

      {/* Action buttons */}
      <div className="flex justify-around pt-2 border-t border-white/[0.06]"
        onClick={e => e.stopPropagation()}>
        {vehicleBtns.map(({ Icon, action }, i) => (
          <button key={i} onClick={action} className="w-[30px] h-[30px] rounded-lg bg-white/[0.05] border-none cursor-pointer flex items-center justify-center">
            <Icon className="w-3.5 h-3.5 text-white/50" />
          </button>
        ))}
      </div>
    </MiniCard>
  );
});


/* ─── KEYFRAMES (injected once) ────────────────────────────────── */
const KEYFRAMES = `
  @keyframes proVinylSpin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @keyframes proPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  @keyframes proMicGlow {
    0%, 100% { box-shadow: 0 0 20px rgba(79,195,247,0.4), 0 0 40px rgba(79,195,247,0.15); }
    50% { box-shadow: 0 0 30px rgba(79,195,247,0.65), 0 0 60px rgba(79,195,247,0.28); }
  }
  @keyframes rpmWave {
    0%   { transform: scaleX(1)   translateY(0px); }
    30%  { transform: scaleX(1.1) translateY(-2px); }
    60%  { transform: scaleX(0.95) translateY(1px); }
    100% { transform: scaleX(1)   translateY(0px); }
  }
`;

let styleInjected = false;
function injectStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const el = document.createElement('style');
  el.textContent = KEYFRAMES;
  document.head.appendChild(el);
}

/* ─── PRO DOCK ─────────────────────────────────────────────────── */
const ProDock = memo(function ProDock({ appMap, dockIds, onLaunch, onOpenApps, onOpenSettings }: {
  appMap: Record<string, AppItem>; dockIds: string[]; onLaunch: (id: string) => void;
  onOpenApps: () => void; onOpenSettings: () => void;
}) {
  const { unreadCount } = useNotificationState();
  const [moreOpen, setMoreOpen] = useState(false);
  const BTN_W = 90, BTN_H = 90, BTN_R = 18, ICON = 24;
  const C_ACC = 'var(--accent, #00e5ff)';
  const C_DIM = 'rgba(255,255,255,0.30)';

  function PBtn({ fn, label, color, children, badge }: {
    fn: () => void; label: string; color: string; children: React.ReactNode; badge?: number;
  }) {
    return (
      <button onClick={fn}
        className="flex flex-col items-center justify-center gap-2 flex-shrink-0 active:scale-90 transition-all relative"
        style={{ width: BTN_W, height: BTN_H, borderRadius: BTN_R, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}>
        <div style={{ color, width: ICON, height: ICON, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {children}
        </div>
        <span style={{ fontSize: 9, color: C_DIM, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em' }}>{label}</span>
        {!!badge && (
          <span className="absolute top-1.5 right-1.5 min-w-4 h-4 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1"
            style={{ background: C_ACC }}>
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="flex-shrink-0"
      style={{ background: 'linear-gradient(180deg,rgba(5,7,14,0.97) 0%,rgba(6,9,18,0.99) 100%)', borderTop: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 -4px 24px rgba(0,0,0,0.60)' }}>
      {moreOpen && (
        <div className="flex items-center justify-center gap-3 px-4 py-2 overflow-x-auto no-scrollbar"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {([
            { label: 'Hava',     color: '#38bdf8', icon: <Cloud    size={20} />, fn: () => { openDrawer('weather');      setMoreOpen(false); } },
            { label: 'Trafik',   color: '#fb923c', icon: <AlertTriangle size={20} />, fn: () => { openDrawer('traffic'); setMoreOpen(false); } },
            { label: 'Dashcam',  color: '#f87171', icon: <Camera   size={20} />, fn: () => { openDrawer('dashcam');      setMoreOpen(false); } },
            { label: 'Seyir',    color: '#34d399', icon: <Route    size={20} />, fn: () => { openDrawer('triplog');      setMoreOpen(false); } },
            { label: 'Arıza',    color: '#fbbf24', icon: <ShieldAlert size={20} />, fn: () => { openDrawer('dtc');       setMoreOpen(false); } },
            { label: 'Bakım',    color: '#94a3b8', icon: <Wrench   size={20} />, fn: () => { openDrawer('vehicle-reminder'); setMoreOpen(false); } },
            { label: 'Güvenlik', color: '#34d399', icon: <Shield   size={20} />, fn: () => { openDrawer('security');    setMoreOpen(false); } },
            { label: 'Eğlence',  color: '#60a5fa', icon: <Tv2     size={20} />, fn: () => { openDrawer('entertainment'); setMoreOpen(false); } },
          ] as const).map((item, i) => (
            <button key={i} onClick={item.fn}
              className="flex flex-col items-center gap-1.5 flex-shrink-0 active:scale-90 transition-all px-3 py-2 rounded-2xl"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ color: item.color }}>{item.icon}</div>
              <span style={{ fontSize: 9, color: C_DIM, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{item.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-center gap-3 overflow-x-auto no-scrollbar px-4 py-3">
        {dockIds.slice(0, 2).map(id => {
          const app = appMap[id] ?? APP_MAP[id];
          if (!app) return null;
          return (
            <PBtn key={id} fn={() => onLaunch(id)} label={app.name} color={C_ACC}>
              <span style={{ fontSize: ICON }}>{app.icon}</span>
            </PBtn>
          );
        })}
        <PBtn fn={() => openDrawer('phone')}         label="Telefon"  color={C_ACC}><Phone           size={ICON} /></PBtn>
        <PBtn fn={() => openMusicDrawer()}           label="Müzik"    color={C_ACC}><Music2          size={ICON} /></PBtn>
        <PBtn fn={() => openDrawer('notifications')} label="Bildirim" color={C_ACC} badge={unreadCount}><Bell size={ICON} /></PBtn>
        <PBtn fn={onOpenApps}                        label="Menü"     color={C_ACC}><LayoutGrid      size={ICON} /></PBtn>
        <PBtn fn={onOpenSettings}                    label="Ayarlar"  color={C_DIM}><SlidersHorizontal size={ICON} /></PBtn>
        <button onClick={() => setMoreOpen(o => !o)}
          className="flex flex-col items-center justify-center gap-2 flex-shrink-0 active:scale-90 transition-all"
          style={{ width: BTN_W, height: BTN_H, borderRadius: BTN_R, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          {moreOpen ? <ChevronDown size={ICON} style={{ color: C_DIM }} /> : <ChevronUp size={ICON} style={{ color: C_DIM }} />}
          <span style={{ fontSize: 9, color: C_DIM, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em' }}>{moreOpen ? 'Kapat' : 'Daha'}</span>
        </button>
      </div>
    </div>
  );
});

/* ─── ROOT LAYOUT ──────────────────────────────────────────────── */
export const ProLayout = memo(function ProLayout({
  onOpenMap, onOpenApps, onOpenSettings, onLaunch, appMap, dockIds, fullMapOpen,
  onOpenRearCam, smart,
}: Props) {
  injectStyles();
  const { screen, profile } = useLayout();

  const isPortrait = screen.height > screen.width;

  // Sidebar genişliği: dockIconSize tabanlı, COMPACT'ta gizlenecek
  const sidebarW = getSidebarW(profile.dockIconSize);

  // Structural sizes — widget row always visible, proportions adapt to screen height
  // dockTotal removed — MainLayout spacer handles dock gap
  const contentH   = Math.max(screen.height - profile.headerHeight - 24, 200);
  // Music card: ekran genişliğinin %33'ü, sidebarW çıkarılır
  const musicCardW = Math.max(Math.min(Math.floor((screen.width - sidebarW) * 0.33), 400), 200);

  // Widget row: 120px min, 220px max — whatever fits after top row
  const widgetH    = Math.min(Math.max(contentH - 296 - 11, 120), 220);
  // Top row: takes remaining space after widget row, minimum 180px
  const topRowH    = Math.max(contentH - widgetH - 11, 180);
  // Final widget height after top row is clamped
  const widgetRowH = contentH - topRowH - 11;
  // Gauge size scales with top row height; cap at screen category-based maximum
  const gaugeMax   = screen.category === 'COMPACT' ? 200 : screen.category === 'WIDE' ? 300 : 260;
  const gaugeSize  = Math.min(Math.floor(topRowH * 0.92), gaugeMax);

  return (
    <div
      className="flex overflow-hidden w-full h-full"
      data-layout="pro-main"
      style={{
        flexDirection: isPortrait ? 'column' : ('var(--l-flex-dir, row)' as CSSProperties['flexDirection']),
        background: 'var(--bg-primary, #0a0c10)',
        transition: 'background 0.4s ease',
      }}
    >
      {/* RPM Bar — COMPACT'ta CSS ile gizlenir */}
      <RpmBar width={sidebarW} />

      {/* Right: top bar + content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar headerH={profile.headerHeight} font2xl={profile.font2xl} fontSm={profile.fontSm} />

        {/* Content */}
        <div
          className="flex-1 flex flex-col overflow-hidden min-h-0"
          style={{ padding: '12px 14px', gap: 11 }}
        >
          {/* Top row: speedo + music */}
          <div className="flex flex-shrink-0 overflow-hidden" style={{ gap: profile.spaceSm, height: topRowH }}>
            <SpeedCard gaugeSize={gaugeSize} spaceMd={profile.spaceMd} />
            <MusicCard width={musicCardW} />
          </div>

          {/* Widget row: always visible, height adapts, COMPACT'ta yatay scroll */}
          <div data-widget-row className="flex flex-shrink-0 overflow-hidden" style={{ gap: profile.spaceSm, height: widgetRowH }}>
            <NavMiniCard onOpenMap={onOpenMap} fullMapOpen={fullMapOpen} />
            <PhoneMiniCard onLaunch={onLaunch} spaceMd={profile.spaceMd} />
            <WeatherMiniCard spaceMd={profile.spaceMd} />
            <AppsMiniCard onLaunch={onLaunch} spaceMd={profile.spaceMd} />
            <VehicleMiniCard onOpenSettings={onOpenSettings} onOpenRearCam={onOpenRearCam} onLaunch={onLaunch} spaceMd={profile.spaceMd} />
          </div>

          {/* Magic Context Card — widget sırasının altında, dock üzerinde */}
          {smart && smart.predictions.length > 0 && (
            <MagicContextCard smart={smart} variant="pro" onLaunch={onLaunch} onOpenMap={onOpenMap} />
          )}
        </div>

        {/* Pro Dock — tam genişlik shortcut satırı */}
        <ProDock appMap={appMap ?? {}} dockIds={dockIds ?? []} onLaunch={onLaunch} onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} />
      </div>
    </div>
  );
});
