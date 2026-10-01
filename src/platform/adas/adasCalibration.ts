/**
 * adasCalibration.ts — Kamera kalibrasyonu: varsayılanlar, doğrulama, otomatik ufuk. SAF.
 *
 * NEDEN OTOMATİK UFUK: metrik mesafe (takip aralığı) doğrudan ufuk satırına bağlıdır;
 * ufukta %1'lik hata 30 m'de ~%15 mesafe hatası demektir. Kullanıcıdan piksel hassasiyeti
 * istemek yerine düz yolda iki şerit çizgisinin kesiştiği KAYBOLMA NOKTASI izlenir ve
 * sağlam (medyan + MAD) bir tahmin yakınsayınca kalibrasyon `auto` olur.
 *
 * FAIL-CLOSED: `source === 'default'` iken metrik mesafe güvenilmez sayılır — takip
 * mesafesi uyarısı üretilmez; ön çarpışma uyarısı ise kalibrasyondan BAĞIMSIZ olan
 * ölçek-değişimi TTC'sine dayanır (bkz. adasCollisionModel).
 */

import type { AdasCalibration, AdasLaneLine } from './adasTypes';

export const DEFAULT_ADAS_CALIBRATION: Readonly<AdasCalibration> = Object.freeze({
  version: 1,
  hfovDeg: 70,          // tipik ön cam kamerası / telefon ana kamera 16:9 kırpım
  cameraHeightM: 1.25,  // binek araç ön cam üst orta montaj
  horizonV: 0.45,
  forwardU: 0.5,
  hoodV: 0.92,          // alt %8 kaput/torpido payı
  lateralOffsetM: 0,
  bumperOffsetM: 1.9,   // ön cam → ön tampon
  source: 'default',
});

/** Alan bazında geçerli aralıklar — dışı varsayılana düşer (sessiz kırpma YOK). */
const LIMITS = {
  hfovDeg:        [40, 130],
  cameraHeightM:  [0.5, 3.0],
  horizonV:       [0.15, 0.85],
  forwardU:       [0.2, 0.8],
  hoodV:          [0.6, 1.0],
  lateralOffsetM: [-1.2, 1.2],
  bumperOffsetM:  [0, 4],
} as const;

function pick(raw: Record<string, unknown>, key: keyof typeof LIMITS): number {
  const v = raw[key];
  const [lo, hi] = LIMITS[key];
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
    ? v
    : DEFAULT_ADAS_CALIBRATION[key];
}

/**
 * Kalıcı depodan gelen güvenilmez veriyi doğrular. Bozuk alan → o alanın varsayılanı.
 * Ufuk bozuksa kaynak `default`a düşer (metrik güven kaybolur — fail-closed).
 */
export function sanitizeCalibration(raw: unknown): AdasCalibration {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_ADAS_CALIBRATION };
  const r = raw as Record<string, unknown>;
  const horizonOk = typeof r.horizonV === 'number' && Number.isFinite(r.horizonV)
    && r.horizonV >= LIMITS.horizonV[0] && r.horizonV <= LIMITS.horizonV[1];
  const src = r.source === 'auto' || r.source === 'manual' ? r.source : 'default';
  return {
    version: 1,
    hfovDeg: pick(r, 'hfovDeg'),
    cameraHeightM: pick(r, 'cameraHeightM'),
    horizonV: pick(r, 'horizonV'),
    forwardU: pick(r, 'forwardU'),
    hoodV: pick(r, 'hoodV'),
    lateralOffsetM: pick(r, 'lateralOffsetM'),
    bumperOffsetM: pick(r, 'bumperOffsetM'),
    source: horizonOk ? src : 'default',
  };
}

/** Metrik mesafe (takip aralığı) için kalibrasyon yeterince güvenilir mi. */
export function isMetricCalibration(cal: AdasCalibration): boolean {
  return cal.source === 'auto' || cal.source === 'manual';
}

// ── Kaybolma noktası ─────────────────────────────────────────────────────────

export interface VanishingPoint { u: number; v: number }

/**
 * Sol ve sağ şerit çizgilerinin kesişimi. Çizgiler u = a + b·v biçiminde:
 * sol çizgi aşağı indikçe sola açılır (b < 0), sağ çizgi sağa (b > 0).
 * Paralel/ters eğimli/kadraj dışı kesişim → null.
 */
export function vanishingPointFromLanes(left: AdasLaneLine, right: AdasLaneLine): VanishingPoint | null {
  const dvL = left.vBottom - left.vTop;
  const dvR = right.vBottom - right.vTop;
  if (dvL < 0.05 || dvR < 0.05) return null;
  const bL = (left.uBottom - left.uTop) / dvL;
  const bR = (right.uBottom - right.uTop) / dvR;
  if (!(bL < -0.05) || !(bR > 0.05)) return null;
  const aL = left.uTop - bL * left.vTop;
  const aR = right.uTop - bR * right.vTop;
  const v = (aR - aL) / (bL - bR);
  const u = aL + bL * v;
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  if (v < LIMITS.horizonV[0] || v > LIMITS.horizonV[1]) return null;
  if (u < LIMITS.forwardU[0] || u > LIMITS.forwardU[1]) return null;
  return { u, v };
}

// ── Otomatik ufuk tahmincisi ─────────────────────────────────────────────────

export interface HorizonEstimate {
  horizonV: number;
  forwardU: number;
  samples: number;
  /** Medyan mutlak sapma (v ekseni). */
  spreadV: number;
  converged: boolean;
}

export const HORIZON_CFG = {
  WINDOW: 90,
  MIN_SAMPLES: 40,
  MAX_SPREAD_V: 0.015,
  MIN_SAMPLE_GAP_MS: 200,
  MIN_SPEED_KMH: 40,
  MIN_LANE_CONF: 0.5,
} as const;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Durumlu ama deterministik ufuk tahmincisi. Örnek yalnız: hız ≥ 40 km/sa, iki şerit
 * güvenilir, kesişim kadraj içinde. Aynı örnek dizisi → aynı tahmin.
 */
export class HorizonEstimator {
  private vs: number[] = [];
  private us: number[] = [];
  private lastSampleTs = Number.NEGATIVE_INFINITY;

  /** @returns örnek kabul edildiyse true. */
  addLanes(lanes: readonly AdasLaneLine[], speedKmh: number | null, nowMs: number): boolean {
    if (speedKmh === null || speedKmh < HORIZON_CFG.MIN_SPEED_KMH) return false;
    if (nowMs - this.lastSampleTs < HORIZON_CFG.MIN_SAMPLE_GAP_MS) return false;
    const left = lanes.find((l) => l.side === 'left');
    const right = lanes.find((l) => l.side === 'right');
    if (!left || !right) return false;
    if (left.confidence < HORIZON_CFG.MIN_LANE_CONF || right.confidence < HORIZON_CFG.MIN_LANE_CONF) return false;
    const vp = vanishingPointFromLanes(left, right);
    if (!vp) return false;
    this.vs.push(vp.v);
    this.us.push(vp.u);
    if (this.vs.length > HORIZON_CFG.WINDOW) { this.vs.shift(); this.us.shift(); }
    this.lastSampleTs = nowMs;
    return true;
  }

  estimate(): HorizonEstimate | null {
    const n = this.vs.length;
    if (n === 0) return null;
    const horizonV = median(this.vs);
    const forwardU = median(this.us);
    const spreadV = median(this.vs.map((v) => Math.abs(v - horizonV)));
    return {
      horizonV,
      forwardU,
      samples: n,
      spreadV,
      converged: n >= HORIZON_CFG.MIN_SAMPLES && spreadV <= HORIZON_CFG.MAX_SPREAD_V,
    };
  }

  reset(): void {
    this.vs = [];
    this.us = [];
    this.lastSampleTs = Number.NEGATIVE_INFINITY;
  }
}
