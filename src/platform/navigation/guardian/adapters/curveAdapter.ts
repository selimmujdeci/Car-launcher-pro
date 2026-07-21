/**
 * curveAdapter — GUARDIAN-AI-G11 (Adapter Contracts, Phase 1).
 *
 * Raw platform (rota geometrisi + hız) verisini `CurveRiskInput`e dönüştürür.
 * GERÇEK IO YOK — bu fazda raw veri DI ile gelir (routing/GPS PARSER'ı burada
 * DEĞİL). FAIL-SOFT: zorunlu okuma alanı eksik/bozuk → `undefined` (throw DEĞİL);
 * registry o kuralı atlar, Guardian çalışmaya devam eder. Girdi MUTASYONA
 * UĞRATILMAZ; `Date.now`/`Math.random`/global durum YOK.
 *
 * Not: `policy` (DI konfigürasyonu) present olmalı; derin geçerliliği ilgili
 * kuralın (evaluateCurveRisk) sorumluluğudur — adapter yalnız nesne varlığını
 * güvenceler ve aynen geçirir.
 */
import type { CurveRiskInput, CurveRiskPolicyInput, CurveDirection, RoadSurfaceCondition } from '../rules';

const CURVE_DIRECTIONS: ReadonlySet<string> = new Set(['left', 'right', 'unknown']);
const ROAD_SURFACES: ReadonlySet<string> = new Set(['dry', 'wet', 'snow', 'ice', 'unknown']);

function isObject<T>(v: T): v is T & Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Raw viraj/hız okuması — platformdan gelen (güvenilmez) ham veri; tüm alanlar
 *  opsiyonel. `policy` DI konfigürasyonudur. */
export interface RawCurveData {
  id?:                   string;
  distanceMeters?:       number;
  direction?:            CurveDirection;
  advisorySpeedKph?:     number;
  advisorySpeedSource?:  string;
  radiusMeters?:         number;
  confidence?:           number;
  currentSpeedKph?:      number;
  surfaceCondition?:     RoadSurfaceCondition;
  policy?:               CurveRiskPolicyInput;
}

export function adaptCurveInput(raw: RawCurveData | undefined): CurveRiskInput | undefined {
  if (!isObject(raw)) return undefined;

  // Zorunlu okuma alanları — biri bile bozuk/eksikse fail-soft undefined.
  if (!isNonEmptyString(raw.id)) return undefined;
  if (!isFiniteNumber(raw.distanceMeters) || raw.distanceMeters < 0) return undefined;
  if (!isFiniteNumber(raw.currentSpeedKph) || raw.currentSpeedKph < 0) return undefined;
  if (!isFiniteNumber(raw.confidence)) return undefined;
  if (!isObject(raw.policy)) return undefined;

  const result: CurveRiskInput = {
    curve: {
      id:                  raw.id,
      distanceMeters:      raw.distanceMeters,
      direction:           (typeof raw.direction === 'string' && CURVE_DIRECTIONS.has(raw.direction)) ? raw.direction : 'unknown',
      advisorySpeedKph:    isFiniteNumber(raw.advisorySpeedKph) ? raw.advisorySpeedKph : undefined,
      advisorySpeedSource: isNonEmptyString(raw.advisorySpeedSource) ? raw.advisorySpeedSource : undefined,
      radiusMeters:        isFiniteNumber(raw.radiusMeters) ? raw.radiusMeters : undefined,
      confidence:          raw.confidence,
    },
    vehicle: { currentSpeedKph: raw.currentSpeedKph },
    policy: raw.policy,
  };

  if (typeof raw.surfaceCondition === 'string' && ROAD_SURFACES.has(raw.surfaceCondition)) {
    result.road = { surfaceCondition: raw.surfaceCondition };
  }

  return result;
}
