#!/usr/bin/env node
/**
 * run-db-matrix — bir SQL matrisini YEREL PostgreSQL'e karşı koşar.
 *
 *   node scripts/run-db-matrix.mjs <sql-dosyasi> "<basari-imzasi>"
 *
 *   npm run test:rls   → 063  RLS maruziyet matrisi
 *   npm run test:dna   → 064  Driver DNA zinciri
 *
 * ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
 * Docker yoksa, konteyner ayakta değilse ya da psql patlarsa bu betik
 * SIFIR DÖNMEZ. "Koşamadım" ile "geçti" AYRI şeylerdir; kanıt üretilemediğinde
 * yeşil raporlamak, kapıyı tiyatroya çevirir.
 *
 * psql `ON_ERROR_STOP` ile 0 dönse bile başarı imzası çıktıda ARANIR — matris
 * sessizce atlanmış olabilir (ör. dosya boşalmış, bloklar hiç koşmamış).
 *
 * Matris dosyaları salt-okunurdur (ROLLBACK ile biterler); bu betik
 * veritabanına kalıcı hiçbir şey yazmaz.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const [sqlPath, marker] = process.argv.slice(2);

/** Yerel Supabase yığınının veritabanı konteyneri. */
const CONTAINER = process.env.CAROS_SUPABASE_DB_CONTAINER ?? 'supabase_db_fleetval';

function die(msg) {
  console.error(`\n  MATRİS KOŞULAMADI — KANIT YOK (geçti SAYILMAZ)\n  ${msg}\n`);
  process.exit(1);
}

if (!sqlPath || !marker) die('Kullanım: run-db-matrix.mjs <sql-dosyasi> "<basari-imzasi>"');

const abs = resolve(sqlPath);
if (!existsSync(abs)) die(`Matris dosyası bulunamadı: ${abs}`);

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
  { input: readFileSync(abs, 'utf8'), encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
);

const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
process.stdout.write(out);

if (run.status !== 0) {
  console.error('\n  ✖ MATRİS DÜŞTÜ — yukarıdaki KAPI/HALKA mesajını oku.\n');
  process.exit(run.status ?? 1);
}

if (!out.includes(marker)) {
  die(`psql 0 döndü ama başarı imzası çıktıda YOK: "${marker}"\n  Matris sessizce atlanmış olabilir.`);
}

console.log(`\n  ✔ ${marker}\n`);
