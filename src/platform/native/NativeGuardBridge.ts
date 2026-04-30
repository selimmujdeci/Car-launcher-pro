/**
 * NativeGuardBridge — Native Yaşam Hattı
 *
 * JS katmanı tamamen kapansa dahi aracın kat ettiği mesafe ve sistem modu
 * Android native katmanında mühürlenmiş olmalı. Bu servis üç görevi yerine getirir:
 *
 * 1. Heartbeat (1s)
 *    CarLauncher.sendHeartbeat() → Android, WebView'ın yaşadığını bilir.
 *    3s içinde heartbeat gelmezse native watchdog WebView'ı yeniden başlatabilir.
 *
 * 2. Odometer Persist (5s, değişim varsa)
 *    CarLauncher.persistOdometer({ km }) → Android SharedPreferences'a atomik yaz.
 *    WebView crash olursa bile en fazla 5s'lik mesafe kaybı olur.
 *    Kıyaslama: safeStorage (4s debounce) + native backup = çift güvenlik ağı.
 *
 * 3. Runtime Mode Sync
 *    runtimeManager.subscribe → CarLauncher.setNativeMode({ mode })
 *    Native taraf düşük voltaj / termal durumda da doğru modu gösterir.
 *
 * Zero-Leak:
 *    stopNativeGuardBridge() tüm timer ve abonelikleri temizler.
 *    Sadece native platformda aktif olur (isNative guard).
 *
 * Hata dayanıklılığı:
 *    Tüm CarLauncher çağrıları try/catch içinde — native metot henüz
 *    implement edilmemişse (opsiyonel interface) sessizce geçilir.
 */

import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { useVehicleStore } from '../vehicleDataLayer/VehicleStateStore';
import { CarLauncher }     from '../nativePlugin';
import { isNative }        from '../bridge';
import { logError }        from '../crashLogger';

// ── Sabitler ──────────────────────────────────────────────────────────────────

const HEARTBEAT_MS     = 1_000;  // 1s — native watchdog beklentisi
const ODO_PERSIST_MS   = 5_000;  // 5s — en fazla bu kadar mesafe kaybedilebilir

// ── Modül state ────────────────────────────────────────────────────────────────

let _active             = false;
let _heartbeatTimer:    ReturnType<typeof setInterval> | null = null;
let _odoTimer:          ReturnType<typeof setInterval> | null = null;
let _unsubRuntime:      (() => void) | null = null;
let _lastPersistedOdo   = -1;   // -1 = hiç persist edilmedi

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function _tryCall<T>(fn: () => Promise<T>): void {
  void fn().catch((e: unknown) => {
    // Native metot yoksa (opsiyonel interface) —  logError'a yazmaya gerek yok
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('not implemented') || msg.includes('unimplemented')) return;
    logError('NativeGuardBridge', e);
  });
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Native Guard Bridge'i başlatır.
 * App.tsx'te bir kez çağrılmalı; dönen thunk cleanup fonksiyonudur.
 * Native olmayan ortamlarda (web/dev) no-op olarak döner.
 */
export function startNativeGuardBridge(): () => void {
  if (_active) return stopNativeGuardBridge;
  if (!isNative) return stopNativeGuardBridge; // web modda aktif değil

  _active           = true;
  _lastPersistedOdo = -1;

  // ── 1. Runtime mode → native sync ──────────────────────────────────────
  // İlk senkronizasyon
  _tryCall(() => CarLauncher.setNativeMode?.({ mode: runtimeManager.getMode() }) ?? Promise.resolve());

  // Sonraki mod değişimlerini dinle
  _unsubRuntime = runtimeManager.subscribe((mode) => {
    _tryCall(() => CarLauncher.setNativeMode?.({ mode }) ?? Promise.resolve());
  });

  // ── 2. Heartbeat: WebView yaşıyor sinyali ──────────────────────────────
  _heartbeatTimer = setInterval(() => {
    _tryCall(() => CarLauncher.sendHeartbeat?.() ?? Promise.resolve());
  }, HEARTBEAT_MS);

  // ── 3. Odometer persist: değişim varsa her 5s'de native storage'a yaz ──
  _odoTimer = setInterval(() => {
    const odo = useVehicleStore.getState().odometer;
    if (odo > 0 && Math.abs(odo - _lastPersistedOdo) >= 0.01) { // 10m değişim eşiği
      _lastPersistedOdo = odo;
      _tryCall(() => CarLauncher.persistOdometer?.({ km: odo }) ?? Promise.resolve());
    }
  }, ODO_PERSIST_MS);

  return stopNativeGuardBridge;
}

export function stopNativeGuardBridge(): void {
  if (!_active) return;
  _active = false;

  if (_heartbeatTimer !== null) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
  if (_odoTimer       !== null) { clearInterval(_odoTimer);       _odoTimer       = null; }
  _unsubRuntime?.(); _unsubRuntime = null;
  _lastPersistedOdo = -1;
}

/* ── HMR cleanup ──────────────────────────────────────────────────────────── */
if (import.meta.hot) {
  import.meta.hot.dispose(() => stopNativeGuardBridge());
}
