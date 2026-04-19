import { memo } from 'react';
import {
  Search, Grid3X3, SkipBack, SkipForward, Play, Pause,
  Gauge, Thermometer, Fuel, Settings, Navigation2,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useMediaState, togglePlayPause, next, previous } from '../../platform/mediaService';
import { useOBDState } from '../../platform/obdService';
import { useGPSLocation } from '../../platform/gpsService';
import { useClock } from '../../hooks/useClock';
import { useDeviceStatus } from '../../platform/deviceApi';
import { MiniMapWidget } from '../map/MiniMapWidget';
import { APP_MAP, type AppItem } from '../../data/apps';

/* ══════════════════════════════════════════
   AUDI THEME — Virtual Cockpit RS Style
   Siyah + Audi Kırmızı (#CC0000) + Gümüş
   ══════════════════════════════════════════ */

interface Props {
  onOpenMap:      () => void;
  onOpenApps:     () => void;
  onOpenSettings: () => void;
  onLaunch:       (id: string) => void;
  appMap:         Record<string, AppItem>;
  dockIds:        string[];
  fullMapOpen?:   boolean;
}

const A_BG     = 'linear-gradient(180deg, #0d0d0d 0%, #111111 50%, #0a0a0a 100%)';
const A_RED    = '#CC0000';
const A_SILVER = '#A8A9AD';
const A_CARD   = 'rgba(20,20,20,0.95)';
const A_BORDER = 'rgba(168,169,173,0.12)';
const A_TEXT   = '#FFFFFF';
const A_DIM    = '#6B7280';
const A_DIM2   = '#9CA3AF';

/* ─── AUDI HEADER ─────────────────────────────────────────────── */
const AudiHeader = memo(function AudiHeader({ onOpenApps, onOpenSettings, onOpenMap }: { onOpenApps: () => void; onOpenSettings: () => void; onOpenMap: () => void }) {
  const { settings } = useStore();
  const { time, date } = useClock(settings.use24Hour, false);
  const device = useDeviceStatus();

  return (
    <div className="flex items-center justify-between px-6 py-3 flex-shrink-0"
      style={{
        background: 'rgba(8,8,8,0.99)',
        borderBottom: `1px solid ${A_BORDER}`,
        boxShadow: `0 1px 0 rgba(204,0,0,0.20)`,
      }}>

      {/* Sol: Audi rings + zaman */}
      <div className="flex items-center gap-4">
        {/* Audi 4 halka */}
        <div className="flex items-center">
          {[0,1,2,3].map(i => (
            <div key={i} className="w-7 h-7 rounded-full flex-shrink-0"
              style={{
                border: `2px solid ${A_SILVER}`,
                marginLeft: i === 0 ? 0 : -10,
                background: 'transparent',
                boxShadow: `0 0 8px rgba(168,169,173,0.15)`,
              }} />
          ))}
        </div>
        <div>
          <div className="font-light tabular-nums" style={{ fontSize: 30, color: A_TEXT, letterSpacing: '-0.5px' }}>{time}</div>
          <div className="text-[9px] uppercase tracking-widest font-light" style={{ color: A_DIM }}>{date}</div>
        </div>
      </div>

      {/* Orta: Araç verisi */}
      <div className="flex items-center gap-1">
        <AStatus label="MENZIL" value="380 km" />
        <div className="w-px h-6 mx-2" style={{ background: A_BORDER }} />
        <AStatus label="BATARYA" value={device.ready ? `${device.battery}%` : '—'} />
        <div className="w-px h-6 mx-2" style={{ background: A_BORDER }} />
        <AStatus label="DIŞ SICAKLIK" value="21°C" />
      </div>

      {/* Sağ */}
      <div className="flex items-center gap-2">
        <AIconBtn onClick={onOpenSettings}><Settings className="w-4 h-4" style={{ color: A_DIM2 }} /></AIconBtn>
        <AIconBtn onClick={onOpenApps}><Grid3X3 className="w-4 h-4" style={{ color: A_DIM2 }} /></AIconBtn>
        <button onClick={onOpenMap} className="flex items-center gap-1.5 px-3 py-2 rounded-lg active:scale-95 transition-all"
          style={{ background: A_RED, boxShadow: `0 4px 16px rgba(204,0,0,0.35)` }}>
          <Navigation2 className="w-3.5 h-3.5" style={{ color: '#ffffff' }} />
          <span className="text-[11px] font-semibold" style={{ color: '#ffffff' }}>GİT</span>
        </button>
      </div>
    </div>
  );
});

function AStatus({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-sm font-light tabular-nums" style={{ color: A_TEXT }}>{value}</div>
      <div className="text-[8px] uppercase tracking-[0.25em] mt-0.5" style={{ color: A_DIM }}>{label}</div>
    </div>
  );
}

function AIconBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="w-9 h-9 rounded-lg flex items-center justify-center active:scale-95 transition-all"
      style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${A_BORDER}` }}>
      {children}
    </button>
  );
}

/* ─── AUDI VIRTUAL COCKPIT (Merkezi Hız) ─────────────────────── */
const AudiCockpit = memo(function AudiCockpit() {
  const obd = useOBDState();
  const gps = useGPSLocation();
  const speedKmh = gps?.speed != null && gps.speed > 0 ? Math.round(gps.speed * 3.6) : (obd.speed ?? 0);
  const rpm  = obd.rpm        ?? 929;
  const temp = obd.engineTemp ?? 88;
  const fuel = obd.fuelLevel  ?? 68;
  const tempWarn = temp > 100;
  const fuelWarn = fuel < 15;

  const R = 105, cx = 130, cy = 140;
  const pct = Math.min(speedKmh / 240, 1);
  const rad = (d: number) => (d * Math.PI) / 180;
  const pt  = (a: number) => ({ x: cx + R * Math.cos(rad(a)), y: cy + R * Math.sin(rad(a)) });
  const arc = (a1: number, a2: number) => {
    const s = pt(a1), e = pt(a2), large = a2 - a1 > 180 ? 1 : 0;
    return `M${s.x} ${s.y} A${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`;
  };
  const fillAngle = 135 + pct * 270;

  // RPM arc
  const rR = 82, rStart = 135, rSpan = 270;
  const rPct = Math.min(rpm / 8000, 1);
  const rArc = (a1: number, a2: number) => {
    const sx = cx + rR * Math.cos(rad(a1)), sy = cy + rR * Math.sin(rad(a1));
    const ex = cx + rR * Math.cos(rad(a2)), ey = cy + rR * Math.sin(rad(a2));
    const large = a2 - a1 > 180 ? 1 : 0;
    return `M${sx} ${sy} A${rR} ${rR} 0 ${large} 1 ${ex} ${ey}`;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden"
      style={{ background: A_CARD, border: `1px solid ${A_BORDER}`, borderRadius: 20 }}>

      {/* Kırmızı üst çizgi */}
      <div style={{ height: 3, background: A_RED, flexShrink: 0, borderRadius: '20px 20px 0 0' }} />

      {/* Ana Gösterge */}
      <div className="flex-1 flex items-center justify-center relative min-h-0">
        <div style={{ position: 'absolute', top: 8, left: 8, right: 8 }}>
          <div className="text-[9px] uppercase tracking-[0.45em] font-medium text-center"
            style={{ color: A_RED }}>AUDI VIRTUAL COCKPIT</div>
        </div>

        <div style={{ width: 260, height: 260, position: 'relative' }}>
          <svg width="260" height="280" viewBox="0 0 260 280">
            {/* Dış halka */}
            <circle cx="130" cy="140" r="120" fill="none" stroke="rgba(168,169,173,0.06)" strokeWidth="1" />
            {/* Hız track */}
            <path d={arc(135, 405)} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="14" strokeLinecap="butt" />
            {/* Hız fill */}
            {pct > 0.01 && (
              <path d={arc(135, fillAngle)} fill="none" stroke={A_RED} strokeWidth="14" strokeLinecap="butt"
                style={{ filter: `drop-shadow(0 0 6px ${A_RED}60)` }} />
            )}
            {/* RPM track */}
            <path d={rArc(rStart, rStart + rSpan)} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="8" strokeLinecap="butt" />
            {/* RPM fill */}
            {rPct > 0.01 && (
              <path d={rArc(rStart, rStart + rPct * rSpan)} fill="none" stroke="rgba(168,169,173,0.60)" strokeWidth="8" strokeLinecap="butt" />
            )}
            {/* Merkezi çember */}
            <circle cx="130" cy="140" r="60" fill="rgba(0,0,0,0.80)" stroke="rgba(168,169,173,0.10)" strokeWidth="1" />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ paddingTop: 12 }}>
            <div className="font-thin tabular-nums leading-none"
              style={{ fontSize: 58, color: A_TEXT, letterSpacing: '-2px' }}>
              {speedKmh}
            </div>
            <div className="text-[10px] font-light tracking-[0.5em] mt-1" style={{ color: A_SILVER, textTransform: 'uppercase' }}>
              km/h
            </div>
            <div className="text-[10px] font-light mt-2" style={{ color: A_DIM }}>
              {rpm.toLocaleString()} rpm
            </div>
          </div>
        </div>
      </div>

      {/* Alt veri çubukları */}
      <div className="flex gap-2 px-4 pb-4 flex-shrink-0">
        <ADataCell Icon={Thermometer} label="MOTOR" value={`${Math.round(temp)}°C`} warn={tempWarn} />
        <ADataCell Icon={Fuel}        label="YAKIT" value={`${Math.round(fuel)}%`}  warn={fuelWarn} />
        <ADataCell Icon={Gauge}       label="TORK"  value="320 Nm"                  warn={false} />
      </div>
    </div>
  );
});

function ADataCell({ Icon, label, value, warn }: { Icon: typeof Gauge; label: string; value: string; warn: boolean }) {
  return (
    <div className="flex-1 rounded-xl p-3 text-center"
      style={{
        background: warn ? 'rgba(204,0,0,0.10)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${warn ? 'rgba(204,0,0,0.25)' : A_BORDER}`,
      }}>
      <Icon className="w-3.5 h-3.5 mx-auto mb-1.5" style={{ color: warn ? A_RED : A_SILVER }} />
      <div className="text-[8px] uppercase tracking-widest mb-1" style={{ color: A_DIM }}>{label}</div>
      <div className="font-medium text-sm tabular-nums" style={{ color: warn ? A_RED : A_TEXT }}>{value}</div>
    </div>
  );
}

/* ─── AUDI MAP ────────────────────────────────────────────────── */
const AudiMap = memo(function AudiMap({ onOpenMap, fullMapOpen }: { onOpenMap: () => void; fullMapOpen?: boolean }) {
  return (
    <div className="flex flex-col h-full overflow-hidden"
      style={{ background: A_CARD, border: `1px solid ${A_BORDER}`, borderRadius: 20 }}>
      <div style={{ height: 3, background: A_RED, flexShrink: 0, borderRadius: '20px 20px 0 0' }} />
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {fullMapOpen
          ? <div className="w-full h-full flex items-center justify-center" style={{ background: '#0a0a0a' }}>
              <span className="text-sm font-light" style={{ color: A_DIM }}>Harita açık</span>
            </div>
          : <MiniMapWidget onFullScreenClick={onOpenMap} />
        }
      </div>
      <div className="flex-shrink-0 flex items-center gap-2 p-3"
        style={{ background: 'rgba(8,8,8,0.95)', borderTop: `1px solid ${A_BORDER}` }}>
        <button onClick={onOpenMap}
          className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg active:scale-[0.99] transition-all"
          style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${A_BORDER}` }}>
          <Search className="w-3.5 h-3.5" style={{ color: A_DIM }} />
          <span className="text-sm font-light" style={{ color: A_DIM }}>Hedef ara...</span>
        </button>
        <div className="rounded-lg px-3 py-2 text-center"
          style={{ background: `rgba(204,0,0,0.10)`, border: `1px solid rgba(204,0,0,0.20)` }}>
          <div className="text-[9px] font-light" style={{ color: A_DIM }}>MESAFE</div>
          <div className="text-sm font-medium tabular-nums" style={{ color: A_TEXT }}>128 km</div>
        </div>
      </div>
    </div>
  );
});

/* ─── AUDI MÜZIK + UYGULAMALAR ────────────────────────────────── */
const AudiSide = memo(function AudiSide({ appMap, onLaunch }: { appMap: Record<string, AppItem>; onLaunch: (id: string) => void }) {
  const { playing, track } = useMediaState();
  const ids = ['maps', 'phone', 'youtube', 'settings'];
  const apps = ids.map(id => ({ id, app: appMap[id] ?? APP_MAP[id] })).filter(x => x.app);

  return (
    <div className="flex flex-col gap-2.5 h-full min-h-0">

      {/* Müzik */}
      <div className="overflow-hidden"
        style={{ background: A_CARD, border: `1px solid ${A_BORDER}`, borderRadius: 20, flexShrink: 0 }}>
        <div style={{ height: 3, background: A_RED, borderRadius: '20px 20px 0 0' }} />
        <div className="p-3">
          <div className="text-[9px] uppercase tracking-[0.4em] font-light mb-2" style={{ color: A_DIM }}>MMI MÜZİK</div>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center overflow-hidden"
              style={{ background: 'rgba(204,0,0,0.12)', border: `1px solid rgba(204,0,0,0.22)` }}>
              {track.albumArt
                ? <img src={track.albumArt} className="w-full h-full object-cover" alt="" />
                : <span className="text-xl">🎵</span>
              }
            </div>
            <div className="min-w-0">
              <div className="font-medium text-sm leading-tight truncate" style={{ color: A_TEXT }}>
                {track.title || 'Seçilmedi'}
              </div>
              <div className="text-xs font-light mt-0.5 truncate" style={{ color: A_DIM }}>
                {track.artist || 'MMI Müzik'}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center gap-4">
            <button onClick={() => previous()} className="active:scale-90 transition-all p-1.5">
              <SkipBack className="w-4 h-4" style={{ color: A_DIM2 }} />
            </button>
            <button onClick={() => togglePlayPause()}
              className="w-10 h-10 rounded-xl flex items-center justify-center active:scale-90 transition-all"
              style={{ background: A_RED, boxShadow: `0 4px 14px rgba(204,0,0,0.40)` }}>
              {playing
                ? <Pause className="w-4 h-4" style={{ color: '#ffffff' }} />
                : <Play  className="w-4 h-4 ml-0.5" style={{ color: '#ffffff' }} />
              }
            </button>
            <button onClick={() => next()} className="active:scale-90 transition-all p-1.5">
              <SkipForward className="w-4 h-4" style={{ color: A_DIM2 }} />
            </button>
          </div>
        </div>
      </div>

      {/* Hızlı Uygulamalar */}
      <div className="flex-1 overflow-hidden"
        style={{ background: A_CARD, border: `1px solid ${A_BORDER}`, borderRadius: 20 }}>
        <div style={{ height: 3, background: A_RED, borderRadius: '20px 20px 0 0' }} />
        <div className="p-3">
          <div className="text-[9px] uppercase tracking-[0.4em] font-light mb-2" style={{ color: A_DIM }}>MMI UYGULAMALAR</div>
          <div className="grid grid-cols-2 gap-2">
            {apps.map(({ id, app }) => (
              <button key={id} onClick={() => onLaunch(id)}
                className="flex flex-col items-center gap-1.5 py-3 rounded-xl active:scale-90 transition-all"
                style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${A_BORDER}` }}>
                <span className="text-xl leading-none">{app!.icon}</span>
                <span className="text-[9px] font-light" style={{ color: A_DIM }}>{app!.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

/* ─── AUDI DOCK ───────────────────────────────────────────────── */
const AudiDock = memo(function AudiDock({ appMap, dockIds, onLaunch }: { appMap: Record<string, AppItem>; dockIds: string[]; onLaunch: (id: string) => void }) {
  const apps = dockIds.slice(0, 12).map(id => ({ id, app: appMap[id] ?? APP_MAP[id] })).filter(x => x.app);
  return (
    <div className="flex-shrink-0"
      style={{ background: 'rgba(8,8,8,0.99)', borderTop: `1px solid ${A_BORDER}`, boxShadow: `0 -1px 0 rgba(204,0,0,0.15)` }}>
      <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar px-4 py-2">
        {apps.map(({ id, app }) => (
          <button key={id} onClick={() => onLaunch(id)}
            className="flex flex-col items-center gap-1 flex-shrink-0 px-2.5 py-1.5 rounded-xl active:scale-90 transition-all min-w-[52px]">
            <span className="text-xl leading-none">{app!.icon}</span>
            <span className="text-[8px] font-light truncate w-full text-center" style={{ color: A_DIM }}>{app!.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

/* ─── AUDI LAYOUT ─────────────────────────────────────────────── */
export const AudiLayout = memo(function AudiLayout({
  onOpenMap, onOpenApps, onOpenSettings, onLaunch, appMap, dockIds, fullMapOpen,
}: Props) {
  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: A_BG }}>
      <AudiHeader onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onOpenMap={onOpenMap} />

      <div className="flex-1 min-h-0 grid gap-2.5 p-2.5 overflow-hidden"
        style={{ gridTemplateColumns: '1fr 1.1fr 0.85fr' }}>

        {/* Sol: Harita */}
        <AudiMap onOpenMap={onOpenMap} fullMapOpen={fullMapOpen} />

        {/* Orta: Virtual Cockpit */}
        <AudiCockpit />

        {/* Sağ: Müzik + Uygulamalar */}
        <AudiSide appMap={appMap} onLaunch={onLaunch} />
      </div>

      <AudiDock appMap={appMap} dockIds={dockIds} onLaunch={onLaunch} />
    </div>
  );
});
