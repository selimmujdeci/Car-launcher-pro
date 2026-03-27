import { useEffect, useRef, useState, memo } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

type MapRef = MapLibreMap & { _fullMapInitialized?: boolean };
import { X, ZoomIn, ZoomOut, Crosshair, Map, Layers, Globe, Navigation2 } from 'lucide-react';
import {
  initializeMap,
  setMapCenter,
  addUserMarker,
  updateUserMarker,
  setMapHeading,
  switchMapStyle,
  setDrivingView,
  exitDrivingView,
  setDrivingMode,
  useDrivingMode,
} from '../../platform/mapService';
import { useGPSLocation, useGPSHeading, startGPSTracking } from '../../platform/gpsService';
import {
  getMapStyle,
  setMapMode,
  useMapMode,
  type MapMode,
} from '../../platform/mapSourceManager';
import { useNavigation, updateNavigationProgress } from '../../platform/navigationService';
import { MapOverlay } from './MapOverlay';

interface FullMapViewProps {
  onClose: () => void;
}

const MODE_LABELS: Record<MapMode, string> = {
  road: 'Yol',
  hybrid: 'Hibrit',
  satellite: 'Uydu',
};

export const FullMapView = memo(function FullMapView({ onClose }: FullMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapRef | null>(null);
  const initDone = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const modeInitRef = useRef(false);
  const locationRef = useRef<ReturnType<typeof useGPSLocation>>(null);
  const headingRef = useRef<number | null>(null);

  const location = useGPSLocation();
  const heading = useGPSHeading();
  const { destination, distanceMeters } = useNavigation();
  const mode = useMapMode();
  const drivingMode = useDrivingMode();

  // Sync refs safely outside of render
  useEffect(() => {
    locationRef.current = location;
    headingRef.current = heading;
  }, [location, heading]);

  const [mapReady, setMapReady] = useState(false);
  const [styleKey, setStyleKey] = useState(0);
  const mapStyleReady = mapReady;

  // Init map — runs exactly once on mount, after container has dimensions
  useEffect(() => {
    if (!containerRef.current || initDone.current) return;

    const el = containerRef.current;
    if (el.offsetWidth === 0 || el.offsetHeight === 0) {
      const raf = requestAnimationFrame(() => {
        if (!initDone.current && el.offsetWidth > 0 && el.offsetHeight > 0) {
          doInit(el);
        }
      });
      return () => cancelAnimationFrame(raf);
    }

    doInit(el);

    function doInit(container: HTMLElement) {
      initDone.current = true;
      let cancelled = false;

      (async () => {
        try {
          const map = await initializeMap(container, { offline: true });
          if (cancelled) return;
          mapRef.current = map;

          if (map.isStyleLoaded()) {
            setMapReady(true);
          } else {
            map.once('style.load', () => {
              if (!cancelled) setMapReady(true);
            });
          }

          startGPSTracking().catch(() => {});
        } catch (err) {
          console.error('FullMap init failed:', err);
        }
      })();

      cleanupRef.current = () => {
        cancelled = true;
        mapRef.current = null;
      };
    }

    return () => {
      cleanupRef.current?.();
    };
  }, []);

  // Exit driving view when driving mode turns off
  useEffect(() => {
    if (!drivingMode && mapRef.current) {
      exitDrivingView(mapRef.current);
    }
  }, [drivingMode]);

  // Map mode change — switch tile style and re-add marker after load
  useEffect(() => {
    if (!modeInitRef.current) {
      modeInitRef.current = true;
      return;
    }
    if (!mapRef.current) return;
    const map = mapRef.current;
    const loc = locationRef.current;
    const hdg = headingRef.current;

    map._fullMapInitialized = false;
    switchMapStyle(map, getMapStyle());

    map.once('style.load', () => {
      if (loc) {
        addUserMarker(map, loc.latitude, loc.longitude, hdg || 0);
        setMapCenter(map, [loc.longitude, loc.latitude], undefined, false);
        map._fullMapInitialized = true;
      }
      setStyleKey((k) => k + 1);
    });
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Location updates — normal tracking or driving view
  useEffect(() => {
    if (!mapRef.current || !location || !mapStyleReady) return;
    if (!mapRef.current.isStyleLoaded()) return;

    const { latitude, longitude } = location;
    const speedKmh = (location.speed ?? 0) * 3.6;
    const bear = heading || 0;

    if (!mapRef.current._fullMapInitialized) {
      addUserMarker(mapRef.current, latitude, longitude, bear);
      if (drivingMode) {
        const h = containerRef.current?.offsetHeight ?? 600;
        setDrivingView(mapRef.current, latitude, longitude, bear, speedKmh, h);
      } else {
        setMapCenter(mapRef.current, [longitude, latitude], 15, true);
      }
      mapRef.current._fullMapInitialized = true;
    } else {
      updateUserMarker(latitude, longitude, bear);

      if (drivingMode) {
        const h = containerRef.current?.offsetHeight ?? 600;
        setDrivingView(mapRef.current, latitude, longitude, bear, speedKmh, h);
      } else {
        const currentCenter = mapRef.current.getCenter();
        const dx = longitude - currentCenter.lng;
        const dy = latitude - currentCenter.lat;
        if (Math.sqrt(dx * dx + dy * dy) > 0.005) {
          setMapCenter(mapRef.current, [longitude, latitude], undefined, false);
        }
        if (heading && isFinite(heading)) {
          setMapHeading(mapRef.current, heading);
        }
      }
    }

    if (destination) {
      updateNavigationProgress(latitude, longitude, bear);
    }
  }, [location, heading, destination, mapStyleReady, styleKey, drivingMode]);

  const handleZoomIn = () => mapRef.current?.zoomIn();
  const handleZoomOut = () => mapRef.current?.zoomOut();

  const handleRecenter = () => {
    if (mapRef.current && location) {
      setMapCenter(mapRef.current, [location.longitude, location.latitude], 15, true);
    }
  };

  const handleToggleDrivingMode = () => {
    const nextMode = !drivingMode;
    setDrivingMode(nextMode);
    
    if (!nextMode && mapRef.current) {
      exitDrivingView(mapRef.current);
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-50">
      {/* Full-screen map container */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ width: '100%', height: '100%' }}
      >
        <MapOverlay
          location={location}
          heading={heading}
          speedKmh={location?.speed != null ? location.speed * 3.6 : undefined}
          destination={destination ? {
            latitude: destination.latitude,
            longitude: destination.longitude,
            name: destination.name,
          } : null}
          distanceMeters={distanceMeters}
        />
      </div>

      {/* ── Top controls ── */}
      <button
        onClick={onClose}
        className={`absolute top-8 left-8 z-20 w-12 h-12 rounded-2xl backdrop-blur-xl border flex items-center justify-center transition-all duration-500 pointer-events-auto active:scale-95 shadow-lg ${
          drivingMode
            ? 'bg-black/20 border-white/5 text-white/30'
            : 'bg-black/50 border-white/10 text-white/80 hover:bg-black/70'
        }`}
      >
        <X className="w-6 h-6" />
      </button>

      {/* ── Right-side controls ── */}
      <div className={`absolute right-8 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-4 pointer-events-auto transition-all duration-500 ${
        drivingMode ? 'opacity-40 translate-x-2' : 'opacity-100'
      }`}>
        <div className="flex flex-col gap-2 p-1 bg-black/40 backdrop-blur-xl rounded-[1.5rem] border border-white/10 shadow-xl">
          <button
            onClick={handleZoomIn}
            className="w-12 h-12 rounded-xl flex items-center justify-center text-white/80 hover:bg-white/10 active:scale-90 transition-all"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <div className="mx-3 h-px bg-white/5" />
          <button
            onClick={handleZoomOut}
            className="w-12 h-12 rounded-xl flex items-center justify-center text-white/80 hover:bg-white/10 active:scale-90 transition-all"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
        </div>

        <button
          onClick={handleRecenter}
          className="w-14 h-14 rounded-2xl bg-blue-500/20 backdrop-blur-xl border border-blue-400/20 flex items-center justify-center text-blue-400 hover:bg-blue-500/30 active:scale-90 transition-all shadow-lg"
        >
          <Crosshair className="w-6 h-6" />
        </button>

        <button
          onClick={handleToggleDrivingMode}
          className={`w-14 h-14 rounded-2xl backdrop-blur-xl border flex items-center justify-center active:scale-95 transition-all duration-500 shadow-xl ${
            drivingMode
              ? 'bg-blue-500 border-blue-400 text-white'
              : 'bg-black/50 border-white/10 text-white/40 hover:bg-black/70 hover:text-white/80'
          }`}
        >
          <Navigation2 className={`w-6 h-6 ${drivingMode ? 'fill-white' : ''}`} />
        </button>
      </div>

      {/* ── Bottom controls ── */}
      <div className={`absolute bottom-10 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-6 transition-all duration-500 ${
        drivingMode ? 'opacity-20 translate-y-4 pointer-events-none' : 'opacity-100'
      }`}>
        {/* Map mode switcher */}
        <div className="flex items-center gap-1 bg-black/50 backdrop-blur-xl rounded-[1.25rem] p-1 border border-white/10 shadow-2xl">
          {(['road', 'hybrid', 'satellite'] as MapMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMapMode(m)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[10px] font-black tracking-[0.15em] uppercase transition-all active:scale-95 ${
                mode === m
                  ? 'bg-white/10 text-white shadow-inner'
                  : 'text-white/30 hover:text-white/60'
              }`}
            >
              {m === 'road' && <Map className="w-4 h-4" />}
              {m === 'hybrid' && <Layers className="w-4 h-4" />}
              {m === 'satellite' && <Globe className="w-4 h-4" />}
              <span className="hidden sm:block">{MODE_LABELS[m]}</span>
            </button>
          ))}
        </div>

        {/* Coordinates */}
        <div className={`flex items-center gap-4 bg-black/20 backdrop-blur-md rounded-full px-4 py-1.5 border border-white/5 transition-opacity ${location ? 'opacity-100' : 'opacity-0'}`}>
          <span className="text-[9px] text-white/20 font-mono font-bold tracking-tight">
            {location?.latitude.toFixed(5)}°, {location?.longitude.toFixed(5)}°
          </span>
          {location?.altitude != null && (
            <span className="text-[9px] text-blue-400/20 font-mono font-bold uppercase">
              {Math.round(location.altitude)}m ALT
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
