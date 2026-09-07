/**
 * mapDataObservation.ts — MAP DATA PLATFORM · F0 · KAYNAK GÖZLEMİ (SAF).
 *
 * SAF: I/O YOK · timer YOK · ağ YOK · global durum YOK · React YOK ·
 * `Date.now`/`performance.now` YOK. "Şimdi" DIŞARIDAN parametre gelir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── MERGE DEĞİL, EVIDENCE FUSION (bağlayıcı kural) ────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Aynı gerçek dünya nesnesi hakkında birden çok kaynak gözlem taşınır ve
 * **hiçbiri diğerinin üstüne YAZILMAZ**. OSM'in bina gözlemi, Overture'ın bina
 * gözlemi ve belediyenin bina gözlemi aynı `RealWorldEntity` altında YAN YANA
 * durur. Hangi ALANIN hangi gözlemden geleceğine çözücü (resolver) sonradan,
 * gerekçeli olarak karar verir.
 *
 * Bunun nedeni ölçülmüştür (`field-runs/map-data-coverage-20260907/REPORT.md`):
 * Tarsus'ta yol GEOMETRİSİ upstream'de var ama ADI yok; bina footprint'i bazı
 * çatılarda hiç yok; kapı numarası karoda var ama stil tüketmiyor. Tek bir
 * "kazanan kaynak" seçmek bu üç farklı kusuru aynı anda çözemez.
 *
 * ── İKİNCİ KANIT SİSTEMİ DEĞİLDİR ─────────────────────────────────────────
 * Kanıt sınıfı `navEvidence.EvidenceGrade`ten gelir; burada yeniden
 * tanımlanmaz. Bu dosya yalnız gözlemin KAYNAK/TAZELİK/KALİTE kanıtını taşır.
 */

import type { EvidenceGrade } from '../navigation/contracts/navEvidence';
import type { EpochMs, MapDataSourceId, MapDatasetRelease, MapFeatureField, MapFeatureKind } from './mapDataSource';
import { fieldAppliesToKind } from './mapDataSource';

/* ══════════════════════════════════════════════════════════════════════════
   1) GEOMETRİ — taşıyıcı tip (renderer/GeoJSON tipine BAĞLANMAZ)
   ══════════════════════════════════════════════════════════════════════════ */

/** `[lon, lat]` — GeoJSON eksen sırası. */
export type LonLat = readonly [number, number];

export type MapGeometry =
  | { readonly type: 'POINT'; readonly coordinates: LonLat }
  /** Dış halka + (varsa) iç halkalar. Halka kapalı varsayılır. */
  | { readonly type: 'POLYGON'; readonly rings: readonly (readonly LonLat[])[] }
  | { readonly type: 'MULTIPOLYGON'; readonly polygons: readonly (readonly (readonly LonLat[])[])[] }
  | { readonly type: 'LINESTRING'; readonly coordinates: readonly LonLat[] };

export function isFiniteLonLat(p: unknown): p is LonLat {
  return Array.isArray(p) && p.length === 2
    && typeof p[0] === 'number' && Number.isFinite(p[0]) && p[0] >= -180 && p[0] <= 180
    && typeof p[1] === 'number' && Number.isFinite(p[1]) && p[1] >= -90 && p[1] <= 90;
}

/** Geometri yapısal olarak geçerli mi. Geçersiz geometri gözleme GİRMEZ. */
export function isValidGeometry(g: unknown): g is MapGeometry {
  if (!g || typeof g !== 'object') return false;
  const geom = g as { type?: unknown; coordinates?: unknown; rings?: unknown };
  if (geom.type === 'POINT') return isFiniteLonLat(geom.coordinates);
  if (geom.type === 'LINESTRING') {
    return Array.isArray(geom.coordinates) && geom.coordinates.length >= 2
      && geom.coordinates.every(isFiniteLonLat);
  }
  if (geom.type === 'POLYGON') {
    if (!Array.isArray(geom.rings) || geom.rings.length === 0) return false;
    return geom.rings.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isFiniteLonLat));
  }
  if (geom.type === 'MULTIPOLYGON') {
    if (!Array.isArray((geom as { polygons?: unknown }).polygons)
      || (geom as { polygons: unknown[] }).polygons.length === 0) return false;
    return (geom as { polygons: unknown[] }).polygons.every((polygon) =>
      Array.isArray(polygon) && polygon.length > 0 && polygon.every((ring) =>
        Array.isArray(ring) && ring.length >= 4 && ring.every(isFiniteLonLat)));
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) TAZELİK — dataset zamanı, monotonik zaman DEĞİL
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Tazelik sınıfı. Navigasyonun `EvidenceGrade`inden AYRIDIR: orada "bu değere
 * güvenilir mi", burada "bu veri ne kadar eski". Bir veri TAZE ama DÜŞÜK
 * KALİTELİ olabilir; TAZE olmadığı hâlde tek kaynak olabilir.
 */
export type MapDataFreshnessClass = 'FRESH' | 'AGING' | 'STALE' | 'UNKNOWN';

export const MAP_FRESHNESS_CLASSES: readonly MapDataFreshnessClass[] = [
  'FRESH', 'AGING', 'STALE', 'UNKNOWN',
] as const;

export interface MapDataFreshness {
  readonly classification: MapDataFreshnessClass;
  /** Veri yaşı (ms). Damga yoksa `null` — sıfır UYDURULMAZ. */
  readonly ageMs: number | null;
  /** Bu sınıflandırmayı üreten bütçe (ms); `null` = bütçe tanımsız. */
  readonly budgetMs: number | null;
}

export const UNKNOWN_FRESHNESS: MapDataFreshness = {
  classification: 'UNKNOWN', ageMs: null, budgetMs: null,
};

/**
 * Kaynak başına tazelik bütçesi (ms). Değerler sağlayıcının ilan ettiği
 * güncelleme kadansından türetilir; UYDURMA yoktur — bilinmeyen kaynak
 * bütçesizdir (`null`) ve tazeliği HESAPLANMAZ.
 *
 * · OSM: ana API canlıdır (dakikalar) → 7 gün pratik bütçe.
 * · OPENFREEMAP: ölçülen paket kadansı ~aylık (30 Ağu paketi 7 Eylül'de
 *   hâlâ yayındaydı) → 45 gün.
 * · OVERTURE: ilan edilen sürüm kadansı aylık → 45 gün.
 */
export const SOURCE_FRESHNESS_BUDGET_MS: Readonly<Record<MapDataSourceId, number | null>> = {
  OSM: 7 * 24 * 60 * 60 * 1000,
  OPENFREEMAP: 45 * 24 * 60 * 60 * 1000,
  OVERTURE: 45 * 24 * 60 * 60 * 1000,
  TUCBS: null,
  MUNICIPALITY: null,
  LICENSED_PROVIDER: null,
  FIELD_OBSERVATION: 24 * 60 * 60 * 1000,
  DERIVED: null,
} as const;

/**
 * Tazelik sınıflandırması. Bütçenin YARISINA kadar `FRESH`, bütçeye kadar
 * `AGING`, sonrası `STALE`. Damga veya bütçe yoksa `UNKNOWN` — "taze" varsayımı
 * ASLA yapılmaz.
 */
export function classifyFreshness(
  observedAtEpochMs: EpochMs | null,
  nowEpochMs: EpochMs,
  budgetMs: number | null,
): MapDataFreshness {
  if (observedAtEpochMs === null || !Number.isFinite(observedAtEpochMs)) return UNKNOWN_FRESHNESS;
  if (!Number.isFinite(nowEpochMs)) return UNKNOWN_FRESHNESS;
  if (budgetMs === null || !Number.isFinite(budgetMs) || budgetMs <= 0) {
    return { classification: 'UNKNOWN', ageMs: null, budgetMs: null };
  }
  const ageMs = nowEpochMs - observedAtEpochMs;
  // Gelecek tarihli damga = bozuk kayıt; taze SAYILMAZ.
  if (ageMs < 0) return { classification: 'UNKNOWN', ageMs: null, budgetMs };
  if (ageMs <= budgetMs / 2) return { classification: 'FRESH', ageMs, budgetMs };
  if (ageMs <= budgetMs) return { classification: 'AGING', ageMs, budgetMs };
  return { classification: 'STALE', ageMs, budgetMs };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) KÖKEN — "bu gözlem tam olarak nereden geldi"
   ══════════════════════════════════════════════════════════════════════════ */

export interface MapDataProvenance {
  readonly sourceId: MapDataSourceId;
  /** Kaynağın kendi nesne kimliği (`way/216760925`, Overture GERS id…). */
  readonly sourceFeatureId: string;
  readonly release: MapDatasetRelease;
  /**
   * Kaydın KENDİ zaman damgası (OSM `timestamp`, Overture `update_time`).
   * `null` → sürüm tarihine DÜŞÜLMEZ; tazelik `UNKNOWN` kalır.
   */
  readonly recordUpdatedAtEpochMs: EpochMs | null;
  /**
   * Kaynağın ilan ettiği ALT kaynaklar (Overture `sources[].dataset` gibi).
   * ODbL yükümlülüğü bu listeden saptanır; boş dizi "alt kaynak yok" demek
   * DEĞİL, "ilan edilmedi" demektir.
   */
  readonly upstreamDatasets: readonly string[];
  /**
   * Kaydın KENDİ ilan ettiği lisans etiketleri (Overture `sources[].license`).
   * Boş dizi = kayıt düzeyinde lisans İLAN EDİLMEDİ → kaynak taban politikası
   * kullanılır. ÖLÇÜLDÜ (F1): Overture bina/yol kayıtları burada `ODbL-1.0`
   * taşır, place kayıtları permissive — bu yüzden hak kaynak kimliğinden
   * DEĞİL, buradan hesaplanır (`effectiveLicensePolicy`).
   */
  readonly recordLicenses: readonly string[];
}

/* ══════════════════════════════════════════════════════════════════════════
   4) KALİTE KANITI — güven UYDURULMAZ, ölçülür
   ══════════════════════════════════════════════════════════════════════════ */

export interface MapObservationQuality {
  /** Konumsal doğruluk (m). `null` = sağlayıcı bildirmedi. */
  readonly positionalAccuracyM: number | null;
  /** Geometri köşe sayısı — genelleştirme/basitleştirme göstergesi. */
  readonly vertexCount: number | null;
  /** Bu tür için tanımlı alanların kaçının dolu olduğu [0,1]. `null` = hesaplanmadı. */
  readonly attributeCompleteness: number | null;
  /** Kaynağın kendi doğrulama/onay işareti (belediye onaylı vb.). */
  readonly sourceVerified: boolean | null;
}

export const UNMEASURED_QUALITY: MapObservationQuality = {
  positionalAccuracyM: null, vertexCount: null,
  attributeCompleteness: null, sourceVerified: null,
};

/**
 * Öznitelik doluluğu — bu türde ANLAMLI alanların kaçı dolu.
 * Türe ait olmayan alanlar paydaya GİRMEZ (yol için `housenumber` beklenmez).
 */
export function computeAttributeCompleteness(
  kind: MapFeatureKind,
  fields: Readonly<Partial<Record<MapFeatureField, unknown>>>,
  expected: readonly MapFeatureField[],
): number | null {
  const applicable = expected.filter((f) => fieldAppliesToKind(kind, f));
  if (applicable.length === 0) return null;
  let filled = 0;
  for (const f of applicable) {
    const v = fields[f];
    if (v !== undefined && v !== null && v !== '') filled += 1;
  }
  return filled / applicable.length;
}

/* ══════════════════════════════════════════════════════════════════════════
   5) KAYNAK GÖZLEMİ VE ADAY NESNE
   ══════════════════════════════════════════════════════════════════════════ */

/** Bir alanın bir kaynaktaki ham değeri. `null` = kaynakta YOK (boş string DEĞİL). */
export type MapFieldValue = string | number | boolean | null;

/**
 * TEK bir kaynağın TEK bir gerçek dünya nesnesi hakkındaki gözlemi.
 * **Değiştirilemez ve başka gözlemle birleştirilmez.**
 */
export interface MapSourceObservation {
  readonly kind: MapFeatureKind;
  readonly provenance: MapDataProvenance;
  readonly geometry: MapGeometry | null;
  readonly fields: Readonly<Partial<Record<MapFeatureField, MapFieldValue>>>;
  readonly quality: MapObservationQuality;
  readonly freshness: MapDataFreshness;
  /**
   * Gözlemin kanıt sınıfı (`navEvidence` sözlüğü). Kaynaktan doğrudan okunan
   * gözlem `OBSERVED`; başka gözlemlerden hesaplanan `DERIVED`; kayıt var ama
   * kullanılamaz durumdaysa `UNAVAILABLE`; tazelik bütçesi aşıldıysa `STALE`.
   */
  readonly grade: EvidenceGrade;
}

/**
 * Normalizasyon/doğrulama sonrası, HENÜZ çözülmemiş aday. Aynı gerçek dünya
 * nesnesine ait olduğu düşünülen gözlemler burada YAN YANA durur.
 *
 * `entityKey` bir eşleştirme ANAHTARIDIR, kalıcı kimlik değildir: eşleştirme
 * algoritması değişirse anahtar da değişir. Kalıcı kimlik canonical çıktıda
 * üretilir.
 */
export interface CandidateMapFeature {
  readonly kind: MapFeatureKind;
  readonly entityKey: string;
  readonly observations: readonly MapSourceObservation[];
}

export function observationSources(c: CandidateMapFeature | null | undefined): readonly MapDataSourceId[] {
  if (!c || !Array.isArray(c.observations)) return [];
  const out: MapDataSourceId[] = [];
  for (const o of c.observations) {
    if (o?.provenance?.sourceId && !out.includes(o.provenance.sourceId)) out.push(o.provenance.sourceId);
  }
  return out;
}

/** Bir alan için değer TAŞIYAN gözlemler (değeri `null`/boş olanlar elenir). */
export function observationsWithField(
  c: CandidateMapFeature | null | undefined,
  field: MapFeatureField,
): readonly MapSourceObservation[] {
  if (!c || !Array.isArray(c.observations)) return [];
  return c.observations.filter((o) => {
    if (!o || !fieldAppliesToKind(o.kind, field)) return false;
    if (field === 'geometry') return o.geometry !== null;
    const v = o.fields?.[field];
    return v !== undefined && v !== null && v !== '';
  });
}

/**
 * Aday yapısal olarak geçerli mi. Gözlemsiz aday, tür karışımı ve geçersiz
 * geometri REDDEDİLİR — bozuk aday çözüme sokulmaz.
 */
export function isValidCandidate(c: unknown): c is CandidateMapFeature {
  if (!c || typeof c !== 'object') return false;
  const cand = c as CandidateMapFeature;
  if (typeof cand.entityKey !== 'string' || cand.entityKey.length === 0) return false;
  if (!Array.isArray(cand.observations) || cand.observations.length === 0) return false;
  return cand.observations.every((o) =>
    !!o && o.kind === cand.kind
    && (o.geometry === null || isValidGeometry(o.geometry))
    && typeof o.provenance?.sourceFeatureId === 'string'
    && o.provenance.sourceFeatureId.length > 0);
}
