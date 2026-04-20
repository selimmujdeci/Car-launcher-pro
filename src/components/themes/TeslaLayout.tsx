import { memo, useState, lazy, Suspense, useRef, useCallback } from 'react';

const VoiceAssistant = lazy(() => import('../modals/VoiceAssistant').then(m => ({ default: m.VoiceAssistant })));
import {
  Search, Grid3X3, SkipBack, SkipForward, Play, Pause,
  Gauge, Thermometer, Fuel, Mic, Settings, Navigation,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useMediaState, togglePlayPause, next, previous } from '../../platform/mediaService';
import { useOBDState } from '../../platform/obdService';
import { useGPSLocation, resolveSpeedKmh } from '../../platform/gpsService';
import { useClock } from '../../hooks/useClock';
import { useDeviceStatus } from '../../platform/deviceApi';
import { MiniMapWidget } from '../map/MiniMapWidget';
import { resolveAndNavigate } from '../../platform/addressNavigationEngine';
import { APP_MAP, type AppItem } from '../../data/apps';

/* ══════════════════════════════════════════
   TESLA THEME — Model S Plaid Cockpit
   Siyah + beyaz + kırmızı vurgu
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

/* Tema sabitleri CSS custom property olarak index.css [data-theme="tesla"]'da tanımlı.
   Buradaki JS referansları saf CSS var() alias — JS bundle'a renk değeri girmez. */
const T_BG     = 'var(--bg-primary, #000000)';
const T_RED    = 'var(--accent, #E31937)';
const T_CARD   = 'var(--bg-card, rgba(18,18,18,0.95))';
const T_CARD2  = 'var(--bg-card2, rgba(24,24,24,0.90))';
const T_BORDER = 'var(--border-color, rgba(255,255,255,0.07))';
const T_TEXT   = 'var(--text, #FFFFFF)';
const T_DIM    = 'var(--text-dim, #8A9AAA)';
const T_DIM2   = 'var(--text-dim2, #B4BDC6)';

/* ─── TESLA HEADER ────────────────────────────────────────────── */
const TeslaHeader = memo(function TeslaHeader({ onOpenApps, onOpenSettings, onVoice }: { onOpenApps: () => void; onOpenSettings: () => void; onVoice: () => void }) {
  const { settings } = useStore();
  const { time } = useClock(settings.use24Hour, false);
  const device = useDeviceStatus();

  return (
    <div className="flex items-center justify-between px-6 flex-shrink-0"
      style={{
        height: 56,
        background: 'rgba(0,0,0,0.98)',
        borderBottom: `1px solid ${T_BORDER}`,
      }}>

      {/* Sol: Tesla logo + saat */}
      <div className="flex items-center gap-5">
        <svg width="34" height="15" viewBox="0 0 342 140" fill={T_RED}>
          <path d="M0 0h342v14c-28 0-56-7-84-7-28 0-56 7-84 7s-56-7-84-7C62 7 34 14 0 14V0z"/>
          <path d="M100 14h142v112l-71 14-71-14V14z"/>
        </svg>
        <div className="font-extralight tabular-nums" style={{ fontSize: 'var(--lp-font-2xl, 32px)', color: T_TEXT, letterSpacing: '-0.5px' }}>{time}</div>
      </div>

      {/* Orta: Durum — COMPACT'ta gizlenir */}
      <div data-header-center className="flex items-center gap-2">
        <TSlot label="MENZIL" value="420 km" />
        <div className="w-px h-4" style={{ background: T_BORDER }} />
        <TSlot label="BATARYA" value={device.ready ? `${device.battery}%` : '—'} />
        <div className="w-px h-4" style={{ background: T_BORDER }} />
        <TSlot label="ISIL" value="21°C" />
      </div>

      {/* Sağ: Aksiyonlar */}
      <div className="flex items-center gap-1.5">
        <TIconBtn onClick={onOpenSettings}><Settings className="w-4 h-4" style={{ color: T_DIM2 }} /></TIconBtn>
        <TIconBtn onClick={onOpenApps}><Grid3X3 className="w-4 h-4" style={{ color: T_DIM2 }} /></TIconBtn>
        <TIconBtn onClick={onVoice} accent>
          <Mic className="w-4 h-4" style={{ color: T_RED }} />
        </TIconBtn>
      </div>
    </div>
  );
});

function TSlot({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center px-2">
      <div className="font-medium tabular-nums" style={{ fontSize: 13, color: T_TEXT }}>{value}</div>
      <div className="uppercase tracking-widest mt-0.5" style={{ fontSize: 10, color: T_DIM, letterSpacing: '0.10em' }}>{label}</div>
    </div>
  );
}

function TIconBtn({ onClick, children, accent }: { onClick: () => void; children: React.ReactNode; accent?: boolean }) {
  return (
    <button onClick={onClick}
      className="w-11 h-11 rounded-xl flex items-center justify-center active:scale-95 transition-all"
      style={{
        background: accent ? 'rgba(227,25,55,0.10)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${accent ? 'rgba(227,25,55,0.22)' : T_BORDER}`,
      }}>
      {children}
    </button>
  );
}

/* ─── TESLA MAP PANEL ─────────────────────────────────────────── */
const TeslaMap = memo(function TeslaMap({ onOpenMap, fullMapOpen, onVoice }: { onOpenMap: () => void; fullMapOpen?: boolean; onVoice: () => void }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const gps = useGPSLocation();

  const handleSubmit = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    const loc = gps?.latitude != null ? { lat: gps.latitude, lng: gps.longitude! } : undefined;
    resolveAndNavigate(q, loc);
    setQuery('');
    inputRef.current?.blur();
  }, [query, gps]);

  return (
    <div className="flex flex-col h-full overflow-hidden relative"
      style={{ background: T_CARD, border: `1px solid ${T_BORDER}`, borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.70), 0 2px 10px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)' }}>

      <div className="flex-1 min-h-0 overflow-hidden relative">
        {fullMapOpen
          ? <div className="w-full h-full flex flex-col items-center justify-center gap-3"
              style={{ background: '#0a0a0a' }}>
              <div className="text-sm font-light" style={{ color: T_DIM }}>Harita açık</div>
            </div>
          : <MiniMapWidget onFullScreenClick={onOpenMap} />
        }
      </div>

      {/* Tesla nav bar */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2.5"
        style={{ background: 'rgba(0,0,0,0.92)', borderTop: `1px solid ${T_BORDER}` }}>
        <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${T_BORDER}` }}>
          <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: T_DIM }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            placeholder="Nereye gidiyorsunuz?"
            className="flex-1 bg-transparent outline-none font-light"
            style={{ fontSize: 13, color: query ? T_TEXT : T_DIM }}
          />
          {query.length > 0 && (
            <button onClick={handleSubmit} className="flex-shrink-0 active:scale-90 transition-all">
              <Navigation className="w-3.5 h-3.5" style={{ color: T_RED }} />
            </button>
          )}
        </div>
        <button
          onClick={onVoice}
          className="flex items-center justify-center rounded-xl transition-all active:scale-95 flex-shrink-0"
          style={{ width: 44, height: 44, background: 'rgba(227,25,55,0.12)', border: '1px solid rgba(227,25,55,0.28)' }}
        >
          <Mic className="w-4 h-4" style={{ color: T_RED }} />
        </button>
        <div className="px-3 py-2 rounded-xl text-center" style={{ background: 'rgba(227,25,55,0.08)', border: `1px solid rgba(227,25,55,0.18)` }}>
          <div style={{ fontSize: 9, color: T_DIM, letterSpacing: '0.1em', textTransform: 'uppercase' }}>ETA</div>
          <div className="font-medium tabular-nums mt-0.5" style={{ fontSize: 13, color: T_TEXT }}>18:45</div>
        </div>
      </div>
    </div>
  );
});

/* ─── TESLA SPEED ─────────────────────────────────────────────── */
const TeslaSpeed = memo(function TeslaSpeed() {
  const obd = useOBDState();
  const gps = useGPSLocation();
  const speedKmh = resolveSpeedKmh(gps, obd.speed ?? 0);
  const rpm  = obd.rpm        ?? 929;
  const temp = obd.engineTemp ?? 88;
  const fuel = obd.fuelLevel  ?? 68;
  const tempWarn = temp > 100;
  const fuelWarn = fuel < 15;

  const R = 78, cx = 100, cy = 105;
  const pct = Math.min(speedKmh / 200, 1);
  const rad = (d: number) => (d * Math.PI) / 180;
  const pt  = (a: number) => ({ x: cx + R * Math.cos(rad(a)), y: cy + R * Math.sin(rad(a)) });
  const arc = (a1: number, a2: number) => {
    const s = pt(a1), e = pt(a2), large = a2 - a1 > 180 ? 1 : 0;
    return `M${s.x} ${s.y} A${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`;
  };
  const fillAngle = 135 + pct * 270;

  return (
    <div className="flex flex-col h-full overflow-hidden"
      style={{ background: T_CARD, border: `1px solid ${T_BORDER}`, borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.70), 0 2px 10px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)' }}>

      {/* Hız göstergesi */}
      <div className="flex-1 flex items-center justify-center relative">
        <div style={{ width: 'var(--lp-speedo, 175px)', height: 'var(--lp-speedo, 175px)', position: 'relative' }}>
          <svg width="100%" height="100%" viewBox="0 0 200 210">
            <path d={arc(135, 405)} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" strokeLinecap="round" />
            {pct > 0.01 && (
              <path d={arc(135, fillAngle)} fill="none" stroke={T_RED} strokeWidth="10" strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 7px rgba(227,25,55,0.55))` }} />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ paddingTop: 8 }}>
            <div className="font-light tabular-nums leading-none" style={{ fontSize: 'var(--lp-speed-font, 58px)', color: T_TEXT, letterSpacing: '-2px', textShadow: '0 0 20px rgba(255,255,255,0.18), 0 2px 6px rgba(0,0,0,0.50)' }}>
              {speedKmh}
            </div>
            <div className="font-light mt-1.5 uppercase" style={{ fontSize: 10, color: T_DIM, letterSpacing: '0.45em' }}>
              km/h
            </div>
          </div>
        </div>
      </div>

      {/* Veri çubukları */}
      <div className="flex flex-shrink-0 gap-2 pb-4 px-4">
        <TDataRow Icon={Gauge}       label="RPM"   value={rpm.toLocaleString()} warn={false} />
        <TDataRow Icon={Thermometer} label="ISIL"  value={`${Math.round(temp)}°`} warn={tempWarn} />
        <TDataRow Icon={Fuel}        label="YAKIT" value={`${Math.round(fuel)}%`} warn={fuelWarn} />
      </div>
    </div>
  );
});

function TDataRow({ Icon, label, value, warn }: { Icon: typeof Gauge; label: string; value: string; warn: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center py-3.5 rounded-xl"
      style={{ background: warn ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${warn ? 'rgba(239,68,68,0.20)' : T_BORDER}` }}>
      <Icon className="w-4 h-4 mb-2" style={{ color: warn ? '#EF4444' : T_DIM }} />
      <div className="uppercase mb-0.5" style={{ fontSize: 10, color: T_DIM, letterSpacing: '0.10em' }}>{label}</div>
      <div className="font-semibold tabular-nums" style={{ fontSize: 14, color: warn ? '#EF4444' : T_TEXT }}>{value}</div>
    </div>
  );
}

/* ─── TESLA MUSIC ─────────────────────────────────────────────── */
const TeslaMusic = memo(function TeslaMusic() {
  const { playing, track } = useMediaState();
  return (
    <div className="flex flex-col h-full overflow-hidden"
      style={{ background: T_CARD, border: `1px solid ${T_BORDER}`, borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.70), 0 2px 10px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)' }}>

      <div className="px-4 pt-3.5 pb-2.5 flex-shrink-0"
        style={{ borderBottom: `1px solid ${T_BORDER}` }}>
        <div className="uppercase font-medium" style={{ fontSize: 10, color: T_DIM, letterSpacing: '0.28em' }}>ÇAL</div>
      </div>

      <div className="flex-1 flex items-center gap-3 px-4 min-h-0">
        <div className="rounded-2xl flex-shrink-0 flex items-center justify-center overflow-hidden"
          style={{
            width: 'var(--lp-album, 52px)', height: 'var(--lp-album, 52px)',
            background: 'rgba(227,25,55,0.12)', border: `1px solid rgba(227,25,55,0.22)`,
          }}>
          {track.albumArt
            ? <img src={track.albumArt} className="w-full h-full object-cover" alt="" />
            : <span style={{ fontSize: 'var(--lp-font-xl, 22px)' }}>🎵</span>
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium leading-tight truncate" style={{ fontSize: 14, color: T_TEXT }}>
            {track.title || 'Seçili şarkı yok'}
          </div>
          <div className="font-light mt-0.5 truncate" style={{ fontSize: 12, color: T_DIM }}>
            {track.artist || 'Müzik çalmıyor'}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-5 flex-shrink-0 py-3.5">
        <button onClick={() => previous()} className="active:scale-90 transition-all p-2.5">
          <SkipBack className="w-5 h-5" style={{ color: T_DIM2 }} />
        </button>
        <button onClick={() => togglePlayPause()}
          className="w-12 h-12 rounded-2xl flex items-center justify-center active:scale-90 transition-all"
          style={{ background: T_RED, boxShadow: `0 4px 18px rgba(227,25,55,0.38)` }}>
          {playing
            ? <Pause className="w-5 h-5" style={{ color: '#ffffff' }} />
            : <Play  className="w-5 h-5 ml-0.5" style={{ color: '#ffffff' }} />
          }
        </button>
        <button onClick={() => next()} className="active:scale-90 transition-all p-2.5">
          <SkipForward className="w-5 h-5" style={{ color: T_DIM2 }} />
        </button>
      </div>
    </div>
  );
});

/* ─── TESLA QUICK APPS ────────────────────────────────────────── */
const TeslaApps = memo(function TeslaApps({ appMap, onLaunch }: { appMap: Record<string, AppItem>; onLaunch: (id: string) => void }) {
  const ids = ['maps', 'phone', 'youtube', 'settings'];
  const apps = ids.map(id => ({ id, app: appMap[id] ?? APP_MAP[id] })).filter(x => x.app);
  return (
    <div className="flex-shrink-0 flex gap-2 px-3 pb-3">
      {apps.map(({ id, app }) => (
        <button key={id} onClick={() => onLaunch(id)}
          className="flex-1 flex flex-col items-center gap-2 py-3.5 rounded-2xl active:scale-90 transition-all"
          style={{ background: T_CARD2, border: `1px solid ${T_BORDER}` }}>
          <span className="text-2xl leading-none">{app!.icon}</span>
          <span className="font-medium" style={{ fontSize: 11, color: T_DIM }}>{app!.name}</span>
        </button>
      ))}
    </div>
  );
});

/* ─── TESLA DOCK ──────────────────────────────────────────────── */
const TeslaDock = memo(function TeslaDock({ appMap, dockIds, onLaunch }: { appMap: Record<string, AppItem>; dockIds: string[]; onLaunch: (id: string) => void }) {
  const apps = dockIds.slice(0, 12).map(id => ({ id, app: appMap[id] ?? APP_MAP[id] })).filter(x => x.app);
  return (
    <div className="flex-shrink-0"
      style={{
        background: 'rgba(0,0,0,0.98)',
        borderTop: `1px solid ${T_BORDER}`,
      }}>
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar px-4 py-2.5">
        {apps.map(({ id, app }) => (
          <button key={id} onClick={() => onLaunch(id)}
            className="flex flex-col items-center gap-1.5 flex-shrink-0 px-3 py-2.5 rounded-xl active:scale-90 transition-all"
            style={{ minWidth: 'var(--lp-tile-w, 56px)' }}>
            <span className="text-xl leading-none">{app!.icon}</span>
            <span className="font-medium truncate w-full text-center" style={{ fontSize: 10, color: T_DIM }}>{app!.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

/* ─── TESLA LAYOUT ────────────────────────────────────────────── */
export const TeslaLayout = memo(function TeslaLayout({
  onOpenMap, onOpenApps, onOpenSettings, onLaunch, appMap, dockIds, fullMapOpen,
}: Props) {
  const [voiceOpen, setVoiceOpen] = useState(false);
  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: T_BG }}>
      {voiceOpen && (
        <Suspense fallback={null}>
          <VoiceAssistant onClose={() => setVoiceOpen(false)} minimal />
        </Suspense>
      )}
      <TeslaHeader onOpenApps={onOpenApps} onOpenSettings={onOpenSettings} onVoice={() => setVoiceOpen(true)} />

      <div className="flex-1 min-h-0 flex overflow-hidden"
        style={{
          gap: 'var(--lp-space-sm, 8px)',
          padding: 'var(--lp-space-sm, 8px)',
          paddingLeft: 'calc(var(--lp-space-sm, 8px) + var(--lp-side-pad, 0px))',
          paddingRight: 'calc(var(--lp-space-sm, 8px) + var(--lp-side-pad, 0px))',
        }}>

        {/* Sol — Harita (büyük) */}
        <div className="flex-[1.8] min-w-0 min-h-0">
          <TeslaMap onOpenMap={onOpenMap} fullMapOpen={fullMapOpen} onVoice={() => setVoiceOpen(true)} />
        </div>

        {/* Sağ — Hız + Müzik */}
        <div data-tesla-right className="flex flex-col gap-2 min-h-0" style={{ width: 'var(--lp-right-panel, 200px)', flexShrink: 0 }}>
          <div className="flex-1 min-h-0">
            <TeslaSpeed />
          </div>
          <div data-tesla-music style={{ height: 'var(--lp-music-card, 155px)', flexShrink: 0 }}>
            <TeslaMusic />
          </div>
        </div>
      </div>

      <TeslaApps appMap={appMap} onLaunch={onLaunch} />
      <TeslaDock appMap={appMap} dockIds={dockIds} onLaunch={onLaunch} />
    </div>
  );
});
