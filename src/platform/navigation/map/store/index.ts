/**
 * navigation/map/store — NAV v3 · L1 MAP TRUTH AUTHORITY (F1).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F1.
 *
 * **TEK kanonik L1 harita gerçeği cephesi.** L4 (Routing) · L5 (Guidance) ·
 * L6 (Arbitration) statik harita gerçeğini ham kaynaklardan (Overpass · tile
 * DB · graph binary · gpsService) DEĞİL, buradan sorar.
 *
 * ── İMPORT NOTU ──────────────────────────────────────────────────────────
 * `getMapStore()` üretim kaynaklarını bağlar (`mapStoreSources`) ve dolayısıyla
 * `mapSourceStore` + `offlineRoutingStatus` zincirini içeri alır. SAF matematik
 * (`tileGrid`) ve saf sözleşmeler (`mapProvenance` · `legacyEdgeIdAdapter` ·
 * `mapStore` fabrikası) bu zincire ihtiyaç duymadan **doğrudan** import
 * edilebilir — testler ve saf tüketiciler bunu yapmalıdır.
 */

/* ── Saf karo matematiği (tek authority) ────────────────────────────────── */
export type { TileCoord, LngLatBBox } from './tileGrid';
export {
  MERCATOR_LAT_LIMIT, TILE_Z_MIN, TILE_Z_MAX, TILE_BBOX_MAX_RESULTS,
  lngLatToTileRawUnclamped, lngLatToTileRawClamped,
  isValidZoom, isValidTile, toTile, tileNorthWest, tileBounds,
  tileKey, parseTileKey, parentTile, tilesForBBox,
} from './tileGrid';

/* ── Köken maskesi (kanıt sınıfı DEĞİL) ─────────────────────────────────── */
export type { MapSourceBit, MapSourceMask } from './mapProvenance';
export {
  MAP_SRC, MAP_SRC_NONE, MAP_SRC_ALL, MAP_SRC_LABEL,
  isValidMask, hasSource, addSource, mergeMasks, isUnknownProvenance,
  describeMask, maskToBits,
} from './mapProvenance';

/* ── Eski graf kimliği ↔ kanonik EdgeId ─────────────────────────────────── */
export type { LegacyEdgeRef, LegacyEdgeDirection } from './legacyEdgeIdAdapter';
export {
  LEGACY_MONOLITH_TILE_ID, LEGACY_MAX_EDGE_ORDINAL,
  MEASURED_GRAPH_EDGE_COUNT, MEASURED_GRAPH_NODE_COUNT,
  toCanonicalEdgeId, toLegacyEdgeRef, isLegacyMonolithEdgeId,
  graphFitsCanonicalIdSpace,
} from './legacyEdgeIdAdapter';

/* ── Cephe ──────────────────────────────────────────────────────────────── */
export type {
  MapDatasetId, MapDataAvailability, MapDatasetStatus, StaticEdgeMetadata,
  MapDatasetObservation, MapDataPorts, MapStore, MapTruthSnapshot,
  EdgeTopology, NearbyEdge, EdgePosition, CorridorEdge, RoadCorridor,
} from './mapStore';
export {
  MAP_DATASET_IDS, MAP_DATA_AVAILABILITIES,
  UNMEASURED_DATASET, UNAVAILABLE_MAP_DATA_PORTS,
  classifyAvailability, createMapStore,
  alongCorridorDistanceM, corridorContainsEdge,
} from './mapStore';

/* ── Sınırlı koridor sözlüğü (F6) — TEK tanım `map/graph/boundedCorridor` ── */
export type { CorridorOutcome, CorridorLimits } from '../graph/boundedCorridor';
export {
  CORRIDOR_OUTCOMES, CORRIDOR_MAX_EDGES, CORRIDOR_MAX_NODE_EXPANSIONS,
  CORRIDOR_MAX_DEPTH, CORRIDOR_HARD_MAX_BUDGET_M,
  corridorIsScanComplete, corridorLimits,
} from '../graph/boundedCorridor';

import type { MapStore } from './mapStore';
import { createMapStore } from './mapStore';
import { productionMapDataPorts } from './mapStoreSources';

let _instance: MapStore | null = null;

/**
 * Üretim L1 cephesi (tekil). **Timer kurmaz · abonelik açmaz · ağ çağırmaz ·
 * hiçbir kaynağı başlatmaz** — yalnız çağrı anında senkron okur.
 */
export function getMapStore(): MapStore {
  if (_instance === null) _instance = createMapStore(productionMapDataPorts);
  return _instance;
}

/** @internal testler arası izolasyon. */
export function _resetMapStoreForTest(): void {
  _instance = null;
}
