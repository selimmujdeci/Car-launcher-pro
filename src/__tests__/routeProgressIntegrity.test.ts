/**
 * P0-NAV-12 — ROTA İLERLEMESİ + MAP-MATCH OTORİTESİ (KİLİT).
 *
 * ── ÖLÇÜM (2026-08-24, koddan) ────────────────────────────────────────────
 * NAV-12'nin sorduğu map-match soruları — yanlış segment · paralel yol ·
 * U dönüşü · GPS sıçraması · düşük hız · duran araç · bayat fix · kötü
 * doğruluk · geriye düşme — `mapMatchModel` içinde ZATEN ölçülüyor ve
 * eşikleri gerekçeli. Bu tur o katmanı YENİDEN KURMAZ.
 *
 * Ölçülen TEK boşluk: **ilerlemenin KENDİSİ hiç yargılanmıyordu.**
 * `routingService` her fix'te `progressM`i hesaplıyor ama yalnız adım
 * ilerletmede kullanıp atıyordu. ETA sıçramalarının defteri VARDI; onu
 * BESLEYEN ilerlemenin defteri YOKTU.
 *
 * ⚠️ KÖR CLAMP YASAK: gerçek U dönüşü rotada geriye gitmektir ve MEŞRUDUR.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  PROGRESS_ANOMALY_RING,
  PROGRESS_BACKWARD_SLACK_M,
  PROGRESS_BUDGET_SLACK_M,
  PROGRESS_REVERSE_DEG,
  PROGRESS_STATIONARY_KMH,
  getProgressLedger,
  judgeProgress,
  recordProgressJudgement,
  resetProgressLedger,
  type ProgressSample,
} from '../platform/navigation/core/routeProgressLedger';
import {
  MIN_MATCH_CONFIDENCE, REVERSE_DELTA_DEG,
} from '../platform/navigation/core/mapMatchModel';

/* ── Fikstür ─────────────────────────────────────────────────────────────── */

const base: ProgressSample = {
  prevRemainingM: 10_000,
  remainingM: 9_970,          // 30 m ilerledi
  elapsedMs: 1_000,
  speedKmh: 90,               // 25 m/s → 1 s'de 25 m
  headingDeltaDeg: 4,
  matchState: 'MATCHED',
  confidence: 0.9,
  prevRouteRevision: 7,
  routeRevision: 7,
};

const s = (over: Partial<ProgressSample> = {}): ProgressSample => ({ ...base, ...over });

beforeEach(() => { resetProgressLedger(); });

/* ══════════════════════════════════════════════════════════════════════════
   1) NORMAL İLERLEME
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-12 › ilerleme hükmü', () => {
  it('hız bütçesi içindeki ilerleme MAKUL', () => {
    const j = judgeProgress(s());
    expect(j.verdict).toBe('PLAUSIBLE');
    expect(j.deltaM).toBe(30);
    expect(j.budgetM ?? 0).toBeGreaterThan(30);
  });

  it('duran araçta küçük oynama SNAP GÜRÜLTÜSÜDÜR', () => {
    const j = judgeProgress(s({
      speedKmh: PROGRESS_STATIONARY_KMH - 1,
      remainingM: 10_000 - 12,
    }));
    expect(j.verdict).toBe('STATIONARY');
  });

  it('hız BİLİNMİYORSA "duruyor" DENMEZ (sahte 0 yasağı)', () => {
    /* Bilinmeyen hızdan "araç durdu" sonucu çıkarmak, kütük #408'de
       düzeltilen tam olarak o hatadır. */
    const j = judgeProgress(s({ speedKmh: null, remainingM: 10_000 - 10 }));
    expect(j.verdict).not.toBe('STATIONARY');
    expect(j.verdict).toBe('PLAUSIBLE');   // sabit pay içinde kalır
  });

  it('hız bilinmiyorsa bütçe YALNIZ sabit paydır (sıçrama meşrulaştırılmaz)', () => {
    const j = judgeProgress(s({ speedKmh: null, remainingM: 10_000 - 500 }));
    expect(j.budgetM).toBe(PROGRESS_BUDGET_SLACK_M);
    expect(j.verdict).toBe('IMPLAUSIBLE_FORWARD');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) SIÇRAMA VE GERİ GİDİŞ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-12 › sıçrama', () => {
  it('hızın izin verdiğinden fazla ilerleme AŞIRI SIÇRAMA', () => {
    /* 90 km/h × 1 s × 2,5 + 60 = ~122 m bütçe; 3 km atlama bunu aşar. */
    const j = judgeProgress(s({ remainingM: 10_000 - 3_000 }));
    expect(j.verdict).toBe('IMPLAUSIBLE_FORWARD');
    expect(j.deltaM).toBe(3_000);
    expect(j.budgetRatio ?? 0).toBeGreaterThan(1);
  });

  it('GERÇEK U dönüşü: geriye gitti VE yön ters → MEŞRU', () => {
    const j = judgeProgress(s({
      remainingM: 10_000 + 500,           // 500 m geriye
      headingDeltaDeg: PROGRESS_REVERSE_DEG + 10,
    }));
    expect(j.verdict).toBe('REAL_BACKTRACK');
    expect(j.deltaM).toBe(-500);
  });

  it('KANITSIZ geri kayma: yön düz ama rota geriye gitti', () => {
    const j = judgeProgress(s({
      remainingM: 10_000 + 500,
      headingDeltaDeg: 5,                 // yön DEĞİŞMEDİ
    }));
    expect(j.verdict).toBe('IMPLAUSIBLE_BACKWARD');
  });

  it('yön BİLİNMİYORSA geri gidiş "gerçek" İDDİA EDİLMEZ', () => {
    const j = judgeProgress(s({ remainingM: 10_000 + 500, headingDeltaDeg: null }));
    expect(j.verdict).toBe('IMPLAUSIBLE_BACKWARD');
  });

  it('gevşeklik içindeki geri oynama sıçrama SAYILMAZ', () => {
    const j = judgeProgress(s({ remainingM: 10_000 + PROGRESS_BACKWARD_SLACK_M - 1 }));
    expect(j.verdict).not.toBe('IMPLAUSIBLE_BACKWARD');
    expect(j.verdict).not.toBe('REAL_BACKTRACK');
  });

  it('ters yön eşiği map-match ile AYNI sayıdır (ikinci otorite yok)', () => {
    expect(PROGRESS_REVERSE_DEG).toBe(REVERSE_DELTA_DEG);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) HÜKÜM VERİLEMEYEN DURUMLAR — "BİLMİYORUZ" DÜRÜSTTÜR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-12 › kanıt yetersizliği', () => {
  it('rota DEĞİŞTİYSE iki ölçüm kıyaslanamaz (reroute sahte alarm üretmez)', () => {
    const j = judgeProgress(s({
      prevRouteRevision: 7, routeRevision: 8,
      remainingM: 25_000,                 // yeni rota çok daha uzun
    }));
    expect(j.verdict).toBe('ROUTE_CHANGED');
    expect(j.deltaM).toBeNull();
  });

  it('eşleşme MATCHED değilse ilerleme YARGILANMAZ', () => {
    for (const st of ['MATCH_UNCERTAIN', 'OFF_NETWORK', 'STALE', 'UNKNOWN'] as const) {
      const j = judgeProgress(s({ matchState: st, remainingM: 10_000 - 5_000 }));
      expect(j.verdict, `${st} yargılandı`).toBe('UNKNOWN');
    }
  });

  it('kalan mesafe ölçülmediyse hüküm UNKNOWN', () => {
    expect(judgeProgress(s({ prevRemainingM: null })).verdict).toBe('UNKNOWN');
    expect(judgeProgress(s({ remainingM: null })).verdict).toBe('UNKNOWN');
    expect(judgeProgress(s({ remainingM: NaN })).verdict).toBe('UNKNOWN');
  });

  it('geçen süre ölçülmediyse bütçe hesaplanamaz', () => {
    const j = judgeProgress(s({ elapsedMs: null }));
    expect(j.verdict).toBe('UNKNOWN');
    expect(j.budgetM).toBeNull();
    /* Fark yine de ÖLÇÜLÜR — bilmediğimiz şey bütçedir, fark değil. */
    expect(j.deltaM).toBe(30);
  });

  it('sıfır/negatif süre bütçe üretmez', () => {
    expect(judgeProgress(s({ elapsedMs: 0 })).verdict).toBe('UNKNOWN');
    expect(judgeProgress(s({ elapsedMs: -5 })).verdict).toBe('UNKNOWN');
  });

  it('map-match güven eşiği modelden GELİR (kopya eşik yok)', () => {
    expect(MIN_MATCH_CONFIDENCE).toBeGreaterThan(0);
    expect(MIN_MATCH_CONFIDENCE).toBeLessThan(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) DEFTER
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-12 › ilerleme defteri', () => {
  it('yalnız ANORMAL örnekler halkaya girer, hepsi SAYILIR', () => {
    const normal = judgeProgress(s());
    for (let i = 0; i < 5; i++) recordProgressJudgement(normal, s(), 1000 + i);
    const jump = judgeProgress(s({ remainingM: 10_000 - 3_000 }));
    recordProgressJudgement(jump, s({ remainingM: 10_000 - 3_000 }), 2000);

    const led = getProgressLedger();
    expect(led.counts.PLAUSIBLE).toBe(5);
    expect(led.counts.IMPLAUSIBLE_FORWARD).toBe(1);
    expect(led.anomalies.length).toBe(1);          // yalnız sıçrama saklandı
    expect(led.totalSamples).toBe(6);
  });

  it('uç değerler ölçülür ve KIRPILMAZ', () => {
    const fwd = judgeProgress(s({ remainingM: 10_000 - 3_000 }));
    recordProgressJudgement(fwd, s(), 1000);
    const back = judgeProgress(s({
      remainingM: 10_000 + 800, headingDeltaDeg: 170,
    }));
    recordProgressJudgement(back, s(), 2000);

    const led = getProgressLedger();
    expect(led.maxForwardJumpM).toBe(3_000);
    expect(led.maxBackwardJumpM).toBe(800);
  });

  it('ölçüm yoksa uç değerler `null` — sahte 0 YASAK', () => {
    const led = getProgressLedger();
    expect(led.maxForwardJumpM).toBeNull();
    expect(led.maxBackwardJumpM).toBeNull();
    expect(led.lastVerdict).toBeNull();
    expect(led.totalSamples).toBe(0);
  });

  it('halka sınırlıdır ama sayaç kaybolmaz', () => {
    const jump = judgeProgress(s({ remainingM: 10_000 - 3_000 }));
    for (let i = 0; i < PROGRESS_ANOMALY_RING + 7; i++) {
      recordProgressJudgement(jump, s(), 1000 + i);
    }
    const led = getProgressLedger();
    expect(led.anomalies.length).toBe(PROGRESS_ANOMALY_RING);
    expect(led.counts.IMPLAUSIBLE_FORWARD).toBe(PROGRESS_ANOMALY_RING + 7);
  });

  it('yeni oturum geçmişi TAŞIMAZ (eski rotanın sıçraması yenisine yazılmaz)', () => {
    recordProgressJudgement(judgeProgress(s({ remainingM: 10_000 - 3_000 })), s(), 1000);
    expect(getProgressLedger().counts.IMPLAUSIBLE_FORWARD).toBe(1);
    resetProgressLedger();
    const led = getProgressLedger();
    expect(led.counts.IMPLAUSIBLE_FORWARD).toBe(0);
    expect(led.maxForwardJumpM).toBeNull();
  });

  it('kayıt yolu THROW ETMEZ', () => {
    expect(() => recordProgressJudgement(
      undefined as unknown as ReturnType<typeof judgeProgress>, s(), 1,
    )).not.toThrow();
  });
});
