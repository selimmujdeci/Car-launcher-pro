import type { StyleSpecification, LayerSpecification } from 'maplibre-gl';
import type { MapSource } from './mapSourceTypes';

/**
 * Navigation Focus Mode — 3-tier tiered road suppression manifest (Faz 3.2).
 *
 * Tier 0 — Normal navigation  : moderate suppression, full context awareness.
 * Tier 1 — Approaching (50-200m): deeper suppression, route starts to dominate.
 * Tier 2 — Junction (<50m)   : maximum suppression, only route corridor visible.
 *
 * Her tier aynı layer ID setine sahip → tier geçişleri tam restore sağlar.
 * Motorway ve trunk kasitleri hiçbir zaman baskılanmaz (otoyol bağlamı).
 */
type SuppressEntry = readonly [string, 'line-opacity' | 'text-opacity', number];

export const NAV_SUPPRESS_TIERS: ReadonlyArray<ReadonlyArray<SuppressEntry>> = [
  // ── Tier 0: Normal navigation ─────────────────────────────────────────────
  [
    ['road-primary-casing', 'line-opacity', 0.50],
    ['road-minor-casing',   'line-opacity', 0.28],
    ['road-primary',        'line-opacity', 0.50],
    ['road-secondary',      'line-opacity', 0.35],
    ['road-minor',          'line-opacity', 0.20],
    ['road-label',          'text-opacity', 0.28],
    ['place-town',          'text-opacity', 0.38],
  ],
  // ── Tier 1: Turn approach (50-200m) ──────────────────────────────────────
  [
    ['road-primary-casing', 'line-opacity', 0.28],
    ['road-minor-casing',   'line-opacity', 0.10],
    ['road-primary',        'line-opacity', 0.32],
    ['road-secondary',      'line-opacity', 0.16],
    ['road-minor',          'line-opacity', 0.07],
    ['road-label',          'text-opacity', 0.12],
    ['place-town',          'text-opacity', 0.20],
  ],
  // ── Tier 2: Junction (<50m) — lane corridor emphasis ─────────────────────
  [
    ['road-primary-casing', 'line-opacity', 0.14],
    ['road-minor-casing',   'line-opacity', 0.04],
    ['road-primary',        'line-opacity', 0.20],
    ['road-secondary',      'line-opacity', 0.08],
    ['road-minor',          'line-opacity', 0.03],
    ['road-label',          'text-opacity', 0.05],
    ['place-town',          'text-opacity', 0.10],
  ],
] as const;

/** Backward compat — NAV_SUPPRESS_LAYERS = tier 0 */
export const NAV_SUPPRESS_LAYERS = NAV_SUPPRESS_TIERS[0];

/**
 * Vector tile style — automotive dark theme, OMT schema.
 *
 * Tile source priority:
 *   1. smart-tile://{z}/{x}/{y}  (local .pbf via Filesystem / APK asset)
 *   2. VITE_VECTOR_TILE_URL env  (custom server / MapTiler / etc.)
 *
 * Glyphs:
 *   Online: MapLibre demo CDN (Noto Sans, always accessible)
 *   Offline: no symbol layers — NavigationHUD already shows turn text
 *
 * If no vector source is available, calls onFallback() (→ buildRoadStyle).
 */
export function buildVectorStyle(
  sources: Map<string, MapSource>,
  onFallback: () => StyleSpecification,
): StyleSpecification {
  const hasLocalPbf = sources.get('local')?.isAvailable === true;
  const customUrl   = (import.meta.env['VITE_VECTOR_TILE_URL'] ?? '') as string;

  // Determine tile URL — must serve .pbf
  let vectorTiles: string[];
  if (hasLocalPbf) {
    vectorTiles = ['smart-tile://{z}/{x}/{y}'];
  } else if (customUrl) {
    vectorTiles = [customUrl];
  } else {
    // No vector source → fall back to raster (smart-tile handles online OSM)
    return onFallback();
  }

  // Glyph-cache protokolü offline'da da etiket render eder (cache'den veya boş döner).
  // 'includeLabels = isOnline' koşulu artık gerekmez — her zaman aktif.
  const includeLabels = true;
  const glyphsUrl = 'glyph-cache://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

  const style: StyleSpecification = {
    version: 8,
    name: 'Vector (Automotive Dark)',
    ...(includeLabels ? { glyphs: glyphsUrl } : {}),
    sources: {
      omv: {
        type: 'vector',
        tiles: vectorTiles,
        minzoom: 0,
        maxzoom: 14,
        attribution: '© OpenMapTiles © OpenStreetMap contributors',
      },
      // ── Terrain DEM — rgb-terrarium encoding (Mapzen/AWS) ──────────────────
      // 3D yüzey render'ı için: fill-extrusion + hill-shade
      // Android WebView WebGL2 desteği varsa aktif olur; yoksa sessizce atlanır.
      'terrain-rgb': {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        tileSize: 256,
        encoding: 'terrarium' as const,
        maxzoom: 14,
        attribution: '© Mapzen',
      },
    },
    // terrain opsiyonu — WebGL2 varsa arazi yüksekliği aktif
    terrain: { source: 'terrain-rgb', exaggeration: 1.2 },
    layers: [
      // ── Base ──────────────────────────────────────────────
      { id: 'background',
        type: 'background',
        paint: { 'background-color': '#0d1117' } },

      // ── Water ─────────────────────────────────────────────
      { id: 'water-fill',
        type: 'fill',
        source: 'omv',
        'source-layer': 'water',
        paint: { 'fill-color': '#0c1e2f' } },
      { id: 'waterway',
        type: 'line',
        source: 'omv',
        'source-layer': 'waterway',
        paint: { 'line-color': '#0c1e2f', 'line-width': 1.5 } },

      // ── Landuse ───────────────────────────────────────────
      { id: 'landuse-park',
        type: 'fill',
        source: 'omv',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['park', 'grass', 'meadow', 'pitch', 'playground', 'golf']]],
        paint: { 'fill-color': '#0d1f12' } },
      { id: 'landuse-residential',
        type: 'fill',
        source: 'omv',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood']]],
        paint: { 'fill-color': '#10131a' } },

      // ── Buildings ─────────────────────────────────────────
      { id: 'building',
        type: 'fill',
        source: 'omv',
        'source-layer': 'building',
        minzoom: 13,
        paint: { 'fill-color': '#15202e', 'fill-outline-color': '#1c2d40' } },

      // ── 3D Buildings — fill-extrusion z15+, automotive dark ──
      // Height-keyed colour: low buildings warm-dark, towers cooler-lighter.
      // fill-extrusion-vertical-gradient adds per-face shading (depth cue).
      // Ambient occlusion casts soft shadows at the building base (MapLibre v3+).
      { id: 'building-3d',
        type: 'fill-extrusion',
        source: 'omv',
        'source-layer': 'building',
        minzoom: 15,
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'],
            ['coalesce', ['get', 'render_height'], ['get', 'height'], 5],
            0,  '#14202e',
            20, '#1c2d42',
            60, '#243748',
          ],
          'fill-extrusion-opacity':           0.72,
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 10],
          'fill-extrusion-base':   ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
          'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-ambient-occlusion-intensity': 0.3,
          'fill-extrusion-ambient-occlusion-radius':    10,
        } as any,
      } as LayerSpecification,

      // ── Roads: casings (outlines) ─────────────────────────
      { id: 'road-motorway-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#b06800',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 12],
        } },
      { id: 'road-primary-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#1a2535',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 14, 9],
        } },
      { id: 'road-minor-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['tertiary', 'minor', 'service']]],
        minzoom: 12,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#111827',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 14, 6],
        } },

      // ── Roads: fills ──────────────────────────────────────
      { id: 'road-motorway',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#f59e0b',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 14, 9],
        } },
      // Faz 3.3: Road hierarchy depth — daha belirgin fiziksel hiyerarşi
      // primary: daha az parlak (eski #e2e8f0 gece modunda çok baskındı)
      // secondary: daha sakin (eski #94a3b8 primary'e çok yakındı)
      // minor: daha geri çekilmiş (arka plan dokusu hissi)
      // Zoom stops artırıldı → yakında daha belirgin, uzakta daha ince (atmosferik derinlik)
      { id: 'road-primary',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'primary'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#c8d5e2',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.0, 12, 3, 14, 6.5, 18, 13],
        } },
      { id: 'road-secondary',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#6b7f96',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 12, 2, 14, 4, 18, 9],
        } },
      { id: 'road-minor',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'track']]],
        minzoom: 12,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#29394d',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.4, 14, 2, 18, 6],
        } },

      // ── Situational POIs — automotive kritik noktalar ─────
      // OMT schema: poi source-layer, class değerleri
      { id: 'poi-gas',
        type: 'circle',
        source: 'omv',
        'source-layer': 'poi',
        minzoom: 14,
        filter: ['in', ['get', 'class'], ['literal', ['fuel', 'gas_station', 'petrol_station']]],
        paint: {
          'circle-color':        '#f59e0b',
          'circle-radius':       6,
          'circle-opacity':      0.85,
          'circle-stroke-color': '#fbbf24',
          'circle-stroke-width': 1.5,
        } } as LayerSpecification,
      { id: 'poi-parking',
        type: 'circle',
        source: 'omv',
        'source-layer': 'poi',
        minzoom: 14,
        filter: ['in', ['get', 'class'], ['literal', ['parking', 'parking_garage']]],
        paint: {
          'circle-color':        '#3b82f6',
          'circle-radius':       5,
          'circle-opacity':      0.8,
          'circle-stroke-color': '#60a5fa',
          'circle-stroke-width': 1.5,
        } } as LayerSpecification,
      { id: 'poi-hospital',
        type: 'circle',
        source: 'omv',
        'source-layer': 'poi',
        minzoom: 13,
        filter: ['in', ['get', 'class'], ['literal', ['hospital', 'clinic', 'pharmacy']]],
        paint: {
          'circle-color':        '#ef4444',
          'circle-radius':       6,
          'circle-opacity':      0.85,
          'circle-stroke-color': '#f87171',
          'circle-stroke-width': 1.5,
        } } as LayerSpecification,
      { id: 'poi-police',
        type: 'circle',
        source: 'omv',
        'source-layer': 'poi',
        minzoom: 13,
        filter: ['in', ['get', 'class'], ['literal', ['police', 'fire_station']]],
        paint: {
          'circle-color':        '#8b5cf6',
          'circle-radius':       5,
          'circle-opacity':      0.8,
          'circle-stroke-color': '#a78bfa',
          'circle-stroke-width': 1.5,
        } } as LayerSpecification,

      // ── Labels (online only) ──────────────────────────────
      ...(includeLabels ? ([
        { id: 'road-label',
          type: 'symbol',
          source: 'omv',
          'source-layer': 'transportation_name',
          minzoom: 12,
          layout: {
            'text-field': ['coalesce', ['get', 'name:tr'], ['get', 'name']],
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 14, 14],
            'symbol-placement': 'line',
            'text-max-angle': 30,
            'text-padding': 4,
            'text-letter-spacing': 0.06,
          },
          paint: {
            'text-color': '#c8d6e8',      // Daha parlak — gün ışığında okunabilir
            'text-halo-color': '#060c14',
            'text-halo-width': 2.2,        // Daha kalın halo → gün ışığı kontrast
            'text-halo-blur': 0.5,
          } },
        { id: 'place-town',
          type: 'symbol',
          source: 'omv',
          'source-layer': 'place',
          filter: ['in', 'class', 'town', 'village', 'hamlet'],
          layout: {
            'text-field': ['coalesce', ['get', 'name:tr'], ['get', 'name']],
            'text-font': ['Noto Sans Regular'],
            'text-size': 13,
            'text-anchor': 'center',
            'text-letter-spacing': 0.04,
          },
          paint: {
            'text-color': '#e2eaf5',
            'text-halo-color': '#060c14',
            'text-halo-width': 2.5,
            'text-halo-blur': 0.5,
          } },
        { id: 'place-city',
          type: 'symbol',
          source: 'omv',
          'source-layer': 'place',
          filter: ['==', 'class', 'city'],
          layout: {
            'text-field': ['coalesce', ['get', 'name:tr'], ['get', 'name']],
            'text-font': ['Noto Sans Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 6, 14, 12, 20],
            'text-anchor': 'center',
            'text-letter-spacing': 0.06,
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#060c14',
            'text-halo-width': 3.0,
            'text-halo-blur': 0.5,
          } },
      ] as LayerSpecification[]) : []),
    ],
  };

  return style;
}

export function buildRoadStyle(
  activeSourceId: string | null,
  sources: Map<string, MapSource>,
  getTileUrls: () => string[],
): StyleSpecification {
  const tiles = getTileUrls();
  const hasLocal = sources.get('local')?.isAvailable === true;
  const usingSmart = hasLocal || activeSourceId === 'local';

  return {
    version: 8,
    name: usingSmart ? 'Smart Offline/Online Map' : 'OSM Map',
    sources: {
      'map-tiles': {
        type: 'raster',
        tiles,
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
        minzoom: 0,
        maxzoom: 19,
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#020408' }
      },
      {
        id: 'tiles-layer',
        type: 'raster',
        source: 'map-tiles',
        paint: {
          'raster-opacity': 1,
          'raster-contrast': 0.7,
          'raster-brightness-min': 0,
          'raster-brightness-max': 0.22,
          'raster-saturation': -1,
          'raster-hue-rotate': 195,
        }
      },
    ],
  };
}

export function buildSatelliteStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'Uydu',
    sources: {
      'satellite-tiles': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri',
        maxzoom: 19,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0d1628' } },
      { id: 'satellite-layer', type: 'raster', source: 'satellite-tiles', paint: { 'raster-opacity': 1 } },
    ],
  };
}

export function buildHybridStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'Hibrit',
    sources: {
      'satellite-tiles': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri',
        maxzoom: 19,
      },
      'road-overlay': {
        type: 'raster',
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
        maxzoom: 19,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0d1628' } },
      { id: 'satellite-layer', type: 'raster', source: 'satellite-tiles', paint: { 'raster-opacity': 1 } },
      {
        id: 'road-overlay-layer',
        type: 'raster',
        source: 'road-overlay',
        paint: {
          // Opacity 0.38 — uydu görüntüsünü açık tutar, yol etiketleri hâlâ okunur
          'raster-opacity': 0.38,
          // Tam renk silme: OSM'nin yeşil parkları / mavi suyu kalkar,
          // sadece siyah/gri yol çizgileri ve beyaz yazılar kalır
          'raster-saturation': -1,
          // Kontrast maksimum: açık zemin → tam beyaz, yollar → tam siyah
          // Sürüş güvenliği: gece modunda bile şerit/kavşak ayrımı net
          'raster-contrast': 0.75,
          // Beyaz OSM zemini → orta gri (0.55) → uydu renkleriyle harmoniyi artırır
          'raster-brightness-max': 0.55,
          'raster-brightness-min': 0,
        },
      },
    ],
  };
}
