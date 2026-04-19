/**
 * LuxuryLayout — Mercedes-Benz MBUX inspired premium experience.
 *
 * Structure:
 *   TOP ROW: Digital cluster strip (RPM/Temp/Fuel — wide panoramic)
 *   MAIN ROW:
 *     LEFT (wide): Navigation + speed overlay
 *     RIGHT (compact stack):
 *       - Media with album art style
 *       - Smart app shortcuts
 */
import { memo } from 'react';
import { Thermometer, Fuel, Gauge, MapPin } from 'lucide-react';
import { PremiumSpeedometer } from '../PremiumSpeedometer';
import { MiniMapWidget } from '../../map/MiniMapWidget';
import { MediaPanel } from '../LayoutWidgets';
import { useMediaState } from '../../../platform/mediaService';
import { useOBDRPM, useOBDEngineTemp, useOBDFuelLevel, useOBDConnectionState } from '../../../platform/obdService';
import type { LayoutProps } from './LayoutProps';
import type { MusicOptionKey } from '../../../data/apps';

export const LuxuryLayout = memo(function LuxuryLayout({
  settings,
  smart,
  appMap,
  handleLaunch,
  setFullMapOpen,
  fullMapOpen,
}: LayoutProps) {
  const connState     = useOBDConnectionState();
  const obdOk         = connState === 'connected';
  const rpmRaw        = useOBDRPM();
  const engineTempRaw = useOBDEngineTemp();
  const fuelLevelRaw  = useOBDFuelLevel();
  const rpm           = obdOk ? rpmRaw        : 0;
  const engineTemp    = obdOk ? engineTempRaw : 0;
  const fuelLevel     = obdOk ? fuelLevelRaw  : 0;
  const { track }     = useMediaState();

  const accent = `var(--pack-accent, #c8a96e)`;
  const accentRgb = `var(--pack-accent-rgb, 200, 169, 110)`;

  return (
    <div className="flex flex-col gap-2.5 w-full h-full p-1 overflow-hidden">

      {/* ══ TOP: Panoramic instrument strip ══ */}
      <div className="flex-shrink-0 flex items-center justify-between px-8 py-3 rounded-[2rem] glass-card shadow-xl relative overflow-hidden"
        style={{
          borderColor: `rgba(${accentRgb},0.30)`,
          borderTopWidth: 2,
        }}>
        {/* Subtle sweep gradient */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: `linear-gradient(90deg, rgba(${accentRgb},0.06) 0%, transparent 40%, rgba(${accentRgb},0.04) 100%)` }} />

        {/* Left: RPM */}
        <LuxMetric icon={<Gauge className="w-5 h-5" style={{ color: accent }} />} label="DEVIR" value={rpm > 0 ? rpm.toLocaleString() : '—'} unit="rpm" />

        {/* Center divider with logo hint */}
        <div className="flex items-center gap-6">
          <div className="w-px h-10 opacity-20" style={{ background: accent }} />
          <div className="flex flex-col items-center gap-0.5">
            <div className="text-[8px] font-black uppercase tracking-[0.5em] opacity-40" style={{ color: accent }}>CAR</div>
            <div className="text-[11px] font-black uppercase tracking-[0.6em]" style={{ color: accent }}>LAUNCHER</div>
            <div className="text-[8px] font-black uppercase tracking-[0.5em] opacity-40" style={{ color: accent }}>PRO</div>
          </div>
          <div className="w-px h-10 opacity-20" style={{ background: accent }} />
        </div>

        {/* Center: Temp */}
        <LuxMetric icon={<Thermometer className="w-5 h-5" style={{ color: engineTemp > 100 ? '#ef4444' : accent }} />} label="MOTOR" value={engineTemp > 0 ? `${engineTemp}` : '—'} unit="°C" warn={engineTemp > 100} />

        <div className="w-px h-10 opacity-15" style={{ background: accent }} />

        {/* Right: Fuel */}
        <LuxMetric icon={<Fuel className="w-5 h-5" style={{ color: fuelLevel < 15 ? '#ef4444' : accent }} />} label="YAKIT" value={fuelLevel > 0 ? `${Math.round(fuelLevel)}` : '—'} unit="%" warn={fuelLevel < 15} />

        {/* Track info */}
        <div className="w-px h-10 opacity-15" style={{ background: accent }} />
        <div className="flex flex-col items-end gap-0.5 min-w-0 max-w-[140px]">
          <div className="text-[8px] font-black uppercase tracking-[0.4em] opacity-60" style={{ color: accent }}>Çalıyor</div>
          <div className="text-white text-[11px] font-bold truncate leading-tight">
            {track.title || <span className="opacity-30">—</span>}
          </div>
          <div className="text-[9px] uppercase tracking-wide opacity-50 truncate" style={{ color: accent }}>
            {track.artist || ''}
          </div>
        </div>
      </div>

      {/* ══ MAIN ROW ══ */}
      <div className="flex-1 min-h-0 flex gap-2.5 overflow-hidden">

        {/* ── LEFT: Map + floating speed ── */}
        <div className="flex-[1.8] min-w-0 min-h-0 rounded-[2.5rem] overflow-hidden relative glass-card shadow-2xl group"
          style={{ borderColor: `rgba(${accentRgb},0.25)` }}>

          {/* Map */}
          {!fullMapOpen && (
            <MiniMapWidget onFullScreenClick={() => setFullMapOpen(true)} />
          )}

          {/* Bottom gradient overlay */}
          <div className="absolute bottom-0 inset-x-0 h-36 pointer-events-none"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 100%)' }} />

          {/* Floating speed pill */}
          <div className="absolute bottom-4 left-4 w-[160px] h-[160px] rounded-[2rem] overflow-hidden"
            style={{
              background: `rgba(0,0,0,0.55)`,
              backdropFilter: 'blur(16px)',
              border: `1px solid rgba(${accentRgb},0.35)`,
              boxShadow: `0 4px 24px rgba(0,0,0,0.5), 0 0 30px rgba(${accentRgb},0.15)`,
            }}>
            <PremiumSpeedometer compact numSize="sm" />
          </div>

          {/* Expand button */}
          <button
            onClick={() => setFullMapOpen(true)}
            className="absolute top-3 right-3 w-9 h-9 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', border: `1px solid rgba(${accentRgb},0.3)` }}
          >
            <MapPin className="w-4 h-4" style={{ color: accent }} />
          </button>
        </div>

        {/* ── RIGHT: Media + shortcuts ── */}
        <div className="flex-[0.9] min-w-0 min-h-0 flex flex-col gap-2.5">

          {/* Media card */}
          <div className="flex-[1.8] min-h-0 rounded-[2.5rem] overflow-hidden glass-card shadow-2xl relative"
            style={{ borderColor: `rgba(${accentRgb},0.22)` }}>
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: `linear-gradient(135deg, rgba(${accentRgb},0.08) 0%, transparent 55%)` }} />
            <MediaPanel defaultMusic={settings.defaultMusic as MusicOptionKey} />
          </div>

          {/* Quick apps */}
          <div className="flex-1 min-h-0 rounded-[2.5rem] glass-card overflow-hidden shadow-xl"
            style={{ borderColor: `rgba(${accentRgb},0.18)` }}>
            <div className="flex items-center justify-around h-full px-4 gap-2">
              {smart.dockIds.slice(0, 5).map(id => {
                const app = appMap[id];
                if (!app) return null;
                return (
                  <button
                    key={id}
                    onClick={() => handleLaunch(id)}
                    className="flex flex-col items-center gap-1.5 p-2 rounded-2xl active:scale-90 transition-all"
                    style={{ color: accent }}
                  >
                    <span className="text-2xl">{app.icon}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wide opacity-75 text-white">{app.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

/* ── LuxMetric — instrument panel metric ────────────────── */
function LuxMetric({
  icon, label, value, unit, warn = false,
}: { icon: React.ReactNode; label: string; value: string; unit: string; warn?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="opacity-80">{icon}</div>
      <div className="flex flex-col">
        <span className="text-[8px] font-black uppercase tracking-[0.4em] opacity-50 text-white">{label}</span>
        <div className="flex items-baseline gap-1">
          <span className={`text-base font-black leading-none ${warn ? 'text-red-400' : 'text-white'}`}>{value}</span>
          <span className="text-[9px] opacity-50 text-white">{unit}</span>
        </div>
      </div>
    </div>
  );
}
