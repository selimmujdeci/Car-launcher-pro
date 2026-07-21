/**
 * Nearby POI Navigation — "en yakın X" sesli komutları için merkezi,
 * genişletilebilir kategori kataloğu + tek dispatch giriş noktası.
 *
 * NAVIGATION-P0-2: "en yakın hastane" komutunu gerçek POI araması +
 * navigasyona bağlar. Çalışan FUEL deseni (addressNavigationEngine.
 * resolveAndNavigate + geocodingService.searchNearby, bkz. o dosyalar)
 * burada kategori bazlı bir kataloğa genelleştirilir — yeni bir "en yakın
 * X" kategorisi eklemek yalnızca NEARBY_POI_CATALOG'a bir satır eklemek
 * demektir; dağınık sentinel/magic-string YOK.
 *
 * ÖNEMLİ — mevcut fuel/parking çağrı yolu (useVoiceCommandHandler.ts'teki
 * legacy handler, satır ~281-294) BİLİNÇLİ OLARAK bu modülü kullanmaz;
 * doğrudan resolveAndNavigate(sentinel, gps) çağırır. O yol bu PR'da
 * DEĞİŞTİRİLMEDİ (regresyon riski). Bu modül şu an yalnız hastane için
 * (ve genel bir gelecekteki üçüncü kategori için) aktif kullanılıyor,
 * ama fuel/parking de aynı GPS fail-closed + dedupe + TTS sözleşmesinden
 * faydalanabilsin diye katalogda tam tanımlıdır.
 *
 * GPS fail-closed: konum yok VEYA geçersizse (0,0 / |lat|>90 / |lng|>180)
 * ARAMA YAPILMAZ — homeWorkNavigation.ts (dispatchHomeWorkNavigation) ile
 * BİREBİR aynı fail-closed sözleşmesi: sahte "aranıyor" TTS'i söylenmez,
 * yalnız bounded "konum yok" mesajı verilir.
 *
 * Dedupe: homeWorkNavigation.ts'teki DISPATCH_DEDUPE_MS deseni (1200ms)
 * yeniden kullanılır, ama AYRI bir anahtar uzayında (`nearby:${category}`)
 * — home/work dispatch'i VEYA farklı POI kategorileri birbirini bloklamaz.
 */
import { resolveAndNavigate, type AddressNavOutcome } from './addressNavigationEngine';
import { speakNavigation } from './ttsService';
import i18n from '../i18n/config';

/* ── Kategori kataloğu ───────────────────────────────────────────────── */

/** Aktif "en yakın X" kategorileri — yeni kategori eklemek için burayı genişlet. */
export type NearbyPoiCategory = 'fuel' | 'hospital';

export interface NearbyPoiDefinition {
  /** addressNavigationEngine.resolveAndNavigate'in tanıdığı özel sentinel değer. */
  sentinel: string;
  /** geocodingService.searchNearby amenity parametresi. */
  amenity: string;
  /** Overpass arama yarıçapı (metre). */
  radiusM: number;
  /** Arama başlarken söylenecek TTS i18n anahtarı. */
  successKey: string;
  /** Sonuç bulunamadığında söylenecek TTS i18n anahtarı. */
  notFoundKey: string;
  /** Ağ/arama hatasında söylenecek TTS i18n anahtarı. */
  errorKey: string;
  /** GPS yok/geçersizken söylenecek TTS i18n anahtarı. */
  gpsUnavailableKey: string;
}

// Sentinel'ler TEK yerde tanımlı — addressNavigationEngine.ts ve
// geocodingService.ts bu değerleri/amenity eşlemesini bilir, burası
// tüketici tarafın tek referans kaynağıdır.
export const NEARBY_POI_CATALOG: Record<NearbyPoiCategory, NearbyPoiDefinition> = {
  fuel: {
    sentinel:          '__nearby_gas__',
    amenity:           'fuel',
    radiusM:           5000,
    successKey:        'navigation.nearby_gas_starting',
    notFoundKey:       'navigation.nearby_gas_none',
    errorKey:          'navigation.nearby_gas_error',
    gpsUnavailableKey: 'navigation.nearby_gps_unavailable',
  },
  hospital: {
    sentinel:          '__nearby_hospital__',
    amenity:           'hospital',
    radiusM:           5000,
    successKey:        'navigation.nearby_hospital_starting',
    notFoundKey:       'navigation.nearby_hospital_none',
    errorKey:          'navigation.nearby_hospital_error',
    gpsUnavailableKey: 'navigation.nearby_gps_unavailable',
  },
};

/* ── GPS doğrulama (fail-closed) ─────────────────────────────────────── */

interface SimpleGps { lat: number; lng: number; }

/** 0,0 (Null Island) veya sınır-dışı koordinatları reddeder — homeWorkNavigation
 *  ve geocodingService.searchNearby ile AYNI kural seti. */
function isValidGps(gps: SimpleGps | undefined | null): gps is SimpleGps {
  if (!gps) return false;
  const { lat, lng } = gps;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return true;
}

/* ── Dispatch dedupe — homeWorkNavigation.ts ile aynı desen, ayrı anahtar uzayı ── */

// homeWorkNavigation.DISPATCH_DEDUPE_MS ile AYNI pencere (1200ms) — davranış
// tutarlılığı için tekrarlanır; iki modül birbirinden import ETMEZ (farklı
// anahtar uzayları, farklı state — kasıtlı ayrım, çapraz-bağımlılık YOK).
export const NEARBY_DISPATCH_DEDUPE_MS = 1200;

let _lastNearbyDispatchAt: Partial<Record<string, number>> = {};

/** Test-only: dedupe penceresini sıfırlar (testler arası sızıntıyı önler). */
export function _resetNearbyDispatchGuardForTests(): void {
  _lastNearbyDispatchAt = {};
}

/* ── Public API ───────────────────────────────────────────────────────── */

export type NearbyPoiDispatchReason = 'no_gps' | 'debounced';

export interface NearbyPoiDispatchResult {
  ok: boolean;
  reason?: NearbyPoiDispatchReason;
}

/**
 * TEK merkezi "en yakın X" dispatch giriş noktası.
 *
 * Akış: GPS doğrula (fail-closed) → dedupe kontrolü → başlangıç TTS'i →
 * resolveAndNavigate(sentinel, gps, onResult) — onResult sonucu göre
 * bounded "bulunamadı"/"hata" TTS'i söyler. startNavigation çağrısı
 * (tek sonuç halinde) resolveAndNavigate/_confirmResult içindedir —
 * burada TEKRARLANMAZ.
 */
export function dispatchNearbyPoiNavigation(
  category: NearbyPoiCategory,
  gps: SimpleGps | undefined | null,
  now: number = Date.now(),
): NearbyPoiDispatchResult {
  const def = NEARBY_POI_CATALOG[category];

  // 1) GPS fail-closed — konum yok/geçersizse ARAMA YAPILMAZ.
  if (!isValidGps(gps)) {
    speakNavigation(i18n.t(def.gpsUnavailableKey));
    return { ok: false, reason: 'no_gps' };
  }

  // 2) Dedupe — ayrı anahtar uzayı (`nearby:${category}`); home/work ve diğer
  //    POI kategorileri bu kategoriyi BLOKLAMAZ.
  const key  = `nearby:${category}`;
  const last = _lastNearbyDispatchAt[key];
  if (last !== undefined && now - last < NEARBY_DISPATCH_DEDUPE_MS) {
    return { ok: false, reason: 'debounced' };
  }
  _lastNearbyDispatchAt = { ..._lastNearbyDispatchAt, [key]: now };

  // 3) Başlangıç TTS'i + gerçek arama/navigasyon.
  speakNavigation(i18n.t(def.successKey));
  resolveAndNavigate(def.sentinel, gps, (outcome: AddressNavOutcome) => {
    if (outcome === 'empty') speakNavigation(i18n.t(def.notFoundKey));
    else if (outcome === 'error') speakNavigation(i18n.t(def.errorKey));
    // 'confirmed' / 'multiple' — resolveAndNavigate zaten UI state'ini günceller;
    // ek TTS gerekmiyor (confirmed rota başlar, multiple kullanıcı seçim kartı görür).
  });

  return { ok: true };
}
