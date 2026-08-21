/**
 * copy-sqljs-wasm.mjs — sql.js WASM ikilisini `public/wasm/`e kopyalar.
 *
 * ── NEDEN VAR (V-06 ölçümü) ────────────────────────────────────────────────
 * `NavigationCompute.worker.ts` sql.js'i `locateFile: (f) => '/wasm/' + f` ile
 * yüklüyor — ama `public/wasm/` dizini **HİÇ YOKTU**. Yani POI arama zinciri
 * `poi.db` olsa bile ÇALIŞAMAZDI: WASM indirilemiyor → `_initSqlJs()` null →
 * "poi.db yüklenemedi". Plan bunu saymıyordu (yalnız `poi.db` eksik diyordu).
 *
 * ── NEDEN KOPYALAMA, NEDEN COMMIT DEĞİL ────────────────────────────────────
 * WASM ile onu yükleyen JS **aynı sürümden** olmak zorundadır. İkiliyi depoya
 * sabitlemek, `sql.js` npm'de güncellendiğinde sessiz bir sürüm ayrışması
 * üretirdi (JS yeni, WASM eski → anlaşılması zor çalışma-zamanı hatası).
 * Bu yüzden ikili KURULU paketten build sırasında kopyalanır: sürüm ayrışması
 * yapısal olarak imkânsız olur.
 *
 * Build zincirinde `vite build`ten ÖNCE koşar (vite `public/`i olduğu gibi
 * `dist/`e alır, oradan da `cap sync` ile APK'ya girer).
 */

import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Worker'ın `locateFile` ile istediği dosya adı — DEĞİŞTİRİLEMEZ. */
const WASM_NAME = 'sql-wasm.wasm';
const OUT_DIR = resolve('public/wasm');

function main() {
  let src;
  try {
    src = resolve(dirname(require.resolve('sql.js')), WASM_NAME);
  } catch {
    console.error('HATA: `sql.js` çözülemedi — bağımlılık kurulu mu?');
    process.exit(2);
  }

  if (!existsSync(src)) {
    console.error(`HATA: ${src} bulunamadı — sql.js paket düzeni değişmiş olabilir.`);
    process.exit(2);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const dst = resolve(OUT_DIR, WASM_NAME);
  copyFileSync(src, dst);

  const kb = (statSync(dst).size / 1024).toFixed(0);
  console.log(`sql.js WASM kopyalandı → public/wasm/${WASM_NAME} (${kb} KB)`);
}

main();
