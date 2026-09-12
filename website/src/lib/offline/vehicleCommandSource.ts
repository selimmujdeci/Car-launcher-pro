/**
 * vehicleCommandSource.ts — ARAÇ KOMUTLARI · TEK OKUMA KATMANI (SALT-OKUNUR).
 *
 * KURALLAR:
 *   · Hiçbir komut GÖNDERMEZ / güncellemez — yalnız okur.
 *   · Okuma başarısızsa `null` döner; sahte 0 ÜRETİLMEZ (çağıran UI
 *     "okunamadı" gösterir).
 *   · Ham `payload` ÇEKİLMEZ — yalnız `id`, `vehicle_id`, `status`.
 *
 * ⚠️ RLS SINIRI (dürüstlük notu): `vehicle_commands` üzerindeki
 * `user_select_commands` politikası `user_id = auth.uid()` şartı koşar.
 * Yani bu okuma **yalnız oturumdaki kullanıcının KENDİ gönderdiği** komutları
 * görür. Filo yöneticisi başka bir üyenin gönderdiği komutu göremez — UI bunu
 * "araçtaki tüm bekleyen komutlar" diye SUNMAMALIDIR.
 */

import { supabaseBrowser } from '../supabase';
import type { VehicleCommandRow } from './vehicleOfflineStatus';

/** Kaç komut geriye bakılacağı — kuyruk sınırsız taranmaz. */
const MAX_ROWS = 200;

/** Sonuçlanmış komutlar da gösterilir (VERIFIED/FAILED) ama sınırlı pencerede. */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

export interface VehicleCommandReading {
  /** vehicleId → komut satırları. Okuma başarısızsa `null`. */
  byVehicle: Readonly<Record<string, readonly VehicleCommandRow[]>> | null;
  readAt:    number;
}

/**
 * Verilen araçlar için komut satırlarını TEK sorguda okur.
 * Abonelik/timer KURMAZ — çağıran ekran açılışta ve elle yenilemede çağırır.
 */
export async function readVehicleCommands(
  vehicleIds: readonly string[],
  now: number,
): Promise<VehicleCommandReading> {
  if (vehicleIds.length === 0) {
    // Sorulacak araç yok → gerçek boş sonuç (okuma hatası DEĞİL).
    return { byVehicle: {}, readAt: now };
  }
  if (!supabaseBrowser) return { byVehicle: null, readAt: now };

  try {
    const since = new Date(now - LOOKBACK_MS).toISOString();
    const { data, error } = await supabaseBrowser
      .from('vehicle_commands')
      .select('id, vehicle_id, status')
      .in('vehicle_id', [...vehicleIds])
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS);

    if (error || !Array.isArray(data)) return { byVehicle: null, readAt: now };

    const byVehicle: Record<string, VehicleCommandRow[]> = {};
    for (const id of vehicleIds) byVehicle[id] = [];
    for (const row of data as { id: string; vehicle_id: string; status: string }[]) {
      const bucket = byVehicle[row.vehicle_id];
      if (bucket) bucket.push({ id: row.id, status: row.status });
    }
    return { byVehicle, readAt: now };
  } catch {
    return { byVehicle: null, readAt: now };
  }
}
