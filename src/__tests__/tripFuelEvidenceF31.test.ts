/**
 * F3.1 · OTOMATİK YAKIT KANITI — kapı, gerekçe ve provenance kilitleri.
 *
 * ── ÖLÇÜLEN GERÇEK (production `vehicle_trips`, 2026-09-18) ──────────────
 *   toplam 157 yolculuk · ortalama mesafe 3.9 km
 *   NO_START          149   (yüzde dolu: 0)
 *   NO_TANK_CAPACITY    4   (yüzde dolu: 4)  ← ölçüm BAŞARILI, litre yok
 *   CONTINUITY_BROKEN   2
 *   IMPLAUSIBLE         1
 *   REFUEL_SUSPECTED    1
 *
 * Yani tıkanma depo kapasitesi DEĞİL, yakıt seviyesinin hiç yakalanamaması.
 * Ama eski `NO_START` iki bambaşka gerçeği birleştiriyordu:
 *   · araç yakıtı HİÇ bildirmiyor (yetenek gerçeği — kodla düzelmez)
 *   · bildiriyor ama örnek yakalayamadık (düzeltilebilir)
 * Bu ayrım olmadan gerçek araç testi de cevap veremezdi.
 *
 * ── KİLİTLENEN INVARIANTLAR ──────────────────────────────────────────────
 * unknown ≠ zero · unsupported ≠ failure · estimated ≠ measured ·
 * derived ≠ direct · yüzde ≠ litre · fail-closed.
 */

import { describe, it, expect } from 'vitest';
import {
  createAccumulator,
  applySample,
  evaluateFuelMeasurement,
  fuelPercentToLitres,
  type TripMetricsAccumulator,
} from '../platform/trip/tripMetricsAccumulator';

/** OBD örneği uygular — gerçek birikim fonksiyonu kullanılır. */
function obd(
  acc: TripMetricsAccumulator,
  at: number,
  over: { fuelPercent?: number | null; speedKmh?: number; transportConnected?: boolean } = {},
): TripMetricsAccumulator {
  return applySample(acc, {
    perfNowMs: at,
    source: 'OBD',
    fresh: true,
    speedKmh: over.speedKmh ?? 40,
    rpm: 1800,
    engineTempC: 88,
    fuelPercent: over.fuelPercent === undefined ? 60 : over.fuelPercent,
    ...(over.transportConnected !== undefined
      ? { transportConnected: over.transportConnected } : {}),
  });
}

/* ═══ 1 · Yetenek gerçeği ile kaçırılan ölçüm ayrımı ═════════════════════ */

describe('F3.1 · reddin gerçek gerekçesi', () => {
  it('6/7 — araç yakıtı HİÇ bildirmiyorsa NO_FUEL_CAPABILITY (NO_START değil)', () => {
    /* Sentinel `-1` = "okuyamadım". Production'daki 149 satırın büyük
       olasılıkla gerçek sebebi budur; artık ölçülebilir.
       Gözlem penceresi AŞILMALI: yakıt ~20 sn kadansta olduğu için birkaç
       çerçevede görmemek kanıt değildir. */
    let acc = createAccumulator();
    for (let i = 0; i <= 12; i += 1) {
      acc = obd(acc, i * 6_000, { fuelPercent: -1 });
    }

    expect(acc.fuelSampleCount).toBe(0);
    expect(acc.obdSampleWithoutFuelCount).toBe(13);
    expect(evaluateFuelMeasurement(acc, 12)).toEqual({
      measured: false, reason: 'NO_FUEL_CAPABILITY',
    });
  });

  it('OBD hiç akmadıysa gerekçe NO_START KALIR (yetenek iddiası KURULMAZ)', () => {
    /* Yalnız GPS örneği geldi: aracın yakıtı bildirip bildirmediği hakkında
       hiçbir şey bilmiyoruz. "Desteklemiyor" demek kanıtsız olurdu. */
    const acc = applySample(createAccumulator(), {
      perfNowMs: 1000, source: 'GPS', fresh: true, speedKmh: 40,
    });
    expect(acc.obdSampleWithoutFuelCount).toBe(0);
    expect(evaluateFuelMeasurement(acc, 12)).toEqual({
      measured: false, reason: 'NO_START',
    });
  });

  it('KISA gözlemden "desteklemiyor" SONUCU ÇIKARILMAZ', () => {
    /* Yakıt ~20 sn kadansta; 5 saniyelik pencerede yakıt görmemek aracın
       o sinyali vermediğini KANITLAMAZ. Dürüst cevap `NO_START` kalır. */
    let acc = createAccumulator();
    for (let i = 1; i <= 5; i += 1) acc = obd(acc, i * 1000, { fuelPercent: -1 });
    expect(evaluateFuelMeasurement(acc, 20)).toEqual({
      measured: false, reason: 'NO_START',
    });
  });

  it('6 — desteklenmeyen yetenek SIFIR tüketim ÜRETMEZ', () => {
    let acc = createAccumulator();
    for (let i = 0; i <= 12; i += 1) acc = obd(acc, i * 6_000, { fuelPercent: -1 });
    const v = evaluateFuelMeasurement(acc, 20);
    expect(v.measured).toBe(false);
    /* `usedPercent` alanı HİÇ yok — 0 değil. */
    expect(v).not.toHaveProperty('usedPercent');
  });
});

/* ═══ 2 · Ölçüm kapıları ════════════════════════════════════════════════ */

describe('F3.1 · ölçüm kapıları fail-closed', () => {
  it('geçerli yüzde düşüşü ÖLÇÜM sayılır', () => {
    let acc = obd(createAccumulator(), 1000, { fuelPercent: 60 });
    acc = obd(acc, 60_000, { fuelPercent: 57 });
    expect(acc.fuelSampleCount).toBe(2);
    expect(evaluateFuelMeasurement(acc, 40)).toEqual({ measured: true, usedPercent: 3 });
  });

  it('9 — yakıt ARTIŞI tüketim sayılmaz (ikmal şüphesi)', () => {
    let acc = obd(createAccumulator(), 1000, { fuelPercent: 30 });
    acc = obd(acc, 60_000, { fuelPercent: 85 });
    expect(acc.refuelSuspected).toBe(true);
    expect(evaluateFuelMeasurement(acc, 40)).toMatchObject({ reason: 'REFUEL_SUSPECTED' });
  });

  it('10 — fiziksel olarak imkânsız tüketim reddedilir', () => {
    let acc = obd(createAccumulator(), 1000, { fuelPercent: 90 });
    acc = obd(acc, 60_000, { fuelPercent: 20 });
    /* 70 puan / 1 km → imkânsız. */
    expect(evaluateFuelMeasurement(acc, 1)).toMatchObject({ reason: 'IMPLAUSIBLE' });
  });

  it('5/11 — mesafe bilinmiyorsa makullük SINANAMAZ → ölçüm yok', () => {
    let acc = obd(createAccumulator(), 1000, { fuelPercent: 60 });
    acc = obd(acc, 60_000, { fuelPercent: 57 });
    expect(evaluateFuelMeasurement(acc, null)).toMatchObject({ reason: 'NO_DISTANCE' });
    expect(evaluateFuelMeasurement(acc, 0)).toMatchObject({ reason: 'NO_DISTANCE' });
  });

  it('8 — OBD sürekliliği koptuysa ölçüm geçersiz', () => {
    let acc = obd(createAccumulator(), 1000, { fuelPercent: 60 });
    acc = obd(acc, 30_000, { fuelPercent: 58, transportConnected: false });
    acc = obd(acc, 60_000, { fuelPercent: 57 });
    expect(evaluateFuelMeasurement(acc, 40)).toMatchObject({ reason: 'CONTINUITY_BROKEN' });
  });

  it('küçük negatif gürültü tüketim sayılmaz', () => {
    let acc = obd(createAccumulator(), 1000, { fuelPercent: 58 });
    acc = obd(acc, 60_000, { fuelPercent: 59 });
    expect(evaluateFuelMeasurement(acc, 40)).toMatchObject({ reason: 'NEGATIVE_DELTA' });
  });
});

/* ═══ 3 · Yüzde ≠ litre ═════════════════════════════════════════════════ */

describe('F3.1 · depo kapasitesi olmadan', () => {
  it('2 — yüzde kanıtı depo kapasitesi OLMADAN korunur', () => {
    let acc = obd(createAccumulator(), 1000, { fuelPercent: 60 });
    acc = obd(acc, 60_000, { fuelPercent: 55 });
    const v = evaluateFuelMeasurement(acc, 50);
    expect(v).toEqual({ measured: true, usedPercent: 5 });
    /* Litre üretilemiyor diye yüzde ÇÖPE ATILMAZ. */
    expect(fuelPercentToLitres(5, null)).toBeNull();
  });

  it('3 — depo kapasitesi yoksa LİTRE UYDURULMAZ', () => {
    expect(fuelPercentToLitres(5, null)).toBeNull();
    expect(fuelPercentToLitres(5, 0)).toBeNull();
    /* Makul olmayan kullanıcı girdisi de litre üretmez. */
    expect(fuelPercentToLitres(5, 10)).toBeNull();
    expect(fuelPercentToLitres(5, 500)).toBeNull();
  });

  it('15 — kullanıcı girdisi depo ECU ölçümü gibi SUNULMAZ', () => {
    /* Dönüşüm yapılabiliyor ama sonuç TÜRETMEDİR: girdi kullanıcıdan gelir.
       `fuelPercentToLitres` yalnız sayıyı verir; "MEASURED" etiketini
       hiçbir koşulda ÜRETMEZ — çağıran onu `DERIVED` işaretler. */
    expect(fuelPercentToLitres(10, 50)).toBe(5);
  });
});

/* ═══ 4 · Provenance ════════════════════════════════════════════════════ */

describe('F3.1 · provenance kaybı yok', () => {
  it('14 — `usedPercent` YALNIZ ölçüm dalında üretilir', () => {
    /* Bu, sunucudaki `fuel_used_percent` alanının DOLU olmasının zaten
       "araçtan ölçüldü" anlamına geldiğinin kilididir. Bu yüzden ayrı bir
       yüzde-provenance kolonu EKLENMEDİ (aynı gerçeği iki kez saklamak). */
    const reasons: Array<TripMetricsAccumulator> = [];
    let a = createAccumulator();                       // hiç örnek yok
    reasons.push(a);
    a = createAccumulator();                                   // yetenek yok
    for (let i = 0; i <= 12; i += 1) a = obd(a, i * 6_000, { fuelPercent: -1 });
    reasons.push(a);
    a = obd(createAccumulator(), 1000, { fuelPercent: 30 });
    a = obd(a, 60_000, { fuelPercent: 85 });                  // ikmal
    reasons.push(a);

    for (const acc of reasons) {
      const v = evaluateFuelMeasurement(acc, 40);
      expect(v.measured).toBe(false);
      expect(v).not.toHaveProperty('usedPercent');
    }
  });

  it('sayaçlar KARARI değiştirmez, yalnız gerekçeyi ölçülebilir kılar', () => {
    let withCounts = obd(createAccumulator(), 1000, { fuelPercent: 60 });
    withCounts = obd(withCounts, 60_000, { fuelPercent: 57 });
    expect(withCounts.fuelSampleCount).toBe(2);
    expect(withCounts.obdSampleWithoutFuelCount).toBe(0);
    /* Aynı iki okuma, sayaçlar olmadan da AYNI hükmü verirdi. */
    expect(evaluateFuelMeasurement(withCounts, 40)).toEqual({
      measured: true, usedPercent: 3,
    });
  });
});
