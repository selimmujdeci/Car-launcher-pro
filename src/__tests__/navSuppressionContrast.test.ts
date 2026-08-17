/**
 * navSuppressionContrast.test.ts — #621 KİLİDİ
 *
 * KULLANICI BİLDİRİMİ (2026-08-17, gece, gerçek navigasyon ekran görüntüsü):
 * *"bu haritayı düzelt, böyle saçma harita olamaz, Google Maps seviyesinde
 * olacak, bu böyle satılamaz."*
 *
 * ÖLÇÜLEN KUSUR: `NAV_SUPPRESS_TIERS` navigasyon açılır açılmaz sokak ağını ve
 * sokak adlarını opaklıkla söndürüyordu. Ekranda kalan kontrast (gece paleti +
 * #620 sonrası `brightness(0.8)` filtresi; **1,00 = tamamen görünmez**):
 *     Tier 0 → tali yol 1,15 · etiket 1,69
 *     Tier 1 → tali yol 1,05 · etiket 1,21   ← kullanıcının ekranı ("80 M SONRA")
 *     Tier 2 → tali yol 1,02 · etiket 1,08
 * Yani rota dışında şehir yok oluyordu. Rota baskınlığı KENDİ genişliği ve
 * renginden gelmelidir; şehri silerek üretilmez — dönülecek sokak da sönüyordu.
 *
 * BU KİLİTLER ZAYIFLATILMAZ. Değer bilinçli değişirse eşikler güncellenir.
 *
 * #622 GÜNCELLEMESİ — yukarıdaki rakamlar o günkü palet + `brightness(0.8)`
 * filtresiyle ölçülmüş TARİHSEL değerlerdir. Palet açıldıktan ve filtre
 * kaldırıldıktan sonra aynı manifest şunu verir: Tier 0 → 3,04 / 8,73 ·
 * Tier 1 → 2,33 / 5,09 · Tier 2 → 1,96 / 3,73. Eşikler bilinçli olarak
 * tabanda bırakıldı: kilit "şehir silinmesin" sözleşmesini korur, paletin
 * her turda değişebilen tam değerini değil.
 */

import { describe, it, expect } from 'vitest';
import { NAV_SUPPRESS_TIERS, NAV_SUPPRESS_LAYERS, NIGHT_PALETTE } from '../platform/mapStyleBuilders';

/* ── Ekranda kalan kontrastı MODELLE (blend → WCAG) ───────────────────────── */
const srgb = (v: number): number => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const lum = (rgb: number[]): number =>
  0.2126 * srgb(rgb[0] / 255) + 0.7152 * srgb(rgb[1] / 255) + 0.0722 * srgb(rgb[2] / 255);
const cr = (a: number[], b: number[]): number => {
  const l1 = lum(a), l2 = lum(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
};
const hex = (h: string): number[] => [0, 2, 4].map((i) => parseInt(h.replace('#', '').substr(i, 2), 16));
const clamp = (x: number): number => Math.max(0, Math.min(255, Math.round(x)));
const blend = (fg: number[], bg: number[], a: number): number[] =>
  fg.map((v, i) => clamp(a * v + (1 - a) * bg[i]));

/**
 * #622 — ZEMİN/YOL CANLI PALETTEN OKUNUR, FİLTRE MODELİ KALDIRILDI.
 *
 * İlk yazımda burada `#161c28` · `#6a6b70` sabitleri ve bir `brightness(0.8)`
 * çarpanı vardı. #622'de palet değişti VE gece filtresi tamamen kaldırıldı —
 * yani kilit, artık var olmayan bir ekranı ölçüyordu. Sabitler ve filtre
 * çıkarıldı: model bundan böyle ürünün gerçek gece yüzeyini modeller.
 */
const BG     = hex(NIGHT_PALETTE.bg);      // gece zemini (canlı)
const MINOR  = hex(NIGHT_PALETTE.minor);   // gece tali yolu (canlı)
const LABEL  = hex('#c8ccd4');             // gece yol etiketi

const opacityOf = (tier: number, layer: string): number => {
  const e = NAV_SUPPRESS_TIERS[tier].find((x) => x[0] === layer);
  expect(e, `${layer} kademesi ${tier} manifestinde yok`).toBeTruthy();
  return e![2];
};
const roadContrast  = (a: number): number => cr(BG, blend(MINOR, BG, a));
const labelContrast = (a: number): number => cr(BG, blend(LABEL, BG, a));

describe('#621 — navigasyon bastırması şehri SİLMEZ', () => {
  it('🔒 Tier 0 (normal seyir) bastırma YAPMAZ — tam bağlam', () => {
    for (const [id, , op] of NAV_SUPPRESS_TIERS[0]) {
      expect(op, `${id} normal seyirde bastırılmış`).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('🔒 hiçbir kademede yol gövdesi görünmezliğe düşmez (sahada 0,03–0,20 idi)', () => {
    for (let t = 0; t < NAV_SUPPRESS_TIERS.length; t++) {
      for (const body of ['road-minor', 'road-secondary', 'road-primary']) {
        expect(opacityOf(t, body), `tier ${t} · ${body}`).toBeGreaterThanOrEqual(0.55);
      }
    }
  });

  it('🔒 hiçbir kademede yol ETİKETİ görünmezliğe düşmez (sahada 0,05–0,28 idi)', () => {
    for (let t = 0; t < NAV_SUPPRESS_TIERS.length; t++) {
      expect(opacityOf(t, 'road-label'), `tier ${t} · road-label`).toBeGreaterThanOrEqual(0.50);
    }
  });

  it('🔒 EKRANDA kalan kontrast: tali yol ≥1,6 · etiket ≥3,0 (her kademede)', () => {
    for (let t = 0; t < NAV_SUPPRESS_TIERS.length; t++) {
      expect(roadContrast(opacityOf(t, 'road-minor')), `tier ${t} tali yol`).toBeGreaterThanOrEqual(1.6);
      expect(labelContrast(opacityOf(t, 'road-label')), `tier ${t} etiket`).toBeGreaterThanOrEqual(3.0);
    }
  });

  it('🔒 kademeler MONOTONİK azalır (tier arttıkça bastırma artar, ters dönmez)', () => {
    for (const layer of ['road-minor', 'road-secondary', 'road-primary', 'road-label']) {
      const vals = [0, 1, 2].map((t) => opacityOf(t, layer));
      expect(vals[0], `${layer} 0→1`).toBeGreaterThanOrEqual(vals[1]);
      expect(vals[1], `${layer} 1→2`).toBeGreaterThanOrEqual(vals[2]);
    }
  });

  it('🔒 üç kademe AYNI katman kimliklerini taşır (tam restore garantisi)', () => {
    const ids = NAV_SUPPRESS_TIERS.map((t) => t.map((e) => e[0]).sort().join('|'));
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).toBe(ids[0]);
  });

  it('🔒 NAV_SUPPRESS_LAYERS hâlâ tier 0 (geriye uyum sözleşmesi)', () => {
    expect(NAV_SUPPRESS_LAYERS).toBe(NAV_SUPPRESS_TIERS[0]);
  });

  it('eski manifest bu kilitleri GEÇEMEZDİ — kilidin anlamı', () => {
    // Sahada ölçülen eski değerler: tier1 tali yol 0,07 · etiket 0,12
    expect(roadContrast(0.07)).toBeLessThan(1.6);
    expect(labelContrast(0.12)).toBeLessThan(3.0);
  });
});
