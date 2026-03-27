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
    <div className="h-full bg-gradient-to-br from-[#0c1428] to-[#080e1c] rounded-3xl shadow-[0_8px_40px_rgba(0,0,0,0.5),0_0_40px_rgba(37,99,235,0.03)] border border-white/[0.08] p-3 flex flex-col overflow-hidden relative">
      {/* Ambient glow in widget */}
      <div className="absolute -top-12 -left-12 w-32 h-32 bg-blue-600/[0.05] rounded-full blur-[40px] pointer-events-none" />

      {/* Minimal header */}
      <div className="flex items-center justify-between flex-shrink-0 px-2 pb-2.5 relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-blue-600/20 border border-blue-500/25 flex items-center justify-center flex-shrink-0">
            <div className={`w-1.5 h-1.5 rounded-full ${location ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-blue-400 opacity-40'}`} />
          </div>
          <div className="flex flex-col">
            <span className="text-blue-400/60 text-[9px] tracking-[0.2em] uppercase font-black leading-none mb-0.5">Navigasyon</span>
            <span className="text-white text-[11px] font-bold tracking-wide">Mini Harita</span>
          </div>
        </div>
        {onFullScreenClick && (
          <button
            onClick={onFullScreenClick}
            className="w-8 h-8 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.1] active:scale-90 transition-all duration-150"
            title="Tam ekran"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Map container — always rendered */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 rounded-2xl overflow-hidden bg-[#05080f] border border-white/5 shadow-inner"
        style={{ position: 'relative' }}
      >
        <MapOverlay location={location} heading={heading} compact={true} />
      </div>
    </div>
  );
});
