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
  _selectedId = id;
  if (id === 'none') {
    unloadProfile();
    return { ok: true };
  }
  const base = MANUFACTURER_DID_PROFILES[id];
  // Otomatik öğrenilen (didLearning — saha korelasyonuyla KANITLI) DID'ler seçili profile
  // EKLENİR; aynı DID profilde varsa profil kazanır. Gösterim yolu TEKTİR (loadProfile).
  const profile: VehicleDidProfile = _learned.dids.length === 0 ? base : {
    ...base,
    ecus: [...base.ecus, ..._learned.ecus.filter((e) => !base.ecus.some((b) => b.id === e.id))],
    dids: [...base.dids, ..._learned.dids.filter((d) => !base.dids.some((b) => b.did === d.did))],
  };
  const result = loadProfile(profile);
  return result.ok ? { ok: true } : { ok: false, errors: result.errors };
}

/* ── Öğrenilen DID katmanı (didLearningEngine → buraya) ─────────────────── */
let _selectedId: ManufacturerDidProfileId | null = null;
let _learned: { ecus: VehicleDidProfile['ecus']; dids: VehicleDidProfile['dids'] } = { ecus: [], dids: [] };

/**
 * Kanıtlı öğrenilmiş DID'leri günceller ve seçili profili yeniden yükler. Kullanıcı
 * marka verisini KAPATTIYSA ('none') hiçbir şey yüklenmez — tercih ezilmez.
 */
export function setLearnedDidOverlay(fragment: { ecus: VehicleDidProfile['ecus']; dids: VehicleDidProfile['dids'] }): void {
  _learned = { ecus: [...fragment.ecus], dids: [...fragment.dids] };
  if (_selectedId !== null && _selectedId !== 'none') syncManufacturerDidProfile(_selectedId);
}

export function getLearnedDidOverlay(): { ecus: VehicleDidProfile['ecus']; dids: VehicleDidProfile['dids'] } {
  return _learned;
}
