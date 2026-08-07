/**
 * maviVehicleSnapshotSource — Mavi araç bağlamının TEK canlı okuma adaptörü.
 * (MAVI-M2-VEHICLE-CONTEXT)
 *
 * ── NEDEN AYRI DOSYA ────────────────────────────────────────────────────────
 * `maviVehicleContext` SAF kalmalıdır: `voiceService` onu statik import eder ve o
 * grafiğe `obdService` gibi MODÜL-SEVİYESİ YAN ETKİLİ bir servis girerse (obdService
 * import anında `onPerformanceModeChange` aboneliği kurar) hem test grafiği hem
 * boot maliyeti kirlenir. Bu yüzden `assistantSafetyKernel`in kendi desenine
 * uyulur: **saf fonksiyonlar bir dosyada, canlı kaynakları okuyan TEK adaptör
 * ayrı dosyada.** Bu modülü YALNIZ composition root (`platformCoreMaviVoiceWiring`)
 * import eder.
 *
 * ── SINIRLAR ────────────────────────────────────────────────────────────────
 *  · YENİ araç-state / poll / timer / abonelik ÜRETMEZ — yalnız senkron okuma.
 *  · Her kaynak AYRI try/catch → biri düşerse diğerleri ve komut akışı ETKİLENMEZ;
 *    düşen kaynak `unknown` üretir (sahte değer YOK).
 *  · Provider pull YOK: `deepScanIgnitionSource.getSnapshot()` yan etkisizdir
 *    (`refresh()` ÇAĞRILMAZ).
 */

import { getObdSpeedFresh, getOBDStatusSnapshot, getObdFreshWindowMs } from '../obdService';
import { useUnifiedVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';
import { useSystemStore } from '../../store/useSystemStore';
import { deepScanIgnitionSource } from '../deepScan/deepScanIgnitionSource';
import type { MaviVehicleSnapshot, MaviIgnitionState } from './maviVehicleContext';

/**
 * Canlı kaynaklardan tek seferlik, dondurulmuş snapshot toplar.
 * Komut başına TEK kez çağrılır (bkz. `voiceService.processTextCommand`).
 */
export function captureMaviVehicleSnapshot(): MaviVehicleSnapshot {
  let obdSpeedFreshKmh: number | null = null;
  let obdConnected = false;
  let obdLastSeenMs = 0;
  let obdFreshWindowMs = 0;
  let gpsSpeedMps: number | null = null;
  let gpsAccuracyM: number | null = null;
  let gpsFixAtMs: number | null = null;
  let reverseSignal = false;
  let ignition: MaviIgnitionState = 'unknown';

  // Hız — protokol kadansına göre ZATEN tazelik kapılı (null = bilinmiyor, 0 DEĞİL).
  try { obdSpeedFreshKmh = getObdSpeedFresh(); } catch { /* kanıt yok → unknown */ }

  try {
    const st = getOBDStatusSnapshot();
    obdConnected = st.connectionState === 'connected';
    obdLastSeenMs = typeof st.lastSeenMs === 'number' ? st.lastSeenMs : 0;
  } catch { /* kanıt yok */ }

  try { obdFreshWindowMs = getObdFreshWindowMs(); } catch { /* kanıt yok */ }

  try {
    const v = useUnifiedVehicleStore.getState();
    const loc = v.location;
    if (loc) {
      gpsSpeedMps  = typeof loc.speed === 'number' ? loc.speed : null;
      gpsAccuracyM = typeof loc.accuracy === 'number' ? loc.accuracy : null;
      gpsFixAtMs   = typeof loc.timestamp === 'number' ? loc.timestamp : null;
    }
    if (v.reverse === true) reverseSignal = true;   // CAN vites bilgisi
  } catch { /* kanıt yok */ }

  // Sistem geri-vites olayı (SystemOrchestrator → useSystemStore.setReverse).
  try { if (useSystemStore.getState().isReverseActive === true) reverseSignal = true; } catch { /* kanıt yok */ }

  // Kontak — üç durumlu; kanıt yoksa 'unknown' KALIR (açık/kapalı varsayılmaz).
  try { ignition = deepScanIgnitionSource.getSnapshot().state; } catch { /* unknown kalır */ }

  return Object.freeze({
    obdSpeedFreshKmh, obdConnected, obdLastSeenMs, obdFreshWindowMs,
    gpsSpeedMps, gpsAccuracyM, gpsFixAtMs, reverseSignal, ignition,
  });
}
