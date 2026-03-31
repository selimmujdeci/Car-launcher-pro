import { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react';
import {
  Bluetooth, Wifi, WifiOff,
  BatteryFull, BatteryMedium, BatteryLow, BatteryCharging,
  Bell, MapPin, GripVertical,
  Search, Phone, User, Star,
} from 'lucide-react';
import {
  useContactsState,
  searchContacts,
  recordCall,
} from '../../platform/contactsService';
import { APP_MAP } from '../../data/apps';
import type { AppItem, MusicOptionKey } from '../../data/apps';
import { useDeviceStatus } from '../../platform/deviceApi';
import { MediaHub } from './MediaHub';
import { registerCommandHandler } from '../../platform/voiceService';
import type { ParsedCommand } from '../../platform/commandParser';
import { startNavigation } from '../../platform/navigationService';
import { getFavoriteAddresses } from '../../platform/addressBookService';
import { useNotificationState } from '../../platform/notificationService';
import { MiniMapWidget } from '../map/MiniMapWidget';
import { FullMapView } from '../map/FullMapView';
import { TPMSWidget } from '../obd/TPMSWidget';
import { VehicleReminderWidget } from './VehicleReminderWidget';
import { VehicleReminderModal } from '../modals/VehicleReminderModal';
import { useStore, type ParkingLocation } from '../../store/useStore';

/* ── useDragSort — pointer tabanlı sırala ────────────────── */

/**
 * Pointer event tabanlı sürükle-bırak sıralama.
 * Kullanım: itemRefs'e her widget'ın ref'ini ver, getHandlers(i) ile pointer
 * handlerlarını al. 600 ms basılı tutunca drag modu aktifleşir.
 */
function useDragSort(
  order: string[],
  onReorder: (next: string[]) => void,
) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragRef    = useRef<number | null>(null);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemRefs   = useRef<(HTMLDivElement | null)[]>([]);

  const cancelTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const resetDrag = useCallback(() => {
    cancelTimer();
    dragRef.current = null;
    setDragIndex(null);
    setOverIndex(null);
  }, [cancelTimer]);

  /** Pointer Y konumundan en yakın widget indeksini bul */
  const nearestIndex = useCallback((clientY: number): number => {
    let best = 0, bestDist = Infinity;
    itemRefs.current.forEach((el, i) => {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(clientY - (rect.top + rect.height / 2));
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    return best;
  }, []);

  const getHandlers = useCallback((index: number) => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        dragRef.current = index;
        setDragIndex(index);
        setOverIndex(index);
      }, 600);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragRef.current === null) return;
      setOverIndex(nearestIndex(e.clientY));
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      cancelTimer();
      if (dragRef.current === null) return;
      const from = dragRef.current;
      const to   = nearestIndex(e.clientY);
      resetDrag();
      if (from !== to) {
        const next = [...order];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        onReorder(next);
      }
    },
    onPointerCancel: resetDrag,
  }), [cancelTimer, nearestIndex, onReorder, order, resetDrag]);

  return { dragIndex, overIndex, itemRefs, getHandlers };
}

/* ── Clock hook ──────────────────────────────────────────── */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/* ── Bildirim Alanı ──────────────────────────────────────── */
const NotificationArea = memo(function NotificationArea() {
  const { notifications, unreadCount } = useNotificationState();

  const displayed = useMemo(() => notifications.slice(0, 5), [notifications]);

  function timeLabel(ts: number): string {
    const diffMin = Math.round((Date.now() - ts) / 60000);
    if (diffMin < 1)  return 'Şimdi';
    if (diffMin < 60) return `${diffMin} dk`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24)   return `${diffH} sa`;
    return `${Math.round(diffH / 24)} gün`;
  }

  return (
    <div className="flex flex-col gap-2 h-full bg-[#0d1628] rounded-2xl border border-white/5 p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-blue-400" />
          <span className="text-slate-500 text-xs tracking-widest uppercase">Bildirimler</span>
        </div>
        {unreadCount > 0 && (
          <span className="bg-blue-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            {unreadCount}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto pr-1">
        {displayed.length === 0 ? (
          <div className="text-slate-600 text-[11px] text-center py-4">Yeni bildirim yok</div>
        ) : (
          displayed.map((n) => (
            <div key={n.id} className="bg-white/5 rounded-xl p-3 border border-white/5 animate-slide-up">
              <div className="flex justify-between items-start mb-1">
                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">
                  {n.appIcon} {n.appName}
                </span>
                <span className="text-[9px] text-slate-400">{timeLabel(n.time)}</span>
              </div>
              <div className="text-[11px] font-bold text-white truncate">{n.sender}</div>
              <div className="text-[11px] text-slate-400 truncate leading-tight mt-0.5">{n.text}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
});

/* ── Saat + Tarih — Larger for Driving ───────────────────── */
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
      <div className="flex items-end gap-3 leading-none">
        <span
          className="text-[72px] font-black tracking-tighter text-white tabular-nums"
          style={{ textShadow: '0 0 60px rgba(59,130,246,0.4)' }}
        >
          {h}:{m}
        </span>
        {showSeconds && (
          <span className="text-[36px] font-bold text-slate-400 tabular-nums mb-3.5">{s}</span>
        )}
        {ampm && (
          <span className="text-[24px] font-black text-slate-400 mb-4.5">{ampm}</span>
        )}
      </div>
      <div className="flex items-baseline gap-3 mt-2">
        <span className="text-white text-xl font-black">{dayStr},</span>
        <span className="text-slate-400 text-lg font-bold">{day} {month} {year}</span>
      </div>
    </div>
  );
});

/* ── Cihaz Durumu — High Contrast ────────────────────────── */
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
    <div className="flex flex-col items-center gap-2 min-w-0">
      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 border-2 ${active ? `${bgClass} border-white/20` : 'bg-white/10 border-white/5'}`}>
        <Icon className={`w-5 h-5 ${active ? colorClass : 'text-slate-500'}`} />
      </div>
      <div className="min-w-0 w-full text-center">
        <div className={`text-[13px] font-black leading-tight truncate ${active ? 'text-white' : 'text-slate-500'}`}>
          {value}
        </div>
        <div className="text-slate-500 text-[11px] font-black uppercase tracking-wider mt-1">{label}</div>
      </div>
    </div>
  );
});

const DeviceStatus = memo(function DeviceStatus() {
  const s = useDeviceStatus();

  if (!s.ready) {
    return (
      <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-white/[0.07] border border-white/10 animate-pulse" />
            <div className="flex flex-col items-center gap-1.5 w-full">
              <div className="h-1.5 w-10 rounded-full bg-white/[0.07] animate-pulse" />
              <div className="h-1 w-6 rounded-full bg-white/[0.05] animate-pulse" />
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


/* ── Favori Uygulamalar ──────────────────────────────────── */
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
  const maxApps = columns * 3;
  const COL_CLASS: Record<number, string> = { 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' };
  const displayApps = favApps.slice(0, maxApps);

  /* Hiç favori yoksa yönlendirici empty state */
  if (displayApps.length === 0) {
    return (
      <div className="h-full bg-[#0d1628]/80 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/[0.08] p-4 flex flex-col items-center justify-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <Star className="w-6 h-6 text-amber-400/70" />
        </div>
        <div className="text-center">
          <div className="text-slate-300 text-[12px] font-bold uppercase tracking-widest">Henüz favori yok</div>
          <div className="text-slate-500 text-[10px] mt-1 leading-tight">Uygulamalar'da ★ ile favorilere ekle</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-[#0d1628]/80 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/5 p-4 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-3.5 flex-shrink-0 px-1">
        <div className="flex items-center gap-2">
          <div className="w-1 h-3 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
          <span className="text-slate-200 text-[11px] font-black tracking-[0.15em] uppercase">Favoriler</span>
        </div>
        <span className="text-slate-500 text-[10px] font-bold tabular-nums">
          {displayApps.length}/{maxApps}
        </span>
      </div>
      <div className={`grid ${COL_CLASS[columns] ?? 'grid-cols-3'} gap-2.5 flex-1`}>
        {displayApps.map((app) => (
          <button
            key={app.id}
            onClick={() => onLaunch(app.id)}
            className="group relative flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/[0.04] border border-white/[0.04] hover:bg-white/[0.08] hover:border-white/10 active:scale-90 transition-all duration-300 overflow-hidden shadow-lg"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <span className="text-3xl leading-none z-10 filter drop-shadow-md transform group-hover:scale-110 transition-transform duration-300">{app.icon}</span>
            <span className="text-slate-300 text-[10px] font-bold truncate w-full text-center px-1.5 leading-tight z-10 tracking-tight group-hover:text-white transition-colors">{app.name}</span>
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
            className="flex-1 flex flex-col items-center gap-2 py-3.5 rounded-xl bg-white/5 border border-white/5 hover:bg-white/[0.08] active:scale-95 transition-transform min-w-0"
          >
            <span className="text-2xl leading-none">{app.icon}</span>
            <span className="text-slate-300 text-xs font-medium truncate w-full text-center px-1 leading-tight">{app.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

/* ── Park Konumu ─────────────────────────────────────────── */
const ParkingWidget = memo(function ParkingWidget({ location }: { location: ParkingLocation }) {
  if (!location) return null;
  const timeStr = new Date(location.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  
  return (
    <div className="flex flex-col gap-2 bg-blue-600/10 border border-blue-500/20 rounded-2xl p-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <MapPin className="w-4 h-4 text-blue-400" />
        <span className="text-slate-500 text-[10px] tracking-widest uppercase">Park Konumu</span>
      </div>
      <div className="text-white text-xs font-bold truncate">Son Park: {timeStr}</div>
      <div className="text-slate-400 text-[10px] truncate">{location.lat.toFixed(4)}, {location.lng.toFixed(4)}</div>
    </div>
  );
});

/* ── Telefon Paneli ──────────────────────────────────────── */
const PhonePanel = memo(function PhonePanel() {
  const [query, setQuery] = useState('');
  const [dial,  setDial]  = useState('');
  const state = useContactsState();

  const shown = query
    ? searchContacts(query, 'name')
    : searchContacts('', 'recent').slice(0, 8);

  const handleCall = useCallback((id: string, number: string) => {
    recordCall(id);
    setDial(number);
    // Native: CarLauncher.launchApp({ androidAction: 'android.intent.action.CALL', data: `tel:${number}` })
    if (typeof window !== 'undefined') {
      window.open(`tel:${number.replace(/\s/g, '')}`, '_self');
    }
  }, []);

  function timeSince(ts?: number): string {
    if (!ts) return '';
    const diffMin = Math.round((Date.now() - ts) / 60000);
    if (diffMin < 60) return `${diffMin} dk önce`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return `${diffH} sa önce`;
    return `${Math.round(diffH / 24)} gün önce`;
  }

  return (
    <div className="h-full bg-[#0d1628] rounded-2xl shadow-xl border border-white/5 flex flex-col overflow-hidden">
      {/* Arama */}
      <div className="p-4 border-b border-white/5 bg-white/5 flex-shrink-0">
        <div className="flex items-center gap-3 bg-black/30 rounded-xl px-4 py-2 border border-white/5">
          <Search className="w-4 h-4 text-slate-500 flex-shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="bg-transparent border-none outline-none text-white text-sm w-full font-medium placeholder:text-slate-400"
            placeholder="Kişi veya numara ara…"
          />
        </div>
      </div>

      {/* Kişi listesi */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {state.loading && (
          <div className="text-slate-400 text-xs text-center py-4">Yükleniyor…</div>
        )}
        {!state.loading && shown.length === 0 && (
          <div className="text-slate-500 text-xs text-center py-4">Kişi bulunamadı</div>
        )}
        {shown.map((c) => {
          const phone = c.phones[0];
          return (
            <div
              key={c.id}
              className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors group"
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 border ${
                c.favorite ? 'bg-amber-500/10 border-amber-500/20' : 'bg-blue-500/10 border-blue-500/20'
              }`}>
                {c.avatar
                  ? <img src={c.avatar} alt="" className="w-full h-full rounded-full object-cover" />
                  : <User className={`w-5 h-5 ${c.favorite ? 'text-amber-400' : 'text-blue-400'}`} />
                }
              </div>
              <div className="flex-1 min-w-0 text-left">
                <div className="text-white text-sm font-bold truncate flex items-center gap-1">
                  {c.name}
                  {c.favorite && <Star className="w-3 h-3 text-amber-400 fill-current flex-shrink-0" />}
                </div>
                <div className="text-slate-500 text-[10px] truncate">
                  {phone?.number ?? '—'}
                  {c.lastCalled ? ` · ${timeSince(c.lastCalled)}` : ''}
                </div>
              </div>
              {phone ? (
                <button
                  onClick={() => handleCall(c.id, phone.number)}
                  className="w-9 h-9 rounded-xl flex items-center justify-center transition-all flex-shrink-0 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 active:scale-90 hover:bg-emerald-500/20"
                >
                  <Phone className="w-4 h-4 fill-current" />
                </button>
              ) : (
                <div className="w-9 h-9 flex-shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {/* Tuş takımı + arama göstergesi */}
      <div className="p-4 bg-white/5 border-t border-white/5 flex gap-2 flex-shrink-0">
        <div className="flex-1 bg-black/40 rounded-xl flex items-center px-4 h-12 font-black text-blue-400 tracking-widest overflow-hidden text-sm">
          {dial || 'NUMARA'}
        </div>
        <button
          onClick={() => { if (dial) window.open(`tel:${dial}`, '_self'); }}
          className="w-12 h-12 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-lg active:scale-95 transition-all"
        >
          <Phone className="w-5 h-5 fill-current" />
        </button>
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
  defaultMusic: MusicOptionKey;
}

function HomeScreen({ favorites, recentApps, onLaunch, use24Hour, showSeconds, defaultMusic }: Props) {
  const { settings, updateSettings } = useStore();
  const [fullMapOpen, setFullMapOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);

  useEffect(() => {
    const cleanup = registerCommandHandler((cmd: ParsedCommand) => {
      if (cmd.type === 'navigate_home') {
        const homeAddress = getFavoriteAddresses().find((a) => a.category === 'home');
        if (homeAddress) {
          startNavigation(homeAddress);
          setFullMapOpen(true);
        }
      }
      if (cmd.type === 'vehicle_maintenance') {
        setReminderOpen(true);
      }
    });
    return cleanup;
  }, []);

  /* ── Drag & Drop sıralama (her zaman aktif, kilit kapalıysa) ── */
  const handleReorder = useCallback((next: string[]) => {
    updateSettings({ widgetOrder: next });
  }, [updateSettings]);

  const { dragIndex, overIndex, itemRefs, getHandlers } = useDragSort(
    settings.widgetOrder,
    handleReorder,
  );

  /* ── Sağ panel alt satır widget render ────────────── */
  const WIDGET_LABELS: Record<string, string> = {
    music: 'Müzik',
    notifications: 'Bildirimler',
    phone: 'Telefon',
  };

  const renderWidget = useCallback((key: string) => {
    if (key === 'music') {
      return (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <MediaHub defaultMusic={defaultMusic} />
          {settings.parkingLocation && <ParkingWidget location={settings.parkingLocation} />}
        </div>
      );
    }
    if (key === 'notifications') {
      return <div className="flex-1 min-h-0"><NotificationArea /></div>;
    }
    if (key === 'phone') {
      return <div className="flex-1 min-h-0"><PhonePanel /></div>;
    }
    return null;
  }, [defaultMusic, settings.parkingLocation]);

  return (
    <>
      <div className="h-full overflow-hidden flex flex-col gap-3 p-4">
        <div className="flex gap-3 flex-1 min-h-0">
          {/* Sol panel */}
          <div className="w-[38%] min-w-0 flex flex-col gap-3">
            <div className="bg-[#0d1628] rounded-2xl shadow-xl border border-white/5 p-5 flex-shrink-0 animate-slide-up select-none">
              <Clock use24Hour={use24Hour} showSeconds={showSeconds} />
              <DeviceStatus />
            </div>
            <div className="flex-shrink-0 animate-slide-up" style={{ animationDelay: '40ms' }}>
              <TPMSWidget />
            </div>
            <div className="flex-shrink-0 animate-slide-up" style={{ animationDelay: '50ms' }}>
              <VehicleReminderWidget onOpen={() => setReminderOpen(true)} />
            </div>
            <div className="flex-1 min-h-0 animate-slide-up" style={{ animationDelay: '60ms' }}>
              <FavApps ids={favorites} onLaunch={onLaunch} columns={3} />
            </div>
          </div>

          {/* Sağ panel */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            <div className="flex-[1.2] min-h-0 animate-slide-up rounded-2xl overflow-hidden" style={{ animationDelay: '30ms' }}>
              <MiniMapWidget onFullScreenClick={() => setFullMapOpen(true)} />
            </div>

            {/* ── Alt satır: sürükle-bırak sıralama ── */}
            <div className="flex-1 min-h-0 flex flex-col gap-2">
                <div className="flex items-center gap-2 px-1 flex-shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500/50" />
                  <span className="text-slate-600 text-[9px] font-bold uppercase tracking-widest">
                    Basılı tut &amp; sürükle — sırala
                  </span>
                </div>

                {settings.widgetOrder.map((key, i) => {
                  const isDragging   = dragIndex === i;
                  const isDropTarget = overIndex === i && dragIndex !== null && dragIndex !== i;
                  const colorStyle = {};

                  return (
                    <div
                      key={key}
                      ref={(el) => { itemRefs.current[i] = el; }}
                      className={`
                        flex-1 min-h-0 relative rounded-2xl border transition-all duration-300 touch-none select-none overflow-hidden
                        ${isDragging
                          ? 'scale-[1.02] shadow-[0_0_32px_rgba(59,130,246,0.4)] border-blue-400 bg-blue-500/10 z-10'
                          : isDropTarget
                          ? 'border-blue-400/60 bg-blue-500/15 scale-[0.98]'
                          : 'border-white/[0.12] bg-[#0c1929]/90 shadow-md shadow-black/30'
                        }
                      `}
                      style={isDragging || isDropTarget ? {} : colorStyle}
                      {...getHandlers(i)}
                    >
                      {isDragging && (
                        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent pointer-events-none" />
                      )}

                      <div className={`
                        absolute top-2 right-2 z-20 w-9 h-9 flex items-center justify-center rounded-xl transition-all
                        ${isDragging ? 'bg-blue-500 text-white shadow-[0_0_14px_rgba(59,130,246,0.6)]' : 'bg-[#1a3050] text-blue-300 border-blue-800/60'}
                        border backdrop-blur-md shadow-lg
                      `}>
                        <GripVertical className="w-4 h-4" />
                      </div>

                      <div className="absolute top-3 left-4 z-20 flex items-center gap-2 pointer-events-none">
                        <div className={`w-1.5 h-1.5 rounded-full ${isDragging ? 'bg-blue-400' : 'bg-blue-400/50'}`} />
                        <span className={`text-[11px] font-black uppercase tracking-[0.15em] ${isDragging ? 'text-white' : 'text-slate-300'}`}>
                          {WIDGET_LABELS[key] ?? key}
                        </span>
                        {!isDragging && (
                          <span className="text-[8px] text-slate-600 font-medium normal-case">#{i + 1}</span>
                        )}
                      </div>

                      <div className={`h-full transition-all duration-300 ${isDragging ? 'opacity-40 blur-[2px] scale-95' : 'opacity-100'}`}>
                        {renderWidget(key)}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        <RecentApps ids={recentApps} onLaunch={onLaunch} />
      </div>

      {fullMapOpen && <FullMapView onClose={() => setFullMapOpen(false)} />}
      {reminderOpen && <VehicleReminderModal onClose={() => setReminderOpen(false)} />}
    </>
  );
}

export default memo(HomeScreen);
