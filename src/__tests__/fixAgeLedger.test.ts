/**
 * fixAgeLedger.test.ts — #537 · GÖREV B: FIX YAŞI DAĞILIM DEFTERİ.
 *
 * SAHA (2026-08-11): kopyada `fixAgeMs: 5237` — TEK ANLIK örnek. #508 ölçütü
 * `p50 < 3 s ∧ p95 < 10 s` DAĞILIMI ister; tek örnekten p50 çıkmaz. İki saha
 * koşumu bu yüzden kapanış üretemedi.
 *
 * Bu testler defterin (a) dağılımı doğru hesapladığını, (b) YETERSİZ örnekte
 * HÜKÜM VERMEDİĞİNİ, (c) örnekleme yanlılığını ve ölçülmeyen üçüncü ölçütü
 * DÜRÜSTÇE beyan ettiğini kilitler.
 */

import { describe, it, expect } from 'vitest';
import {
  appendFixAge, summarizeFixAge,
  FIX_AGE_RING, FIX_AGE_MIN_SAMPLES,
  FIX_AGE_P50_TARGET_MS, FIX_AGE_P95_TARGET_MS,
  type FixAgeSample,
} from '../platform/navigation/core/fixAgeLedger';

const STALE_MS = 5_000;   // gpsService.LOCATION_STALE_MS (otorite çağırandan gelir)

/** 1 Hz okuma kadansıyla verilen yaşlardan halka üretir. */
function ring(ages: readonly number[], gapMs = 1_000): FixAgeSample[] {
  let out: FixAgeSample[] = [];
  ages.forEach((ageMs, i) => { out = appendFixAge(out, { ageMs, atPerfMs: i * gapMs }); });
  return out;
}

describe('#537 · dağılım hesabı', () => {
  it('🔒 p50/p95/min/max doğru (en yakın-sıra, enterpolasyon YOK)', () => {
    const ages = Array.from({ length: 100 }, (_, i) => (i + 1) * 100);  // 100…10 000
    const s = summarizeFixAge(ring(ages), STALE_MS);
    expect(s.count).toBe(100);
    expect(s.p50Ms).toBe(5_000);
    expect(s.p95Ms).toBe(9_500);
    expect(s.minMs).toBe(100);
    expect(s.maxMs).toBe(10_000);
  });

  it('🔒 bayat oran eşiği ÇAĞIRANDAN gelir (ikinci eşik otoritesi yok)', () => {
    const s = summarizeFixAge(ring([1_000, 2_000, 6_000, 7_000]), STALE_MS);
    expect(s.staleShare).toBe(0.5);
    /* Eşik farklı verilirse sonuç DEĞİŞİR → defter kendi eşiğini taşımıyor. */
    expect(summarizeFixAge(ring([1_000, 2_000, 6_000, 7_000]), 10_000).staleShare).toBe(0);
  });

  it('🔒 okuma kadansı da ölçülür (örnekleme yanlılığı GÖRÜNÜR)', () => {
    const s = summarizeFixAge(ring([900, 900, 900, 900], 250), STALE_MS);
    expect(s.readGapP50Ms).toBe(250);
    expect(s.readGapP95Ms).toBe(250);
    expect(s.spanMs).toBe(750);
    expect(s.samplingModel).toBe('CONSUMER_READ');
  });
});

describe('#537 · #508 hükmü — az örnekte SUSAR', () => {
  it('🔒 TEK örnek hüküm ÜRETMEZ (sahanın birebir durumu)', () => {
    const s = summarizeFixAge(ring([5_237]), STALE_MS);
    expect(s.count).toBe(1);
    expect(s.verdict).toBe('INSUFFICIENT_SAMPLES');
    /* Sayı hesaplanır (şeffaflık) ama hüküm VERİLMEZ. */
    expect(s.p50Ms).toBe(5_237);
    expect(s.verdictNote).toContain('YETERSİZ');
  });

  it('🔒 eşik altındaki her örnek sayısı YETERSİZ kalır', () => {
    const ages = Array.from({ length: FIX_AGE_MIN_SAMPLES - 1 }, () => 900);
    expect(summarizeFixAge(ring(ages), STALE_MS).verdict).toBe('INSUFFICIENT_SAMPLES');
  });

  it('🔒 yeterli örnek + hedeflerin altı → GEÇTİ', () => {
    const ages = Array.from({ length: FIX_AGE_MIN_SAMPLES }, () => 1_200);
    const s = summarizeFixAge(ring(ages), STALE_MS);
    expect(s.verdict).toBe('PASS');
    expect(s.p50Ms as number).toBeLessThan(FIX_AGE_P50_TARGET_MS);
    expect(s.p95Ms as number).toBeLessThan(FIX_AGE_P95_TARGET_MS);
  });

  it('🔒 p95 hedefi aşılırsa p50 iyi olsa bile DÜŞTÜ', () => {
    /* 40 örneğin 37'si taze, 3'ü çok bayat → p50 mükemmel, p95 kötü.
       (En yakın-sıra: rank = ceil(0.95×40) = 38 → 38. sıradaki değer bayat olan.) */
    const ages = [...Array.from({ length: 37 }, () => 800), 30_000, 40_000, 50_000];
    const s = summarizeFixAge(ring(ages), STALE_MS);
    expect(s.p50Ms as number).toBeLessThan(FIX_AGE_P50_TARGET_MS);
    expect(s.verdict).toBe('FAIL');
  });

  it('🔒 eski taban (p50 19,5 s) DÜŞTÜ olarak okunur', () => {
    const ages = Array.from({ length: 40 }, () => 19_500);
    expect(summarizeFixAge(ring(ages), STALE_MS).verdict).toBe('FAIL');
  });

  it('🔒 boş defter: sayı UYDURULMAZ, hüküm YOK', () => {
    const s = summarizeFixAge([], STALE_MS);
    expect(s.count).toBe(0);
    expect(s.p50Ms).toBeNull();
    expect(s.p95Ms).toBeNull();
    expect(s.staleShare).toBeNull();
    expect(s.spanMs).toBeNull();
    expect(s.verdict).toBe('INSUFFICIENT_SAMPLES');
  });

  it('🔒 ÜÇÜNCÜ ölçüt (iz/gerçek yol) ÖLÇÜLMEDİ diye BEYAN edilir', () => {
    const ages = Array.from({ length: FIX_AGE_MIN_SAMPLES }, () => 1_000);
    const s = summarizeFixAge(ring(ages), STALE_MS);
    expect(s.trackRatioMeasured).toBe(false);
    /* GEÇTİ hükmü bile bu sınırı metninde taşır — "kapandı" izlenimi üretmez. */
    expect(s.verdictNote).toContain('üçüncü ölçüt');
  });
});

describe('#537 · halka sınırlı ve kirlenmez', () => {
  it('🔒 tavan korunur, en YENİ örnekler kalır', () => {
    const ages = Array.from({ length: FIX_AGE_RING + 25 }, (_, i) => i);
    const r = ring(ages);
    expect(r.length).toBe(FIX_AGE_RING);
    expect(r[r.length - 1].ageMs).toBe(FIX_AGE_RING + 24);
  });

  it('🔒 geçersiz ölçüm defteri KİRLETMEZ', () => {
    let r: FixAgeSample[] = [];
    r = appendFixAge(r, { ageMs: -5, atPerfMs: 0 });
    r = appendFixAge(r, { ageMs: Number.NaN, atPerfMs: 1 });
    r = appendFixAge(r, { ageMs: 900, atPerfMs: Number.NaN });
    expect(r.length).toBe(0);
    r = appendFixAge(r, { ageMs: 0, atPerfMs: 10 });   // 0 ms GEÇERLİ bir ölçümdür
    expect(r.length).toBe(1);
  });

  it('🔒 saf: girdi mutasyona uğramaz', () => {
    const base = ring([1_000, 2_000]);
    const snapshot = JSON.stringify(base);
    appendFixAge(base, { ageMs: 3_000, atPerfMs: 3_000 });
    summarizeFixAge(base, STALE_MS);
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});
