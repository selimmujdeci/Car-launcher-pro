/**
 * adasCollisionModel.ts — Öndeki araç izleme: Ön Çarpışma Uyarısı (FCW), takip mesafesi
 * (headway) ve öndeki aracın kalkışı. Durumlu, deterministik (saat dışarıdan gelir).
 *
 * İKİ BAĞIMSIZ MESAFE İPUCU:
 *   1) ÖLÇEK DEĞİŞİMİ (kalibrasyondan BAĞIMSIZ): görüntüdeki genişlik w ∝ 1/Z olduğundan
 *        d(ln w)/dt = −Ż/Z = 1/TTC
 *      Kamera açısı/yüksekliği bilinmese bile çarpışma süresi doğru çıkar. FCW'nin
 *      birincil girdisi budur — yanlış kalibrasyon FCW'yi kör etmez.
 *   2) YER SATIRI (kalibrasyon ister): aracın yola temas satırı → metrik mesafe (Z).
 *      Takip aralığı (sn) ve yaklaşma hızı (m/s) buradan gelir; kalibrasyon
 *      `default` iken bu değerler YAYINLANMAZ (null) — sahte metre gösterilmez.
 *
 * YANLIŞ ALARM ÖNLEMLERİ: iz ≥ 4 ardışık karede teyit · ego şerit koridoru ·
 * gerçekçi araç genişliği · fiziksel tutarlılık (yaklaşma ≤ ego hız + 3 m/s) ·
 * eşik altında ≥ 2 ardışık değerlendirme · ego hız TAZE değilse HİÇ uyarı yok.
 */

import type { AdasCameraModel } from './adasGeometry';
import { groundDistanceFromRow, lateralFromColumn, widthMetersAt } from './adasGeometry';
import type { AdasLeadState, AdasSensitivity, AdasVehicleDetection } from './adasTypes';

export const FCW_CFG = {
  TTC_WARN_S: { early: 2.7, normal: 2.2, late: 1.7 } as Record<AdasSensitivity, number>,
  TTC_CLEAR_MARGIN_S: 0.6,
  MIN_EGO_KMH: 10,
  MIN_CONFIRM_HITS: 4,
  MIN_CONSEC_BELOW: 2,
  HOLD_MIN_MS: 1200,
  MAX_CLOSING_OVER_EGO_MPS: 3,
  MIN_RANGE_RATE_MPS: -0.5,
} as const;

export const HEADWAY_CFG = {
  GAP_WARN_S: { early: 1.0, normal: 0.8, late: 0.6 } as Record<AdasSensitivity, number>,
  MIN_EGO_KMH: 40,
  SUSTAIN_MS: 3000,
  CLEAR_MARGIN_S: 0.15,
  REARM_MARGIN_S: 0.3,
  REARM_MS: 5000,
} as const;

export const LEAD_DEPART_CFG = {
  STOPPED_KMH: 2,
  MOVING_KMH: 5,
  MIN_STOPPED_MS: 2000,
  MAX_BASE_RANGE_M: 20,
  SHRINK_RATIO: 0.75,
  HOLD_MS: 3000,
} as const;

export const TRACK_CFG = {
  WINDOW_MS: 700,
  COAST_MS: 300,
  MIN_CONF: 0.35,
  MAX_LATERAL_M: 1.6,
  WIDTH_METRIC_M: [1.3, 2.9] as const,
  WIDTH_DEFAULT_M: [1.0, 3.4] as const,
  ASSOC_DU: 0.08,
  ASSOC_WIDTH_RATIO: 1.43,
  MIN_FIT_SAMPLES: 4,
} as const;

export interface CollisionModelInput {
  detection: AdasVehicleDetection | null;
  nowMs: number;
  /** Taze ego hız (km/sa); bayat/bilinmiyorsa null → hiçbir uyarı üretilmez. */
  speedKmh: number | null;
  cam: AdasCameraModel;
  /** Kalibrasyon metrik mesafe için güvenilir mi (auto/manual). */
  metric: boolean;
  sensitivity: AdasSensitivity;
}

export interface CollisionModelOutput {
  lead: AdasLeadState | null;
  forwardCollision: boolean;
  headway: boolean;
  leadDeparture: boolean;
}

interface Sample { t: number; lnW: number; w: number; z: number | null; uc: number }

interface Fit { value: number; slopePerSec: number }

/** Doğrusal en küçük kareler; `tRef` anındaki değer + eğim (birim/s). */
function linFit(pts: ReadonlyArray<{ t: number; y: number }>, tRef: number): Fit | null {
  const n = pts.length;
  if (n < TRACK_CFG.MIN_FIT_SAMPLES) return null;
  let st = 0, sy = 0;
  for (const p of pts) { st += p.t; sy += p.y; }
  const mt = st / n, my = sy / n;
  let num = 0, den = 0;
  for (const p of pts) { num += (p.t - mt) * (p.y - my); den += (p.t - mt) ** 2; }
  if (den <= 0) return null;
  const slope = num / den;
  return { value: my + slope * (tRef - mt), slopePerSec: slope * 1000 };
}

export class LeadVehicleModel {
  private hist: Sample[] = [];
  private hits = 0;
  private lastHitTs = Number.NEGATIVE_INFINITY;

  private fcwActive = false;
  private fcwSince = 0;
  private fcwBelowCount = 0;

  private headwayActive = false;
  private headwayBelowSince: number | null = null;
  private headwayArmed = true;
  private headwayRearmSince: number | null = null;

  private stoppedSince: number | null = null;
  private departBaseW: number | null = null;
  private departFired = false;
  private departUntil = 0;

  reset(): void {
    this.dropTrack();
    this.fcwActive = false;
    this.fcwBelowCount = 0;
    this.headwayActive = false;
    this.headwayBelowSince = null;
    this.headwayArmed = true;
    this.headwayRearmSince = null;
    this.stoppedSince = null;
    this.departBaseW = null;
    this.departFired = false;
    this.departUntil = 0;
  }

  private dropTrack(): void {
    this.hist = [];
    this.hits = 0;
    // Kalkış tabanı İZE aittir: iz koparsa başka (daha uzak) bir araç yanlış kalkış üretemez.
    if (!this.departFired) this.departBaseW = null;
  }

  /** Algılama ego-şerit ve gerçekçi araç ölçüsü kapılarından geçer mi. */
  private plausible(d: AdasVehicleDetection, cam: AdasCameraModel, metric: boolean): { z: number | null; uc: number } | null {
    if (!(d.confidence >= TRACK_CFG.MIN_CONF)) return null;
    const w = d.u1 - d.u0;
    if (!(w > 0)) return null;
    const uc = (d.u0 + d.u1) / 2;
    const z = groundDistanceFromRow(d.vBottom, cam);
    if (z === null) return null;
    const lat = lateralFromColumn(uc, z, cam);
    if (Math.abs(lat) > TRACK_CFG.MAX_LATERAL_M) return null;
    const wm = widthMetersAt(w, z, cam);
    const [lo, hi] = metric ? TRACK_CFG.WIDTH_METRIC_M : TRACK_CFG.WIDTH_DEFAULT_M;
    if (wm < lo || wm > hi) return null;
    return { z, uc };
  }

  private associate(uc: number, w: number): boolean {
    const last = this.hist[this.hist.length - 1];
    if (!last) return false;
    const ratio = w > last.w ? w / last.w : last.w / w;
    return Math.abs(uc - last.uc) <= TRACK_CFG.ASSOC_DU && ratio <= TRACK_CFG.ASSOC_WIDTH_RATIO;
  }

  update(input: CollisionModelInput): CollisionModelOutput {
    const { detection, nowMs: now, cam, metric, sensitivity } = input;

    // ── 1. İz güncelle ─────────────────────────────────────────────────────
    const p = detection ? this.plausible(detection, cam, metric) : null;
    if (detection && p) {
      const w = detection.u1 - detection.u0;
      if (!this.associate(p.uc, w)) this.dropTrack();
      this.hist.push({ t: now, lnW: Math.log(w), w, z: p.z, uc: p.uc });
      this.hits += 1;
      this.lastHitTs = now;
    } else if (now - this.lastHitTs > TRACK_CFG.COAST_MS) {
      this.dropTrack();
    }
    while (this.hist.length > 0 && now - this.hist[0].t > TRACK_CFG.WINDOW_MS) this.hist.shift();

    const confirmed = this.hits >= FCW_CFG.MIN_CONFIRM_HITS && this.hist.length > 0;
    const speed = input.speedKmh;
    const egoMps = speed !== null ? speed / 3.6 : null;

    // ── 2. Kestirimler ─────────────────────────────────────────────────────
    let lead: AdasLeadState | null = null;
    let ttc: number | null = null;
    let closing: number | null = null;
    let rangeRate: number | null = null;
    let zNow: number | null = null;
    if (confirmed) {
      const scale = linFit(this.hist.map((s) => ({ t: s.t, y: s.lnW })), now);
      const zPts = this.hist.filter((s) => s.z !== null).map((s) => ({ t: s.t, y: s.z as number }));
      const zFit = linFit(zPts, now);
      zNow = zFit ? zFit.value : this.hist[this.hist.length - 1].z;
      rangeRate = zFit ? zFit.slopePerSec : null;
      if (scale && scale.slopePerSec > 1e-3) {
        const ttcCam = 1 / scale.slopePerSec;
        // Kamera düzlemine değil TAMPONA kalan süre: (Z − tampon) / Z oranı.
        const frac = zNow !== null && zNow > cam.bumperOffsetM ? (zNow - cam.bumperOffsetM) / zNow : 1;
        ttc = ttcCam * frac;
      }
      if (metric && rangeRate !== null) closing = -rangeRate;
      const distance = metric && zNow !== null ? Math.max(0, zNow - cam.bumperOffsetM) : null;
      const gap = distance !== null && egoMps !== null && egoMps > 1 ? distance / egoMps : null;
      lead = {
        distanceM: distance,
        ttcS: ttc,
        closingMps: closing,
        timeGapS: gap,
        confirmed: true,
        confidence: Math.min(1, detection?.confidence ?? 0.5),
      };
    }

    // ── 3. FCW ─────────────────────────────────────────────────────────────
    const ttcWarn = FCW_CFG.TTC_WARN_S[sensitivity];
    const egoOk = speed !== null && speed >= FCW_CFG.MIN_EGO_KMH;
    const rangeConsistent = rangeRate === null || rangeRate <= FCW_CFG.MIN_RANGE_RATE_MPS;
    const physicsOk = closing === null || egoMps === null || closing <= egoMps + FCW_CFG.MAX_CLOSING_OVER_EGO_MPS;
    const below = egoOk && confirmed && ttc !== null && ttc <= ttcWarn && rangeConsistent && physicsOk;
    this.fcwBelowCount = below ? this.fcwBelowCount + 1 : 0;
    if (!this.fcwActive && this.fcwBelowCount >= FCW_CFG.MIN_CONSEC_BELOW) {
      this.fcwActive = true;
      this.fcwSince = now;
    } else if (this.fcwActive) {
      const held = now - this.fcwSince;
      const clear = speed === null || !confirmed || ttc === null || ttc > ttcWarn + FCW_CFG.TTC_CLEAR_MARGIN_S;
      // Ego hız bayatladıysa tutma beklenmez — fail-closed.
      if (speed === null || (held >= FCW_CFG.HOLD_MIN_MS && clear)) this.fcwActive = false;
    }

    // ── 4. Takip mesafesi (yalnız metrik kalibrasyon) ─────────────────────
    const gapWarn = HEADWAY_CFG.GAP_WARN_S[sensitivity];
    const gapS = lead?.timeGapS ?? null;
    const hwEligible = metric && speed !== null && speed >= HEADWAY_CFG.MIN_EGO_KMH && gapS !== null;
    if (hwEligible && gapS !== null && gapS < gapWarn) {
      if (this.headwayBelowSince === null) this.headwayBelowSince = now;
    } else {
      this.headwayBelowSince = null;
    }
    if (this.headwayActive) {
      if (!hwEligible || gapS === null || gapS > gapWarn + HEADWAY_CFG.CLEAR_MARGIN_S) {
        this.headwayActive = false;
        this.headwayArmed = false;
        this.headwayRearmSince = null;
      }
    } else if (this.headwayArmed && this.headwayBelowSince !== null
      && now - this.headwayBelowSince >= HEADWAY_CFG.SUSTAIN_MS) {
      this.headwayActive = true;
    }
    if (!this.headwayArmed) {
      const rearmOk = gapS === null || gapS > gapWarn + HEADWAY_CFG.REARM_MARGIN_S;
      if (rearmOk) {
        if (this.headwayRearmSince === null) this.headwayRearmSince = now;
        if (now - this.headwayRearmSince >= HEADWAY_CFG.REARM_MS) this.headwayArmed = true;
      } else {
        this.headwayRearmSince = null;
      }
    }

    // ── 5. Öndeki aracın kalkışı (ölçek tabanlı — kalibrasyondan bağımsız) ──
    const stopped = speed !== null && speed < LEAD_DEPART_CFG.STOPPED_KMH;
    if (speed === null || speed >= LEAD_DEPART_CFG.MOVING_KMH) {
      this.stoppedSince = null;
      this.departBaseW = null;
      this.departFired = false;
    } else if (stopped && this.stoppedSince === null) {
      this.stoppedSince = now;
    }
    const stoppedLong = stopped && this.stoppedSince !== null
      && now - this.stoppedSince >= LEAD_DEPART_CFG.MIN_STOPPED_MS;
    if (stoppedLong && confirmed && !this.departFired) {
      const wNow = this.hist[this.hist.length - 1].w;
      const near = zNow !== null && zNow - cam.bumperOffsetM <= LEAD_DEPART_CFG.MAX_BASE_RANGE_M;
      if (this.departBaseW === null) {
        if (near) this.departBaseW = wNow;
      } else if (wNow <= this.departBaseW * LEAD_DEPART_CFG.SHRINK_RATIO) {
        this.departFired = true;
        this.departUntil = now + LEAD_DEPART_CFG.HOLD_MS;
      }
    }
    // Kalkış bildirimi yalnız ego HÂLÂ duruyorken anlamlıdır.
    const leadDeparture = this.departFired && now < this.departUntil && stopped;

    return {
      lead,
      forwardCollision: this.fcwActive,
      headway: this.headwayActive,
      leadDeparture,
    };
  }
}
