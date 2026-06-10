/**
 * otaInstall.test.ts — OTA v1 / Commit 5: güvenli kurulum kapısı
 *
 * A) JS wrapper birim testleri: fileName reddi, fail-soft, sonuç passthrough
 *    (settings_opened / install_prompted), köprü hatası.
 * B) Java kaynak SÖZLEŞME kilitleri: downgrade/paket/imza reddi, izin
 *    yönlendirmesi, FileProvider + ACTION_VIEW, kontrol SIRASI (imza
 *    kontrolü startActivity'den ÖNCE), canonical containment.
 *
 * NOT: Gerçek kurulum diyaloğu + OEM ROM'un bilinmeyen-kaynak ayarının
 * varlığı K24'te doğrulanmalı — "cihazda doğrulanmadı" (bilinen en büyük
 * Commit 5 riski: ayar ekranı ROM'da gizli/kilitli olabilir).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { capState, mockInstallOtaApk } = vi.hoisted(() => ({
  capState: { native: false },
  mockInstallOtaApk: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capState.native,
    getPlatform:      () => (capState.native ? 'android' : 'web'),
  },
  registerPlugin: () => new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'installOtaApk') return mockInstallOtaApk;
      return vi.fn();
    },
  }),
}));

import { installOtaApk } from '../platform/nativeCommandBridge';

beforeEach(() => {
  capState.native = false;
  mockInstallOtaApk.mockReset();
});

/* ═══════════════════════════════════════════════════════════════
   A. JS wrapper
═══════════════════════════════════════════════════════════════ */

describe('installOtaApk wrapper', () => {
  it('traversal/ayraç fileName → ERR_INPUT, native HİÇ çağrılmaz', async () => {
    capState.native = true;
    for (const bad of ['../evil.apk', 'a/b.apk', 'a\\b.apk', '.gizli.apk', '', 'a..b.apk']) {
      const r = await installOtaApk(bad);
      expect(r, `kabul edilmemeliydi: "${bad}"`).toMatchObject({ ok: false, errorCode: 'ERR_INPUT' });
    }
    expect(mockInstallOtaApk).not.toHaveBeenCalled();
  });

  it('web/dev → ERR_NO_NATIVE fail-soft (throw yok)', async () => {
    const r = await installOtaApk('caros-pro-v3.apk');
    expect(r).toMatchObject({ ok: false, errorCode: 'ERR_NO_NATIVE' });
    expect(mockInstallOtaApk).not.toHaveBeenCalled();
  });

  it('izin yok → settings_opened sonucu olduğu gibi geçer (çağıran yeniden dener)', async () => {
    capState.native = true;
    mockInstallOtaApk.mockResolvedValue({
      ok: false, action: 'settings_opened', errorCode: 'ERR_NO_PERMISSION',
      errorMessage: 'Bilinmeyen kaynak izni yok',
    });
    const r = await installOtaApk('caros-pro-v3.apk');
    expect(r).toMatchObject({ ok: false, action: 'settings_opened', errorCode: 'ERR_NO_PERMISSION' });
    expect(mockInstallOtaApk).toHaveBeenCalledWith({ fileName: 'caros-pro-v3.apk' });
  });

  it('izin var → install_prompted (sistem diyaloğu açıldı)', async () => {
    capState.native = true;
    mockInstallOtaApk.mockResolvedValue({ ok: true, action: 'install_prompted' });
    const r = await installOtaApk('caros-pro-v3.apk');
    expect(r).toMatchObject({ ok: true, action: 'install_prompted' });
  });

  it('native red sonuçları (downgrade/paket/imza/eksik dosya) olduğu gibi geçer', async () => {
    capState.native = true;
    for (const code of ['ERR_DOWNGRADE', 'ERR_PACKAGE', 'ERR_SIGNATURE', 'ERR_NOT_FOUND']) {
      mockInstallOtaApk.mockResolvedValueOnce({ ok: false, errorCode: code, errorMessage: code });
      const r = await installOtaApk('caros-pro-v3.apk');
      expect(r).toMatchObject({ ok: false, errorCode: code });
    }
  });

  it('köprü hatası → ERR_BRIDGE fail-soft', async () => {
    capState.native = true;
    mockInstallOtaApk.mockRejectedValue(new Error('bridge down'));
    const r = await installOtaApk('caros-pro-v3.apk');
    expect(r).toMatchObject({ ok: false, errorCode: 'ERR_BRIDGE', errorMessage: 'bridge down' });
  });
});

/* ═══════════════════════════════════════════════════════════════
   B. Java kaynak sözleşme kilitleri
═══════════════════════════════════════════════════════════════ */

describe('OtaInstallManager.java güvenlik sözleşmesi', () => {
  const java = readFileSync(join(process.cwd(),
    'android/app/src/main/java/com/cockpitos/pro/ota/OtaInstallManager.java'), 'utf-8');
  const plugin = readFileSync(join(process.cwd(),
    'android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java'), 'utf-8');
  const manifest = readFileSync(join(process.cwd(),
    'android/app/src/main/AndroidManifest.xml'), 'utf-8');

  it('manifest: REQUEST_INSTALL_PACKAGES gerekçeli yorum ile eklendi', () => {
    expect(manifest).toContain('android.permission.REQUEST_INSTALL_PACKAGES');
    expect(manifest).toMatch(/SESSIZ KURULUM YOK/);
  });

  it('izin akışı: canRequestPackageInstalls → ACTION_MANAGE_UNKNOWN_APP_SOURCES yönlendirme', () => {
    expect(java).toContain('canRequestPackageInstalls()');
    expect(java).toContain('Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES');
    expect(java).toContain('settingsOpened()');
  });

  it('downgrade reddi: archiveVersionCode <= kurulu → ERR_DOWNGRADE', () => {
    expect(java).toMatch(/archiveCode <= currentCode/);
    expect(java).toContain('"ERR_DOWNGRADE"');
  });

  it('paket reddi: farklı packageName → ERR_PACKAGE', () => {
    expect(java).toMatch(/!ownPackage\.equals\(archive\.packageName\)/);
    expect(java).toContain('"ERR_PACKAGE"');
  });

  it('imza reddi: sertifika SHA-256 SET eşitliği → ERR_SIGNATURE (boş set de red)', () => {
    expect(java).toContain('GET_SIGNING_CERTIFICATES');
    expect(java).toMatch(/archiveSigs\.isEmpty\(\) \|\| !archiveSigs\.equals\(currentSigs\)/);
    expect(java).toContain('"ERR_SIGNATURE"');
  });

  it('konum kilidi: isSafeFileName + canonical path containment (files/ota dışı red)', () => {
    expect(java).toContain('OtaDownloadManager.isSafeFileName(fileName)');
    expect(java).toMatch(/getCanonicalPath\(\)/);
    expect(java).toMatch(/!apkCanonical\.startsWith\(dirCanonical\)/);
    expect(java).toContain('"ERR_NOT_FOUND"');
  });

  it('kurulum intent\'i: FileProvider content-URI + ACTION_VIEW + GRANT_READ + APK mime', () => {
    expect(java).toContain('FileProvider.getUriForFile');
    expect(java).toContain('".fileprovider"');
    expect(java).toContain('Intent.ACTION_VIEW');
    expect(java).toContain('FLAG_GRANT_READ_URI_PERMISSION');
    expect(java).toContain('application/vnd.android.package-archive');
  });

  it('kontrol SIRASI: paket → sürüm → imza kontrolleri startActivity(kurulum)dan ÖNCE', () => {
    const pkgIdx  = java.indexOf('"ERR_PACKAGE"');
    const dgIdx   = java.indexOf('"ERR_DOWNGRADE"');
    const sigIdx  = java.indexOf('"ERR_SIGNATURE"');
    const promptIdx = java.indexOf('ctx.startActivity(install)');
    expect(pkgIdx).toBeGreaterThan(0);
    expect(dgIdx).toBeGreaterThan(pkgIdx);
    expect(sigIdx).toBeGreaterThan(dgIdx);
    expect(promptIdx).toBeGreaterThan(sigIdx);
  });

  it('sessiz kurulum YOK: PackageInstaller session/commit kullanılmıyor', () => {
    expect(java).not.toContain('PackageInstaller');
    expect(java).not.toContain('commitSession');
  });

  it('plugin köprüsü: installOtaApk @PluginMethod OTA_EXECUTOR üzerinde (UI bloklamaz)', () => {
    expect(plugin).toContain('public void installOtaApk(PluginCall call)');
    expect(plugin).toMatch(/installOtaApk[\s\S]{0,400}OTA_EXECUTOR\.execute/);
    expect(plugin).toMatch(/OtaInstallManager\.install\(ctx, fileName\)/);
  });
});
