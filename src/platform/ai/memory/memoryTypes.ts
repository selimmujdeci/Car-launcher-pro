/**
 * memoryTypes — Mavi Memory Engine sözleşmeleri (SAĞLAYICI-BAĞIMSIZ).
 *
 * ⚠️ MEMORY ENGINE YENİ BİR DEPO DEĞİLDİR. Kalıcı hafızanın otoriteleri
 * kod tabanında ZATEN vardır ve KORUNUR:
 *   - Kullanıcı tercihleri → `companion/companionMemory` (safeStorage,
 *     `companion_memory_v1`, 15 fact × 120 karakter) — CANLI kullanılıyor.
 *   - Araç geçmişi        → `aiCore/vehicleMemory` (fingerprint-anahtarlı,
 *     güven pekiştirmeli, `car-vehicle-memory-v1`).
 * Bu motor onların ÜSTÜNDE bir OKUMA + POLİTİKA + GÜVENLİK katmanıdır:
 * kısa/uzun dönem ayrımı, hassas veri kapısı, görev politikası, bütçe ve
 * sağlayıcı-nötr enjeksiyon. Yazma yolları değişmez.
 *
 * Bu dosya IO İÇERMEZ.
 */

/**
 * KISA DÖNEM: yalnız RAM, süreç ömürlü (uygulama kapanınca kaybolur) — o anki
 * konuşmanın bağlamı. UZUN DÖNEM: kalıcı depodaki kullanıcı/araç bilgisi.
 */
export type MemoryScope = 'short_term' | 'long_term';

/** Hafıza kaydının kaynağı — kapalı küme (serbest metin DEĞİL). */
export type MemoryOrigin = 'user_preference' | 'vehicle_history' | 'session';

export interface MemoryRecord {
  readonly scope:  MemoryScope;
  readonly origin: MemoryOrigin;
  /** Hassas-veri kapısından GEÇMİŞ metin. */
  readonly text:   string;
  /** Unix ms — kayıt/gözlem anı (bilinmiyorsa 0). */
  readonly at:     number;
  /** 0..1 — yalnız araç geçmişinde anlamlı; yoksa tanımsız. */
  readonly confidence?: number;
}

export interface MemoryBudget {
  /** Azami taşınacak kayıt sayısı (toplam). */
  readonly maxRecords:      number;
  /** Uzun dönem kayıtların azami payı. */
  readonly maxLongTerm:     number;
  /** Kısa dönem kayıtların azami payı. */
  readonly maxShortTerm:    number;
  /** Serileştirilmiş bloğun azami karakter sayısı. */
  readonly maxChars:        number;
}

/** Bir görevde hangi hafıza türlerinin taşınacağı (ALLOWLIST). */
export interface MemoryTaskPolicy {
  readonly includeUserPreferences: boolean;
  readonly includeVehicleHistory:  boolean;
  readonly includeShortTerm:       boolean;
}

/** Okuma portları — motor somut depo modülü İMPORT ETMEZ (DI). */
export interface MemorySources {
  /** Kalıcı kullanıcı tercihleri (companionMemory). */
  readonly readUserPreferences?: () => readonly string[];
  /** Kalıcı araç geçmişi (vehicleMemory) — güvenli ifadeler. */
  readonly readVehicleHistory?:  () => readonly { readonly statement: string; readonly confidence?: number; readonly lastSeen?: number }[];
  /** Süreç-ömürlü kısa dönem kayıtlar. */
  readonly readShortTerm?:       () => readonly MemoryRecord[];
}

export interface MemoryBlock {
  /** Sisteme eklenecek metin; boşsa enjeksiyon YAPILMAZ. */
  readonly text:              string;
  readonly recordCount:       number;
  readonly longTermCount:     number;
  readonly shortTermCount:    number;
  /** Hassas-veri kapısından DÖNEN kayıt sayısı. */
  readonly rejectedCount:     number;
  /** Bütçe nedeniyle düşürülen kayıt sayısı. */
  readonly droppedCount:      number;
}

/**
 * ⚠️ TELEMETRİ SÖZLEŞMESİ: hafıza METNİ, kullanıcı mesajı, araç verisi veya
 * kimlik TAŞIYAN alan BULUNAMAZ — yalnız sayaçlar (yapısal testle kilitli).
 */
export interface MemoryTelemetry {
  readonly taskType:       string;
  readonly memoryEnabled:  boolean;
  readonly consentGranted: boolean;
  readonly recordCount:    number;
  readonly longTermCount:  number;
  readonly shortTermCount: number;
  readonly rejectedCount:  number;
  readonly droppedCount:   number;
  readonly outcome:        'injected' | 'empty' | 'disabled' | 'no_consent' | 'unavailable';
}
