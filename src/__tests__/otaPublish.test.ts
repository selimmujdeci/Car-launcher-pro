/**
 * otaPublish.test.ts — OTA v1 / Commit 3: publish script
 *
 * Kapsam:
 *  - parseArgs: --apk/--dry-run/--channel, eksik/yanlış arg → fail
 *  - parseVersionStrict: publish'te fallback YOK (yanlış sürüm yayını riski)
 *  - buildStoragePath deterministik
 *  - validateApk: eksik/boş/ZIP-imzasız → fail
 *  - sha256OfFile: bilinen vektör
 *  - runPublish: dry-run service role İSTEMEZ; gerçek publish service role
 *    yokken FAIL; mock fetch ile upload+insert akışı; storage 409 → açık hata
 *
 * NOT: Gerçek Supabase'e upload "deploy'da doğrulanmadı" — burada fetch mock.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseArgs,
  parseVersionStrict,
  buildStoragePath,
  validateApk,
  sha256OfFile,
  runPublish,
  // @ts-expect-error — .mjs modülünün tip bildirimi yok (script, src dışı)
} from '../../scripts/publish-ota.mjs';

// ── Fixture: geçici APK dosyaları ─────────────────────────────────────────────

let dir: string;
let validApk: string;   // 'PK' imzalı sahte APK
let emptyApk: string;   // 0 bayt
let notZipApk: string;  // yanlış imza

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ota-publish-test-'));
  validApk  = join(dir, 'app-release.apk');
  emptyApk  = join(dir, 'empty.apk');
  notZipApk = join(dir, 'notzip.apk');
  writeFileSync(validApk, Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('fake-apk-payload')]));
  writeFileSync(emptyApk, Buffer.alloc(0));
  writeFileSync(notZipApk, Buffer.from('MZ-bu-bir-zip-degil'));
});

afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const PROPS = { versionCode: 2, versionName: '1.0.0' };

/** Mock fetch'ler upload stream'ini tüketmez. destroy() lazy construct'ı
 *  (fs.open) tetikler; afterAll dosyayı sildiyse open ENOENT'le döner ve
 *  destroyed stream'de uncaught 'error' olur — önce yut, sonra kapat. */
function drainBody(body: unknown): void {
  const s = body as { destroy?: () => void; on?: (ev: string, fn: () => void) => void } | undefined;
  s?.on?.('error', () => { /* beklenen: temizlik sonrası lazy-open ENOENT */ });
  s?.destroy?.();
}

/* ═══════════════════════════════════════════════════════════════
   parseArgs
═══════════════════════════════════════════════════════════════ */

describe('parseArgs', () => {
  it('--apk + --dry-run + --channel parse edilir', () => {
    expect(parseArgs(['--apk', 'a.apk', '--dry-run', '--channel', 'pilot']))
      .toEqual({ apkPath: 'a.apk', dryRun: true, channel: 'pilot' });
  });

  it('varsayılanlar: dryRun=false, channel=production', () => {
    expect(parseArgs(['--apk', 'a.apk']))
      .toEqual({ apkPath: 'a.apk', dryRun: false, channel: 'production' });
  });

  it('--apk eksik → fail (kullanım mesajı)', () => {
    expect(() => parseArgs([])).toThrow(/--apk/);
    expect(() => parseArgs(['--dry-run'])).toThrow(/--apk/);
  });

  it('geçersiz channel / bilinmeyen argüman → fail', () => {
    expect(() => parseArgs(['--apk', 'a.apk', '--channel', 'beta'])).toThrow(/Geçersiz channel/);
    expect(() => parseArgs(['--apk', 'a.apk', '--force'])).toThrow(/Bilinmeyen argüman/);
  });

  it('elle versionCode/versionName parametresi YOK (tek kaynak version.properties)', () => {
    expect(() => parseArgs(['--apk', 'a.apk', '--version-code', '5'])).toThrow(/Bilinmeyen argüman/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   parseVersionStrict — publish'te fallback yok
═══════════════════════════════════════════════════════════════ */

describe('parseVersionStrict', () => {
  it('geçerli version.properties parse edilir', () => {
    expect(parseVersionStrict('# yorum\nVERSION_CODE=7\nVERSION_NAME=2.1.0\n'))
      .toEqual({ versionCode: 7, versionName: '2.1.0' });
  });

  it('eksik anahtar → fail (fail-soft parser\'dan bilinçli ayrım)', () => {
    expect(() => parseVersionStrict('VERSION_NAME=1.0.0')).toThrow(/VERSION_CODE/);
    expect(() => parseVersionStrict('VERSION_CODE=2')).toThrow(/VERSION_NAME/);
    expect(() => parseVersionStrict('VERSION_CODE=abc\nVERSION_NAME=1.0.0')).toThrow(/VERSION_CODE/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   buildStoragePath + validateApk + sha256
═══════════════════════════════════════════════════════════════ */

describe('artefakt yardımcıları', () => {
  it('storage path deterministik: releases/v{NAME}/caros-pro-v{CODE}.apk', () => {
    expect(buildStoragePath('1.0.0', 2)).toBe('releases/v1.0.0/caros-pro-v2.apk');
    expect(buildStoragePath('2.4.1', 17)).toBe('releases/v2.4.1/caros-pro-v17.apk');
  });

  it('validateApk: eksik dosya → fail', () => {
    expect(() => validateApk(join(dir, 'yok.apk'))).toThrow(/bulunamadı/);
  });

  it('validateApk: boş APK → fail', () => {
    expect(() => validateApk(emptyApk)).toThrow(/boş/);
  });

  it('validateApk: ZIP imzasız dosya → fail (yanlış artefakt koruması)', () => {
    expect(() => validateApk(notZipApk)).toThrow(/ZIP imzası/);
  });

  it('validateApk: geçerli APK boyut döner', () => {
    expect(validateApk(validApk)).toEqual({ size: 20 }); // 'PK\x03\x04' + 16 bayt
  });

  it('sha256OfFile: bilinen vektör ("abc")', async () => {
    const abcFile = join(dir, 'abc.bin');
    writeFileSync(abcFile, 'abc');
    await expect(sha256OfFile(abcFile)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

/* ═══════════════════════════════════════════════════════════════
   runPublish — dry-run / env / akış
═══════════════════════════════════════════════════════════════ */

describe('runPublish', () => {
  it('dry-run: service role İSTEMEZ, özet gerçek hash/boyutla döner, fetch çağrılmaz', async () => {
    let fetchCalled = 0;
    const summary = await runPublish({
      apkPath: validApk, dryRun: true, channel: 'production',
      versionProps: PROPS, env: {}, // ← env tamamen boş
      fetchImpl: () => { fetchCalled++; },
    });
    expect(fetchCalled).toBe(0);
    expect(summary).toMatchObject({
      versionCode: 2, versionName: '1.0.0',
      apkPath: 'releases/v1.0.0/caros-pro-v2.apk',
      apkSize: 20, status: 'draft', dryRun: true,
    });
    expect(summary.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gerçek publish + SERVICE_ROLE_KEY yok → fail-fast (cihaza asla inmez kuralı)', async () => {
    await expect(runPublish({
      apkPath: validApk, dryRun: false, channel: 'production',
      versionProps: PROPS, env: { SUPABASE_URL: 'https://x.supabase.co' },
    })).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('gerçek publish + URL yok → fail-fast', async () => {
    await expect(runPublish({
      apkPath: validApk, dryRun: false, channel: 'production',
      versionProps: PROPS, env: { SUPABASE_SERVICE_ROLE_KEY: 'sk' },
    })).rejects.toThrow(/SUPABASE_URL/);
  });

  it('mock fetch: upload(storage) + insert(rest) doğru sırayla, draft + service role header', async () => {
    const calls: Array<{ url: string; method: string; auth: string | undefined; body?: string }> = [];
    const fetchImpl = (url: string, init: { method: string; headers: Record<string, string>; body?: unknown }) => {
      calls.push({
        url, method: init.method, auth: init.headers['Authorization'],
        body: typeof init.body === 'string' ? init.body : undefined,
      });
      if (typeof init.body !== 'string') drainBody(init.body);
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') });
    };
    const summary = await runPublish({
      apkPath: validApk, dryRun: false, channel: 'internal',
      versionProps: PROPS,
      env: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sk_test' },
      fetchImpl,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://x.supabase.co/storage/v1/object/ota_apks/releases/v1.0.0/caros-pro-v2.apk');
    expect(calls[1].url).toBe('https://x.supabase.co/rest/v1/ota_releases');
    expect(calls[0].auth).toBe('Bearer sk_test');
    const row = JSON.parse(calls[1].body!);
    expect(row).toMatchObject({
      version_code: 2, version_name: '1.0.0', channel: 'internal',
      apk_path: 'releases/v1.0.0/caros-pro-v2.apk', apk_size: 20, status: 'draft',
    });
    expect(row.sha256).toBe(summary.sha256);
  });

  it('storage 409 (sürüm zaten yüklü) → açık hata, insert ÇAĞRILMAZ', async () => {
    let insertCalled = false;
    const fetchImpl = (url: string, init: { body?: unknown }) => {
      if (url.includes('/storage/')) {
        drainBody(init.body);
        return Promise.resolve({ ok: false, status: 409, text: () => Promise.resolve('already exists') });
      }
      insertCalled = true;
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') });
    };
    await expect(runPublish({
      apkPath: validApk, dryRun: false, channel: 'production',
      versionProps: PROPS,
      env: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sk' },
      fetchImpl,
    })).rejects.toThrow(/zaten var/);
    expect(insertCalled).toBe(false);
  });

  it('insert hatası → storage artığı uyarısıyla fail (temizlik talimatı)', async () => {
    const fetchImpl = (url: string, init: { body?: unknown }) => {
      if (url.includes('/storage/')) {
        drainBody(init.body);
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') });
      }
      return Promise.resolve({ ok: false, status: 409, text: () => Promise.resolve('duplicate key') });
    };
    await expect(runPublish({
      apkPath: validApk, dryRun: false, channel: 'production',
      versionProps: PROPS,
      env: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sk' },
      fetchImpl,
    })).rejects.toThrow(/Storage'a yüklenen/);
  });

  it('bozuk APK ile dry-run bile fail (hash sahte veriyle üretilmez)', async () => {
    await expect(runPublish({
      apkPath: emptyApk, dryRun: true, channel: 'production',
      versionProps: PROPS, env: {},
    })).rejects.toThrow(/boş/);
  });
});
