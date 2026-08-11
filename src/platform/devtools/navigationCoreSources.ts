/**
 * navigationCoreSources.ts — CAROS LAB · Navigation Core TEK okuma katmanı.
 *
 * Desen (A3–A8 turlarıyla aynı): senkron getter'lar, her biri kendi try/catch'i
 * içinde. HİÇBİR şey başlatmaz/durdurmaz, komut göndermez, timer kurmaz, ağa
 * çıkmaz. Navigasyonu BAŞLATAMAZ, DURDURAMAZ, DEĞİŞTİREMEZ.
 *
 * ── GİZLİLİK (CLAUDE.md gözlemlenebilirlik kuralı 6 — pazarlıksız) ──────────
 * **KOORDİNAT (enlem/boylam) BU KATMANDAN GEÇMEZ.** Konum kişisel veridir ve
 * `LocationEngineScreen` ile aynı kararı uygular. Görev metni "raw GPS" ve
 * "matched position" göstermeyi istiyor; bunu koordinat SIZDIRMADAN karşılarız:
 * ham fix'in VAR/YOK'u, doğruluğu, yaşı ve eşleşen konuma olan DİK MESAFE
 * gösterilir. Tanı için gereken budur — koordinatın kendisi değil.
 * Hedef adı, adres ve rota geometrisi de TAŞINMAZ.
 */

import { getRouteState, getNavigationCoreSnapshot } from '../routingService';
/* G1 TEK KONUM KANIT OTORİTESİ (#527) + fix yaşı dağılımı (#537).
   GİZLİLİK: bu katmandan YALNIZ yaş/bayatlık/kaynak geçer — KOORDİNAT GEÇMEZ. */
import { getLocationEvidence, getFixAgeLedger } from '../gpsService';
import type { FixAgeSummary } from '../navigation/core/fixAgeLedger';
import {
  getNavigationState, getNavSessionId, getRouteRequestClaim, getEtaVerdict,
} from '../navigationService';
import {
  getVoiceGuidanceSnapshot, type VoiceGuidanceSnapshot,
} from '../navigation/voiceGuidanceRuntime';
import type { EtaVerdict } from '../navigation/core/etaModel';
import type {
  RouteDurationSource, RouteDurationIntegrity,
} from '../navigation/core/routeDurationModel';
import {
  getNavigationSessionRuntimeSnapshot,
  type NavigationSessionRuntimeSnapshot,
} from '../navigation/navigationSessionRuntime';
import {
  getCameraFollowSnapshot, type CameraFollowSnapshot,
} from '../navigation/cameraFollowAuthority';
import {
  classifySpeedLimit, type SpeedLimitVerdict,
} from '../navigation/core/speedLimitTruthModel';
import { getSpeedLimitObservation } from '../speedLimitService';
import {
  resolveRoadClass, type RoadClassVerdict,
} from '../navigation/policy/roadClassResolver';
import {
  POLICY_COUNTRY, POLICY_VERSION, POLICY_EFFECTIVE_FROM, POLICY_SOURCE_AUTHORITY,
} from '../navigation/policy/turkeySpeedPolicy';
import {
  computeEffectiveSpeedLimit, EMPTY_EFFECTIVE_SPEED_LIMIT,
  type EffectiveSpeedLimit,
} from '../navigation/core/vehicleAwareSpeedLimitAuthority';
import {
  getVehicleClassSnapshot, maskVehicleClassKey, type VehicleClassSnapshot,
} from '../vehicle/vehicleClassRuntime';
import { EMPTY_VEHICLE_CLASS_PROFILE } from '../vehicle/legalVehicleClass';
import {
  getMarkerMotionSnapshot, type MarkerMotionSnapshot,
} from '../navigation/navMarkerMotionRuntime';
import {
  decideCameraPolicy, CAMERA_POLICY_VERSION,
  type CameraPolicyDecision,
} from '../navigation/core/cameraPolicyModel';
import {
  getNavigationOrientationSnapshot, orientationOf,
} from '../navigation/navigationOrientation';
import { getMapInstance } from '../mapService';
import {
  getCameraShadowSnapshot, type CameraShadowSnapshot,
} from '../navigation/cameraShadowRuntime';
import {
  getCameraDampingSnapshot, type CameraDampingSnapshot,
} from '../cameraEngine';
import {
  getRouteColorSnapshot, type RouteColorSnapshot,
} from '../map/MapLayerManager';
import { useUnifiedVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';
import {
  getMapNight, getMapMode, useMapSourceStore,
  isTunnelNightOverrideActive, getRequestedMapNight,
} from '../mapSourceManager';
import { getTunnelMode } from '../autoBrightnessService';
import {
  isTunnelNightRuntimeRunning, getTunnelNightTransitionCount,
} from '../map/tunnelNightRuntime';
import { getMapContrastProfile, type MapContrastProfile } from '../mapStyleBuilders';
import {
  getRouteRequestSnapshot, type RouteRequestSnapshot,
} from '../navigation/core/routeRequestLedger';
import {
  getProviderReadinessSnapshot, type ProviderReadinessSnapshot,
} from '../navigation/core/routeProviderReadiness';
import { getOfflineRoutingStatus, type OfflineRoutingStatus } from '../navigation/offlineRoutingStatus';
import type { MapMatchState, MapMatchReason } from '../navigation/core/mapMatchModel';
import type { OffRouteState, OffRouteReason } from '../navigation/core/offRouteModel';
import type { RouteVerdict, RouteCheck } from '../navigation/core/routeValidationModel';
import type { AnchorMethod } from '../navigation/core/maneuverIndexModel';
import type { ManeuverDistanceSource } from '../routingService';
import {
  readPaintedArrowDiagnostics, type PaintedArrowDiagnostics,
} from '../map/core/paintedArrowAccess';
import { PAINTED_ARROW_POLICY_VERSION } from '../map/core/paintedArrowModel';

/** Okuma patlarsa sahte "görünüyor" ÜRETİLMEZ — hüküm NOT_EVALUATED kalır. */
const PAINTED_ARROW_FALLBACK: PaintedArrowDiagnostics = {
  visible: false, reason: 'NOT_EVALUATED', shownCount: 0, appliedCount: 0,
  layerPresent: false, policyVersion: PAINTED_ARROW_POLICY_VERSION,
};

export interface NavigationCoreRawSnapshot {
  readonly readAt: number;

  /** Yola boyanmış manevra oku — hüküm + gerekçe + sayaçlar (konum TAŞIMAZ). */
  readonly paintedArrow: PaintedArrowDiagnostics;

  /* ── Navigasyon durumu ─────────────────────────────────────────────────── */
  readonly navStatus: string;
  readonly isNavigating: boolean;
  readonly isRerouting: boolean;
  readonly hasDestination: boolean;      // hedef ADI/koordinatı TAŞINMAZ
  readonly remainingDistanceM: number | null;
  readonly etaSeconds: number | null;

  /* ── Sağlayıcı ─────────────────────────────────────────────────────────── */
  readonly provider: ProviderReadinessSnapshot;
  readonly offlineGraph: OfflineRoutingStatus;
  readonly onlineHint: boolean | null;
  readonly serverUsed: string | null;
  readonly routeError: string | null;
  readonly routeLoading: boolean;
  readonly straightLineActive: boolean;

  /* ── Konum / eşleştirme (KOORDİNAT YOK) ────────────────────────────────── */
  readonly hasRawFix: boolean;
  /**
   * EŞLEŞTİRİLMİŞ fix'in yaşı (ms) — kaynak `routingService` map-match fix'i.
   *
   * ⚠️ #508'İN DAYANDIĞI SAYI BU DEĞİLDİR. Bu yaş, navigasyon çekirdeğinin son
   * işlediği fix'i ölçer (nav aktif değilken hiç tazelenmez). G1 kabul ölçütü
   * KONUM SAĞLAYICISININ fix yaşını ister → `locationFixAgeMs` alanı. İkisi
   * FARKLI olguları ölçer ve ayrışmaları bir ÇELİŞKİ DEĞİLDİR.
   */
  readonly fixAgeMs: number | null;
  /**
   * #508'in dayandığı sayı — G1 TEK OTORİTESİNDEN (`getLocationEvidence()`),
   * MONOTONİK saatten. Bu katman kendi hesabını YAPMAZ (kasa KİLİT 27).
   */
  readonly locationFixAgeMs: number | null;
  readonly locationStale: boolean;
  readonly locationSource: 'GPS' | 'DEAD_RECKONING' | 'NONE';
  /**
   * #537 — fix yaşı DAĞILIMI (p50/p95 + hüküm). Tek anlık örnek #508'i
   * kapatamaz; dağılım kapatır. Örnekleme modeli özet içinde beyan edilir.
   */
  readonly fixAgeDistribution: FixAgeSummary | null;
  /**
   * GPS gözleminin DUVAR SAATİ karşılığı (`readAt - fixAgeMs`).
   *
   * NEDEN TÜRETİLİYOR: `fix.tsMs` monotoniktir (`performance.now`), ekrandaki
   * yaş hesabı ise duvar saatiyle (`readAt`) yapılır. İkisini doğrudan
   * karşılaştırmak SAAT KARIŞTIRMAKtır ve anlamsız yaş üretir. Bu alan iki
   * saati tek noktada, açıkça uzlaştırır.
   *
   * `null` = henüz hiç fix işlenmedi → GPS türevli alanlar damgasız kalır.
   */
  readonly gpsObservedAtWall: number | null;
  readonly mapMatchState: MapMatchState | null;
  readonly mapMatchConfidence: number | null;
  readonly mapMatchSegIdx: number | null;
  readonly lateralM: number | null;
  readonly headingDeltaDeg: number | null;
  readonly alongRemainingM: number | null;
  readonly hasSnappedPosition: boolean;
  readonly matchReasons: readonly MapMatchReason[];
  readonly corridorM: number;

  /* ── Sapma ─────────────────────────────────────────────────────────────── */
  readonly offRouteState: OffRouteState;
  readonly offRouteEvidence: number;
  readonly offRouteRequired: number;
  readonly offRouteRequiredMs: number;
  readonly offRouteConfirmedAtMs: number | null;
  /**
   * Sapmanın doğrulanmasından bu yana geçen süre (ms).
   *
   * NEDEN: `offRouteConfirmedAtMs` monotonik (`performance.now`) bir sayıdır;
   * ekranda ham hâliyle ("1843271 ms") gösterilmesi insana HİÇBİR ŞEY
   * söylemez. Sürüş günü sorulan soru "ne zaman doğrulandı" değil,
   * "kaç saniye önce doğrulandı"dır. `null` = sapma doğrulanmadı.
   */
  readonly offRouteConfirmedAgeMs: number | null;
  readonly offRouteReasons: readonly OffRouteReason[];

  /* ── Rota ilerlemesi ───────────────────────────────────────────────────── */
  readonly geometryPoints: number;
  readonly stepCount: number;
  readonly currentStepIndex: number;
  readonly nextManeuverDistanceM: number | null;
  readonly nextManeuverDistanceSource: ManeuverDistanceSource;
  readonly totalRouteDistanceM: number;
  readonly anchorResolvedCount: number;
  readonly anchorUnresolvedCount: number;
  readonly anchorMethodCounts: Readonly<Record<AnchorMethod, number>>;

  /* ── Doğrulama ─────────────────────────────────────────────────────────── */
  readonly validationVerdict: RouteVerdict | null;
  readonly validationChecks: readonly RouteCheck[];

  /* ── İstek yaşam döngüsü ───────────────────────────────────────────────── */
  readonly requests: RouteRequestSnapshot;
  readonly fetchInFlight: boolean;

  /* ── Şerit dürüstlüğü ──────────────────────────────────────────────────── */
  readonly stepsWithRealLanes: number;
  readonly roundaboutStepCount: number;
  readonly roundaboutWithExitCount: number;

  /* ── Oturum sürekliliği (GÖRÜNÜMDEN BAĞIMSIZ motor) ─────────────────────
   * Sürüş günü sorulacak soru: "tam ekranı kapattım — navigasyon HÂLÂ
   * ilerliyor mu?" Bu blok o soruyu KANITLA yanıtlar: motorun ayakta olup
   * olmadığı, kaç fix işlediği ve son tick'in yaşı. Hiçbiri koordinat veya
   * hedef kimliği TAŞIMAZ. */
  /* ── Harita görünümü + kamera + hız limiti (MINI_MAP_…_P0) ──────────────
   * Hepsi SALT-OKUNUR. Kamera veya hız limiti buradan DEĞİŞTİRİLEMEZ. */
  readonly miniMapStyle: string;
  /** ETKİN gün/gece — tünel örtüsü DAHİL (`getMapNight()`). */
  readonly mapTheme: 'night' | 'day';
  readonly mapContrastProfile: MapContrastProfile;
  /**
   * TÜNEL GECE ÖRTÜSÜ — salt gözlem.
   *  · `tunnelMode`      → `autoBrightnessService` kararı (far + güneş fazı)
   *  · `tunnelOverride`  → örtü haritada FİİLEN uygulanıyor mu
   *  · `requestedNight`  → kullanıcı/saat isteği (örtü kalkınca dönülecek durum)
   *  · `tunnelTransitions` → uygulanan GERÇEK geçiş sayısı (tekrarlar sayılmaz;
   *    bu sayı hızla artıyorsa flicker VARDIR)
   */
  readonly tunnelMode: boolean;
  readonly tunnelOverride: boolean;
  readonly requestedNight: boolean;
  readonly tunnelTransitions: number;
  readonly tunnelBridgeRunning: boolean;
  readonly camera: CameraFollowSnapshot;
  readonly speedLimit: SpeedLimitVerdict;

  /* ── Araç sınıfı + uygulanabilir hız sınırı (VEHICLE_AWARE_SPEED_LIMIT P0) ──
   * SALT-OKUNUR. Buradan sınıf, politika veya limit DEĞİŞTİRİLEMEZ.
   * GİZLİLİK: tam VIN TAŞINMAZ — yalnız maskeli gösterim ve VAR/YOK. */
  readonly vehicleClass: VehicleClassSnapshot;
  /** Araç kanıt deposunun maskeli anahtarı — seri numarası taşımaz. */
  readonly vehicleKeyMasked: string | null;
  readonly roadClassVerdict: RoadClassVerdict;
  readonly effectiveLimit: EffectiveSpeedLimit;
  readonly policyCountry: string;
  readonly policyVersion: string;
  readonly policyEffectiveFrom: string;
  readonly policySourceAuthority: string;
  /** Kalıcı kanıt önbelleği var mı — çevrimdışıyken sınıf hâlâ bilinir mi. */
  readonly offlineCacheState: 'CACHED' | 'EMPTY';

  /* ── Teslim çekirdeği (NAVIGATION_DELIVERY_CORE_P0) — SALT-OKUNUR ────────
   * LAB bu runtime'ları BAŞLATAMAZ, DURDURAMAZ, DEĞİŞTİREMEZ. */
  readonly voice: VoiceGuidanceSnapshot;
  /** Rota süre modeli künyesi. */
  readonly routeDurationSource: RouteDurationSource;
  readonly durationIntegrityState: RouteDurationIntegrity;
  readonly totalRouteDurationSeconds: number | null;
  readonly remainingRouteDurationSeconds: number | null;
  readonly routeRevision: number;
  readonly durationRevision: number;
  /** ETA hükmü — sayı değil GEREKÇE taşır. */
  readonly eta: EtaVerdict;

  /* ── Hareket + kamera (NAVIGATION_MOTION_CAMERA_P0) — SALT-OKUNUR ────────
   * LAB hiçbir kamera veya hareket davranışını DEĞİŞTİREMEZ.
   * Koordinat TAŞINMAZ: konumlar yalnız VAR/YOK + doğruluk olarak maskelidir. */
  readonly markerMotion: MarkerMotionSnapshot;
  readonly cameraPolicy: CameraPolicyDecision;
  readonly cameraPolicyVersion: string;
  /** Canlı harita değerleri — okunamazsa `null` (uydurma yok). */
  readonly mapZoom: number | null;
  readonly mapPitch: number | null;
  readonly mapBearing: number | null;
  readonly orientation: 'PORTRAIT' | 'LANDSCAPE';
  readonly orientationMode: string;
  /**
   * Politikanın BASTIRACAĞI kamera güncellemesi sayısı — GERÇEK sayaç.
   * Kaynak: `cameraShadowRuntime`, her `setDrivingView` çağrısında artar.
   * (Önceki turda sabit 0 raporlanıyordu; o açık borç bu turda kapandı.)
   */
  readonly suppressedCameraUpdates: number;
  /** Gölge gözlem — legacy ↔ politika karşılaştırması (SALT-OKUNUR). */
  readonly cameraShadow: CameraShadowSnapshot;
  /**
   * Kamera SÖNÜMLEME KADANSI — ölçülen tick aralığı ve ondan türeyen gerçek
   * zaman sabiti. Sönümleme alfaları 150 ms'lik bir tempoda ayarlandığı için
   * tempo sapması doğrudan "kamera hissi" sapmasıdır; burası o sapmanın
   * GÖRÜNÜR olduğu tek yerdir (kaynak: gerçek `dampCameraToward` çağrıları).
   */
  readonly cameraDamping: CameraDampingSnapshot;
  /**
   * Rota RENK kararı — tek hakem (`map/core/routeColorModel`).
   * Boya henüz hiç yazılmadıysa `decision`/`input` `null` olur ve LAB
   * `UNAVAILABLE` gösterir; sahte karar ÜRETİLMEZ.
   */
  readonly routeColor: RouteColorSnapshot;

  readonly sessionId: number;
  /** Rota isteği sahiplenilmiş mi — hedef KİMLİĞİ taşınmaz, yalnız VAR/YOK. */
  readonly hasRouteClaim: boolean;
  readonly runtime: NavigationSessionRuntimeSnapshot;
}

function _safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

const _EMPTY_PROVIDER: ProviderReadinessSnapshot = {
  localState: 'UNKNOWN', localProbedAtMs: null, localProbeCount: 0,
  localSkippedCount: 0, lastSource: 'NONE', lastProviderLabel: null,
  straightLineCount: 0, remoteFailureCount: 0,
};

const _EMPTY_OFFLINE: OfflineRoutingStatus = {
  state: 'UNKNOWN', attemptCount: 0, lastAttemptAt: null, usable: false,
};

const _EMPTY_CAMERA: CameraFollowSnapshot = {
  cameraMode: 'UNKNOWN', isVehicleCentered: false, lastUserPanAgeMs: null,
  recenterAvailable: false, lastRecenterAgeMs: null, recenterReason: 'NONE',
  followZoom: null, autoRecenterPending: false, autoRecenterDelayMs: 0, listenerCount: 0,
};

const _EMPTY_SPEED_LIMIT: SpeedLimitVerdict = {
  state: 'UNKNOWN', kmh: null, source: null, ageMs: null,
  distanceFromFixM: null, confidence: 0, reason: 'okunamadı',
};

const _EMPTY_SHADOW: CameraShadowSnapshot = {
  enabled: false, policyVersion: CAMERA_POLICY_VERSION,
  policyEvaluationCount: 0, policyAcceptedCount: 0, policySuppressedCount: 0,
  legacyCameraApplyCount: 0, legacyCameraSkipCount: 0,
  duplicateEquivalentUpdateCount: 0, lastSuppressionReason: null,
  maxAnchorYDelta: 0, maxZoomDelta: 0, maxPitchDelta: 0, last: null,
};

/** Okunamazsa: sayı UYDURULMAZ — ölçüm yok demek `null`/0 demektir. */
const _EMPTY_DAMPING: CameraDampingSnapshot = {
  calibrationDtMs: 0, lastDtMs: null, tickCount: 0, offCadenceTicks: 0,
  effectivePitchTauSec: null, calibrationPitchTauSec: 0,
  cruiseMs: 0, inCruise: false,
};

/** Okunamazsa: karar UYDURULMAZ — `null` "henüz yazılmadı" demektir. */
const _EMPTY_ROUTE_COLOR: RouteColorSnapshot = {
  policyVersion: 'UNAVAILABLE', decision: null, input: null,
};

const _EMPTY_CAMERA_DECISION: CameraPolicyDecision = {
  state: 'UNKNOWN', profileId: 'STOPPED', policyVersion: CAMERA_POLICY_VERSION,
  speedBand: 'STOPPED', maneuverBand: 'NONE', anchorY: 0.5, anchorX: 0.5,
  cameraDriveAllowed: false, applyManeuverCamera: false, maxZoomHint: null,
  updateReason: 'okunamadı',
};

const _EMPTY_MOTION: MarkerMotionSnapshot = {
  state: 'UNKNOWN', interpolationProgress: 0, sourceAgeMs: 0, confidence: 0,
  rawPositionMasked: 'YOK', renderedPositionMasked: 'YOK',
  sampleCount: 0, snapCorrectionCount: 0, duplicateMotionRuntimeCount: 0,
  reason: 'okunamadı',
};

const _EMPTY_ROAD_CLASS: RoadClassVerdict = {
  roadClass: 'UNKNOWN', confidence: 0, motorwayOperatorKnown: false,
  reason: 'okunamadı',
};

const _EMPTY_VEHICLE_CLASS: VehicleClassSnapshot = {
  key: null, profile: EMPTY_VEHICLE_CLASS_PROFILE, researchOutcome: 'IDLE',
  researchAttemptedAt: null, researchFailureReason: null, promptDismissedAt: null,
  vinMasked: null, hasVin: false,
};

const _EMPTY_VOICE: VoiceGuidanceSnapshot = {
  state: 'IDLE', owner: 'NAV_SESSION_RUNTIME', lastSpokenManeuverId: null,
  lastSpokenStage: null, spokenCount: 0, duplicateSuppressed: 0,
  trackedManeuvers: 0, routeKey: '',
};

const _EMPTY_ETA: EtaVerdict = {
  etaSeconds: null, state: 'UNKNOWN', source: 'NONE',
  correctionFactor: 1, baseSeconds: null, reason: 'okunamadı',
};

const _EMPTY_RUNTIME: NavigationSessionRuntimeSnapshot = {
  running: false, tickCount: 0, lastTickAgeMs: null, lastObservedStatus: null,
  skippedNoFix: 0, skippedInactive: 0, errorCount: 0, lastErrorAgeMs: null,
  uptimeMs: null,
  drState: 'IDLE', drOwner: 'NAV_SESSION_RUNTIME', drTickCount: 0,
  drDistanceMeters: 0, drConfidence: 0, drTimerRunning: false,
  /* Okunamadı → eksen/mesafe/segment UYDURULMAZ. */
  drProjectionMode: 'HEADING_FALLBACK', drConsumedRouteM: null, drProjectionSegIdx: null,
};

/** Tek senkron okuma — çağrıldığı anın anlık görüntüsü. */
export function readNavigationCoreSnapshot(): NavigationCoreRawSnapshot {
  const readAt = Date.now();
  const paintedArrow = _safe(() => readPaintedArrowDiagnostics(), PAINTED_ARROW_FALLBACK);
  const nowPerf = _safe(() => performance.now(), 0);

  const route = _safe(() => getRouteState(), null);
  const core  = _safe(() => getNavigationCoreSnapshot(), null);
  const nav   = _safe(() => getNavigationState(), null);

  const fix = core?.fix ?? null;
  const anchors = route?.maneuverAnchors ?? [];
  const fixAgeMs = fix ? Math.max(0, Math.round(nowPerf - fix.tsMs)) : null;

  const anchorMethodCounts: Record<AnchorMethod, number> = {
    CONCATENATION: 0, NEAREST: 0, UNRESOLVED: 0,
  };
  for (const a of anchors) anchorMethodCounts[a.method]++;

  const steps = route?.steps ?? [];
  let stepsWithRealLanes = 0;
  let roundaboutStepCount = 0;
  let roundaboutWithExitCount = 0;
  for (const s of steps) {
    if (s.lanes && s.lanes.length > 0) stepsWithRealLanes++;
    const t = s.maneuverType;
    if (t === 'roundabout' || t === 'rotary' || t === 'roundabout turn') {
      roundaboutStepCount++;
      if (s.roundaboutExit != null) roundaboutWithExitCount++;
    }
  }

  /* Hız limiti zinciri LAB'da da ÜRÜNLE AYNI saf modellerden geçirilir — ekran
     kendi sınıflandırmasını YAPMAZ (ikinci doğruluk kaynağı olmaz). Konum
     TAŞINMAZ: modeller yalnız mesafe/yaş türevlerini döndürür. */
  const slObs = _safe(() => getSpeedLimitObservation(), null);
  const speedLimit = _safe(() => classifySpeedLimit(
    getSpeedLimitObservation(),
    { lat: null, lon: null, nowMs: nowPerf },
    false,
  ), _EMPTY_SPEED_LIMIT);
  const roadClass = _safe(() => resolveRoadClass({
    highway: slObs?.highway ?? null,
    postedKmh: slObs?.kmh ?? null,
    postedSource: slObs?.source ?? null,
  }), _EMPTY_ROAD_CLASS);
  const vehicleClass = _safe(() => getVehicleClassSnapshot(), _EMPTY_VEHICLE_CLASS);

  /* Kamera kararı LAB'da da ÜRÜNLE AYNI saf modelden geçirilir — ekran kendi
     kamera mantığını KURMAZ (ikinci otorite olmaz). */
  const _orientation = _safe(() => (typeof window !== 'undefined'
    ? orientationOf(window.innerWidth, window.innerHeight) : 'LANDSCAPE'), 'LANDSCAPE');
  const _motionNow = _safe(() => getMarkerMotionSnapshot(nowPerf), _EMPTY_MOTION);
  const _camFollow = _safe(() => getCameraFollowSnapshot(), _EMPTY_CAMERA);
  const _shadow = _safe(() => getCameraShadowSnapshot(), _EMPTY_SHADOW);
  const _cameraDecision = _safe(() => decideCameraPolicy({
    speedKmh: useUnifiedVehicleStore.getState().speed ?? 0,
    prevBand: null,
    nextManeuverM: route?.distanceToNextTurnMeters ?? null,
    maneuverDistanceSource: route?.distanceToNextTurnSource ?? 'UNKNOWN',
    secondManeuverM: null,
    followState: (_camFollow.cameraMode as never) ?? 'UNKNOWN',
    motionState: _motionNow.state,
    orientation: _orientation,
    viewport: 'FULL',
  }), _EMPTY_CAMERA_DECISION);

  return {
    paintedArrow,
    readAt,

    navStatus:    nav?.status ?? 'UNKNOWN',
    isNavigating: nav?.isNavigating ?? false,
    isRerouting:  nav?.isRerouting ?? false,
    hasDestination: !!nav?.destination,
    remainingDistanceM: (nav?.distanceMeters != null && Number.isFinite(nav.distanceMeters))
      ? nav.distanceMeters : null,
    etaSeconds: (nav?.etaSeconds != null && Number.isFinite(nav.etaSeconds)) ? nav.etaSeconds : null,

    provider:     _safe(() => getProviderReadinessSnapshot(), _EMPTY_PROVIDER),
    offlineGraph: _safe(() => getOfflineRoutingStatus(), _EMPTY_OFFLINE),
    onlineHint:   _safe(() => (typeof navigator !== 'undefined' ? navigator.onLine : null), null),
    serverUsed:   route?.serverUsed ?? null,
    routeError:   route?.error ?? null,
    routeLoading: route?.loading ?? false,
    straightLineActive: route?.serverUsed === 'straight-line',

    hasRawFix:  fix !== null,
    fixAgeMs,
    /* #508: G1 otoritesinden — koordinat TAŞINMAZ, yalnız yaş/bayatlık/kaynak. */
    locationFixAgeMs: _safe(() => getLocationEvidence().fixAgeMs, null),
    locationStale:    _safe(() => getLocationEvidence().stale, false),
    locationSource:   _safe(() => getLocationEvidence().source, 'NONE'),
    /* #537: dağılım okuma ucu ÖRNEK ALMAZ → LAB'ı açmak ölçümü kirletmez. */
    fixAgeDistribution: _safe(() => getFixAgeLedger().summary, null),
    gpsObservedAtWall: fixAgeMs != null ? readAt - fixAgeMs : null,
    mapMatchState:      fix?.state ?? null,
    mapMatchConfidence: fix ? fix.confidence : null,
    mapMatchSegIdx:     fix ? fix.segIdx : null,
    lateralM:           fix?.lateralM ?? null,
    headingDeltaDeg:    fix?.headingDeltaDeg ?? null,
    alongRemainingM:    fix?.alongRemainingM ?? null,
    hasSnappedPosition: !!(fix && fix.snappedLat !== null && fix.snappedLon !== null),
    matchReasons:       fix?.reasons ?? [],
    corridorM:          core?.corridorM ?? 0,

    offRouteState:         core?.offRoute.state ?? 'UNKNOWN',
    offRouteEvidence:      core?.offRoute.evidenceCount ?? 0,
    offRouteRequired:      core?.offRoute.requiredEvidence ?? 0,
    offRouteRequiredMs:    core?.offRoute.requiredEvidenceMs ?? 0,
    offRouteConfirmedAtMs: core?.offRoute.confirmedAtMs ?? null,
    offRouteConfirmedAgeMs: core?.offRoute.confirmedAtMs != null
      ? Math.max(0, Math.round(nowPerf - core.offRoute.confirmedAtMs))
      : null,
    offRouteReasons:       core?.offRoute.reasons ?? [],

    geometryPoints:   route?.geometry?.length ?? 0,
    stepCount:        steps.length,
    currentStepIndex: route?.currentStepIndex ?? 0,
    nextManeuverDistanceM: (route && Number.isFinite(route.distanceToNextTurnMeters))
      ? route.distanceToNextTurnMeters : null,
    nextManeuverDistanceSource: route?.distanceToNextTurnSource ?? 'UNKNOWN',
    totalRouteDistanceM: route?.totalDistanceMeters ?? 0,
    anchorResolvedCount:   anchors.filter(a => a.geometryIndex >= 0).length,
    anchorUnresolvedCount: anchors.filter(a => a.geometryIndex < 0).length,
    anchorMethodCounts,

    validationVerdict: route?.validation?.verdict ?? null,
    validationChecks:  route?.validation?.checks ?? [],

    requests:      _safe(() => getRouteRequestSnapshot(), {
      currentId: 0, current: null, history: [], committedCount: 0,
      staleRejectedCount: 0, invalidRejectedCount: 0, supersededCount: 0,
      failedCount: 0, suppressedDuplicateCount: 0,
      latency: {
        offRouteDetectedAtMs: null, requestStartedAtMs: null, responseReceivedAtMs: null,
        routeCommittedAtMs: null, firstNewInstructionAtMs: null,
        detectToCommitMs: null, detectToFirstInstructionMs: null, requestToResponseMs: null,
      },
      lastCompletedLatency: {
        offRouteDetectedAtMs: null, requestStartedAtMs: null, responseReceivedAtMs: null,
        routeCommittedAtMs: null, firstNewInstructionAtMs: null,
        detectToCommitMs: null, detectToFirstInstructionMs: null, requestToResponseMs: null,
      },
    }),
    fetchInFlight: core?.fetchInFlight ?? false,

    stepsWithRealLanes,
    roundaboutStepCount,
    roundaboutWithExitCount,

    miniMapStyle: _safe(() => {
      const st = useMapSourceStore.getState();
      return `${getMapMode()}/${st.tileRender}`;
    }, 'UNKNOWN'),
    mapTheme:           _safe(() => (getMapNight() ? 'night' : 'day'), 'night'),
    mapContrastProfile: _safe(() => getMapContrastProfile(getMapNight()), 'NIGHT_READABLE'),
    /* Okunamazsa örtü YOK sayılır (fail-safe: sahte tünel ilan edilmez). */
    tunnelMode:          _safe(() => getTunnelMode(), false),
    tunnelOverride:      _safe(() => isTunnelNightOverrideActive(), false),
    requestedNight:      _safe(() => getRequestedMapNight(), false),
    tunnelTransitions:   _safe(() => getTunnelNightTransitionCount(), 0),
    tunnelBridgeRunning: _safe(() => isTunnelNightRuntimeRunning(), false),
    camera:             _safe(() => getCameraFollowSnapshot(), _EMPTY_CAMERA),
    /* Hız limiti hükmü LAB'da da AYNI saf modelden geçirilir — ekran kendi
       sınıflandırmasını yapmaz (ikinci doğruluk kaynağı olmaz). Konum
       TAŞINMAZ: model yalnız mesafe/yaş türevlerini döndürür. */
    speedLimit,

    vehicleClass,
    vehicleKeyMasked: _safe(() => maskVehicleClassKey(vehicleClass.key), null),
    roadClassVerdict: roadClass,
    effectiveLimit: _safe(() => computeEffectiveSpeedLimit({
      road: speedLimit, roadClass, vehicleClass: vehicleClass.profile,
    }), EMPTY_EFFECTIVE_SPEED_LIMIT),
    policyCountry: POLICY_COUNTRY,
    policyVersion: POLICY_VERSION,
    policyEffectiveFrom: POLICY_EFFECTIVE_FROM,
    policySourceAuthority: POLICY_SOURCE_AUTHORITY,
    offlineCacheState: vehicleClass.profile.resolutionState === 'UNAVAILABLE' ? 'EMPTY' : 'CACHED',

    sessionId:     _safe(() => getNavSessionId(), 0),
    hasRouteClaim: _safe(() => getRouteRequestClaim() !== null, false),
    runtime:       _safe(() => getNavigationSessionRuntimeSnapshot(), _EMPTY_RUNTIME),

    voice: _safe(() => getVoiceGuidanceSnapshot(), _EMPTY_VOICE),
    routeDurationSource:    route?.routeDurationSource ?? 'NONE',
    durationIntegrityState: route?.durationIntegrityState ?? 'MISSING',
    totalRouteDurationSeconds: (route?.totalDurationSeconds != null
      && Number.isFinite(route.totalDurationSeconds) && route.totalDurationSeconds > 0)
      ? route.totalDurationSeconds : null,
    remainingRouteDurationSeconds: route?.remainingRouteDurationSeconds ?? null,
    routeRevision:    route?.routeRevision ?? 0,
    durationRevision: route?.durationRevision ?? -1,
    eta: _safe(() => getEtaVerdict(), _EMPTY_ETA),

    markerMotion: _safe(() => getMarkerMotionSnapshot(nowPerf), _EMPTY_MOTION),
    cameraPolicy: _cameraDecision,
    cameraPolicyVersion: CAMERA_POLICY_VERSION,
    mapZoom:    _safe(() => { const m = getMapInstance(); return m ? Number(m.getZoom().toFixed(2)) : null; }, null),
    mapPitch:   _safe(() => { const m = getMapInstance(); return m ? Math.round(m.getPitch()) : null; }, null),
    mapBearing: _safe(() => { const m = getMapInstance(); return m ? Math.round(m.getBearing()) : null; }, null),
    orientation: _orientation,
    orientationMode: _safe(() => getNavigationOrientationSnapshot().mode, 'LOCKED_LANDSCAPE'),
    /* GERÇEK sayaç — `cameraShadowRuntime` her legacy kamera çağrısında
       politikayı gölgede değerlendirir ve bastırma kararını sayar. */
    suppressedCameraUpdates: _shadow.policySuppressedCount,
    cameraShadow: _shadow,
    cameraDamping: _safe(() => getCameraDampingSnapshot(), _EMPTY_DAMPING),
    routeColor:    _safe(() => getRouteColorSnapshot(), _EMPTY_ROUTE_COLOR),
  };
}
