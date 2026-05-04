import { memo, useState, lazy, Suspense } from 'react';
import {
  Search, Grid3X3, SkipBack, SkipForward, Play, Pause,
  Gauge, Thermometer, Fuel, Settings, Navigation2, Box, Mic,
} from 'lucide-react';

const VoiceAssistant = lazy(() => import('../modals/VoiceAssistant').then(m => ({ default: m.VoiceAssistant })));

const Vehicle3DViewer = lazy(() => import('../camera/Vehicle3DViewer').then(m => ({ default: m.Vehicle3DViewer })));
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
  smart?:         SmartSnapshot;
}

/* Tema renkleri CSS custom property — index.css [data-theme="audi"] */
const A_BG     = 'var(--bg-primary, #0d0d0d)';
const A_RED    = 'var(--accent, #CC0000)';
const A_SILVER = 'var(--accent2, #A8A9AD)';
const A_CARD   = 'var(--bg-card, rgba(20,20,20,0.95))';
const A_BORDER = 'var(--border-color, rgba(168,169,173,0.13))';
const A_TEXT   = 'var(--text, #FFFFFF)';
const A_DIM    = 'var(--text-dim, #8A9AAA)';
const A_DIM2   = 'var(--text-dim2, #B4BDC6)';

/* ─── AUDI HEADER ─────────────────────────────────────────────── */
const AudiHeader = memo(function AudiHeader({ onOpenApps, onOpenSettings, onOpenMap, onVoice }: { onOpenApps: () => void; onOpenSettings: () => void; onOpenMap: () => void; onVoice: () => void }) {
  const { settings } = useStore();
  const { time, date } = useClock(settings.use24Hour, false);
  const device = useDeviceStatus();

  return (
    <div className="flex items-center justify-between px-6 flex-shrink-0"
      style={{
        height: 56,
        background: 'rgba(8,8,8,0.99)',
        borderBottom: `1px solid ${A_BORDER}`,
        boxShadow: `0 1px 0 rgba(204,0,0,0.18)`,
      }}>

      {/* Sol: Audi rings + zaman */}
      <div className="flex items-center gap-4">
        {/* Audi 4 halka */}
        <div className="flex items-center flex-shrink-0">
          {[0,1,2,3].map(i => (
            <div key={i} className="w-7 h-7 rounded-full"
              style={{
                border: `2px solid ${A_SILVER}`,
                marginLeft: i === 0 ? 0 : -10,
                background: 'transparent',
                boxShadow: `0 0 6px rgba(168,169,173,0.12)`,
              }} />
          ))}
        </div>
        <div>
          <div className="font-light tabular-nums" style={{ fontSize: 'var(--lp-font-2xl, 32px)', color: A_TEXT, letterSpacing: '-0.5px' }}>{time}</div>
          <div className="uppercase font-light" style={{ fontSize: 9, color: A_DIM, letterSpacing: '0.18em' }}>{date}</div>
        </div>
      </div>

      {/* Orta: Araç verisi — COMPACT'ta gizlenir */}
      <div data-header-center className="flex items-center">
        <AStatus label="MENZIL" value="380 km" />
        <div className="w-px h-5 mx-3" style={{ background: A_BORDER }} />
        <AStatus label="BATARYA" value={device.ready ? `${device.battery}%` : '—'} />
        <div className="w-px h-5 mx-3" style={{ background: A_BORDER }} />
        <AStatus label="DIŞ SICAKLIK" value="21°C" />
      </div>

      {/* Sağ */}
      <div className="flex items-center gap-1.5">
        <AIconBtn onClick={onOpenSettings}><Settings className="w-4 h-4" style={{ color: A_DIM2 }} /></AIconBtn>
        <AIconBtn onClick={onOpenApps}><Grid3X3 className="w-4 h-4" style={{ color: A_DIM2 }} /></AIconBtn>
        <AIconBtn onClick={onVoice}><Mic className="w-4 h-4" style={{ color: A_RED }} /></AIconBtn>
        <button onClick={onOpenMap}
          className="flex items-center gap-1.5 px-4 h-11 rounded-xl active:scale-95 transition-all"
          style={{ background: A_RED, boxShadow: `0 3px 14px rgba(204,0,0,0.32)` }}>
          <Navigation2 className="w-3.5 h-3.5 text-white" />
          <span className="font-semibold text-[11px] text-white">GİT</span>
        </button>
      </div>
    </div>
  );
});

function AStatus({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="font-medium tabular-nums" style={{ fontSize: 13, color: A_TEXT }}>{value}</div>
      <div className="uppercase font-medium mt-0.5" style={{ fontSize: 10, color: A_DIM, letterSpacing: '0.15em' }}>{label}</div>
    </div>
  );
}

function AIconBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="w-11 h-11 rounded-xl flex items-center justify-center active:scale-95 transition-all"
      style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${A_BORDER}` }}>
      {children}
    </button>
  );
}

/* ─── AUDI VIRTUAL COCKPIT (Merkezi Hız + 3D mod) ────────────── */
const AudiSpeed = memo(function AudiSpeed() {
  const obd = useOBDState();
  const gps = useGPSLocation();
  const speedKmh = resolveSpeedKmh(gps, obd.speed ?? 0);
  const rpm  = obd.rpm        ?? 0;
  const temp = obd.engineTemp ?? 0;
  const fuel = obd.fuelLevel  ?? 0;
  const tempWarn = temp > 100;
  const fuelWarn = fuel < 15;
  const [show3D, setShow3D] = useState(false);
  const obdReady = obd.connectionState === 'connected' || obd.source === 'mock';
  const hasData  = obdReady || speedKmh > 0;

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
      style={{ background: A_CARD, border: `1px solid ${A_BORDER}`, borderRadius: 20, boxShadow: '0 8px 40px rgba(0,0,0,0.70), 0 2px 10px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)' }}>

      {/* Kırmızı üst çizgi + 3D toggle */}
      <div className="flex items-center flex-shrink-0" style={{ height: 3, background: A_RED, borderRadius: '20px 20px 0 0' }} />
      <div className="flex items-center justify-between px-3 pt-2 pb-0 flex-shrink-0">
        <div className="uppercase font-medium tracking-[0.4em]"
          style={{ fontSize: 9, color: A_RED }}>{show3D ? '3D ARAÇ' : 'VIRTUAL COCKPIT'}</div>
        <button
          onClick={() => setShow3D(v => !v)}
          className="w-7 h-7 rounded-lg flex items-center justify-center active:scale-90 transition-all"
          style={{
            background: show3D ? 'rgba(204,0,0,0.12)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${show3D ? 'rgba(204,0,0,0.30)' : A_BORDER}`,
          }}>
          <Box className="w-3.5 h-3.5" style={{ color: show3D ? A_RED : A_SILVER }} />
        </button>
      </div>

      {show3D ? (
        /* 3D Viewer modu */
        <div className="flex-1 min-h-0">
          <Suspense fallback={
            <div className="w-full h-full flex items-center justify-center">
              <div style={{ fontSize: 11, color: A_DIM }}>Yükleniyor…</div>
            </div>
          }>
            <Vehicle3DViewer accentColor="#CC0000" fps={30} autoRotate />
          </Suspense>
        </div>
      ) : (
        /* Virtual Cockpit modu */
        <div className="flex-1 flex items-center justify-center relative min-h-0">
          {!hasData ? (
            /* OBD bağlı değil — bekleme placeholder'ı */
            <div className="flex flex-col items-center justify-center gap-3">
              <div className="relative w-20 h-20">
                <div className="absolute inset-0 rounded-full border border-[rgba(204,0,0,0.20)] animate-ping [animation-duration:2.4s]" />
                <div className="absolute inset-2 rounded-full border border-[rgba(204,0,0,0.28)] animate-ping [animation-duration:2.4s] [animation-delay:0.6s]" />
                <div className="absolute inset-4 rounded-full border border-[rgba(204,0,0,0.38)] animate-ping [animation-duration:2.4s] [animation-delay:1.2s]" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Gauge className="w-6 h-6" style={{ color: 'rgba(204,0,0,0.55)' }} />
                </div>
              </div>
              <div className="text-center">
                <div className="font-medium uppercase" style={{ fontSize: 9, color: A_RED, letterSpacing: '0.3em' }}>Sinyal Bekleniyor</div>
                <div className="font-light mt-1" style={{ fontSize: 10, color: A_DIM }}>OBD · GPS</div>
              </div>
            </div>
          ) : (
            <div className="w-[min(260px,90%)] h-[min(260px,90%)] relative">
              <svg width="260" height="280" viewBox="0 0 260 280">
                <circle cx="130" cy="140" r="120" fill="none" stroke="rgba(168,169,173,0.05)" strokeWidth="1" />
                <path d={arc(135, 405)} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="14" strokeLinecap="butt" />
                {pct > 0.01 && (
                  <path d={arc(135, fillAngle)} fill="none" stroke={A_RED} strokeWidth="14" strokeLinecap="butt"
                    style={{ filter: `drop-shadow(0 0 6px rgba(204,0,0,0.55))` }} />
                )}
                <path d={rArc(rStart, rStart + rSpan)} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="8" strokeLinecap="butt" />
                {rPct > 0.01 && (
                  <path d={rArc(rStart, rStart + rPct * rSpan)} fill="none" stroke="rgba(168,169,173,0.55)" strokeWidth="8" strokeLinecap="butt" />
                )}
                <circle cx="130" cy="140" r="60" fill="rgba(0,0,0,0.80)" stroke="rgba(168,169,173,0.09)" strokeWidth="1" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center pt-3">
                <div className="font-thin tabular-nums leading-none"
                  style={{ fontSize: 'var(--lp-speed-font, 58px)', color: A_TEXT, letterSpacing: '-2px', textShadow: '0 0 20px rgba(255,255,255,0.18), 0 2px 6px rgba(0,0,0,0.50)' }}>
                  {speedKmh}
                </div>
                <div className="font-light uppercase mt-1.5" style={{ fontSize: 10, color: A_SILVER, letterSpacing: '0.45em' }}>km/h</div>
                <div className="font-light mt-2" style={{ fontSize: 10, color: A_DIM }}>{rpm.toLocaleString()} rpm</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Alt veri çubukları — her iki modda da gösterilir */}
      <div className="flex gap-2 px-4 pb-4 flex-shrink-0">
        <ADataCell Icon={Thermometer} label="MOTOR" value={hasData ? `${Math.round(temp)}°C` : '--'} warn={tempWarn} />
        <ADataCell Icon={Fuel}        label="YAKIT" value={hasData ? `${Math.round(fuel)}%`  : '--'} warn={fuelWarn} />
        <ADataCell Icon={Gauge}       label="TORK"  value={hasData ? '320 Nm'                : '--'} warn={false} />
      </div>
    </div>
  );
});

function ADataCell({ Icon, label, value, warn }: { Icon: typeof Gauge; label: string; value: string; warn: boolean }) {
  return (
    <div className="flex-1 rounded-xl p-3.5 text-center"
      style={{
        background: warn ? 'rgba(204,0,0,0.09)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${warn ? 'rgba(204,0,0,0.22)' : A_BORDER}`,
      }}>
      <Icon className="w-4 h-4 mx-auto mb-2" style={{ color: warn ? A_RED : A_SILVER }} />
      <div className="uppercase font-medium mb-1" style={{ fontSize: 10, color: A_DIM, letterSpacing: '0.10em' }}>{label}</div>
      <div className="font-semibold tabular-nums" style={{ fontSize: 14, color: warn ? A_RED : A_TEXT }}>{value}</div>
    </div>
  );
}

/* ─── AUDI MAP ────────────────────────────────────────────────── */
const AudiMap = memo(function AudiMap({ onOpenMap, fullMapOpen }: { onOpenMap: () => void; fullMapOpen?: boolean }) {
  return (
    <div className="flex flex-col h-full overflow-hidden"
      style={{ background: A_CARD, border: `1px solid ${A_BORDER}`, borderRadius: 20, boxShadow: '0 8px 40px rgba(0,0,0,0.70), 0 2px 10px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)' }}>
      <div style={{ height: 3, background: A_RED, flexShrink: 0, borderRadius: '20px 20px 0 0' }} />
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {fullMapOpen
          ? <div className="w-full h-full flex items-center justify-center bg-[#0a0a0a]">
              <span className="font-light" style={{ fontSize: 13, color: A_DIM }}>Harita açık</span>
            </div>
          : <MiniMapWidget onFullScreenClick={onOpenMap} />
        }
      </div>
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2.5"
        style={{ background: 'rgba(8,8,8,0.95)', borderTop: `1px solid ${A_BORDER}` }}>
        <button onClick={onOpenMap}
          className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl active:scale-[0.99] transition-all"
          style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${A_BORDER}` }}>
          <Search className="w-3.5 h-3.5" style={{ color: A_DIM }} />
          <span className="font-light" style={{ fontSize: 13, color: A_DIM }}>Hedef ara...</span>
        </button>
        <div className="rounded-xl px-3 py-2.5 text-center"
          style={{ background: 'rgba(204,0,0,0.08)', border: `1px solid rgba(204,0,0,0.18)` }}>
          <div className="font-light" style={{ fontSize: 9, color: A_DIM, letterSpacing: '0.1em' }}>MESAFE</div>
          <div className="font-semibold tabular-nums mt-0.5" style={{ fontSize: 13, color: A_TEXT }}>128 km</div>
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
        style={{ background: A_CARD, border: `1px solid ${A_BORDER}`, borderRadius: 20, flexShrink: 0, boxShadow: '0 4px 24px rgba(0,0,0,0.60), 0 1px 6px rgba(0,0,0,0.40)' }}>
        <div style={{ height: 3, background: A_RED, borderRadius: '20px 20px 0 0' }} />
        <div className="p-3.5">
          <div className="uppercase font-medium mb-3" style={{ fontSize: 10, color: A_DIM, letterSpacing: '0.28em' }}>MMI MÜZİK</div>
          <div className="flex items-center gap-3 mb-3.5">
            <div className="w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center overflow-hidden"
              style={{ background: 'rgba(204,0,0,0.10)', border: `1px solid rgba(204,0,0,0.20)` }}>
              {track.albumArt
                ? <img src={track.albumArt} className="w-full h-full object-cover" alt="" />
                : <span className="text-xl">🎵</span>
              }
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium leading-tight truncate" style={{ fontSize: 13, color: A_TEXT }}>
                {track.title || 'Seçilmedi'}
              </div>
              <div className="font-light mt-0.5 truncate" style={{ fontSize: 11, color: A_DIM }}>
                {track.artist || 'MMI Müzik'}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center gap-5">
            <button onClick={() => previous()} className="active:scale-90 transition-all p-2">
              <SkipBack className="w-4.5 h-4.5" style={{ color: A_DIM2 }} />
            </button>
            <button onClick={() => togglePlayPause()}
              className="w-11 h-11 rounded-xl flex items-center justify-center active:scale-90 transition-all"
              style={{ background: A_RED, boxShadow: `0 3px 12px rgba(204,0,0,0.38)` }}>
              {playing
                ? <Pause className="w-5 h-5 text-white" />
                : <Play  className="w-5 h-5 ml-0.5 text-white" />
              }
            </button>
            <button onClick={() => next()} className="active:scale-90 transition-all p-2">
              <SkipForward className="w-4.5 h-4.5" style={{ color: A_DIM2 }} />
            </button>
          </div>
        </div>
      </div>

      {/* Hızlı Uygulamalar */}
      <div className="flex-1 overflow-hidden"
        style={{ background: A_CARD, border: `1px solid ${A_BORDER}`, borderRadius: 20 }}>
        <div style={{ height: 3, background: A_RED, borderRadius: '20px 20px 0 0' }} />
        <div className="p-3.5">
          <div className="uppercase font-medium mb-3" style={{ fontSize: 10, color: A_DIM, letterSpacing: '0.28em' }}>MMI UYGULAMALAR</div>
          <div className="grid grid-cols-2 gap-2">
            {apps.map(({ id, app }) => (
              <button key={id} onClick={() => onLaunch(id)}
                className="flex flex-col items-center gap-1.5 py-3.5 rounded-xl active:scale-90 transition-all"
                style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${A_BORDER}` }}>
                <span className="text-xl leading-none">{app!.icon}</span>
                <span className="font-light" style={{ fontSize: 10, color: A_DIM }}>{app!.name}</span>
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
      style={{ background: 'rgba(8,8,8,0.99)', borderTop: `1px solid ${A_BORDER}`, boxShadow: `0 -1px 0 rgba(204,0,0,0.12)` }}>
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar px-4 py-2.5">
        {apps.map(({ id, app }) => (
          <button key={id} onClick={() => onLaunch(id)}
            className="flex flex-col items-center gap-1.5 flex-shrink-0 px-3 py-2.5 rounded-xl active:scale-90 transition-all"
            style={{ minWidth: 'var(--lp-tile-w, 56px)' }}>
            <span className="text-xl leading-none">{app!.icon}</span>
            <span className="font-medium truncate w-full text-center" style={{ fontSize: 10, color: A_DIM }}>{app!.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

/* ─── AUDI LAYOUT ─────────────────────────────────────────────── */
export const AudiLayout = memo(function AudiLayout({
  onOpenMap, onOpenApps, onOpenSettings, onLaunch, appMap, dockIds, fullMapOpen, smart,
}: Props) {
  const [voiceOpen, setVoiceOpen] = useState(false);
  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: A_BG }}>
      {voiceOpen && (
        <Suspense fallback={null}>
          <VoiceAssistant onClose={() => setVoiceOpen(false)} minimal />
        </Suspense>
      )}
      <AudiHeader onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onOpenMap={onOpenMap} onVoice={() => setVoiceOpen(true)} />

      <div className="flex-1 min-h-0 grid gap-2.5 p-2.5 overflow-hidden"
        style={{ gridTemplateColumns: 'var(--l-grid-cols, minmax(0,1fr) minmax(0,1.1fr) minmax(0,0.85fr))' }}>

        {/* Sol: Harita */}
        <AudiMap onOpenMap={onOpenMap} fullMapOpen={fullMapOpen} />

        {/* Orta: Virtual Cockpit */}
        <AudiSpeed />

        {/* Sağ: Müzik + Uygulamalar */}
        <AudiSide appMap={appMap} onLaunch={onLaunch} />
      </div>

      {smart && smart.predictions.length > 0 && (
        <div className="px-2.5 pb-1.5">
          <MagicContextCard smart={smart} variant="audi" onLaunch={onLaunch} onOpenMap={onOpenMap} />
        </div>
      )}

      <AudiDock appMap={appMap} dockIds={dockIds} onLaunch={onLaunch} />
    </div>
  );
});
