import { useEffect, useRef, useState, useCallback, memo, lazy, Suspense } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

type MapRef = MapLibreMap & { _fullMapInitialized?: boolean };
import { X, ZoomIn, ZoomOut, Crosshair, Map, Layers, Globe, Navigation2, ArrowLeft, Camera, CameraOff } from 'lucide-react';
import {
  initializeMap,
  destroyMap,
  isWebGLAvailable,
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
import { useGPSLocation, useGPSHeading, useGPSSource } from '../../platform/gpsService';
import {
  setMapMode,
  useMapMode,
  useTileRenderMode,
  notifyNavigationRender,
  notifyLowFPS,
  useMapNetworkStatus,
  type MapMode,
} from '../../platform/mapSourceManager';
import { useVisionStore } from '../../platform/visionStore';
import {
  useNavigation, updateNavigationProgress,
  setNavStatus, NavStatus, activateNavigation,
} from '../../platform/navigationService';
import {
  fetchRoute,
  useRouteState,
  updateRouteProgress,
  clearRoute,
  notifyStyleChange,
} from '../../platform/routingService';
import { useAutoBrightnessState } from '../../platform/autoBrightnessService';
import { MapOverlay } from './MapOverlay';
import { NavigationHUD } from './NavigationHUD';
// VisionOverlay lazy — kamera/AR katmanı yalnızca vision aktifken yüklenir.
// Bu import zinciri: VisionOverlay → visionEngine.ts (2280 satır WebGL/CV kodu)
// Başlangıç bundle'ından dışarı alınır; HomeScreen normal çalışmayı etkilemez.
const VisionOverlay = lazy(() =>
  import('./VisionOverlay').then((m) => ({ default: m.VisionOverlay })),
);
import { useNavMode, setUserVisionPreference } from '../../platform/modeController';
import { useRadarMapLayer } from '../../hooks/useRadarMapLayer';

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

// ── setDrivingView throttle yardımcıları ─────────────────────────────────
// Flat-earth yaklaşımı: küçük mesafeler (< 100 m) için hatasız, haversine'den hızlı.
function _distM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dlat = (lat2 - lat1) * 111_320;
  const dlng = (lng2 - lng1) * 111_320 * Math.cos(lat1 * (Math.PI / 180));
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

function _headingDiff(a: number, b: number): number {
  const d = Math.abs((b - a + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** Stable hash of a route geometry — first point + last point + length. */
function _routeHash(geometry: [number, number][] | null | undefined): string {
  if (!geometry || geometry.length < 2) return '';
  const f = geometry[0];
  const l = geometry[geometry.length - 1];
  return `${geometry.length}:${f[0].toFixed(5)},${f[1].toFixed(5)}:${l[0].toFixed(5)},${l[1].toFixed(5)}`;
}

export const FullMapView = memo(function FullMapView({ onClose, onOpenDrawer }: FullMapViewProps) {
  const outerDivRef   = useRef<HTMLDivElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const mapRef        = useRef<MapRef | null>(null);
  const initDone      = useRef(false);
  const cleanupRef    = useRef<(() => void) | null>(null);
  const modeInitRef   = useRef(false);
  const navStatusRef  = useRef<string>(NavStatus.IDLE); // FPS loop içinden okunur
  const locationRef        = useRef<ReturnType<typeof useGPSLocation>>(null);
  const headingRef         = useRef<number | null>(null);
  const lastDrivingPosRef  = useRef<{ lat: number; lng: number; heading: number } | null>(null);
  // unmount guard — prevents async style.load callbacks from touching React state after cleanup
  const mountedRef         = useRef(true);
  // dedup: skip setRouteGeometry when hash+styleKey are identical (same geometry, no style switch)
  const lastAppliedRef     = useRef<{ hash: string; styleKey: number } | null>(null);
  const commandQueueRef    = useRef<Array<() => void>>([]);

  // Tracks destination.id of the last fetch we initiated in this nav session.
  // Prevents duplicate fetches when location ticks while already routing,
  // and enables GPS-fix-late retry: if location was null at nav start, adding
  // location to the effect deps re-runs the effect once GPS arrives.
  const lastFetchedRef    = useRef<string | null>(null);

  const [isPreview, setIsPreview] = useState(false);
  const [routeStartFlash, setRouteStartFlash] = useState(false);
  const [routeReady, setRouteReady] = useState(false);
  const routeGeometryRef  = useRef<[number, number][] | null>(null);
  const routeAltRef       = useRef<[number, number][][] >([]);
  const prevStepIndexRef  = useRef(0);
  /** True while a style switch is in-flight — drives the anti-flicker overlay. */
  const [isSwitchingStyle, setIsSwitchingStyle] = useState(false);
  const renderInitRef = useRef(false);
  /** True while a MapLibre style reload is in-flight — blocks setRouteGeometry and fetchRoute store writes. */
  const styleChangingRef = useRef(false);

  const location = useGPSLocation();
  const heading = useGPSHeading();
  const gpsSource = useGPSSource();
  const { isNavigating, destination, status: navStatus } = useNavigation();
  const route = useRouteState();
  const autoBrightness = useAutoBrightnessState();
  const mode = useMapMode();
  const tileRender = useTileRenderMode();
  const drivingMode = useDrivingMode();
  const navMode = useNavMode();
  const arState = useVisionStore((s) => s.state);
  const [cameraOn, setCameraOn] = useState(false);
  const handleCameraToggle = () => {
    const next = !cameraOn;
    setCameraOn(next);
    setUserVisionPreference(next ? 'hybrid' : 'standard');
  };

  const isNight = autoBrightness.phase === 'night' || autoBrightness.phase === 'evening' || autoBrightness.phase === 'dawn';

  const isValidGPS = !!(location && Number.isFinite(location.accuracy) && location.accuracy < 1000);

  // Sync refs safely outside of render
  useEffect(() => {
    locationRef.current = location;
    headingRef.current = heading;
  }, [location, heading]);

  const [mapStatus, setMapStatus]     = useState<'IDLE' | 'LOADING' | 'READY' | 'ERROR'>('IDLE');
  const [mapError, setMapError]       = useState<string | null>(null);
  const [styleKey, setStyleKey]       = useState(0);
  const mapStyleReady = mapStatus === 'READY';

  const pushDebug = (label: string, data: unknown) => {
    try { console.log(`[NAV] ${label}:`, data); } catch { /* ignore */ }
  };

  useEffect(() => {
    if (mapStatus === 'READY' && commandQueueRef.current.length > 0) {
      commandQueueRef.current.forEach(cmd => cmd());
      commandQueueRef.current = [];
    }
  }, [mapStatus]);

  // Unmount guard — mount-once, sets false on cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // navStatusRef'i her render sonrası güncelle (rAF loop closure'ı için)
  useEffect(() => { navStatusRef.current = navStatus; }, [navStatus]);

  // ── Adaptive Performance — FPS monitörü ─────────────────────────────
  // Sürüş (ACTIVE/REROUTING) her zaman perf-low → blur yok.
  // Sürüş dışında FPS < 20 → perf-low, FPS 20-40 → perf-med.
  // Unmount'ta rAF temizlenir ve thermal lock kaldırılır (Zero-Leak).
  const lastLowFPSRef = useRef(false);

  useEffect(() => {
    const el = outerDivRef.current;
    if (!el) return;

    let frameCount  = 0;
    let lastT       = performance.now();
    let rafId:      number;
    let activeClass = '';

    const applyClass = (cls: string) => {
      if (cls === activeClass) return;
      if (activeClass) el.classList.remove(activeClass);
      if (cls)         el.classList.add(cls);
      activeClass = cls;
    };

    const tick = () => {
      frameCount++;
      const now = performance.now();

      if (now - lastT >= 1000) {
        const fps = frameCount;
        frameCount = 0;
        lastT      = now;

        const isActiveDriving =
          navStatusRef.current === NavStatus.ACTIVE ||
          navStatusRef.current === NavStatus.REROUTING;

        // CSS sınıfı — her ölçümde güncellenir
        if (fps < 20 || isActiveDriving) {
          applyClass('perf-low');
        } else if (fps < 40) {
          applyClass('perf-med');
        } else {
          applyClass('');
        }

        // Thermal lock — sadece high↔low geçişinde çağrılır (her saniye değil)
        const fpsIsLow = fps < 20;
        if (fpsIsLow !== lastLowFPSRef.current) {
          lastLowFPSRef.current = fpsIsLow;
          notifyLowFPS(fpsIsLow);
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      applyClass('');      // sınıfı temizle
      lastLowFPSRef.current = false;
      notifyLowFPS(false); // thermal lock'u kaldır
    };
  }, []); // mount-once; navStatusRef ref olduğu için dep'e girmez

  // ── Tesla/Mercedes auto-hide kontroller ──
  const [ctrlVisible, setCtrlVisible] = useState(true);
  const ctrlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showControls = useCallback(() => {
    setCtrlVisible(true);
    if (ctrlTimerRef.current) clearTimeout(ctrlTimerRef.current);
    ctrlTimerRef.current = setTimeout(() => setCtrlVisible(false), 3500);
  }, []);
  useEffect(() => {
    showControls();
    return () => { if (ctrlTimerRef.current) clearTimeout(ctrlTimerRef.current); };
  }, [showControls]);

  // Online durumu değişince (hotspot geç bağlandıysa) harita stilini yenile
  const { isOnline } = useMapNetworkStatus();
  const prevOnlineRef = useRef(isOnline);
  useEffect(() => {
    if (isOnline && !prevOnlineRef.current && mapRef.current) {
      // Offline → Online geçişi: _doStyleSwitch ile yenile — mutex + marker/route restore dahil
      _doStyleSwitch(mapRef.current, false);
    }
    prevOnlineRef.current = isOnline;
  }, [isOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  // Eagle Eye: render radar / speed-camera icons on the map
  useRadarMapLayer(mapRef, mapStyleReady);

  // Haritaya tıklanınca kontrolleri göster (MapLibre canvas olayları)
  useEffect(() => {
    if (mapStatus !== 'READY' || !mapRef.current) return;
    const map = mapRef.current;
    map.on('mousedown', showControls);
    map.on('touchstart', showControls);
    return () => {
      map.off('mousedown', showControls);
      map.off('touchstart', showControls);
    };
  }, [mapStatus, showControls]);

  // WebGL kontrolü — eski head unit'lerde harita açılamaz
  const webglSupported = isWebGLAvailable();

  // Init map — waits for container to have actual pixel dimensions
  useEffect(() => {
    if (!containerRef.current || initDone.current) return;

    const el = containerRef.current;
    let observer: ResizeObserver | null = null;

    function tryInit() {
      if (initDone.current) return;
      if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
      observer?.disconnect();
      doInit(el);
    }

    if (el.offsetWidth > 0 && el.offsetHeight > 0) {
      doInit(el);
    } else {
      observer = new ResizeObserver(tryInit);
      observer.observe(el);
      requestAnimationFrame(tryInit);
    }

    function doInit(container: HTMLElement) {
      // SINGLE INSTANCE GUARANTEE — never create a second WebGL context
      if (mapRef.current) {
        console.warn('[MAP_INIT] skipped — instance already alive');
        setMapStatus('READY');
        return;
      }
      initDone.current = true;
      setMapStatus('LOADING');
      let cancelled = false;
      console.log('[MAP_INIT] start');

      (async () => {
        try {
          const map = await initializeMap(container, { offline: true });
          if (cancelled) {
            // Component unmounted during init — destroy immediately
            try { map.remove(); } catch { /* ignore */ }
            return;
          }
          mapRef.current = map;
          console.log('[MAP_INIT] done');

          const markReady = () => { if (!cancelled) { console.log('[MAP_READY]'); setMapStatus('READY'); } };

          // ONLY style.load triggers READY — render fires too early (before layers can be added)
          if (map.isStyleLoaded()) {
            markReady();
          } else {
            let _readyFired = false;
            const _doReady = () => { if (!_readyFired) { _readyFired = true; markReady(); } };
            map.once('style.load', _doReady);
            setTimeout(_doReady, 3_000); // fallback: 3s max wait
          }
        } catch (err) {
          if (!cancelled) {
            setMapStatus('ERROR');
            setMapError(err instanceof Error ? err.message : 'Harita başlatılamadı');
          }
        }
      })();

      cleanupRef.current = () => {
        cancelled = true;
        if (styleChangingRef.current) {
          styleChangingRef.current = false;
          notifyStyleChange(false);
        }
        console.log('[MAP_REMOVE]');
        // HARD DESTROY: force WebGL context loss first, then remove
        if (mapRef.current) {
          try {
            const canvas = mapRef.current.getCanvas();
            const gl = canvas?.getContext('webgl');
            if (gl) {
              const ext = gl.getExtension('WEBGL_lose_context');
              ext?.loseContext();
            }
          } catch { /* ignore */ }
          try { mapRef.current.remove(); } catch { /* ignore */ }
          mapRef.current = null;
        }
        try { destroyMap(); } catch { /* ignore */ }
      };
    }

    return () => {
      observer?.disconnect();
      cleanupRef.current?.();
    };
  }, []);

  // Exit driving view when driving mode turns off
  useEffect(() => {
    if (!drivingMode && mapRef.current) {
      lastDrivingPosRef.current = null; // throttle sıfırla — sonraki aktivasyonda hemen çalışsın
      exitDrivingView(mapRef.current);
    }
  }, [drivingMode]);

  // Fetch route when navigation starts, destination changes, or GPS fix arrives after nav start.
  // location is in deps so that if GPS was unavailable at nav-start the effect retries
  // automatically on first fix — eliminating the "nav stuck with no route" deadlock.
  // lastFetchedRef dedups the fetch so normal GPS ticks (location changing every second
  // while driving) don't re-trigger it; mid-route rerouting is handled exclusively by
  // routingService._triggerReroute via updateRouteProgress.
  useEffect(() => {
    if (isNavigating && destination) {
      const loc = locationRef.current;
      if (!loc || loc.accuracy >= 1000) {
        pushDebug('ROUTE_BLOCKED_INVALID_GPS', { accuracy: loc?.accuracy ?? null });
        return;
      }
      if (lastFetchedRef.current === destination.id) return;
      lastFetchedRef.current = destination.id;
      setNavStatus(NavStatus.ROUTING);
      setRouteReady(false);
      fetchRoute(loc.latitude, loc.longitude, destination.latitude, destination.longitude);
      setIsPreview(true);
    } else if (!isNavigating) {
      lastFetchedRef.current = null;
      setIsPreview(false);
      setRouteReady(false);
      if (mapRef.current) clearRouteGeometry(mapRef.current);
      clearRoute();
      routeGeometryRef.current = null;
      routeAltRef.current      = [];
    }
  }, [isNavigating, destination, location]);

  // ROUTING → PREVIEW: rota yüklenince PreviewCard'a dön
  useEffect(() => {
    if (!route.loading && navStatus === NavStatus.ROUTING) {
      setNavStatus(NavStatus.PREVIEW);
    }
  }, [route.loading, navStatus]);

  // PREVIEW/ROUTING → ACTIVE: isPreview kapat
  useEffect(() => {
    if (navStatus === NavStatus.ACTIVE || navStatus === NavStatus.REROUTING) {
      setIsPreview(false);
    }
  }, [navStatus]);

  // D: Detect fetch failure — loading stopped but no geometry (e.g. _waitForStyleReady deadlock released)
  // Guard: navStatus === ROUTING means we are mid-fetch (fetchRoute sets loading:true synchronously,
  // but this effect captures render-time values — so the very first render after isNavigating becomes
  // true sees loading:false + geometry:null before fetchRoute runs). Skip that false positive.
  useEffect(() => {
    if (!isNavigating || route.loading) return;
    if (navStatus === NavStatus.ROUTING) return;
    if (route.geometry) return; // success path — geometry effect handles it
    // Pre-fetch false positive: serverUsed===null && error===null means fetchRoute hasn't run yet.
    if (!route.serverUsed && !route.error) return;
    const _loc = locationRef.current;
    pushDebug('ROUTE_FETCH_FAILED', {
      error: route.error ?? 'no_geometry',
      origin: _loc ? { lat: _loc.latitude, lon: _loc.longitude, acc: _loc.accuracy, src: gpsSource } : null,
      dest: destination ? { lat: destination.latitude, lon: destination.longitude } : null,
    });
  }, [isNavigating, route.loading, route.geometry, route.error, route.serverUsed, navStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // routeReady: rota geometrisi hesaplandı mı? → buton hemen açılır (harita render beklenmez)
  useEffect(() => {
    if (route.geometry && route.geometry.length >= 2) {
      setRouteReady(true);
    }
  }, [route.geometry]);

  // Draw / update route line — only when READY and style is not reloading.
  // styleChangingRef guard: MapLibre wipes all sources/layers on setStyle(); applying
  // route geometry before style.load completes throws "source does not exist" errors.
  // notifyStyleChange(false) → styleKey increments → this effect re-runs automatically.
  useEffect(() => {
    if (!route.geometry || !mapRef.current || mapStatus !== 'READY') return;
    if (styleChangingRef.current) return; // style reload in-flight — wait for notifyStyleChange(false)
    const hash = _routeHash(route.geometry);
    const last = lastAppliedRef.current;
    if (last && last.hash === hash && last.styleKey === styleKey) return;
    lastAppliedRef.current = { hash, styleKey };
    setRouteGeometry(mapRef.current, route.geometry, route.alternatives);
    pushDebug('ROUTE_GEOMETRY_SET', { pts: route.geometry?.length, first: route.geometry?.[0] });
    routeGeometryRef.current = route.geometry;
    routeAltRef.current      = route.alternatives;
  }, [route.geometry, route.alternatives, mapStatus, styleKey]);

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
    if (withFadeOverlay) setIsSwitchingStyle(true);

    map._fullMapInitialized = false;
    // Reset dedup — style switch wipes all sources/layers, so next route apply must run
    lastAppliedRef.current = null;

    // ── routingService mutex: hold fetchRoute store writes until layers are rebuilt ─
    // notifyStyleChange(true) → fetchRoute awaits _waitForStyleReady() before setState.
    // Released unconditionally in style.load to prevent deadlock on cancelled mounts.
    styleChangingRef.current = true;
    notifyStyleChange(true);

    setMapStatus('LOADING');
    switchMapStyle(map, {
      version: 8,
      sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19 } },
      layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }],
    } as any);

    map.once('style.load', () => {
      styleChangingRef.current = false;
      notifyStyleChange(false);
      if (!mountedRef.current) return;

      setMapStatus('READY');

      // Center to GPS after style loads — guaranteed correct timing
      const loc = locationRef.current;
      const hdg = headingRef.current;
      if (loc) {
        addUserMarker(map, loc.latitude, loc.longitude, hdg || 0);
        setMapCenter(map, [loc.longitude, loc.latitude], 15, false);
        map._fullMapInitialized = true;
      }
      if (routeGeometryRef.current) {
        setRouteGeometry(map, routeGeometryRef.current, routeAltRef.current);
      }
      setStyleKey((k) => k + 1);
      if (withFadeOverlay) {
        setTimeout(() => { if (mountedRef.current) setIsSwitchingStyle(false); }, 150);
      }
    });
  }

  // Location updates — normal tracking or driving view
  useEffect(() => {
    if (!mapRef.current || !location || !mapStyleReady) return;

    const { latitude, longitude } = location;
    const speedKmh = (location.speed ?? 0) * 3.6;
    const bear = heading || 0;

    const turnDist = route.steps.length ? route.distanceToNextTurnMeters : undefined;

    if (!mapRef.current._fullMapInitialized) {
      addUserMarker(mapRef.current, latitude, longitude, bear);
      if (drivingMode) {
        const h = containerRef.current?.offsetHeight ?? 600;
        lastDrivingPosRef.current = { lat: latitude, lng: longitude, heading: bear };
        setDrivingView(mapRef.current, latitude, longitude, bear, speedKmh, h, turnDist);
      } else {
        setMapCenter(mapRef.current, [longitude, latitude], 15, true);
      }
      mapRef.current._fullMapInitialized = true;
    } else {
      updateUserMarker(latitude, longitude, bear);

      if (drivingMode) {
        const h    = containerRef.current?.offsetHeight ?? 600;
        const last = lastDrivingPosRef.current;
        const moved = !last
          || _distM(last.lat, last.lng, latitude, longitude) > 2
          || _headingDiff(last.heading, bear) > 3;
        if (moved) {
          lastDrivingPosRef.current = { lat: latitude, lng: longitude, heading: bear };
          setDrivingView(mapRef.current, latitude, longitude, bear, speedKmh, h, turnDist);
        }
      } else {
        const currentCenter = mapRef.current.getCenter();
        const dx = longitude - currentCenter.lng;
        const dy = latitude - currentCenter.lat;
        if (Math.sqrt(dx * dx + dy * dy) > 0.005) {
          setMapCenter(mapRef.current, [longitude, latitude], 15, false);
        }
        if (heading && isFinite(heading)) {
          setMapHeading(mapRef.current, heading);
        }
      }
    }

    if (destination) {
      updateNavigationProgress(latitude, longitude, bear, routeGeometryRef.current ?? undefined);
      updateRouteProgress(latitude, longitude);
    }
  }, [location, heading, destination, mapStyleReady, styleKey, drivingMode]);

  const handleNavStart  = useCallback(() => {
    activateNavigation();
  }, []);
  const handleNavCancel = useCallback(() => {
    setIsPreview(false);
    setDrivingMode(false);
    setRouteReady(false);
    if (mapRef.current) {
      clearRouteGeometry(mapRef.current);
      exitDrivingView(mapRef.current);
    }
    clearRoute();
    routeGeometryRef.current = null;
    routeAltRef.current      = [];
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

  // WebGL yok veya init hatası — anlamlı hata ekranı göster
  if (!webglSupported || mapStatus === 'ERROR') {
    return (
      <div
        className="fixed inset-0 z-[2000] flex flex-col items-center justify-center gap-8 p-10"
        style={{ background: 'linear-gradient(160deg,#08090e,#0a0c12)' }}
      >
        {/* Kapatma — sağ üst */}
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-2xl active:scale-90 transition-all"
          style={{
            position: 'fixed',
            top: 'calc(var(--sat) + 14px)', right: 'calc(var(--sar) + 14px)',
            zIndex: 9999,
            padding: '10px 16px',
            background: 'rgba(239,68,68,0.92)', backdropFilter: 'blur(12px)',
            border: '1.5px solid rgba(255,255,255,0.30)',
            color: '#fff', fontWeight: 800, fontSize: 13,
            cursor: 'pointer', boxShadow: '0 4px 20px rgba(239,68,68,0.45)',
          }}
        >
          <X className="w-4 h-4 text-white stroke-[2.5px]" />
          <span style={{ color: '#fff' }}>KAPAT</span>
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
    <div ref={outerDivRef} className="fixed inset-0 glass-card border-none !shadow-none z-50">
      {mapStatus !== 'READY' && (
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
          opacity: navMode === 'HYBRID_AR_NAVIGATION' ? 0.55 : 1,
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

      {/* Vision AR overlay — lazy loaded, kamera/CV kodu yalnızca gerektiğinde indirilir */}
      <Suspense fallback={null}>
        <VisionOverlay
          isNavigating={cameraOn || (isNavigating && !isPreview)}
          currentLat={location?.latitude ?? null}
          currentLon={location?.longitude ?? null}
          headingDeg={heading ?? 0}
          routeGeometry={route.geometry}
          currentStepIndex={route.currentStepIndex}
        />
      </Suspense>

      {/* Navigation HUD */}
      <NavigationHUD
        onStart={handleNavStart}
        onCancel={handleNavCancel}
        routeReady={routeReady}
        gpsValid={isValidGPS}
        speedKmh={location?.speed != null ? location.speed * 3.6 : 0}
        onNavTab={(id) => {
          if (id === 'media')    { onClose(); onOpenDrawer?.('music');    return; }
          if (id === 'phone')    { onClose(); onOpenDrawer?.('phone');    return; }
          if (id === 'apps')     { onClose(); onOpenDrawer?.('apps');     return; }
          if (id === 'settings') { onClose(); onOpenDrawer?.('settings'); return; }
        }}
      />

      {/* ── KAPAT — her zaman tam görünür (güvenlik) ── */}
      <button
        onClick={onClose}
        aria-label="Haritayı kapat"
        className="flex items-center gap-1.5 rounded-2xl active:scale-90 transition-all"
        style={{
          position: 'fixed',
          top: 'calc(var(--sat) + 14px)', right: 'calc(var(--sar) + 14px)',
          zIndex: 9999,
          padding: '10px 16px',
          background: 'rgba(239,68,68,0.92)',
          backdropFilter: 'blur(12px)',
          border: '1.5px solid rgba(255,255,255,0.25)',
          color: '#fff', fontWeight: 800, fontSize: 13,
          letterSpacing: '0.04em', cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(239,68,68,0.40)',
        }}
      >
        <X className="w-4 h-4 text-white stroke-[2.5px]" />
        <span style={{ color: '#fff' }}>KAPAT</span>
      </button>

      {/* ── SAĞ ALT: Mercedes MBUX tarzı — her zaman yerinde, aktifken parlıyor ── */}
      <div
        className="absolute right-4 z-20 flex flex-col items-center gap-2.5"
        style={{
          bottom: 'calc(var(--lp-dock-h,68px) + 18px)',
          opacity: isNavigating ? 0 : ctrlVisible ? 1 : 0.32,
          transform: isNavigating ? 'translateX(56px)' : 'translateX(0)',
          pointerEvents: isNavigating ? 'none' : 'auto',
          transition: 'opacity 500ms cubic-bezier(0.4,0,0.2,1), transform 400ms cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        {/* Sürüş modu toggle */}
        <button
          onClick={() => { handleToggleDrivingMode(); showControls(); }}
          className={`w-12 h-12 rounded-2xl border flex items-center justify-center active:scale-95 transition-colors duration-300 backdrop-blur-xl ${
            drivingMode
              ? 'bg-blue-500 border-blue-400/50 text-white'
              : 'bg-black/60 border-white/15 text-slate-400 hover:text-white hover:border-white/25'
          }`}
          style={{ boxShadow: drivingMode ? '0 0 20px rgba(59,130,246,0.5), 0 4px 16px rgba(0,0,0,0.5)' : '0 4px 16px rgba(0,0,0,0.5)' }}
        >
          <Navigation2 className={`w-5 h-5 ${drivingMode ? 'fill-white' : ''}`} />
        </button>

        {/* Konuma dön */}
        <button
          onClick={() => { handleRecenter(); showControls(); }}
          className="w-12 h-12 rounded-2xl bg-black/60 backdrop-blur-xl border border-white/15 flex items-center justify-center text-slate-400 hover:text-blue-300 hover:border-blue-400/35 active:scale-90 transition-colors"
          style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
        >
          <Crosshair className="w-5 h-5" />
        </button>

        {/* Kamera aç/kapat */}
        <button
          onClick={handleCameraToggle}
          className={`w-12 h-12 rounded-2xl backdrop-blur-xl border flex items-center justify-center active:scale-90 transition-all ${
            cameraOn
              ? 'bg-blue-600 border-blue-500 text-white shadow-[0_0_16px_rgba(37,99,235,0.6)]'
              : 'bg-black/60 border-white/15 text-slate-400 hover:text-blue-300 hover:border-blue-400/35'
          }`}
          style={{ boxShadow: cameraOn ? '0 0 16px rgba(37,99,235,0.5)' : '0 4px 16px rgba(0,0,0,0.5)' }}
        >
          {cameraOn ? <Camera className="w-5 h-5" /> : <CameraOff className="w-5 h-5" />}
        </button>

        {/* Zoom pill */}
        <div
          className="flex flex-col bg-black/60 backdrop-blur-xl rounded-2xl border border-white/15 overflow-hidden"
          style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.55)' }}
        >
          <button
            onClick={() => { handleZoomIn(); showControls(); }}
            className="w-12 h-12 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 active:scale-90 transition-colors"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <div className="h-px bg-white/12 mx-2.5" />
          <button
            onClick={() => { handleZoomOut(); showControls(); }}
            className="w-12 h-12 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 active:scale-90 transition-colors"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── ALT MERKEZ: Harita katman seçici — nav/preview'da kaybolur, idle'da soluklaşır ── */}
      <div
        className="absolute left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2"
        style={{
          bottom: 'calc(var(--lp-dock-h,68px) + 14px)',
          opacity: (isNavigating || isPreview) ? 0 : ctrlVisible ? 1 : 0.28,
          transform: (isNavigating || isPreview) ? 'translateY(16px)' : 'translateY(0)',
          pointerEvents: (isNavigating || isPreview) ? 'none' : 'auto',
          transition: 'opacity 500ms cubic-bezier(0.4,0,0.2,1), transform 400ms cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <div
          className="flex items-center gap-0.5 bg-black/60 backdrop-blur-xl rounded-2xl p-1 border border-white/15"
          style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.55)' }}
        >
          {(['road', 'hybrid', 'satellite'] as MapMode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMapMode(m); showControls(); }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[10px] font-bold tracking-[0.12em] uppercase transition-all duration-200 active:scale-95 ${
                mode === m
                  ? 'bg-white/18 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/8'
              }`}
            >
              {m === 'road' && <Map className="w-3.5 h-3.5" />}
              {m === 'hybrid' && <Layers className="w-3.5 h-3.5" />}
              {m === 'satellite' && <Globe className="w-3.5 h-3.5" />}
              <span>{MODE_LABELS[m]}</span>
            </button>
          ))}
        </div>
        {location && (
          <span className="text-[9px] text-white/25 font-mono tracking-tight">
            {location.latitude.toFixed(4)}°, {location.longitude.toFixed(4)}°
          </span>
        )}
      </div>

    </div>
  );
});


