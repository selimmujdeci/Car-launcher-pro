/**
 * currentLocationService — "Neredeyim?" için TEK okuma noktası.
 *
 * Saf çekirdeği (`currentLocationCore`) gerçek kaynaklara bağlar:
 *   konum  → `gpsService.getGPSState()`  (sahibi: UnifiedVehicleStore — yeni store AÇILMAZ)
 *   adres  → `geocodingService.reverseGeocode()` (mevcut Nominatim sağlayıcısı)
 *
 * SALT-OKUNUR: yeni GPS aboneliği/timer/watch açmaz, navigasyon başlatmaz, hiçbir şey yazmaz.
 * Portlar DI edilebilir (`CurrentLocationDeps`) → test gerçek ağ/GPS olmadan koşar.
 *
 * Reverse geocoding BAŞARISIZLIĞI hata DEĞİLDİR: koordinat geçerliyse cevap yine üretilir
 * (adres yerine koordinatla). Ağ yoksa hiç denenmez.
 */

import {
  classifyLocationFix,
  buildLocationAnswer,
  LOCATION_GEOCODE_BUDGET_MS,
  type LocationClassification,
  type LocationAnswer,
} from './currentLocationCore';

/** Konum kaynağı etiketi — `GPSState.source` ile aynı küme. */
export type LocationProvider = 'native' | 'web' | 'last_known' | 'default' | null;

export interface CurrentLocationReadout {
  /** Kullanıcıya sunulabilir bir konum cevabı üretilebildi mi. */
  readonly ok: boolean;
  /** Türkçe cevap cümlesi (ok=false ise dürüst "bilmiyorum" mesajı). */
  readonly text: string;
  readonly classification: LocationClassification;
  readonly answer: LocationAnswer;
  /** Yalnız ok=true iken dolu — çağıran bounded veri alanı üretebilsin diye. */
  readonly latitude?: number;
  readonly longitude?: number;
  readonly timestampMs?: number | null;
  readonly accuracyM?: number | null;
  readonly ageMs?: number | null;
  readonly provider: LocationProvider;
  /** Reverse geocoding sonucu (null = denenmedi ya da bulunamadı). */
  readonly address: string | null;
}

export interface GpsStateSnapshot {
  location: { latitude: number; longitude: number; accuracy: number; timestamp: number } | null;
  source: LocationProvider;
}

/** DI portları — varsayılanları gerçek servislerdir. */
export interface CurrentLocationDeps {
  readonly readGpsState?: () => GpsStateSnapshot | Promise<GpsStateSnapshot>;
  readonly reverseGeocode?: (lat: number, lng: number, timeoutMs: number) => Promise<string | null>;
  readonly nowMs?: () => number;
  /** Reverse geocoding toplam bütçesi (ms). */
  readonly geocodeTimeoutMs?: number;
}

/* ── Varsayılan portlar — TEMBEL (dinamik) import ──────────────────────────────
 *
 * `gpsService` (Capacitor Geolocation + store + dead-reckoning) ve `geocodingService`
 * (offline arama → SQLite/IndexedDB) AĞIR modüllerdir. Statik import edilirlerse Mavi'nin
 * Faz-1 tool allowlist'i (`maviTools`) onları boot modül grafiğine ÇEKER — ölçüldü:
 * `maviTools` import süresi 5 sn'i aştı (maviToolRouter testi timeout'a düştü).
 * Bu yüzden gerçek servisler YALNIZ eylem çalıştığında yüklenir. Sonuç aynı, graf hafif. */

async function defaultReadGpsState(): Promise<GpsStateSnapshot> {
  const { getGPSState } = await import('../gpsService');
  const s = getGPSState();
  return { location: s.location, source: s.source };
}

async function defaultReverseGeocode(lat: number, lng: number, timeoutMs: number): Promise<string | null> {
  const { reverseGeocode } = await import('../geocodingService');
  return reverseGeocode(lat, lng, timeoutMs);
}

/**
 * Mevcut konumu oku ve Türkçe cevaba çevir.
 *
 * Akış: GPS snapshot → sınıflandır → (yalnız kullanılabilir fix'te) reverse geocode →
 * cevap üret. Fix yoksa/geçersizse/çok eskiyse ağa HİÇ ÇIKILMAZ (boşuna istek yok).
 * Hiçbir koşulda throw etmez.
 */
export async function readCurrentLocation(
  deps: CurrentLocationDeps = {},
): Promise<CurrentLocationReadout> {
  const now = deps.nowMs ? deps.nowMs() : Date.now();

  let location: { latitude: number; longitude: number; accuracy: number; timestamp: number } | null = null;
  let provider: LocationProvider = null;

  try {
    const state = await (deps.readGpsState ? deps.readGpsState() : defaultReadGpsState());
    location = state?.location ?? null;
    provider = state?.source ?? null;
  } catch {
    location = null;                 // store okunamadı → fix yok (fail-soft, uydurma yok)
    provider = null;
  }

  const classification = classifyLocationFix(location, now);

  // Kullanılamaz fix → adres aranmaz (ağ israfı yok), dürüst "bilmiyorum" döner.
  if (classification.klass !== 'usable' && classification.klass !== 'aging') {
    const answer = buildLocationAnswer({ classification, address: null });
    return {
      ok: false, text: answer.text, classification, answer,
      provider, address: null,
    };
  }

  const fix = classification.fix!;
  const timeout = deps.geocodeTimeoutMs ?? LOCATION_GEOCODE_BUDGET_MS;
  const geocode = deps.reverseGeocode ?? defaultReverseGeocode;

  let address: string | null = null;
  try {
    address = await geocode(fix.latitude, fix.longitude, timeout);
  } catch {
    address = null;                  // sözleşme gereği olmamalı; yine de savunmacı
  }

  const answer = buildLocationAnswer({ classification, address });
  return {
    ok: answer.ok,
    text: answer.text,
    classification,
    answer,
    latitude:    fix.latitude,
    longitude:   fix.longitude,
    timestampMs: fix.timestampMs,
    accuracyM:   fix.accuracyM,
    ageMs:       fix.ageMs,
    provider,
    address,
  };
}
