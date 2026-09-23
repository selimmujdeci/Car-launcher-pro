/**
 * TrafficMapMini — trafik haritası (Google Maps tarzı), YALNIZ GERÇEK veriyle.
 *
 *  · Yollar TomTom resmî akış katmanıyla trafiğe göre renklenir (yeşil → koyu kırmızı).
 *  · Bulunulan yol, TomTom'un döndüğü GERÇEK geometriyle vurgulanır.
 *  · Olaylar (kaza/çalışma/kapalı yol/sıkışıklık) gerçek konumlarında işaretlenir.
 *
 * Eskiden: veri yokken konumun etrafına SAHTE yönlerde (offset) uydurma yol noktaları ve
 * kesik çizgiler çiziliyordu — kaldırıldı (CLAUDE.md §8). Veri yoksa yalnız zemin + konum.
 *
 * Performans: harita BİR KEZ kurulur; konum/veri değişince yalnız merkez + GeoJSON
 * güncellenir (eskiden her konum değişiminde harita baştan yaratılıyordu). interactive:false
 * (Mali-400 sözleşmesi). Yalnız trafik çekmecesi açıkken mount edilir.
 */
import { useEffect, useRef, memo } from 'react';
import maplibregl from 'maplibre-gl';
import { getMapStyle } from '../../platform/mapSourceManager';
import { TRAFFIC_COLORS, type TrafficIncident, type TrafficRoad } from '../../platform/trafficService';
import { noteMapInstanceMounted, noteMapInstanceUnmounted } from '../../platform/perf/mapInstanceEvidence';
import { INCIDENT_COLORS } from './trafficPanelModel';


interface Props {
  lat: number;
  lng: number;
  tileUrl?: string;
  road: TrafficRoad | null;
  incidents: readonly TrafficIncident[];
  height?: number;
}

type FC = GeoJSON.FeatureCollection;
const EMPTY: FC = { type: 'FeatureCollection', features: [] };

function roadFc(road: TrafficRoad | null): FC {
  if (!road || road.coordinates.length < 2) return EMPTY;
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', properties: { color: TRAFFIC_COLORS[road.level] },
      geometry: { type: 'LineString', coordinates: road.coordinates.map((c) => [c[0], c[1]]) },
    }],
  };
}

function incidentFc(incidents: readonly TrafficIncident[]): FC {
  return {
    type: 'FeatureCollection',
    features: incidents.map((i) => {
      const mid = i.coordinates[Math.floor(i.coordinates.length / 2)]!;
      return {
        type: 'Feature', properties: { color: INCIDENT_COLORS[i.kind] },
        geometry: { type: 'Point', coordinates: [mid[0], mid[1]] },
      };
    }),
  };
}

export const TrafficMapMini = memo(function TrafficMapMini({ lat, lng, tileUrl, road, incidents, height = 300 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const readyRef = useRef(false);
  const latest = useRef({ lat, lng, road, incidents });
  latest.current = { lat, lng, road, incidents };

  // Kurulum — yalnız tile URL değişirse yeniden.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let style: maplibregl.StyleSpecification;
    try {
      style = getMapStyle() as maplibregl.StyleSpecification;
    } catch {
      style = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0a0e1a' } }] };
    }
    noteMapInstanceMounted('TRAFFIC');
    const map = new maplibregl.Map({
      container: el, style, center: [latest.current.lng, latest.current.lat], zoom: 13.2,
      interactive: false, attributionControl: false,
    });
    mapRef.current = map;

    map.on('load', () => {
      if (tileUrl) {
        map.addSource('traffic-flow', { type: 'raster', tiles: [tileUrl], tileSize: 256 });
        map.addLayer({ id: 'traffic-flow', type: 'raster', source: 'traffic-flow', paint: { 'raster-opacity': 0.95 } });
      }
      map.addSource('road', { type: 'geojson', data: roadFc(latest.current.road) });
      map.addLayer({ id: 'road-casing', type: 'line', source: 'road',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 } });
      map.addLayer({ id: 'road-line', type: 'line', source: 'road',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 5 } });
      map.addSource('incidents', { type: 'geojson', data: incidentFc(latest.current.incidents) });
      map.addLayer({ id: 'incident-halo', type: 'circle', source: 'incidents',
        paint: { 'circle-radius': 13, 'circle-color': ['get', 'color'], 'circle-opacity': 0.25 } });
      map.addLayer({ id: 'incident-dot', type: 'circle', source: 'incidents',
        paint: { 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff' } });

      const dot = document.createElement('div');
      dot.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#1A73E8;border:3px solid #fff;'
        + 'box-shadow:0 0 0 8px rgba(26,115,232,0.22),0 2px 6px rgba(0,0,0,0.4)';
      markerRef.current = new maplibregl.Marker({ element: dot }).setLngLat([latest.current.lng, latest.current.lat]).addTo(map);
      readyRef.current = true;
    });

    return () => {
      readyRef.current = false;
      markerRef.current = null;
      noteMapInstanceUnmounted();
      map.remove();
      mapRef.current = null;
    };
  }, [tileUrl]);

  // Güncelleme — harita yeniden YARATILMAZ.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.jumpTo({ center: [lng, lat] });
    markerRef.current?.setLngLat([lng, lat]);
    (map.getSource('road') as maplibregl.GeoJSONSource | undefined)?.setData(roadFc(road));
    (map.getSource('incidents') as maplibregl.GeoJSONSource | undefined)?.setData(incidentFc(incidents));
  }, [lat, lng, road, incidents]);

  return (
    <div
      ref={containerRef}
      data-traffic-map=""
      style={{ width: '100%', height, borderRadius: 16, overflow: 'hidden', background: '#0b1220', flexShrink: 0 }}
    />
  );
});
