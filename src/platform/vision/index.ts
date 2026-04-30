/**
 * src/platform/vision/index.ts — Vision Engine Facade
 *
 * Tek giriş noktası. Tüm modüllerdeki public API'yi bir arada sunar.
 * Dış tüketiciler (VisionOverlay.tsx vb.) sadece bu dosyayı import eder.
 *
 * Bağımlılık sırası (dairesel dep yok):
 *   visionUtils → visionTypes → visionImageProcess → visionGeometry → visionCore → index
 */

// ── visionStore re-exports (hooks + runtime types) ───────────────────────────
export {
  useVisionStore,
  useVisionState,
  useLatestVisionFrame,
  useVisionConfidence,
} from '../visionStore';
export type {
  VisionState,
  ConfidenceLevel,
  LaneLine,
  DetectedSign,
  VisionFrame,
  VisionStore,
} from '../visionStore';

// ── AR tip tanımları ─────────────────────────────────────────────────────────
export type {
  CameraIntrinsics,
  ArrowProjectionRange,
  ArrowDepthHints,
  ArrowVertex,
  GroundArrow,
  RouteSample,
  RouteChevron,
  RouteSampleParams,
  LaneEstimate,
  LatencyPrediction,
  ChevronRole,
  EmphasizedChevron,
} from './visionTypes';

// ── Projeksiyon matematiği ───────────────────────────────────────────────────
export {
  buildCameraIntrinsics,
  projectGPSToScreen,
  screenRayToGroundPlane,
  computeArrowProjectionRange,
  computeArrowDepthHints,
  buildGroundArrow,
  computeRouteSampleParams,
  sampleRouteAhead,
  computeOcclusionAlpha,
  buildRouteArrows,
  estimateLaneOffset,
  smoothLaneOffset,
  resetLaneOffset,
  stabilizeRouteChevrons,
  resetStabilization,
  emphasizeRouteArrows,
  interpolateRouteChevrons,
  resetChevronInterpolation,
  updateArLatency,
  setArLatency,
  getArLatency,
  updateYawRate,
  getYawRate,
  predictVehicleState,
  resetLatencyCompensation,
  gatePrediction,
} from './visionGeometry';

// ── Kamera + RAF yönetimi ────────────────────────────────────────────────────
export {
  checkVisionCapabilities,
  startVision,
  stopVision,
  disableVision,
  onVisionFrame,
  getLastFrame,
} from './visionCore';
