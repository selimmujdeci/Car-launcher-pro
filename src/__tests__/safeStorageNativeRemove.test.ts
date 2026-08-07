/**
 * safeStorageNativeRemove.test.ts — NATIVE modda silme bütünlüğü (saha 2026-08-02).
 *
 * ── NEDEN AYRI DOSYA ───────────────────────────────────────────────────────
 * Mevcut `safeStorage.test.ts` Capacitor'ı **web modu** olarak mocklar
 * (`isNativePlatform: () => false`) → `safeRemoveRaw`'ın NATIVE dalı HİÇ
 * çalışmaz. Hata tam olarak orada saklıydı ve bu yüzden testlerden kaçtı.
 *
 * ── KİLİTLENEN HATA ────────────────────────────────────────────────────────
 * `safeSetRawImmediate` NATIVE modda localStorage'a **katman-2 yedeği** yazar ve
 * `safeGetRaw` NATIVE okumada **Stage 4**'te localStorage'a düşer. Eski
 * `safeRemoveRaw` ise localStorage'ı yalnız `else` (web) dalında siliyordu →
 * NATIVE'de kayıt diskten silinip **localStorage kopyası hayatta kalıyordu** →
 * uygulama yeniden başlayınca `safeGetRaw` eski veriyi döndürüyordu.
 *
 * Cihazda gözlenen sonuç (gerçek araç, 2026-08-02): kullanıcı navigasyonu
 * bitirdiği hâlde `nav_crash_state` mührü hayatta kaldı ve sonraki açılışta
 * `restoreNavigationAsync` kullanıcı istemeden sessizce rotayı geri yükledi;
 * bayat step'ten üretilen rota ısrarla "U dönüşü yapın" diyordu.
 * Aynı yol `commandCrypto` cihaz ÖZEL ANAHTARInı da diriltiyordu.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Capacitor mock: NATIVE modu (asıl mesele bu) ───────────── */

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    readdir:    vi.fn().mockResolvedValue({ files: [] }),
    readFile:   vi.fn().mockResolvedValue({ data: '' }),
    writeFile:  vi.fn().mockResolvedValue({}),
    deleteFile: vi.fn().mockResolvedValue({}),
    rename:     vi.fn().mockResolvedValue({}),
    stat:       vi.fn().mockResolvedValue({ size: 10 }),
    mkdir:      vi.fn().mockResolvedValue({}),
  },
  Directory: { Data: 'DATA' },
  Encoding:  { UTF8: 'utf8' },
}));

import { Filesystem } from '@capacitor/filesystem';
import { safeSetRawImmediate, safeRemoveRaw, safeGetRaw, safeStorage } from '../utils/safeStorage';

const deleteFile = Filesystem.deleteFile as unknown as ReturnType<typeof vi.fn>;

const NAV_KEY = 'nav_crash_state';

beforeEach(() => {
  localStorage.clear();
  deleteFile.mockClear();
});

describe('NATIVE modda safeRemoveRaw — silinen kayıt DİRİLMEZ', () => {
  it('🔒 safeSetRawImmediate localStorage katman-2 yedeği yazar (öncül)', async () => {
    await safeSetRawImmediate(NAV_KEY, '{"destination":"Tarsus"}');
    // Bu öncül doğru değilse hatanın mekanizması da geçersizdir.
    expect(localStorage.getItem(NAV_KEY)).toBe('{"destination":"Tarsus"}');
  });

  it('🔒 safeRemoveRaw localStorage kopyasını da SİLER (asıl kilit)', async () => {
    await safeSetRawImmediate(NAV_KEY, '{"destination":"Tarsus"}');
    expect(localStorage.getItem(NAV_KEY)).not.toBeNull();

    safeRemoveRaw(NAV_KEY);

    /* Eski kod NATIVE dalında localStorage'a HİÇ dokunmuyordu → burası null
       DEĞİLDİ ve yeniden başlatmada safeGetRaw Stage-4'ten diriltiyordu. */
    expect(
      localStorage.getItem(NAV_KEY),
      'NATIVE modda localStorage kopyası kaldı — kayıt yeniden başlatmada DİRİLİR',
    ).toBeNull();
  });

  it('🔒 silme sonrası okuma null döner (yeniden başlatma benzeri)', async () => {
    await safeSetRawImmediate(NAV_KEY, '{"destination":"Tarsus"}');
    safeRemoveRaw(NAV_KEY);
    // _fsCache boşaldı; tek kalan kaynak localStorage olurdu — o da temiz olmalı.
    expect(safeGetRaw(NAV_KEY)).toBeNull();
  });

  it('🔒 diskten silme de yapılır (Filesystem.deleteFile çağrılır)', async () => {
    await safeSetRawImmediate(NAV_KEY, 'x');
    safeRemoveRaw(NAV_KEY);
    expect(deleteFile).toHaveBeenCalled();
  });

  it('🔒 zustand removeItem adaptörü de aynı garantiyi taşır', async () => {
    await safeSetRawImmediate('bir-store', '{"state":{}}');
    safeStorage.removeItem('bir-store');
    expect(localStorage.getItem('bir-store')).toBeNull();
  });

  it('🔒 GÜVENLİK: silinen cihaz özel anahtarı geride KALMAZ', async () => {
    // commandCrypto DEVICE_PRIV_KEY'i safeSetRawImmediate ile yazar ve
    // safeRemoveRaw ile siler — eski davranışta anahtar localStorage'da kalıyordu.
    await safeSetRawImmediate('caros.device.privkey', '{"kty":"EC","d":"GIZLI"}');
    safeRemoveRaw('caros.device.privkey');
    expect(localStorage.getItem('caros.device.privkey')).toBeNull();
  });
});
