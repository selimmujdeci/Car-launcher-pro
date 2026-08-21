/**
 * turkishFold — Türkçe arama katlaması (ÇALIŞMA ZAMANI tarafı).
 *
 * SAF: I/O YOK · timer YOK · global durum YOK · `Date.now` YOK.
 *
 * ⚠️ İKİZİ VAR: `scripts/lib/turkishFold.mjs` (BUILD tarafı, `poi.db`yi yazar).
 * İkisi AYNI davranmak ZORUNDADIR: veritabanı orada bu kuralla YAZILIR, sorgu
 * burada aynı kuralla KATLANIR. Ayrışırlarsa arama sessizce hiçbir şey bulmaz —
 * `src/__tests__/turkishFold.test.ts` ikisini aynı fikstür üzerinde karşılaştırır.
 *
 * ── NEDEN `toLowerCase()` YETMEZ ───────────────────────────────────────────
 * Türkçe'nin i/I ikilisi Unicode'da simetrik DEĞİLDİR:
 *   `'I'.toLowerCase() === 'i'`   ama Türkçe'de `I`ın küçüğü `ı`dır
 *   `'İ'.toLowerCase() === 'i̇'`  (i + U+0307) — GÖRÜNMEZ bir birleşen bırakır
 * Sonuç: "İstanbul" ile "istanbul" eşleşmez. Bu yüzden i-ailesinin TAMAMI tek
 * hedefe (`i`) katlanır — arama kaybetmez.
 *
 * Bu bir GÖSTERİM dönüşümü DEĞİLDİR: ekranda ASLA kullanılmaz (kullanıcının
 * yazdığı ad olduğu gibi gösterilir), yalnız arama anahtarı üretir.
 */

/** Katlama tablosu — ikizle BİREBİR aynı olmalı. */
const FOLD_MAP: Readonly<Record<string, string>> = {
  'İ': 'i', 'I': 'i', 'ı': 'i', 'i': 'i',
  'Ş': 's', 'ş': 's',
  'Ğ': 'g', 'ğ': 'g',
  'Ü': 'u', 'ü': 'u',
  'Ö': 'o', 'ö': 'o',
  'Ç': 'c', 'ç': 'c',
  'Â': 'a', 'â': 'a',
  'Î': 'i', 'î': 'i',
  'Û': 'u', 'û': 'u',
};

/**
 * Metni arama anahtarına çevirir: Türkçe katlama + küçük harf + tek boşluk.
 * ASLA throw etmez; string olmayan girdi boş string döner.
 */
export function foldTr(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  let out = '';
  for (const ch of input) {
    const mapped = FOLD_MAP[ch];
    out += mapped !== undefined ? mapped : ch.toLowerCase();
  }
  /* Birleşen işaretleri (ör. `İ`.toLowerCase()'ten kalan U+0307) TEMİZLE. */
  return out.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

export const TURKISH_FOLD_MAP = FOLD_MAP;
