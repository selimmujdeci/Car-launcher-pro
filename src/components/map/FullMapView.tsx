import { useEffect, useRef, memo } from 'react';
import { X, ZoomIn, ZoomOut, Navigation, Wifi } from 'lucide-react';
import {
  initializeMap,
  setMapCenter,
  addUserMarker,
  updateUserMarker,
  setMapHeading,
} from '../../platform/mapService';
import { useGPSLocation, useGPSHeading, startGPSTracking } from '../../platform/gpsService';
import { useMapSources, getMapSourceStatus } from '../../platform/mapSourceManager';
import { useNavigation, updateNavigationProgress } from '../../platform/navigationService';
import { MapOverlay } from './MapOverlay';

interface FullMapViewProps {
  onClose: () => void;
}

export const FullMapView = memo(function FullMapView({ onClose }: FullMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const location = useGPSLocation();
  const heading = useGPSHeading();
  const { sources } = useMapSources();
  const status = getMapSourceStatus();
  const { destination, distanceMeters } = useNavigation();

  const hasOfflineData = sources.has('cached');
  const isOnline = navigator.onLine;
  const canShowMap = hasOfflineData || isOnline;

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

    // Update navigation progress if navigating
    if (destination) {
      updateNavigationProgress(latitude, longitude, heading || 0);
    }
  }, [location, heading, destination]);

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

  // Show error if no map data available
  if (!canShowMap) {
    return (
      <div className="fixed inset-0 bg-black z-50 flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-4 left-4 w-12 h-12 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white hover:bg-white/20 active:scale-95 transition-transform z-10"
        >
          <X className="w-6 h-6" />
        </button>
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/10 border-2 border-red-500/30 flex items-center justify-center">
            <Wifi className="w-8 h-8 text-red-500" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white mb-2">Harita Veri Yok</h2>
            <p className="text-slate-400 text-sm leading-relaxed max-w-xs mb-4">
              Çevrimdışı harita verileri yüklü değil ve şu anda internet bağlantısı mevcut değil.
            </p>
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 text-left text-xs text-slate-300 space-y-2">
              <div>
                <span className="text-slate-400">Çözüm:</span>
              </div>
              <ul className="space-y-1 ml-3">
                <li>• İnternet bağlantısı kurun ve harita yüklemesini bekleyin</li>
                <li>• Ayarlar → Harita Kaynağı'ndan bölgeyi seçin</li>
                <li>• Offline harita verilerinin indirilmesini bekleyin</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Harita container */}
      <div
        ref={containerRef}
        className="flex-1"
        style={{ position: 'relative' }}
      >
        <MapOverlay
          location={location}
          heading={heading}
          speedKmh={location?.speed}
          destination={destination ? {
            latitude: destination.latitude,
            longitude: destination.longitude,
            name: destination.name,
          } : null}
          distanceMeters={distanceMeters}
        />
      </div>

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

      {/* Status bar - Map source & GPS */}
      <div className="absolute top-16 left-4 right-4 p-3 bg-black/40 backdrop-blur-md rounded-lg border border-white/10 z-10 pointer-events-none">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${status.status === 'offline' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            <span className="text-xs text-slate-300">
              {status.status === 'offline' ? '📡 Offline Harita' : '🌐 Online Harita'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-xs text-slate-300">
              {location ? '📍 GPS Aktif' : '⏳ GPS Bekleniyor'}
            </span>
          </div>
        </div>
        <div className="text-[11px] text-slate-400 mt-2 leading-tight">
          {status.status === 'offline'
            ? 'İnternet olmadan çalışıyor'
            : 'Harita verileri otomatik olarak çevrimdışı olarak kaydediliyor'}
        </div>
      </div>

      {/* Bottom info */}
      {location && (
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black via-black/50 to-transparent z-10 pointer-events-none">
          <div className="flex justify-between items-end gap-4 mb-3 pb-3 border-b border-white/10">
            <div className="flex items-center gap-2 text-white text-xs">
              <span className="text-slate-300">
                {status.status === 'offline' ? '✓ Offline Harita Hazır' : '✓ Harita Bağlantılı'}
              </span>
            </div>
          </div>
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
