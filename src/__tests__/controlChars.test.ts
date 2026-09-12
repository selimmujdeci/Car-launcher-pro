/**
 * controlChars — C0/C1 kontrol karakteri yardımcısının KAPSAM kilidi.
 *
 * Bu modül, AI hattındaki 7 ayrı sanitize noktasında kullanılan
 * `new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]')` regex'inin yerine geçti.
 * Gerekçeler (bkz. modül başlığı): `no-control-regex` · `build.target: es2015` /
 * `Chrome >= 50` hedefinde `\p{Cc}` PARSE EDİLEMEZ · her çağrıda regex derleme.
 *
 * Kilidin ASIL işi "çalışıyor mu" değil, **kapsam kaymadı mı**:
 *   – kapsam GENİŞLERSE meşru metin (Türkçe harf, emoji, boşluk) bozulur;
 *   – kapsam DARALIRSA prompt enjeksiyonu ve bozuk API anahtarı sızar.
 *
 * Bu yüzden 0x00–0xFF aralığının TAMAMI, bağımsız bir sayısal şartnameye karşı
 * tek tek karşılaştırılır. Şartname kasıtlı olarak implementasyondan AYRI yazılır
 * (regex de, döngü de değil — sadece aralık tanımı).
 *
 * NOT: bu dosyaya LİTERAL kontrol karakteri yazılmaz; karakterler `fromCharCode`
 * ile üretilir. Böylece kaynak dosya kopyala/yapıştır ile bozulamaz.
 */
import { describe, it, expect } from 'vitest';
import { hasControlChars, stripControlChars } from '../platform/ai/controlChars';

/**
 * BAĞIMSIZ ŞARTNAME — Unicode "Cc" kategorisi:
 *   C0 kontrol : U+0000–U+001F
 *   DEL        : U+007F
 *   C1 kontrol : U+0080–U+009F
 * Eski üretim regex'i bu kümenin ta kendisiydi:
 *   new RegExp('[' + '\u0000-\u001F\u007F-\u009F' + ']')
 */
const spec = (c: number): boolean => (c >= 0x00 && c <= 0x1f) || (c >= 0x7f && c <= 0x9f);

const U = (c: number): string => String.fromCharCode(c);
const hex = (c: number): string => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`;

describe('controlChars — kapsam şartnameye BİREBİR uyar (0x00–0xFF taraması)', () => {
  it('hasControlChars her kod noktasında şartnameyle aynı kararı verir', () => {
    const fark: string[] = [];
    for (let c = 0x00; c <= 0xff; c++) {
      if (hasControlChars(U(c)) !== spec(c)) fark.push(hex(c));
    }
    expect(fark, `kapsam kaydı (şartname ile uyuşmayan kod noktaları): ${fark.join(', ')}`).toEqual([]);
  });

  it('stripControlChars yalnız şartnamedeki karakterleri boşluğa çevirir', () => {
    const fark: string[] = [];
    for (let c = 0x00; c <= 0xff; c++) {
      const beklenen = spec(c) ? 'a b' : `a${U(c)}b`;
      if (stripControlChars(`a${U(c)}b`) !== beklenen) fark.push(hex(c));
    }
    expect(fark, `çıktı farkı: ${fark.join(', ')}`).toEqual([]);
  });

  it('SINIR: aralık uçları içeride, komşuları dışarıda', () => {
    for (const c of [0x00, 0x1f, 0x7f, 0x80, 0x9f]) {
      expect(hasControlChars(U(c)), `${hex(c)} kaçtı — kapsam DARALDI`).toBe(true);
    }
    for (const c of [0x20, 0x7e, 0xa0, 0xa1]) {
      expect(hasControlChars(U(c)), `${hex(c)} yakalandı — kapsam GENİŞLEDİ`).toBe(false);
    }
  });

  it('meşru metin bozulmaz: Türkçe harfler · sembol · emoji · normal boşluk', () => {
    for (const s of [' ', 'a', 'Z', '0', '~', 'ığüşöçİĞÜŞÖÇ', 'Ω', '€', '😀', 'motor 92 derece']) {
      expect(hasControlChars(s), `meşru metin kontrol karakteri sayıldı: ${JSON.stringify(s)}`).toBe(false);
      expect(stripControlChars(s), `meşru metin değiştirildi: ${JSON.stringify(s)}`).toBe(s);
    }
  });
});

describe('controlChars — davranış sözleşmesi', () => {
  it('her kontrol karakteri TEK karakterle değişir (uzunluk korunur)', () => {
    const s = `a${U(0x00)}b${U(0x1f)}c`;
    expect(stripControlChars(s)).toBe('a b c');
    expect(stripControlChars(s).length).toBe(s.length);
  });

  it('satır sonu ve sekme de kontrol karakteridir (tek satıra indirme dayanağı)', () => {
    expect(stripControlChars('satır\nsonu')).toBe('satır sonu');
    expect(stripControlChars('sek\tme')).toBe('sek me');
    expect(stripControlChars('cr\r\nlf')).toBe('cr  lf');
  });

  it('temiz metin AYNEN döner (hot-path: tahsis yok)', () => {
    const s = 'motor sıcaklığı 92 derece';
    expect(stripControlChars(s)).toBe(s);
  });

  it('boş metin ve sınır durumları throw ETMEZ', () => {
    expect(stripControlChars('')).toBe('');
    expect(hasControlChars('')).toBe(false);
  });

  it('değiştirme karakteri özelleştirilebilir (varsayılan boşluk)', () => {
    expect(stripControlChars(`a${U(0x07)}b`, '')).toBe('ab');
    expect(stripControlChars(`a${U(0x07)}b`, '·')).toBe('a·b');
  });
});
