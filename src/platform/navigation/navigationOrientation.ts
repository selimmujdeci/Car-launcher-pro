/**
 * navigationOrientation.ts — EKRAN YÖNÜNÜN tek sahibi (tam ekran navigasyon kapısı).
 *
 * ── SÖZLEŞME (2026-10-02 ürün kararı: yön OTOMATİK) ─────────────────────────
 * Uygulama yönü ZORLAMAZ: manifest `unspecified` → araç ekranı/firmware dikey
 * ya da yatay ne veriyorsa arayüz ona uyar (temaların dikey düzeni vardır).
 * Kullanıcıya seçenek SUNULMAZ. K24/NWD'nin "fiziksel yatay, dikey raporlayan"
 * paneli MainActivity'deki sistem rotasyon kilidiyle ayrıca yataya alınır.
 *
 * Tam ekran navigasyon açıkken yön geçici olarak dört yöne sensörle serbesttir
 * (LANDSCAPE · LANDSCAPE_REVERSE · PORTRAIT · PORTRAIT_REVERSE — telefonda
 * döndürme kilidi açık olsa bile); kapanınca cihazın KENDİ yönüne dönülür.
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

import { CarLauncher } from '../nativePlugin';
import { isNative } from '../bridge';
import type { ViewportOrientation } from './core/cameraPolicyModel';

/** `DEVICE` = cihazın/araç ekranının kendi yönü; `FULL_SENSOR` = tam ekran navigasyon. */
export type NavigationOrientationMode = 'DEVICE' | 'FULL_SENSOR';

let _mode: NavigationOrientationMode = 'DEVICE';
/** Kaç tam ekran navigasyon yüzeyi yönü serbest bıraktı (ref-count, çift mount güvenli). */
let _holders = 0;
let _lastError: string | null = null;

async function _apply(mode: NavigationOrientationMode): Promise<void> {
  if (_mode === mode) return;
  _mode = mode;
  if (!isNative) return;   // web/demo modunda yön çağrısı YOK
  try {
    const plugin = CarLauncher as unknown as {
      setNavigationOrientation?: (o: { mode: string }) => Promise<unknown>;
    };
    if (typeof plugin.setNavigationOrientation !== 'function') {
      _lastError = 'native yöntem yok (eski APK)';
      return;
    }
    await plugin.setNavigationOrientation({
      mode: mode === 'FULL_SENSOR' ? 'sensor' : 'device',
    });
    _lastError = null;
  } catch (e) {
    /* FAIL-SOFT: yön çağrısı uygulanamazsa navigasyon aynen sürer, yalnız ekran
       cihazın o anki yönünde kalır. Sürüşü bozacak bir hata değildir. */
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
    if (_holders === 0) void _apply('DEVICE');
  };
}

export interface NavigationOrientationSnapshot {
  readonly mode: NavigationOrientationMode;
  /** Kaç yüzey yönü serbest bırakıyor (0 = cihazın kendi yönü). */
  readonly holders: number;
  /** Native çağrı hatası — `null` = sorun yok. */
  readonly lastError: string | null;
  /** Ana arayüz dikey açılabilir mi — yön otomatik olduğundan HER ZAMAN `true`. */
  readonly mainUiPortraitAllowed: true;
}

export function getNavigationOrientationSnapshot(): NavigationOrientationSnapshot {
  return {
    mode: _mode,
    holders: _holders,
    lastError: _lastError,
    mainUiPortraitAllowed: true,
  };
}

/** Ölçülen viewport'tan yön — kamera çapası bunu kullanır. */
export function orientationOf(width: number, height: number): ViewportOrientation {
  return height > width ? 'PORTRAIT' : 'LANDSCAPE';
}

/** @internal — testler arası izolasyon. */
export function _resetNavigationOrientationForTest(): void {
  _mode = 'DEVICE';
  _holders = 0;
  _lastError = null;
}
