/**
 * addressSearchLedger.test.ts — adres arama kanıt defteri kilitleri.
 *
 * Bu testler teşhis turunun (2026-08-11) DÜRÜSTLÜK sözleşmesini kilitler:
 * sahte oran üretilmez · kanıt yetersizse sınıf UNKNOWN · gizlilik (metin yok) ·
 * yargılanmamış deneme başarısızlık SAYILMAZ.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ADDRESS_SEARCH_RING,
  appendAddressSearch,
  classifyAddressSearch,
  describeQueryShape,
  noteUserChoice,
  summarizeAddressSearches,
  supersedePending,
  type AddressSearchRecord,
  type AddressSearchSample,
} from '../platform/geo/addressSearchLedger';
import {
  _resetAddressSearchLedgerForTest,
  getAddressSearchLedger,
  getAddressSearchSummary,
  noteAddressSearchChoice,
  recordAddressSearch,
} from '../platform/geo/addressSearchLedgerStore';

const SRC = 'geocodingService.geocodeAddress';

function sample(over: Partial<AddressSearchSample> = {}): AddressSearchSample {
  return {
    atMs: 1_000,
    surface: 'VOICE_ADDRESS',
    shape: describeQueryShape('Mersin Yenişehir Mahallesi 1204 Sokak'),
    queryRewritten: false,
    queryLostRoadType: false,
    stage: 'NOMINATIM',
    resultCount: 1,
    rejectedCount: 0,
    providerMs: 400,
    fastFailHit: false,
    hadLocation: true,
    online: true,
    fallbackQueryUsable: true,
    outcome: 'RESOLVED_AUTO',
    ...over,
  };
}

describe('describeQueryShape — gizlilik ve biçim ekseni', () => {
  it('sorgu METNİNİ hiçbir alanda taşımaz', () => {
    const q = 'Tarsus Bağlar Mahallesi 0455 Sokak';
    const shape = describeQueryShape(q);
    const serialized = JSON.stringify(shape);
    /* Adres = ev adresi = PII. Defterin hiçbir alanı sorgunun parçasını
       İÇERMEZ — bu kilit gevşetilemez. */
    for (const token of ['Tarsus', 'Bağlar', 'Mahallesi', 'Sokak', '0455']) {
      expect(serialized).not.toContain(token);
    }
  });

  it('ölçülen kusur eksenlerini işaretler', () => {
    const s = describeQueryShape('İstanbul Kadıköy Bağdat Caddesi 145');
    expect(s.hasDottedCapitalI).toBe(true);    // 'İ' indeks kayması sınıfı
    expect(s.hasSuffixedRoadType).toBe(true);  // "Caddesi" — koruma kapsamı dışı
    expect(s.hasHouseNumber).toBe(true);
    expect(s.roadTypeWord).toBe('CADDE');
  });

  it('kısaltmayı ve numaralı yolu ayırt eder', () => {
    const s = describeQueryShape('Tarsus Bağlar mh 0469 sk');
    expect(s.hasAbbrev).toBe(true);
    expect(s.hasNumberedStreet).toBe(true);
    expect(s.hasSuffixedRoadType).toBe(false);
  });

  it('boş sorguda çökmez ve sahte alan üretmez', () => {
    const s = describeQueryShape('');
    expect(s.tokenCount).toBe(0);
    expect(s.roadTypeWord).toBe('NONE');
  });
});

describe('classifyAddressSearch — sınıf ancak kanıt varsa', () => {
  it('0 sonuçta veri boşluğunu İDDİA ETMEZ, yer gerçeği boşluğu yazar', () => {
    const rec = classifyAddressSearch(
      sample({ outcome: 'EMPTY', resultCount: 0, rejectedCount: 0 }), SRC);
    expect(rec.failureClass).toBe('PROVIDER_ZERO');
    expect(rec.evidenceGap).toContain('GROUND_TRUTH');
    /* "OSM'de yok" demek için yer gerçeği sorulmalı — sorulmadıysa güven 1.0 OLAMAZ. */
    expect(rec.confidence).toBeLessThan(1);
  });

  it('sonuç geldi ama hepsi elendiyse bulanık-eşleşme sınıfı kurar', () => {
    const rec = classifyAddressSearch(
      sample({ outcome: 'EMPTY', resultCount: 0, rejectedCount: 4 }), SRC);
    expect(rec.failureClass).toBe('PROVIDER_FUZZY_REJECTED');
  });

  it('yavaşlığı ZİNCİR SÜRESİNDEN değil, beklemenin bırakılmasından okur', () => {
    /* Zincir üç deneme yaptığı için 8,6 s sürebilir ama tek yanıt 606 ms olabilir
       (ölçüm 2026-08-11). Süreye bakan bir dedektör bunu YANLIŞ sınıflandırırdı. */
    const uzunAmaHizli = classifyAddressSearch(
      sample({ outcome: 'EMPTY', resultCount: 0, providerMs: 8_600, fastFailHit: false }), SRC);
    expect(uzunAmaHizli.failureClass).not.toBe('NETWORK_SLOW');
    expect(uzunAmaHizli.failureClass).toBe('PROVIDER_ZERO');

    const gercektenYavas = classifyAddressSearch(
      sample({ outcome: 'EMPTY', resultCount: 0, providerMs: 2_400, fastFailHit: true }), SRC);
    expect(gercektenYavas.failureClass).toBe('NETWORK_SLOW');
  });

  it('ayrıştırıcı yol tipini kaybettiyse sağlayıcıyı SUÇLAMAZ', () => {
    /* Ölçüm 2026-08-11: ayrıştırıcı "…0455 Sokak"ı "…0455 Mahallesi" yapıyordu.
       Böyle bir denemede 0 sonuç sağlayıcının değil ürünün hatasıdır. */
    const rec = classifyAddressSearch(
      sample({ outcome: 'EMPTY', resultCount: 0, queryLostRoadType: true }), SRC);
    expect(rec.failureClass).toBe('QUERY_CORRUPTED');
  });

  it('seçim beklerken sınıf İDDİA ETMEZ', () => {
    const rec = classifyAddressSearch(
      sample({ outcome: 'AWAITING_CHOICE', resultCount: 4 }), SRC);
    expect(rec.failureClass).toBe('UNKNOWN');
    expect(rec.confidence).toBe(0);
    expect(rec.evidenceGap).toContain('USER_CHOICE');
  });

  it('numaralı yol + ekli tip başarıda dahi koruma-kapsamı-dışı işaretlenir', () => {
    /* Ölçüldü: `_NUM_STREET_RE` "Caddesi"yi yakalamıyor → numara doğrulaması
       çalışmıyor → yanlış sokağa sessizce gidilebilir. Sonuç dönmüş olsa bile
       bu bir RİSKTİR ve defterde görünür. */
    const rec = classifyAddressSearch(sample({
      shape: describeQueryShape('Adana Çukurova 78. Caddesi'),
      outcome: 'RESOLVED_AUTO',
    }), SRC);
    expect(rec.failureClass).toBe('GUARD_OUT_OF_SCOPE');
  });

  it('ölçülmeyen alanlar kanıt boşluğu olarak sayılır', () => {
    const rec = classifyAddressSearch(sample({
      surface: null, hadLocation: null, providerMs: null, fastFailHit: null, queryRewritten: null,
    }), SRC);
    expect(rec.surface).toBe('UNKNOWN');
    expect(rec.evidenceGap).toEqual(
      expect.arrayContaining(['SURFACE', 'LOCATION', 'LATENCY', 'QUERY_INTEGRITY']));
  });

  it('sourceRef kaydın üzerinde taşınır (kanıt zinciri adresi)', () => {
    const rec = classifyAddressSearch(sample(), 'mapService.searchPlaces');
    expect(rec.sourceRef).toBe('mapService.searchPlaces');
  });
});

describe('kullanıcı seçimi — sınıf GEÇ keskinleşir', () => {
  it('seçim gelince çözüldü olur', () => {
    const rec = classifyAddressSearch(sample({ outcome: 'AWAITING_CHOICE', resultCount: 3 }), SRC);
    const after = noteUserChoice([rec], { atMs: 2_000, picked: true })[0];
    expect(after.outcome).toBe('RESOLVED_PICKED');
    expect(after.refinedFailureClass).toBe('NONE');
    expect(after.evidenceGap).not.toContain('USER_CHOICE');
  });

  it('seçmeden kapatma başarısızlıktır — "sonuç döndü" yetmez', () => {
    const rec = classifyAddressSearch(sample({ outcome: 'AWAITING_CHOICE', resultCount: 4 }), SRC);
    const after = noteUserChoice([rec], { atMs: 2_000, picked: false })[0];
    expect(after.outcome).toBe('ABANDONED');
    expect(after.refinedFailureClass).toBe('PROVIDER_FUZZY_REJECTED');
  });

  it('kanıtı olan sınıfı geriye dönük DEĞİŞTİRMEZ', () => {
    const rec = classifyAddressSearch(sample({ outcome: 'EMPTY', resultCount: 0 }), SRC);
    const after = noteUserChoice([rec], { atMs: 2_000, picked: true })[0];
    expect(after.outcome).toBe('EMPTY');
    expect(after.refinedFailureClass).toBe('PROVIDER_ZERO');
  });

  it('bekleyen kayıt yoksa defter değişmez (sahipsiz kanıt yazılmaz)', () => {
    const rec = classifyAddressSearch(sample({ outcome: 'RESOLVED_AUTO' }), SRC);
    const after = noteUserChoice([rec], { atMs: 2_000, picked: false });
    expect(after[0].outcome).toBe('RESOLVED_AUTO');
  });
});

describe('supersedePending — yargılanmamış deneme', () => {
  it('aynı yüzeydeki bekleyen kaydı SUPERSEDED yapar', () => {
    const rec = classifyAddressSearch(sample({ outcome: 'AWAITING_CHOICE', resultCount: 2 }), SRC);
    const after = supersedePending([rec], 'VOICE_ADDRESS')[0];
    expect(after.outcome).toBe('SUPERSEDED');
  });

  it('BAŞKA yüzeydeki kayda dokunmaz', () => {
    const rec = classifyAddressSearch(sample({ outcome: 'AWAITING_CHOICE', resultCount: 2 }), SRC);
    const after = supersedePending([rec], 'MAP_SEARCH_BAR')[0];
    expect(after.outcome).toBe('AWAITING_CHOICE');
  });
});

describe('summarizeAddressSearches — sahte oran YASAK', () => {
  it('kayıt yokken oran ÜRETMEZ', () => {
    const s = summarizeAddressSearches([]);
    expect(s.total).toBe(0);
    expect(s.failureRate).toBeNull();
    expect(s.medianProviderMs).toBeNull();
    expect(s.meanConfidence).toBeNull();
    expect(s.dominantFailure).toBeNull();
  });

  it('yalnız seçim bekleyen kayıt varken oran ÜRETMEZ', () => {
    const rec = classifyAddressSearch(sample({ outcome: 'AWAITING_CHOICE', resultCount: 3 }), SRC);
    const s = summarizeAddressSearches([rec]);
    expect(s.awaitingChoiceCount).toBe(1);
    expect(s.failureRate).toBeNull();
  });

  it('yargılanmamış deneme oranı BOZMAZ', () => {
    const ok   = classifyAddressSearch(sample({ outcome: 'RESOLVED_AUTO' }), SRC);
    const pend = classifyAddressSearch(sample({ outcome: 'AWAITING_CHOICE', resultCount: 2 }), SRC);
    const sup  = supersedePending([pend], 'VOICE_ADDRESS')[0];
    const s = summarizeAddressSearches([ok, sup]);
    expect(s.supersededCount).toBe(1);
    expect(s.resolvedCount).toBe(1);
    expect(s.failedCount).toBe(0);
    expect(s.failureRate).toBe(0);   // 1 çözüldü / 1 karara bağlandı
  });

  it('UNKNOWN baskın sebep OLARAK sunulmaz', () => {
    const recs = [1, 2, 3].map(() =>
      classifyAddressSearch(sample({ outcome: 'AWAITING_CHOICE', resultCount: 2 }), SRC));
    const s = summarizeAddressSearches(recs);
    expect(s.byFailureClass.UNKNOWN).toBe(3);
    expect(s.dominantFailure).toBeNull();
  });

  it('baskın sebep yalnız açık farkla öndeyse bildirilir', () => {
    const zero = () => classifyAddressSearch(
      sample({ outcome: 'EMPTY', resultCount: 0, rejectedCount: 0 }), SRC);
    const slow = () => classifyAddressSearch(
      sample({ outcome: 'EMPTY', resultCount: 0, fastFailHit: true }), SRC);
    /* Berabere: hüküm verilmez. */
    expect(summarizeAddressSearches([zero(), slow()]).dominantFailure).toBeNull();
    /* Açık fark: bildirilir. */
    expect(summarizeAddressSearches([zero(), zero(), zero(), slow()]).dominantFailure)
      .toBe('PROVIDER_ZERO');
  });

  it('en çok eksik olan kanıt "önce bunu ölç" olarak çıkar', () => {
    const recs = [1, 2].map(() => classifyAddressSearch(
      sample({ outcome: 'EMPTY', resultCount: 0, providerMs: null, fastFailHit: null }), SRC));
    const s = summarizeAddressSearches(recs);
    expect(s.nextMeasurement).not.toBeNull();
    expect(s.evidenceGapCounts.LATENCY).toBe(2);
  });
});

describe('defter halkası ve store', () => {
  beforeEach(() => { _resetAddressSearchLedgerForTest(); });

  it('halka üst sınırını aşmaz (cihazda bellek)', () => {
    let ledger: readonly AddressSearchRecord[] = [];
    for (let i = 0; i < ADDRESS_SEARCH_RING + 12; i++) {
      ledger = appendAddressSearch(ledger, classifyAddressSearch(sample({ atMs: i }), SRC));
    }
    expect(ledger.length).toBe(ADDRESS_SEARCH_RING);
    /* En YENİ kayıtlar korunur. */
    expect(ledger[ledger.length - 1].atMs).toBe(ADDRESS_SEARCH_RING + 11);
  });

  it('store kayıt yazar ve aynı yüzeyde eskiyi yargılanmamış yapar', () => {
    const input = {
      surface: 'MAP_SEARCH_BAR' as const,
      shape: describeQueryShape('Mersin Yenişehir'),
      queryRewritten: false, queryLostRoadType: false,
      stage: 'NOMINATIM' as const, resultCount: 3, rejectedCount: 0,
      providerMs: 300, fastFailHit: false, hadLocation: true, online: true, fallbackQueryUsable: null,
      outcome: 'AWAITING_CHOICE' as const,
    };
    recordAddressSearch(input, 'mapService.searchPlaces');
    recordAddressSearch(input, 'mapService.searchPlaces');
    const led = getAddressSearchLedger();
    expect(led.length).toBe(2);
    expect(led[0].outcome).toBe('SUPERSEDED');
    expect(led[1].outcome).toBe('AWAITING_CHOICE');

    noteAddressSearchChoice(true);
    expect(getAddressSearchLedger()[1].outcome).toBe('RESOLVED_PICKED');
    expect(getAddressSearchSummary().resolvedCount).toBe(1);
  });

  it('store bozuk girdide ÜRÜNÜ DÜŞÜRMEZ (fail-soft)', () => {
    expect(() => recordAddressSearch(
      // @ts-expect-error — kasıtlı bozuk girdi: kayıt yolu arama akışını bozamaz
      { surface: 'VOICE_ADDRESS', shape: null, outcome: 'EMPTY' },
      'geocodingService.geocodeAddress',
    )).not.toThrow();
  });
});
