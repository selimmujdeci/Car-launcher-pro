/**
 * speechText.ts — TTS metin ön-işleme / Türkçe konuşma-dili normalizasyonu (P0-1)
 *
 * Amaç: Ham metindeki sayı, saat, tarih, para, yüzde, derece ve birim ifadelerini
 * TTS motorunun beceriksizce/yanlış okuduğu sembolik biçimden, doğal Türkçe
 * konuşma diline çevirmek. Motordan BAĞIMSIZDIR (saf string işleme) → en düşük
 * donanımlı/offline head unit'te bile çalışır, ücretli/online API gerektirmez.
 *
 * Tasarım kuralları:
 *   - SAF + DETERMİNİSTİK: yan etki yok, aynı girdi → aynı çıktı (test edilebilir).
 *   - FAIL-SOFT: herhangi bir adım hata verirse orijinal metin döner (asla throw).
 *   - ANLAM KORUR: yalnız okunuşu düzeltir; kelimeleri silmez/eklemez (güvenlik
 *     uyarısı metni de güvenle geçer — "500 metre" → "beş yüz metre").
 *
 * Çağrı: ttsService.ttsSpeak() içinde, dedupe'den SONRA, seslendirmeden ÖNCE.
 */

/* ── Türkçe sayı → kelime ───────────────────────────────────────────────────
 * 0 .. 999.999.999.999 aralığı. Türkçe kuralları:
 *   - "bir yüz" / "bir bin" DENMEZ → yalnız "yüz" / "bin".
 *   - "bir milyon" DENİR.
 */
const _ONES = ['sıfır', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const _TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
const _SCALES: [number, string][] = [
  [1_000_000_000, 'milyar'],
  [1_000_000, 'milyon'],
  [1_000, 'bin'],
];

/** 0–999 arası grubu Türkçe kelimeye çevirir. */
function _threeDigit(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) parts.push(h === 1 ? 'yüz' : `${_ONES[h]} yüz`);
  const t = Math.floor(rest / 10);
  const o = rest % 10;
  if (t > 0) parts.push(_TENS[t]);
  if (o > 0) parts.push(_ONES[o]);
  return parts.join(' ');
}

/** Negatif/tam sayıyı Türkçe kelimeye çevirir (ondalık AYRI ele alınır). */
export function numberToTurkish(value: number): string {
  if (!Number.isFinite(value)) return '';
  let n = Math.trunc(Math.abs(value));
  const sign = value < 0 ? 'eksi ' : '';
  if (n === 0) return `${sign}sıfır`;

  const words: string[] = [];
  for (const [scale, name] of _SCALES) {
    if (n >= scale) {
      const count = Math.floor(n / scale);
      n %= scale;
      // "bin" özel: "bir bin" → "bin". milyon/milyar'da "bir milyon" korunur.
      if (scale === 1_000 && count === 1) words.push('bin');
      else words.push(`${_threeDigit(count)} ${name}`);
    }
  }
  if (n > 0) words.push(_threeDigit(n));
  return sign + words.join(' ').replace(/\s+/g, ' ').trim();
}

/** Ondalıklı sayı → "tam virgül basamak basamak" (ör. 3,5 → "üç virgül beş"). */
function _decimalToTurkish(intPart: string, fracPart: string): string {
  const intN = parseInt(intPart, 10);
  const intWords = numberToTurkish(intN);
  // Ondalık kısım rakam-rakam okunur (doğal: "yüz elli virgül elli" değil "... beş sıfır" yerine
  // kuruş gibi anlamlı değilse basamak basamak): "virgül beş", "virgül sıfır beş".
  const fracWords = fracPart.split('').map((d) => _ONES[parseInt(d, 10)] ?? '').join(' ').trim();
  return `${intWords} virgül ${fracWords}`.trim();
}

/* ── Yardımcılar ─────────────────────────────────────────────────────────── */

const _MONTHS = [
  '', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

/** Binlik ayraçlı tam sayı dizgesini ("1.500", "12.000") sayıya çevirir. */
function _stripThousands(s: string): number {
  return parseInt(s.replace(/\./g, ''), 10);
}

/* ── Ana normalizasyon ──────────────────────────────────────────────────────
 * Sıra ÖNEMLİ: özgül kalıplar (tarih, saat, para…) ham rakamlardan ÖNCE işlenir;
 * düz sayı dönüşümü EN SONA bırakılır (kalan rakam gruplarını süpürür).
 */
export function normalizeForSpeech(input: string): string {
  if (!input || typeof input !== 'string') return input ?? '';
  try {
    let s = input;

    // 1) TARİH — yalnız tam GG.AA.YYYY (yıl zorunlu) → ondalık "3.5" ile çakışmasın.
    s = s.replace(
      /\b(0?[1-9]|[12]\d|3[01])[./](0?[1-9]|1[0-2])[./](\d{4})\b/g,
      (_m, d: string, mo: string, y: string) => {
        const day = numberToTurkish(parseInt(d, 10));
        const month = _MONTHS[parseInt(mo, 10)] ?? '';
        const year = numberToTurkish(parseInt(y, 10));
        return `${day} ${month} ${year}`;
      },
    );

    // 2) SAAT — HH:MM (00–23 : 00–59). :00 → yalnız saat, :30 → "buçuk",
    //    diğer → saat + dakika (tek haneli dakika "sıfır N" — dijital saat okunuşu).
    s = s.replace(
      /\b([01]?\d|2[0-3]):([0-5]\d)\b/g,
      (_m, h: string, mi: string) => {
        const hourW = numberToTurkish(parseInt(h, 10));
        const minN = parseInt(mi, 10);
        if (minN === 0) return hourW;
        if (minN === 30) return `${hourW} buçuk`;
        const minW = minN < 10 ? `sıfır ${_ONES[minN]}` : numberToTurkish(minN);
        return `${hourW} ${minW}`;
      },
    );

    // 3) PARA — sembol/kod + sayı (her iki sıralama). Ondalık kısım "kuruş/sent".
    const _money = (numStr: string, unit: string, sub: string): string => {
      const m = numStr.match(/^(\d[\d.]*)(?:,(\d+))?$/);
      if (!m) return `${numStr} ${unit}`;
      const main = numberToTurkish(_stripThousands(m[1]));
      if (m[2]) {
        const subN = parseInt(m[2].padEnd(2, '0').slice(0, 2), 10);
        if (subN > 0) return `${main} ${unit} ${numberToTurkish(subN)} ${sub}`;
      }
      return `${main} ${unit}`;
    };
    s = s
      // ₺150 / $20 / €10   (sembol önde)
      .replace(/₺\s?(\d[\d.]*(?:,\d+)?)/g, (_m, n: string) => _money(n, 'lira', 'kuruş'))
      .replace(/\$\s?(\d[\d.]*(?:,\d+)?)/g, (_m, n: string) => _money(n, 'dolar', 'sent'))
      .replace(/€\s?(\d[\d.]*(?:,\d+)?)/g, (_m, n: string) => _money(n, 'euro', 'sent'))
      // 150 TL / 150₺ / 20 USD / 10 EUR   (sembol/kod arkada)
      .replace(/(\d[\d.]*(?:,\d+)?)\s?(?:₺|TL|TRY)\b/gi, (_m, n: string) => _money(n, 'lira', 'kuruş'))
      .replace(/(\d[\d.]*(?:,\d+)?)\s?(?:\$|USD)\b/gi, (_m, n: string) => _money(n, 'dolar', 'sent'))
      .replace(/(\d[\d.]*(?:,\d+)?)\s?(?:€|EUR)\b/gi, (_m, n: string) => _money(n, 'euro', 'sent'));

    // 4) YÜZDE — %15 (önde, TR yazımı) ve 15% (arkada). Ondalıklı destekli.
    const _pct = (n: string): string => {
      const m = n.match(/^(\d+)(?:,(\d+))?$/);
      if (!m) return `yüzde ${n}`;
      return m[2] ? `yüzde ${_decimalToTurkish(m[1], m[2])}` : `yüzde ${numberToTurkish(parseInt(m[1], 10))}`;
    };
    s = s
      .replace(/%\s?(\d+(?:,\d+)?)/g, (_m, n: string) => _pct(n))
      .replace(/(\d+(?:,\d+)?)\s?%/g, (_m, n: string) => _pct(n));

    // 5) DERECE — 25°, 25 °C, 25°C, -5°. (birim "derece"yi metne katar)
    //    Trailing \b YOK: '°' non-word olduğundan "25°" sonunda boundary oluşmaz.
    s = s.replace(/(-?\d+(?:,\d+)?)\s?°\s?[CcFf]?/g, (_m, n: string) => {
      const neg = n.startsWith('-');
      const abs = neg ? n.slice(1) : n;
      const dm = abs.match(/^(\d+)(?:,(\d+))?$/);
      const w = dm && dm[2] ? _decimalToTurkish(dm[1], dm[2]) : numberToTurkish(parseInt(abs, 10));
      return `${neg ? 'eksi ' : ''}${w} derece`;
    });

    // 6) HIZ — km/s, km/sa, km/h → "saatte N kilometre" (km'den ÖNCE).
    s = s.replace(/(\d+(?:,\d+)?)\s?km\s?\/\s?(?:s|sa|saat|h)\b/gi, (_m, n: string) => {
      const dm = n.match(/^(\d+)(?:,(\d+))?$/);
      const w = dm && dm[2] ? _decimalToTurkish(dm[1], dm[2]) : numberToTurkish(parseInt(n, 10));
      return `saatte ${w} kilometre`;
    });

    // 7) BİRİMLER — yalnız sayıdan SONRA (yanlış eşleşme yok). Uzun ek korunur:
    //    "5 km" → "beş kilometre", "10 kg" → "on kilogram".
    const _units: [RegExp, string][] = [
      [/(\d+(?:,\d+)?)\s?km\b/gi, 'kilometre'],
      [/(\d+(?:,\d+)?)\s?cm\b/gi, 'santimetre'],
      [/(\d+(?:,\d+)?)\s?mm\b/gi, 'milimetre'],
      [/(\d+(?:,\d+)?)\s?kg\b/gi, 'kilogram'],
      [/(\d+(?:,\d+)?)\s?(?:lt|litre|L)\b/g, 'litre'],
      [/(\d+(?:,\d+)?)\s?m\b/g, 'metre'],
    ];
    for (const [re, unit] of _units) {
      s = s.replace(re, (_m, n: string) => {
        const dm = n.match(/^(\d+)(?:,(\d+))?$/);
        const w = dm && dm[2] ? _decimalToTurkish(dm[1], dm[2]) : numberToTurkish(parseInt(n, 10));
        return `${w} ${unit}`;
      });
    }

    // 8) '&' → "ve" (yaygın sembol). Diğer sembollere dokunma (anlam riski).
    s = s.replace(/\s?&\s?/g, ' ve ');

    // 9) KALAN SAYILAR — binlik ayraçlı, ondalıklı ve düz tam sayılar (EN SON).
    //    Binlik: 1.500 / 12.000.000  → tek sayı (ayraçları at).
    s = s.replace(/\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/g, (m) => {
      const [intp, frac] = m.split(',');
      const intN = _stripThousands(intp);
      return frac ? `${numberToTurkish(intN)} virgül ${frac.split('').map((d) => _ONES[+d]).join(' ')}` : numberToTurkish(intN);
    });
    //    Ondalık: 3,5 → "üç virgül beş".
    s = s.replace(/\b(\d+),(\d+)\b/g, (_m, i: string, f: string) => _decimalToTurkish(i, f));
    //    Negatif tam sayı: "-5" → "eksi beş" (kelime sınırında).
    s = s.replace(/(?<![\w.])-(\d+)\b/g, (_m, n: string) => numberToTurkish(-parseInt(n, 10)));
    //    Düz tam sayı.
    s = s.replace(/\b\d+\b/g, (m) => numberToTurkish(parseInt(m, 10)));

    // Çoklu boşlukları sadeleştir.
    return s.replace(/\s{2,}/g, ' ').trim();
  } catch {
    return input; // fail-soft: normalizasyon TTS'i asla kırmaz
  }
}
