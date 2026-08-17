/**
 * recordsServerWriter.ts — BAKIM KAYITLARININ SUNUCUYA YAZILMA TEK OTORİTESİ.
 *
 * ── NEDEN AYRI DOSYA ──────────────────────────────────────────────────────
 * Aynı satırı iki yol yazar: (a) kullanıcı kaydı girdiği an (`recordsService`)
 * ve (b) çevrimdışı kuyruk sonradan gönderdiğinde (`offline/recordsSyncTransport`).
 * İkisi kendi INSERT'ini yazsaydı iki otorite olurdu — alan adı, `source`
 * değeri veya hata yorumu birinde değişip diğerinde değişmediğinde kusur
 * SESSİZ olurdu. Yazma burada TEK yerde durur.
 *
 * Ayrıca bu dosya **dairesel bağımlılığı kırar**: `recordsService` kuyruğa
 * yazmak için `fleetOffline`'ı, `fleetOffline` ise taşıyıcı için yazmayı
 * import eder. Yazma en alta indirilince zincir düz kalır:
 *   fleetOffline → recordsSyncTransport → recordsServerWriter
 *   recordsService → recordsServerWriter + fleetOffline
 *
 * ── DÜRÜSTLÜK KARARLARI ───────────────────────────────────────────────────
 *  · `23505` (unique_violation) **BAŞARIDIR**, hata değil. `client_ref`
 *    araç başına benzersizdir; ikinci gönderim satırın ZATEN sunucuda
 *    olduğunu kanıtlar. Kuyruk bunu hata sayarsa kayıt sonsuza dek
 *    "gönderilemedi" görünürdü — oysa veri yerinde.
 *  · Yeniden denenebilir ile KALICI hata AYRILIR. Ağ hatası tekrar denenir;
 *    RLS reddi / geçersiz veri tekrar denenmez (poison-item olur ve
 *    kullanıcı yanlış yere "bağlantı bekleniyor" sanır).
 *  · Bilinmeyen hata retryable sayılır ama `maxAttempts` sınırlıdır →
 *    sonsuz döngü yoktur, altıncı denemede PERMANENT_FAILED olur.
 */

import { supabaseBrowser, isSupabaseConfigured } from './supabase';
import type { FleetErrorCode } from './fleet/errors';

/** Sunucuya yazma sonucu — kuyruk taşıyıcısı bunu birebir kullanır. */
export type ServerWriteResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; retryable: true;  errorCode: FleetErrorCode | 'network_error' }
  | { ok: false; retryable: false; errorCode: FleetErrorCode };

export interface FuelLogPayload {
  vehicleId:  string;
  filledOn:   string;         // YYYY-MM-DD
  odometerKm: number | null;  // null = bilinmiyor (sahte 0 YOK)
  liters:     number;
  pricePerL:  number | null;
  clientRef:  string;
}

export interface ServiceRecordPayload {
  vehicleId:   string;
  serviceKey:  string;
  performedOn: string;
  odometerKm:  number | null;
  clientRef:   string;
}

/* ── Hata yorumu ──────────────────────────────────────────────────────────── */

/** PostgREST/Postgres hata kodu → kalıcı mı, hangi anlamda. */
function classifyPostgresError(code: string | undefined, message: string): ServerWriteResult {
  switch (code) {
    // Yetki / RLS reddi — tekrar denemek AYNI sonucu verir.
    case '42501':
    case 'PGRST301':
      return { ok: false, retryable: false, errorCode: 'permission_denied' };

    // Araç yok (FK) — araç silinmiş veya eşleşme kopmuş.
    case '23503':
      return { ok: false, retryable: false, errorCode: 'vehicle_not_found' };

    // CHECK ihlali / geçersiz gövde — veri düzelmeden tekrar denenmez.
    case '23514':
    case '22P02':
    case 'PGRST102':
      return { ok: false, retryable: false, errorCode: 'invalid_request' };

    // Tablo yok → migration 064 uygulanmamış. Tekrar denemek anlamsız
    // DEĞİLDİR (migration sonra uygulanabilir) ama sessiz kalmamalı.
    case '42P01':
      return { ok: false, retryable: true, errorCode: 'server_error' };

    default:
      break;
  }

  // Ağ katmanı — supabase-js bazen kodsuz mesajla döner.
  if (/fetch|network|timeout|Failed to fetch/i.test(message)) {
    return { ok: false, retryable: true, errorCode: 'network_error' };
  }
  return { ok: false, retryable: true, errorCode: 'server_error' };
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return '';
}

/* ── Yazıcılar ────────────────────────────────────────────────────────────── */

async function insertRow(
  table: 'vehicle_fuel_logs' | 'vehicle_service_records',
  row: Readonly<Record<string, unknown>>,
): Promise<ServerWriteResult> {
  if (!isSupabaseConfigured || !supabaseBrowser) {
    return { ok: false, retryable: false, errorCode: 'supabase_not_configured' };
  }

  try {
    const { error } = await supabaseBrowser.from(table).insert(row);
    if (!error) return { ok: true, duplicate: false };

    // ZATEN YAZILMIŞ — kuyruk aynı kaydı ikinci kez gönderdi. Bu başarıdır.
    if (readErrorCode(error) === '23505') return { ok: true, duplicate: true };

    return classifyPostgresError(readErrorCode(error), readErrorMessage(error));
  } catch (e) {
    // İstisna = taşıma katmanı düştü (çevrimdışı, DNS, iptal) → tekrar denenir.
    return classifyPostgresError(readErrorCode(e), readErrorMessage(e));
  }
}

export function pushFuelLog(payload: FuelLogPayload): Promise<ServerWriteResult> {
  return insertRow('vehicle_fuel_logs', {
    vehicle_id:      payload.vehicleId,
    filled_on:       payload.filledOn,
    odometer_km:     payload.odometerKm,   // null geçerlidir — sahte 0 YOK
    liters:          payload.liters,
    price_per_liter: payload.pricePerL,
    client_ref:      payload.clientRef,
  });
}

export function pushServiceRecord(payload: ServiceRecordPayload): Promise<ServerWriteResult> {
  return insertRow('vehicle_service_records', {
    vehicle_id:   payload.vehicleId,
    service_key:  payload.serviceKey,
    performed_on: payload.performedOn,
    odometer_km:  payload.odometerKm,
    client_ref:   payload.clientRef,
  });
}

/* ── Silme ────────────────────────────────────────────────────────────────
 *
 * Silme KUYRUĞA ALINMAZ ve bu bilinçli bir karardır: çevrimdışı "silindi"
 * göstermek, satır sunucuda dururken kullanıcıya gitmiş gibi göstermektir.
 * Geri alınamaz bir işlem için bu, tutulamayacak bir sözdür — bağlantı
 * yokken silme REDDEDİLİR ve gerekçesi söylenir.
 *
 * `vehicle_id` eşitliği RLS'e EK savunmadır: politika zaten erişimi tutar,
 * ama yanlış araç kimliğiyle gelen bir çağrı da satır bulamaz.
 */
async function deleteRow(
  table: 'vehicle_fuel_logs' | 'vehicle_service_records',
  vehicleId: string,
  rowId: string,
): Promise<ServerWriteResult> {
  if (!isSupabaseConfigured || !supabaseBrowser) {
    return { ok: false, retryable: false, errorCode: 'supabase_not_configured' };
  }
  try {
    const { error } = await supabaseBrowser
      .from(table).delete().eq('vehicle_id', vehicleId).eq('id', rowId);
    if (!error) return { ok: true, duplicate: false };
    return classifyPostgresError(readErrorCode(error), readErrorMessage(error));
  } catch (e) {
    return classifyPostgresError(readErrorCode(e), readErrorMessage(e));
  }
}

export function deleteFuelLog(vehicleId: string, rowId: string): Promise<ServerWriteResult> {
  return deleteRow('vehicle_fuel_logs', vehicleId, rowId);
}

export function deleteServiceRecord(vehicleId: string, rowId: string): Promise<ServerWriteResult> {
  return deleteRow('vehicle_service_records', vehicleId, rowId);
}

/* ── Güncelleme ────────────────────────────────────────────────────────────
 *
 * Silme ile AYNI politika: çevrimdışı düzenleme KUYRUĞA ALINMAZ. Gerekçe daha
 * da güçlüdür — güncelleme bir ÜST YAZMADIR (last-write-wins). Kuyrukta bekleyen
 * bir düzenleme, aradan geçen sürede başka bir cihazdan yapılmış değişikliği
 * sessizce ezerdi. Bağlantı yokken düzenleme REDDEDİLİR ve gerekçesi söylenir.
 *
 * `client_ref` DEĞİŞTİRİLMEZ: idempotency anahtarıdır, kaydın kimliğidir.
 * Güncellemede yeniden yazılırsa kuyruktaki eşleştirme ve çift-gönderim
 * koruması kopardı.
 */
async function updateRow(
  table:     'vehicle_fuel_logs' | 'vehicle_service_records',
  vehicleId: string,
  rowId:     string,
  patch:     Readonly<Record<string, unknown>>,
): Promise<ServerWriteResult> {
  if (!isSupabaseConfigured || !supabaseBrowser) {
    return { ok: false, retryable: false, errorCode: 'supabase_not_configured' };
  }
  try {
    const { data, error } = await supabaseBrowser
      .from(table).update(patch).eq('vehicle_id', vehicleId).eq('id', rowId).select('id');
    if (error) return classifyPostgresError(readErrorCode(error), readErrorMessage(error));

    /* RLS altında UPDATE, satır GÖRÜNMÜYORSA hata vermez — sıfır satır etkiler
       ve "başarılı" görünür (kütük #195'in dersi: PostgREST 200 ≠ satır etkilendi).
       Etkilenen satır yoksa güncelleme YAPILMAMIŞTIR; başarı İDDİA EDİLMEZ. */
    if (!Array.isArray(data) || data.length === 0) {
      return { ok: false, retryable: false, errorCode: 'permission_denied' };
    }
    return { ok: true, duplicate: false };
  } catch (e) {
    return classifyPostgresError(readErrorCode(e), readErrorMessage(e));
  }
}

/** Yakıt kaydının DEĞİŞTİRİLEBİLİR alanları (`client_ref` ve `vehicle_id` hariç). */
export type FuelLogPatch = Pick<FuelLogPayload, 'filledOn' | 'odometerKm' | 'liters' | 'pricePerL'>;

export function updateFuelLog(
  vehicleId: string, rowId: string, patch: FuelLogPatch,
): Promise<ServerWriteResult> {
  return updateRow('vehicle_fuel_logs', vehicleId, rowId, {
    filled_on:       patch.filledOn,
    odometer_km:     patch.odometerKm,   // null geçerlidir — sahte 0 YOK
    liters:          patch.liters,
    price_per_liter: patch.pricePerL,
  });
}

/** Servis kaydının değiştirilebilir alanları. Kalem anahtarı (`serviceKey`)
 *  değişmez: farklı bir kalem, farklı bir kayıttır. */
export type ServiceRecordPatch = Pick<ServiceRecordPayload, 'performedOn' | 'odometerKm'>;

export function updateServiceRecord(
  vehicleId: string, rowId: string, patch: ServiceRecordPatch,
): Promise<ServerWriteResult> {
  return updateRow('vehicle_service_records', vehicleId, rowId, {
    performed_on: patch.performedOn,
    odometer_km:  patch.odometerKm,
  });
}

/* ── Kuyruk payload'u ⇄ yazıcı sözleşmesi ────────────────────────────────── */

/**
 * Kuyruktan okunan gövdeyi doğrular. Kuyruk `localStorage`ta yaşar; elle
 * bozulmuş veya eski sürümden kalmış bir kaydı sunucuya göndermek yerine
 * REDDEDERİZ — yarım kayıt yazmaktansa kalıcı hata dürüsttür.
 */
export function parseFuelLogPayload(payload: Readonly<Record<string, unknown>>): FuelLogPayload | null {
  const vehicleId = payload.vehicleId;
  const filledOn  = payload.filledOn;
  const liters    = payload.liters;
  const clientRef = payload.clientRef;
  if (typeof vehicleId !== 'string' || vehicleId === '') return null;
  if (typeof filledOn  !== 'string' || filledOn  === '') return null;
  if (typeof clientRef !== 'string' || clientRef === '') return null;
  if (typeof liters !== 'number' || !Number.isFinite(liters) || liters <= 0) return null;

  const km    = payload.odometerKm;
  const price = payload.pricePerL;
  return {
    vehicleId,
    filledOn,
    odometerKm: typeof km    === 'number' && Number.isFinite(km)    ? km    : null,
    liters,
    pricePerL:  typeof price === 'number' && Number.isFinite(price) ? price : null,
    clientRef,
  };
}

export function parseServiceRecordPayload(
  payload: Readonly<Record<string, unknown>>,
): ServiceRecordPayload | null {
  const vehicleId   = payload.vehicleId;
  const serviceKey  = payload.serviceKey;
  const performedOn = payload.performedOn;
  const clientRef   = payload.clientRef;
  if (typeof vehicleId   !== 'string' || vehicleId   === '') return null;
  if (typeof serviceKey  !== 'string' || serviceKey  === '') return null;
  if (typeof performedOn !== 'string' || performedOn === '') return null;
  if (typeof clientRef   !== 'string' || clientRef   === '') return null;

  const km = payload.odometerKm;
  return {
    vehicleId,
    serviceKey,
    performedOn,
    odometerKm: typeof km === 'number' && Number.isFinite(km) ? km : null,
    clientRef,
  };
}
