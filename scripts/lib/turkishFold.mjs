/**
 * turkishFold.mjs — Türkçe arama katlaması (BUILD tarafı).
 *
 * ⚠️ İKİZİ VAR: `src/platform/navigation/core/turkishFold.ts` (ÇALIŞMA ZAMANI).
 * İkisi AYNI davranmak ZORUNDADIR: veritabanı bu fonksiyonla YAZILIR, sorgu
 * öbürüyle KATLANIR. Ayrışırlarsa arama sessizce hiçbir şey bulmaz.
 * `src/__tests__/turkishFold.test.ts` ikisini aynı fikstür üzerinde karşılaştırır.
 *
 * ── NEDEN `toLowerCase()` YETMEZ ───────────────────────────────────────────
 * Türkçe'nin i/I ikilisi Unicode'da simetrik DEĞİLDİR:
 *   'I'.toLowerCase() === 'i'   ama Türkçe'de 'I'ın küçüğü 'ı'dır
 *   'İ'.toLowerCase() === 'i̇'  (i + U+0307 birleşen nokta) — GÖRÜNMEZ artık bırakır
 * Sonuç: "İstanbul" ile "istanbul" eşleşmez, "ISPARTA" ile "ısparta" eşleşmez.
 * Bu yüzden i-ailesinin TAMAMI tek bir hedefe (`i`) katlanır: arama kaybetmez.
 * (Bu bir GÖSTERİM dönüşümü değildir — ekranda ASLA kullanılmaz, yalnız arama
 * anahtarı üretir.)
 */

/** Katlama tablosu — ikizle BİREBİR aynı olmalı. */
const FOLD_MAP = {
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
export function foldTr(input) {
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
