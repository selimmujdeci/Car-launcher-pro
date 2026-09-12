/**
 * shortTermMemory — SÜREÇ-ÖMÜRLÜ kısa dönem hafıza (yalnız RAM).
 *
 * Uzun dönem hafızadan (kalıcı depolar) KESİN olarak ayrıdır:
 *  - Hiçbir kalıcı depoya YAZILMAZ (localStorage/safeStorage/dosya YOK).
 *  - Uygulama yeniden başlayınca BOŞ başlar.
 *  - Sınırlı halka tampon: en eski kayıt düşer (sınırsız büyüme yok).
 *  - Her kayıt HASSAS VERİ KAPISINDAN geçer; geçemeyen SAKLANMAZ.
 *
 * Zaman DI ile gelir (`atMs`); `Date.now` gömülü değildir.
 */

import { guardMemoryText } from './sensitiveMemoryGuard';
import type { MemoryRecord } from './memoryTypes';

/** Halka tampon kapasitesi — token + gizlilik sınırı. */
export const SHORT_TERM_CAPACITY = 8;

let _records: MemoryRecord[] = [];

/**
 * Kısa dönem kayıt ekler. Hassas veya geçersiz metin SAKLANMAZ (`false` döner).
 * Aynı metin arka arkaya tekrarlanırsa yeniden eklenmez (gürültü önleme).
 */
export function rememberShortTerm(text: string, atMs: number): boolean {
  const guard = guardMemoryText(text);
  if (!guard.allowed) return false;

  const last = _records[_records.length - 1];
  if (last && last.text === guard.text) return true;      // tekrar — zaten var

  _records.push({
    scope:  'short_term',
    origin: 'session',
    text:   guard.text,
    at:     Number.isFinite(atMs) ? atMs : 0,
  });
  if (_records.length > SHORT_TERM_CAPACITY) {
    _records = _records.slice(-SHORT_TERM_CAPACITY);      // en eski düşer
  }
  return true;
}

/** Kayıtların kopyası (en eski → en yeni). Dış mutasyona kapalı. */
export function getShortTermMemory(): readonly MemoryRecord[] {
  return [..._records];
}

/** Oturum/profil değişiminde veya kullanıcı isteğiyle temizler. */
export function clearShortTermMemory(): void {
  _records = [];
}
