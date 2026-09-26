/**
 * localPinValetAuthorityW12B.test.ts — WAVE 12B · LOCAL PIN = VALET/GEOFENCE SINIRI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ÜRÜN KARARI (Wave 12 audit'i sonrası)
 *
 * Local PIN aracı kullanmayı engellemez. Tek görevi: AKTİF valet/geofence
 * korumasının, araç başındaki YETKİSİZ kişi tarafından
 *   (1) kapatılmasını, (2) korunan ayarlarının değiştirilmesini,
 *   (3) sınırının etkisiz hâle getirilmesini
 * PIN kanıtı olmadan İMKÂNSIZ kılmaktır.
 *
 * ── TEHDİT MODELİ (dürüst) ────────────────────────────────────────────────
 * Korunan taraf: ARAÇ BAŞINDAKİ İNSAN. Korunmayan taraf: ele geçirilmiş
 * WebView — o zaten native köprüyü doğrudan çağırabilir. Bu sınır fiziksel
 * erişime karşıdır ve raporda böyle beyan edilir.
 *
 * ── WAVE 12'DE ÖLÇÜLEN KUSURLAR (bu dosya önce onları ÜRETİR) ────────────
 *   T1  Koruma aktifken `setValeMode(false)` / `setGeofenceEnabled(false)`
 *       servis katmanından PIN'siz çağrılabiliyor → UI dışından bypass.
 *   T2  `clearPin()` mevcut PIN kanıtı İSTEMİYOR → kilidi bilmeyen kaldırıyor.
 *   T3  Deneme sayacı modül değişkeninde → reload kilitlemeyi sıfırlıyor.
 *
 * Testler kaynak metni okumaz; gerçek servis fonksiyonlarını çalıştırır.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Web/dev yolu: native yok → pinService web doğrulamasına düşer. */
vi.mock('@capacitor/core', () => ({
  Capacitor:      { isNativePlatform: () => false },
  registerPlugin: () => ({}),
}));

/** Geofence kalıcılığı testte diske gitmesin. */
vi.mock('../utils/safeStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/safeStorage')>();
  return { ...actual, safeGetRaw: () => null, safeSet: () => {}, safeGet: () => null };
});

beforeEach(() => {
  vi.resetModules();
  /* Doğrulayıcı + deneme sayacı KALICI depodadır (reload kilidi sıfırlamasın
     diye). Testler arası sızmayı önlemek için her testten önce temizlenir —
     T3 içindeki reload benzetimi test İÇİNDE olduğu için etkilenmez. */
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* jsdom */ }
});

// ── T1 · SERVİS KATMANINDAN PIN'SİZ KAPATMA ────────────────────────────────

describe('W12B/T1 · korunan valet/geofence mutasyonu PIN kanıtı ister', () => {
  it('koruma AKTİFken PIN\'siz `setValeMode(false)` valet\'i KAPATAMAZ', async () => {
    const geo = await import('../platform/geofenceService');
    const pin = await import('../platform/pinService');

    await pin.setupPin('1234');
    geo.setPinLock(true);
    geo.setValeMode(true);
    expect(geo.getGeofenceState().valeModeActive).toBe(true);

    /* UI'yi atlayıp doğrudan servis çağrısı — saldırganın yapacağı şey budur. */
    await geo.setValeMode(false);

    expect(
      geo.getGeofenceState().valeModeActive,
      'PIN kanıtı olmadan valet korunması KAPATILDI — servis katmanında kapı yok',
    ).toBe(true);
  });

  it('koruma AKTİFken PIN\'siz `setGeofenceEnabled(false)` korumayı KAPATAMAZ', async () => {
    const geo = await import('../platform/geofenceService');
    const pin = await import('../platform/pinService');

    await pin.setupPin('1234');
    geo.setPinLock(true);
    geo.setGeofenceEnabled(true);
    expect(geo.getGeofenceState().enabled).toBe(true);

    await geo.setGeofenceEnabled(false);

    expect(
      geo.getGeofenceState().enabled,
      'PIN kanıtı olmadan geofence koruması KAPATILDI',
    ).toBe(true);
  });

  it('koruma AKTİFken PIN\'siz yarıçap DEĞİŞTİRİLEMEZ (sınır etkisizleştirme)', async () => {
    const geo = await import('../platform/geofenceService');
    const pin = await import('../platform/pinService');

    await pin.setupPin('1234');
    geo.setGeofenceCenter({ lat: 41, lng: 29 });
    geo.setPinLock(true);
    geo.setGeofenceEnabled(true);

    const before = geo.getGeofenceState().zones.find((z) => z.id === 'default')?.radiusKm;
    await geo.setGeofenceRadius(9999);   // sınırı anlamsız hâle getirme denemesi
    const after = geo.getGeofenceState().zones.find((z) => z.id === 'default')?.radiusKm;

    expect(after, 'PIN kanıtı olmadan koruma sınırı genişletildi').toBe(before);
  });

  it('DOĞRU PIN kanıtıyla kapatma İZİNLİDİR (kapı kilitlemiyor, yetkilendiriyor)', async () => {
    const geo = await import('../platform/geofenceService');
    const pin = await import('../platform/pinService');

    await pin.setupPin('1234');
    geo.setPinLock(true);
    geo.setValeMode(true);

    await geo.setValeMode(false, '1234');

    expect(geo.getGeofenceState().valeModeActive,
      'doğru PIN ile bile kapatılamıyor — kapı fazla sıkı').toBe(false);
  });

  it('KORUMA KAPALIYKEN PIN istenmez (gereksiz sürtünme yok)', async () => {
    const geo = await import('../platform/geofenceService');
    geo.setPinLock(false);
    geo.setValeMode(true);

    await geo.setValeMode(false);

    expect(geo.getGeofenceState().valeModeActive).toBe(false);
  });

  it('korumayı GÜÇLENDİRMEK PIN istemez (fail-safe yön)', async () => {
    const geo = await import('../platform/geofenceService');
    const pin = await import('../platform/pinService');
    await pin.setupPin('1234');
    geo.setPinLock(true);

    await geo.setValeMode(true);          // açmak = güçlendirmek
    expect(geo.getGeofenceState().valeModeActive).toBe(true);

    await geo.setGeofenceEnabled(true);
    expect(geo.getGeofenceState().enabled).toBe(true);
  });
});

// ── T2 · PIN KALDIRMA MEVCUT PIN KANITI İSTER ──────────────────────────────

describe('W12B/T2 · PIN kaldırma/değiştirme mevcut PIN kanıtı ister', () => {
  it('mevcut PIN bilinmeden `clearPin` BAŞARISIZ olur', async () => {
    const pin = await import('../platform/pinService');
    await pin.setupPin('1234');
    expect(pin.isPinSet()).toBe(true);

    const ok = await pin.clearPin('9999');   // yanlış mevcut PIN

    expect(ok, 'yanlış PIN ile kaldırma başarılı döndü').toBe(false);
    expect(pin.isPinSet(), 'PIN mevcut kanıt olmadan KALDIRILDI — kilit bypass').toBe(true);
  });

  it('doğru mevcut PIN ile `clearPin` başarılı olur', async () => {
    const pin = await import('../platform/pinService');
    await pin.setupPin('1234');

    const ok = await pin.clearPin('1234');

    expect(ok).toBe(true);
    expect(pin.isPinSet()).toBe(false);
  });

  it('PIN DEĞİŞTİRME mevcut PIN kanıtı ister', async () => {
    const pin = await import('../platform/pinService');
    await pin.setupPin('1234');

    const bad = await pin.changePin('0000', '5555');
    expect(bad, 'yanlış mevcut PIN ile değişiklik kabul edildi').toBe(false);
    expect(await pin.verifyPin('1234'), 'eski PIN bozuldu').toBe(true);

    const good = await pin.changePin('1234', '5555');
    expect(good).toBe(true);
    expect(await pin.verifyPin('5555')).toBe(true);
    expect(await pin.verifyPin('1234'), 'eski PIN hâlâ geçerli').toBe(false);
  });

  it('İLK kurulum mevcut PIN istemez', async () => {
    const pin = await import('../platform/pinService');
    expect(pin.isPinSet()).toBe(false);
    await pin.setupPin('4321');
    expect(pin.isPinSet()).toBe(true);
    expect(await pin.verifyPin('4321')).toBe(true);
  });
});

// ── T3 · KİLİTLEME RELOAD İLE SIFIRLANMAZ ──────────────────────────────────

describe('W12B/T3 · kaba kuvvet kilidi reload ile sıfırlanmaz', () => {
  it('5 yanlış denemeden sonra kilit AÇILIR', async () => {
    const pin = await import('../platform/pinService');
    await pin.setupPin('1234');

    for (let i = 0; i < 5; i++) await pin.verifyPin('0000');

    expect(pin.getLockoutState().locked, '5 hatadan sonra kilit yok').toBe(true);
    expect(await pin.verifyPin('1234'), 'kilitliyken doğru PIN geçti').toBe(false);
  });

  it('MODÜL YENİDEN YÜKLENİNCE (reload) kilit KORUNUR', async () => {
    const pin = await import('../platform/pinService');
    await pin.setupPin('1234');
    for (let i = 0; i < 5; i++) await pin.verifyPin('0000');
    expect(pin.getLockoutState().locked).toBe(true);

    /* WebView reload / process restart benzetimi: modül grafiği sıfırlanır. */
    vi.resetModules();
    const reloaded = await import('../platform/pinService');

    expect(
      reloaded.getLockoutState().locked,
      'reload kilitlemeyi SIFIRLADI — sınırsız deneme mümkün (kaba kuvvet bypass)',
    ).toBe(true);
  });
});

// ── T4 · FAIL-CLOSED ───────────────────────────────────────────────────────

describe('W12B/T4 · bilinmeyen/başarısız doğrulama İZİN DEĞİLDİR', () => {
  it('PIN kurulu değilken korunan mutasyon yine de kapıdan geçmez (UNKNOWN ≠ ALLOW)', async () => {
    const geo = await import('../platform/geofenceService');
    geo.setPinLock(true);          // kilit açık ama PIN kurulu DEĞİL
    geo.setValeMode(true);

    await geo.setValeMode(false, '1234');

    expect(
      geo.getGeofenceState().valeModeActive,
      'doğrulayıcı YOKKEN kapatma kabul edildi — UNKNOWN, ALLOW gibi davrandı',
    ).toBe(true);
  });
});
