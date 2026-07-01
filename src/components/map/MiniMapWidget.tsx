import { useEffect, useRef, useState, memo } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

type MapRef = MapLibreMap & { _initialized?: boolean };
import { Maximize2 } from 'lucide-react';
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
} from '../../platform/mapService';
import { useGPSLocation, useGPSHeading, useGPSState } from '../../platform/gpsService';
import { useFusedSpeed } from '../../platform/speedFusion';
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
  const lastAppliedLatRef = useRef(0);
  const lastAppliedLngRef = useRef(0);

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
  const { displaySpeed: fusedSpeedKmh } = useFusedSpeed();

  // Sync refs safely outside of render
  useEffect(() => {
    locationRef.current = location;
    headingRef.current = heading;
  }, [location, heading]);

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
    if (!mapRef.current.isStyleLoaded()) return;

    const { latitude, longitude } = location;
    // speed: GPS m/s → km/h (null/undefined → 0)
    const speedKmh = location.speed != null && Number.isFinite(location.speed)
      ? location.speed * 3.6
      : 0;
    const hdg = heading || 0;
    const isDriving = speedKmh > 5; // 5 km/h eşiği — park/yürüyüş ayrımı

    if (!mapRef.current._initialized) {
      addUserMarker(mapRef.current, latitude, longitude, hdg);
      // Başlangıç zoom: sokak seviyesi (16 = tek tek sokaklar görünür)
      setMapCenter(mapRef.current, [longitude, latitude], 16, true);
      mapRef.current._initialized = true;
      wasDrivingRef.current = isDriving;
      lastAppliedLatRef.current = latitude;
      lastAppliedLngRef.current = longitude;
    } else if (isDriving) {
      // Sürüş modu: hıza göre zoom + heading rotasyonu + look-ahead offset (her fix uygulanır)
      updateUserMarker(latitude, longitude, hdg);
      const containerH = containerRef.current?.offsetHeight ?? 400;
      setDrivingView(mapRef.current, latitude, longitude, hdg, speedKmh, containerH);
      wasDrivingRef.current = true;
      lastAppliedLatRef.current = latitude;
      lastAppliedLngRef.current = longitude;
    } else {
      // P2-B: Dur/park. Sürüşten YENİ çıktıysak bir kez kamerayı düzleştir (exitDrivingView);
      // aksi halde GPS titremesi (≈metre-altı) için hiçbir GL işi yapma — RenderThread burst'ü
      // önlenir. Konum gerçekten kayda değer kadar (≈25m, 0.00025°) değiştiyse marker+merkez güncellenir.
      const movedDeg = Math.abs(latitude - lastAppliedLatRef.current) +
                       Math.abs(longitude - lastAppliedLngRef.current);
      if (wasDrivingRef.current) {
        exitDrivingView(mapRef.current);
        wasDrivingRef.current = false;
      }
      if (movedDeg > 0.00025) {
        updateUserMarker(latitude, longitude, hdg);
        lastAppliedLatRef.current = latitude;
        lastAppliedLngRef.current = longitude;
        const center = mapRef.current.getCenter();
        const dist = Math.sqrt(
          Math.pow(longitude - center.lng, 2) + Math.pow(latitude - center.lat, 2)
        );
        if (dist > 0.002) {
          setMapCenter(mapRef.current, [longitude, latitude], 16.5, true);
        }
      }
    }
  }, [location, heading, mapReady, styleKey]);

  // Hız: PremiumSpeedometer ile aynı kaynak (CAN→OBD→GPS füzyon)
  const speedKmh = fusedSpeedKmh;

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


