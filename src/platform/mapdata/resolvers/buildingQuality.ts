/** Bina kaynağının ölçülebilir provenance/verification sınıfı. */
import type { MapSourceObservation } from '../mapDataObservation';

export type BuildingSourceQualityClass =
  | 'OSM_DERIVED'
  | 'ML_DERIVED_VERIFIED'
  | 'ML_DERIVED_UNVERIFIED'
  | 'UNKNOWN';

const ML_DATASET = /\b(ml|machine\s*learning|open\s*buildings)\b/i;
const OSM_DATASET = /openstreetmap/i;

export function classifyBuildingSourceQuality(
  observation: MapSourceObservation | null | undefined,
): BuildingSourceQualityClass {
  if (!observation || observation.kind !== 'BUILDING') return 'UNKNOWN';
  const datasets = observation.provenance.upstreamDatasets ?? [];
  const ml = datasets.length > 0 && datasets.every((d) => ML_DATASET.test(d));
  if (ml) return observation.quality.sourceVerified === true
    ? 'ML_DERIVED_VERIFIED' : 'ML_DERIVED_UNVERIFIED';
  if (observation.provenance.sourceId === 'OSM' || datasets.some((d) => OSM_DATASET.test(d))) {
    return 'OSM_DERIVED';
  }
  return 'UNKNOWN';
}

export function isCanonicalBuildingGeometryEligible(
  observation: MapSourceObservation | null | undefined,
): boolean {
  const quality = classifyBuildingSourceQuality(observation);
  return quality === 'OSM_DERIVED' || quality === 'ML_DERIVED_VERIFIED';
}
