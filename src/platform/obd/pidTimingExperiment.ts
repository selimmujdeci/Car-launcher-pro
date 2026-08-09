/**
 * pidTimingExperiment — H-A deneyinin köprü katmanı (kütük #518-HA).
 *
 * Native deneyi başlatır/durdurur ve HAM örnekleri okur. Analiz burada YAPILMAZ —
 * `pidTimingExperimentModel` (saf) yapar; bu dosya yalnız köprüdür.
 *
 * ÜRÜN YOLU: deney native tarafta poll döngüsünü durdurmaz, eleme öğrenmesini
 * beslemez ve bitişte ATST'yi geri alır (bkz. `PidTimingExperiment.java`).
 * Web/native olmayan ortamda tüm çağrılar sessizce no-op → tarayıcı modu bozulmaz.
 */
import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';
import { logError } from '../crashLogger';
import type { PidTimingRaw } from './pidTimingExperimentModel';

/** Deneyin varsayılan turu — aşama başına. Cihazda ~2-4 dk sürer. */
export const DEFAULT_ROUNDS = 20;
/** B aşamasında uygulanacak ATST (0xFF × 4 ms ≈ 1020 ms). */
export const DEFAULT_ST_HEX_B = 'FF';

interface StartResult { readonly started: boolean; readonly reason?: string }

function nativeReady(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Deneyi başlatır. `pids` boşsa native ÖLÇÜM YAPMAZ (varsayılan liste UYDURULMAZ) —
 * çağıran hangi PID'leri ölçmek istediğini AÇIKÇA söylemek zorundadır.
 */
export async function startPidTimingExperiment(
  pids: readonly string[],
  rounds: number = DEFAULT_ROUNDS,
  stHex: string = DEFAULT_ST_HEX_B,
): Promise<StartResult> {
  if (!nativeReady()) return { started: false, reason: 'native platform değil' };
  const fn = CarLauncher.startPidTimingExperiment;
  if (typeof fn !== 'function') return { started: false, reason: 'native köprü yok (eski APK)' };
  try {
    const r = await fn.call(CarLauncher, { pids: pids.slice(), rounds, stHex });
    return { started: r?.started === true, reason: r?.reason };
  } catch (e) {
    logError('OBD:PidTimingStart', e);
    return { started: false, reason: 'native çağrı hatası' };
  }
}

/** Koşan deneyi iptal eder — mevcut komut kesilmez, sonraki adım atılmaz. */
export async function abortPidTimingExperiment(): Promise<void> {
  if (!nativeReady()) return;
  const fn = CarLauncher.abortPidTimingExperiment;
  if (typeof fn !== 'function') return;
  try {
    await fn.call(CarLauncher);
  } catch (e) {
    logError('OBD:PidTimingAbort', e);
  }
}

/**
 * Ham sonuçları okur. Native yoksa/okunamazsa `null` — **boş sonuç
 * VARSAYILMAZ** (çağıran "ölçüm yok" ile "ölçüm boş"u ayırabilsin).
 */
export async function readPidTimingExperiment(): Promise<PidTimingRaw | null> {
  if (!nativeReady()) return null;
  const fn = CarLauncher.getPidTimingExperiment;
  if (typeof fn !== 'function') return null;
  try {
    const r = await fn.call(CarLauncher);
    if (!r || typeof r !== 'object') return null;
    return {
      status:     typeof r.status === 'string' ? r.status : 'idle',
      running:    r.running === true,
      failReason: typeof r.failReason === 'string' ? r.failReason : null,
      phases:     Array.isArray(r.phases) ? r.phases : [],
      samples:    Array.isArray(r.samples) ? r.samples : [],
    };
  } catch (e) {
    logError('OBD:PidTimingRead', e);
    return null;
  }
}
