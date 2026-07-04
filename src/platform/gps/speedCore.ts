import { _haversineMeters, _bearingDeg } from './gpsMath';

/** Course-delta için minimum yer değiştirme (metre). Bunun altında GPS jitter'ı
 *  yön üretir → park/durağan halde harita döner. ~4m: 1Hz'de ~14 km/h üstü hareket. */
export const COURSE_DELTA_MIN_M = 4;

/** Durağan araç jitter bastırma eşiği (km/h) — altındaki değerler 0 sayılır.
 *  0.8 km/h: trafik sürünmesi Doppler'den geçer; park/otopark GPS kaymasını bastırır. */
export const GPS_SPEED_DEADZONE_KMH = 0.8;
/** Bu süreden eski GPS fix'inden gelen hız kabul edilmez */
export const GPS_SPEED_MAX_AGE_MS   = 4000;
/** GPS Doppler spike / uydu lock jitter: bu değerin üstü fiziksel olarak imkansız */
export const GPS_SPEED_MAX_KMH      = 280;

/**
 * Ham GPS hızına deadzone + stale + spike filtresi uygular.
 * EMA kasıtlı olarak yok — Doppler hızı donanım seviyesinde filtreli;
 * yazılım EMA sadece gecikme ekler.
 *
 * @param rawSpeedMs Ham hız m/s (GPS Doppler veya delta hesabı)
 * @param dataAgeMs  Timestamp yaşı ms — GPS fix'in ne kadar eski olduğu
 * @returns Filtrelenmiş hız m/s, veya undefined (stale / spike)
 */
export function applySpeedFilters(
  rawSpeedMs: number,
  dataAgeMs: number,
): number | undefined {
  if (dataAgeMs > GPS_SPEED_MAX_AGE_MS) return undefined;

  const rawKmh = rawSpeedMs * 3.6;
  if (rawKmh > GPS_SPEED_MAX_KMH) return undefined;

  // Deadzone: durağan araç jitter'ı bastır, ama 0'a HEMEN düş (EMA yok)
  return (rawKmh < GPS_SPEED_DEADZONE_KMH ? 0 : rawKmh) / 3.6;
}

export interface PrevPosition {
  lat: number;
  lng: number;
  ts: number;
}

/**
 * İki konum arasındaki hızı Haversine delta ile hesaplar.
 * Tamamen saf — state mutasyonu yok; çağıran _prevForSpeed'i yönetir.
 *
 * @param lat   Mevcut enlem
 * @param lng   Mevcut boylam
 * @param ts    Mevcut timestamp (ms, genellikle Date.now())
 * @param prev  Bir önceki konum kaydı; ilk çağrıda null
 * @returns Hız m/s veya undefined (yetersiz dt veya ilk fix)
 */
export function computeSpeedDelta(
  lat: number,
  lng: number,
  ts: number,
  prev: PrevPosition | null,
): number | undefined {
  if (!prev) return undefined;
  const dt = (ts - prev.ts) / 1000; // saniye
  if (dt < 0.5 || dt > 10) return undefined;
  const distM = _haversineMeters(prev.lat, prev.lng, lat, lng);
  if (!Number.isFinite(distM)) return undefined;
  return distM / dt; // m/s
}

/** Doppler hızına güvenmek için alt eşik (m/s). Bazı GPS çipleri/WebView'ler
 *  hareket halindeyken bile coords.speed=0 bildirir ("Doppler'e saplanma") —
 *  0 finite olduğu için eski `gpsSpeed ?? delta` fallback'i HİÇ devreye girmiyordu. */
export const DOPPLER_TRUST_MIN_MS = 0.15;

/**
 * Ham hız seçimi — SAHA FIX (2026-07-04, "harita ters gidiyor + takip etmiyor"):
 * cihaz Doppler hızını 0'a saplarsa tüm hareket tespiti (sürüş görünümü,
 * kamera takibi, rAF uyandırma) ölüyordu. Kural: Doppler > eşik ise ona güven;
 * aksi halde konum-delta hızı (varsa) kullan; o da yoksa Doppler'i aynen döndür
 * (0 = gerçekten durağan senaryosu bozulmaz — delta da 0'a yakın çıkar).
 */
export function pickRawSpeed(
  dopplerMs: number | undefined,
  deltaMs: number | undefined,
): number | undefined {
  if (dopplerMs != null && Number.isFinite(dopplerMs) && dopplerMs > DOPPLER_TRUST_MIN_MS) {
    return dopplerMs;
  }
  if (deltaMs != null && Number.isFinite(deltaMs)) return deltaMs;
  return dopplerMs;
}

/**
 * GPS, bearing (coords.heading) sağlamadığında konum farkından "course over ground"
 * yönü hesaplar. Head unit'lerde pusula (manyetometre) yoktur ve bazı GPS modülleri
 * heading vermez → yön bu fallback olmadan null/0 (kuzey) kalır ve harita YANLIŞ
 * (ters) yöne döner. Yalnız yeterli yer değiştirme varsa döner (jitter koruması).
 *
 * @returns Yön (0–360°) veya null (ilk fix / yetersiz hareket / geçersiz dt)
 */
export function computeCourseDelta(
  lat: number,
  lng: number,
  prev: PrevPosition | null,
): number | null {
  if (!prev) return null;
  const distM = _haversineMeters(prev.lat, prev.lng, lat, lng);
  if (!Number.isFinite(distM) || distM < COURSE_DELTA_MIN_M) return null;
  return _bearingDeg(prev.lat, prev.lng, lat, lng);
}
