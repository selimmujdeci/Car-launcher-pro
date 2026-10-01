/**
 * forwardCollisionModel.ts — Öndeki araç: çarpışma uyarısı (FCW), takip
 * mesafesi (headway) ve "öndeki araç hareket etti" (SAF).
 *
 * ── ÇARPIŞMAYA KALAN SÜRE (TTC) KALİBRASYONDAN BAĞIMSIZ ─────────────────────
 * Öndeki aracın görüntüdeki genişliği w ise, sabit göreli hızda
 *     TTC = w / (dw/dt) = 1 / (d ln w / dt)
 * olur (Mobileye'ın klasik tek-kamera yöntemi). Mesafe, kamera yüksekliği ya da
 * odak uzaklığı bilinmeden hesaplanır → montaj hatalarına dayanıklı. `ln w`
 * α-β filtresiyle izlenir.
 *
 * ── TAKİP MESAFESİ ÖLÇÜLMÜŞ MESAFE İSTER ─────────────────────────────────────
 * Headway = mesafe / kendi hızımız. Mesafe düz-yol geometrisinden (kutu alt
 * kenarı ↔ ufuk) bulunur ve araç sınıfının tipik genişliğiyle çapraz kontrol
 * edilir; iki tahmin %50'den fazla ayrışırsa mesafe GÜVENİLMEZ sayılır ve takip
 * mesafesi uyarısı verilmez (FCW etkilenmez).
 *
 * ── YALNIZ KENDİ ŞERİDİMİZ ───────────────────────────────────────────────────
 * Aday araç kutusunun alt-orta noktası, kalibre merkez hattı etrafındaki ve
 * ufka doğru daralan koridorun içinde olmalı. Park etmiş araçlar ve yan
 * şeritler uyarı üretmez.
 *
 * ── DEDEKTÖR SAĞLIĞI ─────────────────────────────────────────────────────────
 * Tespit hızı < 4 Hz ya da gecikme > 300 ms ise TTC güvenilir izlenemez →
 * FCW `UNAVAILABLE (DETECTOR_TOO_SLOW)`. Sahte güven üretilmez.
 *
 * I/O · timer · `Date.now` · global durum YOK.
 */
import type {
  AdasCalibration, AdasFeatureState, AdasReason, AdasSensitivity, DetectionClass,
  NormBox, VehicleDetection,
} from './adasTypes';
import {
  LANE_REF_Y, alphaBetaStart, alphaBetaStep, focalNormFromHfov, groundDistanceM, iou,
  widthDistanceM, type AlphaBetaState,
} from './adasGeometry';

export const FCW_MIN_SPEED_KMH = 15;
export const HEADWAY_MIN_SPEED_KMH = 50;
export const FCW_TTC_S: Readonly<Record<AdasSensitivity, number>> = { early: 2.7, normal: 2.2, late: 1.8 };
export const HEADWAY_S: Readonly<Record<AdasSensitivity, number>> = { early: 1.0, normal: 0.8, late: 0.6 };
export const HEADWAY_SUSTAIN_MS = 3000;
export const FCW_CONFIRM_UPDATES = 2;
export const FCW_MIN_TRACK_UPDATES = 3;
export const FCW_MIN_TRACK_MS = 400;
export const FCW_HOLD_MS = 1500;
export const FCW_COOLDOWN_MS = 5000;
/** Bekleme süresinde bile TTC bunun altına inerse yeniden uyarılır. */
export const FCW_REARM_TTC_S = 1.2;
export const FCW_MAX_DISTANCE_M = 80;
export const MIN_DETECT_HZ = 4;
export const DETECT_WINDOW_MS = 3000;
export const MAX_DETECT_LATENCY_MS = 300;
export const MIN_DETECTION_SCORE = 0.5;
export const TRACK_MIN_IOU = 0.3;
export const TRACK_LOST_MS = 600;
/** Koridor yarı genişliği, şerit yarı genişliğinin bu katı (ayna/kasa taşması payı). */
export const CORRIDOR_FACTOR = 0.9;
/** Mesafe çapraz kontrolü: iki tahmin bu orandan fazla ayrışırsa güvenilmez. */
export const DISTANCE_AGREEMENT = 0.5;
export const LEAD_STOP_KMH = 1;
export const LEAD_STOP_MIN_MS = 2000;
/** Durunca öndeki araç kutusu bu oranda küçülürse "hareket etti". */
export const LEAD_SHRINK_RATIO = 0.8;
export const LEAD_PULSE_MS = 2500;

/** Sınıf başına tipik genişlik (m) — yalnız çapraz kontrol için. */
export const CLASS_WIDTH_M: Readonly<Record<DetectionClass, number>> = {
  car: 1.8, truck: 2.5, bus: 2.55, motorcycle: 0.8,
};

const ALPHA = 0.45;
const BETA = 0.12;

interface Track {
  readonly box: NormBox;
  readonly cls: DetectionClass;
  readonly firstMs: number;
  readonly lastMs: number;
  readonly n: number;
  readonly logW: AlphaBetaState;
}

export interface ForwardState {
  readonly track: Track | null;
  readonly detectTimes: readonly number[];
  readonly latencies: readonly number[];
  readonly firstDetectMs: number | null;
  readonly fcw: {
    readonly count: number;
    readonly activeSinceMs: number | null;
    readonly cooldownUntil: number;
  };
  readonly headwayBelowSinceMs: number | null;
  readonly stop: {
    readonly sinceMs: number | null;
    readonly refWidth: number | null;
    readonly fired: boolean;
  };
  readonly leadPulseUntil: number;
}

export const INITIAL_FORWARD_STATE: ForwardState = {
  track: null, detectTimes: [], latencies: [], firstDetectMs: null,
  fcw: { count: 0, activeSinceMs: null, cooldownUntil: 0 },
  headwayBelowSinceMs: null,
  stop: { sinceMs: null, refWidth: null, fired: false },
  leadPulseUntil: 0,
};

export interface ForwardInput {
  readonly tMs: number;
  /** Yeni tespit karesi; `null` = yalnız zaman ilerledi (tick). */
  readonly detections: readonly VehicleDetection[] | null;
  /** Bu tespitin kare yakalamadan sonuca gecikmesi (ms). */
  readonly latencyMs: number | null;
  readonly speedKmh: number | null;
  readonly calibration: AdasCalibration | null;
  readonly sensitivity: AdasSensitivity;
  readonly cameraHeightM: number;
  readonly hfovDeg: number;
  /** Dedektör karesinin en-boy oranı (genişlik/yükseklik). */
  readonly aspect: number;
}

export interface LeadInfo {
  readonly box: NormBox;
  readonly cls: DetectionClass;
  readonly distanceM: number | null;
  readonly ttcS: number | null;
  readonly headwayS: number | null;
}

export interface ForwardOutput {
  readonly forward: 'collision' | 'headway' | null;
  readonly leadDeparted: boolean;
  readonly fcwState: AdasFeatureState;
  readonly fcwReason: AdasReason | null;
  readonly headwayState: AdasFeatureState;
  readonly headwayReason: AdasReason | null;
  readonly leadState: AdasFeatureState;
  readonly leadReason: AdasReason | null;
  readonly lead: LeadInfo | null;
  readonly detectHz: number;
  readonly latencyMs: number | null;
}

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

/** Kalibre koridor: satır y'de merkez x ve yarı genişlik. Ufkun üstü → null. */
export function corridorAt(cal: AdasCalibration, y: number): { center: number; half: number } | null {
  const span = LANE_REF_Y - cal.horizonY;
  if (!(span > 0.05)) return null;
  const k = (y - cal.horizonY) / span;
  if (!(k > 0)) return null;
  return {
    center: cal.vanishX + (cal.centerX - cal.vanishX) * k,
    half: (cal.laneWidthAtRef / 2) * k * CORRIDOR_FACTOR,
  };
}

/** Koridordaki en yakın (alt kenarı en aşağıda) araç. */
export function selectLead(
  dets: readonly VehicleDetection[], cal: AdasCalibration,
): VehicleDetection | null {
  let best: VehicleDetection | null = null;
  for (const d of dets) {
    if (d.score < MIN_DETECTION_SCORE || d.box.w < 0.015) continue;
    const bottom = d.box.y + d.box.h;
    const c = corridorAt(cal, bottom);
    if (!c) continue;
    const cx = d.box.x + d.box.w / 2;
    if (Math.abs(cx - c.center) > c.half) continue;
    if (!best || bottom > best.box.y + best.box.h) best = d;
  }
  return best;
}

const within = (xs: readonly number[], tMs: number): number[] =>
  xs.filter((t) => tMs - t <= DETECT_WINDOW_MS);

function medianOf(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ── Ana adım ──────────────────────────────────────────────────────────── */

export function stepForward(prev: ForwardState, input: ForwardInput): { state: ForwardState; out: ForwardOutput } {
  const { tMs, speedKmh, calibration, sensitivity } = input;
  let s = prev;

  /* 1) Dedektör sağlığı (hız + gecikme penceresi). */
  if (input.detections !== null) {
    s = {
      ...s,
      detectTimes: [...within(s.detectTimes, tMs), tMs],
      latencies: input.latencyMs !== null
        ? [...s.latencies.slice(-29), input.latencyMs] : s.latencies,
      firstDetectMs: s.firstDetectMs ?? tMs,
    };
  } else {
    s = { ...s, detectTimes: within(s.detectTimes, tMs) };
  }
  const detectHz = s.detectTimes.length / (DETECT_WINDOW_MS / 1000);
  const latencyMs = medianOf(s.latencies);
  const warmedUp = s.firstDetectMs !== null && tMs - s.firstDetectMs >= DETECT_WINDOW_MS;
  const healthy = warmedUp && detectHz >= MIN_DETECT_HZ
    && (latencyMs === null || latencyMs <= MAX_DETECT_LATENCY_MS);

  /* 2) İzleme — yalnız yeni kare geldiğinde. */
  if (input.detections !== null && calibration) {
    const lead = selectLead(input.detections, calibration);
    if (!lead) {
      if (s.track && tMs - s.track.lastMs > TRACK_LOST_MS) s = { ...s, track: null };
    } else {
      const lnW = Math.log(lead.box.w);
      const same = s.track !== null && iou(s.track.box, lead.box) >= TRACK_MIN_IOU
        && tMs - s.track.lastMs <= TRACK_LOST_MS;
      s = {
        ...s,
        track: same && s.track
          ? {
            box: lead.box, cls: lead.cls, firstMs: s.track.firstMs, lastMs: tMs,
            n: s.track.n + 1, logW: alphaBetaStep(s.track.logW, lnW, tMs, ALPHA, BETA),
          }
          : { box: lead.box, cls: lead.cls, firstMs: tMs, lastMs: tMs, n: 1, logW: alphaBetaStart(lnW, tMs) },
      };
    }
  } else if (s.track && tMs - s.track.lastMs > TRACK_LOST_MS) {
    s = { ...s, track: null };
  }

  /* 3) Öndeki aracın ölçüleri. */
  const t = s.track;
  const matured = t !== null && t.n >= FCW_MIN_TRACK_UPDATES && t.lastMs - t.firstMs >= FCW_MIN_TRACK_MS;
  const rate = t && matured ? t.logW.v : null;
  const ttcS = rate !== null && rate > 0.02 ? 1 / rate : null;

  let distanceM: number | null = null;
  if (t && calibration) {
    const fN = focalNormFromHfov(input.hfovDeg);
    const zg = groundDistanceM(t.box.y + t.box.h, calibration.horizonY, fN, input.aspect, input.cameraHeightM);
    const zw = widthDistanceM(t.box.w, fN, CLASS_WIDTH_M[t.cls]);
    if (zg !== null && zw !== null && Math.abs(zg - zw) / zg <= DISTANCE_AGREEMENT) distanceM = zg;
  }
  const speedKnown = speedKmh !== null && Number.isFinite(speedKmh);
  const vMps = speedKnown ? (speedKmh as number) / 3.6 : null;
  const headwayS = distanceM !== null && vMps !== null && vMps > 1 ? distanceM / vMps : null;

  /* 4) FCW. */
  let fcwState: AdasFeatureState = 'READY';
  let fcwReason: AdasReason | null = null;
  if (!calibration) { fcwState = 'CALIBRATING'; fcwReason = 'CALIBRATING'; }
  else if (s.firstDetectMs === null || !warmedUp) { fcwState = 'UNAVAILABLE'; fcwReason = 'DETECTOR_LOADING'; }
  else if (!healthy) { fcwState = 'UNAVAILABLE'; fcwReason = 'DETECTOR_TOO_SLOW'; }
  else if (!speedKnown) { fcwState = 'UNAVAILABLE'; fcwReason = 'SPEED_UNKNOWN'; }
  else if ((speedKmh as number) < FCW_MIN_SPEED_KMH) { fcwState = 'STANDBY'; fcwReason = 'BELOW_SPEED'; }

  let fcw = s.fcw;
  const fcwEligible = fcwState === 'READY' && ttcS !== null
    && (distanceM === null || distanceM <= FCW_MAX_DISTANCE_M);
  const threatening = fcwEligible && (ttcS as number) < FCW_TTC_S[sensitivity];
  if (fcw.activeSinceMs !== null) {
    const held = tMs - fcw.activeSinceMs >= FCW_HOLD_MS;
    if (held && !threatening) fcw = { count: 0, activeSinceMs: null, cooldownUntil: tMs + FCW_COOLDOWN_MS };
  } else if (threatening && input.detections !== null) {
    const allowed = tMs >= fcw.cooldownUntil || (ttcS as number) < FCW_REARM_TTC_S;
    const count = allowed ? fcw.count + 1 : 0;
    fcw = count >= FCW_CONFIRM_UPDATES
      ? { count: 0, activeSinceMs: tMs, cooldownUntil: fcw.cooldownUntil }
      : { ...fcw, count };
  } else if (!threatening) {
    fcw = { ...fcw, count: 0 };
  }
  s = { ...s, fcw };

  /* 5) Takip mesafesi — ölçülmüş mesafe ve ≥ 50 km/h ister. */
  let headwayState: AdasFeatureState = 'READY';
  let headwayReason: AdasReason | null = null;
  if (!calibration) { headwayState = 'CALIBRATING'; headwayReason = 'CALIBRATING'; }
  else if (!warmedUp) { headwayState = 'UNAVAILABLE'; headwayReason = 'DETECTOR_LOADING'; }
  else if (!healthy) { headwayState = 'UNAVAILABLE'; headwayReason = 'DETECTOR_TOO_SLOW'; }
  else if (!speedKnown) { headwayState = 'UNAVAILABLE'; headwayReason = 'SPEED_UNKNOWN'; }
  else if ((speedKmh as number) < HEADWAY_MIN_SPEED_KMH) { headwayState = 'STANDBY'; headwayReason = 'BELOW_SPEED'; }

  const tooClose = headwayState === 'READY' && headwayS !== null && headwayS < HEADWAY_S[sensitivity];
  const belowSince = tooClose ? (s.headwayBelowSinceMs ?? tMs) : null;
  s = { ...s, headwayBelowSinceMs: belowSince };
  const headwayWarning = belowSince !== null && tMs - belowSince >= HEADWAY_SUSTAIN_MS;

  /* 6) Öndeki araç hareket etti — ölçek küçülmesi, kalibrasyon gerekmez. */
  let leadState: AdasFeatureState = 'READY';
  let leadReason: AdasReason | null = null;
  if (!warmedUp) { leadState = 'UNAVAILABLE'; leadReason = 'DETECTOR_LOADING'; }
  else if (!healthy) { leadState = 'UNAVAILABLE'; leadReason = 'DETECTOR_TOO_SLOW'; }
  else if (!speedKnown) { leadState = 'UNAVAILABLE'; leadReason = 'SPEED_UNKNOWN'; }
  else if (!calibration) { leadState = 'CALIBRATING'; leadReason = 'CALIBRATING'; }

  let stop = s.stop;
  if (leadState === 'READY' && (speedKmh as number) <= LEAD_STOP_KMH) {
    const sinceMs = stop.sinceMs ?? tMs;
    const stoppedLongEnough = tMs - sinceMs >= LEAD_STOP_MIN_MS;
    let refWidth = stop.refWidth;
    if (stoppedLongEnough && refWidth === null && t) refWidth = t.box.w;
    let fired = stop.fired;
    if (!fired && refWidth !== null && t && t.box.w <= refWidth * LEAD_SHRINK_RATIO) {
      fired = true;
      s = { ...s, leadPulseUntil: tMs + LEAD_PULSE_MS };
    }
    stop = { sinceMs, refWidth, fired };
  } else {
    stop = { sinceMs: null, refWidth: null, fired: false };
  }
  s = { ...s, stop };
  const leadDeparted = tMs < s.leadPulseUntil;

  const forward: ForwardOutput['forward'] =
    s.fcw.activeSinceMs !== null ? 'collision' : headwayWarning ? 'headway' : null;

  return {
    state: s,
    out: {
      forward, leadDeparted,
      fcwState, fcwReason, headwayState, headwayReason, leadState, leadReason,
      lead: t ? { box: t.box, cls: t.cls, distanceM, ttcS, headwayS } : null,
      detectHz, latencyMs,
    },
  };
}
