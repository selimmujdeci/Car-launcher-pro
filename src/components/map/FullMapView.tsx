import { useEffect, useRef, useState, useCallback, memo, lazy, Suspense } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

type MapRef = MapLibreMap & { _fullMapInitialized?: boolean };
import { X, Map, Globe, ArrowLeft } from 'lucide-react';
import {
  interpolateNavPoint, type NavPoint
} from '../../utils/interpolation';
import { bearingBetween } from '../../platform/cameraEngine';
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
  enterNavigationView,
  setDrivingMode,
  useDrivingMode,
  updateDrivingLayers,
  setRouteGeometry,
  clearRouteGeometry,
  setTurnFocus,
  clearTurnFocus,
  setMapStyleChanging,
  setNavigationFocusMode,
  reapplyNavigationFocus,
  updateNavigationStyle,
  updateMapMood,
  registerAltRouteSelectCallback,
} from '../../platform/mapService';
import { useHazardStore } from '../../store/useHazardStore';
import { useGPSLocation, useGPSHeading, useGPSSource } from '../../platform/gpsService';
import {
  setMapMode,
  useMapMode,
  useTileRenderMode,
  notifyNavigationRender,
  notifyLowFPS,
  useMapNetworkStatus,
  getMapStyle,
} from '../../platform/mapSourceManager';
import { useVisionStore } from '../../platform/visionStore';
import {
  useNavigation, updateNavigationProgress, getSnappedMarkerPosition,
  setNavStatus, NavStatus, activateNavigation, stopNavigation, startNavigation,
} from '../../platform/navigationService';
import {
  fetchRoute,
  useRouteState,
  getRouteState,
  updateRouteProgress,
  clearRoute,
  notifyStyleChange,
  selectAltRoute,
  registerNavigationStyleCallback,
} from '../../platform/routingService';
import { useAutoBrightnessState } from '../../platform/autoBrightnessService';
import { MapOverlay } from './MapOverlay';
import { NavigationHUD } from './NavigationHUD';
import { MapHudControls } from './MapHudControls';
// VisionOverlay lazy — kamera/AR katmanı yalnızca vision aktifken yüklenir.
// Bu import zinciri: VisionOverlay → visionEngine.ts (2280 satır WebGL/CV kodu)
// Başlangıç bundle'ından dışarı alınır; HomeScreen normal çalışmayı etkilemez.
const VisionOverlay = lazy(() =>
  import('./VisionOverlay').then((m) => ({ default: m.VisionOverlay })),
);
import { useNavMode, setUserVisionPreference } from '../../platform/modeController';
import { useRadarMapLayer } from '../../hooks/useRadarMapLayer';
import { useOBDState } from '../../platform/obdService';

interface FullMapViewProps {
  onClose: () => void;
  /** Navigasyon alt çubuğundan başka sekmeleri açmak için */
  onOpenDrawer?: (type: 'music' | 'phone' | 'apps' | 'settings') => void;
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
  const initializedRef = useRef(false);
  const cleanupRef    = useRef<(() => void) | null>(null);
  const modeInitRef   = useRef(false);
  const navStatusRef  = useRef<string>(NavStatus.IDLE); // FPS loop içinden okunur
  const locationRef        = useRef<ReturnType<typeof useGPSLocation>>(null);
  const headingRef         = useRef<number | null>(null);
  const lastDrivingPosRef  = useRef<{ lat: number; lng: number; heading: number } | null>(null);
  const navPointsRef       = useRef<NavPoint[]>([]);
  const interpolatedStateRef = useRef<NavPoint | null>(null);
  // unmount guard — prevents async style.load callbacks from touching React state after cleanup
  const mountedRef         = useRef(true);
  // dedup: skip setRouteGeometry when hash+styleKey+navStatus are identical
  // navStatus dahil edildi: PREVIEW→ACTIVE geçişinde aynı hash olsa bile yeniden çizilsin
  const lastAppliedRef     = useRef<{ hash: string; styleKey: number; navStatus: string } | null>(null);
  const lastDrivingLayersMs = useRef(0); // queryRenderedFeatures pahalı — 2s throttle
  const userInteractingRef = useRef(false);
  const interactTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandQueueRef    = useRef<Array<() => void>>([]);

  // Tracks destination.id of the last fetch we initiated in this nav session.
  // Prevents duplicate fetches when location ticks while already routing,
  // and enables GPS-fix-late retry: if location was null at nav start, adding
  // location to the effect deps re-runs the effect once GPS arrives.
  const lastFetchedRef    = useRef<string | null>(null);

  const [isPreview, setIsPreview] = useState(false);
  const [routeStartFlash, setRouteStartFlash] = useState(false);
  const [routeReady, setRouteReady] = useState(false);
  const [isFollowing, setIsFollowing] = useState(true);
  const isFollowingRef  = useRef(true);
  const autoFollowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drivingModeRef  = useRef(false);
  const routeGeometryRef  = useRef<[number, number][] | null>(null);
  const routeAltRef       = useRef<[number, number][][]>([]);
  const routeAltIdxRef    = useRef<number[]>([]);
  const routeAltDursRef   = useRef<number[]>([]);
  const routeMainDurRef   = useRef<number>(0);
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

  // ── Dead Reckoning refs — rAF loop içinde kullanılır, React state tetiklemez ──
  const obdSpeedRef     = useRef(0);           // OBD hız (km/h) — DR fallback için
  const gpsLostTsRef    = useRef<number | null>(null); // GPS kayıp zamanı
  const drWarnTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gpsLostWarn, setGpsLostWarn] = useState(false);
  const gpsLostWarnRef  = useRef(false); // stale closure'dan kaçınmak için

  // OBD hız ref'ini reactive olarak güncelle (render tetiklemeden)
  const obdState = useOBDState();
  useEffect(() => { obdSpeedRef.current = obdState.speed ?? 0; }, [obdState.speed]);
  // gpsLostWarn ref sync — tick closure stale okuma önlemi
  useEffect(() => { gpsLostWarnRef.current = gpsLostWarn; }, [gpsLostWarn]);

  // Sync refs safely outside of render
  useEffect(() => {
    locationRef.current = location;
    headingRef.current  = heading;
  }, [location, heading]);

  useEffect(() => { drivingModeRef.current = drivingMode; }, [drivingMode]);

  const [mapStatus, setMapStatus]     = useState<'IDLE' | 'LOADING' | 'READY' | 'ERROR'>('IDLE');
  const [mapError, setMapError]       = useState<string | null>(null);
  const [styleKey, setStyleKey]       = useState(0);
  const mapStyleReady = mapStatus === 'READY';

  // Testability: harita render tamamlandığında DOM attribute set edilir (CSS/logic etkilemez)
  useEffect(() => {
    const el = outerDivRef.current;
    if (!el) return;
    if (mapStatus === 'READY') {
      el.setAttribute('data-map-ready', 'true');
    } else {
      el.removeAttribute('data-map-ready');
    }
  }, [mapStatus]);

  const pushDebug = (label: string, data: unknown) => {
    try { console.log(`[NAV] ${label}:`, data); } catch { /* ignore */ }
  };

  useEffect(() => {
    if (mapStatus === 'READY' && commandQueueRef.current.length > 0) {
      commandQueueRef.current.forEach(cmd => cmd());
      commandQueueRef.current = [];
    }
    // İlk açılışta GPS konumuna atla — map Türkiye merkezinde açılır,
    // kullanıcı konumu gelince hemen oraya geç.
    if (mapStatus === 'READY' && mapRef.current) {
      const loc = locationRef.current;
      if (loc && !mapRef.current._fullMapInitialized) {
        addUserMarker(mapRef.current, loc.latitude, loc.longitude, headingRef.current || 0);
        setMapCenter(mapRef.current, [loc.longitude, loc.latitude], 15, true);
        mapRef.current._fullMapInitialized = true;
      }
    }
  }, [mapStatus]);

  // Stuck-LOADING guard — style.load Android WebView'da bazen hiç gelmez.
  // Resize pump: 300ms aralıkla MapLibre'ye container boyutunu hatırlat (siyah ekran önleme).
  // 5s sonra hâlâ LOADING ise READY'e zorla.
  useEffect(() => {
    if (mapStatus !== 'LOADING') return;

    // Resize pump — MapLibre boyutu sıfır sanıyorsa bu kurtarır
    const pumpId = setInterval(() => {
      const container = containerRef.current;
      if (mapRef.current && container && container.offsetWidth > 0 && container.offsetHeight > 0) {
        try { mapRef.current.resize(); } catch { /* ignore */ }
      }
    }, 300);

    const t = setTimeout(() => {
      clearInterval(pumpId);
      if (mountedRef.current) {
        console.warn('[MAP] style.load timeout — forcing READY');
        if (containerRef.current?.offsetWidth ?? 0 > 0) {
          try { mapRef.current?.resize(); } catch { /* ignore */ }
        }
        setMapStatus('READY');
        notifyStyleChange(false);
      }
    }, 5_000);

    return () => { clearTimeout(t); clearInterval(pumpId); };
  }, [mapStatus]);

  // Unmount guard — mount-once, sets false on cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // routingService → Focus Mode köprüsü.
  // fetchRoute rota hazır/temizlediğinde mapRef üzerinden updateNavigationStyle tetikler.
  useEffect(() => {
    return registerNavigationStyleCallback((active) => {
      if (!mountedRef.current) return;
      const map = mapRef.current;
      if (map && map.isStyleLoaded()) updateNavigationStyle(map, active);
    });
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

    let lastCameraUpdate = 0;
    let lastMarkerUpdate = 0;
    let isPerfLowCached  = false; // DOM classList sorgusunu önler — applyClass'la senkronize

    const tick = (now: number) => {
      // ── Dead Reckoning — GPS koptuysa OBD hız + son heading ile konum hesapla ──
      // Sadece: navigasyon ACTIVE + GPS geçersiz → CPU sıfır yük normal durumda
      const isActiveNav = navStatusRef.current === NavStatus.ACTIVE || navStatusRef.current === NavStatus.REROUTING;
      const gpsOk = !!(locationRef.current && Number.isFinite(locationRef.current.accuracy) && locationRef.current.accuracy < 1000);

      if (isActiveNav && !gpsOk && navPointsRef.current.length > 0) {
        const lastKnown = navPointsRef.current[navPointsRef.current.length - 1];
        const obdKmh    = obdSpeedRef.current;

        // GPS kayıp zamanını ilk kez kaydet
        if (gpsLostTsRef.current === null) gpsLostTsRef.current = now;
        const lostMs = now - gpsLostTsRef.current;

        // 30s GPS yok + OBD hızı 0 → "Konum Kayboldu" uyarısı (bir kez tetiklenir)
        if (lostMs > 30_000 && obdKmh < 1 && !gpsLostWarnRef.current) {
          if (!drWarnTimerRef.current) {
            drWarnTimerRef.current = setTimeout(() => {
              if (mountedRef.current) setGpsLostWarn(true);
            }, 0);
          }
        }

        // perf-low modda DR hesaplama sıklığını azalt (her 500ms)
        const isPerfLow = isPerfLowCached;
        const drInterval = isPerfLow ? 500 : 16;

        if (!userInteractingRef.current && mapRef.current && mapRef.current.isStyleLoaded() && (now - lastCameraUpdate > drInterval)) {
          // Dead Reckoning: s = v × t, kartezyen tahmini
          const dtSec    = Math.min((now - lastKnown.ts) / 1000, 5); // max 5s DR penceresi
          const distDeg  = (obdKmh / 3.6) * dtSec / 111_320;
          const headRad  = (lastKnown.heading * Math.PI) / 180;
          const cosLat   = Math.max(0.001, Math.cos((lastKnown.lat * Math.PI) / 180));
          const drLat    = lastKnown.lat + distDeg * Math.cos(headRad);
          const drLng    = lastKnown.lng + distDeg * Math.sin(headRad) / cosLat;

          if (now - lastMarkerUpdate > 100) {
            updateUserMarker(drLat, drLng, lastKnown.heading, obdKmh);
            lastMarkerUpdate = now;
          }
          if (isFollowingRef.current) {
            const h = containerRef.current?.offsetHeight ?? 600;
            setDrivingView(mapRef.current, drLat, drLng, lastKnown.heading, obdKmh, h);
            lastCameraUpdate = now;
          }
        }
      } else {
        // GPS geri geldi — DR state ve uyarıyı temizle
        if (gpsLostTsRef.current !== null) {
          gpsLostTsRef.current = null;
          if (drWarnTimerRef.current) { clearTimeout(drWarnTimerRef.current); drWarnTimerRef.current = null; }
          if (gpsLostWarnRef.current && mountedRef.current) setGpsLostWarn(false);
        }
      }

      // 1. Interpolation Mantığı — 60 FPS Araç Hareketi
      const buffer = navPointsRef.current;
      if (buffer.length >= 2 && mapRef.current && mapRef.current.isStyleLoaded()) {
        const p1 = buffer[0];
        const p2 = buffer[1];
        const interpolated = interpolateNavPoint(p1, p2, now);
        interpolatedStateRef.current = interpolated;

        const { lat, lng, heading: bear } = interpolated;
        // GPS hız sıfırsa OBD fallback — speed-adaptive zoom/pitch için
        const gpsSpeedKmh = (locationRef.current?.speed ?? 0) * 3.6;
        const speedKmh    = gpsSpeedKmh > 0.5 ? gpsSpeedKmh : obdSpeedRef.current;
        const turnDist = route.steps.length ? route.distanceToNextTurnMeters : undefined;

        // A — Araç işaretçisi + Visual Snapping
        // ACTIVE: snap → rota yoluna kilitle, GPS zıplamalarını gizle
        // Kamera da snapped koordinatı kullanır → sürücü rota dışı görünmez
        const _snap = navStatusRef.current === NavStatus.ACTIVE
          ? getSnappedMarkerPosition()
          : null;
        const displayLat = _snap?.lat ?? lat;
        const displayLng = _snap?.lon ?? lng;

        // Marker: kullanıcı etkileşimi yoksa 100ms'de bir güncelle (10fps yeterli)
        if (!userInteractingRef.current && now - lastMarkerUpdate > 100) {
          updateUserMarker(displayLat, displayLng, bear, speedKmh);
          lastMarkerUpdate = now;
        }

        const isPreviewTracking =
          (navStatusRef.current === NavStatus.PREVIEW || navStatusRef.current === NavStatus.ROUTING) &&
          !!routeGeometryRef.current;
        const isActiveNavigation =
          navStatusRef.current === NavStatus.ACTIVE ||
          navStatusRef.current === NavStatus.REROUTING;
        const wantDrivingView = drivingModeRef.current || isPreviewTracking || isActiveNavigation;

        if (wantDrivingView) {
          const h = containerRef.current?.offsetHeight ?? 600;
          // Kullanıcı etkileşimi varsa kamera GÜNCELLENMESİN — pinch/zoom dondurma
          // Hız sıfırken 500ms, hız varken 150ms (6-7fps) — 16ms~60fps yerine GPU yükü %90 azalır
          const cameraThrottleMs = speedKmh < 1 ? 500 : 150;
          if (!userInteractingRef.current && isFollowingRef.current && (now - lastCameraUpdate > cameraThrottleMs)) {
            // Turn anticipation: manevra sonrası yönü hesapla → kamera dönüşü önceden "görür"
            let _nextTurnBearing: number | undefined;
            const _rs  = getRouteState();
            const _ni  = _rs.currentStepIndex + 1;         // bir sonraki dönüş adımı
            const _ni2 = _ni + 1;                           // dönüş sonrası adım
            if (_rs.steps.length > _ni2) {
              const [aLon, aLat] = _rs.steps[_ni].coordinate;
              const [bLon, bLat] = _rs.steps[_ni2].coordinate;
              _nextTurnBearing = bearingBetween(aLat, aLon, bLat, bLon);
            }
            // Kamera snapped pozisyonu takip eder → GPS zıplamalarını sürücüye hissettirmez
            setDrivingView(mapRef.current, displayLat, displayLng, bear, speedKmh, h, turnDist, obdSpeedRef.current, _nextTurnBearing);
            lastCameraUpdate = now;
          }
        } else if (!userInteractingRef.current && isFollowingRef.current) {
          // Nav dışı takip modu (2D) — 500ms'de bir merkezle
          if (now - lastCameraUpdate > 500) {
            setMapCenter(mapRef.current, [lng, lat], 15, false);
            setMapHeading(mapRef.current, bear);
            lastCameraUpdate = now;
          }
        }
      } else if (buffer.length === 1 && mapRef.current && mapRef.current.isStyleLoaded()) {
        // Tek nokta varsa (başlangıç) doğrudan oraya git
        const p = buffer[0];
        updateUserMarker(p.lat, p.lng, p.heading, 0);
      }

      // 2. FPS & Performance Monitörü
      frameCount++;
      if (now - lastT >= 1000) {
        const fps = frameCount;
        frameCount = 0;
        lastT      = now;

        // CSS sınıfı — her ölçümde güncellenir; isPerfLowCached ile RAF'taki DOM sorgusu kaldırıldı
        if (fps < 20) {
          applyClass('perf-low');
          isPerfLowCached = true;
        } else if (fps < 40) {
          applyClass('perf-med');
          isPerfLowCached = false;
        } else {
          applyClass('');
          isPerfLowCached = false;
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
      applyClass('');
      lastLowFPSRef.current = false;
      notifyLowFPS(false);
      if (interactTimerRef.current) clearTimeout(interactTimerRef.current);
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

  // Interaction guard — map READY olduktan sonra bağlanır (mount-time null sorunu çözüldü)
  const _onInteractStart = useCallback(() => {
    userInteractingRef.current = true;
    if (interactTimerRef.current) { clearTimeout(interactTimerRef.current); interactTimerRef.current = null; }
  }, []);
  const _onInteractEnd = useCallback(() => {
    if (interactTimerRef.current) clearTimeout(interactTimerRef.current);
    interactTimerRef.current = setTimeout(() => { userInteractingRef.current = false; }, 120);
  }, []);
  useEffect(() => {
    if (mapStatus !== 'READY' || !mapRef.current) return;
    const map = mapRef.current;
    map.on('dragstart',   _onInteractStart);
    map.on('dragend',     _onInteractEnd);
    map.on('zoomstart',   _onInteractStart);
    map.on('zoomend',     _onInteractEnd);
    map.on('pitchstart',  _onInteractStart);
    map.on('pitchend',    _onInteractEnd);
    map.on('rotatestart', _onInteractStart);
    map.on('rotateend',   _onInteractEnd);
    return () => {
      map.off('dragstart',   _onInteractStart);
      map.off('dragend',     _onInteractEnd);
      map.off('zoomstart',   _onInteractStart);
      map.off('zoomend',     _onInteractEnd);
      map.off('pitchstart',  _onInteractStart);
      map.off('pitchend',    _onInteractEnd);
      map.off('rotatestart', _onInteractStart);
      map.off('rotateend',   _onInteractEnd);
    };
  }, [mapStatus, _onInteractStart, _onInteractEnd]);

  // Online durumu değişince (hotspot geç bağlandıysa) harita stilini yenile
  const { isOnline } = useMapNetworkStatus();
  const prevOnlineRef = useRef(isOnline);
  useEffect(() => {
    if (isOnline && !prevOnlineRef.current && mapRef.current) {
      // Navigasyon sırasında style switch atla — setStyle() rota katmanlarını siler;
      // tile'lar yeni bağlantıyla zaten kendi başına yenilenir, tam reload gereksiz.
      if (navStatusRef.current === NavStatus.IDLE) {
        _doStyleSwitch(mapRef.current, false);
      }
    }
    prevOnlineRef.current = isOnline;
  }, [isOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  // Eagle Eye: render radar / speed-camera icons on the map
  useRadarMapLayer(mapRef, mapStyleReady);

  // C7.2 — alternatif rota seçim köprüsü: mapService click → routingService
  // mapService, style.load sonrası etkileşimleri otomatik yeniler (persistence garantisi).
  useEffect(() => {
    return registerAltRouteSelectCallback((idx) => selectAltRoute(idx));
  }, []);

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

  // Haritaya uzun basış (sağ tık / contextmenu) → o noktayı hedef seç
  useEffect(() => {
    if (mapStatus !== 'READY' || !mapRef.current) return;
    const map = mapRef.current;
    const onLongPress = (e: { lngLat: { lng: number; lat: number } }) => {
      const { lng, lat } = e.lngLat;
      startNavigation({
        id: `map-${Date.now()}`,
        name: 'Haritadan Seçilen Nokta',
        latitude: lat,
        longitude: lng,
        type: 'history',
      });
    };
    map.on('contextmenu', onLongPress);
    return () => { map.off('contextmenu', onLongPress); };
  }, [mapStatus]);

  // Kullanıcı haritayı sürüklediğinde takibi durdur — 10 saniye sonra otomatik yeniden başlat
  useEffect(() => {
    if (mapStatus !== 'READY' || !mapRef.current) return;
    const map = mapRef.current;
    const scheduleAutoFollow = () => {
      if (autoFollowTimerRef.current) clearTimeout(autoFollowTimerRef.current);
      const isNav = navStatusRef.current === NavStatus.ACTIVE || navStatusRef.current === NavStatus.REROUTING;
      autoFollowTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        isFollowingRef.current = true;
        setIsFollowing(true);
        const loc  = locationRef.current;
        const bear = headingRef.current ?? 0;
        const h    = containerRef.current?.offsetHeight ?? 600;
        if (mapRef.current && loc && mapRef.current.isStyleLoaded()) {
          if (drivingModeRef.current || isNav) {
            enterNavigationView(mapRef.current, loc.latitude, loc.longitude, bear, h);
          }
        }
      }, isNav ? 3_000 : 10_000);
    };
    const onDrag = () => {
      if (isFollowingRef.current) {
        isFollowingRef.current = false;
        setIsFollowing(false);
      }
      scheduleAutoFollow();
    };
    map.on('dragstart', onDrag);
    return () => {
      map.off('dragstart', onDrag);
      if (autoFollowTimerRef.current) clearTimeout(autoFollowTimerRef.current);
    };
  }, [mapStatus]);

  // Sürüş modu açılınca takibi yeniden başlat + haritayı hemen 3D nav görünümüne al
  useEffect(() => {
    if (drivingMode) {
      isFollowingRef.current   = true;
      setIsFollowing(true);
      lastDrivingPosRef.current = null; // throttle sıfırla → sonraki GPS tick'inde kesinlikle setDrivingView çalışır
      const loc  = locationRef.current;
      const bear = headingRef.current ?? 0;
      const h    = containerRef.current?.offsetHeight ?? 600;
      if (mapRef.current && loc && mapRef.current.isStyleLoaded()) {
        enterNavigationView(mapRef.current, loc.latitude, loc.longitude, bear, h);
      }
    }
  }, [drivingMode]);

  // WebGL kontrolü — eski head unit'lerde harita açılamaz
  const webglSupported = isWebGLAvailable();

  // Init map — waits for container to have stable pixel dimensions (min 3 rAF frames)
  useEffect(() => {
    if (!containerRef.current || initDone.current) return;

    const el = containerRef.current;
    let observer: ResizeObserver | null = null;

    let resizeRafId:    number | null = null;
    let resizeTimerId: ReturnType<typeof setTimeout> | null = null; // post-init debounce
    let settleRafId:   number | null = null;
    let settleCount   = 0;
    let lastW         = 0;
    let lastH         = 0;
    const SETTLE_FRAMES = 3; // min 3 frame boyunca aynı boyut → init güvenli

    function scheduleSettle() {
      if (settleRafId !== null) cancelAnimationFrame(settleRafId);
      settleRafId = requestAnimationFrame(() => {
        settleRafId = null;
        if (initDone.current) return;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        if (w === 0 || h === 0) { settleCount = 0; return; } // 0×0 → ResizeObserver bekle
        if (w === lastW && h === lastH) {
          settleCount++;
        } else {
          settleCount = 1;
          lastW = w;
          lastH = h;
        }
        if (settleCount >= SETTLE_FRAMES) {
          doInit(el);
        } else {
          scheduleSettle(); // bir frame daha bekle
        }
      });
    }

    function tryInit() {
      if (initDone.current) {
        if (el.offsetWidth > 0 && el.offsetHeight > 0 && mapRef.current) {
          // 150ms debounce — CSS geçişleri sırasında resize spam'ini önler (MALI-400)
          if (resizeTimerId !== null) clearTimeout(resizeTimerId);
          resizeTimerId = setTimeout(() => {
            resizeTimerId = null;
            const container = containerRef.current;
            if (container && container.offsetWidth > 0 && container.offsetHeight > 0) {
              try { mapRef.current?.resize(); } catch { /* ignore */ }
            }
          }, 150);
        }
        return;
      }
      if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
      // ResizeObserver tetiklendi → settle sayacını sıfırla, yeniden başlat
      settleCount = 0;
      lastW = 0;
      lastH = 0;
      scheduleSettle();
    }

    observer = new ResizeObserver(tryInit);
    observer.observe(el);

    // İlk mount'ta boyut varsa hemen settle döngüsünü başlat
    if (el.offsetWidth > 0 && el.offsetHeight > 0) {
      scheduleSettle();
    } else {
      requestAnimationFrame(tryInit);
    }

    const onTransitionEnd = () => {
      if (mapRef.current && el.offsetWidth > 0 && el.offsetHeight > 0) {
        requestAnimationFrame(() => {
          if (el.offsetWidth > 0 && el.offsetHeight > 0) {
            try { mapRef.current?.resize(); } catch { /* ignore */ }
          }
        });
      }
    };
    el.addEventListener('transitionend', onTransitionEnd);

    function doInit(container: HTMLElement) {
      // SINGLE INSTANCE GUARANTEE — never create a second WebGL context
      if (mapRef.current) {
        console.log('[MAP_INIT_BLOCKED] already exists');
        setMapStatus('READY');
        return;
      }
      if (initializedRef.current) {
        console.log('[MAP_INIT_BLOCKED] initializedRef');
        return;
      }
      initializedRef.current = true;
      initDone.current = true;
      setMapStatus('LOADING');
      let cancelled = false;
      console.log('[MAP_INIT_START]');

      (async () => {
        try {
          const map = await initializeMap(container, { offline: true });
          if (cancelled) {
            // Component unmounted during init — destroy immediately
            try { map.remove(); } catch { /* ignore */ }
            return;
          }
          mapRef.current = map;
          console.log('[MAP_INIT_DONE]');

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
          (window as any).__MAP_MUTEX__ = false;
          setMapStyleChanging(false);
          notifyStyleChange(false);
        }
        console.log('[MAP_DESTROY]');
        mapRef.current = null;
        initializedRef.current = false;
        try { destroyMap(); } catch (e) { console.warn('[MAP_DESTROY_FAILED]', e); }
      };
    }

    return () => {
      observer?.disconnect();
      if (resizeRafId !== null)   cancelAnimationFrame(resizeRafId);
      if (settleRafId !== null)   cancelAnimationFrame(settleRafId);
      if (resizeTimerId !== null) clearTimeout(resizeTimerId);
      el.removeEventListener('transitionend', onTransitionEnd);
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
      console.log('[ROUTE_REQUEST]', {
        gps: { lat: loc.latitude, lon: loc.longitude, accuracy: loc.accuracy },
        destination: { lat: destination.latitude, lon: destination.longitude, name: destination.name },
        requestString: `${loc.longitude},${loc.latitude};${destination.longitude},${destination.latitude}`,
      });
      fetchRoute(loc.latitude, loc.longitude, destination.latitude, destination.longitude);
      setIsPreview(true);
    } else if (!isNavigating) {
      lastFetchedRef.current = null;
      lastAppliedRef.current = null; // dedup sıfırla — aynı rota tekrar çizilsin
      setIsPreview(false);
      setRouteReady(false);
      if (mapRef.current) clearRouteGeometry(mapRef.current);
      clearRoute();
      routeGeometryRef.current = null;
      routeAltRef.current      = [];
    }
  }, [isNavigating, destination, location]);

  // ROUTING → PREVIEW_READY veya ERROR: rota tamamlanınca sonuca göre geç
  useEffect(() => {
    if (!route.loading && navStatus === NavStatus.ROUTING) {
      const failed = route.error && !route.geometry; // error + no geometry = true failure
      if (failed) {
        setNavStatus(NavStatus.ERROR, 'Rota oluşturulamadı');
      } else if (!route.loading) {
        setNavStatus(NavStatus.PREVIEW);
      }
    }
  }, [route.loading, navStatus, route.error, route.geometry]);

  // PREVIEW/ROUTING → ACTIVE: isPreview kapat
  useEffect(() => {
    if (navStatus === NavStatus.ACTIVE || navStatus === NavStatus.REROUTING) {
      setIsPreview(false);
    }
  }, [navStatus]);

  // PREVIEW: rota hazır → haritayı takip moduna al (kullanıcı sürüklemiş olsa bile)
  useEffect(() => {
    if (navStatus !== NavStatus.PREVIEW) return;
    isFollowingRef.current = true;
    setIsFollowing(true);
    lastDrivingPosRef.current = null; // throttle sıfırla → hemen setDrivingView çalışır
  }, [navStatus]);

  // ACTIVE/REROUTING: sürüş modunu garantile + haritayı 3D nav görünümüne al
  // handleNavStart bunu zaten çağırır; bu effect rerouting & edge case'leri kapatır
  useEffect(() => {
    if (navStatus !== NavStatus.ACTIVE && navStatus !== NavStatus.REROUTING) return;
    setDrivingMode(true);
    isFollowingRef.current = true;
    setIsFollowing(true);
    const loc  = locationRef.current;
    const bear = headingRef.current ?? 0;
    const h    = containerRef.current?.offsetHeight ?? 600;
    if (mapRef.current && loc) {
      enterNavigationView(mapRef.current, loc.latitude, loc.longitude, bear, h);
    }
  }, [navStatus]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!route.geometry) return;
    // Ref'leri mapStatus'ten bağımsız her zaman güncelle.
    // _onStyleReady ve webglcontextrestored callback'leri bu ref'lerden okur;
    // harita LOADING iken gelen yeni geometri kaybolmamalı.
    routeGeometryRef.current = route.geometry;
    routeAltRef.current      = route.alternatives;
    routeAltIdxRef.current   = route.altRealIndices;
    routeAltDursRef.current  = route.altDurations;
    routeMainDurRef.current  = route.totalDurationSeconds;

    if (!mapRef.current || mapStatus !== 'READY') return;
    if (styleChangingRef.current) return; // style reload in-flight — wait for notifyStyleChange(false)
    const hash = _routeHash(route.geometry);
    const last = lastAppliedRef.current;
    const styleKeyChanged = !last || last.styleKey !== styleKey;
    if (!styleKeyChanged && last && last.hash === hash && last.navStatus === navStatus) return;
    lastAppliedRef.current = { hash, styleKey, navStatus };
    setRouteGeometry(mapRef.current, route.geometry, route.alternatives, route.altRealIndices, route.altDurations, route.totalDurationSeconds);
    pushDebug('ROUTE_GEOMETRY_SET', { pts: route.geometry?.length, first: route.geometry?.[0] });
  }, [route.geometry, route.alternatives, route.altRealIndices, mapStatus, styleKey, navStatus]);

  // Failsafe Deadlock Recovery — SEL_LAYER 3 saniye boyunca kayıpsa rota yeniden inşa edilir.
  // Senaryo: Android low-memory → layer silindi ama style READY → setRouteGeometry hiç tetiklenmedi.
  useEffect(() => {
    if (!isNavigating || mapStatus !== 'READY') return;
    let missingStart: number | null = null;
    const t = setInterval(() => {
      const map = mapRef.current;
      if (!map || !mountedRef.current || styleChangingRef.current || !map.isStyleLoaded()) {
        missingStart = null;
        return;
      }
      if (map.getLayer('selected-route-layer')) {
        missingStart = null;
        return;
      }
      if (missingStart === null) {
        missingStart = performance.now();
        return;
      }
      if (performance.now() - missingStart >= 3000) {
        missingStart = null;
        const geom = routeGeometryRef.current ?? getRouteState().geometry;
        if (geom) {
          setRouteGeometry(map, geom, routeAltRef.current, routeAltIdxRef.current, routeAltDursRef.current, routeMainDurRef.current);
          lastAppliedRef.current = null;
        }
      }
    }, 1000);
    return () => clearInterval(t);
  }, [isNavigating, mapStatus]);

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
    // Navigasyon sırasında style switch atla — setStyle() tüm rota katmanlarını siler
    // ve rota geçici olarak kayboluyor. tileRender geçişi (raster↔vector) yalnızca
    // IDLE modda anlamlıdır; navigasyon tile'ları OSM raster üzerinden zaten akar.
    if (navStatusRef.current !== NavStatus.IDLE) return;
    // Raster switch (nav start): no fade, no delay — immediate for safety.
    // Vector switch (idle): soft fade-in from dark background.
    const instant = tileRender === 'raster';
    _doStyleSwitch(mapRef.current, !instant);
  }, [tileRender]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigation + AR state → notify auto-switch engine + apply focus mode
  useEffect(() => {
    const arActive = arState === 'active' || arState === 'degraded';
    notifyNavigationRender(isNavigating, arActive);
    // Focus mode: yardımcı yol katmanlarını navigasyon aktifken soldur
    if (mapRef.current && mapRef.current.isStyleLoaded()) {
      setNavigationFocusMode(mapRef.current, isNavigating);
    }
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
    (window as any).__MAP_MUTEX__ = true;
    setMapStyleChanging(true);
    notifyStyleChange(true);

    try { map.resize(); } catch { /* container may be transitioning */ }
    setMapStatus('LOADING');
    switchMapStyle(map, getMapStyle());

    let _styleSwitchFired = false;
    const _onStyleReady = () => {
      if (_styleSwitchFired) return;
      _styleSwitchFired = true;
      clearTimeout(_styleSwitchTimeout);

      try { map.resize(); } catch { /* container transitioning */ }
      styleChangingRef.current = false;
      (window as any).__MAP_MUTEX__ = false;
      setMapStyleChanging(false);
      notifyStyleChange(false);
      if (!mountedRef.current) return;

      setMapStatus('READY');

      const loc = locationRef.current;
      const hdg = headingRef.current;
      if (loc) {
        addUserMarker(map, loc.latitude, loc.longitude, hdg || 0);
        if (drivingModeRef.current) {
          const h = containerRef.current?.offsetHeight ?? 600;
          lastDrivingPosRef.current = null;
          enterNavigationView(map, loc.latitude, loc.longitude, hdg || 0, h);
        } else {
          setMapCenter(map, [loc.longitude, loc.latitude], 15, false);
        }
        map._fullMapInitialized = true;
      }
      // Ref boşsa bile store'daki geometriyi yedek olarak kullan.
      // fetchRoute, style değişimi sırasında store'a yazmış olabilir ama
      // routeGeometryRef henüz güncellenmemiş olabilir (effect tetiklenmedi).
      const _storeGeom = getRouteState().geometry;
      const _geomToRender = routeGeometryRef.current ?? _storeGeom;
      if (_geomToRender && map.isStyleLoaded()) {
        setRouteGeometry(map, _geomToRender, routeAltRef.current, routeAltIdxRef.current, routeAltDursRef.current, routeMainDurRef.current);
      }
      // Style switch sonrası focus mode'u yeniden uygula (setStyle tüm paint'leri sıfırlar)
      reapplyNavigationFocus(map);
      setStyleKey((k) => k + 1);
      if (withFadeOverlay) {
        setTimeout(() => { if (mountedRef.current) setIsSwitchingStyle(false); }, 150);
      }
    };

    // 2.5s fallback — style.load bazen Android WebView'da gelmez
    const _styleSwitchTimeout = setTimeout(_onStyleReady, 2_500);
    map.once('style.load', _onStyleReady);
  }

  // Location updates — buffer data for 60fps interpolation
  useEffect(() => {
    if (!location || !mapStyleReady) return;

    const newPoint: NavPoint = {
      lat: location.latitude,
      lng: location.longitude,
      heading: heading || 0,
      ts: performance.now(),
    };

    const buffer = navPointsRef.current;
    buffer.push(newPoint);
    if (buffer.length > 2) buffer.shift();

    // Rota ilerlemesini gerçek GPS tick'inde güncelle (mantık ve OSRM verisi için)
    if (destination) {
      updateNavigationProgress(location.latitude, location.longitude, heading || 0, routeGeometryRef.current ?? undefined);
      updateRouteProgress(location.latitude, location.longitude);
    }

    // Hız bazlı katman gizleme + POI proximity glow — queryRenderedFeatures pahalı, 2s throttle
    const nowMs = performance.now();
    if (mapRef.current && nowMs - lastDrivingLayersMs.current > 2_000) {
      lastDrivingLayersMs.current = nowMs;
      const spd = (location.speed ?? 0) * 3.6;
      updateDrivingLayers(mapRef.current, spd, location.latitude, location.longitude);
    }

    // Map Mood — tehlike riskine göre görsel karakter değişimi (Phase H3)
    // updateMapMood kendi 200ms iç kısıtlamasını yönetir; GPS tick sıklığında çağrılabilir.
    if (mapRef.current) {
      const { globalRiskScore } = useHazardStore.getState();
      updateMapMood(mapRef.current, globalRiskScore);
    }
  }, [location, heading, destination, mapStyleReady]);

  const handleNavStart  = useCallback(() => {
    activateNavigation();
    setDrivingMode(true);
    isFollowingRef.current = true;
    setIsFollowing(true);
    const loc  = locationRef.current;
    const bear = headingRef.current ?? 0;
    const h    = containerRef.current?.offsetHeight ?? 600;
    if (mapRef.current && loc) {
      enterNavigationView(mapRef.current, loc.latitude, loc.longitude, bear, h);
    }
  }, []);
  const handleNavCancel = useCallback(() => {
    stopNavigation();
    setIsPreview(false);
    setDrivingMode(false);
    setRouteReady(false);
    lastAppliedRef.current = null; // dedup sıfırla
    if (mapRef.current) {
      clearRouteGeometry(mapRef.current);
      exitDrivingView(mapRef.current);
    }
    clearRoute();
    routeGeometryRef.current = null;
    routeAltRef.current      = [];
    routeAltIdxRef.current   = [];
  }, []);

  const handleZoomIn = () => mapRef.current?.zoomIn();
  const handleZoomOut = () => mapRef.current?.zoomOut();

  const handleRecenter = useCallback(() => {
    if (autoFollowTimerRef.current) { clearTimeout(autoFollowTimerRef.current); autoFollowTimerRef.current = null; }
    isFollowingRef.current = true;
    setIsFollowing(true);
    if (mapRef.current && location) {
      if (drivingMode) {
        const bear = headingRef.current ?? 0;
        const h = containerRef.current?.offsetHeight ?? 600;
        enterNavigationView(mapRef.current, location.latitude, location.longitude, bear, h);
      } else {
        setMapCenter(mapRef.current, [location.longitude, location.latitude], 15, true);
      }
    }
  }, [location, drivingMode]);

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

      {/* Cinematic vignette — HUD haritaya bağlanır, "UI overlay" hissi gider (Faz 3.3)
           Bottom: navigasyon çubuğunun altındaki karanlık geçiş
           Top: üst kontrollerin oturması için hafif çerçeve */}
      <div
        className="absolute bottom-0 left-0 right-0 pointer-events-none z-[35]"
        style={{ height: '28%', background: 'linear-gradient(to top, rgba(6,9,15,0.68) 0%, transparent 100%)' }}
      />
      <div
        className="absolute top-0 left-0 right-0 pointer-events-none z-[35]"
        style={{ height: '11%', background: 'linear-gradient(to bottom, rgba(6,9,15,0.42) 0%, transparent 100%)' }}
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

      {/* ── Cadde Adı Barı — Mercedes-Benz tarzı, navigasyon aktifken ── */}
      {isNavigating && (() => {
        const street = route.steps[route.currentStepIndex]?.streetName;
        return street ? (
          <div
            className="absolute z-20 pointer-events-none"
            style={{ bottom: 'calc(var(--nav-bar-h, 72px) + 8px)', left: '50%', transform: 'translateX(-50%)' }}
          >
            <div
              className="futurist-glass px-5 py-2 rounded-2xl flex items-center gap-2"
              style={{ border: '1px solid rgba(255,255,255,0.12)', minWidth: 160, maxWidth: 320 }}
            >
              <span className="text-white font-black text-sm tracking-wide truncate">{street}</span>
            </div>
          </div>
        ) : null;
      })()}

      {/* GPS Kayıp Uyarısı — 30s GPS yok + OBD hız 0 */}
      {gpsLostWarn && isNavigating && (
        <div
          className="absolute z-[9998] pointer-events-none"
          style={{ top: 'calc(var(--sat, 0px) + 70px)', left: '50%', transform: 'translateX(-50%)' }}
        >
          <div className="flex items-center gap-2 px-4 py-2 rounded-2xl"
            style={{ background: 'rgba(239,68,68,0.18)', border: '1.5px solid rgba(239,68,68,0.45)', backdropFilter: 'blur(12px)' }}>
            <span className="text-red-400 text-xs font-black uppercase tracking-widest">⚠ Konum Kayboldu — GPS Sinyali Yok</span>
          </div>
        </div>
      )}

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

      {/* ── HUD Kontroller — butonlar, zoom, katman seçici ── */}
      <MapHudControls
        isNavigating={isNavigating}
        isPreview={isPreview}
        isFollowing={isFollowing}
        ctrlVisible={ctrlVisible}
        drivingMode={drivingMode}
        cameraOn={cameraOn}
        mode={mode}
        heading={heading}
        location={location}
        onClose={onClose}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onRecenter={handleRecenter}
        onToggleDrivingMode={handleToggleDrivingMode}
        onCameraToggle={handleCameraToggle}
        onSetMapMode={setMapMode}
        showControls={showControls}
      />

    </div>
  );
});


