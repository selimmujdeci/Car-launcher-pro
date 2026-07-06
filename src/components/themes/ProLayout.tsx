import { memo, useEffect, useState, useMemo, useRef, lazy, Suspense, createContext, useContext } from 'react';
const VoiceAssistant = lazy(() => import('../modals/VoiceAssistant').then(m => ({ default: m.VoiceAssistant })));
import {
  Navigation, Maximize2, SkipBack, SkipForward, Play, Pause,
  Phone, Clock3, Mic, Bell, Wind, Settings, LayoutGrid,
  Map as MapIcon, Music2, Lock, Plug, Fan, ChevronRight,
  CornerUpRight, Snowflake, BatteryCharging, Plus, Check, X,
  AlertTriangle, Camera, Route, ShieldAlert, Shield, Tv2, Zap, Wrench, Gauge,
} from 'lucide-react';
import { safeGetRaw, safeSetRaw } from '../../utils/safeStorage';
import { useStore } from '../../store/useStore';
import { useClock } from '../../hooks/useClock';
import { useLivingThemeState } from '../../hooks/useLivingThemeState';
import { useDeviceStatus } from '../../platform/deviceApi';
import { StatusControls } from '../common/StatusControls';
import { useOBDState } from '../../platform/obdService';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import { useGPSLocation, resolveSpeedKmh } from '../../platform/gpsService';
import { useMediaState, togglePlayPause, startMediaHub, stopMediaHub } from '../../platform/mediaService';
import { next, previous, resumeLastMedia, previewLastMedia, seek } from '../../platform/media/carosMediaLayer';
import { ensureYouTubeReady } from '../../platform/youtubeService';
import { getPerformanceMode } from '../../platform/performanceMode';
import { useNotificationState } from '../../platform/notificationService';
import { openDrawer } from '../../platform/drawerBus';
import { openMusicDrawer } from '../../platform/mediaUi';
import type { DrawerType } from '../layout/DockBar';
import { useLayout } from '../../context/LayoutContext';
import { MiniMapWidget } from '../map/MiniMapWidget';
import type { AppItem } from '../../data/apps';
import type { SmartSnapshot } from '../../platform/smartEngine';
import { MagicContextCard } from '../common/MagicContextCard';

/* ════════════════════════════════════════════════════════════
   PRO LAYOUT — OEM CAM TILE DASHBOARD (gündüz / gece adaptif)
   Referans: aydınlık + gece HMI kartlı pano + yüzen cam dock.
   Palet day/night ile otomatik döner; aksan = soğuk mavi.
   ════════════════════════════════════════════════════════════ */

interface Pal {
  night: boolean;
  bg: string;
  card: string;        // cam kart yüzeyi
  cardSolid: string;   // opak kart (medya/araç)
  border: string;
  inkCritical: string;
  ink: string;
  ink2: string;
  ink3: string;
  accent: string;
  accentSoft: string;
  accentGlow: string;
  good: string;
  shadow: string;
  dockBg: string;
  dockBorder: string;
  tile: string;        // iç mini-kutu zemini
}

function buildPal(night: boolean): Pal {
  return night
    ? {
        night: true,
        // CarOS Night Collection — Pro = MBUX / BMW OS: SAF koyu ANTRASİT, en sade ve
        // en temiz tema. Nötr antrasit taban + ÇOK HAFİF mavi-grafit geçiş (üst-sağ küçük
        // glow). Horizon'ın laciverdinden ayrışsın diye taban nötr gri tutuldu; mavi yalnız
        // accent + minik parıltıda. Kurumsal, profesyonel, temiz.
        bg: 'radial-gradient(115% 85% at 72% -10%, #162232 0%, transparent 48%), linear-gradient(160deg,#0c0d11 0%,#101117 45%,#0a0b0e 100%)',
        card: 'rgba(30,34,43,0.74)',
        cardSolid: 'rgba(17,22,34,0.94)',
        border: '1px solid rgba(255,255,255,0.07)',
        inkCritical: '#FBFCFF',
        ink: '#eef2f8',
        ink2: 'rgba(225,231,242,0.66)',
        ink3: 'rgba(225,231,242,0.40)',
        accent: '#5b8dff',
        accentSoft: 'rgba(91,141,255,0.18)',
        accentGlow: 'rgba(91,141,255,0.40)',
        good: '#34d399',
        shadow: '0 18px 48px -22px rgba(0,0,0,0.72), 0 2px 10px rgba(0,0,0,0.45)',
        dockBg: 'rgba(16,21,33,0.62)',
        dockBorder: '1px solid rgba(255,255,255,0.09)',
        tile: 'rgba(255,255,255,0.05)',
      }
    : {
        night: false,
        // Hafif mavimsi serin zemin: sol-altta yumuşak mavi wash + sağ-üstte ışık.
        bg:
          'radial-gradient(88% 76% at 7% 113%, rgba(47,107,255,0.16) 0%, rgba(47,107,255,0.05) 32%, transparent 58%),' +
          'radial-gradient(120% 88% at 80% -12%, rgba(236,243,253,0.95) 0%, transparent 54%),' +
          'linear-gradient(160deg,#dbe4f1 0%,#e7eef7 46%,#e0e9f4 100%)',
        // Kart yüzeyleri neredeyse opak (güneşte saydamlık kontrastı düşürür) + hafif mavimsi
        card: 'linear-gradient(150deg, rgba(249,251,255,0.97) 0%, rgba(234,242,253,0.96) 100%)',
        cardSolid: 'linear-gradient(150deg, #f8fbff 0%, #e9f1fd 100%)',
        border: '1px solid rgba(47,107,255,0.18)',
        // Güneş okunabilirliği (WCAG AAA / ISO 15008): tam-opak koyu mürekkep,
        // ikincil/üçüncül yazılar da yüksek kontrast (sönük gri yok).
        inkCritical: '#05090F',
        ink: '#0c1420',
        ink2: 'rgba(16,26,42,0.88)',
        ink3: 'rgba(16,26,42,0.72)',
        accent: '#2f6bff',
        accentSoft: 'rgba(47,107,255,0.12)',
        accentGlow: 'rgba(47,107,255,0.28)',
        good: '#0e9f6e',
        shadow: '0 14px 34px -16px rgba(40,70,120,0.30), 0 2px 8px rgba(40,70,120,0.10)',
        dockBg: 'linear-gradient(150deg, rgba(249,251,255,0.84) 0%, rgba(232,241,253,0.80) 100%)',
        dockBorder: '1px solid rgba(47,107,255,0.20)',
        tile: 'rgba(47,107,255,0.08)',
      };
}

const PalCtx = createContext<Pal>(buildPal(false));
const usePal = () => useContext(PalCtx);

/* ─── ortak kart kabuğu ─────────────────────────────────────── */
function cardStyle(p: Pal, opts?: { solid?: boolean; pad?: number }): React.CSSProperties {
  return {
    background: opts?.solid ? p.cardSolid : p.card,
    border: p.border,
    borderRadius: 24,
    boxShadow: p.shadow,
    backdropFilter: 'blur(18px) saturate(1.25)',
    WebkitBackdropFilter: 'blur(18px) saturate(1.25)',
    padding: opts?.pad,
  };
}

function CardLabel({ children }: { children: React.ReactNode }) {
  const p = usePal();
  return (
    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: p.ink2 }}>
      {children}
    </div>
  );
}

/* ─── STATUS CLUSTER (bt / sinyal / wifi / batarya) ──────────── */
const StatusCluster = memo(function StatusCluster() {
  const p = usePal();
  const device = useDeviceStatus();
  // Living theme — bağlantı ekseni: online → yeşil nabız (.lt-pulse), offline →
  // soluk statik nokta. .lt-pulse Mali-400/static tier'da otomatik durur (index.css
  // guard'ı) → K24'te solid yeşil nokta, kasma yok.
  const online = useLivingThemeState().conn === 'online';
  return (
    <div className="flex items-center gap-2.5" style={{ color: p.ink2 }}>
      <span
        className={online ? 'lt-pulse' : undefined}
        aria-label={online ? 'Çevrimiçi' : 'Çevrimdışı'}
        style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: online ? '#34d399' : p.ink2,
          opacity:    online ? 1 : 0.4,
        }}
      />
      <StatusControls palette={{ ink: p.ink, ink2: p.ink2, accent: p.accent }} size={15} />
      <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: p.ink }}>
        {device.ready ? `${device.battery}%` : '—'}
      </span>
    </div>
  );
});

/* ─── CLOCK CARD ────────────────────────────────────────────── */
const ClockCard = memo(function ClockCard() {
  const p = usePal();
  const use24Hour = useStore(s => s.settings.use24Hour);
  const { time, date } = useClock(use24Hour, false);
  return (
    <div style={{ ...cardStyle(p), padding: '14px 16px' }} className="flex-shrink-0">
      <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color: p.ink, letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' }}>
        {time}
      </div>
      <div style={{ fontSize: 12, fontWeight: 500, color: p.ink2, marginTop: 5 }}>{date}</div>
    </div>
  );
});

/* ─── GAUGE CARD (hız halkası + menzil + mini medya) ────────── */
const GaugeCard = memo(function GaugeCard() {
  const p = usePal();
  const obd = useOBDState();
  const gps = useGPSLocation();
  const { playing, track } = useMediaState();
  const speedKmh = Math.round(resolveSpeedKmh(gps, obd.speed ?? 0));
  const range = obd.fuelLevel != null && obd.fuelLevel >= 0 ? Math.round((obd.fuelLevel / 100) * 750) : null;

  const R = 52, cx = 64, cy = 64, START = 135, SPAN = 270;
  const arc = useMemo(() => {
    const rad = (d: number) => (d * Math.PI) / 180;
    const pt = (a: number) => ({ x: cx + R * Math.cos(rad(a)), y: cy + R * Math.sin(rad(a)) });
    const build = (a1: number, a2: number) => {
      const s = pt(a1), e = pt(a2), large = a2 - a1 > 180 ? 1 : 0;
      return `M${s.x} ${s.y} A${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`;
    };
    const pct = Math.min(speedKmh / 200, 1);
    return { track: build(START, START + SPAN), fill: pct > 0.01 ? build(START, START + pct * SPAN) : null };
  }, [speedKmh]);

  return (
    <div style={{ ...cardStyle(p), padding: 14 }} className="flex-1 min-h-0 flex flex-col items-center justify-between">
      {/* Hız halkası */}
      <div style={{ position: 'relative', width: 128, height: 128 }}>
        <svg viewBox="0 0 128 128" width="128" height="128" style={{ overflow: 'visible' }}>
          <path d={arc.track} fill="none" stroke={p.tile} strokeWidth="9" strokeLinecap="round" />
          {arc.fill && (
            <path d={arc.fill} fill="none" stroke={p.accent} strokeWidth="9" strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 6px ${p.accentGlow})` }} />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span style={{ fontSize: 40, fontWeight: 800, color: p.inkCritical, lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-1px' }}>{speedKmh}</span>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.22em', color: p.ink3, marginTop: 2 }}>KM/S</span>
        </div>
      </div>

      {/* Sürüş modu + limit */}
      <div className="w-full flex items-center justify-between" style={{ marginTop: 4 }}>
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl" style={{ background: p.tile }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: p.accent }}>D</span>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: p.ink2 }}>AUTO</span>
        </div>
        <div className="flex flex-col items-center justify-center rounded-full" style={{ width: 34, height: 34, border: '2.5px solid #E0322B', background: p.cardSolid }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: p.ink, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>90</span>
        </div>
      </div>

      {/* Menzil */}
      <div className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl" style={{ background: p.tile }}>
        <BatteryCharging className="w-3.5 h-3.5" style={{ color: p.good }} />
        <span style={{ fontSize: 15, fontWeight: 800, color: p.ink, fontVariantNumeric: 'tabular-nums' }}>{range ?? '—'}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: p.ink2 }}>km</span>
      </div>

      {/* Mini medya */}
      <button onClick={() => openMusicDrawer()} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl active:scale-[0.98] transition-all"
        style={{ background: p.night ? 'rgba(91,141,255,0.10)' : 'rgba(47,107,255,0.07)', border: 'none', cursor: 'pointer' }}>
        <div className="flex items-end gap-[2px] h-4" style={{ flexShrink: 0 }}>
          {[0.5, 0.9, 0.6, 1].map((s, i) => (
            <div key={i} style={{ width: 2.5, height: `${s * 100}%`, background: p.accent, borderRadius: 1, animation: playing ? `proEq 0.9s ${i * 0.12}s ease-in-out infinite` : 'none', opacity: playing ? 1 : 0.5 }} />
          ))}
        </div>
        <span className="truncate" style={{ fontSize: 11, fontWeight: 600, color: p.ink2, textAlign: 'left', flex: 1 }}>
          {track.title || 'Müzik'}
        </span>
      </button>
    </div>
  );
});

/* ─── SETTINGS CARD (saat kartı stilinde, sol kolon altı) ───── */
const SettingsCard = memo(function SettingsCard({ onOpenSettings }: { onOpenSettings: () => void }) {
  const p = usePal();
  return (
    <button
      onClick={onOpenSettings}
      style={{ ...cardStyle(p), padding: '12px 14px' }}
      className="flex-shrink-0 w-full flex items-center gap-3 active:scale-[0.98] transition-all cursor-pointer"
    >
      <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 38, height: 38, background: p.tile }}>
        <Settings className="w-5 h-5" style={{ color: p.ink2 }} />
      </div>
      <div className="min-w-0 text-left">
        <div style={{ fontSize: 15, fontWeight: 800, color: p.ink, lineHeight: 1 }}>Ayarlar</div>
        <div className="truncate" style={{ fontSize: 11, fontWeight: 500, color: p.ink2, marginTop: 3 }}>Sistem · Tema</div>
      </div>
    </button>
  );
});

/* ─── NAV CARD (büyük harita + dönüş kartı) ─────────────────── */
const NavCard = memo(function NavCard({ onOpenMap, fullMapOpen }: { onOpenMap: () => void; fullMapOpen?: boolean }) {
  const p = usePal();
  return (
    <div onClick={onOpenMap} className="relative overflow-hidden cursor-pointer flex-1 min-h-0"
      style={{ borderRadius: 24, border: p.border, boxShadow: p.shadow }}>
      {/* Harita */}
      <div className="absolute inset-0">
        {fullMapOpen
          ? <div className="w-full h-full flex items-center justify-center" style={{ background: p.night ? '#0a1020' : '#dfe6ef' }}>
              <Navigation className="w-10 h-10" style={{ color: p.accent }} />
            </div>
          : <MiniMapWidget onFullScreenClick={onOpenMap} />}
      </div>

      {/* Üst başlık + büyüt */}
      <div className="absolute top-3 left-3 right-3 flex items-start justify-between pointer-events-none">
        <div className="px-3 py-2 rounded-2xl pointer-events-auto" style={{ ...cardStyle(p), padding: '10px 14px', borderRadius: 18 }}>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center rounded-xl" style={{ width: 38, height: 38, background: p.accent, boxShadow: `0 6px 16px ${p.accentGlow}` }}>
              <CornerUpRight className="w-5 h-5" style={{ color: '#fff' }} />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: p.inkCritical, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                2.4 <span style={{ fontSize: 13, fontWeight: 600, color: p.ink2 }}>km</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, color: p.ink2, marginTop: 2 }}>Sahil Yolu Cd.</div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-center rounded-xl pointer-events-auto" style={{ width: 34, height: 34, background: p.dockBg, border: p.dockBorder, backdropFilter: 'blur(8px)' }}>
          <Maximize2 className="w-4 h-4" style={{ color: p.ink2 }} />
        </div>
      </div>

      {/* Alt ETA şeridi */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 pointer-events-none">
        <div className="flex items-center gap-4 px-4 py-2.5 rounded-2xl pointer-events-auto" style={{ ...cardStyle(p), padding: '10px 16px', borderRadius: 16 }}>
          <div className="flex items-center gap-2">
            <Clock3 className="w-4 h-4" style={{ color: p.accent }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: p.ink }}>23 dk</span>
            <span style={{ fontSize: 12, color: p.ink3 }}>· 19:56</span>
          </div>
          <div style={{ width: 1, height: 16, background: p.border.includes('255') ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: p.ink2 }}>18 km</span>
          <div style={{ width: 1, height: 16, background: p.border.includes('255') ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)' }} />
          <div className="flex items-center gap-1.5">
            <BatteryCharging className="w-4 h-4" style={{ color: p.good }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: p.ink2 }}>EV kullanımı</span>
          </div>
        </div>
      </div>
    </div>
  );
});

/* ─── MUSIC CARD ────────────────────────────────────────────── */
const MusicCard = memo(function MusicCard() {
  const p = usePal();
  const { playing, track, hasSession } = useMediaState();
  // Dock drawer ile aynı kaynak: mount'ta son parçayı önizle (oturum yoksa).
  // YouTube IFrame oynatıcısını önceden ısıt → "son parçadan devam" tıklamasında
  // user-gesture korunur, autoplay engellenmez (cold-start await'i gesture'ı tüketirdi).
  useEffect(() => {
    startMediaHub();
    previewLastMedia();
    // Lite (low-end) modda iframe ısıtması boot'u bloklamasın → idle'a ertele.
    // Diğer modlarda hemen ısıt (ilk çalmada user-gesture korunur).
    if (getPerformanceMode() === 'lite') {
      const id = window.setTimeout(() => { void ensureYouTubeReady().catch(() => {}); }, 4000);
      return () => { window.clearTimeout(id); stopMediaHub(); };
    }
    void ensureYouTubeReady().catch(() => {});
    return () => stopMediaHub();
  }, []);

  const elapsed = track.positionSec || 0;
  const total = track.durationSec || 0;
  const pct = total > 0 ? Math.min((elapsed / total) * 100, 100) : 0;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // Play: aktif oturum varsa duraklat/sürdür; boştaysa son parçayı sürdür, o da yoksa müzik drawer'ını aç.
  const handlePlay = () => {
    if (hasSession) togglePlayPause();
    else if (!resumeLastMedia()) openMusicDrawer();
  };

  // İlerleme çubuğu — dokun/sürükle ile sarma (seek)
  const barRef = useRef<HTMLDivElement>(null);
  const [dragPct, setDragPct] = useState<number | null>(null);
  const ratioFromX = (clientX: number) => {
    const el = barRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
  };
  const onBarDown = (e: React.PointerEvent) => {
    if (total <= 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragPct(ratioFromX(e.clientX) * 100);
  };
  const onBarMove = (e: React.PointerEvent) => {
    if (dragPct == null) return;
    setDragPct(ratioFromX(e.clientX) * 100);
  };
  const onBarUp = (e: React.PointerEvent) => {
    if (dragPct == null) return;
    e.stopPropagation();
    seek(ratioFromX(e.clientX) * total);
    setDragPct(null);
  };
  const shownPct = dragPct ?? pct;

  return (
    <div style={{ ...cardStyle(p), padding: 16 }} className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <CardLabel>Müzik</CardLabel>
        <StatusCluster />
      </div>
      {/* Albüm alanı — dokununca müzik kütüphanesi açılır */}
      <button onClick={() => openMusicDrawer()} className="flex items-center gap-3.5 flex-1 min-h-0 bg-transparent border-none cursor-pointer text-left p-0">
        <div className="rounded-2xl overflow-hidden flex items-center justify-center flex-shrink-0" style={{ width: 74, height: 74, background: 'linear-gradient(135deg,#7c3aed,#db2777 60%,#f97316)', boxShadow: `0 10px 24px ${p.night ? 'rgba(124,58,237,0.45)' : 'rgba(124,58,237,0.30)'}` }}>
          {track.albumArt ? <img src={track.albumArt} className="w-full h-full object-cover" alt="" /> : <Music2 className="w-7 h-7" style={{ color: 'rgba(255,255,255,0.9)' }} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="truncate" style={{ fontSize: 18, fontWeight: 800, color: p.ink }}>{track.title || 'Çalmıyor'}</div>
          <div className="truncate" style={{ fontSize: 13, color: p.ink2, marginTop: 2 }}>{track.artist || 'Oynatmak için dokun'}</div>
        </div>
      </button>
      <div className="mt-3">
        <div
          ref={barRef}
          onPointerDown={onBarDown}
          onPointerMove={onBarMove}
          onPointerUp={onBarUp}
          className="relative mb-1.5"
          style={{ paddingTop: 7, paddingBottom: 7, cursor: total > 0 ? 'pointer' : 'default', touchAction: 'none' }}
        >
          <div className="h-[4px] rounded-full overflow-hidden" style={{ background: p.tile }}>
            <div style={{ height: '100%', width: `${shownPct}%`, background: p.accent, borderRadius: 999, transition: dragPct == null ? 'width 0.4s linear' : 'none' }} />
          </div>
          {total > 0 && (
            <div className="absolute rounded-full" style={{ top: '50%', left: `${shownPct}%`, transform: 'translate(-50%,-50%)', width: 12, height: 12, background: p.accent, boxShadow: `0 0 0 3px ${p.accentSoft}, 0 1px 3px rgba(0,0,0,0.3)`, pointerEvents: 'none' }} />
          )}
        </div>
        <div className="flex items-center justify-between">
          <span style={{ fontSize: 11, color: p.ink3, fontVariantNumeric: 'tabular-nums' }}>{total > 0 ? fmt(dragPct != null ? (dragPct / 100) * total : elapsed) : '--:--'}</span>
          <div className="flex items-center gap-4">
            <button onClick={(e) => { e.stopPropagation(); previous(); }} className="active:scale-90 transition-all bg-transparent border-none cursor-pointer" style={{ color: p.ink2 }}><SkipBack className="w-5 h-5" /></button>
            <button onClick={(e) => { e.stopPropagation(); handlePlay(); }} className="flex items-center justify-center rounded-full active:scale-90 transition-all cursor-pointer" style={{ width: 42, height: 42, background: p.accent, boxShadow: `0 6px 18px ${p.accentGlow}`, border: 'none' }}>
              {playing ? <Pause className="w-5 h-5" style={{ fill: '#fff', color: '#fff' }} /> : <Play className="w-5 h-5 ml-0.5" style={{ fill: '#fff', color: '#fff' }} />}
            </button>
            <button onClick={(e) => { e.stopPropagation(); next(); }} className="active:scale-90 transition-all bg-transparent border-none cursor-pointer" style={{ color: p.ink2 }}><SkipForward className="w-5 h-5" /></button>
          </div>
          <span style={{ fontSize: 11, color: p.ink3, fontVariantNumeric: 'tabular-nums' }}>{total > 0 ? fmt(total) : '--:--'}</span>
        </div>
      </div>
    </div>
  );
});

/* ─── NEW VECTOR SUV (gündüz/gece) ──────────────────────────── */
function VehicleSVG({ p }: { p: Pal }) {
  const body = p.night ? '#d6dce6' : '#e8edf4';
  const bodyDeep = p.night ? '#aab4c4' : '#c7d0dd';
  const glass = p.night ? 'rgba(91,141,255,0.30)' : 'rgba(47,107,255,0.16)';
  const wheel = p.night ? '#0c1018' : '#2a3140';
  return (
    <svg viewBox="0 0 240 110" width="100%" height="100%" style={{ maxWidth: 230 }}>
      <defs>
        <linearGradient id="proSuvBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={p.night ? 0.95 : 1} />
          <stop offset="55%" stopColor={body} />
          <stop offset="100%" stopColor={bodyDeep} />
        </linearGradient>
        <radialGradient id="proSuvGnd" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={p.accent} stopOpacity="0.16" />
          <stop offset="100%" stopColor={p.accent} stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* zemin yansıması */}
      <ellipse cx="120" cy="98" rx="100" ry="9" fill="url(#proSuvGnd)" />
      {/* gövde — modern crossover silüeti */}
      <path d="M14,74 C14,64 20,60 30,58 C40,42 58,32 84,30 L150,30 C172,30 192,40 206,54 C218,56 226,62 226,72 L226,80 C226,84 223,86 219,86 L21,86 C17,86 14,83 14,79 Z" fill="url(#proSuvBody)" stroke={bodyDeep} strokeWidth="0.6" />
      {/* cam / kabin */}
      <path d="M62,34 C72,32 80,31 92,31 L146,31 C162,31 176,38 188,50 L70,50 C66,50 63,48 62,44 Z" fill={glass} stroke="rgba(255,255,255,0.4)" strokeWidth="0.6" />
      <line x1="118" y1="31" x2="118" y2="50" stroke={p.night ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.10)'} strokeWidth="0.8" />
      {/* kapı çizgisi */}
      <path d="M70,52 L196,52" stroke={p.night ? 'rgba(0,0,0,0.14)' : 'rgba(0,0,0,0.08)'} strokeWidth="0.8" />
      {/* far */}
      <path d="M206,56 L222,60 L222,66 L204,63 Z" fill={p.night ? 'rgba(140,180,255,0.85)' : 'rgba(255,250,220,0.9)'} />
      {/* stop lambası */}
      <path d="M16,60 L15,68 L22,70 L24,62 Z" fill="#E0322B" opacity="0.8" />
      {/* tekerlekler */}
      {[64, 176].map((wx) => (
        <g key={wx}>
          <circle cx={wx} cy="86" r="16" fill={wheel} />
          <circle cx={wx} cy="86" r="9" fill={p.night ? '#161c28' : '#3a4254'} />
          <circle cx={wx} cy="86" r="3.4" fill={p.night ? '#222a3a' : '#525c70'} />
          <g stroke={p.night ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.5)'} strokeWidth="1.3">
            <line x1={wx} y1="78" x2={wx} y2="94" /><line x1={wx - 8} y1="86" x2={wx + 8} y2="86" />
            <line x1={wx - 6} y1="80" x2={wx + 6} y2="92" /><line x1={wx - 6} y1="92" x2={wx + 6} y2="80" />
          </g>
        </g>
      ))}
    </svg>
  );
}

/* ─── VEHICLE STATUS CARD ───────────────────────────────────── */
/* Living theme — araç durumu görseli (STATİK renk; animasyon yok → her tier'da
   çalışır, K24'te bile bedava). Yeni global token açılmaz; amber/kırmızı gece+gündüz
   ikisinde de okunur. obd-offline → soluk kart (uyarı değil, "veri yok"). */
const VEH_STATUS: Record<
  string,
  { label: string; color: (p: Pal) => string; accent: string | null; dim: boolean }
> = {
  normal:        { label: 'Normal',             color: (p) => p.ink,  accent: null,      dim: false },
  'fuel-low':    { label: 'Yakıt Düşük',        color: () => '#f59e0b', accent: '#f59e0b', dim: false },
  'temp-high':   { label: 'Motor Isısı Yüksek', color: () => '#ef4444', accent: '#ef4444', dim: false },
  'obd-offline': { label: 'OBD Bağlı Değil',    color: (p) => p.ink3, accent: null,      dim: true  },
};

const VehicleCard = memo(function VehicleCard({ onOpenSettings, onLaunch }: { onOpenSettings: () => void; onLaunch: (id: string) => void }) {
  const p = usePal();
  const obd = useOBDState();
  // Living theme — araç durumu ekseni (eşikler: fuel<=12, engineTemp>=105, OBD yok/stale).
  const { veh } = useLivingThemeState();
  const st = VEH_STATUS[veh] ?? VEH_STATUS.normal;
  const battery = obd.fuelLevel != null && obd.fuelLevel >= 0 ? Math.round(obd.fuelLevel) : 78;
  const range = obd.fuelLevel != null && obd.fuelLevel >= 0 ? Math.round((obd.fuelLevel / 100) * 750) : 320;
  // Odometre — GPS'ten beslenir (OBD'siz de çalışır), TEK kaynak useVehicleStore.odometer.
  const odometer = useUnifiedVehicleStore(s => s.odometer);

  const toggles = [
    { Icon: Lock, label: 'KİLİT', fn: onOpenSettings },
    { Icon: Fan, label: 'HAVALANDIR', fn: () => openDrawer('climate') },
    { Icon: Plug, label: 'ŞARJ', fn: onOpenSettings },
    { Icon: Settings, label: 'AYAR', fn: onOpenSettings },
  ];

  return (
    <div style={{ ...cardStyle(p, { solid: true }), padding: 16, opacity: st.dim ? 0.6 : 1 }} className="flex-1 min-h-0 flex flex-col">
      {/* Durum şeridi — uyarı/tehlikede ince statik renk (box-shadow/blur YOK, Mali-safe) */}
      {st.accent && (
        <div style={{ height: 3, borderRadius: 2, background: st.accent, marginBottom: 8, opacity: 0.9 }} />
      )}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <CardLabel>Araç Durumu</CardLabel>
          <ChevronRight className="w-3.5 h-3.5" style={{ color: p.ink3 }} />
        </div>
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: st.color(p), marginTop: 4 }}>{st.label}</div>

      <div className="flex-1 min-h-0 flex items-center gap-3 my-1">
        <div className="flex-1 flex items-center justify-center min-w-0"><VehicleSVG p={p} /></div>
        <div className="flex flex-col gap-2 flex-shrink-0" style={{ minWidth: 88 }}>
          <Stat p={p} icon={<BatteryCharging className="w-4 h-4" style={{ color: p.good }} />} value={`${battery}%`} label="Batarya" />
          <Stat p={p} icon={<Snowflake className="w-4 h-4" style={{ color: p.accent }} />} value="2.5 bar" label="Lastik" />
          <Stat p={p} icon={<Navigation className="w-4 h-4" style={{ color: p.ink2 }} />} value={`${range} km`} label="Menzil" />
          <Stat p={p} icon={<Gauge className="w-4 h-4" style={{ color: p.ink2 }} />} value={`${Math.round(odometer)} km`} label="Kilometre" />
        </div>
      </div>

      <div className="flex items-center justify-between pt-3" style={{ borderTop: p.border, gap: 6 }} onClick={e => e.stopPropagation()}>
        {toggles.map(({ Icon, label, fn }) => (
          <button key={label} onClick={fn} className="flex flex-col items-center gap-1.5 flex-1 active:scale-95 transition-all bg-transparent border-none cursor-pointer">
            <div className="flex items-center justify-center rounded-xl" style={{ width: 38, height: 38, background: p.tile }}>
              <Icon className="w-4 h-4" style={{ color: p.ink2 }} />
            </div>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', color: p.ink2 }}>{label}</span>
          </button>
        ))}
      </div>
      {/* youtube/monitor erişimi gizli koru */}
      <span className="hidden" onClick={() => onLaunch('youtube')} />
    </div>
  );
});

function Stat({ p, icon, value, label }: { p: Pal; icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <div>
        <div style={{ fontSize: 14, fontWeight: 800, color: p.ink, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        <div style={{ fontSize: 10, fontWeight: 700, color: p.ink2 }}>{label}</div>
      </div>
    </div>
  );
}

/* ─── DOCK (yüzen cam hap) ──────────────────────────────────── */
/** "Daha Fazla" içinde açılan ikincil drawer kısayolları */
const MORE_ITEMS: { label: string; color: string; Icon: typeof MapIcon; drawer: DrawerType }[] = [
  { label: 'Trafik', color: '#f4b740', Icon: AlertTriangle, drawer: 'traffic' },
  { label: 'Dashcam', color: '#a78bfa', Icon: Camera, drawer: 'dashcam' },
  { label: 'Seyir', color: '#34d399', Icon: Route, drawer: 'triplog' },
  { label: 'Arıza', color: '#f87171', Icon: ShieldAlert, drawer: 'dtc' },
  { label: 'Bakım', color: '#fb923c', Icon: Wrench, drawer: 'vehicle-reminder' },
  { label: 'Güvenlik', color: '#60a5fa', Icon: Shield, drawer: 'security' },
  { label: 'Eğlence', color: '#f472b6', Icon: Tv2, drawer: 'entertainment' },
  { label: 'Sport', color: '#fb7185', Icon: Zap, drawer: 'sport' },
];

const DOCK_APPS_KEY = 'proDockApps';
function loadDockApps(): string[] {
  try { const r = safeGetRaw(DOCK_APPS_KEY); return r ? (JSON.parse(r) as string[]) : []; } catch { return []; }
}

const ProDock = memo(function ProDock({ onOpenMap, onVoice, onOpenApps, onOpenSettings, appMap, onLaunch }: {
  onOpenMap: () => void; onVoice: () => void; onOpenApps: () => void; onOpenSettings: () => void;
  appMap: Record<string, AppItem>; onLaunch: (id: string) => void;
}) {
  const p = usePal();
  const n = useNotificationState();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [dockApps, setDockApps] = useState<string[]>(loadDockApps);

  const toggleApp = (id: string) => {
    setDockApps(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      try { safeSetRaw(DOCK_APPS_KEY, JSON.stringify(next)); } catch { /* yoksay */ }
      return next;
    });
  };

  // Uzun-basma → düzenleme modu (tutup silme)
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpFired = useRef(false);
  const startLongPress = () => {
    lpFired.current = false;
    lpTimer.current = setTimeout(() => { lpFired.current = true; setEditMode(true); }, 500);
  };
  const cancelLongPress = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; } };
  useEffect(() => () => cancelLongPress(), []);

  // Yatay kaydırma: dokunmatik native; fare için tekerlek→yatay + sürükle-kaydır
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ down: false, startX: 0, startLeft: 0, moved: false });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (d !== 0) { el.scrollLeft += d; e.preventDefault(); }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const onDragStart = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return; // dokunmatik native scroll kullanır
    drag.current = { down: true, startX: e.clientX, startLeft: scrollRef.current?.scrollLeft ?? 0, moved: false };
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.down || !scrollRef.current) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 5) d.moved = true;
    scrollRef.current.scrollLeft = d.startLeft - dx;
  };
  const onDragEnd = () => { drag.current.down = false; };
  // Sürükleme sonrası yanlışlıkla tıklamayı (uygulama açma/drawer) bastır
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current.moved) { e.stopPropagation(); e.preventDefault(); drag.current.moved = false; }
  };

  // Tüm sabit fonksiyon butonları (birincil + ikincil drawer'lar) inline
  const items: { label: string; color: string; Icon: typeof MapIcon; fn: () => void; badge?: number; accent?: boolean }[] = [
    { label: 'Harita', color: '#3b82f6', Icon: MapIcon, fn: onOpenMap },
    { label: 'Müzik', color: '#ec4899', Icon: Music2, fn: () => openMusicDrawer() },
    { label: 'Asistan', color: '#8b5cf6', Icon: Mic, fn: onVoice, accent: true },
    { label: 'Telefon', color: '#22c55e', Icon: Phone, fn: () => openDrawer('phone') },
    { label: 'Bildirim', color: '#f59e0b', Icon: Bell, fn: () => openDrawer('notifications'), badge: n.unreadCount },
    { label: 'Araç', color: '#64748b', Icon: Navigation, fn: () => openDrawer('vehicle-reminder') },
    { label: 'İklim', color: '#14b8a6', Icon: Wind, fn: () => openDrawer('climate') },
    { label: 'Menü', color: '#3b82f6', Icon: LayoutGrid, fn: onOpenApps },
    ...MORE_ITEMS.map(m => ({ label: m.label, color: m.color, Icon: m.Icon, fn: () => openDrawer(m.drawer) })),
  ];
  void onOpenSettings;

  const allApps = Object.values(appMap ?? {});
  // Büyük dock öğesi
  const TILE_W = 94, TILE_H = 84, ICON = 32;

  const tileBtn = "relative flex flex-col items-center justify-center gap-2 rounded-2xl active:scale-90 transition-all border-none cursor-pointer flex-shrink-0";
  const labelStyle: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, letterSpacing: '0.02em', color: p.ink2, maxWidth: TILE_W - 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

  return (
    <div className="relative w-full" style={{ zIndex: editMode ? 95 : undefined }}>
      {/* Düzenleme modu — dışarı dokununca çık */}
      {editMode && <div className="fixed inset-0" style={{ zIndex: 90 }} onClick={() => setEditMode(false)} />}

      {/* Uygulama ekleme picker — dock'un üstünde, sağda cam panel */}
      {pickerOpen && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 90 }} onClick={() => setPickerOpen(false)} />
          <div className="absolute rounded-3xl p-3"
            style={{ right: 6, bottom: 'calc(100% + 10px)', zIndex: 91, width: 'min(440px, 92vw)', background: p.dockBg, border: p.dockBorder, backdropFilter: 'blur(22px) saturate(1.3)', WebkitBackdropFilter: 'blur(22px) saturate(1.3)', boxShadow: p.shadow }}>
            <div className="flex items-center justify-between mb-2 px-1">
              <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: p.ink2 }}>Dock'a Uygulama Ekle</span>
              <button onClick={() => setPickerOpen(false)} className="bg-transparent border-none cursor-pointer" style={{ fontSize: 12, fontWeight: 700, color: p.accent }}>Bitti</button>
            </div>
            <div className="pro-dock-scroll grid grid-cols-4 gap-1.5" style={{ maxHeight: 240, overflowY: 'auto', scrollbarWidth: 'none' }}>
              {allApps.map(a => {
                const on = dockApps.includes(a.id);
                return (
                  <button key={a.id} onClick={() => toggleApp(a.id)}
                    className="relative flex flex-col items-center justify-center gap-1.5 rounded-2xl active:scale-90 transition-all border-none cursor-pointer"
                    style={{ height: 70, background: on ? p.accentSoft : 'transparent' }}>
                    <span style={{ fontSize: 24, lineHeight: 1 }}>{a.icon}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: p.ink2, maxWidth: 78, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                    {on && (
                      <span className="absolute flex items-center justify-center rounded-full" style={{ top: 4, right: 8, width: 16, height: 16, background: p.accent }}>
                        <Check style={{ width: 11, height: 11, color: '#fff' }} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Tam genişlik, yatay kaydırmalı dock */}
      <div
        ref={scrollRef}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerLeave={onDragEnd}
        onClickCapture={onClickCapture}
        className="pro-dock-scroll flex items-center gap-1.5 px-3 py-3.5 rounded-3xl w-full"
        style={{
          background: p.dockBg, border: p.dockBorder,
          backdropFilter: 'blur(22px) saturate(1.3)', WebkitBackdropFilter: 'blur(22px) saturate(1.3)',
          boxShadow: p.shadow,
          overflowX: 'auto', overflowY: 'hidden',
          scrollbarWidth: 'none', msOverflowStyle: 'none',
          cursor: 'grab', touchAction: 'pan-x',
          position: 'relative', zIndex: 91, // editMode kapatma katmanının (z90) üstünde kalsın → × tıklanabilir
        }}
      >
        {items.map((it, i) => (
          <button key={i} onClick={it.fn} className={tileBtn}
            style={{ width: TILE_W, height: TILE_H, background: it.accent ? p.accentSoft : 'transparent' }}>
            <it.Icon style={{ width: ICON, height: ICON, color: it.accent ? p.accent : it.color }} />
            <span style={labelStyle}>{it.label}</span>
            {!!it.badge && (
              <span className="absolute" style={{ top: 6, right: 16, minWidth: 16, height: 16, background: '#f43f5e', color: '#fff', fontSize: 9, fontWeight: 800, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                {it.badge > 9 ? '9+' : it.badge}
              </span>
            )}
          </button>
        ))}

        {/* Kullanıcının eklediği uygulamalar — tutup silme (uzun-basma → düzenleme modu) */}
        {dockApps.map(id => {
          const a = appMap?.[id];
          if (!a) return null;
          return (
            <button
              key={id}
              onClick={() => { if (lpFired.current || editMode) { lpFired.current = false; return; } onLaunch(id); }}
              onPointerDown={startLongPress}
              onPointerUp={cancelLongPress}
              onPointerLeave={cancelLongPress}
              onContextMenu={(e) => { e.preventDefault(); setEditMode(true); }}
              className={tileBtn}
              style={{ width: TILE_W, height: TILE_H, animation: editMode ? 'proWiggle 0.3s ease-in-out infinite' : 'none' }}
            >
              <span style={{ fontSize: ICON, lineHeight: 1 }}>{a.icon}</span>
              <span style={labelStyle}>{a.name}</span>
              {editMode && (
                <span
                  onClick={(e) => { e.stopPropagation(); toggleApp(id); }}
                  className="absolute flex items-center justify-center rounded-full"
                  style={{ top: 2, left: 8, width: 18, height: 18, background: '#f43f5e', boxShadow: '0 2px 6px rgba(0,0,0,0.3)', cursor: 'pointer' }}
                >
                  <X style={{ width: 12, height: 12, color: '#fff' }} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}

        {/* Ekle */}
        <button onClick={() => setPickerOpen(o => !o)} className={tileBtn} style={{ width: TILE_W, height: TILE_H }}>
          <span className="flex items-center justify-center rounded-full" style={{ width: 40, height: 40, background: p.accentSoft, border: `1.5px dashed ${p.accent}` }}>
            <Plus style={{ width: 22, height: 22, color: p.accent }} />
          </span>
          <span style={{ ...labelStyle, color: p.accent }}>Ekle</span>
        </button>
      </div>
    </div>
  );
});

/* ─── KEYFRAMES ─────────────────────────────────────────────── */
const KEYFRAMES = `
  @keyframes proPulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  @keyframes proEq { 0%,100%{transform:scaleY(0.5)} 50%{transform:scaleY(1)} }
  @keyframes proWiggle { 0%,100%{transform:rotate(-1.6deg)} 50%{transform:rotate(1.6deg)} }
  .pro-dock-scroll::-webkit-scrollbar { display: none; }
`;
let styleInjected = false;
function injectStyles() {
  if (styleInjected || typeof document === 'undefined') return;
  styleInjected = true;
  const el = document.createElement('style');
  el.textContent = KEYFRAMES;
  document.head.appendChild(el);
}

/* ─── ROOT LAYOUT ───────────────────────────────────────────── */
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

export const ProLayout = memo(function ProLayout({
  onOpenMap, onOpenApps, onOpenSettings, onLaunch, appMap, fullMapOpen, smart,
}: Props) {
  injectStyles();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const { screen } = useLayout();
  const dayNightMode = useStore(s => s.settings.dayNightMode);
  const pal = useMemo(() => buildPal(dayNightMode === 'night'), [dayNightMode]);

  const isPortrait = screen.height > screen.width;

  return (
    <PalCtx.Provider value={pal}>
      {voiceOpen && (
        <Suspense fallback={null}>
          {/* Tam overlay (web-first): Chrome'da sesli + her yerde metin/hızlı komut.
              minimal pill (sürüş) sadece konuşma olup webde anında kapanıyordu. */}
          <VoiceAssistant onClose={() => setVoiceOpen(false)} autoStart />
        </Suspense>
      )}
      <div className="flex flex-col w-full h-full overflow-hidden" data-layout="pro-main" style={{ background: pal.bg, transition: 'background 0.4s ease' }}>
        {/* İçerik */}
        <div className="flex-1 min-h-0 overflow-hidden" style={{ padding: '12px 14px 6px' }}>
          <div className="h-full min-h-0 flex" style={{ flexDirection: isPortrait ? 'column' : 'row', gap: 12 }}>
            {/* Sol kolon */}
            <div className="flex flex-col min-h-0" style={{ gap: 12, width: isPortrait ? '100%' : 'clamp(132px, 13vw, 168px)', flexShrink: 0 }}>
              <ClockCard />
              <GaugeCard />
              <SettingsCard onOpenSettings={onOpenSettings} />
            </div>

            {/* Orta kolon — büyük harita tüm yüksekliği kaplar (alt 3 kart kaldırıldı) */}
            <div className="flex flex-col min-h-0 flex-1" style={{ gap: 12 }}>
              <NavCard onOpenMap={onOpenMap} fullMapOpen={fullMapOpen} />
            </div>

            {/* Sağ kolon */}
            <div className="flex flex-col min-h-0" style={{ gap: 12, width: isPortrait ? '100%' : 'clamp(260px, 27vw, 340px)', flexShrink: 0 }}>
              <MusicCard />
              <VehicleCard onOpenSettings={onOpenSettings} onLaunch={onLaunch} />
            </div>
          </div>
        </div>

        {/* Magic context (varsa) */}
        {smart && smart.predictions.length > 0 && (
          <div className="px-4 flex-shrink-0">
            <MagicContextCard smart={smart} variant="pro" onLaunch={onLaunch} onOpenMap={onOpenMap} />
          </div>
        )}

        {/* Dock — tam genişlik, yatay kaydırmalı */}
        <div className="flex-shrink-0" style={{ padding: '4px 14px 12px' }}>
          <ProDock onOpenMap={onOpenMap} onVoice={() => setVoiceOpen(true)} onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} appMap={appMap ?? {}} onLaunch={onLaunch} />
        </div>
      </div>
    </PalCtx.Provider>
  );
});
