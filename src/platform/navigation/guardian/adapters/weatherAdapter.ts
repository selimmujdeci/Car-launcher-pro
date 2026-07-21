/**
 * weatherAdapter — GUARDIAN-AI-G11 (Adapter Contracts, Phase 1).
 *
 * Raw platform (yüzey/hava koşulu) verisini `WeatherRiskInput`e dönüştürür.
 * GERÇEK IO YOK — raw DI ile gelir (hava servisi/harita PARSER'ı burada DEĞİL).
 * FAIL-SOFT: zorunlu okuma (`confidence`) veya `policy` eksik/bozuk → `undefined`;
 * geçersiz `surfaceCondition` → alan DROP edilir (kural fail-closed → event yok).
 * Girdi MUTASYONA UĞRATILMAZ; Date.now/random/global YOK.
 */
import type { WeatherRiskInput, WeatherRiskPolicyInput, WeatherSurfaceCondition } from '../rules';

const WEATHER_SURFACES: ReadonlySet<string> = new Set(['dry', 'wet', 'snow', 'ice', 'unknown']);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export interface RawWeatherData {
  surfaceCondition?:  WeatherSurfaceCondition;
  visibilityMeters?:  number;
  source?:            string;
  confidence?:        number;
  policy?:            WeatherRiskPolicyInput;
}

export function adaptWeatherInput(raw: RawWeatherData | undefined): WeatherRiskInput | undefined {
  if (!isObject(raw)) return undefined;

  if (!isFiniteNumber(raw.confidence)) return undefined;
  if (!isObject(raw.policy)) return undefined;

  return {
    condition: {
      surfaceCondition: (typeof raw.surfaceCondition === 'string' && WEATHER_SURFACES.has(raw.surfaceCondition)) ? raw.surfaceCondition : undefined,
      visibilityMeters: isFiniteNumber(raw.visibilityMeters) ? raw.visibilityMeters : undefined,
      source:           isNonEmptyString(raw.source) ? raw.source : undefined,
      confidence:       raw.confidence,
    },
    policy: raw.policy,
  };
}
