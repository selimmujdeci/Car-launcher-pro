/**
 * presenceVehicleBinding.ts — PRESENCE DEFTERİNİN ARAÇ BAĞINI KURAR (P2).
 *
 * ── NEDEN AYRI DOSYA ───────────────────────────────────────────────────
 * `driverPresence.ts` karar katmanını (resolver) barındırır ve onun bağımlılık
 * grafiğine ağ/kimlik servisi SOKULMAZ: resolver'ı test etmek için bir
 * Supabase istemcisi yüklemek zorunda kalmak, o otoritenin saflığını fiilen
 * bitirirdi. Bu köprü bu yüzden AYRI durur ve TEK yönlüdür:
 *
 *     vehicleIdentityService  →  bindPresenceVehicle()
 *
 * ── BAĞIN OTORİTESİ ────────────────────────────────────────────────────
 * Araç kimliği **sunucunun verdiği araç kaydından** gelir
 * (`getVehicleIdentity()` → `register_vehicle` ile alınmış `vehicle_id`).
 * Gözlemin İÇİNDE gelen `vehicleId` bir İDDİADIR ve bağ kurmak için ASLA
 * kullanılmaz — kullanılsaydı istemci defteri istediği araca yazabilirdi.
 *
 * ── ŞU AN ÜRETİMDE ÇAĞIRAN YOK (bilinçli) ──────────────────────────────
 * Presence ÜRETEN bir kaynak yoktur (NFC/Bluetooth uygulanmadı, head unit
 * beyanı kanıt sayılmaz). Gerçek okuyucu bağlandığında sıra şudur:
 *   1. `syncPresenceVehicleBinding()` (bağ kurulur)
 *   2. okuyucu `driverPresenceStore.record(...)` çağırır
 * Bağ kurulmadan yazılan her gözlem REDDEDİLİR (fail-closed) — sessizce
 * "şu anki araç" varsayılmaz.
 *
 * Timer YOK · abonelik YOK · otomatik yeniden deneme YOK.
 */

import { getVehicleIdentity } from '../vehicleIdentityService';
import { bindPresenceVehicle } from './driverPresence';
import { bindAuthenticationVehicle } from './driverAuthentication';

export type PresenceBindingOutcome =
  | 'BOUND'            // doğrulanmış kimlik bulundu ve bağ kuruldu
  | 'NO_IDENTITY'      // cihaz henüz kaydedilmemiş → bağ YOK (fail-closed)
  | 'LOOKUP_FAILED';   // kimlik okunamadı → bağ DEĞİŞTİRİLMEDİ

/**
 * Doğrulanmış araç kimliğini okur ve deftere bağlar.
 *
 * Fail-soft: kimlik okunamazsa mevcut bağ KORUNUR (yanlışlıkla defteri
 * sıfırlamak, geçici bir ağ/depolama hatasından çok daha zararlıdır).
 * Kimlik YOKSA bağ kurulmaz — "bilinmiyorsa varsay" YAPILMAZ.
 */
export async function syncPresenceVehicleBinding(
  nowMs: number,
): Promise<PresenceBindingOutcome> {
  let identity: { vehicleId: string } | null = null;
  try {
    identity = await getVehicleIdentity();
  } catch {
    return 'LOOKUP_FAILED';
  }

  const vehicleId = identity?.vehicleId;
  if (typeof vehicleId !== 'string' || vehicleId.length === 0) return 'NO_IDENTITY';

  bindPresenceVehicle(vehicleId, nowMs);
  /* Kimlik doğrulama otoritesi AYNI bağa abonedir: iki katmanın farklı
     araçlara bağlı olması, "kimlik A aracında doğrulandı ama varlık B
     aracında gözlendi" gibi asla uzlaşmayacak bir duruma yol açardı. */
  bindAuthenticationVehicle(vehicleId);
  return 'BOUND';
}
