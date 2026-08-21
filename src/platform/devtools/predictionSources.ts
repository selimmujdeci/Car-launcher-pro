/**
 * predictionSources.ts — CAROS LAB · Öngörü Motoru TEK okuma katmanı.
 *
 * Desen (A3–A8 turlarıyla aynı): senkron getter, kendi try/catch'i içinde.
 * HİÇBİR şey başlatmaz/durdurmaz: koşucuyu başlatmaz, tik tetiklemez, örnek
 * eklemez, tampon temizlemez, kural/eşik değiştirmez.
 *
 * GİZLİLİK: bu katmanda kişisel veri YOKTUR — yalnız sensör skalerleri
 * (sıcaklık/voltaj), sayaçlar ve süre. Konum, VIN, sürücü GELMEZ.
 */

import {
  getPredictionSnapshot, type PredictionRuntimeSnapshot,
} from '../obd/predictionRuntime';
import {
  DEFAULT_PREDICTION_RULES, MIN_TREND_SAMPLES, MIN_FIT_QUALITY,
} from '../obd/predictionEngine';

export interface PredictionRawSnapshot {
  readonly readAt: number;
  /** `null` = okuma HATA VERDİ ("çalışmıyor" ile KARIŞTIRILMAZ). */
  readonly runtime: PredictionRuntimeSnapshot | null;
  /** Kural künyeleri — eşiklerin kaynağıyla birlikte gösterimi. */
  readonly rules: ReadonlyArray<{
    readonly kind: string;
    readonly severity: string;
    readonly threshold: number;
    readonly horizonMin: number;
    readonly direction: string;
    readonly unit: string;
    readonly title: string;
  }>;
  readonly minSamples: number;
  readonly minFitQuality: number;
}

/**
 * Tek okuma turu — ASLA fırlatmaz.
 * @param nowMs Çağıranın bastığı damga; bu katman `Date.now()` ÇAĞIRMAZ.
 */
export function readPredictionSnapshot(nowMs: number): PredictionRawSnapshot {
  let runtime: PredictionRuntimeSnapshot | null = null;
  try { runtime = getPredictionSnapshot(); } catch { runtime = null; }

  const rules = Object.values(DEFAULT_PREDICTION_RULES).map((r) => ({
    kind: r.kind,
    severity: r.severity,
    threshold: r.threshold,
    horizonMin: r.horizonMin,
    direction: r.direction,
    unit: r.unit,
    title: r.title,
  }));

  return {
    readAt: nowMs,
    runtime,
    rules,
    minSamples: MIN_TREND_SAMPLES,
    minFitQuality: MIN_FIT_QUALITY,
  };
}
