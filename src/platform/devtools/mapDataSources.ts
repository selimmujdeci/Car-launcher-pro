/**
 * mapDataSources.ts — CAROS LAB · Harita Veri Platformu · TEK OKUMA KATMANI.
 *
 * SENKRON ve SALT-OKUNUR. Her getter kendi `try/catch`'i içindedir; hiçbir
 * okuma başka bir okumayı düşüremez. **Hiçbir şey BAŞLATMAZ**: sağlayıcı
 * bağlamaz, ağ çağırmaz, timer kurmaz, veri kümesi indirmez.
 *
 * ── NE OKUR ───────────────────────────────────────────────────────────────
 * Harita veri platformunun (`platform/mapdata`) **beyan edilmiş durumunu**:
 * hangi kaynaklar tanımlı, hangi haklar kanıtlanmış, hangi portlara sağlayıcı
 * BAĞLI (bugün: hiçbiri), fusion politikası ne.
 *
 * ── NE OKUMAZ (bilinçli) ──────────────────────────────────────────────────
 * Çalışma zamanı harita gerçeği BU EKRANIN KONUSU DEĞİLDİR — onun sahibi
 * NAV v3 L1 `MapStore`tur ve `Navigation Core` ekranında gözlenir. Burada
 * ikinci bir harita gerçeği yüzeyi KURULMAZ.
 *
 * ── GİZLİLİK ──────────────────────────────────────────────────────────────
 * Koordinat · adres · sorgu metni · kullanıcı verisi BU EKRANA GELMEZ.
 * Yalnız sözleşme, hak ve politika değerleri gösterilir.
 */

import {
  MAP_DATA_SOURCE_IDS, MAP_FEATURE_KINDS, FIELDS_BY_KIND,
  type MapDataSourceId, type MapFeatureKind,
} from '../mapdata/mapDataSource';
import {
  MAP_DATA_USE_INTENTS, SPDX_RIGHTS,
  evaluateLicenseGate, licensePolicyFor,
  type LicenseGateVerdict, type MapDataUseIntent, type MapLicensePolicy,
} from '../mapdata/mapDataLicense';
import { SOURCE_FRESHNESS_BUDGET_MS } from '../mapdata/mapDataObservation';
import {
  DEFAULT_RESOLUTION_WEIGHTS, NEUTRAL_AUTHORITY_PRIOR, DEFAULT_MIN_ACCEPTED_SCORE,
  CONTESTED_SCORE_EPSILON,
} from '../mapdata/mapDataResolution';
import {
  DEFAULT_BUILDING_MATCH_POLICY, AGREEMENT_MIN_AREA_RATIO,
} from '../mapdata/resolvers/buildingResolver';
import { NULL_ADDRESS_INDEX, NULL_PLACE_INDEX } from '../mapdata/indexes/addressPlaceIndex';
import { NULL_LIVE_ROAD_CONDITIONS, LIVE_FRESHNESS_BUDGET_MS, LIVE_CONDITION_KINDS } from '../mapdata/live/liveRoadConditions';

/* ── Kaynak satırı ───────────────────────────────────────────────────────── */

export interface MapDataSourceRow {
  readonly sourceId: MapDataSourceId;
  readonly license: string;
  readonly attributionRequired: boolean;
  readonly hasAttributionText: boolean;
  readonly shareAlike: boolean;
  readonly freshnessBudgetMs: number | null;
  /** Niyet başına kapı hükmü — GERÇEKTEN hesaplanır, sabit metin değildir. */
  readonly gates: Readonly<Record<MapDataUseIntent, LicenseGateVerdict>>;
  readonly provenanceNote: string;
}

/** Bir porta bağlı sağlayıcı var mı — bugün hepsi `null` (dürüst beyan). */
export interface MapDataPortRow {
  readonly portId: 'ADDRESS_INDEX' | 'PLACE_INDEX' | 'LIVE_ROAD_CONDITIONS';
  readonly providerId: MapDataSourceId | null;
  readonly bound: boolean;
}

export interface MapDataFusionPolicyRow {
  readonly weightFreshness: number;
  readonly weightAgreement: number;
  readonly weightQuality: number;
  readonly weightAuthority: number;
  readonly neutralAuthorityPrior: number;
  readonly minAcceptedScore: number;
  readonly contestedEpsilon: number;
  readonly buildingMaxCentroidDistanceM: number;
  readonly buildingMinAreaRatio: number;
  readonly buildingRequireContainment: boolean;
  readonly buildingAgreementMinAreaRatio: number;
}

export interface MapDataRawSnapshot {
  readonly readOk: boolean;
  readonly sources: readonly MapDataSourceRow[];
  readonly ports: readonly MapDataPortRow[];
  readonly fusion: MapDataFusionPolicyRow | null;
  readonly featureKinds: readonly { kind: MapFeatureKind; fieldCount: number }[];
  readonly recognizedSpdxLabels: readonly string[];
  readonly liveBudgets: readonly { kind: string; budgetMs: number }[];
  /** Okuma sırasında yakalanan hata sayısı — 0 değilse ekran bunu söyler. */
  readonly readErrors: number;
}

export const EMPTY_MAP_DATA_SNAPSHOT: MapDataRawSnapshot = {
  readOk: false, sources: [], ports: [], fusion: null,
  featureKinds: [], recognizedSpdxLabels: [], liveBudgets: [], readErrors: 0,
};

/* ── Okuyucular ──────────────────────────────────────────────────────────── */

function readSources(): { rows: MapDataSourceRow[]; errors: number } {
  const rows: MapDataSourceRow[] = [];
  let errors = 0;
  for (const id of MAP_DATA_SOURCE_IDS) {
    try {
      const policy: MapLicensePolicy = licensePolicyFor(id);
      const gates = {} as Record<MapDataUseIntent, LicenseGateVerdict>;
      for (const intent of MAP_DATA_USE_INTENTS) {
        gates[intent] = evaluateLicenseGate(policy, intent).verdict;
      }
      rows.push({
        sourceId: id,
        license: policy.license,
        attributionRequired: policy.attributionRequired,
        hasAttributionText: typeof policy.attribution === 'string' && policy.attribution.length > 0,
        shareAlike: policy.shareAlike,
        freshnessBudgetMs: SOURCE_FRESHNESS_BUDGET_MS[id] ?? null,
        gates,
        provenanceNote: policy.provenanceNote,
      });
    } catch { errors += 1; }
  }
  return { rows, errors };
}

function readPorts(): { rows: MapDataPortRow[]; errors: number } {
  const rows: MapDataPortRow[] = [];
  let errors = 0;
  const entries: readonly [MapDataPortRow['portId'], { providerId: MapDataSourceId | null }][] = [
    ['ADDRESS_INDEX', NULL_ADDRESS_INDEX],
    ['PLACE_INDEX', NULL_PLACE_INDEX],
    ['LIVE_ROAD_CONDITIONS', NULL_LIVE_ROAD_CONDITIONS],
  ];
  for (const [portId, port] of entries) {
    try {
      const providerId = port?.providerId ?? null;
      rows.push({ portId, providerId, bound: providerId !== null });
    } catch { errors += 1; }
  }
  return { rows, errors };
}

function readFusionPolicy(): MapDataFusionPolicyRow | null {
  try {
    return {
      weightFreshness: DEFAULT_RESOLUTION_WEIGHTS.freshness,
      weightAgreement: DEFAULT_RESOLUTION_WEIGHTS.agreement,
      weightQuality: DEFAULT_RESOLUTION_WEIGHTS.quality,
      weightAuthority: DEFAULT_RESOLUTION_WEIGHTS.authority,
      neutralAuthorityPrior: NEUTRAL_AUTHORITY_PRIOR,
      minAcceptedScore: DEFAULT_MIN_ACCEPTED_SCORE,
      contestedEpsilon: CONTESTED_SCORE_EPSILON,
      buildingMaxCentroidDistanceM: DEFAULT_BUILDING_MATCH_POLICY.maxCentroidDistanceM,
      buildingMinAreaRatio: DEFAULT_BUILDING_MATCH_POLICY.minAreaRatio,
      buildingRequireContainment: DEFAULT_BUILDING_MATCH_POLICY.requireContainment,
      buildingAgreementMinAreaRatio: AGREEMENT_MIN_AREA_RATIO,
    };
  } catch { return null; }
}

/**
 * Anlık görüntüyü SENKRON okur. Çağrı başına TEK okuma; abonelik/timer YOK.
 * Kısmi hata sonucu düşürmez — `readErrors` ile ilan edilir.
 */
export function readMapDataSnapshot(): MapDataRawSnapshot {
  let errors = 0;

  const { rows: sources, errors: srcErrors } = readSources();
  errors += srcErrors;
  const { rows: ports, errors: portErrors } = readPorts();
  errors += portErrors;
  const fusion = readFusionPolicy();
  if (fusion === null) errors += 1;

  let featureKinds: { kind: MapFeatureKind; fieldCount: number }[] = [];
  try {
    featureKinds = MAP_FEATURE_KINDS.map((kind) => ({
      kind, fieldCount: (FIELDS_BY_KIND[kind] ?? []).length,
    }));
  } catch { errors += 1; }

  let recognizedSpdxLabels: string[] = [];
  try { recognizedSpdxLabels = Object.keys(SPDX_RIGHTS).sort(); } catch { errors += 1; }

  let liveBudgets: { kind: string; budgetMs: number }[] = [];
  try {
    liveBudgets = LIVE_CONDITION_KINDS.map((kind) => ({
      kind, budgetMs: LIVE_FRESHNESS_BUDGET_MS[kind],
    }));
  } catch { errors += 1; }

  return {
    readOk: sources.length > 0 && ports.length > 0,
    sources, ports, fusion, featureKinds, recognizedSpdxLabels, liveBudgets,
    readErrors: errors,
  };
}

/** Kayıt sayısı — kilitlerin "kör" olmadığını kanıtlamak için. */
export const MAP_DATA_SOURCE_COUNT = MAP_DATA_SOURCE_IDS.length;
