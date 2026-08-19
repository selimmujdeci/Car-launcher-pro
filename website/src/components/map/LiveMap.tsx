'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MLMap, GeoJSONSource } from 'maplibre-gl';
import type { LiveVehicle } from '@/types/realtime';
import { TIMING } from '@/lib/constants';
import { vehicleTitle } from '@/lib/vehicleDisplay';

/**
 * CANLI FİLO HARİTASI.
 *
 * #661 — sahadaki iki kusur:
 *  1. Harita HER ZAMAN Türkiye genelinde (zoom 5,8) açılıyordu. Tek araçlı bir
 *     filoda ekranda yol/sokak değil, boş ülke silueti görünüyordu; kullanıcı
 *     bunu "harita çok kötü duruyor" diye tarif etti. Artık araç konumları
 *     bilinir bilinmez kadraja alınır (tek araç → sokak seviyesi zoom).
 *  2. Araç noktası 7 px'lik düz daireydi ve etiketi ancak zoom 10+'ta çıkıyordu;
 *     dokunmatik ekranda isabet alanı yoktu. Artık görünmez bir isabet halkası
 *     (24 px) + halka/çekirdek işaretçi + zoom 6'dan itibaren okunur ad etiketi
 *     var.
 */

/** Karo stilleri — ikisi de CARTO tabanı (atıflı, ticari kullanıma uygun). */
const MAP_STYLES = {
  /** Gece paneli için koyu taban. */
  dark:  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  /** Yol/sokak/POI kontrastı yüksek "net" taban. */
  clear: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
} as const;

export type MapStyleKey = keyof typeof MAP_STYLES;

const TURKEY_CENTER: [number, number] = [32.5, 39.5];
const TURKEY_ZOOM = 5.8;
/** Tek aracın kadrajı — sokak adları okunur seviyede. */
const SINGLE_VEHICLE_ZOOM = 15;

interface Props {
  vehicles: LiveVehicle[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  followMode?: boolean;
  className?: string;
  /** Taban stili — dışarıdan verilmezse koyu. */
  styleKey?: MapStyleKey;
  /** Haritanın üstüne stil değiştirici koy. */
  showStyleToggle?: boolean;
  /* NOT: `className` KONUMLANDIRILMIŞ bir kutu vermelidir (`absolute`
     ya da `relative`) — harita kabı ve üst katmanlar ona göre yerleşir. */
}

interface VehicleFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    id: string;
    label: string;
    driver: string;
    speed: number;
    status: string;
    selected: number;
  };
}

function positioned(vehicles: LiveVehicle[]): LiveVehicle[] {
  return vehicles.filter(
    (v) => v.lat !== 0 && v.lng !== 0 && Number.isFinite(v.lat) && Number.isFinite(v.lng),
  );
}

function buildGeoJSON(vehicles: LiveVehicle[], selectedId?: string | null) {
  return {
    type: 'FeatureCollection' as const,
    features: positioned(vehicles).map<VehicleFeature>((v) => ({
      type: 'Feature',
      id: v.id,
      geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
      properties: {
        id: v.id,
        /* Etiket TEK otoriteden gelir — UUID asla plaka diye yazılmaz. */
        label: vehicleTitle(v),
        driver: v.driver,
        speed: Math.round(v.speed),
        status: v.status,
        selected: v.id === selectedId ? 1 : 0,
      },
    })),
  };
}

export default function LiveMap({
  vehicles,
  selectedId,
  onSelect,
  followMode,
  className,
  styleKey = 'dark',
  showStyleToggle = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<MLMap | null>(null);
  const loadedRef    = useRef(false);
  /* Kadraj bir kez otomatik kurulur; kullanıcı haritayı eline aldıysa
     otomatik hareket ARTIK YAPILMAZ (kamerayı kullanıcıdan geri almayız). */
  const autoFramedRef = useRef(false);
  const userMovedRef  = useRef(false);

  const [activeStyle, setActiveStyle] = useState<MapStyleKey>(styleKey);
  useEffect(() => { setActiveStyle(styleKey); }, [styleKey]);

  // Keep latest callbacks/values in refs to avoid stale closures in event handlers
  const onSelectRef   = useRef(onSelect);
  const vehiclesRef   = useRef(vehicles);
  const selectedIdRef = useRef(selectedId);
  const followModeRef = useRef(followMode);

  onSelectRef.current   = onSelect;
  vehiclesRef.current   = vehicles;
  selectedIdRef.current = selectedId;
  followModeRef.current = followMode;

  /** Araçları kadraja al — tek araçta sokak zoomu, çoklu araçta sınırlar. */
  const frameVehicles = useCallback((animate: boolean) => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const list = positioned(vehiclesRef.current);
    if (list.length === 0) return;

    if (list.length === 1) {
      const v = list[0];
      const camera = { center: [v.lng, v.lat] as [number, number], zoom: SINGLE_VEHICLE_ZOOM };
      if (animate) map.easeTo({ ...camera, duration: 700 });
      else map.jumpTo(camera);
      return;
    }

    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const v of list) {
      if (v.lng < minLng) minLng = v.lng;
      if (v.lat < minLat) minLat = v.lat;
      if (v.lng > maxLng) maxLng = v.lng;
      if (v.lat > maxLat) maxLat = v.lat;
    }
    map.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      { padding: 56, maxZoom: 14, duration: animate ? 700 : 0 },
    );
  }, []);

  /** Katman/kaynak kurulumu — stil her değiştiğinde yeniden çalışır. */
  const installLayers = useCallback((map: MLMap) => {
    if (map.getSource('vehicles')) return;

    map.addSource('vehicles', {
      type: 'geojson',
      data: buildGeoJSON(vehiclesRef.current, selectedIdRef.current),
    });

    // Alarm halo
    map.addLayer({
      id: 'vehicle-halo',
      type: 'circle',
      source: 'vehicles',
      filter: ['==', ['get', 'status'], 'alarm'],
      paint: {
        'circle-radius': 22,
        'circle-color': '#f87171',
        'circle-opacity': 0.22,
        'circle-blur': 0.7,
      },
    });

    // Yumuşak parıltı — noktayı koyu VE açık tabanda ayırt edilir kılar
    map.addLayer({
      id: 'vehicle-glow',
      type: 'circle',
      source: 'vehicles',
      filter: ['!=', ['get', 'status'], 'offline'],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'selected'], 1], 26, 18],
        'circle-color': ['match', ['get', 'status'], 'alarm', '#f87171', '#34d399'],
        'circle-opacity': 0.16,
        'circle-blur': 0.55,
      },
    });

    // Ana nokta — beyaz kenarlık her taban stilinde kontrast verir
    map.addLayer({
      id: 'vehicles',
      type: 'circle',
      source: 'vehicles',
      paint: {
        'circle-radius': ['case', ['==', ['get', 'selected'], 1], 12, 9],
        'circle-color': [
          'match', ['get', 'status'],
          'online', '#34d399',
          'alarm',  '#f87171',
          /* offline */ '#9ca3af',
        ],
        'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 3.5, 2.5],
        'circle-stroke-color': '#ffffff',
      },
    });

    /* DOKUNMA İSABET HALKASI — görünmez, yalnız parmak hedefini büyütür.
       9 px'lik bir daire dokunmatik ekranda güvenilir hedef değildir. */
    map.addLayer({
      id: 'vehicle-hit',
      type: 'circle',
      source: 'vehicles',
      paint: { 'circle-radius': 24, 'circle-color': '#000000', 'circle-opacity': 0.01 },
    });

    // Ad etiketi — zoom 6'dan itibaren görünür (eskiden 10+'taydı)
    map.addLayer({
      id: 'vehicle-labels',
      type: 'symbol',
      source: 'vehicles',
      minzoom: 6,
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 12,
        'text-offset': [0, -1.6],
        'text-anchor': 'bottom',
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#000000',
        'text-halo-width': 1.6,
      },
    });
  }, []);

  // ── Map initialisation — runs once ────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    import('maplibre-gl').then((ml) => {
      if (cancelled || !containerRef.current) return;

      const map = new ml.Map({
        container: containerRef.current,
        style: MAP_STYLES[activeStyle],
        center: TURKEY_CENTER,
        zoom: TURKEY_ZOOM,
        attributionControl: false,
        maxZoom: 19,
      }) as unknown as MLMap;

      mapRef.current = map;

      (map as unknown as { addControl(c: unknown, pos?: string): void }).addControl(
        new ml.AttributionControl({ compact: true }),
        'bottom-right',
      );
      (map as unknown as { addControl(c: unknown, pos?: string): void }).addControl(
        new ml.NavigationControl({ showCompass: false }),
        'bottom-right',
      );

      /* Kullanıcı kamerayı eline aldı mı? (programatik hareket sayılmaz) */
      map.on('dragstart', () => { userMovedRef.current = true; });
      map.on('zoomstart', (e: unknown) => {
        if ((e as { originalEvent?: unknown }).originalEvent) userMovedRef.current = true;
      });

      map.on('load', () => {
        if (cancelled) { map.remove(); return; }
        loadedRef.current = true;

        resizeObserver = new ResizeObserver(() => {
          if (mapRef.current) mapRef.current.resize();
        });
        if (containerRef.current) resizeObserver.observe(containerRef.current);

        installLayers(map);

        /* Konumlar zaten elimizdeyse ilk kadrajı ANİMASYONSUZ kur —
           kullanıcı boş ülke haritasını hiç görmesin. */
        if (positioned(vehiclesRef.current).length > 0 && !userMovedRef.current) {
          autoFramedRef.current = true;
          frameVehicles(false);
        }

        map.on('click', 'vehicle-hit', (e) => {
          const id = (e as unknown as { features?: Array<{ properties?: { id?: string } }> })
            .features?.[0]?.properties?.id;
          onSelectRef.current?.(id ?? null);
        });

        // Boş alana tıklama → seçimi bırak
        map.on('click', (e) => {
          const features = map.queryRenderedFeatures(
            (e as unknown as { point: { x: number; y: number } }).point as unknown as [number, number],
            { layers: ['vehicle-hit'] },
          );
          if (!features.length) onSelectRef.current?.(null);
        });

        map.on('mouseenter', 'vehicle-hit', () => {
          (map.getCanvas() as HTMLCanvasElement).style.cursor = 'pointer';
        });
        map.on('mouseleave', 'vehicle-hit', () => {
          (map.getCanvas() as HTMLCanvasElement).style.cursor = '';
        });
      });
    });

    return () => {
      cancelled = true;
      loadedRef.current = false;
      if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Stil değişimi — katmanlar yeni stile yeniden kurulur ──────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    map.setStyle(MAP_STYLES[activeStyle]);

    const onStyleData = () => {
      if (!mapRef.current || !map.isStyleLoaded()) return;
      installLayers(map);
      const source = map.getSource('vehicles') as GeoJSONSource | undefined;
      source?.setData(
        buildGeoJSON(vehiclesRef.current, selectedIdRef.current) as Parameters<GeoJSONSource['setData']>[0],
      );
      map.off('styledata', onStyleData);
    };
    map.on('styledata', onStyleData);

    return () => { map.off('styledata', onStyleData); };
  }, [activeStyle, installLayers]);

  // ── Update GeoJSON when vehicles or selection changes ─────────────────
  useEffect(() => {
    if (!loadedRef.current || !mapRef.current) return;
    const source = mapRef.current.getSource('vehicles') as GeoJSONSource | undefined;
    source?.setData(buildGeoJSON(vehicles, selectedId) as Parameters<GeoJSONSource['setData']>[0]);

    /* İlk konum sonradan geldiyse (araç açılışta konumsuzdu) kadrajı O AN kur. */
    if (!autoFramedRef.current && !userMovedRef.current && positioned(vehicles).length > 0) {
      autoFramedRef.current = true;
      frameVehicles(true);
    }
  }, [vehicles, selectedId, frameVehicles]);

  // ── Follow mode — easeTo selected vehicle ─────────────────────────────
  useEffect(() => {
    if (!followMode || !selectedId || !loadedRef.current || !mapRef.current) return;
    const v = vehicles.find((v) => v.id === selectedId);
    if (!v || v.lat === 0) return;
    mapRef.current.easeTo({
      center: [v.lng, v.lat],
      zoom: Math.max(mapRef.current.getZoom(), 13),
      duration: TIMING.MAP_THROTTLE_MS,
    });
  }, [followMode, selectedId, vehicles]);

  /** Araçları yeniden kadraja al. */
  const recenter = useCallback(() => {
    userMovedRef.current = false;
    frameVehicles(true);
  }, [frameVehicles]);

  /* ⚠️ SARMALAYICIYA INLINE `position` VERİLMEZ.
     İlk denemede sarmalayıcıya inline bir konum stili (relative) konmuştu;
     inline stil Tailwind'in `absolute inset-0` sınıfını EZDİĞİ için kutu
     akışa düşüyor, `h-full` yüzdesi flex ebeveynde çözülemiyor ve harita
     kabı 0 YÜKSEKLİKTE kalıyordu → ekran tamamen siyah, zoom kontrolleri bile
     çizilmiyordu. Konumlandırma TAMAMEN `className`e aittir; çağıran taraf
     konumlandırılmış bir kutu vermek ZORUNDADIR (`absolute`/`relative`). */
  return (
    <div className={className}>
      <div ref={containerRef} className="absolute inset-0" style={{ background: '#0d1117' }} />

      {showStyleToggle && (
        <div
          className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-xl p-1"
          style={{
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          {([['dark', 'Koyu'], ['clear', 'Net']] as Array<[MapStyleKey, string]>).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveStyle(key)}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors ${
                activeStyle === key ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/70'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={recenter}
            title="Araçları kadraja al"
            className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white/80 transition-colors"
          >
            Ortala
          </button>
        </div>
      )}
    </div>
  );
}
