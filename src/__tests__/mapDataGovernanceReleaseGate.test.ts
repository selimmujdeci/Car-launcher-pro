/**
 * MAP DATA · development benchmark ile commercial release kapısının ayrımı.
 * CODE PASS yalnız sözleşmeyi doğrular; hukuk/izin belgesi yerine geçmez.
 */
import { describe, expect, it } from 'vitest';

import {
  MAP_DATASET_GOVERNANCE_REGISTRY,
  OSM_TURKEY_BASELINE_GOVERNANCE,
  OVERTURE_PLACES_2026_08_19_GOVERNANCE,
  buildMapDataAttributionProjection,
  evaluateCommercialReleaseGate,
  evaluateDevelopmentBenchmarkGate,
} from '../platform/mapdata/mapDatasetGovernance';
import type {
  CommercialReleaseEvidence,
  DevelopmentBenchmarkEvidence,
  MapDatasetGovernanceRecord,
} from '../platform/mapdata/mapDatasetGovernance';
import { unknownLicensePolicy } from '../platform/mapdata/mapDataLicense';

const DEV_EVIDENCE: DevelopmentBenchmarkEvidence = {
  bounded: true,
  usesOfficialAccess: true,
  accessControlsRespected: true,
  termsCompliant: true,
  restrictionsSatisfied: true,
};

function completeReleaseEvidence(
  record: MapDatasetGovernanceRecord,
): CommercialReleaseEvidence {
  return {
    datasetId: record.datasetId,
    releaseId: record.release.releaseId,
    recordedTermsVersion: record.termsVersion,
    recordedDocumentIds: [...record.requiredDocumentIds],
    recordLicenseAuditComplete: true,
    recordLicenses: ['CDLA-Permissive-2.0', 'Apache-2.0'],
    attributionSatisfied: true,
  };
}

describe('MAPDATA · iki eksenli uygunluk', () => {
  it('commercial izin beklerken resmî bounded development benchmark geçebilir', () => {
    expect(OVERTURE_PLACES_2026_08_19_GOVERNANCE.releaseClassification)
      .toBe('PERMISSION_REQUIRED');
    const result = evaluateDevelopmentBenchmarkGate(
      OVERTURE_PLACES_2026_08_19_GOVERNANCE,
      DEV_EVIDENCE,
    );
    expect(result.eligible).toBe(true);
  });

  it('DEV_RESTRICTED kaynakta auth/kota koşulu sağlanmadıysa benchmark kapanır', () => {
    const restricted: MapDatasetGovernanceRecord = {
      ...OVERTURE_PLACES_2026_08_19_GOVERNANCE,
      datasetId: 'restricted-official-source',
      developmentEligibility: 'DEV_RESTRICTED',
    };
    expect(evaluateDevelopmentBenchmarkGate(restricted, {
      ...DEV_EVIDENCE,
      restrictionsSatisfied: false,
    }).eligible).toBe(false);
    expect(evaluateDevelopmentBenchmarkGate(restricted, DEV_EVIDENCE).eligible).toBe(true);
  });

  it('resmî yol, bounded kapsam veya şart uyumu yoksa development da fail-closed', () => {
    const unofficial: MapDatasetGovernanceRecord = {
      ...OVERTURE_PLACES_2026_08_19_GOVERNANCE,
      access: { ...OVERTURE_PLACES_2026_08_19_GOVERNANCE.access, official: false },
    };
    expect(evaluateDevelopmentBenchmarkGate(unofficial, DEV_EVIDENCE).eligible).toBe(false);
    expect(evaluateDevelopmentBenchmarkGate(
      OVERTURE_PLACES_2026_08_19_GOVERNANCE,
      { ...DEV_EVIDENCE, bounded: false },
    ).eligible).toBe(false);
    expect(evaluateDevelopmentBenchmarkGate(
      OVERTURE_PLACES_2026_08_19_GOVERNANCE,
      { ...DEV_EVIDENCE, termsCompliant: false },
    ).eligible).toBe(false);
  });
});

describe('MAPDATA · commercial release gate', () => {
  it('PERMISSION_REQUIRED gerçek kayıt bütün lisans hakları bilinse bile release olamaz', () => {
    const record = OVERTURE_PLACES_2026_08_19_GOVERNANCE;
    const result = evaluateCommercialReleaseGate(record, completeReleaseEvidence(record));
    expect(result.eligible).toBe(false);
    expect(result.licenseGate.verdict).toBe('ALLOW_WITH_ATTRIBUTION');
    expect(result.reasons.join(' ')).toContain('PERMISSION_REQUIRED');
  });

  it('yalnız açık release sınıfı + sürüm + şartlar + haklar + belgeler + atıf birlikte geçer', () => {
    const released: MapDatasetGovernanceRecord = {
      ...OVERTURE_PLACES_2026_08_19_GOVERNANCE,
      releaseClassification: 'ATTRIBUTION_REQUIRED',
    };
    const evidence = completeReleaseEvidence(released);
    const result = evaluateCommercialReleaseGate(released, evidence);
    expect(result.eligible).toBe(true);
    expect(result.licenseGate.verdict).toBe('ALLOW_WITH_ATTRIBUTION');

    expect(evaluateCommercialReleaseGate(released, {
      ...evidence,
      recordedDocumentIds: evidence.recordedDocumentIds.slice(1),
    }).eligible).toBe(false);
    expect(evaluateCommercialReleaseGate(released, {
      ...evidence,
      attributionSatisfied: false,
    }).eligible).toBe(false);
    expect(evaluateCommercialReleaseGate(released, {
      ...evidence,
      recordLicenseAuditComplete: false,
    }).eligible).toBe(false);
  });

  it('UNKNOWN hak, sürüm veya şart kaydı production/offline pakete sızamaz', () => {
    const unknown: MapDatasetGovernanceRecord = {
      ...OVERTURE_PLACES_2026_08_19_GOVERNANCE,
      datasetId: 'unknown-municipal-dataset',
      sourceId: 'MUNICIPALITY',
      release: {
        sourceId: 'MUNICIPALITY',
        releaseId: 'UNKNOWN',
        publishedAtEpochMs: null,
        dataCutoffEpochMs: null,
        retrievedFrom: null,
      },
      releaseClassification: 'UNKNOWN',
      licensePolicy: unknownLicensePolicy('MUNICIPALITY'),
      termsVersion: null,
      requiredDocumentIds: [],
    };
    const result = evaluateCommercialReleaseGate(unknown, {
      ...completeReleaseEvidence(unknown),
      recordLicenses: ['UNVERIFIED'],
    });
    expect(result.eligible).toBe(false);
    expect(result.licenseGate.verdict).toBe('DENY');
  });

  it('release source kimliği governance source kimliğiyle eşleşmelidir', () => {
    const mismatch: MapDatasetGovernanceRecord = {
      ...OVERTURE_PLACES_2026_08_19_GOVERNANCE,
      releaseClassification: 'ATTRIBUTION_REQUIRED',
      release: {
        ...OVERTURE_PLACES_2026_08_19_GOVERNANCE.release,
        sourceId: 'OSM',
      },
    };
    expect(evaluateCommercialReleaseGate(mismatch, completeReleaseEvidence(mismatch)).eligible)
      .toBe(false);
  });
});

describe('MAPDATA · attribution metadata seam', () => {
  it('tek merkezi registry gelecekteki Kaynaklar ve Lisanslar ekranını besler', () => {
    expect(MAP_DATASET_GOVERNANCE_REGISTRY).toEqual([
      OSM_TURKEY_BASELINE_GOVERNANCE,
      OVERTURE_PLACES_2026_08_19_GOVERNANCE,
    ]);
    const projection = buildMapDataAttributionProjection([
      OVERTURE_PLACES_2026_08_19_GOVERNANCE,
      OSM_TURKEY_BASELINE_GOVERNANCE,
      OVERTURE_PLACES_2026_08_19_GOVERNANCE,
    ]);
    expect(projection).toHaveLength(2);
    expect(projection.map((entry) => entry.datasetId)).toEqual([
      'osm-turkey-canonical-baseline',
      'overture-places-2026-08-19.0',
    ]);
    expect(projection[1]).toMatchObject({
      provider: 'Overture Maps Foundation',
      dataset: 'Overture Places',
      version: '2026-08-19.0',
      license: 'CDLA-Permissive-2.0',
      permissionStatus: 'PERMISSION_REQUIRED',
    });
    expect(projection.every((entry) => entry.requiredLinks.length > 0)).toBe(true);
  });
});
