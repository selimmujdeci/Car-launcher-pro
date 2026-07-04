import { useEffect, useRef, useState, useCallback, memo, lazy, Suspense } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

type MapRef = MapLibreMap & { _fullMapInitialized?: boolean };
import { X, Map, Globe, ArrowLeft } from 'lucide-react';
import {
  interpolateNavPoint, projectDeadReckon, resolveDrSpeed, type NavPoint
} from '../../utils/interpolation';
import { bearingBetween } from '../../platform/cameraEngine';
import { logInfo } from '../../platform/debug';
import {
  initializeMap,
  destroyMap,
  isWebGLAvailable,
  setMapCenter,
  addUserMarker,
  updateUserMarker,
  applyMapDayNight,
  setMarkerNavActive,
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
  trimRouteGeometry,
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
import { useGPSSource, onGPSLocation, type GPSLocation } from '../../platform/gpsService';
import { enterMapLiteInteraction, exitMapLiteInteraction } from '../../platform/map/mapLiteMode';
import { pauseWakeWordForInteraction, resumeWakeWordAfterInteraction } from '../../platform/wakeWordService';
import { useThermalState } from '../../platform/thermalWatchdog';
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
  getRouteProgressPoint,
  setNavStatus, NavStatus, activateNavigation, stopNavigation, startNavigation,
  getNavigationState,
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
import { useStore } from '../../store/useStore';
import { showToast } from '../../platform/errorBus';
import { MapOverlay } from './MapOverlay';
import { NavigationHUD } from './NavigationHUD';
import { MapHudControls } from './MapHudControls';
import { MapSearchBar } from './MapSearchBar';
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
  const tryInitRef    = useRef<(() => void) | null>(null);
  const cleanupRef    = useRef<(() => void) | null>(null);
  const modeInitRef   = useRef(false);
  const navStatusRef  = useRef<string>(NavStatus.IDLE); // FPS loop içinden okunur
  const locationRef        = useRef<GPSLocation | null>(null);
  const headingRef         = useRef<number | null>(null);
  const lastDrivingPosRef  = useRef<{ lat: number; lng: number; heading: number } | null>(null);
  const navPointsRef       = useRef<NavPoint[]>([]);
  // SAHA 2026-07-04: Doppler=0 saplanan cihazda yer-değiştirme tabanlı wake çapası
  const wakeAnchorRef      = useRef<{ lat: number; lng: number; ts: number } | null>(null);
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
  // TEMP DEBUG — rota katmanı haritada gerçekten var mı (teşhis rozeti için, sonra kaldırılacak)
  const [isFollowing, setIsFollowing] = useState(true);
  const isFollowingRef  = useRef(true);
  const autoFollowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drivingModeRef  = useRef(false);
  const routeGeometryRef  = useRef<[number, number][] | null>(null);
  // Kat edilen rota kırpma durumu — yalnız segment index / geometri değişince setData
  const lastTrimSegRef    = useRef(-1);
  const lastTrimGeomRef   = useRef<[number, number][] | null>(null);
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

  // GPS artık FullMapView'i her fix'te RE-RENDER ETMEZ (termal/CPU tasarrufu).
  // Gerçek-zamanlı yol: onGPSLocation aboneliği locationRef/headingRef'e yazar,
  // rAF döngüsü bunları tam hızda okur. Aşağıdaki düşük frekanslı (≤1Hz) render
  // state'i yalnızca overlay'leri (MapOverlay, GPS rozeti, HUD prop'ları) tazeler —
  // NavigationHUD zaten store'a kendi abone olduğundan tam hızda kalır.
  const [gpsView, setGpsView] = useState<{ location: GPSLocation | null; heading: number | null }>({ location: null, heading: null });
  const location  = gpsView.location;
  const heading   = gpsView.heading;
  const gpsSource = useGPSSource();
  const { isNavigating, destination, status: navStatus, distanceMeters: navDistMeters } = useNavigation();
  const route = useRouteState();
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

  // Harita paleti gün/gece — UI'ın geri kalanıyla (light-ui / minimap) AYNI sinyali kullanır:
  // settings.dayNightMode (saat 07–19 gündüz). autoBrightness.phase güneş-saati hesabı konum
  // gerektirir ve 'evening'/'dawn'ı da gece sayar → gündüzde bile koyu kalabiliyordu.
  // Canvas CSS filtresi de DAHİL tüm gün/gece kararı bu TEK sinyalden gelir.
  const mapNight = useStore((s) => s.settings.dayNightMode) === 'night';

  const isValidGPS = !!(location && Number.isFinite(location.accuracy) && location.accuracy < 1000);

  // ── Dead Reckoning refs — rAF loop içinde kullanılır, React state tetiklemez ──
  const obdSpeedRef     = useRef(0);           // OBD hız (km/h) — DR fallback için
  const gpsLostTsRef    = useRef<number | null>(null); // GPS kayıp zamanı
  const lastFixTsRef    = useRef<number | null>(null); // son geçerli GPS fix zamanı (performance.now) — staleness için
  const drWarnTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gpsLostWarn, setGpsLostWarn] = useState(false);
  const gpsLostWarnRef  = useRef(false); // stale closure'dan kaçınmak için

  const obdState = useOBDState();
  // Termal seviye — rAF FPS gate için ref'e yansıtılır (hook re-render'ı nadir: seviye değişiminde)
  const { level: thermalLevel } = useThermalState();

  // rAF/subscription içinden okunan ref'ler (re-render tetiklemezler)
  const destinationRef   = useRef<typeof destination>(destination);
  const thermalLevelRef  = useRef(0);
  const mapStyleReadyRef = useRef(false);

  // ── Ref syncs — re-render tetikleyen state'leri rAF/subscription için ref'e yansıt ──
  // NOT: location/heading BURADA YOK — onGPSLocation aboneliği bunları doğrudan
  // locationRef/headingRef'e yazar; böylece GPS tick'i bu effect'i tetiklemez.
  useEffect(() => {
    navStatusRef.current    = navStatus;
    drivingModeRef.current  = drivingMode;
    obdSpeedRef.current     = obdState.speed ?? 0;
    gpsLostWarnRef.current  = gpsLostWarn;
    destinationRef.current  = destination;
    thermalLevelRef.current = thermalLevel;

    // Wake tetikleyicisi: navStatus veya drivingMode değişince döngüyü uyandır.
    // Navigasyon başlarken / sürüş modu açılırken döngünün uyuyor olması kabul edilemez.
    const navActive =
      navStatus === NavStatus.ACTIVE   ||
      navStatus === NavStatus.REROUTING ||
      navStatus === NavStatus.PREVIEW   ||
      navStatus === NavStatus.ROUTING;
    if (navActive || drivingMode) {
      wakeLoopRef.current?.();
    }
  }, [navStatus, drivingMode, obdState.speed, gpsLostWarn, destination, thermalLevel]);

  const [mapStatus, setMapStatus]     = useState<'IDLE' | 'LOADING' | 'READY' | 'ERROR'>('IDLE');
  const [mapError, setMapError]       = useState<string | null>(null);
  const [styleKey, setStyleKey]       = useState(0);
  const mapStyleReady = mapStatus === 'READY';
  useEffect(() => { mapStyleReadyRef.current = mapStatus === 'READY'; }, [mapStatus]);

  // ── Harita + Rover marker — gündüz/gece teması ──────────────────────────
  // applyMapDayNight: marker variantı + raster harita paletini (gündüz doğal açık /
  // gece grafit) RESTYLE OLMADAN canlı günceller (rota katmanları korunur) + night
  // state'i set eder (sonraki stil inşası doğru palet). mapStatus deps: harita READY
  // olunca da çalışır → ilk yüklemede gündüzse açık harita garanti.
  //
  // Vektör istisnası: koyu vektör stil ('omv' source) canlı patch'lenemez (raster
  // 'tiles-layer' yok). Gündüze geçişte IDLE'da tam restyle → getMapStyle gündüz
  // raster fallback döner. navStatus deps: navigasyon bittiğinde de yeniden denenir
  // (nav sırasında setStyle rota katmanlarını sileceğinden ertelenir).
  useEffect(() => {
    applyMapDayNight(mapNight, mapRef.current ?? undefined);
    const map = mapRef.current;
    if (
      map && !mapNight &&
      navStatus === NavStatus.IDLE &&
      !styleChangingRef.current &&
      map.isStyleLoaded() &&
      !!map.getSource('omv')
    ) {
      _doStyleSwitch(map, false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapNight, mapStatus, navStatus]);

  // ── CarOS Rover marker — navigasyon aktifliği (alt halka genişler + glow güçlenir) ──
  useEffect(() => {
    setMarkerNavActive(navStatus === NavStatus.ACTIVE || navStatus === NavStatus.REROUTING);
  }, [navStatus]);

  // ── GPS aboneliği — store değişimini re-render YERİNE ref'e yazar ────────────
  // onGPSLocation her gerçek konum değişiminde tetiklenir (UnifiedVehicleStore'daki
  // shallow-equal guard sayesinde standstill'de tetiklenmez). Mount-once; içeride
  // okunan her şey stable ref/setter olduğundan stale-closure riski yoktur.
  useEffect(() => {
    let lastViewCommit = 0;
    const VIEW_COMMIT_MS = 1000; // overlay tazeleme tavanı — 1Hz (GPS native rate ~1-2Hz ile uyumlu)

    const unsub = onGPSLocation((loc) => {
      if (!mountedRef.current) return;

      // 1) Gerçek-zamanlı yol — ref'ler (rAF döngüsü bunları tam hızda okur)
      locationRef.current = loc;
      headingRef.current  = loc?.heading ?? null;
      // Son geçerli fix zamanı — staleness (gpsOk yaş kontrolü) için. rAF tick ile aynı
      // time origin (performance.now / rAF timestamp) → monotonik, clock-jump güvenli.
      // mapStyleReadyRef koşuluna bağlanmaz: map READY olmasa da yaş doğru izlenmeli.
      if (loc) lastFixTsRef.current = performance.now();

      // 2) Navigasyon buffer beslemesi — eski "Location updates" effect'i buraya taşındı.
      //    rAF interpolasyonu navPointsRef'i tüketir; bu nedenle GPS tick'inde dolmalı.
      if (loc && mapStyleReadyRef.current) {
        const newPoint: NavPoint = {
          lat: loc.latitude,
          lng: loc.longitude,
          heading: loc.heading ?? 0,
          ts: performance.now(),
        };
        const buffer = navPointsRef.current;
        buffer.push(newPoint);
        if (buffer.length > 2) buffer.shift();

        // Wake: yeni GPS pozisyonu hareket taşıyorsa döngüyü uyandır.
        // 1.5 km/h eşiği: durağan GPS titremesi (gürültü) döngüyü sürekli açmasın.
        // SAHA FIX (2026-07-04): bazı cihazlar hareket halinde coords.speed=0
        // bildirir → yalnız hıza bakan wake HİÇ tetiklenmiyor, takip ölüyordu.
        // Yer değiştirme HIZI da hareket sayılır: ≥1.2s zaman penceresi üstünden
        // km/h (fix kadansından bağımsız); ≥3m mutlak taban jitter'ı eler.
        const speedKmh = (loc.speed ?? 0) * 3.6;
        const _anchor = wakeAnchorRef.current;
        if (!_anchor) {
          wakeAnchorRef.current = { lat: newPoint.lat, lng: newPoint.lng, ts: newPoint.ts };
        } else {
          const _dtS = (newPoint.ts - _anchor.ts) / 1000;
          if (_dtS >= 1.2) {
            const _movedM = Math.hypot(
              (newPoint.lat - _anchor.lat) * 111_320,
              (newPoint.lng - _anchor.lng) * 111_320 * Math.cos((newPoint.lat * Math.PI) / 180),
            );
            if (_movedM >= 3 && (_movedM / _dtS) * 3.6 >= 5) wakeLoopRef.current?.();
            wakeAnchorRef.current = { lat: newPoint.lat, lng: newPoint.lng, ts: newPoint.ts };
          }
        }
        if (speedKmh >= 1.5) wakeLoopRef.current?.();

        // Hız bazlı katman gizleme + POI proximity — queryRenderedFeatures pahalı, 2s throttle
        const nowMs = performance.now();
        if (mapRef.current && nowMs - lastDrivingLayersMs.current > 2_000) {
          lastDrivingLayersMs.current = nowMs;
          const spd = (loc.speed ?? 0) * 3.6;
          updateDrivingLayers(mapRef.current, spd, loc.latitude, loc.longitude);
        }

        // Map Mood — tehlike riskine göre görsel karakter (updateMapMood kendi 200ms iç throttle'ı var)
        if (mapRef.current) {
          const { globalRiskScore } = useHazardStore.getState();
          updateMapMood(mapRef.current, globalRiskScore);
        }
      }

      // 2b) Rota ilerlemesi — HARİTA STİLİNDEN BAĞIMSIZ (saha fix 2026-06-12).
      //     Eskiden mapStyleReadyRef kapısının İÇİNDEYDİ: stil bayrağı takılırsa
      //     adım sayacı/mesafe/ses/kırpma topluca donuyordu (GPS rozeti canlıyken).
      //     İlerleme hesabı haritaya ihtiyaç duymaz — her geçerli fix'te çalışır.
      if (loc && destinationRef.current) {
        const _navStatusNow = getNavigationState().status;
        if (_navStatusNow === NavStatus.ACTIVE || _navStatusNow === NavStatus.REROUTING) {
          updateRouteProgress(loc.latitude, loc.longitude);
          updateNavigationProgress(loc.latitude, loc.longitude, loc.heading ?? 0, routeGeometryRef.current ?? undefined);

          // Kat edilen rotayı kırp: snapped noktadan İLERİYE kalan geometri çizilir.
          // Yalnız segment index veya geometri (reroute) değişince setData — Mali-400 dostu.
          const _prog = getRouteProgressPoint();
          const _geom = routeGeometryRef.current;
          if (_prog && _geom && _geom.length >= 2 && mapRef.current &&
              (_prog.segIdx !== lastTrimSegRef.current || _geom !== lastTrimGeomRef.current)) {
            lastTrimSegRef.current  = _prog.segIdx;
            lastTrimGeomRef.current = _geom;
            const _remaining: [number, number][] = [
              [_prog.lon, _prog.lat],
              ..._geom.slice(_prog.segIdx + 1),
            ];
            trimRouteGeometry(mapRef.current, _remaining);
          }
        }
      }

      // 3) Düşük frekanslı render commit — overlay prop'ları bayatlamasın.
      //    İlk fix'te (null veya throttle dolmuşsa) commit; aksi halde re-render yok.
      const commitNow = performance.now();
      if (loc === null || commitNow - lastViewCommit >= VIEW_COMMIT_MS) {
        lastViewCommit = commitNow;
        setGpsView({ location: loc, heading: loc?.heading ?? null });
      }
    });

    return unsub;
  }, []);

  // Testability: DOM attribute set — ana thread'den tahliye: kritik render yoluna girmiyor
  useEffect(() => {
    const el = outerDivRef.current;
    if (!el) return;
    const id = setTimeout(() => {
      if (!mountedRef.current) return;
      if (mapStatus === 'READY') el.setAttribute('data-map-ready', 'true');
      else el.removeAttribute('data-map-ready');
    }, 0);
    return () => clearTimeout(id);
  }, [mapStatus]);

  const pushDebug = (label: string, data: unknown) => {
    try { logInfo(`[NAV] ${label}:`, data); } catch { /* ignore */ }
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
  // rAF pump: setInterval yerine requestAnimationFrame zinciri — gizli sekmelerde durur,
  // GPU frame döngüsüyle senkronize çalışır. 200ms throttle Mali-400'ü zorlamaz.
  useEffect(() => {
    if (mapStatus !== 'LOADING') return;

    let running  = true;

    // 200ms'lik resize pump'u rAF yerine setInterval ile sürülür. İşin doğası zaman-
    // tabanlı (her 200ms bir resize); rAF kullanmak her render frame'inde gereksiz JS
    // context geçişi demekti ve LOADING fazı yavaş GPU'da 15s'ye kadar sürdüğünden tüm
    // o süre boyunca UI thread'e yük bindiriyordu (soğuk-açılış jank). setInterval bu
    // overhead'i ~75× azaltır (16ms frame yerine 200ms tick).
    const pumpId = setInterval(() => {
      if (!running) return;
      const container = containerRef.current;
      if (mapRef.current && container && container.offsetWidth > 0 && container.offsetHeight > 0) {
        try { mapRef.current.resize(); } catch { /* ignore */ }
      }
    }, 200);

    const t = setTimeout(() => {
      running = false;
      clearInterval(pumpId);
      if (mountedRef.current) {
        console.warn('[MAP] style.load timeout — forcing READY');
        if ((containerRef.current?.offsetWidth ?? 0) > 0) {
          try { mapRef.current?.resize(); } catch { /* ignore */ }
        }
        setMapStatus('READY');
        notifyStyleChange(false);
      }
    }, 15_000); // K250: yavaş GPU — 15s bekle

    return () => { running = false; clearInterval(pumpId); clearTimeout(t); };
  }, [mapStatus]);

  // Unmount guard — mount-once, sets false on cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // WebGL kalıcı context kaybı → mapService destroyMap() sonrası re-init
  useEffect(() => {
    const handler = () => {
      if (!mountedRef.current) return;
      console.warn('[MAP] re-init signal received — resetting init state');
      mapRef.current         = null;
      initializedRef.current = false;
      initDone.current       = false;
      setMapStatus('IDLE' as any);
      // ResizeObserver'ın tryInit'ini tetikle — yeni map init başlasın
      requestAnimationFrame(() => tryInitRef.current?.());
    };
    window.addEventListener('map:reinit-needed', handler);
    return () => window.removeEventListener('map:reinit-needed', handler);
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

  // ── Adaptive Performance — on-demand rAF döngüsü + hafif FPS örnekleyicisi ──────
  //
  // BOŞTA = {navStatus IDLE, drivingMode kapalı, hız < 1.5 km/h, takip kapalı,
  //          etkileşim yok, bekleyen GPS tamponu yok} koşullarının TAMAMI doğruysa.
  //
  // Boşta → rAF döngüsü uykuya girer (reschedule DURUR).
  // Wake tetikleyicileri: yeni GPS hareketi, navStatus değişimi, drivingMode açılması,
  // harita etkileşimi (drag/zoom/pitch/rotate), isFollowing açılması.
  //
  // FPS monitörü: 60fps sayımla değil, setInterval(1000ms) + kare zaman damgası ile
  // hafif örnekleyici — idle'da çalışmaz, sadece döngü aktifken tick sayar.
  //
  // Unmount: rAF + interval + tüm timer'lar temizlenir (Zero-Leak).
  const lastLowFPSRef = useRef(false);

  // wake() referansı — GPS aboneliği ve map event'leri buraya erişir.
  const wakeLoopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = outerDivRef.current;
    if (!el) return;

    let rafId:      number = 0;
    let loopActive  = false; // rAF döngüsü çalışıyor mu?
    let activeClass = '';

    // Idle hysteresis: son hareket/uyandırmadan bu kadar ms sonra tekrar idle sayılır.
    // Stop-and-go trafikte sürekli uyku/uyandırma flicker'ını önler.
    const IDLE_HYSTERESIS_MS = 2500;
    let lastWakeTs = performance.now(); // son wake zamanı

    const applyClass = (cls: string) => {
      if (cls === activeClass) return;
      if (activeClass) el.classList.remove(activeClass);
      if (cls)         el.classList.add(cls);
      activeClass = cls;
    };

    // ── Hafif FPS örnekleyicisi — setInterval(1000ms) bazlı ──────────────────
    // 60fps sayımla değil; döngü içinde tickCount artırılır, interval ölçer.
    // Döngü durduğunda interval da durur → idle'da CPU sıfır.
    let tickCount   = 0;          // aktif kare sayacı (döngü içinden artar)
    let isPerfLowCached = false;  // applyClass ile senkronize — DOM sorgusu önler
    let fpsIntervalId: ReturnType<typeof setInterval> | null = null;

    const startFpsMonitor = () => {
      if (fpsIntervalId !== null) return; // zaten çalışıyor
      fpsIntervalId = setInterval(() => {
        const fps = tickCount;
        tickCount  = 0;

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

        // Thermal lock — sadece geçiş anında tetiklenir
        const fpsIsLow = fps < 20;
        if (fpsIsLow !== lastLowFPSRef.current) {
          lastLowFPSRef.current = fpsIsLow;
          notifyLowFPS(fpsIsLow);
        }
      }, 1000);
    };

    const stopFpsMonitor = () => {
      if (fpsIntervalId === null) return;
      clearInterval(fpsIntervalId);
      fpsIntervalId = null;
      tickCount     = 0;
    };

    // ── Idle tespiti ────────────────────────────────────────────────────────
    // Tüm koşullar doğruysa döngü durabilir.
    const isIdleNow = (now: number): boolean => {
      // Hysteresis: son wake'den IDLE_HYSTERESIS_MS geçmediyse idle sayma
      if (now - lastWakeTs < IDLE_HYSTERESIS_MS) return false;

      const status = navStatusRef.current;
      const navActive =
        status === NavStatus.ACTIVE   ||
        status === NavStatus.REROUTING ||
        status === NavStatus.PREVIEW   ||
        status === NavStatus.ROUTING;
      if (navActive)                          return false;
      if (drivingModeRef.current)             return false;
      if (userInteractingRef.current)         return false;
      // NOT: isFollowing TEK BAŞINA idle'ı engellemez. Araç park halindeyken (hız<1.5,
      // nav yok) takip edilecek hareket olmadığından döngü uykuya geçebilir; GPS yeniden
      // hareket taşıdığında onGPSLocation→wake() döngüyü uyandırır. Eski davranışta
      // isFollowing başlangıçta true olduğundan döngü HİÇ idle'a giremiyor, park halinde
      // bile %100 jank üretiyordu (Slow UI thread). Hareket gözcüsü aşağıdaki hız kontrolü.

      // GPS tamponu hareket taşıyor mu?
      const buf = navPointsRef.current;
      if (buf.length >= 2) {
        const speedMs = locationRef.current?.speed ?? 0;
        const speedKmh = speedMs * 3.6;
        if (speedKmh >= 1.5) return false;   // araç hareket ediyor
        // SAHA FIX (2026-07-04): hız 0'a saplansa bile son iki fix arası gerçek
        // yer değiştirme HIZI hareket sayılır — takip döngüsü uyumaz (fail-soft).
        // Zaman-normalize: dt≥0.8s pencerede ≥5 km/h + ≥3m mutlak taban (jitter eler).
        // Daha sık fix'lerde bu kontrol atlanır — displacement-wake çapası (GPS
        // aboneliği) lastWakeTs'i zaten tazeleyip histerezisle döngüyü ayakta tutar.
        const a = buf[buf.length - 2];
        const b = buf[buf.length - 1];
        const dtS = (b.ts - a.ts) / 1000;
        if (dtS >= 0.8) {
          const movedM = Math.hypot(
            (b.lat - a.lat) * 111_320,
            (b.lng - a.lng) * 111_320 * Math.cos((b.lat * Math.PI) / 180),
          );
          if (movedM >= 3 && (movedM / dtS) * 3.6 >= 5) return false; // hız sinyalsiz gerçek hareket
        }
      }

      return true;
    };

    // ── Wake — döngüyü uyandır ───────────────────────────────────────────────
    const wake = () => {
      lastWakeTs = performance.now();
      if (loopActive) return; // zaten çalışıyor
      loopActive = true;
      startFpsMonitor();
      rafId = requestAnimationFrame(tick);
    };

    // Dış erişim için ref'e ata (GPS aboneliği ve map event'leri kullanır)
    wakeLoopRef.current = wake;

    let lastCameraUpdate    = 0;
    let lastMarkerUpdate    = 0;
    let lastThermalFrameTs  = 0; // termal FPS gate — son ağır-iş frame zamanı

    const tick = (now: number) => {
      // ── Idle kontrolü: boştaysa döngüyü durdur ───────────────────────────
      if (isIdleNow(now)) {
        loopActive = false;
        stopFpsMonitor();
        // perf sınıfını temizleme — son ölçüm geçerliliğini koru; yalnız CSS'i bırak.
        return; // rAF yeniden planlanmıyor → döngü uyudu
      }

      // Aktif kare sayacı (FPS örnekleyicisi için)
      tickCount++;

      // ── Termal FPS kısıtlaması ────────────────────────────────────────────
      // level>0 → hedef FPS = 30/level (L1≈30, L2≈15, L3≈10 fps).
      let _doHeavy = true;
      const _tl = thermalLevelRef.current;
      if (_tl > 0) {
        const _minFrameMs = 1000 / (30 / _tl);
        if (now - lastThermalFrameTs >= _minFrameMs) {
          lastThermalFrameTs = now;
        } else {
          _doHeavy = false;
        }
      }

      if (_doHeavy) {
      // ── Dead Reckoning — GPS koptuysa OBD hız + son heading ile konum hesapla ──
      // GPS geçersizse (aktif rota olmasa da) son bilinen noktadan ileri projeksiyon yap
      // Staleness: son fix 5sn'den eskiyse (örn. tünelde sinyal kesildi, locationRef
      // son iyi fix'te DONDU) GPS bayat sayılır → DR devreye girer. Yaş, fix kaydı ile
      // aynı time origin'den (performance.now ≡ rAF `now`) hesaplanır → clock-jump güvenli.
      const GPS_STALE_MS = 5000;
      const fixFresh = lastFixTsRef.current !== null && (now - lastFixTsRef.current) <= GPS_STALE_MS;
      const gpsOk = !!(fixFresh && locationRef.current && Number.isFinite(locationRef.current.accuracy) && locationRef.current.accuracy < 1000);

      if (!gpsOk && navPointsRef.current.length > 0) {
        const lastKnown = navPointsRef.current[navPointsRef.current.length - 1];
        // OBD hızı varsa onu tercih et; yok/0 ise son geçerli GPS hızına (m/s→km/h) düş
        const obdKmh    = resolveDrSpeed(obdSpeedRef.current, locationRef.current?.speed ?? null);

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

        // KÖK NEDEN FIX (2026-07-04): kare-başı isStyleLoaded() kapısı kaldırıldı —
        // tile yüklenirken/setData sonrası false döner, DR kamera takibini yutuyordu.
        if (!userInteractingRef.current && mapRef.current && (now - lastCameraUpdate > drInterval)) {
          // Dead Reckoning: s = v × t, kartezyen tahmini (saf matematik utils'te)
          const { lat: drLat, lng: drLng } = projectDeadReckon(lastKnown, obdKmh, now);

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

      // ── Nav kamera watchdog (saha fix 2026-06-12) ─────────────────────────
      // ACTIVE navigasyonda kamera 8 sn'dir HİÇ güncellenmediyse takılı bayraklar
      // (follow=false asılı kalması / interacting'in temizlenmemesi) kendiliğinden
      // toparlanır — "harita sabit, araç ekrandan çıkıyor" sürücü müdahalesiz düzelir.
      const _navActiveWd = navStatusRef.current === NavStatus.ACTIVE ||
                           navStatusRef.current === NavStatus.REROUTING;
      if (_navActiveWd && now - lastCameraUpdate > 8_000) {
        userInteractingRef.current = false;
        if (!isFollowingRef.current) { isFollowingRef.current = true; setIsFollowing(true); }
        lastCameraUpdate = now - 1_000; // kamera yolu bir sonraki tick'te hemen çalışsın
      }

      // 1. Interpolation Mantığı — 60 FPS Araç Hareketi
      const buffer = navPointsRef.current;
      // KÖK NEDEN FIX (2026-07-04): isStyleLoaded() kapısı kaldırıldı — sürüşte
      // sürekli tile yüklendiğinden çoğu karede false dönüp TÜM takip yolunu
      // (marker + kamera + rotasyon) yutuyordu → "harita sabit, dönmüyor".
      // updateUserMarker self-healing'i ve setDrivingView içi katman işleri
      // kendi guard'larını taşır; kamera (jumpTo) stil gerektirmez.
      if (buffer.length >= 2 && mapRef.current) {
        const p1 = buffer[0];
        const p2 = buffer[1];
        const interpolated = interpolateNavPoint(p1, p2, now);
        interpolatedStateRef.current = interpolated;

        const { lat, lng, heading: bear } = interpolated;
        // GPS hız sıfırsa OBD fallback — speed-adaptive zoom/pitch için
        const gpsSpeedKmh = (locationRef.current?.speed ?? 0) * 3.6;
        const speedKmh    = gpsSpeedKmh > 0.5 ? gpsSpeedKmh : obdSpeedRef.current;
        // TAZE rota durumu — render-scope `route` mount-once rAF closure'ında BAYATTI:
        // steps hep ilk render'daki boş dizi kalıyor, turnDist hiç geçmiyordu (dönüş
        // yaklaşım zoom'u + turn anticipation hiç devreye girmiyordu).
        const _rsTick  = getRouteState();
        const turnDist = _rsTick.steps.length ? _rsTick.distanceToNextTurnMeters : undefined;

        // A — Araç işaretçisi + Visual Snapping
        // ACTIVE: snap → rota yoluna kilitle, GPS zıplamalarını gizle
        // Kamera da snapped koordinatı kullanır → sürücü rota dışı görünmez
        const _snap = navStatusRef.current === NavStatus.ACTIVE
          ? getSnappedMarkerPosition()
          : null;
        const displayLat = _snap?.lat ?? lat;
        const displayLng = _snap?.lon ?? lng;

        // Marker: kullanıcı etkileşimi yoksa 100ms'de bir güncelle (10fps yeterli).
        // NOT: isSwitchingStyle state'i burada bilerek kontrol edilmez.
        // updateUserMarker kendi içinde isStyleLoaded() + self-healing yönetir;
        // isSwitchingStyle ile ekstra kilitleme, stil yüklendikten sonra da
        // marker'ı geciktirir (React state güncelleme gecikmesi).
        // Marker 60ms (~16fps): tek nokta source.setData ucuz → araç ekstrapole yol boyunca
        // daha akıcı kayar (önceki 100ms/10fps'te basamaklı/geride hissi). Kamera throttle'ı
        // (150ms, Mali-400 GPU) ayrı tutulur — marker hızı GPU'yu yük etmez.
        if (!userInteractingRef.current && now - lastMarkerUpdate > 60) {
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
      } else if (buffer.length === 1 && mapRef.current) {
        // Tek nokta varsa (başlangıç) doğrudan oraya git
        const p = buffer[0];
        updateUserMarker(p.lat, p.lng, p.heading, 0);
      }
      } // ── _doHeavy (termal FPS gate) sonu ──

      rafId = requestAnimationFrame(tick);
    };

    // İlk başlangıçta döngüyü çalıştır (harita mount olunca aktif olsun)
    wake();

    return () => {
      cancelAnimationFrame(rafId);
      stopFpsMonitor();
      loopActive = false;
      wakeLoopRef.current = null;
      applyClass('');
      lastLowFPSRef.current = false;
      notifyLowFPS(false);
      // DR uyarı timer'ı — rAF loop içinde oluşturuluyor, unmount'ta açık kalabilir
      if (drWarnTimerRef.current) { clearTimeout(drWarnTimerRef.current); drWarnTimerRef.current = null; }
      if (interactTimerRef.current) { clearTimeout(interactTimerRef.current); interactTimerRef.current = null; }
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
  // ctrlVisible timer: harita READY olmadan başlatılmasın — gereksiz timer yükü önlenir
  useEffect(() => {
    if (mapStatus !== 'READY') return;
    showControls();
    return () => { if (ctrlTimerRef.current) clearTimeout(ctrlTimerRef.current); };
  }, [mapStatus, showControls]);

  // Interaction guard — map READY olduktan sonra bağlanır (mount-time null sorunu çözüldü)
  const _onInteractStart = useCallback(() => {
    userInteractingRef.current = true;
    if (interactTimerRef.current) { clearTimeout(interactTimerRef.current); interactTimerRef.current = null; }
    // Wake: kullanıcı haritayla etkileşince döngüyü uyandır
    wakeLoopRef.current?.();
    // Map Lite Mode: zayıf GPU'da harekette dekoratif overlay'leri gizle (no-op normalde).
    enterMapLiteInteraction(mapRef.current);
    // Vosk: ağır etkileşim sırasında wake grammar thread'ini (~%22 CPU) duraklat.
    pauseWakeWordForInteraction();
  }, []);
  const _onInteractEnd = useCallback(() => {
    if (interactTimerRef.current) clearTimeout(interactTimerRef.current);
    interactTimerRef.current = setTimeout(() => { userInteractingRef.current = false; }, 120);
    // Etkileşim bitti → debounce'lu geri yükleme (overlay görünürlüğü + wake dinleme).
    exitMapLiteInteraction(mapRef.current);
    resumeWakeWordAfterInteraction();
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
  }, [isOnline]);  

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
        // Takip yeniden başladığında döngüyü uyandır
        wakeLoopRef.current?.();
        const loc  = locationRef.current;
        const bear = headingRef.current ?? 0;
        const h    = containerRef.current?.offsetHeight ?? 600;
        // enterNavigationView kamera-tek işlemdir; isStyleLoaded kapısı tile
        // yüklenirken auto-follow dönüşünü sessizce yutuyordu (KÖK NEDEN ailesi).
        if (mapRef.current && loc) {
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
      if (mapRef.current && loc) {
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

    const resizeRafId:    number | null = null;
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

    tryInitRef.current = tryInit;
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
        logInfo('[MAP_INIT_BLOCKED] already exists');
        setMapStatus('READY');
        return;
      }
      if (initializedRef.current) {
        logInfo('[MAP_INIT_BLOCKED] initializedRef');
        return;
      }
      initializedRef.current = true;
      initDone.current = true;
      setMapStatus('LOADING');
      let cancelled = false;
      logInfo('[MAP_INIT_START]');

      (async () => {
        try {
          const map = await initializeMap(container, { offline: true });
          if (cancelled) {
            // Component unmounted during init — destroy immediately
            try { map.remove(); } catch { /* ignore */ }
            return;
          }
          mapRef.current = map;
          logInfo('[MAP_INIT_DONE]');

          const markReady = () => { if (!cancelled) { logInfo('[MAP_READY]'); setMapStatus('READY'); } };

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
        logInfo('[MAP_DESTROY]');
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
      // Rota ÇİZİMİ (önizleme) için origin hassasiyeti kritik değil — şehirler arası
      // rotada birkaç km sapma önemsiz. Eski 1000m guard'ı, GPS soğuk başlangıçta /
      // son-bilinen konumda (yüksek accuracy) rotayı sessizce blokluyordu → "harita
      // açıldı rota yok". Artık yalnız HİÇ konum yoksa blokla (ve kullanıcıya bildir);
      // konum varsa kaba da olsa rotayı çiz, GPS düzeldikçe canlı nav hassaslaşır.
      if (!loc) {
        pushDebug('ROUTE_BLOCKED_NO_GPS', { accuracy: null });
        showToast({ type: 'warning', title: 'Rota çizilemedi', message: 'Konum bulunamadı — GPS sinyali bekleniyor.' });
        return;
      }
      if (loc.accuracy >= 1000) {
        pushDebug('ROUTE_LOWACC_GPS', { accuracy: loc.accuracy });
      }
      if (lastFetchedRef.current === destination.id) return;
      lastFetchedRef.current = destination.id;
      setNavStatus(NavStatus.ROUTING);
      setRouteReady(false);
      logInfo('[ROUTE_REQUEST]', {
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
        // H2: dedup'ı sıfırla — sonraki GPS tick'inde (ağ/GPS düzelince) otomatik yeniden dene.
        lastFetchedRef.current = null;
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
    if (!route.geometry) return;
    // Ref'leri mapStatus'ten bağımsız her zaman güncelle.
    // _onStyleReady ve webglcontextrestored callback'leri bu ref'lerden okur;
    // harita LOADING iken gelen yeni geometri kaybolmamalı.
    routeGeometryRef.current = route.geometry;
    routeAltRef.current      = route.alternatives;
    routeAltIdxRef.current   = route.altRealIndices;
    routeAltDursRef.current  = route.altDurations;
    routeMainDurRef.current  = route.totalDurationSeconds;

    // Ground-truth READY: mapStatus bayrağı bir style-switch'te false'ta TAKILABİLİR
    // (style.load kaçırılırsa). O durumda harita render olur (tile/marker/ETA çalışır) ama
    // rota çizimi hiç tetiklenmezdi → "çizgi hiçbir yerde yok". Bayrak takılıysa bile stil
    // gerçekten yüklüyse (isStyleLoaded) çizime devam et.
    if (!mapRef.current || (mapStatus !== 'READY' && !mapRef.current.isStyleLoaded())) return;
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
    // mapStatus gate'i KASTEN kaldırıldı: takılı bayrak failsafe'i de devre dışı bırakıyordu.
    // İçerideki map.isStyleLoaded() ground-truth kontrolü hazır olup olmadığını zaten yönetir.
    if (!isNavigating) return;
    let missingStart: number | null = null;
    const t = setInterval(() => {
      const map = mapRef.current;
      // Bekleme koşulu artık BAYRAĞA değil, ground-truth'a (isStyleLoaded) bakar.
      // styleChangingRef burada KASTEN yok sayılır: takılı bir bayrak rota çizimini
      // kalıcı bloke ediyorsa ("hiç çizilmiyor, beklesen de gelmiyor") deadlock'u burada kırarız.
      if (!map || !mountedRef.current || !map.isStyleLoaded()) {
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
      if (performance.now() - missingStart >= 1200) {
        missingStart = null;
        // Stil yüklü ama rota katmanı 1.2sn+ yok → çizimi bloke eden takılı/bayat
        // style-changing guard'larını (component ref + module _isStyleChanging) zorla temizle.
        // Stil zaten yüklü olduğundan setRouteGeometry güvenli — "source does not exist" riski yok.
        if (styleChangingRef.current) {
          styleChangingRef.current = false;
          (window as any).__MAP_MUTEX__ = false;
        }
        notifyStyleChange(false); // module _isStyleChanging=false → setRouteGeometry erken-return etmez
        const geom = routeGeometryRef.current ?? getRouteState().geometry;
        if (geom) {
          setRouteGeometry(map, geom, routeAltRef.current, routeAltIdxRef.current, routeAltDursRef.current, routeMainDurRef.current);
          lastAppliedRef.current = null;
        }
      }
    }, 400);
    return () => clearInterval(t);
  }, [isNavigating]);

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
  }, [mode]);  

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
  }, [tileRender]);  

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

  // NOT: Eski "Location updates" effect'i (60fps buffer beslemesi + rota ilerlemesi +
  // driving layers + map mood) yukarıdaki onGPSLocation aboneliğine taşındı.
  // Böylece GPS tick'i FullMapView'i re-render etmeden buffer'ı besler.

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
            <Globe className="w-8 h-8" style={{ color: 'rgba(224,162,60,0.6)' }} />
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
          // Dark-amber cockpit aesthetic — matches map.jsx OEM palette.
          // Night: deep brightness drop + amber sepia overlay via hue-rotate.
          // Day: full color preserved for outdoor sunlight readability.
          // mapNight (settings.dayNightMode) — harita stiliyle AYNI sinyal; eski
          // autoBrightness.phase sinyali gündüzde de filtre uygulayıp haritayı karartıyordu.
          filter: mapNight
            ? 'brightness(0.4) saturate(0.8) sepia(0.2) hue-rotate(-10deg)'
            : 'none',
          transition: 'opacity 500ms ease, filter 5s ease',
        }}
      />

      {/* Vignette — HUD geçişi için hafif gradyan (koyu değil, sadece kenar yumuşatma) */}
      <div
        className="absolute bottom-0 left-0 right-0 pointer-events-none z-[35]"
        style={{ height: '18%', background: 'linear-gradient(to top, rgba(6,9,15,0.38) 0%, transparent 100%)' }}
      />
      <div
        className="absolute top-0 left-0 right-0 pointer-events-none z-[35]"
        style={{ height: '8%', background: 'linear-gradient(to bottom, rgba(6,9,15,0.22) 0%, transparent 100%)' }}
      />

      {/* GPS konum durum göstergesi — sol üst köşe */}
      {mapStatus === 'READY' && (
        <div
          className="absolute pointer-events-none z-[36]"
          style={{ top: 'calc(var(--sat, 0px) + 14px)', left: 14 }}
        >
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl"
            style={{
              background: 'rgba(0,0,0,0.42)',
              backdropFilter: 'blur(8px)',
              border: isValidGPS
                ? '1px solid rgba(52,211,153,0.35)'
                : '1px solid rgba(251,191,36,0.35)',
            }}
          >
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{
                background: isValidGPS ? '#34d399' : '#fbbf24',
                boxShadow: isValidGPS
                  ? '0 0 6px rgba(52,211,153,0.7)'
                  : '0 0 6px rgba(251,191,36,0.7)',
                animation: 'pulse 2s ease-in-out infinite',
              }}
            />
            <span
              className="text-[9px] font-black uppercase tracking-widest"
              style={{ color: isValidGPS ? '#34d399' : '#fbbf24' }}
            >
              {isValidGPS ? 'GPS' : 'GPS Zayıf'}
            </span>
            {isValidGPS && location?.accuracy != null && (
              <span className="text-[8px] font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>
                ±{Math.round(location.accuracy)}m
              </span>
            )}
          </div>
        </div>
      )}

      {/* Adres/yer arama — üst orta. Yalnız boş haritada (IDLE); navigasyon/önizlemede
          gizlenir (rota paneliyle çakışmasın). Sonuçlarda km aynı kanonik kaynaktan. */}
      {mapStatus === 'READY' && (
        <MapSearchBar
          gpsLat={location?.latitude ?? null}
          gpsLon={location?.longitude ?? null}
          hidden={navStatus !== NavStatus.IDLE}
        />
      )}

      {/* KM Sayacı — sol üst, navigasyon aktifken kalan mesafeyi gösterir */}
      {isNavigating && mapStatus === 'READY' && (() => {
        const effectiveDist = (navDistMeters && navDistMeters > 10)
          ? navDistMeters
          : route.totalDistanceMeters;
        if (!effectiveDist || effectiveDist <= 0) return null;
        const distLabel = effectiveDist < 1000
          ? `${Math.round(effectiveDist / 10) * 10} m`
          : `${(effectiveDist / 1000).toFixed(1)} km`;
        return (
          <div
            className="absolute pointer-events-none z-[36]"
            style={{ top: 'calc(var(--sat, 0px) + 48px)', left: 14 }}
          >
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl"
              style={{
                background: 'rgba(0,0,0,0.50)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(224,162,60,0.35)',
              }}
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: '#E0A23C', boxShadow: '0 0 6px rgba(224,162,60,0.7)' }}
              />
              <span
                className="font-black uppercase tracking-widest"
                style={{ fontSize: 11, color: '#E8B86A' }}
              >
                {distLabel}
              </span>
            </div>
          </div>
        );
      })()}

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


