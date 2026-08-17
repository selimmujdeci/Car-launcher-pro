/**
 * lowEndScreenPhysicalPx.test.ts — KİLİT: ekran sınıflandırması FİZİKSEL pikselde ölçülür.
 *
 * ── NEDEN BU DOSYA VAR (kütük #599, cihazda ölçüldü 2026-08-16) ────────────
 * `_lowEndScreen()` eşikleri (800×480 · 1024×600 · 1280×480) gerçek head unit
 * panellerinin FİZİKSEL çözünürlükleridir; ama karşılaştırma `innerWidth/
 * innerHeight` yani CSS px ile yapılıyordu. DPR>1 olan modern panellerde CSS px
 * fiziksel pikselin 1/dpr'ı olduğundan cihaz sahte biçimde "head unit ekranı"
 * sayılıyordu:
 *
 *   Xiaomi 23090RA98I — fiziksel 2712×1220, dpr 3 → CSS 904×407 → low ✗
 *
 * Ölçülen bedel: `getDeviceTier()` → `low` → OBD FAST poll 1000ms (250 yerine);
 * gerçek kadans p50 2361ms / max 5570ms. Cihazda `fastMs=250` zorlanınca aynı
 * donanımda p50 569ms ölçüldü — yani sınıflandırma yanlıştı, donanım değil.
 *
 * Bu kilit "ekran küçük mü" sorusunu DEĞİL, **hangi birimde sorulduğunu** korur.
 * Gerçek head unit satırları da burada — düzeltme onları bozmamalıdır.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getCapabilities, getDeviceTier, _resetCapabilitiesForTest } from '../platform/deviceCapabilities';

/** Ekran ölçülerini CSS px + dpr olarak sahteler; capability önbelleğini tazeler. */
function setScreen(cssW: number, cssH: number, dpr: number): void {
  vi.stubGlobal('innerWidth', cssW);
  vi.stubGlobal('innerHeight', cssH);
  vi.stubGlobal('devicePixelRatio', dpr);
  Object.defineProperty(window, 'innerWidth', { value: cssW, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: cssH, configurable: true });
  Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true });
  _resetCapabilitiesForTest();
}

afterEach(() => {
  vi.unstubAllGlobals();
  _resetCapabilitiesForTest();
});

describe('_lowEndScreen — birim sözleşmesi (fiziksel piksel)', () => {
  /* ── Gerçek head unit'ler: DÜZELTME BUNLARI BOZMAMALI ──────────────── */

  it('KİLİT: 800×480 @dpr1 head unit → lowEndScreen (dpr kapısı)', () => {
    setScreen(800, 480, 1);
    expect(getCapabilities().lowEndScreen).toBe(true);
  });

  it('KİLİT: 1024×600 @dpr1 head unit → lowEndScreen', () => {
    setScreen(1024, 600, 1);
    expect(getCapabilities().lowEndScreen).toBe(true);
  });

  it('KİLİT: 1280×480 fiziksel @dpr1.5 (CSS 853×320) → lowEndScreen', () => {
    /* dpr>1 olduğu için dpr kapısına takılmaz; fiziksel ölçüyle 1280×480
       kuralına girer. CSS ölçüyle de girerdi — ama YANLIŞ kuraldan
       (maxDim 853 <= 1024 && minDim 320 <= 600). Doğru kuralla yakalanması
       şart, yoksa gerçek bir head unit sınıf kaybederdi. */
    setScreen(853.33, 320, 1.5);
    expect(getCapabilities().lowEndScreen).toBe(true);
  });

  it('KİLİT: 1920×720 ultra-wide → lowEndScreen (oran kuralı dpr-bağımsız)', () => {
    setScreen(960, 360, 2);
    expect(getCapabilities().lowEndScreen).toBe(true);
  });

  /* ── Yüksek-DPR modern paneller: SAHTE low OLMAMALI ────────────────── */

  it('KİLİT: Xiaomi 23090RA98I (2712×1220 fiziksel, dpr 3) → lowEndScreen DEĞİL', () => {
    /* #599'un ta kendisi. CSS ölçüsü 904×407 olduğu için eski kod TRUE
       döndürüyordu → tier `low` → OBD 1000ms. */
    setScreen(904, 407, 3);
    expect(getCapabilities().lowEndScreen).toBe(false);
  });

  it('DÜRÜSTLÜK: tier bu ortamda ÖLÇÜLEMEZ — jsdom WebGL/backdrop sağlamaz', () => {
    /* `getDeviceTier()` low kararını YEDİ girdiden verir; jsdom'da
       `supportsWebGL` ve `supportsBackdropFilter` daima false olduğu için
       tier ekran ne olursa olsun `low` çıkar. Yani "#599 sonrası tier high
       oldu" iddiası BURADA doğrulanamaz — bu, cihazda ölçülecek bir kabul
       ölçütüdür (kütük #599) ve kilit onu sessizce doğru saymaz.
       Burada korunan tek şey ekran girdisinin BİRİMİDİR. */
    setScreen(904, 407, 3);
    expect(getCapabilities().supportsWebGL).toBe(false); // ortam sınırı, ürün değil
    expect(getDeviceTier()).toBe('low');                 // ↑ bunun SONUCU
    expect(getCapabilities().lowEndScreen).toBe(false);  // ← düzeltilen girdi
  });

  it('KİLİT: 2340×1080 @dpr2.75 (yaygın telefon) → lowEndScreen DEĞİL', () => {
    setScreen(851, 393, 2.75);
    expect(getCapabilities().lowEndScreen).toBe(false);
  });

  it('KİLİT: 1920×1080 @dpr2 modern panel → lowEndScreen DEĞİL', () => {
    setScreen(960, 540, 2);
    expect(getCapabilities().lowEndScreen).toBe(false);
  });

  /* ── Birim sözleşmesinin kendisi ───────────────────────────────────── */

  it('KİLİT: AYNI fiziksel panel, farklı dpr → AYNI sınıf (birim sızıntısı yok)', () => {
    /* 1024×600 fiziksel panel; dpr 2 ile sunulursa CSS 512×300 olur.
       Sınıflandırma fiziksel ölçüye baktığı için sonuç DEĞİŞMEMELİ. */
    setScreen(512, 300, 2);
    const dpr2 = getCapabilities().lowEndScreen;
    setScreen(1024, 600, 1);
    const dpr1 = getCapabilities().lowEndScreen;
    expect(dpr2).toBe(dpr1);
    expect(dpr2).toBe(true);
  });

  it('KİLİT: eşiğin hemen ÜSTÜ fiziksel panel low sayılmaz (1100×620 @dpr2)', () => {
    setScreen(550, 310, 2);
    expect(getCapabilities().lowEndScreen).toBe(false);
  });
});
