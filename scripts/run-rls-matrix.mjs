#!/usr/bin/env node
/**
 * run-rls-matrix — RLS maruziyet matrisini gerçek PostgreSQL'e karşı koşar (V-15).
 *
 *   npm run test:rls
 *
 * ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
 * Docker yoksa, konteyner ayakta değilse ya da psql patlarsa bu betik
 * SIFIR DÖNMEZ. "Koşamadım" ile "geçti" AYRI şeylerdir; kanıt üretilemediğinde
 * yeşil raporlamak, güvenlik kapısını tiyatroya çevirir.
 *
 * Matris dosyası salt-okunurdur (ROLLBACK ile biter); bu betik veritabanına
 * kalıcı hiçbir şey yazmaz.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL_FILE = resolve('supabase/tests/063_rls_exposure_matrix.sql');
/** Yerel Supabase yığınının veritabanı konteyneri. */
const CONTAINER = process.env.CAROS_SUPABASE_DB_CONTAINER ?? 'supabase_db_fleetval';

function die(msg) {
  console.error(`\n  RLS MATRİSİ KOŞULAMADI — KANIT YOK (geçti SAYILMAZ)\n  ${msg}\n`);
  process.exit(1);
}

if (!existsSync(SQL_FILE)) die(`Matris dosyası bulunamadı: ${SQL_FILE}`);

const ps = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
if (ps.error || ps.status !== 0) {
  die('Docker çalışmıyor ya da erişilemiyor. Yerel Supabase: `supabase start`');
}
if (!ps.stdout.split('\n').some((n) => n.trim() === CONTAINER)) {
  die(`Konteyner ayakta değil: ${CONTAINER}\n  Çalışanlar: ${ps.stdout.trim().split('\n').join(', ') || '(yok)'}`);
}

const run = spawnSync(
  'docker',
  ['exec', '-i', '-e', 'PGPASSWORD=postgres', CONTAINER,
   'psql', '-U', 'postgres', '-d', 'postgres'],
  { input: readFileSync(SQL_FILE, 'utf8'), encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
);

const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
process.stdout.write(out);

if (run.status !== 0) {
  console.error('\n  ✖ RLS MATRİSİ DÜŞTÜ — yukarıdaki KAPI mesajını oku.\n');
  process.exit(run.status ?? 1);
}

/* psql, ON_ERROR_STOP ile 0 dönerken bile bir uyarı bırakmış olabilir;
   kapıların GERÇEKTEN koştuğunu çıktıdan doğrula (sessiz atlama olmasın). */
if (!out.includes('4 KAPI DA GECTI')) {
  die('psql 0 döndü ama kapı bildirimi çıktıda YOK — matris sessizce atlanmış olabilir.');
}

console.log('\n  ✔ RLS maruziyet matrisi: 4 kapı da geçti.\n');
