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

const NOW = 1_700_000_000_000;
const GPS_AGE = 400;

/** Tüm alanların dolu olduğu anlık görüntü — "kaynak var mı" denetimi için. */
function full(over: Partial<NavigationCoreRawSnapshot> = {}): NavigationCoreRawSnapshot {
  return {
    readAt: NOW,
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
    runtime: {
      running: true, tickCount: 42, lastTickAgeMs: 900, lastObservedStatus: 'ACTIVE',
      skippedNoFix: 1, skippedInactive: 5, errorCount: 0, lastErrorAgeMs: null,
      uptimeMs: 60_000,
      drState: 'GPS_FRESH', drOwner: 'NAV_SESSION_RUNTIME', drTickCount: 7,
      drDistanceMeters: 42, drConfidence: 1, drTimerRunning: true,
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
  /* 7 · Manevra */
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
