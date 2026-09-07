/**
 * cartographyAuthority.test.ts — TİCARİ KARTOGRAFİ SÖZLEŞMESİ (2026-09-05).
 *
 * NEDEN VAR: harita "tema uygulanmış bir Android haritası" gibi görünüyordu.
 * Tanı ölçümle yapıldı (OpenFreeMap/OpenMapTiles karoları `@mapbox/vector-tile`
 * ile çözülerek, İstanbul · Siverek · Mersin z8–z14) ve üç SESSİZ kusur
 * bulundu — hiçbiri o güne dek herhangi bir testi düşürmüyordu:
 *
 *   1. **Park/orman HİÇ ÇİZİLMİYORDU.** `landuse-park` katmanı `landuse`
 *      kaynağında `class in [park, grass, meadow, …]` arıyordu; ölçülen
 *      `landuse.class` değerlerinde bunların HİÇBİRİ yok (school/industrial/
 *      cemetery/commercial/…). Yeşil, hiç kullanılmayan `landcover` ve `park`
 *      katmanlarındaydı.
 *   2. **Rampalar ana arterle aynı genişlikteydi** (ölçülen `ramp=1` oranı:
 *      motorway %72 · trunk %58 · primary %25).
 *   3. **Etiketler sınıf/rank süzgeci olmadan basılıyordu**; `road-label`
 *      `transportation_name`in TÜMÜNÜ (feribot hatları dahil) çiziyordu ve
 *      `place-town` z-sınırı olmadan köy/mahalle adlarını da basıyordu
 *      (ölçüm: `place` z10'da karo başına 124–389 kayıt).
 *
 * Bu dosya o üç kusurun ve onlarla birlikte kurulan kartografik hiyerarşinin
 * kilididir. Kilitler ZAYIFLATILMAZ; davranış bilinçli değişirse GÜNCELLENİR.
 */

import { describe, it, expect } from 'vitest';
import { validateStyleMin, createExpression } from '@maplibre/maplibre-gl-style-spec';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

import {
  buildVectorStyle, NAV_SUPPRESS_TIERS,
  ROAD_VISIBILITY, AREA_VISIBILITY, LABEL_VISIBILITY, LABEL_VISIBILITY_MAX,
  RAMP_WIDTH_FACTOR, NIGHT_PALETTE, DAY_PALETTE, BUILDING_3D_RISE,
} from '../platform/mapStyleBuilders';
import { DECLUTTER_OWNED_LAYERS, resolveDeclutter } from '../platform/map/core/mapDeclutterModel';
import { CAMERA_CFG } from '../platform/cameraEngine';
import type { MapSource } from '../platform/mapSourceTypes';

/* ── Stil kurulumu ────────────────────────────────────────────────────────── */

const LOCAL_PBF: MapSource = {
  id: 'local', name: 'local', type: 'offline', description: '', isAvailable: true,
};
function styleFor(night: boolean): StyleSpecification {
  return buildVectorStyle(new Map([['local', LOCAL_PBF]]), () => {
    throw new Error('raster fallback bu kilidin konusu değil');
  }, night);
}
const DAY = styleFor(false);
const NIGHT = styleFor(true);

const layer = (s: StyleSpecification, id: string): LayerSpecification => {
  const l = s.layers.find((x) => x.id === id);
  if (!l) throw new Error(`katman yok: ${id}`);
  return l;
};
const has = (s: StyleSpecification, id: string) => s.layers.some((l) => l.id === id);
const idx = (s: StyleSpecification, id: string) => s.layers.findIndex((l) => l.id === id);
const srcLayer = (s: StyleSpecification, id: string) =>
  (layer(s, id) as unknown as { 'source-layer'?: string })['source-layer'];
const filterOf = (s: StyleSpecification, id: string) =>
  JSON.stringify((layer(s, id) as unknown as { filter?: unknown }).filter ?? null);
const paintOf = (s: StyleSpecification, id: string) =>
  (layer(s, id) as unknown as { paint?: Record<string, unknown> }).paint ?? {};
const layoutOf = (s: StyleSpecification, id: string) =>
  (layer(s, id) as unknown as { layout?: Record<string, unknown> }).layout ?? {};
const minzoomOf = (s: StyleSpecification, id: string) =>
  (layer(s, id) as unknown as { minzoom?: number }).minzoom;

/* ── WCAG ────────────────────────────────────────────────────────────────── */
const _lin = (c8: number) => { const c = c8 / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * _lin(r!) + 0.7152 * _lin(g!) + 0.0722 * _lin(b!);
};

/** Zoom-`interpolate` ifadesini belirli bir zoom'da (lineer) değerlendirir. */
function evalZoom(expr: unknown, zoom: number, feature: Record<string, unknown> = {}): number {
  const e = expr as unknown[];
  if (typeof expr === 'number') return expr;
  if (!Array.isArray(e)) throw new Error('ifade değil');
  if (e[0] === 'interpolate') {
    const stops: Array<[number, unknown]> = [];
    for (let i = 3; i < e.length; i += 2) stops.push([e[i] as number, e[i + 1]]);
    const first = stops[0]!, last = stops[stops.length - 1]!;
    if (zoom <= first[0]) return evalZoom(first[1], zoom, feature);
    if (zoom >= last[0]) return evalZoom(last[1], zoom, feature);
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1]!, b = stops[i]!;
      if (zoom <= b[0]) {
        const t = (zoom - a[0]) / (b[0] - a[0]);
        const va = evalZoom(a[1], zoom, feature), vb = evalZoom(b[1], zoom, feature);
        return va + (vb - va) * t;
      }
    }
  }
  if (e[0] === 'case') {
    // ['case', cond, val, ..., fallback] — yalnız ['==', ['get', k], v] biçimi
    for (let i = 1; i < e.length - 1; i += 2) {
      const c = e[i] as unknown[];
      if (Array.isArray(c) && c[0] === '==' && Array.isArray(c[1]) && (c[1] as unknown[])[0] === 'get') {
        const key = (c[1] as unknown[])[1] as string;
        if (feature[key] === c[2]) return evalZoom(e[i + 1], zoom, feature);
      }
    }
    return evalZoom(e[e.length - 1], zoom, feature);
  }
  throw new Error(`desteklenmeyen ifade: ${String(e[0])}`);
}
const widthAt = (s: StyleSpecification, id: string, z: number, f: Record<string, unknown> = {}) =>
  evalZoom(paintOf(s, id)['line-width'], z, f);

/* ═══ 1. TEK KARTOGRAFİ OTORİTESİ ═══════════════════════════════════════ */

describe('1 · tek kartografi otoritesi', () => {
  it('🔒 gündüz ve gece AYNI katman listesini üretir — ikinci bir stil yok', () => {
    expect(DAY.layers.map((l) => l.id)).toEqual(NIGHT.layers.map((l) => l.id));
  });

  it('🔒 her renk PALETTEN gelir — stilde başıboş hex YOK', () => {
    /* Beyaz kalkan metni, kalkan halosu ve saydam siyahlar bilinçli istisnadır
       (ikon üstü metin; palete ait değil). Onun dışında stilde geçen HER hex,
       ilgili paletin bir tokeni olmalı. */
    const IZINLI = new Set(['#ffffff']);
    for (const [ad, style, P] of [['gündüz', DAY, DAY_PALETTE], ['gece', NIGHT, NIGHT_PALETTE]] as const) {
      const paletHexes = new Set(
        Object.values(P).flatMap((v) => (Array.isArray(v) ? v : [v]))
          .filter((v): v is string => typeof v === 'string' && v.startsWith('#'))
          .map((v) => v.toLowerCase()),
      );
      const bulunan = JSON.stringify(style.layers).toLowerCase().match(/#[0-9a-f]{6}/g) ?? [];
      for (const h of new Set(bulunan)) {
        if (IZINLI.has(h) || paletHexes.has(h)) continue;
        throw new Error(`${ad} stilinde palet DIŞI renk: ${h}`);
      }
    }
  });

  it('🔒 stil MapLibre şemasına göre GEÇERLİ (kütük #552: geçersiz katman sessizce düşer)', () => {
    for (const s of [DAY, NIGHT]) {
      expect(validateStyleMin(s as never).map((e) => e.message)).toEqual([]);
    }
  });
});

/* ═══ 2. GERÇEK ŞEMA — OLMAYAN KAYNAK ADRESLENMEZ ═══════════════════════ */

describe('2 · ölçülmüş şema adresleri', () => {
  it('🔒 park/orman DOĞRU kaynaktan gelir (`landuse.class = park` OMT şemasında YOKTUR)', () => {
    /* Bu kilidin sebebi: eski `landuse-park` katmanı `landuse` kaynağında
       olmayan sınıfları arıyordu ve ekranda park HİÇ çizilmiyordu. */
    expect(srcLayer(DAY, 'landuse-park'), 'park katmanı `park` kaynağını okumalı').toBe('park');
    expect(srcLayer(DAY, 'landcover-wood')).toBe('landcover');
    expect(srcLayer(DAY, 'landcover-grass')).toBe('landcover');
    for (const id of ['landuse-residential', 'landuse-urban', 'landuse-green']) {
      expect(srcLayer(DAY, id), `${id} landuse okumalı`).toBe('landuse');
      const f = filterOf(DAY, id);
      expect(f, `${id} `).not.toContain('"meadow"');
    }
    // `landuse` katmanı ARTIK olmayan sınıfları aramaz:
    for (const id of ['landuse-residential', 'landuse-urban', 'landuse-green']) {
      expect(filterOf(DAY, id)).not.toContain('"grass"');
    }
  });

  it('🔒 ölçümde VAR olan ama hiç kullanılmayan katmanlar artık çiziliyor', () => {
    for (const id of ['landcover-wood', 'landcover-grass', 'landcover-farmland',
      'landuse-park', 'railway', 'aeroway', 'boundary', 'water-label',
      /* 2026-09-07 (MAPDATA-F4): `housenumber` üretim karosunda VARDI ama
         stilin tüketicisi YOKTU — veri stilde kayboluyordu. */
      'housenumber']) {
      expect(has(DAY, id), `${id} stile eklenmemiş`).toBe(true);
    }
    expect(srcLayer(DAY, 'housenumber')).toBe('housenumber');
    expect(srcLayer(DAY, 'railway')).toBe('transportation');
    expect(filterOf(DAY, 'railway')).toContain('rail');
    expect(srcLayer(DAY, 'water-label')).toBe('water_name');
  });

  it('🔒 yüzme havuzu deniz/göl ile AYNI katmanda çizilmez', () => {
    expect(filterOf(DAY, 'water-fill')).toContain('swimming_pool');
    expect(filterOf(DAY, 'water-fill').startsWith('["!="')).toBe(true);
    expect(minzoomOf(DAY, 'water-pool')).toBe(AREA_VISIBILITY['water-pool']);
  });
});

/* ═══ 3. ZOOM × ÖZELLİK GÖRÜNÜRLÜK MATRİSİ ═════════════════════════════ */

describe('3 · kartografik genelleştirme', () => {
  it('🔒 matris MONOTONİKTİR: üst sınıf yol her zaman alt sınıftan ÖNCE görünür', () => {
    const sira = ['motorway', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'path'] as const;
    for (let i = 1; i < sira.length; i++) {
      expect(ROAD_VISIBILITY[sira[i]!].minzoom,
        `${sira[i]} ${sira[i - 1]}'den önce görünüyor`)
        .toBeGreaterThan(ROAD_VISIBILITY[sira[i - 1]!].minzoom);
    }
  });

  it('🔒 stil minzoom değerleri matristen okunur — ikinci bir eşik tablosu YOK', () => {
    const eslesme: Array<[string, number]> = [
      ['road-motorway', ROAD_VISIBILITY.motorway.minzoom],
      ['road-primary', ROAD_VISIBILITY.primary.minzoom],
      ['road-secondary', ROAD_VISIBILITY.secondary.minzoom],
      ['road-tertiary', ROAD_VISIBILITY.tertiary.minzoom],
      ['road-minor', ROAD_VISIBILITY.minor.minzoom],
      ['road-service', ROAD_VISIBILITY.service.minzoom],
      ['road-path', ROAD_VISIBILITY.path.minzoom],
      ['building', AREA_VISIBILITY.building],
      ['building-3d', AREA_VISIBILITY['building-3d']],
      ['road-label', LABEL_VISIBILITY['road-label']],
      ['road-label-major', LABEL_VISIBILITY['road-label-major']],
      ['place-town', LABEL_VISIBILITY['place-town']],
      ['place-village', LABEL_VISIBILITY['place-village']],
      ['place-suburb', LABEL_VISIBILITY['place-suburb']],
      ['place-city', LABEL_VISIBILITY['place-city']],
    ];
    for (const [id, z] of eslesme) {
      for (const s of [DAY, NIGHT]) expect(minzoomOf(s, id), `${id} minzoom`).toBe(z);
    }
  });

  it('🔒 YEREL AĞ düşük zoomda çizilmez (ölçüm: z12 karo başına 2.697 yol parçası)', () => {
    expect(ROAD_VISIBILITY.minor.minzoom).toBeGreaterThanOrEqual(13);
    expect(ROAD_VISIBILITY.service.minzoom).toBeGreaterThanOrEqual(15);
  });

  it('🔒 BİNALAR z14 öncesi çizilmez (ölçüm: z13 karo başına 0–1 poligon)', () => {
    expect(AREA_VISIBILITY.building).toBeGreaterThanOrEqual(14);
    expect(AREA_VISIBILITY['building-3d']).toBeGreaterThan(AREA_VISIBILITY.building);
  });

  it('🔒 3B bina `hide_3d` alanına saygı duyar (OMT alanı vardı, kullanılmıyordu)', () => {
    expect(filterOf(DAY, 'building-3d')).toContain('hide_3d');
  });

  /* ── 3B bina YÜKSELEREK GİRME rampası (2026-09-06) ────────────────────────
     Binalar `minzoom`'da TAM BOYDA tek karede beliriyordu (pop-in). Rampa
     `fill-extrusion-height`/`-base` üzerine kuruldu; OPAKLIĞA DOKUNULMADI —
     o alanın üç yazarı var (stil · declutter · 80 km/h hız mandalı) ve
     MapLibre'de data-constant'tır.
     ──────────────────────────────────────────────────────────────────────── */

  it('🔒 bina yüksekliği zoom rampasıdır ve rampa BAŞINDA sıfırdır (pop-in yok)', () => {
    for (const s of [DAY, NIGHT]) {
      const h = paintOf(s, 'building-3d')['fill-extrusion-height'] as unknown[];
      expect(Array.isArray(h), 'yükseklik düz ifade — rampa YOK').toBe(true);
      expect(h[0]).toBe('interpolate');
      expect(JSON.stringify(h[2])).toBe(JSON.stringify(['zoom']));
      // ilk durak: rampa başlangıcı → yükseklik 0
      expect(h[3]).toBe(BUILDING_3D_RISE.start);
      expect(h[4], 'rampa başında bina TAM BOYDA beliriyor — pop-in geri geldi').toBe(0);
      // son durak: gerçek veri alanı
      expect(h[5]).toBe(BUILDING_3D_RISE.end);
      expect(JSON.stringify(h[6])).toContain('render_height');
    }
  });

  it('🔒 `-base` AYNI rampayı kullanır — taban havada asılı KALMAZ', () => {
    for (const s of [DAY, NIGHT]) {
      const p = paintOf(s, 'building-3d');
      const h = p['fill-extrusion-height'] as unknown[];
      const b = p['fill-extrusion-base'] as unknown[];
      expect(Array.isArray(b)).toBe(true);
      // aynı zoom durakları → her zoomda aynı `t` → height >= base korunur
      expect(b[3]).toBe(h[3]);
      expect(b[5]).toBe(h[5]);
      expect(b[4], 'taban rampa başında sıfır değil').toBe(0);
      expect(JSON.stringify(b[6])).toContain('render_min_height');
    }
  });

  it('🔒 rampa eşiği katmanın KENDİ minzoom değerinden gelir — ikinci eşik tablosu YOK', () => {
    expect(BUILDING_3D_RISE.start).toBe(AREA_VISIBILITY['building-3d']);
    expect(BUILDING_3D_RISE.end).toBeGreaterThan(BUILDING_3D_RISE.start);
    /* Rampa ŞEHİR İÇİ sürüş bandının ALTINDA bitmeli: `cameraEngine`
       ZOOM_AT_60 = 16,7 · ZOOM_AT_30 = 17,5. Rampa bu bandın içine taşarsa
       binalar sürüş sırasında hıza göre boy değiştirirdi (dikkat dağıtıcı). */
    expect(BUILDING_3D_RISE.end).toBeLessThanOrEqual(16.7);
  });

  it('🔒 OPAKLIK hâlâ SABİT SAYI — declutter ve hız mandalı otoritesi kırılmadı', () => {
    /* `fill-extrusion-opacity` MapLibre'de data-constant'tır ve runtime'da
       `mapDeclutterModel` profilleri ile `MapLayerManager`'ın 80 km/h mandalı
       tarafından YAZILIR. Oraya bir zoom ifadesi konulursa runtime onu sabit
       sayıyla ezer → stil ile ekran ayrışır (bu dosyada daha önce üç kez
       görülen "iki yazar, tek alan" kusuru). */
    for (const s of [DAY, NIGHT]) {
      const o = paintOf(s, 'building-3d')['fill-extrusion-opacity'];
      expect(typeof o, 'bina opaklığı ifadeye çevrilmiş — runtime yazarları onu ezecek').toBe('number');
    }
    expect(paintOf(DAY, 'building-3d')['fill-extrusion-opacity']).toBe(DAY_PALETTE.bldg3dOpacity);
    expect(paintOf(NIGHT, 'building-3d')['fill-extrusion-opacity']).toBe(NIGHT_PALETTE.bldg3dOpacity);
  });
});

/* ═══ 4. YOL HİYERARŞİSİ ═══════════════════════════════════════════════ */

describe('4 · yol hiyerarşisi', () => {
  const SINIFLAR = ['road-motorway', 'road-primary', 'road-secondary', 'road-tertiary', 'road-minor'] as const;

  it('🔒 her yol sınıfının KENDİ katmanı var — tertiary artık secondary\'ye gizlenmiyor', () => {
    for (const id of SINIFLAR) expect(has(DAY, id), `${id} yok`).toBe(true);
    expect(filterOf(DAY, 'road-secondary')).not.toContain('tertiary');
    expect(filterOf(DAY, 'road-minor')).not.toContain('service');
  });

  it('🔒 GENİŞLİK merdiveni her sürüş zoom\'unda AYRIK ve monotoniktir', () => {
    /* GECE de ölçülür (2026-09-06 · saha: "gecede yerel sokaklar arterle aynı
       ağırlıkta"). Gece TON merdiveni dar bir banttadır — çünkü "yollar tam
       beyaz" kullanıcının cihaz kararıdır ve `routeNightContrast` ona kalibre
       edildi. Bu yüzden geri çekilme GENİŞLİKLE yapılır ve burada kilitlenir. */
    for (const [st, ad, minOran] of [[DAY, 'gündüz', 2.5], [NIGHT, 'gece', 3.5]] as const) {
      for (const z of [14, 16, 18]) {
        const w = SINIFLAR.map((id) => (minzoomOf(st, id)! <= z ? widthAt(st, id, z) : 0));
        for (let i = 1; i < w.length; i++) {
          expect(w[i - 1]!, `${ad} z${z}: ${SINIFLAR[i - 1]} ≤ ${SINIFLAR[i]}`).toBeGreaterThan(w[i]!);
        }
        expect(w[0]! / w[4]!, `${ad} z${z} otoyol/tali oranı`).toBeGreaterThanOrEqual(minOran);
      }
    }
    /* Gece yerel ağ GÜNDÜZDEN dar olmalı — geri çekilme gerçekten uygulanmış mı. */
    for (const z of [14, 16, 18]) {
      expect(widthAt(NIGHT, 'road-minor', z), `z${z}: gece tali yolu daralmamış`)
        .toBeLessThan(widthAt(DAY, 'road-minor', z));
      expect(widthAt(NIGHT, 'road-tertiary', z), `z${z}: gece üçüncül yolu daralmamış`)
        .toBeLessThan(widthAt(DAY, 'road-tertiary', z));
      /* Arterler DEĞİŞMEMELİ — geri çekilme yalnız YEREL ağa uygulanır. */
      expect(widthAt(NIGHT, 'road-motorway', z), `z${z}: otoyol gecede değişmiş`)
        .toBe(widthAt(DAY, 'road-motorway', z));
      expect(widthAt(NIGHT, 'road-secondary', z), `z${z}: ikincil yol gecede değişmiş`)
        .toBe(widthAt(DAY, 'road-secondary', z));
    }
  });

  it('🔒 RAMPA hiçbir zoomda ana gövde genişliğinde çizilmez', () => {
    expect(RAMP_WIDTH_FACTOR).toBeLessThanOrEqual(0.7);
    for (const id of ['road-motorway', 'road-primary', 'road-secondary', 'road-tertiary']) {
      for (const z of [12, 14, 17]) {
        const govde = widthAt(DAY, id, z);
        const rampa = widthAt(DAY, id, z, { ramp: 1 });
        expect(rampa, `${id} z${z}: rampa gövdeyle aynı`).toBeLessThan(govde);
        expect(rampa / govde).toBeCloseTo(RAMP_WIDTH_FACTOR, 1);
      }
    }
  });

  it('🔒 KASA gövdeden GENİŞ ve KOYU — ince yolu görünür kılan kasadır', () => {
    const ciftler: Array<[string, string]> = [
      ['road-motorway', 'road-motorway-casing'],
      ['road-primary', 'road-primary-casing'],
      ['road-secondary', 'road-secondary-casing'],
      ['road-minor', 'road-minor-casing'],
    ];
    for (const s of [DAY, NIGHT]) {
      for (const [govde, kasa] of ciftler) {
        const z = Math.max(minzoomOf(s, kasa)!, minzoomOf(s, govde)!) + 2;
        expect(widthAt(s, kasa, z), `${kasa} z${z} gövdeden dar`).toBeGreaterThan(widthAt(s, govde, z));
        expect(lum(paintOf(s, kasa)['line-color'] as string),
          `${kasa} gövdeden koyu olmalı`)
          .toBeLessThan(lum(paintOf(s, govde)['line-color'] as string));
      }
    }
  });

  it('🔒 ÇİZİM SIRASI küçükten büyüğe — tali sokak otoyolun ÜSTÜNE binmez', () => {
    const sira = ['road-path', 'road-service', 'road-minor', 'road-tertiary',
      'road-secondary', 'road-primary', 'road-motorway'];
    for (const s of [DAY, NIGHT]) {
      for (let i = 1; i < sira.length; i++) {
        expect(idx(s, sira[i]!), `${sira[i]} ${sira[i - 1]}'den önce çiziliyor`)
          .toBeGreaterThan(idx(s, sira[i - 1]!));
      }
    }
  });

  it('🔒 demiryolu yol ailesinden AYRI okunur (kesikli, yol renginde değil)', () => {
    for (const s of [DAY, NIGHT]) {
      expect(Array.isArray(paintOf(s, 'railway')['line-dasharray'])).toBe(true);
      const rw = paintOf(s, 'railway')['line-color'];
      for (const id of ['road-minor', 'road-secondary', 'road-primary', 'road-motorway']) {
        expect(rw, 'demiryolu bir yol rengini kopyalıyor').not.toBe(paintOf(s, id)['line-color']);
      }
    }
  });
});

/* ═══ 5. ETİKET MOTORU ═════════════════════════════════════════════════ */

  it('🔒 tertiary KENDİ tonunu ve KENDİ kasasını taşır — secondary ile eşitlenemez', () => {
    /* SAHA (2026-09-06): *"çok fazla yol aynı görsel ağırlıkta"*.
       ÖLÇÜM (Tarsus z12–14, OpenFreeMap planet, `@mapbox/vector-tile`):
         tertiary **303** parça · secondary **206** · minor **49**
       Yani EN YOĞUN sınıf, en görünür olması gereken sınıfla aynı kasayı
       (`road-secondary-casing` filtresi `secondary|tertiary` idi) ve aynı gövde
       tonunu (`P.secondary`) paylaşıyordu → 5 sınıf, 2 görsel kademe. */
    for (const st of [DAY, NIGHT]) {
      const secCas = layer(st, 'road-secondary-casing');
      expect(JSON.stringify(secCas.filter), 'secondary kasasi HALA tertiary sinifini kapsiyor')
        .not.toContain('tertiary');
      expect(layer(st, 'road-tertiary-casing'), 'tertiary kendi kasasını kaybetmiş').toBeTruthy();
      const c = (id: string, prop: string) => String((paintOf(st, id) as Record<string, unknown>)[prop]);
      expect(c('road-tertiary-casing', 'line-color'), 'tertiary kasası secondary ile AYNI ton')
        .not.toBe(c('road-secondary-casing', 'line-color'));
      expect(c('road-tertiary', 'line-color'), 'tertiary gövdesi secondary ile AYNI ton')
        .not.toBe(c('road-secondary', 'line-color'));
      expect(c('road-tertiary', 'line-color'), 'tertiary gövdesi minor ile AYNI ton')
        .not.toBe(c('road-minor', 'line-color'));
    }
  });

describe('5 · etiket hiyerarşisi ve yoğunluk bütçesi', () => {
  it('🔒 YOL ETİKETİ iki katmana ayrıldı: ana yol ile yerel sokak aynı ağırlıkta değil', () => {
    expect(has(DAY, 'road-label-major')).toBe(true);
    expect(filterOf(DAY, 'road-label')).toContain('minor');
    expect(filterOf(DAY, 'road-label')).not.toContain('motorway');
    expect(filterOf(DAY, 'road-label-major')).toContain('motorway');
    expect(filterOf(DAY, 'road-label-major')).not.toContain('"minor"');
    expect(LABEL_VISIBILITY['road-label']).toBeGreaterThan(LABEL_VISIBILITY['road-label-major']);
    // Ana yol adı her zoomda yerel sokaktan BÜYÜK:
    for (const z of [15, 16, 17]) {
      expect(evalZoom(layoutOf(DAY, 'road-label-major')['text-size'], z))
        .toBeGreaterThan(evalZoom(layoutOf(DAY, 'road-label')['text-size'], z));
    }
  });

  it('🔒 YEREL SOKAK ADI BÜTÇESİ: geç başlar ve seyrek tekrarlar', () => {
    /* ÖLÇÜM (Tarsus z14 karosu): `transportation_name.minor` **101** parça —
       motorway 32 · trunk 28 · secondary 22 · tertiary 14. Yani yerel sokak adı
       diğer TÜM sınıfların toplamından fazla. Bütçe SIRAYLA değil (sıra
       `pauseable_placement` sözleşmesine bağlı), `minzoom` + `symbol-spacing`
       ile kısılır. */
    for (const st of [DAY, NIGHT]) {
      const lz = minzoomOf(st, 'road-label'); const lay = layoutOf(st, 'road-label') as Record<string, unknown>;
      expect(lz ?? 0, 'yerel sokak adi z16 oncesinde ciziliyor').toBeGreaterThanOrEqual(16);
      expect(Number(lay['symbol-spacing'] ?? 0), 'aynı sokak adı yol boyunca çok sık tekrarlıyor')
        .toBeGreaterThanOrEqual(420);
    }
  });

  it('🔒 FERİBOT HATTI yol adı gibi basılmaz (denizin üstü yazı çöplüğüydü)', () => {
    for (const id of ['road-label', 'road-label-major', 'road-shield']) {
      expect(filterOf(DAY, id), `${id} feribotu dışlamıyor`).not.toContain('ferry');
      // sınıf süzgeci VAR olmalı — süzgeçsiz katman feribotu da çizerdi
      expect(filterOf(DAY, id)).toContain('class');
    }
  });

  it('🔒 KAVŞAK ADI (`subclass = junction`) sokak adı gibi basılmaz', () => {
    /* Ölçüm: motorway/trunk/primary `transportation_name` kayıtlarının
       %61–84\'ü junction idi. */
    for (const id of ['road-label', 'road-label-major', 'road-shield']) {
      expect(filterOf(DAY, id), `${id} junction dışlamıyor`).toContain('junction');
    }
  });

  it('🔒 YER adları sınıfa ve RANK\'a göre süzülür (ölçüm: z10\'da karo başına 389 kayıt)', () => {
    for (const id of ['place-town', 'place-village', 'place-suburb']) {
      expect(filterOf(DAY, id), `${id} rank süzgeci taşımıyor`).toContain('rank');
    }
    expect(filterOf(DAY, 'place-town')).toContain('town');
    expect(filterOf(DAY, 'place-town')).not.toContain('village');
    expect(LABEL_VISIBILITY['place-village']).toBeGreaterThan(LABEL_VISIBILITY['place-town']);
    expect(LABEL_VISIBILITY['place-suburb']).toBeGreaterThan(LABEL_VISIBILITY['place-village']);
  });

  it('🔒 ŞEHİR adı sokak seviyesinde ekranda ASILI KALMAZ (üst zoom sınırı var)', () => {
    const mz = (layer(DAY, 'place-city') as unknown as { maxzoom?: number }).maxzoom;
    expect(mz).toBe(LABEL_VISIBILITY_MAX['place-city']);
    expect(mz!).toBeLessThan(17);
  });

  it('🔒 ÇAKIŞMA ÖNCELİĞİ katman sırasıyla kurulur (MapLibre listeyi SONDAN tarar)', () => {
    /* `pauseable_placement.ts`: `_currentPlacementIndex = order.length - 1` →
       listede EN SONDAKİ sembol katmanı yerleşimi KAZANIR. Bu yüzden öncelik
       sırası listede TERS durmalı: en düşük öncelikli başta. */
    const dusuktenYuksege = ['housenumber', 'place-suburb', 'road-label', 'place-village',
      'water-label', 'road-label-major', 'place-town', 'road-shield', 'place-city'];
    for (const s of [DAY, NIGHT]) {
      for (let i = 1; i < dusuktenYuksege.length; i++) {
        expect(idx(s, dusuktenYuksege[i]!),
          `${dusuktenYuksege[i]} önceliği ${dusuktenYuksege[i - 1]}'in altında kalmış`)
          .toBeGreaterThan(idx(s, dusuktenYuksege[i - 1]!));
      }
    }
  });

  it('🔒 çakışma AÇIK bırakılmaz — hiçbir etiket `allow-overlap` ile zorlanmaz', () => {
    for (const s of [DAY, NIGHT]) {
      for (const l of s.layers) {
        if (l.type !== 'symbol') continue;
        const lay = (l as unknown as { layout?: Record<string, unknown> }).layout ?? {};
        expect(lay['text-allow-overlap'] ?? false, `${l.id} metni çakışmayı eziyor`).toBe(false);
        expect(lay['icon-allow-overlap'] ?? false, `${l.id} ikonu çakışmayı eziyor`).toBe(false);
      }
    }
  });

  it('🔒 sembol katmanları BELİRLENİMCİ sıralanır (rank/sınıf → `symbol-sort-key`)', () => {
    for (const id of ['place-city', 'place-town', 'place-village', 'place-suburb',
      'road-label-major', 'road-shield']) {
      expect(layoutOf(DAY, id)['symbol-sort-key'], `${id} sort-key taşımıyor`).toBeDefined();
    }
  });

  it('🔒 KAPI NUMARASI mevcut veriyi çizer, UYDURMAZ ve sokak adını ELEMEZ', () => {
    /* ÖLÇÜM (`field-runs/map-data-coverage-20260907`): `housenumber` kaynak
       katmanı üretim karosunda vardı (merkez z14: 7 kayıt) ama hiçbir stil
       katmanı onu tüketmiyordu. Bu kilit üç şeyi birden korur:
         1. tüketici VAR ve DOĞRU alanı okur (türetme/interpolasyon YOK),
         2. seyir zoom'unda çizilmez (yerel sokak adından SONRA başlar),
         3. çakışmada sokak adının ALTINDA kalır (listede ondan ÖNCE). */
    for (const st of [DAY, NIGHT]) {
      const lay = layoutOf(st, 'housenumber') as Record<string, unknown>;
      expect(JSON.stringify(lay['text-field'])).toBe('["get","housenumber"]');
      /* MAKUL OLMAYAN DEĞER ÇİZİLMEZ: ölçüldü (2026-09-07) — dokuz üretim
         karosundaki 32 `housenumber` kaydının biri upstream'de kapı numarası
         alanına yazılmış bir TELEFON NUMARASIDIR (`03246245701`). Filtre
         uzunluk tabanlıdır; İÇERİK kalıbına bakmaz çünkü `22/D` gibi harfli
         numaralar Türkçe adreste meşrudur. */
      expect(JSON.stringify(filterOf(st, 'housenumber')))
        .toContain('length');
      expect(filterOf(st, 'housenumber')).toContain('housenumber');
      expect(minzoomOf(st, 'housenumber')).toBe(LABEL_VISIBILITY.housenumber);
      expect(LABEL_VISIBILITY.housenumber).toBeGreaterThan(LABEL_VISIBILITY['road-label']);
      expect(idx(st, 'housenumber')).toBeLessThan(idx(st, 'road-label'));
      /* Kapı numarası her zoomda yerel sokak adından KÜÇÜK — hiyerarşi. */
      for (const z of [17, 18, 19]) {
        expect(evalZoom(lay['text-size'], z))
          .toBeLessThan(evalZoom(layoutOf(st, 'road-label')['text-size'], z));
      }
      /* Opaklık DÜZ SAYI: declutter otoritesi bu alanı yazar. */
      const paint = (st.layers.find((l) => l.id === 'housenumber') as unknown as
        { paint?: Record<string, unknown> }).paint ?? {};
      expect(typeof paint['text-opacity']).toBe('number');
    }
  });

  it('🔒 KAPI NUMARASI mini haritada çizilmez, rehberlikte SÖNDÜRÜLMEZ', () => {
    for (const night of [false, true]) {
      const mini = resolveDeclutter({ surface: 'MINI', night, navActive: false, tier: 0 }, NAV_SUPPRESS_TIERS[0]!);
      const navFull = resolveDeclutter({ surface: 'FULL', night, navActive: true, tier: 0 }, NAV_SUPPRESS_TIERS[0]!);
      const get = (d: { entries: readonly (readonly [string, string, number])[] }, id: string) =>
        d.entries.find(([i]) => i === id)?.[2] ?? -1;
      expect(get(mini, 'housenumber')).toBe(0);
      expect(get(navFull, 'housenumber')).toBeGreaterThan(0);
      /* Varışta kapı numarası sokak adını gölgede bırakmaz. */
      expect(get(navFull, 'housenumber')).toBeLessThanOrEqual(get(navFull, 'road-label-major'));
    }
  });

  it('🔒 yerel sokak etiketi `text-opacity`ye ZOOM İFADESİ koymaz (iki otorite yasağı)', () => {
    /* `road-label.text-opacity` `NAV_SUPPRESS_TIERS` + `MapLayerManager`
       tarafından DÜZ SAYIYLA yazılır. Stile zoom ifadesi konsaydı ilk yazımda
       kalıcı olarak silinirdi — genelleştirme `minzoom`/`text-size` ile taşınır. */
    const suppressed = new Set(NAV_SUPPRESS_TIERS[0]!.map(([id, prop]) => `${id}|${prop}`));
    for (const s of [DAY, NIGHT]) {
      for (const l of s.layers) {
        const paint = (l as unknown as { paint?: Record<string, unknown> }).paint ?? {};
        for (const prop of ['text-opacity', 'line-opacity']) {
          if (!suppressed.has(`${l.id}|${prop}`)) continue;
          expect(typeof paint[prop] === 'undefined' || typeof paint[prop] === 'number',
            `${l.id}.${prop} bastırma otoritesine ait; stilde ifade OLAMAZ`).toBe(true);
        }
      }
    }
  });
});

/* ═══ 6. POI ═══════════════════════════════════════════════════════════ */

describe('6 · POI bütçesi', () => {
  it('🔒 POI `rank` ile sınırlandırılır ve sürüş dışı sınıflar çizilmez', () => {
    for (const id of ['poi-gas', 'poi-hospital', 'poi-police', 'poi-parking']) {
      expect(filterOf(DAY, id), `${id} rank süzgeci taşımıyor`).toContain('rank');
      expect(minzoomOf(DAY, id), `${id} çok erken açılıyor`).toBeGreaterThanOrEqual(14);
    }
    // Ölçümün en kalabalık POI sınıfı (`pharmacy`, 151/karo) ARTIK çizilmiyor:
    expect(JSON.stringify(DAY.layers)).not.toContain('pharmacy');
  });

  it('🔒 POI renkleri PALETTEN gelir ve doygun uyarı renkleri DEĞİLDİR', () => {
    const eski = ['#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#fbbf24', '#60a5fa', '#f87171', '#a78bfa'];
    for (const s of [DAY, NIGHT]) {
      const json = JSON.stringify(s.layers).toLowerCase();
      for (const c of eski) expect(json, `eski doygun POI rengi ${c} hâlâ stilde`).not.toContain(c);
    }
  });

  it('🔒 POI geri çekilmesi DOĞRU özelliğe yazılır (daire katmanı `circle-opacity`)', () => {
    /* Eski tabloda `icon-opacity` yazıyordu; POI katmanları `circle` tipinde
       olduğu için MapLibre çağrıyı REDDEDİYOR, `try/catch` yutuyordu — yani
       POI bastırması hiç uygulanmamıştı. */
    const d = resolveDeclutter({ surface: 'FULL', night: false, navActive: true, tier: 0 },
      NAV_SUPPRESS_TIERS[0]!);
    for (const [id, prop] of d.noiseEntries) {
      if (!id.startsWith('poi-')) continue;
      expect(layer(DAY, id).type, `${id} artık daire değil`).toBe('circle');
      expect(prop, `${id} yanlış opaklık özelliği`).toBe('circle-opacity');
    }
  });
});

/* ═══ 7. YÜZEY BÜTÇELERİ (FULL vs MINI) ════════════════════════════════ */

describe('7 · yüzey bilgi bütçesi', () => {
  it('🔒 TÜM kartografi katmanları bir otoriteye AİT — sahipsiz katman yok', () => {
    const yol = new Set(NAV_SUPPRESS_TIERS[0]!.map(([id]) => id));
    const gurultu = new Set(DECLUTTER_OWNED_LAYERS);
    /* Kasıtlı olarak sahipsiz bırakılanlar: zemin, su gövdesi, tünel/köprü
       topolojisi, kalkan zemini ve otoyol ailesi (hiçbir kademede
       bastırılmaz — otoyol bağlamı korunur). */
    const SAHIPSIZ_MESRU = new Set([
      'background', 'water-fill', 'water-pool',
      'road-tunnel', 'road-tunnel-casing', 'road-bridge', 'road-bridge-casing',
      'road-motorway', 'road-motorway-casing', 'road-path',
    ]);
    for (const l of DAY.layers) {
      if (yol.has(l.id) || gurultu.has(l.id) || SAHIPSIZ_MESRU.has(l.id)) continue;
      throw new Error(`${l.id} hiçbir gürültü/bastırma otoritesine ait değil`);
    }
  });

  it('🔒 iki otorite AYNI katmanı yazmaz', () => {
    const yol = new Set(NAV_SUPPRESS_TIERS[0]!.map(([id]) => id));
    for (const id of DECLUTTER_OWNED_LAYERS) expect(yol.has(id), `${id} iki otoritede`).toBe(false);
  });

  it('🔒 MINI bütçesi FULL\'den DAR — hiçbir katman mini\'de daha görünür olamaz', () => {
    for (const night of [false, true]) {
      const full = resolveDeclutter({ surface: 'FULL', night, navActive: false, tier: 0 }, NAV_SUPPRESS_TIERS[0]!);
      const mini = resolveDeclutter({ surface: 'MINI', night, navActive: false, tier: 0 }, NAV_SUPPRESS_TIERS[0]!);
      const fm = new Map(full.entries.map(([id, p, v]) => [`${id}|${p}`, v]));
      for (const [id, p, v] of mini.entries) {
        expect(v, `${id}.${p} mini'de FULL'den yüksek`).toBeLessThanOrEqual(fm.get(`${id}|${p}`)!);
      }
    }
  });

  it('🔒 MINI\'de bile etiket HİYERARŞİSİ korunur: ana yol adı > yerel sokak adı', () => {
    for (const night of [false, true]) {
      const mini = resolveDeclutter({ surface: 'MINI', night, navActive: true, tier: 0 }, NAV_SUPPRESS_TIERS[0]!);
      const get = (id: string) => mini.entries.find(([i]) => i === id)?.[2] ?? 0;
      expect(get('road-label-major'), 'mini\'de yerel sokak ana yoldan öne geçmiş')
        .toBeGreaterThan(get('road-label'));
    }
  });

  it('🔒 yeni kartografi katmanları gürültü sözleşmesine EKLENDİ (sessiz kalmadı)', () => {
    for (const id of ['landcover-wood', 'landcover-grass', 'landcover-farmland',
      'landuse-urban', 'landuse-green', 'railway', 'aeroway', 'boundary',
      'water-label', 'place-village', 'place-suburb', 'road-label-major', 'waterway-stream',
      'housenumber']) {
      expect(DECLUTTER_OWNED_LAYERS, `${id} gürültü tablosunda yok`).toContain(id);
    }
  });
});

/* ═══ 8. SEMANTİK RENK — DEKORATİF TEMA YASAĞI ═════════════════════════ */

describe('8 · semantik palet (dekoratif tema değil)', () => {
  it('🔒 su MAVİ, doğa YEŞİL ekseninde — her iki temada', () => {
    for (const [ad, P] of [['gündüz', DAY_PALETTE], ['gece', NIGHT_PALETTE]] as const) {
      const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as number[];
      const [wr, , wb] = rgb(P.water);
      expect(wb!, `${ad} su mavi değil`).toBeGreaterThan(wr!);
      for (const yesil of [P.park, P.forest] as const) {
        const [r, g, b] = rgb(yesil);
        expect(g!, `${ad} ${yesil} yeşil değil`).toBeGreaterThan(r!);
        expect(g!, `${ad} ${yesil} yeşil değil`).toBeGreaterThan(b!);
      }
    }
  });

  it('🔒 BRONZ/ALTIN YOL AİLESİ GERİ GELEMEZ (dekoratif tema yasağı)', () => {
    /* KİLİDİN GEÇMİŞİ — iki ayrı kullanıcı kararı, iki ayrı sonuç:
       · 2026-09-05 SABAH: yol ailesi "CarOS krem/altın kimliği" gerekçesiyle
         KOYU BRONZA taşındı (gündüz `#5e4a34`, gece altın `#f2c877`) →
         kullanıcı REDDETTİ. Yasak buradan gelir ve GEÇERLİDİR.
       · 2026-09-05 AKŞAM: kullanıcı gerçek cihazda SICAK KREM ZEMİN + BEYAZ
         YOL görünümünü açıkça SEÇTİ.
       Yani reddedilen şey "sıcaklık" değil, **doygun bronz/altın YOL
       GÖVDESİ**dir. Bu yüzden zemin üzerindeki eski ham sınır (`bg` r−b ≤ 10)
       KALDIRILDI — kullanıcı kararıyla çelişiyordu ve yanlış şeyi ölçüyordu.
       Yerine yolun doygunluğu, PARLAKLIĞA GÖRE sınırlandırılır: açık bir
       kırık-beyaz yolda r−b farkı doğal olarak küçüktür; koyulaştıkça doygun
       bir bronz olmadan bu farkı büyütmek mümkün değildir. */
    for (const [ad, P] of [['gündüz', DAY_PALETTE], ['gece', NIGHT_PALETTE]] as const) {
      for (const yol of [P.motorway, P.primary, P.secondary, P.minor] as const) {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(yol.slice(i, i + 2), 16)) as number[];
        const doygunluk = Math.max(r!, g!, b!) - Math.min(r!, g!, b!);
        expect(doygunluk, `${ad} yol rengi ${yol} doygun (bronz/altın) eksende`)
          .toBeLessThanOrEqual(20);
      }
      /* Reddedilen SOMUT değerler bir daha giremez — kilidin çıpası. */
      const json = JSON.stringify([P.motorway, P.primary, P.secondary, P.minor]).toLowerCase();
      for (const red of ['#5e4a34', '#78644a', '#8f7d5e', '#a99a7f',
        '#f2c877', '#d9ad6b', '#b89a6a', '#7f7461']) {
        expect(json, `${ad}: reddedilen bronz ton ${red} geri gelmiş`).not.toContain(red);
      }
    }
  });

  it('🔒 GÜNDÜZ ROL DAĞILIMI (cihaz kararı): yol en açık · zemin ortada · bina en koyu', () => {
    /* 2026-09-05 akşamı gerçek head unit kararı. Gece paleti zaten bu yöndeydi
       (açık yol / koyu zemin); gündüz de aynı okuma yönüne getirildi, böylece
       iki tema sürücüden İKİ AYRI alışkanlık istemiyor. */
    const P = DAY_PALETTE;
    for (const yol of [P.motorway, P.primary, P.secondary, P.minor] as const) {
      expect(lum(yol), `${yol} zeminden açık olmalı`).toBeGreaterThan(lum(P.bg));
      expect(lum(P.buildingFill), 'bina yoldan koyu olmalı').toBeLessThan(lum(yol));
    }
    expect(lum(P.buildingFill), 'bina zeminden koyu olmalı').toBeLessThan(lum(P.bg));
    // Gece de aynı yön:
    const N = NIGHT_PALETTE;
    for (const yol of [N.motorway, N.primary, N.secondary, N.minor] as const) {
      expect(lum(yol), 'gece yolu zeminden açık olmalı').toBeGreaterThan(lum(N.bg));
    }
  });

  it('🔒 SU zeminden ve YAPI ailesinden ayrışır; DOĞA yolla yarışmaz', () => {
    for (const P of [DAY_PALETTE, NIGHT_PALETTE]) {
      const cr = (a: string, b: string) => {
        const x = lum(a), y = lum(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      expect(cr(P.bg, P.water)).toBeGreaterThanOrEqual(1.2);
      expect(cr(P.water, P.buildingFill)).toBeGreaterThanOrEqual(1.2);
      expect(cr(P.park, P.forest), 'park ve orman ayırt edilemiyor').toBeGreaterThanOrEqual(1.1);
      expect(cr(P.residential, P.urban), 'konut ve sanayi ayırt edilemiyor').toBeGreaterThanOrEqual(1.05);
    }
  });
});

/* ═══ 9. ÜRETİM YÜZEYİ — HAM TELEMETRİ SIZMAZ ═════════════════════════ */

describe('9 · üretim yüzeyi', () => {
  it('🔒 ham koordinat üretim harita ekranında geliştirici kapısı ARDINDA', () => {
    const src = readSource('src/components/map/MapHudControls.tsx');
    const i = src.indexOf('latitude.toFixed');
    expect(i, 'ham lat/lon gösterimi bulunamadı — kilit hedefini kaybetti')
      .toBeGreaterThan(-1);
    const onceki = src.slice(Math.max(0, i - 400), i);
    expect(onceki, 'ham koordinat geliştirici kapısı olmadan çiziliyor')
      .toContain('DEVELOPER_FEATURES_ENABLED');
  });

  it('🔒 harita kontrolleri UYARI rengini kimlik olarak kullanmaz', () => {
    /* KAPAT düğmesi kırmızı dolgu/kenar/glow ile çiziliyordu; sürekli görünen
       bir kırmızı gerçek uyarıların kırmızısını değersizleştirir. */
    const src = readSource('src/components/map/MapHudControls.tsx');
    const kapat = src.slice(src.indexOf('aria-label="Haritayı kapat"'),
      src.indexOf('aria-label="Haritayı kapat"') + 1200);
    expect(kapat).not.toContain('rgba(239,68,68');
  });
});

/* ═══ YOL ETİKETİ — ÖNCELİK · KISALTMA · TEKRAR (Adım 3) ═══════════════════

   Bu bölüm etiketleri METİN EŞLEŞTİRMESİYLE değil, ifadeyi GERÇEKTEN
   DEĞERLENDİREREK kilitler — bir `text-field` ifadesi spec'e uysa bile
   yanlış çıktı üretebilir.
   ═══════════════════════════════════════════════════════════════════════ */

describe('yol etiketi motoru — öncelik · kısaltma · tekrar', () => {
  /** `text-field` ifadesini derleyip gerçek bir ad üzerinde çalıştırır. */
  const adUret = (s: StyleSpecification, layerId: string, name: string): string => {
    const field = layoutOf(s, layerId)['text-field'];
    const c = createExpression(field as never, {
      type: 'formatted', 'property-type': 'data-driven',
      expression: { interpolated: false, parameters: ['zoom', 'feature'] },
    } as never);
    expect(c.result, `${layerId} text-field derlenemedi`).toBe('success');
    const v = (c as { value: { evaluate: (g: unknown, f: unknown) => unknown } }).value;
    return String(v.evaluate({ zoom: 16 }, { properties: { name } }));
  };

  it('🔒 yol adında TÜR EKİ kısalır (ölçülen kazanç: %14–24)', () => {
    for (const s of [DAY, NIGHT]) {
      for (const id of ['road-label', 'road-label-major']) {
        expect(adUret(s, id, 'Kurbağalıdere Caddesi')).toBe('Kurbağalıdere Cd.');
        expect(adUret(s, id, 'Atatürk Bulvarı')).toBe('Atatürk Bul.');
        expect(adUret(s, id, 'Moda Sokağı')).toBe('Moda Sk.');
        expect(adUret(s, id, 'Galata Köprüsü')).toBe('Galata Köp.');
      }
    }
  });

  it('🔒 ÖZEL AD BOZULMAZ — tek kelimelik tür adı ve kısaltılmış ad korunur', () => {
    for (const id of ['road-label', 'road-label-major']) {
      // tek kelime: önünde boşluk yok → kesilmez
      expect(adUret(DAY, id, 'Caddesi')).toBe('Caddesi');
      // zaten kısaltılmış: iki kez kısaltılmaz
      expect(adUret(DAY, id, 'Kuşdili Cd.')).toBe('Kuşdili Cd.');
      // tür eki İÇERMEYEN özel ad aynen kalır
      expect(adUret(DAY, id, 'Bağdat')).toBe('Bağdat');
      expect(adUret(DAY, id, 'E-5')).toBe('E-5');
    }
  });

  it('🔒 kısaltma YALNIZ yol etiketlerinde — yer adlarına SIZMAZ', () => {
    /* `place-*` adları özeldir ("… Mahallesi" bir yerleşim adının parçası
       olabilir); kısaltma kapsamı yol tablolarıyla sınırlı tutuldu. */
    for (const id of ['place-town', 'place-village', 'place-suburb', 'place-city']) {
      const f = JSON.stringify(layoutOf(DAY, id)['text-field'] ?? null);
      expect(f, `${id} yol kısaltmasını kullanıyor — kapsam sızdı`).not.toContain('Caddesi');
    }
  });

  it('🔒 YEREL ağda da sınıf önceliği var (collision motoru eşit görmesin)', () => {
    for (const s of [DAY, NIGHT]) {
      const k = layoutOf(s, 'road-label')['symbol-sort-key'];
      expect(k, 'yerel yol etiketinde öncelik YOK — ekranı en düşük sınıf doldurur')
        .toBeDefined();
      const j = JSON.stringify(k);
      // küçük sayı = yüksek öncelik: tertiary < minor < service
      expect(j).toContain('tertiary');
      expect(j).toContain('service');
      const arr = k as unknown[];
      const idx = (cls: string) => arr.indexOf(cls);
      expect(Number(arr[idx('tertiary') + 1])).toBeLessThan(Number(arr[idx('minor') + 1]));
      expect(Number(arr[idx('minor') + 1])).toBeLessThan(Number(arr[idx('service') + 1]));
    }
  });

  it('🔒 ana yol önceliği yerel yoldan ÖNDE kalır (iki tablo tutarlı)', () => {
    const major = JSON.stringify(layoutOf(DAY, 'road-label-major')['symbol-sort-key']);
    expect(major).toContain('motorway');
    expect(major).toContain('trunk');
  });

  it('🔒 aynı arterin adı ekranda TEKRARLANMAZ (904 px görüntü alanı ölçüsü)', () => {
    /* Cihazda ölçülen görüntü alanı 904×406 CSS px. Tekrar aralığı ekran
       genişliğinin yarısından küçükse aynı ad 3+ kez basılır. */
    const EKRAN_GENISLIK = 904;
    for (const s of [DAY, NIGHT]) {
      const major = layoutOf(s, 'road-label-major')['symbol-spacing'] as number;
      const local = layoutOf(s, 'road-label')['symbol-spacing'] as number;
      expect(major, 'arter adı ekranda 3+ kez tekrarlanıyor').toBeGreaterThan(EKRAN_GENISLIK / 3);
      expect(local).toBeGreaterThan(EKRAN_GENISLIK / 3);
      // arter bağlamı sürüşte daha değerli → major yerelden SIK kalır
      expect(major).toBeLessThan(local);
    }
  });

  it('🔒 etiket OPAKLIĞI hâlâ SABİT SAYI — dört yazarlı alan korunuyor', () => {
    /* `road-label.text-opacity`ye YAZAN dört yol var: stil · mood/risk
       (`MapLayerManager`) · `NAV_SUPPRESS_TIERS` · `mapDeclutterModel`.
       Buraya bir ifade konulursa ilk runtime yazımında sessizce silinir —
       bu turun bütün genelleştirmesi bu yüzden LAYOUT tarafında yapıldı. */
    for (const s of [DAY, NIGHT]) {
      const o = paintOf(s, 'road-label')['text-opacity'];
      expect(typeof o, 'etiket opaklığı ifadeye çevrilmiş — runtime yazarları ezecek').toBe('number');
    }
  });
});

/* ═══ SKY / UFUK — MapLibre 4.7.1 KAPASİTESİ vs KAMERA BANDI ═══════════════

   §7 Adım 2 ("gök katmanı + ufuk bandı") devir belgesinde *"KOLAY"* diye
   işaretlenmişti. ÖLÇÜM bunun bu üründe UYGULANAMAZ olduğunu gösterdi ve bu
   bölüm o ölçümü KİLİTLER — aynı yanlış varsayım bir daha yapılmasın.

   MapLibre 4.7.1'de `sky` bir KATMAN TİPİ DEĞİL, root-level stil objesidir
   (layer tipleri: fill line symbol circle heatmap fill-extrusion raster
   hillshade background). Fragment shader'ı (bundle'dan okundu):

       void main() {
         float y = gl_FragCoord.y;
         if (y > u_horizon) { ...sky_color / horizon_color... }
       }                      ↑ ufkun ALTINA HİÇBİR PİKSEL YAZMAZ

   ve `u_horizon = (height/2 + transform.getHorizon()) * pixelRatio` ile
       getHorizon() = tan(90° − pitch) · cameraToCenterDistance · 0,85
       cameraToCenterDistance = 0,5 / tan(fov/2) · height = 1,5 · height
   (fov = 0,6435011087932844 rad → tan(fov/2) = 1/3 tam).

   Yani ufuk ancak `1,275 · cot(pitch) < 0,5` iken kadraja girer →
   **pitch > 68,59°** (yükseklikten ve dpr'den BAĞIMSIZ). Bu ürünün kamera
   tavanı 50° (`MapCore`), sürüş eğrisinin tepesi 47° (`PITCH_HIGHWAY`).
   Ölçülen sonuç: pitch 50'de `u_horizon` ≈ 1912 device-px, ekran 1218 px →
   **sky HİÇBİR PİKSELİ boyamaz; tam bir no-op'tur.**

   Görünür kılmanın TEK yolu pitch tavanını yükseltmekti; o tavan bir CİHAZ
   gözlemiyle konmuştur (`MapCore`: "50°+ üzerinde MapLibre siyah köşe
   oluşturur") ve kamera davranışını değiştirmek bu turun kapsamı DIŞIDIR.
   ═══════════════════════════════════════════════════════════════════════ */

describe('sky / ufuk — kapasite ve kamera bandı (2026-09-06 ölçümü)', () => {
  const FOV = 0.6435011087932844;
  const camDistPerHeight = 0.5 / Math.tan(FOV / 2);          // = 1,5
  const horizonPerHeight = (pitchDeg: number) =>
    Math.tan(Math.PI / 2 - (pitchDeg * Math.PI) / 180) * camDistPerHeight * 0.85;
  /** Ufkun kadraja girdiği pitch — `height/2 - getHorizon() > 0` çözümü. */
  const UFUK_ESIGI_DEG = (() => {
    let lo = 1, hi = 89;
    for (let i = 0; i < 80; i++) {
      const m = (lo + hi) / 2;
      if (0.5 - horizonPerHeight(m) > 0) hi = m; else lo = m;
    }
    return hi;
  })();

  const mapCoreSrc = readSource('src/platform/map/MapCore.ts');
  /** `MapCore`'daki MapLibre kurulum tavanı — TEK kaynak, kopyalanmaz. */
  const maxPitch = Number(/maxPitch:\s*(\d+(?:\.\d+)?)/.exec(mapCoreSrc)?.[1]);

  it('🔒 ufuk eşiği MapLibre formülünden hesaplanır (~68,6°)', () => {
    expect(Number.isFinite(UFUK_ESIGI_DEG)).toBe(true);
    expect(UFUK_ESIGI_DEG).toBeGreaterThan(68);
    expect(UFUK_ESIGI_DEG).toBeLessThan(69);
  });

  it('🔒 `MapCore` pitch tavanı okunabiliyor — kilit KÖR değil', () => {
    expect(Number.isFinite(maxPitch), 'maxPitch okunamadı — kilit artık hiçbir şeyi korumuyor')
      .toBe(true);
  });

  it('🔒 kamera bandı ufuk eşiğinin ALTINDA — sürüş eğrisi de tavanı aşmaz', () => {
    expect(maxPitch).toBeLessThan(UFUK_ESIGI_DEG);
    expect(CAMERA_CFG.PITCH_HIGHWAY).toBeLessThanOrEqual(maxPitch);
    expect(CAMERA_CFG.PITCH_ROAD).toBeLessThanOrEqual(CAMERA_CFG.PITCH_HIGHWAY);
  });

  it('🔒 pitch tavanı eşiğin altındayken stilde `sky` bildirimi OLMAZ (ölü stil yasağı)', () => {
    /* İKİ YÖNLÜ kilit:
       · Biri bu kamera bandında `sky` eklerse → hiçbir piksel boyamayan ÖLÜ
         stil olur, üstelik `background-color`un ÜÇ yazarına (stil ·
         `applyMapDayNight` · mood/risk) DÖRDÜNCÜ bir paralel yüzey ekler.
       · Biri pitch tavanını 68,6°'nin ÜSTÜNE çıkarırsa bu kilit düşer ve
         `sky` kararının YENİDEN değerlendirilmesi gerektiğini bildirir. */
    if (maxPitch < UFUK_ESIGI_DEG) {
      for (const s of [DAY, NIGHT]) {
        expect(
          (s as unknown as Record<string, unknown>).sky,
          'kamera bandında ufuk kadraja GİRMİYOR — `sky` burada no-op ölü stildir',
        ).toBeUndefined();
      }
    } else {
      throw new Error(
        `pitch tavanı (${maxPitch}°) ufuk eşiğini (${UFUK_ESIGI_DEG.toFixed(2)}°) AŞTI — ` +
        'ufuk artık kadrajda; `sky` kararı yeniden değerlendirilmeli (kütük #1312).',
      );
    }
  });

  it('🔒 zemin rengi TEK kaynaktan gelir — sky/ufuk için ikinci zemin otoritesi YOK', () => {
    expect(paintOf(DAY, 'background')['background-color']).toBeDefined();
    expect(paintOf(NIGHT, 'background')['background-color']).toBeDefined();
  });
});

function readSource(rel: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolve } = require('node:path') as typeof import('node:path');
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}
