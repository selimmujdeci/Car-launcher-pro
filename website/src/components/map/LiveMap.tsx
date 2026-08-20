'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MLMap, GeoJSONSource } from 'maplibre-gl';
import type { LiveVehicle } from '@/types/realtime';
import { TIMING } from '@/lib/constants';
import { vehicleTitle } from '@/lib/vehicleDisplay';
import {
  MAP_STYLE_URL,
  baseForTheme,
  loadingBackdrop,
  nightRoadColor,
  isLabelLayer,
  NIGHT_BACKGROUND,
  NIGHT_LABEL,
  NIGHT_WATER,
} from '@/lib/console/mapStyle';
import {
  CONSOLE_THEME_ATTR,
  normalizeTheme,
  readStoredTheme,
  type ConsoleTheme,
} from '@/lib/console/consoleTheme';

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

/** Taban ve gece okunurluk kuralları tek yerde (`mapStyle`). */
const MAP_STYLES: Record<MapStyleKey, string> = {
  dark:  MAP_STYLE_URL.night,
  clear: MAP_STYLE_URL.day,
};

export type MapStyleKey = 'dark' | 'clear';

/** Konsol teması → taban anahtarı. Harita uygulamanın temasını TAKİP EDER. */
function styleKeyForTheme(theme: ConsoleTheme): MapStyleKey {
  return baseForTheme(theme) === 'day' ? 'clear' : 'dark';
}

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
  /** Taban stili. VERİLMEZSE konsol temasını takip eder (önerilen). */
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
  styleKey,
  showStyleToggle = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<MLMap | null>(null);
  const loadedRef    = useRef(false);
  /* Kadraj bir kez otomatik kurulur; kullanıcı haritayı eline aldıysa
     otomatik hareket ARTIK YAPILMAZ (kamerayı kullanıcıdan geri almayız). */
  const autoFramedRef = useRef(false);
  const userMovedRef  = useRef(false);

  /* HARİTA UYGULAMANIN TEMASINI TAKİP EDER (#665).
     ── TEK OTORİTE, TÜRETİLMİŞ DEĞER ──
     Önce iki ayrı state (tema + taban) senkron tutulmaya çalışılmıştı ve
     ÖLÇÜLDÜ ki ayrışıyorlar: harita `voyager` yüklerken düğme hâlâ "Koyu"yu
     işaretliyordu — çünkü tabanı belirleyen `useState` başlangıcı ile
     effect'te okunan attribute farklı anlarda değerleniyordu. Artık taban
     RENDER SIRASINDA TÜRETİLİR: manuel seçim varsa o, yoksa tema. Senkron
     tutulacak ikinci bir kopya YOKTUR. */
  const [themeState, setThemeState] = useState<ConsoleTheme>(() => readStoredTheme());
  const [override, setOverride] = useState<MapStyleKey | null>(styleKey ?? null);

  useEffect(() => { if (styleKey) setOverride(styleKey); }, [styleKey]);

  /* `<html data-console>` tek kaynaktır; ayrı bir tema aboneliği KURULMAZ. */
  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      const raw = root.getAttribute(CONSOLE_THEME_ATTR);
      setThemeState(raw ? normalizeTheme(raw) : readStoredTheme());
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: [CONSOLE_THEME_ATTR] });
    return () => observer.disconnect();
  }, []);

  const activeStyle: MapStyleKey = override ?? styleKeyForTheme(themeState);

  /* `load` handler bir kez kurulur; o an geçerli tabanı ref'ten okur
     (closure'da donmuş eski değeri kullanmasın). */
  const activeStyleRef = useRef<MapStyleKey>(activeStyle);

  // Keep latest callbacks/values in refs to avoid stale closures in event handlers
  const onSelectRef   = useRef(onSelect);
  const vehiclesRef   = useRef(vehicles);
  const selectedIdRef = useRef(selectedId);
  const followModeRef = useRef(followMode);

  activeStyleRef.current = activeStyle;
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

  /**
   * GECE OKUNURLUK YAMASI (#665).
   *
   * ÖLÇÜLDÜ: CARTO dark-matter'da yol DOLGULARI `#0b0b0b` — zeminden ayırt
   * edilemiyor; kullanıcı bunu *"kapkara bir şey"* diye tarif etti. Stil
   * yüklendikten sonra yol katmanları hiyerarşiye göre parlatılır, zemin bir
   * tık açılır, etiketler okunur hâle getirilir. Kuralı olmayan katmana
   * DOKUNULMAZ — stilin kendi kimliği korunur.
   *
   * Yalnız gece tabanında çalışır; gündüz tabanı (voyager) zaten okunur.
   */
  const applyNightLegibility = useCallback((map: MLMap) => {
    let style: { layers?: Array<{ id: string; type: string }> } | undefined;
    try {
      style = map.getStyle() as unknown as { layers?: Array<{ id: string; type: string }> };
    } catch {
      return; /* stil henüz hazır değilse yama atlanır — ekran çökmez */
    }
    const layers = style?.layers;
    if (!Array.isArray(layers)) return;

    const setPaint = (id: string, prop: string, value: string) => {
      try {
        (map as unknown as { setPaintProperty(i: string, p: string, v: unknown): void })
          .setPaintProperty(id, prop, value);
      } catch {
        /* Katman bu stilde yoksa/özellik desteklenmiyorsa sessizce geç. */
      }
    };

    for (const layer of layers) {
      if (layer.type === 'background') {
        setPaint(layer.id, 'background-color', NIGHT_BACKGROUND);
        continue;
      }
      if (layer.type === 'line') {
        const color = nightRoadColor(layer.id);
        if (color) setPaint(layer.id, 'line-color', color);
        else if (/water/i.test(layer.id)) setPaint(layer.id, 'line-color', NIGHT_WATER);
        continue;
      }
      if (layer.type === 'fill' && /water/i.test(layer.id)) {
        setPaint(layer.id, 'fill-color', NIGHT_WATER);
        continue;
      }
      if (layer.type === 'symbol' && isLabelLayer(layer.id)) {
        setPaint(layer.id, 'text-color', NIGHT_LABEL.text);
        setPaint(layer.id, 'text-halo-color', NIGHT_LABEL.halo);
      }
    }
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
        style: MAP_STYLES[activeStyleRef.current],
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

        if (activeStyleRef.current === 'dark') applyNightLegibility(map);
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
      if (activeStyle === 'dark') applyNightLegibility(map);
      installLayers(map);
      const source = map.getSource('vehicles') as GeoJSONSource | undefined;
      source?.setData(
        buildGeoJSON(vehiclesRef.current, selectedIdRef.current) as Parameters<GeoJSONSource['setData']>[0],
      );
      map.off('styledata', onStyleData);
    };
    map.on('styledata', onStyleData);

    return () => { map.off('styledata', onStyleData); };
  }, [activeStyle, installLayers, applyNightLegibility]);

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
      {/* ⚠️ KONUMLANDIRMA INLINE VERİLİR — SINIFLA DEĞİL (#664).
          MapLibre'nin kendi stil sayfası `.maplibregl-map { position: relative }`
          kuralını taşır ve Next.js onu Tailwind utilities'ten SONRA yerleştirir;
          yani `absolute inset-0` sınıfı ÖLÜDÜR. ÖLÇÜLDÜ (Playwright, /maptest):
          kap `position: relative`, `height: 0` → canvas oluşuyor ama hiç
          görünmüyor. Ekranda kontroller ve lejant çıkıp haritanın boş kalmasının
          sebebi buydu. Inline stil MapLibre'nin kuralını ezer. */}
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          top: 0, right: 0, bottom: 0, left: 0,
          /* Karolar gelene kadar görünen zemin — taban stiliyle uyumlu,
             aksi hâlde gündüz temasında açık tabanda koyu bir kare flaşlar. */
          background: loadingBackdrop(activeStyle === 'clear' ? 'day' : 'night'),
        }}
      />

      {showStyleToggle && (
        <div
          className="absolute top-3 right-3 z-10 p-1"
          style={{
            background: 'var(--cn-bg-panel)',
            border: '1px solid var(--cn-line)',
            borderRadius: 2,
          }}
        >
          {/* TABAN SEÇİCİ KALDIRILDI (#665).
              Kullanıcı: *"gündüz modunda gündüz haritası, gece modunda gece
              haritası olacak"*. Taban artık YALNIZ temadan gelir; ayrı bir
              seçici hem bu kararı ikinci bir yerden ezebiliyordu hem de kendi
              state kopyası tema ile ölçülebilir biçimde AYRIŞMIŞTI (harita
              voyager yüklerken düğme "Koyu"yu işaretliyordu). Tek otorite:
              `<html data-console>`. Geriye yalnız kadraj düğmesi kaldı. */}
          <button
            onClick={recenter}
            title="Araçları kadraja al"
            className="cn-num px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-t2 hover:text-t1 transition-colors"
            style={{ borderRadius: 2 }}
          >
            Ortala
          </button>
        </div>
      )}
    </div>
  );
}
