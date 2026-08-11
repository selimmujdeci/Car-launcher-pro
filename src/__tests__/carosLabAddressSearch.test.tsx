/**
 * carosLabAddressSearch.test.tsx — CAROS LAB · Adres Arama Kanıtı KİLİTLERİ.
 *
 * YAKLAŞIM (A3–A8 turlarıyla aynı): model TAMAMEN SAF → gerçek davranış servis
 * mock'u olmadan doğrulanır; ekran kilidi `renderToStaticMarkup` ile alınır.
 *
 * ANA İLKE: bu ekran YENİ OTORİTE DEĞİLDİR ve ARAMAYA DOKUNMAZ.
 * Kilitler iki soruyu sorar: (1) uydurdu mu? (2) sızdırdı mı?
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  buildAddressSearchView, describeRecord,
  ADDRESS_SEARCH_VERDICT_LABEL,
} from '../platform/devtools/addressSearchModel';
import type { AddressSearchRawSnapshot } from '../platform/devtools/addressSearchSources';
import {
  classifyAddressSearch, describeQueryShape, summarizeAddressSearches,
  type AddressSearchRecord, type AddressSearchSample,
} from '../platform/geo/addressSearchLedger';
import { AddressSearchEvidenceScreen } from '../components/devtools/screens/AddressSearchEvidenceScreen';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';

const NOW = 1_700_000_000_000;
const SRC = 'geocodingService.geocodeAddress';

/** Ölçümdeki gerçek bir başarısızlık: veri OSM'de VAR ama ürün bulamadı. */
function failing(over: Partial<AddressSearchSample> = {}): AddressSearchRecord {
  return classifyAddressSearch({
    atMs: NOW,
    surface: 'VOICE_ADDRESS',
    shape: describeQueryShape('Mersin Yenişehir Mahallesi Kuvayimilliye Caddesi'),
    queryRewritten: false,
    queryLostRoadType: false,
    stage: 'NONE',
    resultCount: 0,
    rejectedCount: 0,
    providerMs: 8_693,
    fastFailHit: false,
    hadLocation: true,
    online: true,
    fallbackQueryUsable: false,
    outcome: 'EMPTY',
    ...over,
  }, SRC);
}

function snap(records: readonly AddressSearchRecord[], over: Partial<AddressSearchRawSnapshot> = {}): AddressSearchRawSnapshot {
  return {
    readAt: NOW,
    ledgerReadable: true,
    records,
    summary: summarizeAddressSearches(records),
    providerName: null,
    providerHasKey: null,
    ...over,
  };
}

describe('CAROS LAB · Adres Arama Kanıtı — model', () => {
  it('🔒 kayıt yokken "sağlıklı" DEMEZ (kayıt yok ≠ hepsi başarılı)', () => {
    const v = buildAddressSearchView(snap([]));
    expect(v.verdict).toBe('NO_DATA');
    expect(ADDRESS_SEARCH_VERDICT_LABEL[v.verdict]).not.toMatch(/ÇÖZÜLDÜ/);
    /* Oran alanı '—' olmalı, %0 OLMAMALI. */
    const rate = v.cards[0].fields.find((f) => f.id === 'rate');
    expect(rate?.value).toBe('—');
    expect(rate?.klass).toBe('UNAVAILABLE');
  });

  it('🔒 defter okunamazsa hiçbir alan yorumlanmaz', () => {
    const v = buildAddressSearchView(snap([], { ledgerReadable: false, summary: null }));
    expect(v.verdict).toBe('UNAVAILABLE');
    expect(v.cards[0].fields.every((f) => f.klass === 'UNAVAILABLE')).toBe(true);
  });

  it('🔒 başarısızlık varken baskın sebebi ancak açık farkla bildirir', () => {
    const many = [failing(), failing(), failing()];
    const v = buildAddressSearchView(snap(many));
    /* Üçü de aynı sınıf → baskın bildirilir. */
    expect(v.verdict).toBe('DOMINANT_CAUSE');
    expect(v.verdictNote).toMatch(/baskın sebep/);
  });

  it('🔒 seçim bekleyen kayıt oranı BOZMAZ ve hüküm NO_DATA kalır', () => {
    const pending = classifyAddressSearch({
      atMs: NOW, surface: 'MAP_SEARCH_BAR',
      shape: describeQueryShape('Mersin Forum'),
      queryRewritten: false, queryLostRoadType: false,
      stage: 'NOMINATIM', resultCount: 4, rejectedCount: 0,
      providerMs: 615, fastFailHit: false, hadLocation: true, online: true, fallbackQueryUsable: null,
      outcome: 'AWAITING_CHOICE',
    }, 'mapService.searchPlaces');
    const v = buildAddressSearchView(snap([pending]));
    expect(v.verdict).toBe('NO_DATA');
    expect(v.verdictNote).toMatch(/karara bağlanmadı/);
  });

  it('🔒 son şans kullanılamadıysa VERİ YOK demez (ölçülen A1 vakası)', () => {
    /* Ölçüm 2026-08-11: `Mersin … Kuvayimilliye Caddesi` → 0 sonuç. Yol OSM'de
       VARDI; Overpass regexi şehir öneki yüzünden kullanılamazdı. Defter bunu
       "veri boşluğu" DEĞİL, ürün zinciri kusuru olarak sınıflar. */
    const rec = failing();
    expect(rec.failureClass).toBe('FALLBACK_UNUSABLE');
    expect(rec.failureClass).not.toBe('PROVIDER_ZERO');
  });

  it('🔒 "önce bunu ölç" eksik kanıt varsa gösterilir', () => {
    /* Son şans KULLANILABİLİRKEN 0 sonuç → "OSM'de var mı" sorusu cevapsız kalır. */
    const v = buildAddressSearchView(snap([failing({ fallbackQueryUsable: true })]));
    expect(v.nextMeasurement).toBe('GROUND_TRUTH');
  });

  it('🔒 kayıt özeti SORGU METNİNİ sızdırmaz (yalnız biçim)', () => {
    const rec = failing();
    const line = describeRecord(rec);
    for (const token of ['Mersin', 'Yenişehir', 'Kuvayimilliye', 'Caddesi']) {
      expect(line).not.toContain(token);
    }
    /* Ama teşhis için gereken biçim bilgisi VAR. */
    expect(line).toMatch(/sözcük/);
    expect(line).toMatch(/ekli tip|cadde/);
  });
});

describe('CAROS LAB · Adres Arama Kanıtı — ekran', () => {
  it('🔒 katalogda AVAILABLE ve ekran haritasından açılıyor', () => {
    const tool = getCarosLabTool('address-search-evidence');
    expect(tool).not.toBeNull();
    expect(tool!.status).toBe('AVAILABLE');
    expect(tool!.category).toBe('vehicle');
    /* PLACEHOLDER değil → gerçekten bir bileşen dönmeli. */
    expect(renderAvailableTool('address-search-evidence')).not.toBeNull();
  });

  it('🔒 boş defterle çökmeden çizilir ve sahte oran BASMAZ', () => {
    const html = renderToStaticMarkup(<AddressSearchEvidenceScreen />);
    expect(html).toContain('ADRES ARAMA KANITI');
    expect(html).toContain('SALT OKUNUR');
    expect(html).toContain('data-verdict="NO_DATA"');
    /* Kayıt yokken %0 gibi bir oran EKRANDA OLMAMALI. */
    expect(html).not.toMatch(/Başarısızlık oranı<\/span><span[^>]*>%0/);
    expect(html).toContain('hiç arama denemesi kaydedilmedi');
  });

  it('🔒 katalog notu gizlilik ve kapsam sınırını AÇIKÇA yazıyor', () => {
    const note = getCarosLabTool('address-search-evidence')!.note;
    expect(note).toMatch(/ADRES METNİ.*GÖSTERİLMEZ/);
    expect(note).toMatch(/KAPSAM SINIRI/);
    /* "veri OSM'de var mı" sorusunun sorulmadığı dürüstçe yazılmalı. */
    expect(note).toMatch(/yer gerçeği/i);
  });
});
