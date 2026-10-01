/**
 * laneDepartureModel.ts — Şerit Ayrılma Uyarısı (LDW) karar modeli (SAF).
 *
 * ISO 17361 (LDWS) çizgisinde:
 *   · Yalnız ≥ 60 km/h'te etkin (55'te kapanır — histerezis).
 *   · Uyarı, aracın YANI çizgiye `margin` kadar yaklaşıp çizgiye doğru
 *     kayarken ya da çizgiyi geçmeye kalan süre (TLC) kısayken verilir.
 *   · O tarafa sinyal verilmişse (ya da az önce verildiyse) SUSAR.
 *   · Şerit değiştirmeyi (çizgilerin yer değiştirmesi) tanır; yanlış alarm yok.
 *
 * Sinyal bilgisi `unknown` ise uyarı yine çalışır ama çıktı bunu taşır —
 * arayüz "sinyal bilgisi yok: şerit değiştirirken uyarı alabilirsiniz" der.
 *
 * I/O · timer · `Date.now` · global durum YOK — (durum, girdi) → (durum, çıktı).
 */
import type {
  AdasCalibration, AdasFeatureState, AdasReason, AdasSensitivity, LaneObservation, TurnSignal,
} from './adasTypes';
import { alphaBetaStart, alphaBetaStep, type AlphaBetaState } from './adasGeometry';
import { laneGeometry } from './adasCalibration';

export const LDW_MIN_SPEED_KMH = 60;
export const LDW_RESUME_BELOW_KMH = 55;
/** Ölçek için varsayılan şerit genişliği (m) — TR otoyol 3.5–3.75. */
export const LDW_LANE_WIDTH_M = 3.5;
/** Aracın yarı genişliği (m). */
export const LDW_HALF_VEHICLE_M = 0.9;
export const LDW_MIN_LANE_CONF = 0.5;
/** Kalibre genişlikten bu orandan fazla sapan ölçüm yanlış çizgidir. */
export const LDW_WIDTH_TOLERANCE = 0.35;
/** Çizgiler bu süreden uzun görünmezse LOW_VISIBILITY. */
export const LDW_LANE_LOST_MS = 1500;
/** Uyarıdan önce ardışık onay karesi. */
export const LDW_CONFIRM_FRAMES = 2;
/** Uyarı en az bu kadar sürer (ms). */
export const LDW_MIN_HOLD_MS = 1200;
/** Aynı tarafa tekrar uyarmadan önce bekleme (ms). */
export const LDW_COOLDOWN_MS = 4000;
/** Sinyal kapandıktan sonra da bastırma süresi (ms). */
export const LDW_SIGNAL_MEMORY_MS = 2000;
/** Çizgiye doğru en düşük yanal hız (m/s) — kaymayan araç uyarılmaz. */
export const LDW_MIN_LATERAL_MPS = 0.1;
/** Ölçüm tahminden bu kadar saparsa çizgiler yer değiştirmiştir (şerit değişti). */
export const LDW_LANE_CHANGE_JUMP_M = 1.2;

const ALPHA = 0.5;
const BETA = 0.15;

/** Hassasiyete göre pay (m) ve TLC eşiği (s). */
export const LDW_SENSITIVITY: Readonly<Record<AdasSensitivity, { marginM: number; tlcS: number }>> = {
  early: { marginM: 0.3, tlcS: 1.0 },
  normal: { marginM: 0.15, tlcS: 0.7 },
  late: { marginM: 0.0, tlcS: 0.5 },
};

type Side = 'left' | 'right';

export interface LdwState {
  readonly filter: AlphaBetaState | null;
  readonly lastGoodMs: number | null;
  readonly candidate: { readonly side: Side; readonly count: number } | null;
  readonly active: { readonly side: Side; readonly sinceMs: number } | null;
  readonly cooldownUntil: { readonly left: number; readonly right: number };
  readonly lastSignal: { readonly side: Side; readonly atMs: number } | null;
  readonly speedGateOpen: boolean;
}

export const INITIAL_LDW_STATE: LdwState = {
  filter: null, lastGoodMs: null, candidate: null, active: null,
  cooldownUntil: { left: 0, right: 0 }, lastSignal: null, speedGateOpen: false,
};

export interface LdwInput {
  readonly tMs: number;
  readonly lanes: LaneObservation;
  readonly speedKmh: number | null;
  readonly turnSignal: TurnSignal;
  readonly calibration: AdasCalibration | null;
  readonly sensitivity: AdasSensitivity;
}

export interface LdwOutput {
  readonly warning: Side | null;
  readonly state: AdasFeatureState;
  readonly reason: AdasReason | null;
  /** Aracın şerit ortasına göre konumu (m, + = sağda). */
  readonly offsetM: number | null;
  readonly distLeftM: number | null;
  readonly distRightM: number | null;
  /** Yanal hız (m/s, + = sağa). */
  readonly lateralMps: number | null;
  readonly turnSignalKnown: boolean;
}

function out(
  s: LdwState, state: AdasFeatureState, reason: AdasReason | null, turnSignal: TurnSignal,
  extra?: Partial<LdwOutput>,
): LdwOutput {
  return {
    warning: s.active?.side ?? null,
    state, reason,
    offsetM: null, distLeftM: null, distRightM: null, lateralMps: null,
    turnSignalKnown: turnSignal !== 'unknown',
    ...extra,
  };
}

/** Uyarı kapanırken o tarafa bekleme süresi başlatılır. */
function release(s: LdwState, tMs: number): LdwState {
  if (!s.active) return s;
  const side = s.active.side;
  return {
    ...s, active: null, candidate: null,
    cooldownUntil: { ...s.cooldownUntil, [side]: tMs + LDW_COOLDOWN_MS },
  };
}

export function stepLdw(prev: LdwState, input: LdwInput): { state: LdwState; out: LdwOutput } {
  const { tMs, speedKmh, turnSignal, calibration } = input;
  let s = prev;

  /* Sinyal hafızası. */
  if (turnSignal === 'left' || turnSignal === 'right') {
    s = { ...s, lastSignal: { side: turnSignal, atMs: tMs } };
    if (s.active?.side === turnSignal) s = release(s, tMs);
  }
  const signalled = (side: Side): boolean =>
    turnSignal === side || (s.lastSignal?.side === side && tMs - s.lastSignal.atMs <= LDW_SIGNAL_MEMORY_MS);

  /* Hız kapısı (histerezis). Bilinmeyen hız → çalışmaz (fail-closed). */
  if (speedKmh === null || !Number.isFinite(speedKmh)) {
    s = { ...release(s, tMs), speedGateOpen: false, filter: null };
    return { state: s, out: out(s, 'UNAVAILABLE', 'SPEED_UNKNOWN', turnSignal) };
  }
  const gate = s.speedGateOpen ? speedKmh >= LDW_RESUME_BELOW_KMH : speedKmh >= LDW_MIN_SPEED_KMH;
  s = { ...s, speedGateOpen: gate };

  if (!calibration) {
    s = { ...release(s, tMs), filter: null };
    return { state: s, out: out(s, 'CALIBRATING', 'CALIBRATING', turnSignal) };
  }
  if (!gate) {
    s = { ...release(s, tMs), filter: null };
    return { state: s, out: out(s, 'STANDBY', 'BELOW_SPEED', turnSignal) };
  }

  /* Şerit geometrisi — kalibre genişlikle tutarlı değilse yanlış çizgidir. */
  const g = laneGeometry(input.lanes, LDW_MIN_LANE_CONF);
  const plausible = g !== null
    && Math.abs(g.width - calibration.laneWidthAtRef) <= LDW_WIDTH_TOLERANCE * calibration.laneWidthAtRef;

  if (!g || !plausible) {
    const lostFor = s.lastGoodMs === null ? Infinity : tMs - s.lastGoodMs;
    if (s.active && tMs - s.active.sinceMs >= LDW_MIN_HOLD_MS) s = release(s, tMs);
    if (lostFor > LDW_LANE_LOST_MS) {
      s = { ...release(s, tMs), filter: null, candidate: null };
      return { state: s, out: out(s, 'UNAVAILABLE', 'LOW_VISIBILITY', turnSignal) };
    }
    return { state: s, out: out(s, 'READY', null, turnSignal) };
  }

  /* Ölçek: kalibre şerit genişliği ↔ gerçek şerit genişliği. */
  const pxPerM = g.width / LDW_LANE_WIDTH_M;
  const z = (calibration.centerX - g.mid) / pxPerM;

  /* Filtre; büyük sıçrama = çizgiler yer değiştirdi (şerit değiştirildi). */
  let filter: AlphaBetaState;
  let laneChanged = false;
  if (!s.filter) {
    filter = alphaBetaStart(z, tMs);
  } else {
    const dt = (tMs - s.filter.tMs) / 1000;
    const predicted = s.filter.x + s.filter.v * Math.max(0, dt);
    if (Math.abs(z - predicted) > LDW_LANE_CHANGE_JUMP_M) {
      filter = alphaBetaStart(z, tMs);
      laneChanged = true;
    } else {
      filter = alphaBetaStep(s.filter, z, tMs, ALPHA, BETA);
    }
  }
  s = { ...s, filter, lastGoodMs: tMs };
  if (laneChanged) {
    s = {
      ...s, active: null, candidate: null,
      cooldownUntil: { left: tMs + LDW_COOLDOWN_MS, right: tMs + LDW_COOLDOWN_MS },
    };
  }

  const offset = filter.x;
  const v = filter.n >= 3 ? filter.v : 0;
  const distLeft = LDW_LANE_WIDTH_M / 2 + offset - LDW_HALF_VEHICLE_M;
  const distRight = LDW_LANE_WIDTH_M / 2 - offset - LDW_HALF_VEHICLE_M;
  const { marginM, tlcS } = LDW_SENSITIVITY[input.sensitivity];

  const approaching = (side: Side): boolean => {
    const d = side === 'left' ? distLeft : distRight;
    const toward = side === 'left' ? -v : v;
    if (!(toward > LDW_MIN_LATERAL_MPS)) return false;
    const tlc = d / toward;
    return d < marginM || (tlc < tlcS && d < 0.6);
  };

  const extra = {
    offsetM: offset, distLeftM: distLeft, distRightM: distRight, lateralMps: v,
  };

  /* Etkin uyarının kapanışı: en az tutma süresi + şeride geri dönüş. */
  if (s.active) {
    const side = s.active.side;
    const d = side === 'left' ? distLeft : distRight;
    const held = tMs - s.active.sinceMs >= LDW_MIN_HOLD_MS;
    if (held && (d > marginM + 0.15 || !approaching(side))) s = release(s, tMs);
    return { state: s, out: out(s, 'READY', null, turnSignal, extra) };
  }

  /* Yeni aday — sinyalli tarafa ve bekleme süresindeki tarafa uyarı yok. */
  const side: Side | null =
    approaching('left') && !signalled('left') && tMs >= s.cooldownUntil.left ? 'left'
      : approaching('right') && !signalled('right') && tMs >= s.cooldownUntil.right ? 'right'
        : null;

  if (side === null) {
    s = { ...s, candidate: null };
  } else {
    const count = s.candidate?.side === side ? s.candidate.count + 1 : 1;
    s = count >= LDW_CONFIRM_FRAMES
      ? { ...s, candidate: null, active: { side, sinceMs: tMs } }
      : { ...s, candidate: { side, count } };
  }
  return { state: s, out: out(s, 'READY', null, turnSignal, extra) };
}
