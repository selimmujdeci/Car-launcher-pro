/**
 * Crash Logger — lightweight production error log.
 *
 * - Stores last 50 errors in memory + localStorage
 * - Never throws — safe to call from any error path
 * - Exposes logError(ctx, error) for all platform services
 * - getErrorLog() for debug screen / support exports
 */

import { safeGetRaw, safeSetRawImmediate, safeRemoveRaw, safeLruEvict } from '../utils/safeStorage';

const LOG_KEY    = 'cl_crash_log';
const MAX_ENTRIES = 50;

/**
 * Hata şiddeti — uzak log hattının filtresi:
 *   critical : crash-grade (ErrorBoundary, boot failure) → remote sink'e gider
 *   error    : normal servis hatası (varsayılan)         → yalnız lokal
 *   warning  : bilgi amaçlı                              → yalnız lokal
 */
export type CrashSeverity = 'critical' | 'error' | 'warning';

export interface CrashEntry {
  ts:    number;    // epoch ms
  ctx:   string;    // e.g. 'GPS', 'OBD', 'Media', 'Bridge', 'React'
  msg:   string;    // human-readable error message
  stack?: string;   // stack trace when available
  severity?: CrashSeverity; // yoksa 'error' kabul edilir (eski kayıtlar)
  /** Son 60 saniyeye ait 1Hz araç durumu anlık görüntüleri (kara kutu verisi). */
  replayBuffer?: unknown[];
}

/* ── Kara kutu kayıt deseni (döngüsel bağımlılık önleme) ───────────────── */

/**
 * BlackBoxService başladığında kendi getReplayData() fonksiyonunu buraya kaydeder.
 * crashLogger, blackBoxService'i doğrudan import etmez → döngüsel dep yok.
 */
let _replayGetter: (() => unknown[]) | null = null;

export function registerBlackBoxGetter(getter: () => unknown[]): void {
  _replayGetter = getter;
}

/**
 * Uzak log sink'i — remoteLogService başlarken kendini buraya kaydeder
 * (registerBlackBoxGetter ile aynı desen → crashLogger remoteLogService'i
 * import etmez, döngüsel bağımlılık yok).
 *
 * Sink YALNIZ severity === 'critical' entry'ler için çağrılır —
 * warning/error seviyeleri uzağa gitmez. null → kayıt silinir (cleanup).
 */
let _remoteSink: ((entry: CrashEntry) => void) | null = null;

export function registerRemoteSink(sink: ((entry: CrashEntry) => void) | null): void {
  _remoteSink = sink;
}

let _log: CrashEntry[] = [];
let _loaded = false;

function _ensureLoaded(): void {
  if (_loaded) return;
  _loaded = true;
  try {
    const raw = safeGetRaw(LOG_KEY);
    if (raw) _log = JSON.parse(raw) as CrashEntry[];
  } catch {
    _log = [];
  }
}

function _persist(): void {
  try {
    const trimmed = _log.slice(-MAX_ENTRIES);
    const serialized = JSON.stringify(trimmed);
    // Bypass debounce — crash log must land on disk immediately
    try {
      safeSetRawImmediate(LOG_KEY, serialized);
    } catch {
      // Quota exceeded — evict low-priority data and retry once
      safeLruEvict();
      try { safeSetRawImmediate(LOG_KEY, serialized); } catch { /* give up */ }
    }
    _log = trimmed;
  } catch {
    _log = [];
    try { safeRemoveRaw(LOG_KEY); } catch { /* ignore */ }
  }
}

/**
 * Record an error. Safe to call from any context — never throws.
 *
 * Kara kutu entegrasyonu:
 *   Her hata anında getReplayData() çağrılır → son 60s araç durumu CrashEntry'ye eklenir.
 *   replayBuffer disk'e safeSetRawImmediate ile anında yazılır (uygulama ölmeden önce).
 */
/**
 * Error-olmayan değerleri OKUNUR mesaja çevirir. `String(obj)` → "[object Object]"
 * tanıyı köreltiyordu (SAHA 2026-07-06: geofence Supabase PostgrestError'ı iz'de
 * "[object Object]" göründü). Supabase/fetch hata objelerinden message/code/
 * details/hint çıkarır; olmazsa JSON'a düşer; o da olmazsa String().
 */
function _errToMsg(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const o = error as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof o.message === 'string' && o.message) parts.push(o.message);
    if (typeof o.code === 'string' || typeof o.code === 'number') parts.push(`[${o.code}]`);
    if (typeof o.details === 'string' && o.details) parts.push(o.details);
    if (typeof o.hint === 'string' && o.hint) parts.push(`hint: ${o.hint}`);
    if (parts.length) return parts.join(' ');
    try {
      const j = JSON.stringify(o);
      if (j && j !== '{}') return j.slice(0, 240);
    } catch { /* döngüsel referans → String'e düş */ }
  }
  return String(error);
}

export function logError(ctx: string, error: unknown, severity: CrashSeverity = 'error'): void {
  try {
    _ensureLoaded();
    const msg   = _errToMsg(error);
    const stack = error instanceof Error ? error.stack?.slice(0, 1024) : undefined;

    const entry: CrashEntry = { ts: Date.now(), ctx, msg, stack, severity };

    // Kara kutu replay verisi — kayıtlı getter varsa çağır
    try {
      const replay = _replayGetter?.();
      if (replay && replay.length > 0) entry.replayBuffer = replay;
    } catch {
      // Getter başarısız → sessiz, log yine de yazılır
    }

    _log.push(entry);
    _persist();

    // Uzak sink — YALNIZ critical; sink hatası logger'ı asla düşürmez
    if (severity === 'critical') {
      try { _remoteSink?.(entry); } catch { /* sessiz */ }
    }
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
  safeRemoveRaw(LOG_KEY);
}
