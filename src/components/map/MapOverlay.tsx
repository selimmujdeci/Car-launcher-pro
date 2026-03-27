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
  destination?: { latitude: number; longitude: number; name?: string } | null;
  distanceMeters?: number;
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
  destination,
  distanceMeters,
  compact = false,
}: MapOverlayProps) {
  const { servingFrom } = useMapNetworkStatus();
  const { unavailable: gpsUnavailable } = useGPSState();
  const isDriving = useDrivingMode();
  
  const speed = speedKmh ?? location?.speed ?? 0;
  const hasHeading = heading != null && isFinite(heading);

  // Source badge — contextual color per serving mode
  const badge = (() => {
    if (servingFrom === 'local') {
      return {
        label: 'YEREL',
        dot: 'bg-emerald-400',
        wrap: 'bg-emerald-500/10 border-emerald-400/20',
        text: 'text-emerald-400/80',
      };
    }
    if (servingFrom === 'cached') {
      return {
        label: 'CACHE',
        dot: 'bg-amber-400',
        wrap: 'bg-amber-500/10 border-amber-400/20',
        text: 'text-amber-400/80',
      };
    }
    return {
      label: 'ONLINE',
      dot: 'bg-blue-400',
      wrap: 'bg-blue-500/10 border-blue-400/20',
      text: 'text-blue-400/80',
    };
  })();

  return (
    <div className={`absolute inset-0 pointer-events-none z-10 transition-all duration-700 ${
      isDriving && !compact ? 'bg-gradient-to-t from-black/30 via-transparent to-transparent' : ''
    }`}>

      {/* ── Source badge — top-right ── */}
      <div className={`absolute top-6 right-6 transition-all duration-500 ${isDriving && !compact ? 'opacity-40 scale-90 translate-x-2' : 'opacity-100'}`}>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-xl border border-white/10 shadow-sm ${badge.text}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
          <span className="text-[10px] font-bold tracking-widest uppercase">{badge.label}</span>
        </div>
      </div>

      {/* ── GPS Status Card — center ── */}
      {!location && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 bg-black/60 backdrop-blur-2xl rounded-[2.5rem] px-10 py-8 border border-white/10 shadow-2xl">
            <div className="relative w-12 h-12">
              <div className="absolute inset-0 border-2 border-blue-500/10 border-t-blue-500 rounded-full animate-spin" />
              <Navigation2 className="absolute inset-0 m-auto w-5 h-5 text-blue-400 opacity-50" />
            </div>
            <div className="text-center">
              <div className="text-white text-xs font-black tracking-[0.25em] uppercase">
                {gpsUnavailable ? 'GPS HATASI' : 'SİNYAL BEKLENİYOR'}
              </div>
              <div className="text-slate-500 text-[9px] font-medium mt-1 uppercase tracking-widest">
                {gpsUnavailable ? 'İzinleri kontrol edin' : 'Açık alan gerekli'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Main HUD — bottom-left ── */}
      {location && (
        <div className={`absolute bottom-8 left-8 transition-all duration-500 ${isDriving && !compact ? 'scale-110' : ''}`}>
          <div className="flex items-center gap-1 bg-black/50 backdrop-blur-2xl rounded-[2rem] border border-white/10 shadow-xl overflow-hidden p-1">
            {/* Speed */}
            <div className="px-6 py-4 flex items-baseline gap-2 bg-white/5 rounded-[1.75rem]">
              <span className={`text-5xl font-black font-mono tracking-tighter ${Math.round(speed) === 0 ? 'text-white/20' : 'text-white'}`}>
                {Math.round(speed)}
              </span>
              <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">KM/S</span>
            </div>
            
            {/* Heading */}
            {hasHeading && (
              <div className="flex items-center gap-4 px-6">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="w-8 h-8 text-blue-400"
                  style={{ transform: `rotate(${heading}deg)`, transition: 'transform 0.8s cubic-bezier(0.2, 0, 0, 1)' }}
                >
                  <path d="M12 2L19 21L12 17L5 21L12 2Z" fill="currentColor" fillOpacity="0.2" />
                </svg>
                <div className="flex flex-col">
                  <span className="text-white font-mono text-xl font-black leading-none">{Math.round(heading!)}°</span>
                  <span className="text-slate-500 text-[9px] font-bold uppercase tracking-widest mt-1">{toCardinal(heading!)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Destination — top-left ── */}
      {!compact && destination && distanceMeters != null && (
        <div className="absolute top-24 left-8">
          <div className="bg-black/50 backdrop-blur-xl rounded-2xl p-4 border border-rose-500/20 shadow-xl flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            </div>
            <div className="flex flex-col">
              {destination.name && <span className="text-[9px] text-rose-400 font-black uppercase tracking-widest mb-0.5">{destination.name}</span>}
              <span className="text-xl font-black text-white font-mono leading-none tracking-tighter">
                {distanceMeters < 1000 ? `${Math.round(distanceMeters)}m` : `${(distanceMeters / 1000).toFixed(1)}km`}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
