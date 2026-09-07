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
  MapDatasetTechnicalClassification, MapDatasetDevelopmentEligibility,
  MapDatasetReleaseClassification, MapDatasetAccessMethod, MapDatasetAccessMetadata,
  MapDatasetGovernanceRecord, DevelopmentBenchmarkEvidence,
  DevelopmentBenchmarkGateResult, CommercialReleaseEvidence,
  CommercialReleaseGateResult, MapDataAttributionEntry,
} from './mapDatasetGovernance';
export {
  evaluateDevelopmentBenchmarkGate, evaluateCommercialReleaseGate,
  buildMapDataAttributionProjection, OSM_TURKEY_BASELINE_GOVERNANCE,
  OVERTURE_PLACES_2026_08_19_GOVERNANCE,
  MAP_DATASET_GOVERNANCE_REGISTRY,
} from './mapDatasetGovernance';

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
export type { NormalizedOvertureSources } from './adapters/overtureSource';
export { normalizeOvertureSources } from './adapters/overtureSource';
export type { OverturePlaceRaw } from './adapters/overturePlaceAdapter';
export {
  overturePlaceAdapter, overturePlaceCategory, overturePointToCanonical,
} from './adapters/overturePlaceAdapter';
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
export type { BuildingSourceQualityClass } from './resolvers/buildingQuality';
export {
  classifyBuildingSourceQuality, isCanonicalBuildingGeometryEligible,
} from './resolvers/buildingQuality';
export type {
  PotentialBuildingGapReason, PotentialBuildingGap, BuildingGapPolicy,
  BuildingGapVerificationEvidence, BuildingGapCountRow, BuildingGapObservatorySnapshot,
} from './resolvers/buildingGapDetector';
export {
  DEFAULT_BUILDING_GAP_POLICY, detectPotentialBuildingGaps, observePotentialBuildingGaps,
} from './resolvers/buildingGapDetector';

/* ── Adres/Place index dikişi (F5) — PORT TANIMI, çalışan index DEĞİL ────── */
export type {
  CanonicalAddress, CanonicalPlace, AddressQuery, PlaceQuery,
  IndexUnavailableReason, IndexResult, AddressIndexPort, PlaceIndexPort,
} from './indexes/addressPlaceIndex';
export {
  INDEX_UNAVAILABLE_REASONS, NULL_ADDRESS_INDEX, NULL_PLACE_INDEX,
  unavailableIndexResult, isMeaningfulAddressQuery, isMeaningfulPlaceQuery,
  isRoutableAddress, formatAddress,
} from './indexes/addressPlaceIndex';

/* ── Canlı yol koşulu dikişi (F6) — sağlayıcı BAĞLI DEĞİL ───────────────── */
export type {
  LiveConditionKind, LiveRoadObservation, LiveRoadEvidence, LiveRoadQuery,
  LiveProviderUnavailableReason, LiveRoadConditionsResult, LiveRoadConditionsPort,
} from './live/liveRoadConditions';
export {
  LIVE_CONDITION_KINDS, LIVE_FRESHNESS_BUDGET_MS, NULL_LIVE_ROAD_CONDITIONS,
  gradeLiveObservation, unavailableLiveResult, isMeaningfulLiveQuery,
  usableLiveEvidence, canLiveConditionMutateStaticTruth,
} from './live/liveRoadConditions';
