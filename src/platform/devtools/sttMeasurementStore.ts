/**
 * sttMeasurementStore.ts — MAVI-STT-LAB-2 ölçüm defterinin YEREL kalıcılığı.
 *
 * ── SINIRLAR (pazarlıksız) ──────────────────────────────────────────────────
 *  · YALNIZ YEREL. Supabase · Firebase · uzak sunucu · telemetri — HİÇBİRİNE
 *    gönderim YOK; bu dosyada ağ çağrısı BULUNMAZ.
 *  · Mevcut `safeStorage` sarmalayıcısı ve `caros.lab.*` ad alanı kullanılır —
 *    `phoneHubFieldStore` ile BİREBİR aynı desen; YENİ genel amaçlı persistence
 *    katmanı KURULMAZ.
 *  · Yazma yalnız KULLANICI tetiklediği anlarda olur (ölçüm bitti · kayıt silindi ·
 *    defter temizlendi) — oturum başına birkaç kez. Yüksek frekanslı telemetri
 *    DEĞİLDİR, bu yüzden `immediate` yazılır (araçta alınan ölçüm uygulama
 *    kapanınca kaybolursa tekrar edilemez; eMMC bütçesi hot-path içindir).
 *  · Okuma ASLA throw etmez; bozuk/eski gövde `sanitizeLedger` ile süzülür,
 *    anlaşılamazsa BOŞ defter döner (sahte kayıt ÜRETİLMEZ).
 *
 * Bu dosya I/O yaptığı için SAF DEĞİLDİR — saf mantık `sttMeasurementModel.ts`te.
 */

import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../utils/safeStorage';
import {
  STT_LEDGER_STORAGE_KEY, STT_MEASUREMENT_SCHEMA_VERSION, STT_LEDGER_MAX,
  sanitizeLedger, sanitizeMeasurementRecord,
  type SttMeasurementRecord,
} from './sttMeasurementModel';

interface StoredLedger {
  schemaVersion: number;
  records: unknown[];
}

/**
 * Defteri diske yazar. ASLA throw etmez; başarısızlıkta `false` döner ve çağıran
 * kullanıcıya dürüst mesaj gösterir (sessiz başarı iddiası YOK).
 *
 * İKİNCİ KAPI: yazılan her kayıt `sanitizeMeasurementRecord`ten geçer — ekrandan
 * gelen nesneye GÜVENİLMEZ, bilinmeyen alan diske ÇIKAMAZ.
 */
export function saveMeasurementLedger(records: readonly SttMeasurementRecord[]): boolean {
  try {
    const safe: SttMeasurementRecord[] = [];
    for (const r of Array.isArray(records) ? records : []) {
      if (safe.length >= STT_LEDGER_MAX) break;
      const clean = sanitizeMeasurementRecord(r);
      if (clean && clean.outcome !== 'cancelled') safe.push(clean);
    }
    const body: StoredLedger = { schemaVersion: STT_MEASUREMENT_SCHEMA_VERSION, records: safe };
    safeSetRaw(STT_LEDGER_STORAGE_KEY, JSON.stringify(body), 0, true);
    return true;
  } catch {
    return false;
  }
}

/** Defteri okur. Bozuk JSON / eski şema / eksik alan ASLA çökertmez → boş defter. */
export function loadMeasurementLedger(): SttMeasurementRecord[] {
  let raw: string | null;
  try {
    raw = safeGetRaw(STT_LEDGER_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const body = parsed as Record<string, unknown>;
  return sanitizeLedger(body['records']);
}

/** Kalıcı defteri tamamen siler. ASLA throw etmez. */
export function clearMeasurementLedgerStorage(): boolean {
  try {
    safeRemoveRaw(STT_LEDGER_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
