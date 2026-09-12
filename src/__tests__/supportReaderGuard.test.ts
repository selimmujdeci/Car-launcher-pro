/**
 * supportReaderGuard.test.ts — SUPPORT-READ-1 sızıntı kilidi (CI guard).
 *
 * "rapor geldi kontrol et" kapısının GÜVENLİK invaryantları:
 *  1. Token dosyası (.env.support.local) .gitignore ile korunur (asla commit edilmez).
 *  2. İstemci script'i SIR İÇERMEZ ve token'ı YALNIZ env'den okur.
 *  3. Şema tarafı SIR İÇERMEZ; token bcrypt ile doğrulanır.
 *
 * ── HEDEF DEĞİŞİKLİĞİ (kütük #588) ────────────────────────────────────────
 * Şema iddiaları eskiden `20260714000033_support_reports_reader.sql` dosyasını
 * okuyordu; #583'ün baseline squash'ı onu `supabase/migrations_archive/`'e
 * taşıyınca bu test **dosya bulunamadı** diye düşüyordu — sızıntı kilidi ölüydü.
 * Şema iddiaları artık `00000000000000_prod_baseline.sql` üzerinden, yani
 * **üretimin gerçeği** üzerinden sınanıyor (kapının derinlemesine kilitleri
 * `prodBaselineSecurityGuards.test.ts` içinde).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import baselineSql from '../../supabase/migrations/00000000000000_prod_baseline.sql?raw';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const SCRIPT = 'scripts/support/fetch-reports.mjs';

/** JWT (eyJ…) veya bcrypt hash ($2a/$2b/$2y$) literal'i = sızıntı. */
const SECRET_LITERAL = /eyJ[A-Za-z0-9_-]{20,}|\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{20,}/;

describe('SUPPORT-READ-1 — sızıntı kilidi', () => {
  it('.env.support.local .gitignore ile kapsanır', () => {
    const gi = read('.gitignore');
    // `.env.*.local` veya `*.local` kuralı `.env.support.local`i yakalar.
    expect(/\.env\.\*\.local|^\*\.local/m.test(gi)).toBe(true);
  });

  it('KİLİT: şema SIR içermez (JWT/bcrypt hash yok) + token guard var', () => {
    expect(SECRET_LITERAL.test(baselineSql)).toBe(false);
    // Token bcrypt ile doğrulanıyor — düz metin karşılaştırma YOK.
    expect(baselineSql).toMatch(/crypt\(p_secret/);
    // Okuma yalnız destek anlık görüntüleriyle sınırlı — genel olay okuyucusu değil.
    expect(baselineSql).toMatch(/e\.type = 'support_snapshot'/);
  });

  it('istemci script SIR içermez + token YALNIZ env\'den okunur', () => {
    const js = read(SCRIPT);
    expect(SECRET_LITERAL.test(js)).toBe(false);
    expect(js).toMatch(/env\.SUPPORT_SECRET/);          // env'den
    // hardcoded p_secret ataması olmamalı (yalnız değişkenden)
    expect(/p_secret:\s*['"]/.test(js)).toBe(false);
  });
});
