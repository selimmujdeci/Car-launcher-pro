/**
 * SAHA KUSURU (kullanıcı bildirdi · cihazda ölçüldü 2026-09-06 · Xiaomi 23090RA98I)
 * ────────────────────────────────────────────────────────────────────────────
 * Ekranda ÜST ÜSTE "Termal Koruma / parlaklık kısıtlandı" bildirimleri birikiyordu
 * (tam ekran haritada aynı anda 4–5 toast görüldü, bkz.
 * `field-runs/nav-device-20260906-after/full-day-after.png`).
 *
 * Bildirim YANLIŞ DEĞİLDİ — Android gerçekten `Thermal Status: 3` (SEVERE, SKIN
 * 52,1 °C) diyordu. Kusur, otomasyonun KULLANICI API'sini çağırmasıydı:
 *
 *   `setBrightness()`      → KULLANICI çağrısı: kap üstü talebi REDDEDER + toast
 *   `setBrightnessAuto()`  → OTOMASYON: kapa SESSİZCE clamp eder ve UYGULAR
 *
 * `autoBrightnessService` scheduler'da `periodMs: 60_000` ile tick attığı için
 * her dakika bir toast üretiliyordu. İkinci (ve daha sinsi) sonuç: tünel
 * karartması ve `stopAutoBrightness()` içindeki "ekran karanlık kalmasın"
 * onarımı termal kap aktifken HİÇ UYGULANMIYORDU (erken return).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mocks = vi.hoisted(() => ({
  setBrightnessNative: vi.fn(() => Promise.resolve()),
  checkWriteSettings: vi.fn(() => Promise.resolve({ granted: true })),
  requestWriteSettings: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  isNative: vi.fn(() => true),
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.isNative } }));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    setBrightness: mocks.setBrightnessNative,
    checkWriteSettings: mocks.checkWriteSettings,
    requestWriteSettings: mocks.requestWriteSettings,
  },
}));
vi.mock('../platform/errorBus', () => ({ showToast: mocks.showToast }));
vi.mock('../platform/obdService', () => ({ onOBDData: vi.fn(() => () => {}) }));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));
vi.mock('../platform/debug', () => ({ logInfo: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));

import {
  setBrightness, setBrightnessAuto,
  setThermalBrightnessLock, clearThermalBrightnessLock,
} from '../platform/systemSettingsService';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
/* Kilit KODU tarar, yorumu değil: açıklama satırlarında geçen örnek çağrılar
   kilidi yanlış düşürüyordu (kör guard'ın tersi: sahte pozitif). */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Debounce (80 ms) + `_applyBrightnessNative` promise zincirini boşalt. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(200);
  await vi.advanceTimersByTimeAsync(0);
}

describe('🔒 TERMAL/TOAST · termal kap aktifken otomasyon EKRANI BİLDİRİMLE DOLDURMAZ', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.showToast.mockClear();
    mocks.setBrightnessNative.mockClear();
    clearThermalBrightnessLock();
  });
  afterEach(() => { clearThermalBrightnessLock(); vi.useRealTimers(); });

  it('otomasyon 20 tick boyunca kap üstü isterse: 0 toast — ve parlaklık GERÇEKTEN uygulanır', async () => {
    setThermalBrightnessLock(50);
    for (let i = 0; i < 20; i++) { setBrightnessAuto(100); await flush(); }
    expect(mocks.showToast, 'otomasyon toast üretiyor — saha spam kusuru geri geldi')
      .not.toHaveBeenCalled();
    expect(mocks.setBrightnessNative.mock.calls.length,
      'otomasyon kap altında bile parlaklığı uygulamıyor').toBeGreaterThan(0);
    // 50% → Android 0–255 ölçeğinde 128
    expect(mocks.setBrightnessNative).toHaveBeenLastCalledWith({ value: 128 });
  });

  it('KULLANICI kap üstü isterse: uyarı verilir ve talep uygulanmaz (koruma DEĞİŞMEDİ)', async () => {
    setThermalBrightnessLock(50);
    setBrightness(100);
    await flush();
    expect(mocks.showToast, 'kullanıcıya termal kısıtlama bildirilmiyor').toHaveBeenCalledTimes(1);
    expect(mocks.setBrightnessNative, 'kullanıcı talebi kapı aştığı hâlde uygulanmış')
      .not.toHaveBeenCalled();
  });

  it('kap YOKKEN otomasyon istediğini aynen uygular (kontrol testi)', async () => {
    setBrightnessAuto(100);
    await flush();
    expect(mocks.setBrightnessNative).toHaveBeenLastCalledWith({ value: 255 });
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it('OTOMASYON modülleri kullanıcı API\'sini ÇAĞIRMAZ (tek kapı kilidi)', () => {
    for (const f of ['src/platform/autoBrightnessService.ts', 'src/hooks/useLayoutServices.ts']) {
      const src = code(f);
      expect(src.match(/(?<!Auto|\.)\bsetBrightness\(/g) ?? [], `${f} kullanıcı API'sini çağırıyor → toast spam`)
        .toHaveLength(0);
      expect(src, `${f} otomasyon API'sini kullanmıyor`).toContain('setBrightnessAuto(');
    }
  });

  it('tünel karartması ve kapanış onarımı otomasyon yolundan geçer (sessiz uygulama)', () => {
    const src = code('src/platform/autoBrightnessService.ts');
    expect(src, 'tünel karartması kullanıcı yolundan gidiyor — kap altında HİÇ uygulanmaz')
      .toContain('setBrightnessAuto(tunnelBright)');
    expect(src, 'kapanış onarımı kullanıcı yolundan gidiyor — ekran karanlık kalabilir')
      .toContain('setBrightnessAuto(100)');
  });
});
