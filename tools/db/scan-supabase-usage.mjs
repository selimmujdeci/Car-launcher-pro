#!/usr/bin/env node
/**
 * scan-supabase-usage.mjs — CAROS PRO kod tabanındaki Supabase kullanımını tarar.
 * SALT-OKUMA: hiçbir DB'ye bağlanmaz, hiçbir dosya yazmaz. Yalnız `.from()` / `.rpc()` /
 * `.channel()` / REST `rpc/…` literallerini sayar ve tablo/RPC matrisi basar.
 *
 * Kullanım:
 *   node tools/db/scan-supabase-usage.mjs          # insan-okur özet
 *   node tools/db/scan-supabase-usage.mjs --json    # makine-okur JSON
 *
 * Amaç: docs/db/CANONICAL_SCHEMA_INVENTORY.md'yi güncel tutmak + reconcile PR'larında
 * "kod gerçekten kullanıyor mu" kanıtını tekrar-üretilebilir kılmak.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['src', 'website/src', 'website/app'];
const EXTS = new Set(['.ts', '.tsx', '.js', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.git', 'coverage']);

/** Bir dizini özyinelemeli gezip uygun dosyaları toplar (node_modules atlanır). */
function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (EXTS.has(extname(name))) out.push(full);
  }
  return out;
}

const PATTERNS = {
  from:    /\.from\(\s*['"`]([a-zA-Z_][a-zA-Z0-9_]*)['"`]/g,
  rpc:     /\.rpc\(\s*['"`]([a-zA-Z_][a-zA-Z0-9_]*)['"`]/g,
  restRpc: /rpc\/([a-zA-Z_][a-zA-Z0-9_]*)/g,
  channel: /\.channel\(\s*['"`]([^'"`]+)['"`]/g,
};

function tally(files) {
  const acc = { from: {}, rpc: {}, restRpc: {}, channel: {} };
  const where = { from: {}, rpc: {}, restRpc: {}, channel: {} };
  for (const f of files) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const [kind, re] of Object.entries(PATTERNS)) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const key = m[1];
        acc[kind][key] = (acc[kind][key] ?? 0) + 1;
        (where[kind][key] ??= new Set()).add(f.replace(/\\/g, '/'));
      }
    }
  }
  return { acc, where };
}

function sorted(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const files = ROOTS.flatMap((r) => walk(r, []));
const { acc, where } = tally(files);

if (process.argv.includes('--json')) {
  const toObj = (o) => Object.fromEntries(sorted(o));
  const filesOf = (kind) => Object.fromEntries(
    Object.entries(where[kind]).map(([k, s]) => [k, [...s].sort()]),
  );
  process.stdout.write(JSON.stringify({
    scannedFiles: files.length,
    tables: toObj(acc.from),
    rpc: toObj({ ...acc.rpc, ...acc.restRpc }),
    channels: toObj(acc.channel),
    fileRefs: { from: filesOf('from'), rpc: filesOf('rpc') },
  }, null, 2) + '\n');
} else {
  const section = (title, o) => {
    console.log(`\n== ${title} (${Object.keys(o).length}) ==`);
    for (const [k, n] of sorted(o)) console.log(`  ${String(n).padStart(3)}  ${k}`);
  };
  console.log(`Taranan dosya: ${files.length}  (roots: ${ROOTS.join(', ')})`);
  section('.from() tabloları', acc.from);
  section('.rpc() fonksiyonları', { ...acc.rpc, ...acc.restRpc });
  section('realtime kanalları', acc.channel);
  console.log('\nNot: SALT-OKUMA — DB\'ye bağlanılmadı. Canlı gerçekle karşılaştırma için');
  console.log('docs/db/CANONICAL_SCHEMA_INVENTORY.md ve supabase/verification/verify_canonical_schema.sql kullanın.');
}
