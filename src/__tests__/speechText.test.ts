/**
 * speechText.test.ts — TTS Türkçe konuşma-dili normalizasyonu (P0-1)
 * Saf fonksiyon testleri: sayı, saat, tarih, para, yüzde, derece, birim.
 */
import { describe, it, expect } from 'vitest';
import { normalizeForSpeech, numberToTurkish } from '../platform/speechText';

describe('numberToTurkish', () => {
  const cases: [number, string][] = [
    [0, 'sıfır'],
    [1, 'bir'],
    [9, 'dokuz'],
    [10, 'on'],
    [11, 'on bir'],
    [21, 'yirmi bir'],
    [100, 'yüz'],
    [101, 'yüz bir'],
    [150, 'yüz elli'],
    [200, 'iki yüz'],
    [999, 'dokuz yüz doksan dokuz'],
    [1000, 'bin'],
    [1500, 'bin beş yüz'],
    [2000, 'iki bin'],
    [12000, 'on iki bin'],
    [1000000, 'bir milyon'],
    [2026, 'iki bin yirmi altı'],
    [-5, 'eksi beş'],
  ];
  it.each(cases)('%d → %s', (n, expected) => {
    expect(numberToTurkish(n)).toBe(expected);
  });
});

describe('normalizeForSpeech — sayı', () => {
  it('düz tam sayı', () => {
    expect(normalizeForSpeech('150')).toBe('yüz elli');
  });
  it('binlik ayraçlı sayı', () => {
    expect(normalizeForSpeech('1.500')).toBe('bin beş yüz');
    expect(normalizeForSpeech('12.000.000')).toBe('on iki milyon');
  });
  it('ondalık (virgül)', () => {
    expect(normalizeForSpeech('3,5')).toBe('üç virgül beş');
  });
  it('negatif', () => {
    expect(normalizeForSpeech('-5 derece')).toBe('eksi beş derece');
  });
});

describe('normalizeForSpeech — yüzde', () => {
  it('%15 (önde)', () => expect(normalizeForSpeech('%15')).toBe('yüzde on beş'));
  it('15% (arkada)', () => expect(normalizeForSpeech('15%')).toBe('yüzde on beş'));
  it('cümle içinde', () => {
    expect(normalizeForSpeech('Yakıt %15, az kaldı.')).toBe('Yakıt yüzde on beş, az kaldı.');
  });
});

describe('normalizeForSpeech — saat', () => {
  it('tam saat → yalnız saat', () => expect(normalizeForSpeech('09:00')).toBe('dokuz'));
  it(':30 → buçuk', () => expect(normalizeForSpeech('12:30')).toBe('on iki buçuk'));
  it('tek haneli dakika → sıfır N', () => expect(normalizeForSpeech('14:05')).toBe('on dört sıfır beş'));
  it('genel', () => expect(normalizeForSpeech('14:45')).toBe('on dört kırk beş'));
});

describe('normalizeForSpeech — tarih', () => {
  it('GG.AA.YYYY', () => {
    expect(normalizeForSpeech('25.06.2026')).toBe('yirmi beş Haziran iki bin yirmi altı');
  });
  it('ondalık tarih sanılmaz (yıl yoksa)', () => {
    // 3.5 → date değil, ondalık
    expect(normalizeForSpeech('3,5 litre')).toBe('üç virgül beş litre');
  });
});

describe('normalizeForSpeech — para', () => {
  it('₺ önde', () => expect(normalizeForSpeech('₺150')).toBe('yüz elli lira'));
  it('TL arkada', () => expect(normalizeForSpeech('150 TL')).toBe('yüz elli lira'));
  it('$ dolar', () => expect(normalizeForSpeech('$20')).toBe('yirmi dolar'));
  it('kuruşlu', () => expect(normalizeForSpeech('150,50 TL')).toBe('yüz elli lira elli kuruş'));
});

describe('normalizeForSpeech — derece & birim', () => {
  it('25° → derece', () => expect(normalizeForSpeech('25°')).toBe('yirmi beş derece'));
  it('25°C → derece', () => expect(normalizeForSpeech('25°C')).toBe('yirmi beş derece'));
  it('5 km → kilometre', () => expect(normalizeForSpeech('5 km')).toBe('beş kilometre'));
  it('80 km/s → saatte ... kilometre', () => {
    expect(normalizeForSpeech('80 km/s')).toBe('saatte seksen kilometre');
  });
  it('"500 metre" zaten kelime — bozulmaz', () => {
    expect(normalizeForSpeech('500 metre ileride')).toBe('beş yüz metre ileride');
  });
});

describe('normalizeForSpeech — güvenlik/dayanıklılık', () => {
  it('boş/geçersiz girdi güvenli', () => {
    expect(normalizeForSpeech('')).toBe('');
    // @ts-expect-error runtime güvenlik testi
    expect(normalizeForSpeech(null)).toBe('');
  });
  it('rakam yoksa metni değiştirmez (& hariç)', () => {
    expect(normalizeForSpeech('Harita açılıyor')).toBe('Harita açılıyor');
  });
  it('güvenlik mesajı anlamı korunur', () => {
    expect(normalizeForSpeech('Dikkat! Kaza, 300 metre ileride.'))
      .toBe('Dikkat! Kaza, üç yüz metre ileride.');
  });
});
