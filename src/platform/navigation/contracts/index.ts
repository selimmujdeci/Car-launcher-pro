/**
 * navigation/contracts — NAV v3 · KANONİK ÇEKİRDEK SÖZLEŞMELER (F0).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F0.
 *
 * Bu paket YALNIZ sözleşme + saf yardımcıdır. Algoritma (MapStore/EKF/HMM/CEH/
 * routing) IMPLEMENT ETMEZ, ikinci bir ufuk/konum/rota/ETA otoritesi KURMAZ,
 * mevcut çalışan navigasyonu DEĞİŞTİRMEZ.
 *
 * Her sembolün TEK sahibi vardır (kilit test: `navV3ContractsF0.test.ts`).
 */

export type {
  MonotonicMs,
  WallClockMs,
} from './navMonotonicTime';
export {
  asMonotonic,
  asWallClock,
  isMonotonic,
  monoAgeMs,
  isMonoStale,
} from './navMonotonicTime';

export type {
  EvidenceGrade,
  NavSignalSource,
  EvidenceReason,
  Evidenced,
} from './navEvidence';
export {
  EVIDENCE_GRADES,
  NAV_SIGNAL_SOURCES,
  EVIDENCE_REASONS,
  UNAVAILABLE_CONFIDENCE_CEIL,
  STALE_CONFIDENCE_CEIL,
  observedNav,
  derivedNav,
  unavailableNav,
  staleNav,
  evidenceAgeMs,
  withStaleness,
  isDecisionGrade,
} from './navEvidence';

export type {
  EdgeId,
  EdgeIdParts,
} from './navEdgeId';
export {
  EDGE_ID_NULL,
  EDGE_ID_TILE_MAX,
  EDGE_ID_LOCAL_IDX_MAX,
  EDGE_ID_DIR_MAX,
  makeEdgeId,
  splitEdgeId,
  edgeIdEquals,
  isSameUndirectedEdge,
  edgeIdToString,
  edgeIdFromString,
  isEdgeId,
} from './navEdgeId';

export type {
  EgoFixMode,
  RoadMatchState,
  RealtimeEgoPose,
  MatchedRoadPose,
} from './navEgoPose';
export {
  EGO_FIX_MODES,
  ROAD_MATCH_STATES,
  isRealtimeEgoPose,
  isMatchedRoadPose,
  matchedPoseCarriesRaw,
  egoModeAllowsGuidance,
} from './navEgoPose';

export type {
  NavDegradation,
  NavClaim,
} from './navDegradation';
export {
  NAV_DEGRADATION_ORDER,
  NAV_CLAIMS,
  NAV_DEGRADATION_SUPPRESSION,
  NAV_DEGRADATION_USER_MESSAGE,
  worstDegradation,
  isAtLeastAsSevere,
  resolveSuppressedClaims,
  isClaimAllowed,
} from './navDegradation';

export type {
  CehHorizonState,
  HorizonPathProvenance,
  HorizonObjectKind,
  HorizonPathId,
  HorizonObject,
  HorizonPath,
  ElectronicHorizon,
} from './navHorizon';
export {
  CEH_HORIZON_STATES,
  HORIZON_PATH_PROVENANCES,
  HORIZON_OBJECT_KINDS,
  MPP_PATH_ID,
  HORIZON_TIME_HEADWAY_S,
  HORIZON_MIN_M,
  HORIZON_MAX_M,
  horizonBudgetM,
  provenanceIsPhysical,
  cehStateAllowsAheadClaim,
  degradationForHorizonState,
  isElectronicHorizon,
  mostProbablePath,
  ambiguityContractHolds,
} from './navHorizon';

export type { NavLayerId } from './navLayers';
export {
  NAV_LAYER_IDS,
  NAV_LAYER_NAME,
  NAV_LAYER_DEPENDENCY_LAW,
  NAV_RAW_SOURCE_MODULES,
  NAV_RAW_SOURCE_ALLOWLIST,
  NAV_L4_TRUTH_OWNERS,
  mayDependOn,
  isDependencyLawAcyclic,
  routingLayersIsolatedFromMapStore,
} from './navLayers';

export type {
  NavPrediction,
  NavObservedOutcome,
  NavTraversalRecord,
  NavOutcomeComparison,
} from './navOutcomeContract';
export {
  compareOutcome,
  NAV_OUTCOME_CONTRACT,
} from './navOutcomeContract';

export type {
  VehicleEvidenceSignalId,
  VehicleEvidenceReading,
  VehicleEvidenceBus,
} from './vehicleEvidenceBus';
export {
  VEHICLE_EVIDENCE_SIGNAL_IDS,
  UNAVAILABLE_VEHICLE_EVIDENCE_BUS,
  isVehicleEvidenceSignalId,
} from './vehicleEvidenceBus';
