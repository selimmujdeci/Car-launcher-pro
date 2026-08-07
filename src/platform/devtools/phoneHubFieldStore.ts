/**
 * phoneHubFieldStore.ts — Saha Doğrulama oturumunun YEREL kalıcılığı (P0.8).
 *
 * ── SINIRLAR (pazarlıksız) ──────────────────────────────────────────────────
 *  · YALNIZ YEREL. Production backend · Supabase · Firebase · uzak sunucu ·
 *    telemetri — HİÇBİRİNE gönderim YOK. Bu dosyada ağ çağrısı BULUNMAZ.
 *  · Mevcut `safeStorage` sarmalayıcısı kullanılır (kota/bozulma dayanıklı,
 *    yazma debounce'lu) — yeni depolama deseni İCAT EDİLMEZ.
 *  · Anahtar `caros.lab.*` ad alanında → üretim kullanıcı verisiyle KARIŞMAZ.
 *  · Yazmadan ÖNCE PII süzgeci uygulanır: modelin tipleri zaten PII taşımaz,
 *    ama diske yazarken ekrandaki nesneye GÜVENİLMEZ (ikinci kapı).
 *  · Okuma ASLA throw etmez; bozuk/eski kayıt `migrateSession` ile göç eder,
 *    anlaşılamazsa `null` döner ve çağıran yeni oturum açar.
 *
 * Bu dosya I/O yaptığı için SAF DEĞİLDİR — saf mantık `phoneHubFieldModel.ts`te.
 */

import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../utils/safeStorage';
import {
  PH_FIELD_STORAGE_KEY, PH_FIELD_SCHEMA_VERSION,
  migrateSession, sanitizeForExport, createSession,
  type PhoneHubFieldValidationSession,
} from './phoneHubFieldModel';

/**
 * Oturumu diske yazar. ASLA throw etmez; başarısızlıkta `false` döner ve çağıran
 * kullanıcıya dürüst bir mesaj gösterir (sessiz başarı iddiası YOK).
 *
 * NEDEN DEBOUNCE DEĞİL, ANINDA: bu yazım YÜKSEK FREKANSLI telemetri DEĞİLDİR —
 * yalnız kullanıcının elle tetiklediği ölçüm/sıfırlama anlarında olur (oturum başına
 * bir elin parmakları kadar). Buna karşılık kaybı pahalıdır: araçtayken alınan bir
 * saha ölçümü uygulama kapanınca YOK OLURSA tekrar edilemez. eMMC bütçesi
 * (CLAUDE.md §I/O) yüksek frekanslı yazımlar içindir; burası o sınıfa girmez.
 * Ek fayda: okuma-yazma tutarlılığı anındadır.
 */
export function saveFieldSession(session: PhoneHubFieldValidationSession): boolean {
  try {
    /* İKİNCİ KAPI: diske yazılan gövde de PII süzgecinden geçer. */
    const safe = sanitizeForExport(session);
    safeSetRaw(PH_FIELD_STORAGE_KEY, JSON.stringify(safe), 0, true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Son oturumu okur. Bozuk JSON, eski şema veya eksik alan ASLA çökertmez;
 * göç edilemeyen gövde için `null` döner.
 */
export function loadFieldSession(): PhoneHubFieldValidationSession | null {
  let raw: string | null;
  try {
    raw = safeGetRaw(PH_FIELD_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return migrateSession(parsed);
}

/** Kalıcı kaydı siler. ASLA throw etmez. */
export function deleteFieldSession(): boolean {
  try {
    safeRemoveRaw(PH_FIELD_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Son oturumu açar; yoksa/bozuksa YENİ oturum kurar.
 *
 * `sessionId` ve `nowMs` ÇAĞIRANDAN gelir — bu dosya da saat/rastgele üretmez ki
 * ekran testte deterministik sürülebilsin.
 */
export function loadOrCreateFieldSession(
  sessionId: string,
  nowMs: number,
): PhoneHubFieldValidationSession {
  const existing = loadFieldSession();
  if (existing && existing.schemaVersion === PH_FIELD_SCHEMA_VERSION) return existing;
  if (existing) return { ...existing, schemaVersion: PH_FIELD_SCHEMA_VERSION };
  return createSession(sessionId, nowMs);
}
