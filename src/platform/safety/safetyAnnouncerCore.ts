/**
 * safetyAnnouncerCore — Safety Assistant FAZ 3B
 *
 * Saf/test edilebilir durumlu çekirdek. React bağımlılığı yok.
 * Bağımlılıklar (speak, chime) dışarıdan enjekte edilir → birim testinde mock.
 *
 * Davranış:
 *  - Aynı ruleId art arda gelirse konuşmaz (repeat basklama).
 *  - null alertte yalnızca iç lastRuleId sıfırlanır; konuşma yok.
 *  - null → aynı alert: yeniden konuşur (arada null → state temizlendi).
 *  - dispose() sonrası announce no-op.
 *  - TTS/chime hataları yakalanır; crash üretmez, console.warn ile loglanır.
 */

import { speakSafetyAlert } from '../ttsService';
import { playSafetyChime }  from './safetyChime';
import type { SafetyLevel } from './types';
import type { SafetyQueueOutput } from './types';

// ── Genel tipler ──────────────────────────────────────────────────────────────

/** Dışarıdan enjekte edilebilir bağımlılıklar (test için). */
export interface SafetyAnnouncerDeps {
  /** TTS fonksiyonu; varsayılan: speakSafetyAlert. */
  speak?: (msg: string) => void;
  /** Chime fonksiyonu; varsayılan: playSafetyChime. */
  chime?: (level: SafetyLevel) => void;
}

/** createSafetyAnnouncerCore dönüş arayüzü. */
export interface SafetyAnnouncer {
  /** Yeni queue çıktısını işle; gerekirse seslendir. */
  announce(output: SafetyQueueOutput): void;
  /** Sonraki announce çağrılarını no-op yap (unmount güvenliği). */
  dispose(): void;
}

// ── Varsayılan bağımlılıklar ──────────────────────────────────────────────────

/**
 * Güvenli TTS sarmalayıcı.
 * speakSafetyAlert başarısız olursa uygulamayı çökertemez.
 */
function defaultSpeak(msg: string): void {
  try {
    speakSafetyAlert(msg);
  } catch (e) {
    console.warn('[SafetyAnnouncer] TTS başarısız, atlandı', e);
  }
}

/** Güvenli chime sarmalayıcı. */
function defaultChime(level: SafetyLevel): void {
  try {
    playSafetyChime(level);
  } catch (e) {
    console.warn('[SafetyAnnouncer] Chime başarısız, atlandı', e);
  }
}

// ── Çekirdek fabrika ──────────────────────────────────────────────────────────

/**
 * Durumlu SafetyAnnouncer çekirdeği oluşturur.
 * Her React component mount noktası için bir instance (useRef ile tutulur).
 *
 * @param deps - Opsiyonel bağımlılık enjeksiyonu (test veya özel davranış).
 */
export function createSafetyAnnouncerCore(deps?: SafetyAnnouncerDeps): SafetyAnnouncer {
  const speak = deps?.speak ?? defaultSpeak;
  const chime = deps?.chime ?? defaultChime;

  // İç durum: son duyurulan ruleId
  let lastRuleId: string | null = null;
  let disposed = false;

  return {
    announce(output: SafetyQueueOutput): void {
      // dispose() sonrası hiçbir şey yapma
      if (disposed) return;

      const alert = output.voiceAnnouncementAlert;
      const cur = alert?.ruleId ?? null;

      // Aynı ruleId tekrar geldi — repeat engelle
      if (cur === lastRuleId) return;

      // State'i güncelle
      lastRuleId = cur;

      // null geçiş: yalnızca state sıfırlar, ses yok
      if (cur === null || alert === null || alert === undefined) return;

      // Önce chime, sonra konuşma (hata bağımsız: chime hatası speak'i durdurmaz)
      try {
        chime(alert.level);
      } catch (e) {
        console.warn('[SafetyAnnouncer] Chime çağrısı başarısız:', e);
      }

      try {
        speak(alert.message);
      } catch (e) {
        console.warn('[SafetyAnnouncer] Speak çağrısı başarısız:', e);
      }
    },

    dispose(): void {
      disposed = true;
    },
  };
}
