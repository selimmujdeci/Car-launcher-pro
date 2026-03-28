import { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  Bluetooth, Wifi, WifiOff,
  BatteryFull, BatteryMedium, BatteryLow, BatteryCharging,
  Bell, MapPin, GripVertical, Check,
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
  const [notifications] = useState([
    { id: 1, app: 'WhatsApp', sender: 'Murat', text: 'Yola çıktın mı?', time: 'Şimdi' },
    { id: 2, app: 'Takvim', sender: 'Hatırlatıcı', text: 'Araç muayenesi yaklaşıyor', time: '10 dk' },
  ]);

  return (
    <div className="flex flex-col gap-2 h-full bg-[#0d1628] rounded-2xl border border-white/5 p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-blue-400" />
          <span className="text-slate-500 text-xs tracking-widest uppercase">Bildirimler</span>
        </div>
        <span className="bg-blue-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">2</span>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto pr-1">
        {notifications.map((n) => (
          <div key={n.id} className="bg-white/5 rounded-xl p-3 border border-white/5 animate-slide-up">
            <div className="flex justify-between items-start mb-1">
              <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">{n.app}</span>
              <span className="text-[9px] text-slate-600">{n.time}</span>
            </div>
            <div className="text-[11px] font-bold text-white truncate">{n.sender}</div>
            <div className="text-[11px] text-slate-400 truncate leading-tight mt-0.5">{n.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
});

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
  const COL_CLASS: Record<number, string> = { 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' };

  return (
    <div className="h-full bg-[#0d1628] rounded-2xl shadow-xl border border-white/5 p-4 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <span className="text-slate-500 text-xs tracking-widest uppercase">Favoriler</span>
        <span className="text-slate-700 text-xs tabular-nums">{favApps.length}</span>
      </div>
      <div className={`grid ${COL_CLASS[columns] ?? 'grid-cols-3'} gap-2.5 flex-1`}>
        {favApps.slice(0, columns * 3).map((app) => (
          <button
            key={app.id}
            onClick={() => onLaunch(app.id)}
            className="flex flex-col items-center justify-center gap-2 py-2 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 active:scale-95 transition-transform overflow-hidden"
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
            className="bg-transparent border-none outline-none text-white text-sm w-full font-medium placeholder:text-slate-600"
            placeholder="Kişi veya numara ara…"
          />
        </div>
      </div>

      {/* Kişi listesi */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {state.loading && (
          <div className="text-slate-600 text-xs text-center py-4">Yükleniyor…</div>
        )}
        {!state.loading && shown.length === 0 && (
          <div className="text-slate-700 text-xs text-center py-4">Kişi bulunamadı</div>
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
              <button
                onClick={() => phone && handleCall(c.id, phone.number)}
                disabled={!phone}
                className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 disabled:opacity-30 active:scale-90 transition-all flex-shrink-0"
              >
                <Phone className="w-4 h-4 fill-current" />
              </button>
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

  /* ── Edit mode toggle — saat alanına uzun bas ────── */
  const editTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClockPointerDown = useCallback(() => {
    editTimerRef.current = setTimeout(() => {
      editTimerRef.current = null;
      updateSettings({ editMode: true });
    }, 800);
  }, [updateSettings]);

  const handleClockPointerUp = useCallback(() => {
    if (editTimerRef.current) { clearTimeout(editTimerRef.current); editTimerRef.current = null; }
  }, []);

  /* ── Drag & Drop sıralama ─────────────────────────── */
  const handleReorder = useCallback((next: string[]) => {
    updateSettings({ widgetOrder: next });
  }, [updateSettings]);

  const { dragIndex, overIndex, itemRefs, getHandlers } = useDragSort(
    settings.widgetOrder,
    handleReorder,
  );

  const exitEditMode = useCallback(() => {
    updateSettings({ editMode: false });
  }, [updateSettings]);

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

  const editMode = settings.editMode;

  return (
    <>
      <div className="h-full overflow-hidden flex flex-col gap-3 p-4">
        <div className="flex gap-3 flex-1 min-h-0">
          {/* Sol panel */}
          <div className="w-[38%] min-w-0 flex flex-col gap-3">
            <div
              className="bg-[#0d1628] rounded-2xl shadow-xl border border-white/5 p-5 flex-shrink-0 animate-slide-up select-none touch-none"
              onPointerDown={handleClockPointerDown}
              onPointerUp={handleClockPointerUp}
              onPointerCancel={handleClockPointerUp}
              title="Widget düzenlemek için 1 sn basılı tut"
            >
              <Clock use24Hour={use24Hour} showSeconds={showSeconds} />
              <DeviceStatus />
            </div>

            {(settings.themePack === 'bmw' || settings.themePack === 'mercedes' || settings.themePack === 'big-cards') && (
              <div className="flex-shrink-0 animate-slide-up" style={{ animationDelay: '40ms' }}>
                <TPMSWidget />
              </div>
            )}

            <div className="flex-shrink-0 animate-slide-up" style={{ animationDelay: '50ms' }}>
              <VehicleReminderWidget onOpen={() => setReminderOpen(true)} />
            </div>

            <div className="flex-1 min-h-0 animate-slide-up" style={{ animationDelay: '60ms' }}>
              <FavApps ids={favorites} onLaunch={onLaunch} columns={3} />
            </div>
          </div>

          {/* Sağ panel */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            <div className="flex-[1.2] min-h-0 animate-slide-up" style={{ animationDelay: '30ms' }}>
              <MiniMapWidget onFullScreenClick={() => setFullMapOpen(true)} />
            </div>

            {/* ── Alt satır: normal veya düzenleme modu ── */}
            {editMode ? (
              /* Düzenleme modu — dikey sürükle-bırak listesi */
              <div className="flex-1 min-h-0 flex flex-col gap-2">
                {/* Başlık */}
                <div className="flex items-center justify-between px-1 flex-shrink-0">
                  <span className="text-slate-500 text-[10px] uppercase tracking-widest">
                    Widget Sırala
                  </span>
                  <button
                    onClick={exitEditMode}
                    className="flex items-center gap-1.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold px-3 py-1.5 rounded-xl active:scale-95 transition-transform"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Bitti
                  </button>
                </div>

                {/* Sürüklenebilir widget kartları */}
                {settings.widgetOrder.map((key, i) => {
                  const isDragging  = dragIndex === i;
                  const isDropTarget = overIndex === i && dragIndex !== null && dragIndex !== i;

                  return (
                    <div
                      key={key}
                      ref={(el) => { itemRefs.current[i] = el; }}
                      className={`
                        flex-1 min-h-0 relative rounded-2xl border transition-all duration-150 touch-none select-none
                        ${isDragging
                          ? 'scale-[1.02] shadow-2xl border-blue-400/40 z-10'
                          : isDropTarget
                          ? 'border-blue-400/30 bg-blue-500/5'
                          : 'border-transparent'
                        }
                      `}
                      {...getHandlers(i)}
                    >
                      {/* Drag tutacağı */}
                      <div className="absolute top-2 right-2 z-20 w-8 h-8 flex items-center justify-center rounded-xl bg-black/50 border border-white/10 text-slate-400 pointer-events-none">
                        <GripVertical className="w-4 h-4" />
                      </div>

                      {/* Widget adı etiketi */}
                      <div className="absolute top-2 left-3 z-20 text-[10px] font-black text-slate-400 uppercase tracking-widest pointer-events-none">
                        {WIDGET_LABELS[key] ?? key}
                      </div>

                      {/* Widget içeriği (dim görünüm) */}
                      <div className={`h-full transition-opacity ${isDragging ? 'opacity-70' : 'opacity-100'}`}>
                        {renderWidget(key)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Normal mod — widgetOrder'a göre yan yana */
              <div className="flex-1 min-h-0 flex gap-3">
                {settings.widgetOrder.slice(0, 2).map((key, i) => (
                  <div
                    key={key}
                    className={`min-h-0 animate-slide-up ${i === 0 ? 'flex-[1.5]' : 'flex-1'}`}
                    style={{ animationDelay: `${90 + i * 30}ms` }}
                  >
                    {renderWidget(key)}
                  </div>
                ))}
              </div>
            )}
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
