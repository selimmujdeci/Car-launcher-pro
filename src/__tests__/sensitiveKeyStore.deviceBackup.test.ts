/**
 * sensitiveKeyStore.deviceBackup.test.ts — Cihaz-içi API anahtarı yedeği
 * (Google'sız, uninstall'a dayanıklı dosya yedeği) testleri.
 *
 * Bağlam: EncryptedSharedPreferences (Keystore) uninstall'da silinir; ikincil
 * Recovery Store (SharedPreferences + Android Auto Backup) Google hesabı /
 * Google Play Services olmayan cihazlarda (head unit — ana hedef) hiç geri
 * gelmiyor (sahada doğrulandı: "No available restore sets"). Bu üçüncü katman
 * anahtarları tek JSON blob olarak native `deviceKeyBackupWrite/Read`
 * üzerinden paylaşımlı harici depolamaya yazar/okur.
 *
 * Kapsam:
 *  (a) set(geminiApiKey) → deviceKeyBackupWrite blob'unda o anahtar var;
 *      RECOVERY dışı bir anahtarın (nav_history) set'i blob yazımını tetiklemez.
 *  (b) get() native boş + recovery boş + device blob dolu → değer döner VE
 *      nativeSet (secureStoreSet) ile geri doldurma çağrılır.
 *  (c) device backup okunamaz/plugin yok → mevcut davranış aynen (boş string,
 *      throw yok).
 *  (d) restore boot başına yalnızca 1 kez denenir (deviceKeyBackupRead tekrar
 *      çağrılmaz).
 *
 * Modül-içi `_deviceRestoreTried` singleton olduğu için her test `vi.resetModules()`
 * + dinamik `import()` ile TAZE modül durumu alır (appVersion.test.ts ile aynı desen).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock altyapısı ──────────────────────────────────────────────────────────
// Native modda çalıştığını simüle eder; CarLauncher metodları vi.fn() ile
// izlenir. secureStoreGet/Set gerçekçi bir in-memory store üzerinden çalışır
// ki restore sonrası "değer nativeSet ile geri yazıldı" senaryosu doğrulanabilsin.

const nativeStore = new Map<string, string>();

const mockSecureStoreGet = vi.fn(async (opts: { key: string }) => ({
  value: nativeStore.get(opts.key) ?? null,
}));
const mockSecureStoreSet = vi.fn(async (opts: { key: string; value: string }) => {
  nativeStore.set(opts.key, opts.value);
});
const mockLoadRecoveryKey = vi.fn(async () => ({ value: '' }));
const mockSaveRecoveryKey = vi.fn(async () => {});
const mockDeviceKeyBackupWrite = vi.fn(async () => {});
const mockDeviceKeyBackupRead = vi.fn(async (): Promise<{ blob: string | null }> => ({ blob: null }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    secureStoreGet: mockSecureStoreGet,
    secureStoreSet: mockSecureStoreSet,
    secureStoreRemove: vi.fn(async () => {}),
    loadRecoveryKey: mockLoadRecoveryKey,
    saveRecoveryKey: mockSaveRecoveryKey,
    deviceKeyBackupWrite: mockDeviceKeyBackupWrite,
    deviceKeyBackupRead: mockDeviceKeyBackupRead,
  },
}));

vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));
vi.mock('../platform/debug', () => ({ logInfo: vi.fn() }));

async function freshStore() {
  vi.resetModules();
  const mod = await import('../platform/sensitiveKeyStore');
  return mod.sensitiveKeyStore;
}

beforeEach(() => {
  nativeStore.clear();
  mockSecureStoreGet.mockClear();
  mockSecureStoreSet.mockClear();
  mockLoadRecoveryKey.mockClear();
  mockLoadRecoveryKey.mockResolvedValue({ value: '' });
  mockSaveRecoveryKey.mockClear();
  mockDeviceKeyBackupWrite.mockClear();
  mockDeviceKeyBackupRead.mockClear();
  mockDeviceKeyBackupRead.mockResolvedValue({ blob: null });
});

/* ═══════════════════════════════════════════════════════════════
   (a) set() → deviceKeyBackupWrite tetiklenir, doğru anahtarları içerir
═══════════════════════════════════════════════════════════════ */

describe('sensitiveKeyStore.set — cihaz-içi yedek senkronizasyonu', () => {
  it('geminiApiKey set edilince deviceKeyBackupWrite blob\'unda o anahtar bulunur', async () => {
    const store = await freshStore();
    await store.set('geminiApiKey', 'AIzaSyTESTKEY0000000000000000000000');

    // _deviceBackupSync fire-and-forget çağrılır (set() onu beklemez) — mikro
    // görev kuyruğunun boşalmasını bekle.
    await vi.waitFor(() => expect(mockDeviceKeyBackupWrite).toHaveBeenCalledTimes(1));
    const blobArg = mockDeviceKeyBackupWrite.mock.calls[0][0] as { blob: string };
    const parsed = JSON.parse(blobArg.blob) as { v: number; keys: Record<string, string> };
    expect(parsed.keys.geminiApiKey).toBe('AIzaSyTESTKEY0000000000000000000000');
  });

  it('RECOVERY dışı bir anahtarın (nav_history) set\'i deviceKeyBackupWrite\'ı tetiklemez ve blob\'a girmez', async () => {
    const store = await freshStore();
    await store.set('nav_history', 'gizli-olmayan-rota-verisi');

    // nav_history RECOVERY_KEYS içinde değil → _deviceBackupSync hiç çağrılmaz.
    expect(mockDeviceKeyBackupWrite).not.toHaveBeenCalled();
  });

  it('nav_history sonrası geminiApiKey set edilirse blob içinde nav_history YOKTUR', async () => {
    const store = await freshStore();
    await store.set('nav_history', 'gizli-olmayan-rota-verisi');
    await store.set('geminiApiKey', 'AIzaSyTESTKEY0000000000000000000000');

    await vi.waitFor(() => expect(mockDeviceKeyBackupWrite).toHaveBeenCalledTimes(1));
    const blobArg = mockDeviceKeyBackupWrite.mock.calls[0][0] as { blob: string };
    const parsed = JSON.parse(blobArg.blob) as { keys: Record<string, string> };
    expect(parsed.keys.nav_history).toBeUndefined();
    expect(parsed.keys.geminiApiKey).toBe('AIzaSyTESTKEY0000000000000000000000');
  });
});

/* ═══════════════════════════════════════════════════════════════
   (b) get() — native+recovery boş, device blob dolu → geri doldurma
═══════════════════════════════════════════════════════════════ */

describe('sensitiveKeyStore.get — cihaz-içi yedekten geri yükleme', () => {
  it('native boş + recovery boş + device blob dolu → değer döner ve secureStoreSet çağrılır', async () => {
    const store = await freshStore();
    mockDeviceKeyBackupRead.mockResolvedValueOnce({
      blob: JSON.stringify({ v: 1, keys: { geminiApiKey: 'AIzaSyRESTORED000000000000000000000' } }),
    });

    const value = await store.get('geminiApiKey');

    expect(value).toBe('AIzaSyRESTORED000000000000000000000');
    expect(mockSecureStoreSet).toHaveBeenCalledWith({ key: 'geminiApiKey', value: 'AIzaSyRESTORED000000000000000000000' });
  });

  it('device blob\'da o anahtar yoksa boş string döner (throw yok)', async () => {
    const store = await freshStore();
    mockDeviceKeyBackupRead.mockResolvedValueOnce({
      blob: JSON.stringify({ v: 1, keys: { groqApiKey: 'gsk_diger_anahtar' } }),
    });

    const value = await store.get('geminiApiKey');
    expect(value).toBe('');
  });
});

/* ═══════════════════════════════════════════════════════════════
   (c) Okunamaz/plugin yok → mevcut davranış aynen (fail-soft)
═══════════════════════════════════════════════════════════════ */

describe('sensitiveKeyStore.get — cihaz-içi yedek okunamazsa fail-soft', () => {
  it('deviceKeyBackupRead reject ederse throw etmez, boş string döner', async () => {
    const store = await freshStore();
    mockDeviceKeyBackupRead.mockRejectedValueOnce(new Error('dosya bulunamadı'));

    await expect(store.get('geminiApiKey')).resolves.toBe('');
  });

  it('bozuk (JSON.parse edilemeyen) blob döner → throw etmez, boş string döner', async () => {
    const store = await freshStore();
    mockDeviceKeyBackupRead.mockResolvedValueOnce({ blob: 'BOZUK-JSON-DEGIL' });

    await expect(store.get('geminiApiKey')).resolves.toBe('');
  });

  it('blob null ise (dosya hiç yok) throw etmez, boş string döner', async () => {
    const store = await freshStore();
    mockDeviceKeyBackupRead.mockResolvedValueOnce({ blob: null });

    await expect(store.get('geminiApiKey')).resolves.toBe('');
  });
});

/* ═══════════════════════════════════════════════════════════════
   (d) Restore boot başına yalnızca 1 kez denenir
═══════════════════════════════════════════════════════════════ */

describe('sensitiveKeyStore.get — restore boot başına 1 kez', () => {
  it('art arda get() çağrılarında deviceKeyBackupRead yalnızca 1 kez çağrılır', async () => {
    const store = await freshStore();
    mockDeviceKeyBackupRead.mockResolvedValue({ blob: null });

    await store.get('geminiApiKey');
    await store.get('claudeHaikuApiKey');
    await store.get('groqApiKey');

    expect(mockDeviceKeyBackupRead).toHaveBeenCalledTimes(1);
  });

  it('ilk restore blob getirse bile ikinci get() çağrısı deviceKeyBackupRead\'i tekrar çağırmaz', async () => {
    const store = await freshStore();
    mockDeviceKeyBackupRead.mockResolvedValueOnce({
      blob: JSON.stringify({ v: 1, keys: { geminiApiKey: 'AIzaSyRESTORED000000000000000000000' } }),
    });

    const first = await store.get('geminiApiKey');
    expect(first).toBe('AIzaSyRESTORED000000000000000000000');

    // İkinci çağrıda artık native store'da değer var (restore sırasında secureStoreSet yazıldı)
    // → nativeGet zaten dolu döner, deviceKeyBackupRead tekrar tetiklenmez.
    const second = await store.get('geminiApiKey');
    expect(second).toBe('AIzaSyRESTORED000000000000000000000');
    expect(mockDeviceKeyBackupRead).toHaveBeenCalledTimes(1);
  });
});
