/**
 * navigationCoreFieldAudit.test.ts — CAROS LAB · Navigation Core ALAN DENETİMİ.
 *
 * ── NEDEN VAR (sürüş öncesi hazırlık, 2026-08-03) ───────────────────────────
 * Gerçek araç ölçümü sırasında bakılacak TEK yüzey bu ekrandır. Bir alanın
 * kaynağı yoksa, yanlış kaynaktan geliyorsa veya tazelik iddiası uydurmaysa,
 * saha ölçümü sessizce çürür — üstelik bunu sürüş sırasında fark etmek imkânsızdır.
 *
 * Bu dosya HER ALANI tek tek kayıt altına alır ve üç şeyi kilitler:
 *   1. Alanın GERÇEK bir anlık-görüntü kaynağı var (SOURCE_MISSING yok).
 *   2. Tazelik damgası sözleşmeye uygun (GPS türevli → yaşlanır; sayaç → damgasız).
 *   3. Kayıt dışı yeni alan eklenemez (kayıt ile ekran senkron kalır).
 */
import { describe, it, expect } from 'vitest';
import {
  buildNavigationCoreCards, deriveNavCoreVerdict,
} from '../platform/devtools/navigationCoreModel';
import type { NavigationCoreRawSnapshot } from '../platform/devtools/navigationCoreSources';
import { readNavigationCoreSnapshot } from '../platform/devtools/navigationCoreSources';
import type { ShadowDomainCounters } from '../platform/navigation/shadow/cehShadowModel';
import { EMPTY_SHADOW_COUNTERS } from '../platform/navigation/shadow/cehShadowModel';

const NOW = 1_700_000_000_000;
const GPS_AGE = 400;

/** F5 gölge defteri fixture yardımcısı — sayaç şekli tek yerde kalsın. */
function shadowCounters(
  over: Partial<ShadowDomainCounters> = {},
): ShadowDomainCounters {
  return { ...EMPTY_SHADOW_COUNTERS, ...over };
}

/** Tüm alanların dolu olduğu anlık görüntü — "kaynak var mı" denetimi için. */
function full(over: Partial<NavigationCoreRawSnapshot> = {}): NavigationCoreRawSnapshot {
  return {
    readAt: NOW,
    paintedArrow: {
      visible: true, reason: 'SHOWN', shownCount: 3, appliedCount: 11,
      layerPresent: true, policyVersion: 'PA-2026.08.08',
    },
    navStatus: 'ACTIVE', isNavigating: true, isRerouting: false,
    hasDestination: true, remainingDistanceM: 4200, etaSeconds: 380,
    provider: {
      localState: 'LOCAL_OSRM_UNAVAILABLE', localProbedAtMs: NOW - 5_000,
      localProbeCount: 1, localSkippedCount: 7,
      lastSource: 'REMOTE_OSRM', lastProviderLabel: 'routing.openstreetmap.de',
      straightLineCount: 0, remoteFailureCount: 2,
    },
    offlineGraph: { state: 'GRAPH_MISSING', attemptCount: 1, lastAttemptAt: NOW - 9_000, usable: false },
    onlineHint: true, serverUsed: 'routing.openstreetmap.de',
    routeError: null, routeLoading: false, straightLineActive: false,
    hasRawFix: true, fixAgeMs: GPS_AGE, gpsObservedAtWall: NOW - GPS_AGE,
    mapMatchState: 'MATCHED', mapMatchConfidence: 0.82, mapMatchSegIdx: 12,
    lateralM: 6.4, headingDeltaDeg: 8, alongRemainingM: 4180,
    hasSnappedPosition: true, matchReasons: [], corridorM: 61,
    offRouteState: 'ON_ROUTE', offRouteEvidence: 0, offRouteRequired: 3,
    offRouteRequiredMs: 1500, offRouteConfirmedAtMs: 12345, offRouteConfirmedAgeMs: 8200,
    offRouteReasons: ['ON_CORRIDOR'],
    geometryPoints: 640, stepCount: 14, currentStepIndex: 3,
    nextManeuverDistanceM: 312, nextManeuverDistanceSource: 'ALONG_ROUTE',
    totalRouteDistanceM: 9800,
    anchorResolvedCount: 14, anchorUnresolvedCount: 0,
    anchorMethodCounts: { CONCATENATION: 14, NEAREST: 0, UNRESOLVED: 0 },
    validationVerdict: 'VALID',
    validationChecks: [{ id: 'ORIGIN_PROXIMITY', status: 'PASS', detail: '4 m' }],
    /* NAV v3 · F7 — gerçek bir seçim turu: iki aday, biri kusurdan düştü. */
    routeRationale: {
      last: {
        chosenIdx: 1,
        candidates: [
          { index: 0, distanceM: 12_000, durationS: 900, verdict: 'DEGRADED',
            failCount: 1, warnCount: 0, failedCheckIds: ['DEST_PROXIMITY'], accepted: true },
          { index: 1, distanceM: 13_400, durationS: 980, verdict: 'VALID',
            failCount: 0, warnCount: 1, failedCheckIds: [], accepted: true },
        ],
        decidingFactor: 'VALIDATION_FAIL',
        durationPenaltyS: 80,
        durationPenaltyRatio: 80 / 900,
        acceptedCount: 2,
        rejectedCount: 0,
        provider: 'REMOTE_OSRM',
      },
      recent: [],
      decisions: 4,
      overrodeProviderFirst: 1,
      maxDurationPenaltyS: 80,
      factorCounts: {
        ONLY_OPTION: 2, VALIDATION_FAIL: 1, VALIDATION_WARN: 0, DURATION: 1,
        TIE_PROVIDER_ORDER: 0, USER_SELECTED: 0, NO_CANDIDATE: 0, UNKNOWN: 0,
      },
    },
    requests: {
      currentId: 3,
      current: { id: 3, kind: 'REROUTE', startedAtMs: 1000, respondedAtMs: 1700,
                 committedAtMs: 1800, outcome: 'COMMITTED', provider: 'osrm' },
      history: [], committedCount: 3, staleRejectedCount: 1,
      invalidRejectedCount: 0, supersededCount: 1, failedCount: 0,
      suppressedDuplicateCount: 2,
      latency: { offRouteDetectedAtMs: 800, requestStartedAtMs: 1000,
                 responseReceivedAtMs: 1700, routeCommittedAtMs: 1800,
                 firstNewInstructionAtMs: 2100, detectToCommitMs: 1000,
                 detectToFirstInstructionMs: 1300, requestToResponseMs: 700 },
      lastCompletedLatency: { offRouteDetectedAtMs: null, requestStartedAtMs: null,
                 responseReceivedAtMs: null, routeCommittedAtMs: null,
                 firstNewInstructionAtMs: null, detectToCommitMs: null,
                 detectToFirstInstructionMs: null, requestToResponseMs: null },
    },
    fetchInFlight: false,
    stepsWithRealLanes: 2, roundaboutStepCount: 2, roundaboutWithExitCount: 1,
    sessionId: 3, hasRouteClaim: true,
    /* P0-NAV-09 — hedef bütünlüğü (kabul edilmiş hedef + ölçülmüş asimetri). */
    destinationOk: true, destinationRejection: null, destinationRejectionCount: 0,
    destinationRejectedTotal: 1, destinationSwapSuspectTotal: 0,
    destinationSwapSuspected: false,
    destinationSwapAsGivenKm: 4.2, destinationSwapIfSwappedKm: 812.5,
    destinationPrecision: 'STREET', destinationProvider: 'NOMINATIM',
    destinationAgeMs: 4_000, destinationIdMasked: 'no…23 (7)',
    /* P0-NAV-10 — sağlayıcı sicili (yedek kurtarması = gizli degradasyon). */
    routeChain: {
      outcome: 'FALLBACK_SUCCESS', winner: 'REMOTE_OSRM', winnerLabel: 'srv-b',
      fallbackReason: 'TIMEOUT', degradedSteps: 1, attemptedCount: 2,
      why: '1 katman düştü, uzak OSRM sunucusu kurtardı',
    },
    routeAttemptCounts: { 'REMOTE_OSRM|TIMEOUT': 1, 'REMOTE_OSRM|SUCCESS': 1 },
    routeFallbackSuccessCount: 1, routeStraightLineChainCount: 0,
    routeAttempts: [],
    /* P0-NAV-11 — uygulanan geometrinin künyesi + reddedilen aday kanıtı. */
    committedGeometry: {
      requestId: 3, providerLabel: 'routing.openstreetmap.de',
      integrity: 'VALID',
      metrics: {
        pointCount: 640, uniquePointCount: 638, duplicateCount: 2,
        invalidPointCount: 0, maxGapM: 84, polylineLengthM: 9_780,
        bboxWidthDeg: 0.0812, bboxHeightDeg: 0.0447,
      },
      flaws: [],
      startDistanceM: 4, endDistanceM: 11, routeRevision: 7,
      atMs: NOW - 1_200,
    },
    rejectedGeometryTotal: 1,
    lastRejectedFlaws: ['LENGTH_MISMATCH'],
    lastRejectedCheckIds: ['REACHES_DESTINATION'],
    /* P0-NAV-12 — ilerleme dürüstlüğü (bir gerçek geri dönüş + bir sıçrama). */
    progress: {
      counts: {
        PLAUSIBLE: 120, STATIONARY: 8, IMPLAUSIBLE_FORWARD: 1, REAL_BACKTRACK: 1,
        IMPLAUSIBLE_BACKWARD: 0, ROUTE_CHANGED: 2, UNKNOWN: 5,
      },
      anomalies: [{
        verdict: 'IMPLAUSIBLE_FORWARD', deltaM: 3_000, budgetM: 122,
        speedKmh: 90, headingDeltaDeg: 4, atMs: NOW - 30_000,
      }],
      lastVerdict: 'PLAUSIBLE',
      maxForwardJumpM: 3_000, maxBackwardJumpM: 800, totalSamples: 137,
    },
    /* P0-NAV-13 — engellenen reroute'lar artık GÖRÜNÜR (eskiden hiç okunmuyordu). */
    rerouteHealth: {
      health: 'BLOCKED_TRANSIENT', offRouteForMs: 8_200,
      blockedBy: 'THROTTLED', why: '8 saniyedir bekleniyor — son engel: THROTTLED',
    },
    rerouteBlockedCount: 3,
    rerouteBlockByReason: { WEAK_ACCURACY: 1, THROTTLED: 2, NO_CONTEXT: 0, STRAIGHT_LINE: 0, DR_POSITION: 0 },
    rerouteLastBlockReason: 'THROTTLED',
    /* P0-NAV-16 — anons denetimi: bir geç anons + bir meşru sessizlik. */
    guidanceAudit: {
      timing: { ON_TIME: 14, LATE: 1, VERY_LATE: 0, UNKNOWN: 0 },
      missed: { NONE: 5, MISSED_IMMINENT: 0, MISSED_ALL: 0, SILENCE_JUSTIFIED: 2 },
      recent: [{
        maneuverId: '3:7:4', stage: 'NEAR', timing: 'LATE', missed: 'NONE',
        distanceM: 90, atMs: NOW - 20_000,
      }],
      announcementCount: 15, maneuverCount: 7,
    },
    /* P0-NAV-19 — sıcak yol maliyeti (düşük-uçlu cihazda p95 kritiktir). */
    tickCost: {
      mapMatch:     { samples: 128, total: 940, p50Ms: 0.42, p95Ms: 1.8, maxMs: 6.2 },
      progressTick: { samples: 128, total: 940, p50Ms: 0.91, p95Ms: 3.4, maxMs: 11.7 },
    },
    /* P0-NAV-20 — arıza tablosu (bir eksen degrade: yedek kurtarmış). */
    failureMatrix: {
      axes: [
        { axis: 'GPS', state: 'HEALTHY', why: 'konum karar kalitesinde' },
        { axis: 'NETWORK', state: 'HEALTHY', why: 'çevrimiçi' },
        { axis: 'SEARCH', state: 'HEALTHY', why: 'sonuç üretildi' },
        { axis: 'ROUTE_PROVIDER', state: 'DEGRADED', why: 'yedek katman kurtardı — gizli degradasyon' },
        { axis: 'GEOMETRY', state: 'HEALTHY', why: 'geometri sağlam' },
        { axis: 'PROGRESS', state: 'HEALTHY', why: 'ilerleme makul' },
        { axis: 'REROUTE', state: 'HEALTHY', why: 'sapma yok ya da rota kuruldu' },
      ],
      overall: 'DEGRADED',
      worstAxis: 'ROUTE_PROVIDER',
      summary: 'rota sağlayıcı: kusurlu ama çalışıyor — yedek katman kurtardı',
    },
    miniMapStyle: 'road/raster', mapTheme: 'night', mapContrastProfile: 'NIGHT_READABLE',
    camera: {
      cameraMode: 'FOLLOWING', isVehicleCentered: true, lastUserPanAgeMs: 4200,
      recenterAvailable: false, lastRecenterAgeMs: 900, recenterReason: 'USER_BUTTON',
      followZoom: 16.5, autoRecenterPending: false, autoRecenterDelayMs: 3000, listenerCount: 2,
    },
    speedLimit: {
      state: 'AVAILABLE', kmh: 50, source: 'osm', ageMs: 12000,
      distanceFromFixM: 40, confidence: 0.8, reason: 'yolun maxspeed etiketi',
    },
    vehicleClass: {
      key: 'mmy:FIAT|DOBLO|2016',
      profile: {
        make: 'Fiat', model: 'Doblo', modelYear: 2016, vinMasked: 'ZFA…56',
        legalVehicleCategory: 'N1', registrationBodyType: 'PICKUP',
        source: 'USER_CONFIRMED', confidence: 0.95,
        verifiedAt: NOW - 86_400_000, expiresAt: null,
        sourceRefs: [{ url: 'https://example.org/a', title: 'Tip onayı', retrievedAt: NOW }],
        resolutionState: 'VERIFIED', candidates: [], reason: 'kullanıcı ruhsat beyanı',
      },
      researchOutcome: 'RESOLVED', researchAttemptedAt: NOW - 3_600_000,
      researchFailureReason: 'önceki denemede zaman aşımı',
      promptDismissedAt: null, vinMasked: 'ZFA…56', hasVin: true,
    },
    vehicleKeyMasked: 'mmy:FIAT|DOBLO|2016',
    roadClassVerdict: {
      roadClass: 'MOTORWAY_KGM', confidence: 0.9, motorwayOperatorKnown: false,
      reason: 'OSM highway=motorway',
    },
    effectiveLimit: {
      roadLimitKmh: 130, vehicleClassCapKmh: 95, effectiveLimitKmh: 95,
      effectiveLimitReason: 'VEHICLE_CLASS_CAP', state: 'AVAILABLE', confidence: 0.77,
      sourceAgeMs: 12_000, roadClass: 'MOTORWAY_KGM', sourceLabel: 'ARAÇ SINIRI',
      reason: 'araç sınıfı tavanı yol sınırından düşük',
      policyCountry: 'TR', policyVersion: 'TR-2022.07.01',
      policyEffectiveFrom: '2022-07-01', policySourceAuthority: 'KGM · md.100',
    },
    policyCountry: 'TR', policyVersion: 'TR-2022.07.01',
    policyEffectiveFrom: '2022-07-01', policySourceAuthority: 'KGM · md.100',
    offlineCacheState: 'CACHED',
    voice: {
      state: 'ACTIVE', owner: 'NAV_SESSION_RUNTIME',
      lastSpokenManeuverId: '3:2:1', lastSpokenStage: 'NEAR',
      spokenCount: 4, duplicateSuppressed: 2, trackedManeuvers: 3, routeKey: '3:2',
    },
    routeDurationSource: 'OSRM_ANNOTATION',
    durationIntegrityState: 'VALID',
    totalRouteDurationSeconds: 1800,
    remainingRouteDurationSeconds: 640,
    routeRevision: 2,
    durationRevision: 2,
    eta: {
      etaSeconds: 690, state: 'ROUTE_MODEL', source: 'OSRM_ANNOTATION',
      correctionFactor: 1.08, baseSeconds: 640,
      reason: 'gözlenen 55 km/sa · model 60 km/sa',
    },
    markerMotion: {
      state: 'INTERPOLATING', interpolationProgress: 0.42, sourceAgeMs: 210,
      confidence: 0.9, rawPositionMasked: 'VAR ±8 m', renderedPositionMasked: 'VAR',
      sampleCount: 120, snapCorrectionCount: 1, duplicateMotionRuntimeCount: 0,
      reason: 'iki fix arası ara değer',
    },
    cameraPolicy: {
      state: 'FOLLOW_CRUISE', profileId: 'CRUISE', policyVersion: 'CAM-2026.08.05',
      speedBand: 'CRUISE', maneuverBand: 'NONE', anchorY: 0.66, anchorX: 0.5,
      cameraDriveAllowed: true, applyManeuverCamera: false, maxZoomHint: null,
      updateReason: 'seyir profili (CRUISE) — ön yol bağlamı',
    },
    cameraPolicyVersion: 'CAM-2026.08.05',
    mapZoom: 15.8, mapPitch: 42, mapBearing: 148,
    orientation: 'LANDSCAPE', orientationMode: 'LOCKED_LANDSCAPE',
    suppressedCameraUpdates: 244,
    cameraShadow: {
      enabled: true, policyVersion: 'CAM-2026.08.05',
      policyEvaluationCount: 340, policyAcceptedCount: 96, policySuppressedCount: 244,
      legacyCameraApplyCount: 288, legacyCameraSkipCount: 52,
      duplicateEquivalentUpdateCount: 173,
      lastSuppressionReason: 'kullanıcı haritayı sürüklüyor — kamera sürülmez',
      maxAnchorYDelta: 0.072, maxZoomDelta: 0, maxPitchDelta: 0,
      last: {
        divergence: 'MINOR', zoomDelta: null, pitchDelta: null, bearingDelta: null,
        anchorYDelta: -0.021, legacyApplied: true, policyAllowed: true,
        cameraState: 'FOLLOW_CRUISE', speedBand: 'CRUISE', maneuverBand: 'NONE',
        speedKmh: 98, maneuverAlongM: 1240, positionAgeMs: 240,
        headingConfidence: 0.93, headingKnown: true, suppressionReason: null,
        reason: 'çapa farkı 0.021 — bant içi',
      },
    },
    /* Kamera SÖNÜMLEME KADANSI — alfalar 150 ms'lik tempoda ayarlandı;
       sapma doğrudan "kamera hissi" sapmasıdır (bkz. cameraEngine). */
    cameraDamping: {
      calibrationDtMs: 150, lastDtMs: 152, tickCount: 288, offCadenceTicks: 0,
      effectivePitchTauSec: 1.30, calibrationPitchTauSec: 1.29,
      cruiseMs: 1050, inCruise: true,
    },
    /* Rota RENK kararı — tek hakem (`map/core/routeColorModel`). */
    routeColor: {
      policyVersion: 'RC-2026.08.07',
      decision: {
        casing: '#f59e0b', glow: '#f59e0b', coreMode: 'EMPHASIS', coreOpacity: 1,
        reason: 'HAZARD', routeColorKey: 'HAZARD|dark|RC-2026.08.07',
        policyVersion: 'RC-2026.08.07',
      },
      input: { maneuverTier: 1, hazardHigh: true, lightBasemap: false },
    },
    runtime: {
      running: true, tickCount: 42, lastTickAgeMs: 900, lastObservedStatus: 'ACTIVE',
      skippedNoFix: 1, skippedInactive: 5, errorCount: 0, lastErrorAgeMs: null,
      uptimeMs: 60_000,
      drState: 'GPS_FRESH', drOwner: 'NAV_SESSION_RUNTIME', drTickCount: 7,
      drDistanceMeters: 42, drConfidence: 1, drTimerRunning: true,
      /* DR projeksiyon ekseni (#451) — dolu anlik goruntude olculmus degerler. */
      drProjectionMode: 'ALONG_ROUTE', drConsumedRouteM: 118, drProjectionSegIdx: 14,
    },
    /* NAV v3 · F3 — L2 ego / L3 ufuk gozlemi. DOLU anlik goruntu: her alan
       olculmus deger tasir (kanit YOKKEN alanlarin UNAVAILABLE kalmasi ayri
       testlerin konusudur — burada "kaynagi olmayan alan" aranir). */
    ego: {
      initialized: true, mode: 'GNSS', modeReason: 'FRESH_FIX', guidanceAllowed: true,
      degradedByTime: false, degradedBySigma: false, sigmaHorizontalM: 4.2,
      fixAgeMs: GPS_AGE, observations: 120, positionUpdatesAccepted: 96,
      positionUpdatesRejected: 4, lastRejectReason: null, lastMahalanobis: 1.8,
      zuptApplied: 3, candidateOutcome: 'CANDIDATES', candidateCount: 3,
      matchOutcome: 'MATCHED', matchReason: 'CONFIDENT', topologyEvidence: true,
      monotonicClock: true,
    },
    ceh: {
      initialized: true, state: 'HORIZON_AVAILABLE', generation: 12, observations: 12,
      monotonicClock: true, horizonAgeMs: 400, pathCount: 1, mppPresent: true,
      ambiguous: false, physicallyConfirmed: true, objectCount: 2, budgetM: 600,
      mapAvailable: true, routeIntentAvailable: true, routeIntentPushes: 12,
      routeIntentAgeMs: 400, errorCount: 0,
    },
    yawFeed: {
      attached: true, holders: 1, events: 640, lastEventAgeMs: 30,
      accepted: 610, rejectedNoGyro: 0, rejectedGravity: 28, rejectedTime: 2,
      polarity: 1, polarityDecisions: 4, lastPolarityDecision: 'AGREE',
      headingObservations: 18, yawRateRadPerSec: 0.12, yawReason: 'OK',
    },
    egoHorizonBridge: {
      orientationAcquired: true, graphAcquired: true, ticks: 120, headingNotes: 18,
      routeIntentPushes: 120, errorCount: 0, lastErrorAgeMs: null,
    },
    graphResidency: {
      state: 'AVAILABLE', holders: 1, loadCount: 1,
      nodeCount: 238252, edgeCount: 295346, version: 2, bytes: 7651542,
      parseMs: 180, adjacencyBuilt: true, reverseAdjacencyBuilt: true,
      spatialIndexBuilt: true, detail: 'v2 · 238252 düğüm · 295346 kenar',
      restrictionCount: 117, viaWayChainCount: 2,
      observedAtMonoMs: 1000,
      /* RTG4 — sınırlı sakinlikle talep üzerine pencere sayaçları. */
      residentRegions: ['tr-69-73', 'tr-69-74', 'tr-68-74'],
      residentGraphBytes: 18023424, peakResidentRegions: 3,
      peakResidentGraphBytes: 18023424, maxResidentRegions: 3,
      maxResidentGraphBytes: 67108864, onDemandRegionLoads: 11,
      regionEvictions: 8, windowFailClosedReason: null,
      altResidentBytes: 20010080, altPeakResidentBytes: 20010080,
      altSliceLoads: 22, altSliceEvictions: 19, altUnavailableReason: null,
    },
    regionalDistribution: {
      manifestStatus: 'READY', datasetId: 'osm-tr-fixture', datasetVersion: '2026-09-A',
      installedRegions: 22, installedGraphBytes: 77_539_328, installedAltBytes: 53_240_688,
      diskBudgetBytes: 500_000_000, pinnedBytes: 130_780_016, evictableBytes: 0,
      activeDownloads: 0, downloadRetries: 1, stagingBytes: 0,
      lastDownloadFailure: null, lastIntegrityFailure: null, registryRecoveryStatus: 'NORMAL',
      recoveredGenerations: 0, rejectedGenerations: 0, orphanGenerations: 0,
      lastRebuildFailure: null, lastPublishFailure: null,
    },
    crossRegionSearch: {
      closedStates: 139229, maxClosedBudget: 200000, windowsUsed: 20,
      weightEscalations: 14, altLandmarkCount: 8, altActive: true,
      reconstructionBytes: 7794468,
      closedByClass: [0, 3200, 8400, 9100, 21000, 44000, 18000, 30000, 900, 4600],
      observedAtMs: 1000,
    },
    /* NAV v3 · F5 — gölge karşılaştırma. Fixture DOLU olmalıdır: dolu anlık
       görüntüde UNAVAILABLE kalan bir alan, kaynağı olmayan alandır. */
    cehShadow: {
      active: true, ticks: 120, errorCount: 0, lastErrorAgeMs: null,
      attributePortsBound: false,
      domains: {
        MANEUVER:     shadowCounters({ samples: 120, agree: 114, divergeDistance: 2, comparable: 118, divergences: 4, maxAbsDeltaM: 41.2, lastVerdict: 'AGREE' }),
        ENFORCEMENT:  shadowCounters({ samples: 12, legacyOnly: 3, bothUnmeasured: 9, comparable: 3, divergences: 3, lastVerdict: 'LEGACY_ONLY' }),
        SPEED_LIMIT:  shadowCounters({ samples: 120, notComparable: 120, lastVerdict: 'NOT_COMPARABLE' }),
        CURVE:        shadowCounters({ samples: 120, notComparable: 120, lastVerdict: 'NOT_COMPARABLE' }),
        ROAD_PROFILE: shadowCounters({ samples: 120, notComparable: 120, lastVerdict: 'NOT_COMPARABLE' }),
      },
      total: shadowCounters({ samples: 492, agree: 114, divergeDistance: 2, legacyOnly: 3, bothUnmeasured: 9, notComparable: 360, comparable: 121, divergences: 7, maxAbsDeltaM: 41.2, lastVerdict: 'NOT_COMPARABLE' }),
      divergenceRatio: 7 / 121,
      states: {
        horizons: 120, ambiguous: 3, physicallyConfirmed: 0, routeIntentOnly: 117,
        noHorizon: 0, lastState: 'CLAIM', lastProvenance: 'ROUTE_INTENT',
      },
      guardianShadow: {
        shadow: true, wouldEmit: false, blockedBy: 'CUTOVER_GATE_CLOSED',
        distanceM: null, confidence: null, label: null,
        sourceId: 'EGM_EDS_MAP', eventKey: null,
      },
      guardianWouldEmitCount: 0,
      suppression: {
        evaluated: 0, delivered: 0, deferred: 0, droppedExpired: 0,
        droppedSuperseded: 0, droppedNoValidity: 0, droppedAlreadyDelivered: 0,
        lastDisposition: null,
      },
      cutover: {
        open: false, state: 'CLOSED',
        unmet: ['F4_FIELD_VALIDATION', 'SHADOW_SAMPLE_VOLUME', 'SHADOW_DIVERGENCE',
          'AMBIGUITY_FAIL_CLOSED', 'REGRESSION_GUARDS', 'ATTRIBUTE_PORTS_BOUND'],
        met: [], unmeasuredCount: 3,
      },
      sideEffectCount: 0,
    },
    /* NAV v3 · F6 — sınırlı koridor + kenar-tabanlı denetim noktası. Fixture
       DOLU olmalıdır: dolu anlık görüntüde UNAVAILABLE kalan bir alan,
       kaynağı olmayan alandır. */
    enforcementHorizonPort: {
      calls: 42, lastOutcome: 'OBJECTS',
      lastCorridorOutcome: 'COMPLETE', lastCorridorEdgeCount: 6,
      lastCorridorNodeExpansions: 4, lastCorridorBranchCount: 1,
      lastCandidateCount: 3, lastObjectCount: 1, lastDurationMs: 0.42,
      cumulativeMatch: {
        matchedToEdge: 12, ambiguousEdge: 1, noEdgeMatch: 4, outsideCoverage: 20,
        notMeasured: 0, onewayImplied: 8, unknownDirection: 4, lastOutcome: 'MATCHED_TO_EDGE',
      },
    },
    ...over,
  };
}

/**
 * ALAN KAYITI — her alan için: hangi modülden gelir, anlık görüntüde hangi
 * alana dayanır, tazelik damgası ne olmalı.
 *
 *   GPS  = GPS gözleminden türer → damga `gpsObservedAtWall` (YAŞLANIR)
 *   NONE = sayaç/yapılandırma/anlık okuma → bağımsız damga YOK
 *   OWN  = kendi gerçek damgası var
 */
type Stamp = 'GPS' | 'NONE' | 'OWN';
interface Reg { source: string; key: keyof NavigationCoreRawSnapshot | string; stamp: Stamp; }

/** P0-NAV-09 hedef bütünlüğü kaynağı — kart ile kayıt aynı etiketi kullanır. */
const SRC_DEST_AUDIT = 'navigationService.getDestinationIntegritySnapshot';
/** P0-NAV-10 rota sağlayıcı sicili kaynağı. */
const SRC_ROUTE_LEDGER_AUDIT = 'routeProviderLedger.getRouteProviderLedger';
/** P0-NAV-11 geometri kanıtı kaynağı. */
const SRC_GEOMETRY_AUDIT = 'routeGeometryModel.getCommittedGeometry';
/** P0-NAV-12 ilerleme defteri kaynağı. */
const SRC_PROGRESS_AUDIT = 'routeProgressLedger.getProgressLedger';
/** P0-NAV-13 reroute engel/açlık kaynağı. */
const SRC_REROUTE_AUDIT = 'routeRequestLedger.getRerouteBlockStats';
/** P0-NAV-16 sesli yönlendirme denetimi kaynağı. */
const SRC_GUIDANCE_AUDIT_AUDIT = 'voiceGuidanceAudit.getGuidanceAudit';
/** P0-NAV-19 sıcak yol maliyeti kaynağı. */
const SRC_TICK_COST_AUDIT = 'navTickCostModel.getNavTickCostSnapshot';
/** P0-NAV-20 arıza tablosu kaynağı. */
const SRC_MATRIX_AUDIT = 'navFailureMatrixModel.buildNavFailureMatrix';
/** NAV v3 · F3 — L2 ego / L3 ufuk gözlem kaynakları. */
const SRC_EGO_AUDIT    = 'ego/egoAuthority.getDiagnostics';
const SRC_CEH_AUDIT    = 'horizon/cehAuthority.getDiagnostics';
const SRC_YAW_AUDIT    = 'navOrientationFeed.getSnapshot';
const SRC_BRIDGE_AUDIT = 'navEgoHorizonBridge.getSnapshot';
const SRC_GRAPH_AUDIT  = 'map/graph/graphResidencyRuntime.getSnapshot';
const SRC_DISTRIBUTION_AUDIT = 'map/graph/regionalDataDistribution.getSnapshot';
/** RTG4 — son uzun rota arama profili (bütçe · ALT kanıtı · sınıf dağılımı). */
const SRC_LONGROUTE_AUDIT = 'offlineRoutingService.getCrossRegionSearchSnapshot';
/** NAV v3 · F5 — gölge karşılaştırma + cutover kapısı. */
const SRC_SHADOW_AUDIT = 'shadow/cehShadowRuntime.getSnapshot';
/** NAV v3 · F6 — sınırlı koridor + kenar-tabanlı denetim noktası. */
const SRC_ENFORCEMENT_AUDIT = 'enforcementHorizonPort.getSnapshot';
const SRC_ROUTE_RATIONALE = 'routeRationaleModel.getRouteRationaleLedger';

const REGISTRY: Record<string, Reg> = {
  /* 1 · Durum */
  'nav-status':     { source: 'navigationService', key: 'navStatus',          stamp: 'NONE' },
  'nav-active':     { source: 'navigationService', key: 'isNavigating',       stamp: 'NONE' },
  'nav-dest':       { source: 'navigationService', key: 'hasDestination',     stamp: 'NONE' },
  'nav-remaining':  { source: 'navigationService', key: 'remainingDistanceM', stamp: 'GPS'  },
  'nav-eta':        { source: 'navigationService', key: 'etaSeconds',         stamp: 'GPS'  },
  /* 2 · Sağlayıcı */
  'pv-local':       { source: 'routeProviderReadiness', key: 'provider.localState',        stamp: 'OWN'  },
  'pv-probe':       { source: 'routeProviderReadiness', key: 'provider.localProbeCount',   stamp: 'NONE' },
  'pv-online':      { source: 'navigator.onLine',       key: 'onlineHint',                 stamp: 'NONE' },
  'pv-source':      { source: 'routeProviderReadiness', key: 'provider.lastSource',        stamp: 'NONE' },
  'pv-server':      { source: 'useRouteStore.serverUsed', key: 'serverUsed',               stamp: 'NONE' },
  'pv-graph':       { source: 'offlineRoutingStatus',   key: 'offlineGraph.state',         stamp: 'OWN'  },
  'pv-straight':    { source: 'routeProviderReadiness', key: 'provider.straightLineCount', stamp: 'NONE' },
  'pv-remote-fail': { source: 'routeProviderReadiness', key: 'provider.remoteFailureCount', stamp: 'NONE' },
  'pv-error':       { source: 'useRouteStore.error',    key: 'routeError',                 stamp: 'NONE' },
  /* 3 · Map matching — TAMAMI GPS türevli */
  'mm-state':    { source: 'mapMatchModel', key: 'mapMatchState',      stamp: 'GPS' },
  'mm-conf':     { source: 'mapMatchModel', key: 'mapMatchConfidence', stamp: 'GPS' },
  'mm-raw':      { source: 'mapMatchModel', key: 'hasRawFix',          stamp: 'GPS' },
  'mm-snapped':  { source: 'mapMatchModel', key: 'hasSnappedPosition', stamp: 'GPS' },
  'mm-lateral':  { source: 'mapMatchModel', key: 'lateralM',           stamp: 'GPS' },
  'mm-corridor': { source: 'routingService', key: 'corridorM',         stamp: 'GPS' },
  'mm-heading':  { source: 'mapMatchModel', key: 'headingDeltaDeg',    stamp: 'GPS' },
  'mm-seg':      { source: 'mapMatchModel', key: 'mapMatchSegIdx',     stamp: 'GPS' },
  'mm-reasons':  { source: 'mapMatchModel', key: 'matchReasons',       stamp: 'GPS' },
  /* 4 · Sapma — TAMAMI GPS türevli */
  'or-state':     { source: 'offRouteModel', key: 'offRouteState',          stamp: 'GPS' },
  'or-evidence':  { source: 'offRouteModel', key: 'offRouteEvidence',       stamp: 'GPS' },
  'or-window':    { source: 'offRouteModel', key: 'offRouteRequiredMs',     stamp: 'GPS' },
  'or-confirmed': { source: 'offRouteModel', key: 'offRouteConfirmedAgeMs', stamp: 'GPS' },
  'or-reasons':   { source: 'offRouteModel', key: 'offRouteReasons',        stamp: 'GPS' },
  /* 5 · Reroute — sayaç ve geçmiş ölçüm; anlık tazelik iddiası YOK */
  'rq-current':    { source: 'routeRequestLedger', key: 'requests.currentId',                stamp: 'NONE' },
  'rq-inflight':   { source: 'routingService',     key: 'fetchInFlight',                     stamp: 'NONE' },
  'rq-committed':  { source: 'routeRequestLedger', key: 'requests.committedCount',           stamp: 'NONE' },
  'rq-superseded': { source: 'routeRequestLedger', key: 'requests.supersededCount',          stamp: 'NONE' },
  'rq-stale':      { source: 'routeRequestLedger', key: 'requests.staleRejectedCount',       stamp: 'NONE' },
  'rq-invalid':    { source: 'routeRequestLedger', key: 'requests.invalidRejectedCount',     stamp: 'NONE' },
  'rq-suppressed': { source: 'routeRequestLedger', key: 'requests.suppressedDuplicateCount', stamp: 'NONE' },
  'rq-failed':     { source: 'routeRequestLedger', key: 'requests.failedCount',              stamp: 'NONE' },
  'rq-lat-net':    { source: 'routeRequestLedger', key: 'requests.latency.requestToResponseMs',        stamp: 'NONE' },
  'rq-lat-commit': { source: 'routeRequestLedger', key: 'requests.latency.detectToCommitMs',           stamp: 'NONE' },
  'rq-lat-instr':  { source: 'routeRequestLedger', key: 'requests.latency.detectToFirstInstructionMs', stamp: 'NONE' },
  /* 6 · Doğrulama */
  'rv-verdict': { source: 'routeValidationModel', key: 'validationVerdict', stamp: 'NONE' },
  /* 6b · F7 — "neden bu rota?" */
  'rr-why':     { source: SRC_ROUTE_RATIONALE, key: 'routeRationale.last.decidingFactor', stamp: 'NONE' },
  'rr-cands':   { source: SRC_ROUTE_RATIONALE, key: 'routeRationale.last.candidates',     stamp: 'NONE' },
  'rr-penalty': { source: SRC_ROUTE_RATIONALE, key: 'routeRationale.last.durationPenaltyS', stamp: 'NONE' },
  'rr-ledger':  { source: SRC_ROUTE_RATIONALE, key: 'routeRationale.decisions',           stamp: 'NONE' },
  /* 7 · Manevra — yola boyanmış ok dahil */
  'pa-state':   { source: 'paintedArrowAccess', key: 'paintedArrow.visible',       stamp: 'NONE' },
  'pa-reason':  { source: 'paintedArrowAccess', key: 'paintedArrow.reason',        stamp: 'NONE' },
  'pa-shown':   { source: 'paintedArrowAccess', key: 'paintedArrow.shownCount',    stamp: 'NONE' },
  'pa-applied': { source: 'paintedArrowAccess', key: 'paintedArrow.appliedCount',  stamp: 'NONE' },
  'pa-layer':   { source: 'paintedArrowAccess', key: 'paintedArrow.layerPresent',  stamp: 'NONE' },
  'pa-policy':  { source: 'paintedArrowModel',  key: 'paintedArrow.policyVersion', stamp: 'NONE' },
  'mv-source': { source: 'routingService',      key: 'nextManeuverDistanceSource', stamp: 'GPS'  },
  'mv-dist':   { source: 'routingService',      key: 'nextManeuverDistanceM',      stamp: 'GPS'  },
  'mv-step':   { source: 'useRouteStore',       key: 'currentStepIndex',           stamp: 'GPS'  },
  'mv-anchor': { source: 'maneuverIndexModel',  key: 'anchorResolvedCount',        stamp: 'NONE' },
  'mv-method': { source: 'maneuverIndexModel',  key: 'anchorMethodCounts',         stamp: 'NONE' },
  'mv-geom':   { source: 'useRouteStore',       key: 'geometryPoints',             stamp: 'NONE' },
  /* 8 · Dürüstlük */
  'tr-lanes':      { source: 'useRouteStore.steps',      key: 'stepsWithRealLanes',   stamp: 'NONE' },
  'tr-roundabout': { source: 'useRouteStore.steps',      key: 'roundaboutStepCount',  stamp: 'NONE' },
  'tr-straight':   { source: 'useRouteStore.serverUsed', key: 'straightLineActive',   stamp: 'NONE' },
  /* 9 · Oturum sürekliliği — GÖRÜNÜMDEN BAĞIMSIZ motor.
     Hepsi `stamp: NONE`: bunlar sayaç/durum okumasıdır, GPS gözleminden
     TÜREMEZ. Motorun kendi tazeliği `ss-tick` alanının DEĞERİNDE (yaş) yazar —
     alanın damgasında değil; damga uydurmak sahte tazelik olurdu. */
  'ss-runtime': { source: 'navigationSessionRuntime', key: 'runtime',       stamp: 'NONE' },
  'ss-session': { source: 'navigationService',        key: 'sessionId',     stamp: 'NONE' },
  'ss-claim':   { source: 'navigationService',        key: 'hasRouteClaim', stamp: 'NONE' },
  'ss-tick':    { source: 'navigationSessionRuntime', key: 'runtime',       stamp: 'NONE' },
  'ss-skip':    { source: 'navigationSessionRuntime', key: 'runtime',       stamp: 'NONE' },
  'ss-err':     { source: 'navigationSessionRuntime', key: 'runtime',       stamp: 'NONE' },
  'ss-uptime':  { source: 'navigationSessionRuntime', key: 'runtime',       stamp: 'NONE' },
  /* 10 · Harita gorunumu · kamera · hiz limiti — hepsi anlik senkron okuma,
     GPS gozleminden turemez → bagimsiz damga YOK (stamp: NONE). */
  'vp-style':    { source: 'mapSourceManager',      key: 'miniMapStyle',       stamp: 'NONE' },
  'vp-theme':    { source: 'mapSourceManager',      key: 'mapTheme',           stamp: 'NONE' },
  'vp-contrast': { source: 'mapStyleBuilders',      key: 'mapContrastProfile', stamp: 'NONE' },
  /* TÜNEL GECE ÖRTÜSÜ — kanıt (far) · uygulanan örtü · örtüsüz istek · geçiş sayısı. */
  'vp-tunnel':     { source: 'autoBrightnessService', key: 'tunnelMode',        stamp: 'NONE' },
  'vp-tunnel-ovr': { source: 'mapSourceManager',      key: 'tunnelOverride',    stamp: 'NONE' },
  'vp-req-night':  { source: 'mapSourceManager',      key: 'requestedNight',    stamp: 'NONE' },
  'vp-tunnel-tr':  { source: 'tunnelNightRuntime',    key: 'tunnelTransitions', stamp: 'NONE' },
  'vp-cam':      { source: 'cameraFollowAuthority', key: 'camera',             stamp: 'NONE' },
  'vp-centered': { source: 'cameraFollowAuthority', key: 'camera',             stamp: 'NONE' },
  'vp-pan':      { source: 'cameraFollowAuthority', key: 'camera',             stamp: 'NONE' },
  'vp-recenter': { source: 'cameraFollowAuthority', key: 'camera',             stamp: 'NONE' },
  'vp-lastrc':   { source: 'cameraFollowAuthority', key: 'camera',             stamp: 'NONE' },
  'vp-autorc':   { source: 'cameraFollowAuthority', key: 'camera',             stamp: 'NONE' },
  'vp-zoom':     { source: 'cameraFollowAuthority', key: 'camera',             stamp: 'NONE' },
  'vp-sl-state': { source: 'speedLimitTruthModel',  key: 'speedLimit',         stamp: 'NONE' },
  'vp-sl-val':   { source: 'speedLimitService',     key: 'speedLimit',         stamp: 'NONE' },
  'vp-sl-src':   { source: 'speedLimitService',     key: 'speedLimit',         stamp: 'NONE' },
  'vp-sl-age':   { source: 'speedLimitTruthModel',  key: 'speedLimit',         stamp: 'NONE' },
  'vp-sl-conf':  { source: 'speedLimitTruthModel',  key: 'speedLimit',         stamp: 'NONE' },
  /* 11 · Araç sınıfı · uygulanabilir hız sınırı (VEHICLE_AWARE_SPEED_LIMIT_P0).
     Çoğu alan anlık senkron okumadır → damga YOK. İki alanın GERÇEK duvar-saati
     damgası vardır (`vc-verified`, `vc-res-at`) → `OWN`. Hiçbiri GPS türevli
     DEĞİLDİR: araç sınıfı konumla değişmez. */
  'vc-key':        { source: 'vehicleClassRuntime',   key: 'vehicleKeyMasked',       stamp: 'NONE' },
  'vc-mmy':        { source: 'vehicleClassRuntime',   key: 'vehicleClass',           stamp: 'NONE' },
  'vc-vinstate':   { source: 'vehicleClassRuntime',   key: 'vehicleClass',           stamp: 'NONE' },
  'vc-vin':        { source: 'vehicleClassRuntime',   key: 'vehicleClass',           stamp: 'NONE' },
  'vc-state':      { source: 'vehicleClassRuntime',   key: 'vehicleClass',           stamp: 'NONE' },
  'vc-cat':        { source: 'vehicleClassRuntime',   key: 'vehicleClass',           stamp: 'NONE' },
  'vc-body':       { source: 'vehicleClassRuntime',   key: 'vehicleClass',           stamp: 'NONE' },
  'vc-src':        { source: 'vehicleClassRuntime',   key: 'vehicleClass',           stamp: 'NONE' },
  'vc-conf':       { source: 'vehicleClassRuntime',   key: 'vehicleClass',           stamp: 'NONE' },
  'vc-verified':   { source: 'vehicleClassRuntime',   key: 'vehicleClass',           stamp: 'OWN'  },
  'vc-refs':       { source: 'vehicleClassRuntime',   key: 'vehicleClass',           stamp: 'NONE' },
  'vc-reason':     { source: 'vehicleClassRuntime',   key: 'vehicleClass',           stamp: 'NONE' },
  'vc-res-at':     { source: 'vehicleClassResearch',  key: 'vehicleClass',           stamp: 'OWN'  },
  'vc-res-out':    { source: 'vehicleClassResearch',  key: 'vehicleClass',           stamp: 'NONE' },
  'vc-res-fail':   { source: 'vehicleClassResearch',  key: 'vehicleClass',           stamp: 'NONE' },
  'vc-cache':      { source: 'vehicleClassRuntime',   key: 'offlineCacheState',      stamp: 'NONE' },
  'vc-pol':        { source: 'turkeySpeedPolicy',     key: 'policyVersion',          stamp: 'NONE' },
  'vc-pol-from':   { source: 'turkeySpeedPolicy',     key: 'policyEffectiveFrom',    stamp: 'NONE' },
  'vc-pol-src':    { source: 'turkeySpeedPolicy',     key: 'policySourceAuthority',  stamp: 'NONE' },
  'vc-roadclass':  { source: 'roadClassResolver',     key: 'roadClassVerdict',       stamp: 'NONE' },
  'vc-road-kmh':   { source: 'speedLimitService',     key: 'effectiveLimit',         stamp: 'NONE' },
  'vc-cap':        { source: 'turkeySpeedPolicy',     key: 'effectiveLimit',         stamp: 'NONE' },
  'vc-eff':        { source: 'vehicleAwareSpeedLimitAuthority', key: 'effectiveLimit', stamp: 'NONE' },
  'vc-eff-state':  { source: 'vehicleAwareSpeedLimitAuthority', key: 'effectiveLimit', stamp: 'NONE' },
  'vc-eff-reason': { source: 'vehicleAwareSpeedLimitAuthority', key: 'effectiveLimit', stamp: 'NONE' },
  'vc-eff-label':  { source: 'vehicleAwareSpeedLimitAuthority', key: 'effectiveLimit', stamp: 'NONE' },
  'vc-eff-age':    { source: 'vehicleAwareSpeedLimitAuthority', key: 'effectiveLimit', stamp: 'NONE' },
  'vc-conflict':   { source: 'vehicleAwareSpeedLimitAuthority', key: 'effectiveLimit', stamp: 'NONE' },
  /* 12 · Teslim çekirdeği (NAVIGATION_DELIVERY_CORE_P0) — hepsi anlık senkron
     okuma. GPS türevli DEĞİL: ses/DR/ETA durumu konumdan değil RUNTIME'dan
     okunur; GPS damgası takmak sahte tazelik olurdu. */
  'dl-voice-state':   { source: 'voiceGuidanceRuntime',       key: 'voice',                         stamp: 'NONE' },
  'dl-voice-owner':   { source: 'voiceGuidanceRuntime',       key: 'voice',                         stamp: 'NONE' },
  'dl-voice-last':    { source: 'voiceGuidanceRuntime',       key: 'voice',                         stamp: 'NONE' },
  'dl-voice-stage':   { source: 'voiceGuidanceRuntime',       key: 'voice',                         stamp: 'NONE' },
  'dl-voice-count':   { source: 'voiceGuidanceRuntime',       key: 'voice',                         stamp: 'NONE' },
  'dl-voice-dupe':    { source: 'voiceGuidanceRuntime',       key: 'voice',                         stamp: 'NONE' },
  'dl-voice-tracked': { source: 'voiceGuidanceRuntime',       key: 'voice',                         stamp: 'NONE' },
  'dl-dr-state':      { source: 'navigationSessionRuntime',   key: 'runtime',                       stamp: 'NONE' },
  'dl-dr-owner':      { source: 'navigationSessionRuntime',   key: 'runtime',                       stamp: 'NONE' },
  'dl-dr-timer':      { source: 'navigationSessionRuntime',   key: 'runtime',                       stamp: 'NONE' },
  'dl-dr-ticks':      { source: 'navigationSessionRuntime',   key: 'runtime',                       stamp: 'NONE' },
  'dl-dr-dist':       { source: 'navigationSessionRuntime',   key: 'runtime',                       stamp: 'NONE' },
  'dl-dr-conf':       { source: 'navigationSessionRuntime',   key: 'runtime',                       stamp: 'NONE' },
  'dl-dur-src':       { source: 'routeDurationModel',         key: 'routeDurationSource',           stamp: 'NONE' },
  'dl-dur-integrity': { source: 'routeDurationModel',         key: 'durationIntegrityState',        stamp: 'NONE' },
  'dl-dur-total':     { source: 'useRouteStore',              key: 'totalRouteDurationSeconds',     stamp: 'NONE' },
  'dl-dur-remain':    { source: 'routeDurationModel',         key: 'remainingRouteDurationSeconds', stamp: 'NONE' },
  'dl-rev':           { source: 'useRouteStore',              key: 'routeRevision',                 stamp: 'NONE' },
  'dl-eta-state':     { source: 'etaModel',                   key: 'eta',                           stamp: 'NONE' },
  'dl-eta-val':       { source: 'etaModel',                   key: 'eta',                           stamp: 'NONE' },
  'dl-eta-base':      { source: 'etaModel',                   key: 'eta',                           stamp: 'NONE' },
  'dl-eta-factor':    { source: 'etaModel',                   key: 'eta',                           stamp: 'NONE' },
  'dl-eta-reason':    { source: 'etaModel',                   key: 'eta',                           stamp: 'NONE' },
  /* 13 · İşaret hareketi · takip kamerası (NAVIGATION_MOTION_CAMERA_P0).
     Hepsi anlık senkron okumadır. GPS türevli DEĞİL: hareket/kamera durumu
     runtime'dan okunur, GPS damgası takmak sahte tazelik olurdu. */
  'mo-state':       { source: 'navMarkerMotionRuntime', key: 'markerMotion',        stamp: 'NONE' },
  'mo-raw':         { source: 'navMarkerMotionRuntime', key: 'markerMotion',        stamp: 'NONE' },
  'mo-rendered':    { source: 'navMarkerMotionRuntime', key: 'markerMotion',        stamp: 'NONE' },
  'mo-progress':    { source: 'navMarkerMotionRuntime', key: 'markerMotion',        stamp: 'NONE' },
  'mo-age':         { source: 'navMarkerMotionRuntime', key: 'markerMotion',        stamp: 'NONE' },
  'mo-conf':        { source: 'navMarkerMotionRuntime', key: 'markerMotion',        stamp: 'NONE' },
  'mo-samples':     { source: 'navMarkerMotionRuntime', key: 'markerMotion',        stamp: 'NONE' },
  'mo-dupruntime':  { source: 'navMarkerMotionRuntime', key: 'markerMotion',        stamp: 'NONE' },
  'mo-reason':      { source: 'navMarkerMotionRuntime', key: 'markerMotion',        stamp: 'NONE' },
  'cam-state':      { source: 'cameraPolicyModel',      key: 'cameraPolicy',        stamp: 'NONE' },
  'cam-profile':    { source: 'cameraPolicyModel',      key: 'cameraPolicy',        stamp: 'NONE' },
  'cam-speedband':  { source: 'cameraPolicyModel',      key: 'cameraPolicy',        stamp: 'NONE' },
  'cam-manband':    { source: 'cameraPolicyModel',      key: 'cameraPolicy',        stamp: 'NONE' },
  'cam-anchor':     { source: 'cameraPolicyModel',      key: 'cameraPolicy',        stamp: 'NONE' },
  'cam-zoom':       { source: 'MapLibre',               key: 'mapZoom',             stamp: 'NONE' },
  'cam-pitch':      { source: 'MapLibre',               key: 'mapPitch',            stamp: 'NONE' },
  'cam-bearing':    { source: 'MapLibre',               key: 'mapBearing',          stamp: 'NONE' },
  'cam-orient':     { source: 'navigationOrientation',  key: 'orientation',         stamp: 'NONE' },
  'cam-pan':        { source: 'cameraFollowAuthority',  key: 'camera',              stamp: 'NONE' },
  'cam-recenter2':  { source: 'cameraFollowAuthority',  key: 'camera',              stamp: 'NONE' },
  'cam-suppressed': { source: 'cameraShadowRuntime',    key: 'cameraShadow',        stamp: 'NONE' },
  'cam-reason':     { source: 'cameraPolicyModel',      key: 'cameraPolicy',        stamp: 'NONE' },
  /* Kadans satırları POLİTİKA modelinden DEĞİL, sönümleme motorundan gelir —
     kaynak etiketi gerçek kaynağı söylemelidir. */
  'cam-cadence':    { source: 'cameraEngine',           key: 'cameraDamping',       stamp: 'NONE' },
  /* Rota rengi HARİTA katmanı kararıdır — kaynak etiketi gerçek sahibi söyler. */
  /* DR projeksiyon ekseni (#451) — kaynak navigasyon oturum runtime'ıdır. */
  'dl-dr-axis':     { source: 'navigationSessionRuntime', key: 'runtime',           stamp: 'NONE' },
  'dl-dr-along':    { source: 'navigationSessionRuntime', key: 'runtime',           stamp: 'NONE' },
  'dl-dr-seg':      { source: 'navigationSessionRuntime', key: 'runtime',           stamp: 'NONE' },
  'rc-reason':      { source: 'routeColorModel',        key: 'routeColor',          stamp: 'NONE' },
  'rc-input':       { source: 'routeColorModel',        key: 'routeColor',          stamp: 'NONE' },
  'rc-applied':     { source: 'routeColorModel',        key: 'routeColor',          stamp: 'NONE' },
  'rc-key':         { source: 'routeColorModel',        key: 'routeColor',          stamp: 'NONE' },
  'cam-tau':        { source: 'cameraEngine',           key: 'cameraDamping',       stamp: 'NONE' },
  'cam-offcadence': { source: 'cameraEngine',           key: 'cameraDamping',       stamp: 'NONE' },
  'sh-enabled':      { source: 'cameraShadowRuntime', key: 'cameraShadow', stamp: 'NONE' },
  'sh-diverge':      { source: 'cameraShadowRuntime', key: 'cameraShadow', stamp: 'NONE' },
  'sh-decision':     { source: 'cameraShadowRuntime', key: 'cameraShadow', stamp: 'NONE' },
  'sh-anchor-d':     { source: 'cameraShadowRuntime', key: 'cameraShadow', stamp: 'NONE' },
  'sh-zoom-d':       { source: 'cameraShadowRuntime', key: 'cameraShadow', stamp: 'NONE' },
  'sh-pitch-d':      { source: 'cameraShadowRuntime', key: 'cameraShadow', stamp: 'NONE' },
  'sh-max':          { source: 'cameraShadowRuntime', key: 'cameraShadow', stamp: 'NONE' },
  'sh-eval':         { source: 'cameraShadowRuntime', key: 'cameraShadow', stamp: 'NONE' },
  'sh-accept':       { source: 'cameraShadowRuntime', key: 'cameraShadow', stamp: 'NONE' },
  'sh-legacy-apply': { source: 'cameraShadowRuntime', key: 'cameraShadow', stamp: 'NONE' },
  'sh-dupe':         { source: 'cameraShadowRuntime', key: 'cameraShadow', stamp: 'NONE' },
  'sh-supreason':    { source: 'cameraShadowRuntime', key: 'cameraShadow', stamp: 'NONE' },
  'sh-ctx':          { source: 'cameraShadowRuntime', key: 'cameraShadow', stamp: 'NONE' },
  /* 14 · Hedef Bütünlüğü (P0-NAV-09) — hepsi anlık okuma, damga YOK.
     Hiçbiri GPS türevli değildir: hedef kararı fix'ten değil, kullanıcı
     seçiminden doğar; GPS damgası taşısalardı yaşlanmış görünürlerdi. */
  'de-ok':         { source: SRC_DEST_AUDIT, key: 'destinationOk',               stamp: 'NONE' },
  'de-reason':     { source: SRC_DEST_AUDIT, key: 'destinationRejection',        stamp: 'NONE' },
  'de-rejected':   { source: SRC_DEST_AUDIT, key: 'destinationRejectedTotal',    stamp: 'NONE' },
  'de-swap':       { source: SRC_DEST_AUDIT, key: 'destinationSwapSuspected',    stamp: 'NONE' },
  'de-swapcount':  { source: SRC_DEST_AUDIT, key: 'destinationSwapSuspectTotal', stamp: 'NONE' },
  'de-precision':  { source: SRC_DEST_AUDIT, key: 'destinationPrecision',        stamp: 'NONE' },
  'de-provider':   { source: SRC_DEST_AUDIT, key: 'destinationProvider',         stamp: 'NONE' },
  'de-age':        { source: SRC_DEST_AUDIT, key: 'destinationAgeMs',            stamp: 'NONE' },
  'de-id':         { source: SRC_DEST_AUDIT, key: 'destinationIdMasked',         stamp: 'NONE' },
  /* 2 · Rota Sağlayıcı — P0-NAV-10 fallback gerçeği. Anlık okuma, damga YOK. */
  'pv-chain':           { source: SRC_ROUTE_LEDGER_AUDIT, key: 'routeChain',                  stamp: 'NONE' },
  'pv-fallback-reason': { source: SRC_ROUTE_LEDGER_AUDIT, key: 'routeChain.fallbackReason',   stamp: 'NONE' },
  'pv-fallback-count':  { source: SRC_ROUTE_LEDGER_AUDIT, key: 'routeFallbackSuccessCount',   stamp: 'NONE' },
  'pv-outcomes':        { source: SRC_ROUTE_LEDGER_AUDIT, key: 'routeAttemptCounts',          stamp: 'NONE' },
  /* 6 · Rota Doğrulama Kapısı — P0-NAV-11 geometri künyesi. Anlık okuma. */
  'gm-integrity':       { source: SRC_GEOMETRY_AUDIT, key: 'committedGeometry',        stamp: 'NONE' },
  'gm-points':          { source: SRC_GEOMETRY_AUDIT, key: 'committedGeometry.metrics', stamp: 'NONE' },
  'gm-ends':            { source: SRC_GEOMETRY_AUDIT, key: 'committedGeometry',        stamp: 'NONE' },
  'gm-extent':          { source: SRC_GEOMETRY_AUDIT, key: 'committedGeometry.metrics', stamp: 'NONE' },
  'gm-rejected':        { source: SRC_GEOMETRY_AUDIT, key: 'rejectedGeometryTotal',    stamp: 'NONE' },
  'gm-rejected-checks': { source: SRC_GEOMETRY_AUDIT, key: 'lastRejectedCheckIds',     stamp: 'NONE' },
  /* 15 · İlerleme Dürüstlüğü (P0-NAV-12). `pr-verdict` GPS türevlidir:
     ilerleme hükmü doğrudan fix'ten doğar ve fix donunca YAŞLANMALIDIR. */
  'pr-verdict':    { source: SRC_PROGRESS_AUDIT, key: 'progress.lastVerdict',     stamp: 'GPS'  },
  'pr-counts':     { source: SRC_PROGRESS_AUDIT, key: 'progress.counts',          stamp: 'NONE' },
  'pr-backtrack':  { source: SRC_PROGRESS_AUDIT, key: 'progress.counts',          stamp: 'NONE' },
  'pr-forward':    { source: SRC_PROGRESS_AUDIT, key: 'progress.counts',          stamp: 'NONE' },
  'pr-extremes':   { source: SRC_PROGRESS_AUDIT, key: 'progress.maxForwardJumpM', stamp: 'NONE' },
  'pr-anomaly':    { source: SRC_PROGRESS_AUDIT, key: 'progress.anomalies',       stamp: 'NONE' },
  /* 5 · Reroute — P0-NAV-13 engel sebepleri + açlık. Anlık okuma, damga YOK. */
  'rq-blocked':     { source: SRC_REROUTE_AUDIT, key: 'rerouteBlockedCount',    stamp: 'NONE' },
  'rq-blocked-why': { source: SRC_REROUTE_AUDIT, key: 'rerouteBlockByReason',   stamp: 'NONE' },
  'rq-health':      { source: SRC_REROUTE_AUDIT, key: 'rerouteHealth',          stamp: 'NONE' },
  'rq-starve':      { source: SRC_REROUTE_AUDIT, key: 'rerouteHealth.offRouteForMs', stamp: 'NONE' },
  /* 12 · Teslim Çekirdeği — P0-NAV-16 anons denetimi. Anlık okuma, damga YOK. */
  'vg-audit':     { source: SRC_GUIDANCE_AUDIT_AUDIT, key: 'guidanceAudit.timing', stamp: 'NONE' },
  'vg-missed':    { source: SRC_GUIDANCE_AUDIT_AUDIT, key: 'guidanceAudit.missed', stamp: 'NONE' },
  'vg-last-flaw': { source: SRC_GUIDANCE_AUDIT_AUDIT, key: 'guidanceAudit.recent', stamp: 'NONE' },
  /* 15 · Sıcak yol maliyeti (P0-NAV-19). Anlık okuma, damga YOK. */
  'tc-match':   { source: SRC_TICK_COST_AUDIT, key: 'tickCost.mapMatch',     stamp: 'NONE' },
  'tc-tick':    { source: SRC_TICK_COST_AUDIT, key: 'tickCost.progressTick', stamp: 'NONE' },
  'tc-samples': { source: SRC_TICK_COST_AUDIT, key: 'tickCost.mapMatch',     stamp: 'NONE' },
  /* 1 · Durum — P0-NAV-20 arıza tablosu. Anlık okuma, damga YOK. */
  'fm-overall': { source: SRC_MATRIX_AUDIT, key: 'failureMatrix.overall', stamp: 'NONE' },
  'fm-axes':    { source: SRC_MATRIX_AUDIT, key: 'failureMatrix.axes',    stamp: 'NONE' },
  /* 16 · NAV v3 — L2 ego / L3 ufuk (F3). Hepsi ANLIK senkron okumadir:
     otoritelerin kendi damgasi yoktur, bu yuzden stamp `NONE`. */
  'hz-bridge':    { source: SRC_BRIDGE_AUDIT, key: 'egoHorizonBridge.ticks',       stamp: 'NONE' },
  'hz-ego-mode':  { source: SRC_EGO_AUDIT,    key: 'ego.mode',                     stamp: 'NONE' },
  'hz-ego-sigma': { source: SRC_EGO_AUDIT,    key: 'ego.sigmaHorizontalM',         stamp: 'NONE' },
  'hz-ego-rej':   { source: SRC_EGO_AUDIT,    key: 'ego.positionUpdatesRejected',  stamp: 'NONE' },
  'hz-ego-match': { source: SRC_EGO_AUDIT,    key: 'ego.candidateOutcome',         stamp: 'NONE' },
  'hz-yaw-feed':  { source: SRC_YAW_AUDIT,    key: 'yawFeed.attached',             stamp: 'NONE' },
  'hz-yaw-gate':  { source: SRC_YAW_AUDIT,    key: 'yawFeed.accepted',             stamp: 'NONE' },
  'hz-yaw-pol':   { source: SRC_YAW_AUDIT,    key: 'yawFeed.polarity',             stamp: 'NONE' },
  'hz-yaw-rate':  { source: SRC_YAW_AUDIT,    key: 'yawFeed.yawRateRadPerSec',     stamp: 'NONE' },
  'hz-ceh-state': { source: SRC_CEH_AUDIT,    key: 'ceh.state',                    stamp: 'NONE' },
  'hz-ceh-mpp':   { source: SRC_CEH_AUDIT,    key: 'ceh.mppPresent',               stamp: 'NONE' },
  'hz-ceh-phys':  { source: SRC_CEH_AUDIT,    key: 'ceh.physicallyConfirmed',      stamp: 'NONE' },
  'hz-ceh-obj':   { source: SRC_CEH_AUDIT,    key: 'ceh.objectCount',              stamp: 'NONE' },
  'hz-ceh-map':   { source: SRC_CEH_AUDIT,    key: 'ceh.mapAvailable',             stamp: 'NONE' },
  /* F4 — graf sakinliği. Anlık senkron okuma, bağımsız damga YOK. */
  'hz-graph-state':   { source: SRC_GRAPH_AUDIT, key: 'graphResidency.state',      stamp: 'NONE' },
  'hz-graph-size':    { source: SRC_GRAPH_AUDIT, key: 'graphResidency.nodeCount',  stamp: 'NONE' },
  'hz-graph-parse':   { source: SRC_GRAPH_AUDIT, key: 'graphResidency.parseMs',    stamp: 'NONE' },
  'hz-graph-derived': { source: SRC_GRAPH_AUDIT, key: 'graphResidency.adjacencyBuilt', stamp: 'NONE' },
  'hz-graph-restrictions': { source: SRC_GRAPH_AUDIT, key: 'graphResidency.restrictionCount', stamp: 'NONE' },
  /* RTG4 — sınırlı sakinlikle talep üzerine pencere. Sayaç alanı: damga YOK. */
  'hz-graph-window':   { source: SRC_GRAPH_AUDIT, key: 'graphResidency.residentGraphBytes',  stamp: 'NONE' },
  'hz-graph-ondemand': { source: SRC_GRAPH_AUDIT, key: 'graphResidency.onDemandRegionLoads', stamp: 'NONE' },

  /* 16c · RTG4 — uzun rota arama profili (sayaç; koordinat/hedef TAŞIMAZ) */
  'hz-longroute-search': { source: SRC_LONGROUTE_AUDIT, key: 'crossRegionSearch.closedStates',   stamp: 'NONE' },
  'hz-longroute-alt':    { source: SRC_LONGROUTE_AUDIT, key: 'crossRegionSearch.altActive',      stamp: 'NONE' },
  'hz-longroute-class':  { source: SRC_LONGROUTE_AUDIT, key: 'crossRegionSearch.closedByClass',  stamp: 'NONE' },
  'hz-longroute-altmem': { source: SRC_GRAPH_AUDIT,     key: 'graphResidency.altResidentBytes',  stamp: 'NONE' },
  'hz-regional-distribution': { source: SRC_DISTRIBUTION_AUDIT, key: 'regionalDistribution.manifestStatus', stamp: 'NONE' },
  'hz-regional-storage': { source: SRC_DISTRIBUTION_AUDIT, key: 'regionalDistribution.installedGraphBytes', stamp: 'NONE' },

  /* 16b · NAV v3 · F5 — gölge karşılaştırma + cutover kapısı */
  'hz-shadow-mode':      { source: SRC_SHADOW_AUDIT, key: 'cehShadow.ticks',              stamp: 'NONE' },
  'hz-shadow-authority': { source: SRC_SHADOW_AUDIT, key: 'cehShadow.cutover.open',       stamp: 'NONE' },
  'hz-shadow-maneuver':  { source: SRC_SHADOW_AUDIT, key: 'cehShadow.domains.MANEUVER',   stamp: 'NONE' },
  'hz-shadow-enforce':   { source: SRC_SHADOW_AUDIT, key: 'cehShadow.domains.ENFORCEMENT', stamp: 'NONE' },
  'hz-shadow-attr':      { source: SRC_SHADOW_AUDIT, key: 'cehShadow.attributePortsBound', stamp: 'NONE' },
  'hz-shadow-ratio':     { source: SRC_SHADOW_AUDIT, key: 'cehShadow.divergenceRatio',    stamp: 'NONE' },
  'hz-shadow-guardian':  { source: SRC_SHADOW_AUDIT, key: 'cehShadow.guardianShadow',     stamp: 'NONE' },
  'hz-shadow-suppress':  { source: SRC_SHADOW_AUDIT, key: 'cehShadow.suppression',        stamp: 'NONE' },
  'hz-shadow-gate':      { source: SRC_SHADOW_AUDIT, key: 'cehShadow.cutover.state',      stamp: 'NONE' },

  /* 16c · NAV v3 · F6 — sınırlı koridor + kenar-tabanlı denetim noktası */
  'hz-corridor':      { source: SRC_ENFORCEMENT_AUDIT, key: 'enforcementHorizonPort.lastCorridorOutcome', stamp: 'NONE' },
  'hz-enforce-match': { source: SRC_ENFORCEMENT_AUDIT, key: 'enforcementHorizonPort.cumulativeMatch',     stamp: 'NONE' },
  'hz-enforce-cost':  { source: SRC_ENFORCEMENT_AUDIT, key: 'enforcementHorizonPort.lastDurationMs',      stamp: 'NONE' },
};

function allFields(s: NavigationCoreRawSnapshot) {
  return buildNavigationCoreCards(s).flatMap(c => c.fields);
}

describe('LAB Navigation Core — alan kaynağı denetimi', () => {
  it('HER alan kayıtlıdır (kayıt dışı alan = denetlenmemiş alan)', () => {
    const ids = allFields(full()).map(f => f.id).filter(id => !id.startsWith('rv-') || id === 'rv-verdict');
    const unregistered = ids.filter(id => !REGISTRY[id]);
    expect(unregistered, `kayıt dışı alan(lar): ${unregistered.join(', ')}`).toEqual([]);
  });

  it('kayıttaki HER alan ekranda gerçekten üretilir (ölü kayıt yok)', () => {
    const ids = new Set(allFields(full()).map(f => f.id));
    const missing = Object.keys(REGISTRY).filter(id => !ids.has(id));
    expect(missing, `kayıtlı ama üretilmeyen alan(lar): ${missing.join(', ')}`).toEqual([]);
  });

  it('HER alanın kaynak etiketi kayıtla eşleşir (yanlış kaynak iddiası yok)', () => {
    for (const f of allFields(full())) {
      const reg = REGISTRY[f.id];
      if (!reg) continue;
      expect(f.source, `${f.id} kaynak etiketi kayıttan farklı`).toBe(reg.source);
    }
  });

  it('SOURCE_MISSING YOK — dolu anlık görüntüde hiçbir alan UNAVAILABLE değil', () => {
    /* Tüm kaynaklar dolu olduğunda hâlâ UNAVAILABLE kalan bir alan, kaynağı
       OLMAYAN (uydurma) bir alandır. Tek meşru istisna: kanıtı bilinçli
       olarak bulunmayan yol sınıfı denetimi — o zaten `validationChecks`
       içinden gelir ve bu fixture'da yer almaz. */
    /* ── YAPISAL İSTİSNA (NAVIGATION_CAMERA_SHADOW) ─────────────────────────
     * `sh-zoom-d` / `sh-pitch-d` DOLU anlık görüntüde bile UNAVAILABLE'dır ve
     * bu DOĞRUDUR: gölge politikası bu turda zoom/pitch ÖNERMİYOR (sahada
     * ayarlı `cameraEngine` eğrileri devralınmadı). Sahte bir 0 delta yazmak
     * "fark yok" yanılgısı üretirdi — o yüzden alanlar dürüstçe boş kalır ve
     * gerekçesi ekranda yazar. Eğri devralındığında bu istisna KALKMALIDIR. */
    const STRUCTURAL_UNAVAILABLE = new Set(['sh-zoom-d', 'sh-pitch-d']);
    const bad = allFields(full())
      .filter(f => f.klass === 'UNAVAILABLE' && !STRUCTURAL_UNAVAILABLE.has(f.id));
    expect(bad.map(f => f.id), 'kaynağı olmayan alan(lar)').toEqual([]);

    // İstisnanın kendisi de kilitli: gerekçe ekranda AÇIKÇA yazmalı.
    const zoomD = allFields(full()).find(f => f.id === 'sh-zoom-d');
    expect(zoomD?.note ?? '').toContain('eğri devralınmadı');
  });

  /* ── TAZELİK DAMGASI SÖZLEŞMESİ ─────────────────────────────────────────── */

  it('GPS türevli alanlar GERÇEK fix damgası taşır (donmuş veri taze görünmez)', () => {
    const fields = allFields(full());
    for (const [id, reg] of Object.entries(REGISTRY)) {
      if (reg.stamp !== 'GPS') continue;
      const f = fields.find(x => x.id === id);
      expect(f, `${id} bulunamadı`).toBeDefined();
      expect(f!.updatedAt, `${id} GPS damgası taşımıyor`).toBe(NOW - GPS_AGE);
    }
  });

  it('sayaç/yapılandırma alanları damga TAŞIMAZ (uydurma "0ms önce" yok)', () => {
    const fields = allFields(full());
    for (const [id, reg] of Object.entries(REGISTRY)) {
      if (reg.stamp !== 'NONE') continue;
      const f = fields.find(x => x.id === id);
      expect(f!.updatedAt, `${id} uydurma damga taşıyor`).toBeNull();
    }
  });

  it('kendi gerçek damgası olan alanlar onu KORUR', () => {
    const s = full();
    const fields = allFields(s);
    expect(fields.find(f => f.id === 'pv-local')!.updatedAt).toBe(s.provider.localProbedAtMs);
    expect(fields.find(f => f.id === 'pv-graph')!.updatedAt).toBe(s.offlineGraph.lastAttemptAt);
  });

  it('GPS yokken GPS türevli alanlar damgasız kalır (sahte tazelik üretilmez)', () => {
    const s = full({ gpsObservedAtWall: null, fixAgeMs: null, hasRawFix: false });
    for (const f of allFields(s)) {
      if (REGISTRY[f.id]?.stamp === 'GPS') {
        expect(f.updatedAt, `${f.id} GPS yokken damga uyduruyor`).toBeNull();
      }
    }
  });

  it('DONMUŞ GPS: fix eskidikçe alanların yaşı BÜYÜR (ekranda görünür)', () => {
    const fresh = full({ gpsObservedAtWall: NOW - 300 });
    const stale = full({ gpsObservedAtWall: NOW - 45_000 });
    const g = (s: NavigationCoreRawSnapshot, id: string) =>
      allFields(s).find(f => f.id === id)!.updatedAt!;
    // Aynı alan, iki farklı fix yaşı → damga farklı olmalı
    expect(NOW - g(fresh, 'mm-state')).toBe(300);
    expect(NOW - g(stale, 'mm-state')).toBe(45_000);
  });

  /* ── GERÇEK OKUMA KATMANI ───────────────────────────────────────────────── */

  it('gerçek okuma katmanı çökmeden çalışır ve sözleşmeyi bozmaz', () => {
    const s = readNavigationCoreSnapshot();
    expect(typeof s.readAt).toBe('number');
    // Türetilmiş damga tutarlı: ya ikisi de null ya ikisi de sayı
    expect(s.gpsObservedAtWall === null).toBe(s.fixAgeMs === null);
    expect(s.offRouteConfirmedAgeMs === null).toBe(s.offRouteConfirmedAtMs === null);
    // Ekran çökmeden kurulur
    expect(() => buildNavigationCoreCards(s)).not.toThrow();
    expect(() => deriveNavCoreVerdict(s)).not.toThrow();
  });

  it('gerçek okumada KOORDİNAT alanı YOK (gizlilik sözleşmesi)', () => {
    const s = readNavigationCoreSnapshot() as unknown as Record<string, unknown>;
    for (const k of Object.keys(s)) {
      expect(k).not.toMatch(/^(lat|lon|latitude|longitude|snappedLat|snappedLon|rawLat|rawLon)$/);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ZAMAN DAMGASI DİSİPLİNİ — reroute · arrival · map matching · validation
   ══════════════════════════════════════════════════════════════════════════
   İki saat vardır ve KARIŞTIRILAMAZ:
     · performance.now() = MONOTONİK — süre ölçümü (gecikme, kanıt penceresi)
     · Date.now()        = DUVAR SAATİ — kalıcılık ve GPS sensör damgası
   Karışım sessiz ve yıkıcıdır: cihaz saati kayınca (NTP, kontak) monotonik
   olmayan bir fark negatif veya devasa çıkar ve saha ölçümünü çürütür.
   ═════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  beginRouteRequest, recordResponse, recordCommit, markOffRouteDetected,
  markFirstNewInstruction, getRouteRequestSnapshot, resetRouteRequestLedger,
} from '../platform/navigation/core/routeRequestLedger';

const readSrc = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('Zaman damgası disiplini', () => {
  it('YAPISAL: routingService ledger\'a YALNIZ monotonik saat verir', () => {
    const src = readSrc('src/platform/routingService.ts');
    for (const call of ['beginRouteRequest', 'recordResponse', 'recordCommit']) {
      const re = new RegExp(`${call}\\([^)]*Date\\.now\\(\\)`);
      expect(src, `${call} duvar saati alıyor — süre ölçümü bozulur`).not.toMatch(re);
    }
    // Gecikme zincirinin T0'ı da monotonik olmalı (sapma makinesinin damgası).
    expect(src).toMatch(/markOffRouteDetected\(_offRoute\.confirmedAtMs \?\? now\)/);
    expect(src).toMatch(/const now = performance\.now\(\)/);
  });

  it('YAPISAL: sapma makinesinin damgası GPS tick\'inin monotonik saatidir', () => {
    const src = readSrc('src/platform/routingService.ts');
    // stepOffRoute'a verilen tsMs, fonksiyon başındaki `now` (performance.now) olmalı
    expect(src).toMatch(/tsMs:\s*now,/);
  });

  /* KİLİT TAŞINDI (NAVIGATION_DELIVERY_CORE_P0): ilk-talimat damgası artık
     sesli yönlendirmeyle birlikte `navigationSessionRuntime`ten atılır
     (anons görünümden bağımsız üretiliyor). Monotoniklik şartı DEĞİŞMEDİ. */
  it('YAPISAL: ilk-talimat damgası da monotonik (runtime tarafı)', () => {
    const rt = readSrc('src/platform/navigation/navigationSessionRuntime.ts');
    expect(rt).toMatch(/markFirstNewInstruction\(_now\(\)\)/);
    expect(rt).not.toMatch(/markFirstNewInstruction\(Date\.now\(\)\)/);
    // `_now()` monotoniktir (performance.now) — duvar saati DEĞİL.
    expect(rt).toMatch(/function _now\(\): number \{[\s\S]{0,120}performance\.now\(\)/);
    // Görünüm artık bu damgayı ATMAZ.
    const hud = readSrc('src/components/map/NavigationHUD.tsx');
    expect(hud).not.toContain('markFirstNewInstruction');
  });

  it('YAPISAL: kalıcılık ve GPS sensör damgası DUVAR saati kullanır (doğru eşleşme)', () => {
    const nav = readSrc('src/platform/navigationService.ts');
    // Kalıcılık: process restart'ı aşmalı → monotonik OLAMAZ
    expect(nav).toMatch(/ts: Date\.now\(\)/);
    // GPS tazeliği: location.timestamp epoch'tur → Date.now ile karşılaştırılır
    expect(nav).toMatch(/Date\.now\(\) - location\.timestamp/);
    // Süre ölçümleri monotonik kalmalı
    expect(nav).toMatch(/_arrivalLowSpeedStartMs = performance\.now\(\)/);
  });

  it('YAPISAL: sağlayıcı/graf damgaları duvar saati (LAB readAt ile aynı taban)', () => {
    const off = readSrc('src/platform/offlineRoutingService.ts');
    expect(off).toMatch(/recordLocalDaemonProbe\((?:true|false|available), Date\.now\(\)\)/);
    const src = readSrc('src/platform/devtools/navigationCoreSources.ts');
    expect(src).toMatch(/const readAt = Date\.now\(\)/);
  });

  it('YAPISAL: LAB iki saati AÇIKÇA uzlaştırır (örtük karşılaştırma yok)', () => {
    const src = readSrc('src/platform/devtools/navigationCoreSources.ts');
    // monotonik fix yaşı → duvar saati damgasına çevrilir
    expect(src).toMatch(/gpsObservedAtWall: fixAgeMs != null \? readAt - fixAgeMs : null/);
    // monotonik yaş monotonik saatle ölçülür
    expect(src).toMatch(/nowPerf - fix\.tsMs/);
    expect(src).toMatch(/nowPerf - core\.offRoute\.confirmedAtMs/);
  });

  it('DAVRANIŞ: gecikme zinciri sıralı ve NEGATİF OLMAYAN süre üretir', () => {
    resetRouteRequestLedger();
    markOffRouteDetected(1_000);
    const id = beginRouteRequest('REROUTE', 1_250);
    recordResponse(id, 1_900, 'osrm');
    recordCommit(id, 2_050, 'osrm');
    markFirstNewInstruction(2_400);
    const L = getRouteRequestSnapshot().latency;

    // Sıralama: tespit ≤ istek ≤ yanıt ≤ commit ≤ ilk talimat
    expect(L.offRouteDetectedAtMs!).toBeLessThanOrEqual(L.requestStartedAtMs!);
    expect(L.requestStartedAtMs!).toBeLessThanOrEqual(L.responseReceivedAtMs!);
    expect(L.responseReceivedAtMs!).toBeLessThanOrEqual(L.routeCommittedAtMs!);
    expect(L.routeCommittedAtMs!).toBeLessThanOrEqual(L.firstNewInstructionAtMs!);
    // Türetilmiş süreler negatif olamaz
    for (const v of [L.requestToResponseMs, L.detectToCommitMs, L.detectToFirstInstructionMs]) {
      expect(v).not.toBeNull();
      expect(v!).toBeGreaterThanOrEqual(0);
    }
    resetRouteRequestLedger();
  });

  it('DAVRANIŞ: commit olmadan ilk-talimat damgası üretilmez (anlamsız süre yok)', () => {
    resetRouteRequestLedger();
    markOffRouteDetected(1_000);
    beginRouteRequest('REROUTE', 1_100);
    markFirstNewInstruction(1_500);
    expect(getRouteRequestSnapshot().latency.detectToFirstInstructionMs).toBeNull();
    resetRouteRequestLedger();
  });
});
