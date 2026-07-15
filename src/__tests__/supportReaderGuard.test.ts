/**
 * supportReaderGuard.test.ts — SUPPORT-READ-1 sızıntı kilidi (CI guard).
 *
 * "rapor geldi kontrol et" kapısının GÜVENLİK invaryantları:
 *  1. Token dosyası (.env.support.local) .gitignore ile korunur (asla commit edilmez).
 *  2. Migration + istemci script'i SIR İÇERMEZ (JWT / bcrypt hash / hardcoded token yok).
 *  3. İstemci token'ı YALNIZ env'den okur (SUPPORT_SECRET), gövdeye gömmez.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const MIGRATION = 'supabase/migrations/20260714000033_support_reports_reader.sql';
const SCRIPT = 'scripts/support/fetch-reports.mjs';

/** JWT (eyJ…) veya bcrypt hash ($2a/$2b/$2y$) literal'i = sızıntı. */
const SECRET_LITERAL = /eyJ[A-Za-z0-9_-]{20,}|\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{20,}/;

describe('SUPPORT-READ-1 — sızıntı kilidi', () => {
  it('.env.support.local .gitignore ile kapsanır', () => {
    const gi = read('.gitignore');
    // `.env.*.local` veya `*.local` kuralı `.env.support.local`i yakalar.
    expect(/\.env\.\*\.local|^\*\.local/m.test(gi)).toBe(true);
  });

  it('migration SIR içermez (JWT/bcrypt hash yok) + token guard var', () => {
    const sql = read(MIGRATION);
    expect(SECRET_LITERAL.test(sql)).toBe(false);
    expect(sql).toMatch(/crypt\(p_secret/);            // token bcrypt ile doğrulanıyor
    expect(sql).toMatch(/type\s*=\s*'support_snapshot'/); // yalnız support_snapshot
  });

  it('istemci script SIR içermez + token YALNIZ env\'den okunur', () => {
    const js = read(SCRIPT);
    expect(SECRET_LITERAL.test(js)).toBe(false);
    expect(js).toMatch(/env\.SUPPORT_SECRET/);          // env'den
    // hardcoded p_secret ataması olmamalı (yalnız değişkenden)
    expect(/p_secret:\s*['"]/.test(js)).toBe(false);
  });
});
