/**
 * Crash Logger — lightweight production error log.
 *
 * - Stores last 50 errors in memory + localStorage
 * - Never throws — safe to call from any error path
 * - Exposes logError(ctx, error) for all platform services
 * - getErrorLog() for debug screen / support exports
 */

const LOG_KEY    = 'cl_crash_log';
const MAX_ENTRIES = 50;

export interface CrashEntry {
  ts:    number;    // epoch ms
  ctx:   string;    // e.g. 'GPS', 'OBD', 'Media', 'Bridge', 'React'
  msg:   string;    // human-readable error message
  stack?: string;   // stack trace when available
}

let _log: CrashEntry[] = [];
let _loaded = false;

function _ensureLoaded(): void {
  if (_loaded) return;
  _loaded = true;
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (raw) _log = JSON.parse(raw) as CrashEntry[];
  } catch {
    _log = [];
  }
}

function _persist(): void {
  try {
    const trimmed = _log.slice(-MAX_ENTRIES);
    localStorage.setItem(LOG_KEY, JSON.stringify(trimmed));
    _log = trimmed;
  } catch {
    // localStorage quota exhausted — reset silently
    _log = [];
    try { localStorage.removeItem(LOG_KEY); } catch { /* ignore */ }
  }
}

/**
 * Record an error. Safe to call from any context — never throws.
 */
export function logError(ctx: string, error: unknown): void {
  try {
    _ensureLoaded();
    const msg   = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack   : undefined;
    _log.push({ ts: Date.now(), ctx, msg, stack });
    _persist();
  } catch {
    // Even the logger itself must not crash
  }
  // Always surface to native WebView console for adb logcat visibility
  console.error(`[CarLauncher:${ctx}]`, error);
}

/**
 * Returns a snapshot of all stored crash entries.
 */
export function getErrorLog(): CrashEntry[] {
  _ensureLoaded();
  return [..._log];
}

/**
 * Wipe stored log — e.g. after user submits a bug report.
 */
export function clearErrorLog(): void {
  _log = [];
  try { localStorage.removeItem(LOG_KEY); } catch { /* ignore */ }
}
