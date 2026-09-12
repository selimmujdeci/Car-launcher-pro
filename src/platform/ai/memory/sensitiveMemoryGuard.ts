/**
 * sensitiveMemoryGuard — hafızaya HASSAS VERİ girmesini/çıkmasını engelleyen kapı.
 *
 * Hafıza kalıcıdır ve AI'ya gider; bu yüzden filtre HEM YAZMA HEM OKUMA yolunda
 * uygulanır (eski kayıtlar da denetlenir — geçmişte sızmış bir veri sonradan
 * AI'ya taşınmaz).
 *
 * ── POLİTİKA: REDAKTE DEĞİL, REDDET ─────────────────────────────────────────
 * Kısmi maskeleme yanlış güven verir ("son 4 hane" bile kimlik ipucudur) ve
 * maskeleme hatası sessizce sızıntıya döner. Bu yüzden hassas desen içeren
 * KAYIT TAMAMEN REDDEDİLİR (fail-closed). Şüphede kalırsak reddederiz.
 *
 * Desenler bilinçli olarak GENİŞ tutulmuştur: yanlış pozitif (bir tercihi
 * hatırlamamak) kabul edilebilir; yanlış negatif (VIN/telefon/anahtar sızması)
 * DEĞİLDİR.
 */

import { hasControlChars } from '../controlChars';

export type SensitiveReason =
  | 'vin'
  | 'plate'
  | 'phone'
  | 'email'
  | 'financial'
  | 'api_key'
  | 'coordinates'
  | 'long_digits'
  | 'too_long'
  | 'empty'
  | 'control_chars';

export type MemoryGuardResult =
  | { readonly allowed: true;  readonly text: string }
  | { readonly allowed: false; readonly reason: SensitiveReason };

/** Tek kaydın azami uzunluğu — uzun paragraf hatırlanmaz (token + gizlilik). */
export const MAX_MEMORY_TEXT_LENGTH = 160;

/**
 * Hassas desenler. Sıra ÖNEMLİ değildir (ilk eşleşen reddeder); her biri
 * bağımsız bir gizlilik sınıfını temsil eder.
 */
const PATTERNS: ReadonlyArray<{ readonly reason: SensitiveReason; readonly re: RegExp }> = [
  // API/gizli anahtar biçimleri (bu kod tabanında kullanılan tüm sağlayıcılar)
  { reason: 'api_key',     re: /\b(sk-[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9]{8,}|tvly-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{10,}|AQ\.[A-Za-z0-9_.-]{10,})/i },
  // VIN: 17 karakter, I/O/Q yok
  { reason: 'vin',         re: /\b[A-HJ-NPR-Z0-9]{17}\b/i },
  // IBAN / kart numarası benzeri
  { reason: 'financial',   re: /\b([A-Z]{2}\d{2}[A-Z0-9]{11,30}|\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{2,7})\b/i },
  // E-posta
  { reason: 'email',       re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  // Telefon (uluslararası veya yerel, ayraçlı)
  { reason: 'phone',       re: /(\+\d[\d\s().-]{7,}\d)|(\b0\d{3}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b)/ },
  // Türk plakası: 34 ABC 123 / 06AB1234
  { reason: 'plate',       re: /\b\d{2}\s?[A-Z]{1,3}\s?\d{2,4}\b/i },
  // Koordinat çifti (ondalıklı)
  { reason: 'coordinates', re: /\b\d{1,3}\.\d{4,}\s*[,;]\s*\d{1,3}\.\d{4,}\b/ },
  // Uzun rakam dizisi (kimlik/kart/hesap ipucu)
  { reason: 'long_digits', re: /\b\d{9,}\b/ },
];

/**
 * Bir hafıza metnini denetler. Geçerse TEMİZLENMİŞ metni, geçmezse REDDEDİLME
 * NEDENİNİ döner. ASLA throw etmez.
 */
export function guardMemoryText(raw: unknown): MemoryGuardResult {
  if (typeof raw !== 'string') return { allowed: false, reason: 'empty' };
  const text = raw.trim().replace(/\s+/g, ' ');
  if (text.length < 2)                       return { allowed: false, reason: 'empty' };
  if (hasControlChars(text))                 return { allowed: false, reason: 'control_chars' };
  if (text.length > MAX_MEMORY_TEXT_LENGTH)  return { allowed: false, reason: 'too_long' };

  for (const { reason, re } of PATTERNS) {
    if (re.test(text)) return { allowed: false, reason };
  }
  return { allowed: true, text };
}

/** Kolaylık: yalnız güvenli metinleri geçiren filtre (okuma yolunda kullanılır). */
export function filterSafeMemoryTexts(texts: readonly unknown[]): readonly string[] {
  const out: string[] = [];
  for (const t of texts ?? []) {
    const result = guardMemoryText(t);
    if (result.allowed) out.push(result.text);
  }
  return out;
}
