/**
 * remoteCommandSources.ts — CAROS LAB · Uzak Komut Zinciri TEK okuma katmanı.
 *
 * Desen (A3–A8 ve enforcementPoints turlarıyla aynı): senkron getter, her biri
 * kendi try/catch'i içinde. HİÇBİR şey başlatmaz/durdurmaz, komut GÖNDERMEZ,
 * dinleyiciyi yeniden bağlamaz, ağa çıkmaz, timer kurmaz.
 *
 * ── GİZLİLİK (CLAUDE.md gözlemlenebilirlik kuralı 6) ────────────────────────
 * Şunlar bu katmandan GEÇMEZ: komut payload'ı · nonce · `api_key` · E2E anahtar
 * malzemesi · komut kimliği (UUID) · araç kimliği (UUID) · koordinat · hedef
 * adres. Geçenler yalnız: SAYILAR, komut TİPİ (kişisel veri değil), ZAMAN
 * damgaları ve VAR/YOK durumları.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Uzak komut zinciri bugüne dek HİÇ gözlenemiyordu. Telefondan basılan bir
 * düğme çalışmadığında dört ayrı sebep AYIRT EDİLEMİYORDU: (a) dinleyici hiç
 * bağlı değil · (b) komut geldi ama şifresi çözülemedi · (c) araç hareket
 * halinde olduğu için güvenlik kapısı reddetti · (d) komut tipi araçta tanımlı
 * değil. Dördü de artık ayrı sayaçtır.
 */

import {
  getCommandEvidence, isCommandListenerActive,
  type CommandEvidence,
} from '../commandListener';
import {
  getSpeedAlertEvidence, getSpeedAlertConfig,
  SPEED_ALERT_HYSTERESIS_KMH, SPEED_ALERT_COOLDOWN_MS,
  SPEED_ALERT_MIN_KMH, SPEED_ALERT_MAX_KMH,
  type SpeedAlertEvidence, type SpeedAlertConfig,
} from '../speedAlertRuntime';

export interface RemoteCommandRawSnapshot {
  readonly readAt: number;
  /** Dinleyici canlı mı — `null` = okunamadı (kaynak hatası). */
  readonly listenerActive: boolean | null;
  readonly command: CommandEvidence | null;
  readonly speedAlert: SpeedAlertEvidence | null;
  /** Araçtaki geçerli hız uyarısı ayarı; `null` = hiç kurulmadı. */
  readonly speedAlertConfig: SpeedAlertConfig | null;
  /* Politika değerleri — eşiği görmeden sayaç yorumlanamaz. */
  readonly hysteresisKmh: number;
  readonly cooldownMs:    number;
  readonly thresholdMinKmh: number;
  readonly thresholdMaxKmh: number;
}

function safeListenerActive(): boolean | null {
  try { return isCommandListenerActive(); } catch { return null; }
}

function safeCommandEvidence(): CommandEvidence | null {
  try { return getCommandEvidence(); } catch { return null; }
}

function safeSpeedAlertEvidence(): SpeedAlertEvidence | null {
  try { return getSpeedAlertEvidence(); } catch { return null; }
}

function safeSpeedAlertConfig(): SpeedAlertConfig | null {
  try { return getSpeedAlertConfig(); } catch { return null; }
}

/** Tek okuma — her alan bağımsız fail-soft. */
export function readRemoteCommandSnapshot(): RemoteCommandRawSnapshot {
  return {
    readAt:           Date.now(),
    listenerActive:   safeListenerActive(),
    command:          safeCommandEvidence(),
    speedAlert:       safeSpeedAlertEvidence(),
    speedAlertConfig: safeSpeedAlertConfig(),
    hysteresisKmh:    SPEED_ALERT_HYSTERESIS_KMH,
    cooldownMs:       SPEED_ALERT_COOLDOWN_MS,
    thresholdMinKmh:  SPEED_ALERT_MIN_KMH,
    thresholdMaxKmh:  SPEED_ALERT_MAX_KMH,
  };
}
