/**
 * deviceIdentityLabSources.ts — CİHAZ KİMLİĞİ + E2E ANAHTAR GÖZLEMİ İÇİN
 * TEK OKUMA KATMANI (P0-001B).
 *
 * Desen A3–A8 ile birebir aynı: her getter SENKRON, kendi `try/catch`inde,
 * hata durumunda `null` döner (ekran `UNAVAILABLE` gösterir — sahte 0 YOK).
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * İki kusur uzun süre görünmedi çünkü ikisi de SESSİZDİ:
 *   · cihaz kimliği reinstall'da kayboluyor ve yeni araç açılıyordu (P0-001C);
 *   · E2E açık anahtar yayını `catch` içinde yutuluyordu ve fiziksel komutlar
 *     hiç çalışmıyordu (P0-001B).
 * Gözlemlenemeyen özellik tamamlanmış sayılmaz — bu katman o iki zinciri
 * ölçülebilir kılar.
 *
 * ── GİZLİLİK KAPILARI (BAĞLAYICI) ─────────────────────────────────────────
 * Bu katman ASLA taşımaz:
 *   · `veh_api_key` (ham veya kırpılmış)
 *   · cihaz kimliğinin KENDİSİ (yalnız KAYNAĞI ve reinstall güvenliği)
 *   · E2E AÇIK anahtarın tamamı (yalnız VAR/YOK + son yayın sonucu)
 *   · E2E ÖZEL anahtar — bu katmana hiç uğramaz
 *   · ham SSAID / ANDROID_ID
 * Taşıdığı şey: VAR/YOK · ADET · DURUM ADI · ZAMAN FARKI.
 *
 * HİÇBİR ŞEY BAŞLATMAZ: yayın tetiklemez, ağ çağrısı yapmaz, anahtar
 * üretmez, timer kurmaz — yalnız mevcut anlık görüntüleri OKUR.
 */

import { getDeviceIdentityStatus } from '../vehicleIdentityService';
import { getVehicleEventPipelineStatus } from '../vehicleIdentityService';
import { getCommandEvidence } from '../commandListener';

/** Her okuma bu kapıdan geçer: fırlatırsa `null` (fail-soft). */
function safe<T>(read: () => T): T | null {
  try {
    const v = read();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

/* ── Cihaz kimliği gözlemi ─────────────────────────────────────────────── */

export interface DeviceIdentityObservation {
  /** `STORED` · `DERIVED_SSAID` · `RANDOM_FALLBACK` · `UNKNOWN`. */
  readonly source: string;
  /** Kimlik reinstall'a dayanıklı mı (saklı ya da türetilebilir). */
  readonly reinstallSafe: boolean;
  /** Sunucu aracı tanıyor ama YEREL ANAHTAR yok (P0-001D/K bekliyor). */
  readonly registeredWithoutKey: boolean;
  /** `crypto.getRandomValues` bulunamadı → zayıf rastgelelik kullanıldı. */
  readonly weakRandomUsed: boolean;
}

export function readDeviceIdentity(): DeviceIdentityObservation | null {
  return safe(() => {
    const s = getDeviceIdentityStatus();
    return {
      source:               s.source,
      reinstallSafe:        s.reinstallSafe,
      registeredWithoutKey: s.registeredWithoutKey,
      weakRandomUsed:       s.weakRandomUsed,
    };
  });
}

/* ── Telemetri hattı gözlemi ───────────────────────────────────────────── */

export interface DevicePairingObservation {
  /** Supabase env build'e gömülü mü. */
  readonly configured: boolean;
  /** Eşlenmemiş cihaz yüzünden bu oturumda düşürülen event sayısı. */
  readonly droppedNoKeyCount: number;
  /** Son düşürme anının YAŞI (ms) — mutlak damga TAŞINMAZ. */
  readonly lastDropAgeMs: number | null;
}

export function readDevicePairing(): DevicePairingObservation | null {
  return safe(() => {
    const s = getVehicleEventPipelineStatus();
    return {
      configured:        s.configured,
      droppedNoKeyCount: s.droppedNoKeyCount,
      lastDropAgeMs:     s.lastDropAt === null ? null : Math.max(0, Date.now() - s.lastDropAt),
    };
  });
}

/* ── E2E açık anahtar yayını gözlemi ───────────────────────────────────── */

export interface E2eKeyPublishObservation {
  /** Yayın denemesi sayısı (her bağlantıda bir kez). */
  readonly runs: number;
  /** Sunucunun KABUL ettiği yayın sayısı. */
  readonly ok: number;
  /** `ok` · `rotated` · `rejected` · `no_key` · `error` · `null` (hiç denenmedi). */
  readonly outcome: string | null;
  /** Sunucunun reddetme gerekçesi (`INVALID_KEY_FORMAT` · `UNSUPPORTED_ALG`). */
  readonly reason: string | null;
  /** Son deneme anının YAŞI (ms) — `null` = hiç denenmedi. */
  readonly lastAgeMs: number | null;
  /** E2E şifre çözme/eksik şifreleme nedeniyle REDDEDİLEN komut sayısı. */
  readonly cryptoFailed: number;
}

export function readE2eKeyPublish(): E2eKeyPublishObservation | null {
  return safe(() => {
    const e = getCommandEvidence();
    return {
      runs:         e.keyPublishRuns,
      ok:           e.keyPublishOk,
      outcome:      e.keyPublishOutcome,
      reason:       e.keyPublishReason,
      lastAgeMs:    e.keyPublishAt === null ? null : Math.max(0, Date.now() - e.keyPublishAt),
      cryptoFailed: e.cryptoFailed,
    };
  });
}
