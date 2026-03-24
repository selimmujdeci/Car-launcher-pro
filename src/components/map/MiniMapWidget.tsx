import { useEffect, useRef, memo } from 'react';
import { AlertCircle, MapPin, Wifi, WifiOff } from 'lucide-react';
import {
  initializeMap,
  setMapCenter,
  addUserMarker,
  updateUserMarker,
  destroyMap,
  setMapHeading,
} from '../../platform/mapService';
import { useGPSLocation, useGPSHeading, startGPSTracking } from '../../platform/gpsService';
import { useMapSources, getMapSourceStatus } from '../../platform/mapSourceManager';

interface MiniMapWidgetProps {
  onFullScreenClick?: () => void;
}

export const MiniMapWidget = memo(function MiniMapWidget({ onFullScreenClick }: MiniMapWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const location = useGPSLocation();
  const heading = useGPSHeading();
  const { activeSourceId } = useMapSources();
  const status = getMapSourceStatus();

  // Init harita
  useEffect(() => {
    if (!containerRef.current) return;

    (async () => {
      try {
        const map = await initializeMap(containerRef.current!, { offline: true });
        mapRef.current = map;

        await startGPSTracking();
      } catch (err) {
        console.error('MiniMap init failed:', err);
      }
    })();

    return () => {
      if (mapRef.current) {
        destroyMap();
      }
    };
  }, []);

  // Konum değişince haritayı güncelle
  useEffect(() => {
    if (!mapRef.current || !location) return;

    const { latitude, longitude } = location;

    if (!mapRef.current._initialized) {
      addUserMarker(mapRef.current, latitude, longitude, heading || 0);
      setMapCenter(mapRef.current, [longitude, latitude], 16, false);
      mapRef.current._initialized = true;
    } else {
      updateUserMarker(latitude, longitude, heading || 0);
      setMapCenter(mapRef.current, [longitude, latitude], undefined, false);
    }

    if (heading && isFinite(heading)) {
      setMapHeading(mapRef.current, heading);
    }
  }, [location, heading]);

  if (!location) {
    return (
      <div className="h-full bg-[#0d1628] rounded-2xl shadow-xl border border-white/5 p-5 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 flex-shrink-0 mb-3">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
          <span className="text-slate-500 text-xs tracking-widest uppercase">Harita</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <AlertCircle className="w-8 h-8 text-slate-600" />
          <div className="text-center">
            <div className="text-slate-400 text-xs font-medium">GPS Bekleniyor</div>
            <div className="text-slate-700 text-[11px] leading-relaxed mt-1">
              Konumunuz algılanıyor...
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-[#0d1628] rounded-2xl shadow-xl border border-white/5 p-3 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 flex-shrink-0 mb-2">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-slate-500 text-xs tracking-widest uppercase">Harita</span>
          {status.status === 'offline' && (
            <WifiOff className="w-3 h-3 text-amber-500" />
          )}
          {status.status === 'online' && (
            <Wifi className="w-3 h-3 text-emerald-500" />
          )}
        </div>
        {onFullScreenClick && (
          <button
            onClick={onFullScreenClick}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
            title="Tam ekran"
          >
            <MapPin className="w-3.5 h-3.5 text-slate-400" />
          </button>
        )}
      </div>
      {activeSourceId && (
        <div className="flex-shrink-0 mb-2 px-2 py-1 bg-white/5 rounded-lg border border-white/5">
          <div className="text-[10px] text-slate-500 leading-tight">
            {status.message}
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className="flex-1 min-h-0 rounded-xl overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800"
        style={{ position: 'relative' }}
      />
    </div>
  );
});
