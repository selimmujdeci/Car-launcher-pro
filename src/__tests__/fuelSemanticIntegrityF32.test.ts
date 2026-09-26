/**
 * F3.2 · YAKIT LİTRESİNİN ANLAM BÜTÜNLÜĞÜ.
 *
 * ── ÖLÇÜLEN KUSUR (production `vehicle_trips`, 2026-09-18) ───────────────
 *   157 satırın **157'si** `round(distanceKm/100 × 8.5, 1)` formülüne
 *   BİREBİR uyuyor · **99'unda `fuel_used_l = 0`** ·
 *   fuel_source: ESTIMATED 157 / DERIVED 0 / MEASURED 0 ·
 *   estimated_cost 157 dolu, hepsinin price_source'u DEFAULT_FALLBACK.
 *
 * Yani "ne kadar yaktığını bilmiyoruz" bilgisi, KALICI ölçüm alanına
 * uydurulmuş bir sayı — üstelik çoğunlukla SAHTE SIFIR — olarak yazılıyordu.
 * Arayüz bunu ölçüm gibi göstermiyordu, ama verinin kendisi yanlıştı:
 * menzil · maliyet · analitik · özet gibi her gelecek tüketici onu gerçek
 * ölçüm sanabilirdi.
 *
 * ── KANONİK SÖZLEŞME ─────────────────────────────────────────────────────
 * `fuelUsedLiters != null` YALNIZ:
 *   (A) güvenilir doğrudan ECU litre kanıtı, veya
 *   (B) güvenilir yüzde × güvenilir depo kapasitesi
 * ile mümkündür. Aksi hâlde `null` — `0` DEĞİL, `8.5` türevi DEĞİL.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateFuelMeasurement,
  fuelPercentToLitres,
  createAccumulator,
  applySample,
  type TripMetricsAccumulator,
} from '../platform/trip/tripMetricsAccumulator';
import { computeTripCost, type PriceSnapshot } from '../platform/trip/tripCostModel';
import { toCanonicalTripSummary, type LegacyTripRecord } from '../platform/trip/tripLifecycle';
import { DEFAULT_FUEL_L_PER_100KM } from '../platform/vehicleAssumptions';

function obd(
  acc: TripMetricsAccumulator,
  at: number,
  fuelPercent: number | null,
): TripMetricsAccumulator {
  return applySample(acc, {
    perfNowMs: at, source: 'OBD', fresh: true,
    speedKmh: 40, rpm: 1800, engineTempC: 88, fuelPercent,
  });
}

/** Gerçek kayıt iskeleti — yalnız yakıt alanları senaryoya göre değişir. */
function record(over: Partial<LegacyTripRecord> = {}): LegacyTripRecord {
  return {
    id: 't1', startTime: 1_000, endTime: 2_000,
    distanceKm: 12.4, durationMin: 18, avgSpeedKmh: 41, maxSpeedKmh: 88,
    fuelConsumptionL: null, fuelCostTL: null,
    drivingScore: 82, harshEvents: 0,
    ...over,
  };
}

const KNOWN_PRICE: PriceSnapshot = {
  unitPrice: 45, currency: 'TRY', source: 'USER_DEFINED', capturedAtMs: 1_000,
};
const FALLBACK_PRICE: PriceSnapshot = {
  unitPrice: 45, currency: 'TRY', source: 'DEFAULT_FALLBACK', capturedAtMs: 1_000,
};

/* ═══ 1 · Litre yalnız kanıtla doğar ═════════════════════════════════════ */

describe('F3.2 · litre semantiği', () => {
  it('1 — ölçüm yoksa litre `null` (0 DEĞİL)', () => {
    let acc = createAccumulator();
    for (let i = 0; i <= 12; i += 1) acc = obd(acc, i * 6_000, -1);
    const v = evaluateFuelMeasurement(acc, 12.4);
    expect(v.measured).toBe(false);

    const s = toCanonicalTripSummary(record(), 'ENDED');
    expect(s.metrics.fuelUsedL.value).toBeNull();
    expect(s.metrics.fuelUsedL.source).toBe('UNAVAILABLE');
    /* Sahte sıfır kesinlikle YOK. */
    expect(s.metrics.fuelUsedL.value).not.toBe(0);
  });

  it('2/3 — depo kapasitesi yoksa litre yok AMA yüzde KORUNUR', () => {
    let acc = obd(createAccumulator(), 1_000, 60);
    acc = obd(acc, 60_000, 55);
    const v = evaluateFuelMeasurement(acc, 50);
    expect(v).toEqual({ measured: true, usedPercent: 5 });

    expect(fuelPercentToLitres(5, null)).toBeNull();

    const s = toCanonicalTripSummary(
      record({ fuelUsedPercent: 5, fuelRejectReason: 'NO_TANK_CAPACITY' }),
      'ENDED',
    );
    expect(s.fuelUsedPercent.value).toBe(5);
    expect(s.fuelUsedPercent.source).toBe('MEASURED');
    expect(s.metrics.fuelUsedL.value).toBeNull();
    /* Litre yoksa birim de iddia EDİLMEZ. */
    expect(s.fuelUnit).toBeNull();
  });

  it('4 — geçerli yüzde × geçerli depo → TÜRETİLMİŞ litre', () => {
    expect(fuelPercentToLitres(10, 50)).toBe(5);
    const s = toCanonicalTripSummary(
      record({ fuelConsumptionL: 5, fuelSource: 'DERIVED', fuelUsedPercent: 10 }),
      'ENDED',
    );
    expect(s.metrics.fuelUsedL).toEqual({ value: 5, source: 'DERIVED' });
    expect(s.fuelUnit).toBe('L');
  });

  it('5 — doğrudan güvenilir litre kanıtı KORUNUR', () => {
    const s = toCanonicalTripSummary(
      record({ fuelConsumptionL: 4.2, fuelSource: 'MEASURED' }), 'ENDED',
    );
    expect(s.metrics.fuelUsedL).toEqual({ value: 4.2, source: 'MEASURED' });
  });

  it('10 — makul olmayan depo kapasitesi REDDEDİLİR', () => {
    for (const tank of [null, 0, -50, 10, 500, Number.NaN]) {
      expect(fuelPercentToLitres(5, tank as number | null), String(tank)).toBeNull();
    }
  });
});

/* ═══ 2 · 8.5 sabiti ════════════════════════════════════════════════════ */

describe('F3.2 · 8.5 sabiti ölçüm olamaz', () => {
  it('6 — yolculuk kaydı artık sabitten litre TÜRETMEZ', () => {
    /* Varsayım otoritesi yerinde durur (rota ÖNCESİ tahmin onu kullanır),
       ama yolculuk ÖLÇÜM kaydına giremez. */
    expect(DEFAULT_FUEL_L_PER_100KM).toBe(8.5);
    const wouldBeFabricated = Math.round((12.4 / 100) * DEFAULT_FUEL_L_PER_100KM * 10) / 10;
    expect(wouldBeFabricated).toBe(1.1);

    const s = toCanonicalTripSummary(record(), 'ENDED');
    expect(s.metrics.fuelUsedL.value).toBeNull();
    expect(s.metrics.fuelUsedL.value).not.toBe(wouldBeFabricated);
  });

  it('6b — kısa yolculukta sahte SIFIR üretilmez (99 satırın kusuru)', () => {
    /* 0.1 km × 8.5/100 = 0.0085 → yuvarlanınca 0.0: eski davranış
       "bu yolculukta hiç yakıt harcanmadı" diyordu. */
    const fabricatedZero = Math.round((0.1 / 100) * DEFAULT_FUEL_L_PER_100KM * 10) / 10;
    expect(fabricatedZero).toBe(0);

    const s = toCanonicalTripSummary(record({ distanceKm: 0.1 }), 'ENDED');
    expect(s.metrics.fuelUsedL.value).toBeNull();
  });

  it('7 — bilinmeyen litre menzil kanıtı OLAMAZ', () => {
    /* F3 menzil tahmincisi YÜZDEye dayanır; litre alanı ona hiç girmez.
       Litre `null` olduğunda yüzde kanıtı bozulmaz. */
    const s = toCanonicalTripSummary(record({ fuelUsedPercent: 5 }), 'ENDED');
    expect(s.metrics.fuelUsedL.value).toBeNull();
    expect(s.fuelUsedPercent.value).toBe(5);
  });
});

/* ═══ 3 · Maliyet izolasyonu ════════════════════════════════════════════ */

describe('F3.2 · maliyet uydurulmaz', () => {
  it('8 — litre bilinmiyorsa KESİN maliyet üretilemez', () => {
    const c = computeTripCost({
      fuelUsedL: null, fuelSource: 'UNAVAILABLE', price: KNOWN_PRICE,
    });
    expect(c.cost).toBeNull();
    expect(c.source).toBe('UNAVAILABLE');
    expect(c.reason).toBe('NO_FUEL');
  });

  it('9 — varsayılan fiyat maliyeti ESTIMATED yapar', () => {
    const c = computeTripCost({
      fuelUsedL: 5, fuelSource: 'DERIVED', price: FALLBACK_PRICE,
    });
    expect(c.cost).toBe(225);
    expect(c.source).toBe('ESTIMATED');
  });

  it('9b — ölçülmüş litre + bilinen fiyat → DERIVED', () => {
    const c = computeTripCost({
      fuelUsedL: 5, fuelSource: 'MEASURED', price: KNOWN_PRICE,
    });
    expect(c.source).toBe('DERIVED');
  });

  it('fiyat bilinmiyorsa maliyet üretilmez', () => {
    const c = computeTripCost({
      fuelUsedL: 5, fuelSource: 'MEASURED',
      price: { unitPrice: null, currency: null, source: 'UNAVAILABLE', capturedAtMs: null },
    });
    expect(c.cost).toBeNull();
    expect(c.reason).toBe('NO_PRICE');
  });

  it('maliyet alanı kayıtta yoksa kanonik katman UNAVAILABLE der', () => {
    const s = toCanonicalTripSummary(record(), 'ENDED');
    expect(s.metrics.estimatedCost.value).toBeNull();
    expect(s.metrics.estimatedCost.source).toBe('UNAVAILABLE');
  });
});

/* ═══ 4 · Geriye uyum ═══════════════════════════════════════════════════ */

describe('F3.2 · eski kayıtlar okunabilir kalır', () => {
  it('16 — eski (sabit türevli) satır HÂLÂ okunur, sessizce silinmez', () => {
    /* Production'daki 157 satır olduğu gibi duruyor; backfill YAPILMADI.
       Kanonik katman onları hâlâ okur ve kaynağını `ESTIMATED` gösterir —
       yani "ölçüm" İDDİA ETMEZ. */
    const s = toCanonicalTripSummary(
      record({ fuelConsumptionL: 1.1, fuelSource: 'ESTIMATED', fuelCostTL: 50 }),
      'ENDED',
    );
    expect(s.metrics.fuelUsedL).toEqual({ value: 1.1, source: 'ESTIMATED' });
    expect(s.metrics.fuelUsedL.source).not.toBe('MEASURED');
  });

  it('eski sahte SIFIR satırı da ölçüm sayılmaz', () => {
    const s = toCanonicalTripSummary(
      record({ fuelConsumptionL: 0, fuelSource: 'ESTIMATED' }), 'ENDED',
    );
    expect(s.metrics.fuelUsedL.source).toBe('ESTIMATED');
    expect(s.metrics.fuelUsedL.source).not.toBe('MEASURED');
  });

  it('18/19 — F3.1 kapıları ve tek trip otoritesi korunur', () => {
    let acc = obd(createAccumulator(), 1_000, 30);
    acc = obd(acc, 60_000, 85);
    expect(evaluateFuelMeasurement(acc, 40)).toMatchObject({ reason: 'REFUEL_SUSPECTED' });
    expect(evaluateFuelMeasurement(createAccumulator(), 40))
      .toMatchObject({ reason: 'NO_START' });
  });
});
