/**
 * navigationOrientation.ts — EKRAN YÖNÜNÜN tek sahibi (taban yön + tam ekran navigasyon).
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 * **TABAN yön kullanıcı tercihidir** (Ayarlar › Ekran › Ekran yönü):
 *   'landscape' (VARSAYILAN — eski davranış: manifest `sensorLandscape`),
 *   'portrait' (dikey panelli head unit, ör. 768×1024 Tesla tipi — 2026-10-02
 *   ürün kararı: mağazadaki araç ekranları dikey olabiliyor), 'auto' (cihaz/
 *   firmware'in kendi yönü). Native tercihi saklar ve açılışta JS'ten ÖNCE uygular.
 *
 * Tam ekran navigasyon açıkken yön geçici olarak dört yöne serbesttir
 * (LANDSCAPE · LANDSCAPE_REVERSE · PORTRAIT · PORTRAIT_REVERSE); kapanınca
 * TABAN yöne dönülür (eskiden sabit yataya dönülürdü).
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

/** `LOCKED_LANDSCAPE` = TABAN yön (adı tarihsel; taban kullanıcı tercihidir). */
export type NavigationOrientationMode = 'LOCKED_LANDSCAPE' | 'FULL_SENSOR';
export type ScreenOrientationPreference = 'landscape' | 'portrait' | 'auto';

let _mode: NavigationOrientationMode = 'LOCKED_LANDSCAPE';
let _base: ScreenOrientationPreference = 'landscape';
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

/**
 * Kullanıcının taban yön tercihini uygular (Ayarlar › Ekran › Ekran yönü).
 * Native tercihi saklar; tam ekran navigasyon yönü serbest bırakmışsa çıkışta
 * uygulanır. Eski APK'da yöntem yoksa sessizce yatay kalır (fail-soft).
 */
export async function setScreenOrientationPreference(pref: ScreenOrientationPreference): Promise<void> {
  if (pref !== 'landscape' && pref !== 'portrait' && pref !== 'auto') return;
  const changed = _base !== pref;
  _base = pref;
  if (changed) _notify();
  if (!isNative) return;   // web/demo: yalnız "Telefonu Yatay Tutun" perdesini etkiler
  try {
    const plugin = CarLauncher as unknown as {
      setScreenOrientation?: (o: { mode: ScreenOrientationPreference }) => Promise<unknown>;
    };
    if (typeof plugin.setScreenOrientation !== 'function') {
      _lastError = 'native ekran yönü yöntemi yok (eski APK)';
      return;
    }
    await plugin.setScreenOrientation({ mode: pref });
    _lastError = null;
  } catch (e) {
    _lastError = (e as { message?: string } | null)?.message ?? 'bilinmeyen hata';
  }
}

export function getScreenOrientationPreference(): ScreenOrientationPreference {
  return _base;
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
  /** Kullanıcının taban yön tercihi. */
  readonly base: ScreenOrientationPreference;
  /** Ana arayüz dikey açılabilir mi — yalnız kullanıcı 'portrait'/'auto' seçtiyse. */
  readonly mainUiPortraitAllowed: boolean;
}

export function getNavigationOrientationSnapshot(): NavigationOrientationSnapshot {
  return {
    mode: _mode,
    holders: _holders,
    lastError: _lastError,
    base: _base,
    mainUiPortraitAllowed: _base !== 'landscape',
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
  _base = 'landscape';
  _holders = 0;
  _lastError = null;
  _listeners.clear();
}
