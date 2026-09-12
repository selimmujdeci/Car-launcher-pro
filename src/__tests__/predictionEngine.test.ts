/**
 * OBD-OS-F4-3 — Trend Öngörüsü ("5 dk sonra ne olacak?").
 *
 * EN ÖNEMLİ KİLİT: EMİN DEĞİLSEK SUSARIZ. Yanlış-pozitif bir "aşırı ısınma" uyarısı,
 * hiç uyarmamaktan DAHA ZARARLIDIR — kullanıcı bir daha hiçbir uyarıya inanmaz.
 * Yetersiz örneklem, gürültülü veri, yanlış yön → tahmin ÜRETİLMEZ.
 */
import { describe, it, expect } from 'vitest';
import {
  fitTrend, predict, DEFAULT_PREDICTION_RULES,
  MIN_TREND_SAMPLES, MIN_FIT_QUALITY,
  type TrendSample,
} from '../platform/obd/predictionEngine';

const T0 = 1_700_000_000_000;
/** n örnek, her biri `stepSec` arayla, `start`'tan `perMin` hızla değişen. */
function ramp(n: number, start: number, perMin: number, stepSec = 30, noise = 0): TrendSample[] {
  return Array.from({ length: n }, (_, i) => ({
    t: T0 + i * stepSec * 1000,
    value: start + perMin * ((i * stepSec) / 60) + (noise ? (i % 2 ? noise : -noise) : 0),
  }));
}

describe('OBD-OS-F4-3 — fitTrend', () => {
  it('düzgün rampa → eğim doğru (birim/dakika)', () => {
    const fit = fitTrend(ramp(8, 80, 3))!;   // dakikada +3°C
    expect(fit.slopePerMin).toBeCloseTo(3, 1);
    expect(fit.fitQuality).toBeGreaterThan(0.99);
  });

  it('🔒 KİLİT: yetersiz örneklem → null (uydurma trend YOK)', () => {
    expect(fitTrend(ramp(MIN_TREND_SAMPLES - 1, 80, 3))).toBeNull();
    expect(fitTrend([])).toBeNull();
  });

  it('sabit değer → eğim 0, uyum tam (trend YOKLUĞU ≠ gürültü)', () => {
    const fit = fitTrend(ramp(8, 90, 0))!;
    expect(fit.slopePerMin).toBeCloseTo(0, 5);
    expect(fit.fitQuality).toBe(1);
  });
});

describe('OBD-OS-F4-3 — predict: overheat', () => {
  const rule = DEFAULT_PREDICTION_RULES.overheat;   // eşik 110°C, ufuk 10 dk

  it('🔒 KİLİT: düzenli tırmanan sıcaklık → EŞİĞE VARMADAN uyarır', () => {
    // 95°C'den dakikada +3°C → 110°C'ye ~5 dk.
    const p = predict(ramp(8, 95, 3), rule, 95)!;
    expect(p).not.toBeNull();
    expect(p.kind).toBe('overheat');
    expect(p.severity).toBe('critical');
    expect(p.minutesToThreshold).toBeGreaterThan(0);
    expect(p.minutesToThreshold).toBeLessThanOrEqual(rule.horizonMin);
    expect(p.reason).toMatch(/\/dk/);         // GEREKÇE ölçülen trendi gösterir
    expect(p.confidence).toBeGreaterThan(0.9);
  });

  it('🔒 KİLİT: SOĞUYAN motorda "overheat" DENMEZ (yanlış yön → sus)', () => {
    expect(predict(ramp(8, 100, -2), rule, 100)).toBeNull();
  });

  it('🔒 KİLİT: yavaş tırmanış ufuk DIŞINDA → henüz uyarma (erken alarm yok)', () => {
    // 80°C'den dakikada +0.5°C → 110°C'ye 60 dk (ufuk 10 dk).
    expect(predict(ramp(8, 80, 0.5), rule, 80)).toBeNull();
  });

  it('🔒 KİLİT: GÜRÜLTÜLÜ veri (zayıf uyum) → tahmin ÜRETİLMEZ', () => {
    // Trend yok, sadece zıplayan gürültü.
    const noisy: TrendSample[] = Array.from({ length: 8 }, (_, i) => ({
      t: T0 + i * 30_000,
      value: 95 + (i % 2 === 0 ? 8 : -8),
    }));
    const fit = predict(noisy, rule, 95);
    expect(fit).toBeNull();
  });

  it('zaten eşiği aşmışsa ÖNGÖRÜ değildir (mevcut durum — başka katmanın işi)', () => {
    expect(predict(ramp(8, 112, 2), rule, 112)).toBeNull();
  });

  it('yetersiz örneklem → sus', () => {
    expect(predict(ramp(3, 95, 5), rule, 95)).toBeNull();
  });
});

describe('OBD-OS-F4-3 — predict: düşen sinyaller (akü / yağ basıncı)', () => {
  it('düşen akü voltajı → marş riski uyarısı', () => {
    const rule = DEFAULT_PREDICTION_RULES.battery_drain;   // eşik 11.8 V, düşüş
    // 12.4 V'tan dakikada -0.1 V → 11.8'e ~6 dk.
    const p = predict(ramp(8, 12.4, -0.1), rule, 12.4)!;
    expect(p.kind).toBe('battery_drain');
    expect(p.minutesToThreshold).toBeGreaterThan(0);
    expect(p.minutesToThreshold).toBeLessThanOrEqual(rule.horizonMin);
  });

  it('YÜKSELEN voltajda "düşüyor" DENMEZ (şarj oluyor)', () => {
    const rule = DEFAULT_PREDICTION_RULES.battery_drain;
    expect(predict(ramp(8, 12.0, +0.1), rule, 12.0)).toBeNull();
  });

  it('düşen yağ basıncı → kritik uyarı', () => {
    const rule = DEFAULT_PREDICTION_RULES.oil_pressure_drop;
    const p = predict(ramp(8, 150, -8), rule, 150)!;
    expect(p.severity).toBe('critical');
  });
});

describe('OBD-OS-F4-3 — confidence uyum kalitesinden türer (sabit değil)', () => {
  it('temiz trend → yüksek güven; gürültülü ama geçerli trend → daha düşük güven', () => {
    const clean = predict(ramp(10, 95, 3), DEFAULT_PREDICTION_RULES.overheat, 95)!;
    const noisy = predict(ramp(10, 95, 3, 30, 1.5), DEFAULT_PREDICTION_RULES.overheat, 95)!;
    expect(clean.confidence).toBeGreaterThan(noisy.confidence);
    expect(noisy.confidence).toBeGreaterThanOrEqual(MIN_FIT_QUALITY);
  });
});
