/**
 * pidDiscoverySources — CAROS LAB · PID Keşif Kanıtı TEK okuma katmanı (P0-OBD-CORE-01B).
 *
 * Desen (A3–A8 turlarıyla aynı): senkron getter, KENDİ try/catch'i içinde.
 * HİÇBİR el sıkışması BAŞLATMAZ, komut GÖNDERMEZ, timer KURMAZ — yalnız
 * `obdService.getHandshakeDiagnostics()` anlık kopyasını okur.
 *
 * GİZLİLİK: taşınan tek şey OBD protokol verisidir (bitmap hex önizlemesi,
 * blok adı, sonuç sınıfı, deneme sayısı). **VIN bu katmandan GEÇMEZ** —
 * `vinPresent` yalnız VAR/YOK boolean'ıdır, VIN'in kendisi ASLA okunmaz.
 */

import { getHandshakeDiagnostics } from '../obdService';
/* Tip, değeri üreten modülden alınır (`getHandshakeDiagnostics` ile AYNI yer) —
   `diagnosticSections` bu tipi yalnız TÜKETİR, sahibi değildir. */
import type { HandshakeDiagnostics } from '../obdService';

export interface PidDiscoverySnapshot {
  readonly readAt: number;
  /** `null` = tanı okunamadı (fail-soft). */
  readonly diag: HandshakeDiagnostics | null;
}

function _safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

/** Tek senkron okuma. ASLA throw etmez. */
export function readPidDiscoverySnapshot(): PidDiscoverySnapshot {
  return {
    readAt: Date.now(),
    diag:   _safe<HandshakeDiagnostics | null>(() => getHandshakeDiagnostics(), null),
  };
}
