/**
 * SqliteEngine — Lazy-loaded sql.js WASM engine for offline POI search.
 *
 * Lifecycle:
 *   • DB is opened only on first query (lazy load)
 *   • WASM module is initialized once and reused
 *   • On MODERATE memory pressure → DB is closed, WASM stays warm
 *   • On CRITICAL memory pressure → DB + WASM both released
 *
 * The DB file is fetched from /maps/search.db via HTTP Range requests.
 * If the file does not exist (404), SqliteEngine stays dormant (no error thrown).
 */

import type { SqlJsStatic, Database } from 'sql.js';
import { registerCachePurge } from '../memoryWatchdog';
import { onMemoryPressure }    from '../memoryWatchdog';

/* ── Constants ───────────────────────────────────────────────────────────── */

const DB_URL      = '/maps/search.db';
const WASM_URL    = '/sql-wasm/sql-wasm.wasm';

/* ── Module state ─────────────────────────────────────────────────────────── */

let _SQL:      SqlJsStatic | null = null;
let _db:       Database    | null = null;
let _initPromise: Promise<SqlJsStatic> | null = null;
let _dbPromise:   Promise<Database | null> | null = null;
let _memCleanup:  (() => void) | null = null;

/* ── sql.js WASM initializer ──────────────────────────────────────────────── */

async function _ensureSQL(): Promise<SqlJsStatic> {
  if (_SQL) return _SQL;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const initSqlJs = (await import('sql.js')).default;
    _SQL = await initSqlJs({ locateFile: () => WASM_URL });
    return _SQL;
  })();

  return _initPromise;
}

/* ── DB loader ────────────────────────────────────────────────────────────── */

async function _openDB(): Promise<Database | null> {
  if (_db) return _db;
  if (_dbPromise) return _dbPromise;

  _dbPromise = (async () => {
    try {
      const res = await fetch(DB_URL);
      if (!res.ok) return null; // search.db yok — sessiz kalıp döner

      const buf = await res.arrayBuffer();
      const SQL = await _ensureSQL();
      _db = new SQL.Database(new Uint8Array(buf));
      return _db;
    } catch {
      return null;
    } finally {
      _dbPromise = null;
    }
  })();

  return _dbPromise;
}

/* ── Memory pressure integration ─────────────────────────────────────────── */

function _closeDB(): void {
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
    _db = null;
  }
  _dbPromise = null;
}

function _releaseAll(): void {
  _closeDB();
  _SQL = null;
  _initPromise = null;
}

function _startMemoryGuard(): void {
  if (_memCleanup) return;

  const unsubPressure = onMemoryPressure((evt) => {
    if (evt.level === 'CRITICAL') {
      _releaseAll();
    } else {
      _closeDB();
    }
  });

  const unsubCache = registerCachePurge(_closeDB);

  _memCleanup = () => {
    unsubPressure();
    unsubCache();
  };
}

/* ── Public API ───────────────────────────────────────────────────────────── */

export interface SqlRow {
  [column: string]: string | number | null | Uint8Array;
}

/**
 * Execute a read-only SQL query against the POI DB.
 * Returns an empty array if:
 *   - search.db is not found (no error thrown)
 *   - a SQL error occurs
 *   - the WASM module fails to load
 */
export async function sqlQuery(sql: string, params: (string | number)[] = []): Promise<SqlRow[]> {
  _startMemoryGuard();

  const db = await _openDB();
  if (!db) return [];

  try {
    const stmt    = db.prepare(sql);
    const results: SqlRow[] = [];
    stmt.bind(params);
    while (stmt.step()) {
      results.push(stmt.getAsObject() as SqlRow);
    }
    stmt.free();
    return results;
  } catch {
    return [];
  }
}

/**
 * Force close the DB and release memory.
 * WASM module stays loaded for fast re-open.
 */
export function closeSqliteDb(): void {
  _closeDB();
}

/**
 * Returns true if the DB is currently open and ready.
 */
export function isSqliteOpen(): boolean {
  return _db !== null;
}
