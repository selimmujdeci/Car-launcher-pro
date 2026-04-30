/**
 * runtimeTypes.ts — Adaptive Runtime Engine · Tip Sözlüğü
 *
 * Bu modül RuntimeEngine'nin tüm tip tanımlarını barındırır.
 * Hiçbir runtime value üretmez; build'de tamamen silinir.
 *
 * Neden `as const` objesi, `enum` değil?
 *   tsconfig.app.json → "erasableSyntaxOnly": true  →  TypeScript'in
 *   JavaScript çıktısı üretecek syntax'ını yasaklar. `enum` gövde JS objesi
 *   üretir → derleme hatası. `as const` + keyof pattern tamamen erasable.
 *
 * Modlar (düşükten yükseğe kapasiteye göre):
 *   SAFE_MODE   — Kritik kurtarma / çok eski donanım  (<200 MHz CPU, Mali-200)
 *   BASIC_JS    — Giriş seviyesi HU               (Mali-400, Android 7-8)
 *   BALANCED    — Standart HU / orta seviye       (Qualcomm 660, 10" panel)
 *   PERFORMANCE — Premium HU / telefon companion  (Snapdragon 865+, 60fps)
 */

/* ── RuntimeMode ─────────────────────────────────────────────── */

/**
 * Sistemin dört çalışma modu.
 * Kullanım: `RuntimeMode.BALANCED`, `'BALANCED'`, veya
 *           `import type { RuntimeMode }` ile parametre tipi olarak.
 */
export const RuntimeMode = {
  PERFORMANCE: 'PERFORMANCE',
  BALANCED:    'BALANCED',
  BASIC_JS:    'BASIC_JS',
  /** Akü koruma modu — düşük voltajda sistem kaynaklarını minimize et (11.8V–12.0V arası) */
  POWER_SAVE:  'POWER_SAVE',
  SAFE_MODE:   'SAFE_MODE',
} as const;

export type RuntimeMode = typeof RuntimeMode[keyof typeof RuntimeMode];

/* ── LoggingLevel ────────────────────────────────────────────── */

/**
 * Çalışma zamanı log seviyesi — düşükten yükseğe:
 *   debug  — Geliştirme: her şey
 *   info   — Normal işlemler
 *   warn   — Beklenmedik ama kurtarılabilir durumlar
 *   error  — Sadece hatalar
 *   silent — Sıfır log (prod SAFE_MODE)
 */
export type LoggingLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/* ── RuntimeConfig ───────────────────────────────────────────── */

/**
 * Bir RuntimeMode'un sabit parametrelerini tanımlar.
 *
 * CLAUDE.md §3 uyumu:
 *  - gpsUpdateMs / obdPollingMs → yüksek frekanslı I/O throttle değerleri
 *  - uiFpsTarget               → RAF render döngüsü hedefi (10-20 Hz BASIC/SAFE)
 *  - enableBlur                → Mali-400'de backdrop-filter GPU maliyeti (kapalı)
 *  - enableAnimations          → CSS/JS animasyon kontrolü
 *  - loggingLevel              → eMMC log yazma sıklığını sınırlar
 */
export interface RuntimeConfig {
  /** GPS konumu güncelleme periyodu (ms). Düşük → daha sık, yüksek pil tüketimi. */
  readonly gpsUpdateMs: number;

  /** OBD-II veri sorgulama periyodu (ms). BALANCED: 3 s, ISO 15031-5 önerisi. */
  readonly obdPollingMs: number;

  /**
   * UI render hedefi (fps).
   * RAF smoother bu değeri tavan olarak kullanır.
   * Mali-400 donanımında > 30 fps gerçekçi değil — BASIC_JS / SAFE_MODE capped.
   */
  readonly uiFpsTarget: 15 | 20 | 30 | 60;

  /**
   * CSS backdrop-filter blur efektleri aktif mi?
   * Mali-400'de hardware accelerated blur YOK → her kare software render =
   * GPU stall. BASIC_JS ve SAFE_MODE'da kapatılır.
   */
  readonly enableBlur: boolean;

  /**
   * CSS/JS animasyonları (transition, keyframe, opacity geçişleri) aktif mi?
   * Kapalıysa `prefers-reduced-motion: reduce` CSS class uygulanır.
   */
  readonly enableAnimations: boolean;

  /**
   * Çalışma zamanı log seviyesi.
   * crashLogger ve intentEngine bu değere göre filtreleme yapar.
   */
  readonly loggingLevel: LoggingLevel;
}

/* ── Store override tipi ─────────────────────────────────────── */

/**
 * Kullanıcının ayarlar ekranından mod seçimi.
 * 'AUTO' → RuntimeEngine cihaz metriğine göre modu otomatik belirler.
 */
export type RuntimeOverride = 'AUTO' | RuntimeMode;
