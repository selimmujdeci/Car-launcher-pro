/**
 * P0-NAV-08 — ARAMA SONUCU KALİTESİ + ÇEVRİMDIŞI KAPSAM (KİLİT).
 *
 * Bu dosya ÜÇ şeyi kilitler:
 *  1. Zincir hükmü (`classifySearchChain`) — "gerçek 0" ile "beklemedik",
 *     "çözümleyemedik", "çevrimdışı" ve "biz eledik" ayrı sınıflardır.
 *  2. Sıralama kanıtı (`rankPlaces().breakdown`) — bir sonucun neden birinci
 *     olduğu ÖLÇÜLEBİLİR bileşenlere ayrılır.
 *  3. Türkçe harf-duyarsız eşleşme — İ/ı/i/I · ş/s · ç/c · ğ/g · ö/o · ü/u.
 *
 * SAF: ağ YOK · timer YOK · cihaz YOK. Hepsi fikstür üzerinde koşar.
 */

import { describe, it, expect } from 'vitest';

import {
  classifySearchChain,
  describeDedupe,
  isUsableCoordinate,
  notAttempted,
  wasProviderReached,
  type SearchProviderAttempt,
} from '../platform/geo/searchChainModel';
import {
  dedupePlacesWithEvidence,
  detectPlaceIntent,
  normalizePlaceQuery,
  rankPlaces,
  type RankablePlace,
} from '../platform/geo/placeQueryModel';
import { foldTr } from '../platform/navigation/core/turkishFold';

/* ── Yardımcılar ─────────────────────────────────────────────────────────── */

const att = (
  provider: SearchProviderAttempt['provider'],
  outcome: SearchProviderAttempt['outcome'],
  rawCount: number | null = null,
  keptCount: number | null = null,
  ms: number | null = null,
): SearchProviderAttempt => ({ provider, outcome, rawCount, keptCount, ms });

/** Tarsus merkezi — canlı ölçümlerin yapıldığı konum. */
const TARSUS = { lat: 36.9175, lng: 34.8621 };

const place = (
  id: string,
  name: string,
  lat: number,
  lng: number,
  layer: RankablePlace['layer'],
  extra: Partial<RankablePlace> = {},
): RankablePlace => ({ id, name, lat, lng, layer, ...extra });

/** Sıralayıp adları döner — testler sırayı adla okur. */
function rankNames(query: string, cands: readonly RankablePlace[], origin = TARSUS): string[] {
  return rankPlaces(detectPlaceIntent(query), cands, { origin, limit: 10 })
    .map((r) => r.item.name);
}

/* ══════════════════════════════════════════════════════════════════════════
   1) ZİNCİR HÜKMÜ — BAŞARISIZLIK SINIFLARI AYRIŞIR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-08 › zincir hükmü', () => {
  it('sonuç varsa hüküm RESULTS — başka soru sorulmaz', () => {
    const c = classifySearchChain([att('NOMINATIM', 'HIT', 4, 4)], { resultCount: 4, online: true });
    expect(c.verdict).toBe('RESULTS');
  });

  it('deneme bildirilmediyse hüküm UNKNOWN — "veri yok" İDDİA EDİLMEZ', () => {
    const c = classifySearchChain([], { resultCount: 0, online: true });
    expect(c.verdict).toBe('UNKNOWN');
    expect(c.attemptedCount).toBe(0);
  });

  it('yalnız NOT_ATTEMPTED bildirildiyse yine UNKNOWN', () => {
    const c = classifySearchChain(
      [notAttempted('NOMINATIM'), notAttempted('OVERPASS_STREET')],
      { resultCount: 0, online: true },
    );
    expect(c.verdict).toBe('UNKNOWN');
  });

  it('TÜM sağlayıcılara ulaşıldı ve hepsi 0 döndü → TRUE_ZERO', () => {
    const c = classifySearchChain(
      [att('NOMINATIM', 'ZERO', 0, 0), att('OVERPASS_STREET', 'ZERO', 0, 0)],
      { resultCount: 0, online: true },
    );
    expect(c.verdict).toBe('TRUE_ZERO');
    expect(c.reachedCount).toBe(2);
    expect(c.totalRaw).toBe(0);
  });

  it('TEK bir zaman aşımı TRUE_ZERO iddiasını ÇÜRÜTÜR', () => {
    /* Saha dersi (2026-08-08 "Ofis Parkı"): beklemediğimiz sağlayıcı doğru
       cevabı vermiş olabilir. "Veri yok" demek o cevabı görünmez kılardı. */
    const c = classifySearchChain(
      [att('NOMINATIM', 'ZERO', 0, 0), att('OVERPASS_STREET', 'TIMEOUT')],
      { resultCount: 0, online: true },
    );
    expect(c.verdict).toBe('TIMEOUT');
    expect(c.verdict).not.toBe('TRUE_ZERO');
  });

  it('servis hatası da TRUE_ZERO iddiasını çürütür', () => {
    const c = classifySearchChain(
      [att('NOMINATIM', 'ZERO', 0, 0), att('OVERPASS_STREET', 'ERROR')],
      { resultCount: 0, online: true },
    );
    expect(c.verdict).toBe('PROVIDER_ERROR');
  });

  it('çözümleme hatası EN YÜKSEK önceliklidir — tek KOD kusuru sınıfı', () => {
    const c = classifySearchChain(
      [att('NOMINATIM', 'PARSE_ERROR'), att('OVERPASS_STREET', 'TIMEOUT')],
      { resultCount: 0, online: true },
    );
    expect(c.verdict).toBe('PARSE_FAILURE');
  });

  it('adaylar geldi ama kapılar hepsini eledi → FILTERED_OUT (TRUE_ZERO DEĞİL)', () => {
    const c = classifySearchChain(
      [att('NOMINATIM', 'HIT', 4, 0)],
      { resultCount: 0, online: true },
    );
    expect(c.verdict).toBe('FILTERED_OUT');
    expect(c.totalRaw).toBe(4);
    expect(c.totalKept).toBe(0);
  });

  it('çevrimdışı + cihaz-içi kaynak DENENDİ → OFFLINE_NO_COVERAGE', () => {
    const c = classifySearchChain(
      [
        att('LOCAL_HISTORY', 'ZERO', 0, 0),
        att('LOCAL_POI', 'ZERO', 0, 0),
        att('NOMINATIM', 'OFFLINE_SKIPPED'),
      ],
      { resultCount: 0, online: false },
    );
    expect(c.verdict).toBe('OFFLINE_NO_COVERAGE');
  });

  it('çevrimdışı + cihaz-içi kaynak da DENENMEDİ → NETWORK_UNAVAILABLE', () => {
    const c = classifySearchChain(
      [att('NOMINATIM', 'OFFLINE_SKIPPED'), att('OVERPASS_STREET', 'OFFLINE_SKIPPED')],
      { resultCount: 0, online: false },
    );
    expect(c.verdict).toBe('NETWORK_UNAVAILABLE');
  });

  it('çevrimdışı hüküm, ZAMAN AŞIMI hükmünden ÖNCE gelir (ağ yoksa beklemek anlamsız)', () => {
    const c = classifySearchChain(
      [att('LOCAL_POI', 'ZERO', 0, 0), att('NOMINATIM', 'TIMEOUT')],
      { resultCount: 0, online: false },
    );
    expect(c.verdict).toBe('OFFLINE_NO_COVERAGE');
  });

  it('kanıt tamlığı ölçülür: ham sayı bildirmeyen ulaşılmış sağlayıcı varsa false', () => {
    const full = classifySearchChain([att('NOMINATIM', 'ZERO', 0, 0)], { resultCount: 0, online: true });
    expect(full.evidenceComplete).toBe(true);
    const partial = classifySearchChain([att('NOMINATIM', 'ZERO', null, null)], { resultCount: 0, online: true });
    expect(partial.evidenceComplete).toBe(false);
  });

  it('NOT_ATTEMPTED bir DENEME sayılmaz', () => {
    const c = classifySearchChain(
      [att('NOMINATIM', 'ZERO', 0, 0), notAttempted('NOMINATIM_RELAXED')],
      { resultCount: 0, online: true },
    );
    expect(c.attemptedCount).toBe(1);
  });

  it('ulaşma tanımı: yalnız HIT ve ZERO', () => {
    expect(wasProviderReached('HIT')).toBe(true);
    expect(wasProviderReached('ZERO')).toBe(true);
    for (const o of ['TIMEOUT', 'ERROR', 'PARSE_ERROR', 'OFFLINE_SKIPPED',
      'NOT_CONFIGURED', 'NOT_ATTEMPTED'] as const) {
      expect(wasProviderReached(o)).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) TÜRKÇE HARF-DUYARSIZ EŞLEŞME
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-08 › Türkçe arama katlaması', () => {
  it('i ailesinin TAMAMI tek hedefe katlanır (İ · I · ı · i)', () => {
    const target = foldTr('istanbul');
    for (const v of ['İstanbul', 'ISTANBUL', 'ıstanbul', 'istanbul', 'İSTANBUL']) {
      expect(foldTr(v)).toBe(target);
    }
  });

  it('ş/s · ç/c · ğ/g · ö/o · ü/u çiftleri aynı anahtarı üretir', () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['Şişli', 'sisli'],
      ['Çankaya', 'cankaya'],
      ['Bağlar', 'baglar'],
      ['Gölbaşı', 'golbasi'],
      ['Ürgüp', 'urgup'],
    ];
    for (const [a, b] of pairs) expect(foldTr(a)).toBe(foldTr(b));
  });

  it('katlama GÖRÜNMEZ birleşen bırakmaz (İ.toLowerCase() tuzağı)', () => {
    const folded = foldTr('İzmir');
    expect(folded).toBe('izmir');
    expect(folded.length).toBe(5);           // U+0307 kalsaydı 6 olurdu
    expect(folded.includes('̇')).toBe(false);
  });

  it('arama anahtarı katlamayı KULLANIR — "Şifa" ile "sifa" aynı sorgudur', () => {
    expect(normalizePlaceQuery('Şifa Eczanesi')).toBe(normalizePlaceQuery('sifa eczanesi'));
    expect(normalizePlaceQuery('İSTANBUL Caddesi')).toBe(normalizePlaceQuery('istanbul caddesi'));
  });

  it('katlama bir GÖSTERİM dönüşümü değildir — aday adı DEĞİŞMEZ', () => {
    const names = rankNames('sisli', [place('a', 'Şişli Eczanesi', 36.92, 34.86, 'NOMINATIM')]);
    expect(names[0]).toBe('Şişli Eczanesi');   // ekranda kullanıcının gördüğü ad
  });

  it('Türkçe yazılmış kategori sorgusu diyakritiksiz de tanınır', () => {
    expect(detectPlaceIntent('en yakın şarj istasyonu').category?.id).toBe('sarj');
    expect(detectPlaceIntent('en yakin sarj istasyonu').category?.id).toBe('sarj');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) SIRALAMA KANITI — "NEDEN BU BİRİNCİ"
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-08 › sıralama kanıtı (breakdown)', () => {
  const cands = [
    place('a', 'Florya Pastanesi', 36.93, 34.87, 'OVERPASS_CATEGORY', { categoryId: 'pastane' }),
    place('b', 'Pastane', 40.18, 29.06, 'NOMINATIM'),
  ];

  it('her sonuç ölçülebilir BİLEŞENLER taşır', () => {
    const ranked = rankPlaces(detectPlaceIntent('pastane'), cands, { origin: TARSUS, limit: 5 });
    expect(ranked.length).toBeGreaterThan(0);
    const b = ranked[0].breakdown;
    for (const k of ['total', 'name', 'category', 'distance', 'context', 'layerBonus'] as const) {
      expect(typeof b[k]).toBe('number');
      expect(Number.isFinite(b[k])).toBe(true);
    }
  });

  it('bileşenlerin ağırlıklı toplamı TOPLAM puana eşittir (kanıt uydurma DEĞİL)', () => {
    const intent = detectPlaceIntent('pastane');
    const ranked = rankPlaces(intent, cands, { origin: TARSUS, limit: 5 });
    /* Kategori sorgusunun ağırlıkları — `rankPlaces` içindeki `W` ile aynı. */
    const W = { name: 0.20, cat: 0.35, dist: 0.42, ctx: 0.03 };
    for (const r of ranked) {
      const b = r.breakdown;
      const recomputed = W.name * b.name + W.cat * b.category
                       + W.dist * b.distance + W.ctx * b.context + b.layerBonus;
      expect(recomputed).toBeCloseTo(b.total, 2);
      expect(b.total).toBe(r.score);
    }
  });

  it('ham puanlar 0–1 aralığındadır (layerBonus hariç — o mutlaktır)', () => {
    const ranked = rankPlaces(detectPlaceIntent('pastane'), cands, { origin: TARSUS, limit: 5 });
    for (const r of ranked) {
      for (const k of ['name', 'category', 'distance', 'context'] as const) {
        expect(r.breakdown[k]).toBeGreaterThanOrEqual(0);
        expect(r.breakdown[k]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('konum YOKSA mesafe ÜRETİLMEZ ama nötr ağırlık taşınır (sahte 0 yasağı)', () => {
    const ranked = rankPlaces(detectPlaceIntent('pastane'), cands, { origin: null, limit: 5 });
    for (const r of ranked) {
      expect(r.distanceKm).toBeNull();
      expect(r.breakdown.distance).toBeCloseTo(0.35, 3);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) FİKSTÜR SENARYOLARI — ÜRÜN DAVRANIŞI
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-08 › arama fikstürleri', () => {
  it('TAM işletme adı: birebir eşleşen aday üste çıkar', () => {
    const names = rankNames('Florya Pastanesi', [
      place('x', 'Flamingo Pastanesi', 36.930, 34.870, 'OVERPASS_CATEGORY', { categoryId: 'pastane' }),
      place('y', 'Florya Pastanesi', 36.935, 34.875, 'OVERPASS_CATEGORY', { categoryId: 'pastane' }),
    ]);
    expect(names[0]).toBe('Florya Pastanesi');
  });

  it('KISMİ ad: ön-ek eşleşmesi alakasız adayı geçer', () => {
    const names = rankNames('flor', [
      place('x', 'Zümrüt Market', 36.920, 34.863, 'NOMINATIM'),
      place('y', 'Florya Pastanesi', 36.930, 34.870, 'NOMINATIM'),
    ]);
    expect(names[0]).toBe('Florya Pastanesi');
  });

  it('YAZIM HATASI: tek harf hatası doğru adayı KAYBETTİRMEZ', () => {
    const names = rankNames('florya pastanesi', [
      place('x', 'Kardeşler Market', 36.918, 34.862, 'NOMINATIM'),
      place('y', 'Florya Pastanesi', 36.930, 34.870, 'NOMINATIM'),
    ]);
    expect(names[0]).toBe('Florya Pastanesi');
    const typo = rankNames('florya pastanesı', [
      place('x', 'Kardeşler Market', 36.918, 34.862, 'NOMINATIM'),
      place('y', 'Florya Pastanesi', 36.930, 34.870, 'NOMINATIM'),
    ]);
    expect(typo[0]).toBe('Florya Pastanesi');
  });

  it('KATEGORİ sorgusu: ad benzerliği DÜŞÜK olsa da kategori kanıtı kazanır', () => {
    /* Ölçülen kusur (2026-08-23): "pastane" sorgusuna adı "Pastane" olan
       372 km'deki yer dönüyordu; 2 km'deki gerçek pastane listeye girmiyordu. */
    const names = rankNames('pastane', [
      place('uzak', 'Pastane', 40.18, 29.06, 'NOMINATIM'),
      place('yakin', 'Florya Pastanesi', 36.937, 34.878, 'OVERPASS_CATEGORY', { categoryId: 'pastane' }),
    ]);
    expect(names[0]).toBe('Florya Pastanesi');
  });

  it('"EN YAKINIMDAKİ": mesafe ağırlığı artar, en yakın aday öne geçer', () => {
    const cands = [
      place('uzak', 'Shell', 37.30, 35.20, 'OVERPASS_CATEGORY', { categoryId: 'benzinlik' }),
      place('yakin', 'Petrol Ofisi', 36.9185, 34.8630, 'OVERPASS_CATEGORY', { categoryId: 'benzinlik' }),
    ];
    expect(detectPlaceIntent('en yakın benzinlik').wantsNearest).toBe(true);
    expect(rankNames('en yakın benzinlik', cands)[0]).toBe('Petrol Ofisi');
  });

  it('AYNI İSİM FARKLI YER: ikisi de KORUNUR, yakın olan üstte', () => {
    const cands = [
      place('a', 'Şok Market', 36.9200, 34.8640, 'NOMINATIM'),
      place('b', 'Şok Market', 37.0500, 35.3200, 'NOMINATIM'),
    ];
    const ranked = rankPlaces(detectPlaceIntent('Şok Market'), cands, { origin: TARSUS, limit: 5 });
    expect(ranked.length).toBe(2);                    // eleme YOK — ikisi de gerçek
    expect(ranked[0].item.id).toBe('a');
    expect((ranked[0].distanceKm ?? Infinity)).toBeLessThan(ranked[1].distanceKm ?? 0);
  });

  it('ÇEVRİMİÇİ + ÇEVRİMDIŞI AYNI YER: tekilleşir ve ZENGİN katman kazanır', () => {
    const { kept, evidence } = dedupePlacesWithEvidence([
      place('poi-1', 'Şifa Eczanesi', 36.92500, 34.86500, 'OFFLINE_POI'),
      place('nom-1', 'Şifa Eczanesi', 36.92501, 34.86501, 'NOMINATIM'),
    ]);
    expect(kept.length).toBe(1);
    expect(kept[0].layer).toBe('NOMINATIM');          // daha zengin katman
    expect(evidence).toEqual({ before: 2, after: 1, merged: 1 });
  });

  it('110 m ötedeki AYNI ADLI yer BİRLEŞTİRİLMEZ (gerçekten farklı olabilir)', () => {
    const { kept, evidence } = dedupePlacesWithEvidence([
      place('a', 'Şok Market', 36.9200, 34.8600, 'NOMINATIM'),
      place('b', 'Şok Market', 36.9600, 34.9000, 'NOMINATIM'),   // ~5 km
    ]);
    expect(kept.length).toBe(2);
    expect(evidence.merged).toBe(0);
  });

  it('SAĞLAYICI ZAMAN AŞIMI: hüküm TIMEOUT, sonuç 0 ama "veri yok" DENMEZ', () => {
    const c = classifySearchChain(
      [
        att('LOCAL_HISTORY', 'ZERO', 0, 0),
        att('LOCAL_POI', 'ZERO', 0, 0),
        att('NOMINATIM', 'TIMEOUT'),
        notAttempted('OVERPASS_STREET'),
      ],
      { resultCount: 0, online: true },
    );
    expect(c.verdict).toBe('TIMEOUT');
    expect(c.attemptedCount).toBe(3);
  });

  it('TAMAMEN ÇEVRİMDIŞI: cihaz-içi kapsam cevap verirse hüküm RESULTS', () => {
    const c = classifySearchChain(
      [
        att('LOCAL_HISTORY', 'HIT', 2, 2),
        att('LOCAL_POI', 'HIT', 3, 3),
        att('NOMINATIM', 'OFFLINE_SKIPPED'),
      ],
      { resultCount: 5, online: false },
    );
    expect(c.verdict).toBe('RESULTS');
  });

  it('GERÇEK 0 SONUÇ: tüm katmanlara ulaşıldı, hiçbiri aday üretmedi', () => {
    const c = classifySearchChain(
      [
        att('LOCAL_HISTORY', 'ZERO', 0, 0),
        att('LOCAL_POI', 'ZERO', 0, 0),
        att('NOMINATIM', 'ZERO', 0, 0),
        att('OVERPASS_STREET', 'ZERO', 0, 0),
      ],
      { resultCount: 0, online: true },
    );
    expect(c.verdict).toBe('TRUE_ZERO');
    expect(c.evidenceComplete).toBe(true);
  });

  it('UZAK TAM EŞLEŞME vs YAKIN ZAYIF EŞLEŞME: ad sorgusunda ad benzerliği baskındır', () => {
    /* Sürücü "Kuvayimilliye Caddesi" yazdıysa 0,8 km'deki alakasız camiyi
       değil, aradığı caddeyi ister — ama 700 km ötedeki bir "Cadde" de cevap
       değildir. Kilit: ADI eşleşen aday, adı eşleşmeyen yakın adayı GEÇER. */
    const names = rankNames('Kuvayimilliye Caddesi', [
      place('yakin', 'Ulu Cami', 36.9180, 34.8625, 'NOMINATIM'),
      place('dogru', 'Kuvayimilliye Caddesi', 36.9250, 34.8700, 'OVERPASS_STREET'),
    ]);
    expect(names[0]).toBe('Kuvayimilliye Caddesi');
  });

  it('ALAKA TABANI listeyi BOŞALTMAZ — taban üstü aday yoksa hepsi korunur', () => {
    const ranked = rankPlaces(detectPlaceIntent('zzzqqq'), [
      place('a', 'Bir Yer', 36.92, 34.86, 'NOMINATIM'),
    ], { origin: TARSUS, limit: 5 });
    expect(ranked.length).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) KOORDİNAT SAĞLAMLIĞI
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-08 › koordinat sözleşmesi', () => {
  it('geçerli koordinat kabul edilir', () => {
    expect(isUsableCoordinate(36.9175, 34.8621)).toBe(true);
    expect(isUsableCoordinate(-33.87, 151.21)).toBe(true);
  });

  it('0,0 · NaN · aralık dışı · sayı olmayan REDDEDİLİR', () => {
    expect(isUsableCoordinate(0, 0)).toBe(false);
    expect(isUsableCoordinate(NaN, 34.8)).toBe(false);
    expect(isUsableCoordinate(36.9, Infinity)).toBe(false);
    expect(isUsableCoordinate(91, 34.8)).toBe(false);
    expect(isUsableCoordinate(36.9, 181)).toBe(false);
    expect(isUsableCoordinate('36.9', 34.8)).toBe(false);
    expect(isUsableCoordinate(undefined, undefined)).toBe(false);
  });

  it('tekilleştirme kanıtı bozuk girdiye çökmüyor', () => {
    expect(describeDedupe(5, 3)).toEqual({ before: 5, after: 3, merged: 2 });
    expect(describeDedupe(NaN, 3)).toEqual({ before: 0, after: 3, merged: 0 });
    /* `after > before` mantıksızdır ama çökmemeli — birleşen NEGATİF olamaz. */
    expect(describeDedupe(2, 5).merged).toBe(0);
  });
});
