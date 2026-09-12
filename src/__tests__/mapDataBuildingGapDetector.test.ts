import { describe, expect, it } from 'vitest';
import type { MapSourceObservation } from '../platform/mapdata/mapDataObservation';
import {
  classifyBuildingSourceQuality,
  detectPotentialBuildingGaps,
  fuseBuildings,
  observePotentialBuildingGaps,
} from '../platform/mapdata';

const release = {
  sourceId: 'OVERTURE' as const, releaseId: '2026-08-19.0',
  publishedAtEpochMs: null, dataCutoffEpochMs: null, retrievedFrom: 'fixture',
};

function square(id: string, dataset: string, x: number, verified: boolean | null = null): MapSourceObservation {
  return {
    kind: 'BUILDING',
    provenance: {
      sourceId: 'OVERTURE', sourceFeatureId: id, release,
      recordUpdatedAtEpochMs: null, upstreamDatasets: [dataset], recordLicenses: ['ODbL-1.0'],
    },
    geometry: { type: 'POLYGON', rings: [[[x, 36], [x + 0.0001, 36], [x + 0.0001, 36.0001], [x, 36.0001], [x, 36]]] },
    fields: {},
    quality: {
      positionalAccuracyM: null,
      vertexCount: 5,
      attributeCompleteness: 0,
      sourceVerified: verified,
      sourceConfidence: null,
    },
    freshness: { classification: 'UNKNOWN', ageMs: null, budgetMs: null },
    grade: dataset.includes('ML') ? 'DERIVED' : 'OBSERVED',
  };
}

describe('MAPDATA · ML building quality ve gap sınırı', () => {
  it('provenance sınıfları ML doğrulamasını OSM kökeninden ayırır', () => {
    expect(classifyBuildingSourceQuality(square('ml', 'Microsoft ML Buildings', 34))).toBe('ML_DERIVED_UNVERIFIED');
    expect(classifyBuildingSourceQuality(square('verified', 'Microsoft ML Buildings', 34, true))).toBe('ML_DERIVED_VERIFIED');
    expect(classifyBuildingSourceQuality(square('osm', 'OpenStreetMap', 34))).toBe('OSM_DERIVED');
  });

  it('doğrulanmamış ML geometri canonical/publishable bina üretemez', () => {
    const result = fuseBuildings([square('ml-only', 'Microsoft ML Buildings', 34)], { intent: 'OFFLINE_PACKAGING' });
    expect(result.publishable).toBe(0);
    expect(result.features[0].geometry.value).toBeNull();
    expect(result.features[0].geometry.unknownReason).toBe('BELOW_QUALITY_GATE');
  });

  it('OSM ile örtüşmeyen ML gözlemi yalnız PotentialBuildingGap üretir', () => {
    const ml = square('ml-gap', 'Microsoft ML Buildings', 34);
    const osm = square('osm-known', 'OpenStreetMap', 34.01);
    const gaps = detectPotentialBuildingGaps([ml], [osm]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      sourceFeatureId: 'ml-gap', sourceQuality: 'ML_DERIVED_UNVERIFIED',
      confidence: null, reason: 'NO_CANONICAL_BUILDING_NEARBY',
    });
    expect(gaps[0].approximateGeometry).toBe(ml.geometry);
  });

  it('canonical footprint ile yeterince örtüşen ML gözlemini gap saymaz', () => {
    const ml = square('ml-covered', 'Microsoft ML Buildings', 34);
    const osm = square('osm-known', 'OpenStreetMap', 34);
    expect(detectPotentialBuildingGaps([ml], [osm])).toEqual([]);
  });

  it('LAB projeksiyonu bağlı olmayan akış için 0 uydurmaz', () => {
    expect(observePotentialBuildingGaps(null)).toMatchObject({
      availability: 'UNAVAILABLE', total: null, publishable: false,
      sources: [], sourceFamilies: [], licenseEligibility: [],
    });
  });

  it('LAB projeksiyonu gap provenance ve kalite kanıtını salt-okunur özetler', () => {
    const gaps = detectPotentialBuildingGaps(
      [square('ml-gap', 'Microsoft ML Buildings', 34)],
      [square('osm-known', 'OpenStreetMap', 34.01)],
    );
    const observed = observePotentialBuildingGaps(gaps);
    expect(observed).toMatchObject({
      availability: 'OBSERVED', total: 1, publishable: false,
      sources: [{ value: 'OVERTURE', count: 1 }],
      sourceFamilies: [{ value: 'ML_DERIVED_UNVERIFIED', count: 1 }],
      reasons: [{ value: 'NO_CANONICAL_BUILDING_NEARBY', count: 1 }],
      evidenceGrades: [{ value: 'DERIVED', count: 1 }],
      releases: [{ value: '2026-08-19.0', count: 1 }],
      freshness: [{ value: 'UNKNOWN', count: 1 }],
      confidenceKnown: 0, medianConfidence: null, distanceMeasured: 1, overlapMeasured: 1,
      withContainment: 0, medianAreaRatio: 1,
      licenseEligibility: [{ value: 'ALLOW_WITH_ATTRIBUTION', count: 1 }],
    });
    expect(observed).not.toHaveProperty('geometry');
  });

});
