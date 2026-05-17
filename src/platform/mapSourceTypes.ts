export type MapMode = 'road' | 'hybrid' | 'satellite';

/**
 * Tile render strategy — orthogonal to MapMode.
 *
 *   'raster' — GPU-decoded PNG tiles (OSM). Fast, stable, ideal for AR + navigation.
 *              Head unit Mali-400 handles raster textures natively at 30+ fps.
 *
 *   'vector' — PBF decoded geometry (OMT schema). Crisp at any zoom/rotation, smaller
 *              file size. CPU-heavier decode — acceptable when idle but risky mid-nav.
 *
 * Auto-switch rules (see notifyNavigationRender):
 *   isNavigating || arActive → 'raster' instantly
 *   idle 2500ms              → 'vector'  (debounced — avoids toggling on short pauses)
 *
 * Only applies to road mode. Satellite/hybrid are always raster.
 */
export type TileRenderMode = 'raster' | 'vector';

export interface MapSource {
  id: string;
  name: string;
  type: 'offline' | 'online';
  description: string;
  isAvailable: boolean;
  cacheSize?: string;
  tileCount?: number;
  lastUpdated?: number;
}

export interface MapSourceState {
  sources: Map<string, MapSource>;
  activeSourceId: string | null;
  /** Which source is actually serving tiles right now */
  servingFrom: 'local' | 'online' | 'cached' | null;
  isOnline: boolean;
  isLoading: boolean;
  error: string | null;
  initialized: boolean;
  mapMode: MapMode;
  /** Active tile render strategy (auto-managed by notifyNavigationRender) */
  tileRender: TileRenderMode;
}

/** localStorage key — "did we ever see local tiles on this device?" */
export const OFFLINE_PREF_KEY = 'car_map_offline_available';

export const GLYPH_CACHE_NAME = 'car-launcher-glyphs-v1';

export const NATIVE_MAPS_SUBDIRS = [
  'Android/data/com.cockpitos.pro/maps', // ExternalStorage
  'maps',                                  // Data directory
];
