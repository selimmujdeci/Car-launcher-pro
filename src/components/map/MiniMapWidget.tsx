import { useCallback, useEffect, useRef, useState, memo } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

type MapRef = MapLibreMap & { _initialized?: boolean };
import { Maximize2, Navigation2, X, Crosshair } from 'lucide-react';
import { logInfo } from '../../platform/debug';
import {
  initializeMap,
  setMapCenter,
  addUserMarker,
  updateUserMarker,
  destroyOwnedMap,
  freeOrphanMapContext,
  getMapInstance,
  switchMapStyle,
  setDrivingView,
  exitDrivingView,
  useMapState,
  checkAndHealMapContext,
  subscribeMapInstance,
  applyMapDayNight,
  setRouteGeometry,
  trimRouteGeometry,
  clearRouteGeometry,
} from '../../platform/mapService';
import {
  shouldTrimRoute,
  nextTrimMark,
  EMPTY_TRIM_MARK,
  type RouteTrimMark,
} from '../../platform/map/routeTrimGate';
import {
  useNavigation,
  endNavigation,
  getRouteProgressPoint,
  formatDistance,
  formatEta,
  NavStatus,
} from '../../platform/navigationService';
import { useRouteState, getRouteState } from '../../platform/routingService';
import { useEffectiveSpeedLimit } from '../../platform/navigation/useEffectiveSpeedLimit';
import {
  getRenderedMotion, useMarkerMotionSampleTick,
} from '../../platform/navigation/navMarkerMotionRuntime';
import { SpeedLimitCard } from './SpeedLimitCard';
import {
  canDriveCamera,
  notifyUserPanStart,
  notifyUserPanEnd,
  beginRecenter,
  completeRecenter,
  noteFollowZoom,
  setCameraNavActive,
} from '../../platform/navigation/cameraFollowAuthority';
import { useCameraFollow } from '../../hooks/useCameraFollow';
import { useGPSLocation, useGPSHeading, useGPSState } from '../../platform/gpsService';
import { acquireCompassDemand, releaseCompassDemand } from '../../platform/gps/compassDemand';

/** Mini haritanın compass talep kimliği (owner) — tek örnek varsayımı korunur. */
const MINI_MAP_COMPASS_OWNER = 'map:mini';
import { useDisplaySpeed } from '../../hooks/useDisplaySpeed';
import { getMapStyle, useMapMode, setMapNight, notifyLowFPS } from '../../platform/mapSourceManager';
import type { MapMode } from '../../platform/mapSourceManager';
import { getDeviceTier } from '../../platform/deviceCapabilities';
import { useStore } from '../../store/useStore';
import { MapOverlay } from './MapOverlay';

/* Düşük-uç (head unit / Mali-400) → MapLibre WebGL ağır. Boot anında init
 * kara ekran/GPU çökmesi/restart yapıyordu; init boot'tan SONRAYA ertelenir
 * (UI önce açılır) ve vektör yerine raster kilitlenir (vektör decode Mali-400'ü
 * boğuyor). Yetenekli cihazlar etkilenmez. */
const IS_LOW_TIER = getDeviceTier() === 'low';

interface MiniMapWidgetProps {
  onFullScreenClick?: () => void;
  /** true → header (NAVİGASYON / MİNİ HARİTA) tamamen gizlenir, harita tüm kartı kaplar */
  hideHeader?:  boolean;
  /** true → MapOverlay (hız/yön yazıları) render edilmez */
  hideOverlay?: boolean;
}

export const MiniMapWidget = memo(function MiniMapWidget({
  onFullScreenClick,
  hideHeader  = false,
  hideOverlay = false,
}: MiniMapWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapRef | null>(null);
  const initDone = useRef(false);
  const initializedRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const modeInitRef = useRef(false);
  // Son uygulanan stil modu — aynı moda geçişte gereksiz tam restyle'ı (overdraw +
  // style.load + marker yeniden ekleme) engeller.
  const lastStyleModeRef = useRef<MapMode | null>(null);
  const locationRef = useRef<ReturnType<typeof useGPSLocation>>(null);
  const headingRef = useRef<number | null>(null);
  // P2-B perf: PowerVR/zayıf GPU'da park halinde her GPS fix'i (≈2sn, konum titremesiyle)
  // harita kamerasını sürüp RenderThread'i patlatıyordu. Sürüş→park geçişini ve
  // uygulanmış son konumu izleyerek; park halinde hareket eşik altındaysa kamera/marker
  // işini TAMAMEN atlarız (GL render burst'ü kesilir). Sürüşte davranış değişmez.
  const wasDrivingRef = useRef(false);
  // ── Compass TALEBİ (saha fix 2026-07-11) ────────────────────────────────
  // Mini harita heading'i YALNIZ sürüş dalında kullanır (setDrivingView rotasyonu +
  // marker yönü). Park/dur dalında kuzey-yukarı statiktir → compass İSTEMEZ.
  // Bu yüzden talep, widget'ın KENDİ mevcut isDriving histerezisine (giriş >5 km/h,
  // çıkış <3 km/h) bağlanır; yeni eşik/yeni state EKLENMEZ.
  const compassHeldRef = useRef(false);
  const _setCompassDemand = (want: boolean): void => {
    if (want === compassHeldRef.current) return;          // idempotent
    compassHeldRef.current = want;
    if (want) acquireCompassDemand(MINI_MAP_COMPASS_OWNER);
    else      releaseCompassDemand(MINI_MAP_COMPASS_OWNER);
  };
  // Zero-leak: widget unmount olursa (drawer/ekran değişimi) talep MUTLAKA bırakılır.
  useEffect(() => () => {
    if (compassHeldRef.current) {
      compassHeldRef.current = false;
      releaseCompassDemand(MINI_MAP_COMPASS_OWNER);
    }
  }, []);
  const lastAppliedLatRef = useRef(0);
  const lastAppliedLngRef = useRef(0);
  // SAHA 2026-07-04: yer-değiştirme hızı için zaman çapası — fix kadansından
  // (200ms…2s) bağımsız km/h üretir; Doppler=0 saplanan cihazda sürüş tespiti.
  const lastAppliedTsRef  = useRef(0);
  /** Son hesaplanan etkin hız — Ortala sürüş görünümünü aynı politikayla kurar. */
  const lastEffKmhRef     = useRef(0);

  const [mapReady, setMapReady] = useState(false);

  // Düşük-uç: WebGL harita init'ini boot fırtınasından SONRAYA ertele. Yetenekli
  // cihazda anında (bootReady=true). Mali-400'de boot'ta eager WebGL = kara
  // ekran/restart → ertelenince app açılır, harita arkadan gelir (bloklamaz).
  const [bootReady, setBootReady] = useState(!IS_LOW_TIER);
  useEffect(() => {
    if (bootReady) return;
    // Düşük-uç'ta vektör yerine raster kilitle (vektör tile decode Mali-400'ü boğar).
    notifyLowFPS(true);
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const hardCap = setTimeout(() => setBootReady(true), 4500); // garanti üst sınır
    let idleId: number | null = null;
    if (typeof w.requestIdleCallback === 'function') {
      idleId = w.requestIdleCallback(() => setBootReady(true), { timeout: 4500 });
    }
    return () => {
      clearTimeout(hardCap);
      if (idleId !== null && typeof w.cancelIdleCallback === 'function') w.cancelIdleCallback(idleId);
    };
  }, [bootReady]);

  // Harita gün/gece — navigasyon (FullMapView) ile tutarlı. Erken setMapNight →
  // initializeMap içindeki getMapStyle doğru paleti kurar; harita hazırsa raster
  // paletini RESTYLE OLMADAN canlı günceller (rota/marker korunur).
  const mapNight = useStore((s) => s.settings.dayNightMode) === 'night';
  useEffect(() => {
    setMapNight(mapNight);
    if (mapRef.current && mapReady) applyMapDayNight(mapNight, mapRef.current);
  }, [mapNight, mapReady]);
  const [styleKey, setStyleKey] = useState(0);
  // Her artışta init effect yeniden çalışır — zombie recovery + ownership takeover sonrası
  const [reinitKey, setReinitKey] = useState(0);
  const location = useGPSLocation();
  const heading = useGPSHeading();
  const gpsState = useGPSState();
  const mode = useMapMode();
  const { tileError } = useMapState();
  /* Kütük #417 — rozet hızı TEK otoriteden okunur. Eskiden ikinci füzyon motoru
     (`speedFusion`) kullanılıyordu; aynı ekranda `UnifiedVehicleStore` tabanlı
     gösterimlerle çelişen değerler üretiyordu. Motorun kendisi duruyor
     (telemetri onu ayrıca init eder) — yalnız EKRANA BASMA yetkisi alındı. */
  const displaySpeedKmh = useDisplaySpeed();

  /* ── AKTİF NAVİGASYON OTURUMU (SESSION CONTINUITY P0) ─────────────────────
   * Mini harita artık aktif rotanın İKİNCİ GÖRÜNÜMÜdür. Kendi rota state'ini
   * KURMAZ, rota İSTEMEZ, ilerleme HESAPLAMAZ: hepsini tek otoriteden okur
   * (navigationService oturumu + routingService rota store'u). İlerlemeyi
   * `navigationSessionRuntime` sürer — bu bileşen yalnız çizer.                */
  const {
    status: navStatus, isNavigating, destination, distanceMeters, etaSeconds, isOfflineResult,
  } = useNavigation();
  const route = useRouteState();
  // Rota çizgisi aktif oturumda gösterilir; PREVIEW'de de rota görünür olmalı
  // (kullanıcı ana ekrandayken hedefi seçtiyse rotayı görmeli).
  const navRouteVisible = isNavigating && route.geometry !== null && route.geometry.length >= 2;
  // Kırpma yalnız CANLI sürüşte anlamlıdır (motor snapped nokta üretir).
  const navLive = navStatus === NavStatus.ACTIVE || navStatus === NavStatus.REROUTING;
  // Effect deps'ini şişirmemek için ref aynası — konum effect'i her fix'te koşar.
  const navLiveRef      = useRef(false);
  const routeGeomRef    = useRef<[number, number][] | null>(null);
  const lastRouteKeyRef = useRef<string | null>(null);
  /* #601: dedup anahtarı segment DEĞİL kat edilen mesafe — karar saf
     `routeTrimGate`te; burada yalnız son işaret taşınır. */
  const lastTrimMarkRef = useRef<RouteTrimMark>(EMPTY_TRIM_MARK);
  useEffect(() => {
    navLiveRef.current   = navLive;
    routeGeomRef.current = route.geometry;
  }, [navLive, route.geometry]);

  /* ── KAMERA TAKİBİ — KANONİK OTORİTE (tam ekranla AYNI) ───────────────────
   * Mini harita eskiden pan'ı HİÇ dinlemiyordu: kullanıcı haritayı kaydırınca
   * bir sonraki GPS fix'i kamerayı sessizce aracın üstüne geri atıyordu.
   * Artık `FullMapView` ile AYNI otoriteyi kullanır — iki ekran farklı mantık
   * çalıştırmaz. */
  const camera = useCameraFollow();

  // Sync refs safely outside of render
  useEffect(() => {
    locationRef.current = location;
    headingRef.current = heading;
  }, [location, heading]);

  /* ── HIZ LİMİTİ — ARAÇ FARKINDA TEK OTORİTE ──────────────────────────────
   * Sayı artık yalnız yoldan değil, YOL + ARACIN YASAL SINIFI birlikte
   * belirlenir (ör. ruhsatta kamyonet N1 yazan bir araç 110'luk yolda 95'e
   * çekilir). Hüküm `useEffectiveSpeedLimit` içinde üretilir ve tam ekran HUD
   * ile BİREBİR AYNIDIR — konum çıpası, sınıflandırma ve araç tavanı orada
   * tek yerde toplanmıştır (ikinci motor YOK). */
  const speedLimit = useEffectiveSpeedLimit();

  /* Navigasyon aktifliğini otoriteye bildir (otomatik dönüş gecikmesini seçer). */
  useEffect(() => {
    setCameraNavActive(navLive);
  }, [navLive]);

  /* ── AKICI İŞARET — PAYLAŞILAN MOTION RUNTIME (NAVIGATION_MOTION_CAMERA_P0) ──
   * Mini harita marker'ı DOĞRUDAN GPS geri çağrısında çiziyordu; GPS tavanı
   * 2 Hz olduğu için araç saniyede iki kez ZIPLIYORDU (tam ekran ise kendi RAF
   * döngüsünde ara değer üretiyordu). "Amatör görünüm" şikâyetinin en görünür
   * kaynağı buydu.
   *
   * Artık konum `navMarkerMotionRuntime`tan okunur — matematiği bu bileşen
   * YAPMAZ, ikinci bir interpolasyon motoru KURULMAZ. Döngü yalnız ÇİZER.
   *
   * ⚠️ BOŞTA CPU KORUMASI PAZARLIKSIZ (#61/#64): döngü YALNIZ araç sürerken
   * çalışır; durunca kendini kapatır. Ayrıca `updateUserMarker` yalnız konum
   * GERÇEKTEN değiştiyse çağrılır — park hâlinde GL yazımı olmaz. */
  const motionTick = useMarkerMotionSampleTick();
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map._initialized) return;
    if (!wasDrivingRef.current) return;   // duran araç → döngü HİÇ açılmaz

    let rafId = 0;
    let lastDrawMs = 0;
    let sentLat = NaN, sentLng = NaN, sentBear = NaN;

    const draw = (now: number) => {
      rafId = requestAnimationFrame(draw);
      if (!wasDrivingRef.current) { cancelAnimationFrame(rafId); rafId = 0; return; }
      // ~16 fps: tek nokta `setData` ucuzdur ama düşük-uç GPU'da her kare pahalıdır.
      if (now - lastDrawMs < 60) return;

      const m = getRenderedMotion(now);
      if (m.lat === null || m.lon === null) return;
      // Bayat konumda hareket UYDURULMAZ — model zaten donduruyor, burada da çizme.
      if (m.state === 'STALE') return;

      const bear = m.bearingDeg ?? sentBear;
      const movedM = Number.isNaN(sentLat)
        ? Infinity
        : Math.hypot((m.lat - sentLat) * 111_320,
                     (m.lon - sentLng) * 111_320 * Math.cos(m.lat * Math.PI / 180));
      const bearD = Number.isNaN(sentBear) || bear == null
        ? Infinity
        : Math.abs(((((bear - sentBear) % 360) + 540) % 360) - 180);
      if (movedM < 0.4 && bearD < 0.6) return;   // gerçek değişim yok → GL yazma

      try { updateUserMarker(m.lat, m.lon, bear ?? 0); } catch { /* stil hazır değil */ }
      lastDrawMs = now;
      sentLat = m.lat; sentLng = m.lon; sentBear = bear ?? 0;
    };

    rafId = requestAnimationFrame(draw);
    return () => { if (rafId) cancelAnimationFrame(rafId); };
    // `motionTick` yeni örnek geldiğinde döngüyü tazeler (duruştan sonra yeniden açar).
  }, [motionTick]);

  /* Aracı ortala — tam ekrandaki `requestFollow` ile BİREBİR aynı sözleşme:
   * mevcut takip zoom'u kullanılır, sabit rastgele zoom YOK. */
  const recenterOnVehicle = useCallback(() => {
    const map = mapRef.current;
    const loc = locationRef.current;
    if (!map || !loc) return;
    beginRecenter('USER_BUTTON');
    try {
      const hdg = headingRef.current ?? 0;
      if (wasDrivingRef.current) {
        const h = containerRef.current?.offsetHeight ?? 400;
        // Sürüş görünümü: mevcut kamera politikası (hız/heading) korunur.
        setDrivingView(map, loc.latitude, loc.longitude, hdg, lastEffKmhRef.current, h);
      } else {
        setMapCenter(map, [loc.longitude, loc.latitude], 16.5, true);
      }
      noteFollowZoom(map.getZoom());
      lastAppliedLatRef.current = loc.latitude;
      lastAppliedLngRef.current = loc.longitude;
    } catch { /* stil hazır değil — sonraki fix'te kamera zaten takip eder */ }
    completeRecenter();
  }, []);

  /* Kullanıcı pan'ı → otoriteye BİLDİR. Kamerayı burada durdurmayız; aşağıdaki
   * konum effect'i `canDriveCamera()` kapısını okur. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const onStart = () => notifyUserPanStart();
    const onEnd   = () => notifyUserPanEnd(recenterOnVehicle);
    map.on('dragstart',   onStart);
    map.on('zoomstart',   onStart);
    map.on('rotatestart', onStart);
    map.on('dragend',     onEnd);
    map.on('zoomend',     onEnd);
    map.on('rotateend',   onEnd);
    return () => {
      map.off('dragstart',   onStart);
      map.off('zoomstart',   onStart);
      map.off('rotatestart', onStart);
      map.off('dragend',     onEnd);
      map.off('zoomend',     onEnd);
      map.off('rotateend',   onEnd);
    };
  }, [mapReady, reinitKey, recenterOnVehicle]);

  /* Rota çizgisini uygula / kaldır.
   * `styleKey` dep'i şart: stil değişimi (gün↔gece, mod) MapLibre'nin tüm
   * source/layer'larını siler → aynı geometri YENİDEN uygulanmalıdır.
   * Anahtar hash + styleKey: aynı rota aynı stilde İKİNCİ kez yazılmaz
   * (Mali-400'de gereksiz setData/layer kurulumu yok).                        */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const geom = route.geometry;
    if (navRouteVisible && geom) {
      const key = `${styleKey}#${geom.length}:` +
        `${geom[0][0].toFixed(4)},${geom[0][1].toFixed(4)}:` +
        `${geom[geom.length - 1][0].toFixed(4)},${geom[geom.length - 1][1].toFixed(4)}`;
      if (lastRouteKeyRef.current === key) return;
      lastRouteKeyRef.current = key;
      lastTrimMarkRef.current = EMPTY_TRIM_MARK; // yeni geometri → kırpma çapası sıfırlanır
      try {
        // Alternatif rota ÇİZİLMEZ: mini harita alanında okunmaz olur ve
        // seçilemez (dokunma hedefi yok) — kanıtsız görsel gürültü üretmeyiz.
        setRouteGeometry(map, geom);
      } catch { /* stil yeniden yükleniyor olabilir — sonraki dep değişiminde tekrar */ }
    } else if (lastRouteKeyRef.current !== null) {
      lastRouteKeyRef.current = null;
      lastTrimMarkRef.current = EMPTY_TRIM_MARK;
      try { clearRouteGeometry(map); } catch { /* fail-soft */ }
    }
  }, [navRouteVisible, route.geometry, mapReady, styleKey]);

  // Unmount: rota katmanlarını bırak — harita singleton'ı FullMapView'a devredilirken
  // bizim çizdiğimiz çizgi orada artık geçerli olmayabilir (Zero-Leak + temiz devir).
  useEffect(() => () => {
    lastRouteKeyRef.current = null;
    lastTrimMarkRef.current = EMPTY_TRIM_MARK;
  }, []);

  // Store instance değişimini izle — stale ref ve re-init yönetimi.
  //
  // Durum A — FullMap sahipliği devraldı (active = FullMap instance, mapRef = MiniMap instance):
  //   Stale ref temizle. Re-init YAPMA — FullMap hâlâ haritayı kullanıyor;
  //   initializeMap çağırmak destroyMap tetikler ve FullMap'i çökertir.
  //
  // Durum B — store boşaldı (active = null) ve bizim initDone = false:
  //   FullMap kapandı ve singleton serbest kaldı. Güvenli re-init yapılabilir.
  useEffect(() => {
    return subscribeMapInstance((active) => {
      if (active !== null && mapRef.current && active !== mapRef.current) {
        // Durum A: FullMap devralındı — stale ref temizle, re-init beklemeye al
        mapRef.current   = null;
        initDone.current = false;
        setMapReady(false);
      } else if (active === null && !initDone.current) {
        // Durum B: singleton serbest kaldı — yeniden init tetikle
        setReinitKey((k) => k + 1);
      }
    });
  }, []);

  // Init map — waits for container to have actual pixel dimensions.
  // reinitKey dep'i: zombie recovery veya FullMap ownership takeover sonrası yeniden çalışır.
  // bootReady dep'i: düşük-uç'ta init boot'tan sonraya ertelenir (yukarıdaki effect).
  useEffect(() => {
    if (!containerRef.current || initDone.current || !bootReady) return;

    const el = containerRef.current;
    let observer: ResizeObserver | null = null;

    let resizeRafId: number | null = null;

    function tryInit() {
      if (initDone.current) {
        if (el.offsetWidth > 0 && el.offsetHeight > 0 && mapRef.current) {
          if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
          resizeRafId = requestAnimationFrame(() => {
            resizeRafId = null;
            mapRef.current?.resize();
          });
        }
        return;
      }
      if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
      doInit(el);
    }

    observer = new ResizeObserver(tryInit);
    observer.observe(el);

    if (el.offsetWidth > 0 && el.offsetHeight > 0) {
      doInit(el);
    } else {
      requestAnimationFrame(tryInit);
    }

    function doInit(container: HTMLElement) {
      if (mapRef.current) {
        logInfo('[MAP_INIT_BLOCKED] MiniMap — already exists');
        return;
      }
      if (initializedRef.current) {
        logInfo('[MAP_INIT_BLOCKED] MiniMap — initializedRef');
        return;
      }
      initializedRef.current = true;
      initDone.current = true;
      let cancelled = false;
      logInfo('[MAP_INIT_START] MiniMap');

      (async () => {
        try {
          const map = await initializeMap(container, { offline: true });
          if (cancelled) return;
          mapRef.current = map;
          logInfo('[MAP_INIT_DONE] MiniMap');

          if (map.isStyleLoaded()) {
            setMapReady(true);
          } else {
            const styleTimeout = setTimeout(() => {
              if (!cancelled) setMapReady(true);
            }, 3000);
            map.once('style.load', () => {
              clearTimeout(styleTimeout);
              if (!cancelled) setMapReady(true);
            });
          }
        } catch (err) {
          console.error('MiniMap init failed:', err);
          if (!cancelled) initDone.current = false;
        }
      })();

      cleanupRef.current = () => {
        cancelled = true;
        initDone.current = false;
        initializedRef.current = false;
        const map = mapRef.current;
        mapRef.current = null;
        logInfo('[MAP_DESTROY] MiniMap');
        if (!map) return;

        const storeInstance = getMapInstance();
        if (storeInstance !== null && storeInstance !== map) {
          // FullMapView sahipliği devraldı → bizim harita ORPHAN. Eski varsayım
          // "FullMap zaten _freeContext çağırdı" bu cihazda YANLIŞ: MiniMap canvas'ı
          // + WebGL context'i DOM'da canlı kalıyordu → PowerVR'da iki context render-
          // target'ı tüketip kasma yapıyordu (DevTools profili, 2026-06-14). Orphan
          // context'i TAM serbest bırak (map.remove() + WEBGL_lose_context).
          void freeOrphanMapContext(map);
        } else {
          // Biz hâlâ sahibiz veya store boş — tam yıkım
          destroyOwnedMap(map);
        }
      };
    }

    return () => {
      observer?.disconnect();
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      cleanupRef.current?.();
    };
  }, [reinitKey, bootReady]);

  // Zombi WebGL context guard — Android 9 düşük bellek durumunda GPU context sessizce ölebilir.
  // checkAndHealMapContext false döndürünce reinitKey arttırılır → init effect yeniden çalışır.
  useEffect(() => {
    if (!mapReady) return;
    const id = setInterval(() => {
      if (!checkAndHealMapContext()) {
        initDone.current = false;
        mapRef.current   = null;
        setMapReady(false);
        setReinitKey((k) => k + 1);
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [mapReady]);

  // Mode change — mirror the mode selected in FullMapView
  useEffect(() => {
    if (!modeInitRef.current) {
      modeInitRef.current = true;
      lastStyleModeRef.current = mode; // mount: baseline modu kaydet, restyle yok
      return;
    }
    if (!mapRef.current) return;
    // Stil/mod gerçekten değişmediyse tam restyle yapma (map overdraw koruması).
    if (lastStyleModeRef.current === mode) return;
    lastStyleModeRef.current = mode;
    const map = mapRef.current;
    const loc = locationRef.current;
    const hdg = headingRef.current;

    map._initialized = false;
    switchMapStyle(map, getMapStyle());

    map.once('style.load', () => {
      if (loc) {
        addUserMarker(map, loc.latitude, loc.longitude, hdg || 0);
        map._initialized = true;
      }
      setStyleKey((k) => k + 1);
    });
  }, [mode]);

  // Update map when location changes (or map/style becomes ready)
  useEffect(() => {
    if (!mapRef.current || !location || !mapReady) return;
    // ⭐ KÖK NEDEN FIX (2026-07-04): isStyleLoaded() yalnız İLK KURULUM (katman
    // ekleyen addUserMarker) için şarttır. Güncelleme yolunda (marker setData +
    // kamera jumpTo) bu kapı ZARARLI: tile yüklenirken ve her setData sonrası
    // false döner → sürüşte fix'lerin çoğu yutuluyor, harita "sabit" kalıyordu.
    // ⭐ KÖK NEDEN FIX (2026-07-17, saha: "mini haritada araç gözükmüyor, tam ekranda
    // gözüküyor"): burada `!_initialized && !isStyleLoaded()` → return kapısı vardı.
    // Android WebView'da `style.load` bazen HİÇ GELMEZ (FullMapView bunun için ayrı bir
    // "Stuck-LOADING guard" taşır) → isStyleLoaded() sonsuza dek false → effect her fix'te
    // erken döner → addUserMarker HİÇ çağrılmaz → Rover mini haritada ASLA çizilmez.
    // FullMapView aynı marker'ı `mapStatus==='READY'` ile, isStyleLoaded() SORMADAN ekliyordu
    // → bu yüzden tam ekranda görünüyor, mini haritada görünmüyordu.
    // Kapı kaldırıldı: aşağıdaki ilk-kurulum dalı try/catch ile korunuyor — stil gerçekten
    // hazır değilse addUserMarker throw eder ve _initialized false kalır → BİR SONRAKİ GPS
    // fix'inde tekrar denenir (fail-soft, sonsuz engel yok).

    const { latitude, longitude } = location;
    // speed: GPS m/s → km/h (null/undefined → 0)
    const speedKmh = location.speed != null && Number.isFinite(location.speed)
      ? location.speed * 3.6
      : 0;
    const hdg = heading || 0;
    // SAHA FIX (2026-07-04, "harita ters gidiyor + takip etmiyor"): bazı cihazlar
    // hareket halinde coords.speed=0 bildirir → yalnız hıza bakan eski eşik
    // (speedKmh>5) sürüş görünümünü HİÇ açmıyordu: rotasyon yok (kuzey-yukarı),
    // merkez ~200m'de bir sıçrıyordu. Hareket artık YER DEĞİŞTİRME HIZINDAN da
    // tespit edilir (fail-soft, CLAUDE.md §2). Hız zaman-normalize (km/h) —
    // fix kadansı 200ms de olsa 2s de olsa aynı eşik çalışır. Histerezis:
    // giriş >5 km/h, çıkış <3 km/h, arası önceki durumu korur (§2 hysteresis).
    const _nowTs   = performance.now();
    const _dtSec   = (_nowTs - lastAppliedTsRef.current) / 1000;
    const _movedM  = (Math.abs(latitude - lastAppliedLatRef.current) +
                      Math.abs(longitude - lastAppliedLngRef.current)) * 111_320;
    const _dispKmh = (_dtSec > 0.15 && _dtSec < 30) ? (_movedM / _dtSec) * 3.6 : 0;
    const _effKmh  = Math.max(speedKmh, _dispKmh);
    const isDriving = _effKmh > 5
      ? true
      : _effKmh < 3 ? false
      : wasDrivingRef.current;
    lastEffKmhRef.current = _effKmh;

    /* ── KAMERA KAPISI (fail-closed) ────────────────────────────────────────
     * Kullanıcı haritayı incelerken (USER_PANNING / FOLLOW_SUSPENDED) kamerayı
     * SÜRME. Marker yine güncellenir — araç nerede olduğu görünmeye devam eder,
     * yalnız görüntü kullanıcının bıraktığı yerden KAÇMAZ. */
    const _cameraOwned = canDriveCamera();

    // Sürüş → heading-up rotasyon var → compass gerekli. Park → kuzey-yukarı → gereksiz.
    _setCompassDemand(isDriving);

    if (!mapRef.current._initialized) {
      // Stil hazır değilse addUserMarker throw eder → _initialized false KALIR ve bir
      // sonraki GPS fix'inde yeniden denenir. Eskiden bu deneme isStyleLoaded() kapısıyla
      // hiç yapılmıyordu (bkz. yukarıdaki kök-neden notu).
      try {
        addUserMarker(mapRef.current, latitude, longitude, hdg);
        // Başlangıç zoom: sokak seviyesi (16 = tek tek sokaklar görünür)
        if (_cameraOwned) setMapCenter(mapRef.current, [longitude, latitude], 16, true);
        mapRef.current._initialized = true;
        wasDrivingRef.current = isDriving;
        lastAppliedLatRef.current = latitude;
        lastAppliedLngRef.current = longitude;
        lastAppliedTsRef.current  = _nowTs;
      } catch {
        /* stil henüz hazır değil → sonraki fix'te tekrar denenir (fail-soft) */
      }
    } else if (isDriving) {
      /* ── KAMERA PARİTESİ (NAVIGATION_MOTION_CAMERA_P0) ──────────────────────
       * Mini harita `setDrivingView`i EKSİK argümanlarla çağırıyordu: manevra
       * mesafesi, sonraki dönüş yönü ve rota yönü GEÇİLMİYORDU. Sonuç: tam
       * ekranda kavşak yaklaşımı, dönüş öngörüsü ve durakta rota-yönü düzeltmesi
       * çalışırken mini haritada HİÇBİRİ çalışmıyordu — iki ekran farklı kamera
       * davranışı gösteriyordu. Artık AYNI politika, AYNI argümanlar.
       *
       * Marker konumu burada değil, paylaşılan motion runtime'ından RAF ile
       * çizilir (aşağıdaki `motion` effect'i) → 2 Hz zıplama biter. */
      if (_cameraOwned) {
        const containerH = containerRef.current?.offsetHeight ?? 400;
        const _rs = getRouteState();
        const _turnDist = _rs.steps.length && _rs.distanceToNextTurnSource === 'ALONG_ROUTE'
          ? _rs.distanceToNextTurnMeters : undefined;
        /* Rotanın İLERİ yönü — tam ekranla AYNI otorite: bir SONRAKİ manevra
           adımı (`currentStepIndex + 1`). Paralel bir "ileri yön" otoritesi
           KURULMAZ; 8 m altındaki mesafede yön gürültülü olur, üretilmez. */
        let _routeBearing: number | undefined;
        const _ni = _rs.currentStepIndex + 1;
        const _st = _rs.steps.length > _ni ? _rs.steps[_ni] : null;
        if (_st?.coordinate) {
          const [_sLon, _sLat] = _st.coordinate;
          const _dLat = (_sLat - latitude) * 111_320;
          const _dLon = (_sLon - longitude) * 111_320 * Math.cos(latitude * Math.PI / 180);
          if (Math.hypot(_dLat, _dLon) > 8) {
            _routeBearing = (Math.atan2(_dLon, _dLat) * 180) / Math.PI;
            if (_routeBearing < 0) _routeBearing += 360;
          }
        }
        setDrivingView(
          mapRef.current, latitude, longitude, hdg, _effKmh, containerH,
          _turnDist, undefined, undefined, _routeBearing,
        );
      } else {
        // Kamera kullanıcıda — marker yine de güncel kalsın (araç nerede görünsün).
        updateUserMarker(latitude, longitude, hdg);
      }
      wasDrivingRef.current = true;
      lastAppliedLatRef.current = latitude;
      lastAppliedLngRef.current = longitude;
      lastAppliedTsRef.current  = _nowTs;
    } else {
      // P2-B: Dur/park. Sürüşten YENİ çıktıysak bir kez kamerayı düzleştir (exitDrivingView);
      // aksi halde GPS titremesi (≈metre-altı) için hiçbir GL işi yapma — RenderThread burst'ü
      // önlenir. Konum gerçekten kayda değer kadar (≈25m, 0.00025°) değiştiyse marker+merkez güncellenir.
      const movedDeg = Math.abs(latitude - lastAppliedLatRef.current) +
                       Math.abs(longitude - lastAppliedLngRef.current);
      if (wasDrivingRef.current && _cameraOwned) {
        exitDrivingView(mapRef.current);
        wasDrivingRef.current = false;
      }
      if (movedDeg > 0.00025) {
        updateUserMarker(latitude, longitude, hdg);
        lastAppliedLatRef.current = latitude;
        lastAppliedLngRef.current = longitude;
        lastAppliedTsRef.current  = _nowTs;
        const center = mapRef.current.getCenter();
        const dist = Math.sqrt(
          Math.pow(longitude - center.lng, 2) + Math.pow(latitude - center.lat, 2)
        );
        if (dist > 0.002 && _cameraOwned) {
          setMapCenter(mapRef.current, [longitude, latitude], 16.5, true);
        }
      }
    }

    /* Kat edilen rotayı kırp — GÖRÜNÜM işi, hesap DEĞİL.
     * İlerleme noktasını `navigationSessionRuntime` üretir; burada yalnız
     * okunur. Segment index değişmedikçe setData YAPILMAZ (FullMapView ile
     * aynı dedup deseni) → düşük-uç GPU'da her fix'te GL yazımı olmaz. */
    if (navLiveRef.current && mapRef.current) {
      const prog = getRouteProgressPoint();
      const geom = routeGeomRef.current;
      const _next = prog && geom
        ? { segIdx: prog.segIdx, lon: prog.lon, lat: prog.lat, geom }
        : null;
      if (prog && geom && geom.length >= 2 && _next &&
          shouldTrimRoute(lastTrimMarkRef.current, _next)) {
        lastTrimMarkRef.current = nextTrimMark(_next);
        try {
          trimRouteGeometry(mapRef.current, [
            [prog.lon, prog.lat],
            ...geom.slice(prog.segIdx + 1),
          ]);
        } catch { /* stil yeniden yükleniyor olabilir — sonraki fix'te tekrar */ }
      }
    }
  }, [location, heading, mapReady, styleKey]);

  // Hız: tek gösterim otoritesi (`useDisplaySpeed`) — null ise rozet `—` gösterir.
  const speedKmh = displaySpeedKmh;

  return (
    <div className="w-full h-full min-h-0 min-w-0 glass-card flex flex-col overflow-hidden relative border-none !shadow-none">
      {/* Ambient glow */}
      <div className="absolute -top-12 -left-12 w-32 h-32 bg-[#E0A23C]/[0.05] rounded-full blur-[40px] pointer-events-none" />

      {/* Header — hideHeader=true ise tamamen gizlenir, harita tüm alanı kaplar */}
      {!hideHeader && (
        <div className="flex-shrink-0 flex items-center justify-between px-5 pt-5 pb-2 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#E0A23C] border-2 border-[#E0A23C] flex items-center justify-center flex-shrink-0 shadow-lg shadow-[#E0A23C]/20">
              <div className={`w-2.5 h-2.5 rounded-full ${location ? 'bg-emerald-300 animate-pulse shadow-[0_0_10px_rgba(110,231,183,0.8)]' : 'bg-white opacity-40'}`} />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[#E0A23C] font-black text-[10px] tracking-[0.2em] uppercase mb-0.5">NAVİGASYON</span>
              <span className="text-primary text-[14px] font-black tracking-tight">MİNİ HARİTA</span>
            </div>
          </div>
          {onFullScreenClick && (
            <button
              onClick={onFullScreenClick}
              className="w-11 h-11 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-primary hover:bg-white/20 active:scale-90 transition-all duration-150 flex-shrink-0 shadow-md"
              title="Tam ekran"
            >
              <Maximize2 className="w-5 h-5" />
            </button>
          )}
        </div>
      )}

      {/* Map container — hideHeader=true → margin yok, rounded-[inherit] ile parent köşesini devralır */}
      <div
        ref={containerRef}
        className={`flex-1 min-h-0 min-w-0 overflow-hidden relative ${
          hideHeader
            ? 'rounded-[inherit]'                         // tüm kartı kapla, köşeyi devral
            : 'mx-4 mb-4 rounded-[2rem] glass-inner-focus' // normal mod
        }`}
      >
        {!hideOverlay && (
          <MapOverlay location={location} heading={heading} compact={true} speedKmh={speedKmh} />
        )}

        {/* ── Skeletal Loading — harita tile'ları yüklenene kadar AGAMA-tarzı placeholder ──
         *  mapReady=false: MapLibre canvas siyah gösterir; bu overlay boş ekranı saklar.
         *  cubic-bezier(0.4,0,0.2,1) geçişi: Tesla UI motion tasarım dili uyumlu.       */}
        {!mapReady && (
          <div
            className="absolute inset-0 z-10 rounded-[inherit] overflow-hidden"
            style={{
              background: 'linear-gradient(160deg, rgba(8,12,28,0.97) 0%, rgba(14,20,42,0.97) 100%)',
              transition: 'opacity 400ms cubic-bezier(0.4,0,0.2,1)',
            }}
          >
            {/* Animasyonlu terrain grid — harita yükleniyor hissi */}
            <svg className="absolute inset-0 w-full h-full opacity-[0.12]" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="sk-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#E0A23C" strokeWidth="0.5"/>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#sk-grid)" />
              {/* Fake road lines */}
              <line x1="30%" y1="0%" x2="30%" y2="100%" stroke="#E0A23C" strokeWidth="1.5" opacity="0.4" />
              <line x1="65%" y1="0%" x2="65%" y2="100%" stroke="#E0A23C" strokeWidth="1"   opacity="0.25" />
              <line x1="0%" y1="40%" x2="100%" y2="40%" stroke="#E0A23C" strokeWidth="1.5" opacity="0.4" />
              <line x1="0%" y1="70%" x2="100%" y2="70%" stroke="#E0A23C" strokeWidth="1"   opacity="0.25" />
            </svg>

            {/* Shimmer sweep — Tesla skeleton animation */}
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(105deg, transparent 40%, rgba(224,162,60,0.06) 50%, transparent 60%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.8s ease-in-out infinite',
              }}
            />

            {/* Merkez yükleme göstergesi */}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <div className="w-8 h-8 rounded-full border-2 border-[#E0A23C]/40 border-t-[#E0A23C] animate-spin" />
              <span className="text-[9px] font-black tracking-[0.25em] uppercase text-[#E0A23C]/60">
                Harita Yükleniyor
              </span>
            </div>
          </div>
        )}

        {/* GPS placeholder — konum yokken MapLibre siyah canvas'ı örter */}
        {!location && (
          <div className="absolute inset-0 z-20 rounded-2xl overflow-hidden bg-white/10">
            {/* Grid çizgileri — harita hissi */}
            <svg className="absolute inset-0 w-full h-full opacity-[0.08]" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
                  <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#E0A23C" strokeWidth="0.5"/>
                </pattern>
                <mask id="grid-mask">
                  <rect width="100%" height="100%" fill="url(#grid)" />
                </mask>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />

              {/* Fake traffic dots — düşük-uç (Mali-400) HARİÇ. SVG SMIL animasyonu
                  (animateMotion) CSS animation değildir → `.perf-low * { animation:none }`
                  onu DURDURMAZ. GPS fix gelene kadar (head unit'te dakikalar sürebilir)
                  bu 3 nokta sürekli compositing/repaint yapıp Mali-400'ü ısıtıyordu.
                  Düşük-uçta statik grid yeterli; hareketli nokta render edilmez. */}
              {!IS_LOW_TIER && (
                <>
                  <circle r="1.5" fill="#E0A23C">
                    <animateMotion dur="8s" repeatCount="indefinite" path="M 10 10 L 290 10 L 290 290 L 10 290 Z" />
                  </circle>
                  <circle r="1.5" fill="#f87171">
                    <animateMotion dur="12s" repeatCount="indefinite" path="M 150 10 L 150 290" />
                  </circle>
                  <circle r="1.5" fill="#E0A23C">
                    <animateMotion dur="10s" repeatCount="indefinite" path="M 10 150 L 290 150" />
                  </circle>
                </>
              )}
            </svg>

            {/* Merkez — radar pulse + pin */}
            <div className="absolute inset-0 flex items-center justify-center">
              {/* Radar halkaları */}
              <div className="absolute w-24 h-24 rounded-full border border-[#E0A23C]/20 animate-ping [animation-duration:2s]" />
              <div className="absolute w-16 h-16 rounded-full border border-[#E0A23C]/25 animate-ping [animation-duration:2s] [animation-delay:0.5s]" />
              <div className="absolute w-8  h-8  rounded-full border border-[#E0A23C]/30 animate-ping [animation-duration:2s] [animation-delay:1s]" />

              {/* İkon + yazı kartı */}
              <div className="relative flex flex-col items-center gap-2.5 z-10">
                <div className="w-10 h-10 rounded-full bg-[#E0A23C]/20 border border-[#E0A23C]/40 flex items-center justify-center shadow-[0_0_24px_rgba(224,162,60,0.3)]">
                  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-[#E0A23C]" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                    <circle cx="12" cy="9" r="2.5" fill="currentColor" fillOpacity="0.4"/>
                  </svg>
                </div>
                <div className="text-center">
                  <div className="text-[#E0A23C] text-[10px] font-black tracking-[0.25em] uppercase">
                    {gpsState.error === 'Son konum kullanılıyor' ? 'Son Konum' :
                     gpsState.error?.includes('Çevrimdışı') ? 'Çevrimdışı Mod' :
                     gpsState.error?.includes('izni') ? 'Zayıf GPS' :
                     'GPS Aranıyor'}
                  </div>
                  <div className="text-slate-500 text-[8px] font-semibold tracking-wider mt-0.5">
                    {gpsState.error ?? 'Sinyal bekleniyor…'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Fallback konum badge — gerçek GPS değil ama harita gösteriliyor */}
        {location && (gpsState.source === 'last_known' || gpsState.source === 'default') && (
          <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 backdrop-blur-sm pointer-events-none">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span className="text-amber-400 text-[9px] font-bold uppercase tracking-wide">
              {gpsState.source === 'last_known' ? 'Son Konum' : 'Çevrimdışı'}
            </span>
          </div>
        )}

        {/* ── HIZ LİMİTİ LEVHASI — PAYLAŞILAN KART ────────────────────────────
         *  Otorite `AVAILABLE`/`ROAD_ONLY`/`AMBIGUOUS`/`CONFLICTED` dışında
         *  ASLA sayı döndürmez; bayat, çelişkili veya çıkarım değerinin ekrana
         *  basılması YAPISAL olarak imkânsızdır. Bilinmiyorsa kart tamamen
         *  GİZLENİR — "—" YAZILMAZ. Kesin olmayan sayı kesikli çerçeveyle ve
         *  altındaki kaynak etiketiyle AYIRT EDİLİR.
         *  Konum: sağ üst, kaynak rozetinin ALTINDA; sağ alttaki hız
         *  göstergesiyle ve tema kartının +/- düğmeleriyle çakışmaz.
         *  Animasyon YOK — sürüşte dikkat dağıtmaz.                            */}
        <div className="absolute z-20 pointer-events-none" style={{ top: 34, right: 8 }}>
          <SpeedLimitCard limit={speedLimit} size="mini" />
        </div>

        {/* ── ARACI ORTALA — KANONİK KAMERA OTORİTESİNDEN ─────────────────────
         *  Araç merkezdeyken (FOLLOWING) düğme GİZLİ; kullanıcı haritayı
         *  kaydırınca çıkar. Tek dokunuş, uzun basma YOK, toast YOK.
         *  Konum ÜST-ORTA: sol-alt nav şeridi, sağ-alt hız göstergesi, sağ-üst
         *  kaynak rozeti ve tema kartının +/- düğmeleriyle çakışmaz.
         *  Dokunma hedefi 44 px — sürüşte parmakla erişilebilir.               */}
        {camera.recenterAvailable && (
          <button
            onClick={recenterOnVehicle}
            aria-label="Aracı ortala"
            title="Aracı ortala"
            className="absolute z-20 flex items-center justify-center rounded-full active:scale-90 transition-all"
            style={{
              top: 8, left: '50%', transform: 'translateX(-50%)',
              width: 44, height: 44,
              background: 'rgba(10,14,26,0.92)',
              backdropFilter: 'blur(12px)',
              border: '1.5px solid rgba(224,162,60,0.55)',
              boxShadow: '0 4px 18px rgba(0,0,0,0.55)',
              cursor: 'pointer',
            }}
          >
            <Crosshair className="w-5 h-5" style={{ color: '#E8B86A' }} />
          </button>
        )}

        {/* ── AKTİF NAVİGASYON ŞERİDİ (SESSION CONTINUITY P0) ──────────────────
         *  Tam ekran kapatıldığında oturum yaşamaya devam eder; kullanıcı ana
         *  ekranda rotayı, kalan mesafeyi, ETA'yı ve sıradaki manevrayı burada
         *  görür. DÜRÜSTLÜK: yalnız kanıtı olan alan yazılır — manevra metni
         *  yoksa satır hiç render edilmez, ölçü yoksa "—" gösterilir. Şerit
         *  bilgisi / dönel kavşak çıkışı burada HİÇ üretilmez.                 */}
        {isNavigating && (() => {
          const step = route.steps[route.currentStepIndex];
          // Manevra metni: talimat → yoksa cadde adı → yoksa satır YOK.
          const maneuver = step?.instruction?.trim() || step?.streetName?.trim() || null;
          // Manevraya mesafe: yalnız yöntemi bilinen ölçü gösterilir.
          const turnM = (route.distanceToNextTurnSource !== 'UNKNOWN' &&
                         Number.isFinite(route.distanceToNextTurnMeters) &&
                         route.distanceToNextTurnMeters > 0)
            ? route.distanceToNextTurnMeters : null;
          // Kalan mesafe: canlı ilerleme → yoksa rotanın toplam mesafesi (ikisi de
          // ölçülmüş değerdir; uydurma yok). İkisi de yoksa "—".
          const remainM = (distanceMeters != null && Number.isFinite(distanceMeters) && distanceMeters > 10)
            ? distanceMeters
            : (route.totalDistanceMeters > 0 ? route.totalDistanceMeters : null);
          const etaTxt = (etaSeconds != null && Number.isFinite(etaSeconds))
            ? formatEta(etaSeconds) : '—';
          const phase =
            navStatus === NavStatus.REROUTING ? 'YENİDEN HESAPLANIYOR' :
            navStatus === NavStatus.ARRIVED   ? 'VARDINIZ'             :
            navStatus === NavStatus.ROUTING   ? 'ROTA HESAPLANIYOR'    :
            navStatus === NavStatus.PREVIEW   ? 'ÖNİZLEME'             : null;

          return (
            <div className="absolute bottom-2 left-2 z-20 max-w-[68%] pointer-events-auto">
              <div
                className="flex flex-col gap-1 px-2.5 py-1.5 rounded-xl bg-black/65 backdrop-blur-xl shadow-lg"
                style={{ border: '1px solid rgba(224,162,60,0.35)' }}
              >
                {/* Başlık satırı — hedef + sonlandır */}
                <div className="flex items-center gap-1.5">
                  <Navigation2 className="w-3 h-3 text-[#E0A23C] flex-shrink-0" />
                  <span className="text-[9px] font-black tracking-widest uppercase text-[#E0A23C] truncate">
                    {phase ?? (destination?.name ?? 'NAVİGASYON')}
                  </span>
                  {isOfflineResult && (
                    <span className="text-[7px] font-black tracking-wider uppercase px-1 py-px rounded bg-amber-500/15 text-amber-400 flex-shrink-0">
                      ÇEVRİMDIŞI
                    </span>
                  )}
                  <button
                    onClick={endNavigation}
                    className="ml-auto w-5 h-5 rounded-md bg-white/10 border border-white/20 flex items-center justify-center text-white/70 active:scale-90 transition-all flex-shrink-0"
                    title="Navigasyonu sonlandır"
                    aria-label="Navigasyonu sonlandır"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>

                {/* Sıradaki manevra — kanıt yoksa satır YOK */}
                {maneuver && (
                  <div className="flex items-baseline gap-1.5">
                    {turnM !== null && (
                      <span className="text-[10px] font-black tabular-nums text-white flex-shrink-0">
                        {formatDistance(turnM)}
                      </span>
                    )}
                    <span className="text-[9px] font-bold text-white/70 truncate">{maneuver}</span>
                  </div>
                )}

                {/* Kalan mesafe · ETA */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black tabular-nums text-white">
                    {remainM !== null ? formatDistance(remainM) : '—'}
                  </span>
                  <span className="text-white/20 text-[9px]">•</span>
                  <span className="text-[10px] font-black tabular-nums text-[#E0A23C]">{etaTxt}</span>
                </div>
              </div>
            </div>
          );
        })()}

        {tileError && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
            <div className="flex flex-col items-center gap-1.5 px-3 py-2 rounded-xl bg-black/60 backdrop-blur-md border border-red-500/30">
              <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              <span className="text-red-400 text-[9px] font-semibold tracking-wide uppercase">Harita yüklenemiyor</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});


