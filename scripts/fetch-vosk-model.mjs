#!/usr/bin/env node
/**
 * fetch-vosk-model.mjs — Vosk Türkçe offline STT modelini indirir + doğrular.
 *
 * Model (57 MB binary) git'e ALINMAZ (bkz. .gitignore, docs/VOSK_MODEL_SETUP.md).
 * Bu script modeli bir mirror/URL'den indirir, açar ve içerik bütünlüğünü
 * scripts/vosk-model-tr.sha256 manifest'ine göre (her dosya SHA256) doğrular.
 *
 * Model caros'a özel REPACKAGE'dir (uuid: caros-vosk-model-tr-0.3-20260605b,
 * small-tr-0.3 tabanlı, standart yapıya taşınmış) → upstream alphacephei zip ile
 * byte-eş DEĞİLDİR. Bu yüzden indirme kaynağı kendi mirror'ınız olmalıdır.
 *
 * Ortam değişkenleri:
 *   VOSK_MODEL_URL     (zorunlu, indirme için) — .zip / .tar.gz mirror adresi.
 *   VOSK_MODEL_SHA256  (opsiyonel) — indirilen ARŞİV dosyasının SHA256'sı; verilirse
 *                      açmadan önce arşiv bütünlüğü de kontrol edilir.
 *
 * Kullanım:
 *   node scripts/fetch-vosk-model.mjs           # yoksa indir+doğrula, varsa sadece doğrula
 *   VOSK_MODEL_URL=https://… node scripts/fetch-vosk-model.mjs
 *
 * Çıkış kodu: 0 = model yerinde ve doğrulandı · 1 = hata (indirilemedi/bozuk/eksik).
 */

import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, createReadStream,
  rmSync, readdirSync, statSync, copyFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const MODEL_DIR = join(REPO_ROOT, 'android', 'app', 'src', 'main', 'assets', 'vosk-model-tr');
const MANIFEST  = join(__dirname, 'vosk-model-tr.sha256');
const MODEL_UUID = 'caros-vosk-model-tr-0.3-20260605b';

const URL    = process.env.VOSK_MODEL_URL    || '';
const ARCHIVE_SHA = (process.env.VOSK_MODEL_SHA256 || '').trim().toLowerCase();

/* ── Yardımcılar ───────────────────────────────────────────────────────────── */

const log  = (m) => console.log(`[vosk] ${m}`);
const fail = (m) => { console.error(`[vosk] HATA: ${m}`); process.exit(1); };

/** Bir dosyanın SHA256 hex digest'ini (stream ile, bellek dostu) hesaplar. */
function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = createReadStream(path);
    s.on('error', reject);
    s.on('data', (chunk) => h.update(chunk));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

/** Manifest'i ayrıştırır → [{ hash, rel }]. Format: "<sha256>  <relpath>". */
function parseManifest() {
  if (!existsSync(MANIFEST)) fail(`manifest bulunamadı: ${MANIFEST}`);
  return readFileSync(MANIFEST, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([0-9a-f]{64})\s+(.+)$/i);
      if (!m) fail(`manifest satırı geçersiz: "${line}"`);
      return { hash: m[1].toLowerCase(), rel: m[2] };
    });
}

/** MODEL_DIR'i manifest'e göre doğrular. { ok, problems[] } döner. */
async function verifyModel() {
  const entries = parseManifest();
  const problems = [];
  if (!existsSync(MODEL_DIR)) return { ok: false, problems: ['model dizini yok'] };
  for (const { hash, rel } of entries) {
    const p = join(MODEL_DIR, rel.split('/').join(sep));
    if (!existsSync(p)) { problems.push(`eksik: ${rel}`); continue; }
    const got = await sha256File(p);
    if (got !== hash) problems.push(`bozuk: ${rel} (beklenen ${hash.slice(0, 12)}…, gelen ${got.slice(0, 12)}…)`);
  }
  return { ok: problems.length === 0, problems };
}

/** URL'den dosyayı stream ile diske indirir (Node global fetch). */
async function download(url, dest) {
  log(`indiriliyor: ${url}`);
  const res = await fetch(url);
  if (!res.ok) fail(`indirme başarısız: HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  log(`indirildi: ${(buf.length / 1048576).toFixed(1)} MB`);
}

/** Arşivi geçici dizine açar. .zip ve .tar.gz destekler (tar → fallback PowerShell). */
function extract(archive, outDir) {
  mkdirSync(outDir, { recursive: true });
  // bsdtar (Win10+/git-bash) -xf hem .tar.gz hem .zip auto-detect eder.
  try {
    execFileSync('tar', ['-xf', archive, '-C', outDir], { stdio: 'pipe' });
    return;
  } catch { /* tar yoksa/başarısızsa zip fallback dene */ }
  if (/\.zip$/i.test(archive)) {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${outDir}' -Force`], { stdio: 'pipe' });
    return;
  }
  fail('arşiv açılamadı (tar yok ve .zip değil).');
}

/** outDir altında model kökünü (am/final.mdl içeren dizin) bulur. */
function findModelRoot(outDir) {
  const stack = [outDir];
  while (stack.length) {
    const d = stack.pop();
    if (existsSync(join(d, 'am', 'final.mdl')) && existsSync(join(d, 'conf', 'model.conf'))) return d;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) stack.push(p);
    }
  }
  return null;
}

/** src dizinini MODEL_DIR'e kopyalar (recursive). */
function copyTree(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    const d = join(dst, name);
    if (statSync(s).isDirectory()) copyTree(s, d);
    else copyFileSync(s, d);
  }
}

/* ── Ana akış ───────────────────────────────────────────────────────────────── */

async function main() {
  // 1) Zaten yerinde ve doğru mu? → idempotent, indirme yok.
  const pre = await verifyModel();
  if (pre.ok) { log(`model mevcut ve doğrulandı (${MODEL_UUID}). İndirme atlandı.`); return; }

  // 2) Yoksa/bozuksa indir. URL şart (caros repackage → kendi mirror'ınız).
  if (!URL) {
    console.error([
      '[vosk] Model eksik/bozuk ve VOSK_MODEL_URL tanımsız.',
      '[vosk] Modeli indirmek için mirror adresinizi verin:',
      '[vosk]   VOSK_MODEL_URL=https://<mirror>/vosk-model-tr.tar.gz npm run fetch:vosk',
      '[vosk] (Model caros repackage; upstream alphacephei zip yapısı farklıdır.)',
      `[vosk] Sorunlar: ${pre.problems.join('; ')}`,
    ].join('\n'));
    process.exit(1);
  }

  const work = mkdtempSync(join(tmpdir(), 'vosk-'));
  const ext  = /\.zip$/i.test(URL) ? '.zip' : '.tar.gz';
  const archive = join(work, `model${ext}`);
  try {
    await download(URL, archive);

    // 3) Opsiyonel arşiv-seviyesi SHA256 kontrolü.
    if (ARCHIVE_SHA) {
      const got = await sha256File(archive);
      if (got !== ARCHIVE_SHA) fail(`arşiv SHA256 uyuşmadı (beklenen ${ARCHIVE_SHA.slice(0, 12)}…, gelen ${got.slice(0, 12)}…)`);
      log('arşiv SHA256 doğrulandı.');
    }

    // 4) Aç + model kökünü bul + MODEL_DIR'e yerleştir.
    const out = join(work, 'unpacked');
    extract(archive, out);
    const root = findModelRoot(out);
    if (!root) fail('açılan arşivde model kökü (am/final.mdl) bulunamadı.');
    if (existsSync(MODEL_DIR)) rmSync(MODEL_DIR, { recursive: true, force: true });
    copyTree(root, MODEL_DIR);

    // 5) Manifest doğrulaması (her dosya SHA256).
    const post = await verifyModel();
    if (!post.ok) fail(`indirilen model doğrulanamadı:\n  ${post.problems.join('\n  ')}`);
    log(`model indirildi ve doğrulandı (${MODEL_UUID}). → ${relative(REPO_ROOT, MODEL_DIR)}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((e) => fail(e?.stack || String(e)));
