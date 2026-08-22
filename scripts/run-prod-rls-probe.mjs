#!/usr/bin/env node
/**
 * run-prod-rls-probe — RLS maruziyet probe'unu ÜRETİME karşı koşar (V-15).
 *
 *   npm run test:rls:prod
 *
 * ── NEDEN AYRI ──────────────────────────────────────────────────────────────
 * `npm run test:rls` YEREL veritabanına bakar. Yerel yeşil, prod yeşil demek
 * DEĞİLDİR — ölçümde prod'da 17 tabloda `anon` GRANT'i vardı, yerelde 12.
 *
 * ── BAŞARI DA HATA OLARAK DÖNER ────────────────────────────────────────────
 * `supabase db query` bir DO bloğunun NOTICE çıktısını göstermez; probe hem
 * başarıyı hem düşüşü `RAISE EXCEPTION` ile bildirir (böylece işlem geri alınır
 * ve üretimde iz kalmaz). Bu yüzden bu betik ÇIKIŞ KODUNA değil MESAJA bakar:
 *   `PROD_RLS_OK`     → geçti
 *   `PROD RLS DUSTU`  → düştü
 *   ikisi de yok      → KOŞULAMADI (yeşil raporlanmaz)
 *
 * Probe salt-okunurdur: yalnız satır VARLIĞI sorar, hiçbir şey yazmaz.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL_REL = 'supabase/tests/063b_prod_rls_probe.sql';
const SQL_FILE = resolve(SQL_REL);

function die(msg) {
  console.error(`\n  PROD RLS PROBE KOŞULAMADI — KANIT YOK (geçti SAYILMAZ)\n  ${msg}\n`);
  process.exit(1);
}

if (!existsSync(SQL_FILE)) die(`Probe dosyası bulunamadı: ${SQL_FILE}`);

/* SQL argüman olarak DEĞİL `-f` ile geçilir: çok satırlı ve kutu karakterli bir
   metni kabuk argümanı yapmak Windows'ta tırnaklamayı bozuyor ve yorum satırları
   SQL gövdesine sızıyordu. Yol GÖRECELİ verilir: proje dizini boşluk içeriyor
   ("caros pro") ve `shell: true` altında mutlak yol ikiye bölünüyordu. */
const run = spawnSync('supabase', ['db', 'query', '--linked', '-f', SQL_REL],
  { encoding: 'utf8', shell: process.platform === 'win32' });

if (run.error) die(`supabase CLI çalıştırılamadı: ${run.error.message}`);

const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;

if (out.includes('PROD RLS DUSTU')) {
  const line = out.split('\n').find((l) => l.includes('PROD RLS DUSTU')) ?? '';
  console.error(`\n  ✖ ÜRETİMDE RLS MARUZİYETİ VAR\n  ${line.trim()}\n`);
  process.exit(2);
}

if (!out.includes('PROD_RLS_OK')) {
  die(`Probe ne başarı ne düşüş bildirdi — bağlantı ya da yetki sorunu olabilir.\n  Çıktı: ${out.trim().slice(0, 400)}`);
}

const detail = (out.match(/PROD_RLS_OK\|[^"\\\n]*/) ?? [''])[0];
console.log(`\n  ✔ Üretimde anon maruziyeti YOK.\n  ${detail}`);
console.log('  Not: "kanitlanamadi" = tablo BOŞ olduğu için koruma KANITLANAMADI — geçti sayılmaz.\n');
