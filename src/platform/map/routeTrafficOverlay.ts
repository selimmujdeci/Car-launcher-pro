/**
 * routeTrafficOverlay — rota üzerindeki trafiği (Google Maps gibi) turuncu/kırmızı
 * parçalar olarak ROTA ÇİZGİSİNİN ÜSTÜNE çizer.
 *
 * NEDEN AYRI KATMAN: rota çekirdeğinin rengi (`line-gradient`) tek yazıcıya
 * aittir (`MapLayerManager._applyRouteColorDecision`) ve manevra kademesi
 * değiştikçe yeniden yazılır. Trafiği oraya yazmak her dönüşte silinmesi
 * demekti. Ayrı GeoJSON katmanı bu otoriteye DOKUNMAZ.
 *
 * VERİ: yalnız sağlayıcının bildirdiği bölümler (`RouteState.trafficSections`,
 * bugün TomTom). Bölüm yoksa katman BOŞ kalır — "akıcı" uydurulmaz, rota
 * kendi rengindedir. Kat edilen parça, rota kırpıldığı gibi kırpılır.
 */
import type maplibregl from 'maplibre-gl';
import type { RouteTrafficSection } from '../routing/tomtomRouting';
import { TRAFFIC_COLORS } from '../trafficService';
import { SEL_LAYER, ROUTE_FLOW } from './_mapState';

type MapLibreMap = maplibregl.Map;

export const ROUTE_TRAFFIC_SRC = 'route-traffic-source';
export const ROUTE_TRAFFIC_LAYER = 'route-traffic-layer';

type FC = GeoJSON.FeatureCollection<GeoJSON.LineString>;

/**
 * Bölümleri çizgi parçalarına çevirir. `progress` verilirse aracın gerisi
 * atılır; aracın içinde bulunduğu bölüm aracın konumundan başlar. SAF.
 */
export function buildRouteTrafficFeatures(
  geometry: readonly [number, number][] | null,
  sections: readonly RouteTrafficSection[],
  progress: { segIdx: number; lon: number; lat: number } | null,
): FC {
  const features: FC['features'] = [];
  if (!geometry || geometry.length < 2) return { type: 'FeatureCollection', features };
  for (const s of sections) {
    if (s.endIdx <= s.startIdx || s.endIdx >= geometry.length) continue;
    let coords: [number, number][];
    if (progress) {
      if (s.endIdx <= progress.segIdx) continue;                   // tamamen geride
      if (s.startIdx <= progress.segIdx) {
        coords = [[progress.lon, progress.lat], ...geometry.slice(progress.segIdx + 1, s.endIdx + 1)];
      } else {
        coords = geometry.slice(s.startIdx, s.endIdx + 1) as [number, number][];
      }
    } else {
      coords = geometry.slice(s.startIdx, s.endIdx + 1) as [number, number][];
    }
    if (coords.length < 2) continue;
    features.push({
      type: 'Feature',
      properties: { color: TRAFFIC_COLORS[s.level], level: s.level, kind: s.kind },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }
  return { type: 'FeatureCollection', features };
}

function _beforeId(map: MapLibreMap): string | undefined {
  if (map.getLayer(ROUTE_FLOW)) return ROUTE_FLOW;
  try {
    const layers = (map.getStyle()?.layers ?? []).filter((l) => l.id !== ROUTE_TRAFFIC_LAYER);
    const i = layers.findIndex((l) => l.id === SEL_LAYER);
    return i >= 0 && i + 1 < layers.length ? layers[i + 1]!.id : undefined;
  } catch { return undefined; }
}

/**
 * Katmanı kurar (yoksa) ve verisini yazar. Rota çekirdeği yoksa (henüz
 * çizilmedi / stil yeniden kuruluyor) HİÇBİR ŞEY yapmaz — sonraki çağrı kurar.
 * Fail-soft: harita hatası navigasyonu etkilemez.
 */
export function syncRouteTrafficOverlay(
  map: MapLibreMap | null | undefined,
  geometry: readonly [number, number][] | null,
  sections: readonly RouteTrafficSection[],
  progress: { segIdx: number; lon: number; lat: number } | null = null,
  /** Rota katmanları yeniden kurulduktan sonra `true` — katman çekirdeğin üstüne taşınır. */
  reorder = false,
): void {
  if (!map) return;
  try {
    const data = buildRouteTrafficFeatures(geometry, sections, progress);
    const src = map.getSource(ROUTE_TRAFFIC_SRC) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
      // Rota katmanları yeniden sıralandıysa çekirdeğin ÜSTÜNE geri al.
      if (reorder && map.getLayer(ROUTE_TRAFFIC_LAYER)) {
        const b = _beforeId(map);
        if (b !== ROUTE_TRAFFIC_LAYER) map.moveLayer(ROUTE_TRAFFIC_LAYER, b);
      }
      return;
    }
    if (data.features.length === 0) return;          // gerek yok → katman da kurulmaz
    if (!map.getLayer(SEL_LAYER)) return;            // rota henüz çizilmedi
    map.addSource(ROUTE_TRAFFIC_SRC, { type: 'geojson', data });
    map.addLayer({
      id: ROUTE_TRAFFIC_LAYER, type: 'line', source: ROUTE_TRAFFIC_SRC,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 7, 17, 11],
      },
    }, _beforeId(map));
  } catch { /* stil yeniden yükleniyor olabilir — sonraki çağrıda yeniden denenir */ }
}

/** Rota temizlenince katmanı kaldırır. */
export function clearRouteTrafficOverlay(map: MapLibreMap | null | undefined): void {
  if (!map) return;
  try {
    if (map.getLayer(ROUTE_TRAFFIC_LAYER)) map.removeLayer(ROUTE_TRAFFIC_LAYER);
    if (map.getSource(ROUTE_TRAFFIC_SRC)) map.removeSource(ROUTE_TRAFFIC_SRC);
  } catch { /* yoksay */ }
}
