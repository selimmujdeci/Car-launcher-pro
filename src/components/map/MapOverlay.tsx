import { memo } from 'react';
import type { GPSLocation } from '../../platform/gpsService';

interface MapOverlayProps {
  location?: GPSLocation | null;
  heading?: number | null;
  speedKmh?: number | undefined;
  destination?: { latitude: number; longitude: number; name?: string } | null;
  distanceMeters?: number;
  compact?: boolean;
}

/**
 * Premium map overlay with location marker, heading arrow, speed, and GPS status
 */
export const MapOverlay = memo(function MapOverlay({
  location,
  heading,
  speedKmh,
  destination,
  distanceMeters,
  compact = false,
}: MapOverlayProps) {
  if (!location) return null;

  const hasValidHeading = heading !== null && isFinite(heading || 0);
  const speed = speedKmh || 0;
  const hasSpeed = speed > 0.5;
  const accuracyMeters = Math.round(location.accuracy || 0);

  // GPS signal bars (0-4)
  const signalBars = Math.min(4, Math.max(0, Math.round(4 * (1 - Math.min(accuracyMeters, 100) / 100))));

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* User Location Marker */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ transform: 'translate(-50%, -50%)' }}
      >
        {/* Outer glow pulse */}
        <div className="absolute inset-0 w-16 h-16 -translate-x-1/2 -translate-y-1/2 left-1/2 top-1/2">
          <div className="absolute inset-0 bg-blue-500 rounded-full opacity-20 animate-pulse" />
          <div
            className="absolute inset-0 bg-blue-500 rounded-full opacity-0 animate-ping"
            style={{ animationDuration: '2s' }}
          />
        </div>

        {/* Accuracy circle */}
        {accuracyMeters > 5 && (
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-blue-400/30"
            style={{
              width: `${Math.min(60, accuracyMeters / 2)}px`,
              height: `${Math.min(60, accuracyMeters / 2)}px`,
            }}
          />
        )}

        {/* Heading arrow */}
        {hasValidHeading && (
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-12 pointer-events-none"
            style={{ transform: `translate(-50%, -50%) rotate(${heading}deg)` }}
          >
            {/* Arrow stem */}
            <div className="absolute left-1/2 top-0 -translate-x-1/2 w-1 h-8 bg-gradient-to-b from-amber-400 to-amber-500/60 rounded-full" />
            {/* Arrow head */}
            <div className="absolute left-1/2 top-0 -translate-x-1/2 w-0 h-0 border-l-2 border-r-2 border-b-4 border-l-transparent border-r-transparent border-b-amber-400" />
          </div>
        )}

        {/* Main marker circle */}
        <div className="relative w-6 h-6 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          {/* Outer ring */}
          <div className="absolute inset-0 bg-blue-500 rounded-full shadow-lg shadow-blue-600/40 border-2 border-blue-300/80" />
          {/* Inner dot */}
          <div className="absolute inset-1 bg-blue-400 rounded-full" />
        </div>
      </div>

      {/* Top-left: GPS Status & Heading */}
      {!compact && (
        <div className="absolute top-4 left-4 space-y-2 pointer-events-auto">
          {/* GPS Signal Strength */}
          <div className="flex flex-col gap-2 bg-black/40 backdrop-blur-md rounded-lg px-3 py-2 border border-white/10">
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`w-1 h-2 rounded-sm transition-all ${
                      i < signalBars ? 'bg-emerald-400' : 'bg-white/20'
                    }`}
                    style={{ height: `${(i + 1) * 6}px` }}
                  />
                ))}
              </div>
              <span className="text-xs text-slate-300 font-mono">
                {signalBars === 4 ? '📡 Mükemmel' : signalBars >= 2 ? '📶 İyi' : '📊 Zayıf'}
              </span>
            </div>
            <div className="text-xs text-slate-400 font-mono">
              ±{accuracyMeters}m hassasiyet
            </div>
            <div className="text-xs text-emerald-400 font-medium">
              ✓ GPS Aktif
            </div>
          </div>

          {/* Heading Display */}
          {hasValidHeading && (
            <div className="bg-black/40 backdrop-blur-md rounded-lg px-3 py-2 border border-white/10 flex items-center gap-2">
              <span className="text-amber-400 text-lg">↑</span>
              <span className="text-xs text-slate-300 font-mono">{Math.round(heading || 0)}°</span>
            </div>
          )}
        </div>
      )}

      {/* Bottom-right: Speed & Coordinates */}
      {!compact && (
        <div className="absolute bottom-4 right-4 space-y-2 pointer-events-auto">
          {/* Speed */}
          {hasSpeed && (
            <div className="bg-gradient-to-br from-emerald-500/30 to-emerald-600/20 backdrop-blur-md rounded-lg px-4 py-2 border border-emerald-400/40 text-right">
              <div className="text-xs text-emerald-300 font-medium">Speed</div>
              <div className="text-lg font-bold text-emerald-400 font-mono">{speed.toFixed(1)}</div>
              <div className="text-xs text-emerald-300">km/h</div>
            </div>
          )}

          {/* Coordinates */}
          <div className="bg-black/40 backdrop-blur-md rounded-lg px-3 py-2 border border-white/10 text-right">
            <div className="text-xs text-slate-400 font-mono leading-tight">
              <div>{location.latitude.toFixed(5)}°</div>
              <div>{location.longitude.toFixed(5)}°</div>
            </div>
          </div>
        </div>
      )}

      {/* Destination Marker and Route Line */}
      {destination && !compact && (
        <>
          {/* Route line SVG */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
            <line
              x1="50%"
              y1="50%"
              x2="50%"
              y2="50%"
              stroke="#f43f5e"
              strokeWidth="2"
              strokeDasharray="4,4"
              opacity="0.6"
            />
          </svg>

          {/* Destination Marker */}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{ transform: 'translate(-50%, -50%)' }}
          >
            {/* Destination glow */}
            <div className="absolute inset-0 w-12 h-12 -translate-x-1/2 -translate-y-1/2 left-1/2 top-1/2">
              <div className="absolute inset-0 bg-red-500 rounded-full opacity-15 animate-pulse" />
            </div>

            {/* Destination circle */}
            <div className="relative w-5 h-5 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="absolute inset-0 bg-red-500 rounded-full shadow-lg shadow-red-600/40 border-2 border-red-300/80" />
              <div className="absolute inset-1.5 bg-red-400 rounded-full" />
            </div>
          </div>

          {/* Distance Info */}
          {distanceMeters && (
            <div className="absolute top-1/2 right-4 -translate-y-1/2 bg-red-500/30 backdrop-blur-md rounded-lg px-4 py-2 border border-red-400/40">
              <div className="text-xs text-red-300 font-medium">Destination</div>
              <div className="text-lg font-bold text-red-400 font-mono">
                {distanceMeters < 1000
                  ? `${Math.round(distanceMeters)}m`
                  : `${(distanceMeters / 1000).toFixed(1)}km`}
              </div>
              {destination.name && (
                <div className="text-xs text-red-300 mt-1 truncate max-w-[200px]">
                  {destination.name}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Compact Mode: Center Speed Badge */}
      {compact && hasSpeed && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2">
          <div className="bg-gradient-to-br from-emerald-500/40 to-emerald-600/30 backdrop-blur-md rounded-full px-6 py-2 border border-emerald-400/50">
            <div className="text-center">
              <div className="text-xs text-emerald-300 font-medium">Speed</div>
              <div className="text-xl font-bold text-emerald-400 font-mono">{speed.toFixed(1)} km/h</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
