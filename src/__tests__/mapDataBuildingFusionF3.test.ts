/**
 * mapDataBuildingFusionF3.test.ts — MAP DATA PLATFORM · F3 BINA FUSION KİLİTLERİ.
 *
 * GERÇEK VERİ: `fixtures/mapdataTarsusNear.json` (123 Overture + 11 OSM bina,
 * Tarsus ~400×400 m, MAPDATA-F1 ölçümünden türetilmiş).
 *
 * Kilitlenen davranışlar:
 *  1) Kümeleme deterministik — girdi sırası sonucu DEĞİŞTİRMEZ.
 *  2) **UYDURMA GEOMETRİ YOK** — canonical geometri DAİMA gerçek bir kaynak
 *     kaydının aynısıdır; iki footprint ortalanmaz/birleştirilmez.
 *  3) Eşleşme hükmü gerekçelidir (çok uzak · alan uyumsuz · içerme yok).
 *  4) Geometri mutabakatı METRİK ölçülür (tür bazlı kaba eşitlik DEĞİL).
 *  5) Lisans yükümlülüğü fusion çıktısında KAYBOLMAZ (ODbL share-alike).
 *  6) Ölçülen kapsam kazancı korunur: 11 OSM → 123 canonical bina.
 *
 * CODE PASS ≠ DEVICE PASS ≠ FIELD PASS. Bu faz renderer'a BAĞLANMADI;
 * cihazda bina çizimi hakkında hiçbir iddia içermez.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { OvertureBuildingRaw } from '../platform/mapdata/adapters/overtureBuildingAdapter';
import { overtureBuildingAdapter } from '../platform/mapdata/adapters/overtureBuildingAdapter';
import type { OsmBuildingRaw } from '../platform/mapdata/adapters/osmBuildingAdapter';
import { osmBuildingAdapter } from '../platform/mapdata/adapters/osmBuildingAdapter';
import type { AdapterContext } from '../platform/mapdata/adapters/adapterContract';
import { normalizeBatch, parseIsoEpochMs } from '../platform/mapdata/adapters/adapterContract';
import {
  clusterBuildingObservations, fuseBuildings, matchBuildings, explainBuildingChoice,
  buildGeometryAgreementKeys, DEFAULT_BUILDING_MATCH_POLICY, AGREEMENT_MIN_AREA_RATIO,
} from '../platform/mapdata/resolvers/buildingResolver';
import {
  polygonAreaM2, polygonCentroid, pointInPolygon, distanceM, measureOverlap,
} from '../platform/mapdata/resolvers/buildingGeometry';
import type { LonLat, MapGeometry, MapSourceObservation } from '../platform/mapdata/mapDataObservation';

const FIXTURE = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/mapdataTarsusNear.json'), 'utf8'),
) as { overtureBuildings: OvertureBuildingRaw[]; osmBuildings: OsmBuildingRaw[] };

const NOW = 1_788_998_400_000; // 2026-09-07T00:00:00Z — sabit, saat okunmaz

const OVERTURE_CTX: AdapterContext = {
  release: {
    sourceId: 'OVERTURE', releaseId: '2026-08-19.0',
    publishedAtEpochMs: parseIsoEpochMs('2026-08-19T00:00:00Z'),
    dataCutoffEpochMs: null, retrievedFrom: 's3://overturemaps-us-west-2',
  },
  nowEpochMs: NOW,
};
const OSM_CTX: AdapterContext = {
  release: {
    sourceId: 'OSM', releaseId: '2026-09-06-api-snapshot',
    publishedAtEpochMs: parseIsoEpochMs('2026-09-06T22:42:12Z'),
    dataCutoffEpochMs: null, retrievedFrom: 'https://api.openstreetmap.org',
  },
  nowEpochMs: NOW,
};

function allObservations(): MapSourceObservation[] {
  const ov = normalizeBatch(overtureBuildingAdapter, FIXTURE.overtureBuildings, OVERTURE_CTX);
  const osm = normalizeBatch(osmBuildingAdapter, FIXTURE.osmBuildings, OSM_CTX);
  return [...ov.observations, ...osm.observations];
}

function geometryKey(g: MapGeometry | null): string {
  return g === null ? 'NULL' : JSON.stringify(g);
}

/* ══════════════════════════════════════════════════════════════════════════
   1) GEOMETRİ MATEMATİĞİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('MAPDATA-F3 · geometri', () => {
  const square: MapGeometry = {
    type: 'POLYGON',
    rings: [[[34.8600, 36.9180], [34.8601, 36.9180], [34.8601, 36.9181], [34.8600, 36.9181], [34.8600, 36.9180]]],
  };

  it('alan makul ve pozitif (≈ 8.9 m × 11.1 m)', () => {
    const area = polygonAreaM2(square);
    expect(area).not.toBeNull();
    expect(area!).toBeGreaterThan(80);
    expect(area!).toBeLessThan(120);
  });

  it('ağırlık merkezi karenin ortasında', () => {
    const c = polygonCentroid(square);
    expect(c![0]).toBeCloseTo(34.86005, 5);
    expect(c![1]).toBeCloseTo(36.91805, 5);
  });

  it('nokta-poligon: merkez içeride, uzak nokta dışarıda', () => {
    expect(pointInPolygon([34.86005, 36.91805], square)).toBe(true);
    expect(pointInPolygon([34.87, 36.92], square)).toBe(false);
  });

  it('🔒 ağırlık merkezi YEREL ÇERÇEVEDE hesaplanır (lon/lat shoelace YASAK)', () => {
    /* ÖLÇÜLDÜ (2026-09-07, ML doğruluk turu): lon/lat koordinatları ÜZERİNDE
       doğrudan shoelace centroid hesabı KATASTROFİK KAYAN NOKTA İPTALİ üretir.
       Çarpım terimleri ~34.86 × 36.92 ≈ 1287 mertebesinde; bina ölçeğinde
       toplamları ise ~1e-9. Ölçüm aracımızda bu hata 25 örneğin 24'ünde
       >3 px sapma, en kötüsünde 11 px'lik bir bina için 302 px sapma verdi.

       `polygonCentroid` bu tuzağa DÜŞMEZ çünkü önce `makeLocalFrame`/`toLocalXY`
       ile metre uzayına geçer. Bu kilit tam olarak o gerekliliği korur: biri
       yerel çerçeveyi kaldırıp ham lon/lat ile hesaplasa merkez metrelerce
       kayar ve test DÜŞER. */
    const ring: LonLat[] = [
      [34.8621000, 36.9175000], [34.8622200, 36.9175000],
      [34.8622200, 36.9176000], [34.8621000, 36.9176000], [34.8621000, 36.9175000],
    ];
    const c = polygonCentroid({ type: 'POLYGON', rings: [ring] });
    expect(c).not.toBeNull();
    // Dikdörtgenin gerçek merkezi bbox ortasıdır; sapma 0,25 m'yi AŞMAMALI.
    const expected: LonLat = [34.8621600, 36.9175500];
    expect(distanceM(c!, expected)).toBeLessThan(0.25);
  });

  it('alan ÖLÇÜLEMEZSE null döner — sıfır UYDURULMAZ', () => {
    expect(polygonAreaM2(null)).toBeNull();
    expect(polygonAreaM2({ type: 'POINT', coordinates: [34.86, 36.91] })).toBeNull();
  });

  it('mesafe ölçümü metre mertebesinde tutarlı', () => {
    // 0.001° enlem ≈ 111 m
    expect(distanceM([34.86, 36.918], [34.86, 36.919])).toBeGreaterThan(105);
    expect(distanceM([34.86, 36.918], [34.86, 36.919])).toBeLessThan(118);
  });

  it('örtüşme kanıtı üç ekseni birden taşır', () => {
    const o = measureOverlap(square, square);
    expect(o.centroidDistanceM).toBeCloseTo(0, 3);
    expect(o.mutualContainment).toBe(2);
    expect(o.areaRatio).toBeCloseTo(1, 6);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) EŞLEŞTİRME — hüküm GEREKÇELİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('MAPDATA-F3 · eşleştirme hükmü', () => {
  const obs = allObservations();

  it('aynı gözlem kendisiyle eşleşir (içerme + alan)', () => {
    const v = matchBuildings(obs[0], obs[0]);
    expect(v.matched).toBe(true);
    expect(v.reason).toBe('CONTAINMENT_AND_AREA');
  });

  it('uzak binalar EŞLEŞMEZ ve gerekçesi TOO_FAR', () => {
    // Fixture kanonik sıralı; ilk ve son gözlem alanın iki ucundadır.
    const v = matchBuildings(obs[0], obs[obs.length - 1]);
    expect(v.matched).toBe(false);
    expect(v.reason).toBe('TOO_FAR');
  });

  it('geometrisiz gözlem eşleşmez ve gerekçesi NO_GEOMETRY', () => {
    const ghost = { ...obs[0], geometry: null };
    const v = matchBuildings(ghost, obs[0]);
    expect(v.matched).toBe(false);
    expect(v.reason).toBe('NO_GEOMETRY');
  });

  it('politika sayıları açık ve gerekçeli', () => {
    expect(DEFAULT_BUILDING_MATCH_POLICY.maxCentroidDistanceM).toBe(12);
    expect(DEFAULT_BUILDING_MATCH_POLICY.minAreaRatio).toBe(0.25);
    expect(DEFAULT_BUILDING_MATCH_POLICY.requireContainment).toBe(true);
    expect(AGREEMENT_MIN_AREA_RATIO).toBeGreaterThan(DEFAULT_BUILDING_MATCH_POLICY.minAreaRatio);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) KÜMELEME — deterministik ve ölçülmüş
   ══════════════════════════════════════════════════════════════════════════ */

describe('MAPDATA-F3 · kümeleme', () => {
  const obs = allObservations();

  it('134 gözlem → 123 küme; 11 küme ÇOK KAYNAKLI', () => {
    const r = clusterBuildingObservations(obs);
    expect(r.stats.totalObservations).toBe(134);
    expect(r.stats.clusters).toBe(123);
    // 11 OSM binasının her biri bir Overture kaydıyla eşleşti.
    expect(r.stats.multiSourceClusters).toBe(11);
    expect(r.stats.singleSourceClusters.OVERTURE).toBe(112);
    expect(r.stats.withoutGeometry).toBe(0);
  });

  it('girdi sırası sonucu DEĞİŞTİRMEZ (deterministik)', () => {
    const a = clusterBuildingObservations(obs);
    const b = clusterBuildingObservations([...obs].reverse());
    expect(b.stats).toEqual(a.stats);
    expect(b.candidates.map((c) => c.entityKey)).toEqual(a.candidates.map((c) => c.entityKey));
    expect(b.candidates.map((c) => c.observations.length))
      .toEqual(a.candidates.map((c) => c.observations.length));
  });

  it('gözlemler küme içinde ÜST ÜSTE YAZILMAZ', () => {
    const r = clusterBuildingObservations(obs);
    const multi = r.candidates.filter((c) => c.observations.length > 1);
    expect(multi.length).toBe(11);
    for (const c of multi) {
      const sources = c.observations.map((o) => o.provenance.sourceId);
      expect(new Set(sources).size).toBeGreaterThan(1);
      // Her gözlem KENDİ kökenini korur.
      for (const o of c.observations) expect(o.provenance.sourceFeatureId.length).toBeGreaterThan(0);
    }
  });

  it('geometri mutabakatı METRİK ölçülür — farklı şekiller mutabık SAYILMAZ', () => {
    const r = clusterBuildingObservations(obs);
    const multi = r.candidates.find((c) => c.observations.length > 1)!;
    const keys = buildGeometryAgreementKeys(multi.observations);
    // Bu kümede OSM footprint'i ile Overture'ın OSM türevi kopyası aynıdır.
    expect(new Set([...keys.values()]).size).toBe(1);

    // Aynı yerde AMA çok farklı ölçekte iki footprint mutabık sayılmamalı.
    const big = multi.observations[0];
    const centroid = polygonCentroid(big.geometry)!;
    const tiny: MapSourceObservation = {
      ...big,
      provenance: { ...big.provenance, sourceFeatureId: 'synthetic/tiny' },
      geometry: {
        type: 'POLYGON',
        rings: [[
          [centroid[0], centroid[1]],
          [centroid[0] + 0.00002, centroid[1]],
          [centroid[0] + 0.00002, centroid[1] + 0.00002],
          [centroid[0], centroid[1] + 0.00002],
          [centroid[0], centroid[1]],
        ]],
      },
    };
    const mixed = buildGeometryAgreementKeys([...multi.observations, tiny]);
    expect(mixed.get('synthetic/tiny')).not.toBe(mixed.get(big.provenance.sourceFeatureId));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) FUSION — uydurma geometri YASAK
   ══════════════════════════════════════════════════════════════════════════ */

describe('MAPDATA-F3 · fusion sonucu', () => {
  const obs = allObservations();
  const result = fuseBuildings(obs, { intent: 'OFFLINE_PACKAGING' });

  it('ML kapsamı canonical bina sayılmaz: yalnız 11 OSM-kökenli geometri yayımlanır', () => {
    expect(FIXTURE.osmBuildings.length).toBe(11);
    expect(result.features.length).toBe(123);
    expect(result.publishable).toBe(11);
    expect(result.degraded).toBe(112);
  });

  it('UYDURMA GEOMETRİ YOK — her canonical geometri GERÇEK bir kaynak kaydıdır', () => {
    const sourceGeometries = new Set(obs.map((o) => geometryKey(o.geometry)));
    for (const f of result.features.filter((feature) => feature.geometry.value !== null)) {
      expect(sourceGeometries.has(geometryKey(f.geometry.value))).toBe(true);
    }
  });

  it('her canonical nesne kaynağını ve gerekçesini taşır', () => {
    for (const f of result.features.filter((feature) => feature.geometry.value !== null)) {
      expect(f.geometry.sourceId).not.toBeNull();
      expect(f.geometry.sourceFeatureId).not.toBeNull();
      expect(f.geometry.scores.length).toBeGreaterThan(0);
      expect(f.geometry.confidence).toBeGreaterThan(0);
    }
    const explained = explainBuildingChoice(result.features[0]);
    expect(explained).toContain('kaynak');
    expect(explained).toContain('alan');
  });

  it('ODbL share-alike yükümlülüğü fusion çıktısında KAYBOLMAZ', () => {
    for (const f of result.features.filter((feature) => feature.geometry.value !== null)) {
      expect(f.license.verdict).toBe('ALLOW_WITH_ATTRIBUTION');
      expect(f.license.shareAlikeObligation).toBe(true);
      expect(f.license.requiredAttribution).toContain('OpenStreetMap');
    }
  });

  it('yükseklik UYDURULMAZ — Overture kaydında height yok, canonical de yok', () => {
    const withHeight = result.features.filter((f) => f.fields.height?.value !== null
      && f.fields.height?.value !== undefined);
    expect(withHeight.length).toBe(0);
    // Ve nedeni açıkça yazılıdır.
    expect(result.features[0].fields.height?.unknownReason).toBe('NO_OBSERVATION');
  });

  it('fusion DETERMİNİSTİK — aynı girdi aynı çıktı', () => {
    const again = fuseBuildings([...obs].reverse(), { intent: 'OFFLINE_PACKAGING' });
    expect(again.features.map((f) => f.entityKey)).toEqual(result.features.map((f) => f.entityKey));
    expect(again.features.map((f) => geometryKey(f.geometry.value)))
      .toEqual(result.features.map((f) => geometryKey(f.geometry.value)));
  });

  it('lisans kapısı kapanırsa hiçbir bina yayımlanamaz (fail-closed)', () => {
    // MUNICIPALITY lisansı UNKNOWN: aynı gözlemler o kaynağa atfedilseydi
    // offline paketlemede TAMAMI düşerdi.
    const blocked = obs.map((o) => ({
      ...o,
      provenance: { ...o.provenance, sourceId: 'MUNICIPALITY' as const, recordLicenses: [] },
    }));
    const r = fuseBuildings(blocked, { intent: 'OFFLINE_PACKAGING' });
    expect(r.publishable).toBe(0);
    expect(r.degraded).toBe(r.features.length);
  });
});
