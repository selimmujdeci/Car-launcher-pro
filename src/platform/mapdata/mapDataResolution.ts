/**
 * mapDataResolution.ts — MAP DATA PLATFORM · F0 · CANONICAL ÇÖZÜM (SAF).
 *
 * SAF: I/O YOK · timer YOK · ağ YOK · global durum YOK · React YOK ·
 * `Date.now`/`performance.now` YOK. Rastgelelik YOK — aynı girdi aynı çıktı.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NE YAPAR ──────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `CandidateMapFeature` içindeki YAN YANA duran kaynak gözlemlerinden
 * **ALAN ALAN** canonical değeri seçer ve **neden seçtiğini** taşır.
 *
 * ── SABİT ÖNCELİK LİSTESİ DEĞİLDİR (bağlayıcı) ────────────────────────────
 * `municipality > Overture > OSM` gibi kör sıralama YASAK. Karar dört kanıt
 * ekseninin ağırlıklı toplamıdır:
 *
 *   1. TAZELİK      (freshness)     — veri ne kadar eski
 *   2. MUTABAKAT    (agreement)     — kaç bağımsız kaynak aynı şeyi diyor
 *   3. KALİTE       (quality)       — doğruluk · köşe yoğunluğu · doluluk
 *   4. YETKİ ÖNSELİ (authority)     — o ALAN için kaynağın ölçülmüş uygunluğu
 *
 * Yetki önseli yalnız DÖRTTE BİR ağırlıktadır; tek başına karar VERMEZ. Taze
 * ve mutabık bir OSM gözlemi, bayat bir "yüksek yetkili" gözlemi yenebilir.
 *
 * ── LİSANS ÖNCE GELİR ─────────────────────────────────────────────────────
 * Lisans kapısından geçemeyen gözlem **düşük puanlanmaz, ELENİR**. Hak yoksa
 * veri yoktur; puanlama hak yerine geçmez.
 *
 * ── UNKNOWN > UYDURMA ─────────────────────────────────────────────────────
 * Uygun gözlem yoksa alan `UNKNOWN` kalır ve gerekçesi yazılır. Boş string,
 * sahte 0 veya "muhtemelen" değeri ÜRETİLMEZ.
 */

import type { EvidenceGrade } from '../navigation/contracts/navEvidence';
import type { MapDataSourceId, MapFeatureField, MapFeatureKind } from './mapDataSource';
import { FIELDS_BY_KIND, fieldAppliesToKind } from './mapDataSource';
import type { LicenseGateResult, MapDataUseIntent } from './mapDataLicense';
import { effectiveLicensePolicy, evaluateLicenseGate, evaluateFusionLicenseGate } from './mapDataLicense';
import type {
  CandidateMapFeature, MapFieldValue, MapGeometry, MapSourceObservation,
} from './mapDataObservation';
import { isValidCandidate, observationsWithField } from './mapDataObservation';

/* ══════════════════════════════════════════════════════════════════════════
   1) HÜKÜM SÖZLÜĞÜ
   ══════════════════════════════════════════════════════════════════════════ */

/** Bir alanın neden çözülemediği. Boş/serbest metin YOK — makine sözleşmesi. */
export type MapFieldUnknownReason =
  /** Bu alan bu tür için anlamlı değil (yol için `housenumber` gibi). */
  | 'FIELD_NOT_APPLICABLE'
  /** Hiçbir kaynak bu alan için değer taşımıyor. */
  | 'NO_OBSERVATION'
  /** Değer taşıyan tüm gözlemler lisans kapısında elendi. */
  | 'LICENSE_BLOCKED'
  /** Değer var ama hiçbiri kalite eşiğini geçmedi. */
  | 'BELOW_QUALITY_GATE';

export const MAP_FIELD_UNKNOWN_REASONS: readonly MapFieldUnknownReason[] = [
  'FIELD_NOT_APPLICABLE', 'NO_OBSERVATION', 'LICENSE_BLOCKED', 'BELOW_QUALITY_GATE',
] as const;

/** Tek bir kaynağın tek bir alan için aldığı puan — açıklanabilirlik kaydı. */
export interface FieldScoreBreakdown {
  readonly sourceId: MapDataSourceId;
  readonly sourceFeatureId: string;
  readonly freshnessScore: number;
  readonly agreementScore: number;
  readonly qualityScore: number;
  readonly authorityScore: number;
  readonly total: number;
}

/** Bir alanın çözüm sonucu. Değer varsa DAİMA gerekçesi ve kaynağı vardır. */
export interface ResolvedField<T extends MapFieldValue | MapGeometry> {
  readonly field: MapFeatureField;
  readonly value: T | null;
  readonly grade: EvidenceGrade;
  /** Değeri veren kaynak; `UNKNOWN` sonuçta `null`. */
  readonly sourceId: MapDataSourceId | null;
  readonly sourceFeatureId: string | null;
  readonly confidence: number;
  /** `value === null` iken DAİMA dolu; aksi hâlde `null`. */
  readonly unknownReason: MapFieldUnknownReason | null;
  /** Kazanan ile ikinci arasındaki fark eşiğin altında ve değerler ÇELİŞİYOR. */
  readonly contested: boolean;
  /** Aynı değeri destekleyen bağımsız kaynak sayısı (kazanan dâhil). */
  readonly agreementCount: number;
  /** Tüm adayların puan dökümü — LAB'ta "neden bu?" sorusunun cevabı. */
  readonly scores: readonly FieldScoreBreakdown[];
}

/** Canonical nesne — çözülmüş alanların ve lisans yükümlülüğünün taşıyıcısı. */
export interface CanonicalMapFeature {
  readonly kind: MapFeatureKind;
  readonly entityKey: string;
  readonly geometry: ResolvedField<MapGeometry>;
  readonly fields: Readonly<Partial<Record<MapFeatureField, ResolvedField<MapFieldValue>>>>;
  /** Canonical çıktıya KATKI VEREN kaynaklar (elenenler dâhil DEĞİL). */
  readonly contributingSources: readonly MapDataSourceId[];
  /** Çıktının bu niyetle dağıtılabilirliği ve atıf yükümlülüğü. */
  readonly license: LicenseGateResult;
  /** Hiçbir alanı çözülemeyen nesne — üretime çıkmamalı. */
  readonly degraded: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) PUANLAMA EKSENLERİ
   ══════════════════════════════════════════════════════════════════════════ */

export interface ResolutionWeights {
  readonly freshness: number;
  readonly agreement: number;
  readonly quality: number;
  readonly authority: number;
}

/**
 * Varsayılan ağırlıklar. Dördü EŞİTTİR: hiçbir eksen — yetki önseli dâhil —
 * tek başına belirleyici değildir. Toplamları 1'dir.
 */
export const DEFAULT_RESOLUTION_WEIGHTS: ResolutionWeights = {
  freshness: 0.25, agreement: 0.25, quality: 0.25, authority: 0.25,
};

/** İki puan bu farkın altındaysa kazanan "tartışmalı" sayılır. */
export const CONTESTED_SCORE_EPSILON = 0.05;

/** Tazelik sınıfının puanı. `UNKNOWN` nötrün ALTINDADIR — bilmemek ödül değil. */
const FRESHNESS_SCORE: Readonly<Record<string, number>> = {
  FRESH: 1, AGING: 0.6, STALE: 0.2, UNKNOWN: 0.35,
};

/**
 * ALAN BAZLI yetki önseli [0,1] — sabit kaynak sıralaması DEĞİL, yalnız dörtte
 * birlik bir terim. Değerler gerekçelidir:
 *
 * · BUILDING/geometry — Overture bina temasında OSM + ML footprint kümelerini
 *   birleştirir; OSM tek başına ölçülmüş kapsam boşluğu gösterdi (Tarsus'ta
 *   uydu görüntüsündeki üç çatı hiçbir OSM/production polygon'una düşmedi).
 * · ROAD/name — yerel yol adında belediye/kamu kaydı doğrudan otoritedir;
 *   ölçüm OSM'de 426/564 adsız way gösterdi.
 * · ADDRESS/housenumber — adres yetkisi idari kayıttadır.
 * · Bilinmeyen/serbest kaynaklar 0.3 nötr-altı alır; kanıt gelirse yükselir.
 */
const AUTHORITY_PRIOR: Readonly<Record<string, Readonly<Partial<Record<MapDataSourceId, number>>>>> = {
  'BUILDING:geometry': { MUNICIPALITY: 0.9, OVERTURE: 0.8, OSM: 0.7, OPENFREEMAP: 0.5, TUCBS: 0.85 },
  'BUILDING:height': { OVERTURE: 0.8, OSM: 0.6, OPENFREEMAP: 0.4, MUNICIPALITY: 0.7, TUCBS: 0.7 },
  'ROAD:geometry': { OSM: 0.85, OVERTURE: 0.8, OPENFREEMAP: 0.6, MUNICIPALITY: 0.7, TUCBS: 0.75 },
  'ROAD:name': { MUNICIPALITY: 0.95, TUCBS: 0.9, OSM: 0.7, OVERTURE: 0.7, OPENFREEMAP: 0.5 },
  'ROAD:roadClass': { OSM: 0.85, OVERTURE: 0.75, OPENFREEMAP: 0.6 },
  'ADDRESS:housenumber': { MUNICIPALITY: 0.95, TUCBS: 0.9, OVERTURE: 0.75, OSM: 0.7, OPENFREEMAP: 0.4 },
  'ADDRESS:street': { MUNICIPALITY: 0.95, TUCBS: 0.9, OVERTURE: 0.75, OSM: 0.7, OPENFREEMAP: 0.4 },
  'PLACE:name': { OVERTURE: 0.8, OSM: 0.75, MUNICIPALITY: 0.7, OPENFREEMAP: 0.4 },
  'PLACE:category': { OVERTURE: 0.85, OSM: 0.7, OPENFREEMAP: 0.35 },
};

/** Hiçbir önsel tanımlı değilse kullanılan nötr-altı puan. */
export const NEUTRAL_AUTHORITY_PRIOR = 0.3;

export function authorityPrior(
  kind: MapFeatureKind, field: MapFeatureField, sourceId: MapDataSourceId,
): number {
  const row = AUTHORITY_PRIOR[`${kind}:${field}`];
  const v = row?.[sourceId];
  return typeof v === 'number' && Number.isFinite(v) ? v : NEUTRAL_AUTHORITY_PRIOR;
}

/** Ölçülmemiş kalite nötr-altı 0.4 alır — "ölçmedik" yüksek puan değildir. */
function qualityScore(o: MapSourceObservation): number {
  const q = o.quality;
  const parts: number[] = [];
  if (typeof q.positionalAccuracyM === 'number' && Number.isFinite(q.positionalAccuracyM)) {
    // 1 m → 1.0 · 10 m → ~0.5 · 25 m ve üstü → 0.2
    parts.push(Math.max(0.2, Math.min(1, 10 / (q.positionalAccuracyM + 9))));
  }
  if (typeof q.attributeCompleteness === 'number' && Number.isFinite(q.attributeCompleteness)) {
    parts.push(Math.max(0, Math.min(1, q.attributeCompleteness)));
  }
  if (q.sourceVerified === true) parts.push(1);
  else if (q.sourceVerified === false) parts.push(0.4);
  if (parts.length === 0) return 0.4;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/** Değerlerin karşılaştırma anahtarı — mutabakat sayımı için. */
function agreementKey(field: MapFeatureField, o: MapSourceObservation): string {
  if (field === 'geometry') {
    const g = o.geometry;
    if (!g) return 'NONE';
    // Geometri eşitliği metrik bir sorudur (F3 BuildingResolver'ın işi).
    // Burada yalnız TÜR bazında kaba mutabakat sayılır; yanlış kesinlik
    // üretmemek için koordinat karşılaştırması YAPILMAZ.
    return `GEOM:${g.type}`;
  }
  const v = o.fields?.[field];
  if (v === undefined || v === null) return 'NONE';
  return typeof v === 'string' ? `S:${v.trim().toLocaleLowerCase('tr-TR')}` : `V:${String(v)}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) ALAN ÇÖZÜMÜ
   ══════════════════════════════════════════════════════════════════════════ */

export interface ResolveOptions {
  readonly intent: MapDataUseIntent;
  readonly weights?: ResolutionWeights;
  /** Bu puanın altındaki en iyi aday bile kabul EDİLMEZ. */
  readonly minAcceptedScore?: number;
}

export const DEFAULT_MIN_ACCEPTED_SCORE = 0.25;

function emptyResolution(
  field: MapFeatureField, reason: MapFieldUnknownReason,
): ResolvedField<never> {
  return {
    field, value: null, grade: 'UNAVAILABLE', sourceId: null, sourceFeatureId: null,
    confidence: 0, unknownReason: reason, contested: false, agreementCount: 0, scores: [],
  };
}

/**
 * TEK bir alanı çözer. Deterministik: eşit puanda kaynak kimliği alfabetik ve
 * ardından kaynak nesne kimliği alfabetik sıraya göre kırılır — böylece aynı
 * girdi her koşuda aynı çıktıyı verir.
 */
export function resolveField<T extends MapFieldValue | MapGeometry>(
  candidate: CandidateMapFeature,
  field: MapFeatureField,
  options: ResolveOptions,
): ResolvedField<T> {
  if (!isValidCandidate(candidate)) return emptyResolution(field, 'NO_OBSERVATION') as ResolvedField<T>;
  if (!fieldAppliesToKind(candidate.kind, field)) {
    return emptyResolution(field, 'FIELD_NOT_APPLICABLE') as ResolvedField<T>;
  }

  const withValue = observationsWithField(candidate, field);
  if (withValue.length === 0) return emptyResolution(field, 'NO_OBSERVATION') as ResolvedField<T>;

  // 1) LİSANS — elenir, düşük puanlanmaz.
  // Hak KAYIT düzeyinden hesaplanır: aynı kaynağın iki kaydı farklı lisans
  // taşıyabilir (ölçüldü — Overture buildings ODbL, places permissive).
  const eligible = withValue.filter(
    (o) => evaluateLicenseGate(
      effectiveLicensePolicy(o.provenance.sourceId, o.provenance.recordLicenses),
      options.intent,
    ).verdict !== 'DENY',
  );
  if (eligible.length === 0) return emptyResolution(field, 'LICENSE_BLOCKED') as ResolvedField<T>;

  // 2) MUTABAKAT — aynı değeri söyleyen BAĞIMSIZ kaynak sayısı.
  const keyCounts = new Map<string, Set<MapDataSourceId>>();
  for (const o of eligible) {
    const k = agreementKey(field, o);
    const set = keyCounts.get(k) ?? new Set<MapDataSourceId>();
    set.add(o.provenance.sourceId);
    keyCounts.set(k, set);
  }
  const distinctSources = new Set(eligible.map((o) => o.provenance.sourceId)).size;

  const w = options.weights ?? DEFAULT_RESOLUTION_WEIGHTS;
  const scores: FieldScoreBreakdown[] = eligible.map((o) => {
    const freshnessScore = FRESHNESS_SCORE[o.freshness.classification] ?? 0.35;
    const supporters = keyCounts.get(agreementKey(field, o))?.size ?? 1;
    const agreementScore = distinctSources <= 1 ? 0.5 : (supporters - 1) / (distinctSources - 1);
    const q = qualityScore(o);
    const authority = authorityPrior(candidate.kind, field, o.provenance.sourceId);
    const total = w.freshness * freshnessScore + w.agreement * agreementScore
      + w.quality * q + w.authority * authority;
    return {
      sourceId: o.provenance.sourceId,
      sourceFeatureId: o.provenance.sourceFeatureId,
      freshnessScore, agreementScore, qualityScore: q, authorityScore: authority,
      total,
    };
  });

  // 3) Deterministik sıralama.
  const order = eligible
    .map((o, i) => ({ o, s: scores[i] }))
    .sort((a, b) => (b.s.total - a.s.total)
      || a.s.sourceId.localeCompare(b.s.sourceId, 'en')
      || a.s.sourceFeatureId.localeCompare(b.s.sourceFeatureId, 'en'));

  const best = order[0];
  const minScore = options.minAcceptedScore ?? DEFAULT_MIN_ACCEPTED_SCORE;
  if (best.s.total < minScore) return emptyResolution(field, 'BELOW_QUALITY_GATE') as ResolvedField<T>;

  const bestKey = agreementKey(field, best.o);
  const runnerUp = order[1];
  const contested = !!runnerUp
    && (best.s.total - runnerUp.s.total) < CONTESTED_SCORE_EPSILON
    && agreementKey(field, runnerUp.o) !== bestKey;

  const agreementCount = keyCounts.get(bestKey)?.size ?? 1;
  const value = (field === 'geometry' ? best.o.geometry : best.o.fields?.[field] ?? null) as T | null;
  if (value === null) return emptyResolution(field, 'NO_OBSERVATION') as ResolvedField<T>;

  // Güven puandan gelir; çelişki varsa tavan uygulanır — çelişkili alan
  // "kesin" olarak yayınlanamaz.
  const confidence = contested ? Math.min(best.s.total, 0.5) : Math.min(best.s.total, 0.95);

  return {
    field,
    value,
    grade: best.o.grade === 'STALE' ? 'STALE' : 'OBSERVED',
    sourceId: best.s.sourceId,
    sourceFeatureId: best.s.sourceFeatureId,
    confidence,
    unknownReason: null,
    contested,
    agreementCount,
    scores: order.map((x) => x.s),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) NESNE ÇÖZÜMÜ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Adayı canonical nesneye çözer. Tüm alanlar `UNKNOWN` kalırsa nesne
 * `degraded` işaretlenir — üretim çıktısına ALINMAMALIDIR.
 */
export function resolveCandidate(
  candidate: CandidateMapFeature,
  options: ResolveOptions,
): CanonicalMapFeature {
  const kind = candidate?.kind ?? 'BUILDING';
  const geometry = resolveField<MapGeometry>(candidate, 'geometry', options);
  const fields: Partial<Record<MapFeatureField, ResolvedField<MapFieldValue>>> = {};

  for (const field of FIELDS_BY_KIND[kind] ?? []) {
    if (field === 'geometry') continue;
    fields[field] = resolveField<MapFieldValue>(candidate, field, options);
  }

  const contributing: MapDataSourceId[] = [];
  const push = (id: MapDataSourceId | null): void => {
    if (id && !contributing.includes(id)) contributing.push(id);
  };
  push(geometry.sourceId);
  for (const r of Object.values(fields)) push(r?.sourceId ?? null);

  // Fusion kapısı yalnız kaynak kimliğine bakarsa kayıt düzeyi ODbL yükümlülüğü
  // kaybolur; bu yüzden KAZANAN gözlemlerin kayıt lisansları kaynak başına
  // toplanıp kapıya verilir (ölçüldü: Overture buildings ODbL, places permissive).
  const winners = new Set<string>([geometry.sourceFeatureId ?? '',
    ...Object.values(fields).map((r) => r?.sourceFeatureId ?? '')].filter(Boolean));
  const recordLicensesBySource: Partial<Record<MapDataSourceId, string[]>> = {};
  for (const o of candidate?.observations ?? []) {
    if (!winners.has(o.provenance.sourceFeatureId)) continue;
    const bucket = recordLicensesBySource[o.provenance.sourceId] ?? [];
    for (const l of o.provenance.recordLicenses ?? []) if (!bucket.includes(l)) bucket.push(l);
    recordLicensesBySource[o.provenance.sourceId] = bucket;
  }
  const license = evaluateFusionLicenseGate(contributing, options.intent, recordLicensesBySource);
  const degraded = geometry.value === null
    && Object.values(fields).every((r) => !r || r.value === null);

  return {
    kind,
    entityKey: candidate?.entityKey ?? 'UNKNOWN',
    geometry,
    fields,
    contributingSources: contributing,
    license,
    degraded,
  };
}

/**
 * Canonical nesne üretime/pakete çıkabilir mi. Lisans REDDİ veya tamamen
 * çözülememiş nesne GEÇEMEZ — bu kapı fail-closed'dır.
 */
export function isPublishable(f: CanonicalMapFeature | null | undefined): boolean {
  if (!f) return false;
  if (f.degraded) return false;
  if (f.license.verdict === 'DENY') return false;
  return f.geometry.value !== null;
}
