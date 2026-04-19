import { useEffect, useRef, useState, useCallback, memo } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

type MapRef = MapLibreMap & { _fullMapInitialized?: boolean };
import { X, ZoomIn, ZoomOut, Crosshair, Map, Layers, Globe, Navigation2, ArrowLeft } from 'lucide-react';
import {
  initializeMap,
  isWebGLAvailable,
  setMapCenter,
  addUserMarker,
  updateUserMarker,
  setMapHeading,
  switchMapStyle,
  setDrivingView,
  exitDrivingView,
  enterNavigationView,
  setDrivingMode,
  useDrivingMode,
  setRouteGeometry,
  clearRouteGeometry,
  setTurnFocus,
  clearTurnFocus,
} from '../../platform/mapService';
import { useGPSLocation, useGPSHeading } from '../../platform/gpsService';
import {
  getMapStyle,
  setMapMode,
  useMapMode,
  useTileRenderMode,
  notifyNavigationRender,
  type MapMode,
} from '../../platform/mapSourceManager';
import { useVisionStore } from '../../platform/visionEngine';
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
import { VisionOverlay } from './VisionOverlay';
import { useNavMode } from '../../platform/modeController';

interface FullMapViewProps {
  onClose: () => void;
  /** Navigasyon alt çubuğundan başka sekmeleri açmak için */
  onOpenDrawer?: (type: 'music' | 'phone' | 'apps' | 'settings') => void;
}

const MODE_LABELS: Record<MapMode, string> = {
  road: 'Yol',
  hybrid: 'Hibrit',
  satellite: 'Uydu',
};

export const FullMapView = memo(function FullMapView({ onClose, onOpenDrawer }: FullMapViewProps) {
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
  /** True while a style switch is in-flight — drives the anti-flicker overlay. */
  const [isSwitchingStyle, setIsSwitchingStyle] = useState(false);
  const renderInitRef = useRef(false);

  const location = useGPSLocation();
  const heading = useGPSHeading();
  const { isNavigating, destination } = useNavigation();
  const route = useRouteState();
  const autoBrightness = useAutoBrightnessState();
  const mode = useMapMode();
  const tileRender = useTileRenderMode();
  const drivingMode = useDrivingMode();
  const navMode = useNavMode();
  const arState = useVisionStore((s) => s.state);

  const isNight = autoBrightness.phase === 'night' || autoBrightness.phase === 'evening' || autoBrightness.phase === 'dawn';

  // Sync refs safely outside of render
  useEffect(() => {
    locationRef.current = location;
    headingRef.current = heading;
  }, [location, heading]);

  const [mapReady, setMapReady]       = useState(false);
  const [mapError, setMapError]       = useState<string | null>(null);
  const [styleKey, setStyleKey]       = useState(0);
  const mapStyleReady = mapReady;

  // WebGL kontrolü — eski head unit'lerde harita açılamaz
  const webglSupported = isWebGLAvailable();

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

          // GPS useLayoutServices'te merkezi olarak başlatılıyor
        } catch (err) {
          if (!cancelled) {
            setMapError(err instanceof Error ? err.message : 'Harita başlatılamadı');
          }
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

  // Map mode change (road/satellite/hybrid) — switch tile style
  useEffect(() => {
    if (!modeInitRef.current) {
      modeInitRef.current = true;
      return;
    }
    if (!mapRef.current) return;
    _doStyleSwitch(mapRef.current, false);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tile render mode change (raster ↔ vector) — auto-driven by navigation/AR state
  useEffect(() => {
    if (!renderInitRef.current) {
      renderInitRef.current = true;
      return;
    }
    if (!mapRef.current) return;
    // Raster switch (nav start): no fade, no delay — immediate for safety.
    // Vector switch (idle): soft fade-in from dark background.
    const instant = tileRender === 'raster';
    _doStyleSwitch(mapRef.current, !instant);
  }, [tileRender]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigation + AR state → notify auto-switch engine
  useEffect(() => {
    const arActive = arState === 'active' || arState === 'degraded';
    notifyNavigationRender(isNavigating, arActive);
  }, [isNavigating, arState]);

  /** Shared style-switch helper — avoids duplicating the marker/route restore logic. */
  function _doStyleSwitch(map: MapRef, withFadeOverlay: boolean): void {
    const loc = locationRef.current;
    const hdg = headingRef.current;

    if (withFadeOverlay) setIsSwitchingStyle(true);

    map._fullMapInitialized = false;
    switchMapStyle(map, getMapStyle());

    map.once('style.load', () => {
      if (loc) {
        addUserMarker(map, loc.latitude, loc.longitude, hdg || 0);
        setMapCenter(map, [loc.longitude, loc.latitude], undefined, false);
        map._fullMapInitialized = true;
      }
      if (routeGeometryRef.current) {
        setRouteGeometry(map, routeGeometryRef.current);
      }
      setStyleKey((k) => k + 1);
      // Brief delay so the first tile batch renders before removing overlay
      if (withFadeOverlay) {
        setTimeout(() => setIsSwitchingStyle(false), 150);
      }
    });
  }

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

  const handleNavStart  = useCallback(() => {
    setIsPreview(false);
    setDrivingMode(true);

    // Giriş animasyonu: tilt 0→45°, zoom →17, bearing = rota/GPS yönü
    if (mapRef.current) {
      const loc = locationRef.current;
      const bear = headingRef.current ?? 0;
      const h    = containerRef.current?.offsetHeight ?? 600;
      if (loc) {
        enterNavigationView(mapRef.current, loc.latitude, loc.longitude, bear, h);
      }
    }
  }, []);
  const handleNavCancel = useCallback(() => {
    setIsPreview(false);
    setDrivingMode(false);
    if (mapRef.current) {
      clearRouteGeometry(mapRef.current);
      exitDrivingView(mapRef.current);
    }
    clearRoute();
    routeGeometryRef.current = null;
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

  // WebGL yok — harita açılamaz, anlamlı hata ekranı göster
  if (!webglSupported || mapError) {
    return (
      <div
        className="fixed inset-0 z-[2000] flex flex-col items-center justify-center gap-8 p-10"
        style={{ background: 'linear-gradient(160deg,#08090e,#0a0c12)' }}
      >
        {/* Kapatma — sol üst */}
        <button
          onClick={onClose}
          className="flex items-center gap-2 rounded-2xl active:scale-90 transition-all"
          style={{
            position: 'fixed', top: 16, left: 16, zIndex: 9999,
            padding: '12px 20px',
            background: '#ef4444', border: '3px solid white',
            color: '#fff', fontWeight: 900, fontSize: 15,
            cursor: 'pointer', boxShadow: '0 4px 20px rgba(239,68,68,0.5)',
            overflow: 'visible',
          }}
        >
          <X className="w-5 h-5 text-white stroke-[3px]" />
          <span style={{ color: '#fff', fontWeight: 900 }}>KAPAT</span>
        </button>

        <div className="w-24 h-24 rounded-[2.5rem] flex items-center justify-center animate-pulse"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <Map className="w-12 h-12 text-red-400" />
        </div>
        <div className="text-center max-w-md">
          <div className="font-black text-3xl mb-4 tracking-tighter uppercase text-white">Harita Devre Dışı</div>
          <div className="text-base leading-relaxed font-bold uppercase tracking-widest px-4"
            style={{ color: 'rgba(255,255,255,0.45)' }}>
            {!webglSupported
              ? 'Bu cihazda WebGL desteği bulunamadı. GPU sürücülerini kontrol edin veya Chrome ayarlarında donanım hızlandırmayı etkinleştirin.'
              : mapError}
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex items-center gap-3 px-10 py-4 rounded-2xl active:scale-90 transition-all"
          style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', fontWeight: 700 }}
        >
          <ArrowLeft className="w-5 h-5" />
          Geri Dön
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 glass-card border-none !shadow-none z-50">
      {!mapReady && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center animate-spin-slow">
            <Globe className="w-8 h-8 text-blue-400/60" />
          </div>
        </div>
      )}
      {/* Full-screen map container — dims when AR camera feed is active */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{
          width: '100%',
          height: '100%',
          opacity: navMode === 'HYBRID_AR_NAVIGATION' ? 0.2 : 1,
          filter: isNight ? 'brightness(0.72) saturate(0.65)' : 'none',
          transition: 'opacity 500ms ease, filter 5s ease',
        }}
      />

      {/* Style-switch anti-flicker overlay.
          Fades in over the map (dark fill) while vector↔raster transition is
          in-flight, then fades out once first tiles have rendered.
          Not used for raster→raster switches (nav start) — those are instant. */}
      <div
        className="absolute inset-0 pointer-events-none z-[45]"
        style={{
          background: '#0d1117',
          opacity: isSwitchingStyle ? 1 : 0,
          transition: isSwitchingStyle
            ? 'opacity 80ms ease-in'   // snap dark quickly before tiles clear
            : 'opacity 300ms ease-out', // fade away slowly as new tiles appear
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

      {/* Vision AR overlay — camera feed + lane/sign detection */}
      <VisionOverlay
        isNavigating={isNavigating && !isPreview}
        currentLat={location?.latitude ?? null}
        currentLon={location?.longitude ?? null}
        headingDeg={heading ?? 0}
        routeGeometry={route.geometry}
        currentStepIndex={route.currentStepIndex}
      />

      {/* Navigation HUD */}
      <NavigationHUD
        isPreview={isPreview}
        onStart={handleNavStart}
        onCancel={handleNavCancel}
        speedKmh={location?.speed != null ? location.speed * 3.6 : 0}
        onNavTab={(id) => {
          if (id === 'media')    { onClose(); onOpenDrawer?.('music');    return; }
          if (id === 'phone')    { onClose(); onOpenDrawer?.('phone');    return; }
          if (id === 'apps')     { onClose(); onOpenDrawer?.('apps');     return; }
          if (id === 'settings') { onClose(); onOpenDrawer?.('settings'); return; }
        }}
      />

      {/* ── Kapatma butonu — sol üst, her zaman görünür ── */}
      <button
        onClick={onClose}
        aria-label="Haritayı kapat"
        className="flex items-center gap-2 rounded-2xl active:scale-90 transition-all shadow-2xl"
        style={{
          position: 'fixed', top: 16, left: 16, zIndex: 9999,
          padding: '12px 20px',
          background: '#ef4444', border: '3px solid white',
          color: '#fff', fontWeight: 900, fontSize: 15,
          letterSpacing: '0.05em', cursor: 'pointer',
          boxShadow: '0 4px 24px rgba(239,68,68,0.55)',
          overflow: 'visible',
        }}
      >
        <X className="w-6 h-6 text-white stroke-[3px]" />
        <span style={{ color: '#fff', fontWeight: 900 }}>KAPAT</span>
      </button>

      {/* ── Sağ kontroller — aktif navigasyonda gizle (SpeedPanel + LeftButtons yeterli) ── */}
      <div className={`absolute right-4 top-[30%] -translate-y-1/2 z-20 flex flex-col gap-3 pointer-events-auto transition-all duration-500 ${
        isNavigating ? 'opacity-0 pointer-events-none translate-x-4' :
        drivingMode  ? 'opacity-80 translate-x-2' : 'opacity-100'
      }`}>
        <div className="flex flex-col gap-2 p-1 var(--panel-bg-secondary) backdrop-blur-md backdrop-blur-xl rounded-[1.5rem] border border-white/10 shadow-xl">
          <button
            onClick={handleZoomIn}
            className="w-12 h-12 rounded-xl flex items-center justify-center text-primary/80 hover:var(--panel-bg-secondary) active:scale-90 transition-all"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <div className="mx-3 h-px var(--panel-bg-secondary)" />
          <button
            onClick={handleZoomOut}
            className="w-12 h-12 rounded-xl flex items-center justify-center text-primary/80 hover:var(--panel-bg-secondary) active:scale-90 transition-all"
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
              ? 'bg-blue-500 border-blue-400 text-primary'
              : 'var(--panel-bg-secondary) backdrop-blur-md border-white/30 text-primary/85 hover:var(--panel-bg-secondary) backdrop-blur-md hover:text-primary'
          }`}
        >
          <Navigation2 className={`w-6 h-6 ${drivingMode ? 'fill-white' : ''}`} />
        </button>
      </div>

      {/* ── Alt kontroller — dock üzerinde: bottom-[136px] ── */}
      <div className={`absolute bottom-[136px] left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-4 transition-all duration-500 ${
        isNavigating || drivingMode || isPreview ? 'opacity-0 translate-y-4 pointer-events-none' : 'opacity-100'
      }`}>
        {/* Map mode switcher */}
        <div className="flex items-center gap-1 var(--panel-bg-secondary) backdrop-blur-md backdrop-blur-xl rounded-[1.25rem] p-1 border border-white/10 shadow-2xl">
          {(['road', 'hybrid', 'satellite'] as MapMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMapMode(m)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[10px] font-black tracking-[0.15em] uppercase transition-all active:scale-95 ${
                mode === m
                  ? 'var(--panel-bg-secondary) text-primary shadow-inner'
                  : 'text-primary/75 hover:text-primary'
              }`}
            >
              {m === 'road' && <Map className="w-4 h-4" />}
              {m === 'hybrid' && <Layers className="w-4 h-4" />}
              {m === 'satellite' && <Globe className="w-4 h-4" />}
              <span className="hidden sm:block">{MODE_LABELS[m]}</span>
            </button>
          ))}
        </div>

        {/* Coordinates — kompakt, sadece lat/lng */}
        {location && (
          <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md rounded-full px-3 py-1 border border-white/8">
            <span className="text-[9px] text-white/45 font-mono tracking-tight">
              {location.latitude.toFixed(4)}°, {location.longitude.toFixed(4)}°
            </span>
          </div>
        )}
      </div>
    </div>
  );
});


