/**
 * driverFatigueAdapter — GUARDIAN-AI-G11 (Adapter Contracts, Phase 1).
 *
 * Raw platform (sürücü yorgunluğu/dikkat sinyalleri) verisini
 * `DriverFatigueRiskInput`e dönüştürür. GERÇEK IO YOK — raw DI ile gelir
 * (kamera/göz-takibi/sensör OKUMA burada DEĞİL). FAIL-SOFT: `policy` eksik/bozuk
 * → `undefined`; bozuk sinyal → o alan DROP. Kuralın THROW etmemesi için okuma
 * alanları burada TEMİZLENİR: süreler finite&>=0, localHour tam-sayı 0..23,
 * confidence finite&0..1 değilse o alan bırakılır. Girdi MUTASYONA UĞRATILMAZ;
 * Date.now/random/global YOK.
 */
import type { DriverFatigueRiskInput, DriverFatigueSignalsInput, DriverFatiguePolicyInput } from '../rules';

function isObject<T>(v: T): v is T & Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isNonNegativeFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}
function isValidHour(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23;
}
function isUnitInterval(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

export interface RawDriverFatigueData {
  continuousDrivingMinutes?:        number;
  minutesSinceLastMeaningfulBreak?: number;
  tripDurationMinutes?:             number;
  localHour?:                       number;
  lowAttentionSignal?:              boolean;
  repeatedLaneCorrectionSignal?:    boolean;
  microsleepSuspectedSignal?:       boolean;
  confidence?:                      number;
  policy?:                          DriverFatiguePolicyInput;
}

export function adaptDriverFatigueInput(raw: RawDriverFatigueData | undefined): DriverFatigueRiskInput | undefined {
  if (!isObject(raw)) return undefined;
  if (!isObject(raw.policy)) return undefined;

  // Yalnız kuralın THROW etmeyeceği GEÇERLİ sinyaller taşınır (fail-soft).
  const signals: DriverFatigueSignalsInput = {};
  if (isNonNegativeFinite(raw.continuousDrivingMinutes))        signals.continuousDrivingMinutes = raw.continuousDrivingMinutes;
  if (isNonNegativeFinite(raw.minutesSinceLastMeaningfulBreak)) signals.minutesSinceLastMeaningfulBreak = raw.minutesSinceLastMeaningfulBreak;
  if (isNonNegativeFinite(raw.tripDurationMinutes))             signals.tripDurationMinutes = raw.tripDurationMinutes;
  if (isValidHour(raw.localHour))                               signals.localHour = raw.localHour;
  if (typeof raw.lowAttentionSignal === 'boolean')             signals.lowAttentionSignal = raw.lowAttentionSignal;
  if (typeof raw.repeatedLaneCorrectionSignal === 'boolean')   signals.repeatedLaneCorrectionSignal = raw.repeatedLaneCorrectionSignal;
  if (typeof raw.microsleepSuspectedSignal === 'boolean')      signals.microsleepSuspectedSignal = raw.microsleepSuspectedSignal;
  if (isUnitInterval(raw.confidence))                          signals.confidence = raw.confidence;

  return { signals, policy: raw.policy };
}
