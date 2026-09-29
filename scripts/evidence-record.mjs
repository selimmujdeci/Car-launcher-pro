/**
 * evidence-record.mjs — saha kanıtını TEK KOMUTLA kütüğe yazar.
 *
 * Cihazda bir özellik kanıtlandığında (smoke testi geçti, sahada gözlendi) kaydı
 * elle yazmak gerekmez: numara, tarih, derleme (sürüm + commit) ve — cihaz adb ile
 * bağlıysa — model / Android / WebView sürümü OTOMATİK doldurulur.
 *
 * KULLANIM
 *   npm run kanit -- --alan mavi --sonuc gecti --not "Hey Mavi uyanma + müzik değiştir smoke"
 *   npm run kanit -- --alan navigasyon --sonuc gecti --not "smoke geçti" --kapatir 1221,1328
 *   npm run kanit -- --alan obd --sonuc dustu --not "DID okuması boş döndü" --dene
 *
 * SEÇENEKLER
 *   --alan      Alan / özellik adı (zorunlu)            ör. mavi, navigasyon, obd-pid
 *   --sonuc     gecti | dustu (zorunlu)
 *   --not       Ne gözlemlendi (zorunlu, kısa)
 *   --kapatir   Kapattığı 🔴 madde numaraları (virgüllü) → o maddeler 🟢/❌ tablosuna taşınır
 *   --kaynak    Kanıt türü (varsayılan: "sahip gözlemi (smoke)")
 *   --tarih     YYYY-MM-DD (varsayılan: bugün)
 *   --dene      Dosyaya yazmaz; eklenecek satırları gösterir
 *
 * Dürüstlük: bu araç yalnız KAYIT eder, kanıt üretmez. Kaynak alanı kanıtın türünü
 * (smoke gözlemi / ölçüm) açıkça yazar; testlerin geçmesi saha kanıtı DEĞİLDİR.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyEvidence, provenance } from './lib/evidenceLedger.mjs';

const LEDGER = join(process.cwd(), 'docs/DEVICE_VALIDATION_LEDGER.md');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name) => args.includes(`--${name}`);

function run(cmd, cmdArgs) {
  try { return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim(); }
  catch { return undefined; }
}

/** adb ile bağlı cihazın kimliği — yoksa boş (kayıt yine yapılır, "alınamadı" yazılır). */
function deviceInfo() {
  if (!run('adb', ['get-state'])) return {};
  const prop = (k) => run('adb', ['shell', 'getprop', k]) || undefined;
  const wv = run('adb', ['shell', 'dumpsys', 'webviewupdate']);
  const webview = wv?.match(/Current WebView package.*?\(([^,)]+)/)?.[1];
  return { model: prop('ro.product.model'), android: prop('ro.build.version.release'), webview };
}

const today = new Date().toISOString().slice(0, 10);
const date = opt('tarih') ?? today;
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error('--tarih YYYY-MM-DD olmalı'); process.exit(2); }

const version = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version;
const commit = run('git', ['rev-parse', '--short', 'HEAD']);
const prov = provenance({ date, source: opt('kaynak') ?? 'sahip gözlemi (smoke)', commit, version, device: deviceInfo() });
const closes = (opt('kapatir') ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
if (closes.some((n) => !Number.isInteger(n) || n <= 0)) { console.error('--kapatir yalnız madde numaraları alır (ör. 1221,1328)'); process.exit(2); }

const before = readFileSync(LEDGER, 'utf8');
let result;
try {
  result = applyEvidence(before, { result: opt('sonuc'), area: opt('alan'), note: opt('not'), closes, prov, date });
} catch (e) {
  console.error(`Kayıt yapılamadı: ${e.message}`);
  process.exit(2);
}

const added = result.text.split('\n').filter((l) => !before.includes(l));
console.log(flag('dene') ? '— ÖNİZLEME (dosyaya yazılmadı) —' : `Kütüğe yazıldı: #${result.no}${closes.length ? ` · taşınan: ${closes.map((n) => `#${n}`).join(', ')}` : ''}`);
for (const l of added) console.log(l.length > 400 ? `${l.slice(0, 400)}…` : l);
if (!flag('dene')) writeFileSync(LEDGER, result.text);
