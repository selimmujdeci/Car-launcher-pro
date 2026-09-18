/**
 * DTC sonucunun TELEFON TARAFI OKUYUCUSU — ince adaptör.
 *
 * ── NEDEN DOĞRUDAN SUPABASE ──────────────────────────────────────────────
 * Eski yol `/api/pwa/dtc-result` idi; o uç `api_key` karşılaştırmasına
 * dayandığı için HİÇ çalışmadı ve bilinçli olarak 410 ile kapatıldı.
 * Tombstone'un kendi notu çözümü de söylüyordu: "oturumlu kullanıcı
 * `vehicle_commands` satırını RLS ile doğrudan okuyabilir."
 *
 * Yetki KONTROLÜ BURADA TAŞINMAZ — otorite veritabanındadır:
 *   SELECT "commands: okuyabilir" → is_vehicle_owner(vehicle_id)
 *                                   OR is_paired(auth.uid(), vehicle_id)
 * (production katalogdan doğrulandı, 2026-09-18). Yani `commandId` bilmek
 * YETMEZ; araç sahipliği şarttır. `vehicle_id` eşitliği ek bir bağ
 * doğrulamasıdır, yetki kaynağı değildir.
 *
 * Bu modül ikinci bir durum otoritesi KURMAZ: yalnız satırı okur, yorum
 * `dtcResultContract.classifyDtcCommand` içindedir.
 */

import { supabaseBrowser } from '@/lib/supabase';
import { classifyDtcCommand, type DtcCommandRow, type DtcOutcome } from './dtcResultContract';

/** Sonuç bu süreden eskiyse kullanıcıya "güncel değil" denir. */
export const DTC_RESULT_MAX_AGE_MS = 10 * 60_000;

/** Okunan kolonlar — fazlası istenmez (en az yetki ilkesi). */
const COLUMNS =
  'id,vehicle_id,type,status,result,error_message,created_at,finished_at';

/**
 * Komut satırını okur. Yetki yoksa RLS boş döndürür → `null`.
 *
 * `null` "sonuç yok" DEĞİL, "okunamadı"dır; çağıran bunu sonuç sanmamalıdır
 * (sözleşme `FAILED` üretir).
 */
export async function readDtcCommandRow(
  commandId: string,
  vehicleId: string,
): Promise<DtcCommandRow | null> {
  if (!supabaseBrowser) return null;
  try {
    const { data, error } = await supabaseBrowser
      .from('vehicle_commands')
      .select(COLUMNS)
      .eq('id', commandId)
      .eq('vehicle_id', vehicleId)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as DtcCommandRow;
  } catch {
    return null;
  }
}

/**
 * Satırı okur ve KANONİK yoruma verir.
 *
 * Telefon hiçbir DTC üretmez: `kind` ne olursa olsun karar aracın yazdığı
 * kayda dayanır. Okunamayan satır "arıza yok"a DÖNÜŞMEZ.
 */
export async function readDtcOutcome(
  commandId: string,
  vehicleId: string,
  options: { maxAgeMs?: number; now?: number } = {},
): Promise<DtcOutcome> {
  const row = await readDtcCommandRow(commandId, vehicleId);
  return classifyDtcCommand({
    row,
    expectedVehicleId: vehicleId,
    expectedType: 'read_dtc',
    maxAgeMs: options.maxAgeMs ?? DTC_RESULT_MAX_AGE_MS,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}
