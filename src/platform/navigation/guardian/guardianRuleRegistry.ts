/**
 * Guardian Rule Registry — saf orkestratör — GUARDIAN-AI-G10.
 *
 * Guardian'ın TEK giriş noktası. Runtime artık kuralları TEK TEK çağırmaz;
 * yalnız `buildGuardianRuleResults(input)` çağrılır ve bu fonksiyon 8 saf kuralı
 * SABİT sırada çalıştırıp `GuardianRuleResult[]` döndürür.
 *
 * Bu orkestratör SAF bir toplayıcıdır — KARAR VERMEZ:
 *   - Hiçbir event'i FİLTRELEMEZ / DEĞİŞTİRMEZ / birleştirmez.
 *   - DEDUP YAPMAZ (dedup + sıralama + skor `guardianEngine.runGuardian`in işi —
 *     görev değişmedi; registry onun ÖNÜNDE, girdisini hazırlar).
 *   - Karar/eşik/severity üretmez (hepsi tek tek kurallarda, DI ile).
 *
 * SAF/deterministik/immutable/fail-closed; yalnız guardian modül-içi importlar
 * (`./models` tipleri + `./rules` saf değerlendiriciler). GPS/OBD/harita/hava/
 * Android/UI/Mavi/provider wiring YOK — tüm veri DI ile `input` üzerinden gelir.
 * Bu adım "tek kural = tek çağrı"dan "tek input → tüm kurallar → runGuardian"
 * boru hattına geçiştir; gerçek adapter wiring EN SON, ayrı faz.
 */
import type { GuardianRuleResult } from './models';
import {
  evaluateCurveRisk,
  evaluateSpeedLimitRisk,
  evaluateRoadProfileRisk,
  evaluateWeatherRisk,
  evaluateVehicleHealthRisk,
  evaluateRoadHazardRisk,
  evaluateDriverFatigueRisk,
  evaluateSpeedCameraRisk,
  type CurveRiskInput,
  type SpeedLimitRiskInput,
  type RoadProfileRiskInput,
  type WeatherRiskInput,
  type VehicleHealthRiskInput,
  type RoadHazardRiskInput,
  type DriverFatigueRiskInput,
  type SpeedCameraRiskInput,
} from './rules';

/* ── Sözleşme ─────────────────────────────────────────────────────────────── */

/**
 * Tüm Guardian kurallarının DI girdilerini TEK model altında toplar. Her alan
 * OPSİYONELDİR — bir alan `undefined` ise (bölüm eksik) ilgili kural
 * ÇALIŞTIRILMAZ (fail-closed; başka kurallar etkilenmez). Bir alan VERİLMİŞSE
 * (present) ilgili kurala AYNEN geçirilir; girdi geçerliliğini o kural doğrular
 * (bozuk bölüm → kuralın kendi `throw`u YAYILIR, registry gizlemez).
 */
export interface GuardianRuleRegistryInput {
  curve?:          CurveRiskInput;
  speedLimit?:     SpeedLimitRiskInput;
  roadProfile?:    RoadProfileRiskInput;
  weather?:        WeatherRiskInput;
  vehicleHealth?:  VehicleHealthRiskInput;
  roadHazard?:     RoadHazardRiskInput;
  driverFatigue?:  DriverFatigueRiskInput;
  speedCamera?:    SpeedCameraRiskInput;
}

/** SABİT çağrı/çıktı sırası — belgeleme + test için dışa verilir. Kod bu diziyi
 *  değil, aşağıdaki açık `if` zincirini kullanır (tip güvenliği için); ikisi
 *  AYNI sırayı taşır ve test bunu kilitler. */
export const GUARDIAN_RULE_REGISTRY_ORDER: readonly string[] = [
  'curve-risk',
  'speed-limit',
  'road-profile',
  'weather',
  'vehicle-health',
  'road-hazard',
  'driver-fatigue',
  'speed-camera',
];

/* ── Orkestratör ──────────────────────────────────────────────────────────── */

/**
 * TEK giriş noktası. `input` MUTASYONA UĞRATILMAZ (registry hiçbir alanı
 * değiştirmez; kurallar da girdilerini değiştirmez). Aynı input her zaman AYNI
 * çıktıyı verir — `Date.now`/`Math.random`/global durum YOK. Yalnız var olan
 * (present) bölümlerin `GuardianRuleResult`larını SABİT sırayla döndürür; boş
 * riskEvents üreten kuralın sonucu bile DAHİL EDİLİR (filtreleme YOK).
 */
export function buildGuardianRuleResults(input: GuardianRuleRegistryInput): GuardianRuleResult[] {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new RangeError('buildGuardianRuleResults: input bir nesne olmalı (null/dizi/primitive değil).');
  }

  const results: GuardianRuleResult[] = [];

  // SABİT sıra — her bölüm VARSA (present) ilgili kural çalışır; YOKSA atlanır.
  if (input.curve !== undefined)         results.push(evaluateCurveRisk(input.curve));
  if (input.speedLimit !== undefined)    results.push(evaluateSpeedLimitRisk(input.speedLimit));
  if (input.roadProfile !== undefined)   results.push(evaluateRoadProfileRisk(input.roadProfile));
  if (input.weather !== undefined)       results.push(evaluateWeatherRisk(input.weather));
  if (input.vehicleHealth !== undefined) results.push(evaluateVehicleHealthRisk(input.vehicleHealth));
  if (input.roadHazard !== undefined)    results.push(evaluateRoadHazardRisk(input.roadHazard));
  if (input.driverFatigue !== undefined) results.push(evaluateDriverFatigueRisk(input.driverFatigue));
  if (input.speedCamera !== undefined)   results.push(evaluateSpeedCameraRisk(input.speedCamera));

  return results;
}
