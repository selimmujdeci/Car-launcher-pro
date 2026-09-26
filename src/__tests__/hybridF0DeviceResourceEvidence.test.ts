/**
 * hybridF0DeviceResourceEvidence.test.ts — HYBRID-F0: gerçek native kaynak kanıtı
 * (RAM/ABI/depolama/çekirdek) kanonik `deviceCapabilities`e ÖLÇÜM olarak besleniyor.
 *
 * NEDEN VAR: `getCapabilities()` bugüne kadar `cores`/`memoryMb` için yalnız
 * `navigator.hardwareConcurrency`/`deviceMemory` TAHMİNİNE dayanıyordu. Bu WebView
 * tahminleri head unit'lerde ya `0` (bilinmiyor) ya da YANLIŞtır — saha kanıtı: K2401
 * ekranı "6GB" derken gerçek `/proc/meminfo` 2 GB'tır (DEVICE_VALIDATION_LEDGER.md).
 * `setNativeResourceEvidence` bu ölçümü `setNativeScreenMetrics` ile AYNI ilkede besler.
 *
 * Kilitlenen davranışlar:
 *  1. Native ölçüm varsa TAHMİN yerine kullanılır (K2401: 2GB/4 çekirdek → 'low').
 *  2. Ölçüm YOKSA (`null`/eksik/native bridge yok) tahmin dalına fail-soft düşülür —
 *     hiçbir zaman "unknown → yüksek capability" olmaz (kısıtlayıcı yönde fail-closed).
 *  3. Geçersiz alan (0/negatif/NaN/boş dizi) TEK TEK elenir — kısmi kanıt kabul edilir.
 *  4. ABI/boş RAM/depolama tier hesaplamasına HİÇ GİRMEZ (mevcut tier sözleşmesi sabit).
 *  5. Besleme önbelleği geçersiz kılar (eski tier yeni ölçüme taşınmaz).
 *  6. `nativeCoreService` sırası doğru: kanıt besleme, `initFromDeviceProfile`'dan ÖNCE.
 *  7. Otorite tekilliği: `getDeviceTier()` TEK karar noktası kalır, native karar VERMEZ.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setNativeResourceEvidence, getNativeResourceEvidence, getResourceEvidenceSource,
  getDeviceTier, getCapabilities, _resetCapabilitiesForTest,
} from '../platform/deviceCapabilities';

/** Tahmin dalını sabit bir duruma kilitler — navigator ölçümleri BİLİNMİYOR (0/undefined). */
function stubEstimateBranch(opts?: { cores?: number; deviceMemoryGb?: number }): void {
  vi.stubGlobal('navigator', {
    ...(globalThis.navigator ?? {}),
    hardwareConcurrency: opts?.cores ?? 0,
    deviceMemory: opts?.deviceMemoryGb,
    userAgent: 'Mozilla/5.0 (Linux; Android 10)',
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  _resetCapabilitiesForTest();
});

describe('HYBRID-F0 — K2401 saha fixture (2GB RAM / armeabi-v7a / 4 çekirdek)', () => {
  it('gerçek 2GB + armeabi-v7a fixture → tier "low" (native ölçüm tahmini EZER)', () => {
    // Tahmin dalı "bilinmiyor" der (WebView bazen 0/undefined döner) — ölçüm devreye girmeli.
    stubEstimateBranch();
    setNativeResourceEvidence({
      totalRamMb: 2048, availMemMb: 640, isLowRamDevice: true,
      cpuCoreCount: 4, supportedAbis: ['armeabi-v7a'], usableStorageMb: 900, sdkInt: 29,
    });

    expect(getResourceEvidenceSource()).toBe('native');
    const c = getCapabilities();
    expect(c.cores).toBe(4);
    expect(c.memoryMb).toBe(2048);
    // ≤3072MB kriteri zaten tier'ı 'low' yapar (mevcut sözleşme — burada DEĞİŞMEDİ).
    expect(getDeviceTier()).toBe('low');
  });

  it('ABI/boş RAM/depolama gözlemlenebilir ama tier hesaplamasına GİRMEZ', () => {
    stubEstimateBranch();
    setNativeResourceEvidence({
      totalRamMb: 2048, availMemMb: 640, isLowRamDevice: true,
      cpuCoreCount: 4, supportedAbis: ['armeabi-v7a'], usableStorageMb: 900, sdkInt: 29,
    });
    const ev = getNativeResourceEvidence();
    expect(ev?.supportedAbis).toEqual(['armeabi-v7a']);
    expect(ev?.availMemMb).toBe(640);
    expect(ev?.usableStorageMb).toBe(900);
    // DeviceCapabilities yüzeyinde ABI/depolama alanı YOK — tier girdisi genişlemedi.
    expect(getCapabilities()).not.toHaveProperty('supportedAbis');
    expect(getCapabilities()).not.toHaveProperty('usableStorageMb');
  });
});

describe('HYBRID-F0 — ölçüm yok → fail-closed (unknown asla eligible/high anlamına gelmez)', () => {
  it('native kanıt beslenmediyse kaynak "estimated" kalır ve tahmin dalı çalışır', () => {
    stubEstimateBranch({ cores: 8, deviceMemoryGb: 8 });
    expect(getResourceEvidenceSource()).toBe('estimated');
    const c = getCapabilities();
    expect(c.cores).toBe(8);
    expect(c.memoryMb).toBe(8192);
  });

  it('null besleme tahmin dalına geri döner (fail-soft) — kısıtlayıcı yönde asla değil', () => {
    stubEstimateBranch({ cores: 8, deviceMemoryGb: 8 });
    setNativeResourceEvidence({ totalRamMb: 2048, cpuCoreCount: 4 });
    expect(getResourceEvidenceSource()).toBe('native');
    setNativeResourceEvidence(null);
    expect(getResourceEvidenceSource()).toBe('estimated');
    expect(getNativeResourceEvidence()).toBeNull();
  });

  it('geçersiz alanlar (0/negatif/NaN/boş dizi) TEK TEK elenir — sahte 0 üretilmez', () => {
    stubEstimateBranch({ cores: 8, deviceMemoryGb: 8 });
    setNativeResourceEvidence({
      totalRamMb: 0,                 // geçersiz → elenir
      availMemMb: -5,                // geçersiz → elenir
      cpuCoreCount: Number.NaN,      // geçersiz → elenir
      supportedAbis: [],             // boş → elenir
      usableStorageMb: 512,          // geçerli → kalır
      sdkInt: 29,                    // geçerli → kalır
      isLowRamDevice: false,         // geçerli → kalır
    });
    const ev = getNativeResourceEvidence();
    expect(ev?.totalRamMb).toBeUndefined();
    expect(ev?.availMemMb).toBeUndefined();
    expect(ev?.cpuCoreCount).toBeUndefined();
    expect(ev?.supportedAbis).toBeUndefined();
    expect(ev?.usableStorageMb).toBe(512);
    expect(ev?.sdkInt).toBe(29);
    expect(ev?.isLowRamDevice).toBe(false);

    // totalRamMb/cpuCoreCount elendiği için `getCapabilities()` TAHMİN dalına düşmeli
    // (sahte 0 ile tier kararı ASLA bozulmaz) — kaynak yine de 'native' sayılır çünkü
    // kısmi kanıt (usableStorageMb/sdkInt) geçerlidir.
    const c = getCapabilities();
    expect(c.cores).toBe(8);
    expect(c.memoryMb).toBe(8192);
  });

  it('tamamı geçersizse kanıt YOK sayılır (kaynak "estimated")', () => {
    stubEstimateBranch();
    setNativeResourceEvidence({
      totalRamMb: -1, availMemMb: 0, cpuCoreCount: 0, supportedAbis: [], usableStorageMb: 0, sdkInt: 0,
    });
    expect(getResourceEvidenceSource()).toBe('estimated');
    expect(getNativeResourceEvidence()).toBeNull();
  });
});

describe('HYBRID-F0 — high-end arm64 fixture → mevcut tier kurallarına göre değerlendirme', () => {
  it('8 çekirdek + 8GB + arm64-v8a → RAM/CPU eşiği TETİKLENMEZ (tier kuralı DEĞİŞMEDİ)', () => {
    stubEstimateBranch();
    setNativeResourceEvidence({
      totalRamMb: 8192, availMemMb: 4096, isLowRamDevice: false,
      cpuCoreCount: 8, supportedAbis: ['arm64-v8a', 'armeabi-v7a'], usableStorageMb: 16384, sdkInt: 34,
    });
    const c = getCapabilities();
    expect(c.cores).toBe(8);
    expect(c.memoryMb).toBe(8192);
    /* Bu fazın kilidi: `getDeviceTier()`in RAM/CPU KRİTERİ (≤4 çekirdek VEYA ≤3072MB)
     * native ölçümle TETİKLENMEMELİ. Nihai 'low'/'mid'/'high' kararı jsdom'da WebGL/
     * backdrop/dvh/@layer gibi DİĞER kapılara da bağlıdır (bu ortamda desteklenmezler,
     * ekran-ölçüm testlerinde de aynı sınırlama var) — o kuralın KENDİSİ bu fazda hiç
     * DEĞİŞMEDİ; burada doğrulanan yalnız girdinin native ölçümden geldiğidir. */
    expect(c.cores > 4).toBe(true);
    expect(c.memoryMb > 3072).toBe(true);
  });
});

describe('HYBRID-F0 — native bridge unavailable → crash yok', () => {
  it('bozuk/eksik/tip-uyumsuz kanıt nesnesi throw ETMEZ, fail-soft null sayılır', () => {
    expect(() => setNativeResourceEvidence(undefined as unknown as null)).not.toThrow();
    expect(getNativeResourceEvidence()).toBeNull();

    expect(() => setNativeResourceEvidence({} as unknown as Parameters<typeof setNativeResourceEvidence>[0])).not.toThrow();
    expect(getNativeResourceEvidence()).toBeNull();

    expect(() => setNativeResourceEvidence('not-an-object' as unknown as Parameters<typeof setNativeResourceEvidence>[0])).not.toThrow();
    expect(getNativeResourceEvidence()).toBeNull();

    expect(() => getCapabilities()).not.toThrow();
    expect(() => getDeviceTier()).not.toThrow();
  });

  it('besleme önbelleği geçersiz kılar — eski tier yeni ölçüme taşınmaz', () => {
    stubEstimateBranch({ cores: 8, deviceMemoryGb: 8 });
    const before = getDeviceTier();               // önbelleğe alınır (yüksek tahminle)
    setNativeResourceEvidence({ totalRamMb: 2048, cpuCoreCount: 4 });
    const after = getDeviceTier();                 // yeniden hesaplanmalı
    expect(after).toBe('low');
    void before;
  });
});

describe('HYBRID-F0 — nativeCoreService sırası ve otorite tekilliği', () => {
  it('kaynak kanıtı besleme, sınıf kararından (initFromDeviceProfile) ÖNCE gelir', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'platform', 'nativeCoreService.ts'), 'utf8',
    ) as string;

    expect(src).toMatch(/setNativeResourceEvidence\(/);
    const feedIdx   = src.indexOf('setNativeResourceEvidence(');
    const decideIdx = src.indexOf('initFromDeviceProfile(');
    expect(feedIdx).toBeGreaterThan(-1);
    expect(decideIdx).toBeGreaterThan(-1);
    expect(feedIdx).toBeLessThan(decideIdx);
  });

  it('tier kararı hâlâ TEK yerden (getDeviceTier) türetilir — native ikinci otorite DEĞİL', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'platform', 'nativeCoreService.ts'), 'utf8',
    ) as string;
    expect(src).toMatch(/initFromDeviceProfile\(getDeviceTier\(\)\)/);
    expect(src).not.toMatch(/initFromDeviceProfile\(profile\.deviceClass\)/);
  });
});
