/**
 * runtimeConfig.ts — Adaptive Runtime Engine · Mod Konfigürasyonları
 *
 * Her RuntimeMode için dondurulmuş (frozen) sabit değerler.
 * Object.freeze() ile anlık mutasyon hatalarını derleme değil çalışma
 * zamanında yakalarız; strict modda TypeScript zaten readonly korur.
 *
 * Değer seçimi referansları:
 *  - GPS:  Android LocationManager best-effort interval (PASSIVE → 5s, GPS_FAST → 500ms)
 *  - OBD:  ISO 15031-5 §6.3 poll cycle ≤ 3s; ELM327 response ≤ 200ms/frame
 *  - FPS:  CLAUDE.md §3 "Render Throttling" → 10Hz-20Hz for low-end GPU
 *  - Blur: Mali-400 GPU benchmark → backdrop-filter = 40% frame budget spike
 */

import { RuntimeMode, type RuntimeConfig } from './runtimeTypes';

/* ── Mod tanımları ───────────────────────────────────────────── */

/**
 * PERFORMANCE — Premium donanım (Snapdragon 865+, yüksek çözünürlüklü HU)
 *
 * Tüm görsel efektler, 60fps, maksimum sensör frekansı.
 * Telefon companion modu veya high-end araç ünitesi için.
 */
const PERFORMANCE_CONFIG: RuntimeConfig = Object.freeze({
  gpsUpdateMs:      500,      // 2 Hz — navigasyon için akıcı güncelleme
  obdPollingMs:     1_000,    // 1 Hz — düşük gecikme OBD dashboard
  uiFpsTarget:      60,       // 60fps smooth
  enableBlur:       true,     // hardware accelerated
  enableAnimations: true,
  loggingLevel:     'warn',
} as const);

/**
 * BALANCED — Standart HU / orta seviye (Qualcomm 660, 10" panel, Android 9-11)
 *
 * Varsayılan mod. Görsel kalite ile performans dengeli.
 * ISO 15031-5 uyumlu 3s OBD polling.
 */
const BALANCED_CONFIG: RuntimeConfig = Object.freeze({
  gpsUpdateMs:      1_000,    // 1 Hz — navigasyon için yeterli
  obdPollingMs:     3_000,    // ~0.33 Hz — ISO 15031-5 standart aralığı
  uiFpsTarget:      30,       // 30fps — çoğu HU ekranı 30Hz native
  enableBlur:       true,     // orta sınıf GPU destekler
  enableAnimations: true,
  loggingLevel:     'warn',
} as const);

/**
 * BASIC_JS — Giriş seviyesi HU (Mali-400, Android 7-8, 800×480 ekran)
 *
 * Blur ve animasyon kapalı — Mali-400 backdrop-filter desteği yok,
 * her blur frame'de software render → ekran donmaları (CLAUDE.md §3).
 * 20fps hedef: 50ms frame budget, JS + render birlikte sığar.
 */
const BASIC_JS_CONFIG: RuntimeConfig = Object.freeze({
  gpsUpdateMs:      2_000,    // 0.5 Hz — pil ve CPU tasarrufu
  obdPollingMs:     5_000,    // 0.2 Hz — ELM327 bağlantı stabilitesi
  uiFpsTarget:      20,       // 20fps — Mali-400 gerçekçi üst sınır
  enableBlur:       false,    // Mali-400 uyarısı — GPU stall
  enableAnimations: false,    // JS animation loop CPU maliyetini kaldır
  loggingLevel:     'error',  // sadece hatalar — eMMC yazma azalt
} as const);

/**
 * SAFE_MODE — Kritik kurtarma / çok eski donanım (<200 MHz, Mali-200)
 *
 * Minimum kaynak kullanımı. Uygulama çalışıyor ama sadece temel
 * fonksiyonlar (saat, hız, navigasyon yönlendirmesi).
 * Yavaş OBD polling: bağlantı stabilitesi > veri tazeliği öncelikli.
 */
const SAFE_MODE_CONFIG: RuntimeConfig = Object.freeze({
  gpsUpdateMs:      5_000,    // 0.2 Hz — minimum konum güncellemesi
  obdPollingMs:     10_000,   // 0.1 Hz — bağlantı stabilitesi öncelikli
  uiFpsTarget:      15,       // 15fps — ~67ms frame budget, JS dominant
  enableBlur:       false,
  enableAnimations: false,
  loggingLevel:     'silent', // sıfır log — eMMC ömrü koruması
} as const);

/* ── Config haritası ─────────────────────────────────────────── */

/**
 * RuntimeMode → RuntimeConfig eşlemesi.
 * `as const` ile readonly map; referans hataları tip düzeyinde yakalanır.
 */
export const RUNTIME_CONFIGS: Readonly<Record<RuntimeMode, RuntimeConfig>> = Object.freeze({
  [RuntimeMode.PERFORMANCE]: PERFORMANCE_CONFIG,
  [RuntimeMode.BALANCED]:    BALANCED_CONFIG,
  [RuntimeMode.BASIC_JS]:    BASIC_JS_CONFIG,
  [RuntimeMode.SAFE_MODE]:   SAFE_MODE_CONFIG,
} as const);

/**
 * Mod için konfigürasyon al.
 * Tip sistemi eksik anahtar geçişini derleme zamanında engeller.
 */
export function getRuntimeConfig(mode: RuntimeMode): RuntimeConfig {
  return RUNTIME_CONFIGS[mode];
}
