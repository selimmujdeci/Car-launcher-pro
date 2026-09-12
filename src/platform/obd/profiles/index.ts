/**
 * profiles/index — Patch 12D: profil kayıt defteri + ayar→servis bağlaması.
 *
 * 12A+B+C'de yazılan iki profil (`universalUdsProfile`, `renaultDaciaProfile`) hiçbir yerden
 * YÜKLENMİYORDU (manufacturerPidService.loadProfile çağıran yoktu → ölü kod). Bu modül:
 *  (1) kullanıcı ayarındaki kimlikle (`ManufacturerDidProfileId`) gerçek profil nesnesini eşler,
 *  (2) `syncManufacturerDidProfile` — React'siz, saf bağlama fonksiyonu: hook'lar/efektler
 *      bunu çağırır, kendisi de manufacturerPidService.loadProfile/unloadProfile'ı sarar.
 *
 * Neden 'none' varsayılan DEĞİL: `universal-uds` marka BAĞIMSIZ (ISO 14229-1 Annex C.1,
 * TÜM Mode 22 destekleyen ECU'larda beklenir) ve MALİ-400 sıfır-maliyet sözleşmesi
 * (manufacturerPidService: izleyici yokken zamanlayıcı kurulmaz) sayesinde profil yüklü
 * olması TEK BAŞINA hiçbir ek trafik/CPU yaratmaz — yalnız kullanıcı Sensör Panelini açar
 * veya sesli marka-verisi sorusu sorarsa DID sorgulanır. Bu yüzden varsayılan `universal-uds`:
 * boru hattının (native readObdDid → decode → sensorQueryService) uçtan uca kanıtı varsayılan
 * olarak devrede olur, ekstra kullanıcı adımı gerekmez. Kullanıcı ayarlardan 'none' seçip
 * marka verilerini tamamen kapatabilir.
 */
import type { VehicleDidProfile } from '../vehicleDidProfile';
import { loadProfile, unloadProfile } from '../manufacturerPidService';
import { universalUdsProfile, UNIVERSAL_UDS_SOURCE } from './universalUdsProfile';
import { renaultDaciaProfile, RENAULT_DACIA_SOURCE } from './renaultDaciaProfile';
import { renaultZoePh2Profile, RENAULT_ZOE_PH2_SOURCE } from './renaultZoePh2Profile';
import { renaultTraficKwpProfile, RENAULT_TRAFIC_KWP_SOURCE } from './renaultTraficKwpProfile';

export type ManufacturerDidProfileId =
  | 'none' | 'universal-uds' | 'renault-dacia' | 'renault-zoe-ph2' | 'renault-trafic-kwp';

/** UI seçici için sıralı liste — 'none' dahil değil (o ayrı "kapalı" seçeneği). */
export const MANUFACTURER_DID_PROFILES: Readonly<
  Record<Exclude<ManufacturerDidProfileId, 'none'>, VehicleDidProfile>
> = {
  'universal-uds': universalUdsProfile,
  'renault-dacia': renaultDaciaProfile,
  'renault-zoe-ph2': renaultZoePh2Profile,
  'renault-trafic-kwp': renaultTraficKwpProfile,
};

export const MANUFACTURER_DID_PROFILE_LABELS: Readonly<Record<ManufacturerDidProfileId, string>> = {
  none: 'Kapalı — marka verisi okunmaz',
  'universal-uds': universalUdsProfile.brand,
  'renault-dacia': renaultDaciaProfile.brand,
  'renault-zoe-ph2': renaultZoePh2Profile.brand,
  'renault-trafic-kwp': renaultTraficKwpProfile.brand,
};

export const MANUFACTURER_DID_PROFILE_SOURCES: Readonly<Record<Exclude<ManufacturerDidProfileId, 'none'>, string>> = {
  'universal-uds': UNIVERSAL_UDS_SOURCE,
  'renault-dacia': RENAULT_DACIA_SOURCE,
  'renault-zoe-ph2': RENAULT_ZOE_PH2_SOURCE,
  'renault-trafic-kwp': RENAULT_TRAFIC_KWP_SOURCE,
};

export interface ManufacturerDidProfileSyncResult {
  ok: boolean;
  /** Yalnız ok:false iken dolu — şema doğrulama hatası (bozuk profil YÜKLENMEDİ). */
  errors?: string[];
}

/**
 * Ayardaki profil kimliğini gerçek servise bağlar. React'siz saf fonksiyon — hem boot'ta
 * (persist edilmiş ayar) hem ayar değiştiğinde aynı yoldan çağrılır (tek kaynak, tutarlı
 * davranış). 'none' → unloadProfile (izlenen DID kalmaz, zamanlayıcı durur — zaten dururdu
 * çünkü profilsizken _watchedDids() boş döner, ama unloadProfile önceki profili de temizler).
 */
export function syncManufacturerDidProfile(id: ManufacturerDidProfileId): ManufacturerDidProfileSyncResult {
  if (id === 'none') {
    unloadProfile();
    return { ok: true };
  }
  const profile = MANUFACTURER_DID_PROFILES[id];
  const result = loadProfile(profile);
  return result.ok ? { ok: true } : { ok: false, errors: result.errors };
}
