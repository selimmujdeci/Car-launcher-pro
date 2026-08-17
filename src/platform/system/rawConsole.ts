/**
 * rawConsole.ts — KAPILANMAMIŞ (gate'siz) console referansları.
 *
 * ── NEDEN VAR (kütük #598-D / #604) ────────────────────────────────────────
 * `logGate.installConsoleGate()` düşük runtime modlarında `console.*`'ı
 * susturur (`BASIC_JS` → 'error', `POWER_SAVE`/`SAFE_MODE` → 'silent').
 * Bu doğru bir eMMC/CPU koruması — AMA bir yan etkisi ÖLÇÜLDÜ:
 *
 *   `AdaptiveRuntimeManager._commit()` önce `this._mode = mode` yazıyor,
 *   SONRA `[Runtime] runtime_mode_changed: … → SAFE_MODE` satırını
 *   `console.warn` ile basıyor. O anda aktif mod ARTIK SAFE_MODE olduğu için
 *   gate 'silent' okur ve satırı YUTAR.
 *
 * Yani **moda geçişi duyuran log, tam da duyurduğu geçiş tarafından
 * susturuluyordu.** Sahada "SAFE_MODE'a kim soktu" sorusu bu yüzden
 * cevaplanamadı: tetikleyici hiçbir iz bırakmıyordu. Aynı tuzak `BASIC_JS`
 * geçişinde de var ('error' seviyesi warn/info'yu susturur).
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 * Bu modül, gate kurulmadan ÖNCE (import değerlendirme anında) gerçek
 * `console` metotlarını yakalar ve gate'ten BAĞIMSIZ bir kanal sunar.
 * Sıra garantilidir: `installConsoleGate()` bir ÇALIŞMA ZAMANI çağrısıdır
 * (main.tsx gövdesi), bu modül ise import grafiği değerlendirilirken çalışır.
 *
 * ⚠️ KULLANIM SINIRI — bu kanal ucuz değil, AYRICALIKLI: yalnız **seyrek ve
 * teşhis için vazgeçilmez** olaylar buradan yazılır (runtime mod değişimi,
 * çökme kurtarma). Sıcak yola (hız/RPM/GPS tik) ASLA konmaz — gate'in var
 * oluş sebebi odur. Bugün tek çağıran `AdaptiveRuntimeManager`dır.
 *
 * SAF: yan etkisi yok, timer yok, global durum yazmaz.
 */

/* Gate kurulmadan önceki gerçek metotlar. `bind` şart: `console` bağlamı
   kaybolursa bazı WebView'larda `Illegal invocation` atar. */
const _rawWarn: (...args: unknown[]) => void =
  typeof console !== 'undefined' && typeof console.warn === 'function'
    ? console.warn.bind(console)
    : () => { /* console yok (SSR / kısıtlı worker) */ };

const _rawInfo: (...args: unknown[]) => void =
  typeof console !== 'undefined' && typeof console.info === 'function'
    ? console.info.bind(console)
    : () => { /* console yok */ };

/**
 * Gate'ten bağımsız `warn`. Susturulamaz.
 * Kendi başına fail-soft: console patlarsa çağıranı düşürmez.
 */
export function rawWarn(...args: unknown[]): void {
  try { _rawWarn(...args); } catch { /* log asla akışı bozmaz */ }
}

/** Gate'ten bağımsız `info`. Susturulamaz. */
export function rawInfo(...args: unknown[]): void {
  try { _rawInfo(...args); } catch { /* log asla akışı bozmaz */ }
}

/**
 * `logGate` bu referansları KULLANIR — böylece "gerçek console" tek yerde
 * yakalanır ve gate ile ham kanal arasında ikinci bir otorite doğmaz.
 */
export const _rawConsoleForGate = Object.freeze({
  warn: _rawWarn,
  info: _rawInfo,
});
