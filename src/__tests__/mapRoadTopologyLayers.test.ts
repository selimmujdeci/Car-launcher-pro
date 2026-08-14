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
import {
  buildVectorStyle, blockOnlineVector, unblockOnlineVector, isOnlineVectorBlocked,
  DAY_PALETTE, NIGHT_PALETTE,
} from '../platform/mapStyleBuilders';
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
  /* ⚠️ KİLİT TAŞINDI, KALDIRILMADI (#552 · 2026-08-12).
   *
   * Bu iki kilit AO şiddetini STİLDEN okuyordu ve YEŞİLDİ — ama ürün o sırada
   * ZATEN kırıktı: `fill-extrusion-ambient-occlusion-*` Mapbox özelliğidir,
   * MapLibre 4 tanımaz ve `layers[6]`'yı reddediyordu (saha hata kütüğü).
   * Yani testler "stilde şu değer yazıyor" diyordu, ekranda ise hiçbir zaman
   * uygulanmamıştı — kilidin kendisi sahte güven üretiyordu.
   *
   * Tasarım kararı (gündüz kararması gecenin üstünde) GEÇERLİ ve korunuyor;
   * artık doğru kaynaktan — palet tokeninden — kilitleniyor. Uygulanmadığı
   * gerçeği ise ayrı ve AÇIK bir kilitle sabitlendi ki borç sessizleşmesin. */
  it('tasarım kararı KORUNUR: gündüz taban kararması gecenin ÜSTÜNDE', () => {
    expect(DAY_PALETTE.bldg3dAO).toBeGreaterThan(NIGHT_PALETTE.bldg3dAO);
  });

  it('AO tokeni her iki temada da makul aralıkta kalır', () => {
    for (const p of [DAY_PALETTE, NIGHT_PALETTE]) {
      expect(p.bldg3dAO).toBeGreaterThan(0.15);
      expect(p.bldg3dAO).toBeLessThanOrEqual(0.6);
    }
  });

  it('🔴 AÇIK BORÇ: AO token STİLE UYGULANMIYOR (MapLibre 4 desteklemiyor)', () => {
    /* Bu kilit AO desteklenip geri bağlandığında BİLİNÇLİ olarak düşecek ve
       o an güncellenecek — borcun kapandığının işareti budur. */
    for (const s of [DAY, NIGHT]) {
      const paint = (layer(s, 'building-3d') as unknown as
        { paint: Record<string, unknown> }).paint;
      expect(paint['fill-extrusion-ambient-occlusion-intensity']).toBeUndefined();
      // Hacim hissini taşıyan TEK desteklenen araç:
      expect(paint['fill-extrusion-vertical-gradient']).toBe(true);
    }
  });
});

describe('vektör karo kaynağı — sürüm damgası tuzağı', () => {
  /*
   * SAHA (#486): `VITE_VECTOR_TILE_URL` tanımsız ve yerel .pbf yokken ürün her
   * açılışta ham OSM raster'a düşüyordu; palet ve topoloji ÜRÜNDE ölü koddu.
   * Kaynak bağlanırken ikinci bir tuzak var: sağlayıcılar karo yoluna VERİ
   * SÜRÜMÜ damgası koyar (ör. /planet/20260802_080001_pt/{z}/{x}/{y}.pbf).
   * Damgalı şablon sabitlenirse, sağlayıcı veriyi tazelediği gün harita
   * SESSİZCE kırılır. Bu yüzden şablonsuz URL TileJSON ucu sayılmalı ve
   * MapLibre'ye `url` olarak verilmelidir.
   */
  function styleWithSource(url: string): StyleSpecification {
    // Yerel .pbf YOK → özel URL dalı çalışır.
    const sources = new Map<string, MapSource>([
      ['local', { ...LOCAL_PBF, isAvailable: false }],
    ]);
    const prev = import.meta.env['VITE_VECTOR_TILE_URL'];
    import.meta.env['VITE_VECTOR_TILE_URL'] = url;
    try {
      return buildVectorStyle(sources, () => {
        throw new Error('raster fallback — özel URL dalı çalışmadı');
      }, false);
    } finally {
      import.meta.env['VITE_VECTOR_TILE_URL'] = prev;
    }
  }

  it('şablonsuz URL TileJSON ucu sayılır — `url` olarak verilir', () => {
    const src = styleWithSource('https://tiles.openfreemap.org/planet')
      .sources['omv'] as unknown as { url?: string; tiles?: string[] };
    expect(src.url).toBe('https://tiles.openfreemap.org/planet');
    expect(src.tiles).toBeUndefined();
  });

  it('{z}/{x}/{y} içeren URL karo şablonu sayılır — `tiles` olarak verilir', () => {
    const tpl = 'https://example.org/t/{z}/{x}/{y}.pbf';
    const src = styleWithSource(tpl)
      .sources['omv'] as unknown as { url?: string; tiles?: string[] };
    expect(src.tiles).toEqual([tpl]);
    expect(src.url).toBeUndefined();
  });

  it('hiç kaynak yoksa raster fallback ÇAĞRILIR (sessiz boş harita YOK)', () => {
    const sources = new Map<string, MapSource>([
      ['local', { ...LOCAL_PBF, isAvailable: false }],
    ]);
    const prev = import.meta.env['VITE_VECTOR_TILE_URL'];
    import.meta.env['VITE_VECTOR_TILE_URL'] = '';
    let called = false;
    try {
      buildVectorStyle(sources, () => { called = true; return DAY; }, false);
    } finally {
      import.meta.env['VITE_VECTOR_TILE_URL'] = prev;
    }
    expect(called).toBe(true);
  });

  it('HİBRİT: çevrimdışında online vektör DENENMEZ, raster\'a düşülür', () => {
    /*
     * `VITE_VECTOR_TILE_URL` tanımlıyken ağ yoksa vektör karolar indirilemez ve
     * harita BOŞ kalır — kendiliğinden raster'a düşmez. Raster yolu
     * `caros-tile://` önbelleğiyle çevrimdışında da bir şey gösterebilir.
     */
    const sources = new Map<string, MapSource>([
      ['local', { ...LOCAL_PBF, isAvailable: false }],
    ]);
    const prevEnv = import.meta.env['VITE_VECTOR_TILE_URL'];
    const nav = globalThis.navigator as { onLine?: boolean } | undefined;
    const prevOnline = nav?.onLine;
    import.meta.env['VITE_VECTOR_TILE_URL'] = 'https://tiles.example.org/planet';
    let fellBack = false;
    try {
      if (nav) Object.defineProperty(nav, 'onLine', { value: false, configurable: true });
      buildVectorStyle(sources, () => { fellBack = true; return DAY; }, false);
    } finally {
      import.meta.env['VITE_VECTOR_TILE_URL'] = prevEnv;
      if (nav) Object.defineProperty(nav, 'onLine', { value: prevOnline, configurable: true });
    }
    expect(fellBack).toBe(true);
  });

  it('HİBRİT: karo hatası kapısı kapanınca online vektör bir daha denenmez', () => {
    /*
     * Bu kapı olmadan: raster'a düşen fallback yeniden `getMapStyle()` çağırır,
     * o yine vektör döner, karolar yine gelmez → SONSUZ DÖNGÜ.
     * "Bağlı ama internet yok" durumunu `navigator.onLine` yakalayamaz;
     * gerçek kanıt karo hatasıdır.
     */
    const sources = new Map<string, MapSource>([
      ['local', { ...LOCAL_PBF, isAvailable: false }],
    ]);
    const prevEnv = import.meta.env['VITE_VECTOR_TILE_URL'];
    import.meta.env['VITE_VECTOR_TILE_URL'] = 'https://tiles.example.org/planet';
    try {
      unblockOnlineVector();
      expect(isOnlineVectorBlocked()).toBe(false);
      // Kapı açıkken vektör seçilir.
      const okStyle = buildVectorStyle(sources, () => DAY, false);
      expect((okStyle.sources['omv'] as unknown as { url?: string }).url).toBeTruthy();

      blockOnlineVector();
      expect(isOnlineVectorBlocked()).toBe(true);
      let fellBack = false;
      buildVectorStyle(sources, () => { fellBack = true; return DAY; }, false);
      expect(fellBack).toBe(true);
    } finally {
      unblockOnlineVector();
      import.meta.env['VITE_VECTOR_TILE_URL'] = prevEnv;
    }
  });

  it('YEREL .pbf ağdan BAĞIMSIZDIR — çevrimdışında da vektör kalır', () => {
    // Offline-first sözleşmesi: yerel karo varken ağ durumu hiç sorulmaz.
    const nav = globalThis.navigator as { onLine?: boolean } | undefined;
    const prevOnline = nav?.onLine;
    try {
      if (nav) Object.defineProperty(nav, 'onLine', { value: false, configurable: true });
      blockOnlineVector();                       // online kapısı kapalı olsa BİLE
      const style = buildVectorStyle(
        new Map([['local', LOCAL_PBF]]),
        () => { throw new Error('yerel .pbf varken raster\'a DÜŞÜLMEMELİ'); },
        false,
      );
      const src = style.sources['omv'] as unknown as { tiles?: string[] };
      expect(src.tiles?.[0]).toContain('smart-tile://');
    } finally {
      unblockOnlineVector();
      if (nav) Object.defineProperty(nav, 'onLine', { value: prevOnline, configurable: true });
    }
  });

  it('ODbL atıfı her hâlde taşınır', () => {
    const src = DAY.sources['omv'] as unknown as { attribution?: string };
    expect(src.attribution).toContain('OpenStreetMap');
    expect(src.attribution).toContain('OpenMapTiles');
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

/* ── STİL GEÇERLİLİĞİ (#552 · 2026-08-12) ────────────────────────────────────
 * SAHA ARIZASI: gerçek cihaz hata kütüğünde stil kurulurken BEŞ ayrı hata:
 *   layers[6].paint.fill-extrusion-ambient-occlusion-intensity: unknown property
 *   layers[6].paint.fill-extrusion-ambient-occlusion-radius:    unknown property
 *   layers[7|8|16|17].paint.line-width: Only one zoom-based "step" or
 *     "interpolate" subexpression may be used in an expression
 *   layers[23].layout.icon-image: 'undefined' value invalid. Use null instead.
 *
 * Üçü de SESSİZDİ: katmanlar düşüyor ama uygulama çalışmaya devam ediyordu.
 * Tünel/köprü gövdeleri 1 px hatta iniyor, yol numarası kalkanları HİÇ
 * çizilmiyor, gündüz binalar düz kalıyordu.
 *
 * Bu blok stili MapLibre'nin KENDİ doğrulayıcısına verir. Yapısal regex
 * kilitleri yerine gerçek doğrulama kullanılır ki gelecekte DESTEKLENMEYEN
 * BAŞKA bir özellik eklendiğinde de aynı kilit düşsün. */
describe('#552 · stil MapLibre doğrulayıcısından TEMİZ geçer', () => {
  const validate = async () => {
    const { validateStyleMin } = await import('@maplibre/maplibre-gl-style-spec');
    return validateStyleMin;
  };

  for (const [ad, style] of [['gündüz', DAY], ['gece', NIGHT]] as const) {
    it(`🔒 ${ad} stilinde SIFIR doğrulama hatası`, async () => {
      const validateStyleMin = await validate();
      const errors = validateStyleMin(style as unknown as StyleSpecification);
      const msgs = errors.map((e) => `${e.message}`);
      expect(msgs, `stil hataları:\n${msgs.join('\n')}`).toEqual([]);
    });
  }

  it('🔒 KONTROL: doğrulayıcı üç saha hatasını GERÇEKTEN yakalıyor', async () => {
    /* "Sıfır hata" ancak doğrulayıcının hata bulabildiği kanıtlanırsa anlamlı.
       Aşağıdaki üç kalıp sahada ölçülen üç hatanın ta kendisidir ve
       doğrulayıcı bunlara SAHADAKİ MESAJIN AYNISINI döndürür. */
    const validateStyleMin = await validate();
    const base = {
      version: 8 as const, name: 't',
      sources: { omv: { type: 'vector' as const, tiles: ['http://x/{z}/{x}/{y}.pbf'] } },
    };
    const cases: ReadonlyArray<readonly [string, unknown]> = [
      ['Only one zoom-based', { ...base, layers: [{
        id: 'l', type: 'line', source: 'omv', 'source-layer': 't',
        paint: { 'line-width': ['case', ['==', ['get', 'class'], 'motorway'],
          ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 12],
          ['interpolate', ['linear'], ['zoom'], 8, 1, 14, 5]] } }] }],
      ['unknown property', { ...base, layers: [{
        id: 'l', type: 'fill-extrusion', source: 'omv', 'source-layer': 'b',
        paint: { 'fill-extrusion-ambient-occlusion-intensity': 0.4 } }] }],
      ["'undefined' value invalid", { ...base, layers: [{
        id: 'l', type: 'symbol', source: 'omv', 'source-layer': 'x',
        layout: { 'icon-image': undefined } }] }],
    ];
    for (const [needle, style] of cases) {
      const msgs = validateStyleMin(style as unknown as StyleSpecification)
        .map((e) => e.message).join(' | ');
      expect(msgs, `doğrulayıcı bu kusuru artık yakalamıyor: ${needle}`).toContain(needle);
    }
  });

  it('🔒 tünel/köprü line-width TEK zoom ifadesi kullanır (interpolate EN DIŞTA)', () => {
    /* Kök buydu: `case` dışta + her dalda ayrı `interpolate` = 3 zoom ifadesi.
       Doğrulayıcı bunu yakalar, ama kök kalıbı ayrıca sabitliyoruz ki düzeltme
       "hatayı sustur" diye başka yönden geri gelmesin. */
    for (const id of ['road-tunnel-casing', 'road-tunnel', 'road-bridge-casing', 'road-bridge']) {
      const layer = DAY.layers[idx(DAY, id)] as LayerSpecification & {
        paint?: { 'line-width'?: unknown };
      };
      const w = layer.paint?.['line-width'];
      expect(Array.isArray(w), `${id}: line-width ifade değil`).toBe(true);
      expect((w as unknown[])[0], `${id}: en dış ifade interpolate olmalı`).toBe('interpolate');
      expect(JSON.stringify(w).match(/"interpolate"/g)?.length, `${id}: birden fazla interpolate`).toBe(1);
    }
  });

  it('🔒 kalkan icon-image TANIMLI (döngüsel import undefined bırakmaz)', () => {
    /* `mapStyleBuilders → _mapState → mapStyleBuilders` döngüsü paleti
       `shieldImage: undefined` ile donduruyordu. Bu kilit döngü geri gelirse
       düşer — üstelik doğrulayıcıdan ÖNCE ve daha okunur bir mesajla. */
    for (const [style, expected] of [[DAY, SHIELD_IMG_DAY], [NIGHT, SHIELD_IMG_NIGHT]] as const) {
      const layer = style.layers[idx(style, 'road-shield')] as LayerSpecification & {
        layout?: { 'icon-image'?: unknown };
      };
      expect(layer.layout?.['icon-image']).toBe(expected);
    }
  });

  it('🔒 desteklenmeyen fill-extrusion AO özellikleri stile GERİ GELMEZ', () => {
    const json = JSON.stringify({ day: DAY, night: NIGHT });
    expect(json, 'MapLibre 4 ambient-occlusion tanımaz — stil reddedilir')
      .not.toContain('fill-extrusion-ambient-occlusion');
  });
});
