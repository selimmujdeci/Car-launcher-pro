import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useStore } from '../../store/useStore';
import {
  Home, Map, Music, Gauge, Navigation, Settings, Sliders,
  Thermometer, Battery, Zap, Search, Mic,
  ChevronRight, SkipBack, Play, SkipForward, Heart,
  Plus, Minus, Wind, Snowflake, ArrowLeft,
  MapPin, Briefcase, Compass, ArrowRight, ArrowUp,
} from 'lucide-react';
import { useOBDState, useOBDRPM } from '../../platform/obdService';
import { useGPSLocation, resolveSpeedKmh } from '../../platform/gpsService';
import { useMediaState, togglePlayPause, next, previous } from '../../platform/mediaService';
import type { MusicOptionKey } from '../../data/apps';
import { MiniMapWidget } from '../map/MiniMapWidget';
import { TelemetryView } from '../sport/TelemetryView';
import { QuickControlsOverlay } from '../climate/QuickControlsOverlay';
import { geocodeAddress, type GeoResult } from '../../platform/geocodingService';
import { startNavigation, activateNavigation, useNavigation } from '../../platform/navigationService';
import { useRouteState, selectAltRoute, fetchRoute } from '../../platform/routingService';
import type { Address } from '../../platform/addressBookService';
import '../../styles/oem-cockpit.css';

const SettingsPage = lazy(() =>
  import('../settings/SettingsPage').then(m => ({ default: m.SettingsPage }))
);
const MediaScreenReal = lazy(() =>
  import('../media/MediaScreen').then(m => ({ default: m.MediaScreen }))
);

// ────────────────────────────────────────────────────────
//  Types
// ────────────────────────────────────────────────────────
type OEMScreen = 'cockpit' | 'navigation' | 'media' | 'telemetry' | 'split' | 'settings';

interface OEMCockpitLayoutProps {
  onOpenFullMap?: () => void;
  onOpenSettings?: () => void;
  onOpenApps?: () => void;
}

// ────────────────────────────────────────────────────────
//  Clock hook
// ────────────────────────────────────────────────────────
function useClock() {
  const fmt = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const days = ['PAZAR','PAZARTESİ','SALI','ÇARŞAMBA','PERŞEMBE','CUMA','CUMARTESİ'];
    const months = ['OCA','ŞUB','MAR','NİS','MAY','HAZ','TEM','AĞU','EYL','EKİ','KAS','ARA'];
    return {
      hhmm: pad(d.getHours()) + ':' + pad(d.getMinutes()),
      dateLine: days[d.getDay()] + ' · ' + pad(d.getDate()) + ' ' + months[d.getMonth()],
    };
  };
  const [time, setTime] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setTime(fmt()), 15_000);
    return () => clearInterval(id);
  }, []);
  return time;
}

// ────────────────────────────────────────────────────────
//  BrandMark SVG
// ────────────────────────────────────────────────────────
function BrandMark() {
  return (
    <svg width="36" height="36" viewBox="0 0 40 40" fill="none" aria-hidden>
      <defs>
        <linearGradient id="bmGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(82% 0.08 246)" />
          <stop offset="1" stopColor="oklch(56% 0.11 250)" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="18.5" stroke="rgba(232,224,208,0.22)" />
      <circle cx="20" cy="20" r="14" stroke="rgba(232,224,208,0.10)" />
      <path d="M14 14h12M14 20h12M14 26h8" stroke="url(#bmGold)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ────────────────────────────────────────────────────────
//  StatusStrip — 88px top bar
// ────────────────────────────────────────────────────────
function StatusStrip({ onScreen: _onScreen }: { screen: OEMScreen; onScreen: (s: OEMScreen) => void }) {
  const time = useClock();
  const obd = useOBDState();

  const battery = obd.fuelLevel >= 0 ? Math.round(obd.fuelLevel) : 76;
  const range = obd.estimatedRangeKm >= 0 ? Math.round(obd.estimatedRangeKm) : 384;
  const cabin = 21;

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, height: 88,
      display: 'flex', alignItems: 'center',
      padding: '0 32px',
      borderBottom: '1px solid var(--line)',
      background: 'linear-gradient(180deg, var(--chrome-bg-strong) 0%, var(--chrome-bg-soft) 60%, transparent 100%)',
      backdropFilter: 'blur(4px)',
      zIndex: 10,
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '0 1 220px' }}>
        <BrandMark />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.18em', color: 'var(--ink)' }}>
            CarOS <span style={{ color: 'var(--amber)' }}>PRO</span>
          </div>
          <div className="oem-eyebrow" style={{ fontSize: 9, marginTop: 2 }}>Kokpit Sistemi</div>
        </div>
      </div>

      {/* Centered clock */}
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div className="oem-num" style={{ fontSize: 32, fontWeight: 200, letterSpacing: '0.04em', lineHeight: 1, color: 'var(--ink)' }}>
          {time.hhmm}
        </div>
        <div className="oem-eyebrow" style={{ marginTop: 5, letterSpacing: '0.20em', fontSize: 10 }}>
          {time.dateLine}
        </div>
      </div>

      {/* Right: telemetry chips + action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
        <TelChip icon={<Thermometer size={14} />} value={`${cabin}°`} label="KABİN" />
        <TelChip
          icon={<Battery size={14} />}
          value={`${battery}%`}
          label="YAKIT"
          tone={battery > 30 ? 'good' : 'warn'}
        />
        <TelChip icon={<Zap size={14} />} value={`${range} km`} label="MENZİL" tone="amber" />

        <div style={{ width: 1, height: 32, background: 'var(--line)', margin: '0 4px' }} />

        <button className="oem-btn ghost icon" aria-label="Ara">
          <Search size={18} />
        </button>
        <button className="oem-btn ghost icon" aria-label="Sesli komut">
          <Mic size={18} />
        </button>
        {/* Avatar */}
        <button
          className="oem-btn ghost icon"
          aria-label="Profil"
          style={{ padding: 0, width: 44, height: 44 }}
        >
          <span style={{
            width: 34, height: 34, borderRadius: 999,
            background: 'linear-gradient(135deg, oklch(80% 0.08 246), oklch(54% 0.12 252))',
            color: '#f4f6fb', fontWeight: 700, fontSize: 13,
            display: 'grid', placeItems: 'center',
            boxShadow: '0 0 0 1px rgba(255,220,170,0.2)',
          }}>S</span>
        </button>
      </div>
    </div>
  );
}

function TelChip({
  icon, value, label, tone = 'default',
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  tone?: 'default' | 'good' | 'warn' | 'amber';
}) {
  const color =
    tone === 'warn' ? 'var(--warn)' :
    tone === 'good' ? 'var(--good)' :
    tone === 'amber' ? 'var(--amber)' :
    'var(--ink)';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '7px 12px',
      border: '1px solid var(--line-strong)',
      borderRadius: 999,
      background: 'linear-gradient(180deg, rgba(255,250,240,0.06), transparent 60%), var(--chip-bg)',
      backdropFilter: 'blur(8px)',
      flexShrink: 0,
    }}>
      <span style={{ color: 'var(--ink-3)', flexShrink: 0 }}>{icon}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, whiteSpace: 'nowrap' }}>
        <span className="oem-num" style={{ fontSize: 13, fontWeight: 600, color }}>{value}</span>
        <span className="oem-eyebrow" style={{ fontSize: 9 }}>{label}</span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
//  SideRail — 176px left nav
// ────────────────────────────────────────────────────────
const RAIL_ITEMS: { id: OEMScreen; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'cockpit',    label: 'Kokpit',  Icon: Home },
  { id: 'navigation', label: 'Yol',     Icon: Map },
  { id: 'media',      label: 'Müzik',   Icon: Music },
  { id: 'telemetry',  label: 'Araç',    Icon: Gauge },
  { id: 'split',      label: 'Sürüş',   Icon: Navigation },
  { id: 'settings',   label: 'Ayarlar', Icon: Settings },
];

function SideRail({
  screen,
  onScreen,
  onQuickControls,
}: {
  screen: OEMScreen;
  onScreen: (s: OEMScreen) => void;
  onQuickControls: () => void;
}) {
  return (
    <div style={{
      position: 'absolute', top: 88, bottom: 0, left: 0, width: 176,
      borderRight: '1px solid var(--line-strong)',
      background:
        'linear-gradient(180deg, rgba(232,236,244,0.04), transparent 12%, transparent 88%, rgba(232,236,244,0.03)),' +
        'radial-gradient(140% 60% at -10% 50%, oklch(64% 0.08 242 / 0.08), transparent 70%),' +
        'linear-gradient(90deg, var(--chrome-bg-strong), var(--chrome-bg-soft) 85%, transparent)',
      backdropFilter: 'blur(4px) saturate(110%)',
      WebkitBackdropFilter: 'blur(4px) saturate(110%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '20px 0 16px',
      gap: 4,
      zIndex: 9,
      overflowY: 'auto', overflowX: 'hidden',
      boxShadow: 'inset -1px 0 0 rgba(255,240,210,0.04), 4px 0 32px -8px rgba(0,0,0,0.45)',
    }}>
      {/* Right edge highlight */}
      <span style={{
        position: 'absolute', top: 0, right: -1, width: 1, height: '100%',
        background: 'linear-gradient(180deg, transparent, rgba(255,240,210,0.20) 20%, rgba(255,240,210,0.20) 80%, transparent)',
        pointerEvents: 'none',
      }} />

      {RAIL_ITEMS.map(({ id, label, Icon }) => {
        const active = screen === id;
        return (
          <button
            key={id}
            onClick={() => onScreen(id)}
            style={{
              appearance: 'none',
              background: active
                ? 'linear-gradient(180deg, rgba(255,235,200,0.14), rgba(255,235,200,0.02) 70%), var(--surface-1)'
                : 'transparent',
              color: active ? 'var(--ink)' : 'var(--ink-2)',
              padding: '18px 0 16px',
              width: 144,
              height: 100,
              borderRadius: 22,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 10,
              cursor: 'pointer',
              position: 'relative',
              fontFamily: 'inherit',
              border: `1px solid ${active ? 'var(--line-warm)' : 'transparent'}`,
              boxShadow: active
                ? '0 1px 0 rgba(232,236,244,0.12) inset, 0 -1px 0 rgba(0,0,0,0.18) inset, 0 12px 32px -16px oklch(66% 0.10 248 / 0.42)'
                : 'none',
              transition: 'color 0.22s ease, background 0.22s ease',
              flex: 'none',
            }}
          >
            {active && (
              <>
                {/* Glowing left bar */}
                <span style={{
                  position: 'absolute', left: -12, top: 22, bottom: 22, width: 5,
                  background: 'linear-gradient(180deg, oklch(86% 0.07 248), oklch(66% 0.11 250) 60%, oklch(50% 0.12 252))',
                  borderRadius: 5,
                  boxShadow: '0 0 14px oklch(70% 0.10 248 / 0.50)',
                }} />
                {/* Halo behind icon */}
                <span style={{
                  position: 'absolute', left: '50%', top: 28, width: 72, height: 72,
                  borderRadius: 999,
                  background: 'radial-gradient(circle, oklch(70% 0.10 248 / 0.24), transparent 70%)',
                  transform: 'translateX(-50%)',
                  pointerEvents: 'none',
                  filter: 'blur(8px)',
                }} />
              </>
            )}
            <span style={{
              position: 'relative', zIndex: 1,
              color: active ? 'var(--amber)' : 'currentColor',
              filter: active ? 'drop-shadow(0 0 10px oklch(70% 0.10 248 / 0.45))' : 'none',
              display: 'flex',
            }}>
              <Icon size={34} />
            </span>
            <span style={{
              fontSize: 12,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              fontWeight: 700,
              position: 'relative', zIndex: 1,
            }}>{label}</span>
          </button>
        );
      })}

      <div style={{ flex: 1 }} />

      {/* Separator */}
      <div style={{
        width: 80, height: 1,
        background: 'linear-gradient(90deg, transparent, var(--line-strong), transparent)',
        margin: '6px 0 12px',
      }} />

      {/* KABİN — quick controls */}
      <button
        onClick={onQuickControls}
        style={{
          appearance: 'none',
          border: '1px solid var(--line-warm)',
          background:
            'radial-gradient(circle at 50% 30%, oklch(70% 0.10 248 / 0.28), transparent 70%),' +
            'linear-gradient(180deg, oklch(64% 0.10 250 / 0.20), oklch(44% 0.10 252 / 0.08))',
          width: 108, height: 108, borderRadius: 28,
          color: 'var(--amber)', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8, marginBottom: 6,
          boxShadow:
            '0 0 32px oklch(66% 0.10 248 / 0.24),' +
            '0 1px 0 rgba(255,240,210,0.18) inset,' +
            '0 -1px 0 rgba(0,0,0,0.20) inset,' +
            '0 12px 32px -10px rgba(0,0,0,0.45)',
          fontFamily: 'inherit',
          flex: 'none',
          position: 'relative',
        }}
        aria-label="Hızlı kontroller"
      >
        <span style={{
          position: 'absolute', inset: -4, borderRadius: 32,
          background: 'radial-gradient(circle, transparent 60%, oklch(70% 0.10 248 / 0.18) 100%)',
          pointerEvents: 'none',
          animation: 'oemHaloPulse 5s ease-in-out infinite',
        }} />
        <Sliders size={38} />
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Kabin</span>
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────
//  DriveCoreCard — SVG speedometer with real OBD data
// ────────────────────────────────────────────────────────
function DriveCoreCard() {
  const obd = useOBDState();
  const gps = useGPSLocation();
  const rpm = useOBDRPM();

  const rawSpeed = resolveSpeedKmh(gps, obd.speed);
  const speed = Math.max(0, Math.round(rawSpeed ?? 0));
  const rpmK  = (Math.max(0, rpm) / 1000).toFixed(1);
  const power = Math.round(8 + speed * 0.6);
  const gear  = 'D';
  const battery = obd.fuelLevel >= 0 ? Math.round(obd.fuelLevel) : 76;
  const range   = obd.estimatedRangeKm >= 0 ? Math.round(obd.estimatedRangeKm) : 384;

  const SPEED_MAX = 180;
  const v      = Math.max(0, Math.min(1, speed / SPEED_MAX));
  const startA = -210;
  const endA   = 30;
  const sweep  = (endA - startA) * v;
  const arcR   = 218;
  const cx = 240;
  const cy = 240;
  const polar = (deg: number, r: number): [number, number] => {
    const rad = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [sx, sy] = polar(startA, arcR);
  const [ex, ey] = polar(startA + sweep, arcR);
  const largeArc = sweep > 180 ? 1 : 0;

  return (
    <div className="oem-card" style={{ padding: '24px 28px 28px', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="oem-eyebrow">Sürüş Çekirdeği</div>
          <h3 style={{ fontSize: 22, marginTop: 6, fontWeight: 600, color: 'var(--ink)' }}>Canlı Telemetri</h3>
        </div>
        <LiveTag>OBD-II</LiveTag>
      </div>

      {/* Speed gauge */}
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', position: 'relative', minHeight: 460 }}>
        {/* Outer volumetric glow */}
        <div className="oem-halo-pulse" style={{
          position: 'absolute', width: 400, height: 400, borderRadius: '999px',
          background: 'radial-gradient(circle, oklch(70% 0.09 248 / 0.16), transparent 60%)',
          filter: 'blur(24px)',
          pointerEvents: 'none',
        }} />

        {/* SVG arc gauge */}
        <svg width="480" height="480" viewBox="0 0 480 480" style={{ position: 'absolute' }}>
          <defs>
            <linearGradient id="oemSpeedArc" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="oklch(64% 0.11 250)" />
              <stop offset="0.6" stopColor="oklch(78% 0.09 246)" />
              <stop offset="1" stopColor="oklch(90% 0.05 240)" />
            </linearGradient>
            <filter id="oemArcGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
          </defs>

          {/* Tick marks every 20 km/h */}
          {Array.from({ length: 10 }).map((_, i) => {
            const a = startA + (endA - startA) * (i / 9);
            const [x1, y1] = polar(a, arcR - 14);
            const [x2, y2] = polar(a, arcR - 4);
            const major = i % 2 === 0;
            return (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="rgba(232,224,208,0.20)" strokeWidth={major ? 2 : 1} strokeLinecap="round" />
            );
          })}

          {/* Track arc (full 240°) */}
          <path
            d={`M ${polar(startA, arcR)[0]} ${polar(startA, arcR)[1]}
                A ${arcR} ${arcR} 0 1 1 ${polar(endA, arcR)[0]} ${polar(endA, arcR)[1]}`}
            fill="none" stroke="rgba(232,224,208,0.07)" strokeWidth="6" strokeLinecap="round"
          />

          {/* Filled arc */}
          {v > 0.01 && (
            <>
              <path
                d={`M ${sx} ${sy} A ${arcR} ${arcR} 0 ${largeArc} 1 ${ex} ${ey}`}
                fill="none" stroke="url(#oemSpeedArc)" strokeWidth="14" strokeLinecap="round"
                filter="url(#oemArcGlow)" opacity="0.45" className="oem-speed-arc"
              />
              <path
                d={`M ${sx} ${sy} A ${arcR} ${arcR} 0 ${largeArc} 1 ${ex} ${ey}`}
                fill="none" stroke="url(#oemSpeedArc)" strokeWidth="6" strokeLinecap="round"
              />
            </>
          )}

          {/* 80 km/h speed limit marker */}
          {(() => {
            const a = startA + (endA - startA) * (80 / SPEED_MAX);
            const [tx, ty] = polar(a, arcR - 32);
            return (
              <g>
                <circle cx={tx} cy={ty} r="14" fill="var(--chip-bg)" stroke="oklch(72% 0.16 22)" strokeWidth="2" />
                <text x={tx} y={ty + 4} textAnchor="middle" fontSize="12" fontWeight="700"
                  fill="oklch(85% 0.12 30)" fontFamily="JetBrains Mono, monospace">80</text>
              </g>
            );
          })()}
        </svg>

        {/* Center speed readout */}
        <div style={{ textAlign: 'center', position: 'relative', zIndex: 2 }}>
          <div className="oem-num oem-speed-digit" style={{
            fontSize: 200, fontWeight: 200, lineHeight: 1,
            letterSpacing: '-0.05em', color: 'var(--ink)',
          }}>{speed}</div>
          <div className="oem-mono" style={{
            fontSize: 12, letterSpacing: '0.36em', color: 'var(--amber)',
            marginTop: 6, fontWeight: 600,
          }}>KM · SAAT</div>
        </div>

        {/* Bottom badges */}
        <div style={{
          position: 'absolute', bottom: -4, left: 0, right: 0,
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="oem-eyebrow" style={{ fontSize: 9 }}>Mod</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Konfor</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            <span className="oem-eyebrow" style={{ fontSize: 9 }}>Limit</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'oklch(85% 0.12 30)' }}>80 km/s</span>
          </div>
        </div>
      </div>

      {/* Mini metrics row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 20 }}>
        <MiniMetric label="DEVİR" value={rpmK} unit="×1000" />
        <MiniMetric label="GÜÇ" value={String(power)} unit="kW" amber />
        <MiniMetric label="VİTES" value={String(gear)} unit="" />
      </div>

      {/* Fuel/battery strip */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="oem-eyebrow">Yakıt</span>
          <span className="oem-num" style={{ fontSize: 13, color: 'var(--ink-2)' }}>{battery}% · {range} km</span>
        </div>
        <div className="oem-meter-track" style={{ height: 5 }}>
          <div className="oem-meter-fill" style={{
            width: `${battery}%`, height: '100%',
            background: 'oklch(80% 0.11 158)',
          }} />
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ label, value, unit, amber }: { label: string; value: string; unit: string; amber?: boolean }) {
  return (
    <div className="oem-card-inset" style={{ padding: '12px 16px' }}>
      <div className="oem-eyebrow" style={{ fontSize: 9, marginBottom: 5 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span className="oem-num" style={{ fontSize: 20, fontWeight: 500, color: amber ? 'var(--amber)' : 'var(--ink)' }}>{value}</span>
        {unit && <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{unit}</span>}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
//  MediaTile
// ────────────────────────────────────────────────────────
function MediaTile() {
  const media = useMediaState();
  const isPlaying = media.playing;
  const track = media.track;
  const title = track.title || 'Ses Kaynağı';
  const artist = track.artist || '';
  const durationSec = track.durationSec ?? 0;
  const currentSec  = track.positionSec ?? 0;
  const progress = durationSec > 0 ? currentSec / durationSec : 0;

  const fmtSec = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <OEMCard title={title} eyebrow="Çalıyor" action={
      <button className="oem-btn ghost icon" aria-label="Müzik ekranı" style={{ width: 40, height: 40 }}>
        <ChevronRight size={16} />
      </button>
    }>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        {/* Album art placeholder */}
        <div style={{
          width: 84, height: 84, borderRadius: 14, flexShrink: 0,
          background:
            'radial-gradient(120% 80% at 30% 20%, oklch(66% 0.07 245 / 0.45), transparent 60%),' +
            'linear-gradient(140deg, oklch(50% 0.07 248) 0%, oklch(26% 0.05 250) 100%)',
          display: 'grid', placeItems: 'center',
          boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
        }}>
          <Music size={28} style={{ color: 'rgba(255,255,255,0.5)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{artist}</div>
          {/* Scrubber */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <span className="oem-num" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{fmtSec(currentSec)}</span>
            <div style={{ flex: 1 }}>
              <div className="oem-meter-track" style={{ height: 2 }}>
                <div className="oem-meter-fill" style={{ width: `${progress * 100}%`, background: 'var(--ink)' }} />
              </div>
            </div>
            <span className="oem-num" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{fmtSec(durationSec)}</span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <button className="oem-btn ghost icon" onClick={previous} aria-label="Önceki" style={{ width: 44, height: 44 }}>
          <SkipBack size={16} />
        </button>
        <button
          className="oem-btn icon"
          onClick={togglePlayPause}
          aria-label={isPlaying ? 'Duraklat' : 'Çal'}
          style={{
            width: 52, height: 52,
            background: 'linear-gradient(180deg, oklch(96% 0.02 80), oklch(78% 0.04 60))',
            color: '#0a0a0a', borderColor: 'oklch(78% 0.04 60)',
            boxShadow: '0 1px 0 rgba(255,255,255,0.5) inset, 0 6px 18px rgba(0,0,0,0.4)',
          }}
        >
          <Play size={18} />
        </button>
        <button className="oem-btn ghost icon" onClick={next} aria-label="Sonraki" style={{ width: 44, height: 44 }}>
          <SkipForward size={16} />
        </button>
        <div style={{ width: 1, height: 22, background: 'var(--line)' }} />
        <button className="oem-btn ghost icon" aria-label="Beğen" style={{ width: 44, height: 44 }}>
          <Heart size={14} />
        </button>
      </div>
    </OEMCard>
  );
}

// ────────────────────────────────────────────────────────
//  ClimateTile
// ────────────────────────────────────────────────────────
function ClimateTile() {
  const [driverT, setDriverT] = useState(21.0);
  const [paxT, setPaxT]       = useState(20.0);
  const [fanAuto, setFanAuto] = useState(true);

  return (
    <OEMCard title="İklim" eyebrow="Kabin">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <TempColumn side="Sürücü" value={driverT}
          onUp={() => setDriverT(t => Math.min(28, parseFloat((t + 0.5).toFixed(1))))}
          onDown={() => setDriverT(t => Math.max(16, parseFloat((t - 0.5).toFixed(1))))}
        />
        <TempColumn side="Yolcu" value={paxT}
          onUp={() => setPaxT(t => Math.min(28, parseFloat((t + 0.5).toFixed(1))))}
          onDown={() => setPaxT(t => Math.max(16, parseFloat((t - 0.5).toFixed(1))))}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <ClimateChip icon={<Wind size={14} />} label="Oto" active={fanAuto} onClick={() => setFanAuto(v => !v)} />
        <ClimateChip icon={<Snowflake size={14} />} label="Klima" />
        <ClimateChip icon={<DefrostIcon size={14} />} label="Buğu" />
      </div>
    </OEMCard>
  );
}

function TempColumn({ side, value, onUp, onDown }: { side: string; value: number; onUp: () => void; onDown: () => void }) {
  return (
    <div className="oem-card-inset" style={{ padding: '14px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div className="oem-eyebrow" style={{ fontSize: 9 }}>{side}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="oem-btn ghost icon" style={{ width: 32, height: 32 }} onClick={onDown} aria-label="Soğut">
          <Minus size={12} />
        </button>
        <div className="oem-num" style={{ fontSize: 28, fontWeight: 300, minWidth: 72, textAlign: 'center', color: 'var(--ink)' }}>
          {value.toFixed(1)}°
        </div>
        <button className="oem-btn ghost icon" style={{ width: 32, height: 32 }} onClick={onUp} aria-label="Isıt">
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}

function ClimateChip({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      className={`oem-btn ${active ? 'active' : 'ghost'}`}
      onClick={onClick}
      style={{ flex: 1, justifyContent: 'center', padding: '10px 6px', fontSize: 12 }}
    >
      {icon} {label}
    </button>
  );
}

// ────────────────────────────────────────────────────────
//  Generic OEM Card wrapper
// ────────────────────────────────────────────────────────
function OEMCard({
  title, eyebrow, action, children, style,
}: {
  title?: string;
  eyebrow?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="oem-card" style={{ display: 'flex', flexDirection: 'column', ...style }}>
      {(title || eyebrow || action) && (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '26px 28px 0', gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            {eyebrow && <div className="oem-eyebrow" style={{ marginBottom: 8 }}>{eyebrow}</div>}
            {title && <h3 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h3>}
          </div>
          {action && <div style={{ flexShrink: 0 }}>{action}</div>}
        </div>
      )}
      <div style={{ flex: 1, padding: '20px 28px 24px', minHeight: 0 }}>{children}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
//  LiveTag
// ────────────────────────────────────────────────────────
function LiveTag({ children }: { children?: React.ReactNode }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      padding: '7px 12px', borderRadius: 999, whiteSpace: 'nowrap',
      background: 'oklch(78% 0.10 158 / 0.12)', border: '1px solid oklch(78% 0.10 158 / 0.34)',
      color: 'var(--good)', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.18em', textTransform: 'uppercase',
    }}>
      <span className="oem-live-dot" />
      {children ?? 'Canlı'}
    </div>
  );
}

// ────────────────────────────────────────────────────────
//  CockpitScreen — 3-col grid
// ────────────────────────────────────────────────────────
function CockpitScreen({ onOpenFullMap }: { onOpenFullMap?: () => void }) {
  return (
    <div style={{
      position: 'absolute',
      inset: '88px 0 0 176px',
      padding: '28px 32px 32px',
      display: 'grid',
      gridTemplateColumns: '1.1fr 1fr 0.85fr',
      gridTemplateRows: '1fr 1fr',
      gap: 20,
    }}>
      {/* Map card — spans 2 rows */}
      <OEMCard
        title="Mini Harita"
        eyebrow="Navigasyon"
        action={
          <button className="oem-btn ghost" onClick={onOpenFullMap} style={{ padding: '8px 14px', fontSize: 12, minHeight: 36, whiteSpace: 'nowrap', flexShrink: 0 }}>
            <Maximize size={14} /> BÜYÜT
          </button>
        }
        style={{ gridRow: '1 / 3' }}
      >
        {/* Fill inner area — use negative margins to remove OEMCard padding around map */}
        <div style={{ position: 'relative', height: '100%', margin: '-20px -28px -24px', borderRadius: '0 0 var(--r-lg) var(--r-lg)', overflow: 'hidden' }}>
          <MiniMapWidget hideHeader hideOverlay />
          {/* GPS locked badge */}
          <div style={{ position: 'absolute', right: 20, top: 20 }}>
            <LiveTag>GPS Kilitli</LiveTag>
          </div>
          {/* Destination shortcuts bottom-left */}
          <div style={{ position: 'absolute', left: 16, bottom: 20, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 5 }}>
            <ShortcutTile icon={<Home size={15} />} label="Ev" sub="14 dk · 8,2 km" />
            <ShortcutTile icon={<Briefcase size={15} />} label="Ofis" sub="22 dk · 13 km" />
          </div>
          {/* Map controls bottom-right */}
          <div style={{ position: 'absolute', right: 20, bottom: 20, display: 'flex', gap: 8 }}>
            <button className="oem-btn ghost icon" aria-label="Pusula" style={{ width: 44, height: 44 }}>
              <Compass size={16} />
            </button>
            <button className="oem-btn ghost icon" aria-label="uzaklaş" style={{ width: 44, height: 44 }}>
              <Minus size={16} />
            </button>
            <button className="oem-btn ghost icon" aria-label="yakınlaş" style={{ width: 44, height: 44 }}>
              <Plus size={16} />
            </button>
          </div>
        </div>
      </OEMCard>

      {/* Drive Core — spans 2 rows */}
      <div style={{ gridRow: '1 / 3' }}>
        <DriveCoreCard />
      </div>

      {/* Media — top right */}
      <MediaTile />

      {/* Climate — bottom right */}
      <ClimateTile />
    </div>
  );
}

// ────────────────────────────────────────────────────────
//  DefrostIcon — rear window defrost
// ────────────────────────────────────────────────────────
function DefrostIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 8h18M3 12h18M3 16h18" />
      <path d="M7 5l2 3M12 5v3M17 5l-2 3" />
    </svg>
  );
}

// ────────────────────────────────────────────────────────
//  ShortcutTile — destination quick access on map
// ────────────────────────────────────────────────────────
function ShortcutTile({ icon, label, sub }: { icon: React.ReactNode; label: string; sub: string }) {
  return (
    <button style={{
      appearance: 'none', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px', borderRadius: 14,
      background: 'rgba(10, 8, 6, 0.78)',
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
      border: '1px solid rgba(232,200,140,0.22)',
      minWidth: 168,
    }}>
      <span style={{
        width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center',
        background: 'linear-gradient(135deg, oklch(74% 0.09 248 / 0.22), oklch(56% 0.10 250 / 0.08))',
        color: 'var(--amber)', flexShrink: 0,
      }}>{icon}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{label}</div>
        <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 2 }}>{sub}</div>
      </div>
    </button>
  );
}

// ────────────────────────────────────────────────────────
//  LaneArrow — single lane indicator
// ────────────────────────────────────────────────────────
function LaneArrow({ dir, active }: { dir: 'left' | 'straight' | 'right'; active?: boolean }) {
  return (
    <div style={{
      width: 46, height: 46, borderRadius: 12, display: 'grid', placeItems: 'center', flexShrink: 0,
      background: active
        ? 'linear-gradient(180deg, oklch(74% 0.09 248 / 0.32), oklch(56% 0.10 250 / 0.12))'
        : 'rgba(255,255,255,0.04)',
      border: `1px solid ${active ? 'var(--line-warm)' : 'var(--line)'}`,
      color: active ? 'var(--amber)' : 'var(--ink-3)',
      filter: active ? 'drop-shadow(0 0 8px oklch(70% 0.10 248 / 0.40))' : 'none',
    }}>
      {dir === 'left'     && <ArrowLeft size={20} />}
      {dir === 'straight' && <ArrowUp size={20} />}
      {dir === 'right'    && <ArrowRight size={20} />}
    </div>
  );
}

// ────────────────────────────────────────────────────────
//  RouteOption — selectable route alternative
// ────────────────────────────────────────────────────────
function RouteOption({ index, label, time, dist, active, onSelect }: {
  index: number; label: string; time: string; dist: string; active?: boolean; onSelect?: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      style={{
        appearance: 'none', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '11px 13px', borderRadius: 12,
        background: active
          ? 'linear-gradient(180deg, oklch(74% 0.09 248 / 0.20), oklch(56% 0.10 250 / 0.08))'
          : 'rgba(255,255,255,0.03)',
        border: `1px solid ${active ? 'var(--line-warm)' : 'var(--line)'}`,
        transition: 'background 0.18s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 999, display: 'grid', placeItems: 'center',
          background: active ? 'var(--amber)' : 'rgba(255,255,255,0.08)',
          color: active ? '#1a1207' : 'var(--ink-3)',
          fontSize: 11, fontWeight: 700, flexShrink: 0,
        }}>{index + 1}</span>
        <span style={{ fontSize: 13, color: active ? 'var(--ink)' : 'var(--ink-2)', fontWeight: active ? 600 : 400 }}>{label}</span>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="oem-num" style={{ fontSize: 13, color: active ? 'var(--ink)' : 'var(--ink-2)', fontWeight: 600 }}>{time}</div>
        <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>{dist}</div>
      </div>
    </button>
  );
}

// ────────────────────────────────────────────────────────
//  LayerToggle — map layer on/off toggle row
// ────────────────────────────────────────────────────────
function LayerToggle({ label, active, onToggle }: { label: string; active?: boolean; onToggle?: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        appearance: 'none', fontFamily: 'inherit', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 2px', background: 'none', border: 'none',
        borderBottom: '1px solid var(--line)', color: active ? 'var(--ink)' : 'var(--ink-3)',
        width: '100%', transition: 'color 0.18s',
      }}
    >
      <span style={{ fontSize: 13 }}>{label}</span>
      <span style={{
        width: 38, height: 22, borderRadius: 999, flexShrink: 0,
        background: active ? 'oklch(64% 0.12 250)' : 'rgba(255,255,255,0.12)',
        position: 'relative', display: 'block',
        transition: 'background 0.2s',
        boxShadow: active ? '0 0 8px oklch(64% 0.12 250 / 0.45)' : 'none',
      }}>
        <span style={{
          position: 'absolute', top: 4, left: active ? 18 : 4,
          width: 14, height: 14, borderRadius: 999,
          background: '#fff', transition: 'left 0.2s',
        }} />
      </span>
    </button>
  );
}

// ────────────────────────────────────────────────────────
//  Maximize icon (not in lucide tree shake)
// ────────────────────────────────────────────────────────
function Maximize({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

// ────────────────────────────────────────────────────────
//  NavigationScreen — full map + glass overlays
// ────────────────────────────────────────────────────────
function NavigationScreen({ onBack }: { onBack: () => void }) {
  const [layers,     setLayers]     = useState({ traffic: true, alerts: true, fuel: false });
  const [searchQ,    setSearchQ]    = useState('');
  const [results,    setResults]    = useState<GeoResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const location = useGPSLocation();
  const nav      = useNavigation();
  const route    = useRouteState();

  // Current turn step
  const currentStep = route.steps[route.currentStepIndex] ?? null;
  const nextStep    = route.steps[route.currentStepIndex + 1] ?? null;

  // Turn card display values
  const turnInstruction = currentStep?.instruction
    ?? (nav.destination ? 'Güzergah hesaplanıyor…' : 'Hedef seçin');
  const turnStreet = currentStep?.streetName ?? nav.destination?.name ?? '';
  const turnDist   = route.distanceToNextTurnMeters > 0
    ? route.distanceToNextTurnMeters < 1000
      ? `${Math.round(route.distanceToNextTurnMeters)} m sonra`
      : `${(route.distanceToNextTurnMeters / 1000).toFixed(1)} km sonra`
    : nav.destination ? 'Başlatmaya hazır' : '—';

  // ETA strip — prefer live nav values, fall back to route totals
  const _totalSec  = route.totalDurationSeconds;
  const _totalM    = route.totalDistanceMeters;
  const etaSec     = nav.etaSeconds   ?? (_totalSec > 0 ? _totalSec : null);
  const distM      = nav.distanceMeters ?? (_totalM  > 0 ? _totalM  : null);

  const displayArrival = etaSec != null ? (() => {
    const d = new Date(Date.now() + etaSec * 1000);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  })() : null;
  const displayMin  = etaSec  != null ? `${Math.round(etaSec / 60)} dk` : null;
  const displayKm   = distM   != null
    ? distM >= 1000 ? `${(distM / 1000).toFixed(1)}` : `${Math.round(distM)}`
    : null;
  const displayUnit = distM   != null && distM < 1000 ? 'm' : 'km';

  // Alternatives — only visible after route fetch
  const altLabels = ['Hızlı Yol', 'En Kısa', 'Az Trafikli'];
  const hasAlts   = route.altDistances.length > 0;

  // Search debounce
  const onSearchChange = (q: string) => {
    setSearchQ(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); setSearchOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      const res = await geocodeAddress(q, location?.latitude, location?.longitude);
      setResults(res);
      setSearchOpen(res.length > 0);
    }, 350);
  };

  const onSelectResult = (r: GeoResult) => {
    setSearchQ(r.name);
    setResults([]);
    setSearchOpen(false);
    const addr: Address = { id: r.id, name: r.name, latitude: r.lat, longitude: r.lng, type: 'history' };
    startNavigation(addr, r.source === 'offline');
    if (location) {
      void fetchRoute(location.latitude, location.longitude, r.lat, r.lng);
    }
  };

  const onStart = () => {
    if (nav.destination) activateNavigation();
  };

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  return (
    <div style={{ position: 'absolute', inset: '88px 0 0 176px' }}>
      {/* Full-size live map */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <MiniMapWidget hideHeader hideOverlay />
      </div>

      {/* Top search bar */}
      <div style={{ position: 'absolute', top: 16, left: 16, right: 16, display: 'flex', gap: 10, zIndex: 20 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <div className="oem-glass" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
            <Search size={15} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
            <input
              value={searchQ}
              onChange={e => onSearchChange(e.target.value)}
              onFocus={() => results.length > 0 && setSearchOpen(true)}
              placeholder="Adres, mekân veya kategori ara"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--ink)', fontSize: 14,
              }}
            />
          </div>
          {searchOpen && results.length > 0 && (
            <div className="oem-glass" style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
              padding: '4px 0', zIndex: 30, maxHeight: 200, overflowY: 'auto',
            }}>
              {results.map(r => (
                <button
                  key={r.id}
                  onClick={() => onSelectResult(r)}
                  style={{
                    width: '100%', textAlign: 'left', background: 'none', border: 'none',
                    padding: '8px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 1,
                  }}
                >
                  <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>{r.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{r.fullName}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="oem-btn ghost icon" onClick={onBack} aria-label="Geri" style={{ flexShrink: 0 }}>
          <ArrowLeft size={18} />
        </button>
      </div>

      {/* Left: turn-by-turn + lane guidance */}
      <div style={{ position: 'absolute', left: 16, top: 84, width: 320, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 10 }}>
        {/* Turn card */}
        <div className="oem-glass" style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'linear-gradient(135deg, oklch(74% 0.09 248 / 0.28), oklch(56% 0.10 250 / 0.10))',
              border: '1px solid var(--line-warm)',
              display: 'grid', placeItems: 'center', color: 'var(--amber)',
              boxShadow: '0 0 16px oklch(64% 0.09 248 / 0.18)',
              flexShrink: 0,
            }}>
              <Navigation size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="oem-eyebrow" style={{ fontSize: 10 }}>{turnDist}</div>
              <h3 style={{ fontSize: 20, marginTop: 2, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{turnInstruction}</h3>
            </div>
          </div>
          {turnStreet && (
            <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{turnStreet}</div>
          )}
          {nextStep && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
              <MapPin size={11} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Sonra {nextStep.instruction}</span>
            </div>
          )}
        </div>

        {/* Lane guidance */}
        <div className="oem-glass" style={{ padding: '10px 14px' }}>
          <div className="oem-eyebrow" style={{ marginBottom: 8, fontSize: 10 }}>Şerit Yönlendirme</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <LaneArrow dir="left" />
            <LaneArrow dir="straight" active />
            <LaneArrow dir="straight" active />
            <LaneArrow dir="right" />
          </div>
        </div>
      </div>

      {/* Right: route alternatives (only after route fetch) + layer toggles */}
      <div style={{ position: 'absolute', right: 16, top: 84, width: 272, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 10 }}>
        {hasAlts && (
          <div className="oem-glass" style={{ padding: '12px 14px' }}>
            <div className="oem-eyebrow" style={{ marginBottom: 8, fontSize: 10 }}>Alternatifler</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {route.altDistances.map((dist, i) => {
                const dur      = route.altDurations[i] ?? 0;
                const realIdx  = route.altRealIndices[i] ?? i;
                const isActive = route.selectedAltIndex === realIdx;
                return (
                  <RouteOption
                    key={i}
                    index={i}
                    label={altLabels[i] ?? `Güzergah ${i + 1}`}
                    time={`${Math.round(dur / 60)} dk`}
                    dist={dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`}
                    active={isActive}
                    onSelect={() => selectAltRoute(realIdx)}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Layer toggles */}
        <div className="oem-glass" style={{ padding: '12px 14px' }}>
          <div className="oem-eyebrow" style={{ marginBottom: 8, fontSize: 10 }}>Katmanlar</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <LayerToggle label="Trafik" active={layers.traffic} onToggle={() => setLayers(l => ({ ...l, traffic: !l.traffic }))} />
            <LayerToggle label="Uyarılar" active={layers.alerts} onToggle={() => setLayers(l => ({ ...l, alerts: !l.alerts }))} />
            <LayerToggle label="Yakıt İstasyonları" active={layers.fuel} onToggle={() => setLayers(l => ({ ...l, fuel: !l.fuel }))} />
          </div>
        </div>
      </div>

      {/* Bottom ETA strip */}
      <div className="oem-glass" style={{
        position: 'absolute', left: 16, right: 16, bottom: 16,
        padding: '12px 22px', display: 'flex', alignItems: 'center', gap: 22, zIndex: 10,
      }}>
        <div>
          <div className="oem-eyebrow" style={{ fontSize: 10 }}>Varış</div>
          <div className="oem-num" style={{ fontSize: 26, fontWeight: 300, marginTop: 2, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
            {displayArrival ?? '—:—'}
          </div>
        </div>
        <div style={{ width: 1, height: 32, background: 'var(--line-strong)' }} />
        <div>
          <div className="oem-eyebrow" style={{ fontSize: 10 }}>Mesafe</div>
          <div className="oem-num" style={{ fontSize: 26, fontWeight: 300, marginTop: 2, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
            {displayKm ?? '—'}
            {displayKm && <span style={{ fontSize: 13, color: 'var(--ink-3)', marginLeft: 3 }}>{displayUnit}</span>}
          </div>
        </div>
        <div style={{ width: 1, height: 32, background: 'var(--line-strong)' }} />
        <div>
          <div className="oem-eyebrow" style={{ fontSize: 10 }}>Tahmini</div>
          <div className="oem-num" style={{ fontSize: 26, fontWeight: 300, marginTop: 2, letterSpacing: '-0.02em', color: 'var(--good)' }}>
            {displayMin ?? '— dk'}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          className="oem-btn"
          onClick={onStart}
          disabled={!nav.destination}
          style={{
            background: nav.destination
              ? 'linear-gradient(180deg, oklch(64% 0.13 250), oklch(52% 0.13 252))'
              : 'rgba(255,255,255,0.05)',
            color: nav.destination ? '#f4f6fb' : 'var(--ink-3)',
            borderColor: nav.destination ? 'oklch(60% 0.12 250)' : 'var(--line)',
            fontWeight: 700, padding: '11px 22px',
            boxShadow: nav.destination ? '0 6px 20px oklch(56% 0.12 252 / 0.38)' : 'none',
            opacity: nav.destination ? 1 : 0.5,
          }}
        >
          <Navigation size={14} /> BAŞLAT
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
//  SettingsScreen — wraps existing SettingsPage
// ────────────────────────────────────────────────────────
function SettingsScreen({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ position: 'absolute', inset: '88px 0 0 176px', display: 'flex', flexDirection: 'column' }}>
      {/* Header bar */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 16,
        padding: '16px 28px', borderBottom: '1px solid var(--line)',
        background: 'linear-gradient(180deg, var(--chrome-bg-strong), transparent)',
      }}>
        <button className="oem-btn ghost icon" onClick={onBack} aria-label="Geri" style={{ width: 44, height: 44 }}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="oem-eyebrow">Sistem</div>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Ayarlar</h2>
        </div>
      </div>
      {/* SettingsPage content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Suspense fallback={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <span style={{ color: 'var(--ink-3)' }}>Yükleniyor...</span>
          </div>
        }>
          <SettingsPage />
        </Suspense>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
//  MediaScreenWrapper — header + real MediaScreen
//  (full Tab nav + sources + library from ../media/MediaScreen)
// ────────────────────────────────────────────────────────
function MediaScreenWrapper({ onBack }: { onBack: () => void }) {
  const defaultMusic = useStore(s => s.settings.defaultMusic) as MusicOptionKey;
  return (
    <div style={{ position: 'absolute', inset: '88px 0 0 176px', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 16,
        padding: '16px 28px', borderBottom: '1px solid var(--line)',
        background: 'linear-gradient(180deg, var(--chrome-bg-strong), transparent)',
      }}>
        <button className="oem-btn ghost icon" onClick={onBack} aria-label="Geri" style={{ width: 44, height: 44 }}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="oem-eyebrow">Medya Oynatıcı</div>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Müzik</h2>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Suspense fallback={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <span style={{ color: 'var(--ink-3)' }}>Müzik yükleniyor...</span>
          </div>
        }>
          <MediaScreenReal defaultMusic={defaultMusic} />
        </Suspense>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
//  TelemetryScreenWrapper — header + real TelemetryView
// ────────────────────────────────────────────────────────
function TelemetryScreenWrapper({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ position: 'absolute', inset: '88px 0 0 176px', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 16,
        padding: '16px 28px', borderBottom: '1px solid var(--line)',
        background: 'linear-gradient(180deg, var(--chrome-bg-strong), transparent)',
      }}>
        <button className="oem-btn ghost icon" onClick={onBack} aria-label="Geri" style={{ width: 44, height: 44 }}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="oem-eyebrow">OBD-II</div>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Araç Telemetrisi</h2>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <LiveTag>Canlı</LiveTag>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <TelemetryView />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
//  SplitScreen — map + telemetry side by side
// ────────────────────────────────────────────────────────
function SplitScreen({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ position: 'absolute', inset: '88px 0 0 176px', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 16,
        padding: '16px 28px', borderBottom: '1px solid var(--line)',
        background: 'linear-gradient(180deg, var(--chrome-bg-strong), transparent)',
      }}>
        <button className="oem-btn ghost icon" onClick={onBack} aria-label="Geri" style={{ width: 44, height: 44 }}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="oem-eyebrow">Bölünmüş Görünüm</div>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Sürüş Modu</h2>
        </div>
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, padding: '20px 28px 24px' }}>
        {/* Map half */}
        <div className="oem-card" style={{ overflow: 'hidden', padding: 0 }}>
          <MiniMapWidget hideHeader hideOverlay />
        </div>
        {/* Drive core half */}
        <DriveCoreCard />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
//  Root OEMCockpitLayout
// ────────────────────────────────────────────────────────
export function OEMCockpitLayout({ onOpenFullMap, onOpenSettings: _onOpenSettings }: OEMCockpitLayoutProps) {
  const [screen, setScreen] = useState<OEMScreen>('cockpit');
  const [quickOpen, setQuickOpen] = useState(false);
  const dayNightMode = useStore(s => s.settings.dayNightMode);
  const handleScreen = useCallback((s: OEMScreen) => {
    setScreen(s);
  }, []);

  return (
    <div
      data-theme={dayNightMode === 'day' ? 'pro-day' : undefined}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: 'radial-gradient(140% 90% at 50% 0%, #1A2030 0%, #131822 50%, #0B0E15 100%)',
        overflow: 'hidden',
        isolation: 'isolate',
        fontFamily: "'Manrope', system-ui, sans-serif",
        color: 'var(--ink)',
      }}>
      {/* ── Ambient layers ── */}
      {/* Windshield glow + A-pillars */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
        background:
          'radial-gradient(80% 50% at 50% -8%, oklch(64% 0.07 230 / 0.32), transparent 65%),' +
          'radial-gradient(40% 40% at 8% 4%, oklch(70% 0.08 220 / 0.18), transparent 70%),' +
          'radial-gradient(40% 40% at 92% 4%, oklch(70% 0.08 220 / 0.16), transparent 70%),' +
          'radial-gradient(45% 80% at -4% 45%, oklch(64% 0.08 240 / 0.16), transparent 65%),' +
          'radial-gradient(45% 80% at 104% 45%, oklch(64% 0.08 240 / 0.16), transparent 65%)',
      }} />

      {/* Warm floor wash */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: 480,
        pointerEvents: 'none',
        background:
          'radial-gradient(60% 80% at 50% 100%, oklch(64% 0.09 242 / 0.26), transparent 60%),' +
          'radial-gradient(120% 100% at 50% 100%, oklch(54% 0.08 244 / 0.14), transparent 70%),' +
          'linear-gradient(to top, oklch(44% 0.07 246 / 0.20), transparent 75%)',
        opacity: 0.85,
        zIndex: 1,
      }} />

      {/* Side door glow */}
      <div style={{
        position: 'absolute', top: 88, bottom: 0, left: 0, right: 0,
        pointerEvents: 'none', zIndex: 1,
        background:
          'linear-gradient(90deg, oklch(60% 0.08 242 / 0.16), transparent 8%, transparent 92%, oklch(60% 0.08 242 / 0.16)),' +
          'radial-gradient(8% 60% at 0% 50%, oklch(64% 0.09 242 / 0.24), transparent),' +
          'radial-gradient(8% 60% at 100% 50%, oklch(64% 0.09 242 / 0.24), transparent)',
        opacity: 0.55,
        mixBlendMode: 'screen',
      }} />

      {/* Top metal edge */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(228,236,248,0.18) 30%, rgba(228,236,248,0.18) 70%, transparent)',
        zIndex: 2, pointerEvents: 'none',
      }} />

      {/* Dashboard rim top */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 16,
        zIndex: 50, pointerEvents: 'none',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.35) 60%, transparent 100%)',
      }} />
      {/* Dashboard rim bottom */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 12,
        zIndex: 50, pointerEvents: 'none',
        background: 'linear-gradient(0deg, rgba(0,0,0,0.60) 0%, rgba(0,0,0,0.15) 70%, transparent 100%)',
      }} />

      {/* Film grain */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        opacity: 0.45, mixBlendMode: 'overlay', zIndex: 3,
        backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
      }} />

      {/* Warm trim under status strip */}
      <div style={{
        position: 'absolute', top: 88, left: 0, right: 0, height: 24,
        background: 'linear-gradient(180deg, oklch(66% 0.08 242 / 0.08), transparent)',
        pointerEvents: 'none', zIndex: 8,
      }} />

      {/* ── Chrome ── */}
      <StatusStrip screen={screen} onScreen={handleScreen} />
      <SideRail screen={screen} onScreen={handleScreen} onQuickControls={() => setQuickOpen(v => !v)} />

      {/* ── Screen content ── */}
      {screen === 'cockpit'    && <CockpitScreen onOpenFullMap={onOpenFullMap} />}
      {screen === 'navigation' && <NavigationScreen onBack={() => setScreen('cockpit')} />}
      {screen === 'settings'   && <SettingsScreen onBack={() => setScreen('cockpit')} />}
      {screen === 'media'      && <MediaScreenWrapper onBack={() => setScreen('cockpit')} />}
      {screen === 'telemetry'  && <TelemetryScreenWrapper onBack={() => setScreen('cockpit')} />}
      {screen === 'split'      && <SplitScreen onBack={() => setScreen('cockpit')} />}

      {/* Quick controls overlay — full QuickControlsOverlay (ZoneTile/SeatTile/ActionTile/Ambient) */}
      {quickOpen && (
        <QuickControlsOverlay onClose={() => setQuickOpen(false)} />
      )}
    </div>
  );
}
