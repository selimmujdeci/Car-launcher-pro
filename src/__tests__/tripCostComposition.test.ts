/**
 * tripCostComposition.test.ts — TRIP-COST-B3 · rota→plan wiring kilitleri.
 *
 * KAPATILAN BOŞLUK: B2 dönüşümü vardı ama çağıranı yoktu; rota modelinde
 * olmayan alanları (başlangıç · hedef · gece · yolcu · araç profili) kimse
 * sağlamıyordu. Bu testler wiring'in İKİ ana sözleşmesini kilitler:
 *   1. FİYAT KAYNAĞI OLMADAN da plan üretilir (mesafe/süre/kalem çıkar,
 *      tutar boş kalır — sıfır YAZILMAZ, tahmin ÜRETİLMEZ).
 *   2. FAIL-CLOSED: beyan edilmeyen alan varsayılanla DOLDURULMAZ; o kaleme
 *      ait maliyet HİÇ DOĞMAZ.
 */
import { describe, it, expect } from 'vitest';
import {
  buildTripCostOutcome,
  TRIP_COST_GAP_LABEL,
  TRIP_COST_CATEGORY_REASON_LABEL,
  type RouteCostSnapshot,
  type TripCostDeclaration,
} from '../platform/trip/cost/tripCostComposition';

const ROUTE: RouteCostSnapshot = { distanceM: 245_000, durationS: 9_000, hasToll: false };
const ROUTE_TOLL: RouteCostSnapshot = { ...ROUTE, hasToll: true };

/** Bugün üründe GERÇEKTEN elde olan beyan (hedef navigasyondan gelir). */
const MINIMAL: TripCostDeclaration = {
  planId: 'active-route', currency: 'TRY',
  origin: 'Konya', destination: 'Tarsus',
};

function catOf(out: ReturnType<typeof buildTripCostOutcome>, c: string) {
  return out.categories.find((x) => x.category === c)!;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · FİYAT KAYNAĞI OLMADAN ÇALIŞMA (tasarım şartı)
 * ════════════════════════════════════════════════════════════════════════ */

describe('fiyat kaynağı olmadan da plan üretilir', () => {
  it('🔒 hiçbir fiyat yokken plan KURULUR ve mesafe/süre okunur', () => {
    const out = buildTripCostOutcome(ROUTE, MINIMAL);
    expect(out.planBuilt, 'fiyat yok diye plan üretilmemiş').toBe(true);
    expect(out.totalDistanceKm).toBe(245);
    expect(out.totalDurationSeconds).toBe(9_000);
    expect(out.plan!.legs).toHaveLength(1);
    expect(out.plan!.legs[0].distanceKm).toBe(245);
  });

  it('🔒 yakıt kalemi DOĞAR ama tutarı null — sıfır YAZILMAZ', () => {
    const out = buildTripCostOutcome(ROUTE, MINIMAL);
    const fuel = out.report!.missingItems.find((i) => i.category === 'fuel');
    expect(fuel, 'yakıt kalemi hiç doğmamış — "bilinmiyor" diyecek kalem yok').toBeTruthy();
    expect(fuel!.value, 'kaynağı olmayan kaleme sayı yazılmış').toBeNull();
    expect(fuel!.status).toBe('unknown');
    expect(out.report!.knownItems, 'bilinmeyen kalem toplama girmiş').toHaveLength(0);
  });

  it('🔒 toplam SIFIR diye sunulmaz; üst sınır UYDURULMAZ', () => {
    const out = buildTripCostOutcome(ROUTE, MINIMAL);
    expect(out.report!.isComplete, 'eksik rapor "tam" sayılmış').toBe(false);
    expect(out.report!.upperBound, 'üst sınır uydurulmuş').toBeNull();
    expect(out.report!.missingItems.length).toBeGreaterThan(0);
  });

  it('🔒 mesafe kalemin BREAKDOWN\'ında taşınır (fiyat gelince hesap hazır)', () => {
    const out = buildTripCostOutcome(ROUTE, MINIMAL);
    const fuel = out.report!.missingItems.find((i) => i.category === 'fuel')!;
    expect(fuel.breakdown).toMatchObject({ totalDistanceKm: 245, legCount: 1 });
    expect((fuel.breakdown as Record<string, unknown>).pricePerLiter).toBeNull();
  });

  it('🔒 fiyat SONRADAN takılınca aynı çağrı gerçek tutar üretir', () => {
    const out = buildTripCostOutcome(ROUTE, MINIMAL, {
      fuel: { enabled: true, consumptionL100Km: 6, pricePerLiter: 50 },
    });
    const fuel = out.report!.knownItems.find((i) => i.category === 'fuel');
    expect(fuel, 'fiyat verildiği hâlde kalem bilinmiyor kalmış').toBeTruthy();
    expect(fuel!.value).toBeCloseTo(245 * 6 / 100 * 50, 6);
    expect(catOf(out, 'fuel').reason).toBe('ACIK');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · FAIL-CLOSED — beyan edilmeyen alan DOLDURULMAZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('fail-closed beyan kapısı', () => {
  it('🔒 başlangıç beyan edilmezse plan KURULMAZ (uydurulmaz)', () => {
    const out = buildTripCostOutcome(ROUTE, { ...MINIMAL, origin: undefined });
    expect(out.planBuilt).toBe(false);
    expect(out.blockedBy).toContain('BASLANGIC_BEYAN_EDILMEDI');
    expect(out.report, 'plan yokken rapor üretilmiş').toBeNull();
  });

  it('🔒 hedef beyan edilmezse plan KURULMAZ', () => {
    const out = buildTripCostOutcome(ROUTE, { ...MINIMAL, destination: undefined });
    expect(out.planBuilt).toBe(false);
    expect(out.blockedBy).toContain('HEDEF_BEYAN_EDILMEDI');
  });

  it('🔒 rota yokken plan KURULMAZ ama sebep okunur', () => {
    const out = buildTripCostOutcome(null, MINIMAL);
    expect(out.planBuilt).toBe(false);
    expect(out.blockedBy).toContain('ROTA_YOK');
    expect(out.totalDistanceKm, 'rota yokken sahte 0 km üretilmiş').toBeNull();
  });

  it('🔒 gece sayısı beyan edilmezse KONAKLAMA KALEMİ HİÇ DOĞMAZ', () => {
    const out = buildTripCostOutcome(ROUTE, MINIMAL);
    const lodging = catOf(out, 'lodging');
    expect(lodging.opened).toBe(false);
    expect(lodging.reason).toBe('GECE_SAYISI_BEYAN_EDILMEDI');
    /* Ne known ne missing — kalem YOKTUR (kategori açılmadı). */
    const all = [...out.report!.knownItems, ...out.report!.missingItems];
    expect(all.some((i) => i.category === 'lodging'),
      'beyan edilmemiş kategoriden kalem doğmuş').toBe(false);
  });

  it('🔒 yolcu sayısı VARSAYILMAZ — "1 yolcu" bile uydurmadır', () => {
    const out = buildTripCostOutcome(ROUTE, MINIMAL);
    expect(out.gaps).toContain('YOLCU_BEYAN_EDILMEDI');
    expect(out.plan!.travellers.adults,
      'beyan edilmemiş yolcu sayısına varsayılan atanmış').toBe(0);
  });

  it('🔒 araç profili beyan edilmezse propulsion UNKNOWN kalır', () => {
    const out = buildTripCostOutcome(ROUTE, MINIMAL);
    expect(out.gaps).toContain('ARAC_PROFILI_BEYAN_EDILMEDI');
    expect(out.plan!.vehicleProfile.propulsion).toBe('unknown');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · İKİ FARKLI "YOK" AYRIMI — birleştirilmesi yasak
 * ════════════════════════════════════════════════════════════════════════ */

describe('kategori AÇILMADI ≠ değer BİLİNMİYOR', () => {
  it('🔒 yakıt AÇIK ama bilinmiyor; konaklama HİÇ AÇILMADI', () => {
    const out = buildTripCostOutcome(ROUTE, MINIMAL);
    expect(catOf(out, 'fuel').opened).toBe(true);
    expect(catOf(out, 'fuel').reason).toBe('ACIK_DEGER_BILINMIYOR');
    expect(catOf(out, 'lodging').opened).toBe(false);
  });

  it('🔒 rota ÜCRETLİ ama tarife yoksa bu AYRICA işaretlenir', () => {
    const out = buildTripCostOutcome(ROUTE_TOLL, MINIMAL);
    const toll = catOf(out, 'toll');
    expect(toll.opened).toBe(false);
    expect(toll.reason, 'ücretli rota sessizce "veri yok"a düşmüş')
      .toBe('ROTA_UCRETLI_AMA_SEGMENT_YOK');
  });

  it('🔒 ücretsiz rotada toll kapısı FARKLI sebep verir', () => {
    const out = buildTripCostOutcome(ROUTE, MINIMAL);
    expect(catOf(out, 'toll').reason).toBe('UCRETLI_SEGMENT_VERISI_YOK');
  });

  it('🔒 boş segment listesiyle toll AÇILMAZ — "0 TL geçiş" YALANI üretilmez', () => {
    const out = buildTripCostOutcome(ROUTE_TOLL, MINIMAL, {
      toll: { enabled: true, segments: [], priceEntries: [] },
    });
    expect(catOf(out, 'toll').opened).toBe(false);
    const all = [...out.report!.knownItems, ...out.report!.missingItems];
    expect(all.some((i) => i.category === 'toll' && i.value === 0),
      'boş segmentten "0 TL ücretli geçiş" kalemi doğmuş').toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · Sözleşme bütünlüğü
 * ════════════════════════════════════════════════════════════════════════ */

describe('sözleşme bütünlüğü', () => {
  it('🔒 her gap ve her kategori sebebinin ETİKETİ vardır (sessiz boşluk yok)', () => {
    for (const [k, v] of Object.entries(TRIP_COST_GAP_LABEL)) {
      expect(v.length, `${k} etiketsiz`).toBeGreaterThan(0);
    }
    for (const [k, v] of Object.entries(TRIP_COST_CATEGORY_REASON_LABEL)) {
      expect(v.length, `${k} etiketsiz`).toBeGreaterThan(0);
    }
  });

  it('🔒 aynı rota + aynı beyan → aynı plan kimliği (deterministik)', () => {
    const a = buildTripCostOutcome(ROUTE, MINIMAL);
    const b = buildTripCostOutcome(ROUTE, MINIMAL);
    expect(a.plan!.id).toBe(b.plan!.id);
    expect(a.plan!.legs[0].id).toBe(b.plan!.legs[0].id);
  });

  it('🔒 composition SAF — girdi mutasyona uğramaz', () => {
    const decl = { ...MINIMAL };
    const route = { ...ROUTE };
    buildTripCostOutcome(route, decl);
    expect(decl).toEqual(MINIMAL);
    expect(route).toEqual(ROUTE);
  });
});
