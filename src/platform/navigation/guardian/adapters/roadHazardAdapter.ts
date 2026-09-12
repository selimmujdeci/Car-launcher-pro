/**
 * roadHazardAdapter — GUARDIAN-AI-G11 (Adapter Contracts, Phase 1).
 *
 * Raw platform (yol tehlikesi bildirimi) verisini `RoadHazardRiskInput`e
 * dönüştürür. GERÇEK IO YOK — raw DI ile gelir (topluluk/harita servisi burada
 * DEĞİL). FAIL-SOFT: zorunlu okuma (id/distanceMeters/confidence) veya `policy`
 * eksik/bozuk → `undefined`; geçersiz `hazardType` → alan DROP (kural event
 * üretmez). Girdi MUTASYONA UĞRATILMAZ; Date.now/random/global YOK.
 */
import type { RoadHazardRiskInput, RoadHazardRiskPolicyInput, RoadHazardType } from '../rules';

const HAZARD_TYPES: ReadonlySet<string> = new Set([
  'accident', 'roadwork', 'obstacle', 'lane_closed', 'animal', 'flood', 'rockfall', 'unknown',
]);

function isObject<T>(v: T): v is T & Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export interface RawRoadHazardData {
  id?:              string;
  hazardType?:      RoadHazardType;
  distanceMeters?:  number;
  confidence?:      number;
  source?:          string;
  policy?:          RoadHazardRiskPolicyInput;
}

export function adaptRoadHazardInput(raw: RawRoadHazardData | undefined): RoadHazardRiskInput | undefined {
  if (!isObject(raw)) return undefined;

  if (!isNonEmptyString(raw.id)) return undefined;
  if (!isFiniteNumber(raw.distanceMeters) || raw.distanceMeters < 0) return undefined;
  if (!isFiniteNumber(raw.confidence)) return undefined;
  if (!isObject(raw.policy)) return undefined;

  return {
    hazard: {
      id:             raw.id,
      hazardType:     (typeof raw.hazardType === 'string' && HAZARD_TYPES.has(raw.hazardType)) ? raw.hazardType : undefined,
      distanceMeters: raw.distanceMeters,
      confidence:     raw.confidence,
      source:         isNonEmptyString(raw.source) ? raw.source : undefined,
    },
    policy: raw.policy,
  };
}
