import { useState, useEffect, useCallback, useRef, memo, type ReactNode, type PointerEvent } from 'react';
import {
  Wifi, Bluetooth, Battery, BatteryCharging,
  MapPin, Map as MapIcon, SkipBack, SkipForward, Play, Pause,
  LayoutGrid, SlidersHorizontal, Check, X,
  Camera, Route, ShieldAlert, Shield, GripVertical, Bell, CloudSun, Smartphone,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { VoiceMicButton } from '../modals/VoiceAssistant';
import { PassengerQRModal } from '../modals/PassengerQRModal';
import { SportModePanel } from '../sport/SportModePanel';
import { SecuritySuite } from '../security/SecuritySuite';
import { EntertainmentPortal, BreakAlertOverlay } from '../entertainment/EntertainmentPortal';
import { SplitScreen } from '../split/SplitScreen';
import { RearViewCamera } from '../camera/RearViewCamera';
import { enableWakeWord, disableWakeWord, useWakeWordState } from '../../platform/wakeWordService';
import { startTrafficService, updateTrafficLocation, useTrafficState, TRAFFIC_COLORS } from '../../platform/trafficService';
import { initializeContacts } from '../../platform/contactsService';
import {
  startAutoBrightness,
  stopAutoBrightness,
  updateAutoBrightnessLocation,
  useAutoBrightnessState,
} from '../../platform/autoBrightnessService';
import { FullMapView } from '../map/FullMapView';
import { MiniMapWidget } from '../map/MiniMapWidget';
import AppGrid from '../apps/AppGrid';
import { SettingsPage } from '../settings/SettingsPage';
import { OBDPanel } from '../obd/OBDPanel';
import { DigitalCluster } from '../obd/DigitalCluster';
import { DTCPanel } from '../obd/DTCPanel';
import { DashcamView } from '../dashcam/DashcamView';
import { TripLogView } from '../trip/TripLogView';
import { NotificationCenter } from '../notifications/NotificationCenter';
import { WeatherWidget } from '../weather/WeatherWidget';
import { startTripLog } from '../../platform/tripLogService';
import {
  startNotificationService, stopNotificationService,
  useNotificationState,
} from '../../platform/notificationService';
import {
  startWeatherService, stopWeatherService,
} from '../../platform/weatherService';
import {
  NAV_OPTIONS, MUSIC_OPTIONS,
  type NavOptionKey, type MusicOptionKey,
  type AppItem,
} from '../../data/apps';
import { openApp } from '../../platform/appLauncher';
import { useDeviceStatus } from '../../platform/deviceApi';
import {
  useMediaState,
  togglePlayPause, next, previous, pause, play,
} from '../../platform/mediaService';
import { toIntent, routeIntent } from '../../platform/intentEngine';
import { registerCommandHandler } from '../../platform/voiceService';
import type { ParsedCommand } from '../../platform/commandParser';
import { useSmartEngine, trackLaunch } from '../../platform/smartEngine';
import { SmartContextBanner } from '../common/SmartContextBanner';
import { setDrivingMode } from '../../platform/mapService';
import { useNavigation } from '../../platform/navigationService';
import { initializeAddressBook } from '../../platform/addressBookService';
import { useApps } from '../../platform/appDiscovery';
import { startSpeedLimitService, stopSpeedLimitService } from '../../platform/speedLimitService';
import { useOBDState } from '../../platform/obdService';
import {
  startHeadlightAutoBrightness,
  stopHeadlightAutoBrightness,
} from '../../platform/systemSettingsService';
import { useGPSLocation, feedBackgroundLocation } from '../../platform/gpsService';
import { startWifiService, stopWifiService } from '../../platform/wifiService';
import { isNative } from '../../platform/bridge';
import { CarLauncher } from '../../platform/nativePlugin';
import { showToast, dismissToastByTitle } from '../../platform/errorBus';
import { ErrorToast } from '../common/ErrorToast';
import { VolumeOverlay } from '../common/VolumeOverlay';
import { GestureVolumeZone } from '../common/GestureVolumeZone';
import {
  getPerformanceMode, onPerformanceModeChange,
  type PerformanceMode,
} from '../../platform/performanceMode';

/* ── Persistence ─────────────────────────────────────────── */

function save(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
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

const ClockHand = ({ angle, length, width, color, cx, cy }: { angle: number; length: number; width: number; color: string; cx: number; cy: number }) => {
  const rad = (angle - 90) * (Math.PI / 180);
  const x2 = cx + length * Math.cos(rad);
  const y2 = cy + length * Math.sin(rad);
  return <line x1={cx} y1={cy} x2={x2} y2={y2} stroke={color} strokeWidth={width} strokeLinecap="round" />;
};

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
      <ClockHand angle={hourAngle} length={r * 0.5} width={2.5} color="rgba(255,255,255,0.9)" cx={cx} cy={cy} />

      {/* Minute hand */}
      <ClockHand angle={minuteAngle} length={r * 0.72} width={1.5} color="rgba(255,255,255,0.7)" cx={cx} cy={cy} />

      {/* Second hand with glow */}
      {showSeconds && (
        <g filter="drop-shadow(0 0 6px rgba(59,130,246,0.5))">
          <ClockHand angle={secondAngle} length={r * 0.85} width={1} color="#3b82f6" cx={cx} cy={cy} />
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
  onOpenMap,
  offlineMap,
}: {
  defaultNav:  NavOptionKey;
  onLaunch:    (id: string) => void;
  onOpenMap?:  () => void;
  offlineMap?: boolean;
}) {
  const nav = NAV_OPTIONS[defaultNav];

  // Offline map mode: show MiniMapWidget inside NavHero card
  if (offlineMap && onOpenMap) {
    return (
      <div className="min-h-0 w-full h-full transform transition-all duration-300 hover:scale-[1.002] active:scale-[0.995]">
        <MiniMapWidget onFullScreenClick={onOpenMap} />
      </div>
    );
  }

  return (
    <div
      className="flex flex-col rounded-[2.5rem] border border-white/10 p-8 overflow-hidden relative min-h-0 w-full h-full group transition-all duration-300 shadow-[0_20px_60px_rgba(0,0,0,0.6)] hover:border-white/20 hover:shadow-[0_25px_70px_rgba(0,0,0,0.7)]"
      style={{ background: 'linear-gradient(165deg, rgba(10,18,40,0.7) 0%, rgba(5,10,25,0.9) 100%)', backdropFilter: 'blur(50px)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-10 flex-shrink-0 relative z-10">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 rounded-[1.5rem] bg-blue-600/15 border border-blue-500/30 flex items-center justify-center flex-shrink-0 shadow-[0_10px_30px_rgba(59,130,246,0.25)] group-hover:border-blue-500/50 transition-colors duration-300">
            <span className="text-4xl leading-none drop-shadow-2xl">{nav.icon}</span>
          </div>
          <div>
            <div className="text-blue-400 font-black text-xs uppercase tracking-[0.5em] mb-1.5 opacity-100">NAVİGASYON ÜNİTESİ</div>
            <div className="text-white text-3xl font-black tracking-tighter uppercase">{nav.name}</div>
          </div>
        </div>
        <div className="flex items-center gap-5">
          {onOpenMap && (
            <button
              onClick={(e) => { e.stopPropagation(); onOpenMap(); }}
              className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 hover:border-white/40 active:scale-90 active:bg-white/20 transition-all duration-150 shadow-xl group/map"
            >
              <MapIcon className="w-7 h-7 transform group-hover/map:scale-110 transition-transform duration-200" />
            </button>
          )}
        </div>
      </div>

      {/* Main launch button — Snappy & Tactile */}
      <button
        onClick={(e) => { e.stopPropagation(); onLaunch(defaultNav); }}
        className="relative flex flex-col items-center justify-center rounded-[3rem] overflow-hidden active:scale-[0.975] active:brightness-90 transition-all duration-200 gap-8 min-h-0 flex-1 group/btn shadow-[0_30px_70px_rgba(37,99,235,0.4)] hover:shadow-[0_35px_80px_rgba(37,99,235,0.5)]"
        style={{ background: 'linear-gradient(145deg, #1e3a8a 0%, #2563eb 50%, #1e3a8a 100%)', border: '1px solid rgba(255,255,255,0.2)' }}
      >
        <div className="absolute inset-0 bg-white/10 opacity-0 group-hover/btn:opacity-100 transition-opacity duration-300" />
        <div className="relative flex flex-col items-center gap-8 pointer-events-none">
          <MapPin className="w-36 h-36 text-white relative drop-shadow-[0_15px_40px_rgba(0,0,0,0.6)] transform group-hover/btn:scale-105 transition-transform duration-500" />
          <div className="text-center">
            <div className="text-white text-6xl font-black tracking-tighter uppercase" style={{ textShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>NAVİGASYONU AÇ</div>
          </div>
        </div>
      </button>
    </div>
  );
});

/* ── MediaPanel ──────────────────────────────────────────── */

const MediaPanel = memo(function MediaPanel({
  defaultMusic,
}: {
  defaultMusic: MusicOptionKey;
}) {
  const { playing, track } = useMediaState();
  const music = MUSIC_OPTIONS[defaultMusic];

  return (
    <div
      className="flex flex-col rounded-[2.5rem] border border-white/10 p-8 min-h-0 w-full h-full overflow-hidden relative group transition-all duration-300 shadow-[0_20px_60px_rgba(0,0,0,0.6)] hover:border-white/20"
      style={{ background: 'linear-gradient(165deg, rgba(10,18,40,0.7) 0%, rgba(5,10,25,0.9) 100%)', backdropFilter: 'blur(50px)' }}
    >
      <div className="flex-1 flex flex-col justify-center min-h-0 relative z-10">
        {/* Track info */}
        <div className="text-white font-black leading-none truncate text-[2.2rem] tracking-tight mb-2 group-hover:text-blue-50 transition-colors duration-300">{track.title}</div>
        <div className="text-blue-200/40 truncate text-base font-black uppercase tracking-[0.2em] mb-4">{track.artist}</div>

        {/* Controls — Snappy Tactile Buttons */}
        <div className="flex items-center justify-center gap-6 flex-shrink-0 mt-4">
          <button onClick={(e) => { e.stopPropagation(); previous(); }} className="w-14 h-14 flex items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 hover:border-white/30 active:scale-90 active:bg-white/20 transition-all duration-150 shadow-md">
            <SkipBack className="w-7 h-7" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); togglePlayPause(); }}
            className="w-20 h-20 flex items-center justify-center rounded-[2rem] text-white active:scale-[0.94] active:brightness-90 transition-all duration-200 group/play"
            style={{ background: `linear-gradient(145deg, ${music.color}cc, ${music.color}88)`, border: '1px solid rgba(255,255,255,0.2)' }}
          >
            {playing ? <Pause className="w-9 h-9" /> : <Play className="w-9 h-9 ml-1.5 fill-white" />}
          </button>
          <button onClick={(e) => { e.stopPropagation(); next(); }} className="w-14 h-14 flex items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 hover:border-white/30 active:scale-90 active:bg-white/20 transition-all duration-150 shadow-md">
            <SkipForward className="w-7 h-7" />
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
  appMap,
}: {
  dockIds: string[];
  onLaunch: (id: string) => void;
  appMap: Record<string, AppItem>;
}) {
  const apps = dockIds.slice(0, 4).map((id) => ({ id, app: appMap[id] })).filter((x) => x.app);

  return (
    <div
      className="flex flex-col rounded-[2.5rem] border border-white/10 p-6 h-full overflow-hidden relative group transition-all duration-700 shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
      style={{ background: 'linear-gradient(165deg, rgba(15,23,42,0.6) 0%, rgba(10,15,30,0.8) 100%)', backdropFilter: 'blur(40px)' }}
    >
      <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-blue-600/5 rounded-full blur-[60px] pointer-events-none" />
      <div className="text-blue-400 font-black text-[9px] uppercase tracking-[0.3em] mb-4 opacity-70 px-1">Kısayollar</div>
      <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
        {apps.map(({ id, app }) => (
          <button
            key={id}
            onClick={() => onLaunch(id)}
            className="flex flex-col items-center justify-center gap-2.5 rounded-[1.8rem] bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.15] active:scale-[0.94] transition-all duration-300 min-h-0 group/item shadow-sm hover:shadow-blue-500/10"
          >
            <span className="text-[2rem] leading-none transform group-hover/item:scale-110 transition-transform duration-500">{app!.icon}</span>
            <span className="text-white/40 group-hover:text-white/80 text-[10px] font-bold uppercase tracking-widest truncate px-2 transition-colors">{app!.name}</span>
          </button>
        ))}
      </div>
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

/* ── DraggableWidget ─────────────────────────────────────── */

interface DraggableWidgetProps {
  id: string;
  editMode: boolean;
  dragId: string | null;
  dropId: string | null;
  onDragStart: (id: string) => void;
  onDragOver: (id: string) => void;
  onDrop: () => void;
  children: ReactNode;
  className?: string;
}

const DraggableWidget = memo(function DraggableWidget({
  id, editMode, dragId, dropId, onDragStart, onDragOver, onDrop, children, className = '',
}: DraggableWidgetProps) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDragging = dragId === id;
  const isDropTarget = dropId === id && dragId !== null && dragId !== id;

  const handlePointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!editMode) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    holdTimer.current = setTimeout(() => {
      onDragStart(id);
    }, 350);
  }, [editMode, id, onDragStart]);

  const handlePointerUp = useCallback(() => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    onDrop();
  }, [onDrop]);

  const handlePointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    if (dragId === null || dragId === id) return;
    // Check if pointer is over this widget
    const rect = e.currentTarget.getBoundingClientRect();
    if (
      e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top  && e.clientY <= rect.bottom
    ) {
      onDragOver(id);
    }
  }, [dragId, id, onDragOver]);

  return (
    <div
      className={`relative flex min-h-0 transition-all duration-200 ${
        isDragging ? 'opacity-50 scale-[0.98]' : ''
      } ${
        isDropTarget ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-transparent rounded-[2.5rem]' : ''
      } ${className}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerCancel={handlePointerUp}
    >
      {children}
      {/* Drag handle indicator in edit mode */}
      {editMode && (
        <div className="absolute top-3 left-3 z-50 bg-black/60 backdrop-blur-sm rounded-xl p-1.5 text-slate-400">
          <GripVertical className="w-4 h-4" />
        </div>
      )}
    </div>
  );
});

/* ── MainLayout ──────────────────────────────────────────── */

type DrawerType = 'none' | 'apps' | 'settings' | 'dashcam' | 'triplog' | 'dtc' | 'notifications' | 'weather' | 'sport' | 'security' | 'entertainment';

export default function MainLayout() {
  const { settings, updateSettings, updateParking } = useStore();
  const { apps: allApps, appMap, loading: appsLoading } = useApps();
  const obd = useOBDState();
  const location = useGPSLocation();
  const [bootPhase, setBootPhase] = useState<BootPhase>('show');
  const [drawer, setDrawer]       = useState<DrawerType>('none');
  const [favorites, setFavorites] = useState<string[]>(() =>
    load<string[]>('favorites', [])
  );
  const [perfMode, setPerfMode] = useState<PerformanceMode>(() => getPerformanceMode());
  const [fullMapOpen, setFullMapOpen] = useState(false);

  const notifState  = useNotificationState();
  const traffic = useTrafficState();
  const autoBrightness = useAutoBrightnessState();
  const hudMedia = useMediaState();

  const [splitOpen,      setSplitOpen]      = useState(false);
  const [rearCamOpen,    setRearCamOpen]    = useState(false);
  const [passengerOpen,  setPassengerOpen]  = useState(false);

  const { isNavigating } = useNavigation();

  useWakeWordState(); // wake word durumunu başlatmak için subscribe

  // Wake word
  useEffect(() => {
    if (settings.wakeWordEnabled) enableWakeWord(settings.wakeWord ?? 'hey car');
    else disableWakeWord();
    return () => { disableWakeWord(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.wakeWordEnabled]);

  // Kişi rehberini yükle
  useEffect(() => { initializeContacts(); }, []);

  // OBD hata durumlarını toast ile kullanıcıya ilet
  useEffect(() => {
    const state = obd.connectionState;
    if (state === 'error') {
      showToast({
        type:    'error',
        title:   'OBD Bağlantısı Kesildi',
        message: 'ELM327 adapteriyle bağlantı kurulamadı. Simüle veri gösteriliyor.',
        duration: 7000,
      });
    } else if (state === 'connected') {
      dismissToastByTitle('OBD Bağlantısı Kesildi');
      showToast({ type: 'success', title: 'OBD Bağlandı', message: obd.deviceName, duration: 3000 });
    } else if (state === 'reconnecting') {
      showToast({ type: 'warning', title: 'OBD Yeniden Bağlanıyor...', duration: 4000 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obd.connectionState]);

  // GPS izin hatası toast
  useEffect(() => {
    if (!location && isNative) {
      const t = setTimeout(() => {
        showToast({
          type: 'warning',
          title: 'GPS İzni Gerekli',
          message: 'Konum izni verilmeden harita ve navigasyon çalışmaz.',
          duration: 8000,
        });
      }, 5000); // 5 sn bekle — servis henüz başlıyor olabilir
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arka plan GPS servisi (native cihazda app minimize olunca GPS'i ayakta tutar)
  useEffect(() => {
    if (!isNative) return;
    CarLauncher.startBackgroundService().catch(() => {
      showToast({ type: 'warning', title: 'Arka Plan GPS', message: 'Foreground servis başlatılamadı.', duration: 5000 });
    });
    // Arka plan konumu gps servisine ilet
    let handle: { remove(): void } | null = null;
    CarLauncher.addListener('backgroundLocation', (loc) => {
      // Arka plan GPS → gpsService store'a besle (minimize modda Capacitor dursa bile)
      feedBackgroundLocation(loc);
      if (settings.autoBrightnessEnabled) {
        updateAutoBrightnessLocation(loc.lat, loc.lng);
      }
      updateTrafficLocation(loc.lat);
    }).then((h) => { handle = h; }).catch(() => undefined);
    // Mola hatırlatıcısı
    let breakHandle: { remove(): void } | null = null;
    CarLauncher.addListener('breakReminder', () => {
      if (settings.breakReminderEnabled) {
        // BreakAlertOverlay'i tetikle — breakReminderService üzerinden
        // (native servis bağımsız çalışır, JS servisi de kendi sayacını tutar)
        showToast({ type: 'warning', title: 'Mola Zamanı', message: '2 saattir kesintisiz sürüş yapıyorsunuz.', duration: 0 });
      }
    }).then((h) => { breakHandle = h; }).catch(() => undefined);

    return () => {
      handle?.remove();
      breakHandle?.remove();
      CarLauncher.stopBackgroundService().catch(() => undefined);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // WiFi durumu servisi — SSID + bağlantı durumu
  useEffect(() => {
    startWifiService();
    return () => { stopWifiService(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trafik servisi — GPS ile güncelle
  useEffect(() => {
    startTrafficService(location?.latitude);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (location?.latitude) updateTrafficLocation(location.latitude);
  }, [location?.latitude]);

  // Otomatik parlaklık
  useEffect(() => {
    if (settings.autoBrightnessEnabled && location?.latitude) {
      startAutoBrightness({
        lat: location.latitude,
        lng: location.longitude,
        onThemeChange: settings.autoThemeEnabled
          ? (theme) => updateSettings({ theme })
          : undefined,
      });
    } else {
      stopAutoBrightness();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoBrightnessEnabled, settings.autoThemeEnabled]);

  useEffect(() => {
    if (settings.autoBrightnessEnabled && location?.latitude) {
      updateAutoBrightnessLocation(location.latitude, location.longitude);
    }
  }, [location?.latitude, location?.longitude, settings.autoBrightnessEnabled]);

  // GPS hızına göre sürüş modu — 15 km/h üzeri 3 saniye boyunca devam ederse drive mode aktif
  const autoDriveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!settings.smartContextEnabled) return;
    const speedKmh = location?.speed != null ? location.speed * 3.6 : 0;
    if (speedKmh > 15) {
      if (!autoDriveTimerRef.current) {
        autoDriveTimerRef.current = setTimeout(() => {
          setDrivingMode(true);
          autoDriveTimerRef.current = null;
        }, 3000);
      }
    } else {
      if (autoDriveTimerRef.current) {
        clearTimeout(autoDriveTimerRef.current);
        autoDriveTimerRef.current = null;
      }
    }
  }, [location?.speed, settings.smartContextEnabled]);

  // ── Drag & drop state for right-column widgets ────────────
  const [dragId, setDragId]   = useState<string | null>(null);
  const [dropId, setDropId]   = useState<string | null>(null);

  const handleDragStart = useCallback((id: string) => {
    setDragId(id);
    setDropId(null);
  }, []);

  const handleDragOver = useCallback((id: string) => {
    setDropId(id);
  }, []);

  const handleDrop = useCallback(() => {
    if (dragId && dropId && dragId !== dropId) {
      const order = [...(settings.widgetOrder ?? ['media', 'shortcuts'])];
      const fromIdx = order.indexOf(dragId);
      const toIdx   = order.indexOf(dropId);
      if (fromIdx !== -1 && toIdx !== -1) {
        [order[fromIdx], order[toIdx]] = [order[toIdx], order[fromIdx]];
        updateSettings({ widgetOrder: order });
      }
    }
    setDragId(null);
    setDropId(null);
  }, [dragId, dropId, settings.widgetOrder, updateSettings]);

  // Save parking location when RPM drops to 0 (Engine Off)
  const lastRpmRef = useRef(0);
  useEffect(() => {
    if (lastRpmRef.current > 0 && obd.rpm === 0 && location) {
      updateParking({
        lat: location.latitude,
        lng: location.longitude,
        timestamp: Date.now(),
      });
    }
    lastRpmRef.current = obd.rpm;
  }, [obd.rpm, location, updateParking]);

  // Filter invalid favorites once apps load (only on native)
  useEffect(() => {
    if (!appsLoading && Object.keys(appMap).length > 0) {
      const validFavorites = favorites.filter(id => id in appMap || id.startsWith('native-'));
      if (validFavorites.length !== favorites.length) {
        setFavorites(validFavorites);
      }
    }
  }, [appsLoading, appMap, favorites]);

  // Smart engine — local AI layer
  const device = useDeviceStatus();
  const smart  = useSmartEngine(
    device,
    favorites,
    settings.defaultNav as NavOptionKey,
    settings.defaultMusic as MusicOptionKey,
    location?.speed != null ? location.speed * 3.6 : undefined,
    hudMedia.playing,
    isNavigating,
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

  // Initialize address book, speed limit service, and trip log
  useEffect(() => {
    initializeAddressBook().catch((err) => {
      console.error('Failed to initialize address book:', err);
    });

    startSpeedLimitService();
    startTripLog();
    startNotificationService();
    startWeatherService();
    startHeadlightAutoBrightness(() => useStore.getState().settings.brightness);

    return () => {
      stopSpeedLimitService();
      stopNotificationService();
      stopWeatherService();
      stopHeadlightAutoBrightness();
    };
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
    const app = appMap[id];
    if (!app) return;

    if (app.internalPage === 'settings') {
      setDrawer('settings');
      return;
    }

    trackLaunch(id);
    openApp(app);
    setDrawer('none');
  }, [appMap]);

  const openApps     = useCallback(() => setDrawer('apps'),     []);
  const openSettings = useCallback(() => setDrawer('settings'), []);
  const closeDrawer  = useCallback(() => setDrawer('none'),     []);

  // ── Voice command routing ────────────────────────────────
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

      if (cmd.type === 'toggle_sleep_mode') {
        update({ sleepMode: !s.sleepMode });
        return;
      }

      const intent = toIntent(cmd, {
        defaultNav:   s.defaultNav,
        defaultMusic: s.defaultMusic,
        recentAppId:  sm.quickActions.find((a) => a.id.startsWith('last-'))?.appId,
      });

      routeIntent(intent, {
        launch,
        openDrawer: (target) => open(target as DrawerType),
        setTheme:   (theme) => update({ theme }),
        playMedia:  play,
        pauseMedia: pause,
      });
    });
  }, []);

  useEffect(() => {
    if (settings.performanceMode) {
      document.body.classList.add('performance-mode');
    } else {
      document.body.classList.remove('performance-mode');
    }
  }, [settings.performanceMode]);

  const wallpaperStyle = settings.wallpaper !== 'none' ? {
    backgroundImage: `url(${settings.wallpaper})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat'
  } : {};

  return (
    <div
      data-theme={settings.theme}
      data-theme-pack={settings.themePack}
      data-theme-style={settings.themeStyle}
      data-widget-style={settings.widgetStyle}
      data-drive-state={smart.drivingMode}
      data-performance-mode={perfMode}
      data-edit-mode={settings.editMode}
      data-media-active={String(smart.mediaProminent)}
      data-nav-active={String(smart.mapPriority)}
      className="flex flex-col h-full w-full overflow-hidden text-white transition-all duration-500"
      style={{
        background: settings.theme === 'oled' ? '#000' : '#060d1a',
        filter: `brightness(${Math.max(50, Math.min(150, settings.brightness)) / 100})`,
        ...wallpaperStyle
      }}
    >
      <BootSplash phase={bootPhase} />
      <ErrorToast />
      <VolumeOverlay />

      {/* Premium Settings Shortcut */}
      <button
        onClick={openSettings}
        className="fixed top-4 right-4 z-[45] group flex items-center justify-center transition-all duration-500 ease-out"
        data-drive-size={smart.drivingMode ? 'compact' : 'normal'}
      >
        <div className="absolute inset-0 bg-white/[0.03] backdrop-blur-2xl rounded-2xl border border-white/10 group-hover:bg-white/10 group-hover:border-white/20 transition-all shadow-[0_10px_30px_rgba(0,0,0,0.3)]" />
        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl" />
        <div className="relative p-3 flex items-center justify-center group-active:scale-90 transition-transform">
          <SlidersHorizontal className="w-5 h-5 text-slate-400 group-hover:text-white group-hover:drop-shadow-[0_0_8px_var(--pack-glow-color,rgba(59,130,246,0.5))] transition-all" />
        </div>
      </button>

      {/* Kenar swipe ses kontrolü — sadece seçili tarafta aktif */}
      {settings.gestureVolumeSide !== 'off' && (
        <GestureVolumeZone
          side={settings.gestureVolumeSide}
          volume={settings.volume}
          onVolumeChange={(v) => {
            updateSettings({ volume: v });
          }}
        />
      )}

      {/* Edit Mode Banner */}
      {settings.editMode && (
        <div className="edit-mode-banner fixed top-0 inset-x-0 z-[60] h-12 bg-blue-600 flex items-center justify-between px-6 shadow-2xl">
          <div className="flex items-center gap-2">
            <LayoutGrid className="w-4 h-4 text-white animate-pulse" />
            <span className="text-white text-sm font-bold tracking-wider uppercase">DÜZENLEME MODU AKTİF</span>
          </div>
          <button 
            onClick={() => updateSettings({ editMode: false })}
            className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-1.5 rounded-full transition-colors active:scale-95"
          >
            <Check className="w-4 h-4 text-white" />
            <span className="text-white text-xs font-bold uppercase">BİTTİ</span>
          </button>
        </div>
      )}

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
      <div className="flex items-center justify-between px-5 pt-2.5 pb-1 flex-shrink-0 relative z-30">
        <ClockArea use24Hour={settings.use24Hour} showSeconds={settings.showSeconds} clockStyle={settings.clockStyle} />
        <DeviceStatusBar />
      </div>

      {/* Smart Context Banner — öneri bandı + hızlı eylem chipleri */}
      <SmartContextBanner
        smart={smart}
        enabled={settings.smartContextEnabled}
        onLaunch={handleLaunch}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0 relative z-10" data-theme-layout="main">
        {/* OBD Row (Visible in Big Cards or when forced) */}
        <div 
          className="px-3 pt-1 flex-shrink-0 relative" 
          data-section="obd"
          data-hidden={!settings.widgetVisible.obd}
        >
          {settings.widgetVisible.obd && (
            (settings.themePack === 'bmw' || settings.themePack === 'mercedes') 
              ? <DigitalCluster /> 
              : <OBDPanel />
          )}
          {settings.editMode && (
            <div className="absolute top-4 right-4 z-50 flex gap-2">
              <button 
                onClick={() => updateSettings({ widgetVisible: { ...settings.widgetVisible, obd: !settings.widgetVisible.obd }})}
                className={`w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md border border-white/20 transition-all ${settings.widgetVisible.obd ? 'bg-red-500/80 text-white' : 'bg-green-500/80 text-white'}`}
              >
                {settings.widgetVisible.obd ? <X className="w-5 h-5" /> : <Check className="w-5 h-5" />}
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-hidden flex gap-3 px-3 pt-1 pb-1">
          {/* Left: Navigation / Offline Map */}
          <div
            className={`min-w-0 min-h-0 flex relative transition-[flex] duration-700 ${
              settings.smartContextEnabled
                ? smart.layoutWeights.navFlex === 4 ? 'flex-[2.5]'
                  : smart.layoutWeights.navFlex === 2 ? 'flex-[1.2]'
                  : 'flex-[1.8]'
                : 'flex-[1.8]'
            }`}
            data-section="hero"
            data-hidden={!settings.widgetVisible.nav}
          >
            {settings.widgetVisible.nav && (
              <NavHero
                defaultNav={settings.defaultNav as NavOptionKey}
                onLaunch={handleLaunch}
                onOpenMap={() => setFullMapOpen(true)}
                offlineMap={settings.offlineMap}
              />
            )}
            {settings.editMode && (
              <div className="absolute top-4 right-4 z-50 flex gap-2">
                <button 
                  onClick={() => updateSettings({ widgetVisible: { ...settings.widgetVisible, nav: !settings.widgetVisible.nav }})}
                  className={`w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md border border-white/20 transition-all ${settings.widgetVisible.nav ? 'bg-red-500/80 text-white' : 'bg-green-500/80 text-white'}`}
                >
                  {settings.widgetVisible.nav ? <X className="w-5 h-5" /> : <Check className="w-5 h-5" />}
                </button>
              </div>
            )}
          </div>
          {/* Right: Media + Quick Access (drag & drop reorderable in edit mode) */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-3" data-section="sidebar">
            {(settings.widgetOrder ?? ['media', 'shortcuts']).map((widgetId, index) => {
              const flex = index === 0 ? 'flex-[1.5]' : 'flex-1';
              if (widgetId === 'media') {
                return (
                  <DraggableWidget
                    key="media"
                    id="media"
                    editMode={settings.editMode}
                    dragId={dragId}
                    dropId={dropId}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    className={`${flex} min-h-0`}
                  >
                    <div className="flex-1 min-h-0 flex relative w-full" data-section="media" data-hidden={!settings.widgetVisible.media}>
                      {settings.widgetVisible.media && (
                        <MediaPanel
                          defaultMusic={settings.defaultMusic as MusicOptionKey}
                        />
                      )}
                      {settings.editMode && (
                        <div className="absolute top-4 right-4 z-50">
                          <button
                            onClick={() => updateSettings({ widgetVisible: { ...settings.widgetVisible, media: !settings.widgetVisible.media } })}
                            className={`w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md border border-white/20 transition-all ${settings.widgetVisible.media ? 'bg-red-500/80 text-white' : 'bg-green-500/80 text-white'}`}
                          >
                            {settings.widgetVisible.media ? <X className="w-5 h-5" /> : <Check className="w-5 h-5" />}
                          </button>
                        </div>
                      )}
                    </div>
                  </DraggableWidget>
                );
              }
              if (widgetId === 'shortcuts') {
                return (
                  <DraggableWidget
                    key="shortcuts"
                    id="shortcuts"
                    editMode={settings.editMode}
                    dragId={dragId}
                    dropId={dropId}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    className={`${flex} min-h-0`}
                  >
                    <div className="flex-1 min-h-0 flex relative w-full" data-section="shortcuts" data-hidden={!settings.widgetVisible.shortcuts}>
                      {settings.widgetVisible.shortcuts && (
                        <DockShortcuts
                          dockIds={smart.dockIds}
                          onLaunch={handleLaunch}
                          appMap={appMap}
                        />
                      )}
                      {settings.editMode && (
                        <div className="absolute top-4 right-4 z-50">
                          <button
                            onClick={() => updateSettings({ widgetVisible: { ...settings.widgetVisible, shortcuts: !settings.widgetVisible.shortcuts } })}
                            className={`w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md border border-white/20 transition-all ${settings.widgetVisible.shortcuts ? 'bg-red-500/80 text-white' : 'bg-green-500/80 text-white'}`}
                          >
                            {settings.widgetVisible.shortcuts ? <X className="w-5 h-5" /> : <Check className="w-5 h-5" />}
                          </button>
                        </div>
                      )}
                    </div>
                  </DraggableWidget>
                );
              }
              return null;
            })}
          </div>
        </div>
      </div>

      {/* Drive Mode HUD — collapses when idle/normal, slides up when driving */}
      <div data-drive-hud="main" className="flex-shrink-0 relative z-25 px-3">
        <div className="mb-1.5 px-4 py-2.5 rounded-2xl bg-black/75 backdrop-blur-xl border border-white/[0.08] flex items-center gap-4">
          {/* Speed display */}
          <div className="flex items-baseline gap-1 flex-shrink-0 min-w-[72px]">
            <span className="text-4xl font-black text-white tabular-nums leading-none">
              {Math.round(obd.speed)}
            </span>
            <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wide self-end mb-0.5">km/h</span>
          </div>

          <div className="w-px h-8 bg-white/10 flex-shrink-0" />

          {/* Track info */}
          <div className="flex-1 min-w-0">
            <div className="text-white text-sm font-bold truncate leading-tight">
              {hudMedia.track.title || '—'}
            </div>
            <div className="text-slate-500 text-xs truncate mt-0.5">
              {hudMedia.track.artist || '\u00a0'}
            </div>
          </div>

          {/* Media controls */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={previous}
              className="w-9 h-9 rounded-xl bg-white/[0.07] border border-white/10 flex items-center justify-center active:scale-95"
            >
              <SkipBack className="w-4 h-4 text-slate-300" />
            </button>
            <button
              onClick={togglePlayPause}
              className="w-11 h-11 rounded-xl bg-blue-500 flex items-center justify-center active:scale-95 shadow-[0_2px_12px_rgba(59,130,246,0.45)]"
            >
              {hudMedia.playing
                ? <Pause className="w-5 h-5 fill-current" />
                : <Play  className="w-5 h-5 fill-current" />
              }
            </button>
            <button
              onClick={next}
              className="w-9 h-9 rounded-xl bg-white/[0.07] border border-white/10 flex items-center justify-center active:scale-95"
            >
              <SkipForward className="w-4 h-4 text-slate-300" />
            </button>
          </div>

          {/* Night indicator */}
          {(autoBrightness.phase === 'night' || autoBrightness.phase === 'evening' || autoBrightness.phase === 'dawn') && (
            <span className="flex-shrink-0 text-base leading-none select-none">🌙</span>
          )}
        </div>
      </div>

      {/* Dock */}
      <div data-dock="main" className="flex items-center justify-center px-6 py-3 flex-shrink-0 relative z-20 overflow-hidden">
        <div className="flex items-center gap-2 p-1 rounded-[2rem] bg-black/60 backdrop-blur-3xl border border-white/5 shadow-[0_15px_40px_rgba(0,0,0,0.7)] max-w-5xl w-full relative overflow-hidden group">
          <div className="absolute top-0 left-1/4 right-1/4 h-[1px] bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />
          
          {/* Scrollable Container */}
          <div className="flex items-center gap-2 overflow-x-auto overflow-y-hidden snap-x snap-mandatory no-scrollbar scroll-smooth px-2 py-1 w-full mask-fade">
            {smart.dockIds.slice(0, 5).map((id) => {
              const app = appMap[id];
              if (!app) return null;
              return (
                <button
                  key={id}
                  onClick={() => handleLaunch(id)}
                  className="flex-shrink-0 min-w-[100px] h-11 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center"
                >
                  <span className="text-xl leading-none group-hover:scale-110 transition-transform">{app.icon}</span>
                  <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">{app.name}</span>
                </button>
              );
            })}

            <div className="w-px h-6 bg-white/5 mx-1 flex-shrink-0" />

            {/* Notifications */}
            <button
              onClick={() => setDrawer('notifications')}
              className="flex-shrink-0 min-w-[100px] h-11 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group relative snap-center"
            >
              <Bell className="w-5 h-5 text-slate-500 group-hover:text-blue-400 transition-colors" />
              {notifState.unreadCount > 0 && (
                <span className="absolute top-1.5 right-2.5 min-w-[16px] h-4 bg-blue-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1 leading-none">
                  {notifState.unreadCount > 9 ? '9+' : notifState.unreadCount}
                </span>
              )}
              <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Bildirim</span>
            </button>

            {/* Dashcam */}
            <button
              onClick={() => setDrawer('dashcam')}
              className="flex-shrink-0 min-w-[100px] h-11 flex items-center justify-center gap-2 rounded-xl bg-red-500/5 border border-red-500/10 hover:bg-red-500/15 active:scale-[0.95] transition-all duration-300 group snap-center"
            >
              <Camera className="w-5 h-5 text-red-400/60 group-hover:text-red-400 transition-colors" />
              <span className="text-red-400/40 group-hover:text-red-400 text-[10px] font-black uppercase tracking-[0.2em]">Kamera</span>
            </button>

            {/* Trip Log */}
            <button
              onClick={() => setDrawer('triplog')}
              className="flex-shrink-0 min-w-[100px] h-11 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center"
            >
              <Route className="w-5 h-5 text-slate-500 group-hover:text-emerald-400 transition-colors" />
              <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Seyir</span>
            </button>

            {/* DTC */}
            <button
              onClick={() => setDrawer('dtc')}
              className="flex-shrink-0 min-w-[100px] h-11 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center"
            >
              <ShieldAlert className="w-5 h-5 text-slate-500 group-hover:text-amber-400 transition-colors" />
              <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Arıza</span>
            </button>

            {/* Weather */}
            <button
              onClick={() => setDrawer('weather')}
              className="flex-shrink-0 min-w-[100px] h-11 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center"
            >
              <CloudSun className="w-5 h-5 text-slate-500 group-hover:text-amber-400 transition-colors" />
              <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Hava</span>
            </button>

            <div className="w-px h-6 bg-white/5 mx-1 flex-shrink-0" />

            <div className="flex-shrink-0 snap-center">
              <VoiceMicButton />
            </div>

            <button
              onClick={openApps}
              className="flex-shrink-0 min-w-[100px] h-11 flex items-center justify-center gap-2 rounded-xl bg-blue-500/5 border border-blue-500/10 hover:bg-blue-500/20 active:scale-[0.95] transition-all duration-300 group snap-center"
            >
              <LayoutGrid className="w-5 h-5 text-blue-400 group-hover:text-blue-300 transition-colors" />
              <span className="text-blue-400/60 group-hover:text-blue-300 text-[10px] font-black uppercase tracking-[0.2em]">Menü</span>
            </button>

            {/* Split Screen */}
            <button
              onClick={() => setSplitOpen(true)}
              className="flex-shrink-0 min-w-[100px] h-11 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center"
            >
              <span className="text-lg leading-none group-hover:scale-110 transition-transform">⊞</span>
              <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Split</span>
            </button>

            {/* Geri Kamera */}
            <button
              onClick={() => setRearCamOpen(true)}
              className="flex-shrink-0 min-w-[100px] h-11 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center"
            >
              <span className="text-lg leading-none group-hover:scale-110 transition-transform">📸</span>
              <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Kamera</span>
            </button>

            {/* Trafik */}
            <button
              onClick={() => { /* trafik paneli ileride */ }}
              className="flex-shrink-0 min-w-[100px] h-11 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group relative snap-center"
            >
              <span className="text-lg leading-none group-hover:scale-110 transition-transform">🚦</span>
              {traffic.summary && (
                <span
                  className="absolute top-1.5 right-2 w-2.5 h-2.5 rounded-full border border-black/40"
                  style={{ backgroundColor: TRAFFIC_COLORS[traffic.summary.level] }}
                />
              )}
              <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Trafik</span>
            </button>

            {/* Sport Modu */}
            <button
              onClick={() => setDrawer('sport')}
              className="flex-shrink-0 min-w-[100px] h-11 flex items-center justify-center gap-2 rounded-xl bg-red-500/5 border border-red-500/10 hover:bg-red-500/15 active:scale-[0.95] transition-all duration-300 group snap-center"
            >
              <span className="text-lg leading-none group-hover:scale-110 transition-transform">⚡</span>
              <span className="text-red-400/40 group-hover:text-red-400 text-[10px] font-black uppercase tracking-widest">Sport</span>
            </button>

            {/* Güvenlik */}
            <button
              onClick={() => setDrawer('security')}
              className="flex-shrink-0 min-w-[100px] h-11 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center"
            >
              <Shield className="w-5 h-5 text-slate-500 group-hover:text-amber-400 transition-colors" />
              <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Vale</span>
            </button>

            {/* Eğlence */}
            <button
              onClick={() => setDrawer('entertainment')}
              className="flex-shrink-0 min-w-[100px] h-11 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center"
            >
              <span className="text-lg leading-none group-hover:scale-110 transition-transform">🎬</span>
              <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Eğlence</span>
            </button>

            {/* Yolcu Kontrolü */}
            <button
              onClick={() => setPassengerOpen(true)}
              className="flex-shrink-0 min-w-[100px] h-11 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center"
            >
              <Smartphone className="w-5 h-5 text-slate-500 group-hover:text-blue-400 transition-colors" />
              <span className="text-white/30 group-hover:text-blue-400 text-[10px] font-black uppercase tracking-[0.2em]">Yolcu</span>
            </button>

            <button
              onClick={openSettings}
              className="flex-shrink-0 min-w-[100px] h-11 flex items-center justify-center gap-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.95] transition-all duration-300 group snap-center"
            >
              <SlidersHorizontal className="w-5 h-5 text-slate-500 group-hover:text-white transition-colors" />
              <span className="text-white/30 group-hover:text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Ayarlar</span>
            </button>
          </div>
        </div>
      </div>

      <DrawerShell open={drawer === 'apps'} onClose={closeDrawer}>
        <AppGrid
          apps={allApps}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onLaunch={handleLaunch}
          gridColumns={settings.gridColumns as 3 | 4 | 5}
        />
      </DrawerShell>

      <DrawerShell open={drawer === 'settings'} onClose={closeDrawer}>
        <SettingsPage onOpenMap={() => { closeDrawer(); setFullMapOpen(true); }} />
      </DrawerShell>

      <DrawerShell open={drawer === 'dtc'} onClose={closeDrawer}>
        <DTCPanel />
      </DrawerShell>

      <DrawerShell open={drawer === 'notifications'} onClose={closeDrawer}>
        <NotificationCenter />
      </DrawerShell>

      <DrawerShell open={drawer === 'triplog'} onClose={closeDrawer}>
        <TripLogView />
      </DrawerShell>

      <DrawerShell open={drawer === 'weather'} onClose={closeDrawer}>
        <WeatherWidget />
      </DrawerShell>

      <DrawerShell open={drawer === 'sport'} onClose={closeDrawer}>
        <SportModePanel />
      </DrawerShell>

      <DrawerShell open={drawer === 'security'} onClose={closeDrawer}>
        <SecuritySuite />
      </DrawerShell>

      <DrawerShell open={drawer === 'entertainment'} onClose={closeDrawer}>
        <EntertainmentPortal />
      </DrawerShell>

      {/* Mola uyarısı — her zaman üstte */}
      <BreakAlertOverlay />

      {/* Split Screen */}
      {splitOpen && <SplitScreen onClose={() => setSplitOpen(false)} />}

      {/* Geri Görüş Kamerası */}
      {rearCamOpen && <RearViewCamera onClose={() => setRearCamOpen(false)} />}

      {drawer === 'dashcam' && (
        <div className="fixed inset-0 z-40 bg-[#060d1a]">
          <DashcamView onClose={closeDrawer} />
        </div>
      )}

      {fullMapOpen && <FullMapView onClose={() => setFullMapOpen(false)} />}

      {/* Yolcu QR Paneli */}
      {passengerOpen && <PassengerQRModal onClose={() => setPassengerOpen(false)} />}
    </div>
  );
}
