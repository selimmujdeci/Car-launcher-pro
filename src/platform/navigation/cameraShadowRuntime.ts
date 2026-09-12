/**
 * cameraShadowRuntime.ts — kamera politikasının GÖLGE gözlemcisi.
 *
 * ── SÖZLEŞME (pazarlıksız) ──────────────────────────────────────────────────
 *  · **ÜRÜN DAVRANIŞI DEĞİŞMEZ.** Bu modül hiçbir kamera değeri UYGULAMAZ.
 *  · **Map API ÇAĞRISI YOK.** `maplibre-gl` import edilmez; harita nesnesi
 *    buraya HİÇ geçmez. Legacy'nin zaten hesapladığı skalerler raporlanır.
 *  · **Koordinat KABUL EDİLMEZ.** Girdi tipi (`LegacyCameraOutcome`) lat/lon
 *    alanı taşımaz; rota geometrisi ve adres buraya ulaşamaz.
 *  · Fail-soft: buradaki her hata yutulur — gölge gözlem kamerayı ASLA bozmaz.
 *
 * ── VERİ KAYNAĞI (LAB'daki sayılar nereden geliyor) ─────────────────────────
 * `MapInteractionManager.setDrivingView` her çağrısında sonucu buraya bildirir:
 * uygulandıysa gerçek `zoom/pitch/bearing` ve **ölçülen** `anchorY`
 * (`map.project(...).y / H` — legacy zaten çerçeve denetimi için hesaplıyor),
 * erken döndüyse `applied: false`. Politika önerisi aynı anda
 * `cameraPolicyModel.decideCameraPolicy` ile üretilir. Yani LAB'daki her sayı
 * GERÇEK bir kamera çağrısından gelir; sabit/uydurma değer YOKTUR.
 */

import {
  decideCameraPolicy, shouldApplyCameraUpdate,
  CAMERA_POLICY_VERSION,
  type CameraPolicyDecision, type SpeedBand, type ViewportOrientation,
  type ViewportProfile,
} from './core/cameraPolicyModel';
import {
  compareCameraOutcome, isEquivalentUpdate,
  type CameraShadowComparison, type CameraShadowContext, type LegacyCameraOutcome,
} from './core/cameraShadowModel';
import { getCameraFollowState, CameraFollowState } from './cameraFollowAuthority';
import { getMarkerMotionSnapshot } from './navMarkerMotionRuntime';
import { getRouteState } from '../routingService';

/* ── Gölge modu anahtarı ────────────────────────────────────────────────────
 * Varsayılan AÇIK: gözlem maliyeti saf bir karşılaştırmadan ibarettir (Map
 * çağrısı yok, ağ yok, timer yok). Kapatma yolu yalnız ölçüm sırasında A/B
 * yapmak içindir. */
let _shadowEnabled = true;
export function setCameraShadowEnabled(on: boolean): void { _shadowEnabled = on; }
export function isCameraShadowEnabled(): boolean { return _shadowEnabled; }

/* ── Sayaçlar (hepsi GERÇEK çağrılardan) ─────────────────────────────────── */
let _policyEvaluationCount = 0;
let _policyAcceptedCount = 0;
let _policySuppressedCount = 0;
let _legacyCameraApplyCount = 0;
let _legacyCameraSkipCount = 0;
let _duplicateEquivalentUpdateCount = 0;

let _last: CameraShadowComparison | null = null;
let _lastSuppressionReason: string | null = null;
let _prevBand: SpeedBand | null = null;
let _prevDecision: CameraPolicyDecision | null = null;
let _lastAppliedMs = 0;
let _prevSpeedKmh = 0;

/** Gözlenen en büyük mutlak farklar — devralma kararının kanıtı. */
let _maxAnchorDelta = 0;
let _maxZoomDelta = 0;
let _maxPitchDelta = 0;

export interface CameraShadowSnapshot {
  readonly enabled: boolean;
  readonly policyVersion: string;
  readonly policyEvaluationCount: number;
  readonly policyAcceptedCount: number;
  readonly policySuppressedCount: number;
  readonly legacyCameraApplyCount: number;
  readonly legacyCameraSkipCount: number;
  readonly duplicateEquivalentUpdateCount: number;
  readonly lastSuppressionReason: string | null;
  readonly maxAnchorYDelta: number;
  readonly maxZoomDelta: number;
  readonly maxPitchDelta: number;
  readonly last: CameraShadowComparison | null;
}

export function getCameraShadowSnapshot(): CameraShadowSnapshot {
  return {
    enabled: _shadowEnabled,
    policyVersion: CAMERA_POLICY_VERSION,
    policyEvaluationCount: _policyEvaluationCount,
    policyAcceptedCount: _policyAcceptedCount,
    policySuppressedCount: _policySuppressedCount,
    legacyCameraApplyCount: _legacyCameraApplyCount,
    legacyCameraSkipCount: _legacyCameraSkipCount,
    duplicateEquivalentUpdateCount: _duplicateEquivalentUpdateCount,
    lastSuppressionReason: _lastSuppressionReason,
    maxAnchorYDelta: Number(_maxAnchorDelta.toFixed(3)),
    maxZoomDelta: Number(_maxZoomDelta.toFixed(2)),
    maxPitchDelta: Number(_maxPitchDelta.toFixed(1)),
    last: _last,
  };
}

/** Bağlam okuyucu — DI ile testte enjekte edilebilir. */
export interface ShadowContextReader {
  readonly followState: () => CameraFollowState;
  readonly motion: () => { state: string; sourceAgeMs: number; confidence: number };
  readonly route: () => { alongM: number | null; source: 'ALONG_ROUTE' | 'STRAIGHT_LINE' | 'UNKNOWN' };
  readonly nowMs: () => number;
}

const _DEFAULT_READER: ShadowContextReader = {
  followState: () => getCameraFollowState(),
  motion: () => {
    const m = getMarkerMotionSnapshot(performance.now());
    return { state: m.state, sourceAgeMs: m.sourceAgeMs, confidence: m.confidence };
  },
  route: () => {
    const rs = getRouteState();
    return {
      alongM: rs.steps.length ? rs.distanceToNextTurnMeters : null,
      source: rs.distanceToNextTurnSource,
    };
  },
  nowMs: () => performance.now(),
};

/** `CameraFollowState` → politika girdisi (birebir eşleme, yeni durum YOK). */
function _mapFollow(s: CameraFollowState):
  'FOLLOWING' | 'USER_PANNING' | 'FOLLOW_SUSPENDED' | 'RECENTERING' | 'UNKNOWN' {
  switch (s) {
    case CameraFollowState.FOLLOWING:        return 'FOLLOWING';
    case CameraFollowState.USER_PANNING:     return 'USER_PANNING';
    case CameraFollowState.FOLLOW_SUSPENDED: return 'FOLLOW_SUSPENDED';
    case CameraFollowState.RECENTERING:      return 'RECENTERING';
    default:                                  return 'UNKNOWN';
  }
}

function _mapMotion(s: string):
  'INTERPOLATING' | 'TRACKING' | 'SNAP_CORRECTION' | 'GPS_DEGRADED' | 'STALE' | 'UNKNOWN' {
  return (s === 'INTERPOLATING' || s === 'TRACKING' || s === 'SNAP_CORRECTION'
    || s === 'GPS_DEGRADED' || s === 'STALE') ? s : 'UNKNOWN';
}

export interface LegacyCameraReport extends LegacyCameraOutcome {
  readonly speedKmh: number;
  readonly orientation: ViewportOrientation;
  readonly viewport: ViewportProfile;
}

/**
 * Legacy kamera sonucunu bildir ve politika önerisini GÖLGEDE üret.
 *
 * `setDrivingView` her çağrısında (uygulasa da erken dönse de) çağırır.
 * ASLA throw etmez ve hiçbir şey uygulamaz.
 *
 * @returns Karşılaştırma (test/gözlem) veya gölge kapalıysa `null`.
 */
export function noteLegacyCameraOutcome(
  report: LegacyCameraReport,
  reader: ShadowContextReader = _DEFAULT_READER,
): CameraShadowComparison | null {
  if (!_shadowEnabled) return null;
  try {
    const now = reader.nowMs();
    const motion = reader.motion();
    const route = reader.route();

    const decision = decideCameraPolicy({
      speedKmh: report.speedKmh,
      prevBand: _prevBand,
      nextManeuverM: route.alongM,
      maneuverDistanceSource: route.source,
      secondManeuverM: null,
      followState: _mapFollow(reader.followState()),
      motionState: _mapMotion(motion.state),
      orientation: report.orientation,
      viewport: report.viewport,
    });
    _prevBand = decision.speedBand;
    _policyEvaluationCount++;

    /* Politikanın güncelleme kapısı — ürüne UYGULANMAZ, yalnız sayılır.
       Bu sayaç, eğri devralındığında ne kadar kamera işi eleneceğinin
       kanıtıdır (bugün legacy kendi eşiklerini kullanmaya devam ediyor). */
    const accepted = shouldApplyCameraUpdate({
      nowMs: now,
      lastAppliedMs: _lastAppliedMs,
      prevDecision: _prevDecision,
      nextDecision: decision,
      prevSpeedKmh: _prevSpeedKmh,
      speedKmh: report.speedKmh,
    });
    if (accepted) { _policyAcceptedCount++; _lastAppliedMs = now; }
    else          { _policySuppressedCount++; }
    _prevDecision = decision;
    _prevSpeedKmh = report.speedKmh;

    if (report.applied) _legacyCameraApplyCount++;
    else                _legacyCameraSkipCount++;

    const ctx: CameraShadowContext = {
      speedKmh: report.speedKmh,
      maneuverAlongM: route.source === 'ALONG_ROUTE' ? route.alongM : null,
      maneuverDistanceSource: route.source,
      positionAgeMs: Number.isFinite(motion.sourceAgeMs) ? motion.sourceAgeMs : null,
      headingConfidence: Number.isFinite(motion.confidence) ? motion.confidence : null,
      headingKnown: report.bearing !== null && Number.isFinite(report.bearing),
    };

    const cmp = compareCameraOutcome(report, decision, ctx);
    if (isEquivalentUpdate(_last, cmp)) _duplicateEquivalentUpdateCount++;
    _last = cmp;
    if (cmp.suppressionReason) _lastSuppressionReason = cmp.suppressionReason;

    if (cmp.anchorYDelta !== null) {
      _maxAnchorDelta = Math.max(_maxAnchorDelta, Math.abs(cmp.anchorYDelta));
    }
    if (cmp.zoomDelta !== null)  _maxZoomDelta  = Math.max(_maxZoomDelta, Math.abs(cmp.zoomDelta));
    if (cmp.pitchDelta !== null) _maxPitchDelta = Math.max(_maxPitchDelta, Math.abs(cmp.pitchDelta));

    return cmp;
  } catch {
    /* FAIL-SOFT: gölge gözlem ürün kamerasını ASLA bozmaz. */
    return null;
  }
}

/** Navigasyon bitti / oturum kapandı → gölge durumu temizlenir (sayaçlar kalır). */
export function resetCameraShadowSession(): void {
  _last = null;
  _prevBand = null;
  _prevDecision = null;
  _lastAppliedMs = 0;
  _prevSpeedKmh = 0;
}

/** @internal — testler arası izolasyon (sayaçlar dahil). */
export function _resetCameraShadowForTest(): void {
  resetCameraShadowSession();
  _shadowEnabled = true;
  _policyEvaluationCount = 0;
  _policyAcceptedCount = 0;
  _policySuppressedCount = 0;
  _legacyCameraApplyCount = 0;
  _legacyCameraSkipCount = 0;
  _duplicateEquivalentUpdateCount = 0;
  _lastSuppressionReason = null;
  _maxAnchorDelta = 0;
  _maxZoomDelta = 0;
  _maxPitchDelta = 0;
}
