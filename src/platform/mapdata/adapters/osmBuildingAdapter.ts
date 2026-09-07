/**
 * osmBuildingAdapter.ts — MAP DATA PLATFORM · F2 · OSM BINA ADAPTÖRÜ (SAF).
 *
 * SAF: I/O YOK · ağ YOK · timer YOK · saat YOK. Düğüm çözümü (node id →
 * koordinat) ÇAĞIRANIN işidir; adaptör hazır halka alır.
 *
 * ── NEDEN GEREKLİ ─────────────────────────────────────────────────────────
 * Fusion iki kaynaklı olmadan anlamsızdır. OSM bugünkü üretim karosunun
 * (OpenFreeMap) upstream'idir ve **insan tarafından girilmiş** gözlemdir;
 * Overture'ın ML footprint'lerinden epistemik olarak farklıdır. İkisi yan
 * yana durmadan "hangi footprint canonical" sorusu sorulamaz.
 */

import type { LonLat, MapGeometry, MapFieldValue } from '../mapDataObservation';
import { classifyFreshness, computeAttributeCompleteness, isValidGeometry, SOURCE_FRESHNESS_BUDGET_MS } from '../mapDataObservation';
import { FIELDS_BY_KIND } from '../mapDataSource';
import type { AdapterContext, AdapterResult, MapSourceAdapter } from './adapterContract';
import { accepted, parseIsoEpochMs, rejected } from './adapterContract';

/** OSM way — düğümleri çağıran tarafından koordinata çözülmüş hâlde. */
export interface OsmBuildingRaw {
  readonly id?: number | string | null;
  readonly type?: string | null;
  readonly timestamp?: string | null;
  readonly version?: number | null;
  readonly tags?: Readonly<Record<string, string>> | null;
  /** Dış halka koordinatları `[lon, lat]`. Kapalı olması beklenir. */
  readonly ring?: readonly (readonly [number, number])[] | null;
}

/** Halkayı kapatır (ilk = son). Zaten kapalıysa dokunmaz. */
function closeRing(ring: readonly (readonly [number, number])[]): readonly LonLat[] | null {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const pts: LonLat[] = ring.map((p) => [p[0], p[1]] as LonLat);
  const first = pts[0], last = pts[pts.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) pts.push([first[0], first[1]]);
  return pts.length >= 4 ? pts : null;
}

export const osmBuildingAdapter: MapSourceAdapter<OsmBuildingRaw> = {
  sourceId: 'OSM',
  kind: 'BUILDING',

  normalize(raw: OsmBuildingRaw, ctx: AdapterContext): AdapterResult {
    const rawId = raw?.id;
    const id = (typeof rawId === 'number' && Number.isFinite(rawId)) || (typeof rawId === 'string' && rawId.length > 0)
      ? `way/${String(rawId)}` : null;
    if (!id) return rejected('MISSING_SOURCE_ID', null);

    const tags = raw.tags ?? {};
    // `building` etiketi olmayan way bu adaptörün konusu değildir.
    if (!tags.building) return rejected('UNSUPPORTED_TYPE', id);

    const ring = closeRing(raw.ring ?? []);
    if (!ring) return rejected('INVALID_GEOMETRY', id);
    const geometry: MapGeometry = { type: 'POLYGON', rings: [ring] };
    if (!isValidGeometry(geometry)) return rejected('INVALID_GEOMETRY', id);

    const fields: Record<string, MapFieldValue> = {};
    if (tags.name) fields.name = tags.name;
    const height = Number.parseFloat(tags.height ?? '');
    if (Number.isFinite(height)) fields.height = height;
    const levels = Number.parseInt(tags['building:levels'] ?? '', 10);
    if (Number.isFinite(levels)) fields.levels = levels;
    if (tags['addr:housenumber']) fields.housenumber = tags['addr:housenumber'];
    if (tags['addr:street']) fields.street = tags['addr:street'];
    if (tags['addr:postcode']) fields.postcode = tags['addr:postcode'];

    const recordUpdatedAtEpochMs = parseIsoEpochMs(raw.timestamp);

    return accepted({
      kind: 'BUILDING',
      provenance: {
        sourceId: 'OSM',
        sourceFeatureId: id,
        release: ctx.release,
        recordUpdatedAtEpochMs,
        upstreamDatasets: ['OpenStreetMap'],
        // OSM ham verisi kayıt düzeyinde lisans etiketi TAŞIMAZ; hak taban
        // politikadan (ODbL-1.0) gelir. Boş dizi = "ilan edilmedi".
        recordLicenses: [],
      },
      geometry,
      fields,
      quality: {
        positionalAccuracyM: null,
        vertexCount: ring.length,
        attributeCompleteness: computeAttributeCompleteness('BUILDING', fields, FIELDS_BY_KIND.BUILDING),
        // OSM insan katkısıdır ama formel doğrulama işareti taşımaz.
        sourceVerified: null,
        sourceConfidence: null,
      },
      freshness: classifyFreshness(
        recordUpdatedAtEpochMs, ctx.nowEpochMs, SOURCE_FRESHNESS_BUDGET_MS.OSM,
      ),
      grade: 'OBSERVED',
    });
  },
};
