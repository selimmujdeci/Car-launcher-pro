import type { StyleSpecification, LayerSpecification, FilterSpecification } from 'maplibre-gl';
import type { MapSource } from './mapSourceTypes';
/* #552 — kimlikler `_mapState`'ten DEĞİL, döngüsüz `_mapIds`'ten alınır.
 * `_mapState` bu dosyadan `RASTER_PAINT_*` aldığı için eski import bir döngü
 * kuruyordu ve paletler `shieldImage: undefined` ile donuyordu. */
import { SHIELD_IMG_DAY, SHIELD_IMG_NIGHT } from './map/_mapIds';

/**
 * Navigation Focus Mode — 3-tier tiered road suppression manifest (Faz 3.2).
 *
 * Tier 0 — Normal navigation  : moderate suppression, full context awareness.
 * Tier 1 — Approaching (50-200m): deeper suppression, route starts to dominate.
 * Tier 2 — Junction (<50m)   : maximum suppression, only route corridor visible.
 *
 * Her tier aynı layer ID setine sahip → tier geçişleri tam restore sağlar.
 * Motorway ve trunk kasitleri hiçbir zaman baskılanmaz (otoyol bağlamı).
 */
type SuppressEntry = readonly [string, 'line-opacity' | 'text-opacity', number];

export const NAV_SUPPRESS_TIERS: ReadonlyArray<ReadonlyArray<SuppressEntry>> = [
  // ── Tier 0: Normal navigation ─────────────────────────────────────────────
  [
    ['road-primary-casing', 'line-opacity', 0.50],
    ['road-minor-casing',   'line-opacity', 0.28],
    ['road-primary',        'line-opacity', 0.50],
    ['road-secondary',      'line-opacity', 0.35],
    ['road-minor',          'line-opacity', 0.20],
    ['road-label',          'text-opacity', 0.28],
    ['place-town',          'text-opacity', 0.38],
  ],
  // ── Tier 1: Turn approach (50-200m) ──────────────────────────────────────
  [
    ['road-primary-casing', 'line-opacity', 0.28],
    ['road-minor-casing',   'line-opacity', 0.10],
    ['road-primary',        'line-opacity', 0.32],
    ['road-secondary',      'line-opacity', 0.16],
    ['road-minor',          'line-opacity', 0.07],
    ['road-label',          'text-opacity', 0.12],
    ['place-town',          'text-opacity', 0.20],
  ],
  // ── Tier 2: Junction (<50m) — lane corridor emphasis ─────────────────────
  [
    ['road-primary-casing', 'line-opacity', 0.14],
    ['road-minor-casing',   'line-opacity', 0.04],
    ['road-primary',        'line-opacity', 0.20],
    ['road-secondary',      'line-opacity', 0.08],
    ['road-minor',          'line-opacity', 0.03],
    ['road-label',          'text-opacity', 0.05],
    ['place-town',          'text-opacity', 0.10],
  ],
] as const;

/** Backward compat — NAV_SUPPRESS_LAYERS = tier 0 */
export const NAV_SUPPRESS_LAYERS = NAV_SUPPRESS_TIERS[0];

/**
 * Vector tile style — automotive dark theme, OMT schema.
 *
 * Tile source priority:
 *   1. smart-tile://{z}/{x}/{y}  (local .pbf via Filesystem / APK asset)
 *   2. VITE_VECTOR_TILE_URL env  (custom server / MapTiler / etc.)
 *
 * Glyphs:
 *   Online: MapLibre demo CDN (Noto Sans, always accessible)
 *   Offline: no symbol layers — NavigationHUD already shows turn text
 *
 * If no vector source is available, calls onFallback() (→ buildRoadStyle).
 */
/**
 * Vektör taban paleti — TEK katman listesi, iki renk kümesi.
 *
 * NEDEN BÖYLE (saha 2026-08-08, Siverek): gündüz vektör paleti hiç yazılmamıştı
 * ve `buildVectorStyle` gündüzde `onFallback()` ile RASTER OSM'e düşüyordu.
 * Raster karolar önceden pişmiş resimlerdir: binalar bej, yollar sarı/turuncu,
 * otoyol pembe — yeniden renklendirilemez. Sürücünün tarifi: *"Google'da yollar
 * gri, her yer beyaz, çok güzel duruyor; biz OEM seviyesinde hiç değiliz."*
 *
 * Katman listesini ÇOĞALTMIYORUZ: aynı ID'ler, aynı filtreler, aynı genişlikler
 * — yalnız renk yuvaları değişir. Bu kritik, çünkü `NAV_SUPPRESS_TIERS`
 * (navigasyon odak modu) katman ID'lerine isimle bağlıdır; ikinci bir liste
 * doğsaydı gündüz odak modu sessizce ölürdü.
 */
/**
 * Vektör gündüz zemini — nötr açık gri.
 *
 * ⚠️ **İlk teşhiste bir incelik atlanmıştı.** İlk deneme (#fafbfc) zemini beyaza
 * çekiyordu ve tali yolun zemine kontrastı **1.38**'di → "yollar beyaz, hiçbir
 * şey seçilmiyor" şikâyeti buydu. Ama asıl kusur zeminin beyazlığı DEĞİL,
 * **yolların da açık olmasıydı** (`#d3d8df`). Yollar koyulaştıktan sonra zemini
 * beyaza geri çekmek kontrastı bozmaz, **artırır**: aynı tali yol #e9edf1
 * zeminde 1.63 iken #f5f7f9 zeminde **1.71**, otoyol 3.22 → **4.06**.
 * Bu yüzden zemin bilinçli olarak beyaza yakın ama saf beyaz değil.
 *
 * Rol dağılımı (kilitli: `mapDayPaletteContrast.test.ts`):
 * **binalar en açık (beyaz) · zemin ortada · yollar en koyu.** Böylece "evler
 * beyaz, yollar gri" okunur ve anlam TON'la taşınır — renk körlüğünden ve
 * güneş parlamasından bağımsız.
 *
 * Raster gündüz zemininden (`MAP_BG_DAY` = #e9eef3) ayrı kalır: raster
 * karoların kendi zemin rengi vardır, vektörde zemini biz çizeriz.
 */
export const MAP_BG_DAY_VECTOR = '#f5f7f9';

interface VectorPalette {
  readonly bg: string;
  readonly water: string;
  readonly park: string;
  readonly residential: string;
  readonly buildingFill: string;
  readonly buildingOutline: string;
  readonly bldg3d: readonly [string, string, string];
  readonly bldg3dOpacity: number;
  /**
   * Bina tabanı kararma şiddeti (ambient occlusion).
   *
   * ⚠️ ŞU AN UYGULANMIYOR (kütük #552): `fill-extrusion-ambient-occlusion-*`
   * Mapbox GL özelliğidir; MapLibre GL 4 tanımaz ve stili reddeder. Değer
   * KORUNUYOR çünkü tasarım kararı geçerli — MapLibre desteklediğinde tek
   * satırla geri bağlanacak. Bu alanı değiştirmek BUGÜN hiçbir şeyi
   * değiştirmez; gündüz binaların düzlüğü bu yüzdendir (açık borç).
   */
  readonly bldg3dAO: number;
  /** Yol numarası kalkanı zemini (E-5 · D-100) — çalışma zamanı imajıyla eşleşir. */
  readonly shieldImage: string;
  /** Tünel gövdesinin görünürlüğü — yüzeyin ALTINDA olduğu okunmalı. */
  readonly tunnelOpacity: number;
  /** Köprü kasası — güverte kenarı, altındaki yolu kesmeli. */
  readonly bridgeCasing: string;
  readonly motorwayCasing: string;
  readonly primaryCasing: string;
  readonly minorCasing: string;
  readonly motorway: string;
  readonly primary: string;
  readonly secondary: string;
  readonly minor: string;
  readonly labelText: string;
  readonly labelHalo: string;
  readonly townText: string;
  readonly townHalo: string;
  readonly cityText: string;
  readonly cityHalo: string;
  /** POI noktalarının dolgu şeffaflığı — açık zeminde soluk kalmamalı. */
  readonly poiStrong: number;
  readonly poiWeak: number;
}

/** Mevcut OEM gece paleti — değerler BİREBİR korunmuştur (davranış değişmedi). */
export const NIGHT_PALETTE: VectorPalette = {
  bg:              MAP_BG_NIGHT,
  water:           '#16213a',
  park:            '#1c2b22',
  residential:     '#171b25',
  buildingFill:    '#1d2230',
  buildingOutline: '#2c3346',
  bldg3d:          ['#1d2230', '#2c3346', '#313850'],
  bldg3dOpacity:   0.78,
  bldg3dAO:        0.30,
  shieldImage:     SHIELD_IMG_NIGHT,
  tunnelOpacity:   0.42,
  bridgeCasing:    '#0b0e14',
  motorwayCasing:  '#2a2418',
  primaryCasing:   '#16161d',
  minorCasing:     '#101015',
  motorway:        '#6b6048',
  primary:         '#44444f',
  secondary:       '#383840',
  minor:           '#2a2a33',
  labelText:       '#e8e0d0',
  labelHalo:       '#0a0e16',
  townText:        '#e2eaf5',
  townHalo:        '#060c14',
  cityText:        '#ffffff',
  cityHalo:        '#060c14',
  poiStrong:       0.6,
  poiWeak:         0.45,
};

/**
 * OEM gündüz paleti — GRİ yol hiyerarşisi, BEYAZ binalar, nötr gri zemin.
 *
 * Üç katmanlı ton sözleşmesi (hepsi kilitli):
 *   1. **Binalar en açık** — saf beyaz dolgu + net kontur → "evler beyaz, net".
 *   2. **Zemin ortada** — nötr açık gri; ne binayla ne yolla karışır.
 *   3. **Yollar en koyu** — otoyol → tali monoton açılan gri; hiyerarşi renkle
 *      değil TONLA okunur (güneş altında ve renk körlüğünde dayanıklı).
 *
 * Kasalar kendi gövdesinden bir ton koyudur → yolun kenarı zeminde kaybolmaz;
 * ince tali yolu görünür kılan asıl öğe gövde değil, kasadır.
 *
 * Aktif rota bu sakin zeminin üstünde tek doygun öğedir; rota rengi
 * `lightBasemap` sözleşmesiyle açık zemine göre kontrast alır
 * (`routeColorModel.ts`) — bu palet o sözleşmeyi BOZMAZ, mod'a bakar renge
 * değil.
 */
export const DAY_PALETTE: VectorPalette = {
  bg:              MAP_BG_DAY_VECTOR,
  water:           '#bcd6ee',
  park:            '#d4e6cd',
  // Yerleşim dokusu zeminden bir tık koyu → üstündeki beyaz binalar öne çıkar.
  residential:     '#eef1f5',
  buildingFill:    '#ffffff',
  // Zemin beyaza yaklaştıkça bina/zemin farkı kapanır (1.07) — bina sınırını
  // artık DOLGU değil KONTUR taşır, bu yüzden kontur koyulaştırıldı (1.52).
  buildingOutline: '#c3cbd5',
  bldg3d:          ['#ffffff', '#f4f7fa', '#e7ecf1'],
  bldg3dOpacity:   0.95,
  // Gündüz AO gecenin ÜSTÜNDE: beyaz bina + beyaza yakın zemin ancak taban
  // kararmasıyla hacim kazanır (bina/zemin dolgu farkı yalnız 1.07).
  bldg3dAO:        0.48,
  shieldImage:     SHIELD_IMG_DAY,
  tunnelOpacity:   0.34,
  bridgeCasing:    '#39424f',
  // Kasalar gövdeden bir ton koyu → yol kenarı zeminde kaybolmaz.
  motorwayCasing:  '#515b6a',
  primaryCasing:   '#6e7887',
  minorCasing:     '#9aa3b0',
  motorway:        '#6e7a8a',
  primary:         '#8b95a4',
  secondary:       '#9ea7b5',
  minor:           '#b8c0cb',
  labelText:       '#22272f',
  labelHalo:       '#ffffff',
  townText:        '#333a45',
  townHalo:        '#ffffff',
  cityText:        '#151a23',
  cityHalo:        '#ffffff',
  poiStrong:       0.9,
  poiWeak:         0.75,
};

/**
 * Yüzey yolları için brunnel kapısı.
 *
 * OpenMapTiles `transportation` katmanında `brunnel` alanı bir yolun köprü mü,
 * tünel mi yoksa yüzey mi olduğunu söyler. Bu kapı OLMADAN üç durum da AYNI
 * çizilir → katlı kavşak düz bir gri yumak olur, sürücü hangi kolun üstten
 * geçtiğini okuyamaz.
 *
 * Alan YOKSA (`null`) `in` false döner → `!` true → yol yüzey sayılır. Yani
 * brunnel taşımayan karo setlerinde davranış BUGÜNKÜYLE BİREBİR aynıdır —
 * bu değişiklik veri yoksa hiçbir şeyi bozmaz.
 */
function surfaceOnly(classFilter: FilterSpecification): FilterSpecification {
  return ['all',
    classFilter,
    ['!', ['in', ['get', 'brunnel'], ['literal', ['bridge', 'tunnel']]]],
  ] as FilterSpecification;
}

/** Yalnız köprü ya da yalnız tünel — sınıf ayrımı genişlikte yapılır. */
function brunnelOnly(kind: 'bridge' | 'tunnel'): FilterSpecification {
  return ['==', ['get', 'brunnel'], kind] as FilterSpecification;
}

/**
 * Köprü/tünel katmanları TEK katmanda tüm yol sınıflarını taşır (katman sayısı
 * head unit'te bütçe kalemidir). Genişlik sınıfa göre `match` ile seçilir.
 */
function brunnelWidth(scale: number): FilterSpecification {
  /* ⚠️ SIRALAMA PAZARLIKSIZ (kütük #552 · 2026-08-12): zoom `interpolate` EN
     DIŞTA, sınıf `case` stop DEĞERLERİNİN içinde olmalı.
     Eskiden tersiydi (`case` dışta, her dalda ayrı `interpolate`) ve MapLibre
     stili sahada REDDEDİYORDU:
       `layers[7|8|16|17].paint.line-width: Only one zoom-based "step" or
        "interpolate" subexpression may be used in an expression.`
     Sonuç: tünel ve köprü katmanlarının dördü de düşüyor, gövdeler varsayılan
     1 px hat olarak çiziliyordu. Bir ifadede yalnız BİR zoom-bağımlı alt-ifade
     bulunabilir — dallanma stop'ların İÇİNE girer. */
  const atZoom = (mw: number, pri: number, other: number) => ['case',
    ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]], mw * scale,
    ['in', ['get', 'class'], ['literal', ['primary', 'secondary']]], pri * scale,
    other * scale,
  ];
  return ['interpolate', ['linear'], ['zoom'],
    8,  atZoom(4, 2.5, 1.2),
    14, atZoom(12, 9, 5),
    18, atZoom(20, 15, 9),
  ] as unknown as FilterSpecification;
}

/* ── Hibrit kaynak kapısı ───────────────────────────────────────────────────
 *
 * Öncelik: **yerel .pbf > çevrimiçi vektör > raster.**
 *
 * NEDEN GEREKLİ: `VITE_VECTOR_TILE_URL` tanımlıyken ağ yoksa vektör karolar
 * indirilemez ve harita BOŞ kalır — raster'a kendiliğinden düşmez. Raster yolu
 * ise `caros-tile://` önbelleği sayesinde çevrimdışında da bir şeyler gösterir.
 * Bu yüzden çevrimiçi vektör yalnız KULLANILABİLİR olduğunda seçilir.
 *
 * İki kapı vardır:
 *   1. `navigator.onLine === false` → açılışta hiç denenmez.
 *   2. Karo hataları eşiği aşıldıysa (`blockOnlineVector()`) → oturum boyunca
 *      denenmez. Bu ikincisi ŞART: aksi hâlde raster'a düşen fallback yeniden
 *      `getMapStyle()` çağırır, o yine vektör döner ve **sonsuz döngü** olur.
 *      "Bağlı ama internet yok" durumunu `navigator.onLine` yakalayamaz;
 *      gerçek kanıt karo hatasıdır.
 */
let _onlineVectorBlocked = false;

/** Karo hatası eşiği aşıldı — bu oturumda çevrimiçi vektör bir daha denenmez. */
export function blockOnlineVector(): void { _onlineVectorBlocked = true; }

/** Ağ geri geldi / kullanıcı kaynağı değiştirdi — kapıyı yeniden aç. */
export function unblockOnlineVector(): void { _onlineVectorBlocked = false; }

export function isOnlineVectorBlocked(): boolean { return _onlineVectorBlocked; }

function onlineVectorUsable(): boolean {
  if (_onlineVectorBlocked) return false;
  // `navigator.onLine` yalnız KESİN çevrimdışıyı bildirir; true olması
  // internet garantisi DEĞİLDİR — o yüzden tek dayanak değil, ilk kapıdır.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return true;
}

export function buildVectorStyle(
  sources: Map<string, MapSource>,
  onFallback: () => StyleSpecification,
  night = true,
): StyleSpecification {
  /* Gündüzde artık raster'a DÜŞÜLMEZ — gündüz paleti yukarıda tanımlı.
     (Eski davranış: `if (!night) return onFallback();` → sürücü gündüz hep
     ham OSM raster'ı görüyordu.) */
  const P = night ? NIGHT_PALETTE : DAY_PALETTE;

  const hasLocalPbf = sources.get('local')?.isAvailable === true;
  const customUrl   = (import.meta.env['VITE_VECTOR_TILE_URL'] ?? '') as string;

  // Determine tile URL — must serve .pbf
  /* Kaynak iki biçimde gelebilir:
       · KARO ŞABLONU — `{z}/{x}/{y}` içerir, doğrudan `tiles` olarak verilir.
       · TileJSON UCU — şablon içermez; MapLibre'ye `url` olarak verilir ve
         gerçek karo adresini O çözer.

     TileJSON desteği ZORUNLU: sağlayıcılar karo yoluna veri sürümü damgası
     koyar (ör. OpenFreeMap `/planet/20260802_080001_pt/{z}/{x}/{y}.pbf`).
     Damgalı şablonu sabitlemek, sağlayıcı veriyi tazelediği gün haritayı
     sessizce kırardı — TileJSON her açılışta güncel adresi verir. */
  let vectorTiles: string[] | null = null;
  let vectorTileJson: string | null = null;

  if (hasLocalPbf) {
    // Yerel .pbf ağdan BAĞIMSIZDIR → çevrimdışında da vektör kalitesi korunur.
    vectorTiles = ['smart-tile://{z}/{x}/{y}'];
  } else if (customUrl && onlineVectorUsable()) {
    if (customUrl.includes('{z}')) vectorTiles = [customUrl];
    else vectorTileJson = customUrl;
  } else {
    // No vector source → fall back to raster (smart-tile handles online OSM)
    return onFallback();
  }

  // Glyph-cache protokolü offline'da da etiket render eder (cache'den veya boş döner).
  // 'includeLabels = isOnline' koşulu artık gerekmez — her zaman aktif.
  const includeLabels = true;
  const glyphsUrl = 'glyph-cache://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

  const style: StyleSpecification = {
    version: 8,
    /* Ad TEMAYA göre verilir. Eskiden sabit "Vector (Automotive Dark)" idi;
       gündüz paleti yazıldıktan sonra (#482) gündüzde de bu ad dönüyordu ve
       teşhis çıktısı "koyu vektör" diye okunuyordu. Ad, ne çizildiğini
       söylemeli. */
    name: night ? 'Vector (Automotive Night)' : 'Vector (Automotive Day)',
    ...(includeLabels ? { glyphs: glyphsUrl } : {}),
    sources: {
      omv: {
        type: 'vector',
        ...(vectorTileJson ? { url: vectorTileJson } : { tiles: vectorTiles! }),
        minzoom: 0,
        maxzoom: 14,
        // ODbL gereği atıf ZORUNLU. TileJSON kendi atfını taşısa da kaynak
        // yerel .pbf olduğunda o metin gelmez — taban atıf her hâlde durur.
        attribution: '© OpenMapTiles © OpenStreetMap katkıcıları',
      },
      // ── Terrain DEM — rgb-terrarium encoding (Mapzen/AWS) ──────────────────
      // 3D yüzey render'ı için: fill-extrusion + hill-shade
      // Android WebView WebGL2 desteği varsa aktif olur; yoksa sessizce atlanır.
      'terrain-rgb': {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        tileSize: 256,
        encoding: 'terrarium' as const,
        maxzoom: 14,
        attribution: '© Mapzen',
      },
    },
    // terrain opsiyonu — WebGL2 varsa arazi yüksekliği aktif
    terrain: { source: 'terrain-rgb', exaggeration: 1.2 },
    layers: [
      // ── Base ──────────────────────────────────────────────
      // OEM tasarım gece paleti: sıcak grafit (--map-bg-1 #131822)
      { id: 'background',
        type: 'background',
        paint: { 'background-color': P.bg } },

      // ── Water ─────────────────────────────────────────────
      // --map-water-a #1A2540 / --map-water-b #152035
      { id: 'water-fill',
        type: 'fill',
        source: 'omv',
        'source-layer': 'water',
        paint: { 'fill-color': P.water } },
      { id: 'waterway',
        type: 'line',
        source: 'omv',
        'source-layer': 'waterway',
        paint: { 'line-color': P.water, 'line-width': 1.5 } },

      // ── Landuse ───────────────────────────────────────────
      // --map-park-a #1F2E26
      { id: 'landuse-park',
        type: 'fill',
        source: 'omv',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['park', 'grass', 'meadow', 'pitch', 'playground', 'golf']]],
        paint: { 'fill-color': P.park } },
      // hafif yükseltilmiş yerleşim zemini — --map-residential #2A2A33'e yakın koyu
      { id: 'landuse-residential',
        type: 'fill',
        source: 'omv',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood']]],
        paint: { 'fill-color': P.residential } },

      // ── Buildings ─────────────────────────────────────────
      // --map-bldg-1b #1D2230 fill, --map-bldg-1a #2C3346 outline
      { id: 'building',
        type: 'fill',
        source: 'omv',
        'source-layer': 'building',
        minzoom: 13,
        paint: { 'fill-color': P.buildingFill, 'fill-outline-color': P.buildingOutline } },

      // ── 3D Buildings — fill-extrusion z15+, OEM grafit ──
      // Yükseklik-bazlı renk: alçak binalar koyu, kuleler hafif aydınlık.
      // --map-bldg-1b #1D2230 → --map-bldg-2a #313850 → hafif sıcak vurgu.
      { id: 'building-3d',
        type: 'fill-extrusion',
        source: 'omv',
        'source-layer': 'building',
        minzoom: 15,
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'],
            ['coalesce', ['get', 'render_height'], ['get', 'height'], 5],
            0,  P.bldg3d[0],
            20, P.bldg3d[1],
            60, P.bldg3d[2],
          ],
          'fill-extrusion-opacity':           P.bldg3dOpacity,
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 10],
          'fill-extrusion-base':   ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
          /* Hacim hissini veren TEK desteklenen araç bu (taban→tepe koyu→açık).
             `fill-extrusion-ambient-occlusion-*` BİLEREK YOK: bu özellikler
             Mapbox GL'e aittir, MapLibre GL 4 tanımıyor ve stili sahada
             REDDEDİYORDU (kütük #552):
               `layers[6].paint.fill-extrusion-ambient-occlusion-intensity:
                unknown property`
             Yani AO zaten HİÇ uygulanmıyordu — kaldırmak görsel bir kayıp
             değil, yalnız sessiz hatanın kesilmesidir. `P.bldg3dAO` tokeni
             KORUNDU: MapLibre AO'yu desteklediğinde tek satırla geri bağlanır
             (açık borç — kütük #552). */
          'fill-extrusion-vertical-gradient': true,
        },
      } as LayerSpecification,

      // ── Tüneller — yüzey yollarının ALTINDA ───────────────
      // Sıra kasıtlı: tünel önce çizilir, üstüne yüzey yolları biner. Böylece
      // tünelin dağın/şehrin altından geçtiği okunur. Kesikli kasa + soluk gövde
      // "burada yol var ama görünmüyor" demenin OEM standardı yoludur.
      { id: 'road-tunnel-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: brunnelOnly('tunnel'),
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': P.minorCasing,
          'line-width': brunnelWidth(1.15) as unknown as number,
          'line-dasharray': [2.4, 1.6],
          'line-opacity': P.tunnelOpacity,
        } } as LayerSpecification,
      { id: 'road-tunnel',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: brunnelOnly('tunnel'),
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': P.bg,
          'line-width': brunnelWidth(0.82) as unknown as number,
          'line-opacity': P.tunnelOpacity + 0.24,
        } } as LayerSpecification,

      // ── Roads: casings (outlines) ─────────────────────────
      // OEM: otoyol kasası sıcak-koyu (sadece aktif rota altın renkte parlar)
      { id: 'road-motorway-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: surfaceOnly(['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]]),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.motorwayCasing,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 12],
        } },
      { id: 'road-primary-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: surfaceOnly(['in', ['get', 'class'], ['literal', ['primary', 'secondary']]]),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.primaryCasing,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 14, 9],
        } },
      { id: 'road-minor-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: surfaceOnly(['in', ['get', 'class'], ['literal', ['tertiary', 'minor', 'service']]]),
        minzoom: 12,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.minorCasing,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 14, 6],
        } },

      // ── Roads: fills ──────────────────────────────────────
      // --map-hwy-b #635A44 (sıcak koyu zeytin) — otoyol gövdesi
      { id: 'road-motorway',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: surfaceOnly(['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]]),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.motorway,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 14, 9],
        } },
      // OEM grafit hiyerarşisi: arterler koyu arduvaz (--map-art-a #44444F),
      // yan yollar daha geri çekilmiş (--map-secondary #353540 / --map-residential #2A2A33).
      // Sadece aktif rota (altın) öne çıkar — tasarım dili bu.
      { id: 'road-primary',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: surfaceOnly(['==', ['get', 'class'], 'primary']),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.primary,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.0, 12, 3, 14, 6.5, 18, 13],
        } },
      { id: 'road-secondary',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: surfaceOnly(['in', ['get', 'class'], ['literal', ['secondary', 'tertiary']]]),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.secondary,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 12, 2, 14, 4, 18, 9],
        } },
      { id: 'road-minor',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: surfaceOnly(['in', ['get', 'class'], ['literal', ['minor', 'service', 'track']]]),
        minzoom: 12,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.minor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.4, 14, 2, 18, 6],
        } },

      // ── Köprüler — yüzey yollarının ÜSTÜNDE ───────────────
      // Sıra kasıtlı: köprü EN SON çizilir, altındaki yolu keser. Kasa gövdeden
      // belirgin daha geniştir → güverte kenarı gölge gibi okunur ve katlı
      // kavşakta hangi kolun üstten geçtiği bir bakışta anlaşılır.
      { id: 'road-bridge-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: brunnelOnly('bridge'),
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': P.bridgeCasing,
          'line-width': brunnelWidth(1.42) as unknown as number,
        } } as LayerSpecification,
      { id: 'road-bridge',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: brunnelOnly('bridge'),
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          // Gövde rengi sınıfı izler → köprüde de yol hiyerarşisi korunur.
          'line-color': ['case',
            ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]], P.motorway,
            ['in', ['get', 'class'], ['literal', ['primary', 'secondary']]], P.primary,
            P.minor,
          ] as unknown as string,
          'line-width': brunnelWidth(1.0) as unknown as number,
        } } as LayerSpecification,

      // ── Situational POIs — automotive kritik noktalar ─────
      // OMT schema: poi source-layer, class değerleri
      { id: 'poi-gas',
        type: 'circle',
        source: 'omv',
        'source-layer': 'poi',
        minzoom: 14,
        filter: ['in', ['get', 'class'], ['literal', ['fuel', 'gas_station', 'petrol_station']]],
        paint: {
          'circle-color':        '#f59e0b',
          'circle-radius':       6,
          'circle-opacity':      P.poiStrong,
          'circle-stroke-color': '#fbbf24',
          'circle-stroke-width': 1,
        } } as LayerSpecification,
      { id: 'poi-parking',
        type: 'circle',
        source: 'omv',
        'source-layer': 'poi',
        minzoom: 14,
        filter: ['in', ['get', 'class'], ['literal', ['parking', 'parking_garage']]],
        paint: {
          'circle-color':        '#3b82f6',
          'circle-radius':       5,
          'circle-opacity':      P.poiWeak,
          'circle-stroke-color': '#60a5fa',
          'circle-stroke-width': 1,
        } } as LayerSpecification,
      { id: 'poi-hospital',
        type: 'circle',
        source: 'omv',
        'source-layer': 'poi',
        minzoom: 13,
        filter: ['in', ['get', 'class'], ['literal', ['hospital', 'clinic', 'pharmacy']]],
        paint: {
          'circle-color':        '#ef4444',
          'circle-radius':       6,
          'circle-opacity':      P.poiStrong,
          'circle-stroke-color': '#f87171',
          'circle-stroke-width': 1,
        } } as LayerSpecification,
      { id: 'poi-police',
        type: 'circle',
        source: 'omv',
        'source-layer': 'poi',
        minzoom: 13,
        filter: ['in', ['get', 'class'], ['literal', ['police', 'fire_station']]],
        paint: {
          'circle-color':        '#8b5cf6',
          'circle-radius':       5,
          'circle-opacity':      P.poiWeak,
          'circle-stroke-color': '#a78bfa',
          'circle-stroke-width': 1,
        } } as LayerSpecification,

      // ── Labels (online only) ──────────────────────────────
      ...(includeLabels ? ([
        { id: 'road-label',
          type: 'symbol',
          source: 'omv',
          'source-layer': 'transportation_name',
          minzoom: 12,
          layout: {
            'text-field': ['coalesce', ['get', 'name:tr'], ['get', 'name']],
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 14, 14],
            'symbol-placement': 'line',
            'text-max-angle': 30,
            'text-padding': 4,
            'text-letter-spacing': 0.06,
          },
          paint: {
            'text-color': P.labelText,      // OEM --map-label sıcak fildişi
            'text-halo-color': P.labelHalo,
            'text-halo-width': 2.2,        // kalın halo → gün ışığı kontrast
            'text-halo-blur': 0.5,
          } },
        /* ── Yol numarası kalkanı (E-5 · D-100 · O-4) ──────────────────────
           Sürücü tabelayı haritayla EŞLEŞTİRİR: yol adı yeterli değildir,
           numara birincil referanstır. `ref` alanı OMT `transportation_name`
           katmanında zaten geliyordu, yalnız hiç kullanılmıyordu.

           `icon-text-fit: 'both'` sayesinde tek bir arkaplan imajı metne göre
           esner → "E-5" ve "D-100" aynı imajla doğru genişlikte çıkar; her
           numara için ayrı görsel üretilmez. İmaj çalışma zamanında canvas'ta
           üretilir (stilde sprite YOK) — id palet üzerinden paylaşılır. */
        { id: 'road-shield',
          type: 'symbol',
          source: 'omv',
          'source-layer': 'transportation_name',
          minzoom: 9,
          filter: ['all',
            ['has', 'ref'],
            ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
          ] as FilterSpecification,
          layout: {
            'text-field': ['get', 'ref'],
            'text-font': ['Noto Sans Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 13],
            'text-letter-spacing': 0.04,
            'icon-image': P.shieldImage,
            'icon-text-fit': 'both',
            'icon-text-fit-padding': [2, 5, 2, 5],
            'symbol-placement': 'line',
            'symbol-spacing': 260,
            'text-padding': 3,
            'icon-allow-overlap': false,
            'text-allow-overlap': false,
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': 'rgba(0,0,0,0.35)',
            'text-halo-width': 0.8,
          } } as LayerSpecification,
        { id: 'place-town',
          type: 'symbol',
          source: 'omv',
          'source-layer': 'place',
          filter: ['in', 'class', 'town', 'village', 'hamlet'],
          layout: {
            'text-field': ['coalesce', ['get', 'name:tr'], ['get', 'name']],
            'text-font': ['Noto Sans Regular'],
            'text-size': 13,
            'text-anchor': 'center',
            'text-letter-spacing': 0.04,
          },
          paint: {
            'text-color': P.townText,
            'text-halo-color': P.townHalo,
            'text-halo-width': 2.5,
            'text-halo-blur': 0.5,
          } },
        { id: 'place-city',
          type: 'symbol',
          source: 'omv',
          'source-layer': 'place',
          filter: ['==', 'class', 'city'],
          layout: {
            'text-field': ['coalesce', ['get', 'name:tr'], ['get', 'name']],
            'text-font': ['Noto Sans Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 6, 14, 12, 20],
            'text-anchor': 'center',
            'text-letter-spacing': 0.06,
          },
          paint: {
            'text-color': P.cityText,
            'text-halo-color': P.cityHalo,
            'text-halo-width': 3.0,
            'text-halo-blur': 0.5,
          } },
      ] as LayerSpecification[]) : []),
    ],
  };

  return style;
}

/* ═══════════════════════════════════════════════════════════════════════════
   HARİTA GÜN/GECE TOKEN SİSTEMİ — TEK KAYNAK
   ═══════════════════════════════════════════════════════════════════════════
   Gündüz ve gece görünümü AYNI token setinden üretilir; bileşen içinde
   rastgele renk YOKTUR. `buildRoadStyle` (stil kurulumu) ve `applyMapDayNight`
   (canlı geçiş) ikisi de buradan okur → tek bir yerde değiştirilir.

   ⚠️ RASTER SINIRI (dürüstlük notu): ürünün varsayılan yolu RASTER OSM
   tile'ıdır (`buildVectorStyle` yalnız yerel .pbf veya `VITE_VECTOR_TILE_URL`
   varsa devreye girer; yoksa raster'a düşer). Raster'da **katman başına**
   (bina / ara yol / ana yol / etiket / POI / su) ayrı renk vermek MÜMKÜN
   DEĞİLDİR — elde yalnız tüm görüntüye uygulanan parlaklık/kontrast/doygunluk
   vardır. Bu yüzden "sokak isimleri okunsun ama arka plan koyu kalsın"
   dengesi burada KONTRAST ile kurulur, katman renkleriyle değil. Gerçek
   katman-bazlı gece paleti vektör stildedir (`buildVectorStyle`).

   ── SAHA GEÇMİŞİ ──────────────────────────────────────────────────────────
   • 2026-06-13: "çok koyu, yazı okunmuyor" → koyulaştırma brightness ile
     yapılır, contrast düşürülerek etiketler EZİLMEZ.
   • 2026-08-02 (Mersin, gerçek cihaz `adb screencap`): brightness-max .50
     gündüz parlaklığındaydı; .08 fazla sönük; **.16 seçildi.**
   • 2026-08-04 (bu tur): kullanıcı mini haritada "gece çok karanlık,
     okunamıyor" bildirdi. .16 tam ekranda kabul edilebilirken mini haritada
     (küçük alan, ince yol çizgileri, küçük etiketler) yol ağı seçilemiyordu.
     Okunabilirlik profili yükseltildi: parlaklık .16 → .25, kontrast .30 → .40
     (ana/ara yol ayrımı ve etiket kenarları), doygunluk -.70 → -.58 (su/yeşil
     ipuçları geri gelir, neon olmaz). Gündüze DÖNMEZ: .25, gündüzün 1.0'ının
     dörtte birinden azdır ve medya kartından parlak değildir.
   • ÜST SINIR .25 PAZARLIKSIZ: `regression.guards` içindeki saha kilidi
     (2026-08-02, ölçülen 180/255 piksel) bunu bağlar. Okunabilirlik artışı bu
     zarfın İÇİNDE yapılır — kilit zayıflatılarak DEĞİL.                      */

/** Profil adı — CAROS LAB `mapContrastProfile` alanı bunu gösterir. */
export type MapContrastProfile = 'NIGHT_READABLE' | 'DAY_NATURAL';

/** Gece token seti (raster). Tek kaynak — canlı geçiş de bunu kullanır. */
export const RASTER_PAINT_NIGHT = {
  'raster-opacity': 1,
  'raster-contrast': 0.40,
  'raster-brightness-min': 0.02,   // saf siyah YOK — 0 blokları detayı yutuyordu
  'raster-brightness-max': 0.25,
  'raster-saturation': -0.58,
  'raster-hue-rotate': 15,
} as const;

/** Gündüz token seti — ham OSM'nin doğal renkleri, koyulaştırma YOK. */
export const RASTER_PAINT_DAY = {
  'raster-opacity': 1,
  'raster-contrast': 0.05,
  'raster-brightness-min': 0,
  'raster-brightness-max': 1,
  'raster-saturation': -0.05,
  'raster-hue-rotate': 0,
} as const;

/** Arka plan token'ları — TEK KAYNAK `map/_mapIds.ts` (DÖNGÜSÜZ sabitler evi).
 *  Burada yalnız yeniden dışa aktarılır ki stil kurucuları tek yerden okusun.
 *
 *  ⚠️ Kaynak `_mapState` DEĞİL, `_mapIds`tir (kütük #605): `_mapState` bu
 *  dosyadan `RASTER_PAINT_*` aldığı için oradan okumak döngü kurar ve
 *  `NIGHT_PALETTE` modül üst seviyesinde kurulduğundan TDZ ile ÇÖKER. */
export { MAP_BG_NIGHT, MAP_BG_DAY } from './map/_mapIds';
import { MAP_BG_NIGHT, MAP_BG_DAY } from './map/_mapIds';

/** Yürürlükteki kontrast profili — LAB gözlemi için. */
export function getMapContrastProfile(night: boolean): MapContrastProfile {
  return night ? 'NIGHT_READABLE' : 'DAY_NATURAL';
}

export function buildRoadStyle(
  activeSourceId: string | null,
  sources: Map<string, MapSource>,
  getTileUrls: () => string[],
  night = true,
): StyleSpecification {
  const tiles = getTileUrls();
  const hasLocal = sources.get('local')?.isAvailable === true;
  const usingSmart = hasLocal || activeSourceId === 'local';

  return {
    version: 8,
    name: usingSmart ? 'Smart Offline/Online Map' : 'OSM Map',
    sources: {
      'map-tiles': {
        type: 'raster',
        tiles,
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
        minzoom: 0,
        maxzoom: 19,
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': night ? MAP_BG_NIGHT : MAP_BG_DAY }  // token seti — tek kaynak
      },
      {
        id: 'tiles-layer',
        type: 'raster',
        source: 'map-tiles',
        paint: { ...(night ? RASTER_PAINT_NIGHT : RASTER_PAINT_DAY) },
      },
    ],
  };
}

export function buildSatelliteStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'Uydu',
    sources: {
      'satellite-tiles': {
        type: 'raster',
        // SAHA FİX 2026-06-12: ham https → caros-tile:// protokolü. Capacitor Android
        // WebView MapLibre'nin iç XHR'ını (CORS/mixed-content) blokluyordu → uydu boş
        // geliyordu. Yol karoları gibi caros-tile JS fetch()'ten geçer + LRU cache.
        tiles: ['caros-tile://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri',
        // maxzoom 17: ESRI World_Imagery bazı bölgelerde z18-19'da görüntüye sahip değil →
        // "Map data not yet available" placeholder karosu döner. Düşük maxzoom ile MapLibre
        // mevcut karoyu OVER-ZOOM eder (hafif bulanık ama gerçek görüntü, placeholder yok).
        maxzoom: 17,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0d1628' } },
      { id: 'satellite-layer', type: 'raster', source: 'satellite-tiles', paint: { 'raster-opacity': 1 } },
    ],
  };
}

export function buildHybridStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'Hibrit',
    sources: {
      'satellite-tiles': {
        type: 'raster',
        // SAHA FİX 2026-06-12: ham https → caros-tile:// protokolü. Capacitor Android
        // WebView MapLibre'nin iç XHR'ını (CORS/mixed-content) blokluyordu → uydu boş
        // geliyordu. Yol karoları gibi caros-tile JS fetch()'ten geçer + LRU cache.
        tiles: ['caros-tile://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri',
        // bkz. buildSatelliteStyle — ESRI placeholder karosunu önlemek için over-zoom
        maxzoom: 17,
      },
      'road-overlay': {
        type: 'raster',
        // caros-tile:// — WebView XHR bloklamasını aşar (yukarıdaki uydu notu).
        tiles: ['caros-tile://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
        maxzoom: 19,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0d1628' } },
      { id: 'satellite-layer', type: 'raster', source: 'satellite-tiles', paint: { 'raster-opacity': 1 } },
      {
        id: 'road-overlay-layer',
        type: 'raster',
        source: 'road-overlay',
        paint: {
          // Opacity 0.38 — uydu görüntüsünü açık tutar, yol etiketleri hâlâ okunur
          'raster-opacity': 0.38,
          // Tam renk silme: OSM'nin yeşil parkları / mavi suyu kalkar,
          // sadece siyah/gri yol çizgileri ve beyaz yazılar kalır
          'raster-saturation': -1,
          // Kontrast maksimum: açık zemin → tam beyaz, yollar → tam siyah
          // Sürüş güvenliği: gece modunda bile şerit/kavşak ayrımı net
          'raster-contrast': 0.75,
          // Beyaz OSM zemini → orta gri (0.55) → uydu renkleriyle harmoniyi artırır
          'raster-brightness-max': 0.55,
          'raster-brightness-min': 0,
        },
      },
    ],
  };
}
