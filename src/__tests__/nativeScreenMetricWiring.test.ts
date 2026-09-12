/**
 * nativeScreenMetricWiring.test.ts — V-04/2: native ekran ÖLÇÜMÜ cihaz sınıflandırmasına
 * bağlandı (kütük #599'un kökü).
 *
 * NEDEN VAR: `initNativeCore()` native'den GERÇEK panel boyutunu (WindowManager) okuyordu
 * ama onu yalnız bir CSS değişkenine yazıyordu. Sınıflandırma (`deviceCapabilities`) ise
 * fiziksel pikseli `cssW × devicePixelRatio` ile TAHMİN etmeye devam ediyordu. #599 tam
 * bunun sonucuydu: yanlış dpr → sahte `low` sınıfı → poll 1000 ms → OBD verisi bayat.
 * Ölçüm elde varken tahminle karar vermek, veriyi çöpe atmaktır.
 *
 * Kilitlenen davranışlar:
 *  1. Ölçüm beslenince sınıflandırma ONU kullanır; `devicePixelRatio` tahmini DEVREDE DEĞİL.
 *  2. Native yol `dpr <= 1.0 → low` KESTİRMESİNİ atlar — o kural dpr'nin güvenilmezliğini
 *     telafi eden bir heuristiktir; gerçek ölçü varken uygulanması ölçümün üstüne tahmin
 *     koymak olurdu (#599'un kökü).
 *  3. Geçersiz ölçüm (0/negatif/NaN) YOK SAYILIR — sahte ölçüm, tahminden kötüdür.
 *  4. Besleme önbelleği geçersiz kılar — eski `tier` yeni ölçüme taşınmaz.
 *  5. Ürün yolu gerçekten bağlı (kaynak kanıtı) ve otorite TEKİLDİR.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setNativeScreenMetrics, getScreenMetricSource, getEffectiveScreenPx,
  getDeviceTier, getCapabilities, _resetCapabilitiesForTest,
} from '../platform/deviceCapabilities';

/** Tahmin dalını belirli bir duruma sabitler (cssW × dpr). */
function stubWindow(cssW: number, cssH: number, dpr: number): void {
  vi.stubGlobal('window', {
    ...(globalThis.window ?? {}),
    innerWidth: cssW,
    innerHeight: cssH,
    devicePixelRatio: dpr,
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  _resetCapabilitiesForTest();
});

describe('V-04/2 — native ölçüm sınıflandırmaya bağlı', () => {
  it('ölçüm YOKKEN kaynak "estimated" ve tahmin dalı çalışır', () => {
    stubWindow(1024, 600, 2);
    expect(getScreenMetricSource()).toBe('estimated');
    /* 1024×600 CSS × dpr 2 = 2048×1200 fiziksel → düşük-uç DEĞİL. */
    expect(getCapabilities().lowEndScreen).toBe(false);
  });

  it('ölçüm beslenince kaynak "native" olur ve ÖLÇÜM kazanır', () => {
    /* Tahmin dalı "düşük değil" derdi (2048×1200); ölçüm ise gerçek paneli söylüyor. */
    stubWindow(1024, 600, 2);
    setNativeScreenMetrics({ widthPx: 1024, heightPx: 600 });

    expect(getScreenMetricSource()).toBe('native');
    expect(getEffectiveScreenPx()).toEqual({ widthPx: 1024, heightPx: 600 });
    /* Gerçek panel 1024×600 → düşük-uç. Tahmin bunu KAÇIRIYORDU. */
    expect(getCapabilities().lowEndScreen).toBe(true);
  });

  it('native yol `dpr <= 1.0 → low` KESTİRMESİNİ atlar', () => {
    /* dpr=1 iken tahmin dalı KOŞULSUZ "low" der (heuristik). Ama gerçek panel 1920×1080
       ise cihaz düşük-uç DEĞİLDİR — ölçüm heuristiği ezmeli. */
    stubWindow(1920, 1080, 1);
    expect(getCapabilities().lowEndScreen).toBe(true);      // tahmin dalı: kestirme

    _resetCapabilitiesForTest();
    stubWindow(1920, 1080, 1);
    setNativeScreenMetrics({ widthPx: 1920, heightPx: 1080 });
    expect(getCapabilities().lowEndScreen).toBe(false);     // ölçüm dalı: gerçek
  });

  it('geçersiz ölçüm YOK SAYILIR — sahte ölçüm tahminden kötüdür', () => {
    stubWindow(1024, 600, 2);
    for (const bad of [
      { widthPx: 0, heightPx: 600 },
      { widthPx: 1024, heightPx: 0 },
      { widthPx: -1, heightPx: 600 },
      { widthPx: Number.NaN, heightPx: 600 },
    ]) {
      _resetCapabilitiesForTest();
      stubWindow(1024, 600, 2);
      setNativeScreenMetrics(bad);
      expect(getScreenMetricSource(), JSON.stringify(bad)).toBe('estimated');
    }
  });

  it('besleme önbelleği geçersiz kılar — eski tier taşınmaz', () => {
    stubWindow(1024, 600, 2);
    const before = getDeviceTier();                 // önbelleğe alınır
    setNativeScreenMetrics({ widthPx: 800, heightPx: 480 });
    const after = getDeviceTier();                  // yeniden hesaplanmalı
    /* 800×480 kesin düşük-uç → tier 'low' olmalı; önbellek taşınsaydı eski değer kalırdı. */
    expect(after).toBe('low');
    expect(getCapabilities().lowEndScreen).toBe(true);
    void before;
  });

  it('null besleme tahmin dalına geri döndürür (fail-soft)', () => {
    stubWindow(1024, 600, 2);
    setNativeScreenMetrics({ widthPx: 800, heightPx: 480 });
    expect(getScreenMetricSource()).toBe('native');
    setNativeScreenMetrics(null);
    expect(getScreenMetricSource()).toBe('estimated');
  });
});

describe('V-04/2 — ürün yolu ve otorite tekilliği', () => {
  it('nativeCoreService ölçümü besliyor ve sıra DOĞRU (kaynak kanıtı)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'platform', 'nativeCoreService.ts'), 'utf8',
    ) as string;

    expect(src).toMatch(/setNativeScreenMetrics\(/);

    /* SIRA KİLİDİ: ölçüm besleme, sınıf kararından ÖNCE gelmeli. Ters sırada karar
       tahminle verilir ve ölçüm çöpe gider — kusurun ta kendisi. */
    const feedIdx = src.indexOf('setNativeScreenMetrics(');
    const decideIdx = src.indexOf('initFromDeviceProfile(');
    expect(feedIdx).toBeGreaterThan(-1);
    expect(decideIdx).toBeGreaterThan(-1);
    expect(feedIdx).toBeLessThan(decideIdx);
  });

  it('performans modu KANONİK sınıftan türetilir — ikinci otorite yok', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'platform', 'nativeCoreService.ts'), 'utf8',
    ) as string;

    /* Eskiden `initFromDeviceProfile(profile.deviceClass)` idi: aynı soruyu yanıtlayan
       İKİNCİ otorite. Artık kanonik `getDeviceTier()` besleniyor. */
    expect(src).toMatch(/initFromDeviceProfile\(getDeviceTier\(\)\)/);
    expect(src).not.toMatch(/initFromDeviceProfile\(profile\.deviceClass\)/);
  });
});
