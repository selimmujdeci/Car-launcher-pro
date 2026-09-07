/**
 * buildingResolver.ts — MAP DATA PLATFORM · F3 · BINA FUSION MVP (SAF).
 *
 * SAF: I/O YOK · ağ YOK · timer YOK · saat YOK · rastgelelik YOK ·
 * ML/sezgisel öğrenme YOK. Aynı girdi → aynı çıktı.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN İLK FUSION DOMAİNİ BINA ─────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Gerçek cihaz problemi burada ÖLÇÜLDÜ: Tarsus'ta duran araçta geniş
 * footprint boşluğu görülüyordu; ölçüm boşluğun kaynağının OSM kapsamı
 * olduğunu, Overture'ın aynı 400×400 m alanda 11 yerine 123 footprint
 * taşıdığını gösterdi (`field-runs/mapdata-shootout-20260907/REPORT.md`).
 *
 * ── NE YAPAR ──────────────────────────────────────────────────────────────
 *  1. Farklı kaynaklardan gelen bina gözlemlerini **aynı gerçek nesne**
 *     kümelerine ayırır (deterministik, açıklanabilir örtüşme kanıtıyla).
 *  2. Her kümeyi `CandidateMapFeature` yapar — gözlemler ÜST ÜSTE YAZILMAZ.
 *  3. `resolveCandidate` ile alan alan canonical değeri seçtirir.
 *
 * ── NE YAPMAZ ─────────────────────────────────────────────────────────────
 *  · Poligon birleştirme/ortalama YAPMAZ. İki footprint'ten yeni bir "melez"
 *    geometri ÜRETİLMEZ — üretilen geometri DAİMA gerçek bir kaynak kaydıdır.
 *    Uydurma geometri, uydurma değerin en tehlikeli türüdür.
 *  · Renderer'a bağlanmaz. Bu faz gölge/fixture karşılaştırmasıdır.
 *  · Kendi lisans hükmünü üretmez — `resolveCandidate` kapıyı çalıştırır.
 */

import type { CandidateMapFeature, MapSourceObservation } from '../mapDataObservation';
import type { CanonicalMapFeature, ResolveOptions } from '../mapDataResolution';
import { resolveCandidate } from '../mapDataResolution';
import type { MapDataSourceId } from '../mapDataSource';
import type { FootprintOverlap } from './buildingGeometry';
import { bboxIntersects, bboxOf, measureOverlap, polygonAreaM2 } from './buildingGeometry';
import { isCanonicalBuildingGeometryEligible } from './buildingQuality';

/* ══════════════════════════════════════════════════════════════════════════
   1) EŞLEŞTİRME POLİTİKASI — sayılar gerekçelidir
   ══════════════════════════════════════════════════════════════════════════ */

export interface BuildingMatchPolicy {
  /**
   * Merkezler bu mesafeden uzaksa aynı bina SAYILMAZ (m). Tarsus ölçümünde
   * ML footprint'lerle OSM footprint'leri arasındaki merkez sapması tipik
   * olarak birkaç metredir; 12 m bina ölçeğinde cömert ama komşu binayı
   * yutmayacak bir sınırdır.
   */
  readonly maxCentroidDistanceM: number;
  /**
   * Alan oranı bunun altındaysa aynı bina SAYILMAZ. 0.25 = biri diğerinin
   * dörtte birinden küçükse bunlar farklı nesnelerdir (ör. avlu içindeki
   * müştemilat ile ana blok).
   */
  readonly minAreaRatio: number;
  /**
   * Merkez içerme kanıtı ZORUNLU mu. `true` iken yalnız yakınlık yetmez;
   * en az bir merkez diğerinin poligonu içinde olmalıdır. Bu, sıra sıra
   * dizilmiş küçük binaların birbirine yapışmasını engeller.
   */
  readonly requireContainment: boolean;
  /** bbox ön elemesi için derece cinsinden tampon (~15 m). */
  readonly bboxPadDeg: number;
}

export const DEFAULT_BUILDING_MATCH_POLICY: BuildingMatchPolicy = {
  maxCentroidDistanceM: 12,
  minAreaRatio: 0.25,
  requireContainment: true,
  bboxPadDeg: 0.00015,
};

/** Eşleşme hükmü — neden eşleşti/eşleşmedi taşınır. */
export interface BuildingMatchVerdict {
  readonly matched: boolean;
  readonly overlap: FootprintOverlap;
  readonly reason:
    | 'CONTAINMENT_AND_AREA'
    | 'PROXIMITY_AND_AREA'
    | 'NO_GEOMETRY'
    | 'TOO_FAR'
    | 'AREA_MISMATCH'
    | 'NO_CONTAINMENT';
}

export function matchBuildings(
  a: MapSourceObservation,
  b: MapSourceObservation,
  policy: BuildingMatchPolicy = DEFAULT_BUILDING_MATCH_POLICY,
): BuildingMatchVerdict {
  const overlap = measureOverlap(a?.geometry, b?.geometry);
  if (overlap.centroidDistanceM === null) {
    return { matched: false, overlap, reason: 'NO_GEOMETRY' };
  }
  if (overlap.centroidDistanceM > policy.maxCentroidDistanceM) {
    return { matched: false, overlap, reason: 'TOO_FAR' };
  }
  if (overlap.areaRatio !== null && overlap.areaRatio < policy.minAreaRatio) {
    return { matched: false, overlap, reason: 'AREA_MISMATCH' };
  }
  if (overlap.mutualContainment > 0) {
    return { matched: true, overlap, reason: 'CONTAINMENT_AND_AREA' };
  }
  if (policy.requireContainment) {
    return { matched: false, overlap, reason: 'NO_CONTAINMENT' };
  }
  return { matched: true, overlap, reason: 'PROXIMITY_AND_AREA' };
}

/* ══════════════════════════════════════════════════════════════════════════
   2) KÜMELEME — deterministik birleştirme
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Kümeleme sırası SONUCU ETKİLEMESİN diye gözlemler önce kanonik olarak
 * sıralanır (kaynak kimliği, sonra kaynak nesne kimliği). Böylece aynı küme
 * girdi sırasından bağımsız olarak aynı `entityKey`i üretir.
 */
function canonicalSort(observations: readonly MapSourceObservation[]): MapSourceObservation[] {
  return [...observations].sort((x, y) =>
    x.provenance.sourceId.localeCompare(y.provenance.sourceId, 'en')
    || x.provenance.sourceFeatureId.localeCompare(y.provenance.sourceFeatureId, 'en'));
}

/**
 * Küme anahtarı: kümedeki KANONİK OLARAK EN KÜÇÜK kaynak kimliği.
 * **Kalıcı kimlik değildir** (F0 sözleşmesi) — eşleştirme değişirse değişir.
 */
function clusterKey(sorted: readonly MapSourceObservation[]): string {
  const first = sorted[0];
  return `building:${first.provenance.sourceId}:${first.provenance.sourceFeatureId}`;
}

export interface BuildingClusterStats {
  readonly totalObservations: number;
  readonly clusters: number;
  readonly multiSourceClusters: number;
  readonly singleSourceClusters: Readonly<Partial<Record<MapDataSourceId, number>>>;
  readonly withoutGeometry: number;
}

export interface BuildingClusterResult {
  readonly candidates: readonly CandidateMapFeature[];
  readonly stats: BuildingClusterStats;
}

/**
 * Bina gözlemlerini aynı gerçek nesne kümelerine ayırır.
 *
 * Karmaşıklık: bbox ön elemesiyle O(n·k). Sınırlı bölge (bir karo / küçük
 * bbox) için tasarlanmıştır — **tüm ülke tek seferde beslenmez** (YAGNI).
 */
export function clusterBuildingObservations(
  observations: readonly MapSourceObservation[],
  policy: BuildingMatchPolicy = DEFAULT_BUILDING_MATCH_POLICY,
): BuildingClusterResult {
  const sorted = canonicalSort((observations ?? []).filter((o) => o && o.kind === 'BUILDING'));
  const boxes = sorted.map((o) => bboxOf(o.geometry));

  const clusters: number[][] = [];
  let withoutGeometry = 0;

  for (let i = 0; i < sorted.length; i += 1) {
    if (boxes[i] === null) {
      // Geometrisiz gözlem KENDİ kümesinde kalır — sessizce atılmaz.
      withoutGeometry += 1;
      clusters.push([i]);
      continue;
    }
    let target = -1;
    for (let c = 0; c < clusters.length && target === -1; c += 1) {
      for (const j of clusters[c]) {
        if (boxes[j] === null) continue;
        if (!bboxIntersects(boxes[i], boxes[j], policy.bboxPadDeg)) continue;
        if (matchBuildings(sorted[i], sorted[j], policy).matched) { target = c; break; }
      }
    }
    if (target === -1) clusters.push([i]);
    else clusters[target].push(i);
  }

  const candidates: CandidateMapFeature[] = [];
  const singleSourceClusters: Partial<Record<MapDataSourceId, number>> = {};
  let multiSourceClusters = 0;

  for (const idx of clusters) {
    const members = canonicalSort(idx.map((i) => sorted[i]));
    const sources = new Set(members.map((m) => m.provenance.sourceId));
    if (sources.size > 1) multiSourceClusters += 1;
    else {
      const only = members[0].provenance.sourceId;
      singleSourceClusters[only] = (singleSourceClusters[only] ?? 0) + 1;
    }
    candidates.push({ kind: 'BUILDING', entityKey: clusterKey(members), observations: members });
  }

  // Çıktı sırası da deterministik olsun.
  candidates.sort((a, b) => a.entityKey.localeCompare(b.entityKey, 'en'));

  return {
    candidates,
    stats: {
      totalObservations: sorted.length,
      clusters: clusters.length,
      multiSourceClusters,
      singleSourceClusters,
      withoutGeometry,
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) ÇÖZÜM + AÇIKLAMA
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Küme içindeki footprint'leri **metrik olarak** mutabakat gruplarına ayırır.
 *
 * İki gözlem aynı gruba girer ancak ve ancak eşleşiyorlarsa VE alan oranları
 * `agreementMinAreaRatio` üstündeyse — yani "aynı yeri gösteriyor" değil,
 * "aynı şekli söylüyor". Böylece 300 m²'lik bir blok ile onun içindeki 80
 * m²'lik farklı bir footprint mutabakat SAYILMAZ.
 *
 * Grup anahtarı kümedeki kanonik ilk üyeye bağlanır → deterministik.
 */
export const AGREEMENT_MIN_AREA_RATIO = 0.75;

export function buildGeometryAgreementKeys(
  members: readonly MapSourceObservation[],
  policy: BuildingMatchPolicy = DEFAULT_BUILDING_MATCH_POLICY,
): ReadonlyMap<string, string> {
  const sorted = canonicalSort(members);
  const groups: MapSourceObservation[][] = [];
  for (const o of sorted) {
    let placed = false;
    for (const g of groups) {
      const v = matchBuildings(o, g[0], policy);
      if (v.matched && (v.overlap.areaRatio ?? 0) >= AGREEMENT_MIN_AREA_RATIO) {
        g.push(o);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([o]);
  }
  const keys = new Map<string, string>();
  for (const g of groups) {
    const key = `GEOM:${g[0].provenance.sourceId}:${g[0].provenance.sourceFeatureId}`;
    for (const o of g) keys.set(o.provenance.sourceFeatureId, key);
  }
  return keys;
}

export interface BuildingFusionResult {
  readonly features: readonly CanonicalMapFeature[];
  readonly stats: BuildingClusterStats;
  /** Yayımlanabilir (lisans geçti + geometri çözüldü) nesne sayısı. */
  readonly publishable: number;
  /** Hiçbir alanı çözülemeyen nesne sayısı. */
  readonly degraded: number;
}

export function fuseBuildings(
  observations: readonly MapSourceObservation[],
  options: ResolveOptions,
  policy: BuildingMatchPolicy = DEFAULT_BUILDING_MATCH_POLICY,
): BuildingFusionResult {
  const { candidates, stats } = clusterBuildingObservations(observations, policy);
  const features = candidates.map((c) => {
    // Geometri mutabakatı METRİK olarak ölçülür; genel çözücü bunu kendi
    // başına yapamaz (bkz. ResolveOptions.agreementKeyFor).
    const geomKeys = buildGeometryAgreementKeys(c.observations, policy);
    return resolveCandidate(c, {
      ...options,
      observationEligibleFor: (field, o) => {
        if (options.observationEligibleFor?.(field, o) === false) return false;
        return field !== 'geometry' || isCanonicalBuildingGeometryEligible(o);
      },
      agreementKeyFor: (field, o) => (field === 'geometry'
        ? geomKeys.get(o.provenance.sourceFeatureId) ?? null
        : null),
    });
  });
  return {
    features,
    stats,
    publishable: features.filter((f) => !f.degraded && f.license.verdict !== 'DENY' && f.geometry.value !== null).length,
    degraded: features.filter((f) => f.degraded).length,
  };
}

/**
 * Tek bir canonical binanın **neden bu geometriye sahip olduğu** — LAB ve
 * denetim için insan okunur gerekçe. Sayı uydurmaz: bilinmeyen alan yazılmaz.
 */
export function explainBuildingChoice(feature: CanonicalMapFeature): string {
  const g = feature.geometry;
  if (g.value === null) {
    return `KARARSIZ — geometri çözülemedi (${g.unknownReason ?? 'BİLİNMİYOR'}).`;
  }
  const area = polygonAreaM2(g.value);
  const parts = [
    `kaynak ${g.sourceId ?? 'BİLİNMİYOR'} (${g.sourceFeatureId ?? '—'})`,
    `güven ${g.confidence.toFixed(2)}`,
    `mutabakat ${g.agreementCount}`,
    area !== null ? `alan ${area.toFixed(0)} m²` : 'alan ÖLÇÜLEMEDİ',
    g.contested ? 'TARTIŞMALI' : 'tartışmasız',
    `aday ${g.scores.length}`,
  ];
  return parts.join(' · ');
}
