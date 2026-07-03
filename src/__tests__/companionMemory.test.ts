/**
 * companionMemory.test.ts — uzun-dönem kişisel hafıza (#7).
 *
 * addFact/getFacts/forgetFact/clearFacts + prompt bölümü davranışını kilitler:
 *  - dedup (aynı fact iki kez eklenmez)
 *  - kapasite (MAX_FACTS taşınca en eski düşer)
 *  - forget: fuzzy tekil sil + "hepsini unut" temizler + eşleşme yoksa null
 *  - boş/çok kısa fact reddedilir (SAHTE ONAY YOK zinciriyle uyumlu)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  addFact, getFacts, forgetFact, clearFacts, buildMemoryPromptSection,
  _resetCompanionMemoryForTest,
} from '../platform/companion/companionMemory';

beforeEach(() => {
  _resetCompanionMemoryForTest();
});

describe('addFact', () => {
  it('geçerli fact ekler ve döner', () => {
    const f = addFact('Arabası dizel');
    expect(f?.text).toBe('Arabası dizel');
    expect(getFacts()).toHaveLength(1);
  });

  it('aynı fact iki kez eklenmez (dedup, normalize)', () => {
    addFact('Hep 95 benzin alır');
    addFact('hep 95 benzin alır');   // farklı büyük/küçük harf
    expect(getFacts()).toHaveLength(1);
  });

  it('boş / çok kısa fact reddedilir → null', () => {
    expect(addFact('')).toBeNull();
    expect(addFact('  ')).toBeNull();
    expect(addFact('a')).toBeNull();
    expect(getFacts()).toHaveLength(0);
  });

  it('MAX_FACTS taşınca en eski düşer (kapasite)', () => {
    for (let i = 0; i < 20; i++) addFact(`fact numarası ${i}`);
    const facts = getFacts();
    expect(facts.length).toBe(15);                    // MAX_FACTS
    expect(facts[0].text).toBe('fact numarası 5');    // 0-4 düştü
    expect(facts[facts.length - 1].text).toBe('fact numarası 19');
  });
});

describe('forgetFact', () => {
  it('fuzzy tekil siler (silinen metni döner)', () => {
    addFact('Arabası dizel');
    addFact('Hep 95 benzin alır');
    const removed = forgetFact('benzin');
    expect(removed).toBe('Hep 95 benzin alır');
    expect(getFacts()).toHaveLength(1);
  });

  it('"hepsini unut" → tümünü temizler (döner "all")', () => {
    addFact('Arabası dizel');
    addFact('Hep 95 benzin alır');
    expect(forgetFact('hepsini unut')).toBe('all');
    expect(getFacts()).toHaveLength(0);
  });

  it('eşleşme yoksa null — yanlış fact silinmez', () => {
    addFact('Arabası dizel');
    expect(forgetFact('tamamen alakasız zzz')).toBeNull();
    expect(getFacts()).toHaveLength(1);
  });
});

describe('buildMemoryPromptSection', () => {
  it('fact yoksa boş string (prompt\'a girmez)', () => {
    expect(buildMemoryPromptSection()).toBe('');
  });

  it('fact varsa madde listesi + kullanım talimatı içerir', () => {
    addFact('Arabası dizel');
    const section = buildMemoryPromptSection();
    expect(section).toContain('HATIRLADIKLARIN');
    expect(section).toContain('- Arabası dizel');
    expect(section).toContain('her cevapta sıralama');
  });

  it('clearFacts sonrası tekrar boş', () => {
    addFact('Arabası dizel');
    clearFacts();
    expect(buildMemoryPromptSection()).toBe('');
  });
});
