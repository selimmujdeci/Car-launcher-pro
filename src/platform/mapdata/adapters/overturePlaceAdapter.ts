/**
 * overturePlaceAdapter.ts — BOUNDED OVERTURE PLACE EVIDENCE ADAPTER (SAF).
 *
 * Ağ/dosya erişimi yapmaz; yalnız dışarıdan verilmiş tek ham Place kaydını
 * provenance-korumalı gözleme çevirir. Çıktı canonical MapStore/renderer'a
 * bağlı değildir. 2026-09-07 üç-AOI shootout'unda Mersin'de OSM ile exact-name
 * eşleşmeyen 71 adayın 31'i temel kalite filtresini geçti; gerçek-dünya/saha
 * doğrulaması yapılmadığı için bu adaptör yalnız ENRICHMENT_CANDIDATE evidence
 * üretim dikişidir, production truth değildir.
 */

import type { LonLat, MapFieldValue, MapGeometry } from '../mapDataObservation';
import {
  classifyFreshness, computeAttributeCompleteness, isFiniteLonLat,
  SOURCE_FRESHNESS_BUDGET_MS,
} from '../mapDataObservation';
import type { AdapterContext, AdapterResult, MapSourceAdapter } from './adapterContract';
import { accepted, rejected } from './adapterContract';
import type { OvertureSourceRef } from './overtureSource';
import { normalizeOvertureSources } from './overtureSource';

export interface OverturePlaceRaw {
  readonly id?: string | null;
  readonly name?: string | null;
  readonly names?: { readonly primary?: string | null } | null;
  /** Eylül 2026 sonrası tercih edilen kategori şeması. */
  readonly taxonomy?: { readonly primary?: string | null } | null;
  readonly basic_category?: string | null;
  /** Ağustos 2026'da mevcut, Eylül 2026 release'inde kaldırılması planlı alan. */
  readonly categories?: { readonly primary?: string | null } | null;
  readonly confidence?: number | null;
  readonly operating_status?: string | null;
  readonly sources?: readonly OvertureSourceRef[] | null;
  readonly geometry?: unknown;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function overturePlaceCategory(raw: OverturePlaceRaw): string | null {
  if (nonEmpty(raw.taxonomy?.primary)) return raw.taxonomy.primary;
  if (nonEmpty(raw.basic_category)) return raw.basic_category;
  if (nonEmpty(raw.categories?.primary)) return raw.categories.primary;
  return null;
}

export function overturePointToCanonical(geometry: unknown): MapGeometry | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const raw = geometry as { type?: unknown; coordinates?: unknown };
  if (raw.type !== 'Point' || !isFiniteLonLat(raw.coordinates)) return null;
  return { type: 'POINT', coordinates: raw.coordinates as LonLat };
}

export const overturePlaceAdapter: MapSourceAdapter<OverturePlaceRaw> = {
  sourceId: 'OVERTURE',
  kind: 'PLACE',

  normalize(raw: OverturePlaceRaw, ctx: AdapterContext): AdapterResult {
    const id = nonEmpty(raw?.id) ? raw.id : null;
    if (!id) return rejected('MISSING_SOURCE_ID', null);

    const geometry = overturePointToCanonical(raw.geometry);
    if (!geometry) return rejected('INVALID_GEOMETRY', id);

    const name = nonEmpty(raw.name)
      ? raw.name
      : (nonEmpty(raw.names?.primary) ? raw.names.primary : null);
    const category = overturePlaceCategory(raw);
    if (name === null && category === null) return rejected('EMPTY_RECORD', id);

    const fields: Record<string, MapFieldValue> = {};
    if (name !== null) fields.name = name;
    if (category !== null) fields.category = category;

    const sourceConfidence = typeof raw.confidence === 'number'
      && Number.isFinite(raw.confidence)
      && raw.confidence >= 0
      && raw.confidence <= 1
      ? raw.confidence : null;
    const provenance = normalizeOvertureSources(raw.sources);

    return accepted({
      kind: 'PLACE',
      provenance: {
        sourceId: 'OVERTURE',
        sourceFeatureId: id,
        release: ctx.release,
        recordUpdatedAtEpochMs: provenance.recordUpdatedAtEpochMs,
        upstreamDatasets: provenance.upstreamDatasets,
        recordLicenses: provenance.recordLicenses,
      },
      geometry,
      fields,
      quality: {
        positionalAccuracyM: null,
        vertexCount: 1,
        attributeCompleteness: computeAttributeCompleteness(
          'PLACE', fields, ['name', 'category'],
        ),
        sourceVerified: null,
        // Sağlayıcı skoru taşınır; resolver bunu canonical güven saymaz.
        sourceConfidence,
      },
      freshness: classifyFreshness(
        provenance.recordUpdatedAtEpochMs,
        ctx.nowEpochMs,
        SOURCE_FRESHNESS_BUDGET_MS.OVERTURE,
      ),
      grade: raw.operating_status === 'closed_permanently' ? 'UNAVAILABLE' : 'OBSERVED',
    });
  },
};
