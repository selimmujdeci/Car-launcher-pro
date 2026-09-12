/**
 * locationProvider.ts — ÇOK KAYNAKLI KONUM SÖZLEŞMESİ (SAF).
 *
 * ── NEDEN ─────────────────────────────────────────────────────────────
 * Bugün TEK konum kaynağı var: `gpsService` (Capacitor Geolocation veya
 * `navigator.geolocation`, `feedBackgroundLocation` ile native besleme).
 * O modül sahada doğrulanmış ağır işleri yapıyor (jump guard · DR fusion
 * ramp · heading blend · termal throttle · first-fix fallback · last-known
 * kalıcılığı) ve **DEĞİŞTİRİLMEZ**.
 *
 * Bu katman ONUN ÜSTÜNE oturur: `gpsService` artık YALNIZCA BİR sağlayıcıdır
 * (`HEAD_UNIT_GPS`). Harici GPS, Phone Hub ve Last-Known aynı sözleşmeyi
 * üretir; hangisinin konuşacağına ayrı bir hakem (arbiter) karar verir.
 *
 * ── OTORİTE SINIRLARI (BAĞLAYICI) ─────────────────────────────────────
 *   · Bu katman konum ÜRETMEZ, yalnız SINIFLANDIRIR ve SEÇER.
 *   · Kanıt yoksa `null` — "muhtemelen buradasın" tahmini YASAK.
 *   · Tek fix `HIGH` güven DEĞİLDİR (§4) — süreklilik kanıtı gerekir.
 *   · Bayat konum "canlı" olarak SUNULMAZ.
 *   · Sağlayıcı hatası konumu SESSİZCE kaybetmez; sayılır ve gösterilir.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · global durum YOK.
 */

/* ── Sağlayıcı kimlikleri ve öncelik ───────────────────────────────────── */

/**
 * Sağlayıcılar — **öncelik sırasıyla** (§3).
 *
 * `EXTERNAL_GPS` en üstte: harici modül (Bluetooth/USB/TCP) genellikle
 * head unit'in gömülü alıcısından daha iyi antene ve daha yüksek fix
 * oranına sahiptir. Bu tur harici sağlayıcı KAYIT ARAYÜZÜNÜ kurar; gerçek
 * taşıma (BT/USB/TCP) BU PAKETE DAHİL DEĞİLDİR.
 */
export const LOCATION_PROVIDERS = [
  'EXTERNAL_GPS',   // 1 — harici alıcı (gelecek taşıma; arayüz hazır)
  'HEAD_UNIT_GPS',  // 2 — mevcut `gpsService` (Capacitor / web / native besleme)
  'PHONE_HUB_GPS',  // 3 — telefon köprüsü (gelecek)
  'LAST_KNOWN',     // 4 — kalıcı son bilinen konum (ASLA canlı sayılmaz)
] as const;
export type LocationProviderId = (typeof LOCATION_PROVIDERS)[number];

/** Küçük sayı = yüksek öncelik. Bilinmeyen sağlayıcı en sona düşer. */
export const PROVIDER_PRIORITY: Readonly<Record<LocationProviderId, number>> = {
  EXTERNAL_GPS: 1,
  HEAD_UNIT_GPS: 2,
  PHONE_HUB_GPS: 3,
  LAST_KNOWN: 4,
};

export function providerPriority(id: LocationProviderId): number {
  return PROVIDER_PRIORITY[id] ?? Number.MAX_SAFE_INTEGER;
}

export function isLocationProviderId(raw: unknown): raw is LocationProviderId {
  return (LOCATION_PROVIDERS as readonly string[]).includes(String(raw));
}

/* ── Güven (§4) ────────────────────────────────────────────────────────── */

export const LOCATION_CONFIDENCES = [
  'VERY_HIGH',  // taze + hassas + süreklilik kanıtı
  'HIGH',       // taze + hassas, süreklilik kısmen
  'MEDIUM',     // taze ama hassasiyet zayıf VEYA tek fix
  'LOW',        // bayat veya çok kaba
  'UNKNOWN',    // kanıt yok / sınıflandırılamaz
] as const;
export type LocationConfidence = (typeof LOCATION_CONFIDENCES)[number];

/* ── Örnek (sample) ────────────────────────────────────────────────────── */

/**
 * Tek bir konum örneği. **Her sağlayıcı bu modeli üretir** (§2).
 *
 * Bilinmeyen alan `null`'dır — `0` DEĞİL. `accuracyM = 0` fiziksel olarak
 * anlamsızdır ve "bilinmiyor" demek için KULLANILAMAZ.
 */
export interface LocationSample {
  readonly latitude: number;
  readonly longitude: number;
  /** Yatay hassasiyet (m, 1σ). Bilinmiyorsa `null` — 0 veya 999 DEĞİL. */
  readonly accuracyM: number | null;
  /** Derece 0–360. Bilinmiyorsa `null` (durağan araçta GPS course null'dur). */
  readonly headingDeg: number | null;
  /** m/s. Bilinmiyorsa `null`. Ölçülen 0 GEÇERLİDİR. */
  readonly speedMps: number | null;
  /** Fix'in ÜRETİLDİĞİ an (epoch ms) — alındığı an değil. */
  readonly timestampMs: number;
  readonly provider: LocationProviderId;
  readonly confidence: LocationConfidence;
}

/** Sağlayıcının ham çıktısı — güven HAKEM tarafından atanır, sağlayıcı ATAMAZ. */
export type RawLocationSample = Omit<LocationSample, 'confidence'>;

/* ── Sağlayıcı arayüzü ─────────────────────────────────────────────────── */

/**
 * Sağlayıcının anlık durumu. Hakem bunu OKUR; sağlayıcıyı BAŞLATMAZ.
 *
 * `available=false` ile `sample=null` AYNI ŞEY DEĞİLDİR:
 *   · `available=false` → sağlayıcı yok/kapalı (ör. harici modül takılı değil)
 *   · `available=true, sample=null` → sağlayıcı var ama henüz fix YOK
 */
export interface LocationProviderStatus {
  readonly id: LocationProviderId;
  readonly available: boolean;
  readonly sample: RawLocationSample | null;
  /** Sağlayıcının bildirdiği hata sayısı (kümülatif). */
  readonly errorCount: number;
  /** Son hatanın SINIFI — ham hata metni TAŞINMAZ (gizlilik + gürültü). */
  readonly lastErrorKind: LocationErrorKind | null;
}

export const LOCATION_ERROR_KINDS = [
  'PERMISSION_DENIED',
  'POSITION_UNAVAILABLE',
  'TIMEOUT',
  'TRANSPORT_LOST',     // harici modül bağlantısı koptu
  'MALFORMED_FIX',      // koordinat/aralık doğrulaması düştü
  'UNKNOWN',
] as const;
export type LocationErrorKind = (typeof LOCATION_ERROR_KINDS)[number];

export function normalizeErrorKind(raw: unknown): LocationErrorKind {
  return (LOCATION_ERROR_KINDS as readonly string[]).includes(String(raw))
    ? (raw as LocationErrorKind)
    : 'UNKNOWN';
}

/* ── Doğrulama ─────────────────────────────────────────────────────────── */

export const LOCATION_LIMITS = {
  latitude:  { min: -90, max: 90 },
  longitude: { min: -180, max: 180 },
  headingDeg: { min: 0, max: 360 },
  /** 0 m hassasiyet fiziksel olarak imkânsız → reddedilir. */
  accuracyM: { min: 0.5, max: 10_000 },
  speedMps:  { min: 0, max: 120 },      // 432 km/h — araç için üst sınır
} as const;

function inRange(v: number, r: { min: number; max: number }): boolean {
  return Number.isFinite(v) && v >= r.min && v <= r.max;
}

/** Sayısal alan süzgeci — aralık dışı/NaN/Infinity → `null`. */
export function sanitizeField(
  value: unknown,
  key: keyof typeof LOCATION_LIMITS,
): number | null {
  if (typeof value !== 'number') return null;
  return inRange(value, LOCATION_LIMITS[key]) ? value : null;
}

export interface ProviderSampleInput {
  readonly latitude?: unknown;
  readonly longitude?: unknown;
  readonly accuracyM?: unknown;
  readonly headingDeg?: unknown;
  readonly speedMps?: unknown;
  readonly timestampMs?: unknown;
}

/**
 * Ham sağlayıcı çıktısını sözleşmeye çevirir.
 *
 * Koordinat geçersizse **TÜM örnek reddedilir** (`null`): yarım konum diye
 * bir şey yoktur. Yardımcı alanlar geçersizse yalnız o alan `null` olur.
 * `timestampMs` geçersizse örnek REDDEDİLİR — tazelik kurulamayan bir fix
 * "canlı" iddia edemez.
 */
export function buildRawSample(
  input: ProviderSampleInput,
  provider: LocationProviderId,
): RawLocationSample | null {
  const lat = sanitizeField(input.latitude, 'latitude');
  const lng = sanitizeField(input.longitude, 'longitude');
  if (lat === null || lng === null) return null;

  const ts = typeof input.timestampMs === 'number' && Number.isFinite(input.timestampMs)
    ? input.timestampMs : null;
  if (ts === null) return null;

  /* Hız `0` ÖLÇÜLEN değerdir; `null` bilinmiyordur. Ayrımı korumak için
     `speedMps` ayrı süzgeçten geçer (min 0 dahil). */
  const speed = typeof input.speedMps === 'number' && Number.isFinite(input.speedMps)
    && input.speedMps >= LOCATION_LIMITS.speedMps.min
    && input.speedMps <= LOCATION_LIMITS.speedMps.max
      ? input.speedMps : null;

  return {
    latitude: lat,
    longitude: lng,
    accuracyM: sanitizeField(input.accuracyM, 'accuracyM'),
    headingDeg: sanitizeField(input.headingDeg, 'headingDeg'),
    speedMps: speed,
    timestampMs: ts,
    provider,
  };
}
