/**
 * adasSupervisor.ts — ADAS gözetmeni (SAF).
 *
 * `adasRuntime` dış dünyayı (kamera, araç verisi, ayarlar, dedektör) okur;
 * bu modül o okumaları modellerin diline çevirir ve model çıktılarını sistem
 * kapılarıyla birleştirip TEK hükme indirger:
 *
 *   girdi dönüşümü  → laneObservationFromFrame · turnSignalFrom · cameraKeyOf
 *   kamera evresi   → cameraPhase (izin / yok / hata / başlıyor / çalışıyor)
 *   özellik durumu  → composeFeatures (ayar · sistem kapısı · model)
 *   genel hüküm     → composeOverall
 *   uyarı sinyali   → composeWarning (YALNIZ READY özellik uyarı üretir)
 *
 * Kural: bir özellik READY değilse o özelliğin uyarısı ASLA yayımlanmaz —
 * kamera donduysa, işlemci yetişmiyorsa, kalibrasyon yoksa "uyarı yok" demek
 * "yol temiz" demek değildir; arayüz nedeni ayrıca söyler.
 *
 * I/O · timer · `Date.now` · global durum YOK.
 */
import type { LaneLine, VisionState } from '../visionStore';
import type {
  AdasCalibration, AdasFeature, AdasFeatureStatus, AdasReason, AdasSettings,
  AdasWarningSignal, LaneObservation, NormLine, TurnSignal,
} from './adasTypes';
import { NO_ADAS_WARNING } from './adasTypes';
import type { AdasOverall } from './adasStore';
import type { LdwOutput } from './laneDepartureModel';
import type { ForwardOutput } from './forwardCollisionModel';
import type { DetectorStatus } from './vehicleDetector';

/** Şerit worker'ının işleme çözünürlüğü (visionImageProcess PROC_W/PROC_H). */
export const LANE_SRC_W = 320;
export const LANE_SRC_H = 180;

/** Bu süre şerit karesi gelmezse kamera/işleme donmuş sayılır (ms). */
export const LANE_STALL_MS = 1500;

export const ADAS_FEATURES: readonly AdasFeature[] = ['ldw', 'fcw', 'headway', 'leadDeparture'];

// ── Girdi dönüşümü ───────────────────────────────────────────────────────────

const clampConf = (c: number): number => (Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0);

function toNorm(l: LaneLine, w: number, h: number): NormLine | null {
  const v = [l.x1, l.y1, l.x2, l.y2];
  if (!v.every(Number.isFinite)) return null;
  return { x1: l.x1 / w, y1: l.y1 / h, x2: l.x2 / w, y2: l.y2 / h, confidence: clampConf(l.confidence) };
}

/** Worker'ın piksel şerit çizgilerini normalize gözleme çevirir. */
export function laneObservationFromFrame(
  lanes: readonly LaneLine[], w = LANE_SRC_W, h = LANE_SRC_H,
): LaneObservation {
  const left = lanes.find((l) => l.side === 'left');
  const right = lanes.find((l) => l.side === 'right');
  return {
    left: left ? toNorm(left, w, h) : null,
    right: right ? toNorm(right, w, h) : null,
  };
}

/**
 * Sinyal lambası. Araç profili sinyali ÇÖZMÜYORSA ya da CAN kapısı güvenli
 * moddaysa `unknown` — varsayılan `false` değerleri "sinyal kapalı" sayılmaz.
 * Dörtlü (ya da iki taraf birden) yanıp sönüyorsa yön bilgisi yoktur → `none`.
 */
export function turnSignalFrom(p: {
  readonly known: boolean; readonly left: boolean; readonly right: boolean; readonly hazard: boolean;
}): TurnSignal {
  if (!p.known) return 'unknown';
  if (p.hazard || (p.left && p.right)) return 'none';
  return p.left ? 'left' : p.right ? 'right' : 'none';
}

/**
 * Kalibrasyonun ait olduğu kamera. Etiket (ör. "camera2 0, facing back",
 * "USB Camera (0c45:6366)") oturumlar arasında kararlıdır; deviceId bazı
 * WebView'larda site verisiyle döner — yalnız etiket yoksa kullanılır.
 */
export function cameraKeyOf(track: { readonly deviceId: string | null; readonly label: string } | null): string {
  if (!track) return 'auto';
  const label = track.label.trim();
  if (label) return `label:${label}`;
  return track.deviceId ? `id:${track.deviceId}` : 'auto';
}

/** Kayıtlı kalibrasyon yalnız AYNI kameraya uygulanır; başka kamera → `null`. */
export function calibrationFor(cal: AdasCalibration | null, cameraKey: string): AdasCalibration | null {
  return cal && cal.cameraKey === cameraKey ? cal : null;
}

// ── Kamera evresi ────────────────────────────────────────────────────────────

export type CameraPhase =
  | { readonly phase: 'starting' }
  | { readonly phase: 'running' }
  | { readonly phase: 'blocked'; readonly reason: AdasReason };

const DENIED_RE = /izin|NotAllowed|Permission|denied/i;
const MISSING_RE = /NotFound|not found|Overconstrained|DevicesNotFound|no camera|Requested device/i;

/** visionStore durumunu ADAS kamera evresine çevirir. */
export function cameraPhase(state: VisionState, error: string | null): CameraPhase {
  switch (state) {
    case 'active':
    case 'degraded':
      return { phase: 'running' };
    case 'disabled':
      return { phase: 'blocked', reason: error && MISSING_RE.test(error) ? 'NO_CAMERA' : 'CAMERA_DENIED' };
    case 'error':
      if (error && DENIED_RE.test(error)) return { phase: 'blocked', reason: 'CAMERA_DENIED' };
      return { phase: 'blocked', reason: error && MISSING_RE.test(error) ? 'NO_CAMERA' : 'CAMERA_ERROR' };
    default:
      return { phase: 'starting' };
  }
}

/** İzin reddi dışındaki kamera engelleri kendiliğinden düzelebilir (USB tak-çıkar). */
export function cameraReasonRetryable(reason: AdasReason): boolean {
  return reason === 'NO_CAMERA' || reason === 'CAMERA_ERROR' || reason === 'CAMERA_STALLED';
}

// ── Özellik durumu ───────────────────────────────────────────────────────────

export type { DetectorStatus };

export interface ComposeInput {
  readonly settings: AdasSettings;
  /**
   * Tüm özellikleri durduran sistem kapısı: REVERSE · SYSTEM_PROTECTION ·
   * kamera nedenleri. `null` = kapı açık.
   */
  readonly block: AdasReason | null;
  /** Kamera henüz açılıyor (izin penceresi / ilk kare). */
  readonly starting: boolean;
  readonly calibration: AdasCalibration | null;
  readonly laneStale: boolean;
  readonly ldw: LdwOutput | null;
  readonly forward: ForwardOutput | null;
  readonly detector: DetectorStatus;
}

const st = (feature: AdasFeature, state: AdasFeatureStatus['state'], reason: AdasReason | null): AdasFeatureStatus =>
  ({ feature, state, reason });

function forwardFeature(
  feature: 'fcw' | 'headway' | 'leadDeparture', i: ComposeInput,
): AdasFeatureStatus {
  if (!i.calibration) return st(feature, 'CALIBRATING', 'CALIBRATING');
  if (i.detector === 'unavailable') return st(feature, 'UNAVAILABLE', 'DETECTOR_UNAVAILABLE');
  if (i.detector !== 'ready' || !i.forward) return st(feature, 'UNAVAILABLE', 'DETECTOR_LOADING');
  const f = i.forward;
  if (feature === 'fcw') return st(feature, f.fcwState, f.fcwReason);
  if (feature === 'headway') return st(feature, f.headwayState, f.headwayReason);
  return st(feature, f.leadState, f.leadReason);
}

/** Dört özelliğin durumu — sıra sabit: ldw, fcw, headway, leadDeparture. */
export function composeFeatures(i: ComposeInput): AdasFeatureStatus[] {
  return ADAS_FEATURES.map((feature) => {
    if (!i.settings[feature]) return st(feature, 'OFF', null);
    if (i.block) return st(feature, 'UNAVAILABLE', i.block);
    if (i.starting) return st(feature, 'STANDBY', null);
    if (feature !== 'ldw') return forwardFeature(feature, i);
    if (i.laneStale) return st(feature, 'UNAVAILABLE', 'CAMERA_STALLED');
    if (!i.calibration) return st(feature, 'CALIBRATING', 'CALIBRATING');
    if (!i.ldw) return st(feature, 'STANDBY', null);
    return st(feature, i.ldw.state, i.ldw.reason);
  });
}

/** İki durum listesi aynı mı (gereksiz React render'ını önlemek için). */
export function sameFeatures(a: readonly AdasFeatureStatus[], b: readonly AdasFeatureStatus[]): boolean {
  return a.length === b.length
    && a.every((x, k) => x.feature === b[k].feature && x.state === b[k].state && x.reason === b[k].reason);
}

// ── Genel hüküm ──────────────────────────────────────────────────────────────

export interface OverallInput {
  readonly settings: AdasSettings;
  readonly features: readonly AdasFeatureStatus[];
  readonly block: AdasReason | null;
  readonly starting: boolean;
}

/** Ayarlarda en az bir özellik açık mı. */
export function anyFeatureEnabled(s: AdasSettings): boolean {
  return ADAS_FEATURES.some((f) => s[f]);
}

export function composeOverall(i: OverallInput): { overall: AdasOverall; reason: AdasReason | null } {
  if (!i.settings.enabled || !anyFeatureEnabled(i.settings)) return { overall: 'OFF', reason: 'DISABLED' };
  if (i.settings.consentAtMs === null) return { overall: 'OFF', reason: 'NO_CONSENT' };
  /* Geri vites geçicidir — sistem sağlam, yalnız beklemede. */
  if (i.block === 'REVERSE') return { overall: 'DEGRADED', reason: 'REVERSE' };
  if (i.block) return { overall: 'UNAVAILABLE', reason: i.block };
  if (i.starting) return { overall: 'STARTING', reason: null };

  const on = i.features.filter((f) => f.state !== 'OFF');
  const unavailable = on.filter((f) => f.state === 'UNAVAILABLE');
  if (on.length > 0 && unavailable.length === on.length) {
    return { overall: 'UNAVAILABLE', reason: unavailable[0].reason };
  }
  if (on.some((f) => f.state === 'CALIBRATING')) return { overall: 'CALIBRATING', reason: 'CALIBRATING' };
  if (unavailable.length > 0) return { overall: 'DEGRADED', reason: unavailable[0].reason };
  return { overall: 'ACTIVE', reason: null };
}

// ── Uyarı sinyali ────────────────────────────────────────────────────────────

/**
 * Güvenlik asistanına giden sinyal. Bir uyarı yalnız (a) kullanıcı o özelliği
 * açtıysa, (b) özellik şu an READY ise, (c) model o uyarıyı veriyorsa çıkar.
 */
export function composeWarning(
  settings: AdasSettings,
  features: readonly AdasFeatureStatus[],
  ldw: LdwOutput | null,
  forward: ForwardOutput | null,
  nowPerfMs: number,
): AdasWarningSignal {
  const ready = (f: AdasFeature): boolean => features.some((x) => x.feature === f && x.state === 'READY');

  const lane = settings.ldw && ready('ldw') ? (ldw?.warning ?? null) : null;

  let fwd: AdasWarningSignal['forward'] = null;
  if (forward) {
    if (settings.fcw && ready('fcw') && forward.forward === 'collision') fwd = 'collision';
    else if (settings.headway && ready('headway') && forward.headwayWarning) fwd = 'headway';
  }

  const leadDeparted = settings.leadDeparture && ready('leadDeparture') && !!forward?.leadDeparted;

  if (lane === null && fwd === null && !leadDeparted) {
    return { ...NO_ADAS_WARNING, atPerfMs: nowPerfMs };
  }
  return { lane, forward: fwd, leadDeparted, atPerfMs: nowPerfMs };
}
