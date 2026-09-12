/**
 * Native Core Service — startup orchestration for CockpitOS.
 *
 * Responsibilities:
 *   1. Read device hardware profile from native layer (getDeviceProfile)
 *   2. Auto-set performance mode based on device class (low/mid/high)
 *   3. Cache real screen metrics (more reliable than JS window.screen on head units)
 *   4. Provide React hooks for downstream consumers
 *
 * Call init() once at app startup (before React mounts, or in main.tsx).
 * All methods are safe to call on web/demo mode — they fall back gracefully.
 */

import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { CarLauncher } from './nativePlugin';
import type { NativeDeviceProfile, NativeScreenMetrics } from './nativePlugin';
import { initFromDeviceProfile } from './performanceMode';
import { setNativeScreenMetrics, getDeviceTier } from './deviceCapabilities';

/* ── Module state ─────────────────────────────────────────── */

let _profile:       NativeDeviceProfile | null = null;
let _screenMetrics: NativeScreenMetrics | null = null;
let _ready          = false;

const _profileListeners = new Set<(p: NativeDeviceProfile | null) => void>();
const _metricsListeners = new Set<(m: NativeScreenMetrics | null) => void>();

/* ── Helpers ──────────────────────────────────────────────── */

function notifyProfile(): void  { _profileListeners.forEach(fn => fn(_profile)); }
function notifyMetrics(): void  { _metricsListeners.forEach(fn => fn(_screenMetrics)); }

/* ── Public: init ─────────────────────────────────────────── */

/**
 * Call once at app startup (non-blocking — fire and forget).
 * Safe to call multiple times; runs only once.
 */
export async function initNativeCore(): Promise<void> {
  if (_ready) return;
  _ready = true;

  if (!Capacitor.isNativePlatform()) return; // web/demo mode — skip

  /* ══════════════════════════════════════════════════════════════════════
   * SIRA KRİTİK (kütük #599 · #683): ÖNCE ekran ölçümü, SONRA sınıflandırma.
   *
   * Eskiden ters sıradaydı: cihaz sınıfı native profilden alınıp performans modu
   * ayarlanıyor, ekran metrikleri SONRA okunuyor ve YALNIZ bir CSS değişkenine
   * yazılıyordu — sınıflandırmaya HİÇ girmiyordu. Yani gerçek panel ölçüsü elde
   * olduğu hâlde `deviceCapabilities` `cssW × devicePixelRatio` TAHMİNİYLE karar
   * veriyordu. #599 tam bu yüzden çıktı: yanlış dpr → sahte `low` → poll 1000 ms →
   * OBD verisi bayat. Ölçüm varken tahminle karar vermek, veriyi çöpe atmaktır.
   * ════════════════════════════════════════════════════════════════════ */

  // ── Screen metrics (ÖNCE — sınıflandırmanın girdisi) ──────
  try {
    const metrics = await CarLauncher.getScreenMetrics();
    _screenMetrics = metrics;
    notifyMetrics();

    /* Kanonik sınıflandırıcıya ÖLÇÜMÜ besle. Bu İKİNCİ OTORİTE DEĞİLDİR:
       karar yine `deviceCapabilities`ındır, burada yalnız girdi sağlanır. */
    setNativeScreenMetrics({ widthPx: metrics.widthPx, heightPx: metrics.heightPx });

    // Inject as CSS variables so components can use them
    const root = document.documentElement;
    root.style.setProperty('--native-vw', `${metrics.widthPx}px`);
    root.style.setProperty('--native-vh', `${metrics.heightPx}px`);
    root.style.setProperty('--native-density', String(metrics.density));
  } catch {
    /* Ölçüm alınamadı → `deviceCapabilities` tahmin dalında kalır (fail-soft).
       Sahte ölçüm BESLENMEZ: yanlış ölçüm, tahminden kötüdür. */
  }

  // ── Device profile ────────────────────────────────────────
  try {
    const profile = await CarLauncher.getDeviceProfile();
    _profile = profile;
    notifyProfile();

    /* TEK OTORİTE: performans modu KANONİK cihaz sınıfından türetilir
       (`performanceMode.ts` kendisi de "tek kaynak: deviceCapabilities" diyor).
       Eskiden native `profile.deviceClass` doğrudan veriliyordu — bu, aynı soruyu
       yanıtlayan İKİNCİ bir otoriteydi ve iki yol farklı sonuç verebilirdi.
       Sıra sayesinde `getDeviceTier()` artık native ÖLÇÜMLE hesaplanıyor. */
    initFromDeviceProfile(getDeviceTier());

    // Low-end veya düşük RAM cihaz: tüm pahalı CSS efektlerini hemen kapat.
    // `perf-low` index.css'te tanımlı: animation:none, blur:none, shadow:none.
    // `data-compat-mode`: tüm backdrop-blur sınıflarını opak arka planla değiştirir.
    /* CSS baskılama kararı da KANONİK sınıfa bağlı — native `deviceClass` ile
       `getDeviceTier()` ayrışırsa ekran bir sınıfa, poll başka sınıfa göre davranırdı. */
    if (getDeviceTier() === 'low' || profile.isLowRamDevice) {
      document.documentElement.classList.add('perf-low');
      document.documentElement.setAttribute('data-compat-mode', 'true');
      // Cache: sonraki açılışta anında uygula (FOUC önler)
      // Kütük #411: burada YAZILAN şey performans sınıfıdır, cihaz türü DEĞİL.
      // Eskiden `cl_isHeadUnit='1'` yazılıyordu → düşük RAM'li TELEFONLAR head
      // unit sayılıp HU yerleşimi alıyordu (sahada ölçüldü, #412'nin kökü).
      try { localStorage.setItem('cl_compatLowTier', '1'); } catch { /* quota */ }
    } else if (getDeviceTier() === 'mid') {
      // Orta sınıf cihazda animasyon yavaşlatması yeterli; blur'a izin ver
      document.documentElement.classList.add('perf-med');
    }
  } catch {
    // Native call failed — continue with defaults, no crash
  }

}

/* ── Public: getters ──────────────────────────────────────── */

export function getDeviceProfile(): NativeDeviceProfile | null {
  return _profile;
}

export function getScreenMetrics(): NativeScreenMetrics | null {
  return _screenMetrics;
}

/* ── React hooks ──────────────────────────────────────────── */

export function useDeviceProfile(): NativeDeviceProfile | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      _profileListeners.add(onStoreChange);
      return () => { _profileListeners.delete(onStoreChange); };
    },
    () => _profile,
    () => _profile,
  );
}

export function useScreenMetrics(): NativeScreenMetrics | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      _metricsListeners.add(onStoreChange);
      return () => { _metricsListeners.delete(onStoreChange); };
    },
    () => _screenMetrics,
    () => _screenMetrics,
  );
}
