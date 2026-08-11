/**
 * guardianVehicleHealthPolicy — GUARDIAN-AI-G16 · araç sağlığı eşik politikası.
 *
 * `vehicleHealthRule` bilinçli olarak GÖMÜLÜ SAYI TAŞIMAZ; eşikleri DI ile
 * bekler. Bu dosya o DI'yı üretir ve **her sayının kaynak otoritesini** yazar.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 *
 * ── İKİNCİ OTORİTE KURMAMA (pazarlıksız) ────────────────────────────────────
 * Aşırı ısınma ve düşük akü gerilimi için üründe ZATEN karar veren yerler var.
 * Guardian bu fazda onlarla YARIŞMAZ; aynı sayıları KULLANIR:
 *
 *   · soğutucu 105 °C  ← `VehicleCompute.worker.ts` `ENGINE_OVERHEAT_ON`
 *     (histerezis OFF eşiği 100 °C — o histerezis worker'ın işidir, Guardian
 *     kopyalamaz). `aiMechanic.ts` `COOLANT_OVERHEAT_C` de aynı sayıyı kullanır.
 *   · akü 12.0 V / 11.8 V ← `power/BatteryProtectionService.ts`
 *     `THRESH_WARN` / `THRESH_SLEEP`.
 *
 * Sayılar burada YENİDEN YAZILIYOR çünkü kaynak modüller onları dışa vermiyor
 * (`VehicleCompute.worker.ts` bir worker giriş noktasıdır — ana iş parçacığına
 * import edilemez). Sessiz ayrışmaya karşı `guardianTickPolicy.test.ts` içindeki
 * **parite testi** kaynak dosyaları okuyup eşitliği KİLİTLER.
 *
 * ── ERİŞİLEMEZ EŞİKLER (dürüstlük notu) ─────────────────────────────────────
 * `oilPressureKpa`, `brakeWarning`, `engineWarningLamp`, `transmissionWarning`
 * sinyalleri bugün HİÇBİR kaynaktan gelmiyor (`obdServiceSource` yalnız
 * soğutucu + akü üretir; `OBDData`da diğerleri YOK). Kural yine de bu alanları
 * doğrular, bu yüzden geçerli değer vermek ZORUNLUDUR. Aşağıdaki değerler
 * **kuralın doğrulama kapısını geçmek içindir ve bir OTORİTE İDDİASI DEĞİLDİR** —
 * sinyal bağlanmadan hiçbir olay üretemezler. Test bunu kilitler.
 */

import type { VehicleHealthPolicyInput } from '../rules';

/* ── Kaynağı olan eşikler ────────────────────────────────────────────────── */

/** `VehicleCompute.worker.ts` `ENGINE_OVERHEAT_ON` ile PARİTE (°C). */
export const GUARDIAN_COOLANT_CRITICAL_C = 105;
/**
 * "Yükseliyor" bandı (°C). Worker'ın histerezis KAPANIŞ eşiği (100 °C) ile
 * aynı sayıdır: worker için "artık aşırı ısınma değil" sınırı, Guardian için
 * "artık normal değil" sınırıdır. Yeni bir sayı UYDURULMADI.
 */
export const GUARDIAN_COOLANT_HIGH_C = 100;

/** `BatteryProtectionService.THRESH_WARN` ile PARİTE (V). */
export const GUARDIAN_BATTERY_LOW_V = 12.0;
/** `BatteryProtectionService.THRESH_SLEEP` ile PARİTE (V). */
export const GUARDIAN_BATTERY_CRITICAL_V = 11.8;

/* ── Erişilemez eşikler (sinyal kaynağı YOK) ─────────────────────────────── */

/** ERİŞİLEMEZ — `oilPressureKpa` üreten kaynak yok. Otorite iddiası DEĞİL. */
export const GUARDIAN_OIL_PRESSURE_LOW_KPA = 100;
/** ERİŞİLEMEZ — `oilPressureKpa` üreten kaynak yok. Otorite iddiası DEĞİL. */
export const GUARDIAN_OIL_PRESSURE_CRITICAL_KPA = 50;

/**
 * OBD ölçümünün güveni. Doğrudan ölçümdür (tahmin değil) ama telemetri
 * aftermarket ve güvenilmezdir (zero-trust) → kuralın kendi varsayılanı olan
 * 0.9 AYNEN korunur; Guardian burada daha iyimser bir sayı UYDURMAZ.
 */
export const GUARDIAN_HEALTH_SIGNAL_CONFIDENCE = 0.9;

/* ── DI politikası ───────────────────────────────────────────────────────── */

/**
 * `createObdServiceSource`a verilen donmuş politika. Donmuştur çünkü tick
 * gövdesinde her koşumda YENİDEN KURULMAZ (zero-allocation hot-path) ve
 * yanlışlıkla mutasyona uğrayamaz.
 */
export const GUARDIAN_VEHICLE_HEALTH_POLICY: VehicleHealthPolicyInput = Object.freeze({
  thresholds: Object.freeze({
    coolant: Object.freeze({
      high:     GUARDIAN_COOLANT_HIGH_C,
      critical: GUARDIAN_COOLANT_CRITICAL_C,
    }),
    oilPressure: Object.freeze({
      low:      GUARDIAN_OIL_PRESSURE_LOW_KPA,
      critical: GUARDIAN_OIL_PRESSURE_CRITICAL_KPA,
    }),
    batteryVoltage: Object.freeze({
      low:      GUARDIAN_BATTERY_LOW_V,
      critical: GUARDIAN_BATTERY_CRITICAL_V,
    }),
  }),
  booleanSeverities: Object.freeze({
    /* Üçü de ERİŞİLEMEZ (sinyal kaynağı yok) — bkz. dosya başlığı. */
    brakeWarning:        'CRITICAL',
    engineWarningLamp:   'HIGH',
    transmissionWarning: 'HIGH',
  }),
  signalConfidence: GUARDIAN_HEALTH_SIGNAL_CONFIDENCE,
}) as VehicleHealthPolicyInput;
