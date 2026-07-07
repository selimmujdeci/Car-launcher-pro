/**
 * bootTimingRecorder — boot dalga (Wave) süre kaydedici (tanı genişliği).
 *
 * SystemBoot.start() dört dalgayı (Wave 1-4) sırayla bekler; bu kaydedici o
 * sıranın DIŞINDA, yalnız GÖZLEMCİ olarak her Wave'in süresini (ms) alır.
 * Boot sırasını/mantığını DEĞİŞTİRMEZ — yalnız ölçüm eklenir.
 *
 * Zero-Allocation: module-level sabit tavanlı dizi, hot-path DEĞİL (boot bir
 * kez çalışır, ömür boyu tek seferlik — 3Hz hız/RPM döngüsüne asla girmez).
 *
 * PII yok — yalnız wave adı (statik metin) + süre (ms, sayısal).
 */

export interface BootWaveTiming {
  name:       string;
  durationMs: number;
}

export interface BootTimingSnapshot {
  waves:       BootWaveTiming[];
  /** Toplam cold-start süresi (ms) — boot tamamlanmadıysa şimdiye kadarki toplam. */
  totalMs:     number;
  /** En yavaş dalganın adı — açılış yavaşlığının kökü. Ölçüm yoksa null. */
  slowestWave: string | null;
}

// Güvenlik tavanı — 4 dalga + pay (sınırsız büyüme yok, zero-leak).
const MAX_WAVES = 8;

let _waves: BootWaveTiming[] = [];
let _bootStartTs: number | null = null;
let _totalMs: number | null = null;

/**
 * SystemBoot.start() girişinde bir kez çağrılır — toplam süre ölçümü için taban.
 * Yeniden boot (stop→start) öncesi önce resetBootTiming() çağrılmalı.
 */
export function recordBootStart(): void {
  _bootStartTs = performance.now();
}

/** Bir Wave tamamlandığında çağrılır — adı + süresi (ms, tam sayıya yuvarlanır). */
export function recordBootWave(name: string, durationMs: number): void {
  if (_waves.length >= MAX_WAVES) return; // tavan koruması
  _waves.push({ name, durationMs: Math.max(0, Math.round(durationMs)) });
}

/** Boot tamamen bitince (window.__APP_READY__) çağrılır — toplam süreyi mühürler. */
export function recordBootComplete(): void {
  if (_bootStartTs === null) return;
  _totalMs = Math.max(0, Math.round(performance.now() - _bootStartTs));
}

/** Tanı payload'ı için boot zaman çizelgesi anlık görüntüsü (kopya, fail-soft). */
export function getBootTimingSnapshot(): BootTimingSnapshot {
  let slowest:   string | null = null;
  let slowestMs = -1;
  for (const w of _waves) {
    if (w.durationMs > slowestMs) { slowestMs = w.durationMs; slowest = w.name; }
  }
  const total = _totalMs ?? _waves.reduce((acc, w) => acc + w.durationMs, 0);
  return { waves: [..._waves], totalMs: total, slowestWave: slowest };
}

/** Yeniden boot (stop→start) öncesi sıfırlar — SystemBoot.start() girişinde çağrılır. */
export function resetBootTiming(): void {
  _waves = [];
  _bootStartTs = null;
  _totalMs = null;
}

/** @internal testler için. */
export function _resetBootTimingForTest(): void {
  resetBootTiming();
}
