/**
 * roadProfileAdapter — GUARDIAN-AI-G11 (Adapter Contracts, Phase 1).
 *
 * Raw platform (yol-profili/eğim segmenti + hız) verisini `RoadProfileRiskInput`e
 * dönüştürür. GERÇEK IO YOK — raw DI ile gelir. FAIL-SOFT: zorunlu okuma
 * eksik/bozuk → `undefined`. Girdi MUTASYONA UĞRATILMAZ; Date.now/random/global
 * YOK. `policy` VE `gradeThresholds` (ikisi de DI konfigürasyonu) present olmalı;
 * derin geçerlilik ilgili kuralın işi.
 */
import type { RoadProfileRiskInput, RoadProfilePolicyInput, RoadProfileGradeThresholds } from '../rules';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export interface RawRoadProfileData {
  id?:                    string;
  distanceMeters?:        number;
  downhillGradePercent?:  number;
  source?:                string;
  confidence?:            number;
  currentSpeedKph?:       number;
  policy?:                RoadProfilePolicyInput;
  gradeThresholds?:       RoadProfileGradeThresholds;
}

export function adaptRoadProfileInput(raw: RawRoadProfileData | undefined): RoadProfileRiskInput | undefined {
  if (!isObject(raw)) return undefined;

  if (!isNonEmptyString(raw.id)) return undefined;
  if (!isFiniteNumber(raw.distanceMeters) || raw.distanceMeters < 0) return undefined;
  if (!isFiniteNumber(raw.currentSpeedKph) || raw.currentSpeedKph < 0) return undefined;
  if (!isFiniteNumber(raw.confidence)) return undefined;
  if (!isObject(raw.policy)) return undefined;
  if (!isObject(raw.gradeThresholds)) return undefined;

  return {
    segment: {
      id:                   raw.id,
      distanceMeters:       raw.distanceMeters,
      downhillGradePercent: isFiniteNumber(raw.downhillGradePercent) ? raw.downhillGradePercent : undefined,
      source:               isNonEmptyString(raw.source) ? raw.source : undefined,
      confidence:           raw.confidence,
    },
    vehicle: { currentSpeedKph: raw.currentSpeedKph },
    policy: raw.policy,
    gradeThresholds: raw.gradeThresholds,
  };
}
