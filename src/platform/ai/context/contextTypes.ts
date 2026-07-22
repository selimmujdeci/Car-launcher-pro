/**
 * contextTypes — Mavi Context Engine sözleşmeleri (SAĞLAYICI-BAĞIMSIZ).
 *
 * Araç bağlamının TİPLİ, sınırlı ve güncellik-bilgili gösterimi. Bu dosya IO
 * İÇERMEZ; sağlayıcıya (OpenRouter/Gemini) ait hiçbir kavram GEÇMEZ.
 *
 * ── BU FAZDA BİLİNÇLİ OLARAK YOK ────────────────────────────────────────────
 *  - `make/model/year`: kod tabanında GÜVENİLİR OTORİTE YOK. `VehicleProfile.name`
 *    kullanıcının yazdığı SERBEST METİNDİR (prompt injection yüzeyi) → alınmaz.
 *    Yalnız `vehicleType` (kapalı enum) taşınır.
 *  - `milOn`: OBDData'da MIL/Check-Engine alanı YOK; DTC sayısı MIL'in yerine
 *    GEÇMEZ → uydurulmaz.
 *  - VIN / plaka / tam GPS koordinatı / kullanıcı kimliği: ASLA.
 *  - Hava durumu: bu fazda ağ çağrısı yok → alınmaz.
 */

/** Bir ölçümün güncellik sınıfı. `unknown` = zaman damgası yok/geçersiz. */
export type ContextFreshness = 'fresh' | 'stale' | 'unknown';

/**
 * Tek bir canlı değer. Değer ASLA zaman damgasız taşınmaz; eksik veri `0`/`false`
 * ile DOLDURULMAZ (alan tamamen atlanır).
 */
export interface ContextValue<T> {
  readonly value:      T;
  /** Unix ms — ölçümün gözlendiği an. */
  readonly observedAt: number;
  readonly freshness:  ContextFreshness;
  /** Veriyi üreten otorite (kapalı küme — serbest metin DEĞİL). */
  readonly source:     ContextSource;
}

/** Bilinen veri otoriteleri — allowlist (serializer yalnız bunları yazar). */
export type ContextSource = 'obd' | 'dtc' | 'obd_session';

/** Bağlantı/veri kaynağı sağlığı. */
export type ContextSourceHealth = 'healthy' | 'degraded' | 'unavailable';

export interface MaviVehicleContext {
  readonly schemaVersion: 1;
  readonly generatedAt:   number;
  readonly vehicle: {
    readonly connected: boolean;
    /**
     * `mock` → veri SİMÜLASYONDUR. Serializer bunu AÇIKÇA belirtir; gerçek araç
     * gerçeği gibi sunulmaz.
     */
    readonly dataOrigin?: 'real' | 'mock';
    readonly identity?: {
      /** Kapalı enum (ice/diesel/hybrid/phev/ev…). Serbest metin YOK. */
      readonly vehicleType?: string;
    };
    readonly session?: {
      /** Allowlist'ten geçmiş protokol sınıfı (ör. CAN/KWP/ISO/J1850). */
      readonly protocolClass?:        string;
      readonly sourceHealth?:         ContextSourceHealth;
      /** Allowlist'ten geçmiş hata KODU — serbest metin değil. */
      readonly lastDisconnectReason?: string;
    };
    readonly live?: {
      readonly rpm?:            ContextValue<number>;
      readonly speedKph?:       ContextValue<number>;
      readonly coolantC?:       ContextValue<number>;
      readonly fuelPercent?:    ContextValue<number>;
      readonly batteryVoltage?: ContextValue<number>;
    };
    readonly diagnostics?: {
      readonly dtcCount?:      ContextValue<number>;
      /** BOUNDED kod listesi — biçim doğrulamasından geçmiş, açıklama metni YOK. */
      readonly boundedCodes?:  readonly string[];
    };
  };
}

/* ── Bütçe ─────────────────────────────────────────────────────────────────── */

export interface ContextBudget {
  /** Azami taşınacak alan sayısı (canlı değer + tanı + oturum alanları). */
  readonly maxFields:      number;
  /** Azami DTC kodu. */
  readonly maxDtcCodes:    number;
  /** Serileştirilmiş metnin azami karakter sayısı (yaklaşık token vekili). */
  readonly maxChars:       number;
  /** Azami kaynak sayısı. */
  readonly maxSources:     number;
}

/** Bütçe aşımında hangi alanın önce düşeceğini belirleyen öncelik (küçük = önemli). */
export type ContextFieldPriority = number;

/* ── İzin (consent) ────────────────────────────────────────────────────────── */

/**
 * `off` → hiç bağlam üretilmez. `vehicle_context` → araç bağlamı serbest.
 * Konum izni bu fazda YOK (ileride ayrı seviye).
 */
export type ContextConsentLevel = 'off' | 'vehicle_context';

/* ── Telemetri (YALNIZ güvenli metadata) ──────────────────────────────────── */

/**
 * ⚠️ SÖZLEŞME: canlı değer, DTC kodu, VIN/fingerprint, GPS, kullanıcı mesajı,
 * AI cevabı veya ham bağlam metni TAŞIYAN alan BULUNAMAZ (yapısal testle kilitli).
 */
export interface ContextTelemetry {
  readonly taskType:            string;
  readonly contextEnabled:      boolean;
  readonly consentGranted:      boolean;
  readonly contextFieldCount:   number;
  readonly staleFieldCount:     number;
  readonly droppedFieldCount:   number;
  readonly collectionDurationMs: number;
  readonly contextSourceCount:  number;
  readonly contextOutcome:      'injected' | 'empty' | 'disabled' | 'no_consent' | 'unavailable';
}
