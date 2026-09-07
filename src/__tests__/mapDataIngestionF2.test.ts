/**
 * mapDataIngestionF2.test.ts — MAP DATA PLATFORM · F2 INGESTION KİLİTLERİ.
 *
 * GERÇEK VERİ ile çalışır: `fixtures/mapdataTarsusNear.json` MAPDATA-F1
 * ölçümünden türetilmiş sınırlı Tarsus kümesidir (123 Overture + 11 OSM bina,
 * ~400×400 m). Uydurma kayıt YOKTUR.
 *
 * Kilitlenen davranışlar:
 *  1) Adaptörler SAF (I/O · ağ · timer · saat yok) ve deterministik.
 *  2) Reddedilen kayıt SESSİZCE atılmaz — gerekçesiyle döner.
 *  3) Kayıt düzeyi lisans AYNEN taşınır; ölçüm bunu doğrular (ODbL-1.0).
 *  4) ML footprint `DERIVED` + `sourceVerified: false` — insan gözlemiyle
 *     aynı kefeye KONMAZ.
 *  5) Overture'ın permissive DAĞITIM lisansı bina temasında share-alike'ı
 *     KALDIRMAZ (F1 ölçümünün F0 kaydını düzelttiği nokta).
 *  6) Gözlemler birbirinin ÜSTÜNE YAZILMAZ.
 *
 * CODE PASS ≠ DEVICE PASS: bu test veri hattını doğrular, cihazda çizim
 * davranışını DEĞİL. Üretim davranışı bu fazda değişmedi.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

import type { OvertureBuildingRaw } from '../platform/mapdata/adapters/overtureBuildingAdapter';
import { overtureBuildingAdapter, overtureGeometryToCanonical, isMachineDerivedDataset } from '../platform/mapdata/adapters/overtureBuildingAdapter';
import type { OsmBuildingRaw } from '../platform/mapdata/adapters/osmBuildingAdapter';
import { osmBuildingAdapter } from '../platform/mapdata/adapters/osmBuildingAdapter';
import { normalizeBatch, parseIsoEpochMs } from '../platform/mapdata/adapters/adapterContract';
import type { AdapterContext } from '../platform/mapdata/adapters/adapterContract';
import { effectiveLicensePolicy, evaluateLicenseGate } from '../platform/mapdata/mapDataLicense';
import { isValidCandidate } from '../platform/mapdata/mapDataObservation';

const FIXTURE = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/mapdataTarsusNear.json'), 'utf8'),
) as {
  counts: { overtureBuildings: number; osmBuildings: number };
  overtureBuildings: OvertureBuildingRaw[];
  osmBuildings: OsmBuildingRaw[];
};

// Sabit "şimdi" — testte saat OKUNMAZ (2026-09-07T00:00:00Z).
const NOW = 1_788_998_400_000;

const OVERTURE_CTX: AdapterContext = {
  release: {
    sourceId: 'OVERTURE',
    releaseId: '2026-08-19.0',
    publishedAtEpochMs: parseIsoEpochMs('2026-08-19T00:00:00Z'),
    dataCutoffEpochMs: null,
    retrievedFrom: 's3://overturemaps-us-west-2/release/2026-08-19.0',
  },
  nowEpochMs: NOW,
};
const OSM_CTX: AdapterContext = {
  release: {
    sourceId: 'OSM',
    releaseId: '2026-09-06-api-snapshot',
    publishedAtEpochMs: parseIsoEpochMs('2026-09-06T22:42:12Z'),
    dataCutoffEpochMs: null,
    retrievedFrom: 'https://api.openstreetmap.org/api/0.6/map.json',
  },
  nowEpochMs: NOW,
};

/* ══════════════════════════════════════════════════════════════════════════
   1) FIXTURE BÜTÜNLÜĞÜ — kilit boş kümede "geçmesin"
   ══════════════════════════════════════════════════════════════════════════ */

describe('MAPDATA-F2 · fixture', () => {
  it('gerçek ölçümden gelen sınırlı küme dolu (kör guard değil)', () => {
    expect(FIXTURE.counts.overtureBuildings).toBe(123);
    expect(FIXTURE.counts.osmBuildings).toBe(11);
    expect(FIXTURE.overtureBuildings.length).toBe(123);
    expect(FIXTURE.osmBuildings.length).toBe(11);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) OVERTURE ADAPTÖRÜ
   ══════════════════════════════════════════════════════════════════════════ */

describe('MAPDATA-F2 · Overture bina adaptörü', () => {
  const batch = normalizeBatch(overtureBuildingAdapter, FIXTURE.overtureBuildings, OVERTURE_CTX);

  it('123 gerçek kaydın tamamı normalize oldu, hiçbiri düşmedi', () => {
    expect(batch.observations.length).toBe(123);
    expect(batch.rejections.length).toBe(0);
  });

  it('kayıt düzeyi lisans AYNEN taşındı — ölçüm: 123/123 ODbL-1.0', () => {
    const licensed = batch.observations.filter(
      (o) => o.provenance.recordLicenses.length > 0
        && o.provenance.recordLicenses.every((l) => l === 'ODbL-1.0'),
    );
    expect(licensed.length).toBe(123);
  });

  it('ML footprint DERIVED + sourceVerified:false · OSM kökenli OBSERVED', () => {
    const ml = batch.observations.filter((o) => o.grade === 'DERIVED');
    const human = batch.observations.filter((o) => o.grade === 'OBSERVED');
    // F1 ölçümü: yakın alandaki 123 binanın 112'si OSM DIŞI kaynaklıdır.
    expect(ml.length).toBe(112);
    expect(human.length).toBe(11);
    expect(ml.every((o) => o.quality.sourceVerified === false)).toBe(true);
    expect(human.every((o) => o.quality.sourceVerified === null)).toBe(true);
    expect(ml.every((o) => o.provenance.upstreamDatasets.every(isMachineDerivedDataset))).toBe(true);
  });

  it('köken tam: kaynak kimliği · sürüm · alt kaynak taşınıyor', () => {
    for (const o of batch.observations) {
      expect(o.provenance.sourceId).toBe('OVERTURE');
      expect(o.provenance.sourceFeatureId.length).toBeGreaterThan(0);
      expect(o.provenance.release.releaseId).toBe('2026-08-19.0');
      expect(o.provenance.upstreamDatasets.length).toBeGreaterThan(0);
    }
  });

  it('geometri gerçek ve kapalı; köşe sayısı ölçülü', () => {
    for (const o of batch.observations) {
      expect(o.geometry?.type).toBe('POLYGON');
      expect(o.quality.vertexCount).toBeGreaterThanOrEqual(4);
    }
  });

  it('Overture bina yüksekliği YOK — uydurulmuyor (F1: 0/2627 height)', () => {
    const withHeight = batch.observations.filter((o) => o.fields.height !== undefined);
    expect(withHeight.length).toBe(0);
  });

  it('deterministik — aynı girdi aynı çıktı', () => {
    const again = normalizeBatch(overtureBuildingAdapter, FIXTURE.overtureBuildings, OVERTURE_CTX);
    expect(again.observations.map((o) => o.provenance.sourceFeatureId))
      .toEqual(batch.observations.map((o) => o.provenance.sourceFeatureId));
    expect(again.observations.map((o) => o.grade)).toEqual(batch.observations.map((o) => o.grade));
  });

  it('bozuk kayıt SESSİZCE atılmaz — gerekçe döner', () => {
    expect(overtureBuildingAdapter.normalize({ id: null, geometry: {} }, OVERTURE_CTX).rejection?.reason)
      .toBe('MISSING_SOURCE_ID');
    expect(overtureBuildingAdapter.normalize({ id: 'x', geometry: null }, OVERTURE_CTX).rejection?.reason)
      .toBe('INVALID_GEOMETRY');
    expect(overtureBuildingAdapter.normalize(
      { id: 'x', geometry: { type: 'Point', coordinates: [34.8, 36.9] } }, OVERTURE_CTX,
    ).rejection?.reason).toBe('INVALID_GEOMETRY');
    const bad = normalizeBatch(overtureBuildingAdapter, [{ id: null }, { id: 'y' }], OVERTURE_CTX);
    expect(bad.rejectionCounts.MISSING_SOURCE_ID).toBe(1);
    expect(bad.rejectionCounts.INVALID_GEOMETRY).toBe(1);
  });

  it('MultiPolygon parçaları SESSİZCE atılmaz', () => {
    const g = overtureGeometryToCanonical({
      type: 'MultiPolygon',
      coordinates: [
        [[[34.86, 36.91], [34.861, 36.91], [34.861, 36.911], [34.86, 36.91]]],
        [[[34.862, 36.912], [34.863, 36.912], [34.863, 36.913], [34.862, 36.912]]],
      ],
    });
    expect(g?.type).toBe('MULTIPOLYGON');
    expect(g && g.type === 'MULTIPOLYGON' ? g.polygons.length : 0).toBe(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) OSM ADAPTÖRÜ
   ══════════════════════════════════════════════════════════════════════════ */

describe('MAPDATA-F2 · OSM bina adaptörü', () => {
  const batch = normalizeBatch(osmBuildingAdapter, FIXTURE.osmBuildings, OSM_CTX);

  it('11 gerçek OSM binası normalize oldu', () => {
    expect(batch.observations.length).toBe(11);
    expect(batch.rejections.length).toBe(0);
    expect(batch.observations.every((o) => o.grade === 'OBSERVED')).toBe(true);
  });

  it('kaynak kimliği kanonik biçimde (`way/<id>`) taşınıyor', () => {
    expect(batch.observations.every((o) => /^way\/\d+$/.test(o.provenance.sourceFeatureId))).toBe(true);
  });

  it('kayıt düzeyi lisans ilan edilmemiş — boş dizi, uydurma etiket YOK', () => {
    expect(batch.observations.every((o) => o.provenance.recordLicenses.length === 0)).toBe(true);
  });

  it('bina olmayan way REDDEDİLİR', () => {
    const r = osmBuildingAdapter.normalize(
      { id: 1, tags: { highway: 'residential' }, ring: [[34.8, 36.9], [34.81, 36.9], [34.81, 36.91]] },
      OSM_CTX,
    );
    expect(r.rejection?.reason).toBe('UNSUPPORTED_TYPE');
  });

  it('açık halka kapatılır; üç noktadan az geometri reddedilir', () => {
    const ok = osmBuildingAdapter.normalize(
      { id: 2, tags: { building: 'yes' }, ring: [[34.8, 36.9], [34.81, 36.9], [34.81, 36.91]] },
      OSM_CTX,
    );
    expect(ok.observation?.geometry?.type).toBe('POLYGON');
    const short = osmBuildingAdapter.normalize(
      { id: 3, tags: { building: 'yes' }, ring: [[34.8, 36.9], [34.81, 36.9]] }, OSM_CTX,
    );
    expect(short.rejection?.reason).toBe('INVALID_GEOMETRY');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) LİSANS — F1 ÖLÇÜMÜNÜN F0 KAYDINI DÜZELTTİĞİ NOKTA
   ══════════════════════════════════════════════════════════════════════════ */

describe('MAPDATA-F2 · kayıt düzeyi lisans kapısı', () => {
  it('Overture bina kaydı ODbL taşır → share-alike YÜKÜMLÜLÜĞÜ SÜRER', () => {
    const policy = effectiveLicensePolicy('OVERTURE', ['ODbL-1.0']);
    expect(policy.shareAlike).toBe(true);
    const gate = evaluateLicenseGate(policy, 'OFFLINE_PACKAGING');
    expect(gate.verdict).toBe('ALLOW_WITH_ATTRIBUTION');
    expect(gate.shareAlikeObligation).toBe(true);
    expect(gate.requiredAttribution).toContain('OpenStreetMap');
    expect(gate.requiredAttribution).toContain('Overture');
  });

  it('Overture place kaydı permissive → share-alike YOK', () => {
    const policy = effectiveLicensePolicy('OVERTURE', ['CDLA-Permissive-2.0']);
    expect(policy.shareAlike).toBe(false);
  });

  it('CC0 kaydı atıf gerektirmez ama hakları tam', () => {
    const policy = effectiveLicensePolicy('OVERTURE', ['CC0-1.0']);
    expect(policy.attributionRequired).toBe(false);
    expect(evaluateLicenseGate(policy, 'OFFLINE_PACKAGING').verdict).toBe('ALLOW');
  });

  it('karışık lisansta EN KISITLAYICI kazanır', () => {
    const policy = effectiveLicensePolicy('OVERTURE', ['CC0-1.0', 'ODbL-1.0']);
    expect(policy.shareAlike).toBe(true);
    expect(policy.attributionRequired).toBe(true);
  });

  it('TANINMAYAN lisans etiketi → fail-closed RED', () => {
    const policy = effectiveLicensePolicy('OVERTURE', ['Bilinmeyen-Lisans-9.9']);
    expect(policy.commercialUse).toBe('UNKNOWN');
    expect(evaluateLicenseGate(policy, 'ONLINE_RUNTIME').verdict).toBe('DENY');
  });

  it('kayıt lisansı ilan edilmemişse taban politika kullanılır (varsayım DEĞİL)', () => {
    expect(effectiveLicensePolicy('OSM', []).license).toBe('ODbL-1.0');
    expect(effectiveLicensePolicy('OSM', undefined).license).toBe('ODbL-1.0');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) GÖZLEMLER ÜST ÜSTE YAZILMAZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('MAPDATA-F2 · merge değil evidence fusion', () => {
  it('aynı nesne için iki kaynak gözlemi YAN YANA durur', () => {
    const ov = normalizeBatch(overtureBuildingAdapter, FIXTURE.overtureBuildings, OVERTURE_CTX);
    const osm = normalizeBatch(osmBuildingAdapter, FIXTURE.osmBuildings, OSM_CTX);
    const candidate = {
      kind: 'BUILDING' as const,
      entityKey: 'building:tarsus:near:0',
      observations: [ov.observations[0], osm.observations[0]],
    };
    expect(isValidCandidate(candidate)).toBe(true);
    expect(candidate.observations.length).toBe(2);
    // İki gözlem de KENDİ kökenini korur — biri diğerini ezmez.
    expect(candidate.observations[0].provenance.sourceId).toBe('OVERTURE');
    expect(candidate.observations[1].provenance.sourceId).toBe('OSM');
    expect(candidate.observations[0].geometry).not.toEqual(candidate.observations[1].geometry);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) MİMARİ KİLİDİ — adaptörler dâhil TÜM mapdata ağacı SAF
   ══════════════════════════════════════════════════════════════════════════ */

function walkTs(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (entry.endsWith('.ts')) out.push({ file: full, text: readFileSync(full, 'utf8') });
  }
  return out;
}

describe('MAPDATA-F2 · saflık kilidi (alt klasörler DÂHİL)', () => {
  const files = walkTs(resolve(__dirname, '../platform/mapdata'));

  it('kilit alt klasörleri gerçekten tarıyor', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(files.some((f) => f.file.includes('adapters'))).toBe(true);
  });

  it('mapdata/** (adaptörler dâhil) SAF: I/O · ağ · timer · saat · React YOK', () => {
    const forbidden = [
      /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bsetTimeout\s*\(/, /\bsetInterval\s*\(/,
      /\bDate\.now\s*\(/, /\bperformance\.now\s*\(/, /\bnew Date\s*\(/, /\bMath\.random\s*\(/,
      /from\s+'react'/, /from\s+'node:fs'/, /localStorage/, /indexedDB/,
    ];
    for (const { file, text } of files) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const re of forbidden) {
        expect(`${file}:${re.source}:${re.test(code)}`).toBe(`${file}:${re.source}:false`);
      }
    }
  });

  it('adaptörler L1 store · rota · renderer import ETMİYOR', () => {
    const illegal = [
      /from\s+'[^']*navigation\/map\/store/, /from\s+'[^']*routingService/,
      /from\s+'[^']*mapSourceManager/, /from\s+'[^']*maplibre/,
      /from\s+'[^']*\/components\//,
    ];
    for (const { file, text } of files) {
      for (const re of illegal) {
        expect(`${file}:${re.source}:${re.test(text)}`).toBe(`${file}:${re.source}:false`);
      }
    }
  });
});
