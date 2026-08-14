/**
 * etaTimeRateLimit.test.ts — #551 · ETA ÇARPANINA ZAMAN ORANI SINIRI.
 *
 * ── KÖK KANITI (2026-08-12, gerçek araç · CAROS LAB kopyası) ────────────────
 *   byTrigger: SPEED_GATE_CHANGED 7/11 · dominant HÂLÂ hız kapısı
 *   en büyükler: -174 s · -161 s · +142 s   (dördü tam `factor 1 ↔ 1.5`)
 *   blackbox hız dizisi: 55 → 42 → 23 → 10 → 0 km/sa ≈ 15 s
 *
 * #538 rampası kapıyı HIZ ekseninde sürekli yaptı ve bu doğruydu — ama saha
 * ZAMAN ekseninde ölçüyor. `rollingAvgKmh` ETA kadansında (sürüşte 5 s)
 * örneklendiği için gerçek bir yavaşlamada ağırlıklı ortalama 8 km/sa'lik
 * bandın TAMAMINI tek adımda geçiyor → `gateWeight` 1→0 → çarpan 1.5→1.
 *
 * ⚠️ #538'in kilidi (`etaSpeedGateRamp.test.ts`) bunu göremezdi: o test hızı
 * 0,5 km/sa adımlarla tarar, sahanın adımı ise 5 s'de ~15 km/sa. Bu dosya
 * eksiği kapatır — kilit ZAMAN adımında kurulur.
 *
 * Aşağıdaki ilk iki test birlikte anlamlıdır: biri sınırın çalıştığını, diğeri
 * sınır OLMADAN aynı senaryonun GERÇEKTEN sıçradığını kanıtlar (yani test
 * boşluğa kilit atmıyor).
 */

import { describe, it, expect } from 'vitest';
import {
  computeEta, rampCorrectionFactorInTime,
  ETA_MAX_CORRECTION_DRIFT_S_PER_S, ETA_DRIFT_DT_CAP_MS, ETA_MAX_FACTOR,
  type EtaInput,
} from '../platform/navigation/core/etaModel';
import { ETA_JUMP_MIN_S } from '../platform/navigation/core/etaJumpLedger';

/** Saha koşullarına yakın taban: model 60 km/sa (10 km / 600 sn). */
const BASE: EtaInput = {
  navActive: true,
  remainingRouteDurationS: 600,
  durationIntegrity: 'VALID',
  durationSource: 'OSRM_ANNOTATION',
  routeRevision: 1,
  durationRevision: 1,
  remainingDistanceM: 10_000,
  rollingAvgKmh: 60,
  stopBufferS: 0,
};

/** Sürüşteki ETA kadansı (`ETA_HYSTERESIS_MS`). */
const STEP_MS = 5_000;

/**
 * Saha yavaşlamasının ağırlıklı ortalamada bıraktığı iz — EN KÖTÜ HÂL:
 * ortalama tek örnekleme adımında bandın üstünden (30) altına (6) düşer.
 */
const FIELD_DECEL_KMH = [30, 6, 6, 12, 30, 30];

describe('#551 · ZAMAN EKSENİ KİLİDİ (saha dizisi)', () => {
  it('🔒 saha yavaşlamasında ardışık ETA farkı sıçrama eşiğinin ALTINDA kalır', () => {
    let prevFactor: number | null = null;
    let prevEta: number | null = null;

    for (const kmh of FIELD_DECEL_KMH) {
      const v = computeEta({
        ...BASE,
        rollingAvgKmh: kmh,
        previousCorrectionFactor: prevFactor,
        sinceLastEtaMs: STEP_MS,
      });
      const eta = v.etaSeconds as number;
      if (prevEta !== null) {
        expect(Math.abs(eta - prevEta), `${kmh} km/sa adımında`).toBeLessThan(ETA_JUMP_MIN_S);
      }
      prevEta = eta;
      prevFactor = v.correctionFactor;
    }
  });

  it('🔒 KONTROL: sınır olmadan aynı dizi GERÇEKTEN sıçrıyor (test boşluğa kilitlenmiyor)', () => {
    /* Girdi verilmezse eski davranış → 900 → 600 = 300 s tek adımda. */
    const fast = computeEta({ ...BASE, rollingAvgKmh: 30 }).etaSeconds as number;
    const slow = computeEta({ ...BASE, rollingAvgKmh: 6 }).etaSeconds as number;
    expect(Math.abs(fast - slow)).toBeGreaterThanOrEqual(ETA_JUMP_MIN_S);
  });

  it('🔒 tek adımdaki ETA kayması tavanla tutarlı (8 s/s × 5 s = 40 s)', () => {
    const a = computeEta({ ...BASE, rollingAvgKmh: 30 });
    const b = computeEta({
      ...BASE, rollingAvgKmh: 6,
      previousCorrectionFactor: a.correctionFactor,
      sinceLastEtaMs: STEP_MS,
    });
    const drift = Math.abs((a.etaSeconds as number) - (b.etaSeconds as number));
    expect(drift).toBeCloseTo(ETA_MAX_CORRECTION_DRIFT_S_PER_S * (STEP_MS / 1000), 0);
  });
});

describe('#551 · oran sınırı fonksiyonu (saf)', () => {
  it('🔒 kare atlanırsa dt KIRPILIR — gevşeyip sıçramaya izin vermez', () => {
    const wide = rampCorrectionFactorInTime(1.5, 1.0, 600, 60_000);
    const capped = rampCorrectionFactorInTime(1.5, 1.0, 600, ETA_DRIFT_DT_CAP_MS);
    expect(wide).toBe(capped);
    /* En kötü hâl: 8 × 6 = 48 s → hâlâ 60 s eşiğinin altında. */
    const worstDriftS = 600 * (1.5 - wide);
    expect(worstDriftS).toBeLessThan(ETA_JUMP_MIN_S);
  });

  it('🔒 hedefin ÖTESİNE geçmez (sınır yalnız frenler, yön değiştirmez)', () => {
    expect(rampCorrectionFactorInTime(1.5, 1.49, 600, STEP_MS)).toBe(1.49);
    expect(rampCorrectionFactorInTime(1.0, 1.01, 600, STEP_MS)).toBe(1.01);
  });

  it('🔒 sabit hedefte çarpan sonunda hedefe ULAŞIR (kalıcı geride kalma yok)', () => {
    let f: number | null = ETA_MAX_FACTOR;
    for (let i = 0; i < 200; i++) f = rampCorrectionFactorInTime(f, 1.0, 600, STEP_MS);
    expect(f).toBeCloseTo(1.0, 6);
  });

  it('🔒 geçmiş/süre/taban yoksa sınır UYGULANMAZ (eski çağıranlar birebir aynı)', () => {
    expect(rampCorrectionFactorInTime(null, 1.5, 600, STEP_MS)).toBe(1.5);
    expect(rampCorrectionFactorInTime(undefined, 1.5, 600, STEP_MS)).toBe(1.5);
    expect(rampCorrectionFactorInTime(1.0, 1.5, 600, undefined)).toBe(1.5);
    expect(rampCorrectionFactorInTime(1.0, 1.5, 600, 0)).toBe(1.5);
    expect(rampCorrectionFactorInTime(1.0, 1.5, 0, STEP_MS)).toBe(1.5);
    expect(rampCorrectionFactorInTime(Number.NaN, 1.5, 600, STEP_MS)).toBe(1.5);
  });

  it('🔒 varışa yakın (küçük taban) sınır KENDİLİĞİNDEN gevşer — ETA çevik kalır', () => {
    /* 20 s tabanda 8 s/s tavanı çarpanda 2.0'lik adıma izin verir → kırpma yok. */
    expect(rampCorrectionFactorInTime(1.5, 1.0, 20, STEP_MS)).toBe(1.0);
  });
});

describe('#551 · KORUNAN DAVRANIŞLAR (regresyon yok)', () => {
  it('🔒 girdiler verilmezse ETA eski hesapla BİREBİR aynı', () => {
    for (const kmh of [0, 5, 8, 12, 20, 60, 120]) {
      const withField = computeEta({ ...BASE, rollingAvgKmh: kmh });
      const legacy = computeEta({
        ...BASE, rollingAvgKmh: kmh,
        previousCorrectionFactor: null, sinceLastEtaMs: undefined,
      });
      expect(withField.etaSeconds, `${kmh} km/sa`).toBe(legacy.etaSeconds);
    }
  });

  it('🔒 TABAN süre serbest — mesafe azalınca ETA doğal düşüşünü sürdürür', () => {
    /* Sınır YALNIZ düzeltme payına konur. Taban 600 → 300 düşerse ETA de
       düşmeli; 60 s eşiğine takılıp donmamalı (yoksa ETA yalan söyler). */
    const a = computeEta({
      ...BASE, rollingAvgKmh: 60,
      previousCorrectionFactor: 1.0, sinceLastEtaMs: STEP_MS,
    });
    const b = computeEta({
      ...BASE, remainingRouteDurationS: 300, remainingDistanceM: 5_000,
      rollingAvgKmh: 60,
      previousCorrectionFactor: a.correctionFactor, sinceLastEtaMs: STEP_MS,
    });
    expect(b.etaSeconds).toBeLessThan(310);
  });

  it('🔒 ARAÇ DURUNCA ETA SONSUZA ÇIKMAZ (pazarlıksız kural korunur)', () => {
    let f: number | null = 1.5;
    for (let i = 0; i < 50; i++) {
      const v = computeEta({
        ...BASE, rollingAvgKmh: 0,
        previousCorrectionFactor: f, sinceLastEtaMs: STEP_MS,
      });
      f = v.correctionFactor;
      expect(v.etaSeconds as number).toBeLessThanOrEqual(600 * ETA_MAX_FACTOR);
    }
    expect(f).toBeCloseTo(1.0, 6);
  });

  it('🔒 gözlemlenebilirlik: ham · kapılı · uygulanan çarpan AYRI okunur', () => {
    const v = computeEta({
      ...BASE, rollingAvgKmh: 6,
      previousCorrectionFactor: 1.5, sinceLastEtaMs: STEP_MS,
    });
    expect(v.correctionFactorGated).toBe(1);          // hız rampası: kapı kapalı
    expect(v.correctionFactor).toBeGreaterThan(1);    // zaman sınırı frenledi
    expect(v.reason).toContain('zaman sınırı');
  });
});
