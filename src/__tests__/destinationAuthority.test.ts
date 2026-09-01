/**
 * P0-NAV-09 — HEDEF OTORİTESİ + ROTA İSTEĞİ BÜTÜNLÜĞÜ (KİLİT).
 *
 * ── ÖLÇÜLEN KUSUR (2026-08-24, koddan) ────────────────────────────────────
 * Ürünün koordinat kapısı `addressBookService.isValidDestination` ZATEN VARDI
 * ve doğruydu — ama YALNIZ Ev/İş hızlı-hedef yolunda çağrılıyordu. Tüm
 * hedeflerin geçtiği TEK kapı `navigationService.startNavigation` onu **HİÇ
 * çağırmıyordu**: sahiplik ("bu hedefi kim koydu") sorgulanıyor, GEÇERLİLİK
 * ("bu koordinat gerçek bir yer mi") sorulmuyordu. `NaN` · `0,0` · aralık dışı
 * bir hedef sessizce mühürlenip rota motoruna gidebiliyordu.
 *
 * SAF: ağ YOK · timer YOK · cihaz YOK.
 */

import { describe, it, expect } from 'vitest';

import {
  CHAIN_COORD_TOLERANCE_M,
  DESTINATION_STALE_MS,
  SWAP_FAR_KM,
  SWAP_NEAR_KM,
  describeSwapSuspicion,
  judgeChainIntegrity,
  judgeDestinationIntegrity,
  type DestinationCandidate,
  type DestinationChainLink,
} from '../platform/navigation/core/destinationIntegrityModel';
import { isValidDestination } from '../platform/addressBookService';

/* ── Fikstürler ──────────────────────────────────────────────────────────── */

const TARSUS = { lat: 36.9175, lng: 34.8621 };
const NOW = 1_700_000_000_000;

const good: DestinationCandidate = {
  id: 'nom-123', name: 'Bağlar Mahallesi',
  latitude: 36.9250, longitude: 34.8700,
  address: 'Bağlar Mahallesi, Tarsus, Mersin',
  provider: 'NOMINATIM', resolvedAtMs: NOW - 5_000, precision: 'STREET',
};

const ctx = { nowMs: NOW, origin: TARSUS };

/* ══════════════════════════════════════════════════════════════════════════
   1) FAIL-CLOSED KOORDİNAT KAPISI
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-09 › hedef bütünlüğü kapısı', () => {
  it('geçerli hedef KABUL edilir ve kanonik künye üretir', () => {
    const v = judgeDestinationIntegrity(good, ctx);
    expect(v.ok).toBe(true);
    expect(v.rejection).toBeNull();
    expect(v.identity).not.toBeNull();
    expect(v.identity?.placeId).toBe('nom-123');
    expect(v.identity?.displayName).toBe('Bağlar Mahallesi');
    expect(v.identity?.provider).toBe('NOMINATIM');
    expect(v.identity?.precision).toBe('STREET');
    expect(v.identity?.address).toBe('Bağlar Mahallesi, Tarsus, Mersin');
  });

  it('NaN koordinat REDDEDİLİR', () => {
    const v = judgeDestinationIntegrity({ ...good, latitude: NaN }, ctx);
    expect(v.ok).toBe(false);
    expect(v.rejection).toBe('NOT_FINITE');
    expect(v.identity).toBeNull();
  });

  it('Infinity koordinat REDDEDİLİR', () => {
    expect(judgeDestinationIntegrity({ ...good, longitude: Infinity }, ctx).rejection)
      .toBe('NOT_FINITE');
  });

  it('sayı OLMAYAN koordinat REDDEDİLİR (kör cast yok)', () => {
    expect(judgeDestinationIntegrity({ ...good, latitude: '36.9' }, ctx).rejection)
      .toBe('NOT_FINITE');
    expect(judgeDestinationIntegrity({ ...good, longitude: null }, ctx).rejection)
      .toBe('NOT_FINITE');
  });

  it('0,0 (Null Island) REDDEDİLİR — "konum yok" imzasıdır', () => {
    const v = judgeDestinationIntegrity({ ...good, latitude: 0, longitude: 0 }, ctx);
    expect(v.ok).toBe(false);
    expect(v.allRejections).toContain('NULL_ISLAND');
  });

  it('aralık dışı koordinat REDDEDİLİR', () => {
    expect(judgeDestinationIntegrity({ ...good, latitude: 91 }, ctx).allRejections)
      .toContain('OUT_OF_RANGE');
    expect(judgeDestinationIntegrity({ ...good, longitude: -181 }, ctx).allRejections)
      .toContain('OUT_OF_RANGE');
  });

  it('kimliksiz hedef REDDEDİLİR — zincir izlenemez', () => {
    expect(judgeDestinationIntegrity({ ...good, id: '' }, ctx).allRejections)
      .toContain('MISSING_ID');
    expect(judgeDestinationIntegrity({ ...good, id: '   ' }, ctx).allRejections)
      .toContain('MISSING_ID');
  });

  it('adsız hedef REDDEDİLİR — sürücüye "nereye" denemez', () => {
    expect(judgeDestinationIntegrity({ ...good, name: '' }, ctx).allRejections)
      .toContain('MISSING_NAME');
  });

  it('TÜM ihlaller sayılır — ilki hüküm, hepsi teşhis', () => {
    const v = judgeDestinationIntegrity(
      { ...good, id: '', name: '', latitude: 0, longitude: 0 }, ctx,
    );
    expect(v.allRejections).toEqual(
      expect.arrayContaining(['NULL_ISLAND', 'MISSING_ID', 'MISSING_NAME']),
    );
    expect(v.allRejections.length).toBeGreaterThanOrEqual(3);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) BAYAT ARAMA SONUCU
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-09 › bayat çözüm', () => {
  it('eşiği aşan çözüm REDDEDİLİR', () => {
    const v = judgeDestinationIntegrity(
      { ...good, resolvedAtMs: NOW - DESTINATION_STALE_MS - 1 }, ctx,
    );
    expect(v.ok).toBe(false);
    expect(v.allRejections).toContain('STALE_RESOLUTION');
  });

  it('eşiğin ALTINDAKİ çözüm kabul edilir (sınır dâhil)', () => {
    const v = judgeDestinationIntegrity(
      { ...good, resolvedAtMs: NOW - DESTINATION_STALE_MS }, ctx,
    );
    expect(v.ok).toBe(true);
  });

  it('`resolvedAtMs` BİLDİRİLMEDİYSE bayatlık İDDİA EDİLMEZ', () => {
    /* "Bilinmiyor" ≠ "bayat". Bildirmeyen çağıranı cezalandırmak, geçerli bir
       hedefi kanıtsız reddetmek olurdu. */
    const { resolvedAtMs: _drop, ...noStamp } = good;
    void _drop;
    const v = judgeDestinationIntegrity(noStamp, ctx);
    expect(v.ok).toBe(true);
    expect(v.ageMs).toBeNull();
    expect(v.allRejections).not.toContain('STALE_RESOLUTION');
  });

  it('şimdiki zaman ölçülemezse bayatlık İDDİA EDİLMEZ', () => {
    const v = judgeDestinationIntegrity(
      { ...good, resolvedAtMs: 1 }, { nowMs: null, origin: TARSUS },
    );
    expect(v.ok).toBe(true);
    expect(v.ageMs).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) ENLEM/BOYLAM TAKAS ŞÜPHESİ — KANIT, DÜZELTME DEĞİL
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-09 › takas şüphesi', () => {
  it('⚠️ ÖLÇÜLEN SINIR: Akdeniz kuşağında takas YAKALANAMAZ (dürüstlük kilidi)', () => {
    /* Tarsus 36.9175/34.8621 → takas edilirse 34.8621/36.9175. İkisi de GEÇERLİ
       aralıktadır (aralık denetimi bu sınıfı YAKALAYAMAZ) ve aradaki mesafe
       yalnız ~290 km — eşiğin ALTINDA.

       BU TEST BİR KUSURU DEĞİL, BİLİNEN BİR SINIRI KİLİTLER. Eşiği düşürerek
       "yakalamış" gibi yapmak, Hatay'a giden MEŞRU bir sürücüyü sürekli
       uyarmak demektir — sinyal gürültüye döner. Sınır açık borç olarak
       kütüğe YAZILIR; sahte bir dedektörle kapatılmaz. */
    const s = describeSwapSuspicion(34.8621, 36.9175, TARSUS);
    expect(s.asGivenKm).not.toBeNull();
    expect(s.asGivenKm ?? 0).toBeLessThan(SWAP_FAR_KM);
    expect(s.ifSwappedKm).toBeCloseTo(0, 0);
    expect(s.suspected, 'eşik sessizce düşürülmüş — yanlış pozitif riski').toBe(false);
  });

  it('enlem ile boylam AÇIKÇA ayrıştığında şüphe ÜRETİLİR', () => {
    /* İstanbul 41,0/29,0 → takas 29,0/41,0 ≈ Suudi Arabistan, ~1400 km.
       Takas edilmiş okuma kullanıcının TAM konumudur → 0 km. Sinyalin
       gerçekten konuştuğu sınıf budur. */
    const IST = { lat: 41.0082, lng: 28.9784 };
    const s = describeSwapSuspicion(IST.lng, IST.lat, IST);
    expect(s.asGivenKm ?? 0).toBeGreaterThanOrEqual(SWAP_FAR_KM);
    expect(s.ifSwappedKm ?? 999).toBeLessThanOrEqual(SWAP_NEAR_KM);
    expect(s.suspected).toBe(true);
  });

  it('yakın hedefte şüphe YOKTUR', () => {
    const s = describeSwapSuspicion(36.9250, 34.8700, TARSUS);
    expect(s.suspected).toBe(false);
  });

  it('kullanıcı konumu YOKSA şüphe İDDİA EDİLEMEZ', () => {
    const s = describeSwapSuspicion(36.9250, 34.8700, null);
    expect(s.suspected).toBe(false);
    expect(s.asGivenKm).toBeNull();
    expect(s.ifSwappedKm).toBeNull();
  });

  it('takas edilmiş okuma geçerli enlem üretmiyorsa şüphe YOKTUR', () => {
    /* boylam 150 → enlem olamaz; "takas edilmiş hâli daha yakın" cümlesi
       anlamsızdır ve uydurma bir işaret üretilmez. */
    const s = describeSwapSuspicion(10, 150, TARSUS);
    expect(s.suspected).toBe(false);
    expect(s.ifSwappedKm).toBeNull();
  });

  it('ŞÜPHE hedefi REDDETMEZ ve koordinatı DEĞİŞTİRMEZ', () => {
    /* Sessiz düzeltme, sürücüyü kanıtsız bir yere sürmektir — YASAK. */
    const IST = { lat: 41.0082, lng: 28.9784 };
    const v = judgeDestinationIntegrity(
      { ...good, latitude: IST.lng, longitude: IST.lat },
      { nowMs: NOW, origin: IST },
    );
    expect(v.ok).toBe(true);
    expect(v.identity?.latitude).toBe(IST.lng);    // DEĞİŞMEDİ
    expect(v.identity?.longitude).toBe(IST.lat);   // DEĞİŞMEDİ
    expect(v.swap.suspected).toBe(true);
    expect(v.note).toContain('ŞÜPHE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) ZİNCİR: ARAMA SONUCU → HEDEF → ROTA İSTEĞİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-09 › zincir bütünlüğü', () => {
  const link = (
    stage: DestinationChainLink['stage'],
    placeId: string | null, lat: number | null, lng: number | null,
  ): DestinationChainLink => ({ stage, placeId, latitude: lat, longitude: lng });

  it('aynı kimlik + aynı nokta → TUTARLI', () => {
    const v = judgeChainIntegrity(
      link('SEARCH_RESULT', 'nom-1', 36.9250, 34.8700),
      link('ROUTE_REQUEST', 'nom-1', 36.9250, 34.8700),
    );
    expect(v.integrity).toBe('CONSISTENT');
    expect(v.driftM).toBe(0);
  });

  it('kimlik değişmişse zincir KOPMUŞTUR (koordinat aynı olsa bile)', () => {
    const v = judgeChainIntegrity(
      link('SEARCH_RESULT', 'nom-1', 36.9250, 34.8700),
      link('ROUTE_REQUEST', 'nom-2', 36.9250, 34.8700),
    );
    expect(v.integrity).toBe('ID_DRIFT');
  });

  it('tolerans içindeki koordinat farkı AYNI nokta sayılır', () => {
    /* ~10 m — geocoder yuvarlaması. Kopma DEĞİLDİR. */
    const v = judgeChainIntegrity(
      link('SEARCH_RESULT', 'nom-1', 36.92500, 34.87000),
      link('ROUTE_REQUEST', 'nom-1', 36.92509, 34.87000),
    );
    expect(v.driftM ?? 999).toBeLessThanOrEqual(CHAIN_COORD_TOLERANCE_M);
    expect(v.integrity).toBe('CONSISTENT');
  });

  it('toleransı aşan kayma COORD_DRIFT üretir', () => {
    const v = judgeChainIntegrity(
      link('SEARCH_RESULT', 'nom-1', 36.9250, 34.8700),
      link('ROUTE_REQUEST', 'nom-1', 36.9350, 34.8700),   // ~1,1 km
    );
    expect(v.integrity).toBe('COORD_DRIFT');
    expect(v.driftM ?? 0).toBeGreaterThan(CHAIN_COORD_TOLERANCE_M);
  });

  it('hem kimlik hem koordinat kaydıysa BOTH_DRIFT', () => {
    const v = judgeChainIntegrity(
      link('SEARCH_RESULT', 'nom-1', 36.9250, 34.8700),
      link('ROUTE_REQUEST', 'nom-9', 37.5000, 35.5000),
    );
    expect(v.integrity).toBe('BOTH_DRIFT');
  });

  it('zincirin bir ucu ölçülmediyse hüküm UNKNOWN — "tutarlı" İDDİA EDİLMEZ', () => {
    expect(judgeChainIntegrity(
      link('SEARCH_RESULT', null, null, null),
      link('ROUTE_REQUEST', null, null, null),
    ).integrity).toBe('UNKNOWN');

    /* Yalnız kimlikler biliniyor, koordinat yok → yine UNKNOWN. */
    expect(judgeChainIntegrity(
      link('SEARCH_RESULT', 'nom-1', null, null),
      link('ROUTE_REQUEST', 'nom-1', null, null),
    ).integrity).toBe('UNKNOWN');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) MEVCUT KAPIYLA TUTARLILIK — İKİNCİ OTORİTE KURULMADI
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-09 › mevcut kapıyla tutarlılık', () => {
  it('koordinat hükmü `isValidDestination` ile AYNI cevabı verir', () => {
    /* İki kapı ayrışırsa hangisinin doğru olduğu tartışılır olur — bu deponun
       tekrar eden "ikinci otorite" kusurudur. Yeni kapı ESKİSİNİ kapsar. */
    const cases: ReadonlyArray<readonly [number, number]> = [
      [36.9175, 34.8621], [0, 0], [NaN, 34.8], [91, 34.8], [36.9, 181],
      [-90, -180], [90, 180], [1e-12, 1e-12],
    ];
    for (const [lat, lng] of cases) {
      const legacy = isValidDestination({ latitude: lat, longitude: lng });
      const next = judgeDestinationIntegrity(
        { ...good, latitude: lat, longitude: lng },
        { nowMs: NOW, origin: null },
      );
      const coordOk = !next.allRejections.some(
        (r) => r === 'NOT_FINITE' || r === 'OUT_OF_RANGE' || r === 'NULL_ISLAND',
      );
      expect(coordOk, `lat=${lat} lng=${lng} kapılar ayrıştı`).toBe(legacy);
    }
  });
});
