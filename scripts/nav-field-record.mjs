/**
 * nav-field-record.mjs — NAV-CORE-P0 GERÇEK ARAÇ ölçüm kaydedicisi.
 *
 * Cihazdaki salt-okunur saha köprüsünü (`window.__CAROS_NAV_FIELD__`) CDP over
 * adb üzerinden 1 Hz örnekler ve JSONL'e yazar. Ürüne HİÇBİR komut göndermez.
 *
 * ÖN KOŞULLAR
 *   1. Dev/debug APK kurulu (CDP açık: NODE_ENV=development ile cap sync).
 *   2. adb forward yapılmış:
 *        adb forward tcp:9222 localabstract:webview_devtools_remote_<PID>
 *
 * KULLANIM
 *   node scripts/nav-field-record.mjs P0-1
 *   node scripts/nav-field-record.mjs P0-1 --out C:/olcum --hz 1
 *
 * Durdurmak için Ctrl+C — dosya her örnekte diske yazıldığı için kayıp olmaz.
 *
 * GİZLİLİK: çıktı HAM KOORDİNAT içerir (saha doğruluğu aksi hâlde ölçülemez).
 * Dosya kişisel veridir; paylaşmadan önce temizleyin.
 */
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright-core');

const args = process.argv.slice(2);
const label = args.find(a => !a.startsWith('--')) ?? 'RUN';
const outDir = valOf('--out') ?? join(process.cwd(), 'field-runs');
const hz = Number(valOf('--hz') ?? '1');
const cdp = valOf('--cdp') ?? 'http://localhost:9222';
const periodMs = Math.max(200, Math.round(1000 / (hz > 0 ? hz : 1)));

function valOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outFile = join(outDir, `nav-${label}-${stamp}.jsonl`);

console.log(`[kaydedici] etiket=${label}  hz=${hz}  dosya=${outFile}`);
console.log('[kaydedici] Ctrl+C ile durdurun.\n');

const browser = await chromium.connectOverCDP(cdp);
let page = browser.contexts()[0]?.pages()[0];
if (!page) { console.error('[kaydedici] WebView sayfası bulunamadı.'); process.exit(2); }

// Köprü var mı?
const ok = await page.evaluate(() => !!window.__CAROS_NAV_FIELD__).catch(() => false);
if (!ok) {
  console.error('[kaydedici] HATA: __CAROS_NAV_FIELD__ yok.');
  console.error('  → Dev build kurulu mu? (VITE_ENABLE_DEBUG_PANEL=true + NODE_ENV=development cap sync)');
  process.exit(3);
}

// NAV v3 . F8 -- sinirli kayit destekleniyorsa (version >= 2) baslat.
// Bu, dis 1 Hz orneklemeye IKINCI bir zamanlayici EKLEMEZ; ayni sample()
// cagrisina PIGGYBACK eder (bkz. navFieldBridge.ts SS F8). Desteklenmiyorsa
// (eski build) sessizce atlanir -- JSONL akisi HER durumda ayni calisir.
const fieldTraceSupported = await page.evaluate(() => {
  const b = window.__CAROS_NAV_FIELD__;
  return !!(b && b.version >= 2 && typeof b.startRecording === 'function');
}).catch(() => false);
if (fieldTraceSupported) {
  await page.evaluate((lbl) => window.__CAROS_NAV_FIELD__.startRecording({ label: lbl }), label).catch(() => {});
  console.log('[kaydedici] F8 sinirli kayit ACIK (JSONL akisi degismeden AYRICA devam eder).');
} else {
  console.log('[kaydedici] F8 sinirli kayit bu build de YOK (eski koprü) -- yalniz JSONL akisi calisacak.');
}

let n = 0, errors = 0, lastStatus = '', lastOff = '';
let stopping = false;

process.on('SIGINT', () => { stopping = true; });

appendFileSync(outFile, JSON.stringify({
  _meta: true, label, startedAt: Date.now(), hz,
  note: 'NAV-CORE-P0 gerçek araç ölçümü — salt-okunur köprü, 1 Hz',
}) + '\n');

while (!stopping) {
  const t0 = Date.now();
  try {
    const s = await page.evaluate(() => window.__CAROS_NAV_FIELD__.sample());
    appendFileSync(outFile, JSON.stringify(s) + '\n');
    n++;

    // Canlı özet — yalnız DEĞİŞİMDE yaz (konsolu boğmasın)
    const st = `${s.nav.status}/${s.offRoute.state}`;
    if (st !== lastStatus || s.offRoute.state !== lastOff) {
      lastStatus = st; lastOff = s.offRoute.state;
      console.log(
        `[${new Date().toLocaleTimeString()}] ${s.nav.status.padEnd(9)} ` +
        `sapma=${s.offRoute.state.padEnd(19)} ` +
        `eşleşme=${String(s.match.state).padEnd(15)} ` +
        `hız=${(s.veh.speedKmh ?? 0).toFixed(0).padStart(3)}km/h ` +
        `yanal=${s.match.lateralM == null ? '—' : s.match.lateralM.toFixed(0) + 'm'} ` +
        `mesafeKaynağı=${s.route.distSource}`,
      );
    }
  } catch (e) {
    errors++;
    // Sayfa yeniden yüklendiyse (uygulama restart) yeniden bağlan
    try {
      const pages = browser.contexts()[0]?.pages() ?? [];
      if (pages.length) page = pages[0];
    } catch { /* yoksay */ }
    if (errors % 10 === 1) console.warn(`[kaydedici] örnekleme hatası (${errors}): ${e.message}`);
  }
  const dt = Date.now() - t0;
  if (dt < periodMs) await new Promise(r => setTimeout(r, periodMs - dt));
}

console.log(`\n[kaydedici] durdu. ${n} örnek yazıldı, ${errors} hata.`);
console.log(`[kaydedici] dosya: ${outFile}`);
console.log(`[kaydedici] analiz: node scripts/nav-field-analyze.mjs "${outFile}"`);
// NAV v3 . F8 -- sinirli trace'i durdur ve disa aktar (destekleniyorsa).
// Export SADECE host'a TASINIR -- urun kararina hicbir sekilde geri BESLENMEZ.
if (fieldTraceSupported) {
  try {
    await page.evaluate(() => window.__CAROS_NAV_FIELD__.stopRecording());
    const trace = await page.evaluate(() => window.__CAROS_NAV_FIELD__.exportTrace());
    if (trace) {
      const traceFile = outFile.replace(/\.jsonl$/, '.trace.json');
      appendFileSync(traceFile, JSON.stringify(trace, null, 2));
      const ov = trace.overflow;
      console.log(`[kaydedici] F8 trace: ${traceFile}`);
      console.log(`[kaydedici] F8 ozet: ${trace.samples.length} ornek . ${trace.events.length} olay . ` +
        `koordinat redakte=${trace.coordinatesRedacted} . tasma=${ov.samplesTruncated || ov.eventsTruncated}`);
      if (ov.samplesTruncated || ov.eventsTruncated) {
        console.warn('[kaydedici] UYARI: F8 trace tavana ULASTI -- bazi ornek/olay REDDEDILDI (dosyada bu ACIKCA isaretli).');
      }
    } else {
      console.log('[kaydedici] F8 trace: hic kayit yapilmamis (baslatilamadi).');
    }
  } catch (e) {
    console.warn(`[kaydedici] F8 trace disa aktarilamadi (JSONL akisi ETKILENMEDI): ${e.message}`);
  }
}

await browser.close().catch(() => {});
