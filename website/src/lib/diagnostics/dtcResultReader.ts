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
import {
  classifyDtcCommand,
  classifyVoltageCommand,
  type DtcCommandRow,
  type DtcOutcome,
  type VoltageOutcome,
} from './dtcResultContract';

/** Sonuç bu süreden eskiyse kullanıcıya "güncel değil" denir. */
export const DTC_RESULT_MAX_AGE_MS = 10 * 60_000;

/**
 * SAĞLIK KARTININ kabul ettiği en eski ölçüm (F2.2).
 *
 * Panelin 10 dakikası "az önce istediğim okuma" içindir. Sağlık kartı ise
 * kullanıcı uygulamayı açtığında GEÇMİŞ okumayı gösterir; 10 dakika orada
 * her şeyi "bilinmiyor" yapardı.
 *
 * Bu bir FİZİKSEL eşik değildir, GÜVEN penceresidir: üç hafta önceki "arıza
 * yok" okuması bugünün manşeti olamaz. Sınır içindeki ölçüm de yaşıyla
 * birlikte gösterilir — tazelik gizlenmez.
 */
export const DTC_HEALTH_MAX_AGE_MS = 24 * 60 * 60_000;

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

/**
 * DTC gövdesi yazan BAŞKA bir komutun (ör. `clear_dtc`) sonucu.
 *
 * ÖLÇÜLEN KUSUR (F2.2): `clear_dtc` doğrulaması da 410 tombstone'a
 * çarpıyordu; silme sonrası DOĞRULAMA OKUMASI hiç çalışmıyordu. Davranış
 * fail-closed olduğu için yalan üretmiyordu ("liste KORUNUR") ama "temizlendi"
 * hiçbir zaman kanıtlanamıyordu. Aynı kanonik yol buna da uygulanır.
 */
export async function readDtcOutcomeForType(
  commandId: string,
  vehicleId: string,
  expectedType: string,
  options: { maxAgeMs?: number; now?: number } = {},
): Promise<DtcOutcome> {
  const row = await readDtcCommandRow(commandId, vehicleId);
  return classifyDtcCommand({
    row,
    expectedVehicleId: vehicleId,
    expectedType,
    maxAgeMs: options.maxAgeMs ?? DTC_RESULT_MAX_AGE_MS,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}

/**
 * Bir aracın EN SON komut satırını türe göre okur (F2.2).
 *
 * Sağlık kartı yeni komut GÖNDERMEZ: kullanıcı uygulamayı açtığında aracın
 * daha önce yazdığı ölçümü okur. Yetki yine RLS'tedir — `vehicle_id` filtresi
 * yetki kaynağı değil, sorgu daraltmasıdır.
 *
 * `null` = okunamadı VEYA hiç okuma yapılmamış. İkisi de "arıza yok" DEĞİLDİR;
 * sınıflandırıcı ikisinden de sağlık iddiası üretmez.
 */
export async function readLatestCommandRow(
  vehicleId: string,
  type: string,
): Promise<DtcCommandRow | null> {
  if (!supabaseBrowser) return null;
  try {
    const { data, error } = await supabaseBrowser
      .from('vehicle_commands')
      .select(COLUMNS)
      .eq('vehicle_id', vehicleId)
      .eq('type', type)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as DtcCommandRow;
  } catch {
    return null;
  }
}

/**
 * Aracın EN SON teşhis okumasının durumu — sağlık kartının DTC kanıtı.
 *
 * Hiç okuma yapılmamışsa `null` döner. Bu bilinçlidir: "hiç taranmadı" ile
 * "tarandı, arıza çıkmadı" AYNI ŞEY DEĞİLDİR ve sağlık modeli bu ikisini
 * ayrı ele alır.
 */
export async function readLatestDtcOutcome(
  vehicleId: string,
  options: { maxAgeMs?: number; now?: number } = {},
): Promise<DtcOutcome | null> {
  const row = await readLatestCommandRow(vehicleId, 'read_dtc');
  if (!row) return null;
  return classifyDtcCommand({
    row,
    expectedVehicleId: vehicleId,
    expectedType: 'read_dtc',
    maxAgeMs: options.maxAgeMs ?? DTC_HEALTH_MAX_AGE_MS,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}

/**
 * Belirli bir `read_voltage` komutunun sonucu.
 *
 * F2.1 ile aynı kopuk halka voltajda da vardı: panel sonucu 410 tombstone'dan
 * istiyordu. Artık satır RLS ile okunur ve kanonik sözleşme yorumlar.
 */
export async function readVoltageOutcome(
  commandId: string,
  vehicleId: string,
  options: { maxAgeMs?: number; now?: number } = {},
): Promise<VoltageOutcome> {
  const row = await readDtcCommandRow(commandId, vehicleId);
  return classifyVoltageCommand({
    row,
    expectedVehicleId: vehicleId,
    expectedType: 'read_voltage',
    maxAgeMs: options.maxAgeMs ?? DTC_RESULT_MAX_AGE_MS,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}

/** Aracın EN SON voltaj ölçümü — sağlık kartının akü kanıtı. */
export async function readLatestVoltageOutcome(
  vehicleId: string,
  options: { maxAgeMs?: number; now?: number } = {},
): Promise<VoltageOutcome | null> {
  const row = await readLatestCommandRow(vehicleId, 'read_voltage');
  if (!row) return null;
  return classifyVoltageCommand({
    row,
    expectedVehicleId: vehicleId,
    expectedType: 'read_voltage',
    maxAgeMs: options.maxAgeMs ?? DTC_HEALTH_MAX_AGE_MS,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}
