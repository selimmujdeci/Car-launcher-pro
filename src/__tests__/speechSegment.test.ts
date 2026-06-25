/**
 * speechSegment.test.ts — söyleyiş segmentasyonu + prozodi (P0-2 + P1-1)
 */
import { describe, it, expect } from 'vitest';
import { segmentSpeech } from '../platform/speechSegment';

describe('segmentSpeech — temel', () => {
  it('boş metin → boş dizi', () => {
    expect(segmentSpeech('')).toEqual([]);
    expect(segmentSpeech('   ')).toEqual([]);
  });

  it('tek kısa düz cümle → 1 segment, düşen ton, hızlı tempo', () => {
    const segs = segmentSpeech('Harita açılıyor.');
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe('Harita açılıyor.');
    expect(segs[0].pauseMs).toBe(0);            // son segment → sessizlik yok
    expect(segs[0].pitch).toBeCloseTo(0.94, 5); // düz cümle sonu → düşen ton
    expect(segs[0].rate).toBeCloseTo(1.06, 5);  // kısa cümlecik → biraz hızlı
  });

  it('soru cümlesi → yükselen ton, terminatör korunur', () => {
    const segs = segmentSpeech('Nereye gidiyoruz?');
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe('Nereye gidiyoruz?');
    expect(segs[0].pitch).toBeCloseTo(1.10, 5);
  });
});

describe('segmentSpeech — çok cümle / duraklama', () => {
  it('iki cümle → 2 segment, ilkinde nokta duraklaması, sonda 0', () => {
    const segs = segmentSpeech('Birinci cümle. İkinci cümle?');
    expect(segs).toHaveLength(2);
    expect(segs[0].pauseMs).toBe(280);   // nokta duraklaması
    expect(segs[0].pitch).toBeCloseTo(0.94, 5);
    expect(segs[1].pauseMs).toBe(0);     // son
    expect(segs[1].pitch).toBeCloseTo(1.10, 5); // soru → yükselen
  });

  it('virgül cümleciği → ara duraklama, orta perde düz', () => {
    const segs = segmentSpeech('Yakıt yüzde on beş, az kaldı.');
    expect(segs).toHaveLength(2);
    expect(segs[0].text).toBe('Yakıt yüzde on beş');
    expect(segs[0].pauseMs).toBe(120);          // virgül duraklaması
    expect(segs[0].pitch).toBeCloseTo(1.0, 5);  // cümle ortası → kontur yok
    expect(segs[1].text).toBe('az kaldı.');
    expect(segs[1].pauseMs).toBe(0);
  });
});

describe('segmentSpeech — taban değer çarpımı', () => {
  it('taban rate/pitch segmente çarpılır', () => {
    const segs = segmentSpeech('Tamam.', { rate: 0.9, pitch: 1.1 });
    // "Tamam" = 1 kelime (kısa) → 0.9 * 1.06
    expect(segs[0].rate).toBeCloseTo(0.954, 3);
    // düz cümle sonu → 1.1 * 0.94
    expect(segs[0].pitch).toBeCloseTo(1.034, 3);
  });
});

describe('segmentSpeech — limitler', () => {
  it('normal: segment sayısı tavanı 8', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Cümle ${i + 1}.`).join(' ');
    const segs = segmentSpeech(many);
    expect(segs.length).toBeLessThanOrEqual(8);
    expect(segs[segs.length - 1].pauseMs).toBe(0); // son daima 0
  });

  it('düşük donanım: tavan 4 + virgül bölmesi yapılmaz', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Cümle ${i + 1}.`).join(' ');
    const segs = segmentSpeech(many, { lowEnd: true });
    expect(segs.length).toBeLessThanOrEqual(4);

    // virgüllü cümle düşük donanımda bölünmez (tek segment)
    const comma = segmentSpeech('Yakıt yüzde on beş, az kaldı.', { lowEnd: true });
    expect(comma).toHaveLength(1);
  });

  it('uzun cümle → sakin tempo', () => {
    // 16 kelimelik tek cümlecik (virgülsüz) → LONG_WORDS(14) eşiğini aşar
    const longClause = 'Bu oldukça uzun bir cümledir ve içinde gerçekten pek çok kelime barındırır sanırım şu an tam burada.';
    const segs = segmentSpeech(longClause);
    expect(segs[0].rate).toBeCloseTo(0.95, 5); // ≥14 kelime → 0.95
  });
});
