/** ML footprint'lerini bina gerçeği üretmeden eksik-veri adayı olarak karşılaştırır. */
import type { EvidenceGrade } from '../../navigation/contracts/navEvidence';
import type { MapGeometry, MapSourceObservation } from '../mapDataObservation';
import type { MapDataSourceId, MapDatasetRelease } from '../mapDataSource';
import type { FootprintOverlap } from './buildingGeometry';
import { measureOverlap } from './buildingGeometry';
import { classifyBuildingSourceQuality } from './buildingQuality';

export type PotentialBuildingGapReason =
  | 'NO_CANONICAL_BUILDING_NEARBY'
  | 'INSUFFICIENT_CANONICAL_OVERLAP';

export interface PotentialBuildingGap {
  readonly approximateGeometry: MapGeometry;
  readonly source: MapDataSourceId;
  readonly sourceFeatureId: string;
  readonly sourceQuality: 'ML_DERIVED_UNVERIFIED';
  readonly confidence: number | null;
  readonly evidenceGrade: EvidenceGrade;
  readonly distanceToCanonicalBuildingM: number | null;
  readonly overlap: FootprintOverlap | null;
  readonly observedDatasetRelease: MapDatasetRelease;
  readonly reason: PotentialBuildingGapReason;
}

export interface BuildingGapPolicy {
  readonly maxCanonicalDistanceM: number;
  readonly minAreaRatio: number;
  readonly requireContainment: boolean;
}

export const DEFAULT_BUILDING_GAP_POLICY: BuildingGapPolicy = {
  maxCanonicalDistanceM: 12,
  minAreaRatio: 0.25,
  requireContainment: true,
};

/** Filo kanıtı yalnız adayı doğrular/reddeder; canonical geometri üretmez. */
export interface BuildingGapVerificationEvidence {
  readonly gapSourceFeatureId: string;
  readonly kind: 'REPEATED_LOCALIZATION_MAP_EVIDENCE' | 'PERMITTED_VISION_EVIDENCE';
  readonly grade: EvidenceGrade;
  readonly observationCount: number;
  readonly observedAtEpochMs: number | null;
  readonly supportsPresence: boolean | null;
}

export function detectPotentialBuildingGaps(
  mlObservations: readonly MapSourceObservation[],
  canonicalBuildingObservations: readonly MapSourceObservation[],
  policy: BuildingGapPolicy = DEFAULT_BUILDING_GAP_POLICY,
): readonly PotentialBuildingGap[] {
  const canonical = canonicalBuildingObservations.filter((o) => o.kind === 'BUILDING' && o.geometry !== null);
  const gaps: PotentialBuildingGap[] = [];
  for (const ml of mlObservations) {
    if (classifyBuildingSourceQuality(ml) !== 'ML_DERIVED_UNVERIFIED' || ml.geometry === null) continue;
    let nearest: FootprintOverlap | null = null;
    for (const known of canonical) {
      const overlap = measureOverlap(ml.geometry, known.geometry);
      if (overlap.centroidDistanceM === null) continue;
      if (nearest === null || nearest.centroidDistanceM === null
        || overlap.centroidDistanceM < nearest.centroidDistanceM) nearest = overlap;
    }
    const distance = nearest?.centroidDistanceM ?? null;
    const nearby = distance !== null && distance <= policy.maxCanonicalDistanceM;
    const overlapsEnough = nearby
      && (nearest?.areaRatio ?? 0) >= policy.minAreaRatio
      && (!policy.requireContainment || (nearest?.mutualContainment ?? 0) > 0);
    if (overlapsEnough) continue;
    gaps.push({
      approximateGeometry: ml.geometry,
      source: ml.provenance.sourceId,
      sourceFeatureId: ml.provenance.sourceFeatureId,
      sourceQuality: 'ML_DERIVED_UNVERIFIED',
      confidence: null,
      evidenceGrade: ml.grade,
      distanceToCanonicalBuildingM: distance,
      overlap: nearest,
      observedDatasetRelease: ml.provenance.release,
      reason: nearby ? 'INSUFFICIENT_CANONICAL_OVERLAP' : 'NO_CANONICAL_BUILDING_NEARBY',
    });
  }
  return gaps.sort((a, b) => a.sourceFeatureId.localeCompare(b.sourceFeatureId, 'en'));
}
