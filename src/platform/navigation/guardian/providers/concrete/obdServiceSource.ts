/**
 * obdServiceSource — GUARDIAN-AI-G15 (Concrete OBD Source, pure factory).
 *
 * G12 `ObdSource` sözleşmesinin İLK GERÇEK implementasyonu: OBD servisinin sağlık
 * snapshot'ından `RawVehicleHealthData` üretir (curve/G14-GPS deseninin OBD
 * muadili). Bu DOSYA SAF/DI'dır — `obdService`'i ve store'u İMPORT ETMEZ (yalnız
 * tipler). Gerçek servise bağlanma `obdServiceHealthPort.ts`teki ayrı concrete
 * binding'de yapılır (o dosya obdService'i import eder → import-time yan etki
 * ORADA izole kalır; bu pure factory'de YOK).
 *
 * ── DESTEKLENEN SİNYALLER (yalnız gerçekten okunabilenler) ──────────────────
 * `OBDData` snapshot'ında RawVehicleHealthData'nın 6 sinyalinden yalnız 2'si
 * mevcuttur:
 *   - `coolantTemperatureC` ← `OBDData.engineTemp` (°C)
 *   - `batteryVoltage`      ← `OBDData.batteryVoltage` (V, PID 0x42)
 * Diğer 4 (`oilPressureKpa`, `brakeWarning`, `engineWarningLamp`/MIL,
 * `transmissionWarning`) OBDData'da YOKTUR → HER ZAMAN `undefined` (fail-soft;
 * uydurma YOK). Gelecekte MIL/DTC ayrı kaynaktan gelirse burada genişletilir.
 *
 * ── SENTINEL GÜVENLİĞİ (kritik) ─────────────────────────────────────────────
 * OBDData sözleşmesi: `-1 = desteklenmiyor/yok`, `undefined = henüz okunmadı`.
 * Bu değerler GERÇEK VERİ GİBİ TAŞINMAZ — `-1`/NaN/Inf/undefined olan bir sinyal
 * DROP edilir (RawVehicleHealthData'da undefined kalır). Böylece `-1 °C` /
 * `-1 V` gibi imkânsız değerler Guardian pipeline'ına ASLA girmez.
 *
 * ── FAIL-SOFT / ZERO-LEAK / DETERMINISTIC ───────────────────────────────────
 * Port throw / nesne-olmayan snapshot / hiç kullanılabilir sinyal yok / OBD
 * bağlı değil → `read()` `undefined` döner, ASLA throw etmez. PULL/snapshot —
 * timer/interval/listener EKLENMEZ (obdService kendi poll'unu yönetir; biz
 * yalnız son snapshot'ı okuruz). `Date.now`/`Math.random`/global YOK. Girdi
 * MUTASYONA UĞRATILMAZ; her `read()` YENİ nesne döndürür. Factory port'u OKUMAZ
 * (lazy) ve hiçbir yan etki üretmez.
 */
import type { VehicleHealthPolicyInput } from '../../rules';
import type { RawVehicleHealthData } from '../../adapters/vehicleHealthAdapter';
import type { ObdSource } from '../obdSource';

/* ── Port sözleşmesi (Guardian ↔ gerçek servis sınırı) ────────────────────── */

/** Gerçek OBD servisinden okunan, Guardian tarafına normalize edilmiş sağlık
 *  snapshot'ı. Alanlar opsiyonel; `-1`/NaN/Inf değerler "yok" sayılır (sentinel).
 *  İlerideki genişlemeler (MIL/DTC vs.) buraya EKLENİR — mevcut OBDData yalnız
 *  bu ikisini güvenilir sağlar. */
export interface ObdHealthSnapshot {
  /** Motor soğutma sıcaklığı (°C). `OBDData.engineTemp`. */
  engineTempC?:      number;
  /** 12V akü gerilimi (V). `OBDData.batteryVoltage`. */
  batteryVoltageV?:  number;
}

/** Guardian'ın bağlandığı küçük port — gerçek OBD servisini soyutlar. */
export interface ObdHealthPort {
  getLatestHealth(): ObdHealthSnapshot | undefined;
}

export interface ObdServiceSourceDependencies {
  port:    ObdHealthPort;
  /** DI konfigürasyonu — üretilen `RawVehicleHealthData.policy`ye eklenir
   *  (eşik + boolean severity haritaları; VehicleHealthRule bunu bekler). */
  policy:  VehicleHealthPolicyInput;
}

/* ── Sabitler ─────────────────────────────────────────────────────────────── */

/** OBDData "desteklenmiyor/yok" sentinel'i — gerçek değer gibi taşınmaz. */
const SENTINEL_UNAVAILABLE = -1;

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

function isObject<T>(v: T): v is T & Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Bir sağlık değeri KULLANILABİLİR mi: finite VE sentinel(-1) DEĞİL. */
function isUsable(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v !== SENTINEL_UNAVAILABLE;
}

/** Port'u FAIL-SOFT okur: port throw ederse / nesne-olmayan çıktı verirse
 *  `undefined` döner (asla throw etmez). */
function safeReadSnapshot(port: ObdHealthPort): ObdHealthSnapshot | undefined {
  let snapshot: ObdHealthSnapshot | undefined;
  try {
    snapshot = port.getLatestHealth();
  } catch {
    return undefined; // servis hatası Guardian'ı devirmez
  }
  return isObject(snapshot) ? snapshot : undefined;
}

/* ── Concrete source (pure factory) ───────────────────────────────────────── */

/**
 * Gerçek OBD servisine port üzerinden bağlı `ObdSource` üretir. Factory DI'yı
 * doğrular (wiring/programlama hatası → throw); üretilen `read()` ise HER ZAMAN
 * fail-soft'tur (undefined, asla throw). Factory port'u OKUMAZ (lazy), timer/
 * listener KURMAZ.
 */
export function createObdServiceSource(deps: ObdServiceSourceDependencies): ObdSource {
  if (!isObject(deps) || !deps.port || typeof deps.port.getLatestHealth !== 'function') {
    throw new RangeError('createObdServiceSource: geçerli bir port zorunludur (getLatestHealth fonksiyonu).');
  }
  if (!isObject(deps.policy)) {
    throw new RangeError('createObdServiceSource: policy (VehicleHealthPolicyInput) zorunludur.');
  }
  const { port, policy } = deps;

  return {
    read(): RawVehicleHealthData | undefined {
      const snapshot = safeReadSnapshot(port);
      if (snapshot === undefined) return undefined;

      // Yalnız GERÇEKTEN desteklenen 2 sinyal; sentinel/geçersiz → DROP.
      const out: RawVehicleHealthData = { policy };
      if (isUsable(snapshot.engineTempC))     out.coolantTemperatureC = snapshot.engineTempC;
      if (isUsable(snapshot.batteryVoltageV)) out.batteryVoltage = snapshot.batteryVoltageV;

      // Diğer 4 sinyal (oilPressure/brake/MIL/transmission) OBDData'da YOK →
      // bilinçli olarak HİÇ set edilmez (undefined kalır).

      // Hiç kullanılabilir sinyal yoksa → rapor edilecek bir şey yok (skip).
      if (out.coolantTemperatureC === undefined && out.batteryVoltage === undefined) {
        return undefined;
      }
      return out;
    },
  };
}
