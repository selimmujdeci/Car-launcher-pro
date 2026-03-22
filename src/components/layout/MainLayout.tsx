import { useState, useEffect, useCallback, useRef, memo, type ReactNode } from 'react';
import {
  Wifi, Bluetooth, Battery, BatteryCharging,
  MapPin, SkipBack, SkipForward, Play, Pause,
  LayoutGrid, SlidersHorizontal, Mic,
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
import {
  useVoiceState, processTextCommand, startListening, registerCommandHandler,
} from '../../platform/voiceService';
import type { ParsedCommand } from '../../platform/commandParser';
import {
  useSmartEngine, trackLaunch,
  type DrivingMode, type QuickAction,
} from '../../platform/smartEngine';

/* ── Constants ───────────────────────────────────────────── */

const DEFAULT_SETTINGS: Settings = {
  brightness: 80,
  volume: 60,
  theme: 'dark',
  use24Hour: true,
  showSeconds: false,
  gridColumns: 3,
  defaultNav: 'maps',
  defaultMusic: 'spotify',
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

/* ── ClockArea ───────────────────────────────────────────── */

const ClockArea = memo(function ClockArea({
  use24Hour,
  showSeconds,
}: {
  use24Hour: boolean;
  showSeconds: boolean;
}) {
  const { time, date } = useClock(use24Hour, showSeconds);
  return (
    <div className="flex flex-col justify-center">
      <div className="text-[72px] font-thin leading-none text-white tabular-nums tracking-tight">
        {time}
      </div>
      <div className="text-slate-500 text-sm font-medium mt-2 tracking-wide">{date}</div>
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
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors duration-200 ${
        active ? 'bg-white/10 text-white' : 'bg-white/5 text-slate-600'
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
  navFlex,
  drivingMode,
}: {
  defaultNav:  NavOptionKey;
  onLaunch:    (id: string) => void;
  navFlex:     number;
  drivingMode: DrivingMode;
}) {
  const nav = NAV_OPTIONS[defaultNav];
  return (
    <div
      className="flex flex-col rounded-3xl bg-[#0d1628] border border-white/5 p-6 overflow-hidden relative min-h-0"
      style={{ flex: navFlex }}
    >
      <div className="absolute -top-16 -left-16 w-56 h-56 bg-blue-600/8 rounded-full blur-3xl pointer-events-none" />

      {drivingMode === 'driving' && (
        <div className="absolute top-4 right-4 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/20 pointer-events-none">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-emerald-400 text-[9px] font-semibold uppercase tracking-widest">Sürüş</span>
        </div>
      )}

      <div className="flex items-center gap-3 mb-5 flex-shrink-0">
        <span className="text-3xl">{nav.icon}</span>
        <div>
          <div className="text-slate-500 text-xs uppercase tracking-widest font-medium">Navigasyon</div>
          <div className="text-white text-xl font-semibold">{nav.name}</div>
        </div>
      </div>

      <button
        onClick={() => onLaunch(defaultNav)}
        className="flex-1 flex flex-col items-center justify-center rounded-2xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 active:scale-[0.98] transition-[transform,background-color] duration-150 shadow-2xl shadow-blue-600/25 gap-3 min-h-0"
      >
        <div className="relative">
          <div className="absolute inset-0 bg-white/20 rounded-full blur-xl scale-150 pointer-events-none" />
          <MapPin className="w-14 h-14 text-white relative" />
        </div>
        <span className="text-white text-3xl font-bold">Rota Başlat</span>
        <span className="text-blue-200 text-base">{nav.name} ile aç</span>
      </button>
    </div>
  );
});

/* ── MediaPanel ──────────────────────────────────────────── */

const MediaPanel = memo(function MediaPanel({
  defaultMusic,
  onLaunch,
  mediaFlex,
}: {
  defaultMusic: MusicOptionKey;
  onLaunch:     (id: string) => void;
  mediaFlex:    number;
}) {
  const { playing, track } = useMediaState();
  const music = MUSIC_OPTIONS[defaultMusic];
  const pct = track.durationSec > 0 ? (track.positionSec / track.durationSec) * 100 : 0;

  return (
    <div
      className="flex flex-col rounded-3xl bg-[#0d1628] border border-white/5 p-6 min-h-0"
      style={{ flex: mediaFlex }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">{music.icon}</span>
          <span className="text-slate-500 text-xs uppercase tracking-widest font-medium">Müzik</span>
        </div>
        <button
          onClick={() => onLaunch(defaultMusic)}
          className="text-xs text-blue-400 font-semibold hover:text-blue-300 active:text-blue-200 transition-colors duration-150 px-3 py-1.5 rounded-xl hover:bg-blue-400/10"
        >
          Aç →
        </button>
      </div>

      {/* Track info + controls */}
      <div className="flex-1 flex flex-col justify-center min-h-0">
        <div className="text-white text-2xl font-semibold leading-tight truncate">{track.title}</div>
        <div className="text-slate-400 text-base mt-1 truncate">{track.artist}</div>

        {/* Progress */}
        <div className="mt-5 mb-5 flex-shrink-0">
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-slate-600 text-xs tabular-nums">{fmtTime(track.positionSec)}</span>
            <span className="text-slate-600 text-xs tabular-nums">{fmtTime(track.durationSec)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4 flex-shrink-0">
          <button
            onClick={previous}
            className="w-14 h-14 flex items-center justify-center rounded-2xl text-slate-400 hover:text-white hover:bg-white/10 active:scale-90 transition-[transform,background-color,color] duration-150"
          >
            <SkipBack className="w-6 h-6" />
          </button>
          <button
            onClick={togglePlayPause}
            className="w-20 h-20 flex items-center justify-center rounded-2xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 active:scale-95 text-white shadow-xl shadow-blue-600/30 transition-[transform,background-color] duration-150"
          >
            {playing ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8" />}
          </button>
          <button
            onClick={next}
            className="w-14 h-14 flex items-center justify-center rounded-2xl text-slate-400 hover:text-white hover:bg-white/10 active:scale-90 transition-[transform,background-color,color] duration-150"
          >
            <SkipForward className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );
});

/* ── QuickActions ────────────────────────────────────────── */

const QuickActions = memo(function QuickActions({
  actions,
  onLaunch,
}: {
  actions:  QuickAction[];
  onLaunch: (id: string) => void;
}) {
  if (actions.length === 0) return null;
  return (
    <div className="flex items-center gap-2 px-8 pb-3 flex-shrink-0">
      <span className="text-slate-700 text-[10px] uppercase tracking-widest font-medium mr-1 flex-shrink-0">
        Hızlı Eylem
      </span>
      {actions.map((action) => {
        const app = APP_MAP[action.appId];
        if (!app) return null;
        return (
          <button
            key={action.id}
            onClick={() => onLaunch(action.appId)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 active:scale-[0.95] transition-[transform,background-color,border-color] duration-150"
          >
            <span className="text-base leading-none">{app.icon}</span>
            <span className="text-slate-300 text-xs font-medium whitespace-nowrap">{action.label}</span>
          </button>
        );
      })}
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
    <div className="flex items-center gap-3 px-6 py-4 border-t border-white/5 flex-shrink-0">
      {dockIds.map((id) => {
        const app = APP_MAP[id];
        if (!app) return null;
        return (
          <button
            key={id}
            onClick={() => onLaunch(id)}
            className="flex-1 h-16 flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 active:scale-[0.95] active:bg-white/[0.12] transition-[transform,background-color,border-color] duration-150"
          >
            <span className="text-2xl leading-none">{app.icon}</span>
            <span className="text-slate-400 text-[10px] font-medium truncate px-1">{app.name}</span>
          </button>
        );
      })}

      <div className="w-px h-10 bg-white/5 mx-1 flex-shrink-0" />

      <button
        onClick={onOpenApps}
        className="flex-1 h-16 flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 active:scale-[0.95] transition-[transform,background-color,border-color] duration-150"
      >
        <LayoutGrid className="w-5 h-5 text-slate-400" />
        <span className="text-slate-400 text-[10px] font-medium">Uygulamalar</span>
      </button>

      <button
        onClick={onOpenSettings}
        className="flex-1 h-16 flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 active:scale-[0.95] transition-[transform,background-color,border-color] duration-150"
      >
        <SlidersHorizontal className="w-5 h-5 text-slate-400" />
        <span className="text-slate-400 text-[10px] font-medium">Ayarlar</span>
      </button>
    </div>
  );
});

/* ── VoiceBar ────────────────────────────────────────────── */

const VOICE_CHIPS = ['Eve git', 'Müziği aç', 'Haritayı aç', 'Ayarları aç'] as const;

const VoiceBar = memo(function VoiceBar() {
  const voice = useVoiceState();
  const [input, setInput] = useState('');

  const isListening = voice.status === 'listening';
  const isSuccess   = voice.status === 'success';
  const isError     = voice.status === 'error';

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    processTextCommand(text);
    setInput('');
  }, [input]);

  // Placeholder: rich feedback text for each status
  const placeholder =
    isError   ? (voice.error ?? 'Anlaşılamadı') :
    isSuccess ? `Anlaşıldı: ${voice.lastCommand?.feedback ?? ''}` :
    isListening ? 'Dinleniyor...' :
    'Bir komut söyle...';

  return (
    <div className="flex items-center gap-3 px-8 pb-3 flex-shrink-0">

      {/* Mic toggle */}
      <button
        onClick={startListening}
        className={`w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0 border transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-90 ${
          isListening ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-600/30' :
          isError     ? 'bg-red-500/10 border-red-500/20 text-red-400' :
          isSuccess   ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
          'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10 hover:text-white'
        }`}
      >
        <Mic className={`w-4 h-4 ${isListening ? 'animate-pulse' : ''}`} />
      </button>

      {/* Text input (demo) — native bypasses this via processTextCommand() */}
      <div
        className={`flex-1 flex items-center gap-2 h-10 px-3 rounded-xl border transition-[border-color,background-color] duration-150 ${
          isListening ? 'bg-blue-600/10 border-blue-500/30' :
          isError     ? 'bg-red-500/5 border-red-500/15' :
          isSuccess   ? 'bg-emerald-500/5 border-emerald-500/20' :
          'bg-white/5 border-white/5 focus-within:border-blue-500/30 focus-within:bg-white/[0.07]'
        }`}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={placeholder}
          style={{ userSelect: 'text' } as React.CSSProperties}
          className={`flex-1 bg-transparent text-sm outline-none ${
            isError   ? 'text-red-400 placeholder:text-red-400/70' :
            isSuccess ? 'placeholder:text-emerald-400/80 text-white' :
            'text-white placeholder:text-slate-600'
          }`}
        />
        {input && (
          <button
            onClick={submit}
            className="text-blue-400 text-xs font-semibold hover:text-blue-300 active:text-blue-200 transition-colors duration-150 flex-shrink-0"
          >
            Gönder
          </button>
        )}
      </div>

      {/* Chip area: suggestions on error, default hints otherwise */}
      <div className="hidden lg:flex items-center gap-1.5 flex-shrink-0">
        {isError && voice.suggestions.length > 0 ? (
          <>
            <span className="text-slate-700 text-[10px] mr-0.5 flex-shrink-0">Bunu mu demek istediniz?</span>
            {voice.suggestions.slice(0, 3).map((s) => (
              <button
                key={s.example}
                onClick={() => processTextCommand(s.example)}
                className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-medium hover:bg-amber-500/20 active:scale-95 transition-[transform,background-color,border-color] duration-150"
              >
                {s.label}
              </button>
            ))}
          </>
        ) : (
          VOICE_CHIPS.map((chip) => (
            <button
              key={chip}
              onClick={() => processTextCommand(chip)}
              className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/5 text-slate-500 text-[10px] font-medium hover:bg-white/10 hover:text-slate-300 hover:border-white/10 active:scale-95 transition-[transform,background-color,border-color,color] duration-150"
            >
              {chip}
            </button>
          ))
        )}
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
      className="flex flex-col h-full w-full overflow-hidden text-white"
      style={{ background: settings.theme === 'oled' ? '#000' : '#060d1a' }}
    >
      <BootSplash phase={bootPhase} />

      {/* Top bar */}
      <div className="flex items-center justify-between px-8 pt-6 pb-4 flex-shrink-0">
        <ClockArea use24Hour={settings.use24Hour} showSeconds={settings.showSeconds} />
        <DeviceStatusBar />
      </div>

      {/* Quick actions */}
      <QuickActions actions={smart.quickActions} onLaunch={handleLaunch} />

      {/* Voice bar */}
      <VoiceBar />

      {/* Hero */}
      <div className="flex flex-1 gap-5 px-8 pb-5 min-h-0">
        <NavHero
          defaultNav={settings.defaultNav}
          onLaunch={handleLaunch}
          navFlex={smart.layoutWeights.navFlex}
          drivingMode={smart.drivingMode}
        />
        <MediaPanel
          defaultMusic={settings.defaultMusic}
          onLaunch={handleLaunch}
          mediaFlex={smart.layoutWeights.mediaFlex}
        />
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
