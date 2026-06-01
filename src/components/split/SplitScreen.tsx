/**
 * Split Screen — OEM Cockpit grid: Map (sol, 2 satır span) + Media (sağ üst) + Telemetry (sağ alt).
 *
 * Big speed HUD merkezde halo-pulse + oklch text-shadow ile.
 * MiniHUD glass paneller harita altında ETA/Mesafe/Şarj gösterir.
 * SAFE_MODE: halo-pulse + heavy blur kapatılır (GPU safety).
 */

import { memo, useCallback, useState, useSyncExternalStore, useMemo } from 'react';
import {
  X, Maximize2, Music, Map as MapIcon,
  Play, Pause, SkipBack, SkipForward, Plus, Compass,
} from 'lucide-react';
import { MiniMapWidget } from '../map/MiniMapWidget';
import { FullMapView } from '../map/FullMapView';
import {
  useMediaState,
  togglePlayPause,
  next,
  previous,
  fmtTime,
} from '../../platform/mediaService';
import { useOBDState } from '../../platform/obdService';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer';
import { useRouteState } from '../../platform/routingService';
import { useNavigation, formatDistance } from '../../platform/navigationService';
import { openMusicDrawer } from '../../platform/mediaUi';
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../../core/runtime/runtimeTypes';
import '../../styles/oem-cockpit.css';

/* SAFE_MODE subscription */
function subscribeRuntime(cb: () => void) { return runtimeManager.subscribe(cb); }
function getRuntimeMode() { return runtimeManager.getMode(); }

/* ── AlbumArt — premium 4-layer shadow + texture + specular sweep ── */
function AlbumArt({ size, src, hue = 42 }: { size: number; src?: string; hue?: number }) {
  return (
    <div style={{
      width: size, height: size,
      borderRadius: Math.max(12, size * 0.10),
      flex: 'none',
      background: src
        ? '#0d0d12'
        : `radial-gradient(120% 80% at 30% 20%, oklch(75% 0.10 ${hue} / 0.55), transparent 60%),` +
          ` linear-gradient(140deg, oklch(56% 0.10 ${hue}) 0%, oklch(28% 0.08 ${hue + 30}) 100%)`,
      position: 'relative',
      overflow: 'hidden',
      boxShadow:
        '0 1px 0 rgba(255,240,210,0.18) inset,' +
        ' 0 -1px 0 rgba(0,0,0,0.30) inset,' +
        ' 0 12px 32px rgba(0,0,0,0.55),' +
        ' 0 2px 6px rgba(0,0,0,0.30)',
      border: '1px solid rgba(0,0,0,0.3)',
    }}>
      {src && <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 12px, transparent 12px 28px)',
      }} />
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'linear-gradient(135deg, rgba(255,240,210,0.18) 0%, transparent 35%)',
      }} />
      {!src && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ color: 'rgba(255,255,255,0.55)' }}>
          <Music style={{ width: size * 0.32, height: size * 0.32, strokeWidth: 1.2 }} />
        </div>
      )}
    </div>
  );
}

/* ── MiniHUD — eyebrow + value (per screens.jsx 999-1006) ── */
function MiniHUD({ label, value, tone }: { label: string; value: string; tone?: 'good' }) {
  return (
    <div>
      <div className="text-[10px] font-black uppercase tracking-[0.20em]"
        style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
        {label}
      </div>
      <div className="tabular-nums mt-1"
        style={{
          fontSize: 'clamp(16px, 1.8vw, 20px)',
          fontWeight: 500,
          color: tone === 'good' ? 'var(--oem-good, oklch(80% 0.10 158))' : 'var(--oem-ink, #F0EBE0)',
        }}>
        {value}
      </div>
    </div>
  );
}

/* ── MiniMetric — bottom telemetry strip cells ── */
function MiniMetric({ label, value, unit, tone }: {
  label: string; value: string; unit: string; tone?: 'amber';
}) {
  const color = tone === 'amber'
    ? 'var(--oem-amber, oklch(80% 0.13 60))'
    : 'var(--oem-ink, #F0EBE0)';
  return (
    <div className="rounded-2xl p-3.5"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--oem-line, rgba(255,240,210,0.08))',
      }}>
      <div className="text-[10px] font-black uppercase tracking-[0.20em] mb-1.5"
        style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="tabular-nums" style={{ fontSize: 22, fontWeight: 500, color, letterSpacing: '-0.01em' }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 11, color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>{unit}</span>
        )}
      </div>
    </div>
  );
}

/* ── Glass panel base style ── */
const GLASS_PANEL: React.CSSProperties = {
  background: 'var(--oem-surface-1, rgba(38,44,60,0.78))',
  border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
  borderRadius: 28,
  backdropFilter: 'blur(calc(var(--rt-blur, 1) * 18px)) saturate(120%)',
  WebkitBackdropFilter: 'blur(calc(var(--rt-blur, 1) * 18px)) saturate(120%)',
  boxShadow: '0 1px 0 rgba(255,240,210,0.10) inset, 0 24px 56px -24px rgba(0,0,0,0.70)',
};

/* ── Big speed HUD overlay (per screens.jsx 930-938) ── */
function BigSpeedHUD({ speedKmh, limitKmh, isSafeMode }: {
  speedKmh: number; limitKmh?: number | null; isSafeMode: boolean;
}) {
  return (
    <div className="absolute pointer-events-none"
      style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
      {/* Halo-pulse — disabled under SAFE_MODE */}
      {!isSafeMode && (
        <div className="oem-halo-pulse" style={{
          position: 'absolute', inset: -80, borderRadius: 999,
          background: 'radial-gradient(circle, oklch(78% 0.10 60 / 0.28), transparent 60%)',
          filter: 'blur(24px)',
        }} />
      )}
      <div className="tabular-nums" style={{
        fontSize: 'clamp(100px, 14vw, 220px)',
        fontWeight: 200,
        color: 'var(--oem-ink, #F0EBE0)',
        letterSpacing: '-0.05em',
        lineHeight: 1,
        textShadow: 'var(--oem-amber-soft, oklch(78% 0.10 60 / 0.35)) 0 0 100px,' +
                    ' var(--oem-amber-glow, oklch(86% 0.10 70 / 0.32)) 0 0 40px',
        position: 'relative',
      }}>
        {Math.round(speedKmh)}
      </div>
      <div className="mt-2 font-bold"
        style={{
          fontSize: 14,
          letterSpacing: '0.36em',
          color: 'var(--oem-amber, oklch(80% 0.13 60))',
          position: 'relative',
        }}>
        KM · SAAT {limitKmh != null && limitKmh > 0 ? `· LİMİT ${limitKmh}` : ''}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* ─ Main SplitScreen ────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────── */

interface SplitScreenProps {
  onClose: () => void;
}

export const SplitScreen = memo(function SplitScreen({ onClose }: SplitScreenProps) {
  const [mapFullScreen, setMapFullScreen] = useState(false);
  const { playing, track } = useMediaState();
  const obd = useOBDState();
  const fuelPct  = useUnifiedVehicleStore((s) => s.fuel);
  const rawSpeed = useUnifiedVehicleStore((s) => s.speed);
  const engineT  = obd.engineTemp >= 0 ? obd.engineTemp : null;
  const speedKmh = rawSpeed ?? 0;
  const route = useRouteState();
  const nav   = useNavigation();

  const runtimeMode = useSyncExternalStore(subscribeRuntime, getRuntimeMode, getRuntimeMode);
  const isSafeMode  = runtimeMode === RuntimeMode.SAFE_MODE;

  // Detail: speed limit (best-effort — we don't subscribe to dynamic limit here to avoid extra fetch)
  const speedLimit: number | null = null;

  // ETA computation
  const arrivalStr = useMemo(() => {
    const sec = nav.etaSeconds ?? route.totalDurationSeconds ?? 0;
    if (sec <= 0) return '—';
    const d = new Date(Date.now() + sec * 1000);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }, [nav.etaSeconds, route.totalDurationSeconds]);

  const distLabel = useMemo(() => {
    const m = nav.distanceMeters ?? route.totalDistanceMeters ?? 0;
    return m > 0 ? formatDistance(m) : '—';
  }, [nav.distanceMeters, route.totalDistanceMeters]);

  // Range / cabin / battery (best-effort fallbacks)
  const rangeKm = obd.fuelLevel >= 0 ? Math.round((obd.fuelLevel / 100) * 750) : null;
  const launch  = useCallback(() => openMusicDrawer(), []);
  const pct     = track.durationSec > 0 ? Math.min(100, (track.positionSec / track.durationSec) * 100) : 0;

  if (mapFullScreen) {
    return <FullMapView onClose={() => setMapFullScreen(false)} />;
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{
        background:
          'linear-gradient(180deg, var(--oem-bg-deep, #0E1218) 0%, var(--oem-bg, #131822) 60%, var(--oem-bg-deep, #0E1218) 100%)',
      }}
    >
      {/* Top header strip — title + close */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-3"
        style={{ borderBottom: '1px solid var(--oem-line, rgba(255,240,210,0.08))' }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, oklch(82% 0.10 65 / 0.30), oklch(60% 0.10 50 / 0.10))',
              border: '1px solid var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))',
              color: 'var(--oem-amber, oklch(80% 0.13 60))',
            }}>
            <MapIcon className="w-4 h-4" />
          </div>
          <span className="text-[11px] font-black uppercase tracking-[0.20em]"
            style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
            Sürüş & Müzik · Split
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Kapat"
          className="w-10 h-10 rounded-2xl flex items-center justify-center active:scale-90 transition-all"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
            color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
          }}>
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Grid: Map (left, spans both rows) | Media (top right) + Telemetry (bottom right) */}
      <div className="flex-1 min-h-0 p-4"
        style={{
          display: 'grid',
          gridTemplateColumns: '1.3fr 1fr',
          gridTemplateRows: '1fr auto',
          gap: 16,
        }}>

        {/* ─── MAP (left, full height) ───────────────────────────── */}
        <div className="overflow-hidden relative min-h-0 min-w-0"
          style={{ ...GLASS_PANEL, gridColumn: '1', gridRow: '1 / 3' }}>
          {/* Map canvas */}
          <div className="absolute inset-0">
            <MiniMapWidget onFullScreenClick={() => setMapFullScreen(true)} hideHeader hideOverlay />
          </div>

          {/* Top-left turn hint (placeholder when no active route) */}
          <div className="absolute top-5 left-5 right-5 flex justify-between items-start pointer-events-none">
            {route.steps.length > 0 && route.steps[route.currentStepIndex] ? (
              <div className="pointer-events-auto rounded-[1.5rem] px-5 py-3.5 flex items-center gap-4"
                style={{
                  background: 'var(--oem-surface-1, rgba(38,44,60,0.78))',
                  border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
                  backdropFilter: 'blur(calc(var(--rt-blur, 1) * 18px)) saturate(120%)',
                  WebkitBackdropFilter: 'blur(calc(var(--rt-blur, 1) * 18px)) saturate(120%)',
                  boxShadow: '0 1px 0 rgba(255,240,210,0.10) inset, 0 20px 50px -22px rgba(0,0,0,0.55)',
                  maxWidth: '70%',
                }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 14,
                  background: 'linear-gradient(135deg, oklch(82% 0.10 65 / 0.30), oklch(60% 0.10 50 / 0.10))',
                  border: '1px solid var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))',
                  display: 'grid', placeItems: 'center',
                  color: 'var(--oem-amber, oklch(80% 0.13 60))',
                  boxShadow: '0 0 20px oklch(70% 0.10 60 / 0.20), 0 1px 0 rgba(255,240,210,0.10) inset',
                  flexShrink: 0,
                }}>
                  <Compass className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-[0.20em]"
                    style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
                    {formatDistance(route.distanceToNextTurnMeters || 0)} sonra
                  </div>
                  <div className="text-base font-bold mt-0.5 truncate"
                    style={{ color: 'var(--oem-ink, #F0EBE0)', letterSpacing: '-0.005em' }}>
                    {route.steps[route.currentStepIndex]?.streetName || 'Düz devam'}
                  </div>
                </div>
              </div>
            ) : <span />}
            {/* Live tag */}
            <div className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{
                background: 'rgba(34,197,94,0.10)',
                border: '1px solid rgba(34,197,94,0.28)',
              }}>
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#4ade80' }}>
                GPS · CANLI
              </span>
            </div>
          </div>

          {/* Big speed HUD — center */}
          <BigSpeedHUD speedKmh={speedKmh} limitKmh={speedLimit} isSafeMode={isSafeMode} />

          {/* Bottom MiniHUD strip + map controls */}
          <div className="absolute left-5 right-5 bottom-5 flex items-end justify-between pointer-events-none">
            <div className="pointer-events-auto flex gap-9 px-7 py-4 rounded-[1.5rem]"
              style={{
                background: 'var(--oem-surface-1, rgba(38,44,60,0.78))',
                border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
                backdropFilter: 'blur(calc(var(--rt-blur, 1) * 18px)) saturate(120%)',
                WebkitBackdropFilter: 'blur(calc(var(--rt-blur, 1) * 18px)) saturate(120%)',
                boxShadow: '0 1px 0 rgba(255,240,210,0.10) inset, 0 20px 50px -22px rgba(0,0,0,0.55)',
              }}>
              <MiniHUD label="Varış"  value={arrivalStr} />
              <MiniHUD label="Mesafe" value={distLabel} />
              <MiniHUD label="Yakıt"  value={fuelPct != null ? `%${Math.round(fuelPct)}` : '—'} tone="good" />
            </div>
            <div className="pointer-events-auto flex gap-2">
              <button aria-label="Yakınlaş"
                className="w-11 h-11 rounded-full flex items-center justify-center active:scale-90 transition-all"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
                  color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
                }}>
                <Plus className="w-4 h-4" />
              </button>
              <button onClick={() => setMapFullScreen(true)} aria-label="Tam ekran"
                className="w-11 h-11 rounded-full flex items-center justify-center active:scale-90 transition-all"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
                  color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
                }}>
                <Maximize2 className="w-4 h-4" />
              </button>
              <button aria-label="Merkezle"
                className="w-11 h-11 rounded-full flex items-center justify-center active:scale-90 transition-all"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
                  color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
                }}>
                <Compass className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* ─── MEDIA (top right) ────────────────────────────────── */}
        <div className="overflow-hidden p-5 flex flex-col min-h-0"
          style={{ ...GLASS_PANEL, gridColumn: '2', gridRow: '1' }}>
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <span className="text-[10px] font-black uppercase tracking-[0.20em]"
              style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
              Çalıyor
            </span>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.28)' }}>
              <div className="w-1 h-1 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#4ade80' }}>HD</span>
            </div>
          </div>

          <button onClick={launch}
            className="flex gap-4 items-center flex-1 min-h-0 active:opacity-80 transition-opacity text-left">
            <AlbumArt size={120} src={track.albumArt ?? undefined} hue={42} />
            <div className="flex-1 min-w-0">
              <div className="truncate" style={{ fontSize: 22, fontWeight: 500, color: 'var(--oem-ink, #F0EBE0)', letterSpacing: '-0.01em' }}>
                {track.title || 'Çalmıyor'}
              </div>
              <div className="text-sm truncate mt-1" style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
                {track.artist || '—'}
              </div>
              {track.artist && (
                <div className="text-[10px] font-black uppercase tracking-[0.20em] mt-1.5"
                  style={{ color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>
                  {playing ? 'Şu an oynatılıyor' : 'Duraklatıldı'}
                </div>
              )}
            </div>
          </button>

          {/* Progress meter */}
          <div className="mt-4 flex-shrink-0">
            <div className="relative w-full rounded-full overflow-visible"
              style={{ height: 3, background: 'var(--oem-line-strong, rgba(255,240,210,0.18))' }}>
              <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, oklch(72% 0.11 55), oklch(86% 0.10 70))',
                  boxShadow: '0 0 14px var(--oem-amber-glow, transparent)',
                }} />
            </div>
            <div className="flex justify-between text-[10px] mt-1 tabular-nums"
              style={{ color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>
              <span>{fmtTime(track.positionSec)}</span>
              <span>{fmtTime(track.durationSec)}</span>
            </div>
          </div>

          {/* Controls — premium play + glass ghost prev/next */}
          <div className="flex justify-evenly items-center mt-4 flex-shrink-0">
            <button onClick={previous} aria-label="Önceki"
              className="w-12 h-12 rounded-full flex items-center justify-center active:scale-90 transition-all"
              style={{
                background: 'transparent',
                border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
                color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
              }}>
              <SkipBack className="w-5 h-5" />
            </button>
            <button onClick={togglePlayPause} aria-label={playing ? 'Duraklat' : 'Çal'}
              className="w-16 h-16 rounded-full flex items-center justify-center active:scale-95 transition-all"
              style={{
                background: 'linear-gradient(180deg, oklch(96% 0.02 80), oklch(78% 0.04 60))',
                color: '#0a0a0a',
                border: '1px solid oklch(78% 0.04 60)',
                boxShadow:
                  '0 1px 0 rgba(255,255,255,0.5) inset,' +
                  ' 0 -1px 0 rgba(0,0,0,0.15) inset,' +
                  ' 0 6px 18px rgba(0,0,0,0.40),' +
                  ' 0 0 24px var(--oem-amber-glow, transparent)',
              }}>
              {playing
                ? <Pause className="w-7 h-7" style={{ color: '#0a0a0a', fill: '#0a0a0a' }} />
                : <Play  className="w-7 h-7 ml-0.5" style={{ color: '#0a0a0a', fill: '#0a0a0a' }} />
              }
            </button>
            <button onClick={next} aria-label="Sonraki"
              className="w-12 h-12 rounded-full flex items-center justify-center active:scale-90 transition-all"
              style={{
                background: 'transparent',
                border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
                color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
              }}>
              <SkipForward className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ─── TELEMETRY (bottom right) ─────────────────────────── */}
        <div className="overflow-hidden p-5 min-h-0"
          style={{ ...GLASS_PANEL, gridColumn: '2', gridRow: '2' }}>
          <div className="text-[10px] font-black uppercase tracking-[0.20em] mb-3"
            style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
            Araç
          </div>
          <div className="grid grid-cols-3 gap-3">
            <MiniMetric
              label="Yakıt"
              value={fuelPct != null ? Math.round(fuelPct).toString() : '—'}
              unit={fuelPct != null ? '%' : ''} />
            <MiniMetric
              label="Menzil"
              value={rangeKm != null ? rangeKm.toString() : '—'}
              unit="km"
              tone="amber" />
            <MiniMetric
              label="Motor"
              value={engineT != null ? `${Math.round(engineT)}` : '—'}
              unit={engineT != null ? '°C' : ''} />
          </div>
        </div>
      </div>
    </div>
  );
});

export default SplitScreen;
