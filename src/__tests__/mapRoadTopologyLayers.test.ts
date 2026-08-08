/**
 * mapRoadTopologyLayers.test.ts — köprü/tünel topolojisi + yol numarası kalkanı kilitleri.
 *
 * NEDEN VAR: HMI referans değerlendirmesinde iki kusur ölçüldü —
 *   (1) katlı kavşak düz bir gri yumaktı; hangi kolun üstten geçtiği okunmuyordu,
 *       çünkü köprü · tünel · yüzey yolu AYNI çiziliyordu (`brunnel` hiç okunmuyordu),
 *   (2) yol numarası (E-5) hiç gösterilmiyordu; sürücü tabelayı haritayla
 *       eşleştiremiyordu, oysa `ref` alanı karolarda ZATEN geliyordu.
 *
 * Bu dosyanın kilitlediği asıl şey KATMAN SIRASIDIR: topoloji tamamen çizim
 * sırasından okunur. Tünel yüzeyin altına, köprü üstüne çizilmezse veri doğru
 * olsa bile ekran yanlış olur — ve bu tür bir bozulma sessizdir.
 */

import { describe, it, expect } from 'vitest';
import { buildVectorStyle } from '../platform/mapStyleBuilders';
import { SHIELD_IMG_DAY, SHIELD_IMG_NIGHT } from '../platform/map/_mapState';
import type { MapSource } from '../platform/mapSourceTypes';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

const LOCAL_PBF: MapSource = {
  id: 'local', name: 'local', type: 'offline', description: '', isAvailable: true,
};

function styleFor(night: boolean): StyleSpecification {
  const sources = new Map<string, MapSource>([['local', LOCAL_PBF]]);
  return buildVectorStyle(sources, () => {
    throw new Error('vektör stili üretilemedi');
  }, night);
}

const DAY = styleFor(false);
const NIGHT = styleFor(true);

const idx = (style: StyleSpecification, id: string): number => {
  const i = style.layers.findIndex((l) => l.id === id);
  if (i < 0) throw new Error(`katman yok: ${id}`);
  return i;
};
const layer = (style: StyleSpecification, id: string): LayerSpecification =>
  style.layers[idx(style, id)]!;
const filterJson = (style: StyleSpecification, id: string): string =>
  JSON.stringify((layer(style, id) as unknown as { filter?: unknown }).filter ?? null);

/** Yüzey yolu çizen tüm katmanlar — brunnel kapısı hepsinde olmalı. */
const SURFACE_ROAD_LAYERS = [
  'road-motorway-casing', 'road-primary-casing', 'road-minor-casing',
  'road-motorway', 'road-primary', 'road-secondary', 'road-minor',
];

describe('köprü / tünel topolojisi', () => {
  it('her yüzey yolu katmanı köprü ve tüneli DIŞLAR', () => {
    for (const id of SURFACE_ROAD_LAYERS) {
      const f = filterJson(DAY, id);
      expect(f, `${id} brunnel kapısı taşımıyor`).toContain('brunnel');
      expect(f, `${id} köprüyü dışlamıyor`).toContain('bridge');
      expect(f, `${id} tüneli dışlamıyor`).toContain('tunnel');
    }
  });

  it('tünel yüzey yollarının ALTINDA çizilir (sıra kilidi)', () => {
    // Tünel önce → üstüne yüzey biner → "yolun altından geçiyor" okunur.
    for (const id of SURFACE_ROAD_LAYERS) {
      expect(idx(DAY, 'road-tunnel-casing'), `road-tunnel-casing ${id} altında olmalı`)
        .toBeLessThan(idx(DAY, id));
      expect(idx(DAY, 'road-tunnel'), `road-tunnel ${id} altında olmalı`)
        .toBeLessThan(idx(DAY, id));
    }
  });

  it('köprü yüzey yollarının ÜSTÜNDE çizilir (sıra kilidi)', () => {
    for (const id of SURFACE_ROAD_LAYERS) {
      expect(idx(DAY, 'road-bridge-casing'), `road-bridge-casing ${id} üstünde olmalı`)
        .toBeGreaterThan(idx(DAY, id));
      expect(idx(DAY, 'road-bridge'), `road-bridge ${id} üstünde olmalı`)
        .toBeGreaterThan(idx(DAY, id));
    }
  });

  it('köprü kasası gövdesinden ÖNCE gelir — güverte kenarı gövdeyi yemez', () => {
    expect(idx(DAY, 'road-bridge-casing')).toBeLessThan(idx(DAY, 'road-bridge'));
    expect(idx(DAY, 'road-tunnel-casing')).toBeLessThan(idx(DAY, 'road-tunnel'));
  });

  it('köprü ve tünel katmanları YALNIZ kendi brunnel türünü çizer', () => {
    for (const [id, kind] of [
      ['road-bridge', 'bridge'], ['road-bridge-casing', 'bridge'],
      ['road-tunnel', 'tunnel'], ['road-tunnel-casing', 'tunnel'],
    ] as const) {
      const f = JSON.parse(filterJson(DAY, id)) as unknown[];
      expect(f[0], `${id} eşitlik filtresi kullanmalı`).toBe('==');
      expect(f[2], `${id} yanlış brunnel türü`).toBe(kind);
    }
  });

  it('tünel gecede de tanımlıdır ve gündüzden farklı görünürlük taşır', () => {
    const dayOp = (layer(DAY, 'road-tunnel') as unknown as
      { paint: Record<string, number> }).paint['line-opacity'];
    const nightOp = (layer(NIGHT, 'road-tunnel') as unknown as
      { paint: Record<string, number> }).paint['line-opacity'];
    expect(typeof dayOp).toBe('number');
    expect(typeof nightOp).toBe('number');
    expect(dayOp).not.toBe(nightOp);
  });

  it('tünel kasası KESİKLİ çizilir — "yol var ama görünmüyor" işareti', () => {
    const paint = (layer(DAY, 'road-tunnel-casing') as unknown as
      { paint: Record<string, unknown> }).paint;
    expect(Array.isArray(paint['line-dasharray'])).toBe(true);
  });
});

describe('yol numarası kalkanı', () => {
  it('yalnız ref TAŞIYAN ve üst sınıf yollarda görünür', () => {
    const f = filterJson(DAY, 'road-shield');
    expect(f).toContain('has');
    expect(f).toContain('ref');
    expect(f).toContain('motorway');
    // Tali sokaklarda kalkan olmaz — ekranı kirletirdi.
    expect(f).not.toContain('service');
  });

  it('metin ref alanından gelir — sabit numara GÖMÜLMEZ', () => {
    const layout = (layer(DAY, 'road-shield') as unknown as
      { layout: Record<string, unknown> }).layout;
    expect(JSON.stringify(layout['text-field'])).toContain('ref');
  });

  it('tek imaj metne göre esner — numara başına ayrı asset YOK', () => {
    const layout = (layer(DAY, 'road-shield') as unknown as
      { layout: Record<string, unknown> }).layout;
    // icon-text-fit olmadan "E-5" ve "D-100" için ayrı görsel üretmek gerekirdi.
    expect(layout['icon-text-fit']).toBe('both');
  });

  it('gündüz ve gece AYRI imaj kullanır ve id sabitlerle birebir eşleşir', () => {
    /*
     * Katman `mapStyleBuilders`'ta, imaj `MapLayerManager`'da üretilir. İkisi
     * ayrı dosyada olduğu için id'ler sessizce ayrışabilir → kalkan boş çıkar
     * ama hiçbir hata verilmez. Bu kilit o sessiz kırılmayı yakalar.
     */
    const dayIcon = (layer(DAY, 'road-shield') as unknown as
      { layout: Record<string, unknown> }).layout['icon-image'];
    const nightIcon = (layer(NIGHT, 'road-shield') as unknown as
      { layout: Record<string, unknown> }).layout['icon-image'];
    expect(dayIcon).toBe(SHIELD_IMG_DAY);
    expect(nightIcon).toBe(SHIELD_IMG_NIGHT);
    expect(dayIcon).not.toBe(nightIcon);
  });

  it('kalkan yol etiketiyle çakışmaz (overlap kapalı)', () => {
    const layout = (layer(DAY, 'road-shield') as unknown as
      { layout: Record<string, unknown> }).layout;
    expect(layout['icon-allow-overlap']).toBe(false);
    expect(layout['text-allow-overlap']).toBe(false);
  });
});

describe('bina hacmi — gündüz beyaz bloklar düz kâğıt gibi durmamalı', () => {
  const ao = (s: StyleSpecification): number =>
    (layer(s, 'building-3d') as unknown as { paint: Record<string, number> })
      .paint['fill-extrusion-ambient-occlusion-intensity']!;

  it('gündüz taban kararması gecenin ÜSTÜNDEDİR', () => {
    // Gündüz bina/zemin dolgu farkı yalnız 1.07 — hacmi taşıyan tek şey AO.
    expect(ao(DAY)).toBeGreaterThan(ao(NIGHT));
  });

  it('AO her iki temada da makul aralıkta kalır', () => {
    for (const s of [DAY, NIGHT]) {
      expect(ao(s)).toBeGreaterThan(0.15);
      expect(ao(s)).toBeLessThanOrEqual(0.6);
    }
  });
});

describe('performans bütçesi', () => {
  it('topoloji için eklenen katman sayısı sınırlı kalır (head unit bütçesi)', () => {
    // Köprü×2 + tünel×2 + kalkan×1 = 5. Sınıf başına ayrı katman açılsaydı
    // bu sayı 20'ye çıkardı; genişlik `match` ile tek katmanda çözülüyor.
    const added = DAY.layers.filter((l) =>
      l.id.startsWith('road-bridge') || l.id.startsWith('road-tunnel') || l.id === 'road-shield');
    expect(added.length).toBe(5);
  });

  it('gece ve gündüz AYNI katman listesini üretir — ikinci liste doğmaz', () => {
    expect(DAY.layers.map((l) => l.id)).toEqual(NIGHT.layers.map((l) => l.id));
  });
});
