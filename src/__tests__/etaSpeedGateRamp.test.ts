/**
 * etaSpeedGateRamp.test.ts — #538 · GÖREV C: G3 DÜZELTMESİ (HIZ KAPISI RAMPASI).
 *
 * ── KÖK KANITI (2026-08-11, gerçek araç · `etaJumpLedger`) ──────────────────
 *   byTrigger: SPEED_GATE_CHANGED 4 · ROUTE_REVISION 1 · BASE_DURATION_ONLY 1
 *              DISTANCE_SOURCE_CHANGED 0
 *   dominant : SPEED_GATE_CHANGED (4/6 = %67)
 * Dört geçişin HEPSİ `factor 1 ↔ 1.5`:
 *   ETA 167→246 · 224→150 · 143→207 · 183→122  (aritmetik beklentiyle 0-8 s uyum)
 *
 * Bu testler kapının artık anahtar değil rampa olduğunu kilitler: HIZ ekseninde
 * eşikte süreklidir. Ayrıca bantın DIŞINDA eski davranışın BİREBİR korunduğunu
 * ve defterin yeni mekanizmaya kör kalmadığını sabitler.
 *
 * ⚠️ KAPSAM UYARISI (2026-08-12 · kütük #551): buradaki kilitler HIZ eksenini
 * tarar (0,5 km/sa adımlarla). Sahanın adımı ise 5 s'de ~15 km/sa olduğu için
 * bu dosya ZAMAN ekseninde doğan basamağı GÖREMEZ — nitekim görmedi: #538'den
 * sonraki koşumda `SPEED_GATE_CHANGED` 7/11 ile hâlâ baskındı (-174 s).
 * Zaman ekseni kilidi ayrı dosyadadır: `etaTimeRateLimit.test.ts`.
 * Bu dosyadaki "yapısal olarak imkânsız" iddiası ORADA daraltıldı.
 */

import { describe, it, expect } from 'vitest';
import {
  computeEta, etaSpeedGateWeight,
  ETA_MIN_CORRECTION_KMH, ETA_GATE_RAMP_KMH, ETA_MAX_FACTOR, ETA_MIN_FACTOR,
  type EtaInput,
} from '../platform/navigation/core/etaModel';
import {
  detectEtaJump, ETA_GATE_WEIGHT_MIN_DELTA, type EtaSample,
} from '../platform/navigation/core/etaJumpLedger';

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

describe('#538 · rampa fonksiyonu', () => {
  it('🔒 eşik altı 0 · bant sonu 1 · arası kademeli', () => {
    expect(etaSpeedGateWeight(0)).toBe(0);
    expect(etaSpeedGateWeight(ETA_MIN_CORRECTION_KMH)).toBe(0);
    expect(etaSpeedGateWeight(ETA_MIN_CORRECTION_KMH + ETA_GATE_RAMP_KMH / 2)).toBeCloseTo(0.5, 6);
    expect(etaSpeedGateWeight(ETA_MIN_CORRECTION_KMH + ETA_GATE_RAMP_KMH)).toBe(1);
    expect(etaSpeedGateWeight(200)).toBe(1);
  });

  it('🔒 monoton artan ve geçersiz girdide 0 (uydurma yok)', () => {
    let prev = -1;
    for (let kmh = 0; kmh <= 30; kmh += 0.5) {
      const w = etaSpeedGateWeight(kmh);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
    expect(etaSpeedGateWeight(Number.NaN)).toBe(0);
  });
});

describe('#538 · ÖLÇÜLEN SIÇRAMA MEKANİZMASI KALDIRILDI', () => {
  /**
   * Sahada ölçülen tam senaryo: dur-kalk trafiğinde ortalama hız 8 km/h eşiğini
   * geçiyor ve çarpan 1 → 1.5 ATLIYOR. Eskiden ETA tek adımda %50 zıplıyordu.
   */
  it('🔒 eşiğin iki yanında ETA SIÇRAMAZ (eski davranış: %50)', () => {
    const slow = computeEta({ ...BASE, rollingAvgKmh: ETA_MIN_CORRECTION_KMH - 0.1 });
    const fast = computeEta({ ...BASE, rollingAvgKmh: ETA_MIN_CORRECTION_KMH + 0.1 });
    expect(slow.correctionFactor).toBe(1);
    /* Rampa öncesi burada 1.5 vardı (ham oran 60/8 = 7.5 → tavan). Şimdi eşiğin
       hemen üstünde ağırlık ~0 olduğu için çarpan 1'e YAPIŞIK kalır. */
    expect(fast.correctionFactorRaw).toBe(ETA_MAX_FACTOR);   // ham oran hâlâ tavanda
    expect(fast.correctionFactor).toBeLessThan(1.02);
    const jumpS = Math.abs((fast.etaSeconds as number) - (slow.etaSeconds as number));
    expect(jumpS).toBeLessThan(10);          // eskiden 300 s (600 → 900)
  });

  it('🔒 eşik civarında SÜREKLİ: komşu adımlar arası fark küçük kalır', () => {
    let prevEta = computeEta({ ...BASE, rollingAvgKmh: 0 }).etaSeconds as number;
    for (let kmh = 0.5; kmh <= 40; kmh += 0.5) {
      const eta = computeEta({ ...BASE, rollingAvgKmh: kmh }).etaSeconds as number;
      /* 0,5 km/sa'lik bir hız adımı ETA'yı 60 s'den fazla oynatamaz — sahadaki
         sıçrama ölçütü tam olarak 60 s'dir (`ETA_JUMP_MIN_S`). */
      expect(Math.abs(eta - prevEta), `${kmh} km/sa`).toBeLessThan(60);
      prevEta = eta;
    }
  });

  it('🔒 ham çarpan ve rampa ağırlığı GÖZLEMLENEBİLİR (kanıt kaybı yok)', () => {
    const v = computeEta({ ...BASE, rollingAvgKmh: ETA_MIN_CORRECTION_KMH + 2 });
    expect(v.correctionFactorRaw).toBe(ETA_MAX_FACTOR);      // ham oran tavanda
    expect(v.speedGateWeight).toBeCloseTo(0.25, 6);
    expect(v.correctionFactor).toBeCloseTo(1 + 0.5 * 0.25, 6);
    expect(v.reason).toContain('kapı rampası');
  });
});

describe('#538 · KORUNAN DAVRANIŞLAR (regresyon yok)', () => {
  it('🔒 bant DIŞINDA düzeltme TAM uygulanır (eski davranış birebir)', () => {
    /* 30 km/sa: ağırlık 1 → ham oran 2 → tavan 1.5 → ETA 900 (eskiyle AYNI). */
    const v = computeEta({ ...BASE, rollingAvgKmh: 30 });
    expect(v.speedGateWeight).toBe(1);
    expect(v.correctionFactor).toBe(ETA_MAX_FACTOR);
    expect(v.etaSeconds).toBe(900);
  });

  it('🔒 hızlı gidilirken taban çarpan korunur', () => {
    const v = computeEta({ ...BASE, rollingAvgKmh: 200 });
    expect(v.correctionFactor).toBe(ETA_MIN_FACTOR);
  });

  it('🔒 ARAÇ DURUNCA ETA SONSUZA ÇIKMAZ (pazarlıksız kural)', () => {
    for (const kmh of [0, 0.5, ETA_MIN_CORRECTION_KMH - 0.1]) {
      const v = computeEta({ ...BASE, rollingAvgKmh: kmh });
      expect(v.correctionFactor).toBe(1);
      expect(v.etaSeconds).toBe(600);
    }
  });

  it('🔒 çarpan HER hızda [0.8, 1.5] bandında kalır', () => {
    for (let kmh = 0; kmh <= 250; kmh += 1) {
      const f = computeEta({ ...BASE, rollingAvgKmh: kmh }).correctionFactor;
      expect(f, `${kmh} km/sa`).toBeGreaterThanOrEqual(ETA_MIN_FACTOR);
      expect(f, `${kmh} km/sa`).toBeLessThanOrEqual(ETA_MAX_FACTOR);
    }
  });

  it('🔒 rampa BAYAT süreyi ya da yedek yolu DEĞİŞTİRMEZ', () => {
    expect(computeEta({ ...BASE, durationRevision: 2 }).state).toBe('STALE');
    const fb = computeEta({ ...BASE, durationIntegrity: 'MISSING', remainingRouteDurationS: null });
    expect(fb.state).toBe('DEGRADED_FALLBACK');
    expect(fb.correctionFactor).toBe(1);
  });
});

describe('#538 · DEFTER YENİ MEKANİZMAYA KÖR DEĞİL (doğrulamanın geçerlilik şartı)', () => {
  function sample(over: Partial<EtaSample> = {}): EtaSample {
    return {
      atMs: 1_000, etaSeconds: 600, baseDurationS: 600, factor: 1,
      remainingDistanceM: 10_000, rollingAvgKmh: 60, routeRevision: 1,
      etaState: 'ROUTE_MODEL', ...over,
    };
  }

  it('🔒 eşik geçişi HÂLÂ SPEED_GATE_CHANGED olarak okunur', () => {
    const a = sample({ rollingAvgKmh: 12, etaSeconds: 12_008 });
    const b = sample({ atMs: 2_000, rollingAvgKmh: 4, etaSeconds: 10_007 });
    expect(detectEtaJump(a, b)?.trigger).toBe('SPEED_GATE_CHANGED');
  });

  it('🔒 BANT İÇİ belirgin hareket de kapı olayı sayılır', () => {
    /* 9 → 15 km/sa: eşik geçilmiyor ama ağırlık 0.125 → 0.875 (Δ 0.75). Eski
       ikili dedektör bunu göremezdi ve "kapı düzeldi" yanılgısı üretirdi. */
    const a = sample({ rollingAvgKmh: 9, etaSeconds: 10_007 });
    const b = sample({ atMs: 2_000, rollingAvgKmh: 15, etaSeconds: 12_008 });
    expect(detectEtaJump(a, b)?.trigger).toBe('SPEED_GATE_CHANGED');
  });

  it('🔒 bant içi KÜÇÜK hareket kapıya YAZILMAZ (yanlış suçlama yok)', () => {
    const dv = (ETA_GATE_WEIGHT_MIN_DELTA * ETA_GATE_RAMP_KMH) / 2;   // eşik altı
    const a = sample({ rollingAvgKmh: 10, etaSeconds: 10_007 });
    const b = sample({ atMs: 2_000, rollingAvgKmh: 10 + dv, etaSeconds: 12_008 });
    expect(detectEtaJump(a, b)?.trigger).toBe('BASE_DURATION_ONLY');
  });
});
