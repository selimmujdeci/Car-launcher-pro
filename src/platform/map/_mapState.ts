// ══════════════════════════════════════════════════════════════════════════
// CarOS Pro — Map Shared State (mapService God-Object refactoring)
//
// Bu yaprak (leaf) modül, harita katmanının TÜM paylaşılan durumunu barındırır:
//   • useMapStore  — Zustand store (DEĞİŞTİRİLMEDİ; yalnızca taşındı)
//   • M            — modül-seviyesi mutable state (tek mutable nesne → modüller arası
//                    yazma ES "read-only live binding" kısıtını aşar: M.foo = x)
//   • Paylaşılan sabitler — layer ID'leri, stiller, rover/badge sabitleri, nominatim
//
// MapCore / MapLayerManager / MapInteractionManager hepsi BURADAN import eder.
// Bu modül onlardan HİÇBİR ŞEY import etmez → döngüsel modül-init riski yok.
// Davranış değişikliği YOK (Zero-Change in Behavior) — yalnızca konum değişti.
// ══════════════════════════════════════════════════════════════════════════
import maplibregl, { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { create } from 'zustand';

// ── Public config tipi ──────────────────────────────────────────────────────
export interface MapConfig {
  offline: boolean;
  style?: string;
  tileUrl?: string;
}

// ── Zustand store (entegrasyon DEĞİŞTİRİLMEDİ) ───────────────────────────────
export interface MapState {
  mapInstance: MapLibreMap | null;
  isReady: boolean;
  error: string | null;
  tileError: boolean;
  drivingMode: boolean;
}

export const useMapStore = create<MapState>(() => ({
  mapInstance: null,
  isReady: false,
  error: null,
  tileError: false,
  drivingMode: false,
}));

// ── Saha teşhis kancası ──────────────────────────────────────────────────────
// Kamera durumunu canlı okumak için (CDP-over-adb / Playwright probe):
//   __MAP_STORE__.getState().mapInstance?.getBearing()
// Maliyet: tek global referans. Cihazda uzaktan teşhis iş akışı gereği
// production'da da açık bırakılır (bkz. project_assistant-429-quota CDP yöntemi).
if (typeof window !== 'undefined') {
  (window as { __MAP_STORE__?: unknown }).__MAP_STORE__ = useMapStore;
}

// ── Rota geometri cache tipi ─────────────────────────────────────────────────
export interface RouteGeom {
  coords: [number, number][];
  alts: [number, number][][];
  altIdx?: number[];
  altDurs?: number[];
  mainDur?: number;
}

// ── Modül-seviyesi mutable state (tek nesne — modüller arası paylaşım) ───────
// Alan adları orijinal `_foo` değişkenleriyle birebir eşlenir (underscore atılmış).
export const M = {
  // Initialization / lifecycle mutex
  initPromise:        null as Promise<MapLibreMap> | null,
  initGen:            0,                  // her destroyMap'te artar
  currentContainer:   null as HTMLElement | null,
  destroyLock:        Promise.resolve() as Promise<void>,
  webglAvailableCache: null as boolean | null,

  // Marker durum makinesi
  lastScaleSpeedKmh:  -1,
  markerNight:        false,
  markerNavActive:    false,
  lastRingPulseMs:    0,

  // Rota etkileşim motoru
  routeInteractionCleanup: null as (() => void) | null,
  onAltRouteSelect:        null as ((realIdx: number) => void) | null,

  // Movement jitter (pozisyon)
  lastJumpLat:        0,
  lastJumpLng:        0,

  // Cinematic light trail (rAF)
  flowRafId:          null as number | null,
  flowProgress:       0.0,

  // Pulse gradient cache (GC-opt)
  pCacheRisk:         -1,
  pCacheAttn:         false,
  pPeakStr:           'rgba(255,255,255,0.80)',
  pShoulderStr:       'rgba(255,255,255,0.22)',

  // Movement energy
  flowSpeedFactor:    1.0,
  lastFlowSpeedKmh:   -1.0,

  // Map mood controller
  lastMoodScore:      -1.0,
  lastMoodMs:         0,
  lastMoodSafetyState: '',

  // External risk alert / camera lockdown
  lastExternalRiskAlert: false,
  lastHazardZoom:     0,

  // Navigation focus mode
  focusModeActive:    false,
  lastIntersectionTier: 0,   // -1 = force re-apply

  // Perspective + maneuver emphasis
  lastPerspectiveScale: 1.0,
  lastManeuverTier:   0,

  // Dynamic shadow elevation + blur
  lastShadowPitch:    -1.0,
  lastShadowZoom:     -1.0,
  lastBlurReduced:    false,

  // Route geometry cache
  cachedRoute:          null as RouteGeom | null,
  pendingRouteGeometry: null as RouteGeom | null,
  isStyleChanging:    false,

  // Turn focus marker
  turnFocusMarker:    null as Marker | null,

  // Driving layer updater
  lastSpeedHide:      false,
};

// ── Paylaşılan sabitler — stiller ────────────────────────────────────────────
// Single tile source — caros-tile:// interceptor handles caching transparently
export const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'osm': {
      type: 'raster',
      tiles: ['caros-tile://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [
    // Tile yüklenemeyince siyah kanvas yerine OEM sıcak grafit arka plan görünür
    { id: 'background', type: 'background', paint: { 'background-color': '#131822' } },
    // OEM gece tonu: ham OSM raster'ı sıcak-koyu grafite indirger (--map-bg-1 #131822).
    { id: 'osm-tiles',  type: 'raster',     source: 'osm',
      paint: {
        // OKUNUR gece tonu — RASTER_PAINT_NIGHT ile birebir aynı (bkz. mapStyleBuilders).
        'raster-opacity': 1,
        'raster-contrast': 0.42,
        'raster-brightness-min': 0,
        'raster-brightness-max': 0.62,
        'raster-saturation': -0.55,
        'raster-hue-rotate': 15,
      } },
  ],
};

/** Son çare fallback stili — gün/gece paleti parametreyle seçilir.
 *  Varsayılan GÜNDÜZ (night=false): fallback haritası gündüz temada asla koyu kurulmaz.
 *  Layer id 'tiles-layer' + source 'map-tiles': applyMapDayNight canlı paint geçişi ve
 *  MapCore'daki source-loaded kontrolü ana stille (buildRoadStyle) aynı id'leri bulur. */
export const getOnlineTileStyle = (night = false): maplibregl.StyleSpecification => ({
  version: 8,
  name: 'OSM Online',
  sources: {
    'map-tiles': {
      type: 'raster' as const,
      tiles: [
        'caros-tile://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'caros-tile://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'caros-tile://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      minzoom: 0,
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background' as const,
      paint: { 'background-color': night ? '#131822' : '#e9eef3' },
    },
    {
      id: 'tiles-layer',
      type: 'raster' as const,
      source: 'map-tiles',
      paint: night
        ? {
            // OKUNUR gece tonu — RASTER_PAINT_NIGHT ile birebir aynı (lock: mapDayNightStyle.test).
            // Night UX Polish 2026-06-25: harita gece "en parlak blok" olmasın → ~%20 koyu
            // (brightness 0.62→0.50) + contrast 0.42→0.52 (OSM koyu etiketleri okunur kalsın).
            'raster-opacity': 1,
            'raster-contrast': 0.52,
            'raster-brightness-min': 0,
            'raster-brightness-max': 0.50,
            'raster-saturation': -0.55,
            'raster-hue-rotate': 15,
          }
        : {
            // Gündüz: ham OSM doğal açık renkleri — RASTER_PAINT_DAY ile birebir aynı
            'raster-opacity': 1,
            'raster-contrast': 0.05,
            'raster-brightness-min': 0,
            'raster-brightness-max': 1,
            'raster-saturation': -0.05,
            'raster-hue-rotate': 0,
          },
    },
  ],
});

// ── Paylaşılan sabitler — marker (rover) ─────────────────────────────────────
export const ROVER_IMG_DAY   = 'rover-veh-day';
export const ROVER_IMG_NIGHT = 'rover-veh-night';
export const USER_LAYERS = [
  'user-glow',     // alt: yumuşak amber hale
  'user-ring',     // amber konum halkası
  'user-vehicle',  // üstte dönen Rover
];

// ── Paylaşılan sabitler — etkileşim ──────────────────────────────────────────
export const ALT_TOUCH_PAD = 24; // px — dokunmatik dostu hitbox genişlemesi

// ── Paylaşılan sabitler — rota katmanları ────────────────────────────────────
export const ROUTE_SHADOW    = 'car-route-shadow';      // Layer 0 — depth shadow
export const ROUTE_GLOW_SEL  = 'car-route-glow-sel';   // Layer 1 — neon outer glow
export const ROUTE_CASE      = 'car-route-casing';      // Layer 2 — contrast border
export const SEL_LAYER       = 'selected-route-layer';  // Layer 3 — gradient core
export const ROUTE_FLOW      = 'car-route-flow';        // Layer 4 — marching-ants flow
export const ALT_SRC         = 'car-route-alt';
export const ALT_FILL        = 'car-route-alt-fill';
export const ALT_BADGE_SRC   = 'car-route-alt-badge';
export const ALT_BADGE_LAYER = 'car-route-alt-badge-labels';
export const DEBUG_SRC       = 'car-route-debug';
export const DEBUG_LAYER     = 'car-route-debug-line';
export const SEL_SRC         = 'selected-route-source';
export const BADGE_IMAGE_ID  = 'alt-badge-bg'; // C7.3 — premium glassmorphic badge arkaplanı

// ── Paylaşılan sabitler — pulse / mood ───────────────────────────────────────
export const PULSE_TRANSPARENT = 'rgba(255,255,255,0)';
export const MOOD_THROTTLE_MS  = 200;
export const MOOD_HYSTERESIS   = 0.05;

// ── Paylaşılan sabitler — nominatim ──────────────────────────────────────────
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
export const NOMINATIM_UA  = 'CockpitOS/1.0 (aybarsselimaybars@gmail.com)';
