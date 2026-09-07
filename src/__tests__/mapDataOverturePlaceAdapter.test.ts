/**
 * Bounded Overture Places evidence adaptörü.
 * Örnekler 2026-09-07 Mersin dense AOI resmî STAC snapshot'ından gelir.
 */
import { describe, expect, it } from 'vitest';

import { normalizeBatch } from '../platform/mapdata/adapters/adapterContract';
import type { AdapterContext } from '../platform/mapdata/adapters/adapterContract';
import {
  overturePlaceAdapter,
  overturePlaceCategory,
  overturePointToCanonical,
} from '../platform/mapdata/adapters/overturePlaceAdapter';
import type { OverturePlaceRaw } from '../platform/mapdata/adapters/overturePlaceAdapter';

const CONTEXT: AdapterContext = {
  release: {
    sourceId: 'OVERTURE',
    releaseId: '2026-08-19.0',
    publishedAtEpochMs: null,
    dataCutoffEpochMs: null,
    retrievedFrom: 'https://stac.overturemaps.org/',
  },
  nowEpochMs: Date.parse('2026-09-07T12:00:00Z'),
};

const KOZA_GIDA: OverturePlaceRaw = {
  id: '282ca0f2-976b-485f-ac01-c2f6b2a80e86',
  names: { primary: 'Koza Gida' },
  categories: { primary: 'delicatessen' },
  confidence: 0.8950564861297607,
  geometry: { type: 'Point', coordinates: [34.63173407, 36.80951946] },
  sources: [
    {
      dataset: 'meta',
      license: 'CDLA-Permissive-2.0',
      record_id: '552673028523821',
      update_time: '2026-08-10T00:00:00.000Z',
    },
    {
      dataset: 'Overture',
      license: 'CDLA-Permissive-2.0',
      record_id: null,
      update_time: '2026-08-14T19:46:07Z',
    },
  ],
};

describe('MAPDATA · Overture Places adapter', () => {
  it('gerçek snapshot kaydını provenance, release, confidence ve freshness ile korur', () => {
    const result = overturePlaceAdapter.normalize(KOZA_GIDA, CONTEXT);
    expect(result.rejection).toBeNull();
    expect(result.observation).toMatchObject({
      kind: 'PLACE',
      provenance: {
        sourceId: 'OVERTURE',
        sourceFeatureId: KOZA_GIDA.id,
        release: CONTEXT.release,
        upstreamDatasets: ['meta', 'Overture'],
        recordLicenses: ['CDLA-Permissive-2.0'],
        recordUpdatedAtEpochMs: Date.parse('2026-08-14T19:46:07Z'),
      },
      geometry: { type: 'POINT', coordinates: [34.63173407, 36.80951946] },
      fields: { name: 'Koza Gida', category: 'delicatessen' },
      quality: {
        vertexCount: 1,
        attributeCompleteness: 1,
        sourceVerified: null,
        sourceConfidence: 0.8950564861297607,
      },
      grade: 'OBSERVED',
    });
    expect(result.observation?.freshness.classification).toBe('AGING');
  });

  it('yeni taxonomy alanını deprecated categories alanından önce seçer', () => {
    expect(overturePlaceCategory({
      taxonomy: { primary: 'coffee_shop' },
      basic_category: 'restaurant',
      categories: { primary: 'cafe' },
    })).toBe('coffee_shop');
    expect(overturePlaceCategory({ basic_category: 'restaurant' })).toBe('restaurant');
    expect(overturePlaceCategory({ categories: { primary: 'cafe' } })).toBe('cafe');
  });

  it('freeform adres ve telefon verisini canonical alanlara sızdırmaz', () => {
    const raw = {
      ...KOZA_GIDA,
      addresses: [{ freeform: 'Örnek adres' }],
      phones: ['+90 324 000 00 00'],
    } as OverturePlaceRaw;
    const fields = overturePlaceAdapter.normalize(raw, CONTEXT).observation?.fields;
    expect(fields).toEqual({ name: 'Koza Gida', category: 'delicatessen' });
  });

  it('sağlayıcı confidence değeri geçersizse uydurmaz; canonical confidence yapmaz', () => {
    for (const confidence of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = overturePlaceAdapter.normalize({ ...KOZA_GIDA, confidence }, CONTEXT);
      expect(result.observation?.quality.sourceConfidence).toBeNull();
    }
  });

  it('kalıcı kapalı kayıt kanıtını silmez, UNAVAILABLE olarak taşır', () => {
    const result = overturePlaceAdapter.normalize({
      ...KOZA_GIDA,
      operating_status: 'closed_permanently',
    }, CONTEXT);
    expect(result.observation?.grade).toBe('UNAVAILABLE');
  });

  it('kimlik, geometri veya tüm anlamlı alan eksikse gerekçeli reddeder', () => {
    const batch = normalizeBatch(overturePlaceAdapter, [
      { ...KOZA_GIDA, id: '' },
      { ...KOZA_GIDA, geometry: { type: 'LineString', coordinates: [] } },
      { ...KOZA_GIDA, name: null, names: null, categories: null },
      KOZA_GIDA,
    ], CONTEXT);
    expect(batch.observations).toHaveLength(1);
    expect(batch.rejectionCounts).toEqual({
      MISSING_SOURCE_ID: 1,
      INVALID_GEOMETRY: 1,
      UNSUPPORTED_TYPE: 0,
      EMPTY_RECORD: 1,
    });
  });

  it('yalnız GeoJSON Point ve geçerli lon/lat kabul eder', () => {
    expect(overturePointToCanonical({ type: 'Point', coordinates: [34.63, 36.81] }))
      .toEqual({ type: 'POINT', coordinates: [34.63, 36.81] });
    expect(overturePointToCanonical({ type: 'Point', coordinates: [190, 36.81] })).toBeNull();
    expect(overturePointToCanonical(null)).toBeNull();
  });
});
