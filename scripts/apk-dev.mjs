/**
 * apk-dev.mjs — DOĞRULAMALI debug APK derlemesi ("eski dosyalarla derlendi" tuzağına karşı).
 *
 * KULLANIM
 *   npm run apk:dev                          derle + zinciri doğrula
 *   npm run apk:dev -- --install             + cihaza kur + CİHAZDA doğrula
 *   npm run apk:dev -- --install --launch    + uygulamayı başlat
 *   ANDROID_SERIAL=<seri> npm run apk:dev -- --install   (birden çok cihaz)
 *
 * NEDEN: cihaz testinde eski kod koşuyordu ve bu hiçbir yerde görünmüyordu. Ölçülen/olası
 * delikler: yanlış çalışma kopyası/dal · `npm run build` düşüp `cap sync`in eski dist'i
 * kopyalaması · `cap sync` atlanması · sessizce başarısız `adb install` · OTA'nın eski
 * yayını geri kurması. Bu betik her halkada bir ÖNCEKİNİN çıktısını doğrular; uyuşmazlıkta
 * exit≠0 ile DURUR — "derlendi" demek ancak cihazdaki paketin damgası eşleşince mümkündür.
 *
 * ZİNCİR
 *   0  git: klasör · dal · HEAD · commit'lenmemiş değişiklikler yazdırılır
 *   1  dist/ ve android/app/src/main/assets/public/ SİLİNİR (eski paket kalamaz)
 *   2  npm run build        → dist/build-stamp.json commit === HEAD, bu çalıştırmada üretildi
 *   3  npx cap sync android → assets/public/build-stamp.json === dist damgası
 *   4  gradle assembleDebug → APK bu çalıştırmada yazıldı + APK İÇİNDEKİ damga === dist damgası
 *   5  (--install) adb install -r → "Success"; dumpsys versionName "-dev+<etiket>" === beklenen
 *
 * Release/sevkiyat için DEĞİLDİR (RELEASE GATE ayrıdır); `apk:safe` ile karıştırma.
 */

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readZipEntry, versionTag, sameStamp, parseDumpsysPackage, installSucceeded } from './lib/apkProvenance.mjs';

const isWindows = process.platform === 'win32';
const ROOT = process.cwd();
const APP_ID = 'com.cockpitos.pro';
const STAMP = 'build-stamp.json';
const DIST_STAMP = join(ROOT, 'dist', STAMP);
const ASSETS_PUBLIC = join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public');
const ASSETS_STAMP = join(ASSETS_PUBLIC, STAMP);
// Windows'ta android/build.gradle (usesWindowsTempBuildDir) buildDir'i C:/Temp/carlauncher'a taşır.
const APK = isWindows
  ? join('C:/Temp/carlauncher', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
  : join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const APK_STAMP_ENTRY = `assets/public/${STAMP}`;

function step(n, msg) { console.log(`\n[apk:dev] ── ${n} ── ${msg}`); }
function ok(msg) { console.log(`[apk:dev] ✓ ${msg}`); }
function fail(msg, hint) {
  console.error(`\n[apk:dev] ✗ DURDU: ${msg}`);
  if (hint) console.error(`[apk:dev]   → ${hint}`);
  console.error('[apk:dev]   Bu APK ile cihaz testi YAPMA — kanıt sayılmaz.');
  process.exit(1);
}

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  // trimEnd: porcelain satırlarının baştaki durum sütunu (" M") korunmalı.
  return r.status === 0 ? r.stdout.trimEnd() : null;
}

/** Windows'ta .cmd çalıştırmak shell ister; boşluklu yol riskine karşı argümanlar sabit. */
function run(cmd, args) {
  console.log(`[apk:dev] $ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(isWindows ? `${cmd}.cmd` : cmd, args, { stdio: 'inherit', shell: isWindows, cwd: ROOT });
  if (r.error) fail(`${cmd} çalıştırılamadı: ${r.error.message}`);
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} başarısız (exit ${r.status})`);
}

/** Kontrol-sonra-kullan YOK: tek okuma; yokluk ENOENT'ten anlaşılır. */
function readStamp(path, label) {
  let raw = '';
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') fail(`${label} damgası yok: ${path}`, 'Bu halka üretilmedi ya da eski araç zinciri kullanıldı.');
    fail(`${label} damgası okunamadı: ${e.message}`);
  }
  try { return JSON.parse(raw); } catch (e) { fail(`${label} damgası bozuk: ${e.message}`); }
  return null;
}

/**
 * APK'yı TEK dosya tanıtıcısıyla açar: tarih kontrolü ve içerik AYNI açık dosyadan gelir
 * (yol üzerinden stat + ayrı okuma arasında dosya değişebilirdi — TOCTOU).
 */
export function readFreshApk(path, notBeforeMs) {
  let fd;
  try {
    fd = openSync(path, 'r');
  } catch (e) {
    fail(`APK açılamadı: ${path} (${e && e.code ? e.code : e.message})`);
  }
  try {
    if (fstatSync(fd).mtimeMs < notBeforeMs) fail('APK bu çalıştırmada YAZILMADI (eski dosya)', 'Gradle çıktısını kontrol et.');
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function adbPath() {
  if (process.env.ADB) return process.env.ADB;
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (sdk) {
    const p = join(sdk, 'platform-tools', isWindows ? 'adb.exe' : 'adb');
    if (existsSync(p)) return p;
  }
  return 'adb';
}

function adb(args) {
  const r = spawnSync(adbPath(), args, { encoding: 'utf8' });
  if (r.error) fail(`adb çalıştırılamadı: ${r.error.message}`, 'ANDROID_HOME ya da ADB ortam değişkenini ayarla.');
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function main() {
  const argv = new Set(process.argv.slice(2));
  const install = argv.has('--install');
  const launch = argv.has('--launch');
  const startedAt = Date.now();

  // ── 0 ── git kimliği ──────────────────────────────────────────────────────
  step(0, 'kaynak kimliği');
  const head = git(['rev-parse', '--short', 'HEAD']);
  if (!head) fail('git HEAD okunamadı', 'Betiği repo kökünden çalıştır.');
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'unknown';
  const status = git(['status', '--porcelain']) ?? '';
  console.log(`[apk:dev] klasör : ${ROOT}`);
  console.log(`[apk:dev] dal    : ${branch}`);
  console.log(`[apk:dev] HEAD   : ${head}`);
  if (status.length > 0) {
    console.log('[apk:dev] ⚠ commit\'lenmemiş değişiklikler APK\'ya GİRECEK (damga ".dirty"):');
    for (const l of status.split(/\r?\n/).slice(0, 30)) console.log(`[apk:dev]     ${l}`);
  } else {
    ok('çalışma ağacı temiz');
  }

  // ── 1 ── eski çıktıları sil ───────────────────────────────────────────────
  step(1, 'eski web paketi siliniyor (dist + assets/public)');
  for (const dir of [join(ROOT, 'dist'), ASSETS_PUBLIC]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      fail(`silinemedi: ${dir} (${e.message})`, 'Dosya kilitli olabilir (Android Studio / Gradle daemon / açık gezgin). Kapatıp yeniden çalıştır.');
    }
  }
  ok('silindi');

  // ── 2 ── web derlemesi ────────────────────────────────────────────────────
  step(2, 'web derlemesi');
  run('npm', ['run', 'build']);
  const distStamp = readStamp(DIST_STAMP, 'dist');
  if (distStamp.commit !== head) fail(`dist commit ${distStamp.commit} ≠ HEAD ${head}`, 'Derleme başka bir çalışma kopyasından mı geldi?');
  if (Date.parse(distStamp.time) < startedAt - 5000) fail(`dist damgası bu çalıştırmadan ESKİ (${distStamp.time})`);
  if (distStamp.dirty !== (status.length > 0)) {
    fail(
      `dist dirty=${distStamp.dirty} ama derleme başında git durumu ${status.length > 0 ? 'değişiklikli' : 'temiz'}`,
      'Derleme sırasında izlenen bir dosya değişti (ör. build:sw public/serviceWorker.js\'i yeniden üretti) ya da '
        + 'derleme sürerken dosya düzenlendi. `git status` ile bak; değişikliği commit\'le ve yeniden çalıştır.',
    );
  }
  ok(`dist damgası: ${versionTag(distStamp)}`);

  // ── 3 ── Capacitor senkronu ───────────────────────────────────────────────
  step(3, 'Capacitor senkronu');
  run('npx', ['cap', 'sync', 'android']);
  const assetsStamp = readStamp(ASSETS_STAMP, 'assets/public');
  if (!sameStamp(assetsStamp, distStamp)) fail('assets/public damgası dist ile AYNI DEĞİL', 'cap sync eski bir web dizinini kopyalamış.');
  ok('assets/public = dist');

  // ── 4 ── Gradle ───────────────────────────────────────────────────────────
  step(4, 'Gradle assembleDebug');
  const g = spawnSync(process.execPath, [join(ROOT, 'scripts', 'gradle-build.mjs'), 'assembleDebug'], { stdio: 'inherit', cwd: ROOT });
  if (g.status !== 0) fail(`gradle başarısız (exit ${g.status})`);
  const apkBytes = readFreshApk(APK, startedAt);
  const inApk = readZipEntry(apkBytes, APK_STAMP_ENTRY);
  if (!inApk) fail(`APK içinde ${APK_STAMP_ENTRY} yok`);
  if (!sameStamp(JSON.parse(inApk.toString('utf8')), distStamp)) fail('APK içindeki damga dist ile AYNI DEĞİL', 'APK eski web paketini taşıyor.');
  const tag = versionTag(distStamp);
  ok(`APK doğrulandı: ${APK}`);

  if (!install) {
    console.log(`\n[apk:dev] HAZIR — etiket ${tag}. Cihaza kurmak için: npm run apk:dev -- --install`);
    return;
  }

  // ── 5 ── kurulum + cihazda doğrulama ──────────────────────────────────────
  step(5, 'cihaza kurulum');
  const devices = adb(['devices']).out.split(/\r?\n/).filter((l) => /\tdevice$/.test(l));
  if (devices.length === 0) fail('bağlı cihaz yok (adb devices)');
  if (devices.length > 1 && !process.env.ANDROID_SERIAL) fail('birden çok cihaz bağlı', 'ANDROID_SERIAL=<seri> ile hedefi seç.');
  /* Kurulan dosya = DOĞRULANAN baytlar. Yoldan yeniden okumak, doğrulama ile kurulum
     arasında değişen bir APK'yı kurabilirdi; özel geçici dizine (mkdtemp) yazılır. */
  const tmpDir = mkdtempSync(join(tmpdir(), 'caros-apk-'));
  const verifiedApk = join(tmpDir, 'app-debug.apk');
  let inst;
  try {
    writeFileSync(verifiedApk, apkBytes, { flag: 'wx' });
    inst = adb(['install', '-r', verifiedApk]);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  process.stdout.write(inst.out);
  if (!installSucceeded(inst.out)) {
    const hint = /INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(inst.out)
      ? 'Cihazdaki uygulama farklı imzalı (ör. release). Kaldırmak VERİYİ SİLER: adb uninstall com.cockpitos.pro — kararı sen ver.'
      : undefined;
    fail('adb install "Success" demedi — cihazda ESKİ uygulama duruyor', hint);
  }
  const pkg = parseDumpsysPackage(adb(['shell', 'dumpsys', 'package', APP_ID]).out);
  console.log(`[apk:dev] cihaz versionName  : ${pkg.versionName ?? '—'}`);
  console.log(`[apk:dev] cihaz lastUpdateTime: ${pkg.lastUpdateTime ?? '—'}`);
  if (!pkg.versionName || !pkg.versionName.endsWith(`-dev+${tag}`)) {
    fail(`cihazdaki sürüm (${pkg.versionName}) bu derleme değil (beklenen …-dev+${tag})`);
  }
  ok(`CİHAZDA DOĞRULANDI: ${pkg.versionName}`);

  if (launch) {
    adb(['shell', 'monkey', '-p', APP_ID, '-c', 'android.intent.category.LAUNCHER', '1']);
    ok('uygulama başlatıldı');
  }
  console.log(`\n[apk:dev] TAMAM — cihazdaki paket = ${branch}@${head}${distStamp.dirty ? ' (+ commit\'lenmemiş değişiklikler)' : ''} · ${tag}`);
  console.log('[apk:dev] Uygulamada Ayarlar › Sistem › Hakkında › "Derleme:" satırı aynı commit\'i göstermeli.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
