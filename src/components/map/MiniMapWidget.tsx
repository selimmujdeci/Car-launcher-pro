import { useEffect, useRef, useState, memo } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

type MapRef = MapLibreMap & { _initialized?: boolean };
import { Maximize2 } from 'lucide-react';
import {
  initializeMap,
  setMapCenter,
  addUserMarker,
  updateUserMarker,
  destroyMap,
  switchMapStyle,
  setDrivingView,
  exitDrivingView,
  useMapState,
  checkAndHealMapContext,
} from '../../platform/mapService';
import { useGPSLocation, useGPSHeading, useGPSState } from '../../platform/gpsService';
import { getMapStyle, useMapMode } from '../../platform/mapSourceManager';
import { MapOverlay } from './MapOverlay';

interface MiniMapWidgetProps {
  onFullScreenClick?: () => void;
}

export const MiniMapWidget = memo(function MiniMapWidget({ onFullScreenClick }: MiniMapWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapRef | null>(null);
  const initDone = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const modeInitRef = useRef(false);
  const locationRef = useRef<ReturnType<typeof useGPSLocation>>(null);
  const headingRef = useRef<number | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [styleKey, setStyleKey] = useState(0);
  const location = useGPSLocation();
  const heading = useGPSHeading();
  const gpsState = useGPSState();
  const mode = useMapMode();
  const { tileError } = useMapState();

  // Sync refs safely outside of render
  useEffect(() => {
    locationRef.current = location;
    headingRef.current = heading;
  }, [location, heading]);

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
      // ResizeObserver fires as soon as the container gets real dimensions —
      // more reliable than rAF on slow Android head units where layout takes >1 frame.
      observer = new ResizeObserver(tryInit);
      observer.observe(el);
      // rAF as secondary safety net
      requestAnimationFrame(tryInit);
    }

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
            // B39: style.load timeout — style hiç gelmezse sonsuza bekleme
            const styleTimeout = setTimeout(() => {
              if (!cancelled) setMapReady(true);
            }, 8000);
            map.once('style.load', () => {
              clearTimeout(styleTimeout);
              if (!cancelled) setMapReady(true);
            });
          }
        } catch (err) {
          console.error('MiniMap init failed:', err);
          // Reset so a subsequent layout change can retry
          if (!cancelled) initDone.current = false;
        }
      })();

      cleanupRef.current = () => {
        cancelled = true;
        initDone.current = false;
        if (mapRef.current) {
          destroyMap();
          mapRef.current = null;
        }
      };
    }

    return () => {
      observer?.disconnect();
      cleanupRef.current?.();
    };
  }, []);

  // Zombi WebGL context guard — Android 9 düşük bellek durumunda GPU
  // context'i sessizce ölebilir. 30 s'de bir kontrol et; kayıpsa haritayı yeniden başlat.
  useEffect(() => {
    if (!mapReady) return;
    const id = setInterval(() => {
      if (!checkAndHealMapContext()) {
        // Context öldü → initDone sıfırla, sonraki GPS effect yeniden mount eder
        initDone.current = false;
        mapRef.current   = null;
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [mapReady]);

  // Mode change — mirror the mode selected in FullMapView
  useEffect(() => {
    if (!modeInitRef.current) {
      modeInitRef.current = true;
      return;
    }
    if (!mapRef.current) return;
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
    } else {
      updateUserMarker(latitude, longitude, hdg);

      if (isDriving) {
        // Sürüş modu: hıza göre zoom + heading rotasyonu + look-ahead offset
        const containerH = containerRef.current?.offsetHeight ?? 400;
        setDrivingView(mapRef.current, latitude, longitude, hdg, speedKmh, containerH);
      } else {
        // Dur/yavaş: sokak seviyesinde statik merkez
        exitDrivingView(mapRef.current);
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

  // GPS hızını km/h olarak hesapla (location.speed m/s cinsinden depolanır)
  const speedKmh = location?.speed != null && Number.isFinite(location.speed) && location.speed > 0
    ? location.speed * 3.6
    : 0;

  return (
    <div className="w-full h-full min-h-0 min-w-0 glass-card flex flex-col overflow-hidden relative border-none !shadow-none">
      {/* Ambient glow */}
      <div className="absolute -top-12 -left-12 w-32 h-32 bg-blue-600/[0.05] rounded-full blur-[40px] pointer-events-none" />

      {/* Header — flex-shrink-0 so it never grows or collapses the map */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 pt-5 pb-2 relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 border-2 border-blue-400 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/20">
            <div className={`w-2.5 h-2.5 rounded-full ${location ? 'bg-emerald-300 animate-pulse shadow-[0_0_10px_rgba(110,231,183,0.8)]' : 'bg-white opacity-40'}`} />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-blue-500 font-black text-[10px] tracking-[0.2em] uppercase mb-0.5">NAVİGASYON</span>
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

      {/* Map container — flex-1 + min-h-0 ensures it fills remaining space without overflow */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 min-w-0 mx-4 mb-4 rounded-[20px] overflow-hidden glass-inner-focus relative"
      >
        <MapOverlay location={location} heading={heading} compact={true} speedKmh={speedKmh} />

        {/* ── Skeletal Loading — harita tile'ları yüklenene kadar AGAMA-tarzı placeholder ──
         *  mapReady=false: MapLibre canvas siyah gösterir; bu overlay boş ekranı saklar.
         *  cubic-bezier(0.4,0,0.2,1) geçişi: Tesla UI motion tasarım dili uyumlu.       */}
        {!mapReady && (
          <div
            className="absolute inset-0 z-10 rounded-[20px] overflow-hidden"
            style={{
              background: 'linear-gradient(160deg, rgba(8,12,28,0.97) 0%, rgba(14,20,42,0.97) 100%)',
              transition: 'opacity 400ms cubic-bezier(0.4,0,0.2,1)',
            }}
          >
            {/* Animasyonlu terrain grid — harita yükleniyor hissi */}
            <svg className="absolute inset-0 w-full h-full opacity-[0.12]" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="sk-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#3b82f6" strokeWidth="0.5"/>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#sk-grid)" />
              {/* Fake road lines */}
              <line x1="30%" y1="0%" x2="30%" y2="100%" stroke="#3b82f6" strokeWidth="1.5" opacity="0.4" />
              <line x1="65%" y1="0%" x2="65%" y2="100%" stroke="#3b82f6" strokeWidth="1"   opacity="0.25" />
              <line x1="0%" y1="40%" x2="100%" y2="40%" stroke="#3b82f6" strokeWidth="1.5" opacity="0.4" />
              <line x1="0%" y1="70%" x2="100%" y2="70%" stroke="#3b82f6" strokeWidth="1"   opacity="0.25" />
            </svg>

            {/* Shimmer sweep — Tesla skeleton animation */}
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(105deg, transparent 40%, rgba(59,130,246,0.06) 50%, transparent 60%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.8s ease-in-out infinite',
              }}
            />

            {/* Merkez yükleme göstergesi */}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <div className="w-8 h-8 rounded-full border-2 border-blue-500/40 border-t-blue-400 animate-spin" />
              <span className="text-[9px] font-black tracking-[0.25em] uppercase text-blue-400/60">
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
                  <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#3b82f6" strokeWidth="0.5"/>
                </pattern>
                <mask id="grid-mask">
                  <rect width="100%" height="100%" fill="url(#grid)" />
                </mask>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
              
              {/* Fake traffic dots */}
              <circle r="1.5" fill="#60a5fa">
                <animateMotion dur="8s" repeatCount="indefinite" path="M 10 10 L 290 10 L 290 290 L 10 290 Z" />
              </circle>
              <circle r="1.5" fill="#f87171">
                <animateMotion dur="12s" repeatCount="indefinite" path="M 150 10 L 150 290" />
              </circle>
              <circle r="1.5" fill="#60a5fa">
                <animateMotion dur="10s" repeatCount="indefinite" path="M 10 150 L 290 150" />
              </circle>
            </svg>

            {/* Merkez — radar pulse + pin */}
            <div className="absolute inset-0 flex items-center justify-center">
              {/* Radar halkaları */}
              <div className="absolute w-24 h-24 rounded-full border border-blue-500/20 animate-ping [animation-duration:2s]" />
              <div className="absolute w-16 h-16 rounded-full border border-blue-500/25 animate-ping [animation-duration:2s] [animation-delay:0.5s]" />
              <div className="absolute w-8  h-8  rounded-full border border-blue-500/30 animate-ping [animation-duration:2s] [animation-delay:1s]" />

              {/* İkon + yazı kartı */}
              <div className="relative flex flex-col items-center gap-2.5 z-10">
                <div className="w-10 h-10 rounded-full bg-blue-600/20 border border-blue-500/40 flex items-center justify-center shadow-[0_0_24px_rgba(59,130,246,0.3)]">
                  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-blue-400" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                    <circle cx="12" cy="9" r="2.5" fill="currentColor" fillOpacity="0.4"/>
                  </svg>
                </div>
                <div className="text-center">
                  <div className="text-blue-300 text-[10px] font-black tracking-[0.25em] uppercase">
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


