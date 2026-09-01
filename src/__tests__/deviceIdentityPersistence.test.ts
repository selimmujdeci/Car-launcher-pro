/**
 * deviceIdentityPersistence.test.ts — P0-001C · CİHAZ KİMLİĞİNİN KALICILIĞI
 *
 * ── ÖLÇÜLEN KUSUR ─────────────────────────────────────────────────────────
 * `veh_device_id` rastgele üretilip EncryptedSharedPreferences'a yazılıyordu.
 * O depo Android Keystore anahtarına bağlıdır ve uygulama KALDIRILDIĞINDA
 * anahtarla birlikte silinir. Reinstall sonrası cihaz yeni bir UUID üretiyor,
 * sunucu onu YENİ BİR ARAÇ sanıyordu.
 * Üretim izi: 838 araç · 822 tekil `device_name` · **837'si SAHİPSİZ**.
 *
 * ── BU DOSYANIN ASIL KANITI ───────────────────────────────────────────────
 * "Kimlik türetiliyor mu" değil — **reinstall'dan sonra SUNUCUYA AYNI
 * `p_device_id` gidiyor mu.** Kusur sunucuda yeni satır açılmasıydı; kanıt da
 * oradan okunmalıdır. Bu yüzden testler `register_vehicle` çağrısının
 * GÖVDESİNİ karşılaştırır, iç değişkenleri değil.
 *
 * ── REINSTALL NASIL SİMÜLE EDİLİR ─────────────────────────────────────────
 * `vi.resetModules()` + güvenli deponun BOŞALTILMASI = uygulamanın silinip
 * yeniden kurulması. SSAID (cihaz) aynı kalır — gerçekte de öyledir.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  store: new Map<string, string>(),
  /** Native SSAID türevi; `null` → SSAID okunamıyor. */
  stableId: null as string | null,
  /** true → native metot hiç yok (eski APK) — çağrı fırlatır. */
  nativeMissing: false,
  isNative: true,
  calls: [] as Array<{ url: string; body: Record<string, unknown> }>,
}));

vi.mock('../platform/sensitiveKeyStore', () => ({
  sensitiveKeyStore: {
    get: vi.fn(async (k: string) => M.store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { M.store.set(k, v); }),
    remove: vi.fn(async (k: string) => { M.store.delete(k); }),
  },
}));

vi.mock('../platform/connectivityService', () => ({
  connectivityService: { enqueue: vi.fn(async () => {}) },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => M.isNative },
}));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    getStableDeviceId: vi.fn(async () => {
      if (M.nativeMissing) throw new Error('not implemented');
      return M.stableId === null
        ? { deviceId: null, source: 'UNAVAILABLE' }
        : { deviceId: M.stableId, source: 'SSAID' };
    }),
  },
}));

/** Gerçek SSAID türevi biçimi: 64 hex karakter. */
const SSAID_HASH_A = 'a'.repeat(64);
const SSAID_HASH_B = 'b'.repeat(64);

function registerFetch(withKey: boolean, alreadyProvisioned = false) {
  return vi.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    M.calls.push({ url: String(url), body });
    if (String(url).includes('/rpc/register_vehicle')) {
      return {
        ok: true,
        json: async () => ({
          vehicle_id: 'veh-123',
          ...(withKey ? { api_key: 'key_first_time' } : {}),
          ...(alreadyProvisioned ? { already_provisioned: true } : {}),
          linking_code: '123456',
          expires_at: new Date(Date.now() + 300_000).toISOString(),
        }),
      };
    }
    return { ok: false, json: async () => ({ message: 'unexpected_rpc' }) };
  });
}

beforeEach(() => {
  vi.resetModules();
  M.store = new Map();
  M.stableId = SSAID_HASH_A;
  M.nativeMissing = false;
  M.isNative = true;
  M.calls = [];
  vi.stubGlobal('fetch', registerFetch(true));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('P0-001C · ilk kurulum', () => {
  it("temiz cihaz: kimlik SSAID'den TÜRETİLİR ve saklanır", async () => {
    const vis = await import('../platform/vehicleIdentityService');

    const id = await vis.getReporterDeviceId();

    expect(id).toBe(SSAID_HASH_A);
    expect(M.store.get('veh_device_id')).toBe(SSAID_HASH_A);
    expect(vis.getDeviceIdentityStatus().source).toBe('DERIVED_SSAID');
    expect(vis.getDeviceIdentityStatus().reinstallSafe).toBe(true);
  });

  it('ilk kayıt api_key ALIR ve saklar (P0-001A ilk-dal sözleşmesi korunur)', async () => {
    const vis = await import('../platform/vehicleIdentityService');

    const res = await vis.registerVehicle();

    expect(res.code).toBe('123456');
    expect(M.store.get('veh_api_key')).toBe('key_first_time');
    expect(vis.getDeviceIdentityStatus().registeredWithoutKey).toBe(false);
  });
});

describe('P0-001C · REINSTALL (asıl kusur)', () => {
  it('KİLİT: reinstall sonrası SUNUCUYA AYNI device_id gider — yeni araç AÇILMAZ', async () => {
    // ── 1. kurulum ────────────────────────────────────────────────────────
    const first = await import('../platform/vehicleIdentityService');
    await first.registerVehicle();
    const firstDeviceId = M.calls[0].body.p_device_id as string;
    expect(firstDeviceId).toBe(SSAID_HASH_A);

    // ── UYGULAMA SİLİNİR ──────────────────────────────────────────────────
    // EncryptedSharedPreferences, Keystore anahtarıyla birlikte yok olur.
    // Cihaz (SSAID) AYNI kalır — gerçekte de öyledir.
    M.store.clear();
    M.calls = [];
    vi.resetModules();
    vi.stubGlobal('fetch', registerFetch(false, true));

    // ── 2. kurulum (reinstall) ────────────────────────────────────────────
    const second = await import('../platform/vehicleIdentityService');
    await second.registerVehicle();
    const secondDeviceId = M.calls[0].body.p_device_id as string;

    /* ASIL KANIT: iki kurulum sunucuya AYNI kimliği bildirir. Eski davranışta
       burada rastgele YENİ bir UUID olurdu ve sunucu yeni bir araç açardı. */
    expect(secondDeviceId, 'reinstall yeni bir device_id üretti — yeni araç açılır')
      .toBe(firstDeviceId);
    expect(second.getDeviceIdentityStatus().source).toBe('DERIVED_SSAID');
  });

  it('reinstall sonrası anahtar GERİ GELMEZ ve bu durum RAPORLANIR (uydurma yok)', async () => {
    /* P0-001A gereği sunucu mevcut cihaza ham anahtarı bir daha VERMEZ.
       Kimlik doğru, anahtar yok → "kayıtlı ama anahtarsız". Bu SESSİZ
       bırakılmaz; sessiz bırakmak cihazı sebepsiz kör gösterirdi. */
    vi.stubGlobal('fetch', registerFetch(false, true));
    const vis = await import('../platform/vehicleIdentityService');

    await vis.registerVehicle();

    expect(await vis.isDevicePaired()).toBe(false);
    expect(vis.getDeviceIdentityStatus().registeredWithoutKey).toBe(true);
    expect(vis.getDeviceIdentityStatus().reinstallSafe).toBe(true);
  });

  it('reinstall YENİ araç açmaz ama boot da kilitlenmez (fail-soft)', async () => {
    vi.stubGlobal('fetch', registerFetch(false, true));
    const vis = await import('../platform/vehicleIdentityService');

    const ok = await vis.ensureDeviceRegistered();

    expect(ok).toBe(false);                    // anahtar alınamadı — dürüst cevap
    expect(M.calls).toHaveLength(1);           // TEK deneme; boot loop YOK
    expect(M.store.get('veh_device_id')).toBe(SSAID_HASH_A);
  });
});

describe('P0-001C · mevcut kayıtlı cihazlar (geriye uyumluluk)', () => {
  it("KİLİT: SAKLI kimlik AYNEN korunur — SSAID'e HİÇ bakılmaz", async () => {
    /* EN KRİTİK KURAL: sahadaki 838 cihazın kimliği rastgele üretilmiştir ve
       SSAID türeviyle eşleşmez. Türetme saklı değeri EZSEYDİ, bu düzeltmenin
       kendisi tüm filoyu yeni araç açmaya zorlardı — önlemek istediği
       felaketin aynısı. */
    M.store.set('veh_device_id', 'legacy-random-uuid-from-old-apk');
    const { CarLauncher } = await import('../platform/nativePlugin');
    const vis = await import('../platform/vehicleIdentityService');

    const id = await vis.getReporterDeviceId();

    expect(id).toBe('legacy-random-uuid-from-old-apk');
    expect(vis.getDeviceIdentityStatus().source).toBe('STORED');
    expect(CarLauncher.getStableDeviceId, 'saklı kimlik varken SSAID sorulmamalı')
      .not.toHaveBeenCalled();
  });

  it('saklı kimlik sunucuya DEĞİŞMEDEN bildirilir', async () => {
    M.store.set('veh_device_id', 'legacy-random-uuid-from-old-apk');
    const vis = await import('../platform/vehicleIdentityService');

    await vis.registerVehicle();

    expect(M.calls[0].body.p_device_id).toBe('legacy-random-uuid-from-old-apk');
  });
});

describe('P0-001C · SSAID kullanılamadığında (fail-soft)', () => {
  it('SSAID yok → rastgele kimliğe düşer ve bunu SAKLAMAZ gibi davranmaz', async () => {
    M.stableId = null;
    const vis = await import('../platform/vehicleIdentityService');

    const id = await vis.getReporterDeviceId();

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(M.store.get('veh_device_id')).toBe(id);
    expect(vis.getDeviceIdentityStatus().source).toBe('RANDOM_FALLBACK');
    /* Bu dalda reinstall HÂLÂ yeni araç açar — "güvenli" DENMEZ. */
    expect(vis.getDeviceIdentityStatus().reinstallSafe).toBe(false);
  });

  it('eski APK (native metot YOK) → çökmez, rastgele yola düşer', async () => {
    M.nativeMissing = true;
    const vis = await import('../platform/vehicleIdentityService');

    const id = await vis.getReporterDeviceId();

    expect(id).toBeTruthy();
    expect(vis.getDeviceIdentityStatus().source).toBe('RANDOM_FALLBACK');
  });

  it('native BOZUK değer dönerse kimlik olarak KABUL EDİLMEZ', async () => {
    /* Kısa/bozuk bir değeri kimlik saymak, o ROM'daki BÜTÜN cihazları aynı
       araca çökertebilirdi. Biçim doğrulanır. */
    M.stableId = 'kisa-bozuk-deger';
    const vis = await import('../platform/vehicleIdentityService');

    const id = await vis.getReporterDeviceId();

    expect(id).not.toBe('kisa-bozuk-deger');
    expect(vis.getDeviceIdentityStatus().source).toBe('RANDOM_FALLBACK');
  });

  it('web/demo (native değil) → SSAID sorulmaz, rastgele kimlik', async () => {
    M.isNative = false;
    const { CarLauncher } = await import('../platform/nativePlugin');
    const vis = await import('../platform/vehicleIdentityService');

    await vis.getReporterDeviceId();

    expect(CarLauncher.getStableDeviceId).not.toHaveBeenCalled();
    expect(vis.getDeviceIdentityStatus().source).toBe('RANDOM_FALLBACK');
  });
});

describe('P0-001C · kimlik üretiminin rastgeleliği', () => {
  it('KİLİT: UUID kriptografik kaynaktan üretilir (Math.random DEĞİL)', async () => {
    M.stableId = null;                     // rastgele dala zorla
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const vis = await import('../platform/vehicleIdentityService');

    await vis.getReporterDeviceId();

    expect(spy).toHaveBeenCalled();
    expect(vis.getDeviceIdentityStatus().weakRandomUsed).toBe(false);
  });

  it('iki farklı cihaz (farklı SSAID) FARKLI kimlik alır', async () => {
    const a = await import('../platform/vehicleIdentityService');
    const idA = await a.getReporterDeviceId();

    M.store.clear();
    M.stableId = SSAID_HASH_B;
    vi.resetModules();
    const b = await import('../platform/vehicleIdentityService');
    const idB = await b.getReporterDeviceId();

    expect(idA).not.toBe(idB);
  });
});
