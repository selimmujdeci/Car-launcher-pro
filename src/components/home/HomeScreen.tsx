import { useState, useEffect, useCallback, memo } from 'react';
import {
  Bluetooth, Wifi, WifiOff,
  BatteryFull, BatteryMedium, BatteryLow, BatteryCharging,
  Play, Pause, SkipBack, SkipForward, MapPin, Star as StarIcon,
} from 'lucide-react';
import { APP_MAP, NAV_OPTIONS, MUSIC_OPTIONS } from '../../data/apps';
import type { AppItem, NavOptionKey, MusicOptionKey } from '../../data/apps';
import { openNavigation, openMusic } from '../../platform/appLauncher';
import { useDeviceStatus } from '../../platform/deviceApi';
import { useMediaState, togglePlayPause, next, previous, fmtTime } from '../../platform/mediaService';

/* ── Clock hook ──────────────────────────────────────────── */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/* ── Saat + Tarih ────────────────────────────────────────── */
const Clock = memo(function Clock({ use24Hour, showSeconds }: { use24Hour: boolean; showSeconds: boolean }) {
  const now = useClock();
  const rawH = now.getHours();
  const h = use24Hour
    ? rawH.toString().padStart(2, '0')
    : ((rawH % 12) || 12).toString().padStart(2, '0');
  const m   = now.getMinutes().toString().padStart(2, '0');
  const s   = now.getSeconds().toString().padStart(2, '0');
  const ampm    = !use24Hour ? (rawH >= 12 ? 'PM' : 'AM') : '';
  const day     = now.getDate();
  const month   = now.toLocaleDateString('tr-TR', { month: 'long' });
  const year    = now.getFullYear();
  const weekday = now.toLocaleDateString('tr-TR', { weekday: 'long' });
  const dayStr  = weekday.charAt(0).toUpperCase() + weekday.slice(1);

  return (
    <div className="select-none">
      <div className="flex items-end gap-2 leading-none">
        <span
          className="text-[64px] font-thin tracking-tighter text-white tabular-nums"
          style={{ textShadow: '0 0 80px rgba(59,130,246,0.35), 0 0 20px rgba(59,130,246,0.15)' }}
        >
          {h}:{m}
        </span>
        {showSeconds && (
          <span className="text-[32px] font-thin text-slate-600 tabular-nums mb-2.5">{s}</span>
        )}
        {ampm && (
          <span className="text-[20px] font-light text-slate-500 mb-3.5">{ampm}</span>
        )}
      </div>
      <div className="flex items-baseline gap-2 mt-1.5">
        <span className="text-slate-200 text-base font-medium">{dayStr},</span>
        <span className="text-slate-500 text-sm font-light">{day} {month} {year}</span>
      </div>
    </div>
  );
});

/* ── Cihaz Durumu ────────────────────────────────────────── */
const StatusChip = memo(function StatusChip({
  icon: Icon,
  label,
  value,
  active,
  colorClass,
  bgClass,
}: {
  icon: typeof Bluetooth;
  label: string;
  value: string;
  active: boolean;
  colorClass: string;
  bgClass: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 min-w-0">
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${active ? bgClass : 'bg-white/5'}`}>
        <Icon className={`w-4 h-4 ${active ? colorClass : 'text-slate-600'}`} />
      </div>
      <div className="min-w-0 w-full text-center">
        <div className={`text-[11px] font-medium leading-tight truncate ${active ? 'text-slate-200' : 'text-slate-600'}`}>
          {value}
        </div>
        <div className="text-slate-600 text-[10px] leading-tight mt-0.5">{label}</div>
      </div>
    </div>
  );
});

const DeviceStatus = memo(function DeviceStatus() {
  const s = useDeviceStatus();

  // Skeleton while native data loads
  if (!s.ready) {
    return (
      <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className="w-8 h-8 rounded-xl bg-white/5 animate-pulse" />
            <div className="flex flex-col items-center gap-1 w-full">
              <div className="h-2.5 w-10 rounded-sm bg-white/5 animate-pulse" />
              <div className="h-2 w-7 rounded-sm bg-white/5 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const BattIcon = s.charging
    ? BatteryCharging
    : s.battery >= 80 ? BatteryFull
    : s.battery > 20  ? BatteryMedium
    : BatteryLow;

  const battColor = s.charging
    ? 'text-blue-400'
    : s.battery > 20 ? 'text-emerald-400' : 'text-red-400';
  const battBg = s.charging
    ? 'bg-blue-500/15'
    : s.battery > 20 ? 'bg-emerald-500/15' : 'bg-red-500/15';

  return (
    <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-3 gap-2">
      <StatusChip
        icon={Bluetooth}
        label="Bluetooth"
        value={s.btConnected ? (s.btDevice || 'Bağlı') : 'Kapalı'}
        active={s.btConnected}
        colorClass="text-blue-400"
        bgClass="bg-blue-500/15"
      />
      <StatusChip
        icon={s.wifiConnected ? Wifi : WifiOff}
        label="Wi-Fi"
        value={s.wifiConnected ? (s.wifiName || 'Bağlı') : 'Kapalı'}
        active={s.wifiConnected}
        colorClass="text-emerald-400"
        bgClass="bg-emerald-500/15"
      />
      <StatusChip
        icon={BattIcon}
        label={s.charging ? 'Şarj' : 'Pil'}
        value={`%${s.battery}`}
        active={s.battery > 20 || s.charging}
        colorClass={battColor}
        bgClass={battBg}
      />
    </div>
  );
});

/* ── Müzik Kartı ─────────────────────────────────────────── */
const MusicCard = memo(function MusicCard({ defaultMusic }: { defaultMusic: MusicOptionKey }) {
  const { playing, track } = useMediaState();
  const launch = useCallback(() => openMusic(defaultMusic), [defaultMusic]);
  const app = MUSIC_OPTIONS[defaultMusic];

  const progressPct = track.durationSec > 0
    ? Math.min(100, Math.round((track.positionSec / track.durationSec) * 100))
    : 0;

  return (
    <div className="h-full bg-[#0d1628] rounded-2xl shadow-xl border border-white/5 p-5 flex flex-col gap-3 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${playing ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
          <span className="text-slate-500 text-xs tracking-widest uppercase">Müzik</span>
        </div>
        <span className="text-slate-700 text-xs">{app.name}</span>
      </div>

      {/* Album art + track info */}
      <button onClick={launch} className="flex items-center gap-4 flex-shrink-0 w-full text-left active:opacity-70 transition-opacity duration-100">
        <div
          className="w-16 h-16 rounded-xl flex-shrink-0 flex items-center justify-center text-3xl shadow-lg"
          style={{ background: `linear-gradient(135deg, ${app.color}cc, ${app.color}44)` }}
        >
          {app.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-white text-lg font-semibold truncate leading-tight">
            {track.title || '—'}
          </div>
          <div className="text-slate-400 text-sm truncate mt-1 leading-tight">
            {track.artist || '—'}
          </div>
        </div>
      </button>

      {/* Progress */}
      <div className="flex-shrink-0">
        <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-[width] duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex justify-between text-slate-700 text-[10px] mt-1 tabular-nums">
          <span>{fmtTime(track.positionSec)}</span>
          <span>{fmtTime(track.durationSec)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-2.5 flex-1 min-h-0">
        <button
          onClick={previous}
          className="flex-1 rounded-xl bg-white/5 border border-white/5 text-white hover:bg-white/10 active:scale-95 transition-transform duration-150 flex items-center justify-center"
        >
          <SkipBack className="w-5 h-5" />
        </button>
        <button
          onClick={togglePlayPause}
          className="flex-[2] rounded-xl text-white hover:opacity-90 active:scale-95 active:opacity-80 transition-[transform,opacity] duration-150 shadow-lg flex items-center justify-center"
          style={{ background: app.color, boxShadow: `0 4px 20px ${app.color}40` }}
        >
          {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
        </button>
        <button
          onClick={next}
          className="flex-1 rounded-xl bg-white/5 border border-white/5 text-white hover:bg-white/10 active:scale-95 transition-transform duration-150 flex items-center justify-center"
        >
          <SkipForward className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
});

/* ── Navigasyon Kartı ────────────────────────────────────── */
const NavCard = memo(function NavCard({ defaultNav }: { defaultNav: NavOptionKey }) {
  const app = NAV_OPTIONS[defaultNav];
  const open = useCallback(() => openNavigation(defaultNav), [defaultNav]);

  return (
    <div className="h-full bg-[#0d1628] rounded-2xl shadow-xl border border-white/5 p-5 flex flex-col gap-3 overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
        <span className="text-slate-500 text-xs tracking-widest uppercase">Navigasyon</span>
      </div>

      {/* App info */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div
          className="w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center text-2xl shadow-md"
          style={{ background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)' }}
        >
          {app.icon}
        </div>
        <div className="min-w-0">
          <div className="text-white text-base font-semibold leading-tight">{app.name}</div>
          <div className="text-slate-500 text-xs mt-0.5">Varsayılan navigasyon</div>
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={open}
        className="flex-1 w-full rounded-xl bg-blue-600 text-white text-lg font-bold hover:bg-blue-500 active:scale-[0.97] active:bg-blue-700 transition-[transform,background-color] duration-150 shadow-lg shadow-blue-600/25 flex items-center justify-center gap-3"
      >
        <MapPin className="w-5 h-5 flex-shrink-0" />
        <span>Haritayı Aç</span>
      </button>
    </div>
  );
});

/* ── Favori Uygulamalar ──────────────────────────────────── */
const COL_CLASS: Record<number, string> = { 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5', 6: 'grid-cols-6' };

const FavApps = memo(function FavApps({
  ids,
  onLaunch,
  columns = 3,
}: {
  ids: string[];
  onLaunch: (id: string) => void;
  columns?: number;
}) {
  const favApps = ids.map((id) => APP_MAP[id]).filter(Boolean) as AppItem[];
  const isEmpty = favApps.length === 0;

  if (isEmpty) {
    return (
      <div className="h-full bg-[#0d1628] rounded-2xl shadow-xl border border-white/5 p-5 flex flex-col overflow-hidden">
        <span className="text-slate-500 text-xs tracking-widest uppercase flex-shrink-0 mb-3">Favoriler</span>
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center">
            <StarIcon className="w-5 h-5 text-slate-700" />
          </div>
          <div className="text-center">
            <div className="text-slate-400 text-xs font-medium mb-1">Favori yok</div>
            <div className="text-slate-700 text-[11px] leading-relaxed">
              Uygulamalar ekranından<br />yıldıza basarak ekle
            </div>
          </div>
        </div>
      </div>
    );
  }

  const displayed = favApps.slice(0, columns * 3);

  return (
    <div className="h-full bg-[#0d1628] rounded-2xl shadow-xl border border-white/5 p-4 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <span className="text-slate-500 text-xs tracking-widest uppercase">Favoriler</span>
        <span className="text-slate-700 text-xs tabular-nums">{favApps.length}</span>
      </div>
      <div className={`grid ${COL_CLASS[columns] ?? 'grid-cols-3'} gap-2.5 flex-1`}>
        {displayed.map((app) => (
          <button
            key={app.id}
            onClick={() => onLaunch(app.id)}
            className="flex flex-col items-center justify-center gap-2 py-2 rounded-xl active:scale-95 transition-transform duration-150 bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 overflow-hidden min-w-0 min-h-[44px]"
          >
            <span className="text-3xl leading-none">{app.icon}</span>
            <span className="text-slate-300 text-xs font-medium truncate w-full text-center px-1 leading-tight">{app.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

/* ── Son Kullanılanlar ───────────────────────────────────── */
const RecentApps = memo(function RecentApps({ ids, onLaunch }: { ids: string[]; onLaunch: (id: string) => void }) {
  const apps = ids.map((id) => APP_MAP[id]).filter(Boolean) as AppItem[];
  if (apps.length === 0) return null;

  return (
    <div className="flex-shrink-0 bg-[#0d1628] rounded-2xl border border-white/5 px-4 py-3.5">
      <div className="text-slate-500 text-xs tracking-widest uppercase mb-3">Son Kullanılanlar</div>
      <div className="flex gap-2">
        {apps.slice(0, 6).map((app) => (
          <button
            key={app.id}
            onClick={() => onLaunch(app.id)}
            className="flex-1 flex flex-col items-center gap-2 py-3.5 rounded-xl bg-white/5 border border-white/5 hover:bg-white/[0.08] hover:border-white/10 active:scale-95 transition-transform duration-150 min-w-0"
          >
            <span className="text-2xl leading-none">{app.icon}</span>
            <span className="text-slate-300 text-xs font-medium truncate w-full text-center px-1 leading-tight">{app.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

/* ── Ana bileşen ─────────────────────────────────────────── */
interface Props {
  favorites: string[];
  recentApps: string[];
  onLaunch: (id: string) => void;
  use24Hour: boolean;
  showSeconds: boolean;
  defaultNav: NavOptionKey;
  defaultMusic: MusicOptionKey;
}

function HomeScreen({ favorites, recentApps, onLaunch, use24Hour, showSeconds, defaultNav, defaultMusic }: Props) {
  return (
    <div className="h-full overflow-hidden flex flex-col gap-3 p-4">

      <div className="flex gap-3 flex-1 min-h-0">

        {/* Sol panel */}
        <div className="w-[38%] min-w-0 flex flex-col gap-3">
          <div className="bg-[#0d1628] rounded-2xl shadow-xl border border-white/5 p-5 flex-shrink-0 animate-slide-up">
            <Clock use24Hour={use24Hour} showSeconds={showSeconds} />
            <DeviceStatus />
          </div>
          <div className="flex-1 min-h-0 animate-slide-up" style={{ animationDelay: '60ms' }}>
            <FavApps ids={favorites} onLaunch={onLaunch} columns={3} />
          </div>
        </div>

        {/* Sağ panel */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="flex-[1] min-h-0 animate-slide-up" style={{ animationDelay: '30ms' }}>
            <NavCard defaultNav={defaultNav} />
          </div>
          <div className="flex-[1] min-h-0 animate-slide-up" style={{ animationDelay: '90ms' }}>
            <MusicCard defaultMusic={defaultMusic} />
          </div>
        </div>

      </div>

      <RecentApps ids={recentApps} onLaunch={onLaunch} />

    </div>
  );
}

export default memo(HomeScreen);
