/**
 * tripMetricsP2.test.ts — TRIP METRİK GERÇEKLİĞİ KİLİTLERİ (P2).
 *
 * §14'te istenen A–H test aileleri:
 *   A metric semantics · B fuel · C cost · D driving events
 *   E durations · F max metrics · G violation · H confidence
 */

import { describe, it, expect } from 'vitest';
import {
  createAccumulator,
  applySample,
  sealAccumulator,
  evaluateFuelMeasurement,
  fuelPercentToLitres,
  buildCoverageReport,
  HARSH_DELTA_KMH,
  HARSH_DEBOUNCE_MS,
  SAMPLE_STALE_MS,
  STOP_MIN_MS,
  REFUEL_RISE_PCT,
  MAX_FUEL_PCT_PER_100KM,
  type MetricSample,
  type TripMetricsAccumulator,
} from '../platform/trip/tripMetricsAccumulator';
import {
  capturePriceSnapshot,
  computeTripCost,
  deriveEvidenceConfidence,
  weakestConfidence,
  UNAVAILABLE_PRICE,
  DEFAULT_FUEL_PRICE,
} from '../platform/trip/tripCostModel';

const T0 = 10_000;   // monotonik başlangıç

/** Örnek üreteci — varsayılan TAZE GPS örneği. */
function s(over: Partial<MetricSample> = {}): MetricSample {
  return { perfNowMs: T0, source: 'GPS', speedKmh: 50, fresh: true, ...over };
}

/** Bir dizi örneği sırayla uygular. */
function feed(samples: readonly MetricSample[]): TripMetricsAccumulator {
  let acc = createAccumulator();
  for (const x of samples) acc = applySample(acc, x);
  return acc;
}

/* ══════════════════ A · METRIC SEMANTICS ══════════════════ */

describe('A · metrik semantiği', () => {
  it('A1. 🔒 hiç ölçülmemiş metrik NULL başlar (0 DEĞİL)', () => {
    const acc = createAccumulator();
    expect(acc.maxRpm).toBeNull();
    expect(acc.maxEngineTempC).toBeNull();
    expect(acc.fuelAtStartPct).toBeNull();
    expect(acc.fuelAtEndPct).toBeNull();
    expect(acc.lastSpeedKmh).toBeNull();
    /* Sayaçlar 0 başlar — onlar ÖLÇÜM değil ADET. */
    expect(acc.harshBrakeCount).toBe(0);
    expect(acc.stopCount).toBe(0);
  });

  it('A2. 🔒 ölçülen 0 KORUNUR (rpm=0 motor kapalı gerçeğidir)', () => {
    const acc = feed([s({ source: 'OBD', rpm: 0, speedKmh: 0 })]);
    expect(acc.maxRpm).toBe(0);
  });

  it('A3. 🔒 `-1` sentinel\'i (EV/desteklenmiyor) NULL kalır', () => {
    const acc = feed([s({ source: 'OBD', rpm: -1, engineTempC: -1, fuelPercent: -1 })]);
    expect(acc.maxRpm).toBeNull();
    expect(acc.maxEngineTempC).toBeNull();
    expect(acc.fuelAtStartPct).toBeNull();
  });

  it('A4. 🔒 aralık dışı değer REDDEDİLİR', () => {
    const acc = feed([s({ source: 'OBD', rpm: 99_999, engineTempC: 500, fuelPercent: 150 })]);
    expect(acc.maxRpm).toBeNull();
    expect(acc.maxEngineTempC).toBeNull();
    expect(acc.fuelAtStartPct).toBeNull();
  });

  it('A5. 🔒 NaN/Infinity örnek durumu BOZMAZ', () => {
    const acc = feed([s({ speedKmh: NaN }), s({ perfNowMs: NaN }), s({ speedKmh: Infinity })]);
    expect(acc.speedSampleCount).toBe(0);
    expect(acc.lastSpeedKmh).toBeNull();
  });
});

/* ══════════════════ B · FUEL ══════════════════ */

describe('B · yakıt ölçümü', () => {
  const fuelRun = (start: number, end: number, extra: Partial<MetricSample> = {}) => feed([
    s({ perfNowMs: T0, source: 'OBD', fuelPercent: start, speedKmh: 40 }),
    s({ perfNowMs: T0 + 2_000, source: 'OBD', fuelPercent: end, speedKmh: 40, ...extra }),
  ]);

  it('B1. 🔒 geçerli başlangıç+bitiş → MEASURED yüzde', () => {
    const v = evaluateFuelMeasurement(fuelRun(80, 76), 50);
    expect(v.measured).toBe(true);
    if (v.measured) expect(v.usedPercent).toBe(4);
  });

  it('B2. 🔒 başlangıç YOK → ölçüm değil', () => {
    const acc = feed([s({ source: 'OBD', fuelPercent: null, speedKmh: 40 })]);
    const v = evaluateFuelMeasurement(acc, 50);
    expect(v.measured).toBe(false);
    if (!v.measured) expect(v.reason).toBe('NO_START');
  });

  it('B3. 🔒 BAYAT örnek yakıt okuması ÜRETMEZ', () => {
    const acc = feed([s({ source: 'OBD', fuelPercent: 80, fresh: false, speedKmh: 40 })]);
    expect(acc.fuelAtStartPct).toBeNull();
    expect(evaluateFuelMeasurement(acc, 50).measured).toBe(false);
  });

  it('B4. 🔒 YAKIT İKMALİ tespit edilir → ölçüm GEÇERSİZ', () => {
    const acc = fuelRun(30, 30 + REFUEL_RISE_PCT + 5);
    expect(acc.refuelSuspected).toBe(true);
    const v = evaluateFuelMeasurement(acc, 50);
    expect(v.measured).toBe(false);
    if (!v.measured) expect(v.reason).toBe('REFUEL_SUSPECTED');
  });

  it('B5. 🔒 küçük şamandıra gürültüsü ikmal SAYILMAZ', () => {
    const acc = fuelRun(50, 51);   // +1 puan < eşik
    expect(acc.refuelSuspected).toBe(false);
  });

  it('B6. 🔒 NEGATİF delta ölçüm sayılmaz', () => {
    const v = evaluateFuelMeasurement(fuelRun(50, 51), 50);
    expect(v.measured).toBe(false);
    if (!v.measured) expect(v.reason).toBe('NEGATIVE_DELTA');
  });

  it('B7. 🔒 FİZİKSEL OLARAK İMKÂNSIZ tüketim reddedilir', () => {
    /* 10 km'de %40 → %400/100km */
    const v = evaluateFuelMeasurement(fuelRun(90, 50), 10);
    expect(v.measured).toBe(false);
    if (!v.measured) expect(v.reason).toBe('IMPLAUSIBLE');
  });

  it('B8. 🔒 OBD SÜREKLİLİĞİ kırıldıysa ölçüm sayılmaz', () => {
    const acc = fuelRun(80, 76, { transportConnected: false });
    expect(acc.obdContinuityBroken).toBe(true);
    const v = evaluateFuelMeasurement(acc, 50);
    expect(v.measured).toBe(false);
    if (!v.measured) expect(v.reason).toBe('CONTINUITY_BROKEN');
  });

  it('B9. 🔒 MESAFE olmadan makullük sınanamaz → ölçüm değil', () => {
    const v = evaluateFuelMeasurement(fuelRun(80, 76), null);
    expect(v.measured).toBe(false);
    if (!v.measured) expect(v.reason).toBe('NO_DISTANCE');
  });

  it('B10. 🔒 DEPO KAPASİTESİ YOKSA litre ÜRETİLMEZ', () => {
    expect(fuelPercentToLitres(4, null)).toBeNull();
    expect(fuelPercentToLitres(4, 0)).toBeNull();
    expect(fuelPercentToLitres(4, -10)).toBeNull();
  });

  it('B11. 🔒 makul olmayan depo kapasitesi REDDEDİLİR', () => {
    expect(fuelPercentToLitres(4, 5)).toBeNull();      // 5 L depo yok
    expect(fuelPercentToLitres(4, 5_000)).toBeNull();  // 5000 L depo yok
    expect(fuelPercentToLitres(4, 50)).toBe(2);        // %4 × 50 L = 2 L
  });

  it('B12. 🔒 yüzde farkı LİTRE DEĞİLDİR (ayrı fonksiyon, ayrı kaynak)', () => {
    const v = evaluateFuelMeasurement(fuelRun(80, 76), 50);
    expect(v.measured).toBe(true);
    if (v.measured) {
      /* Ölçüm YÜZDE'dir; litre DÖNÜŞÜMDÜR (DERIVED). */
      expect(v.usedPercent).toBe(4);
      expect(fuelPercentToLitres(v.usedPercent, 50)).toBe(2);
    }
  });
});

/* ══════════════════ C · COST ══════════════════ */

describe('C · maliyet modeli', () => {
  it('C1. 🔒 kullanıcı fiyatı → USER_DEFINED snapshot', () => {
    const p = capturePriceSnapshot({ userUnitPrice: 48.5, userCurrency: 'try', nowMs: 1_000 });
    expect(p.source).toBe('USER_DEFINED');
    expect(p.unitPrice).toBe(48.5);
    expect(p.currency).toBe('TRY');
    expect(p.capturedAtMs).toBe(1_000);
  });

  it('C2. 🔒 fiyat YOKSA ve fallback KAPALIYSA maliyet null', () => {
    const p = capturePriceSnapshot({ userUnitPrice: null, nowMs: 1_000, allowFallback: false });
    expect(p).toEqual(UNAVAILABLE_PRICE);
    const c = computeTripCost({ fuelUsedL: 2, fuelSource: 'MEASURED', price: p });
    expect(c.cost).toBeNull();
    expect(c.source).toBe('UNAVAILABLE');
    expect(c.reason).toBe('NO_PRICE');
  });

  it('C3. 🔒 varsayılan fiyat DEFAULT_FALLBACK ve maliyet ESTIMATED', () => {
    const p = capturePriceSnapshot({ userUnitPrice: null, nowMs: 1_000 });
    expect(p.source).toBe('DEFAULT_FALLBACK');
    expect(p.unitPrice).toBe(DEFAULT_FUEL_PRICE.unitPrice);
    const c = computeTripCost({ fuelUsedL: 2, fuelSource: 'MEASURED', price: p });
    expect(c.source).toBe('ESTIMATED');
    expect(c.cost).toBe(90);
  });

  it('C4. 🔒 ölçülen yakıt + kullanıcı fiyatı → DERIVED (asla MEASURED)', () => {
    const p = capturePriceSnapshot({ userUnitPrice: 50, userCurrency: 'TRY', nowMs: 1 });
    const c = computeTripCost({ fuelUsedL: 2, fuelSource: 'MEASURED', price: p });
    /* Çarpım TÜRETMEDİR — "ölçülmüş maliyet" diye bir şey yok. */
    expect(c.source).toBe('DERIVED');
    expect(c.cost).toBe(100);
    expect(c.currency).toBe('TRY');
  });

  it('C5. 🔒 TAHMİNİ yakıt + gerçek fiyat → ESTIMATED (en zayıf halka)', () => {
    const p = capturePriceSnapshot({ userUnitPrice: 50, nowMs: 1 });
    const c = computeTripCost({ fuelUsedL: 3, fuelSource: 'ESTIMATED', price: p });
    expect(c.source).toBe('ESTIMATED');
  });

  it('C6. 🔒 yakıt YOKSA maliyet null', () => {
    const p = capturePriceSnapshot({ userUnitPrice: 50, nowMs: 1 });
    const c = computeTripCost({ fuelUsedL: null, fuelSource: 'UNAVAILABLE', price: p });
    expect(c.cost).toBeNull();
    expect(c.reason).toBe('NO_FUEL');
  });

  it('C7. 🔒 geçersiz kullanıcı fiyatı kabul EDİLMEZ', () => {
    expect(capturePriceSnapshot({ userUnitPrice: 0, nowMs: 1 }).source).toBe('DEFAULT_FALLBACK');
    expect(capturePriceSnapshot({ userUnitPrice: -5, nowMs: 1 }).source).toBe('DEFAULT_FALLBACK');
    expect(capturePriceSnapshot({ userUnitPrice: 99_999, nowMs: 1 }).source).toBe('DEFAULT_FALLBACK');
    expect(capturePriceSnapshot({ userUnitPrice: NaN, nowMs: 1 }).source).toBe('DEFAULT_FALLBACK');
  });

  it('C8. 🔒 SNAPSHOT: fiyat sonradan değişse maliyet DEĞİŞMEZ', () => {
    const snap = capturePriceSnapshot({ userUnitPrice: 40, userCurrency: 'TRY', nowMs: 1_000 });
    const before = computeTripCost({ fuelUsedL: 2, fuelSource: 'MEASURED', price: snap });
    /* Kullanıcı fiyatı 60'a çıkardı — ama trip SNAPSHOT'ı taşıyor. */
    const after = computeTripCost({ fuelUsedL: 2, fuelSource: 'MEASURED', price: snap });
    expect(after.cost).toBe(before.cost);
    expect(before.cost).toBe(80);
    /* Yeni snapshot yeni tripler içindir. */
    const newSnap = capturePriceSnapshot({ userUnitPrice: 60, userCurrency: 'TRY', nowMs: 2_000 });
    expect(computeTripCost({ fuelUsedL: 2, fuelSource: 'MEASURED', price: newSnap }).cost).toBe(120);
  });

  it('C9. 🔒 para birimi taşınır (farklı birimler sessizce toplanmasın)', () => {
    const p = capturePriceSnapshot({ userUnitPrice: 1.8, userCurrency: 'EUR', nowMs: 1 });
    expect(computeTripCost({ fuelUsedL: 10, fuelSource: 'MEASURED', price: p }).currency).toBe('EUR');
  });
});

/* ══════════════════ D · DRIVING EVENTS ══════════════════ */

describe('D · sürüş olayları', () => {
  it('D1. 🔒 sert fren sayılır', () => {
    const acc = feed([
      s({ perfNowMs: T0, speedKmh: 60 }),
      s({ perfNowMs: T0 + 1_000, speedKmh: 60 - HARSH_DELTA_KMH - 5 }),
    ]);
    expect(acc.harshBrakeCount).toBe(1);
    expect(acc.harshAccelCount).toBe(0);
  });

  it('D2. 🔒 ani hızlanma sayılır', () => {
    const acc = feed([
      s({ perfNowMs: T0, speedKmh: 20 }),
      s({ perfNowMs: T0 + 1_000, speedKmh: 20 + HARSH_DELTA_KMH + 5 }),
    ]);
    expect(acc.harshAccelCount).toBe(1);
    expect(acc.harshBrakeCount).toBe(0);
  });

  it('D3. 🔒 AYNI manevra ÇİFT SAYILMAZ (debounce)', () => {
    /* Tek gerçek fren: 5 Hz akışta ardışık 4 örnekte eşik aşılır. */
    let acc = createAccumulator();
    let t = T0;
    let v = 80;
    acc = applySample(acc, s({ perfNowMs: t, speedKmh: v }));
    for (let i = 0; i < 4; i += 1) {
      t += 200; v -= 18;
      acc = applySample(acc, s({ perfNowMs: t, speedKmh: Math.max(0, v) }));
    }
    expect(acc.harshBrakeCount).toBe(1);
  });

  it('D4. 🔒 debounce dolunca İKİNCİ gerçek manevra sayılır', () => {
    const acc = feed([
      s({ perfNowMs: T0, speedKmh: 60 }),
      s({ perfNowMs: T0 + 500, speedKmh: 40 }),                              // 1. olay
      s({ perfNowMs: T0 + 1_000, speedKmh: 60 }),
      s({ perfNowMs: T0 + 1_000 + HARSH_DEBOUNCE_MS + 500, speedKmh: 60 }),  // boşluk yok
    ]);
    expect(acc.harshBrakeCount).toBe(1);

    const acc2 = feed([
      s({ perfNowMs: T0, speedKmh: 60 }),
      s({ perfNowMs: T0 + 500, speedKmh: 40 }),                     // 1. fren
      s({ perfNowMs: T0 + 2_000, speedKmh: 45 }),
      s({ perfNowMs: T0 + 3_500, speedKmh: 20 }),                   // 2. fren (debounce doldu)
    ]);
    expect(acc2.harshBrakeCount).toBe(2);
  });

  it('D5. 🔒 VERİ BOŞLUĞU sonrası fark OLAY DEĞİLDİR (reconnect spike)', () => {
    const acc = feed([
      s({ perfNowMs: T0, speedKmh: 90 }),
      /* 10 s susma → dönüşte 0 km/h. Bu bir fren DEĞİL, boşluktur. */
      s({ perfNowMs: T0 + 10_000, speedKmh: 0 }),
    ]);
    expect(acc.harshBrakeCount).toBe(0);
    expect(acc.dataGapCount).toBe(1);
  });

  it('D6. 🔒 KAYNAK DEĞİŞİMİ spike\'ı olay DEĞİLDİR', () => {
    const acc = feed([
      s({ perfNowMs: T0, source: 'GPS', speedKmh: 60 }),
      s({ perfNowMs: T0 + 500, source: 'OBD', speedKmh: 20 }),   // GPS→OBD farkı
    ]);
    expect(acc.harshBrakeCount).toBe(0);
    expect(acc.sourceSwitchCount).toBe(1);
  });

  it('D7. 🔒 BAYAT örnek olay ÜRETMEZ', () => {
    const acc = feed([
      s({ perfNowMs: T0, speedKmh: 60 }),
      s({ perfNowMs: T0 + 500, speedKmh: 10, fresh: false }),
    ]);
    expect(acc.harshBrakeCount).toBe(0);
  });

  it('D8. 🔒 İLK ÖRNEKTEN olay çıkarılmaz', () => {
    const acc = feed([s({ perfNowMs: T0, speedKmh: 0 })]);
    expect(acc.harshBrakeCount).toBe(0);
    expect(acc.harshAccelCount).toBe(0);
  });

  it('D9. 🔒 TRIP SINIRI: yeni birikim sıfırdan başlar', () => {
    const acc1 = feed([
      s({ perfNowMs: T0, speedKmh: 60 }),
      s({ perfNowMs: T0 + 500, speedKmh: 20 }),
    ]);
    expect(acc1.harshBrakeCount).toBe(1);
    /* Yeni trip → yeni birikim; eski olay TAŞINMAZ. */
    expect(createAccumulator().harshBrakeCount).toBe(0);
  });

  it('D10. 🔒 eşik ALTI fark olay değildir', () => {
    const acc = feed([
      s({ perfNowMs: T0, speedKmh: 60 }),
      s({ perfNowMs: T0 + 500, speedKmh: 60 - HARSH_DELTA_KMH + 1 }),
    ]);
    expect(acc.harshBrakeCount).toBe(0);
  });
});

/* ══════════════════ E · DURATIONS ══════════════════ */

describe('E · süre sınıflandırması', () => {
  it('E1. 🔒 hareketli süre moving kovasına gider', () => {
    const acc = feed([
      s({ perfNowMs: T0, speedKmh: 50 }),
      s({ perfNowMs: T0 + 2_000, speedKmh: 50 }),
    ]);
    expect(acc.movingMs).toBe(2_000);
    expect(acc.idleMs).toBe(0);
    expect(acc.unknownMs).toBe(0);
  });

  it('E2. 🔒 duruş süresi idle kovasına gider', () => {
    const acc = feed([
      s({ perfNowMs: T0, speedKmh: 0 }),
      s({ perfNowMs: T0 + 2_000, speedKmh: 0 }),
    ]);
    expect(acc.idleMs).toBe(2_000);
    expect(acc.movingMs).toBe(0);
  });

  it('E3. 🔒 VERİ BOŞLUĞU idle SAYILMAZ → unknown', () => {
    const acc = feed([
      s({ perfNowMs: T0, speedKmh: 50 }),
      s({ perfNowMs: T0 + 30_000, speedKmh: 50 }),
    ]);
    expect(acc.unknownMs).toBe(30_000);
    expect(acc.idleMs).toBe(0);
    expect(acc.movingMs).toBe(0);
  });

  it('E4. 🔒 EŞİKLER ARASI hız (1–3 km/h) unknown\'a gider (tahmin YOK)', () => {
    const acc = feed([
      s({ perfNowMs: T0, speedKmh: 2 }),
      s({ perfNowMs: T0 + 1_000, speedKmh: 2 }),
    ]);
    expect(acc.unknownMs).toBe(1_000);
    expect(acc.idleMs).toBe(0);
  });

  it('E5. 🔒 BAYAT örnek süresi unknown\'a gider', () => {
    const acc = feed([
      s({ perfNowMs: T0, speedKmh: 50 }),
      s({ perfNowMs: T0 + 1_000, speedKmh: 50, fresh: false }),
    ]);
    expect(acc.unknownMs).toBe(1_000);
  });

  it('E6. 🔒 KARIŞIK trip: moving + idle + unknown ayrı sayılır', () => {
    const acc = feed([
      s({ perfNowMs: T0, speedKmh: 50 }),
      s({ perfNowMs: T0 + 1_000, speedKmh: 50 }),   // +1000 moving
      s({ perfNowMs: T0 + 2_000, speedKmh: 0 }),    // +1000 moving (önceki hız 50)
      s({ perfNowMs: T0 + 3_000, speedKmh: 0 }),    // +1000 idle
      s({ perfNowMs: T0 + 20_000, speedKmh: 0 }),   // +17000 unknown (boşluk)
    ]);
    expect(acc.movingMs).toBe(2_000);
    expect(acc.idleMs).toBe(1_000);
    expect(acc.unknownMs).toBe(17_000);
  });

  it('E7. 🔒 TOPLAM INVARYANTI: moving+idle+unknown <= süre', () => {
    const acc = feed([
      s({ perfNowMs: T0, speedKmh: 50 }),
      s({ perfNowMs: T0 + 1_000, speedKmh: 50 }),
      s({ perfNowMs: T0 + 2_000, speedKmh: 0 }),
      s({ perfNowMs: T0 + 25_000, speedKmh: 0 }),
    ]);
    const sealed = sealAccumulator(acc, T0 + 30_000);
    const total = sealed.movingMs + sealed.idleMs + sealed.unknownMs;
    expect(total).toBeLessThanOrEqual(30_000);
    expect(total).toBe(30_000);
  });

  it('E8. 🔒 kapanış kuyruğu unknown\'a gider (idle DEĞİL)', () => {
    const acc = feed([s({ perfNowMs: T0, speedKmh: 0 })]);
    const sealed = sealAccumulator(acc, T0 + 5_000);
    expect(sealed.unknownMs).toBe(5_000);
    expect(sealed.idleMs).toBe(0);
  });

  it('E9. 🔒 DURUŞ DEBOUNCE: kısa jitter duruş sayılmaz', () => {
    const acc = feed([
      s({ perfNowMs: T0, speedKmh: 40 }),
      s({ perfNowMs: T0 + 500, speedKmh: 0 }),
      s({ perfNowMs: T0 + 1_500, speedKmh: 40 }),   // 1 s duruş < eşik
    ]);
    expect(acc.stopCount).toBe(0);
  });

  it('E10. 🔒 gerçek duruş SAYILIR ve AYNI duruş iki kez sayılmaz', () => {
    let acc = createAccumulator();
    let t = T0;
    acc = applySample(acc, s({ perfNowMs: t, speedKmh: 40 }));
    /* 8 s boyunca 0 km/h — her 1 s'de örnek. */
    for (let i = 0; i < 8; i += 1) {
      t += 1_000;
      acc = applySample(acc, s({ perfNowMs: t, speedKmh: 0 }));
    }
    expect(acc.stopCount).toBe(1);
    expect(t - T0).toBeGreaterThan(STOP_MIN_MS);
  });

  it('E11. 🔒 iki AYRI duruş iki kez sayılır', () => {
    let acc = createAccumulator();
    let t = T0;
    const stop = () => { for (let i = 0; i < 7; i += 1) { t += 1_000; acc = applySample(acc, s({ perfNowMs: t, speedKmh: 0 })); } };
    const go = () => { for (let i = 0; i < 3; i += 1) { t += 1_000; acc = applySample(acc, s({ perfNowMs: t, speedKmh: 40 })); } };
    acc = applySample(acc, s({ perfNowMs: t, speedKmh: 40 }));
    stop(); go(); stop();
    expect(acc.stopCount).toBe(2);
  });
});

/* ══════════════════ F · MAX METRICS ══════════════════ */

describe('F · tepe metrikler', () => {
  it('F1. 🔒 max RPM taze OBD\'den gelir', () => {
    const acc = feed([
      s({ perfNowMs: T0, source: 'OBD', rpm: 2_000 }),
      s({ perfNowMs: T0 + 1_000, source: 'OBD', rpm: 4_500 }),
      s({ perfNowMs: T0 + 2_000, source: 'OBD', rpm: 3_000 }),
    ]);
    expect(acc.maxRpm).toBe(4_500);
  });

  it('F2. 🔒 max motor sıcaklığı taze OBD\'den gelir', () => {
    const acc = feed([
      s({ perfNowMs: T0, source: 'OBD', engineTempC: 70 }),
      s({ perfNowMs: T0 + 1_000, source: 'OBD', engineTempC: 96 }),
    ]);
    expect(acc.maxEngineTempC).toBe(96);
  });

  it('F3. 🔒 BAYAT OBD tepe değeri ÜRETMEZ', () => {
    const acc = feed([s({ source: 'OBD', rpm: 6_000, engineTempC: 110, fresh: false })]);
    expect(acc.maxRpm).toBeNull();
    expect(acc.maxEngineTempC).toBeNull();
  });

  it('F4. 🔒 GPS örneği motor metriği ÜRETMEZ', () => {
    const acc = feed([s({ source: 'GPS', rpm: 5_000, engineTempC: 100 })]);
    expect(acc.maxRpm).toBeNull();
    expect(acc.maxEngineTempC).toBeNull();
  });

  it('F5. 🔒 aralık dışı tepe değeri kabul edilmez', () => {
    const acc = feed([
      s({ perfNowMs: T0, source: 'OBD', rpm: 3_000, engineTempC: 90 }),
      s({ perfNowMs: T0 + 1_000, source: 'OBD', rpm: 50_000, engineTempC: 400 }),
    ]);
    expect(acc.maxRpm).toBe(3_000);
    expect(acc.maxEngineTempC).toBe(90);
  });

  it('F6. 🔒 SONRAKİ TRIP tepe değerini DEVRALMAZ', () => {
    const acc1 = feed([s({ source: 'OBD', rpm: 5_000 })]);
    expect(acc1.maxRpm).toBe(5_000);
    /* Yeni trip → yeni birikim. */
    const acc2 = createAccumulator();
    expect(acc2.maxRpm).toBeNull();
  });

  it('F7. 🔒 negatif sıcaklık geçerlidir (soğuk motor)', () => {
    const acc = feed([s({ source: 'OBD', engineTempC: -10 })]);
    expect(acc.maxEngineTempC).toBe(-10);
  });
});

/* ══════════════════ G · SPEED VIOLATION ══════════════════ */

describe('G · hız ihlali', () => {
  it('G1. 🔒 GERÇEK hız limiti kaynağı YOK → birikim ihlal ÜRETMEZ', () => {
    /* Birikimde `speedViolationCount` alanı BİLE YOK — üretilemez.
       Kod tabanında gerçek limit kaynağı bulunamadı:
         · `mapSource`: "GERÇEK IO YOK — Gerçek HERE/TomTom/OSM KAPSAM DIŞI"
         · `SPEED_LIMIT_KMH: 90`: website'te sabit global, kullanıcı/filo
           tanımı DEĞİL ve yol limiti DEĞİL. */
    const acc = feed([
      s({ perfNowMs: T0, speedKmh: 150 }),
      s({ perfNowMs: T0 + 1_000, speedKmh: 160 }),
    ]);
    expect('speedViolationCount' in acc).toBe(false);
    expect(Object.keys(acc)).not.toContain('speedViolationCount');
  });

  it('G2. 🔒 yüksek hız TEK BAŞINA ihlal DEĞİLDİR', () => {
    /* 160 km/h Almanya otobanında ihlal değildir. Limit kaynağı olmadan
       ihlal üretmek UYDURMAKTIR. */
    const acc = feed([s({ perfNowMs: T0, speedKmh: 160 })]);
    expect(acc.speedSampleCount).toBe(1);
    expect(acc.harshAccelCount).toBe(0);
  });
});

/* ══════════════════ H · CONFIDENCE ══════════════════ */

describe('H · kanıta dayalı confidence', () => {
  const cov = (over: Partial<ReturnType<typeof buildCoverageReport>> = {}) => ({
    timeCoverage: 1, obdCoverage: 0.5, speedSampleCount: 100,
    dataGapCount: 0, sourceSwitchCount: 0, ...over,
  });

  it('H1. 🔒 TAM kapsama → VERY_HIGH', () => {
    const r = deriveEvidenceConfidence({
      coverage: cov(), distanceSource: 'MEASURED', durationSource: 'MEASURED',
      cleanClose: true, durationMs: 600_000,
    });
    expect(r.overall).toBe('VERY_HIGH');
    expect(r.limitedBy).toBe('none');
  });

  it('H2. 🔒 TEK FIX yüksek güven ÜRETMEZ', () => {
    const r = deriveEvidenceConfidence({
      coverage: cov({ speedSampleCount: 1 }), distanceSource: 'MEASURED',
      durationSource: 'MEASURED', cleanClose: true, durationMs: 60_000,
    });
    expect(r.overall).toBe('LOW');
    expect(r.limitedBy).toBe('speedSamples');
  });

  it('H3. 🔒 OBD YOKLUĞU tüm trip\'i GEÇERSİZ YAPMAZ', () => {
    const r = deriveEvidenceConfidence({
      coverage: cov({ obdCoverage: 0 }), distanceSource: 'MEASURED',
      durationSource: 'MEASURED', cleanClose: true, durationMs: 600_000,
    });
    /* Mesafe güveni yüksek KALIR; yalnız motor güveni UNKNOWN. */
    expect(r.distance).toBe('VERY_HIGH');
    expect(r.overall).toBe('VERY_HIGH');
    expect(r.engine).toBe('UNKNOWN');
  });

  it('H4. 🔒 yakıt/motor güveni MESAFE güveninden AYRI', () => {
    const withObd = deriveEvidenceConfidence({
      coverage: cov({ obdCoverage: 0.9 }), distanceSource: 'MEASURED',
      durationSource: 'MEASURED', cleanClose: true, durationMs: 600_000,
    });
    const noObd = deriveEvidenceConfidence({
      coverage: cov({ obdCoverage: 0 }), distanceSource: 'MEASURED',
      durationSource: 'MEASURED', cleanClose: true, durationMs: 600_000,
    });
    expect(withObd.distance).toBe(noObd.distance);
    expect(withObd.engine).not.toBe(noObd.engine);
  });

  it('H5. 🔒 UZUN BOŞLUK güveni düşürür', () => {
    const r = deriveEvidenceConfidence({
      coverage: cov({ timeCoverage: 0.4 }), distanceSource: 'MEASURED',
      durationSource: 'MEASURED', cleanClose: true, durationMs: 600_000,
    });
    expect(r.overall).toBe('LOW');
    expect(r.limitedBy).toBe('timeCoverage');
  });

  it('H6. 🔒 ÇOK KAYNAK GEÇİŞİ güveni sınırlar', () => {
    const r = deriveEvidenceConfidence({
      coverage: cov({ sourceSwitchCount: 40 }), distanceSource: 'MEASURED',
      durationSource: 'MEASURED', cleanClose: true, durationMs: 600_000,
    });
    expect(r.overall).toBe('MEDIUM');
    expect(r.limitedBy).toBe('sourceSwitches');
  });

  it('H7. 🔒 OBD Euler mesafesi (DERIVED) tavanı MEDIUM', () => {
    const r = deriveEvidenceConfidence({
      coverage: cov(), distanceSource: 'DERIVED', durationSource: 'MEASURED',
      cleanClose: true, durationMs: 600_000,
    });
    expect(r.overall).toBe('MEDIUM');
    expect(r.limitedBy).toBe('distanceSource');
  });

  it('H8. 🔒 KİRLİ KAPANIŞ güveni sınırlar', () => {
    const r = deriveEvidenceConfidence({
      coverage: cov(), distanceSource: 'MEASURED', durationSource: 'MEASURED',
      cleanClose: false, durationMs: 600_000,
    });
    expect(r.overall).toBe('MEDIUM');
  });

  it('H9. 🔒 kanıt YOKSA UNKNOWN', () => {
    const r = deriveEvidenceConfidence({
      coverage: cov({ timeCoverage: null, obdCoverage: null, speedSampleCount: 0 }),
      distanceSource: 'UNAVAILABLE', durationSource: 'UNAVAILABLE',
      cleanClose: false, durationMs: null,
    });
    expect(r.overall).toBe('UNKNOWN');
  });

  it('H10. 🔒 en zayıf halka kuralı', () => {
    expect(weakestConfidence('VERY_HIGH', 'LOW')).toBe('LOW');
    expect(weakestConfidence('MEDIUM', 'HIGH')).toBe('MEDIUM');
    expect(weakestConfidence('UNKNOWN', 'VERY_HIGH')).toBe('UNKNOWN');
  });

  it('H11. 🔒 kapsama raporu gerçek birikimden türer', () => {
    const acc = feed([
      s({ perfNowMs: T0, source: 'GPS', speedKmh: 50 }),
      s({ perfNowMs: T0 + 1_000, source: 'OBD', speedKmh: 50 }),
      s({ perfNowMs: T0 + 2_000, source: 'GPS', speedKmh: 50 }),
    ]);
    const c = buildCoverageReport(acc);
    expect(c.speedSampleCount).toBe(3);
    expect(c.obdCoverage).toBeCloseTo(1 / 3, 2);
    expect(c.sourceSwitchCount).toBe(2);
    expect(c.timeCoverage).toBe(1);
  });

  it('H12. 🔒 hiç örnek yoksa kapsama NULL (0 DEĞİL)', () => {
    const c = buildCoverageReport(createAccumulator());
    expect(c.timeCoverage).toBeNull();
    expect(c.obdCoverage).toBeNull();
  });
});
