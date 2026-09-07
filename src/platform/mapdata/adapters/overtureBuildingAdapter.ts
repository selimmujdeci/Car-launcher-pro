/**
 * overtureBuildingAdapter.ts — MAP DATA PLATFORM · F2 · OVERTURE BINA ADAPTÖRÜ (SAF).
 *
 * SAF: I/O YOK · ağ YOK · timer YOK · saat YOK. Çekim çağıranın işidir.
 *
 * ── NEDEN YALNIZ BINA ─────────────────────────────────────────────────────
 * MAPDATA-F1 ölçümü (Tarsus z14/9778/6381, sürüm 2026-08-19.0):
 *   · bina: OSM 340 → Overture 2627 (dedup edilmiş GERÇEK artış 2290);
 *     yakın 400×400 m alanda 11 → 123.
 *   · yol adı: yalnız Overture'da 3 ayrık ad, üçü de yerel sokak DEĞİL.
 *   · adres: Overture bu bbox'ta 0 kayıt (üretim karosunda 7 var).
 * Yani Overture'ın kanıtlanmış katkısı BINA tarafındadır. Yol adı ve adres
 * için adaptör YAZILMADI — kanıtsız ingestion yapılmaz.
 *
 * ── LİSANS ────────────────────────────────────────────────────────────────
 * Kayıt düzeyi `sources[].license` AYNEN taşınır (`recordLicenses`). Ölçümde
 * bina kayıtlarının 2627/2627'si ODbL-1.0'dır: Overture'ın permissive DAĞITIM
 * lisansı bu temada share-alike'ı kaldırmaz. Hak hesabı `effectiveLicensePolicy`
 * içinde yapılır; adaptör hak UYDURMAZ, yalnız ilan edileni taşır.
 *
 * ── ML FOOTPRINT DÜRÜSTLÜĞÜ ───────────────────────────────────────────────
 * `Microsoft ML Buildings` / `Google Open Buildings` gibi türetilmiş kümeler
 * **algoritma çıktısıdır, yer gerçeği değildir**. Bu kayıtlar `sourceVerified:
 * false` ile işaretlenir ve kanıt sınıfı `DERIVED` olur — `OBSERVED` DEĞİL.
 * Böylece çözücü, insan tarafından girilmiş bir gözlemle makine çıktısını
 * aynı kefeye koymaz.
 */

import type { MapGeometry, LonLat } from '../mapDataObservation';
import { classifyFreshness, computeAttributeCompleteness, isValidGeometry, SOURCE_FRESHNESS_BUDGET_MS } from '../mapDataObservation';
import { FIELDS_BY_KIND } from '../mapDataSource';
import type { AdapterContext, AdapterResult, MapSourceAdapter } from './adapterContract';
import { accepted, parseIsoEpochMs, rejected } from './adapterContract';

/* ── Ham kayıt biçimi (Overture GeoParquet satırının JSON karşılığı) ─────── */

export interface OvertureSourceRef {
  readonly dataset?: string | null;
  readonly license?: string | null;
  readonly record_id?: string | null;
  readonly update_time?: string | null;
  readonly confidence?: number | null;
}

export interface OvertureBuildingRaw {
  readonly id?: string | null;
  /** Overture `names.primary` (çekimde düzleştirilmiş olabilir). */
  readonly name?: string | null;
  readonly names?: { readonly primary?: string | null } | null;
  readonly height?: number | null;
  readonly num_floors?: number | null;
  readonly class?: string | null;
  readonly subtype?: string | null;
  readonly sources?: readonly OvertureSourceRef[] | null;
  /** GeoJSON `Polygon` veya `MultiPolygon` nesnesi. */
  readonly geometry?: unknown;
}

/** Türetilmiş (makine üretimi) footprint kümeleri — insan gözlemi DEĞİL. */
const ML_DATASET_PATTERN = /\b(ml|machine\s*learning|open\s*buildings)\b/i;

export function isMachineDerivedDataset(dataset: string | null | undefined): boolean {
  return typeof dataset === 'string' && ML_DATASET_PATTERN.test(dataset);
}

/* ── Geometri dönüşümü ───────────────────────────────────────────────────── */

function toRing(coords: unknown): readonly LonLat[] | null {
  if (!Array.isArray(coords)) return null;
  const ring: LonLat[] = [];
  for (const c of coords) {
    if (!Array.isArray(c) || c.length < 2) return null;
    const lon = c[0], lat = c[1];
    if (typeof lon !== 'number' || typeof lat !== 'number') return null;
    ring.push([lon, lat]);
  }
  return ring;
}

/**
 * GeoJSON Polygon/MultiPolygon → canonical `POLYGON`.
 * MultiPolygon'da **yalnız EN BÜYÜK halka sayısına sahip ilk parça** değil,
 * TÜM parçaların dış halkaları taşınır: bina parçalarını sessizce atmak
 * kapsam kaybıdır. İç halkalar (avlu) korunur.
 */
export function overtureGeometryToCanonical(geometry: unknown): MapGeometry | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const g = geometry as { type?: unknown; coordinates?: unknown };
  const rings: (readonly LonLat[])[] = [];
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
    for (const r of g.coordinates) {
      const ring = toRing(r);
      if (!ring) return null;
      rings.push(ring);
    }
  } else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    const polygons: (readonly (readonly LonLat[])[])[] = [];
    for (const poly of g.coordinates) {
      if (!Array.isArray(poly)) return null;
      const polygon: (readonly LonLat[])[] = [];
      for (const r of poly) {
        const ring = toRing(r);
        if (!ring) return null;
        polygon.push(ring);
      }
      if (polygon.length === 0) return null;
      polygons.push(polygon);
    }
    const out: MapGeometry = { type: 'MULTIPOLYGON', polygons };
    return isValidGeometry(out) ? out : null;
  } else return null;

  if (rings.length === 0) return null;
  const out: MapGeometry = { type: 'POLYGON', rings };
  return isValidGeometry(out) ? out : null;
}

/* ── Adaptör ─────────────────────────────────────────────────────────────── */

export const overtureBuildingAdapter: MapSourceAdapter<OvertureBuildingRaw> = {
  sourceId: 'OVERTURE',
  kind: 'BUILDING',

  normalize(raw: OvertureBuildingRaw, ctx: AdapterContext): AdapterResult {
    const id = typeof raw?.id === 'string' && raw.id.length > 0 ? raw.id : null;
    if (!id) return rejected('MISSING_SOURCE_ID', null);

    const geometry = overtureGeometryToCanonical(raw.geometry);
    if (!geometry) return rejected('INVALID_GEOMETRY', id);

    const sources = Array.isArray(raw.sources) ? raw.sources : [];
    const datasets = sources.map((s) => (typeof s?.dataset === 'string' ? s.dataset : 'UNKNOWN'));
    const recordLicenses = [...new Set(
      sources.map((s) => s?.license).filter((l): l is string => typeof l === 'string' && l.length > 0),
    )];

    // Kaydın kendi zamanı: alt kaynakların EN YENİ damgası. Hiçbiri yoksa
    // `null` — sürüm tarihine DÜŞÜLMEZ (tazelik UNKNOWN kalır).
    let recordUpdatedAtEpochMs: number | null = null;
    for (const s of sources) {
      const t = parseIsoEpochMs(s?.update_time);
      if (t !== null && (recordUpdatedAtEpochMs === null || t > recordUpdatedAtEpochMs)) {
        recordUpdatedAtEpochMs = t;
      }
    }

    const name = (typeof raw.name === 'string' && raw.name.length > 0)
      ? raw.name
      : (typeof raw.names?.primary === 'string' && raw.names.primary.length > 0 ? raw.names.primary : null);

    const fields: Record<string, string | number | boolean | null> = {};
    if (name !== null) fields.name = name;
    if (typeof raw.height === 'number' && Number.isFinite(raw.height)) fields.height = raw.height;
    if (typeof raw.num_floors === 'number' && Number.isFinite(raw.num_floors)) fields.levels = raw.num_floors;

    // Yalnız geometri taşıyan kayıt GEÇERLİDİR (Tarsus kazancının tamamı
    // öznitelisiz footprint'tir) — `EMPTY_RECORD` yalnız geometri de yoksa.

    const machineDerived = datasets.length > 0 && datasets.every(isMachineDerivedDataset);
    const vertexCount = geometry.type === 'POLYGON'
      ? geometry.rings.reduce((n, r) => n + r.length, 0)
      : geometry.type === 'MULTIPOLYGON'
        ? geometry.polygons.flat().reduce((n, r) => n + r.length, 0) : null;

    return accepted({
      kind: 'BUILDING',
      provenance: {
        sourceId: 'OVERTURE',
        sourceFeatureId: id,
        release: ctx.release,
        recordUpdatedAtEpochMs,
        upstreamDatasets: datasets,
        recordLicenses,
      },
      geometry,
      fields,
      quality: {
        // Overture konumsal doğruluk BİLDİRMEZ → uydurulmaz.
        positionalAccuracyM: null,
        vertexCount,
        attributeCompleteness: computeAttributeCompleteness('BUILDING', fields, FIELDS_BY_KIND.BUILDING),
        // Makine türevi footprint doğrulanmamıştır; OSM kökenli kayıt için
        // "doğrulandı" iddiası da yoktur → `null` (bilinmiyor).
        sourceVerified: machineDerived ? false : null,
      },
      freshness: classifyFreshness(
        recordUpdatedAtEpochMs, ctx.nowEpochMs, SOURCE_FRESHNESS_BUDGET_MS.OVERTURE,
      ),
      // Makine çıktısı `DERIVED`; insan kaydı `OBSERVED`.
      grade: machineDerived ? 'DERIVED' : 'OBSERVED',
    });
  },
};
