/**
 * mapDatasetGovernance.ts — MAP DATA PLATFORM · DATASET GOVERNANCE (SAF).
 *
 * SAF: I/O YOK · ağ YOK · timer YOK · saat YOK · global mutable durum YOK.
 *
 * Bu modül iki farklı soruyu bilinçli olarak ayırır:
 *  1) Bir kaynağı resmî/izinli yoldan bounded geliştirme ölçümünde kullanabilir
 *     miyiz?
 *  2) Aynı dataset ticari, yeniden dağıtılan OFFLINE pakete girebilir mi?
 *
 * Birinci kapının geçmesi ikinciyi GEÇİRMEZ. Ticari hak bilinmiyorsa benchmark
 * otomatik engellenmez; release ise daima fail-closed kalır. Hakların asıl
 * hesabı `mapDataLicense` içindedir — burada ikinci lisans sözlüğü kurulmaz.
 */

import type { LicenseGateResult, MapLicensePolicy } from './mapDataLicense';
import { effectiveLicensePolicy, evaluateLicenseGate, licensePolicyFor } from './mapDataLicense';
import type { MapDatasetRelease, MapDataSourceId } from './mapDataSource';
import { isReleaseIdentified } from './mapDataSource';

export type MapDatasetTechnicalClassification =
  | 'CANONICAL_CANDIDATE'
  | 'ENRICHMENT_CANDIDATE'
  | 'GAP_EVIDENCE'
  | 'REFERENCE_ONLY'
  | 'QUALITY_REJECTED';

export type MapDatasetDevelopmentEligibility = 'DEV_ALLOWED' | 'DEV_RESTRICTED';

export type MapDatasetReleaseClassification =
  | 'RELEASE_ALLOWED'
  | 'ATTRIBUTION_REQUIRED'
  | 'PERMISSION_REQUIRED'
  | 'RELEASE_BLOCKED'
  | 'UNKNOWN';

export type MapDatasetAccessMethod =
  | 'API'
  | 'WFS'
  | 'WCS'
  | 'DOWNLOAD'
  | 'EXPORT'
  | 'NONE';

export interface MapDatasetAccessMetadata {
  /** Sağlayıcının ilan ettiği erişim yolu mu? */
  readonly official: boolean;
  readonly method: MapDatasetAccessMethod;
  readonly url: string | null;
  /** Sağlayıcı bu yoldan küçük AOI/örnek ölçümüne izin veriyor mu? */
  readonly boundedBenchmarkAllowed: boolean;
  /** Auth, kota, kapsam gibi yerine getirilmesi gereken koşullar. */
  readonly restrictions: readonly string[];
}

/**
 * Tek dataset sürümünün teknik, erişim ve release metadata kaydı.
 * Gelecekteki “Harita Verileri / Kaynaklar ve Lisanslar” ekranının canonical
 * besleme dikişidir; UI metni farklı modüllere hard-code edilmez.
 */
export interface MapDatasetGovernanceRecord {
  readonly datasetId: string;
  readonly sourceId: MapDataSourceId;
  readonly provider: string;
  readonly dataset: string;
  readonly release: MapDatasetRelease;
  readonly technicalClassification: MapDatasetTechnicalClassification;
  readonly developmentEligibility: MapDatasetDevelopmentEligibility;
  readonly releaseClassification: MapDatasetReleaseClassification;
  readonly access: MapDatasetAccessMetadata;
  /** Dataset politikası; hak çözümünün tek otoritesi yine mapDataLicense'tır. */
  readonly licensePolicy: MapLicensePolicy;
  readonly termsVersion: string | null;
  readonly attributionText: string | null;
  readonly requiredLinks: readonly string[];
  /** Lisans/izin/NOTICE/atıf planı gibi release dosyasına konacak kanıt kimlikleri. */
  readonly requiredDocumentIds: readonly string[];
}

export interface DevelopmentBenchmarkEvidence {
  readonly bounded: boolean;
  readonly usesOfficialAccess: boolean;
  readonly accessControlsRespected: boolean;
  readonly termsCompliant: boolean;
  /** DEV_RESTRICTED için auth/kota/kurum koşulları gerçekten sağlandı mı? */
  readonly restrictionsSatisfied: boolean;
}

export interface DevelopmentBenchmarkGateResult {
  readonly eligible: boolean;
  readonly datasetId: string;
  readonly reasons: readonly string[];
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Commercial durumdan BAĞIMSIZ, yalnız meşru bounded geliştirme erişimi. */
export function evaluateDevelopmentBenchmarkGate(
  record: MapDatasetGovernanceRecord,
  evidence: DevelopmentBenchmarkEvidence,
): DevelopmentBenchmarkGateResult {
  const reasons: string[] = [];
  if (!record || !nonEmpty(record.datasetId)) reasons.push('Dataset kimliği kayıtlı değil.');
  if (!record?.access?.official || record.access.method === 'NONE' || !nonEmpty(record.access.url)) {
    reasons.push('Resmî erişim yolu doğrulanmadı.');
  }
  if (!record?.access?.boundedBenchmarkAllowed) reasons.push('Bounded benchmark erişim şartlarında izinli değil.');
  if (!evidence?.bounded) reasons.push('İstek bounded değil.');
  if (!evidence?.usesOfficialAccess) reasons.push('İstek resmî erişim yolunu kullanmıyor.');
  if (!evidence?.accessControlsRespected) reasons.push('Erişim kontrollerine uyum kanıtlanmadı.');
  if (!evidence?.termsCompliant) reasons.push('Kullanım şartlarına uyum kanıtlanmadı.');
  if (record?.developmentEligibility === 'DEV_RESTRICTED' && !evidence?.restrictionsSatisfied) {
    reasons.push('DEV_RESTRICTED erişim koşulları tamamlanmadı.');
  }
  return {
    eligible: reasons.length === 0,
    datasetId: record?.datasetId ?? 'UNKNOWN',
    reasons: reasons.length > 0 ? reasons : ['Resmî, bounded ve şartlara uygun development benchmark.'],
  };
}

export interface CommercialReleaseEvidence {
  readonly datasetId: string;
  readonly releaseId: string;
  readonly recordedTermsVersion: string | null;
  readonly recordedDocumentIds: readonly string[];
  /** Kayıt düzeyi lisans alanı incelendi; boş dizi ancak gerçekten ilan yoksa geçerlidir. */
  readonly recordLicenseAuditComplete: boolean;
  readonly recordLicenses: readonly string[];
  readonly attributionSatisfied: boolean;
}

export interface CommercialReleaseGateResult {
  readonly eligible: boolean;
  readonly datasetId: string;
  readonly reasons: readonly string[];
  readonly licenseGate: LicenseGateResult;
}

const RELEASE_CLASSIFICATIONS_ALLOWED: readonly MapDatasetReleaseClassification[] = [
  'RELEASE_ALLOWED', 'ATTRIBUTION_REQUIRED',
] as const;

/**
 * Satış/offline paket kapısı. Bu kapı development benchmark'ı yönetmez.
 * Her koşul olumlu kanıtlanmadıkça `eligible=false` döner.
 */
export function evaluateCommercialReleaseGate(
  record: MapDatasetGovernanceRecord,
  evidence: CommercialReleaseEvidence,
): CommercialReleaseGateResult {
  const reasons: string[] = [];
  const auditedLicenses = evidence?.recordLicenseAuditComplete ? evidence.recordLicenses : ['UNKNOWN'];
  const effectivePolicy = record
    ? effectiveLicensePolicy(record.sourceId, auditedLicenses)
    : effectiveLicensePolicy('DERIVED', ['UNKNOWN']);
  const licenseGate = evaluateLicenseGate(effectivePolicy, 'OFFLINE_PACKAGING');

  if (!record || !nonEmpty(record.datasetId)) reasons.push('Dataset governance kaydı yok.');
  const releaseClassification = record?.releaseClassification ?? 'UNKNOWN';
  if (!RELEASE_CLASSIFICATIONS_ALLOWED.includes(releaseClassification)) {
    reasons.push(`Release sınıfı ${record?.releaseClassification ?? 'UNKNOWN'} → fail-closed.`);
  }
  if (!isReleaseIdentified(record?.release)) reasons.push('Dataset release sürümü kayıtlı değil.');
  if (record?.release?.sourceId !== record?.sourceId) {
    reasons.push('Dataset release kaynak kimliği governance kaydıyla eşleşmiyor.');
  }
  if (evidence?.datasetId !== record?.datasetId) reasons.push('Release kanıtı dataset kimliğiyle eşleşmiyor.');
  if (evidence?.releaseId !== record?.release?.releaseId) reasons.push('Release kanıtı dataset sürümüyle eşleşmiyor.');
  if (!nonEmpty(record?.termsVersion) || evidence?.recordedTermsVersion !== record.termsVersion) {
    reasons.push('Şart/lisans sürümü kaydı eksik veya eşleşmiyor.');
  }
  if (!nonEmpty(record?.licensePolicy?.termsUrl)) reasons.push('Canonical şart/lisans bağlantısı kayıtlı değil.');
  if (!record?.requiredDocumentIds?.length) {
    reasons.push('Zorunlu release belgesi listesi tanımlı değil.');
  } else {
    for (const documentId of record.requiredDocumentIds) {
      if (!evidence?.recordedDocumentIds?.includes(documentId)) {
        reasons.push(`Zorunlu release belgesi eksik: ${documentId}`);
      }
    }
  }
  if (!evidence?.recordLicenseAuditComplete) reasons.push('Kayıt düzeyi lisans denetimi tamamlanmadı.');
  if (licenseGate.verdict === 'DENY') reasons.push(...licenseGate.reasons.map((reason) => `Lisans: ${reason}`));

  const attributionRequired = record?.releaseClassification === 'ATTRIBUTION_REQUIRED'
    || effectivePolicy.attributionRequired;
  if (attributionRequired) {
    if (!nonEmpty(record?.attributionText)) reasons.push('Zorunlu attribution metni kayıtlı değil.');
    if (!record?.requiredLinks?.some(nonEmpty)) reasons.push('Zorunlu attribution bağlantısı kayıtlı değil.');
    if (!evidence?.attributionSatisfied) reasons.push('Release attribution uygulaması doğrulanmadı.');
  }

  return {
    eligible: reasons.length === 0,
    datasetId: record?.datasetId ?? 'UNKNOWN',
    reasons: reasons.length > 0 ? reasons : ['Commercial use, redistribution, offline packaging ve belgeler doğrulandı.'],
    licenseGate,
  };
}

export interface MapDataAttributionEntry {
  readonly datasetId: string;
  readonly provider: string;
  readonly dataset: string;
  readonly version: string;
  readonly license: string;
  readonly attributionText: string | null;
  readonly requiredLinks: readonly string[];
  readonly permissionStatus: MapDatasetReleaseClassification;
}

/** UI-bağımsız, sıralı ve tekilleştirilmiş “Kaynaklar ve Lisanslar” projection'ı. */
export function buildMapDataAttributionProjection(
  records: readonly MapDatasetGovernanceRecord[],
): readonly MapDataAttributionEntry[] {
  const byDatasetId = new Map<string, MapDataAttributionEntry>();
  for (const record of records ?? []) {
    if (!record || !nonEmpty(record.datasetId) || byDatasetId.has(record.datasetId)) continue;
    byDatasetId.set(record.datasetId, {
      datasetId: record.datasetId,
      provider: record.provider,
      dataset: record.dataset,
      version: record.release.releaseId,
      license: record.licensePolicy.license,
      attributionText: record.attributionText,
      requiredLinks: [...record.requiredLinks],
      permissionStatus: record.releaseClassification,
    });
  }
  return [...byDatasetId.values()].sort((a, b) => a.datasetId.localeCompare(b.datasetId));
}

/** Mevcut canonical geometri baseline'ı; development rolü değişmez. */
export const OSM_TURKEY_BASELINE_GOVERNANCE: MapDatasetGovernanceRecord = {
  datasetId: 'osm-turkey-canonical-baseline',
  sourceId: 'OSM',
  provider: 'OpenStreetMap contributors',
  dataset: 'OpenStreetMap Turkey baseline',
  release: {
    sourceId: 'OSM',
    // Gerçek offline paket snapshot'ı henüz bu metadata kaydına pinlenmedi.
    releaseId: 'UNKNOWN',
    publishedAtEpochMs: null,
    dataCutoffEpochMs: null,
    retrievedFrom: 'https://www.openstreetmap.org/copyright',
  },
  technicalClassification: 'CANONICAL_CANDIDATE',
  developmentEligibility: 'DEV_ALLOWED',
  releaseClassification: 'PERMISSION_REQUIRED',
  access: {
    official: true,
    method: 'API',
    url: 'https://api.openstreetmap.org/api/0.6/map',
    boundedBenchmarkAllowed: true,
    restrictions: ['Main API is only for small bounded research requests', 'No bulk production use'],
  },
  licensePolicy: licensePolicyFor('OSM'),
  termsVersion: 'ODbL-1.0',
  attributionText: '© OpenStreetMap contributors',
  requiredLinks: [
    'https://www.openstreetmap.org/copyright',
    'https://operations.osmfoundation.org/policies/api/',
  ],
  requiredDocumentIds: [
    'license:odbl-1.0',
    'plan:osm-attribution-and-share-alike',
    'snapshot:osm-turkey-offline-release',
    'permission:turkiye-geographic-data-commercial-release',
  ],
};

/**
 * Bu turda bounded evidence ingestion'a alınan TEK yeni dataset kaydı.
 * Lisansı teknik olarak permissive olsa da Türkiye satış/offline dağıtım izin
 * incelemesi tamamlanmadığı için release sınıfı bilerek PERMISSION_REQUIRED.
 */
export const OVERTURE_PLACES_2026_08_19_GOVERNANCE: MapDatasetGovernanceRecord = {
  datasetId: 'overture-places-2026-08-19.0',
  sourceId: 'OVERTURE',
  provider: 'Overture Maps Foundation',
  dataset: 'Overture Places',
  release: {
    sourceId: 'OVERTURE',
    releaseId: '2026-08-19.0',
    publishedAtEpochMs: null,
    dataCutoffEpochMs: null,
    retrievedFrom: 'https://docs.overturemaps.org/getting-data/overturemaps-py/',
  },
  technicalClassification: 'ENRICHMENT_CANDIDATE',
  developmentEligibility: 'DEV_ALLOWED',
  releaseClassification: 'PERMISSION_REQUIRED',
  access: {
    official: true,
    method: 'DOWNLOAD',
    url: 'https://docs.overturemaps.org/getting-data/overturemaps-py/',
    boundedBenchmarkAllowed: true,
    restrictions: ['Bounded STAC bbox query', 'Release must be pinned'],
  },
  licensePolicy: licensePolicyFor('OVERTURE'),
  termsVersion: 'Overture attribution and record licenses @ 2026-08-19.0',
  attributionText: '© Overture Maps Foundation',
  requiredLinks: [
    'https://docs.overturemaps.org/attribution/',
    'https://docs.overturemaps.org/guides/places/',
  ],
  requiredDocumentIds: [
    'license:overture-distribution-cdla-permissive-2.0',
    'audit:overture-places-record-licenses-2026-08-19.0',
    'permission:turkiye-geographic-data-commercial-release',
  ],
};

/** Merkezi metadata seam; UI veya renderer'a bağlı değildir. */
export const MAP_DATASET_GOVERNANCE_REGISTRY: readonly MapDatasetGovernanceRecord[] = [
  OSM_TURKEY_BASELINE_GOVERNANCE,
  OVERTURE_PLACES_2026_08_19_GOVERNANCE,
] as const;
