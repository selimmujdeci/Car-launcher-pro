/**
 * verify-webview-compat.mjs — Eski head unit WebView boot-sözdizimi kapısı.
 *
 * NEDEN: "farklı cihazda açılmama" hatasının kökü, build çıktısının eski WebView'ın
 * (Chrome 52-79) parse edemeyeceği sözdizimi içermesiydi (modül worker, ?./??, ES2020+).
 * Kaynak-metin regresyon kilitleri (regression.guards.test.ts) config'i korur AMA
 * gerçek EMIT edilen sözdizimini görmez — yeni bir worker/bağımlılık config doğruyken
 * bile modern sözdizimi sızdırabilir. Bu script build ÇIKTISINI acorn ile hedef-ES
 * seviyesinde parse eder → sızarsa apk:safe APK üretmez (§HEAD_UNIT_MATRIX §6).
 *
 * Taze dist/ gerektirir (npm run build sonrası). apk:safe pipeline'ında build'den
 * SONRA çalışır.
 */
import { createRequire } from 'module';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const require = createRequire(import.meta.url);
const acorn = require('acorn');

const DIST = 'dist';
const ASSETS = join(DIST, 'assets');
const failures = [];

/** true = OK, aksi halde hata mesajı. */
function parseErr(code, ecmaVersion, sourceType = 'script') {
  try { acorn.parse(code, { ecmaVersion, sourceType }); return null; }
  catch (e) { return String(e.message).slice(0, 60); }
}

if (!existsSync(ASSETS)) {
  console.error('❌ dist/assets yok — önce `npm run build` çalıştır.');
  process.exit(2);
}
const files = readdirSync(ASSETS);

// 1) Classic compute worker'ları ES2015 parse etmeli (Chrome 52+).
//    NavigationCompute HARİÇ: bilinçli modül worker (sql.js), supportsModuleWorker
//    ile Chrome 80+'a kapılı — eski cihazda hiç yüklenmez.
const classicWorkers = files.filter((f) => /(VehicleCompute|VisionCompute)\.worker-.*\.js$/.test(f));
if (classicWorkers.length < 2) {
  failures.push(`Classic compute worker chunk'ları eksik (Vehicle/Vision beklendi, bulunan: ${classicWorkers.length})`);
}
for (const f of classicWorkers) {
  const err = parseErr(readFileSync(join(ASSETS, f), 'utf8'), 2015);
  if (err) failures.push(`Worker ${f} ES2015 parse EDEMEDİ → eski WebView boot ölümü: ${err}`);
}

// 2) Legacy ana chunk'lar ES2015 parse etmeli (plugin-legacy Chrome>=50 hedefi).
const legacyPrefixes = ['main-legacy', 'polyfills-legacy', 'vendor-react-legacy', 'vendor-maplibre-legacy', 'useStore-legacy'];
for (const pre of legacyPrefixes) {
  const f = files.find((x) => x.startsWith(pre) && x.endsWith('.js'));
  if (!f) { failures.push(`Legacy chunk bulunamadı: ${pre}-* (plugin-legacy çıktısı eksik?)`); continue; }
  const err = parseErr(readFileSync(join(ASSETS, f), 'utf8'), 2015);
  if (err) failures.push(`Legacy ${f} ES2015 parse EDEMEDİ: ${err}`);
}

// 3) index.html inline boot-guard ES5-güvenli olmalı (guard'ın KENDİSİ Chrome52+ parse etmeli).
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?bootstrapError[\s\S]*?)<\/script>/);
if (!m) {
  failures.push('index.html boot-guard script bloğu bulunamadı (bootstrapError yok)');
} else {
  const guard = m[1];
  if (/\?\./.test(guard)) failures.push('boot-guard optional chaining (?.) içeriyor — Chrome<80 guard\'ın kendisi ölür');
  if (/\?\?/.test(guard)) failures.push('boot-guard nullish (??) içeriyor — Chrome<80 parse hatası');
  const err = parseErr(guard, 5);
  if (err) failures.push(`boot-guard ES5 parse EDEMEDİ: ${err}`);
}

if (failures.length) {
  console.error('\n❌ WebView uyumluluk kapısı BAŞARISIZ:\n' + failures.map((x) => '  • ' + x).join('\n') + '\n');
  process.exit(1);
}
console.log('✅ WebView uyumluluk kapısı geçti — worker ES2015, legacy ES2015, boot-guard ES5-safe.');
