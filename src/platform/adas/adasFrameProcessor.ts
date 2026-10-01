/**
 * adasFrameProcessor.ts — Tek kare → ADAS değerlendirmesi. IO YOK, saat dışarıdan.
 *
 * Görü karesi (worker çıktısı, 320×180 piksel uzayı) normalize edilir; şerit modeli,
 * öncü araç modeli ve otomatik ufuk tahmincisi aynı karede, AYNI kalibrasyonla çalışır.
 * Kullanıcı özellik anahtarları burada DEĞİL, yayımlama anında (adasRuntime) uygulanır:
 * modeller kapalı özellik için de izlemeyi sürdürür → açıldığı an ısınmış olarak çalışır.
 */

import type { VisionFrame } from '../visionStore';
import { buildCameraModel } from './adasGeometry';
import { HorizonEstimator, isMetricCalibration, HORIZON_CFG } from './adasCalibration';
import { LaneDepartureModel } from './adasLaneModel';
import { LeadVehicleModel } from './adasCollisionModel';
import type {
  AdasCalibration, AdasLaneLine, AdasLaneState, AdasLeadState, AdasSensitivity, AdasTurnSignal,
} from './adasTypes';

/** Düşük ışık bu süre sürerse durum "kısıtlı" olur (tünel girişinde titreme yok). */
export const LOW_LIGHT_HOLD_MS = 2000;

export interface FrameContext {
  /** Karenin yakalanma anı (performance.now). */
  now: number;
  /** Taze ego hız (km/sa) ya da null. */
  speedKmh: number | null;
  turnSignal: AdasTurnSignal;
  calibration: AdasCalibration;
  sensitivity: AdasSensitivity;
  /** Worker işleme çözünürlüğü. */
  procW: number;
  procH: number;
}

export interface FrameResult {
  forwardCollision: boolean;
  headway: boolean;
  laneDeparture: 'left' | 'right' | null;
  leadDeparture: boolean;
  lead: AdasLeadState | null;
  lane: AdasLaneState;
  /** Düşük ışık ≥ LOW_LIGHT_HOLD_MS sürdü. */
  lowLight: boolean;
  /** Ufuk yakınsadıysa önerilen kalibrasyon güncellemesi (yalnız varsayılan kalibrasyonda). */
  horizonUpdate: { horizonV: number; forwardU: number } | null;
  /** 0..1 — metrik kalibrasyonda 1. */
  calibrationProgress: number;
}

/** Worker şerit çizgisi (piksel, x1/y1 üst · x2/y2 alt) → normalize. */
export function normalizeLanes(frame: VisionFrame, procW: number, procH: number): AdasLaneLine[] {
  return frame.lanes.map((l) => ({
    side: l.side,
    uTop: l.x1 / procW,
    vTop: l.y1 / procH,
    uBottom: l.x2 / procW,
    vBottom: l.y2 / procH,
    confidence: l.confidence,
  }));
}

export class AdasFrameProcessor {
  private laneModel = new LaneDepartureModel();
  private leadModel = new LeadVehicleModel();
  private horizon = new HorizonEstimator();
  private lowLightSince: number | null = null;

  reset(): void {
    this.laneModel.reset();
    this.leadModel.reset();
    this.horizon.reset();
    this.lowLightSince = null;
  }

  /** Kalibrasyon değişti (kullanıcı sıfırladı / kamera değişti) — ufuk örnekleri geçersiz. */
  resetCalibration(): void {
    this.horizon.reset();
  }

  process(frame: VisionFrame, ctx: FrameContext): FrameResult {
    const det = frame.adas ?? null;
    const aspect = det?.aspect ?? ctx.procW / ctx.procH;
    const cam = buildCameraModel(ctx.calibration, aspect);
    const metric = isMetricCalibration(ctx.calibration);
    const lanes = normalizeLanes(frame, ctx.procW, ctx.procH);

    const laneOut = this.laneModel.update({
      lanes, nowMs: ctx.now, speedKmh: ctx.speedKmh, turnSignal: ctx.turnSignal, cam, sensitivity: ctx.sensitivity,
    });

    // Düşük ışıkta gölge yöntemi kör — izleme de yapılmaz (eski iz coast süresinde düşer).
    const lowNow = det?.lowLight === true;
    if (lowNow) { if (this.lowLightSince === null) this.lowLightSince = ctx.now; }
    else this.lowLightSince = null;
    const lowLight = this.lowLightSince !== null && ctx.now - this.lowLightSince >= LOW_LIGHT_HOLD_MS;

    const leadOut = this.leadModel.update({
      detection: lowNow ? null : det?.lead ?? null,
      nowMs: ctx.now, speedKmh: ctx.speedKmh, cam, metric, sensitivity: ctx.sensitivity,
    });

    let horizonUpdate: FrameResult['horizonUpdate'] = null;
    let progress = 1;
    if (ctx.calibration.source === 'default') {
      this.horizon.addLanes(lanes, ctx.speedKmh, ctx.now);
      const est = this.horizon.estimate();
      progress = est ? Math.min(1, est.samples / HORIZON_CFG.MIN_SAMPLES) : 0;
      if (est?.converged) {
        horizonUpdate = { horizonV: est.horizonV, forwardU: est.forwardU };
        progress = 1;
      }
    }

    return {
      forwardCollision: leadOut.forwardCollision,
      headway: leadOut.headway,
      laneDeparture: laneOut.departure,
      leadDeparture: leadOut.leadDeparture,
      lead: leadOut.lead,
      lane: laneOut.lane,
      lowLight,
      horizonUpdate,
      calibrationProgress: metric ? 1 : progress,
    };
  }
}
