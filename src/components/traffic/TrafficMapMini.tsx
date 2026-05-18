/**
 * TrafficMapMini — Kompakt statik harita, trafik yoğunluğunu görselleştirir.
 *
 * interactive:false → pan/zoom yok, Mali-400 için güvenli.
 * Segment yönleri GPS konumundan offset hesaplanır (tahmin modunda gerçek
 * koordinat olmadığından yön bazlı yaklaşık gösterim kullanılır).
 * HERE/TomTom tile URL varsa gerçek trafik katmanı eklenir.
 */

import { useEffect, useRef, memo } from 'react';
import maplibregl from 'maplibre-gl';
import { getMapStyle } from '../../platform/mapSourceManager';
import type { TrafficSegment } from '../../platform/trafficService';

/* ── Sabitler ──────────────────────────────────────────────── */

const LEVEL_COLORS: Record<string, string> = {
  free:       '#22c55e',
  moderate:   '#f59e0b',
  heavy:      '#ef4444',
  standstill: '#7c3aed',
};

const DIR_BEARING: Record<string, number> = {
  'kuzey':     0,
  'kuzeydoğu': 45,
  'doğu':      90,
  'güneydoğu': 135,
  'güney':     180,
  'güneybatı': 225,
  'batı':      270,
  'kuzeybatı': 315,
};

/** GPS konumundan verilen yön ve mesafede yeni koordinat hesaplar */
function offsetPos(lat: number, lng: number, bearingDeg: number, distM: number): [number, number] {
  const d  = distM / 6_371_000;
  const b  = bearingDeg * (Math.PI / 180);
  const φ1 = lat * (Math.PI / 180);
  const λ1 = lng * (Math.PI / 180);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(b));
  const λ2 = λ1 + Math.atan2(
    Math.sin(b) * Math.sin(d) * Math.cos(φ1),
    Math.cos(d) - Math.sin(φ1) * Math.sin(φ2),
  );
  return [φ2 * (180 / Math.PI), λ2 * (180 / Math.PI)];
}

/* ── Bileşen ───────────────────────────────────────────────── */

interface Props {
  lat:       number;
  lng:       number;
  segments:  TrafficSegment[];
  tileUrl?:  string;
}

export const TrafficMapMini = memo(function TrafficMapMini({ lat, lng, segments, tileUrl }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Mevcut harita varsa önce temizle (lat/lng/tileUrl değişiminde yeniden init)
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

    let style: maplibregl.StyleSpecification;
    try {
      style = getMapStyle() as maplibregl.StyleSpecification;
    } catch {
      // Fallback: sade koyu harita
      style = {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0a0e1a' } }],
      };
    }

    const map = new maplibregl.Map({
      container:        el,
      style,
      center:           [lng, lat],
      zoom:             13,
      pitch:            0,
      bearing:          0,
      interactive:      false,   // pan/zoom/tilt yok — statik görüntü
      attributionControl: false,
    });

    mapRef.current = map;

    map.on('load', () => {
      // ── HERE/TomTom trafik tile katmanı ───────────────────────────
      if (tileUrl) {
        map.addSource('traffic-tiles', {
          type:     'raster',
          tiles:    [tileUrl],
          tileSize: 256,
        });
        map.addLayer({
          id:     'traffic-layer',
          type:   'raster',
          source: 'traffic-tiles',
          paint:  { 'raster-opacity': 0.75 },
        });
      }

      // ── Segment yoğunluk noktaları (GPS ofset + bağlantı çizgisi) ─
      const features: GeoJSON.Feature[] = [];

      segments.forEach((seg, i) => {
        const bearing         = DIR_BEARING[seg.direction] ?? (i * 72);
        const [sLat, sLng]    = offsetPos(lat, lng, bearing, 750);
        const color           = LEVEL_COLORS[seg.level] ?? '#94a3b8';

        // GPS → segment yön çizgisi
        features.push({
          type:       'Feature',
          geometry:   { type: 'LineString', coordinates: [[lng, lat], [sLng, sLat]] },
          properties: { color, opacity: 0.55 },
        });

        // Segment nokta işareti
        features.push({
          type:       'Feature',
          geometry:   { type: 'Point', coordinates: [sLng, sLat] },
          properties: { color, label: seg.label, level: seg.level },
        });
      });

      map.addSource('traffic-segments', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });

      // Bağlantı çizgileri
      map.addLayer({
        id:     'seg-lines',
        type:   'line',
        source: 'traffic-segments',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint:  {
          'line-color':   ['get', 'color'],
          'line-width':   2.5,
          'line-opacity': ['get', 'opacity'],
          'line-dasharray': [2, 3],
        },
      });

      // Yoğunluk halkaları (dış hale — glow efekti)
      map.addLayer({
        id:     'seg-dots-glow',
        type:   'circle',
        source: 'traffic-segments',
        filter: ['==', ['geometry-type'], 'Point'],
        paint:  {
          'circle-radius':       12,
          'circle-color':        ['get', 'color'],
          'circle-opacity':      0.20,
          'circle-blur':         0.6,
        },
      });

      // Yoğunluk noktaları (iç)
      map.addLayer({
        id:     'seg-dots',
        type:   'circle',
        source: 'traffic-segments',
        filter: ['==', ['geometry-type'], 'Point'],
        paint:  {
          'circle-radius':        7,
          'circle-color':         ['get', 'color'],
          'circle-stroke-width':  2,
          'circle-stroke-color':  '#ffffff',
          'circle-stroke-opacity': 0.9,
        },
      });

      // ── GPS konum noktası ──────────────────────────────────────────
      const posEl = document.createElement('div');
      posEl.style.cssText = [
        'width:14px', 'height:14px', 'border-radius:50%',
        'background:#3b82f6',
        'border:3px solid #fff',
        'box-shadow:0 0 0 5px rgba(59,130,246,0.25), 0 0 12px rgba(59,130,246,0.6)',
        'flex-shrink:0',
      ].join(';');

      new maplibregl.Marker({ element: posEl })
        .setLngLat([lng, lat])
        .addTo(map);

      // ── Segment isim etiketleri (HTML marker) ─────────────────────
      segments.forEach((seg, i) => {
        const bearing      = DIR_BEARING[seg.direction] ?? (i * 72);
        const [sLat, sLng] = offsetPos(lat, lng, bearing, 750);
        const color        = LEVEL_COLORS[seg.level] ?? '#94a3b8';

        const el = document.createElement('div');
        el.style.cssText = [
          'font-size:10px', 'font-weight:800', 'font-family:system-ui,sans-serif',
          'color:#fff',
          'background:rgba(0,0,0,0.72)',
          `border:1px solid ${color}55`,
          'padding:2px 6px', 'border-radius:5px',
          'white-space:nowrap',
          'max-width:72px', 'overflow:hidden', 'text-overflow:ellipsis',
          'pointer-events:none',
          'margin-top:14px',  // dot yüksekliğinin altına kaydır
        ].join(';');
        el.textContent = seg.label;

        new maplibregl.Marker({ element: el, anchor: 'top' })
          .setLngLat([sLng, sLat])
          .addTo(map);
      });
    });

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  // Sadece konum veya tile URL değiştiğinde yeniden init
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, tileUrl]);

  return (
    <div
      ref={containerRef}
      style={{
        width:        '100%',
        height:       190,
        borderRadius: 14,
        overflow:     'hidden',
        border:       '1px solid rgba(255,255,255,0.08)',
        background:   '#070d1a',
        flexShrink:   0,
      }}
    />
  );
});
