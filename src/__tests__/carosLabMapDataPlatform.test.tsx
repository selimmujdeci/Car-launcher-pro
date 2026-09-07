/**
 * carosLabMapDataPlatform.test.tsx — CAROS LAB · Harita Veri Platformu kilitleri.
 *
 * Anayasa §👁️ ZORUNLU GÖZLEMLENEBİLİRLİK: "Gözlemlenemeyen özellik
 * tamamlanmış değildir." Bu dosya MAPDATA fazlarının LAB borcunu kapatan
 * ekranın yedi şartını denetler:
 *
 *  1) Katalogda kayıtlı ve AVAILABLE (PLACEHOLDER değil).
 *  2) Ekran GERÇEK kaynaklardan okur (sabit/örnek veri YOK).
 *  3) AKTİF KOMUT GÖNDERMEZ — okuma katmanı ağ/timer/başlatma içermez.
 *  4) KANITSIZ BİLGİ ÜRETMEZ: sağlayıcı yoksa "BAĞLI DEĞİL" der, sahte
 *     "sağlıklı" göstermez; damgası olmayan alan için sahte tarih üretmez.
 *  5) GİZLİLİK: koordinat/adres/sorgu metni taşımaz.
 *  6) İKİNCİ OTORİTE DEĞİL: hüküm kanonik kapıdan gelir, LAB kendi hakkını
 *     hesaplamaz ve üretime geri beslemez.
 *  7) Model SAF (I/O · timer · saat yok).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';
import {
  readMapDataSnapshot, MAP_DATA_SOURCE_COUNT, EMPTY_MAP_DATA_SNAPSHOT,
} from '../platform/devtools/mapDataSources';
import {
  buildBuildingGapFields, buildMapDataFields, deriveMapDataVerdict, summarizeLicenses, mapDataHeadline,
  PORT_UNBOUND_REASON, PORT_LABEL,
} from '../platform/devtools/mapDataLabModel';
import { MapDataPlatformScreen } from '../components/devtools/screens/MapDataPlatformScreen';
import { evaluateLicenseGate, licensePolicyFor } from '../platform/mapdata/mapDataLicense';
import type { PotentialBuildingGap } from '../platform/mapdata';

const SOURCES_SRC = readFileSync(
  resolve(__dirname, '../platform/devtools/mapDataSources.ts'), 'utf8');
const MODEL_SRC = readFileSync(
  resolve(__dirname, '../platform/devtools/mapDataLabModel.ts'), 'utf8');
const SCREEN_SRC = readFileSync(
  resolve(__dirname, '../components/devtools/screens/MapDataPlatformScreen.tsx'), 'utf8');
const GAP_DETECTOR_SRC = readFileSync(
  resolve(__dirname, '../platform/mapdata/resolvers/buildingGapDetector.ts'), 'utf8');

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const GAP_FIXTURE = [{
  approximateGeometry: {
    type: 'POLYGON',
    rings: [[[34, 36], [34.001, 36], [34.001, 36.001], [34, 36.001], [34, 36]]],
  },
  source: 'OVERTURE', sourceFeatureId: 'ml-gap-observatory-fixture',
  sourceQuality: 'ML_DERIVED_UNVERIFIED', confidence: 0.72, evidenceGrade: 'DERIVED',
  distanceToCanonicalBuildingM: 18,
  overlap: { centroidDistanceM: 18, mutualContainment: 0, areaRatio: 0.2,
    areaAM2: 100, areaBM2: 500 },
  observedDatasetRelease: { sourceId: 'OVERTURE', releaseId: '2026-08-19.0',
    publishedAtEpochMs: null, dataCutoffEpochMs: null, retrievedFrom: 'fixture' },
  sourceFreshness: { classification: 'AGING', ageMs: 1, budgetMs: 2 },
  recordLicenses: ['ODbL-1.0'], reason: 'INSUFFICIENT_CANONICAL_OVERLAP',
}] as const satisfies readonly PotentialBuildingGap[];

/* ══════════════════════════════════════════════════════════════════════════
   1) KATALOG
   ══════════════════════════════════════════════════════════════════════════ */

describe('CAROS LAB · Harita Veri Platformu · katalog', () => {
  const tool = CAROS_LAB_TOOLS.find((t) => t.id === 'map-data-platform');

  it('katalogda kayıtlı ve AVAILABLE', () => {
    expect(tool).toBeDefined();
    expect(tool!.status).toBe('AVAILABLE');
    expect(tool!.category).toBe('vehicle');
  });

  it('not alanı sınırları AÇIKÇA söyler (ikinci gerçek yüzeyi yok · komut yok)', () => {
    const note = tool!.note ?? '';
    expect(note).toContain('BAŞLATMAZ');
    expect(note).toContain('İKİNCİ OTORİTE DEĞİL');
    expect(note).toContain('Navigation Core');
    expect(note).toContain('GİZLİLİK');
    expect(`${tool!.desc} ${note}`).toContain('GAP EVIDENCE ≠ MAP TRUTH');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) OKUMA KATMANI — gerçek kaynak, sabit veri YOK
   ══════════════════════════════════════════════════════════════════════════ */

describe('CAROS LAB · Harita Veri Platformu · okuma', () => {
  const snap = readMapDataSnapshot();

  it('gerçek kaynak sözlüğünü okur — kör/boş değil', () => {
    expect(snap.readOk).toBe(true);
    expect(snap.sources.length).toBe(MAP_DATA_SOURCE_COUNT);
    expect(snap.sources.length).toBeGreaterThanOrEqual(8);
    expect(snap.readErrors).toBe(0);
    expect(snap.ports.length).toBe(3);
    expect(snap.buildingGaps).toMatchObject({
      availability: 'UNAVAILABLE', total: null, publishable: false,
    });
  });

  it('lisans hükmü SABİT METİN DEĞİL — kanonik kapıyla birebir aynı', () => {
    for (const row of snap.sources) {
      const expected = evaluateLicenseGate(licensePolicyFor(row.sourceId), 'OFFLINE_PACKAGING').verdict;
      expect(row.gates.OFFLINE_PACKAGING).toBe(expected);
    }
    // Ölçülmüş gerçek: hak kanıtlanmayan kaynaklar offline pakette REDDEDİLİR.
    expect(snap.sources.find((s) => s.sourceId === 'MUNICIPALITY')!.gates.OFFLINE_PACKAGING).toBe('DENY');
    expect(snap.sources.find((s) => s.sourceId === 'OSM')!.gates.OFFLINE_PACKAGING)
      .toBe('ALLOW_WITH_ATTRIBUTION');
  });

  it('okuma katmanı AKTİF KOMUT/AĞ/TIMER içermez', () => {
    const code = stripComments(SOURCES_SRC);
    for (const re of [/\bfetch\s*\(/, /\bsetTimeout\s*\(/, /\bsetInterval\s*\(/,
      /\bXMLHttpRequest\b/, /\.start\s*\(/, /\.connect\s*\(/, /\bawait\b/]) {
      expect(`${re.source}:${re.test(code)}`).toBe(`${re.source}:false`);
    }
  });

  it('her getter kendi try/catch içinde — kısmi hata ekranı düşürmez', () => {
    const catches = (SOURCES_SRC.match(/catch\s*\{/g) ?? []).length;
    expect(catches).toBeGreaterThanOrEqual(5);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) MODEL — saf, kanıtsız bilgi üretmez
   ══════════════════════════════════════════════════════════════════════════ */

describe('CAROS LAB · Harita Veri Platformu · model', () => {
  it('model SAF: I/O · timer · saat · React YOK', () => {
    const code = stripComments(MODEL_SRC);
    for (const re of [/\bfetch\s*\(/, /\bsetTimeout\s*\(/, /\bDate\.now\s*\(/,
      /\bnew Date\s*\(/, /from\s+'react'/, /from\s+'node:fs'/]) {
      expect(`${re.source}:${re.test(code)}`).toBe(`${re.source}:false`);
    }
  });

  it('okunamayan durum UNAVAILABLE — sahte "sağlıklı" YOK', () => {
    expect(deriveMapDataVerdict(EMPTY_MAP_DATA_SNAPSHOT)).toBe('UNAVAILABLE');
    expect(deriveMapDataVerdict(null)).toBe('UNAVAILABLE');
    const fields = buildMapDataFields(EMPTY_MAP_DATA_SNAPSHOT);
    expect(fields.every((f) => f.klass === 'UNAVAILABLE')).toBe(true);
    const gapFields = buildBuildingGapFields(EMPTY_MAP_DATA_SNAPSHOT);
    expect(gapFields.find((f) => f.id === 'gap-total')).toMatchObject({
      value: '—', klass: 'UNAVAILABLE',
    });
    expect(gapFields.find((f) => f.id === 'gap-publishable')).toMatchObject({
      value: 'FALSE', klass: 'OBSERVED',
    });
  });

  it('bugünkü doğru hâl: sağlayıcı YOK → CONTRACTS_ONLY (arıza DEĞİL)', () => {
    const snap = readMapDataSnapshot();
    expect(snap.ports.every((p) => p.bound === false)).toBe(true);
    expect(deriveMapDataVerdict(snap)).toBe('CONTRACTS_ONLY');
    expect(mapDataHeadline('CONTRACTS_ONLY', snap)).toContain('BAĞLI DEĞİL');
  });

  it('SAHTE ZAMAN DAMGASI YOK — sözleşme alanları updatedAt taşımaz', () => {
    const fields = buildMapDataFields(readMapDataSnapshot());
    expect(fields.length).toBeGreaterThan(5);
    expect(fields.every((f) => f.updatedAt === null)).toBe(true);
    expect(fields.every((f) => f.value !== '')).toBe(true);
  });

  it('lisans özeti gerçek satırlardan türetilir', () => {
    const snap = readMapDataSnapshot();
    const lic = summarizeLicenses(snap.sources);
    expect(lic.offlineAllowed + lic.offlineDenied).toBe(snap.sources.length);
    expect(lic.shareAlike).toBeGreaterThan(0); // ODbL kaynakları var
    // Atıf metni bilinmeyen kaynaklar zaten kapıda reddedilir → risk 0 olmalı
    // değil; sayı ne olursa olsun UYDURULMAZ, gerçek satırdan sayılır.
    expect(lic.attributionMissing).toBe(
      snap.sources.filter((s) => s.attributionRequired && !s.hasAttributionText).length,
    );
  });

  it('port gerekçeleri ÖLÇÜME dayalı — her port için yazılı', () => {
    for (const id of ['ADDRESS_INDEX', 'PLACE_INDEX', 'LIVE_ROAD_CONDITIONS'] as const) {
      expect(PORT_LABEL[id].length).toBeGreaterThan(0);
      expect(PORT_UNBOUND_REASON[id].length).toBeGreaterThan(20);
    }
    expect(PORT_UNBOUND_REASON.ADDRESS_INDEX).toContain('0 kayıt');
    expect(PORT_UNBOUND_REASON.PLACE_INDEX).toContain('337');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) EKRAN
   ══════════════════════════════════════════════════════════════════════════ */

describe('CAROS LAB · Harita Veri Platformu · ekran', () => {
  const html = renderToStaticMarkup(<MapDataPlatformScreen />);

  it('açılışta tek okuma yapar ve durumu gösterir', () => {
    expect(html).toContain('data-testid="map-data-platform"');
    expect(html).toContain('data-verdict="CONTRACTS_ONLY"');
    expect(html).toContain('SALT OKUNUR');
  });

  it('Gap Observatory gerçeği ve publish sınırını açıkça gösterir', () => {
    expect(html).toContain('data-testid="mdp-gap-observatory" data-publishable="false"');
    expect(html).toContain('GAP EVIDENCE ≠ MAP TRUTH');
    expect(html).toContain('Publishable building');
    expect(html).toContain('FALSE');
    expect(html).toContain('Gap evidence akışı bağlı değil; 0 UYDURULMAZ.');
  });

  it('verilen detector çıktısını saklamadan salt-okunur gösterir', () => {
    const observedHtml = renderToStaticMarkup(<MapDataPlatformScreen gapEvidence={GAP_FIXTURE} />);
    expect(observedHtml).toContain('OVERTURE:1');
    expect(observedHtml).toContain('ML_DERIVED_UNVERIFIED:1');
    expect(observedHtml).toContain('INSUFFICIENT_CANONICAL_OVERLAP:1');
    expect(observedHtml).toContain('0.72');
    expect(observedHtml).toContain('2026-08-19.0:1');
    expect(observedHtml).toContain('ALLOW_WITH_ATTRIBUTION:1');
  });

  it('üç portu da BAĞLI DEĞİL olarak gösterir (sahte hazır YOK)', () => {
    for (const id of ['ADDRESS_INDEX', 'PLACE_INDEX', 'LIVE_ROAD_CONDITIONS']) {
      expect(html).toContain(`data-testid="mdp-port-${id}" data-bound="false"`);
    }
    expect(html).toContain('BAĞLI DEĞİL');
  });

  it('lisans kapısı satırları gerçek hükmü taşır', () => {
    expect(html).toContain('data-testid="mdp-source-OSM" data-offline="ALLOW_WITH_ATTRIBUTION"');
    expect(html).toContain('data-testid="mdp-source-MUNICIPALITY" data-offline="DENY"');
    expect(html).toContain('data-testid="mdp-source-OPENFREEMAP" data-offline="DENY"');
  });

  it('elle YENİLE var, TIMER yok, zero-leak deseni korunuyor', () => {
    expect(html).toContain('data-testid="mdp-refresh"');
    const code = stripComments(SCREEN_SRC);
    for (const re of [/setInterval\s*\(/, /setTimeout\s*\(/, /requestAnimationFrame/]) {
      expect(`${re.source}:${re.test(code)}`).toBe(`${re.source}:false`);
    }
    expect(code).toContain('mountedRef');
    expect(code).toContain('return () => { mountedRef.current = false; };');
    expect(code).toContain('readMapDataSnapshot(gapEvidence)');
  });

  it('Gap Observatory truth/store/resolver/renderer/routing/CEH yazarı değildir', () => {
    const detector = stripComments(GAP_DETECTOR_SRC);
    for (const re of [/from\s+['"][^'"]*MapStore/i, /\.setState\s*\(/,
      /\bmapStore\s*\./i, /\bfuseBuildings\s*\(/, /\bresolveBuilding\w*\s*\(/,
      /\bmaplibre\b/i, /\brouting\w*\s*\./i, /\bceh\w*\s*\./i]) {
      expect(`${re.source}:${re.test(detector)}`).toBe(`${re.source}:false`);
    }
    expect(detector).not.toContain('setInterval(');
    expect(detector).not.toContain('setTimeout(');
  });

  it('GİZLİLİK: ekran koordinat/adres/sorgu alanı OKUMAZ', () => {
    const all = `${SOURCES_SRC}
${MODEL_SRC}
${SCREEN_SRC}`;
    for (const re of [/latitude/i, /longitude/i, /gpsService/,
      /searchPlaces/, /geocodeAddress/]) {
      expect(`${re.source}:${re.test(all)}`).toBe(`${re.source}:false`);
    }
  });
});
