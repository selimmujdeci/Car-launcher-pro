/**
 * securityWiring.ts — ARCH-05 bağlam okuyucularının TEK bağlama noktası.
 *
 * Güvenlik katmanı (`enforcement.ts`) hiçbir alan modülünü doğrudan import
 * ETMEZ: ederse hem açılış grafiği şişer hem de döngüsel bağımlılık riski
 * doğar. Bunun yerine okuyucular BURADA bir kez bağlanır (ARCH-01 wiring
 * deseniyle aynı). Bu dosya karar VERMEZ, eşik TANIMLAMAZ, değer TÜRETMEZ —
 * yalnız mevcut otoritelerin getter'larını güvenlik katmanına tanıtır.
 */

import { getCapabilityScope } from '../obd/capability/capabilityStore';
import { getObdSpeedFresh } from '../obdService';
import {
  WRITE_GATE_STOPPED_SPEED_KMH,
} from '../obd/writeGate';
import { bindSecurityContextReaders } from './enforcement';
import type { MotionClass } from './authorization';

/**
 * DOĞRULANMIŞ HAREKET SINIFI.
 *
 * ⚠️ İKİNCİ HAREKET OTORİTESİ KURULMADI: eşik `obd/writeGate`ten AYNEN
 * alınır ve tazelik kararı `obdService.getObdSpeedFresh()`e aittir (bayat
 * ölçüm `null` döner). GPS hızı bu yola GİREMEZ — GPS "araç duruyor" kanıtı
 * DEĞİLDİR (uydu kaybı, tünel, kapalı otopark hepsi sahte "0" üretir).
 *
 * `null` (ölçüm yok) → `UNKNOWN`. **UNKNOWN ASLA PARKED DEĞİLDİR.**
 */
function readVerifiedMotion(): MotionClass {
  let speed: number | null = null;
  try { speed = getObdSpeedFresh(); } catch { return 'UNKNOWN'; }
  if (speed === null || !Number.isFinite(speed) || speed < 0) return 'UNKNOWN';
  return speed < WRITE_GATE_STOPPED_SPEED_KMH ? 'PARKED' : 'MOVING';
}

/**
 * AKTİF ARAÇ KAPSAMI — `capabilityStore` tek sahiptir.
 *
 * Değer 16 hane parmak izidir (`isPersistableVehicleRef` kapısından geçmiş);
 * ham VIN yapısal olarak buraya GİREMEZ. Kimlik çözülmediyse `null` → araç
 * kapsamı gerektiren her yetki fail-closed reddedilir.
 */
function readVehicleRef(): string | null {
  try { return getCapabilityScope().vehicleRef; } catch { return null; }
}

let _bound = false;

/** Bağlamayı BİR KEZ yapar (yeniden çağrı zararsızdır). */
export function installSecurityContextReaders(): void {
  if (_bound) return;
  _bound = true;
  bindSecurityContextReaders({ vehicleRef: readVehicleRef, motion: readVerifiedMotion });
}

/** YALNIZ TEST — bağlama bayrağını sıfırlar. */
export function _resetSecurityWiringForTest(): void { _bound = false; }

installSecurityContextReaders();
