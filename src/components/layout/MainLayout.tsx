import { useState, useEffect, useCallback, useRef, memo, type ReactNode } from 'react';
import {
  Wifi, Bluetooth, Battery, BatteryCharging,
  MapPin, SkipBack, SkipForward, Play, Pause,
  LayoutGrid, SlidersHorizontal,
} from 'lucide-react';
import AppGrid from '../apps/AppGrid';
import { SettingsPage, type Settings } from '../settings/SettingsPage';
import {
  APP_MAP,
  NAV_OPTIONS, MUSIC_OPTIONS,
  type NavOptionKey, type MusicOptionKey,
} from '../../data/apps';
import { openApp } from '../../platform/appLauncher';
import { useDeviceStatus } from '../../platform/deviceApi';
import {
  useMediaState,
  togglePlayPause, next, previous, fmtTime, pause, play,
} from '../../platform/mediaService';
import { toIntent, routeIntent } from '../../platform/intentEngine';
import { registerCommandHandler } from '../../platform/voiceService';
import type { ParsedCommand } from '../../platform/commandParser';
import {
  useSmartEngine, trackLaunch,
  type DrivingMode,
} from '../../platform/smartEngine';
import { initializeAddressBook } from '../../platform/addressBookService';
import {
  getPerformanceMode, onPerformanceModeChange,
  type PerformanceMode,
} from '../../platform/performanceMode';

/* ── Constants ───────────────────────────────────────────── */

const DEFAULT_SETTINGS: Settings = {
  brightness: 80,
  volume: 60,
  theme: 'dark',
  themePack: 'tesla',
  use24Hour: true,
  showSeconds: false,
  clockStyle: 'digital',
  gridColumns: 3,
  defaultNav: 'maps',
  defaultMusic: 'spotify',
  sleepMode: false,
  widgetOrder: ['hero'],
  widgetVisible: { hero: true },
};

/* ── Persistence ─────────────────────────────────────────── */

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

/* ── Boot splash ─────────────────────────────────────────── */

type BootPhase = 'show' | 'fade' | 'done';

const SteeringWheel = memo(function SteeringWheel({ size = 48 }: { size?: number }) {
  const cx = size / 2, cy = size / 2, r = size * 0.42;
  const hub = size * 0.11;
  const sw  = size * 0.055;
  const spoke = (angleDeg: number, inner: boolean) => {
    const rad  = (angleDeg - 90) * (Math.PI / 180);
    const dist = inner ? hub * 1.3 : r;
    return { x: cx + dist * Math.cos(rad), y: cy + dist * Math.sin(rad) };
  };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx={cx} cy={cy} r={r} stroke="#3b82f6" strokeWidth={sw * 0.6} opacity="0.2" />
      <circle cx={cx} cy={cy} r={r} stroke="#3b82f6" strokeWidth={sw * 0.5} />
      <circle cx={cx} cy={cy} r={hub} fill="#3b82f6" />
      {[0, 120, 240].map((a) => {
        const from = spoke(a, true);
        const to   = spoke(a, false);
        return <line key={a} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#3b82f6" strokeWidth={sw * 0.6} strokeLinecap="round" />;
      })}
    </svg>
  );
});

const BootSplash = memo(function BootSplash({ phase }: { phase: BootPhase }) {
  if (phase === 'done') return null;
  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-300 pointer-events-none ${
        phase === 'fade' ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ background: '#060d1a' }}
    >
      <div className="flex flex-col items-center mb-10 select-none">
        <div className="relative mb-5">
          <div className="absolute inset-0 bg-blue-500/15 rounded-full blur-xl scale-150" />
          <SteeringWheel size={64} />
        </div>
        <div className="text-xl font-bold tracking-[0.2em] uppercase text-white">Car Launcher</div>
        <div className="text-[11px] font-semibold tracking-[0.45em] uppercase text-blue-500 mt-1">Pro</div>
        <div className="text-[9px] font-medium tracking-[0.3em] uppercase text-slate-600 mt-2">Araç Kontrol Merkezi</div>
      </div>
      <div className="w-28 h-px bg-white/5 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500 rounded-full animate-boot-bar" />
      </div>
    </div>
  );
});

/* ── Clock hook ──────────────────────────────────────────── */

const DAYS_TR   = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

function buildTimeStr(d: Date, use24Hour: boolean, showSeconds: boolean): string {
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  if (!use24Hour) {
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return showSeconds ? `${h}:${m}:${s} ${ampm}` : `${h}:${m} ${ampm}`;
  }
  return showSeconds
    ? `${h.toString().padStart(2, '0')}:${m}:${s}`
    : `${h.toString().padStart(2, '0')}:${m}`;
}

function buildDateStr(d: Date): string {
  return `${DAYS_TR[d.getDay()]}, ${d.getDate()} ${MONTHS_TR[d.getMonth()]}`;
}

function useClock(use24Hour: boolean, showSeconds: boolean) {
  const [time, setTime] = useState(() => buildTimeStr(new Date(), use24Hour, showSeconds));
  const [date, setDate] = useState(() => buildDateStr(new Date()));

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(buildTimeStr(now, use24Hour, showSeconds));
      setDate(buildDateStr(now));
    };
    tick();
    const id = setInterval(tick, showSeconds ? 1000 : 10000);
    return () => clearInterval(id);
  }, [use24Hour, showSeconds]);

  return { time, date };
}

function useAnalogClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return {
    hours: now.getHours() % 12,
    minutes: now.getMinutes(),
    seconds: now.getSeconds(),
  };
}

/* ── AnalogClock ──────────────────────────────────────────── */

const AnalogClock = memo(function AnalogClock({
  size = 200,
  hours,
  minutes,
  seconds,
  showSeconds,
}: {
  size?: number;
  hours: number;
  minutes: number;
  seconds: number;
  showSeconds: boolean;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42;
  const hourAngle = (hours + minutes / 60) * 30;
  const minuteAngle = (minutes + seconds / 60) * 6;
  const secondAngle = seconds * 6;

  const Hand = ({ angle, length, width, color }: { angle: number; length: number; width: number; color: string }) => {
    const rad = (angle - 90) * (Math.PI / 180);
    const x2 = cx + length * Math.cos(rad);
    const y2 = cy + length * Math.sin(rad);
    return <line x1={cx} y1={cy} x2={x2} y2={y2} stroke={color} strokeWidth={width} strokeLinecap="round" />;
  };

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Face circle */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />

      {/* Hour marks */}
      {[...Array(12)].map((_, i) => {
        const angle = i * 30;
        const rad = (angle - 90) * (Math.PI / 180);
        const isBig = i % 3 === 0;
        const start = r * (isBig ? 0.85 : 0.88);
        const end = r * (isBig ? 1 : 0.95);
        const x1 = cx + (start) * Math.cos(rad);
        const y1 = cy + (start) * Math.sin(rad);
        const x2 = cx + (end) * Math.cos(rad);
        const y2 = cy + (end) * Math.sin(rad);
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={isBig ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)"}
            strokeWidth={isBig ? 1.5 : 0.8}
            strokeLinecap="round"
          />
        );
      })}

      {/* Hour hand */}
      <Hand angle={hourAngle} length={r * 0.5} width={2.5} color="rgba(255,255,255,0.9)" />

      {/* Minute hand */}
      <Hand angle={minuteAngle} length={r * 0.72} width={1.5} color="rgba(255,255,255,0.7)" />

      {/* Second hand with glow */}
      {showSeconds && (
        <g filter="drop-shadow(0 0 6px rgba(59,130,246,0.5))">
          <Hand angle={secondAngle} length={r * 0.85} width={1} color="#3b82f6" />
        </g>
      )}

      {/* Center dot */}
      <circle cx={cx} cy={cy} r="3" fill="white" />
    </svg>
  );
});

/* ── ClockArea ───────────────────────────────────────────── */

const ClockArea = memo(function ClockArea({
  use24Hour,
  showSeconds,
  clockStyle,
}: {
  use24Hour: boolean;
  showSeconds: boolean;
  clockStyle: 'digital' | 'analog';
}) {
  const { time, date } = useClock(use24Hour, showSeconds);
  const analogClock = useAnalogClock();

  if (clockStyle === 'analog') {
    return (
      <div className="flex items-center gap-4">
        <AnalogClock
          size={52}
          hours={analogClock.hours}
          minutes={analogClock.minutes}
          seconds={analogClock.seconds}
          showSeconds={showSeconds}
        />
        <div className="flex flex-col gap-1">
          <span className="text-slate-400 text-sm font-medium">{time}</span>
          <span className="text-slate-600 text-xs tracking-wide">{date}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-baseline gap-3">
      <div className="text-[28px] font-semibold leading-none text-white tabular-nums tracking-tight" style={{ textShadow: '0 0 30px rgba(255,255,255,0.06)' }}>
        {time}
      </div>
      <div className="text-xs font-medium tracking-wide text-slate-500">
        {date}
      </div>
    </div>
  );
});

/* ── DeviceStatusBar ─────────────────────────────────────── */

const StatusPill = memo(function StatusPill({
  icon: Icon,
  label,
  active,
}: {
  icon: typeof Wifi;
  label: string;
  active: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors duration-200 border ${
        active ? 'bg-white/[0.07] border-white/[0.08] text-white' : 'bg-white/[0.03] border-white/[0.05] text-slate-600'
      }`}
    >
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${active ? 'text-blue-400' : 'text-slate-600'}`} />
      <span className="truncate max-w-[80px]">{label}</span>
    </div>
  );
});

const DeviceStatusBar = memo(function DeviceStatusBar() {
  const s = useDeviceStatus();

  if (!s.ready) {
    return (
      <div className="flex items-center gap-2">
        {[56, 72, 48].map((w, i) => (
          <div key={i} className="h-7 rounded-full bg-white/5 animate-pulse" style={{ width: w }} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <StatusPill
        icon={Bluetooth}
        label={s.btConnected ? (s.btDevice || 'BT') : 'Bluetooth'}
        active={s.btConnected}
      />
      <StatusPill
        icon={Wifi}
        label={s.wifiConnected ? (s.wifiName || 'Wi-Fi') : 'Wi-Fi'}
        active={s.wifiConnected}
      />
      <StatusPill
        icon={s.charging ? BatteryCharging : Battery}
        label={`${s.battery}%`}
        active={s.battery > 20}
      />
    </div>
  );
});

/* ── NavHero ─────────────────────────────────────────────── */

const NavHero = memo(function NavHero({
  defaultNav,
  onLaunch,
  drivingMode,
}: {
  defaultNav:  NavOptionKey;
  onLaunch:    (id: string) => void;
  drivingMode: DrivingMode;
}) {
  const nav = NAV_OPTIONS[defaultNav];

  return (
    <div
      className="flex flex-col rounded-3xl border border-white/[0.08] p-5 overflow-hidden relative min-h-0 w-full h-full"
      style={{ background: 'linear-gradient(165deg, #0c1428 0%, #0a1020 40%, #080e1c 100%)', boxShadow: '0 8px 40px rgba(0,0,0,0.5), 0 0 60px rgba(37,99,235,0.06)' }}
    >
      {/* Ambient glow */}
      <div className="absolute -top-24 -left-24 w-80 h-80 bg-blue-600/[0.12] rounded-full blur-[80px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-56 h-56 bg-blue-500/[0.06] rounded-full blur-[60px] pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/25 flex items-center justify-center flex-shrink-0" style={{ boxShadow: '0 0 12px rgba(59,130,246,0.15)' }}>
            <span className="text-lg leading-none">{nav.icon}</span>
          </div>
          <div>
            <div className="text-blue-400/60 text-[10px] uppercase tracking-[0.2em] font-semibold">Navigasyon</div>
            <div className="text-white text-sm font-semibold">{nav.name}</div>
          </div>
        </div>
        {drivingMode === 'driving' && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25" style={{ boxShadow: '0 0 10px rgba(52,211,153,0.1)' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-emerald-400 text-[9px] font-bold uppercase tracking-widest">Sürüş</span>
          </div>
        )}
      </div>

      {/* Main launch button */}
      <button
        onClick={(e) => { e.stopPropagation(); onLaunch(defaultNav); }}
        className="relative flex flex-col items-center justify-center rounded-2xl overflow-hidden active:scale-[0.97] transition-transform duration-150 gap-3 min-h-0 flex-1"
        style={{ background: 'linear-gradient(145deg, #1e50d8 0%, #2563eb 40%, #1d4ed8 70%, #1a3fb0 100%)', boxShadow: '0 6px 30px rgba(37,99,235,0.3), inset 0 1px 0 rgba(255,255,255,0.08)' }}
      >
        {/* Inner glow overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-white/[0.06] pointer-events-none" />

        <div className="relative flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 bg-white/25 rounded-full blur-2xl scale-[2.5] pointer-events-none" />
            <MapPin className="w-16 h-16 text-white relative" style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.3))' }} />
          </div>
          <div className="text-center">
            <div className="text-white text-3xl font-black tracking-tight" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.3)' }}>Rota Başlat</div>
            <div className="text-blue-100/70 text-sm font-medium mt-1">{nav.name} ile aç</div>
          </div>
        </div>
      </button>
    </div>
  );
});

/* ── MediaPanel ──────────────────────────────────────────── */

const MediaPanel = memo(function MediaPanel({
  defaultMusic,
  onLaunch,
}: {
  defaultMusic: MusicOptionKey;
  onLaunch:     (id: string) => void;
}) {
  const { playing, track } = useMediaState();
  const music = MUSIC_OPTIONS[defaultMusic];
  const pct = track.durationSec > 0 ? (track.positionSec / track.durationSec) * 100 : 0;

  return (
    <div
      className="flex flex-col rounded-3xl border border-white/[0.08] p-5 min-h-0 w-full h-full overflow-hidden relative"
      style={{ background: 'linear-gradient(165deg, #0c1428 0%, #0a1020 40%, #080e1c 100%)', boxShadow: '0 8px 40px rgba(0,0,0,0.5), 0 0 40px rgba(37,99,235,0.04)' }}
    >
      {/* Ambient */}
      <div className="absolute -bottom-20 -right-20 w-56 h-56 bg-blue-600/[0.08] rounded-full blur-[60px] pointer-events-none" />
      <div className="absolute -top-12 -left-12 w-40 h-40 bg-blue-500/[0.04] rounded-full blur-[40px] pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/25 flex items-center justify-center flex-shrink-0" style={{ boxShadow: '0 0 10px rgba(59,130,246,0.1)' }}>
            <span className="text-base leading-none">{music.icon}</span>
          </div>
          <span className="text-blue-400/60 text-[10px] uppercase tracking-[0.2em] font-semibold">Müzik</span>
          {playing && <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
        </div>
        <button onClick={(e) => { e.stopPropagation(); onLaunch(defaultMusic); }} className="text-[11px] text-blue-400 font-semibold hover:text-blue-300 active:text-blue-200 transition-colors duration-150 px-3 py-1.5 rounded-xl hover:bg-blue-400/10 border border-transparent hover:border-blue-500/15">
          Aç →
        </button>
      </div>

      <div className="flex-1 flex flex-col justify-center min-h-0">
        {/* Track info */}
        <div className="text-white font-bold leading-tight truncate text-[1.65rem]" style={{ textShadow: '0 1px 8px rgba(0,0,0,0.3)' }}>{track.title}</div>
        <div className="text-slate-300 mt-1.5 truncate text-sm font-medium">{track.artist}</div>

        {/* Progress bar */}
        <div className="mt-4 mb-4 flex-shrink-0">
          <div className="h-[5px] bg-white/[0.08] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', boxShadow: '0 0 10px rgba(59,130,246,0.5)' }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-slate-500 text-[11px] tabular-nums font-mono">{fmtTime(track.positionSec)}</span>
            <span className="text-slate-500 text-[11px] tabular-nums font-mono">{fmtTime(track.durationSec)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-3 flex-shrink-0">
          <button onClick={(e) => { e.stopPropagation(); previous(); }} className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/[0.05] border border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/[0.1] active:scale-90 transition-[transform,background-color,color] duration-150">
            <SkipBack className="w-5 h-5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); togglePlayPause(); }}
            className="w-14 h-14 flex items-center justify-center rounded-2xl text-white active:scale-95 transition-[transform,background-color] duration-150"
            style={{ background: 'linear-gradient(145deg, #2563eb, #1d4ed8)', boxShadow: '0 4px 20px rgba(37,99,235,0.35), inset 0 1px 0 rgba(255,255,255,0.1)' }}
          >
            {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
          </button>
          <button onClick={(e) => { e.stopPropagation(); next(); }} className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/[0.05] border border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/[0.1] active:scale-90 transition-[transform,background-color,color] duration-150">
            <SkipForward className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
});

/* ── DockShortcuts ───────────────────────────────────────── */

const DockShortcuts = memo(function DockShortcuts({
  dockIds,
  onLaunch,
}: {
  dockIds: string[];
  onLaunch: (id: string) => void;
}) {
  const apps = dockIds.slice(0, 4).map((id) => ({ id, app: APP_MAP[id] })).filter((x) => x.app);

  return (
    <div
      className="flex flex-col rounded-3xl border border-white/[0.08] p-4 h-full overflow-hidden relative"
      style={{ background: 'linear-gradient(165deg, #0c1428 0%, #0a1020 40%, #080e1c 100%)', boxShadow: '0 8px 40px rgba(0,0,0,0.5), 0 0 30px rgba(37,99,235,0.03)' }}
    >
      <div className="absolute -bottom-10 -left-10 w-36 h-36 bg-blue-600/[0.04] rounded-full blur-[40px] pointer-events-none" />
      <div className="text-blue-400/50 text-[10px] uppercase tracking-[0.2em] font-semibold mb-2.5 flex-shrink-0">Hızlı Erişim</div>
      <div className="grid grid-cols-2 gap-2 flex-1 min-h-0">
        {apps.map(({ id, app }) => (
          <button
            key={id}
            onClick={() => onLaunch(id)}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/[0.04] border border-white/[0.07] hover:bg-white/[0.08] hover:border-white/[0.12] active:scale-[0.94] transition-[transform,background-color,border-color] duration-150 min-h-0"
          >
            <span className="text-[1.7rem] leading-none">{app!.icon}</span>
            <span className="text-slate-400 text-[11px] font-medium truncate px-1">{app!.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

/* ── Dock ────────────────────────────────────────────────── */

const Dock = memo(function Dock({
  dockIds,
  onLaunch,
  onOpenApps,
  onOpenSettings,
}: {
  dockIds:        string[];
  onLaunch:       (id: string) => void;
  onOpenApps:     () => void;
  onOpenSettings: () => void;
}) {

  return (
    <div className="flex items-center gap-2 px-5 py-1.5 border-t border-white/[0.06] flex-shrink-0" style={{ background: 'linear-gradient(180deg, rgba(10,16,32,0.6) 0%, rgba(6,13,26,0.8) 100%)' }}>
      {dockIds.map((id) => {
        const app = APP_MAP[id];
        if (!app) return null;
        return (
          <button
            key={id}
            onClick={() => onLaunch(id)}
            className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.1] active:scale-[0.95] transition-[transform,background-color,border-color] duration-150"
          >
            <span className="text-lg leading-none">{app.icon}</span>
            <span className="text-slate-400 text-[10px] font-medium truncate">{app.name}</span>
          </button>
        );
      })}

      <div className="w-px h-6 bg-white/[0.06] mx-0.5 flex-shrink-0" />

      <button
        onClick={onOpenApps}
        className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.1] active:scale-[0.95] transition-[transform,background-color,border-color] duration-150"
      >
        <LayoutGrid className="w-4 h-4 text-slate-500" />
        <span className="text-slate-400 text-[10px] font-medium">Uygulamalar</span>
      </button>

      <button
        onClick={onOpenSettings}
        className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.1] active:scale-[0.95] transition-[transform,background-color,border-color] duration-150"
      >
        <SlidersHorizontal className="w-4 h-4 text-slate-500" />
        <span className="text-slate-400 text-[10px] font-medium">Ayarlar</span>
      </button>
    </div>
  );
});


/* ── DrawerShell ─────────────────────────────────────────── */

const DrawerShell = memo(function DrawerShell({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`fixed inset-0 z-40 transition-opacity duration-200 ${
        open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Sheet */}
      <div
        className={`absolute inset-x-0 bottom-0 h-[85%] rounded-t-3xl flex flex-col bg-[#0b1424] transition-transform duration-200 ease-out ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-12 h-1 bg-white/20 rounded-full" />
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </div>
      </div>
    </div>
  );
});

/* ── SleepOverlay ───────────────────────────────────────── */

const SleepOverlay = memo(function SleepOverlay({
  use24Hour,
  showSeconds,
  clockStyle,
  onWake,
}: {
  use24Hour: boolean;
  showSeconds: boolean;
  clockStyle: 'digital' | 'analog';
  onWake: () => void;
}) {
  const sleepClk = useClock(use24Hour, showSeconds);
  const sleepAnalog = useAnalogClock();

  return (
    <div
      className="sleep-overlay fixed inset-0 z-40 bg-black flex flex-col items-center justify-center cursor-pointer select-none"
      onClick={onWake}
    >
      <div className="absolute w-96 h-96 rounded-full bg-blue-500/[0.04] blur-[100px] pointer-events-none" />
      <div className="relative z-10 pointer-events-none mb-6">
        {clockStyle === 'analog' ? (
          <AnalogClock
            size={240}
            hours={sleepAnalog.hours}
            minutes={sleepAnalog.minutes}
            seconds={sleepAnalog.seconds}
            showSeconds={showSeconds}
          />
        ) : (
          <div className="text-[110px] font-extralight tabular-nums tracking-tight text-white leading-none drop-shadow-[0_0_30px_rgba(255,255,255,0.08)]">
            {sleepClk.time}
          </div>
        )}
      </div>
      <div className="text-slate-600 text-base tracking-[0.35em] uppercase pointer-events-none z-10">
        {sleepClk.date}
      </div>
      <div className="fixed bottom-8 text-slate-800 text-[10px] tracking-[0.4em] pointer-events-none">
        DOKUNUN
      </div>
    </div>
  );
});

/* ── MainLayout ──────────────────────────────────────────── */

type DrawerType = 'none' | 'apps' | 'settings';

export default function MainLayout() {
  const [bootPhase, setBootPhase] = useState<BootPhase>('show');
  const [drawer, setDrawer]       = useState<DrawerType>('none');
  const [favorites, setFavorites] = useState<string[]>(() =>
    load<string[]>('favorites', []).filter((id) => id in APP_MAP)
  );
  const [settings, setSettings] = useState<Settings>(() => ({
    ...DEFAULT_SETTINGS,
    ...load<Partial<Settings>>('settings', {}),
  }));
  const [perfMode, setPerfMode] = useState<PerformanceMode>(() => getPerformanceMode());

  // Smart engine — local AI layer
  const device = useDeviceStatus();
  const smart  = useSmartEngine(
    device,
    favorites,
    settings.defaultNav,
    settings.defaultMusic,
  );

  useEffect(() => {
    const t1 = setTimeout(() => setBootPhase('fade'), 850);
    const t2 = setTimeout(() => setBootPhase('done'), 1150);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // Subscribe to performance mode changes
  useEffect(() => {
    return onPerformanceModeChange(setPerfMode);
  }, []);

  // Initialize address book for navigation
  useEffect(() => {
    initializeAddressBook().catch((err) => {
      console.error('Failed to initialize address book:', err);
    });
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id];
      save('favorites', next);
      return next;
    });
  }, []);

  const handleLaunch = useCallback((id: string) => {
    if (!id) return;
    const app = APP_MAP[id];
    if (!app) return;

    if (app.internalPage === 'settings') {
      setDrawer('settings');
      return;
    }

    trackLaunch(id);
    openApp(app);
    setDrawer('none');
  }, []);

  const updateSettings = useCallback((partial: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      save('settings', next);
      return next;
    });
    // Auto-close settings drawer on theme changes for immediate visual feedback
    if (partial.theme) {
      setTimeout(() => setDrawer('none'), 150);
    }
  }, []);

  const openApps     = useCallback(() => setDrawer('apps'),     []);
  const openSettings = useCallback(() => setDrawer('settings'), []);
  const closeDrawer  = useCallback(() => setDrawer('none'),     []);

  // ── Voice command routing ────────────────────────────────
  // Ref always holds latest closure values — avoids stale deps in the handler
  const voiceCtxRef = useRef({
    settings, smart, handleLaunch, updateSettings, setDrawer,
  });
  useEffect(() => {
    voiceCtxRef.current = { settings, smart, handleLaunch, updateSettings, setDrawer };
  });

  useEffect(() => {
    return registerCommandHandler((cmd: ParsedCommand) => {
      const { settings: s, smart: sm, handleLaunch: launch, updateSettings: update, setDrawer: open } =
        voiceCtxRef.current;

      // Handle vehicle status queries directly (don't need intent routing)
      if (cmd.type === 'vehicle_speed' || cmd.type === 'vehicle_fuel' || cmd.type === 'vehicle_temp') {
        return; // feedback already set by parser, voice state shows success
      }

      // Handle sleep mode toggle directly
      if (cmd.type === 'toggle_sleep_mode') {
        update({ sleepMode: !s.sleepMode });
        return;
      }

      // Build intent from parsed command + current user context
      const intent = toIntent(cmd, {
        defaultNav:   s.defaultNav,
        defaultMusic: s.defaultMusic,
        recentAppId:  sm.quickActions.find((a) => a.id.startsWith('last-'))?.appId,
      });

      // Route through the central action dispatcher
      routeIntent(intent, {
        launch,
        openDrawer: (target) => open(target as DrawerType),
        setTheme:   (theme) => update({ theme }),
        playMedia:  play,
        pauseMedia: pause,
      });
    });
  }, []); // register once — voiceCtxRef keeps values current

  return (
    <div
      data-theme={settings.theme}
      data-drive-state={smart.drivingMode}
      data-performance-mode={perfMode}
      className="flex flex-col h-full w-full overflow-hidden text-white"
      style={{
        background: settings.theme === 'oled' ? '#000' : '#060d1a',
        filter: `brightness(${Math.max(50, Math.min(150, settings.brightness)) / 100})`,
      }}
    >
      <BootSplash phase={bootPhase} />

      {/* Sleep mode overlay */}
      {settings.sleepMode && (
        <SleepOverlay
          use24Hour={settings.use24Hour}
          showSeconds={settings.showSeconds}
          clockStyle={settings.clockStyle}
          onWake={() => updateSettings({ sleepMode: false })}
        />
      )}

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 pt-2.5 pb-1 flex-shrink-0">
        <ClockArea use24Hour={settings.use24Hour} showSeconds={settings.showSeconds} clockStyle={settings.clockStyle} />
        <DeviceStatusBar />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="flex-1 min-h-0 overflow-hidden flex gap-3 px-5 pt-1.5 pb-2.5">
          {/* Left: Navigation — fills full height */}
          <div className="flex-1 min-w-0 min-h-0 flex">
            <NavHero
              defaultNav={settings.defaultNav}
              onLaunch={handleLaunch}
              drivingMode={smart.drivingMode}
            />
          </div>
          {/* Right: Media (top) + Quick Access (bottom) */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-3">
            <div className="flex-[3] min-h-0 flex">
              <MediaPanel
                defaultMusic={settings.defaultMusic}
                onLaunch={handleLaunch}
              />
            </div>
            <div className="flex-[2] min-h-0 flex">
              <DockShortcuts
                dockIds={smart.dockIds}
                onLaunch={handleLaunch}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Dock */}
      <Dock
        dockIds={smart.dockIds}
        onLaunch={handleLaunch}
        onOpenApps={openApps}
        onOpenSettings={openSettings}
      />

      {/* Apps drawer */}
      <DrawerShell open={drawer === 'apps'} onClose={closeDrawer}>
        <AppGrid
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onLaunch={handleLaunch}
          gridColumns={settings.gridColumns}
        />
      </DrawerShell>

      {/* Settings drawer */}
      <DrawerShell open={drawer === 'settings'} onClose={closeDrawer}>
        <SettingsPage settings={settings} onUpdate={updateSettings} />
      </DrawerShell>
    </div>
  );
}
