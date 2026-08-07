/**
 * fleetAnonGrantMigration.test.ts — MIGRATION 037 SÖZLEŞME KİLİDİ.
 *
 * Bu test SQL'i ÇALIŞTIRMAZ (canlı doğrulama geçici PostgreSQL'de yapıldı:
 * `supabase/verification/local_037_verify.sql`). Burada kilitlenen şey,
 * migration dosyasının SÖZLEŞMESİDİR — bir sonraki düzenleme sessizce
 * head unit'i kıran veya kapsamı genişleten bir değişiklik getirmesin.
 *
 * En kritik kilit: 037 araç tablolarına DOKUNMAMALIDIR. Head unit
 * (commandListener.ts) `vehicles` ve `vehicle_commands` tablolarına
 * anon key ile DOĞRUDAN erişir; oradaki GRANT geri alınırsa araç komut
 * almayı bırakır.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE_NAME = '20260729000037_anon_grant_defense_in_depth.sql';

/** Koşucu kökten de website'ten de başlatılabilir — iki yolu da dene. */
const SQL_PATH = [
  resolve(process.cwd(), '..', 'supabase', 'migrations', FILE_NAME),
  resolve(process.cwd(), 'supabase', 'migrations', FILE_NAME),
].find(existsSync);

const SQL = SQL_PATH ? readFileSync(SQL_PATH, 'utf8') : '';

/** Yorum satırlarını atar — kilitler YALNIZ çalıştırılabilir SQL'e bakar. */
const EXECUTABLE = SQL.split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('migration 037 · kapsam sözleşmesi', () => {
  it('migration dosyası BULUNUR — sessizce boş sözleşme test edilmez', () => {
    expect(SQL_PATH).toBeTruthy();
    expect(SQL.length).toBeGreaterThan(500);
  });

  it('yalnız profiles ve companies daraltılır', () => {
    expect(EXECUTABLE).toMatch(/REVOKE ALL ON public\.profiles\s+FROM anon/);
    expect(EXECUTABLE).toMatch(/REVOKE ALL ON public\.companies\s+FROM anon/);
  });

  it('🔴 ARAÇ TABLOLARINA DOKUNMAZ — head unit anon erişimi korunur', () => {
    for (const table of ['vehicles', 'vehicle_commands', 'vehicle_locations', 'vehicle_events']) {
      expect(EXECUTABLE).not.toMatch(new RegExp(`REVOKE[^;]*\\bpublic\\.${table}\\b`, 'i'));
    }
  });

  it('authenticated ve service_role ayrıcalıklarına DOKUNMAZ', () => {
    expect(EXECUTABLE).not.toMatch(/REVOKE[^;]*FROM\s+authenticated/i);
    expect(EXECUTABLE).not.toMatch(/REVOKE[^;]*FROM\s+service_role/i);
  });

  it('RLS politikalarına DOKUNMAZ (GRANT daraltma ≠ politika değişimi)', () => {
    expect(EXECUTABLE).not.toMatch(/CREATE POLICY/i);
    expect(EXECUTABLE).not.toMatch(/DROP POLICY/i);
    expect(EXECUTABLE).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
  });

  it('veri yazmaz / şema değiştirmez', () => {
    expect(EXECUTABLE).not.toMatch(/\b(INSERT INTO|UPDATE\s+public\.|DELETE FROM|DROP TABLE|TRUNCATE)\b/i);
  });
});

describe('migration 037 · güvenlik davranışı', () => {
  it('tek işlemdir — kısmi uygulama olamaz', () => {
    expect(EXECUTABLE).toMatch(/^\s*BEGIN;/m);
    expect(EXECUTABLE).toMatch(/^\s*COMMIT;/m);
  });

  it('RLS kapalıysa FAIL-CLOSED durur', () => {
    expect(EXECUTABLE).toMatch(/RLS_KAPALI/);
    expect(EXECUTABLE).toMatch(/rowsecurity\s*=\s*false/);
  });

  it('uygulama sonrası kendini doğrular ve düşerse EXCEPTION atar', () => {
    expect(EXECUTABLE).toMatch(/DOĞRULAMA DÜŞTÜ/);
    expect(EXECUTABLE).toMatch(/RAISE EXCEPTION/);
  });

  it('authenticated yan hasarını ayrıca doğrular', () => {
    expect(EXECUTABLE).toMatch(/YAN HASAR/);
  });

  it('PUBLIC rolünden de geri alır (dolaylı devralma kapatılır)', () => {
    expect(EXECUTABLE).toMatch(/REVOKE ALL ON public\.profiles\s+FROM PUBLIC/);
    expect(EXECUTABLE).toMatch(/REVOKE ALL ON public\.companies\s+FROM PUBLIC/);
  });
});

describe('migration 037 · dürüstlük', () => {
  it('production ortamına UYGULANMADIĞI dosyada açıkça yazılıdır', () => {
    expect(SQL).toMatch(/PRODUCTION'A UYGULANMADI/);
  });

  it('FAZ 2 borcu ve gerekçesi belgelenmiştir', () => {
    expect(SQL).toMatch(/FAZ 2/);
    expect(SQL).toMatch(/commandListener\.ts/);
  });

  it('geri alma yolu belgelenmiştir', () => {
    expect(SQL).toMatch(/ROLLBACK/);
  });
});
