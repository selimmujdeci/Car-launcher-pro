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
  setMapHeading,
  switchMapStyle,
  useMapState,
} from '../../platform/mapService';
import { useGPSLocation, useGPSHeading, startGPSTracking } from '../../platform/gpsService';
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
  const mode = useMapMode();
  const { tileError } = useMapState();

  // Sync refs safely outside of render
  useEffect(() => {
    locationRef.current = location;
    headingRef.current = heading;
  }, [location, heading]);

  // Init map — runs exactly once when container is available and has dimensions
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
          console.error('MiniMap init failed:', err);
        }
      })();

      cleanupRef.current = () => {
        cancelled = true;
        if (mapRef.current) {
          destroyMap();
        }
      };
    }

    return () => {
      cleanupRef.current?.();
    };
  }, []);

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
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update map when location changes (or map/style becomes ready)
  useEffect(() => {
    if (!mapRef.current || !location || !mapReady) return;
    if (!mapRef.current.isStyleLoaded()) return;

    const { latitude, longitude } = location;

    if (!mapRef.current._initialized) {
      addUserMarker(mapRef.current, latitude, longitude, heading || 0);
      setMapCenter(mapRef.current, [longitude, latitude], 14, true);
      mapRef.current._initialized = true;
    } else {
      updateUserMarker(latitude, longitude, heading || 0);
      const center = mapRef.current.getCenter();
      const dist = Math.sqrt(
        Math.pow(longitude - center.lng, 2) + Math.pow(latitude - center.lat, 2)
      );
      if (dist > 0.005) {
        setMapCenter(mapRef.current, [longitude, latitude], undefined, false);
      }
    }

    if (heading && isFinite(heading)) {
      setMapHeading(mapRef.current, heading);
    }
  }, [location, heading, mapReady, styleKey]);

  return (
    <div className="w-full h-full min-h-0 min-w-0 bg-gradient-to-br from-[#0c1428] to-[#080e1c] rounded-3xl shadow-[0_8px_40px_rgba(0,0,0,0.5)] border border-white/[0.08] flex flex-col overflow-hidden relative">
      {/* Ambient glow */}
      <div className="absolute -top-12 -left-12 w-32 h-32 bg-blue-600/[0.05] rounded-full blur-[40px] pointer-events-none" />

      {/* Header — flex-shrink-0 so it never grows or collapses the map */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 pt-4 pb-2 relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-600 border-2 border-blue-400 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/20">
            <div className={`w-2 h-2 rounded-full ${location ? 'bg-emerald-300 animate-pulse shadow-[0_0_8px_rgba(110,231,183,0.8)]' : 'bg-white opacity-40'}`} />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-blue-400 font-black text-[11px] tracking-[0.2em] uppercase mb-0.5">NAVİGASYON</span>
            <span className="text-white text-[13px] font-black tracking-wide">MİNİ HARİTA</span>
          </div>
        </div>
        {onFullScreenClick && (
          <button
            onClick={onFullScreenClick}
            className="w-10 h-10 rounded-2xl bg-white/10 border-2 border-white/20 flex items-center justify-center text-white hover:bg-white/20 active:scale-90 transition-all duration-150 flex-shrink-0 shadow-md"
            title="Tam ekran"
          >
            <Maximize2 className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Map container — flex-1 + min-h-0 ensures it fills remaining space without overflow */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 min-w-0 mx-3 mb-3 rounded-2xl overflow-hidden bg-[#05080f] border border-white/5 relative"
      >
        <MapOverlay location={location} heading={heading} compact={true} />
        {tileError && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-1.5 px-3 py-2 rounded-xl bg-black/70 border border-red-500/30 backdrop-blur-sm">
              <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              <span className="text-red-400 text-[9px] font-semibold tracking-wide uppercase">Harita yüklenemiyor</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
