/**
 * mapMoodPaletteAuthority.test.ts — #641 KİLİDİ
 * "Harita mood'u renk İCAT EDEMEZ; palet tek otoritedir."
 *
 * ── NEDEN VAR (CİHAZDA ÖLÇÜLDÜ, 2026-08-19, Xiaomi 23090RA98I) ──────────────
 * KULLANICI: *"ana yollar siyah, belli olmuyor."*
 * Ekran pikselinden ölçüldü (vektör GECE, `adb screencap`):
 *   ara sokak  **RGB(111,117,129)** = `NIGHT_PALETTE.minor` (#6f7581) ✔ doğru
 *   ana yol    **RGB(56,56,64)**    = palette KARŞILIĞI YOK ✘
 * Katman sayımı kusuru doğruladı: `primaryCasing` %9,23 çizilirken `primary`
 * gövdesi %0,01, `secondary` %0,03 idi — yani ana yollar gövdesiz siyah kasa
 * gibi görünüyordu.
 *
 * KÖK: `updateMapMood()` "OEM grafit" döneminden kalma SABİT sayılarla
 * `road-primary` (68,68,79), `road-secondary` (56,56,64) ve `background`
 * (#131822) yazıyordu. İkisi de zemin (#222c3c) ve `minor` (#6f7581) tonundan
 * KOYU → yol merdiveni TERSİNE dönüyordu; ayrıca #622'de ölçülerek yükseltilen
 * gece zemini her mood güncellemesinde eski karanlık değere geri çekiliyordu.
 * Paint property yazımı KALICI olduğu için harita "önce doğru, ilk risk
 * güncellemesinden sonra siyah" davranıyordu.
 *
 * KİLİTLENEN SÖZLEŞMELER:
 *   1. Risk YOKKEN (r=0) yol renkleri paletin BİREBİR kendisidir.
 *   2. Risk arttıkça renk yalnız ZEMİNE doğru harmanlanır (geri çekilme) —
 *      yeni bir renk üretilmez.
 *   3. Yol merdiveni sırası HER risk değerinde korunur (motorway ≥ primary ≥
 *      secondary ≥ minor, gece; gündüz palet ters yönde ama sıra yine korunur).
 *   4. Zemin tabanı PALETTEN gelir — sabit `#131822` yasak (#622).
 *   5. Kaynakta ham `rgb(68`/`rgb(56` sabitleri geri gelemez.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { _hexToRgb, _mixRgb } from '../platform/map/MapLayerManager';
import { NIGHT_PALETTE, DAY_PALETTE, MAP_BG_NIGHT, MAP_BG_DAY } from '../platform/mapStyleBuilders';

function lum([r, g, b]: readonly [number, number, number]): number {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Ürün formülünün birebir kopyası — kilit, davranışı MODELLER. */
function moodColor(hex: string, bgHex: string, risk: number) {
  return _mixRgb(_hexToRgb(hex), _hexToRgb(bgHex), 0.25 * risk);
}

describe('#641 — mood renk icat edemez, palet tek otoritedir', () => {
  it('🔒 risk YOKKEN yol rengi paletin BİREBİR kendisi', () => {
    for (const [pal, bg] of [[NIGHT_PALETTE, MAP_BG_NIGHT], [DAY_PALETTE, MAP_BG_DAY]] as const) {
      expect(moodColor(pal.primary,   bg, 0)).toEqual(_hexToRgb(pal.primary));
      expect(moodColor(pal.secondary, bg, 0)).toEqual(_hexToRgb(pal.secondary));
    }
  });

  it('🔒 CİHAZDA ÖLÇÜLEN KUSUR: ana yol ARTIK (56,56,64) / (68,68,79) OLAMAZ', () => {
    const bad = [[56, 56, 64], [68, 68, 79]];
    for (let r = 0; r <= 1.0001; r += 0.1) {
      for (const [pal, bg] of [[NIGHT_PALETTE, MAP_BG_NIGHT], [DAY_PALETTE, MAP_BG_DAY]] as const) {
        for (const key of ['primary', 'secondary'] as const) {
          const c = moodColor(pal[key], bg, r);
          for (const b of bad) {
            expect(c, `risk ${r.toFixed(1)} · ${key} eski grafit rengine düştü`).not.toEqual(b);
          }
        }
      }
    }
  });

  it('🔒 GECE: ana yollar HER risk değerinde zeminden ve `minor`dan AÇIK kalır', () => {
    const bgL    = lum(_hexToRgb(MAP_BG_NIGHT));
    const minorL = lum(_hexToRgb(NIGHT_PALETTE.minor));
    for (let r = 0; r <= 1.0001; r += 0.1) {
      const p = lum(moodColor(NIGHT_PALETTE.primary,   MAP_BG_NIGHT, r));
      const s = lum(moodColor(NIGHT_PALETTE.secondary, MAP_BG_NIGHT, r));
      expect(p, `risk ${r.toFixed(1)}: primary zeminden koyu`).toBeGreaterThan(bgL);
      expect(s, `risk ${r.toFixed(1)}: secondary zeminden koyu`).toBeGreaterThan(bgL);
      expect(s, `risk ${r.toFixed(1)}: secondary tali yoldan koyu — hiyerarşi ters`).toBeGreaterThan(minorL);
      expect(p, `risk ${r.toFixed(1)}: primary secondary'den koyu — merdiven bozuk`).toBeGreaterThan(s);
    }
  });

  it('🔒 risk ARTTIKÇA yol zemine yaklaşır (geri çekilir), uzaklaşmaz', () => {
    const bgL = lum(_hexToRgb(MAP_BG_NIGHT));
    let prev = Math.abs(lum(moodColor(NIGHT_PALETTE.primary, MAP_BG_NIGHT, 0)) - bgL);
    for (let r = 0.2; r <= 1.0001; r += 0.2) {
      const d = Math.abs(lum(moodColor(NIGHT_PALETTE.primary, MAP_BG_NIGHT, r)) - bgL);
      expect(d, `risk ${r.toFixed(1)}: kontrast artmış (mood öne çıkarıyor)`).toBeLessThanOrEqual(prev + 1e-9);
      prev = d;
    }
  });

  it('🔒 KAYNAK: ham grafit sabitleri ve sabit #131822 zemini geri gelemez', () => {
    const src = readFileSync(join(process.cwd(), 'src/platform/map/MapLayerManager.ts'), 'utf8');
    const fn  = src.match(/export function updateMapMood[\s\S]*?\n\}/)?.[0] ?? '';
    expect(fn, 'updateMapMood bulunamadı').not.toBe('');
    expect(fn, 'ham (68 - 20 * r) grafit formülü geri gelmiş').not.toMatch(/68\s*-\s*20\s*\*\s*r/);
    expect(fn, 'ham (56 - 18 * r) grafit formülü geri gelmiş').not.toMatch(/56\s*-\s*18\s*\*\s*r/);
    expect(fn, 'zemin sabit sayıdan türetiliyor (#622 ihlali)').not.toMatch(/19\s*-\s*7\s*\*\s*r/);
    expect(fn, 'renk paletten türetilmiyor').toMatch(/NIGHT_PALETTE|DAY_PALETTE/);
  });
});
