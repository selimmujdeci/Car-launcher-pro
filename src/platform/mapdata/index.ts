/**
 * platform/mapdata — MAP DATA PLATFORM · VERİ ÜRETİM/NORMALİZASYON KATMANI.
 *
 * Bu paket NAV v3 L1 `MapStore`'un **ALTINDADIR**. L1 ve üstü katmanlar
 * (Routing · Guidance · Arbitration · UI) bu paketi doğrudan TÜKETMEZ; yalnız
 * canonical çıktı L1'in mevcut cephesine beslenir.
 *
 * ── OTORİTE SINIRI (CLAUDE.md §1 ONE DOMAIN = ONE AUTHORITY) ──────────────
 *  · Bu paket **ikinci bir harita gerçeği otoritesi DEĞİLDİR.** Çalışma
 *    zamanı harita gerçeğinin sahibi `navigation/map/store` olarak KALIR.
 *  · Burada üretilen şey çalışma zamanı gerçeği değil, **veri kümesidir**:
 *    hangi binanın/yolun/adresin canonical hâlinin ne olduğu.
 *  · Kanıt sınıfı (`EvidenceGrade`) `navigation/contracts/navEvidence`ten
 *    gelir — kopyalanmaz, sarılmaz, yeniden adlandırılmaz.
 *  · Köken maskesi (`MapSourceMask`, fiziksel düzlem) ile kaynak kimliği
 *    (`MapDataSourceId`, üretici) AYRI eksenlerdir; biri diğerinin yerine
 *    kullanılmaz.
 *  · Timer · abonelik · scheduler · ağ SAHİBİ DEĞİLDİR (hepsi saf TS).
 */

export type {
  MapDataSourceId, MapFeatureKind, MapFeatureField, MapDatasetRelease, EpochMs,
} from './mapDataSource';
export {
  MAP_DATA_SOURCE_IDS, MAP_FEATURE_KINDS, MAP_FEATURE_FIELDS, FIELDS_BY_KIND,
  isMapDataSourceId, fieldAppliesToKind, unknownRelease, isReleaseIdentified,
} from './mapDataSource';

export type {
  LicenseRight, MapDataUseIntent, MapLicensePolicy, LicenseGateVerdict, LicenseGateResult,
  SpdxRights,
} from './mapDataLicense';
export {
  LICENSE_RIGHTS, MAP_DATA_USE_INTENTS, MAP_LICENSE_REGISTRY, SPDX_RIGHTS,
  unknownLicensePolicy, licensePolicyFor, requiresOsmShareAlike,
  effectiveLicensePolicy, evaluateLicenseGate, evaluateFusionLicenseGate,
} from './mapDataLicense';

export type {
  LonLat, MapGeometry, MapDataFreshnessClass, MapDataFreshness, MapDataProvenance,
  MapObservationQuality, MapFieldValue, MapSourceObservation, CandidateMapFeature,
} from './mapDataObservation';
export {
  MAP_FRESHNESS_CLASSES, UNKNOWN_FRESHNESS, UNMEASURED_QUALITY,
  SOURCE_FRESHNESS_BUDGET_MS, isFiniteLonLat, isValidGeometry, classifyFreshness,
  computeAttributeCompleteness, observationSources, observationsWithField, isValidCandidate,
} from './mapDataObservation';

export type {
  MapFieldUnknownReason, FieldScoreBreakdown, ResolvedField, CanonicalMapFeature,
  ResolutionWeights, ResolveOptions,
} from './mapDataResolution';
export {
  MAP_FIELD_UNKNOWN_REASONS, DEFAULT_RESOLUTION_WEIGHTS, CONTESTED_SCORE_EPSILON,
  NEUTRAL_AUTHORITY_PRIOR, DEFAULT_MIN_ACCEPTED_SCORE,
  authorityPrior, resolveField, resolveCandidate, isPublishable,
} from './mapDataResolution';

/* ── Kaynak adaptörleri (F2) — ham kayıt → gözlem, SAF ──────────────────── */
export type {
  AdapterRejectReason, AdapterRejection, AdapterContext, AdapterResult,
  MapSourceAdapter, AdapterBatchResult,
} from './adapters/adapterContract';
export {
  ADAPTER_REJECT_REASONS, accepted, rejected, normalizeBatch, parseIsoEpochMs,
} from './adapters/adapterContract';
export type { OvertureBuildingRaw, OvertureSourceRef } from './adapters/overtureBuildingAdapter';
export {
  overtureBuildingAdapter, overtureGeometryToCanonical, isMachineDerivedDataset,
} from './adapters/overtureBuildingAdapter';
export type { OsmBuildingRaw } from './adapters/osmBuildingAdapter';
export { osmBuildingAdapter } from './adapters/osmBuildingAdapter';

/* ── Bina fusion (F3) — SAF, deterministik ──────────────────────────────── */
export type { LocalFrame, FootprintOverlap } from './resolvers/buildingGeometry';
export {
  EARTH_RADIUS_M, NO_OVERLAP, makeLocalFrame, toLocalXY, distanceM, outerRing,
  signedAreaM2, polygonAreaM2, polygonCentroid, pointInRing, pointInPolygon,
  bboxOf, bboxIntersects, measureOverlap,
} from './resolvers/buildingGeometry';
export type {
  BuildingMatchPolicy, BuildingMatchVerdict, BuildingClusterStats,
  BuildingClusterResult, BuildingFusionResult,
} from './resolvers/buildingResolver';
export {
  DEFAULT_BUILDING_MATCH_POLICY, AGREEMENT_MIN_AREA_RATIO,
  matchBuildings, clusterBuildingObservations, buildGeometryAgreementKeys,
  fuseBuildings, explainBuildingChoice,
} from './resolvers/buildingResolver';
