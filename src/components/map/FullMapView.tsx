import { useEffect, useRef, useState, useCallback, memo } from 'react';
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
  setRouteGeometry,
  clearRouteGeometry,
  setTurnFocus,
  clearTurnFocus,
} from '../../platform/mapService';
import { useGPSLocation, useGPSHeading, startGPSTracking } from '../../platform/gpsService';
import {
  getMapStyle,
  setMapMode,
  useMapMode,
  type MapMode,
} from '../../platform/mapSourceManager';
import { useNavigation, updateNavigationProgress } from '../../platform/navigationService';
import {
  fetchRoute,
  useRouteState,
  updateRouteProgress,
  clearRoute,
} from '../../platform/routingService';
import { useAutoBrightnessState } from '../../platform/autoBrightnessService';
import { MapOverlay } from './MapOverlay';
import { NavigationHUD } from './NavigationHUD';

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

  const [isPreview, setIsPreview] = useState(false);
  const [routeStartFlash, setRouteStartFlash] = useState(false);
  const routeGeometryRef  = useRef<[number, number][] | null>(null);
  const prevStepIndexRef  = useRef(0);

  const location = useGPSLocation();
  const heading = useGPSHeading();
  const { isNavigating, destination } = useNavigation();
  const route = useRouteState();
  const autoBrightness = useAutoBrightnessState();
  const mode = useMapMode();
  const drivingMode = useDrivingMode();

  const isNight = autoBrightness.phase === 'night' || autoBrightness.phase === 'evening' || autoBrightness.phase === 'dawn';

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

  // Fetch route when navigation starts
  useEffect(() => {
    if (isNavigating && destination) {
      const loc = locationRef.current;
      const fromLat = loc?.latitude  ?? destination.latitude;
      const fromLon = loc?.longitude ?? destination.longitude;
      fetchRoute(fromLat, fromLon, destination.latitude, destination.longitude);
      setIsPreview(true);
    } else if (!isNavigating) {
      setIsPreview(false);
      if (mapRef.current) clearRouteGeometry(mapRef.current);
      clearRoute();
      routeGeometryRef.current = null;
    }
  }, [isNavigating]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draw / update route line on map when geometry arrives
  useEffect(() => {
    if (route.geometry && mapRef.current && mapRef.current.isStyleLoaded()) {
      setRouteGeometry(mapRef.current, route.geometry);
      routeGeometryRef.current = route.geometry;
    }
  }, [route.geometry]);

  // Turn focus: highlight next turn when approaching, clear on step advance
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route.steps.length) return;

    // Step just advanced → turn completed, clear focus
    if (route.currentStepIndex !== prevStepIndexRef.current) {
      prevStepIndexRef.current = route.currentStepIndex;
      clearTurnFocus();
      return;
    }

    const nextIdx  = Math.min(route.currentStepIndex + 1, route.steps.length - 1);
    const nextStep = route.steps[nextIdx];
    const dist     = route.distanceToNextTurnMeters;

    if (dist > 0 && dist < 200 && nextStep && nextIdx > route.currentStepIndex) {
      const [nLon, nLat] = nextStep.coordinate;
      setTurnFocus(map, nLon, nLat);
    } else {
      clearTurnFocus();
    }
  }, [route.currentStepIndex, route.distanceToNextTurnMeters, route.steps.length]);

  // Route start micro-interaction flash
  useEffect(() => {
    if (!isPreview) return;
    setRouteStartFlash(true);
    const t = setTimeout(() => setRouteStartFlash(false), 700);
    return () => clearTimeout(t);
  }, [isPreview]);

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
      // Restore route line after style change
      if (routeGeometryRef.current) {
        setRouteGeometry(map, routeGeometryRef.current);
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

    const turnDist = route.steps.length ? route.distanceToNextTurnMeters : undefined;

    if (!mapRef.current._fullMapInitialized) {
      addUserMarker(mapRef.current, latitude, longitude, bear);
      if (drivingMode) {
        const h = containerRef.current?.offsetHeight ?? 600;
        setDrivingView(mapRef.current, latitude, longitude, bear, speedKmh, h, turnDist);
      } else {
        setMapCenter(mapRef.current, [longitude, latitude], 15, true);
      }
      mapRef.current._fullMapInitialized = true;
    } else {
      updateUserMarker(latitude, longitude, bear);

      if (drivingMode) {
        const h = containerRef.current?.offsetHeight ?? 600;
        setDrivingView(mapRef.current, latitude, longitude, bear, speedKmh, h, turnDist);
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
      updateRouteProgress(latitude, longitude);
    }
  }, [location, heading, destination, mapStyleReady, styleKey, drivingMode]);

  const handleNavStart  = useCallback(() => setIsPreview(false), []);
  const handleNavCancel = useCallback(() => {
    setIsPreview(false);
    if (mapRef.current) clearRouteGeometry(mapRef.current);
    clearRoute();
    routeGeometryRef.current = null;
    // stopNavigation is handled inside NavigationHUD cancel
  }, []);

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
        style={{
          width: '100%',
          height: '100%',
          filter: isNight ? 'brightness(0.72) saturate(0.65)' : 'none',
          transition: 'filter 5s ease',
        }}
      />

      {/* Map overlays (pointer-events layer on top of map) */}
      <div className="absolute inset-0 pointer-events-none">
        <MapOverlay
          location={location}
          heading={heading}
          speedKmh={location?.speed != null ? location.speed * 3.6 : undefined}
        />
      </div>

      {/* Route start micro-interaction */}
      {routeStartFlash && (
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{
            background: 'radial-gradient(ellipse at 50% 65%, rgba(59,130,246,0.22) 0%, transparent 70%)',
            animation: 'routeStartFlash 0.7s ease-out forwards',
          }}
        />
      )}

      {/* Navigation HUD */}
      <NavigationHUD
        isPreview={isPreview}
        onStart={handleNavStart}
        onCancel={handleNavCancel}
        speedKmh={location?.speed != null ? location.speed * 3.6 : 0}
      />

      {/* ── Top controls ── */}
      <button
        onClick={onClose}
        style={{
          position: 'fixed',
          top: '16px',
          right: '16px',
          zIndex: 9999,
          background: '#dc2626',
          border: '3px solid #f87171',
          borderRadius: '14px',
          padding: '10px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          color: 'white',
          fontWeight: 800,
          fontSize: '14px',
          cursor: 'pointer',
          boxShadow: '0 0 24px rgba(220,38,38,0.6)',
          letterSpacing: '0.05em',
          pointerEvents: 'auto',
        }}
      >
        <X style={{ width: 18, height: 18, strokeWidth: 3 }} />
        <span>Çıkış</span>
      </button>

      {/* ── Right-side controls ── */}
      <div className={`absolute right-8 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-4 pointer-events-auto transition-all duration-500 ${
        drivingMode ? 'opacity-80 translate-x-2' : 'opacity-100'
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
              : 'bg-black/50 border-white/30 text-white/85 hover:bg-black/70 hover:text-white'
          }`}
        >
          <Navigation2 className={`w-6 h-6 ${drivingMode ? 'fill-white' : ''}`} />
        </button>
      </div>

      {/* ── Bottom controls ── */}
      <div className={`absolute bottom-10 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-6 transition-all duration-500 ${
        drivingMode || isPreview ? 'opacity-60 translate-y-4 pointer-events-none' : 'opacity-100'
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
                  : 'text-white/75 hover:text-white'
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
          <span className="text-[9px] text-white/55 font-mono font-bold tracking-tight">
            {location?.latitude.toFixed(5)}°, {location?.longitude.toFixed(5)}°
          </span>
          {location?.altitude != null && (
            <span className="text-[9px] text-blue-400/60 font-mono font-bold uppercase">
              {Math.round(location.altitude)}m ALT
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
