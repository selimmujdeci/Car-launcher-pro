/**
 * ttsNaturalness.guards.test.ts — TTS DOĞALLIK KİLİDİ (P0-1 + P0-2 + P1-1)
 *
 * Konuşma çok sentetik/robotikti → normalizasyon + segmentasyon + prozodi eklendi.
 * Bu davranışlar bir daha sessizce geri gitmesin diye kilitlenir:
 *  - Sayı/yüzde/saat/para/birim Türkçe konuşma diline çevrilir.
 *  - Güvenlik/acil uyarıları segmentlenmez (gecikme yok) → segment:false.
 *  - Segmentasyon: son segmentte sessizlik yok; soru sonu yükselen ton.
 *
 * (Ayrı dosya: regression.guards.test.ts'i bu işin dışındaki değişikliklerle
 *  karıştırmamak için kasıtlı olarak bağımsız tutuldu.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeForSpeech } from '../platform/speechText';
import { segmentSpeech } from '../platform/speechSegment';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('TTS normalizasyon kilidi (speechText)', () => {
  it('sayı/yüzde/saat/para/birim/derece → Türkçe konuşma dili', () => {
    expect(normalizeForSpeech('150')).toBe('yüz elli');
    expect(normalizeForSpeech('%15')).toBe('yüzde on beş');
    expect(normalizeForSpeech('12:30')).toBe('on iki buçuk');
    expect(normalizeForSpeech('150 TL')).toBe('yüz elli lira');
    expect(normalizeForSpeech('80 km/s')).toBe('saatte seksen kilometre');
    expect(normalizeForSpeech('25°C')).toBe('yirmi beş derece');
  });
  it('rakamsız metni bozmaz (fail-soft) — güvenlik mesajı anlamı korunur', () => {
    expect(normalizeForSpeech('Harita açılıyor')).toBe('Harita açılıyor');
    expect(normalizeForSpeech('Dikkat! Kaza, 300 metre ileride.'))
      .toBe('Dikkat! Kaza, üç yüz metre ileride.');
  });
});

describe('TTS segmentasyon/prozodi kilidi (speechSegment)', () => {
  it('son segmentte sessizlik yok; soru sonu yükselen, düz cümle düşen ton', () => {
    const q = segmentSpeech('Hazır mısın?');
    expect(q[q.length - 1].pauseMs).toBe(0);
    expect(q[q.length - 1].pitch).toBeGreaterThan(1.0);  // soru → yükselen
    const s = segmentSpeech('Harita açılıyor.');
    expect(s[0].pitch).toBeLessThan(1.0);                // düz cümle → düşen
  });
  it('düşük donanımda segment tavanı 4', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Cümle ${i + 1}.`).join(' ');
    expect(segmentSpeech(many, { lowEnd: true }).length).toBeLessThanOrEqual(4);
  });
});

describe('TTS güvenlik uyarısı kilidi (ttsService kaynağı)', () => {
  it('safety/hazard uyarıları segmentlenmez (segment: false) → gecikmesiz', () => {
    const src = read('src/platform/ttsService.ts');
    // İki acil kanal da segment:false vermeli (mikro-duraklama gecikmesi olmasın).
    const matches = src.match(/segment:\s*false/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
