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

/* ── Senkron okuma ucu (#523) ──────────────────────────────────────────────
 * SORUN (saha 2026-08-10): deney koştu, ekranda hüküm göründü, ama "TÜMÜNÜ
 * KOPYALA" çıktısında deney bölümü YOKTU → saha oturumu okunamadan gitti.
 * KÖK: kopya yolu (`carosLabCopySources`) sözleşmesi gereği SENKRONDUR;
 * `readPidTimingExperiment()` ise native köprü üzerinden ASYNC'tir ve kopya
 * onu çağıramaz.
 * ÇÖZÜM: async okuma her yapıldığında sonucu modül-yerel önbelleğe yazarız;
 * kopya bu önbelleği senkron okur. Önbellek BOŞSA kopya "okunmadı" der —
 * boş rapor "deney yok" diye SUNULMAZ (sahte 0 yasağı). */
let _lastRaw: PidTimingRaw | null = null;
let _lastReadAtMs = 0;

/**
 * Kopya/rapor yolu için SENKRON son okuma. `null` = bu oturumda deney ekranı
 * hiç okunmadı (deneyin yokluğu DEĞİL — okuma yapılmadı).
 */
export function getLastPidTimingRaw(): { raw: PidTimingRaw; readAtMs: number } | null {
  return _lastRaw === null ? null : { raw: _lastRaw, readAtMs: _lastReadAtMs };
}

/** Yalnız testler için — önbelleği sıfırlar. */
export function _resetPidTimingCacheForTest(): void {
  _lastRaw = null;
  _lastReadAtMs = 0;
}

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
    const parsed: PidTimingRaw = {
      status:     typeof r.status === 'string' ? r.status : 'idle',
      running:    r.running === true,
      failReason: typeof r.failReason === 'string' ? r.failReason : null,
      /* #523 — BU ÜÇ ALAN KÖPRÜDE DÜŞÜYORDU: native `stRestored` (B7 · ATST geri
         alındı mı) ve deney penceresi damgalarını (B5) gönderiyor, ama köprü onları
         taşımadığı için model hep `UNKNOWN`/null görüyordu. Ekranda "ATST geri
         alındı: UNKNOWN" bu yüzden çıkıyordu — native tarafı sağlamdı. */
      stRestored: typeof r.stRestored === 'string' ? r.stRestored : undefined,
      experimentStartMs: typeof r.experimentStartMs === 'number' ? r.experimentStartMs : undefined,
      experimentEndMs:   typeof r.experimentEndMs === 'number' ? r.experimentEndMs : undefined,
      phases:     Array.isArray(r.phases) ? r.phases : [],
      samples:    Array.isArray(r.samples) ? r.samples : [],
    };
    /* #523 — kopya yolu SENKRONDUR ve bu async çağrıyı yapamaz; son okuma
       burada önbelleğe alınır ki "TÜMÜNÜ KOPYALA" deney sonucunu taşıyabilsin. */
    _lastRaw = parsed;
    _lastReadAtMs = Date.now();
    return parsed;
  } catch (e) {
    logError('OBD:PidTimingRead', e);
    return null;
  }
}
