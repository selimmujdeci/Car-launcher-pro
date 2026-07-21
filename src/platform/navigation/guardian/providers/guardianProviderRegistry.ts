/**
 * guardianProviderRegistry — GUARDIAN-AI-G12 (Provider Source Contracts).
 *
 * Provider katmanının TEK giriş noktası. DI ile verilen kaynakları okuyup G11
 * `GuardianRawPlatformData`sını ÜRETİR. Böylece TAM boru hattı:
 *   Provider Registry → GuardianRawPlatformData → Adapter Registry
 *   → GuardianRuleRegistryInput → Rule Registry → GuardianEngine.
 *
 * GERÇEK IO YOK — kaynaklar DI interface'i (Android/GPS/OBD/HTTP implementasyonu
 * KAPSAM DIŞI). KARAR VERMEZ / severity HESAPLAMAZ — yalnız okuma toplar + hız
 * enjeksiyonu yapar (composition).
 *
 * ── FAIL-SOFT (mutlak) ───────────────────────────────────────────────────────
 * Bir kaynağın `read()`i THROW etse VEYA nesne-olmayan bozuk çıktı verse bile
 * registry THROW ETMEZ — yalnız o bölüm `undefined` olur, diğer kaynaklar
 * çalışmaya devam eder. Kaynak yoksa (undefined) o bölüm de yok.
 *
 * ── HIZ ENJEKSİYONU (composition) ────────────────────────────────────────────
 * `currentSpeedKph` bu fazın kesişen değeridir ve GPS kaynağından gelir. Map
 * kaynaklı curve/speed-limit/road-profile dilimleri kendi hızlarını taşımıyorsa
 * GPS hızı bu dilimlere KOPYALANARAK enjekte edilir (orijinal map çıktısı MUTATE
 * EDİLMEZ — yeni nesne üretilir). Dilim kendi `currentSpeedKph`ini taşıyorsa GPS
 * onu EZMEZ.
 *
 * ── DETERMINISTIC ────────────────────────────────────────────────────────────
 * Bu saf composition `Date.now`/`Math.random`/global durum KULLANMAZ; aynı
 * kaynak çıktıları → aynı sonuç. (Gerçek kaynak implementasyonları elbette
 * zamana bağlıdır — o davranış kaynağın kendi işi, bu sözleşmenin değil.)
 */
import type { GuardianRawPlatformData } from '../adapters/guardianAdapterRegistry';
import type { GpsSource, RawGpsData } from './gpsSource';
import type { MapSource } from './mapSource';
import type { ObdSource } from './obdSource';
import type { WeatherSource } from './weatherSource';
import type { DriverSource } from './driverSource';

function isObject<T>(v: T): v is T & Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** DI ile verilen Guardian kaynakları — her biri opsiyonel (yoksa o bölüm yok). */
export interface GuardianProviderSources {
  gps?:      GpsSource;
  map?:      MapSource;
  obd?:      ObdSource;
  weather?:  WeatherSource;
  driver?:   DriverSource;
}

/** Bir kaynağı FAIL-SOFT okur: kaynak/`read` yoksa, throw ederse veya nesne
 *  olmayan çıktı verirse `undefined` döner (asla throw etmez). */
function safeRead<T>(source: { read(): T | undefined } | undefined): T | undefined {
  if (!source || typeof source.read !== 'function') return undefined;
  try {
    const value = source.read();
    return isObject(value) ? (value as T) : undefined;
  } catch {
    return undefined; // fail-soft: kaynak hatası Guardian'ı devirmez
  }
}

/** Bir map-kaynaklı dilime (curve/speed/roadProfile) GPS hızını enjekte eder —
 *  dilim kendi hızını taşımıyorsa. Orijinali MUTATE ETMEZ (yeni nesne). */
function withGpsSpeed<T extends { currentSpeedKph?: number }>(slice: T, gps: RawGpsData | undefined): T {
  if (isFiniteNumber(slice.currentSpeedKph)) return { ...slice };
  if (gps && isFiniteNumber(gps.currentSpeedKph)) return { ...slice, currentSpeedKph: gps.currentSpeedKph };
  return { ...slice };
}

export function buildGuardianRawPlatformData(sources: GuardianProviderSources | undefined): GuardianRawPlatformData {
  if (!isObject(sources)) return {};

  const gps     = safeRead<RawGpsData>(sources.gps);
  const map     = safeRead<import('./mapSource').RawMapData>(sources.map);
  const obd     = safeRead<import('../adapters/vehicleHealthAdapter').RawVehicleHealthData>(sources.obd);
  const weather = safeRead<import('../adapters/weatherAdapter').RawWeatherData>(sources.weather);
  const driver  = safeRead<import('../adapters/driverFatigueAdapter').RawDriverFatigueData>(sources.driver);

  const out: GuardianRawPlatformData = {};

  // Map-kaynaklı segmentler — curve/speed/roadProfile'a GPS hızı enjekte edilir.
  if (map !== undefined) {
    if (isObject(map.curve))       out.curve = withGpsSpeed(map.curve, gps);
    if (isObject(map.speedLimit))  out.speedLimit = withGpsSpeed(map.speedLimit, gps);
    if (isObject(map.roadProfile)) out.roadProfile = withGpsSpeed(map.roadProfile, gps);
    if (isObject(map.roadHazard))  out.roadHazard = map.roadHazard;    // hız gerekmez
    if (isObject(map.speedCamera)) out.speedCamera = map.speedCamera;  // hız gerekmez
  }

  if (obd !== undefined)     out.vehicleHealth = obd;
  if (weather !== undefined) out.weather = weather;
  if (driver !== undefined)  out.driverFatigue = driver;

  return out;
}
