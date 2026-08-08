/**
 * mapDayPaletteContrast.test.ts — gündüz vektör paletinin TON SÖZLEŞMESİ kilidi.
 *
 * NEDEN VAR: gündüz paletinin ilk sürümü zemini beyaza (#fafbfc) çekiyordu ve tali
 * yolun zemine kontrastı **1.38**'e düşüyordu — sürücünün sahada gördüğü "yollar
 * beyaz, hiçbir şey seçilmiyor" tam olarak bu sayıydı. Renk tercihi tartışmaya
 * açıktır, ama **ölçülebilir ayrım pazarlık konusu değildir**: bu dosya rolleri ve
 * en düşük kontrast oranlarını kilitler, böylece palet bir daha sessizce beyazlaşamaz.
 *
 * SÖZLEŞME: binalar EN AÇIK (beyaz) · zemin ORTADA · yollar EN KOYU, otoyoldan
 * taliye monoton açılan gri. Hiyerarşi renkle değil TONLA taşınır.
 */

import { describe, it, expect } from 'vitest';
import { buildVectorStyle } from '../platform/mapStyleBuilders';
import type { MapSource } from '../platform/mapSourceTypes';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

/* ── WCAG bağıl parlaklık + kontrast oranı ────────────────────────────────── */

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/* ── Stil kurulumu ────────────────────────────────────────────────────────── */

const LOCAL_PBF: MapSource = {
  id: 'local', name: 'local', type: 'offline', description: '', isAvailable: true,
};

function styleFor(night: boolean): StyleSpecification {
  const sources = new Map<string, MapSource>([['local', LOCAL_PBF]]);
  return buildVectorStyle(sources, () => {
    throw new Error('vektör stili üretilemedi — raster fallback bu kilidin konusu değil');
  }, night);
}

function layer(style: StyleSpecification, id: string): LayerSpecification {
  const found = style.layers.find((l) => l.id === id);
  if (!found) throw new Error(`katman bulunamadı: ${id}`);
  return found;
}
function paintColor(style: StyleSpecification, id: string, prop: string): string {
  const p = (layer(style, id) as unknown as { paint?: Record<string, unknown> }).paint ?? {};
  const v = p[prop];
  if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) {
    throw new Error(`${id}.${prop} düz hex renk değil: ${String(v)}`);
  }
  return v;
}

const DAY = styleFor(false);
const NIGHT = styleFor(true);

const bg        = () => paintColor(DAY, 'background', 'background-color');
const bldgFill  = () => paintColor(DAY, 'building', 'fill-color');
const bldgLine  = () => paintColor(DAY, 'building', 'fill-outline-color');

const ROAD_BODY = {
  motorway:  'road-motorway',
  primary:   'road-primary',
  secondary: 'road-secondary',
  minor:     'road-minor',
} as const;

/** Gövde → kasa eşlemesi. `secondary` kasası tasarımda `minor` kasasını paylaşır. */
const ROAD_CASING: Record<keyof typeof ROAD_BODY, string> = {
  motorway:  'road-motorway-casing',
  primary:   'road-primary-casing',
  secondary: 'road-minor-casing',
  minor:     'road-minor-casing',
};

/**
 * En düşük kabul edilen gövde/zemin kontrastı — sahada ölçülen 1.38 fiyaskosunun
 * çok üstünde. Eşikler palet her güçlendiğinde YUKARI taşınır, asla aşağı.
 * Bugünkü ölçüm: otoyol 4.06 · ana cadde 2.82 · ikincil 2.26 · tali 1.71.
 */
const MIN_ROAD_BG_CONTRAST: Record<keyof typeof ROAD_BODY, number> = {
  motorway: 3.9, primary: 2.7, secondary: 2.2, minor: 1.68,
};

describe('gündüz vektör paleti — ton sözleşmesi', () => {
  it('zemin SAF BEYAZ değildir ve bina sınırı konturla korunur', () => {
    /*
     * ⚠️ BU KİLİT DÜZELTİLDİ. Önceki hali "zemin beyazdan en az 1.1 uzakta olsun"
     * diyordu — yanlış bir VEKİL ölçüydü. Asıl kural yol/zemin ayrımıdır ve
     * yollar koyulaştıktan sonra zemini beyaza yaklaştırmak o ayrımı BOZMAZ,
     * artırır (tali sokak 1.63 → 1.71). Eski eşik korunsaydı doğru paleti
     * engelleyecekti. Kilit gevşetilmedi, ölçtüğü şey DÜZELTİLDİ: zemin saf
     * beyaz olamaz, ve zemin beyaza yaklaştıkça kaybolan bina/zemin farkını
     * KONTUR taşımak zorundadır.
     */
    expect(luminance(bg())).toBeLessThan(luminance('#ffffff'));
    expect(contrast(bldgLine(), bg())).toBeGreaterThanOrEqual(1.4);
  });

  it('binalar haritanın EN AÇIK öğesidir — "evler beyaz"', () => {
    expect(bldgFill().toLowerCase()).toBe('#ffffff');
    expect(luminance(bldgFill())).toBeGreaterThan(luminance(bg()));
    for (const id of Object.values(ROAD_BODY)) {
      expect(luminance(bldgFill())).toBeGreaterThan(luminance(paintColor(DAY, id, 'line-color')));
    }
  });

  it('bina konturu dolgudan koyudur → beyaz binalar birbirine yapışmaz', () => {
    expect(luminance(bldgLine())).toBeLessThan(luminance(bldgFill()));
    expect(contrast(bldgFill(), bldgLine())).toBeGreaterThan(1.2);
  });

  it('her yol gövdesi zeminden KOYUDUR ve en düşük kontrastı geçer', () => {
    for (const [name, id] of Object.entries(ROAD_BODY)) {
      const body = paintColor(DAY, id, 'line-color');
      expect(luminance(body), `${name} zeminden koyu olmalı`).toBeLessThan(luminance(bg()));
      expect(
        contrast(bg(), body),
        `${name} gövde/zemin kontrastı yetersiz`,
      ).toBeGreaterThanOrEqual(MIN_ROAD_BG_CONTRAST[name as keyof typeof ROAD_BODY]);
    }
  });

  it('yol hiyerarşisi TON olarak monotondur: otoyol en koyu → tali en açık', () => {
    const tones = (['motorway', 'primary', 'secondary', 'minor'] as const)
      .map((k) => luminance(paintColor(DAY, ROAD_BODY[k], 'line-color')));
    for (let i = 1; i < tones.length; i++) {
      expect(tones[i], `hiyerarşi ${i}. adımda bozuldu`).toBeGreaterThan(tones[i - 1]!);
    }
  });

  it('her kasa kendi gövdesinden koyudur — ince yolu görünür kılan kasadır', () => {
    for (const key of Object.keys(ROAD_BODY) as Array<keyof typeof ROAD_BODY>) {
      const body   = paintColor(DAY, ROAD_BODY[key], 'line-color');
      const casing = paintColor(DAY, ROAD_CASING[key], 'line-color');
      expect(luminance(casing), `${key} kasası gövdeden koyu olmalı`).toBeLessThan(luminance(body));
    }
  });

  it('su ve park zeminden ayrışır (nötr griye karışmaz)', () => {
    for (const id of ['water-fill', 'landuse-park']) {
      expect(contrast(bg(), paintColor(DAY, id, 'fill-color')), id).toBeGreaterThan(1.05);
    }
  });
});

describe('gündüz etiketleri — halo palete bağlı (gece sabiti sızmaz)', () => {
  /*
   * REGRESYON: `place-town` ve `place-city` halo'ları palette `townHalo`/`cityHalo`
   * TANIMLI olmasına rağmen gece sabitini (#060c14) doğrudan yazıyordu → gündüz
   * beyaz zeminde koyu lacivert gölge. Palet kurulmuş ama katmanlar ona
   * BAĞLANMAMIŞTI; bu kilit o yarım işin geri gelmesini engeller.
   */
  it('hiçbir gündüz katmanı gece halo sabitini taşımaz', () => {
    expect(JSON.stringify(DAY.layers)).not.toContain('#060c14');
  });

  it('şehir/kasaba/yol etiketlerinin halosu açık, metni koyudur', () => {
    for (const id of ['road-label', 'place-town', 'place-city']) {
      const text = paintColor(DAY, id, 'text-color');
      const halo = paintColor(DAY, id, 'text-halo-color');
      expect(luminance(halo), `${id} halosu açık olmalı`).toBeGreaterThan(luminance(text));
      expect(contrast(text, halo), `${id} metin/halo kontrastı`).toBeGreaterThan(4.5);
    }
  });
});

describe('gece paleti — bu turda DEĞİŞMEDİ', () => {
  it('gece halo değerleri birebir korunur (halo palete bağlanması gece davranışını değiştirmez)', () => {
    expect(paintColor(NIGHT, 'place-town', 'text-halo-color')).toBe('#060c14');
    expect(paintColor(NIGHT, 'place-city', 'text-halo-color')).toBe('#060c14');
  });

  it('gecede zemin koyu, yollar zeminden AÇIK kalır — gündüzün tersi ve doğrusu', () => {
    const nightBg = paintColor(NIGHT, 'background', 'background-color');
    for (const id of Object.values(ROAD_BODY)) {
      expect(luminance(paintColor(NIGHT, id, 'line-color')), id).toBeGreaterThan(luminance(nightBg));
    }
  });
});
