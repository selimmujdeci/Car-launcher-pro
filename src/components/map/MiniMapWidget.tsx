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
import { MapOverlay } from './MapOverlay';

interface MiniMapWidgetProps {
  onFullScreenClick?: () => void;
}

export const MiniMapWidget = memo(function MiniMapWidget({ onFullScreenClick }: MiniMapWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const location = useGPSLocation();
  const heading = useGPSHeading();
  const { activeSourceId, sources } = useMapSources();
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
    const hasOfflineData = sources.has('cached');
    const offlineStatus = hasOfflineData
      ? 'Offline Harita Hazır'
      : 'Offline Harita Yok';
    const offlineDesc = hasOfflineData
      ? 'Offline harita yüklü. GPS aktif olana kadar harita gösterilecek.'
      : 'Offline harita verileri mevcut değil. İnternet bağlantısını kontrol edin.';

    return (
      <div className="h-full bg-[#0d1628] rounded-2xl shadow-xl border border-white/5 p-5 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 flex-shrink-0 mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${hasOfflineData ? 'bg-emerald-400' : 'bg-amber-500'} animate-pulse`} />
            <span className="text-slate-500 text-xs tracking-widest uppercase">Harita</span>
          </div>
          {hasOfflineData && (
            <span className="text-[10px] text-emerald-400 font-medium px-2 py-1 bg-emerald-500/10 rounded-full">
              OFFLINE
            </span>
          )}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <AlertCircle className={`w-8 h-8 ${hasOfflineData ? 'text-emerald-600' : 'text-amber-600'}`} />
          <div className="text-center">
            <div className={`text-xs font-medium ${hasOfflineData ? 'text-emerald-400' : 'text-amber-400'}`}>
              {offlineStatus}
            </div>
            <div className="text-slate-400 text-[11px] leading-relaxed mt-2">
              GPS Bekleniyor
            </div>
            <div className="text-slate-600 text-[10px] leading-relaxed mt-1">
              {offlineDesc}
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
          <span className="text-[9px] text-emerald-400 font-medium">GPS Aktif</span>
          {status.status === 'offline' && (
            <>
              <WifiOff className="w-3 h-3 text-amber-500" />
              <span className="text-[9px] text-amber-400">OFFLINE</span>
            </>
          )}
          {status.status === 'online' && (
            <>
              <Wifi className="w-3 h-3 text-emerald-500" />
              <span className="text-[9px] text-emerald-400">ONLINE</span>
            </>
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
            {status.status === 'offline' ? 'Offline Harita - İnternet gerektirmez' : 'Online Harita - Akış hızı en iyi'}
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className="flex-1 min-h-0 rounded-xl overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800"
        style={{ position: 'relative' }}
      >
        <MapOverlay location={location} heading={heading} compact={true} />
      </div>
    </div>
  );
});
