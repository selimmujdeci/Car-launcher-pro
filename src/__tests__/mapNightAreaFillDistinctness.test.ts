/**
 * mapNightAreaFillDistinctness.test.ts — 2026-08-24 KİLİT: alan dolguları
 * BİRBİRİNDEN de ayırt edilir, yalnız zeminden değil.
 *
 * SAHA (gerçek cihaz ekran görüntüsü, "kesinlikle premium değil" turu):
 * kullanıcı "Google'da parklar yeşil, su mavi, biz her şey aynı düzlemde"
 * dedi. `mapNightContrastAndTileError.test.ts` her dolguyu ZEMİNE karşı ayrı
 * ayrı ölçüyordu (hepsi geçiyordu) ama dolguları BİRBİRİNE karşı hiç
 * ölçmüyordu. Bu dosya o boşluğu kapatır:
 *
 *     park↔residential (eski)  → 1,00  (matematiksel olarak AYNI parlaklık)
 *     water↔buildingFill (eski) → 1,04  (neredeyse ayırt edilemez)
 *
 * Yani ekranın büyük kısmını kaplayan dört dolgu (su/park/konut/bina) dar bir
 * parlaklık bandına (0,040–0,063) sıkışmıştı — yalnız yollar bandın dışındaydı.
 * `water`/`park` yükseltildi, `residential`/`buildingFill` KORUNDU (konutun
 * sakin/"yarışmayan" zemin işlevi `mapNightContrastAndTileError.test.ts`
 * içinde ayrıca kilitli). Bu kilit ZAYIFLATILMAZ/SİLİNMEZ; değer bilinçli
 * değişirse GÜNCELLENİR.
 */
import { describe, it, expect } from 'vitest';
import { NIGHT_PALETTE } from '../platform/mapStyleBuilders';

function _lin(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b);
}
function contrast(a: string, b: string): number {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe('gece paleti — dolgular BİRBİRİNDEN ayırt edilir (yalnız zeminden değil)', () => {
  it('`park` ve `residential` matematiksel olarak AYNI RENK DEĞİL (eski değer 1.00 idi)', () => {
    const cr = contrast(NIGHT_PALETTE.park, NIGHT_PALETTE.residential);
    expect(cr, `park↔residential ${cr.toFixed(2)} — ayırt edilemez`).toBeGreaterThanOrEqual(1.3);
  });

  it('`water` ve `buildingFill` ayırt edilir (eski değer 1.04 idi — göl mü bina mı belirsizdi)', () => {
    const cr = contrast(NIGHT_PALETTE.water, NIGHT_PALETTE.buildingFill);
    expect(cr, `water↔buildingFill ${cr.toFixed(2)} — ayırt edilemez`).toBeGreaterThanOrEqual(1.2);
  });

  it('yükseltme `residential`/`buildingFill`\'e DOKUNMADI (konutun sakin-zemin sözleşmesi korunur)', () => {
    expect(NIGHT_PALETTE.residential).toBe('#2e394b');
    expect(NIGHT_PALETTE.buildingFill).toBe('#3a4557');
  });

  it('renk YÖNÜ korundu — su mavi ekseninde (B>R), park yeşil ekseninde (G>R,G>B)', () => {
    const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
    const [wr, , wb] = hex(NIGHT_PALETTE.water);
    expect(wb).toBeGreaterThan(wr);
    const [pr, pg, pb] = hex(NIGHT_PALETTE.park);
    expect(pg).toBeGreaterThan(pr);
    expect(pg).toBeGreaterThan(pb);
  });

  it('yeni değerler de GECE KONFORU tavanını (≤2,5, zemine karşı) aşmadı', () => {
    const bg = NIGHT_PALETTE.bg;
    expect(contrast(bg, NIGHT_PALETTE.water)).toBeLessThanOrEqual(2.5);
    expect(contrast(bg, NIGHT_PALETTE.park)).toBeLessThanOrEqual(2.5);
  });

  it('yeni değerler de `minor` yolundan KOYU kaldı (dolgular yolla yarışmaz)', () => {
    expect(luminance(NIGHT_PALETTE.water)).toBeLessThan(luminance(NIGHT_PALETTE.minor));
    expect(luminance(NIGHT_PALETTE.park)).toBeLessThan(luminance(NIGHT_PALETTE.minor));
  });
});
