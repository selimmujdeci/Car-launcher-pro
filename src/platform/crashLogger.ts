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

export interface CrashEntry {
  ts:    number;    // epoch ms
  ctx:   string;    // e.g. 'GPS', 'OBD', 'Media', 'Bridge', 'React'
  msg:   string;    // human-readable error message
  stack?: string;   // stack trace when available
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
export function logError(ctx: string, error: unknown): void {
  try {
    _ensureLoaded();
    const msg   = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack?.slice(0, 1024) : undefined;

    const entry: CrashEntry = { ts: Date.now(), ctx, msg, stack };

    // Kara kutu replay verisi — kayıtlı getter varsa çağır
    try {
      const replay = _replayGetter?.();
      if (replay && replay.length > 0) entry.replayBuffer = replay;
    } catch {
      // Getter başarısız → sessiz, log yine de yazılır
    }

    _log.push(entry);
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
  safeRemoveRaw(LOG_KEY);
}
