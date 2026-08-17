/**
 * Console Log Gate — head unit log/IO yükü azaltma.
 *
 * Mali-400 sınıfı head unit'te sürekli `console.*` çağrısı + (remote debug açıksa)
 * eMMC yazma gereksiz CPU/IO yüküdür (CLAUDE.md §3). Bu gate, YALNIZCA düşük
 * runtime modlarında debug log'larını (log/info/warn) susturur:
 *
 *   loggingLevel 'error'  → BASIC_JS        → log/info/warn susar, error görünür
 *   loggingLevel 'silent' → POWER_SAVE/SAFE → hepsi susar
 *   loggingLevel 'warn'   → BALANCED/PERF   → HİÇBİR ŞEY susturulmaz (dev + capable cihaz tam log)
 *
 * Yani tarayıcı/dev (BALANCED) ve güçlü cihazlar etkilenmez — geliştirme deneyimi
 * korunur. 210+ çağrı yerinde değiştirilmez (riskli); tek noktadan, geri-uyumlu.
 *
 * Tek seferlik kurulur (main.tsx boot). Testler bu fonksiyonu çağırmaz → test
 * ortamında console davranışı DEĞİŞMEZ.
 *
 * ⚠️ İSTİSNA (kütük #598-D): runtime MOD DEĞİŞİMİ satırları bu kapıya tabi
 * DEĞİLDİR. `AdaptiveRuntimeManager._commit()` önce modu yazıp sonra logladığı
 * için, `SAFE_MODE`/`BASIC_JS`'e geçişi duyuran satır kapı tarafından
 * yutuluyordu — yani tetikleyici hiçbir iz bırakmıyordu. O satırlar artık
 * `rawConsole` üzerinden, kapıdan bağımsız yazılır. Bkz `rawConsole.ts`.
 */
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { _rawConsoleForGate } from './rawConsole';

let _installed = false;

export function installConsoleGate(): void {
  if (_installed) return;
  if (typeof console === 'undefined') return;
  _installed = true;

  /* `warn`/`info` referansları `rawConsole`dan alınır — "gerçek console"un
     tek sahibi orasıdır; burada ikinci kez yakalamak iki otorite yaratırdı. */
  const orig = {
    log:   console.log.bind(console),
    info:  _rawConsoleForGate.info,
    warn:  _rawConsoleForGate.warn,
    error: console.error.bind(console),
  };

  // loggingLevel runtime config'ten DİNAMİK okunur → mod değişince otomatik uyar.
  const quiet  = (): boolean => {
    const lvl = runtimeManager.getConfig().loggingLevel;
    return lvl === 'error' || lvl === 'silent';
  };
  const silent = (): boolean => runtimeManager.getConfig().loggingLevel === 'silent';

  console.log   = (...a: unknown[]): void => { if (!quiet())  orig.log(...a); };
  console.info  = (...a: unknown[]): void => { if (!quiet())  orig.info(...a); };
  console.warn  = (...a: unknown[]): void => { if (!quiet())  orig.warn(...a); };
  console.error = (...a: unknown[]): void => { if (!silent()) orig.error(...a); };
}
