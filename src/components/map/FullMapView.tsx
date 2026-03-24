import { useEffect, useRef, memo } from 'react';
import { X, ZoomIn, ZoomOut, Navigation } from 'lucide-react';
import {
  initializeMap,
  setMapCenter,
  addUserMarker,
  updateUserMarker,
  setMapHeading,
} from '../../platform/mapService';
import { useGPSLocation, useGPSHeading, startGPSTracking } from '../../platform/gpsService';

interface FullMapViewProps {
  onClose: () => void;
}

export const FullMapView = memo(function FullMapView({ onClose }: FullMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const location = useGPSLocation();
  const heading = useGPSHeading();

  // Init harita
  useEffect(() => {
    if (!containerRef.current) return;

    (async () => {
      try {
        const map = await initializeMap(containerRef.current!, { offline: true });
        mapRef.current = map;

        await startGPSTracking();

        // Başlangıçta marker ekle
        if (location) {
          addUserMarker(map, location.latitude, location.longitude, heading || 0);
          setMapCenter(map, [location.longitude, location.latitude], 14, false);
        }
      } catch (err) {
        console.error('FullMap init failed:', err);
      }
    })();

    return () => {
      if (mapRef.current) {
        // Harita örneğini sakla ama destroy etme, sonra mini map tekrar init edebilir
        mapRef.current = null;
      }
    };
  }, []);

  // Konum değişince güncelle
  useEffect(() => {
    if (!mapRef.current || !location) return;

    const { latitude, longitude } = location;

    if (!mapRef.current._fullMapInitialized) {
      addUserMarker(mapRef.current, latitude, longitude, heading || 0);
      mapRef.current._fullMapInitialized = true;
    } else {
      updateUserMarker(latitude, longitude, heading || 0);
    }

    // Harita merkezini konum takip et (soft update)
    const currentCenter = mapRef.current.getCenter();
    const dx = longitude - currentCenter.lng;
    const dy = latitude - currentCenter.lat;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 0.01) {
      setMapCenter(mapRef.current, [longitude, latitude], undefined, false);
    }

    if (heading && isFinite(heading)) {
      setMapHeading(mapRef.current, heading);
    }
  }, [location, heading]);

  const handleZoomIn = () => {
    if (mapRef.current) {
      mapRef.current.zoomIn();
    }
  };

  const handleZoomOut = () => {
    if (mapRef.current) {
      mapRef.current.zoomOut();
    }
  };

  const handleRecenterOnUser = () => {
    if (mapRef.current && location) {
      setMapCenter(
        mapRef.current,
        [location.longitude, location.latitude],
        undefined,
        true
      );
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Harita container */}
      <div
        ref={containerRef}
        className="flex-1"
        style={{ position: 'relative' }}
      />

      {/* Top bar - Close */}
      <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between z-10 pointer-events-none">
        <button
          onClick={onClose}
          className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white hover:bg-white/20 active:scale-95 transition-transform pointer-events-auto"
        >
          <X className="w-6 h-6" />
        </button>
        <div className="text-white text-sm font-medium">Navigasyon Haritası</div>
        <div className="w-12" />
      </div>

      {/* Controls - Right side */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 p-4 flex flex-col gap-2 z-10 pointer-events-none">
        <button
          onClick={handleZoomIn}
          className="w-12 h-12 rounded-lg bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white hover:bg-white/20 active:scale-95 transition-transform pointer-events-auto"
          title="Yakınlaş"
        >
          <ZoomIn className="w-5 h-5" />
        </button>
        <button
          onClick={handleZoomOut}
          className="w-12 h-12 rounded-lg bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white hover:bg-white/20 active:scale-95 transition-transform pointer-events-auto"
          title="Uzaklaş"
        >
          <ZoomOut className="w-5 h-5" />
        </button>
        <button
          onClick={handleRecenterOnUser}
          className="w-12 h-12 rounded-lg bg-blue-500/20 backdrop-blur-md border border-blue-400/30 flex items-center justify-center text-blue-400 hover:bg-blue-500/30 active:scale-95 transition-transform pointer-events-auto"
          title="Kullanıcıya Git"
        >
          <Navigation className="w-5 h-5" />
        </button>
      </div>

      {/* Bottom info */}
      {location && (
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black via-black/50 to-transparent z-10 pointer-events-none">
          <div className="flex justify-between items-end">
            <div className="text-white text-sm">
              <div className="text-slate-400 text-xs mb-1">Konum</div>
              <div className="font-mono text-xs">
                {location.latitude.toFixed(4)}°, {location.longitude.toFixed(4)}°
              </div>
            </div>
            {location.accuracy && (
              <div className="text-right text-white text-sm">
                <div className="text-slate-400 text-xs mb-1">Doğruluk</div>
                <div className="font-mono text-xs">±{Math.round(location.accuracy)}m</div>
              </div>
            )}
            {heading && isFinite(heading) && (
              <div className="text-right text-white text-sm">
                <div className="text-slate-400 text-xs mb-1">Yön</div>
                <div className="font-mono text-xs">{Math.round(heading)}°</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
