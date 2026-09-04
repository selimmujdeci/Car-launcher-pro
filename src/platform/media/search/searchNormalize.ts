/**
 * searchNormalize.ts — F5 · Arama anahtarı normalizasyonu (SAF).
 *
 * PAZARLIKSIZ SINIR: burada üretilen metin YALNIZ arama anahtarıdır.
 * Kanonik metadata (başlık · sanatçı · albüm) ASLA bu değerle değiştirilmez —
 * kullanıcıya gösterilen ad her zaman sağlayıcının/kütüphanenin verdiği addır.
 *
 * TÜRKÇE: `toLowerCase()` Türkçe için YANLIŞTIR — "İ" → "i̇" (birleşik nokta)
 * üretir ve "I" → "i" yaparak ı/i ayrımını bozar. Bu yüzden önce NFD ile
 * aksanlar ayrıştırılır, birleşen işaretler düşürülür, sonra `tr-TR` yerelinde
 * küçültülür ve son olarak ı→i katlaması yapılır (kullanıcı "ısparta" ile
 * "isparta" arasında ayrım beklemez).
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

/**
 * Katlama tablosu — KÜÇÜLTMEDEN SONRA uygulanır.
 *
 * Sıra kritiktir: "İ" NFD ile "I" + birleşen nokta olur, nokta düşünce "I"
 * kalır ve `tr-TR` küçültmesi onu "ı" yapar. Katlama önce uygulansaydı
 * "İstanbul" → "ıstanbul" olurdu (yani kullanıcı "istanbul" yazınca bulamazdı).
 * Bu yüzden ı→i katlaması küçültmenin ARDINDAN gelir.
 */
const FOLD: Readonly<Record<string, string>> = {
  ı: 'i', ş: 's', ğ: 'g', ç: 'c', ö: 'o', ü: 'u',
};

/**
 * Arama anahtarı üretir: aksansız, `tr-TR` küçük harf, ı/i katlanmış, tek
 * boşlukla sadeleştirilmiş. Boş/geçersiz girdi boş string döner (uydurma yok).
 */
export function searchKey(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length === 0) return '';
  // NFD: "ş" → "s" + birleşen çengel; birleşen işaretler (U+0300–U+036F) atılır.
  const lowered = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('tr-TR');
  let out = '';
  for (const ch of lowered) out += FOLD[ch] ?? ch;
  return out.replace(/\s+/g, ' ').trim();
}

/** Anahtarı kelimelere böler — boş parça üretmez. */
export function searchTokens(value: string | null | undefined): readonly string[] {
  const key = searchKey(value);
  return key ? key.split(' ') : [];
}

/**
 * Sorgu tarafı normalizasyonu. Aramada anlamı olmayan noktalama düşürülür
 * (kullanıcı "sezen aksu - gülümse" yazınca da bulmalı), ama harfler KORUNUR.
 */
export function normalizeQuery(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  return searchKey(raw.replace(/[_\-–—/\\|,;:.!?"'`()[\]{}]+/g, ' '));
}

/** İki anahtarın kelime düzeyinde kesişim sayısı — sıralama kanıtı girdisi. */
export function tokenOverlap(
  queryTokens: readonly string[], targetTokens: readonly string[],
): number {
  if (queryTokens.length === 0 || targetTokens.length === 0) return 0;
  const target = new Set(targetTokens);
  let hits = 0;
  queryTokens.forEach((t) => { if (target.has(t)) hits += 1; });
  return hits;
}
