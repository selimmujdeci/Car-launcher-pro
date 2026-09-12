/**
 * speedLimitAdapter — GUARDIAN-AI-G11 (Adapter Contracts, Phase 1).
 *
 * Raw platform (hız-limiti segmenti + hız) verisini `SpeedLimitRiskInput`e
 * dönüştürür. GERÇEK IO YOK — raw DI ile gelir. FAIL-SOFT: zorunlu okuma
 * eksik/bozuk → `undefined`. Girdi MUTASYONA UĞRATILMAZ; Date.now/random/global
 * YOK. `policy` present olmalı; derin geçerlilik ilgili kuralın işi.
 */
import type { SpeedLimitRiskInput, SpeedLimitPolicyInput } from '../rules';

function isObject<T>(v: T): v is T & Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export interface RawSpeedLimitData {
  id?:                   string;
  distanceMeters?:       number;
  postedSpeedLimitKph?:  number;
  source?:               string;
  confidence?:           number;
  currentSpeedKph?:      number;
  policy?:               SpeedLimitPolicyInput;
}

export function adaptSpeedLimitInput(raw: RawSpeedLimitData | undefined): SpeedLimitRiskInput | undefined {
  if (!isObject(raw)) return undefined;

  if (!isNonEmptyString(raw.id)) return undefined;
  if (!isFiniteNumber(raw.distanceMeters) || raw.distanceMeters < 0) return undefined;
  if (!isFiniteNumber(raw.currentSpeedKph) || raw.currentSpeedKph < 0) return undefined;
  if (!isFiniteNumber(raw.confidence)) return undefined;
  if (!isObject(raw.policy)) return undefined;

  return {
    segment: {
      id:                  raw.id,
      distanceMeters:      raw.distanceMeters,
      postedSpeedLimitKph: isFiniteNumber(raw.postedSpeedLimitKph) ? raw.postedSpeedLimitKph : undefined,
      source:              isNonEmptyString(raw.source) ? raw.source : undefined,
      confidence:          raw.confidence,
    },
    vehicle: { currentSpeedKph: raw.currentSpeedKph },
    policy: raw.policy,
  };
}
