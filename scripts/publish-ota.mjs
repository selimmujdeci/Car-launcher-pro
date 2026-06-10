#!/usr/bin/env node
/**
 * publish-ota.mjs — OTA v1 / Commit 3: güvenli release publish
 *
 * Release APK'yı Supabase Storage `ota_apks` bucket'ına yükler, SHA-256
 * hesaplar ve `ota_releases` tablosuna DRAFT kayıt atar (active yapmak
 * AYRI operasyon — admin/RolloutCenter kararı; cihazlar draft'ı göremez).
 *
 * Kullanım:
 *   npm run ota:publish -- --apk path/to/app-release.apk --dry-run
 *   npm run ota:publish -- --apk path/to/app-release.apk [--channel internal|pilot|production]
 *
 * Tek sürüm kaynağı: version.properties (elle versionCode/versionName
 * parametresi YOK — bump-version.mjs disipliniyle aynı).
 *
 * GÜVENLİK:
 *   - SUPABASE_SERVICE_ROLE_KEY yalnız publish ortamında (local/CI) env'den
 *     okunur; CİHAZA/REPOYA ASLA girmez. Dry-run service role İSTEMEZ.
 *   - Storage path deterministik: releases/v{NAME}/caros-pro-v{CODE}.apk
 *   - Upsert YOK: aynı sürüm ikinci kez yüklenemez (storage 409 +
 *     ota_releases.version_code UNIQUE) — yayınlanmış artefakt sessizce
 *     değiştirilemez (bütünlük garantisi).
 *   - Fail-fast: her adım hatada anında durur, non-zero exit.
 *
 * Şema: supabase/migrations/20260610000018_ota_release_registry.sql
 * Bucket: supabase/migrations/20260610000019_ota_storage_policies.sql
 */
import { createReadStream, readFileSync, statSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CHANNELS = ['internal', 'pilot', 'production'];

// ── Saf yardımcılar (vitest bunları import eder) ─────────────────────────────

/** CLI argümanlarını parse eder. Geçersiz girişte throw (fail-fast). */
export function parseArgs(argv) {
  const out = { apkPath: null, dryRun: false, channel: 'production' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apk') {
      out.apkPath = argv[++i] ?? null;
    } else if (a === '--dry-run') {
      out.dryRun = true;
    } else if (a === '--channel') {
      out.channel = argv[++i] ?? '';
    } else {
      throw new Error(`Bilinmeyen argüman: ${a}`);
    }
  }
  if (!out.apkPath) {
    throw new Error('Kullanım: --apk <path/to/app-release.apk> [--dry-run] [--channel internal|pilot|production]');
  }
  if (!CHANNELS.includes(out.channel)) {
    throw new Error(`Geçersiz channel: "${out.channel}" (geçerli: ${CHANNELS.join('|')})`);
  }
  return out;
}

/**
 * version.properties STRICT parse — publish'te fallback YOK:
 * eksik/bozuk anahtar = yanlış sürüm yayınlama riski → throw.
 * (src/utils/versionProperties.ts'in fail-soft sürümünden bilinçli ayrım.)
 */
export function parseVersionStrict(content) {
  const code = content.match(/^VERSION_CODE=(\d+)\s*$/m);
  const name = content.match(/^VERSION_NAME=(.+?)\s*$/m);
  if (!code) throw new Error('version.properties: VERSION_CODE bulunamadı/bozuk');
  if (!name) throw new Error('version.properties: VERSION_NAME bulunamadı/bozuk');
  const versionCode = parseInt(code[1], 10);
  if (!Number.isInteger(versionCode) || versionCode <= 0) {
    throw new Error(`version.properties: VERSION_CODE pozitif tamsayı olmalı (${code[1]})`);
  }
  return { versionCode, versionName: name[1].trim() };
}

/** Deterministik storage yolu — cihaz indirme URL'i bunu kullanır. */
export function buildStoragePath(versionName, versionCode) {
  return `releases/v${versionName}/caros-pro-v${versionCode}.apk`;
}

/**
 * APK ön-doğrulaması: var mı, dosya mı, boş değil mi, ZIP imzalı mı
 * (APK = ZIP; ilk 2 bayt 'PK' değilse yanlış dosya yayınlanıyor demektir).
 */
export function validateApk(apkPath) {
  if (!existsSync(apkPath)) throw new Error(`APK bulunamadı: ${apkPath}`);
  const st = statSync(apkPath);
  if (!st.isFile()) throw new Error(`APK bir dosya değil: ${apkPath}`);
  if (st.size <= 0) throw new Error(`APK boş (0 bayt): ${apkPath}`);
  const fd = openSync(apkPath, 'r');
  try {
    const magic = Buffer.alloc(2);
    readSync(fd, magic, 0, 2, 0);
    if (magic.toString('latin1') !== 'PK') {
      throw new Error(`APK ZIP imzası yok ('PK' bekleniyordu): ${apkPath}`);
    }
  } finally {
    closeSync(fd);
  }
  return { size: st.size };
}

/** Streaming SHA-256 — APK belleğe alınmaz. */
export function sha256OfFile(apkPath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(apkPath)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/**
 * Publish akışı — fetchImpl/env enjekte edilebilir (test edilebilirlik).
 * Dönüş: özet objesi (CLI bunu yazdırır).
 */
export async function runPublish(opts) {
  const { apkPath, dryRun, channel, versionProps, env, fetchImpl = fetch } = opts;

  // 1. APK doğrulama + hash (dry-run dahil — özet gerçek veridir)
  const { size } = validateApk(apkPath);
  const sha256 = await sha256OfFile(apkPath);
  const { versionCode, versionName } = versionProps;
  const storagePath = buildStoragePath(versionName, versionCode);

  const summary = {
    versionCode,
    versionName,
    channel,
    apkPath: storagePath,
    apkSize: size,
    sha256,
    status: 'draft',
    dryRun,
  };

  // 2. Dry-run: service role İSTEMEDEN burada biter
  if (dryRun) return summary;

  // 3. Gerçek publish — env şartları (fail-fast)
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL (veya VITE_SUPABASE_URL) env tanımsız');
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY env tanımsız — service role yalnız publish ortamında, cihaza asla');
  }
  const authHeaders = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };

  // 4. Storage upload (upsert YOK — aynı yol 409 döner)
  const upRes = await fetchImpl(`${url}/storage/v1/object/ota_apks/${storagePath}`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/vnd.android.package-archive' },
    body: createReadStream(apkPath),
    duplex: 'half', // Node fetch stream body şartı
  });
  if (upRes.status === 409 || upRes.status === 400) {
    const body = await upRes.text();
    if (upRes.status === 409 || body.includes('already exists') || body.includes('Duplicate')) {
      throw new Error(`Storage: ${storagePath} zaten var — yayınlanmış artefakt üzerine yazılamaz. ` +
        'Yeni sürüm için önce `npm run release:bump`.');
    }
    throw new Error(`Storage upload başarısız (${upRes.status}): ${body}`);
  }
  if (!upRes.ok) {
    throw new Error(`Storage upload başarısız (${upRes.status}): ${await upRes.text()}`);
  }

  // 5. ota_releases insert (draft; version_code UNIQUE — duplicate fail-fast)
  const insRes = await fetchImpl(`${url}/rest/v1/ota_releases`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      version_code: versionCode,
      version_name: versionName,
      channel,
      apk_path: storagePath,
      apk_size: size,
      sha256,
      status: 'draft',
    }),
  });
  if (!insRes.ok) {
    throw new Error(`ota_releases insert başarısız (${insRes.status}): ${await insRes.text()}\n` +
      `UYARI: Storage'a yüklenen ${storagePath} duruyor — tekrar denemeden önce ` +
      'Supabase Dashboard → Storage → ota_apks içinden silinmeli.');
  }

  return summary;
}

// ── CLI giriş noktası (test import'unda ÇALIŞMAZ) ───────────────────────────

const _isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (_isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const args = parseArgs(process.argv.slice(2));
    const versionProps = parseVersionStrict(readFileSync(join(root, 'version.properties'), 'utf8'));
    const summary = await runPublish({ ...args, versionProps, env: process.env });
    console.log(JSON.stringify(summary, null, 2));
    console.log(args.dryRun
      ? 'DRY-RUN: hiçbir şey yüklenmedi/yazılmadı.'
      : `OK: draft release kaydedildi. Aktive etmek AYRI operasyon: ota_releases.status='active' (super_admin).`);
  } catch (err) {
    console.error(`HATA: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
