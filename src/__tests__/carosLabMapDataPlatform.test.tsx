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
  buildMapDataFields, deriveMapDataVerdict, summarizeLicenses, mapDataHeadline,
  PORT_UNBOUND_REASON, PORT_LABEL,
} from '../platform/devtools/mapDataLabModel';
import { MapDataPlatformScreen } from '../components/devtools/screens/MapDataPlatformScreen';
import { evaluateLicenseGate, licensePolicyFor } from '../platform/mapdata/mapDataLicense';

const SOURCES_SRC = readFileSync(
  resolve(__dirname, '../platform/devtools/mapDataSources.ts'), 'utf8');
const MODEL_SRC = readFileSync(
  resolve(__dirname, '../platform/devtools/mapDataLabModel.ts'), 'utf8');
const SCREEN_SRC = readFileSync(
  resolve(__dirname, '../components/devtools/screens/MapDataPlatformScreen.tsx'), 'utf8');

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

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
    expect(code).toContain('readMapDataSnapshot()');
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
