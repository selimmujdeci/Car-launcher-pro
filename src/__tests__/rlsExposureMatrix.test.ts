/**
 * rlsExposureMatrix.test.ts — V-15 RLS maruziyet matrisinin KİLİTLERİ.
 *
 * ── NEDEN BU DOSYA VAR ──────────────────────────────────────────────────────
 * Asıl matris gerçek PostgreSQL'e karşı koşar (`npm run test:rls`) ve Docker
 * gerektirir. Bu vitest dosyası onun YERİNE geçmez; matrisin KENDİSİNİ korur.
 *
 * Bir güvenlik kapısının en zayıf noktası, kapının izin listesidir: `vehicles`
 * satırını izin listesine eklemek kapıyı sessizce SUSTURUR ve hiçbir test
 * düşmez. Aşağıdaki kilitler tam olarak bunu engeller — Docker'sız CI'da da
 * koşarlar.
 *
 * KANIT (mutasyonla doğrulandı, 2026-08-22, yerel PostgreSQL):
 *   · `vehicles` anon'a `USING (true)`      → KAPI 1 düştü
 *   · `vehicle_telemetry` anon INSERT açıldı → KAPI 2 düştü
 *   · `vehicle_trips` RLS kapatıldı          → KAPI 3 düştü
 * Üçü de doğru tablo adıyla düştü ve ROLLBACK sayesinde kalıcı iz bırakmadı.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(resolve(process.cwd(), 'supabase/tests/063_rls_exposure_matrix.sql'), 'utf8');

/** İzin listesi bloğundan (rol, tablo) çiftlerini çıkarır. */
function allowlistPairs(): ReadonlyArray<readonly [string, string]> {
  const start = SQL.indexOf('INSERT INTO read_allowlist VALUES');
  expect(start).toBeGreaterThan(-1);
  const block = SQL.slice(start, SQL.indexOf('CREATE TEMP TABLE rls_matrix', start));
  /* Yorum satırları ayıklanır: gerekçeler tablo adı içerebilir. */
  const code = block.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
  return [...code.matchAll(/\(\s*'(anon|authenticated)'\s*,\s*'([a-z0-9_]+)'/g)]
    .map((m) => [m[1], m[2]] as const);
}

/**
 * İMZALI izin listesi. Bu sabiti değiştirmek, "bu tablonun içeriği kimlik
 * doğrulanmadan görülebilir" diye imza atmaktır — bilinçli bir karardır.
 */
const SIGNED: ReadonlyArray<readonly [string, string]> = [
  ['anon', 'feature_flags'],
  ['anon', 'runtime_policies'],
  ['anon', 'ota_releases'],
  ['authenticated', 'feature_flags'],
  ['authenticated', 'runtime_policies'],
  ['authenticated', 'ota_releases'],
  ['authenticated', 'ai_evidence_adapter_state'],
];

/** Hiçbir koşulda kimliksiz okunmaması gereken tablolar. */
const NEVER_PUBLIC = [
  'vehicles', 'vehicle_locations', 'vehicle_telemetry', 'vehicle_commands',
  'vehicle_events', 'vehicle_pairings', 'vehicle_trips', 'vehicle_identity',
  'vehicle_geofences', 'vehicle_ownership_transfers', 'vehicle_linking_codes',
  'vehicle_driver_assignments', 'vehicle_driver_authentication',
  'vehicle_driver_presence', 'vehicle_driver_presence_history',
  'profiles', 'companies', 'fleet_drivers', 'fleet_health', 'fleet_insight',
  'fleet_trend', 'driver_dna', 'driver_dna_trip', 'audit_logs',
  'push_subscriptions', 'key_beams', 'support_reader_secret',
] as const;

describe('RLS maruziyet matrisi › izin listesi', () => {
  it('izin listesi İMZALI kümeden BÜYÜK DEĞİL', () => {
    const actual = allowlistPairs().map(([r, t]) => `${r}:${t}`).sort();
    const signed = SIGNED.map(([r, t]) => `${r}:${t}`).sort();
    /* Fazlası varsa: biri kapıyı susturmak için tablo eklemiş. */
    expect(actual).toEqual(signed);
  });

  it('kiracıya-özgü hiçbir tablo izin listesinde OLAMAZ', () => {
    const listed = new Set(allowlistPairs().map(([, t]) => t));
    for (const t of NEVER_PUBLIC) expect(listed.has(t)).toBe(false);
  });
});

describe('RLS maruziyet matrisi › kapılar yerinde', () => {
  it('dört kapı da EXCEPTION fırlatır — WARNING ile geçiştirilmez', () => {
    for (const g of [1, 2, 3, 4]) {
      expect(SQL).toMatch(new RegExp(`RAISE EXCEPTION 'RLS KAPI ${g} DUSTU`));
    }
  });

  it('kapı dördü KİMLİKSİZ authenticated okumasını yakalar (038 sınıfı)', () => {
    const gate = SQL.slice(SQL.indexOf('KAPI 4'), SQL.indexOf('RLS KAPI 4 DUSTU'));
    expect(gate).toMatch(/role_name = 'authenticated'/);
    expect(gate).toMatch(/select_v = 'EXPOSED'/);
  });

  it('`ON_ERROR_STOP` açık — kapı düşünce dosya HATA ile biter', () => {
    expect(SQL).toMatch(/\\set ON_ERROR_STOP on/);
  });

  it('matris SALT-OKUNUR: ROLLBACK ile biter, COMMIT ETMEZ', () => {
    expect(SQL.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    expect(SQL).not.toMatch(/^\s*COMMIT;/m);
  });
});

describe('RLS maruziyet matrisi › sahte 0 tuzağı', () => {
  it('boş tablo GEÇTİ sayılmaz — UNPROVEN ayrı bir hüküm', () => {
    /* `anon 0 satır gördü` KORUMA KANITI DEĞİLDİR: tablo boş da olabilir. */
    expect(SQL).toMatch(/WHEN ns = 0 THEN 'UNPROVEN'/);
    /* UNPROVEN, DENIED sayılıp kapıdan geçirilmemeli. */
    const gate1 = SQL.slice(SQL.indexOf('KAPI 1 —'), SQL.indexOf('RLS KAPI 1 DUSTU'));
    expect(gate1).not.toMatch(/UNPROVEN/);
  });

  it('özet raporu kanıtlanamayanı AYRI sütunda sayar', () => {
    expect(SQL).toMatch(/select_v = 'UNPROVEN'\).*AS kanitlanamadi/);
  });
});

describe('RLS maruziyet matrisi › koşucu fail-closed', () => {
  /* Koşucu GENELDİR: 063 (RLS) ve 064 (Driver DNA) aynı betikle koşar.
     İki ayrı koşucu tutmak, tam da bu projede tekrar tekrar bulduğumuz
     "iki otorite" desenini üretirdi. */
  const RUNNER = readFileSync(resolve(process.cwd(), 'scripts/run-db-matrix.mjs'), 'utf8');
  const PKG = readFileSync(resolve(process.cwd(), 'package.json'), 'utf8');

  it('Docker/konteyner yoksa SIFIR DÖNMEZ — "koşamadım" ≠ "geçti"', () => {
    expect(RUNNER).toMatch(/process\.exit\(1\)/);
    expect(RUNNER).toMatch(/Docker çalışmıyor/);
    expect(RUNNER).toMatch(/Konteyner ayakta değil/);
  });

  it('psql 0 dönse bile BAŞARI İMZASI çıktıda ARANIR (sessiz atlama yok)', () => {
    expect(RUNNER).toMatch(/out\.includes\(marker\)/);
  });

  it('npm betikleri doğru matrisi ve doğru imzayı geçiriyor', () => {
    /* İmza yanlış yazılırsa koşucu "kanıt yok" der ve DÜŞER — sessizce
       yeşile dönmez; bu kilit imzanın gerçek olanla eşleştiğini korur. */
    expect(PKG).toContain('063_rls_exposure_matrix.sql');
    expect(PKG).toContain('4 KAPI DA GECTI');
    expect(SQL).toContain('4 KAPI DA GECTI');
  });
});
