/**
 * rtg3BuildPreflight.mjs — RTG3 BUILD ARAÇ ZİNCİRİ SÖZLEŞMESİ + ÖN KONTROL.
 *
 * "Benim makinemde çalışıyor" bir build platformu değildir. Bu dosya RTG3
 * üreticisinin çalışabilmesi için gereken TEK sözleşmedir ve builder başlamadan
 * ÖNCE fail-fast doğrular. Yarım graf bırakmak yasaktır: eksik araç zinciri
 * build BAŞLAMADAN reddedilir.
 *
 * Yeni bir bağımlılık yönetim sistemi İCAT ETMEZ; `package.json#engines` ile
 * aynı Node aralığını ve mevcut `osmium-tool` beklentisini tek yerde toplar.
 */

import { spawn } from 'node:child_process';
import {
  accessSync, closeSync, constants, existsSync, mkdirSync, openSync,
  readSync, rmSync, statSync, statfsSync, writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

/** Araç zinciri sözleşmesi — `package.json#engines` ile SENKRON tutulur. */
export const RTG3_TOOLCHAIN = Object.freeze({
  node: Object.freeze({
    /* `node:sqlite` v22.5.0'da `--experimental-sqlite` ARKASINDA geldi;
       v22.13.0'dan itibaren bayraksız kullanılabilir. Builder bayrak
       gerektirmemelidir → alt sınır 22.13.0. */
    min: '22.13.0',
    reason: 'node:sqlite (DatabaseSync) bayraksiz kullanilabilir olmali',
    verified: Object.freeze(['22.22.1', '24.15.0']),
  }),
  osmium: Object.freeze({
    min: '1.14.0',
    reason: 'osmium tags-filter -R + cat -t node OPL akisi',
    verified: Object.freeze(['1.19.0']),
  }),
  sqlite: Object.freeze({
    backend: 'node:sqlite (Node ile gelen gomulu SQLite)',
    requires: Object.freeze(['DatabaseSync', 'prepare', 'iterate', 'WAL journal']),
  }),
  minMemoryBudgetMiB: 256,
});

export function compareSemver(a, b) {
  const pa = String(a).split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

function check(name, required, measured, ok, detail = null) {
  return { check: name, required, measured, result: ok ? 'PASS' : 'FAIL', detail };
}

async function osmiumVersion(bin) {
  return new Promise((done) => {
    let out = '';
    let child;
    try {
      child = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { done(null); return; }
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    child.on('error', () => done(null));
    child.on('close', () => done(out.match(/osmium version\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i)?.[1] ?? null));
  });
}

/** node:sqlite yalniz import edilebilmesiyle degil, GERCEK sorguyla kanitlanir. */
async function sqliteCapability() {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE probe(id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT INTO probe VALUES(?,?)').run(1, 'ok');
    const rows = [...db.prepare('SELECT value FROM probe WHERE id=?').iterate(1)];
    db.close();
    return rows[0]?.value === 'ok'
      ? { ok: true, detail: 'DatabaseSync + prepare + iterate' }
      : { ok: false, detail: 'sorgu sonucu beklenmedik' };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** OSM PBF imzasi: BE uint32 BlobHeader uzunlugu + protobuf icinde OSMHeader. */
function looksLikeOsmPbf(path) {
  let fd = null;
  try {
    fd = openSync(path, 'r');
    const head = Buffer.alloc(64);
    const read = readSync(fd, head, 0, 64, 0);
    if (read < 16) return { ok: false, detail: `dosya cok kisa (${read} bayt)` };
    const headerLength = head.readUInt32BE(0);
    if (headerLength < 8 || headerLength > 64 * 1024) {
      return { ok: false, detail: `BlobHeader uzunlugu gecersiz (${headerLength})` };
    }
    if (!head.subarray(4, read).includes('OSMHeader')) {
      return { ok: false, detail: 'OSMHeader blob imzasi yok' };
    }
    return { ok: true, detail: `BlobHeader ${headerLength} bayt` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* yut */ } }
  }
}

function writable(dir) {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    const probe = resolve(dir, `.rtg3-preflight-${process.pid}`);
    writeFileSync(probe, 'probe');
    rmSync(probe, { force: true });
    return { ok: true, detail: null };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function freeBytes(dir) {
  try {
    const fs = statfsSync(dir);
    return fs.bavail * fs.bsize;
  } catch {
    return null;
  }
}

/**
 * Builder baslamadan once calisir. Herhangi bir FAIL varsa `assertPreflight`
 * fail-fast atar — yarim graf URETILMEZ.
 */
export async function runRtg3BuildPreflight({
  sourcePath, tempDir, outputDir, memoryBudgetMiB,
  osmiumBin = process.env.OSMIUM ?? 'osmium',
  minFreeBytes = 0,
}) {
  const checks = [];

  const nodeVersion = process.versions.node;
  checks.push(check('node-runtime', `>=${RTG3_TOOLCHAIN.node.min}`, nodeVersion,
    compareSemver(nodeVersion, RTG3_TOOLCHAIN.node.min) >= 0, RTG3_TOOLCHAIN.node.reason));

  const sqlite = await sqliteCapability();
  checks.push(check('node-sqlite-capability', RTG3_TOOLCHAIN.sqlite.requires.join(' + '),
    sqlite.ok ? 'USABLE' : 'UNUSABLE', sqlite.ok, sqlite.detail));

  const osmium = await osmiumVersion(osmiumBin);
  checks.push(check('osmium-tool', `>=${RTG3_TOOLCHAIN.osmium.min}`, osmium ?? 'NOT_FOUND',
    osmium !== null && compareSemver(osmium, RTG3_TOOLCHAIN.osmium.min) >= 0,
    osmium === null ? `${osmiumBin} bulunamadi (PATH veya OSMIUM ortam degiskeni)` : null));

  if (!sourcePath || !existsSync(sourcePath)) {
    checks.push(check('source-pbf', 'okunabilir OSM PBF', sourcePath ? 'MISSING' : 'UNSET', false,
      `kaynak yok: ${sourcePath ?? '(verilmedi)'}`));
  } else {
    const signature = looksLikeOsmPbf(sourcePath);
    checks.push(check('source-pbf', 'okunabilir OSM PBF', `${statSync(sourcePath).size} B`,
      signature.ok, signature.detail));
  }

  const temp = writable(tempDir);
  checks.push(check('temp-writable', 'yazilabilir dizin', tempDir, temp.ok, temp.detail));
  const output = writable(outputDir);
  checks.push(check('output-writable', 'yazilabilir dizin', outputDir, output.ok, output.detail));

  const free = freeBytes(tempDir);
  checks.push(check('free-disk', minFreeBytes > 0 ? `>=${minFreeBytes} B` : 'olcum',
    free === null ? 'UNAVAILABLE' : `${free} B`,
    free === null ? minFreeBytes === 0 : free >= minFreeBytes,
    free === null ? 'statfs bu platformda okunamadi' : null));

  const budget = Number(memoryBudgetMiB);
  checks.push(check('memory-budget', `>=${RTG3_TOOLCHAIN.minMemoryBudgetMiB} MiB`,
    Number.isFinite(budget) ? `${budget} MiB` : 'INVALID',
    Number.isFinite(budget) && budget >= RTG3_TOOLCHAIN.minMemoryBudgetMiB));

  return { ok: checks.every((c) => c.result === 'PASS'), checks, toolchain: RTG3_TOOLCHAIN };
}

export function assertPreflight(report) {
  if (report.ok) return report;
  const failed = report.checks.filter((c) => c.result === 'FAIL');
  const lines = failed.map((c) => `  - ${c.check}: gereken ${c.required}, olculen ${c.measured}${c.detail ? ` (${c.detail})` : ''}`);
  throw new Error(`RTG3_PREFLIGHT_FAILED — build BASLATILMADI (yarim graf yok):\n${lines.join('\n')}`);
}
