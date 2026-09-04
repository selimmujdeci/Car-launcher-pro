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
  setUserMarkerEstimated,
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
  setPaintedArrow,
  setMapStyleChanging,
  reapplyNavigationFocus,
  updateNavigationStyle,
  updateMapMood,
} from '../../platform/mapService';
import {
  shouldTrimRoute,
  nextTrimMark,
  EMPTY_TRIM_MARK,
  type RouteTrimMark,
} from '../../platform/map/routeTrimGate';
import { useHazardStore } from '../../store/useHazardStore';
import { useGPSSource, onGPSLocation, type GPSLocation, LOCATION_STALE_MS } from '../../platform/gpsService';
import { acquireCompassDemand } from '../../platform/gps/compassDemand';
import { enterMapLiteInteraction, exitMapLiteInteraction } from '../../platform/map/mapLiteMode';
import { pauseWakeWordForInteraction, resumeWakeWordAfterInteraction } from '../../platform/wakeWordService';
import { useThermalState } from '../../platform/thermalWatchdog';
import {
  setMapMode,
  useMapMode,
  useTileRenderMode,
  notifyLowFPS,
  useMapNetworkStatus,
  getMapStyle,
  getMapNight,
} from '../../platform/mapSourceManager';
import { buildPaintedArrow } from '../../platform/map/core/paintedArrowModel';
import { useVisionStore } from '../../platform/visionStore';
import {
  CameraFollowState,
  canDriveCamera,
  getCameraFollowState,
  subscribeCameraFollow,
  setCameraNavActive,
  notifyUserPanStart,
  notifyUserPanEnd,
  beginRecenter,
  completeRecenter,
  noteFollowZoom,
  resetCameraFollow,
  type RecenterReason,
} from '../../platform/navigation/cameraFollowAuthority';
import {
  useNavigation, getSnappedMarkerPosition, getSnappedRoadBearing,
  getRouteProgressPoint,
  setNavStatus, NavStatus, activateNavigation,
  getNavigationState, claimRouteRequest, releaseRouteRequest, endNavigation,
} from '../../platform/navigationService';
import {
  fetchRoute,
  useRouteState,
  getRouteState,
  clearRoute,
  notifyStyleChange,
  registerNavigationStyleCallback,
  type RouteStep,
} from '../../platform/routingService';
import { resolveRouteForwardBearing } from '../../platform/navigation/core/navigationEntryBearing';
import { useStore } from '../../store/useStore';
import { showToast } from '../../platform/errorBus';
import { MapOverlay } from './MapOverlay';
import { NavigationHUD } from './NavigationHUD';
import { VehicleClassPrompt } from './VehicleClassPrompt';
import { acquireFullNavigationOrientation } from '../../platform/navigation/navigationOrientation';
import { MapHudControls } from './MapHudControls';
import { useMapOverlayLifecycle } from './hooks/useMapOverlayLifecycle';
import { useRouteDrawingLifecycle } from './hooks/useRouteDrawingLifecycle';
import { useMapStyleLifecycle } from './hooks/useMapStyleLifecycle';
import { mapMutexWindow as _mapMutexWindow, routeHash as _routeHash } from './hooks/_mapSurfaceInternals';
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
import { useDisplaySpeed } from '../../hooks/useDisplaySpeed';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
/* ARCH-06/F3 — YALNIZ SAYAÇ. Koordinat, bearing ve rota verisi ölçüm
   katmanına TAŞINMAZ; rAF sahipliği ve idle-uyku davranışı DEĞİŞMEDİ. */
import { bumpPerf } from '../../platform/perf/perfCounters';

interface FullMapViewProps {
  onClose: () => void;
  /** Navigasyon alt çubuğundan başka sekmeleri açmak için */
  onOpenDrawer?: (type: 'music' | 'phone' | 'apps' | 'settings') => void;
}

/** Stable hash of a route geometry — first point + last point + length. */
/* `_routeHash` ve `_mapMutexWindow` `./hooks/_mapSurfaceInternals`e TAŞINDI
   (P0-NAV-02): ayrıştırılan rota-çizim hook'u da aynı tanımı kullanır. İkinci
   bir kopya bırakılsaydı biri değişip diğeri değişmediğinde çizim sessizce iki
   farklı dedup anahtarı kullanırdı. */

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
  // NAV-1: araç marker'ı "tahmini" (DR >5s) modda mı — yalnız DEĞİŞİMDE paint güncellenir.
  const drEstimatedRef     = useRef(false);
  /* G1 (#529) — EKRANDA DÜRÜSTLÜK (vizyon §7.9 Katman 6).
   * Konum bayatken kullanıcı bunu GÖRMELİ; marker'ın soluklaşması tek başına
   * "kaç saniyedir kör olduğumu" söylemez. Değer SANİYE çözünürlüğünde ve
   * YALNIZ değiştiğinde state'e yazılır (rAF her karede set etseydi render
   * fırtınası olurdu). `null` = bayat değil → gösterge HİÇ çizilmez, yani
   * EKRAN-TEK BAKIŞTA kovasının ~3 bilgi birimi bütçesi normalde AŞILMAZ. */
  const [staleFixSec, setStaleFixSec] = useState<number | null>(null);
  const staleFixSecRef     = useRef<number | null>(null);
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

  const [isPreview, setIsPreview] = useState(false);
  const [routeStartFlash, setRouteStartFlash] = useState(false);
  const [routeReady, setRouteReady] = useState(false);
  // TEMP DEBUG — rota katmanı haritada gerçekten var mı (teşhis rozeti için, sonra kaldırılacak)
  /* Kamera takibi artik KANONIK OTORITEDE (cameraFollowAuthority) yasar; bu ikili
   * onun AYNASIdir. `isFollowingRef` sicak yolda (rAF/GPS tick) ucuz ref okumasi
   * olarak KORUNUR — otoriteyi her karede sorgulamak gereksiz maliyet olurdu.
   * Ayna YALNIZ abonelikten yazilir (asagidaki effect); dogrudan mutasyon YOK. */
  const [isFollowing, setIsFollowing] = useState(() => canDriveCamera());
  const isFollowingRef  = useRef(true);
  // Kamera/marker dedup çapasını GEÇERSİZ kıl: kullanıcı haritayı gezdirdikten sonra
  // (araç yerinde dursa bile) takip kamerası MUTLAKA geri merkezlemeli; stil yeniden
  // yüklendiğinde marker MUTLAKA yeniden çizilmeli. Dedup bunları yutmasın.
  const redrawDirtyRef  = useRef(true);
  const drivingModeRef  = useRef(false);
  const routeGeometryRef  = useRef<[number, number][] | null>(null);
  /* Kat edilen rota kırpma durumu. Karar SAF modelde (`routeTrimGate`);
     burada yalnız son işaret taşınır. #601: eskiden yalnız segment indeksi
     karşılaştırılıyordu → otoyolda uzun segmentlerde rota aracın arkasında
     61 s'ye kadar kalıyordu (ölçüm dosyanın başında). */
  const lastTrimMarkRef   = useRef<RouteTrimMark>(EMPTY_TRIM_MARK);
  const routeAltRef       = useRef<[number, number][][]>([]);
  const routeAltIdxRef    = useRef<number[]>([]);
  const routeAltDursRef   = useRef<number[]>([]);
  const routeMainDurRef   = useRef<number>(0);
  /** Kök 1 (2026-08-18) — rota bandı üstü sokak adı etiketleri için OSRM adımları. */
  const routeStepsRef     = useRef<RouteStep[]>([]);
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
  const { isNavigating, destination, status: navStatus } = useNavigation();
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
  // Kütük #417 — ekrana basılan hızın TEK otoritesi (ham GPS/ikinci füzyon motoru DEĞİL).
  const displaySpeedKmh = useDisplaySpeed();
  /* Kütük #413 — GÖSTERİLEN doğruluk, KARARLARI BESLEYEN konumdan okunur.
   * SAHADA ÖLÇÜLEN AYRIŞMA: ekran "GPS Doğruluğu Düşük — ~129 m" derken köprü
   * aynı dakikada `accuracyM = 2 068 m` okudu. Ekran `onGPSLocation` (gpsService)
   * akışını, motor (`routingService`/eşleme) ise `UnifiedVehicleStore.location`'ı
   * kullanıyordu — iki ayrı konum otoritesi. Sürücüye motorun gerçekten güvendiği
   * değer gösterilir; aksi hâlde "GPS iyi" yazarken kararlar çöp fix'le alınır. */
  const engineAccuracyM = useUnifiedVehicleStore((s) =>
    (s.location && Number.isFinite(s.location.accuracy)) ? s.location.accuracy : null);
  // Termal seviye — rAF FPS gate için ref'e yansıtılır (hook re-render'ı nadir: seviye değişiminde)
  const { level: thermalLevel } = useThermalState();

  // rAF/subscription içinden okunan ref'ler (re-render tetiklemezler)
  const destinationRef   = useRef<typeof destination>(destination);
  const thermalLevelRef  = useRef(0);
  const mapStyleReadyRef = useRef(false);

  /* ── EKRAN YÖNÜ — YALNIZ TAM EKRAN NAVİGASYON (MOTION_CAMERA_P0) ──────────
   * Ana CAROS arayüzü YATAY kalır (manifest `sensorLandscape`). Bu görünüm
   * açıkken kilit dört yöne gevşetilir, kapanınca GERİ ALINIR. Ref-count'ludur:
   * çift mount'ta kilit erken geri alınmaz. Oturum/rota/ses/ETA etkilenmez —
   * hepsi görünümden bağımsız runtime'lardadır. */
  useEffect(() => acquireFullNavigationOrientation(), []);

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
  }, [navStatus, drivingMode, obdState.speed, gpsLostWarn, destination, thermalLevel]);

  useEffect(() => {
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
  }, [navStatus, drivingMode]);

  // Mod değişmeden gelen gerçek hareket ve yeni hedef de uyuyan çizim döngüsünü açar.
  // Sıfır/durgun OBD örnekleri rAF'ı boş yere yeniden başlatmaz.
  useEffect(() => {
    if (obdState.speed >= 1.5) wakeLoopRef.current?.();
  }, [obdState.speed]);
  useEffect(() => {
    if (destination) wakeLoopRef.current?.();
  }, [destination]);

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

        // ── SAHA FIX (2026-07-12, cihaz CDP teşhisi): WAKE-tarafı park gürültü tutucusu ──
        // KÖK NEDEN: displacement-wake accuracy-BLIND'dı → park hâlinde GPS doğruluğu ±Nm
        // olunca ardışık fix'ler ~Nm zıplayıp "≥3m / ≥5km/h" eşiğini geçiyor → wake SPAM
        // (cihazda ~2.8/sn ölçüldü) → isIdleNow histerezisi (IDLE_HYSTERESIS_MS=2500) HİÇ
        // dolmuyor → döngü HİÇ uyumuyordu (cihaz: idle CPU ~108%, rAF 137/sn, %100 histerezis
        // bloğu). #61'in park tutucusu yalnız isIdleNow (döngü ÇIKIŞI) tarafındaydı; wake
        // GİRİŞİ korunmamıştı → yarım fix. ÇÖZÜM: isIdleNow ile TUTARLI semantik — park
        // (hız<STANDSTILL_KMH) hâlinde, fix'in KENDİ doğruluk yarıçapı
        // (≥STANDSTILL_HOLD_M) altındaki kayma GPS jitter'ıdır → wake ETME. Gerçek hareket
        // hız alanında (≥1.5 km/h) görünür → tutucu es geçilir, takip bozulmaz.
        const _WAKE_STANDSTILL_KMH = 1.5; // isIdleNow STANDSTILL_KMH ile aynı
        const _WAKE_STANDSTILL_M   = 5;   // isIdleNow STANDSTILL_HOLD_M ile aynı
        const _noiseFloorM = Math.max(_WAKE_STANDSTILL_M, loc.accuracy ?? 0);

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
            // Park gürültüsü: park + doğruluk yarıçapı altı kayma → hareket DEĞİL, wake etme
            const _standstillNoise = speedKmh < _WAKE_STANDSTILL_KMH && _movedM < _noiseFloorM;
            if (!_standstillNoise && _movedM >= 3 && (_movedM / _dtS) * 3.6 >= 5) wakeLoopRef.current?.();
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

      // 2b) Rota KIRPMA — GÖRÜNÜM işi (saha fix 2026-06-12: harita stilinden bağımsız).
      //
      //     ⚠️ İLERLEME MOTORU ARTIK BURADA DEĞİL (SESSION CONTINUITY P0).
      //     `updateRouteProgress` + `updateNavigationProgress` sahipliği
      //     `navigationSessionRuntime`'a taşındı: motor uygulama ömrü boyunca
      //     yaşayan tek abonelikten sürülür, bu bileşen unmount olsa da ilerleme
      //     DURMAZ. Burada yalnız motorun ürettiği ilerleme noktasından rotayı
      //     kırpmak kalır — bu saf çizim işidir ve görünüm ölünce durması DOĞRUdur.
      //
      //     Sıra: runtime aboneliği boot'ta (Wave 3) kurulur, bu abonelik mount'ta
      //     → store dinleyicileri ekleme sırasıyla çağrılır, yani motor bu bloktan
      //     ÖNCE koşar ve okuduğumuz ilerleme noktası aynı fix'e aittir. Sıra
      //     bozulsa bile en kötü ihtimal bir fix'lik (~1 s) görsel gecikmedir.
      if (loc && destinationRef.current) {
        const _navStatusNow = getNavigationState().status;
        if (_navStatusNow === NavStatus.ACTIVE || _navStatusNow === NavStatus.REROUTING) {
          // Kat edilen rotayı kırp: snapped noktadan İLERİYE kalan geometri çizilir.
          // Yalnız segment index veya geometri (reroute) değişince setData — Mali-400 dostu.
          const _prog = getRouteProgressPoint();
          const _geom = routeGeometryRef.current;
          if (_prog && _geom && _geom.length >= 2 && mapRef.current) {
            const _next = {
              segIdx: _prog.segIdx, lon: _prog.lon, lat: _prog.lat, geom: _geom,
            };
            if (shouldTrimRoute(lastTrimMarkRef.current, _next)) {
              lastTrimMarkRef.current = nextTrimMark(_next);
              const _remaining: [number, number][] = [
                [_prog.lon, _prog.lat],
                ..._geom.slice(_prog.segIdx + 1),
              ];
              trimRouteGeometry(mapRef.current, _remaining);
            }
          }

          /* 2c) YOLA BOYANMIŞ MANEVRA OKU — aynı fix, ek abonelik/timer YOK.
             Karar saf modeldedir; burada yalnız girdi toplanır ve sonuç
             haritaya yazılır. `setPaintedArrow` kendi dedup'ını yapar:
             hüküm değişmediyse `setData` HİÇ çağrılmaz (GPS 1 Hz akar).

             Adım seçimi HUD ile AYNI kuralı izler (NavigationHUD:1877):
             OSRM'de `steps[i].maneuver` adımın BAŞINDAKİ manevradır, yani
             yaklaşan dönüş `steps[currentStepIndex + 1]`'dir; `steps[i]` az
             önce GEÇİLMİŞ manevradır. İkisi ayrışırsa ok yanlış kavşağı
             boyar — bu yüzden tek kural, tek yorum. */
          const _rsArrow  = getRouteState();
          const _nextIdx  = _rsArrow.currentStepIndex + 1;
          const _nextStep = _rsArrow.steps[_nextIdx];
          const _anchor   = _rsArrow.maneuverAnchors.find((a) => a.stepIndex === _nextIdx);
          const _anchorIdx = _anchor?.geometryIndex ?? -1;

          const _arrow = buildPaintedArrow({
            navActive:             true,
            routeGeometry:         _rsArrow.geometry,
            maneuverGeometryIndex: _anchorIdx,
            distanceToManeuverM:   Number.isFinite(_rsArrow.distanceToNextTurnMeters)
              ? _rsArrow.distanceToNextTurnMeters : null,
            maneuverType:          _nextStep?.maneuverType ?? '',
            maneuverModifier:      _nextStep?.maneuverModifier ?? '',
          });
          setPaintedArrow(mapRef.current, _arrow, _anchorIdx, getMapNight());
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

  // ── Compass TALEBİ (saha fix 2026-07-11) ─────────────────────────────────
  // Tam ekran harita heading-up çalışır (setDrivingView / setMapHeading takip kamerası
  // ve Rover marker yönü blend edilmiş heading'i kullanır) → compass'a GERÇEKTEN
  // ihtiyaç duyar. Mount'ta talep açılır, unmount'ta bırakılır; talep yokken
  // gpsService compass aboneliğini kapatır (konum takibi ETKİLENMEZ).
  // NOT: bu efekt yalnız talep kaydeder — sensör aboneliğinin sahibi gpsService/gate'tir.
  useEffect(() => {
    const release = acquireCompassDemand('map:full');
    return release;
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
      setMapStatus('IDLE');
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

  /* ⚠️ KONUM ÖNEMLİ: `requestFollow` bunu kullanan effect'lerden ÖNCE tanımlanır.
   * Bağımlılık dizileri RENDER sırasında değerlendirilir; tanım aşağıda kalsaydı
   * `requestFollow`u deps'e eklemek TDZ (ReferenceError) üretirdi ve bu yüzden
   * eksik-bağımlılık uyarısı "çözülemez" görünürdü. Tanım yukarı alınınca deps
   * dürüstçe tam yazılabiliyor. */
  /* ── #625 — GİRİŞ KAMERASININ YÖN GİRDİLERİ (tek yer) ──────────────────────
   * Cihazda ölçüldü: `enterNavigationView` altı çağrı yerinin hepsinde ham GPS
   * heading (`?? 0`) ile çağrılıyordu. Park hâlindeki araçta bu değer fiziksel
   * olarak anlamsızdır (Doppler yok) ve kamera rotanın 257° tersine kuruldu →
   * rotanın 309 noktasının 0'ı ekranda kaldı. Rota yönü ürünün MEVCUT
   * otoritesinden (`currentStepIndex + 1` adımı) okunur; paralel bir hesap
   * KURULMAZ. Tüm erişimler ref üzerinden olduğu için bağımlılık dizisi boştur. */
  const entryBearingArgs = useCallback((lat: number, lng: number): [number | null, number | null] => {
    let rb: number | null = null;
    try {
      const rs = getRouteState();
      rb = resolveRouteForwardBearing(lat, lng, rs.steps, rs.currentStepIndex);
    } catch { rb = null; }
    let sp: number | null = null;
    try {
      const gpsKmh = (locationRef.current?.speed ?? 0) * 3.6;
      sp = gpsKmh > 0.5 ? gpsKmh : obdSpeedRef.current;
    } catch { sp = null; }
    return [rb, sp];
  }, []);

  /* Takibi otoriteden iste — kamerayı da uygular. Görünüm ARTIK kendi bayrağını
   * yazmaz; tek yol burasıdır. */
  const requestFollow = useCallback((reason: RecenterReason) => {
    beginRecenter(reason);
    const loc  = locationRef.current;
    const bear = headingRef.current ?? 0;
    const h    = containerRef.current?.offsetHeight ?? 600;
    const isNav = navStatusRef.current === NavStatus.ACTIVE ||
                  navStatusRef.current === NavStatus.REROUTING;
    if (mapRef.current && loc) {
      if (drivingModeRef.current || isNav) {
        enterNavigationView(mapRef.current, loc.latitude, loc.longitude, bear, h, ...entryBearingArgs(loc.latitude, loc.longitude));
      } else {
        setMapCenter(mapRef.current, [loc.longitude, loc.latitude], 15, true);
      }
      try { noteFollowZoom(mapRef.current.getZoom()); } catch { /* stil geçişi */ }
    }
    lastDrivingPosRef.current = null;
    redrawDirtyRef.current    = true;
    wakeLoopRef.current?.();
    completeRecenter();
  }, []);


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

    /* ── SAHA FIX (2026-07-11, cihaz QA): harita boşta %43-212 CPU ──────────────
     * KÖK NEDEN (iki katman):
     *  (1) Idle kapısı GPS GÜRÜLTÜSÜNÜ hareket sanıyordu: park hâlinde ±3 m doğrulukla
     *      gelen fix'ler "3 m yer değiştirme ≈ 10 km/h" üretiyor → wake + isIdleNow=false
     *      → rAF döngüsü HİÇ uyumuyordu.
     *  (2) Döngü uyanıkken tick, DEĞİŞİKLİK OLMASA DA iş yapıyordu: updateUserMarker()
     *      sonunda KOŞULSUZ `source.setData()` çağırır (MapLayerManager.ts) → her 60 ms'de
     *      bir MapLibre repaint; kamera da 150-500 ms'de bir yeniden hesaplanıyordu.
     *      → sürekli GPU/compositor yükü (mali-event-hand + Chrome_InProcGp).
     *
     * ÇÖZÜM: "yapılan iş" ölçütü. Marker/kamera yalnız GERÇEKTEN değiştiğinde gönderilir;
     * NO_WORK_IDLE_MS boyunca hiç iş çıkmadıysa harita gerçekten sabittir → döngü uyur.
     * Wake tetikleyicileri ve hareket semantiği DEĞİŞMEDİ (nav/sürüş davranışı aynı).
     */
    const MARKER_EPS_M      = 0.3;   // altındaki kayma ekranda fark edilmez
    const MARKER_EPS_BEAR   = 0.5;   // derece
    const MARKER_EPS_SPEED  = 0.5;   // km/h
    const CAM_EPS_M         = 0.5;
    const CAM_EPS_BEAR      = 0.5;
    // Park gürültü tutucusu: hız < 1.5 km/h ve nav/sürüş yokken, fix'in KENDİ doğruluk
    // yarıçapı altındaki kayma HAREKET DEĞİLDİR (GPS jitter). Marker sabit tutulur.
    const STANDSTILL_KMH    = 1.5;
    const STANDSTILL_HOLD_M = 5;
    const STANDSTILL_BEAR   = 15;    // park hâlinde heading gürültüsü de yok sayılır
    const NO_WORK_IDLE_MS   = 2500;  // bu süre boyunca iş yoksa döngü uyur

    // Son GÖNDERİLEN (committed) marker/kamera durumu — dedup çapası
    let sentMarkerLat = NaN, sentMarkerLng = NaN, sentMarkerBear = NaN, sentMarkerSpeed = NaN;
    let sentCamLat    = NaN, sentCamLng    = NaN, sentCamBear    = NaN, sentCamSpeed    = NaN;
    let sentCamTurn   = NaN;
    let sentCamStep   = -1;
    let lastWorkTs    = performance.now(); // son GERÇEK güncelleme (marker/kamera) zamanı

    /** İki koordinat arası metre (düz yaklaşım — tick hot-path, allocation yok). */
    const distM = (aLat: number, aLng: number, bLat: number, bLng: number): number =>
      Math.hypot(
        (bLat - aLat) * 111_320,
        (bLng - aLng) * 111_320 * Math.cos((bLat * Math.PI) / 180),
      );

    /** İki açı arası en kısa fark (derece). */
    const bearDelta = (a: number, b: number): number =>
      Math.abs(((b - a + 540) % 360) - 180);

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
      if (userInteractingRef.current)         return false;

      // ── YAPILAN İŞ ÖLÇÜTÜ (kök-neden kapısı) ──────────────────────────────
      // Marker ve kamera NO_WORK_IDLE_MS boyunca hiç güncellenmediyse harita
      // gerçekten sabittir. Bu, aşağıdaki hız/yer-değiştirme SEZGİLERİNDEN daha
      // güvenilirdir: onlar park hâlindeki GPS gürültüsünü "hareket" sanıp döngüyü
      // sonsuza dek ayakta tutuyordu (cihaz QA: %43-212 CPU). Gerçek hareket varsa
      // her karede iş çıkar → lastWorkTs tazedir → burada uyunmaz.
      // Aktif navigasyonda GPS kaybı → DR geçişi LOCATION_STALE_MS'de başlar.
      // O ana kadar döngüyü açık tut; stale eşik geçildiğinde DR gerçek hareket
      // üretiyorsa lastWorkTs zaten tazelenir. Araç duruyorsa sonsuz boş rAF yerine
      // döngü uyur ve yeni GPS/route/interaction olayı wake() ile geri açar.
      const motionModeActive = navActive || drivingModeRef.current;
      const noWorkIdleMs = motionModeActive
        ? Math.max(NO_WORK_IDLE_MS, LOCATION_STALE_MS + 1_000)
        : NO_WORK_IDLE_MS;
      if (now - lastWorkTs >= noWorkIdleMs) return true;
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
      if (loopActive) return; // aktif döngünün idle saatini/gürültü filtresini sıfırlama
      lastWakeTs = performance.now();
      // Uyandırma "iş var" varsayımıdır: döngüye histerezis kadar süre tanı, iş
      // çıkmazsa (dedup her şeyi elerse) NO_WORK_IDLE_MS sonunda kendiliğinden uyur.
      lastWorkTs = lastWakeTs;
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

      // ── Dedup GEÇERSİZLEME (force) ────────────────────────────────────────
      // (a) Kullanıcı haritayı gezdirdi → kamera çapası bayat (redrawDirtyRef).
      // (b) Stil yeniden yüklendi / katman düştü → marker source'u yok; updateUserMarker
      //     self-healing için ÇAĞRILMALI, dedup bunu yutmamalı.
      const _layerMissing = !!mapRef.current && !mapRef.current.getLayer('user-vehicle');
      const _force = redrawDirtyRef.current || _layerMissing;
      if (_force) {
        sentMarkerLat = NaN; sentMarkerLng = NaN; sentMarkerBear = NaN; sentMarkerSpeed = NaN;
        sentCamLat    = NaN; sentCamLng    = NaN; sentCamBear    = NaN; sentCamSpeed    = NaN;
        sentCamTurn   = NaN;
        redrawDirtyRef.current = false;
        lastWorkTs = now;   // force → bir sonraki karede iş çıkacak; hemen uyuma
      }

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
      /* G1 (#529): eşik TEK OTORİTEDEN. Aynı "5 saniye" bu dosyada yerel sabit,
         `interpolation.DR_CONFIDENT_SEC`te, `navigationSessionRuntime`te ve
         `gpsService`te AYRI AYRI yazılıydı — dört kopya, tek gerçek. Biri
         değişirse diğerleri sessizce ayrışırdı. */
      const fixFresh = lastFixTsRef.current !== null && (now - lastFixTsRef.current) <= LOCATION_STALE_MS;
      const gpsOk = !!(fixFresh && locationRef.current && Number.isFinite(locationRef.current.accuracy) && locationRef.current.accuracy < 1000);

      // NAV-1: DR "tahmini" görsel işareti — GPS kayıp + son fix >5s ise marker soluklaşır
      // (dürüst sinyal: GPS teyitli değil). GPS dönünce netleşir. Yalnız DEĞİŞİMDE paint yaz.
      {
        const _buf = navPointsRef.current;
        /* #529: "tahmini" kararı da aynı otoriteden — `drIsEstimated` kendi
           eşiğini (DR_CONFIDENT_SEC) taşıyordu ve bu ikinci bir otoriteydi. */
        const _wantEst = !gpsOk && _buf.length > 0
          && (now - _buf[_buf.length - 1].ts) > LOCATION_STALE_MS;
        if (_wantEst !== drEstimatedRef.current) {
          drEstimatedRef.current = _wantEst;
          setUserMarkerEstimated(_wantEst);
        }
        /* #529: bayatlık SÜRESİ ekrana taşınır — saniye değişiminde tek set. */
        const _ageSec = (!gpsOk && lastFixTsRef.current !== null)
          ? Math.floor((now - lastFixTsRef.current) / 1000)
          : null;
        const _shown = _ageSec !== null && _ageSec * 1000 > LOCATION_STALE_MS ? _ageSec : null;
        if (_shown !== staleFixSecRef.current) {
          staleFixSecRef.current = _shown;
          setStaleFixSec(_shown);
        }
      }

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

        /* ── TÜNEL SÜREKLİLİĞİ ARTIK BURADA DEĞİL (NAVIGATION_DELIVERY_CORE_P0)
         * DR ilerleme beslemesi bu RAF döngüsündeydi; `FullMapView` unmount
         * olunca (mini haritaya dönüş) tünelde **mesafe · ETA · adım sayacı ·
         * sesli anons** topluca DONUYORDU. Besleme
         * `navigationSessionRuntime`in kendi 1 Hz zamanlayıcısına taşındı
         * (aynı eşikler, aynı `allowReroute:false` sözleşmesi).
         *
         * Bu döngü DR'yi yalnız ÇİZMEK için kullanmaya devam eder (marker +
         * kamera). Çizim ilerleme ÜRETMEZ → çift ilerleme imkânsızdır. */
        // KÖK NEDEN FIX (2026-07-04): kare-başı isStyleLoaded() kapısı kaldırıldı —
        // tile yüklenirken/setData sonrası false döner, DR kamera takibini yutuyordu.
        if (!userInteractingRef.current && mapRef.current && (now - lastCameraUpdate > drInterval)) {
          // Dead Reckoning: s = v × t, kartezyen tahmini (saf matematik utils'te)
          const { lat: drLat, lng: drLng } = projectDeadReckon(lastKnown, obdKmh, now);

          // DEDUP: DR duruyorsa (obdKmh≈0) projeksiyon aynı noktayı üretir → repaint etme.
          const _drMoved = Number.isNaN(sentMarkerLat)
            ? Infinity
            : distM(sentMarkerLat, sentMarkerLng, drLat, drLng);
          const _drBearD = Number.isNaN(sentMarkerBear)
            ? Infinity
            : bearDelta(sentMarkerBear, lastKnown.heading);
          const _drChanged = _drMoved >= MARKER_EPS_M || _drBearD >= MARKER_EPS_BEAR;

          if (now - lastMarkerUpdate > 100 && _drChanged) {
            updateUserMarker(drLat, drLng, lastKnown.heading, obdKmh);
            lastMarkerUpdate = now;
            sentMarkerLat   = drLat;
            sentMarkerLng   = drLng;
            sentMarkerBear  = lastKnown.heading;
            sentMarkerSpeed = obdKmh;
            lastWorkTs      = now;
          }
          if (isFollowingRef.current && _drChanged) {
            const h = containerRef.current?.offsetHeight ?? 600;
            setDrivingView(mapRef.current, drLat, drLng, lastKnown.heading, obdKmh, h);
            sentCamLat   = drLat;
            sentCamLng   = drLng;
            sentCamBear  = lastKnown.heading;
            sentCamSpeed = obdKmh;
            lastWorkTs   = now;
          }
          lastCameraUpdate = now;
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
        /* Takılı bayrak kurtarması — AMA kullanıcı ŞU AN haritayı sürüklüyorsa
         * (USER_PANNING) kamera ASLA geri alınmaz: görev kuralı "kullanıcı hâlâ
         * haritayı incelerken camera geri alınmasın". Yalnız FOLLOWING'e takılı
         * kalmış bir sapma düzeltilir. */
        if (getCameraFollowState() !== CameraFollowState.USER_PANNING && !canDriveCamera()) {
          beginRecenter('AUTO_TIMEOUT');
          completeRecenter();
        }
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
        /* Mesafenin KAYNAĞI da taşınır — KARAR burada VERİLMEZ. Kamera/rota
           vurgusu manevraya göre kurulacaksa mesafenin YOL-BOYU olması şarttır
           (kuş uçuşu virajlı yaklaşımda kısa çıkar → kavşağa erken girilir).
           Kapı `MapInteractionManager` içinde, kanonik `resolveManeuverBand`
           ile uygulanır; bu satır yalnız gerçeği İLETİR. */
        const _turnDistSource = _rsTick.distanceToNextTurnSource;

        // A — Araç işaretçisi + Visual Snapping
        // ACTIVE: snap → rota yoluna kilitle, GPS zıplamalarını gizle
        // Kamera da snapped koordinatı kullanır → sürücü rota dışı görünmez
        const _snap = navStatusRef.current === NavStatus.ACTIVE
          ? getSnappedMarkerPosition()
          : null;
        const displayLat = _snap?.lat ?? lat;
        const displayLng = _snap?.lon ?? lng;

        /* ── KAMERA YÖNÜ: yol geometrisi > GPS heading (saha 2026-08-08) ─────
         * Ölçülen GPS yön gürültüsü: |Δyön|/s p90 15,9° · p99 38,6°, araç
         * DURURKEN bile max 18,0°, örneklerin %5'i işaret değiştiriyor. Kamera
         * bunu kovaladığı için harita "bir öyle bir böyle" dönüyordu.
         * Rotaya güvenle oturmuşken yön ROTA SEGMENTİNDEN alınır (titremez);
         * oturtma güvenilmezse ham heading'e düşülür — yani rota dışındayken
         * davranış BİREBİR eskisi gibi kalır. İşaretçi zaten aynı kapıdan
         * geçen `_snap`i kullanıyor: konum ve yön artık tutarlı. */
        const _roadBear = _snap ? getSnappedRoadBearing() : null;
        const _camBear  = _roadBear ?? bear;

        // Marker: kullanıcı etkileşimi yoksa 100ms'de bir güncelle (10fps yeterli).
        // NOT: isSwitchingStyle state'i burada bilerek kontrol edilmez.
        // updateUserMarker kendi içinde isStyleLoaded() + self-healing yönetir;
        // isSwitchingStyle ile ekstra kilitleme, stil yüklendikten sonra da
        // marker'ı geciktirir (React state güncelleme gecikmesi).
        // Marker 60ms (~16fps): tek nokta source.setData ucuz → araç ekstrapole yol boyunca
        // daha akıcı kayar (önceki 100ms/10fps'te basamaklı/geride hissi). Kamera throttle'ı
        // (150ms, Mali-400 GPU) ayrı tutulur — marker hızı GPU'yu yük etmez.
        //
        // DEDUP (2026-07-11): updateUserMarker KOŞULSUZ `source.setData()` çağırır →
        // her çağrı bir MapLibre repaint'idir. Konum/heading/hız GERÇEKTEN değişmediyse
        // çağırma. Park hâlinde (hız < 1.5 km/h) fix'in doğruluk yarıçapı
        // altındaki kayma GPS gürültüsüdür — marker sabit tutulur.
        /* ⚠️ "DURGUN" TANIMI NAVİGASYONLA EZİLİYORDU — ısınmanın ikinci ölçülen
         * kaynağı (2026-08-03). Koşul `!_navOrDriving && hız < 1.5` idi: yani
         * navigasyon AÇIKSA araç park hâlinde olsa bile "durgun" SAYILMIYOR,
         * eşikler 0.3 m / 0.5°'ye düşüyordu. GPS gürültüsü (doğruluk ±1.8 m,
         * heading fix başına ~3° kayıyor) bu eşikleri HER TİKTE aşıyor →
         * `updateUserMarker` sürekli çağrılıyor → her `setData` haritayı baştan
         * çizdiriyor. CİHAZ ÖLÇÜMÜ: park hâlinde `setData:user-location`
         * **20 sn'de 72 kez** (3.6/sn).
         * Durgunluk aracın hâlidir, navigasyonun değil: park etmiş araç
         * navigasyon açıkken de park hâlindedir. Gerçek hareket başlayınca
         * (hız ≥ 1.5 km/h) eşikler zaten hassas moda döner. */
        const _stationary = speedKmh < STANDSTILL_KMH;
        const _accM       = locationRef.current?.accuracy ?? 0;
        const _moveThreshM = _stationary
          ? Math.max(STANDSTILL_HOLD_M, Number.isFinite(_accM) ? _accM : 0)
          : MARKER_EPS_M;
        const _bearThresh  = _stationary ? STANDSTILL_BEAR : MARKER_EPS_BEAR;

        const _markerMovedM   = Number.isNaN(sentMarkerLat)
          ? Infinity
          : distM(sentMarkerLat, sentMarkerLng, displayLat, displayLng);
        const _markerBearD    = Number.isNaN(sentMarkerBear) ? Infinity : bearDelta(sentMarkerBear, bear);
        const _markerSpeedD   = Number.isNaN(sentMarkerSpeed) ? Infinity : Math.abs(speedKmh - sentMarkerSpeed);
        const _markerChanged  =
          _markerMovedM >= _moveThreshM ||
          _markerBearD  >= _bearThresh  ||
          _markerSpeedD >= MARKER_EPS_SPEED;

        if (!userInteractingRef.current && now - lastMarkerUpdate > 60 && _markerChanged) {
          updateUserMarker(displayLat, displayLng, bear, speedKmh);
          lastMarkerUpdate = now;
          sentMarkerLat   = displayLat;
          sentMarkerLng   = displayLng;
          sentMarkerBear  = bear;
          sentMarkerSpeed = speedKmh;
          lastWorkTs      = now;   // gerçek iş → döngü uyanık kalır
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
            // Kamera DEDUP: girdiler (konum/heading/hız/dönüş mesafesi) değişmediyse
            // kamerayı yeniden hesaplama — setDrivingView her çağrıda MapLibre'yi
            // yeniden çizdirir. Değişiklik yoksa görüntü zaten doğrudur.
            /* Durakta kamera yönü için ROTANIN İLERİ YÖNÜ: araçtan bir sonraki
               manevra noktasına bakan açı. Durakta GPS heading'i gürültüdür ve
               dondurulmuş eski değer haritayı ters çevirir ("geri geri mi
               gideceğim"). Rota geometrisi titremez → sabit VE doğru. */
            /* ⚠️ SAHA KUSURU — KAMERA TAM TERSE BAKIYORDU (cihazda ölçüldü 2026-08-03):
               burada `steps[currentStepIndex]` kullanılıyordu. `RouteStep.coordinate`
               ADIM BAŞLANGICIDIR (routingService.ts:29) — yani sürücünün ÜZERİNDE
               olduğu adımın girişi, aracın ARKASI. Ölçüm: harita bearing = −30.84°
               (=329.2°) ve bu değer `bearingToFirstRoutePoint` ile BİREBİR aynıydı;
               rotanın ileri yönü ise 148.6° idi → **179° ters**. Kullanıcı bunu
               "geri geri mi gideceğim" diye bildirdi.
               DOĞRUSU bir SONRAKİ manevradır (`currentStepIndex + 1`) — bu zaten
               projenin tek otoritesidir: `distanceToNextTurnMeters` ve yukarıdaki
               `_nextTurnBearing` de aynı indeksi kullanır. Paralel bir "ileri yön"
               otoritesi KURULMAZ. */
            let _routeBearing: number | undefined;
            if (_rs.steps.length > _ni) {
              const _st = _rs.steps[_ni];
              if (_st?.coordinate) {
                const [_sLon, _sLat] = _st.coordinate;
                if (distM(displayLat, displayLng, _sLat, _sLon) > 8) {
                  _routeBearing = bearingBetween(displayLat, displayLng, _sLat, _sLon);
                }
              }
            }

            const _camMovedM = Number.isNaN(sentCamLat)
              ? Infinity
              : distM(sentCamLat, sentCamLng, displayLat, displayLng);
            const _camBearD  = Number.isNaN(sentCamBear) ? Infinity : bearDelta(sentCamBear, _camBear);
            const _camSpeedD = Number.isNaN(sentCamSpeed) ? Infinity : Math.abs(speedKmh - sentCamSpeed);
            const _turnKey   = turnDist ?? -1;
            const _turnChanged = Number.isNaN(sentCamTurn) || Math.abs(_turnKey - sentCamTurn) >= 1;
            const _stepChanged = _rs.currentStepIndex !== sentCamStep;
            /* Rota yönü ile harita yönü ayrıştıysa kamera GÜNCELLENMELİ.
               Yoksa durakta hiçbir girdi değişmediği için `setDrivingView` hiç
               çağrılmaz ve harita rotanın tersine bakmaya devam eder
               (cihazda 140.6° sapma ölçüldü). */
            const _mapBear = mapRef.current.getBearing();
            const _routeBearOff = _routeBearing != null
              ? Math.abs(((((_routeBearing - _mapBear) % 360) + 540) % 360) - 180)
              : 0;

            /* ARCH-06/F3: hedef HESAPLANDI (dedup kararından ÖNCE). */
            bumpPerf('map.cameraTargetComputed');
            const _camChanged =
              _camMovedM >= CAM_EPS_M ||
              _camBearD  >= CAM_EPS_BEAR ||
              _camSpeedD >= MARKER_EPS_SPEED ||
              _turnChanged ||
              _stepChanged ||
              _routeBearOff > 15;

            if (_camChanged) {
              // Kamera snapped pozisyonu takip eder → GPS zıplamalarını sürücüye hissettirmez
              setDrivingView(mapRef.current, displayLat, displayLng, _camBear, speedKmh, h, turnDist, obdSpeedRef.current, _nextTurnBearing, _routeBearing, _turnDistSource);
              sentCamLat   = displayLat;
              sentCamLng   = displayLng;
              sentCamBear  = _camBear;
              sentCamSpeed = speedKmh;
              sentCamTurn  = _turnKey;
              sentCamStep  = _rs.currentStepIndex;
              lastWorkTs   = now;   // gerçek iş
            } else {
              /* AYNI hedef — harita mutasyonu GÖNDERİLMEDİ. Bu sayaç,
                 kamera dedup'ının GERÇEKTEN kazandırdığını kanıtlar. */
              bumpPerf('map.cameraDedupSkipped');
            }
            lastCameraUpdate = now; // throttle penceresi her koşulda ilerler
          }
        } else if (!userInteractingRef.current && isFollowingRef.current) {
          // Nav dışı takip modu (2D) — 500ms'de bir merkezle (değişiklik varsa)
          if (now - lastCameraUpdate > 500) {
            const _camMovedM = Number.isNaN(sentCamLat) ? Infinity : distM(sentCamLat, sentCamLng, lat, lng);
            const _camBearD  = Number.isNaN(sentCamBear) ? Infinity : bearDelta(sentCamBear, bear);
            bumpPerf('map.cameraTargetComputed');
            if (_camMovedM >= CAM_EPS_M || _camBearD >= CAM_EPS_BEAR) {
              setMapCenter(mapRef.current, [lng, lat], 15, false);
              setMapHeading(mapRef.current, bear);
              sentCamLat  = lat;
              sentCamLng  = lng;
              sentCamBear = bear;
              lastWorkTs  = now;   // gerçek iş
            } else {
              bumpPerf('map.cameraDedupSkipped');
            }
            lastCameraUpdate = now;
          }
        }
      } else if (buffer.length === 1 && mapRef.current) {
        // Tek nokta varsa (başlangıç) doğrudan oraya git.
        // DEDUP: bu dal HER KAREDE koşuyordu → tek fix varken 60 fps repaint (setData).
        // Nokta değişmediyse çizdirme.
        const p = buffer[0];
        const _pMoved = Number.isNaN(sentMarkerLat)
          ? Infinity
          : distM(sentMarkerLat, sentMarkerLng, p.lat, p.lng);
        const _pBearD = Number.isNaN(sentMarkerBear) ? Infinity : bearDelta(sentMarkerBear, p.heading);
        if (_pMoved >= MARKER_EPS_M || _pBearD >= MARKER_EPS_BEAR) {
          updateUserMarker(p.lat, p.lng, p.heading, 0);
          sentMarkerLat   = p.lat;
          sentMarkerLng   = p.lng;
          sentMarkerBear  = p.heading;
          sentMarkerSpeed = 0;
          lastWorkTs      = now;
        }
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
    /* ARCH-06/F3: kullanıcı haritayı elle oynattı → takip kamerası BASTIRILIR.
       Bu sayaç "follow camera kullanıcıyı EZMİYOR" iddiasının ölçülebilir
       kanıtıdır (F3 kabul ölçütü §34). */
    bumpPerf('map.cameraSuppressedByUser');
    userInteractingRef.current = true;
    if (interactTimerRef.current) { clearTimeout(interactTimerRef.current); interactTimerRef.current = null; }
    // Kullanıcı kamerayı elle oynattı → dedup çapası artık kamerayı temsil etmiyor.
    // Etkileşim bitince takip kamerası (araç yerinde dursa bile) geri merkezlemeli.
    redrawDirtyRef.current = true;
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

  /* ── OVERLAY KÖPRÜLERİ → `useMapOverlayLifecycle` (P0-NAV-02) ─────────────
   * Alternatif rota seçimi · dokununca kontrolleri göster · uzun basış hedefi.
   * Üç efekt de burada, TAM BU KONUMDA bildirilir → React efekt sırası
   * taşımadan önceki hâliyle birebir aynıdır. */
  useMapOverlayLifecycle({ mapRef, mapStatus, showControls });

  /* Kullanıcı pan'ı → KANONİK OTORİTE.
   *
   * Eskiden takip bayrağı ve otomatik dönüş zamanlayıcısı BU BİLEŞENDE yaşıyordu;
   * mini haritanın bundan haberi yoktu. Artık yalnız BİLDİRİM yapılır:
   * `notifyUserPanStart` / `notifyUserPanEnd`. Otomatik dönüş gecikmesi
   * (navigasyonda 3 sn / dışında 10 sn) otoriteye TAŞINDI — sayılar aynı,
   * sözleşme değişmedi. Kamerayı gerçekten hareket ettiren kod burada kalır. */
  useEffect(() => {
    if (mapStatus !== 'READY' || !mapRef.current) return;
    const map = mapRef.current;

    const applyRecenter = () => {
      if (!mountedRef.current) return;
      wakeLoopRef.current?.();                 // takip dönünce döngüyü uyandır
      const loc  = locationRef.current;
      const bear = headingRef.current ?? 0;
      const h    = containerRef.current?.offsetHeight ?? 600;
      const isNav = navStatusRef.current === NavStatus.ACTIVE ||
                    navStatusRef.current === NavStatus.REROUTING;
      // enterNavigationView kamera-tek işlemdir; isStyleLoaded kapısı tile
      // yüklenirken auto-follow dönüşünü sessizce yutuyordu (KÖK NEDEN ailesi).
      if (mapRef.current && loc && (drivingModeRef.current || isNav)) {
        enterNavigationView(mapRef.current, loc.latitude, loc.longitude, bear, h, ...entryBearingArgs(loc.latitude, loc.longitude));
      }
      try { noteFollowZoom(mapRef.current?.getZoom() ?? null); } catch { /* stil geçişi */ }
    };

    const onPanStart = () => notifyUserPanStart();
    const onPanEnd   = () => notifyUserPanEnd(applyRecenter);

    map.on('dragstart',   onPanStart);
    map.on('zoomstart',   onPanStart);
    map.on('rotatestart', onPanStart);
    map.on('pitchstart',  onPanStart);
    map.on('dragend',     onPanEnd);
    map.on('zoomend',     onPanEnd);
    map.on('rotateend',   onPanEnd);
    map.on('pitchend',    onPanEnd);
    return () => {
      map.off('dragstart',   onPanStart);
      map.off('zoomstart',   onPanStart);
      map.off('rotatestart', onPanStart);
      map.off('pitchstart',  onPanStart);
      map.off('dragend',     onPanEnd);
      map.off('zoomend',     onPanEnd);
      map.off('rotateend',   onPanEnd);
      map.off('pitchend',    onPanEnd);
    };
  }, [mapStatus]);

  /* Otorite → yerel ayna. Sıcak yol (rAF/GPS tick) `isFollowingRef`i okur;
   * her karede modül çağırmak gereksiz maliyet olurdu. */
  useEffect(() => {
    const sync = () => {
      const ok = canDriveCamera();
      isFollowingRef.current = ok;
      setIsFollowing(ok);
    };
    sync();
    return subscribeCameraFollow(sync);
  }, []);

  /* Navigasyon aktifliğini otoriteye bildir — otomatik dönüş gecikmesini seçer. */
  useEffect(() => {
    setCameraNavActive(navStatus === NavStatus.ACTIVE || navStatus === NavStatus.REROUTING);
  }, [navStatus]);

  // Sürüş modu açılınca takibi yeniden başlat + haritayı hemen 3D nav görünümüne al
  useEffect(() => {
    if (drivingMode) {
      requestFollow('NAV_START');
      lastDrivingPosRef.current = null; // throttle sıfırla → sonraki GPS tick'inde kesinlikle setDrivingView çalışır
      redrawDirtyRef.current = true;    // dedup çapasını da sıfırla → kamera/marker kesinlikle yeniden çizilsin
      const loc  = locationRef.current;
      const bear = headingRef.current ?? 0;
      const h    = containerRef.current?.offsetHeight ?? 600;
      if (mapRef.current && loc) {
        enterNavigationView(mapRef.current, loc.latitude, loc.longitude, bear, h, ...entryBearingArgs(loc.latitude, loc.longitude));
      }
    }
  }, [drivingMode, requestFollow]);

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
          _mapMutexWindow().__MAP_MUTEX__ = false;
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
      redrawDirtyRef.current = true;    // dedup çapasını da sıfırla → kamera/marker kesinlikle yeniden çizilsin
      exitDrivingView(mapRef.current);
    }
  }, [drivingMode]);

  // Fetch route when navigation starts, destination changes, or GPS fix arrives after nav start.
  // location is in deps so that if GPS was unavailable at nav-start the effect retries
  // automatically on first fix — eliminating the "nav stuck with no route" deadlock.
  // claimRouteRequest (oturum otoritesi) dedups the fetch so normal GPS ticks (location
  // changing every second while driving) don't re-trigger it — and, unlike the old
  // component ref, it survives fullscreen close/reopen; mid-route rerouting is handled
  // exclusively by routingService._triggerReroute via updateRouteProgress.
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
      // Oturum sahipliği (SESSION CONTINUITY P0): aynı oturumda aynı hedef için
      // İKİNCİ istek atılmaz. Dedup artık bileşen ref'inde DEĞİL — ref unmount'ta
      // ölüyordu, dolayısıyla tam ekran her yeniden açıldığında AKTİF oturum için
      // yeni bir fetchRoute atılıyor ve durum ACTIVE→ROUTING'e düşüyordu.
      if (!claimRouteRequest(destination.id)) return;
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
      // Oturum yok (IDLE/ERROR) → sahiplik oturum otoritesinde zaten düşmüştür
      // (stopNavigation). Burada yalnız GÖRÜNÜM artıkları temizlenir.
      lastAppliedRef.current = null; // dedup sıfırla — aynı rota tekrar çizilsin
      setIsPreview(false);
      setRouteReady(false);
      if (mapRef.current) clearRouteGeometry(mapRef.current);
      clearRoute();
      routeGeometryRef.current = null;
      routeAltRef.current      = [];
      routeStepsRef.current    = [];
    }
  }, [isNavigating, destination, location]);

  // ROUTING → PREVIEW_READY veya ERROR: rota tamamlanınca sonuca göre geç
  useEffect(() => {
    if (!route.loading && navStatus === NavStatus.ROUTING) {
      const failed = route.error && !route.geometry; // error + no geometry = true failure
      if (failed) {
        setNavStatus(NavStatus.ERROR, 'Rota oluşturulamadı');
        // H2: sahipliği bırak — sonraki GPS tick'inde (ağ/GPS düzelince) otomatik yeniden dene.
        releaseRouteRequest();
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
    requestFollow('NAV_START');
    lastDrivingPosRef.current = null; // throttle sıfırla → hemen setDrivingView çalışır
    redrawDirtyRef.current = true;    // dedup çapasını da sıfırla → kamera/marker kesinlikle yeniden çizilsin
  }, [navStatus, requestFollow]);

  // ACTIVE/REROUTING: sürüş modunu garantile + haritayı 3D nav görünümüne al
  // handleNavStart bunu zaten çağırır; bu effect rerouting & edge case'leri kapatır
  useEffect(() => {
    if (navStatus !== NavStatus.ACTIVE && navStatus !== NavStatus.REROUTING) return;
    setDrivingMode(true);
    requestFollow('NAV_START');
    const loc  = locationRef.current;
    const bear = headingRef.current ?? 0;
    const h    = containerRef.current?.offsetHeight ?? 600;
    if (mapRef.current && loc) {
      enterNavigationView(mapRef.current, loc.latitude, loc.longitude, bear, h, ...entryBearingArgs(loc.latitude, loc.longitude));
    }
  }, [navStatus, requestFollow]);  

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

  /* ── ROTA ÇİZİM YAŞAM DÖNGÜSÜ → `useRouteDrawingLifecycle` (P0-NAV-02) ────
   * routeReady · rota çizgisi · deadlock kurtarma · dönüş odağı · başlangıç
   * parlaması. Beş efekt de TAM BU KONUMDA bildirilir; eşikler ve bağımlılık
   * dizileri değişmedi. Rota MOTORU (routingService / navigation core) bu
   * turda ELLENMEDİ — burada yalnız ÇİZİM yaşar. */
  useRouteDrawingLifecycle({
    mapRef, mountedRef,
    /* Vurgu sözleşmesi için iki MEVCUT hüküm daha geçirilir; yeni hesap YOK. */
    route: {
      ...route,
      serverUsed: route.serverUsed ?? null,
      validationVerdict: route.validation?.verdict ?? null,
    },
    mapStatus, styleKey, navStatus, isNavigating, isPreview,
    styleChangingRef, lastAppliedRef, routeGeometryRef, routeAltRef, routeAltIdxRef,
    routeAltDursRef, routeMainDurRef, routeStepsRef, prevStepIndexRef,
    setRouteReady, setRouteStartFlash, pushDebug,
  });

  /* ── STİL / TEMA YAŞAM DÖNGÜSÜ → `useMapStyleLifecycle` (P0-NAV-02) ───────
   * Harita modu · karo render modu · navigasyon+AR odak modu. Üç efekt de TAM
   * BU KONUMDA bildirilir. İlk-render atlama bayrakları burada KALIR: harita
   * yeniden kurulduğunda (WebGL context kaybı) ilk stil değişimi sessizce
   * atlanmasın diye ömürleri bileşene bağlıdır. */
  useMapStyleLifecycle({
    mapRef, mode, tileRender, navStatusRef, isNavigating, arState,
    modeInitRef, renderInitRef, doStyleSwitch: _doStyleSwitch,
    styleKey, mapStatus,
  });

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
    _mapMutexWindow().__MAP_MUTEX__ = true;
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
      _mapMutexWindow().__MAP_MUTEX__ = false;
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
          redrawDirtyRef.current = true;    // dedup çapasını da sıfırla → kamera/marker kesinlikle yeniden çizilsin
          enterNavigationView(map, loc.latitude, loc.longitude, hdg || 0, h, ...entryBearingArgs(loc.latitude, loc.longitude));
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
        setRouteGeometry(map, _geomToRender, routeAltRef.current, routeAltIdxRef.current, routeAltDursRef.current, routeMainDurRef.current, routeStepsRef.current);
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
    requestFollow('NAV_START');
    const loc  = locationRef.current;
    const bear = headingRef.current ?? 0;
    const h    = containerRef.current?.offsetHeight ?? 600;
    if (mapRef.current && loc) {
      enterNavigationView(mapRef.current, loc.latitude, loc.longitude, bear, h, ...entryBearingArgs(loc.latitude, loc.longitude));
    }
  }, [requestFollow]);
  /* Açık "Navigasyonu sonlandır" eylemi — oturumu GERÇEKTEN bitiren tek yol.
   * Tam ekranı kapatmak (MapHudControls X / donanım geri) bu yolu ÇAĞIRMAZ;
   * o yalnız `onClose` ile görünümü kapatır ve oturum yaşamaya devam eder. */
  const handleNavCancel = useCallback(() => {
    endNavigation();               // stopNavigation + clearRoute (tek giriş noktası)
    resetCameraFollow('NAV_END');  // kamera sahipliği temiz kapanır (bekleyen dönüş iptal)
    setIsPreview(false);
    setDrivingMode(false);
    setRouteReady(false);
    lastAppliedRef.current = null; // dedup sıfırla
    if (mapRef.current) {
      clearRouteGeometry(mapRef.current);
      exitDrivingView(mapRef.current);
    }
    routeGeometryRef.current = null;
    routeAltRef.current      = [];
    routeAltIdxRef.current   = [];
    routeStepsRef.current    = [];
  }, []);

  const handleZoomIn = () => mapRef.current?.zoomIn();
  const handleZoomOut = () => mapRef.current?.zoomOut();

  /* "Ortala" — TEK DOKUNUŞ. Mini harita ile BİREBİR aynı yol (aynı otorite,
   * aynı zoom politikası): iki ekran farklı mantık kullanmaz. */
  const handleRecenter = useCallback(() => {
    requestFollow('USER_BUTTON');
  }, [requestFollow]);

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
        className="fixed inset-0 z-[var(--z-map-fatal)] flex flex-col items-center justify-center gap-8 p-10"
        style={{ background: 'linear-gradient(160deg,#08090e,#0a0c12)' }}
      >
        {/* Kapatma — sağ üst */}
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-2xl active:scale-90 transition-all"
          style={{
            position: 'fixed',
            top: 'calc(var(--sat) + 14px)', right: 'calc(var(--sar) + 14px)',
            zIndex: 'var(--z-map-alert)',
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
    <div ref={outerDivRef} data-theme-surface="nav" data-editable="nav.screen" data-editable-type="panel"
      className="fixed inset-0 glass-card border-none !shadow-none z-[var(--z-map-surface)]">
      {/* ═══ #529 · KONUM BAYAT ROZETİ (vizyon §7.9 Katman 6: ekranda dürüstlük) ═══
          Konum bayatken harita BUNU SÖYLER; akıcı animasyonla taze veri varmış
          gibi gösterilmez. Yalnız bayatken çizilir → normal sürüşte ekran bütçesi
          etkilenmez. Tek bilgi birimi, 1 saniyede okunur. */}
      {staleFixSec !== null && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-[var(--z-map-honesty)] pointer-events-none
                     rounded-full border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)]
                     backdrop-blur-md px-3.5 py-1.5 text-[12px] font-bold tracking-wide text-[var(--oem-warn)]"
          style={{ boxShadow: '0 10px 28px -14px rgba(0,0,0,0.6)' }}
          data-testid="stale-fix-badge"
        >
          KONUM {staleFixSec} sn
        </div>
      )}
      {mapStatus !== 'READY' && (
        <div className="absolute inset-0 z-[var(--z-map-loading)] flex items-center justify-center pointer-events-none">
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
          /**
           * #620 — GECE FİLTRESİ, PALETİN ÜSTÜNDE İKİNCİ BİR KARARTMA OTORİTESİYDİ.
           *
           * KULLANICI BİLDİRİMİ: *"gece rota böyle karanlık oluyor."*
           *
           * CİHAZDA ÖLÇÜLDÜ (2026-08-17, gece, ACTIVE navigasyon, gerçek rota):
           * ekran pikselinden okunan rota gövdesi **#2D3F52** = rgb(45,63,82) —
           * oysa palet rengi `#5b9dff` = rgb(91,157,255). Filtre zinciri
           * modellendiğinde tahmin rgb(49,64,87) çıktı: **ölçümle birebir**.
           * Yani rotayı karartan şey palet DEĞİL, bu CSS filtresiydi.
           *
           * ETKİ (WCAG kontrast, gece zemini `#131822`):
           *     filtre yok        → rota↔zemin **6,53** · amber sinyal↔zemin **8,28**
           *     brightness(0.4)…  → rota↔zemin **1,89** · amber sinyal↔zemin **2,13**
           * Yani #612 (gece yolları) ve #619 (gece rotası) turlarında ölçülerek
           * kazanılan kontrastın neredeyse tamamını bu satır geri alıyordu.
           *
           * GÜVENLİK GEREKÇESİ (kozmetikten önce gelir): filtre yalnız estetik
           * değil, **amber uyarı sinyalini** de eziyordu (tehlike + kritik manevra
           * kılıfı/halosu 8,28 → 2,13). Sinyal renginin post-hoc bir filtreyle
           * körelmesi kabul edilemez.
           *
           * SEÇİLEN DEĞER — ölçülerek: `brightness(0.8) saturate(0.95)`
           *     rota↔zemin **4,53** · amber↔zemin **5,54**
           * `sepia(0.2)` ve `hue-rotate(-10deg)` KALDIRILDI: ikisi maviyi ve
           * amber'i kahverengiye çekip sinyal kimliğini bozuyordu (ölçümde yolun
           * kendisi bile #25221F gibi kahverengi okunuyordu). Gece görünümü artık
           * ÖLÇÜLMÜŞ gece paletinden gelir (#612/#619) — filtre yalnız hafif bir
           * parlaklık düşüşü yapar, ikinci bir palet OLMAZ.
           *
           * NOT: gündüzde filtre YOKTUR (güneş altında okunabilirlik) — eski
           * `autoBrightness.phase` sinyali gündüzde de karartıyordu, o düzeltme
           * korunuyor: karar `mapNight` ile AYNI sinyalden gelir.
           */
          /**
           * #622 — GECE FİLTRESİ TAMAMEN KALDIRILDI: gece görünümü artık TEK
           * otoriteden, ÖLÇÜLMÜŞ gece paletinden gelir.
           *
           * #620'de filtre 0,4 → 0,8'e çekilmişti (rota 1,89 → 4,53). Bu turda
           * palet ve filtre BİRLİKTE ölçülünce asıl kusur görüldü: sorun
           * kontrast ORANI değil, yüzeyin MUTLAK parlaklığıydı —
           *     Google gece zemini `#242f3e` → 0,028
           *     bizim ekranda (`#161c28` × 0,8) → **0,008** (3,5 kat karanlık)
           * Zemin `#222c3c`ye (0,025) çıkarıldıktan sonra filtre yalnız aynı
           * kazancı geri alan ikinci bir karartma otoritesi olurdu.
           *
           * Kalan gece "hissi" paletin kendisindedir (koyu lacivert zemin,
           * sakin alan dolguları, kontrastlı yol merdiveni) — post-hoc bir
           * filtreyle üretilmez. Gündüzde de filtre yoktur; iki tema artık
           * AYNI mekanizmayı kullanır.
           */
          filter: 'none',
          transition: 'opacity 500ms ease, filter 5s ease',
        }}
      />

      {/* Vignette — HUD geçişi için hafif gradyan (koyu değil, sadece kenar yumuşatma) */}
      <div
        className="absolute bottom-0 left-0 right-0 pointer-events-none z-[var(--z-map-scrim)]"
        style={{ height: '18%', background: 'linear-gradient(to top, rgba(6,9,15,0.38) 0%, transparent 100%)' }}
      />
      <div
        className="absolute top-0 left-0 right-0 pointer-events-none z-[var(--z-map-scrim)]"
        style={{ height: '8%', background: 'linear-gradient(to bottom, rgba(6,9,15,0.22) 0%, transparent 100%)' }}
      />

      {/* ── GPS konum rozeti — YALNIZ REHBERLİK YOKKEN (P0-NAV-05) ────────────
       * ÖLÇÜLEN KUSUR: P0-NAV-04 raporu bu rozetin "manevra kartından
       * kaldırıldığını" söylüyordu — YANLIŞTI. Rozet kartın İÇİNDE değil,
       * BURADA yaşıyor (`top: sat+14, left: 14`) ve yeni kart `left: 12`den
       * başladığı için TAM ÜSTÜNE düştü. Kart eskiden 96 px sağa kaydırılarak
       * kaçınıyordu; kaydırma kalkınca çakışma ortaya çıktı.
       * Rehberlik sırasında konum durumunun tek sahibi `NavigationStatus`tır
       * (GPS_DEGRADED). Rozet yalnız harita gezinme modunda kalır. */}
      {mapStatus === 'READY' && !isNavigating && (
        <div
          className="absolute pointer-events-none z-[var(--z-map-chip)]"
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
            {isValidGPS && engineAccuracyM != null && (
              <span className="text-[8px] font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>
                ±{Math.round(engineAccuracyM)}m
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

      {/* ── KM SAYACI ÇİPİ KALDIRILDI (P0-NAV-05) ─────────────────────────────
       * Kalan mesafenin TEK sahibi `hud/TripSummary`nin "Mesafe" sütunudur.
       * Bu çip (`top: sat+48, left: 14`) aynı sayıyı ikinci kez gösteriyor VE
       * yeni manevra kartının altına biniyordu. İki yerde gösterilen bir sayı,
       * biri güncellenmediğinde sessizce ayrışır — depoda kayıtlı kusur sınıfı. */}

      {/* Style-switch anti-flicker overlay.
          Fades in over the map (dark fill) while vector↔raster transition is
          in-flight, then fades out once first tiles have rendered.
          Not used for raster→raster switches (nav start) — those are instant. */}
      <div
        className="absolute inset-0 pointer-events-none z-[var(--z-map-transition)]"
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
        {/* Kütük #417: hız ham GPS'ten DEĞİL, tek gösterim otoritesinden gelir. */}
        <MapOverlay
          location={location}
          heading={heading}
          speedKmh={displaySpeedKmh}
        />
      </div>

      {/* Route start micro-interaction */}
      {routeStartFlash && (
        <div
          className="absolute inset-0 pointer-events-none z-[var(--z-map-effect)]"
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
            className="absolute z-[var(--z-map-label)] pointer-events-none"
            style={{ bottom: 'calc(var(--nav-bar-h, 72px) + 8px)', left: '50%', transform: 'translateX(-50%)' }}
          >
            <div
              data-editable="nav.street-bar" data-editable-type="card"
              className="oem-glass px-5 py-2 rounded-2xl flex items-center gap-2"
              style={{
                background: 'var(--oem-surface-1, rgba(38,44,60,0.86))',
                border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
                boxShadow: 'var(--oem-shadow-card, 0 20px 44px -22px rgba(0,0,0,0.55))',
                minWidth: 160, maxWidth: 320,
              }}
            >
              <span className="font-black text-sm tracking-wide truncate" style={{ color: 'var(--oem-ink, #F0EBE0)' }}>{street}</span>
            </div>
          </div>
        ) : null;
      })()}

      {/* GPS Kayıp Uyarısı — 30s GPS yok + OBD hız 0 */}
      {gpsLostWarn && isNavigating && (
        <div
          className="absolute z-[var(--z-map-control)] pointer-events-none"
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
        onRecenter={handleRecenter}
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

      {/* ── Ruhsat sınıfı sorusu — MODAL DEĞİL, yalnız araç DURURKEN ────────
       *  Uygulanabilir hız sınırı aracın yasal sınıfını bilmeyi gerektirir.
       *  Kapısı `shouldPromptVehicleClass`tadır: hareket hâlinde, kimlik yokken
       *  veya cevap zaten varken HİÇ çizilmez. */}
      <VehicleClassPrompt />

    </div>
  );
});


