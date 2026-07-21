/**
 * gpsSource — GUARDIAN-AI-G12 (Provider Source Contracts).
 *
 * GPS kaynağı sözleşmesi — araç anlık hızı gibi konum/hareket verisini SAĞLAR.
 * GERÇEK IO YOK — bu fazda yalnız interface + raw tip. Gerçek Android/GPS API
 * implementasyonu KAPSAM DIŞI (ayrı faz). Kaynak Guardian KARARI ÜRETMEZ,
 * severity HESAPLAMAZ — yalnız raw okuma döndürür.
 *
 * `currentSpeedKph` bu fazın kesişen (cross-cutting) hız değeridir: provider
 * registry onu map kaynaklı curve/speed-limit/road-profile dilimlerine enjekte
 * eder (o dilimler kendi hızını taşımıyorsa).
 */

/** GPS'ten gelen raw okuma. Tüm alanlar opsiyonel (kaynak güvenilmez olabilir). */
export interface RawGpsData {
  /** Araç anlık hızı (km/s) — curve/speed-limit/road-profile için gereklidir. */
  currentSpeedKph?: number;
}

/** GPS kaynak sözleşmesi. `read()` senkron raw okuma döndürür; veri yoksa/hata
 *  durumunda `undefined` dönebilir VEYA throw edebilir (registry fail-soft ele
 *  alır — implementasyonun temiz olması ZORUNLU DEĞİL). */
export interface GpsSource {
  read(): RawGpsData | undefined;
}
