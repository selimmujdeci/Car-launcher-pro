/**
 * mapNightFilterContrast.test.ts — #620 KİLİDİ
 *
 * KULLANICI BİLDİRİMİ (2026-08-17, gerçek araç, gece, ACTIVE navigasyon):
 * *"gece rota böyle karanlık oluyor."*
 *
 * KÖK: `FullMapView` harita kabına gece CSS filtresi uyguluyordu
 * (`brightness(0.4) saturate(0.8) sepia(0.2) hue-rotate(-10deg)`). Filtre
 * MapLibre canvas'ının TAMAMINI karartır — rota ve amber uyarı sinyali dâhil.
 * Cihazda ekran pikselinden okunan rota gövdesi #2D3F52 = rgb(45,63,82) idi;
 * palet rengi `#5b9dff` = rgb(91,157,255). Filtre modeli aynı girdide
 * rgb(49,64,87) öngördü → ölçümle birebir eşleşti, kök kanıtlandı.
 *
 * Bu kilit, PALETİ değil **ekranda kalan** kontrastı korur: filtre bir daha
 * sessizce ölçülmüş kazancı geri alamaz. Değer bilinçli değişirse eşikler
 * güncellenir — kilit kaldırılmaz.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTE_CORE_STOPS_DARK_BASEMAP } from '../platform/map/core/routeColorModel';
import { MAP_BG_NIGHT } from '../platform/map/_mapIds';

/* ── WCAG + CSS filter primitifleri (spec matrisleri) ────────────────────── */
const srgb = (v: number): number => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const lum = (rgb: number[]): number =>
  0.2126 * srgb(rgb[0] / 255) + 0.7152 * srgb(rgb[1] / 255) + 0.0722 * srgb(rgb[2] / 255);
const cr = (a: number[], b: number[]): number => {
  const l1 = lum(a), l2 = lum(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
};
const hexToRgb = (h: string): number[] => {
  const c = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(c.substr(i, 2), 16));
};
const clamp = (x: number): number => Math.max(0, Math.min(255, Math.round(x)));
const brightness = (rgb: number[], k: number): number[] => rgb.map((v) => clamp(v * k));
const saturate = (rgb: number[], s: number): number[] => {
  const [r, g, b] = rgb;
  return [
    clamp((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b),
    clamp((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b),
    clamp((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b),
  ];
};

/* #622 — zemin artık paletten okunur (sabit kopya TUTULMAZ; palet değişirse
   kilit onunla birlikte hareket eder). Eski sabit `#131822` idi. */
const NIGHT_BG = hexToRgb(MAP_BG_NIGHT);
const AMBER    = hexToRgb('#f59e0b');   // tehlike + kritik manevra sinyali
const CORE     = hexToRgb(ROUTE_CORE_STOPS_DARK_BASEMAP[0]);

/**
 * Kaynaktan harita kabının filtresini OKU — kilit gerçek koda bakar.
 *
 * #622: gece filtresi TAMAMEN kaldırıldı (`filter: 'none'`). Kilit bu yüzden
 * "filtre varsa şu eşikleri sağlasın" yerine "filtre KARARTMASIN" sözleşmesine
 * taşındı; filtre yoksa etkin kontrast doğrudan paletten hesaplanır.
 */
function readNightFilter(): string {
  const src = readFileSync(join(process.cwd(), 'src/components/map/FullMapView.tsx'), 'utf8');
  const m = src.match(/filter:\s*(?:mapNight\s*\?\s*)?'([^']+)'/);
  expect(m, 'harita kabının filtresi kaynakta bulunamadı').toBeTruthy();
  return m![1];
}

/** Filtre dizesini uygula — yalnız beklenen primitifler desteklenir. */
function applyFilter(rgb: number[], filter: string): number[] {
  let out = rgb;
  const b = filter.match(/brightness\(([\d.]+)\)/);
  const s = filter.match(/saturate\(([\d.]+)\)/);
  if (b) out = brightness(out, parseFloat(b[1]));
  if (s) out = saturate(out, parseFloat(s[1]));
  return out;
}

describe('#620 — gece CSS filtresi ölçülmüş kontrastı geri ALMAZ', () => {
  const filter = readNightFilter();

  it('🔒 sinyal kimliğini bozan primitifler YOK (sepia · hue-rotate · grayscale · invert)', () => {
    for (const bad of ['sepia', 'hue-rotate', 'grayscale', 'invert']) {
      expect(filter, `filtrede ${bad} var`).not.toContain(bad);
    }
  });

  it('🔒 parlaklık düşüşü yok ya da ölçülen tabanın üstünde (0,4 sahada KUSURLUYDU)', () => {
    const b = filter.match(/brightness\(([\d.]+)\)/);
    if (b) {
      // Filtre geri getirilirse en az bu taban korunur.
      expect(parseFloat(b[1])).toBeGreaterThanOrEqual(0.85);
      expect(parseFloat(b[1])).toBeLessThanOrEqual(1.0);
    } else {
      // #622 sözleşmesi: karartma filtresi YOK — gece paletten gelir.
      expect(filter).toBe('none');
    }
  });

  it('🔒 FİLTRE SONRASI rota↔zemin kontrastı ≥ 4,0 (kusurlu hâlde 1,89 idi)', () => {
    const bg   = applyFilter(NIGHT_BG, filter);
    const core = applyFilter(CORE, filter);
    expect(cr(bg, core)).toBeGreaterThanOrEqual(4.0);
  });

  it('🔒 FİLTRE SONRASI amber SİNYAL↔zemin ≥ 4,5 (kusurlu hâlde 2,13 idi)', () => {
    const bg    = applyFilter(NIGHT_BG, filter);
    const amber = applyFilter(AMBER, filter);
    expect(cr(bg, amber)).toBeGreaterThanOrEqual(4.5);
  });

  it('eski filtre bu kilitleri GEÇEMEZDİ — kilidin anlamı', () => {
    const old = 'brightness(0.4) saturate(0.8)';
    const bg   = applyFilter(NIGHT_BG, old);
    const core = applyFilter(CORE, old);
    const amber = applyFilter(AMBER, old);
    expect(cr(bg, core)).toBeLessThan(4.0);
    expect(cr(bg, amber)).toBeLessThan(4.5);
  });

  it('🔒 HİÇBİR temada karartma filtresi uygulanmaz (#622)', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/map/FullMapView.tsx'), 'utf8');
    /* Eski sözleşme "gündüz none, gece filtre" idi. #622 ile gece filtresi de
       kalktı: gündüz okunabilirliği korunurken gece de ölçülmüş paletten gelir.
       Kilit, karartmanın hangi temada olursa olsun geri gelmesini engeller. */
    expect(src).toMatch(/filter:\s*'none'/);
    expect(src).not.toMatch(/filter:\s*mapNight/);
  });
});
