import { memo } from 'react';
import { Navigation2 } from 'lucide-react';
import type { GPSLocation } from '../../platform/gpsService';
import { useGPSState } from '../../platform/gpsService';
import { useMapNetworkStatus } from '../../platform/mapSourceManager';
import { useDrivingMode } from '../../platform/mapService';

interface MapOverlayProps {
  location?: GPSLocation | null;
  heading?: number | null;
  speedKmh?: number | undefined;
  compact?: boolean;
}

const CARDINAL = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'];
function toCardinal(deg: number): string {
  return CARDINAL[Math.round(deg / 45) % 8];
}

/**
 * Premium unified map HUD overlay — glassmorphism design.
 * Handles speed, heading, source badge, and GPS status.
 */
export const MapOverlay = memo(function MapOverlay({
  location,
  heading,
  speedKmh,
  compact = false,
}: MapOverlayProps) {
  const { servingFrom } = useMapNetworkStatus();
  const { unavailable: gpsUnavailable } = useGPSState();
  const isDriving = useDrivingMode();
  
  const speed = speedKmh ?? (location?.speed != null ? location.speed * 3.6 : 0);
  const hasHeading = heading != null && isFinite(heading);

  // Source badge — contextual color per serving mode
  const badge = (() => {
    if (servingFrom === 'local') {
      return {
        label: 'YEREL',
        dot: 'bg-emerald-400',
        wrap: 'bg-emerald-500/10 border-emerald-400/20',
        text: 'text-emerald-400',
      };
    }
    if (servingFrom === 'cached') {
      return {
        label: 'CACHE',
        dot: 'bg-amber-400',
        wrap: 'bg-amber-500/10 border-amber-400/20',
        text: 'text-amber-400',
      };
    }
    return {
      label: 'ONLINE',
      dot: 'bg-blue-400',
      wrap: 'bg-blue-500/10 border-blue-400/20',
      text: 'text-blue-400',
    };
  })();

  /* ── Compact (mini widget) vs Full renderleri ── */
  if (compact) {
    return (
      <div className="absolute inset-0 pointer-events-none z-10">

        {/* Source badge — top-right, küçük */}
        <div className="absolute top-2 right-2">
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full var(--panel-bg-secondary) backdrop-blur-md backdrop-blur-xl border ${badge.wrap} shadow-sm`}>
            <div className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
            <span className={`text-[8px] font-black tracking-widest uppercase ${badge.text}`}>{badge.label}</span>
          </div>
        </div>

        {/* GPS bekleniyor — kompakt */}
        {!location && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 bg-[#0f172a]/80 backdrop-blur-xl rounded-2xl px-4 py-3 border border-white/10">
              <div className="relative w-7 h-7">
                <div className="absolute inset-0 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                <Navigation2 className="absolute inset-0 m-auto w-3.5 h-3.5 text-blue-400" />
              </div>
              <span className="text-primary text-[9px] font-black tracking-widest uppercase">
                {gpsUnavailable ? 'GPS HATASI' : 'GPS BEKLENİYOR'}
              </span>
            </div>
          </div>
        )}

        {/* Hız + yön — bottom-right, kompakt */}
        {location && (
          <div className="absolute bottom-2 right-2">
            <div className="flex items-center gap-1.5 var(--panel-bg-secondary) backdrop-blur-md backdrop-blur-xl rounded-xl border border-white/10 shadow-lg px-2.5 py-1.5">
              <span className={`text-lg font-black font-mono leading-none tabular-nums ${Math.round(speed) === 0 ? 'text-slate-400' : 'text-primary'}`}>
                {Math.round(speed)}
              </span>
              <span className="text-[8px] font-black text-blue-400 uppercase leading-none">km/h</span>
              {hasHeading && (
                <>
                  <div className="w-px h-3 var(--panel-bg-secondary) mx-0.5" />
                  <svg
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                    className="w-3.5 h-3.5 text-blue-400"
                    style={{ transform: `rotate(${heading}deg)`, transition: 'transform 1s ease-out' }}
                  >
                    <path d="M12 2L19 21L12 17L5 21L12 2Z" fill="currentColor" fillOpacity="0.35" />
                  </svg>
                  <span className="text-[8px] font-black text-blue-400/70 uppercase">{toCardinal(heading!)}</span>
                </>
              )}
            </div>
          </div>
        )}

      </div>
    );
  }

  /* ── Full (tam ekran) render ── */
  return (
    <div className={`absolute inset-0 pointer-events-none z-10 transition-all duration-1000 ${
      isDriving ? 'bg-gradient-to-t from-black/50 via-transparent to-transparent' : ''
    }`}>

      {/* Source badge — top-right */}
      <div className={`absolute top-8 right-8 transition-all duration-700 ${isDriving ? 'opacity-30 scale-90 translate-x-4' : 'opacity-100'}`}>
        <div className={`flex items-center gap-2.5 px-4 py-2 rounded-full var(--panel-bg-secondary) backdrop-blur-md backdrop-blur-3xl border border-white/10 shadow-lg ${badge.text}`}>
          <div className={`w-2 h-2 rounded-full animate-pulse ${badge.dot}`} />
          <span className="text-[10px] font-black tracking-[0.2em] uppercase">{badge.label}</span>
        </div>
      </div>

      {/* GPS Status Card — center */}
      {!location && (
        <div className="absolute inset-0 flex items-center justify-center animate-in fade-in zoom-in-95 duration-1000">
          <div className="flex flex-col items-center gap-6 bg-[#0f172a]/80 backdrop-blur-3xl rounded-[3rem] px-12 py-10 border border-white/10 shadow-[0_40px_100px_rgba(0,0,0,0.8)]">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 border-4 border-blue-500/10 border-t-blue-500 rounded-full animate-spin" />
              <Navigation2 className="absolute inset-0 m-auto w-7 h-7 text-blue-400 opacity-80" />
            </div>
            <div className="text-center">
              <div className="text-primary text-sm font-black tracking-[0.3em] uppercase mb-1">
                {gpsUnavailable ? 'GPS HATASI' : 'SİNYAL BEKLENİYOR'}
              </div>
              <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">
                {gpsUnavailable ? 'KONUM İZİNLERİNİ KONTROL EDİN' : 'AÇIK BİR ALANA ÇIKIN'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main HUD — bottom-left */}
      {location && (
        <div className={`absolute bottom-24 right-6 transition-all duration-700 ${isDriving ? 'scale-110 origin-bottom-right' : ''}`}>
          <div className="flex items-stretch var(--panel-bg-secondary) backdrop-blur-md backdrop-blur-3xl rounded-[2.5rem] border border-white/10 shadow-2xl overflow-hidden p-1.5">
            {/* Speed */}
            <div className="px-8 py-5 flex items-baseline gap-3 var(--panel-bg-secondary) rounded-[2rem] border border-white/5 shadow-inner">
              <span className={`text-6xl font-black font-mono tracking-tighter transition-colors duration-500 ${Math.round(speed) === 0 ? 'text-slate-400' : 'text-primary'}`}>
                {Math.round(speed)}
              </span>
              <div className="flex flex-col">
                <span className="text-[11px] font-black text-blue-400 uppercase tracking-widest leading-none">KM/H</span>
                <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mt-1">HIZ</span>
              </div>
            </div>

            {/* Heading */}
            {hasHeading && (
              <div className="flex items-center gap-5 px-8">
                <div className="relative">
                  <div className="absolute inset-0 bg-blue-500/10 blur-xl rounded-full" />
                  <svg
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                    className="w-10 h-10 text-blue-400 relative z-10"
                    style={{ transform: `rotate(${heading}deg)`, transition: 'transform 1.2s cubic-bezier(0.2, 0, 0, 1)' }}
                  >
                    <path d="M12 2L19 21L12 17L5 21L12 2Z" fill="currentColor" fillOpacity="0.3" />
                  </svg>
                </div>
                <div className="flex flex-col">
                  <span className="text-primary font-mono text-2xl font-black leading-none tracking-tight">{Math.round(heading!)}°</span>
                  <span className="text-blue-400/70 text-[10px] font-black uppercase tracking-widest mt-1.5">{toCardinal(heading!)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
});


