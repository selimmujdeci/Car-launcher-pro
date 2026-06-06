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
 */
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';

let _installed = false;

export function installConsoleGate(): void {
  if (_installed) return;
  if (typeof console === 'undefined') return;
  _installed = true;

  const orig = {
    log:   console.log.bind(console),
    info:  console.info.bind(console),
    warn:  console.warn.bind(console),
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
