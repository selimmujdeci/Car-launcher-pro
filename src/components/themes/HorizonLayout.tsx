import { memo, useState, lazy, Suspense, useEffect, useMemo, useRef, createContext, useContext } from 'react';
import {
  Navigation, Music2, Mic, Settings, Car, Bell,
  Plus, Minus, SkipBack, SkipForward, Play, Pause, MoreVertical,
  Bluetooth, Wifi, Volume2, ChevronRight, CornerUpRight,
  Fuel, Phone, Cloud, AlertTriangle, Camera, Route, ShieldAlert, Shield, Tv2, Zap,
  LayoutGrid, Wind, Crosshair, Mountain, Gauge, Thermometer, Battery, Droplet,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useMediaState, togglePlayPause, next, previous, startMediaHub, stopMediaHub } from '../../platform/mediaService';
import { useOBDState } from '../../platform/obdService';
import { useGPSLocation, resolveSpeedKmh } from '../../platform/gpsService';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import { useClock } from '../../hooks/useClock';
import { useNotificationState } from '../../platform/notificationService';
import { openDrawer } from '../../platform/drawerBus';
import { openMusicDrawer } from '../../platform/mediaUi';
import { MiniMapWidget } from '../map/MiniMapWidget';
import { type AppItem } from '../../data/apps';
import type { SmartSnapshot } from '../../platform/smartEngine';
import { MagicContextCard } from '../common/MagicContextCard';

const VoiceAssistant = lazy(() => import('../modals/VoiceAssistant').then(m => ({ default: m.VoiceAssistant })));

/* ══════════════════════════════════════════════════════════════════════
   CarOS HORIZON v3 — Expedition ↔ Land Rover Pivi Pro
   Sıcak premium karakter (gece bronz/kömür · gündüz kum/krem), amber aksan.
   Askeri/vidalı his %30 azaltıldı: vida imzası YALNIZCA logo plakası + dock +
   pusula housing'inde; içerik kartları rafine bevel'li temiz kenar (rivet yok).
   Harita = hero. Metal pusula = tema imzası. CarOS logosu plakalı/belirgin.
   Gündüzde şasi/metal AÇIK → üzerine KOYU metin (onDark modla döner).
   Tam izolasyon: başka tema dosyasından import yok; HzDockScroll kendi kopyası.
   Mali-400 güvenli: backdrop blur yok — opak gradient + ince bevel.
   ══════════════════════════════════════════════════════════════════════ */

interface Pal {
  night: boolean;
  desk: string;
  panel: string; panelHi: string; panelLo: string;
  ink: string; ink2: string; ink3: string;
  accent: string; accent2: string; accentDeep: string; accentGlow: string; accentInk: string;
  edge: string; edgeHi: string;
  metal: string; bolt: string;
  elev: string; bevel: string; mapveil: string;
  onDark: string; onDark2: string;
  ok: string;
}

const NIGHT_H: Pal = {
  night: true,
  desk: 'radial-gradient(150% 130% at 50% -15%, #1d1812 0%, #15110b 55%, #0c0906 100%)',
  panel: '#221d15', panelHi: '#2a2418', panelLo: '#15110a',
  ink: '#ECE3D2', ink2: '#AE9F82', ink3: '#6E6149',
  accent: '#F2871C', accent2: '#FFB35C', accentDeep: '#B25F0C', accentGlow: 'rgba(242,135,28,.42)', accentInk: '#1A0D02',
  edge: 'rgba(196,158,98,.16)', edgeHi: 'rgba(228,192,128,.22)',
  metal: 'linear-gradient(160deg,#473d2c 0%,#2a2417 55%,#181309 100%)',
  bolt: 'radial-gradient(circle at 36% 30%, #b59a6a, #4a3d24 70%)',
  elev: '0 16px 36px rgba(0,0,0,.58), 0 3px 9px rgba(0,0,0,.5)',
  bevel: 'inset 0 1px 0 rgba(232,200,140,.18)',
  mapveil: 'linear-gradient(180deg, rgba(8,6,4,0) 38%, rgba(8,6,4,.6))',
  onDark: '#ECE3D2', onDark2: '#AE9F82',
  ok: '#86B85E',
};

const DAY_H: Pal = {
  night: false,
  desk: 'radial-gradient(150% 130% at 50% -15%, #ece3d0 0%, #ddd2b9 55%, #cabd9f 100%)',
  panel: '#F2ECDE', panelHi: '#F8F3E9', panelLo: '#E2D8C4',
  ink: '#2E281C', ink2: '#6C6250', ink3: '#9A907A',
  accent: '#DA801A', accent2: '#E89A3C', accentDeep: '#A85C0C', accentGlow: 'rgba(218,128,26,.28)', accentInk: '#FFF6E9',
  edge: 'rgba(92,72,38,.20)', edgeHi: 'rgba(255,250,238,.7)',
  metal: 'linear-gradient(160deg,#d3c9b3 0%,#b8ac90 55%,#9c9075 100%)',
  bolt: 'radial-gradient(circle at 36% 30%, #fdf8ec, #8d815f 72%)',
  elev: '0 12px 26px rgba(70,54,26,.18), 0 2px 6px rgba(70,54,26,.14)',
  bevel: 'inset 0 1px 0 rgba(255,252,244,.7)',
  mapveil: 'linear-gradient(180deg, rgba(40,32,18,0) 45%, rgba(40,32,18,.34))',
  // Gündüz şasi/metal AÇIK kum-steel → üzerine KOYU metin
  onDark: '#2E281C', onDark2: '#6C6250',
  ok: '#5E9E3E',
};

const PalCtxH = createContext<Pal>(NIGHT_H);
const usePalH = () => useContext(PalCtxH);

/* ─── keyframes ───────────────────────────────────────────────────── */
const HZ_KEYFRAMES = `
  @keyframes hzPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.45;transform:scale(.82)} }
  @keyframes hzRing  { 0%{transform:scale(.7);opacity:.5} 100%{transform:scale(1.9);opacity:0} }
  .hz-btn { transition: transform .14s ease; }
  .hz-btn:active { transform: scale(0.93); }
  .hz-dock-scroll::-webkit-scrollbar { display: none; }
  .hz-dock-btn { transition: color .15s ease; }
`;
let _hzInjected = false;
function injectHz() {
  if (_hzInjected || typeof document === 'undefined') return;
  _hzInjected = true;
  const el = document.createElement('style');
  el.textContent = HZ_KEYFRAMES;
  document.head.appendChild(el);
}

/* ─── PANEL (rafine bevel — VİDA YOK; askeri azalt) ───────────────── */
function panelStyle(p: Pal): React.CSSProperties {
  return {
    position: 'relative', minWidth: 0, overflow: 'hidden', borderRadius: 17,
    background: p.panel, border: `1px solid ${p.edge}`, boxShadow: `${p.elev}, ${p.bevel}`,
  };
}
const Panel = memo(function Panel({ children, style, className, onClick }: {
  children: React.ReactNode; style?: React.CSSProperties; className?: string; onClick?: () => void;
}) {
  const p = usePalH();
  return <div className={className} onClick={onClick} style={{ ...panelStyle(p), ...style }}>{children}</div>;
});

/* İmza vidası — yalnızca logo plakası + dock + pusula */
function Bolt({ style }: { style: React.CSSProperties }) {
  const p = usePalH();
  return <span style={{ position: 'absolute', width: 9, height: 9, borderRadius: '50%', background: p.bolt, boxShadow: '0 1px 2px rgba(0,0,0,.55), inset 0 0 1px rgba(255,235,190,.5)', zIndex: 5, ...style }} />;
}

function HzLabel({ children }: { children: React.ReactNode }) {
  const p = usePalH();
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: p.ink3 }}>{children}</div>;
}

/* ─── MARKA AMBLEMİ (inline SVG — pusula yıldızı) ─────────────────── */
function HzMark({ size = 40 }: { size?: number }) {
  const p = usePalH();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" style={{ flexShrink: 0, filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.45))' }}>
      <circle cx="24" cy="24" r="21" stroke={p.accent} strokeWidth="1.6" opacity="0.75" />
      <circle cx="24" cy="24" r="15" stroke={p.onDark2} strokeWidth="1" opacity="0.6" />
      <path d="M24 3 L28 22 L24 24 L20 22 Z" fill={p.accent} />
      <path d="M24 45 L20 26 L24 24 L28 26 Z" fill={p.onDark2} />
      <path d="M45 24 L26 28 L24 24 L26 20 Z" fill={p.onDark2} />
      <path d="M3 24 L22 20 L24 24 L22 28 Z" fill={p.onDark2} />
      <circle cx="24" cy="24" r="2.6" fill={p.accent} />
    </svg>
  );
}

/* ─── TOP BAR (CarOS logosu plakalı/belirgin) ─────────────────────── */
const HzTopBar = memo(function HzTopBar() {
  const p = usePalH();
  const use24Hour = useStore(s => s.settings.use24Hour);
  const { time, date } = useClock(use24Hour, false);
  const ambient = useUnifiedVehicleStore(s => s.canAmbientTemp);
  const gps = useGPSLocation();
  const n = useNotificationState();
  const alt = gps?.altitude;

  return (
    <div className="relative flex items-center justify-between flex-shrink-0" style={{ height: 'clamp(58px, 9.4vh, 74px)', padding: '0 2px' }}>
      <div className="flex items-center">
        {/* Marka plakası — metal + imza vida */}
        <div className="flex items-center" style={{ gap: 13, padding: '8px 16px 8px 10px', borderRadius: 14, background: p.metal, border: `1px solid ${p.edgeHi}`, boxShadow: p.elev, position: 'relative' }}>
          <Bolt style={{ top: 6, left: 6 }} />
          <Bolt style={{ bottom: 6, left: 6 }} />
          <HzMark size={40} />
          <div style={{ lineHeight: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 21, letterSpacing: '0.14em', color: p.onDark }}>
              CAR<span style={{ color: p.accent }}>OS</span> <span style={{ color: p.onDark2 }}>PRO</span>
            </div>
            <div style={{ marginTop: 4, fontWeight: 700, fontSize: 10, letterSpacing: '0.52em', color: p.accent }}>HORIZON</div>
          </div>
        </div>
        {/* Mod + rakım chip */}
        <div className="flex items-center" style={{ gap: 8, marginLeft: 14, padding: '7px 13px', borderRadius: 999, background: p.panel, border: `1px solid ${p.edge}`, boxShadow: p.elev }}>
          <Mountain className="w-3.5 h-3.5" style={{ color: p.accent }} />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', color: p.accent }}>
            EXPEDITION{alt != null ? ` · ${Math.round(alt)} m` : ''}
          </span>
        </div>
      </div>

      {/* merkez saat */}
      <div className="absolute" style={{ left: '50%', top: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', pointerEvents: 'none' }}>
        <div style={{ fontWeight: 700, fontSize: 28, lineHeight: 1, color: p.onDark, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.01em' }}>{time}</div>
        <div style={{ marginTop: 2, fontSize: 10, fontWeight: 700, letterSpacing: '0.13em', textTransform: 'uppercase', color: p.onDark2 }}>{date}</div>
      </div>

      <div className="flex items-center" style={{ gap: 13, color: p.onDark2 }}>
        <Bluetooth className="w-[17px] h-[17px]" />
        <div className="flex items-end" style={{ gap: 2, height: 14 }}>
          {[5, 8, 11, 14].map((h, i) => <div key={i} style={{ width: 3, height: h, background: 'currentColor', borderRadius: 1 }} />)}
        </div>
        <Wifi className="w-[17px] h-[17px]" />
        <Volume2 className="w-[17px] h-[17px]" />
        <span className="flex items-center" style={{ gap: 6, padding: '6px 11px', borderRadius: 999, background: p.panel, border: `1px solid ${p.edge}`, boxShadow: p.elev }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: p.ink, fontVariantNumeric: 'tabular-nums' }}>{ambient != null ? `${Math.round(ambient)}°C` : '—'}</span>
        </span>
        <button onClick={() => openDrawer('notifications')} className="hz-btn relative" style={{ background: 'none', border: 'none', cursor: 'pointer', color: p.onDark2, display: 'flex' }}>
          <Bell className="w-[18px] h-[18px]" />
          {n.unreadCount > 0 && <span style={{ position: 'absolute', top: -5, right: -6, minWidth: 14, height: 14, background: p.accent, color: p.accentInk, fontSize: 8, fontWeight: 800, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 2px' }}>{n.unreadCount > 9 ? '9+' : n.unreadCount}</span>}
        </button>
      </div>
    </div>
  );
});

/* ─── SOL: SÜRÜŞ MODU ────────────────────────────────────────────── */
const HzDriveModeCard = memo(function HzDriveModeCard() {
  const p = usePalH();
  return (
    <Panel style={{ padding: '13px 15px' }}>
      <div className="flex items-center justify-between"><HzLabel>Sürüş Modu</HzLabel><HzLabel>4WD · High</HzLabel></div>
      <div className="flex items-center" style={{ gap: 9, marginTop: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.ok, boxShadow: `0 0 8px ${p.ok}` }} />
        <span style={{ fontWeight: 700, fontSize: 18, color: p.ink }}>Normal</span>
      </div>
    </Panel>
  );
});

/* ─── SOL: HIZ ───────────────────────────────────────────────────── */
const HzSpeedCard = memo(function HzSpeedCard() {
  const p = usePalH();
  const obd = useOBDState();
  const gps = useGPSLocation();
  const speed = Math.round(resolveSpeedKmh(gps, obd.speed ?? 0));
  const pct = Math.min(speed / 200, 1) * 100;
  return (
    <Panel style={{ padding: '14px 15px', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 0 }}>
      <HzLabel>Hız</HzLabel>
      <div className="flex items-baseline" style={{ gap: 8, marginTop: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 60, lineHeight: 0.85, color: p.ink, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em' }}>{speed}</div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', color: p.ink3 }}>KM/H</div>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: p.panelLo, marginTop: 14, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: p.accent, borderRadius: 999, transition: 'width .5s ease' }} />
      </div>
    </Panel>
  );
});

/* ─── SOL: MENZİL ────────────────────────────────────────────────── */
const HzRangeCard = memo(function HzRangeCard() {
  const p = usePalH();
  const obd = useOBDState();
  const lvl = obd.fuelLevel != null && obd.fuelLevel >= 0 ? obd.fuelLevel : null;
  const range = obd.estimatedRangeKm != null && obd.estimatedRangeKm >= 0 ? obd.estimatedRangeKm : null;
  const fpct = lvl != null ? Math.max(0, Math.min(lvl, 100)) : 0;
  return (
    <Panel style={{ padding: '13px 15px' }}>
      <div className="flex items-center justify-between"><HzLabel>Menzil</HzLabel><Fuel className="w-4 h-4" style={{ color: p.ink3 }} /></div>
      <div style={{ fontWeight: 700, fontSize: 25, marginTop: 4, color: p.ink, fontVariantNumeric: 'tabular-nums' }}>{range ?? '—'} <small style={{ fontSize: 13, color: p.ink3, fontWeight: 500 }}>km</small></div>
      <div className="flex items-center" style={{ gap: 7, marginTop: 8 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: p.ink3 }}>E</span>
        <div style={{ flex: 1, height: 6, borderRadius: 999, background: p.panelLo, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${fpct}%`, background: `linear-gradient(90deg, ${p.accentDeep}, ${p.accent})`, transition: 'width .5s ease' }} />
        </div>
        <span style={{ fontSize: 9, fontWeight: 700, color: p.ink3 }}>F</span>
      </div>
    </Panel>
  );
});

/* ─── SOL: YAKIT TÜKETİMİ ────────────────────────────────────────── */
const HzConsumptionCard = memo(function HzConsumptionCard({ onOpenSettings }: { onOpenSettings: () => void }) {
  const p = usePalH();
  const obd = useOBDState();
  const l100 = (obd.fuelRemainingL != null && obd.fuelRemainingL > 0 && obd.estimatedRangeKm != null && obd.estimatedRangeKm > 0)
    ? (obd.fuelRemainingL / obd.estimatedRangeKm) * 100 : null;
  return (
    <Panel style={{ padding: '13px 15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} onClick={onOpenSettings}>
      <div>
        <HzLabel>Yakıt Tüketimi</HzLabel>
        <div style={{ fontWeight: 700, fontSize: 21, marginTop: 4, color: p.ink, fontVariantNumeric: 'tabular-nums' }}>{l100 != null ? l100.toFixed(1) : '—'} <small style={{ fontSize: 12, color: p.ink3, fontWeight: 500 }}>L/100km</small></div>
      </div>
      <Gauge className="w-[18px] h-[18px]" style={{ color: p.accent }} />
    </Panel>
  );
});

/* ─── MERKEZ: HARİTA HERO ────────────────────────────────────────── */
function HzMapBtn({ children }: { children: React.ReactNode }) {
  const p = usePalH();
  return <button className="hz-btn flex items-center justify-center" style={{ width: 40, height: 40, borderRadius: 12, background: p.panel, border: `1px solid ${p.edge}`, color: p.ink2, cursor: 'pointer', boxShadow: p.elev }} onClick={e => e.stopPropagation()}>{children}</button>;
}

const HzMap = memo(function HzMap({ onOpenMap, fullMapOpen }: { onOpenMap: () => void; fullMapOpen?: boolean }) {
  const p = usePalH();
  const gps = useGPSLocation();
  const heading = gps?.heading ?? 0;
  const chip: React.CSSProperties = { background: p.panel, border: `1px solid ${p.edge}`, boxShadow: p.elev };
  // sıcak arazi fallback zemini (MiniMapWidget yüklenene kadar / şeffaf bölgelerde)
  const terrain = 'radial-gradient(130% 100% at 62% 40%, #6b6a3e 0%, #4f5530 30%, #36492f 52%, #1f3a3e 72%, #16303c 100%)';
  // Pusula yuvası: harita kartının alt kenarına PUSULA İLE EŞMERKEZLİ içbükey kavis.
  // Pusula EKRAN-merkezli (dock tam genişlik), harita ofsetli → x'i viewport-merkeze hizala.
  // Pusula merkezi harita alt kenarının ~25px ALTINDA (root gap 12 + dock içi konum) →
  // mask dairesini calc(100% + 25px)'e taşı ki kavis pusula yayıyla eşmerkezli otursun.
  // Yarıçap = pusula yarıçapı (clamp(75,12vh,94)) + küçük boşluk.
  const notchX = 'calc(50vw - 27px - clamp(184px, 17.8vw, 300px))';
  const notchR = 'calc(clamp(75px, 12vh, 94px) + 7px)';
  const notchMask = `radial-gradient(circle at ${notchX} calc(100% + 25px), transparent 0 calc(${notchR} - 1px), #000 ${notchR})`;
  return (
    <Panel style={{ padding: 0, flex: 1, minWidth: 0, minHeight: 0, maskImage: notchMask, WebkitMaskImage: notchMask }} onClick={onOpenMap}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 17, overflow: 'hidden', cursor: 'pointer', background: terrain }}>
        {fullMapOpen
          ? <div className="w-full h-full flex items-center justify-center"><Navigation className="w-10 h-10" style={{ color: p.accent }} /></div>
          : <MiniMapWidget onFullScreenClick={onOpenMap} />}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: 17, background: p.mapveil }} />
      </div>

      {/* nav talimatı — sol üst */}
      <div className="absolute" style={{ top: 15, left: 15, pointerEvents: 'auto' }}>
        <div className="flex items-center" style={{ gap: 12, padding: '11px 15px', borderRadius: 14, ...chip }}>
          <div className="flex items-center justify-center" style={{ width: 42, height: 42, borderRadius: 12, background: `linear-gradient(135deg, ${p.accent}, ${p.accentDeep})`, boxShadow: `0 6px 16px ${p.accentGlow}` }}>
            <CornerUpRight className="w-5 h-5" style={{ color: '#fff' }} />
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: p.ink, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>2.4 <span style={{ fontSize: 12, fontWeight: 500, color: p.ink3 }}>km</span></div>
            <div style={{ fontSize: 12, fontWeight: 500, color: p.ink2, marginTop: 3 }}>D400 · Kaş Yolu</div>
          </div>
        </div>
      </div>

      {/* online */}
      <div className="absolute" style={{ top: 15, right: 15 }}>
        <div className="flex items-center" style={{ gap: 7, padding: '7px 12px', borderRadius: 999, ...chip }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.ok, animation: 'hzPulse 2s infinite' }} />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: p.ink2 }}>Online</span>
        </div>
      </div>

      {/* kontroller */}
      <div className="absolute flex flex-col" style={{ right: 15, top: '50%', transform: 'translateY(-50%)', gap: 9 }}>
        <HzMapBtn><span style={{ fontSize: 13, fontWeight: 800, color: p.accent }}>N</span></HzMapBtn>
        <HzMapBtn><Plus className="w-[18px] h-[18px]" /></HzMapBtn>
        <HzMapBtn><Minus className="w-[18px] h-[18px]" /></HzMapBtn>
        <HzMapBtn><Crosshair className="w-[18px] h-[18px]" /></HzMapBtn>
      </div>

      {/* konum marker */}
      <div className="absolute" style={{ left: '46%', top: '55%', transform: 'translate(-50%,-50%)', pointerEvents: 'none' }}>
        <span style={{ position: 'absolute', left: '50%', top: '50%', width: 48, height: 48, transform: 'translate(-50%,-50%)', borderRadius: '50%', background: p.accentGlow, animation: 'hzRing 2.4s ease-out infinite' }} />
        <div style={{ position: 'relative', width: 36, height: 36, borderRadius: '50%', background: p.panel, border: `2px solid ${p.accent}`, display: 'grid', placeItems: 'center', boxShadow: `0 4px 12px ${p.accentGlow}` }}>
          <Navigation className="w-4 h-4" style={{ color: p.accent, fill: p.accent, transform: `rotate(${heading}deg)` }} />
        </div>
      </div>

      {/* seyahat bilgisi — pusula yuvasıyla çakışmasın diye sol-alt */}
      <div className="absolute" style={{ bottom: 15, left: 15, pointerEvents: 'auto' }}>
        <div className="flex items-center" style={{ borderRadius: 14, ...chip }}>
          <HzTripCell k="Saat" v="2:15" />
          <span style={{ width: 1, height: 28, background: p.edge }} />
          <HzTripCell k="KM" v="137" />
          <span style={{ width: 1, height: 28, background: p.edge }} />
          <HzTripCell k="Varış" v="15:39" accent />
        </div>
      </div>
    </Panel>
  );
});

function HzTripCell({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  const p = usePalH();
  return (
    <div style={{ padding: '9px 17px', textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: accent ? p.accent : p.ink, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{v}</div>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: p.ink3, marginTop: 3 }}>{k}</div>
    </div>
  );
}

/* ─── SAĞ: MEDYA ─────────────────────────────────────────────────── */
const HzMediaCard = memo(function HzMediaCard() {
  const p = usePalH();
  const { playing, track } = useMediaState();
  useEffect(() => { startMediaHub(); return () => stopMediaHub(); }, []);
  const total = track.durationSec || 0;
  const elapsed = track.positionSec || 0;
  const pct = total > 0 ? Math.min((elapsed / total) * 100, 100) : 0;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return (
    <Panel style={{ padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      <div className="flex items-center" style={{ gap: 12 }}>
        <button onClick={() => openMusicDrawer()} className="hz-btn" style={{ width: 56, height: 56, borderRadius: 12, flexShrink: 0, border: `1px solid ${p.edge}`, overflow: 'hidden', background: p.metal, display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: p.bevel }}>
          {track.albumArt ? <img src={track.albumArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music2 className="w-6 h-6" style={{ color: p.accent }} />}
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: p.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title || 'Çalmıyor'}</div>
          <div style={{ color: p.ink3, fontSize: 11, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist || 'Oynatmak için dokun'}</div>
        </div>
        <button onClick={() => openMusicDrawer()} style={{ background: 'none', border: 'none', cursor: 'pointer', color: p.ink3, alignSelf: 'flex-start' }}><MoreVertical className="w-5 h-5" /></button>
      </div>
      <div className="flex items-center" style={{ gap: 9 }}>
        <span style={{ fontSize: 10, fontWeight: 500, color: p.ink3, fontVariantNumeric: 'tabular-nums' }}>{total > 0 ? fmt(elapsed) : '0:00'}</span>
        <div style={{ flex: 1, height: 4, borderRadius: 999, background: p.panelLo, position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 999, background: p.accent }} />
        </div>
        <span style={{ fontSize: 10, fontWeight: 500, color: p.ink3, fontVariantNumeric: 'tabular-nums' }}>{total > 0 ? fmt(total) : '--:--'}</span>
      </div>
      <div className="flex items-center justify-center" style={{ gap: 24, flex: 1, minHeight: 0 }}>
        <button onClick={() => previous()} className="hz-btn" style={{ background: 'none', border: 'none', cursor: 'pointer', color: p.ink }}><SkipBack className="w-6 h-6" style={{ fill: 'currentColor' }} /></button>
        <button onClick={() => togglePlayPause()} className="hz-btn" style={{ width: 46, height: 46, borderRadius: '50%', display: 'grid', placeItems: 'center', cursor: 'pointer', background: p.accent, color: p.accentInk, border: 'none', boxShadow: `0 6px 18px ${p.accentGlow}` }}>
          {playing ? <Pause className="w-5 h-5" style={{ fill: 'currentColor' }} /> : <Play className="w-5 h-5 ml-0.5" style={{ fill: 'currentColor' }} />}
        </button>
        <button onClick={() => next()} className="hz-btn" style={{ background: 'none', border: 'none', cursor: 'pointer', color: p.ink }}><SkipForward className="w-6 h-6" style={{ fill: 'currentColor' }} /></button>
      </div>
    </Panel>
  );
});

/* ─── SAĞ: ARAÇ DURUMU (premium render + 4 bar) ──────────────────── */
function HzVehicleRender() {
  const p = usePalH();
  const stroke = p.night ? '#100c07' : '#6a5b3a';
  return (
    <svg width="100%" height="100%" viewBox="0 0 300 150" preserveAspectRatio="xMidYMax meet">
      <defs>
        <linearGradient id="hzBd" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.night ? '#5a5240' : '#8a7f63'} /><stop offset=".5" stopColor={p.night ? '#3c3526' : '#5e5640'} /><stop offset="1" stopColor={p.night ? '#211c12' : '#3a3325'} />
        </linearGradient>
        <linearGradient id="hzGl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9aa39a" /><stop offset="1" stopColor="#39403a" /></linearGradient>
        <radialGradient id="hzTi" cx=".5" cy=".4" r=".6"><stop offset="0" stopColor="#33302a" /><stop offset="1" stopColor="#0d0b08" /></radialGradient>
        <linearGradient id="hzRi" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#cabf9f" /><stop offset="1" stopColor="#6a6048" /></linearGradient>
      </defs>
      <ellipse cx="150" cy="138" rx="122" ry="10" fill="#000" opacity=".28" />
      <path d="M38 98 L42 72 C44 66 50 62 60 62 L96 62 L104 50 L196 48 C214 48 226 56 232 70 L236 72 C254 74 268 84 270 100 L270 110 C270 114 266 116 260 116 L48 116 C42 116 36 110 38 98 Z" fill="url(#hzBd)" stroke={stroke} strokeWidth="1.5" />
      <path d="M92 50 L188 42" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
      <rect x="62" y="66" width="40" height="18" rx="2" fill="url(#hzGl)" />
      <path d="M110 50 L196 48 L210 64 L110 66 Z" fill="url(#hzGl)" />
      <path d="M50 96 C100 90 210 90 264 100" fill="none" stroke={p.night ? '#7a6f52' : '#a89770'} strokeWidth="2" opacity=".5" />
      <rect x="258" y="92" width="12" height="10" rx="2" fill={p.accent} opacity=".9" />
      <circle cx="96" cy="116" r="23" fill="url(#hzTi)" /><circle cx="96" cy="116" r="10" fill="url(#hzRi)" />
      <circle cx="228" cy="116" r="23" fill="url(#hzTi)" /><circle cx="228" cy="116" r="10" fill="url(#hzRi)" />
    </svg>
  );
}

function HzBar({ Icon, label, value, unit, fill, danger }: {
  Icon: typeof Thermometer; label: string; value: string; unit: string; fill: number; danger?: boolean;
}) {
  const p = usePalH();
  return (
    <div className="flex items-center" style={{ gap: 9 }}>
      <Icon className="w-[15px] h-[15px] flex-shrink-0" style={{ color: p.ink3 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: p.ink3 }}>{label}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: p.ink, fontVariantNumeric: 'tabular-nums' }}>{value}<small style={{ color: p.ink3, fontWeight: 500 }}>{unit}</small></span>
        </div>
        <div style={{ height: 5, borderRadius: 999, background: p.panelLo, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.max(0, Math.min(fill, 100))}%`, borderRadius: 999, background: danger ? '#D8552B' : p.accent, transition: 'width .5s ease' }} />
        </div>
      </div>
    </div>
  );
}

const HzVehicleStatus = memo(function HzVehicleStatus({ onOpenSettings }: { onOpenSettings: () => void }) {
  const p = usePalH();
  const obd = useOBDState();
  const volt = useUnifiedVehicleStore(s => s.canBatteryVolt);
  const motor = obd.engineTemp != null && obd.engineTemp >= 0 ? Math.round(obd.engineTemp) : null;
  const rpm = obd.rpm != null && obd.rpm >= 0 ? obd.rpm : null;
  const fuel = obd.fuelLevel != null && obd.fuelLevel >= 0 ? Math.round(obd.fuelLevel) : null;
  return (
    <Panel style={{ padding: '13px 15px', display: 'flex', flexDirection: 'column', minHeight: 0 }} onClick={onOpenSettings}>
      <div className="flex items-center justify-between">
        <HzLabel>Araç Durumu</HzLabel>
        <div className="flex items-center" style={{ gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.ok }} />
          <span style={{ fontWeight: 700, fontSize: 13, color: p.ink }}>Normal</span>
          <ChevronRight className="w-4 h-4" style={{ color: p.ink3 }} />
        </div>
      </div>
      {/* render — tek esneyen eleman (minHeight:0) → barlar asla kırpılmaz */}
      <div style={{ flex: '1 1 0', minHeight: 0, margin: '2px 0 8px', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
        <div style={{ width: '88%', maxWidth: 240, height: '100%', display: 'grid', placeItems: 'center' }}><HzVehicleRender /></div>
      </div>
      <div className="flex flex-col flex-shrink-0" style={{ gap: 7 }} onClick={e => e.stopPropagation()}>
        <HzBar Icon={Thermometer} label="Motor" value={motor != null ? `${motor}` : '—'} unit="°C" fill={motor != null ? (motor / 120) * 100 : 0} danger={motor != null && motor >= 105} />
        <HzBar Icon={Battery} label="Akü" value={volt != null ? volt.toFixed(1) : '—'} unit="V" fill={volt != null ? ((volt - 11) / 4) * 100 : 0} />
        <HzBar Icon={Droplet} label="Yakıt" value={fuel != null ? `${fuel}` : '—'} unit="%" fill={fuel ?? 0} danger={fuel != null && fuel <= 12} />
        <HzBar Icon={Gauge} label="Devir" value={rpm != null ? `${rpm}` : '—'} unit="" fill={rpm != null ? (rpm / 6000) * 100 : 0} />
      </div>
    </Panel>
  );
});

/* ─── DOCK ───────────────────────────────────────────────────────── */
function HzDockBtn({ Icon, cap, active, onClick, badge }: {
  Icon: typeof Navigation; cap: string; active?: boolean; onClick: () => void; badge?: number;
}) {
  const p = usePalH();
  return (
    <button onClick={onClick} className="hz-dock-btn flex flex-col items-center justify-center flex-shrink-0" style={{ flexBasis: '33.333%', minWidth: 0, scrollSnapAlign: 'start', background: 'transparent', border: 'none', cursor: 'pointer', gap: 7, color: active ? p.accent : p.onDark2, position: 'relative' }}>
      <span style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: active ? p.accent : 'transparent', color: active ? p.accentInk : 'inherit', boxShadow: active ? `0 6px 16px ${p.accentGlow}` : 'none' }}><Icon className="w-[22px] h-[22px]" /></span>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{cap}</span>
      {!!badge && <span style={{ position: 'absolute', top: 0, right: '24%', minWidth: 15, height: 15, background: p.accent, color: p.accentInk, fontSize: 9, fontWeight: 800, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{badge > 9 ? '9+' : badge}</span>}
    </button>
  );
}

/* PUSULA — tema imzası (knurled metal bezel + kazınmış tick + amber iğne) */
const HzCompass = memo(function HzCompass({ onClick }: { onClick: () => void }) {
  const p = usePalH();
  const gps = useGPSLocation();
  const heading = gps?.heading ?? 0;
  const ticks = useMemo(() => Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2; const mj = i % 9 === 0; const r2 = mj ? 59 : 65;
    return { x1: 90 + 68 * Math.sin(a), y1: 90 - 68 * Math.cos(a), x2: 90 + r2 * Math.sin(a), y2: 90 - r2 * Math.cos(a), mj };
  }), []);
  return (
    <button onClick={onClick} className="hz-btn" style={{ position: 'absolute', left: '50%', bottom: 5, transform: 'translateX(-50%)', width: 'clamp(150px, 24vh, 188px)', aspectRatio: '1', zIndex: 3, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
      <svg viewBox="0 0 180 180" width="100%" height="100%">
        <defs>
          <radialGradient id="hzBz" cx=".5" cy=".34" r=".72"><stop offset="0" stopColor={p.night ? '#7a6a4a' : '#dcd2ba'} /><stop offset=".7" stopColor={p.night ? '#544733' : '#b3a888'} /><stop offset="1" stopColor={p.night ? '#3a3120' : '#8d815f'} /></radialGradient>
          <radialGradient id="hzFc" cx=".5" cy=".4" r=".72"><stop offset="0" stopColor={p.night ? '#2c2517' : '#3a3526'} /><stop offset="1" stopColor={p.night ? '#1c160d' : '#2a2418'} /></radialGradient>
        </defs>
        <circle cx="90" cy="90" r="88" fill="url(#hzBz)" stroke={p.edgeHi} strokeWidth="1" />
        <circle cx="90" cy="90" r="72" fill="url(#hzFc)" stroke={p.accent} strokeOpacity=".45" strokeWidth="1.5" />
        <g transform={`rotate(${-heading} 90 90)`} style={{ transition: 'transform .4s ease' }}>
          {ticks.map((t, i) => <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={p.accent2} strokeWidth={t.mj ? 2 : 1} opacity={t.mj ? 1 : 0.45} />)}
          <path d="M90 26 L99 90 L90 83 L81 90 Z" fill={p.accent} />
          <path d="M90 154 L81 90 L90 97 L99 90 Z" fill={p.ink3} />
        </g>
        <text x="90" y="22" fill={p.accent} fontSize="14" fontWeight="800" textAnchor="middle">N</text>
        <text x="90" y="166" fill="#C9BC9E" fontSize="12" fontWeight="700" textAnchor="middle">S</text>
        <text x="162" y="95" fill="#C9BC9E" fontSize="12" fontWeight="700" textAnchor="middle">E</text>
        <text x="18" y="95" fill="#C9BC9E" fontSize="12" fontWeight="700" textAnchor="middle">W</text>
        <circle cx="90" cy="90" r="19" fill="url(#hzBz)" stroke={p.edge} />
        <circle cx="90" cy="90" r="3" fill={p.accent} />
      </svg>
    </button>
  );
});

/* ─── DOCK YATAY KAYDIRMA (Horizon kendi kopyası — izole) ─────────── */
const HzDockScroll = memo(function HzDockScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef({ down: false, startX: 0, startLeft: 0, moved: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (d !== 0) { el.scrollLeft += d; e.preventDefault(); }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    drag.current = { down: true, startX: e.clientX, startLeft: ref.current?.scrollLeft ?? 0, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.down || !ref.current) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 5) d.moved = true;
    ref.current.scrollLeft = d.startLeft - dx;
  };
  const onPointerUp = () => { drag.current.down = false; };
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current.moved) { e.stopPropagation(); e.preventDefault(); drag.current.moved = false; }
  };
  return (
    <div ref={ref} className="hz-dock-scroll"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} onClickCapture={onClickCapture}
      style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'stretch', overflowX: 'auto', overflowY: 'hidden', scrollSnapType: 'x mandatory', scrollbarWidth: 'none', msOverflowStyle: 'none', cursor: 'grab', touchAction: 'pan-x' }}>
      {children}
    </div>
  );
});

const HzDock = memo(function HzDock({ onOpenMap, onOpenApps, onOpenSettings, onVoice, onOpenDashcam }: {
  onOpenMap: () => void; onOpenApps: () => void; onOpenSettings: () => void; onVoice: () => void; onOpenDashcam?: () => void;
}) {
  const p = usePalH();
  const n = useNotificationState();
  return (
    <div style={{ position: 'relative', flex: '0 0 auto', height: 'clamp(94px, 14.6vh, 122px)' }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 17, background: p.metal, border: `1px solid ${p.edgeHi}`, boxShadow: `${p.elev}, ${p.bevel}`, display: 'flex', alignItems: 'stretch', padding: '0 10px' }}>
        {/* imza vidaları — dock köşeleri */}
        <Bolt style={{ top: 8, left: 9 }} /><Bolt style={{ bottom: 8, left: 9 }} />
        <Bolt style={{ top: 8, right: 9 }} /><Bolt style={{ bottom: 8, right: 9 }} />
        <HzDockScroll>
          <HzDockBtn Icon={Navigation} cap="Navigasyon" active onClick={onOpenMap} />
          <HzDockBtn Icon={LayoutGrid} cap="Uygulamalar" onClick={onOpenApps} />
          <HzDockBtn Icon={Music2}     cap="Medya"       onClick={() => openMusicDrawer()} />
          <HzDockBtn Icon={Mic}        cap="Asistan"     onClick={onVoice} />
          <HzDockBtn Icon={Phone}      cap="Telefon"     onClick={() => openDrawer('phone')} />
          <HzDockBtn Icon={Bell}       cap="Bildirim"    onClick={() => openDrawer('notifications')} badge={n.unreadCount} />
        </HzDockScroll>
        <div style={{ flex: '0 0 clamp(168px, 26vh, 210px)' }} />
        <HzDockScroll>
          <HzDockBtn Icon={Car}           cap="Araç"     onClick={() => openDrawer('vehicle-reminder')} />
          <HzDockBtn Icon={Camera}        cap="Kameralar" onClick={() => (onOpenDashcam ? onOpenDashcam() : openDrawer('dashcam'))} />
          <HzDockBtn Icon={Settings}      cap="Ayarlar"  onClick={onOpenSettings} />
          <HzDockBtn Icon={Wind}          cap="Klima"    onClick={() => openDrawer('climate')} />
          <HzDockBtn Icon={Cloud}         cap="Hava"     onClick={() => openDrawer('weather')} />
          <HzDockBtn Icon={AlertTriangle} cap="Trafik"   onClick={() => openDrawer('traffic')} />
          <HzDockBtn Icon={Route}         cap="Seyir"    onClick={() => openDrawer('triplog')} />
          <HzDockBtn Icon={ShieldAlert}   cap="Arıza"    onClick={() => openDrawer('dtc')} />
          <HzDockBtn Icon={Shield}        cap="Güvenlik" onClick={() => openDrawer('security')} />
          <HzDockBtn Icon={Tv2}           cap="Eğlence"  onClick={() => openDrawer('entertainment')} />
          <HzDockBtn Icon={Zap}           cap="Sport"    onClick={() => openDrawer('sport')} />
        </HzDockScroll>
      </div>
      <HzCompass onClick={onOpenApps} />
    </div>
  );
});

/* ─── ROOT ───────────────────────────────────────────────────────── */
interface Props {
  onOpenMap:      () => void;
  onOpenApps:     () => void;
  onOpenSettings: () => void;
  onLaunch:       (id: string) => void;
  appMap:         Record<string, AppItem>;
  dockIds:        string[];
  fullMapOpen?:   boolean;
  onOpenRearCam?: () => void;
  onOpenDashcam?: () => void;
  smart?:         SmartSnapshot;
}

export const HorizonLayout = memo(function HorizonLayout(props: Props) {
  const { onOpenMap, onOpenApps, onOpenSettings, onLaunch, fullMapOpen, onOpenDashcam, smart } = props;
  injectHz();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const dayNightMode = useStore(s => s.settings.dayNightMode);
  const pal = dayNightMode === 'day' ? DAY_H : NIGHT_H;

  return (
    <PalCtxH.Provider value={pal}>
      <div className="relative w-full h-full overflow-hidden" style={{ background: pal.desk, transition: 'background .5s ease', color: pal.ink, display: 'flex', flexDirection: 'column', padding: 15, gap: 12 }}>
        {voiceOpen && <Suspense fallback={null}><VoiceAssistant onClose={() => setVoiceOpen(false)} minimal /></Suspense>}

        <HzTopBar />

        {/* Kolon oranları referanstan: Sol 17.8% · Orta 51% (harita hero) · Sağ 25.8% */}
        <div style={{ flex: '1 1 auto', minHeight: 0, display: 'grid', gridTemplateColumns: 'clamp(184px,17.8vw,300px) minmax(0,1fr) clamp(244px,25.8vw,400px)', gap: 12 }}>
          <div style={{ display: 'grid', gap: 11, minWidth: 0, minHeight: 0, gridTemplateRows: 'auto 1fr auto auto' }}>
            <HzDriveModeCard />
            <HzSpeedCard />
            <HzRangeCard />
            <HzConsumptionCard onOpenSettings={onOpenSettings} />
          </div>

          <div style={{ position: 'relative', minWidth: 0, minHeight: 0, display: 'flex' }}>
            <HzMap onOpenMap={onOpenMap} fullMapOpen={fullMapOpen} />
            {smart && smart.predictions.length > 0 && (
              <div className="absolute" style={{ bottom: 78, left: 15, right: 15, zIndex: 20 }}>
                <MagicContextCard smart={smart} variant="tesla" onLaunch={onLaunch} onOpenMap={onOpenMap} />
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gap: 11, minWidth: 0, minHeight: 0, gridTemplateRows: '0.93fr 1fr' }}>
            <HzMediaCard />
            <HzVehicleStatus onOpenSettings={onOpenSettings} />
          </div>
        </div>

        <HzDock onOpenMap={onOpenMap} onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onVoice={() => setVoiceOpen(true)} onOpenDashcam={onOpenDashcam} />
      </div>
    </PalCtxH.Provider>
  );
});
