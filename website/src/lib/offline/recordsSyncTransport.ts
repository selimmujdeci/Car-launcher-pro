/**
 * recordsSyncTransport.ts — BAKIM KAYITLARI İÇİN KUYRUK TAŞIYICISI.
 *
 * ── NEDEN AYRI TAŞIYICI ───────────────────────────────────────────────────
 * Filo işlemleri Next API rotalarına (`/api/company`, `/api/vehicle/link`)
 * gider; bakım kayıtları ise doğrudan Supabase'e yazılır çünkü tablolarının
 * RLS'i `authenticated` üzerinden zaten tenant güvenlidir (migration 064).
 * Kayıtlar için ayrıca bir API rotası açmak **ikinci bir yetki otoritesi**
 * kurardı: aynı erişim kuralı hem RLS'te hem rotada yaşar, biri değişip
 * diğeri değişmediğinde kusur sessiz olur. Bu yüzden yeni rota AÇILMADI —
 * yazma yolu ürünle AYNI (`recordsServerWriter`), yalnız zamanı ertelendi.
 *
 * Bilinmeyen/bozuk gövde KALICI hatadır: yarım kayıt yazmaktansa kuyrukta
 * "gönderilemedi" olarak durması dürüsttür (sessizce atılmaz).
 */

import type { QueueItem } from './types';
import type { SyncTransport, TransportResult } from './syncOrchestrator';
import {
  pushFuelLog,
  pushServiceRecord,
  parseFuelLogPayload,
  parseServiceRecordPayload,
  type ServerWriteResult,
} from '../recordsServerWriter';

/** Bu işlem türü bakım kaydı mı (taşıyıcı yönlendirmesi bunu kullanır). */
export function isRecordOperation(operationType: QueueItem['operationType']): boolean {
  return operationType === 'FUEL_LOG_ADD' || operationType === 'SERVICE_RECORD_ADD';
}

/** Yazma sonucunu kuyruk sözleşmesine çevirir. `duplicate` BAŞARIDIR. */
function toTransportResult(result: ServerWriteResult): TransportResult {
  if (result.ok) return { ok: true };
  return result.retryable
    ? { ok: false, retryable: true,  errorCode: result.errorCode }
    : { ok: false, retryable: false, errorCode: result.errorCode };
}

export class RecordsSyncTransport implements SyncTransport {
  async send(item: QueueItem): Promise<TransportResult> {
    if (item.operationType === 'FUEL_LOG_ADD') {
      const payload = parseFuelLogPayload(item.payload);
      if (!payload) return { ok: false, retryable: false, errorCode: 'invalid_request' };
      return toTransportResult(await pushFuelLog(payload));
    }

    if (item.operationType === 'SERVICE_RECORD_ADD') {
      const payload = parseServiceRecordPayload(item.payload);
      if (!payload) return { ok: false, retryable: false, errorCode: 'invalid_request' };
      return toTransportResult(await pushServiceRecord(payload));
    }

    // Bu taşıyıcıya ait olmayan işlem — yönlendirme hatası, sessizce yutulmaz.
    return { ok: false, retryable: false, errorCode: 'invalid_request' };
  }
}

/**
 * İki taşıyıcıyı tek sözleşme altında birleştirir: bakım kayıtları Supabase'e,
 * geri kalan her şey HTTP rotalarına. `SyncOrchestrator` tek taşıyıcı bilir —
 * yönlendirme burada, orkestratörün içinde DEĞİL (orkestratör işlem türüne
 * göre dallanmaya başlarsa taşıyıcı soyutlaması anlamını yitirir).
 */
export class CompositeSyncTransport implements SyncTransport {
  constructor(
    private readonly http:    SyncTransport,
    private readonly records: SyncTransport,
  ) {}

  send(item: QueueItem): Promise<TransportResult> {
    return isRecordOperation(item.operationType)
      ? this.records.send(item)
      : this.http.send(item);
  }
}
