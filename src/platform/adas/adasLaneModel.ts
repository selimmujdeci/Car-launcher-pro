/**
 * adasLaneModel.ts — Şerit takibi + Şeritten Ayrılma Uyarısı (LDW). Durumlu, deterministik.
 *
 * YÖNTEM: görüntüdeki her şerit çizgisi yol düzleminde bir doğruya karşılık gelir.
 * Çizginin iki satırdaki yanal konumu (X₁@Z₁, X₂@Z₂) hesaplanır ve ön tekerlek
 * hizasına (Z_teker) doğrusal olarak taşınır → tekerlek ile çizgi arasındaki boşluk.
 * Boşluğun zamana göre türevi (en küçük kareler, ~0.6 s pencere) yanal hızdır.
 *
 * UYARI KOŞULU (hepsi):
 *   · hız TAZE ve ≥ eşik (hassasiyete göre 55/60/65 km/sa)
 *   · ilgili çizgi ≥ 3 ardışık karede güvenle izleniyor
 *   · boşluk ≤ eşik VE çizgiye doğru yanal hız ≥ 0.1 m/s
 *   · o yöne sinyal VERİLMEMİŞ
 *   · sinyal bilgisi YOKSA ('unknown'): yanal hız ≤ 0.9 m/s — kasıtlı şerit
 *     değişimi (tipik > 1 m/s) sürüklenmeden ayrılır; bu, sinyal kablosu olmayan
 *     kurulumda her şerit değişiminde bağırmayı önler.
 * Tetiklendikten sonra aynı olay tekrar ETMEZ: araç şeride dönüp ≥ 1 s ortada kalana
 * veya çizgiler ≥ 1.5 s kaybolana kadar yeniden kurulmaz.
 */

import type { AdasCameraModel } from './adasGeometry';
import { groundDistanceFromRow, lateralFromColumn } from './adasGeometry';
import type { AdasLaneLine, AdasLaneState, AdasSensitivity, AdasTurnSignal } from './adasTypes';

export const LDW_CFG = {
  MIN_SPEED_KMH: { early: 55, normal: 60, late: 65 } as Record<AdasSensitivity, number>,
  GAP_WARN_M:    { early: 0.3, normal: 0.15, late: 0.0 } as Record<AdasSensitivity, number>,
  VEHICLE_HALF_WIDTH_M: 0.9,
  MIN_LINE_CONF: 0.45,
  MIN_TRACK_FRAMES: 3,
  MIN_TOWARD_MPS: 0.1,
  MAX_DRIFT_MPS_NO_SIGNAL: 0.9,
  VEL_WINDOW_MS: 600,
  LINE_JUMP_M: 0.6,
  LANE_WIDTH_MIN_M: 2.4,
  LANE_WIDTH_MAX_M: 4.8,
  HOLD_MIN_MS: 1500,
  HOLD_MAX_MS: 3500,
  REARM_CENTER_GAP_M: 0.4,
  REARM_CENTER_MS: 1000,
  REARM_LOST_MS: 1500,
  WHEEL_BEHIND_BUMPER_M: 0.9,
} as const;

export interface LaneModelInput {
  lanes: readonly AdasLaneLine[];
  nowMs: number;
  /** Taze ego hız (km/sa); bayat/bilinmiyorsa null → uyarı üretilmez. */
  speedKmh: number | null;
  turnSignal: AdasTurnSignal;
  cam: AdasCameraModel;
  sensitivity: AdasSensitivity;
}

export interface LaneModelOutput {
  lane: AdasLaneState;
  /** Bu anda aktif ayrılma uyarısı (tutma süresi dahil). */
  departure: 'left' | 'right' | null;
}

interface SideTrack {
  hist: Array<{ t: number; x: number }>;
  streak: number;
  lastSeenTs: number;
}

function newSide(): SideTrack {
  return { hist: [], streak: 0, lastSeenTs: Number.NEGATIVE_INFINITY };
}

/** Çizginin v satırındaki u değeri (doğrusal). */
function uAt(line: AdasLaneLine, v: number): number {
  const dv = line.vBottom - line.vTop;
  if (Math.abs(dv) < 1e-6) return line.uBottom;
  return line.uTop + ((line.uBottom - line.uTop) * (v - line.vTop)) / dv;
}

/**
 * Çizginin ön tekerlek hizasındaki yanal konumu (m, araç orta çizgisine göre).
 * Görünür en yakın satır (Z₁) ve iki kat uzağı (Z₂) üzerinden doğrusal ekstrapolasyon.
 */
export function lineLateralAtWheel(line: AdasLaneLine, cam: AdasCameraModel): number | null {
  const v1 = Math.min(line.vBottom, cam.hoodV - 0.01);
  const z1 = groundDistanceFromRow(v1, cam);
  if (z1 === null) return null;
  const z2 = z1 * 2;
  const v2 = cam.horizonV + (v1 - cam.horizonV) / 2;
  const x1 = lateralFromColumn(uAt(line, v1), z1, cam);
  const x2 = lateralFromColumn(uAt(line, v2), z2, cam);
  const zWheel = Math.max(0.3, cam.bumperOffsetM - LDW_CFG.WHEEL_BEHIND_BUMPER_M);
  const slope = (x2 - x1) / (z2 - z1);
  const x = x1 + slope * (zWheel - z1);
  return Number.isFinite(x) ? x : null;
}

/** En küçük kareler eğimi (birim/ms → birim/s). Yetersiz örnek → null. */
function slopePerSec(hist: ReadonlyArray<{ t: number; x: number }>): number | null {
  if (hist.length < 3) return null;
  const n = hist.length;
  let st = 0, sx = 0;
  for (const p of hist) { st += p.t; sx += p.x; }
  const mt = st / n, mx = sx / n;
  let num = 0, den = 0;
  for (const p of hist) { num += (p.t - mt) * (p.x - mx); den += (p.t - mt) ** 2; }
  if (den <= 0) return null;
  return (num / den) * 1000;
}

export class LaneDepartureModel {
  private left = newSide();
  private right = newSide();
  private laneWidth: number | null = null;
  private activeSide: 'left' | 'right' | null = null;
  private activeSince = 0;
  private armed = true;
  private centeredSince: number | null = null;

  reset(): void {
    this.left = newSide();
    this.right = newSide();
    this.laneWidth = null;
    this.activeSide = null;
    this.activeSince = 0;
    this.armed = true;
    this.centeredSince = null;
  }

  private ingest(track: SideTrack, x: number | null, conf: number, now: number): void {
    if (x === null || conf < LDW_CFG.MIN_LINE_CONF) {
      track.streak = 0;
      return;
    }
    const last = track.hist[track.hist.length - 1];
    // Çizgi sıçraması (şerit geçildi / sınıflandırma yön değiştirdi) → geçmiş geçersiz.
    if (last && Math.abs(x - last.x) > LDW_CFG.LINE_JUMP_M) {
      track.hist = [];
      track.streak = 0;
    }
    track.hist.push({ t: now, x });
    while (track.hist.length > 0 && now - track.hist[0].t > LDW_CFG.VEL_WINDOW_MS) track.hist.shift();
    track.streak += 1;
    track.lastSeenTs = now;
  }

  update(input: LaneModelInput): LaneModelOutput {
    const { lanes, nowMs: now, cam, sensitivity } = input;
    const l = lanes.find((x) => x.side === 'left');
    const r = lanes.find((x) => x.side === 'right');
    let xl = l ? lineLateralAtWheel(l, cam) : null;
    let xr = r ? lineLateralAtWheel(r, cam) : null;

    // Geometrik tutarlılık: sol çizgi solda, sağ çizgi sağda, genişlik makul.
    if (xl !== null && xl > 0) xl = null;
    if (xr !== null && xr < 0) xr = null;
    if (xl !== null && xr !== null) {
      const w = xr - xl;
      if (w < LDW_CFG.LANE_WIDTH_MIN_M || w > LDW_CFG.LANE_WIDTH_MAX_M) { xl = null; xr = null; }
      else this.laneWidth = this.laneWidth === null ? w : this.laneWidth * 0.9 + w * 0.1;
    }

    this.ingest(this.left, xl, l?.confidence ?? 0, now);
    this.ingest(this.right, xr, r?.confidence ?? 0, now);

    const leftTracked = this.left.streak >= LDW_CFG.MIN_TRACK_FRAMES;
    const rightTracked = this.right.streak >= LDW_CFG.MIN_TRACK_FRAMES;

    const half = LDW_CFG.VEHICLE_HALF_WIDTH_M;
    const gapL = leftTracked && xl !== null ? -xl - half : null;
    const gapR = rightTracked && xr !== null ? xr - half : null;

    // Araç sağa giderken çizgilerin X'i azalır → yanal hız = −dX/dt.
    const sL = leftTracked ? slopePerSec(this.left.hist) : null;
    const sR = rightTracked ? slopePerSec(this.right.hist) : null;
    const vels = [sL, sR].filter((s): s is number => s !== null).map((s) => -s);
    const lateralVel = vels.length ? vels.reduce((a, b) => a + b, 0) / vels.length : null;

    const offsetM = xl !== null && xr !== null && leftTracked && rightTracked ? -(xl + xr) / 2 : null;

    // ── Yeniden kurma (re-arm) ────────────────────────────────────────────
    const bothLost = now - this.left.lastSeenTs > LDW_CFG.REARM_LOST_MS
      && now - this.right.lastSeenTs > LDW_CFG.REARM_LOST_MS;
    const centered = (gapL === null || gapL >= LDW_CFG.REARM_CENTER_GAP_M)
      && (gapR === null || gapR >= LDW_CFG.REARM_CENTER_GAP_M)
      && (gapL !== null || gapR !== null);
    if (centered) { if (this.centeredSince === null) this.centeredSince = now; }
    else this.centeredSince = null;
    if (!this.armed && this.activeSide === null
      && (bothLost || (this.centeredSince !== null && now - this.centeredSince >= LDW_CFG.REARM_CENTER_MS))) {
      this.armed = true;
    }

    // ── Aktif uyarının tutulması / bitişi ─────────────────────────────────
    const warnGap = LDW_CFG.GAP_WARN_M[sensitivity];
    if (this.activeSide !== null) {
      const held = now - this.activeSince;
      const gap = this.activeSide === 'left' ? gapL : gapR;
      const recovered = gap !== null && gap > warnGap + 0.25;
      if (held >= LDW_CFG.HOLD_MAX_MS || (held >= LDW_CFG.HOLD_MIN_MS && (recovered || gap === null))) {
        this.activeSide = null;
      }
    }

    // ── Yeni tetik ────────────────────────────────────────────────────────
    const speedOk = input.speedKmh !== null && input.speedKmh >= LDW_CFG.MIN_SPEED_KMH[sensitivity];
    if (this.activeSide === null && this.armed && speedOk) {
      const candidate = (side: 'left' | 'right', gap: number | null, slope: number | null): boolean => {
        if (gap === null || slope === null) return false;
        if (gap > warnGap) return false;
        // Sola sürükleniyorsa sol çizginin X'i ARTAR (sıfıra yaklaşır) → toward = +slope.
        const toward = side === 'left' ? slope : -slope;
        if (toward < LDW_CFG.MIN_TOWARD_MPS) return false;
        if (input.turnSignal === side) return false;
        if (input.turnSignal === 'unknown' && toward > LDW_CFG.MAX_DRIFT_MPS_NO_SIGNAL) return false;
        return true;
      };
      const side = candidate('left', gapL, sL) ? 'left' : candidate('right', gapR, sR) ? 'right' : null;
      if (side !== null) {
        this.activeSide = side;
        this.activeSince = now;
        this.armed = false;
        this.centeredSince = null;
      }
    }

    return {
      lane: {
        offsetM,
        laneWidthM: this.laneWidth,
        lateralVelMps: lateralVel,
        leftTracked,
        rightTracked,
      },
      departure: this.activeSide,
    };
  }
}
