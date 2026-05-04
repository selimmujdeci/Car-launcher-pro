import { memo, useState, lazy, Suspense } from 'react';
import {
  SkipBack, SkipForward,
  Grid3X3, Settings, Radio, Mic,
  Phone, Music2, Bell, LayoutGrid, SlidersHorizontal,
  ChevronUp, ChevronDown, Cloud, AlertTriangle, Camera,
  Route, ShieldAlert, Wrench, Shield, Tv2,
} from 'lucide-react';
import { openMusicDrawer } from '../../platform/mediaUi';
import { openDrawer } from '../../platform/drawerBus';
import { useNotificationState } from '../../platform/notificationService';

const VoiceAssistant = lazy(() => import('../modals/VoiceAssistant').then(m => ({ default: m.VoiceAssistant })));
import { useStore } from '../../store/useStore';
import { useMediaState, togglePlayPause, next, previous } from '../../platform/mediaService';
import { useOBDState } from '../../platform/obdService';
import { useGPSLocation, resolveSpeedKmh } from '../../platform/gpsService';
import { useClock } from '../../hooks/useClock';
import { useDeviceStatus } from '../../platform/deviceApi';
import { MiniMapWidget } from '../map/MiniMapWidget';
import { APP_MAP, type AppItem } from '../../data/apps';
import type { SmartSnapshot } from '../../platform/smartEngine';
import { MagicContextCard } from '../common/MagicContextCard';

/* ══════════════════════════════════════════════════════════════
   COCKPIT THEME — Airbus A350 / Boeing 787 Glass Cockpit
   Renk: Karanlık kokpit + Cyan (#00D4FF) + Amber (#FFB300)
   ══════════════════════════════════════════════════════════════ */

interface Props {
  onOpenMap:      () => void;
  onOpenApps:     () => void;
  onOpenSettings: () => void;
  onLaunch:       (id: string) => void;
  appMap:         Record<string, AppItem>;
  dockIds:        string[];
  fullMapOpen?:   boolean;
  smart?:         SmartSnapshot;
}

/* Tema renkleri CSS custom property — index.css [data-theme="cockpit"] */
const C_BG      = 'var(--bg-primary, #050A10)';
const C_CYAN    = 'var(--accent, #00D4FF)';
const C_AMBER   = 'var(--accent2, #FFB300)';
const C_GREEN   = '#00E676';
const C_RED     = '#FF3B30';
const C_WHITE   = 'var(--text, #E8F0FF)';
const C_DIM     = 'var(--text-dim, #4C6070)';
const C_DIM2    = 'var(--text-dim2, #7A8E9A)';
const C_PANEL   = 'var(--bg-card, rgba(6,12,20,0.98))';
const C_BORDER  = 'var(--border-color, rgba(0,212,255,0.18))';
const C_BORDER2 = 'rgba(0,212,255,0.08)';

/* ── Ortak panel çerçevesi ─────────────────────────────────── */
function CPanel({ children, label, sublabel, accent = C_CYAN, style }: {
  children: React.ReactNode;
  label: string;
  sublabel?: string;
  accent?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden relative"
      style={{
        background: C_PANEL,
        border: `1px solid ${C_BORDER}`,
        borderRadius: 8,
        boxShadow: `0 0 0 1px rgba(0,0,0,0.80), 0 8px 32px rgba(0,0,0,0.70), inset 0 1px 0 rgba(0,212,255,0.05)`,
        ...style,
      }}>
      {/* Üst çizgi — renk kodu */}
      <div style={{ height: 2, background: `linear-gradient(90deg, transparent 0%, ${accent} 30%, ${accent} 70%, transparent 100%)`, flexShrink: 0 }} />

      {/* Panel başlık */}
      <div className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ borderBottom: `1px solid ${C_BORDER2}`, background: 'rgba(0,212,255,0.03)' }}>
        <span className="text-[10px] font-mono font-bold tracking-[0.30em] uppercase" style={{ color: accent }}>{label}</span>
        {sublabel && <span className="text-[9px] font-mono" style={{ color: C_DIM2 }}>{sublabel}</span>}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

/* ── Glareshield (üst bar) ─────────────────────────────────── */
const Glareshield = memo(function Glareshield({ onOpenApps, onOpenSettings, onVoice }: { onOpenApps: () => void; onOpenSettings: () => void; onVoice: () => void }) {
  const { settings } = useStore();
  const { time } = useClock(settings.use24Hour, true);
  const device = useDeviceStatus();

  return (
    <div className="flex items-center justify-between px-4 py-2 flex-shrink-0"
      style={{
        background: 'linear-gradient(180deg, #0A0E14 0%, #060C14 100%)',
        borderBottom: `1px solid rgba(0,212,255,0.12)`,
        boxShadow: `0 2px 20px rgba(0,0,0,0.80)`,
      }}>

      {/* Sol: Uçuş numarası / sistem */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded flex items-center justify-center"
            style={{ background: 'rgba(0,212,255,0.08)', border: `1px solid ${C_BORDER}` }}>
            {/* Kokpit ikonu */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 9l3 1-3 4h5l1 8h8l1-8h5l-3-4 3-1L12 2z" fill={C_CYAN} opacity="0.9"/>
            </svg>
          </div>
          <div>
            <div className="text-[10px] font-mono font-bold tracking-[0.3em]" style={{ color: C_CYAN }}>CAR-LAUNCHER</div>
            <div className="text-[8px] font-mono" style={{ color: C_DIM2 }}>GLASS COCKPIT v2.1</div>
          </div>
        </div>

        {/* Status annunciators */}
        <div className="flex items-center gap-1.5 ml-4">
          <Annunciator label="GPS" active color={C_GREEN} />
          <Annunciator label="OBD" active={device.ready} color={C_GREEN} />
          <Annunciator label="BT" active={device.ready && device.btConnected} color={C_CYAN} />
          <Annunciator label="WIFI" active={device.ready && device.wifiConnected} color={C_CYAN} />
        </div>
      </div>

      {/* Orta: Dijital saat — kronometrik */}
      <div className="flex flex-col items-center">
        <div className="font-mono font-bold tabular-nums" style={{ fontSize: 'var(--lp-font-xl, 23px)', color: C_WHITE, letterSpacing: '0.05em', textShadow: `0 0 20px rgba(0,212,255,0.30)` }}>
          {time}
        </div>
        <div className="text-[9px] font-mono tracking-[0.4em] uppercase" style={{ color: C_DIM }}>UTC+03</div>
      </div>

      {/* Sağ: Kontrol butonları */}
      <div className="flex items-center gap-2">
        <GButton label="SYS" onClick={onOpenSettings}><Settings className="w-3.5 h-3.5" style={{ color: C_DIM2 }} /></GButton>
        <GButton label="APPS" onClick={onOpenApps}><Grid3X3 className="w-3.5 h-3.5" style={{ color: C_DIM2 }} /></GButton>
        <GButton label="MIC" onClick={onVoice}><Mic className="w-3.5 h-3.5" style={{ color: C_GREEN }} /></GButton>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded"
          style={{ background: 'rgba(0,230,118,0.10)', border: `1px solid rgba(0,230,118,0.25)` }}>
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: C_GREEN }} />
          <span className="text-[9px] font-mono font-bold tracking-widest" style={{ color: C_GREEN }}>NORMAL OPS</span>
        </div>
      </div>
    </div>
  );
});

function Annunciator({ label, active, color }: { label: string; active: boolean; color: string }) {
  return (
    <div className="px-2.5 py-1.5 rounded text-[9px] font-mono font-bold tracking-wider"
      style={{
        background: active ? `${color}18` : 'rgba(255,255,255,0.03)',
        border: `1px solid ${active ? `${color}40` : C_DIM}`,
        color: active ? color : C_DIM,
      }}>
      {label}
    </div>
  );
}

function GButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-1 px-3 py-2 rounded active:scale-95 transition-all"
      style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${C_DIM}` }}>
      {children}
      <span className="text-[8px] font-mono" style={{ color: C_DIM2 }}>{label}</span>
    </button>
  );
}

/* ── PFD: Primary Flight Display ───────────────────────────── */
const PFD = memo(function PFD() {
  const obd = useOBDState();
  const gps = useGPSLocation();
  const speedKmh = resolveSpeedKmh(gps, obd.speed ?? 0);
  const heading = gps?.heading ?? 247;
  const rpm = obd.rpm ?? 929;

  const bankAngle = 0;
  const pitchAngle = 2.5;

  const W = 220, H = 240;
  const cx = W / 2, cy = H / 2 - 10;

  // Yapay ufuk hesaplama
  const bankRad = (bankAngle * Math.PI) / 180;
  const pitchPx = pitchAngle * 6; // 1 derece = 6px
  const cosB = Math.cos(bankRad), sinB = Math.sin(bankRad);

  // Ufuk çizgisi
  const horizonLen = 180;
  const hx1 = cx - (horizonLen / 2) * cosB - pitchPx * sinB;
  const hy1 = cy + (horizonLen / 2) * sinB - pitchPx * cosB;
  const hx2 = cx + (horizonLen / 2) * cosB + pitchPx * sinB;
  const hy2 = cy - (horizonLen / 2) * sinB + pitchPx * cosB;

  // Gökyüzü polygon (horizon üstü)
  const skyPoints = `0,0 ${W},0 ${hx2},${hy2} ${hx1},${hy1}`;
  // Zemin polygon
  const groundPoints = `${hx1},${hy1} ${hx2},${hy2} ${W},${H} 0,${H}`;

  // Hız tape — sol
  const speedKnots = Math.round(speedKmh * 0.539957);

  // Heading band
  const hStart = heading - 30;

  return (
    <CPanel label="PFD" sublabel="PRIMARY FLIGHT DISPLAY" accent={C_CYAN}>
      <div className="flex flex-col h-full">

        {/* Yapay ufuk alanı */}
        <div className="flex-1 relative overflow-hidden min-h-0">
          <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
            <defs>
              <clipPath id="adi-clip">
                <rect x="0" y="0" width={W} height={H} rx="4" />
              </clipPath>
            </defs>
            <g clipPath="url(#adi-clip)">
              {/* Gökyüzü */}
              <polygon points={skyPoints} fill="#0A2547" />
              {/* Zemin */}
              <polygon points={groundPoints} fill="#3D2008" />
              {/* Ufuk çizgisi */}
              <line x1={hx1} y1={hy1} x2={hx2} y2={hy2} stroke="#FFFFFF" strokeWidth="2" />

              {/* Pitch çizgileri */}
              {[-10, -5, 5, 10].map(p => {
                const py = pitchPx - p * 6;
                const len = Math.abs(p) === 10 ? 60 : 40;
                const px1 = cx - (len / 2) * cosB - py * sinB;
                const py1 = cy + (len / 2) * sinB - py * cosB;
                const px2 = cx + (len / 2) * cosB + py * sinB;
                const py2 = cy - (len / 2) * sinB + py * cosB;
                return (
                  <g key={p}>
                    <line x1={px1} y1={py1} x2={px2} y2={py2} stroke="rgba(255,255,255,0.50)" strokeWidth="1" />
                    <text x={px1 - 18} y={py1 + 4} fill="rgba(255,255,255,0.50)" fontSize="9" fontFamily="monospace">{Math.abs(p)}</text>
                  </g>
                );
              })}

              {/* Bank açı göstergesi — üst */}
              <g transform={`rotate(${bankAngle}, ${cx}, ${cy})`}>
                <polygon points={`${cx},${cy - 95} ${cx - 6},${cy - 82} ${cx + 6},${cy - 82}`}
                  fill={C_WHITE} opacity="0.8" />
              </g>

              {/* Merkezi uçak silüeti */}
              <g>
                {/* Gövde */}
                <rect x={cx - 2} y={cy - 3} width={4} height={6} fill={C_AMBER} />
                {/* Sol kanat */}
                <rect x={cx - 28} y={cy} width={24} height={3} fill={C_AMBER} rx="1" />
                {/* Sağ kanat */}
                <rect x={cx + 4} y={cy} width={24} height={3} fill={C_AMBER} rx="1" />
                {/* Kuyruk */}
                <rect x={cx - 1} y={cy + 3} width={2} height={8} fill={C_AMBER} />
              </g>

              {/* Sol hız tape arka planı */}
              <rect x="2" y={cy - 60} width="38" height="120" rx="3" fill="rgba(0,0,0,0.65)" stroke={C_BORDER} strokeWidth="0.5" />
              {/* Hız değeri */}
              <rect x="3" y={cy - 13} width="36" height="26" rx="2" fill="rgba(0,0,0,0.85)" stroke={C_CYAN} strokeWidth="1" />
              <text x="21" y={cy + 6} textAnchor="middle" fill={C_WHITE} fontSize="14" fontWeight="bold" fontFamily="monospace">{speedKnots}</text>
              <text x="21" y={cy + 22} textAnchor="middle" fill={C_DIM2} fontSize="7" fontFamily="monospace">KT</text>

              {/* Sağ RPM tape */}
              <rect x={W - 40} y={cy - 60} width="38" height="120" rx="3" fill="rgba(0,0,0,0.65)" stroke={C_BORDER} strokeWidth="0.5" />
              <rect x={W - 39} y={cy - 13} width="36" height="26" rx="2" fill="rgba(0,0,0,0.85)" stroke={C_AMBER} strokeWidth="1" />
              <text x={W - 21} y={cy + 6} textAnchor="middle" fill={C_WHITE} fontSize="12" fontWeight="bold" fontFamily="monospace">{Math.round(rpm / 100)}</text>
              <text x={W - 21} y={cy + 22} textAnchor="middle" fill={C_DIM2} fontSize="7" fontFamily="monospace">×100</text>

              {/* Heading band — alt */}
              <rect x="0" y={H - 28} width={W} height="28" fill="rgba(0,0,0,0.70)" />
              <rect x={cx - 20} y={H - 27} width="40" height="27" fill="rgba(0,0,0,0.90)" stroke={C_CYAN} strokeWidth="1" />
              <text x={cx} y={H - 8} textAnchor="middle" fill={C_WHITE} fontSize="14" fontWeight="bold" fontFamily="monospace">{Math.round(heading)}°</text>

              {/* Heading tick'leri */}
              {[-3, -2, -1, 1, 2, 3].map(i => {
                const hdg = (hStart + (i + 3) * 10) % 360;
                const xPos = cx + i * 28 - 14;
                return (
                  <g key={i}>
                    <line x1={xPos + 14} y1={H - 28} x2={xPos + 14} y2={H - 22} stroke={C_DIM2} strokeWidth="1" />
                    <text x={xPos + 14} y={H - 16} textAnchor="middle" fill={C_DIM2} fontSize="7" fontFamily="monospace">
                      {hdg < 1 ? 360 : hdg}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        {/* Alt hız / km satırı */}
        <div className="flex-shrink-0 flex items-center justify-between px-3 py-2"
          style={{ borderTop: `1px solid ${C_BORDER2}`, background: 'rgba(0,0,0,0.60)' }}>
          <MonoValue label="IAS" value={`${speedKnots} KT`} color={C_CYAN} />
          <MonoValue label="KM/H" value={`${speedKmh}`} color={C_WHITE} />
          <MonoValue label="HDG" value={`${Math.round(heading)}°`} color={C_AMBER} />
        </div>
      </div>
    </CPanel>
  );
});

function MonoValue({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center">
      <div className="text-[9px] font-mono tracking-widest" style={{ color: C_DIM2 }}>{label}</div>
      <div className="text-sm font-mono font-bold tabular-nums mt-0.5" style={{ color }}>{value}</div>
    </div>
  );
}

/* ── ND: Navigation Display ────────────────────────────────── */
const ND = memo(function ND({ onOpenMap, fullMapOpen }: { onOpenMap: () => void; fullMapOpen?: boolean }) {
  const gps = useGPSLocation();
  const heading = gps?.heading ?? 247;
  const speedKmh = resolveSpeedKmh(gps, 0);

  return (
    <CPanel label="ND" sublabel="NAVIGATION DISPLAY" accent={C_GREEN}>
      <div className="flex flex-col h-full">

        {/* Harita */}
        <div className="flex-1 min-h-0 relative overflow-hidden">
          {fullMapOpen
            ? <div className="w-full h-full flex items-center justify-center bg-[#050A10]">
                <span className="text-sm font-mono" style={{ color: C_DIM }}>FULL MAP ACTIVE</span>
              </div>
            : <MiniMapWidget onFullScreenClick={onOpenMap} />
          }

          {/* ND Overlay — heading arc */}
          <div className="absolute top-2 left-2 right-2 pointer-events-none">
            <svg width="100%" height="50" viewBox="0 0 300 50">
              {/* Bearing arc */}
              <path d="M 150,48 A 148,148 0 0,1 2,48" fill="none" stroke={C_GREEN} strokeWidth="1" opacity="0.30" />
              {/* Heading pointer */}
              <polygon points="150,4 146,16 154,16" fill={C_CYAN} />
              {/* Track labels */}
              <text x="8"  y="46" fill={C_DIM2} fontSize="9" fontFamily="monospace">W</text>
              <text x="146" y="14" fill={C_CYAN} fontSize="9" fontFamily="monospace">{Math.round(heading)}°</text>
              <text x="280" y="46" fill={C_DIM2} fontSize="9" fontFamily="monospace">E</text>
            </svg>
          </div>

          {/* Hız / Range overlay — sağ alt */}
          <div className="absolute bottom-2 right-2 pointer-events-none">
            <div className="flex flex-col items-end gap-0.5">
              <div className="px-2 py-1 rounded text-[9px] font-mono" style={{ background: 'rgba(0,0,0,0.70)', color: C_GREEN }}>
                GS {speedKmh} KM/H
              </div>
              <div className="px-2 py-1 rounded text-[8px] font-mono" style={{ background: 'rgba(0,0,0,0.70)', color: C_DIM2 }}>
                RANGE 20 NM
              </div>
            </div>
          </div>

          {/* Hedef overlay — sol alt */}
          <div className="absolute bottom-2 left-2 pointer-events-none">
            <div className="px-2 py-1 rounded text-[9px] font-mono" style={{ background: 'rgba(0,0,0,0.70)', color: C_AMBER }}>
              DEST — ETA --:--
            </div>
          </div>
        </div>

        {/* Arama */}
        <div className="flex-shrink-0 px-3 py-2"
          style={{ borderTop: `1px solid ${C_BORDER2}`, background: 'rgba(0,0,0,0.60)' }}>
          <button onClick={onOpenMap}
            className="w-full flex items-center gap-2 px-3 py-2 rounded active:scale-[0.99] transition-all"
            style={{ background: 'rgba(0,212,255,0.05)', border: `1px solid ${C_BORDER}` }}>
            <span className="text-[9px] font-mono" style={{ color: C_DIM2 }}>▶</span>
            <span className="text-[11px] font-mono" style={{ color: C_DIM2 }}>ENTER DESTINATION / DIRECT TO</span>
          </button>
        </div>
      </div>
    </CPanel>
  );
});

/* ── EICAS: Engine Indication & Crew Alerting ──────────────── */
const EICAS = memo(function EICAS({ appMap, onLaunch }: { appMap: Record<string, AppItem>; onLaunch: (id: string) => void }) {
  const obd = useOBDState();
  const rpm  = obd.rpm        ?? 0;
  const temp = obd.engineTemp ?? 0;
  const fuel = obd.fuelLevel  ?? 0;
  const tempWarn = temp > 100;
  const fuelWarn = fuel < 15;

  const { playing, track } = useMediaState();

  return (
    <div className="flex flex-col gap-2 h-full min-h-0">

      {/* Motor göstergesi */}
      <CPanel label="EICAS" sublabel="ENGINE & SYSTEMS" accent={C_AMBER} style={{ flexShrink: 0 }}>
        <div className="p-3 flex flex-col gap-2">

          {/* N1 / RPM arc'ı */}
          <div className="flex items-center gap-3">
            <div className="relative w-[70px] h-[70px]">
              <svg width="70" height="70" viewBox="0 0 70 70">
                <circle cx="35" cy="35" r="28" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
                <circle cx="35" cy="35" r="28" fill="none" stroke={C_AMBER} strokeWidth="6"
                  strokeDasharray={`${(rpm / 8000) * 176} 176`}
                  strokeDashoffset="44"
                  strokeLinecap="round"
                  style={{ filter: `drop-shadow(0 0 4px ${C_AMBER}60)` }} />
                <text x="35" y="38" textAnchor="middle" fill={C_WHITE} fontSize="12" fontWeight="bold" fontFamily="monospace">
                  {Math.round(rpm / 10) / 100}
                </text>
                <text x="35" y="50" textAnchor="middle" fill={C_DIM2} fontSize="7" fontFamily="monospace">N1%</text>
              </svg>
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              <EICASRow label="EGT" value={`${Math.round(temp + 480)}°C`} warn={tempWarn} max={1000} current={temp + 480} />
              <EICASRow label="FF"  value="28 L/H"  warn={false}     max={100}  current={28} />
              <EICASRow label="OIL" value="4.2 bar"  warn={false}    max={6}    current={4.2} />
            </div>
          </div>

          {/* Yakıt + Sıcaklık */}
          <div className="flex gap-2">
            <EICASGauge label="FUEL" value={Math.round(fuel)} unit="%" warn={fuelWarn} color={fuelWarn ? C_RED : C_GREEN} />
            <EICASGauge label="TEMP" value={Math.round(temp)} unit="°C" warn={tempWarn} color={tempWarn ? C_RED : C_AMBER} />
            <EICASGauge label="VOLT" value="12.6" unit="V" warn={false} color={C_CYAN} />
          </div>
        </div>
      </CPanel>

      {/* Comms — Müzik */}
      <CPanel label="COMMS" sublabel="AUDIO MANAGEMENT" accent={C_CYAN} style={{ flexShrink: 0 }}>
        <div className="p-3">
          <div className="flex items-center gap-2 mb-2.5">
            <div className="w-10 h-10 rounded flex-shrink-0 flex items-center justify-center overflow-hidden"
              style={{ background: 'rgba(0,212,255,0.08)', border: `1px solid ${C_BORDER}` }}>
              {track.albumArt
                ? <img src={track.albumArt} className="w-full h-full object-cover" alt="" />
                : <Radio className="w-4 h-4" style={{ color: C_CYAN }} />
              }
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-mono font-bold truncate" style={{ color: C_WHITE }}>
                {track.title || 'NO AUDIO SIGNAL'}
              </div>
              <div className="text-[9px] font-mono mt-0.5 truncate" style={{ color: C_DIM2 }}>
                {track.artist || 'CHANNEL CLEAR'}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center gap-3">
            <CommsBtn onClick={() => previous()}><SkipBack className="w-3.5 h-3.5" style={{ color: C_DIM2 }} /></CommsBtn>
            <button onClick={() => togglePlayPause()}
              className="px-4 py-1.5 rounded text-[10px] font-mono font-bold tracking-widest active:scale-90 transition-all"
              style={{
                background: playing ? 'rgba(0,212,255,0.15)' : 'rgba(0,212,255,0.08)',
                border: `1px solid ${C_CYAN}`,
                color: C_CYAN,
                boxShadow: playing ? `0 0 12px rgba(0,212,255,0.30)` : 'none',
              }}>
              {playing ? '■ STOP' : '▶ PLAY'}
            </button>
            <CommsBtn onClick={() => next()}><SkipForward className="w-3.5 h-3.5" style={{ color: C_DIM2 }} /></CommsBtn>
          </div>
        </div>
      </CPanel>

      {/* Hızlı uygulamalar — FMC stili */}
      <CPanel label="FMC" sublabel="FLIGHT MANAGEMENT" accent={C_GREEN} style={{ flex: 1 }}>
        <div className="p-2 grid grid-cols-2 gap-1.5 h-full content-start">
          {['maps', 'phone', 'youtube', 'settings'].map(id => {
            const app = appMap[id] ?? APP_MAP[id];
            if (!app) return null;
            return (
              <button key={id} onClick={() => onLaunch(id)}
                className="flex items-center gap-2 px-2 py-2 rounded active:scale-90 transition-all"
                style={{ background: 'rgba(0,230,118,0.04)', border: `1px solid rgba(0,230,118,0.12)` }}>
                <span className="text-base leading-none">{app.icon}</span>
                <span className="text-[9px] font-mono truncate" style={{ color: C_DIM2 }}>{app.name.toUpperCase()}</span>
              </button>
            );
          })}
        </div>
      </CPanel>
    </div>
  );
});

function EICASRow({ label, value, warn, max, current }: { label: string; value: string; warn: boolean; max: number; current: number }) {
  const pct = Math.min(current / max, 1);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-mono w-8 flex-shrink-0" style={{ color: C_DIM2 }}>{label}</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct * 100}%`, background: warn ? C_RED : C_AMBER, boxShadow: warn ? `0 0 4px ${C_RED}` : 'none' }} />
      </div>
      <span className="text-[10px] font-mono w-14 text-right flex-shrink-0" style={{ color: warn ? C_RED : C_WHITE }}>{value}</span>
    </div>
  );
}

function EICASGauge({ label, value, unit, warn, color }: { label: string; value: number | string; unit: string; warn: boolean; color: string }) {
  return (
    <div className="flex-1 rounded px-2.5 py-2 text-center"
      style={{ background: warn ? 'rgba(255,59,48,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${warn ? 'rgba(255,59,48,0.25)' : C_DIM}` }}>
      <div className="text-[9px] font-mono mb-1" style={{ color: C_DIM2 }}>{label}</div>
      <div className="text-sm font-mono font-bold tabular-nums" style={{ color }}>
        {value}<span className="text-[9px] ml-0.5" style={{ color: C_DIM2 }}>{unit}</span>
      </div>
    </div>
  );
}

function CommsBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="w-8 h-8 rounded flex items-center justify-center active:scale-90 transition-all"
      style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${C_DIM}` }}>
      {children}
    </button>
  );
}

/* ── MIP: Mode Indicator Panel (dock) ──────────────────────── */
const MIP = memo(function MIP({ appMap, dockIds, onLaunch, onOpenApps, onOpenSettings }: {
  appMap: Record<string, AppItem>; dockIds: string[]; onLaunch: (id: string) => void;
  onOpenApps: () => void; onOpenSettings: () => void;
}) {
  const { unreadCount } = useNotificationState();
  const [moreOpen, setMoreOpen] = useState(false);
  const BTN_W = 90, BTN_H = 90, BTN_R = 16, ICON = 26;

  function MipBtn({ fn, label, color, children, badge }: {
    fn: () => void; label: string; color: string; children: React.ReactNode; badge?: number;
  }) {
    return (
      <button onClick={fn}
        className="flex flex-col items-center justify-center gap-2 flex-shrink-0 active:scale-90 transition-all relative"
        style={{ width: BTN_W, height: BTN_H, borderRadius: BTN_R, background: 'rgba(0,212,255,0.05)', border: `1px solid ${C_DIM}` }}>
        <div style={{ color, width: ICON, height: ICON, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {children}
        </div>
        <span className="font-mono uppercase tracking-wider leading-none" style={{ fontSize: 9, color: C_DIM2 }}>{label}</span>
        {!!badge && (
          <span className="absolute top-1.5 right-1.5 min-w-4 h-4 bg-cyan-500 text-black text-[9px] font-black rounded-full flex items-center justify-center px-1">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="flex-shrink-0"
      style={{
        background: 'linear-gradient(180deg, #060C14 0%, #040810 100%)',
        borderTop: `1px solid rgba(0,212,255,0.12)`,
        boxShadow: `0 -2px 20px rgba(0,0,0,0.80)`,
      }}>
      {moreOpen && (
        <div className="flex items-center justify-center gap-3 px-3 py-2 overflow-x-auto no-scrollbar"
          style={{ borderBottom: `1px solid ${C_DIM}` }}>
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
              className="flex flex-col items-center gap-1.5 flex-shrink-0 active:scale-90 transition-all px-2.5 py-2 rounded"
              style={{ background: 'rgba(0,212,255,0.04)', border: `1px solid ${C_DIM}` }}>
              <div style={{ color: item.color }}>{item.icon}</div>
              <span className="text-[8px] font-mono uppercase tracking-wider" style={{ color: C_DIM2 }}>{item.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-center overflow-x-auto no-scrollbar px-3 py-2 gap-3">
        {dockIds.slice(0, 2).map(id => {
          const app = appMap[id] ?? APP_MAP[id];
          if (!app) return null;
          return (
            <MipBtn key={id} fn={() => onLaunch(id)} label={app.name} color={C_CYAN}>
              <span style={{ fontSize: ICON }}>{app.icon}</span>
            </MipBtn>
          );
        })}
        <MipBtn fn={() => openDrawer('phone')}         label="Telefon"  color={C_CYAN}><Phone           size={ICON} /></MipBtn>
        <MipBtn fn={() => openMusicDrawer()}           label="Müzik"    color={C_CYAN}><Music2          size={ICON} /></MipBtn>
        <MipBtn fn={() => openDrawer('notifications')} label="Bildirim" color={C_CYAN} badge={unreadCount}><Bell size={ICON} /></MipBtn>
        <MipBtn fn={onOpenApps}                        label="Menü"     color={C_CYAN}><LayoutGrid      size={ICON} /></MipBtn>
        <MipBtn fn={onOpenSettings}                    label="Ayarlar"  color={C_DIM2}><SlidersHorizontal size={ICON} /></MipBtn>
        <button onClick={() => setMoreOpen(o => !o)}
          className="flex flex-col items-center justify-center gap-2 flex-shrink-0 active:scale-90 transition-all"
          style={{ width: BTN_W, height: BTN_H, borderRadius: BTN_R, background: 'rgba(0,212,255,0.03)', border: `1px solid ${C_DIM}` }}>
          {moreOpen ? <ChevronDown size={ICON} style={{ color: C_DIM2 }} /> : <ChevronUp size={ICON} style={{ color: C_DIM2 }} />}
          <span className="font-mono uppercase tracking-wider" style={{ fontSize: 9, color: C_DIM2 }}>{moreOpen ? 'Kapat' : 'Daha'}</span>
        </button>
      </div>
    </div>
  );
});

/* ── COCKPIT LAYOUT ────────────────────────────────────────── */
export const CockpitLayout = memo(function CockpitLayout({
  onOpenMap, onOpenApps, onOpenSettings, onLaunch, appMap, dockIds, fullMapOpen, smart,
}: Props) {
  const [voiceOpen, setVoiceOpen] = useState(false);
  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: C_BG }}>
      {voiceOpen && (
        <Suspense fallback={null}>
          <VoiceAssistant onClose={() => setVoiceOpen(false)} minimal />
        </Suspense>
      )}

      {/* CRT scan-line efekti */}
      <div className="absolute inset-0 pointer-events-none z-[1]" style={{
        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)',
      }} />

      {/* Ambient glow — up-blob sistemi ile sağlanıyor */}

      <div className="relative z-10 flex flex-col h-full">
        {/* Glareshield */}
        <Glareshield onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onVoice={() => setVoiceOpen(true)} />

        {/* Ana panel — 3 kolon (ratio-aware) */}
        <div className="flex-1 min-h-0 grid gap-2 p-2 overflow-hidden"
          style={{ gridTemplateColumns: 'var(--l-grid-cols, minmax(0,0.85fr) minmax(0,1.20fr) minmax(0,0.95fr))' }}>
          <PFD />
          <div data-cockpit-nd className="min-h-0 overflow-hidden">
            <ND onOpenMap={onOpenMap} fullMapOpen={fullMapOpen} />
          </div>
          <EICAS appMap={appMap} onLaunch={onLaunch} />
        </div>

        {/* Magic Context Card — hız göstergesi ekranının alt kısmı */}
        {smart && smart.predictions.length > 0 && (
          <div className="px-2 pb-1">
            <MagicContextCard smart={smart} variant="cockpit" onLaunch={onLaunch} onOpenMap={onOpenMap} />
          </div>
        )}

        {/* MIP dock */}
        <MIP appMap={appMap} dockIds={dockIds} onLaunch={onLaunch} onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} />
      </div>
    </div>
  );
});
