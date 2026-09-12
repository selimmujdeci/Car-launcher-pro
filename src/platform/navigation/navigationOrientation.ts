/**
 * navigationOrientation.ts — tam ekran navigasyonun EKRAN YÖNÜ kapısı.
 *
 * ── SÖZLEŞME (görev §9, pazarlıksız) ────────────────────────────────────────
 * **Ana CAROS arayüzü YATAY KALIR.** Araç ekranları yataydır ve manifest bunu
 * `android:screenOrientation="sensorLandscape"` ile kilitler.
 *
 * YALNIZ tam ekran navigasyon açıkken kilit gevşetilir (dört yön: LANDSCAPE ·
 * LANDSCAPE_REVERSE · PORTRAIT · PORTRAIT_REVERSE); tam ekran kapanınca kilit
 * GERİ ALINIR. Manifesti kalıcı olarak gevşetmek ana arayüzü de dikeye açardı —
 * bu yüzden değişiklik çalışma zamanında ve KAPSAMLI yapılır.
 *
 * ── NEDEN OTURUM ETKİLENMEZ ─────────────────────────────────────────────────
 * Yön değişimi Android'de Activity'yi yeniden yaratabilir; manifestte
 * `android:configChanges` içinde `orientation|screenSize|screenLayout` ZATEN
 * listelidir → Activity yeniden YARATILMAZ, yalnız yapılandırma değişir. Bu
 * yüzden navigasyon oturumu, rota, ses kuyruğu, ETA ve işaret hareketi
 * etkilenmez: hepsi zaten görünümden bağımsız runtime'lardadır
 * (`navigationSessionRuntime` · `voiceGuidanceRuntime` · `navMarkerMotionRuntime`).
 * Görünümün yapması gereken TEK iş viewport/çapa/padding'i yeniden hesaplamaktır.
 */

import { useEffect, useState } from 'react';
import { CarLauncher } from '../nativePlugin';
import { isNative } from '../bridge';
import type { ViewportOrientation } from './core/cameraPolicyModel';

export type NavigationOrientationMode = 'LOCKED_LANDSCAPE' | 'FULL_SENSOR';

let _mode: NavigationOrientationMode = 'LOCKED_LANDSCAPE';
/** Kaç tam ekran navigasyon yüzeyi kilidi gevşetti (ref-count, çift mount güvenli). */
let _holders = 0;
let _lastError: string | null = null;
const _listeners = new Set<() => void>();

function _notify(): void {
  for (const fn of [..._listeners]) { try { fn(); } catch { /* fail-soft */ } }
}

async function _apply(mode: NavigationOrientationMode): Promise<void> {
  if (_mode === mode) return;
  _mode = mode;
  _notify();
  if (!isNative) return;   // web/demo modunda yön kilidi YOK
  try {
    const plugin = CarLauncher as unknown as {
      setNavigationOrientation?: (o: { mode: string }) => Promise<unknown>;
    };
    if (typeof plugin.setNavigationOrientation !== 'function') {
      _lastError = 'native yöntem yok (eski APK)';
      return;
    }
    await plugin.setNavigationOrientation({
      mode: mode === 'FULL_SENSOR' ? 'sensor' : 'landscape',
    });
    _lastError = null;
  } catch (e) {
    /* FAIL-SOFT: yön kilidi uygulanamazsa navigasyon aynen sürer, yalnız ekran
       yataya kilitli kalır. Sürüşü bozacak bir hata değildir. */
    _lastError = (e as { message?: string } | null)?.message ?? 'bilinmeyen hata';
  }
}

/** Tam ekran navigasyon açıldı → dört yön serbest. Bırakma fonksiyonu döner. */
export function acquireFullNavigationOrientation(): () => void {
  _holders++;
  if (_holders === 1) void _apply('FULL_SENSOR');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    _holders = Math.max(0, _holders - 1);
    if (_holders === 0) void _apply('LOCKED_LANDSCAPE');
  };
}

export interface NavigationOrientationSnapshot {
  readonly mode: NavigationOrientationMode;
  /** Kaç yüzey kilidi tutuyor (0 = ana arayüz yatay). */
  readonly holders: number;
  /** Native çağrı hatası — `null` = sorun yok. */
  readonly lastError: string | null;
  /** Ana arayüz dikey açılabilir mi — HER ZAMAN `false` olmalıdır. */
  readonly mainUiPortraitAllowed: false;
}

export function getNavigationOrientationSnapshot(): NavigationOrientationSnapshot {
  return {
    mode: _mode,
    holders: _holders,
    lastError: _lastError,
    mainUiPortraitAllowed: false,
  };
}

/** React aboneliği — portre uyarısını bastırmak için `App` kullanır. */
export function useNavigationOrientationMode(): NavigationOrientationMode {
  const [m, setM] = useState(_mode);
  useEffect(() => {
    const fn = () => setM(_mode);
    _listeners.add(fn);
    fn();
    return () => { _listeners.delete(fn); };
  }, []);
  return m;
}

/** Ölçülen viewport'tan yön — kamera çapası bunu kullanır. */
export function orientationOf(width: number, height: number): ViewportOrientation {
  return height > width ? 'PORTRAIT' : 'LANDSCAPE';
}

/** @internal — testler arası izolasyon. */
export function _resetNavigationOrientationForTest(): void {
  _mode = 'LOCKED_LANDSCAPE';
  _holders = 0;
  _lastError = null;
  _listeners.clear();
}
