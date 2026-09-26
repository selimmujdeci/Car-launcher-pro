/**
 * overspeedWarning.test — hız sınırı aşımı: kırmızı levha kuralı + TEK SEFERLİK ses.
 * Kullanıcı: "50'yi geçince kırmızıya döner, bir kere uyarır, her seferinde değil."
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../platform/ttsService', async (orig) => ({
  ...(await orig<typeof import('../platform/ttsService')>()), speakNavigation: vi.fn(),
}));

import { isOverspeed, OVERSPEED_TOLERANCE_KMH } from '../platform/navigation/core/overspeedModel';
import {
  noteOverspeedSample, _resetOverspeedWarningForTest,
} from '../platform/navigation/overspeedWarningRuntime';

const spoken: string[] = [];
const speak = (t: string) => { spoken.push(t); };
const at = (s: number | null, l: number | null, ms: number) => noteOverspeedSample(s, l, ms, speak);

beforeEach(() => { _resetOverspeedWarningForTest(); spoken.length = 0; });

describe('kırmızı levha kuralı', () => {
  it('sınır + tolerans üstü kırmızı; bilinmeyen hız/sınır kırmızı DEĞİL', () => {
    expect(isOverspeed(50 + OVERSPEED_TOLERANCE_KMH + 1, 50)).toBe(true);
    expect(isOverspeed(54, 50)).toBe(false);
    expect(isOverspeed(null, 50)).toBe(false);
    expect(isOverspeed(90, null)).toBe(false);
  });
});

describe('tek seferlik sesli uyarı', () => {
  it('🔒 aşım 3 sn sürünce BİR KEZ uyarır', () => {
    at(62, 50, 0); at(63, 50, 1_000); at(64, 50, 2_000);
    expect(spoken).toHaveLength(0);
    at(64, 50, 3_100);
    expect(spoken).toEqual(['Hız sınırı 50. Hız sınırını aştınız.']);
    for (let t = 4_000; t < 60_000; t += 1_000) at(65, 50, t);
    expect(spoken).toHaveLength(1);
  });

  it('🔒 aynı sınırda yavaşlayıp tekrar aşmak İKİNCİ uyarı üretmez', () => {
    at(62, 50, 0); at(62, 50, 3_500);
    at(45, 50, 10_000); at(62, 50, 20_000); at(62, 50, 30_000);
    expect(spoken).toHaveLength(1);
  });

  it('yeni sınır (yeni yol) → yeniden bir kez uyarabilir', () => {
    at(62, 50, 0); at(62, 50, 3_500);
    at(100, 82, 10_000); at(100, 82, 13_500);
    expect(spoken).toEqual(['Hız sınırı 50. Hız sınırını aştınız.', 'Hız sınırı 82. Hız sınırını aştınız.']);
  });

  it('kısa sıçrama (3 sn altı) uyarı üretmez; sınır bilinmiyorsa hiç konuşmaz', () => {
    at(62, 50, 0); at(45, 50, 2_000); at(62, 50, 2_500); at(45, 50, 4_000);
    at(120, null, 10_000); at(120, null, 20_000);
    expect(spoken).toHaveLength(0);
  });

  it('🔒 30↔50 sık değişen bölümler: aynı değer 2 dk içinde geri gelince İKİNCİ anons yok (cihaz 2026-09-24)', () => {
    at(50, 30, 0); at(50, 30, 3_500);                 // 30 bölgesi → uyarı
    at(50, 50, 20_000);                               // 50 bölgesi (aşım yok)
    at(50, 30, 40_000); at(50, 30, 44_000);           // yine 30 → sessiz
    expect(spoken).toHaveLength(1);
    at(50, 50, 150_000);
    at(50, 30, 200_000); at(50, 30, 204_000);         // 2 dk sonra → yeniden bir kez
    expect(spoken).toHaveLength(2);
  });
});

describe('kaynak kilidi', () => {
  it('🔒 sabit hızda da teyit gelir — hook aşım sürerken teyit anında yeniden değerlendirir', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/platform/navigation/overspeedWarningRuntime.ts', 'utf8');
    expect(src).toMatch(/if \(!isOverspeed\(speed, shownLimit\)\) return undefined;/);
    expect(src).toMatch(/setTimeout\(sample, OVERSPEED_CONFIRM_MS/);
    expect(src).toMatch(/return \(\) => clearTimeout\(t\)/);
  });
});
