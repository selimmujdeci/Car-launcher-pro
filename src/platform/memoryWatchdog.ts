/**
 * memoryWatchdog.ts — Android LMK RAM Baskısı Yöneticisi
 *
 * thermalWatchdog'a paralel mimari:
 *   Native (MainActivity / CarLauncherPlugin)
 *     → onTrimMemory(RUNNING_CRITICAL | MODERATE)
 *     → notifyListeners("memoryPressure", { level })
 *     → JS: _handleMemoryPressure()
 *
 * Seviyeler:
 *   MODERATE  → BASIC_JS (animasyon/blur kapat, cache yarıya indir)
 *   CRITICAL  → SAFE_MODE + reportFailure('RAM') + Worker askıya al + cache boşalt
 *
 * Zero-Leak:
 *   stop() → Capacitor listener + tüm callback'ler temizlenir.
 */

import { Capacitor }    from '@capacitor/core';
import { CarLauncher }  from './nativePlugin';
import { runtimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode }    from '../core/runtime/runtimeTypes';

/* ── Tipler ──────────────────────────────────────────────────────────────── */

export type MemoryPressureLevel = 'MODERATE' | 'CRITICAL';

export interface MemoryPressureEvent {
  level:  MemoryPressureLevel;
  ts:     number;
}

type MemoryPressureCallback = (evt: MemoryPressureEvent) => void;

/* ── Modül state ─────────────────────────────────────────────────────────── */

let _running   = false;
let _nativeSub: (() => void) | null = null;

const _callbacks = new Set<MemoryPressureCallback>();

/* ── Cache purge registry ────────────────────────────────────────────────── */

/** RAM krizinde çağrılacak cache temizleme fonksiyonlarını tutan kayıt. */
const _cachePurgeHandlers = new Set<() => void>();

/**
 * Cache temizleme fonksiyonu kaydet.
 * trafficCache, offlineRoutingService vb. buraya kendini kaydeder.
 * @returns  Kaydı iptal eden thunk — Zero-Leak.
 */
export function registerCachePurge(fn: () => void): () => void {
  _cachePurgeHandlers.add(fn);
  return () => { _cachePurgeHandlers.delete(fn); };
}

/* ── Core handler ────────────────────────────────────────────────────────── */

function _handleMemoryPressure(level: MemoryPressureLevel): void {
  const evt: MemoryPressureEvent = { level, ts: Date.now() };

  if (level === 'CRITICAL') {
    // Anlık SAFE_MODE geçişi + arıza sinyal
    runtimeManager.setMode(RuntimeMode.SAFE_MODE, 'Memory Pressure');
    runtimeManager.reportFailure('RAM');
    // OPTIONAL worker'ları sonlandır (VisionCompute, NavigationCompute)
    runtimeManager.handleMemoryPressure('CRITICAL');
    // Tüm kayıtlı cache'leri boşalt
    _cachePurgeHandlers.forEach(fn => { try { fn(); } catch { /* sessiz */ } });

  } else if (level === 'MODERATE') {
    // Hafif baskı: animasyon/blur kapat, OPTIONAL worker'ları sonlandır
    runtimeManager.setMode(RuntimeMode.BASIC_JS, 'Memory Moderate');
    runtimeManager.handleMemoryPressure('MODERATE');
    // Cache purge yok — CRITICAL'a bırakılır
  }

  // Aboneleri bildir (VisionAROverlay, bileşenler)
  _callbacks.forEach(cb => { try { cb(evt); } catch { /* sessiz */ } });
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/**
 * Memory watchdog'u başlatır. İdempotent.
 * Native platformda CarLauncher'ı dinler; web'de no-op.
 */
export function startMemoryWatchdog(): void {
  if (_running) return;
  _running = true;

  if (!Capacitor.isNativePlatform()) return; // web modda native event yok

  // Capacitor plugin event listener
  CarLauncher.addListener('memoryPressure', (data: { level?: string }) => {
    const raw = data?.level;
    if (raw === 'CRITICAL' || raw === 'MODERATE') {
      _handleMemoryPressure(raw as MemoryPressureLevel);
    }
  }).then(listener => {
    _nativeSub = () => listener.remove();
  }).catch(() => { /* eski plugin versiyonu — sessiz */ });
}

/**
 * Watchdog'u durdurur ve tüm listener'ları temizler.
 * Zero-Leak garantisi.
 */
export function stopMemoryWatchdog(): void {
  if (!_running) return;
  _running = false;

  _nativeSub?.();
  _nativeSub = null;
  _callbacks.clear();
  _cachePurgeHandlers.clear();
}

/**
 * RAM baskısı olaylarına abone ol.
 * @returns  Aboneliği iptal eden thunk — useEffect cleanup'ında kullan.
 */
export function onMemoryPressure(cb: MemoryPressureCallback): () => void {
  _callbacks.add(cb);
  return () => { _callbacks.delete(cb); };
}

/** Aktif RAM baskısı seviyesini test veya debug için simüle et. */
export function _simulateMemoryPressureForTest(level: MemoryPressureLevel): void {
  _handleMemoryPressure(level);
}
