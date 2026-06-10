/**
 * otaDownload.test.ts — OTA v1 / Commit 4: native indirme + hash doğrulama
 *
 * İki katman:
 *  A) JS wrapper (çalıştırılabilir birim test): girdi doğrulama, fail-soft,
 *     progress listener yaşam döngüsü, hata eşleme.
 *  B) Java kaynak SÖZLEŞME kilitleri (OtaDownloadManager.java cihazsız
 *     çalıştırılamaz — streaming/.tmp/silme/disk/service_role-yasağı gibi
 *     güvenlik değişmezleri kaynak üzerinde kilitlenir; biri kaldırılırsa
 *     bu testler kırılır).
 *
 * NOT: Gerçek indirme/hash NATIVE'de koşar — K24'te küçük test binary'siyle
 * doğrulama "cihazda doğrulanmadı" (RELEASE_CHECKLIST). Gradle compile yeşil.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Mock altyapısı (appVersion.test.ts deseni) ───────────────────────────────

// vi.mock hoist edilir ve statik import zinciri (nativeCommandBridge →
// safeStorage → Capacitor.isNativePlatform()) factory'yi modül init'inden
// ÖNCE çalıştırır → state vi.hoisted ile TDZ'siz tanımlanmalı.
const { capState, mockDownloadOtaApk, mockRemove, mockAddListener } = vi.hoisted(() => {
  const remove = vi.fn(() => Promise.resolve());
  return {
    capState: { native: false },
    mockDownloadOtaApk: vi.fn(),
    mockRemove: remove,
    mockAddListener: vi.fn(() => Promise.resolve({ remove })),
  };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capState.native,
    getPlatform:      () => (capState.native ? 'android' : 'web'),
  },
  registerPlugin: () => new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'downloadOtaApk') return mockDownloadOtaApk;
      if (prop === 'addListener')    return mockAddListener;
      return vi.fn();
    },
  }),
}));

import { validateOtaDownloadInput, downloadOtaApk } from '../platform/nativeCommandBridge';

const VALID = {
  url: 'https://x.supabase.co/storage/v1/object/ota_apks/releases/v1.0.0/caros-pro-v2.apk',
  expectedSha256: 'a'.repeat(64),
  expectedSize: 1024,
  fileName: 'caros-pro-v2.apk',
};

beforeEach(() => {
  capState.native = false;
  mockDownloadOtaApk.mockReset();
  mockAddListener.mockClear();
  mockRemove.mockClear();
});

/* ═══════════════════════════════════════════════════════════════
   A1. validateOtaDownloadInput — saf girdi doğrulama
═══════════════════════════════════════════════════════════════ */

describe('validateOtaDownloadInput', () => {
  it('geçerli girdi → null', () => {
    expect(validateOtaDownloadInput(VALID)).toBeNull();
  });

  it('boş/https-olmayan url → fail', () => {
    expect(validateOtaDownloadInput({ ...VALID, url: '' })).toMatch(/https/);
    expect(validateOtaDownloadInput({ ...VALID, url: 'http://x.co/a.apk' })).toMatch(/https/);
  });

  it('bozuk sha256 (kısa / hex-değil) → fail', () => {
    expect(validateOtaDownloadInput({ ...VALID, expectedSha256: 'abc' })).toMatch(/64-hex/);
    expect(validateOtaDownloadInput({ ...VALID, expectedSha256: 'z'.repeat(64) })).toMatch(/64-hex/);
  });

  it('expectedSize ≤ 0 / NaN → fail', () => {
    expect(validateOtaDownloadInput({ ...VALID, expectedSize: 0 })).toMatch(/expectedSize/);
    expect(validateOtaDownloadInput({ ...VALID, expectedSize: -5 })).toMatch(/expectedSize/);
    expect(validateOtaDownloadInput({ ...VALID, expectedSize: Number.NaN })).toMatch(/expectedSize/);
  });

  it('path traversal / ayraç / gizli dosya fileName → fail', () => {
    for (const bad of ['../evil.apk', 'a/b.apk', 'a\\b.apk', '.hidden.apk', '', 'a..b.apk']) {
      expect(validateOtaDownloadInput({ ...VALID, fileName: bad }),
        `kabul edilmemeliydi: "${bad}"`).not.toBeNull();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════
   A2. downloadOtaApk wrapper — fail-soft + listener yaşam döngüsü
═══════════════════════════════════════════════════════════════ */

describe('downloadOtaApk wrapper', () => {
  it('geçersiz girdi → ERR_INPUT, native HİÇ çağrılmaz (native platformda bile)', async () => {
    capState.native = true;
    const r = await downloadOtaApk({ ...VALID, fileName: '../evil.apk' });
    expect(r).toMatchObject({ ok: false, errorCode: 'ERR_INPUT' });
    expect(mockDownloadOtaApk).not.toHaveBeenCalled();
  });

  it('web/dev → ERR_NO_NATIVE fail-soft (throw yok)', async () => {
    const r = await downloadOtaApk(VALID);
    expect(r).toMatchObject({ ok: false, errorCode: 'ERR_NO_NATIVE' });
    expect(mockDownloadOtaApk).not.toHaveBeenCalled();
  });

  it('native başarı: sonuç passthrough + progress event doğru tipte iletilir + listener kaldırılır', async () => {
    capState.native = true;
    mockDownloadOtaApk.mockResolvedValue({
      ok: true, path: '/data/data/com.cockpitos.pro/files/ota/caros-pro-v2.apk',
      sha256: VALID.expectedSha256, size: 1024,
    });
    const events: Array<{ downloadedBytes: number; totalBytes: number; percent: number }> = [];

    const r = await downloadOtaApk(VALID, (ev) => events.push(ev));

    expect(r.ok).toBe(true);
    expect(r.path).toContain('files/ota/caros-pro-v2.apk');
    expect(mockAddListener).toHaveBeenCalledWith('otaDownloadProgress', expect.any(Function));
    // Native event'i simüle et: kayıtlı handler'a sözleşme şeklinde payload ver
    const handler = mockAddListener.mock.calls[0]![1] as (e: unknown) => void;
    handler({ downloadedBytes: 512, totalBytes: 1024, percent: 50 });
    expect(events).toEqual([{ downloadedBytes: 512, totalBytes: 1024, percent: 50 }]);
    expect(mockRemove).toHaveBeenCalledTimes(1); // Zero-Leak: listener kaldırıldı
  });

  it('onProgress verilmezse listener hiç kurulmaz', async () => {
    capState.native = true;
    mockDownloadOtaApk.mockResolvedValue({ ok: true, path: '/x', sha256: 'a'.repeat(64), size: 1 });
    await downloadOtaApk(VALID);
    expect(mockAddListener).not.toHaveBeenCalled();
  });

  it('köprü hatası → ERR_BRIDGE fail-soft + listener yine kaldırılır', async () => {
    capState.native = true;
    mockDownloadOtaApk.mockRejectedValue(new Error('bridge down'));
    const r = await downloadOtaApk(VALID, () => {});
    expect(r).toMatchObject({ ok: false, errorCode: 'ERR_BRIDGE', errorMessage: 'bridge down' });
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it('native hata sonucu (ERR_HASH vb.) olduğu gibi geçer', async () => {
    capState.native = true;
    mockDownloadOtaApk.mockResolvedValue({
      ok: false, errorCode: 'ERR_HASH', errorMessage: 'SHA-256 uyuşmazlığı',
    });
    const r = await downloadOtaApk(VALID);
    expect(r).toMatchObject({ ok: false, errorCode: 'ERR_HASH' });
  });
});

/* ═══════════════════════════════════════════════════════════════
   B. Java kaynak sözleşme kilitleri
═══════════════════════════════════════════════════════════════ */

describe('OtaDownloadManager.java güvenlik sözleşmesi', () => {
  const java = readFileSync(join(process.cwd(),
    'android/app/src/main/java/com/cockpitos/pro/ota/OtaDownloadManager.java'), 'utf-8');
  const plugin = readFileSync(join(process.cwd(),
    'android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java'), 'utf-8');

  it('streaming: 64KB buffer döngüsü + eş-zamanlı digest (RAM\'e komple alma YOK)', () => {
    expect(java).toMatch(/while \(\(n = in\.read\(buffer\)\) > 0\)/);
    expect(java).toContain('digest.update(buffer, 0, n)');
    expect(java).toContain('MessageDigest.getInstance("SHA-256")');
    expect(java).not.toContain('readAllBytes'); // tüm-dosya RAM okuma yasak
  });

  it('.tmp → doğrulama → rename sırası: renameTo, hash karşılaştırmasından SONRA', () => {
    expect(java).toContain('fileName + ".tmp"');
    const hashCheckIdx = java.indexOf('equalsIgnoreCase(expectedSha256)');
    const renameIdx    = java.indexOf('tmpFile.renameTo(finalFile)');
    expect(hashCheckIdx).toBeGreaterThan(0);
    expect(renameIdx).toBeGreaterThan(hashCheckIdx);
  });

  it('hash/boyut uyuşmazlığında ve her hata yolunda tmp silinir', () => {
    // ERR_SIZE (aşım) + ERR_SIZE (eksik) + ERR_HASH + catch-all: ≥4 delete
    const deletes = java.match(/tmpFile\.delete\(\)/g) ?? [];
    expect(deletes.length).toBeGreaterThanOrEqual(4);
    expect(java).toMatch(/Boyut aşımı/);          // sunucuya güven yok: aşımda anında kes
    expect(java).toMatch(/SHA-256 uyuşmazlığı/);
  });

  it('bayat .tmp temizliği + disk kontrolü (usableSpace ≥ expectedSize * 2)', () => {
    expect(java).toContain('cleanupStaleTmp');
    expect(java).toMatch(/\.endsWith\("\.tmp"\)/);
    expect(java).toMatch(/usable < expectedSize \* 2/);
  });

  it('girdi doğrulama native\'de de var (defense-in-depth) + service_role YASAK', () => {
    expect(java).toMatch(/startsWith\("https:\/\/"\)/);
    expect(java).toMatch(/\[0-9a-fA-F\]\{64\}/);
    expect(java).toContain('isSafeFileName');
    expect(java).toContain('!name.contains("..")');
    expect(java.toLowerCase()).not.toContain('service_role');
  });

  it('plugin köprüsü: tek-iş executor (UI bloklamaz) + otaDownloadProgress eventi', () => {
    expect(plugin).toContain('OTA_EXECUTOR = Executors.newSingleThreadExecutor()');
    expect(plugin).toMatch(/OTA_EXECUTOR\.execute/);
    expect(plugin).toContain('notifyListeners("otaDownloadProgress", ev)');
  });

  it('sorumluluk ayrımı: indirme sınıfında kurulum mantığı YOK (kurulum = OtaInstallManager)', () => {
    // Commit 5 izni manifest'e ekledi; bu kilit artık SINIF-DÜZEYİNDE:
    // downloader asla intent/kurucu çağırmaz — tek işi indirme+doğrulama.
    expect(java).not.toContain('PackageInstaller');
    expect(java).not.toContain('ACTION_VIEW');
    expect(java).not.toContain('startActivity');
    expect(java).not.toContain('REQUEST_INSTALL_PACKAGES');
  });

  it('FileProvider hazırlığı: file_paths.xml files/ota yolu', () => {
    const paths = readFileSync(join(process.cwd(),
      'android/app/src/main/res/xml/file_paths.xml'), 'utf-8');
    expect(paths).toMatch(/<files-path name="ota" path="ota\/"\s*\/>/);
  });
});
