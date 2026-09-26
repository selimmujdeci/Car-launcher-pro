/**
 * didLearningCore.test — otomatik DID öğrenmenin SAF çekirdekleri.
 *
 * Saha verisi (2026-09-23, Renault motor ECU 7E0 · parça 237100942S):
 *  · 2000 = FFBF544D maskesi; kaba taramada 200A gerçekten yanıt VERMEDİ.
 *  · 2002 = motor devri × 4 (845 rpm → 3417, 1577 → 6310).
 *  · 20A5 = PID 31 ile bayt bayt aynı (12A6 = 4774 km).
 *  · Çoklu okuma yanıtı: 222002200B200C → "0D5B200B02BF200C0160".
 */
import { describe, it, expect } from 'vitest';
import {
  parseSupportMask, pickMaskProbes, evaluateMaskSemantics, toDidHex,
} from '../platform/obd/didLearning/supportBitmap';
import { splitMultiDidResponse, chunkDids } from '../platform/obd/didLearning/multiDidCodec';
import { classifyDidSamples, type DidSample } from '../platform/obd/didLearning/didClassifier';
import {
  matchAgainst, matchDid, referenceAt, type RefSample,
} from '../platform/obd/didLearning/semanticMatcher';

describe('destek maskesi', () => {
  it('saha maskesi 2000=FFBF544D: 200A yok, zincir devam ediyor', () => {
    const m = parseSupportMask(0x2000, 'FFBF544D')!;
    expect(m.supported).not.toContain(0x200A);
    expect(m.supported).toContain(0x2001);
    expect(m.supported).toContain(0x2009);
    expect(m.continues).toBe(true);
    expect(m.supported.every((d) => d > 0x2000 && d < 0x2020)).toBe(true);
  });

  it('zincirin sonu: 22A0=FFFFFFFE → devam yok', () => {
    expect(parseSupportMask(0x22A0, 'FFFFFFFE')!.continues).toBe(false);
  });

  it('4 bayt olmayan yanıt maske SAYILMAZ; 0x20 katı olmayan taban reddedilir', () => {
    expect(parseSupportMask(0x2000, '0D56')).toBeNull();
    expect(parseSupportMask(0x2001, 'FFFFFFFF')).toBeNull();
    expect(parseSupportMask(0x2000, null)).toBeNull();
  });

  it('doğrulama: iki yönde kanıt → CONFIRMED; çelişki → CONTRADICTED; hat hatası → INCONCLUSIVE', () => {
    expect(evaluateMaskSemantics(['ok', 'ok', 'ok'], ['rejected'])).toBe('CONFIRMED');
    expect(evaluateMaskSemantics(['ok', 'rejected'], ['rejected'])).toBe('CONTRADICTED');
    expect(evaluateMaskSemantics(['ok'], ['ok'])).toBe('CONTRADICTED');
    expect(evaluateMaskSemantics(['ok'], ['error'])).toBe('INCONCLUSIVE');
    expect(evaluateMaskSemantics(['ok', 'ok'], [])).toBe('INCONCLUSIVE');
  });

  it('yoklama örnekleri deterministik: var/yok listelerinden', () => {
    const p = pickMaskProbes(parseSupportMask(0x2000, 'FFBF544D')!);
    expect(p.claimed.length).toBeGreaterThan(0);
    expect(p.unclaimed).toContain(0x200A);
    expect(toDidHex(0x200A)).toBe('200A');
  });
});

describe('çoklu DID yanıtı', () => {
  it('saha yanıtı uzunluk bilgisiyle ayrılır', () => {
    const m = splitMultiDidResponse(['2002', '200B', '200C'], '0D5B200B02BF200C0160', new Map([['2002', 2], ['200B', 2], ['200C', 2]]))!;
    expect(m.get('2002')).toBe('0D5B');
    expect(m.get('200B')).toBe('02BF');
    expect(m.get('200C')).toBe('0160');
  });

  it('uzunluk bilinmese de tekil yankıyla ayrılır', () => {
    const m = splitMultiDidResponse(['2002', '2163'], '0D6F21638427', new Map())!;
    expect(m.get('2002')).toBe('0D6F');
    expect(m.get('2163')).toBe('8427');
  });

  it('yankı bozuk ya da artık bayt → null (yanlış atama yok)', () => {
    expect(splitMultiDidResponse(['2002', '200B'], '0D5B200C02BF', new Map([['2002', 2]]))).toBeNull();
    expect(splitMultiDidResponse(['2002'], '0D5B00', new Map([['2002', 2]]))).toBeNull();
  });

  it('gruplama ≤3', () => {
    expect(chunkDids(['a', 'b', 'c', 'd'])).toEqual([['a', 'b', 'c'], ['d']]);
  });
});

const series = (vals: number[], dt = 1000, t0 = 0): DidSample[] => vals.map((raw, i) => ({ t: t0 + i * dt, raw }));

describe('davranış sınıfı', () => {
  it('yetersiz gözlem → UNKNOWN; uzun süre sabit → CONSTANT', () => {
    expect(classifyDidSamples(series([5, 5, 5]), 1)).toBe('UNKNOWN');
    expect(classifyDidSamples(series(Array(10).fill(7), 10_000), 2)).toBe('CONSTANT');
    expect(classifyDidSamples(series(Array(10).fill(7), 100), 2)).toBe('UNKNOWN'); // kısa pencere
  });
  it('tek bayt birkaç değer → FLAG; artan → COUNTER; diğer → ANALOG', () => {
    expect(classifyDidSamples(series([0, 1, 0, 1, 1, 0, 0, 1]), 1)).toBe('FLAG');
    expect(classifyDidSamples(series([10, 10, 11, 12, 12, 13, 14]), 2)).toBe('COUNTER');
    expect(classifyDidSamples(series([700, 3400, 1200, 900, 2800, 703]), 2)).toBe('ANALOG');
  });
});

/* Referans ve DID serileri: DID okuması referanstan 200 ms sonra. */
function rpmScenario(n: number, rawOf: (rpm: number) => number) {
  const ref: RefSample[] = [];
  const did: DidSample[] = [];
  for (let i = 0; i < n; i++) {
    const rpm = 850 + Math.round(730 * Math.abs(Math.sin(i / 5)));
    ref.push({ t: i * 1000, value: rpm });
    did.push({ t: i * 1000 + 200, raw: rawOf(rpm) });
  }
  return { ref, did };
}

describe('anlamlandırma', () => {
  it('ara değer: pencere içinde doğrusal, dışında null (uydurma yok)', () => {
    const ref = [{ t: 0, value: 100 }, { t: 1000, value: 200 }];
    expect(referenceAt(ref, 500, 900)).toBe(150);
    expect(referenceAt(ref, 5000, 900)).toBeNull();
  });

  it('🔒 saha: 2002 = devir × 4 → SESSION_PROVEN, k=0,25', () => {
    const { ref, did } = rpmScenario(60, (rpm) => rpm * 4);
    const m = matchAgainst(did, 2, ref, 'rpm')!;
    expect(m.status).toBe('SESSION_PROVEN');
    expect(m.k).toBe(0.25);
    expect(m.o).toBe(0);
  });

  it('Kelvin×10 sıcaklık kütüphaneye oturur (o=-273,15)', () => {
    const ref: RefSample[] = []; const did: DidSample[] = [];
    for (let i = 0; i < 50; i++) { const c = 60 + i * 0.8; ref.push({ t: i * 10_000, value: c }); did.push({ t: i * 10_000 + 500, raw: Math.round((c + 273.15) * 10) }); }
    const m = matchAgainst(did, 2, ref, 'coolant')!;
    expect(m.status).toBe('SESSION_PROVEN');
    expect(m.k).toBeCloseTo(0.1, 6);
    expect(m.o).toBeCloseTo(-273.15, 2);
  });

  it('🔒 saha: 20A5 = PID 31 birebir → exactEquality ile kanıt', () => {
    const ref: RefSample[] = []; const did: DidSample[] = [];
    for (let i = 0; i < 25; i++) { const km = 4774 + i; ref.push({ t: i * 60_000, value: km }); did.push({ t: i * 60_000 + 1000, raw: km }); }
    const m = matchAgainst(did, 2, ref, 'distSinceClear')!;
    expect(m.exactEquality).toBe(true);
    expect(m.status).toBe('SESSION_PROVEN');
  });

  it('referans bu oturumda değişmediyse bilgi taşımaz → kanıt YOK', () => {
    const ref: RefSample[] = []; const did: DidSample[] = [];
    for (let i = 0; i < 50; i++) { ref.push({ t: i * 1000, value: 850 + (i % 2) }); did.push({ t: i * 1000, raw: (850 + (i % 2)) * 4 }); }
    const m = matchAgainst(did, 2, ref, 'rpm');
    expect(m?.status).not.toBe('SESSION_PROVEN');
  });

  it('yuvarlak katsayıya oturmayan güçlü ilişki yalnız ADAY kalır (saha: 200B yükle r≈0,92)', () => {
    const { ref, did } = rpmScenario(60, (rpm) => Math.round(rpm * 3.477 - 2324));
    const m = matchAgainst(did, 2, ref, 'rpm')!;
    expect(m.status).not.toBe('SESSION_PROVEN');
  });

  it('ayırt edilemeyen iki referans (ısınırken yağ ≈ su) → AMBIGUOUS', () => {
    const coolant: RefSample[] = []; const oil: RefSample[] = []; const did: DidSample[] = [];
    for (let i = 0; i < 50; i++) {
      const c = 60 + i * 0.7;
      coolant.push({ t: i * 10_000, value: c });
      oil.push({ t: i * 10_000, value: c + 0.3 });
      did.push({ t: i * 10_000 + 500, raw: Math.round((c + 273.15) * 10) });
    }
    const m = matchDid(did, 2, new Map([['coolant', coolant], ['oil', oil]]))!;
    expect(m.status).toBe('AMBIGUOUS');
  });

  it('az örnek → eşleşme hükmü yok', () => {
    const { ref, did } = rpmScenario(10, (rpm) => rpm * 4);
    expect(matchAgainst(did, 2, ref, 'rpm')).toBeNull();
  });
});
