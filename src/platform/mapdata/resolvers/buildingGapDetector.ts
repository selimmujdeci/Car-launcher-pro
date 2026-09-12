/** ML footprint'lerini bina gerçeği üretmeden eksik-veri adayı olarak karşılaştırır. */
import type { EvidenceGrade } from '../../navigation/contracts/navEvidence';
import type { MapGeometry, MapSourceObservation } from '../mapDataObservation';
import type { MapDataFreshness } from '../mapDataObservation';
import type { MapDataSourceId, MapDatasetRelease } from '../mapDataSource';
import type { LicenseGateVerdict } from '../mapDataLicense';
import { effectiveLicensePolicy, evaluateLicenseGate } from '../mapDataLicense';
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
  readonly sourceFreshness: MapDataFreshness;
  readonly recordLicenses: readonly string[];
  readonly reason: PotentialBuildingGapReason;
}

export interface BuildingGapCountRow<T extends string> {
  readonly value: T;
  readonly count: number;
}

export interface BuildingGapObservatorySnapshot {
  readonly availability: 'OBSERVED' | 'UNAVAILABLE';
  readonly total: number | null;
  readonly sources: readonly BuildingGapCountRow<MapDataSourceId>[];
  readonly sourceFamilies: readonly BuildingGapCountRow<'ML_DERIVED_UNVERIFIED'>[];
  readonly reasons: readonly BuildingGapCountRow<PotentialBuildingGapReason>[];
  readonly evidenceGrades: readonly BuildingGapCountRow<EvidenceGrade>[];
  readonly releases: readonly BuildingGapCountRow<string>[];
  readonly freshness: readonly BuildingGapCountRow<MapDataFreshness['classification']>[];
  readonly confidenceKnown: number | null;
  readonly medianConfidence: number | null;
  readonly distanceMeasured: number | null;
  readonly medianDistanceM: number | null;
  readonly overlapMeasured: number | null;
  readonly withContainment: number | null;
  readonly medianAreaRatio: number | null;
  readonly licenseEligibility: readonly BuildingGapCountRow<LicenseGateVerdict>[];
  /** Gap evidence hiçbir koşulda publishable building değildir. */
  readonly publishable: false;
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
      sourceFreshness: ml.freshness,
      recordLicenses: ml.provenance.recordLicenses,
      reason: nearby ? 'INSUFFICIENT_CANONICAL_OVERLAP' : 'NO_CANONICAL_BUILDING_NEARBY',
    });
  }
  return gaps.sort((a, b) => a.sourceFeatureId.localeCompare(b.sourceFeatureId, 'en'));
}

function counts<T extends string>(values: readonly T[]): BuildingGapCountRow<T>[] {
  const grouped = new Map<T, number>();
  for (const value of values) grouped.set(value, (grouped.get(value) ?? 0) + 1);
  return [...grouped].sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([value, count]) => ({ value, count }));
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** LAB için salt-okunur projeksiyon; hüküm/geometry üretmez ve hiçbir yere yazmaz. */
export function observePotentialBuildingGaps(
  gaps: readonly PotentialBuildingGap[] | null | undefined,
): BuildingGapObservatorySnapshot {
  if (!gaps) {
    return {
      availability: 'UNAVAILABLE', total: null, sources: [], sourceFamilies: [], reasons: [],
      evidenceGrades: [], releases: [], freshness: [], confidenceKnown: null,
      medianConfidence: null,
      distanceMeasured: null, medianDistanceM: null, overlapMeasured: null,
      withContainment: null, medianAreaRatio: null,
      licenseEligibility: [], publishable: false,
    };
  }
  const distances = gaps.map((g) => g.distanceToCanonicalBuildingM)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const confidences = gaps.map((g) => g.confidence)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const overlaps = gaps.map((g) => g.overlap).filter((v): v is FootprintOverlap => v !== null);
  const areaRatios = overlaps.map((o) => o.areaRatio)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const licenseVerdicts = gaps.map((g) => evaluateLicenseGate(
    effectiveLicensePolicy(g.source, g.recordLicenses), 'OFFLINE_PACKAGING',
  ).verdict);
  return {
    availability: 'OBSERVED', total: gaps.length,
    sources: counts(gaps.map((g) => g.source)),
    sourceFamilies: counts(gaps.map((g) => g.sourceQuality)),
    reasons: counts(gaps.map((g) => g.reason)),
    evidenceGrades: counts(gaps.map((g) => g.evidenceGrade)),
    releases: counts(gaps.map((g) => g.observedDatasetRelease.releaseId)),
    freshness: counts(gaps.map((g) => g.sourceFreshness.classification)),
    confidenceKnown: confidences.length, medianConfidence: median(confidences),
    distanceMeasured: distances.length, medianDistanceM: median(distances),
    overlapMeasured: overlaps.length,
    withContainment: overlaps.filter((o) => o.mutualContainment > 0).length,
    medianAreaRatio: median(areaRatios),
    licenseEligibility: counts(licenseVerdicts), publishable: false,
  };
}
