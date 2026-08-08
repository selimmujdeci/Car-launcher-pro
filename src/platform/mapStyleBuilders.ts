import type { StyleSpecification, LayerSpecification } from 'maplibre-gl';
import type { MapSource } from './mapSourceTypes';

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
 * ⚠️ **Beyaz DEĞİL, bilinçli olarak.** İlk deneme (#fafbfc) zemini beyaza
 * çekiyordu; ölçüldüğünde tali yolun zemine kontrastı **1.38**'e düşüyordu →
 * sürücünün gördüğü "yollar beyaz, hiçbir şey seçilmiyor" tam olarak buydu.
 * Zemin griye çekilince aynı yol **1.63**'e, otoyol 2.49 → **3.22**'ye çıkar.
 *
 * Rol dağılımı (kilitli: `mapDayPaletteContrast.test.ts`):
 * **binalar en açık (beyaz) · zemin ortada · yollar en koyu.** Böylece "evler
 * beyaz, yollar gri" okunur ve anlam TON'la taşınır — renk körlüğünden ve
 * güneş parlamasından bağımsız.
 *
 * Raster gündüz zemininden (`MAP_BG_DAY` = #e9eef3) ayrı kalır: raster
 * karoların kendi zemin rengi vardır, vektörde zemini biz çizeriz.
 */
export const MAP_BG_DAY_VECTOR = '#e9edf1';

interface VectorPalette {
  readonly bg: string;
  readonly water: string;
  readonly park: string;
  readonly residential: string;
  readonly buildingFill: string;
  readonly buildingOutline: string;
  readonly bldg3d: readonly [string, string, string];
  readonly bldg3dOpacity: number;
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
const NIGHT_PALETTE: VectorPalette = {
  bg:              MAP_BG_NIGHT,
  water:           '#16213a',
  park:            '#1c2b22',
  residential:     '#171b25',
  buildingFill:    '#1d2230',
  buildingOutline: '#2c3346',
  bldg3d:          ['#1d2230', '#2c3346', '#313850'],
  bldg3dOpacity:   0.78,
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
const DAY_PALETTE: VectorPalette = {
  bg:              MAP_BG_DAY_VECTOR,
  water:           '#bcd6ee',
  park:            '#d4e6cd',
  // Yerleşim dokusu zeminden bir tık koyu → üstündeki beyaz binalar öne çıkar.
  residential:     '#e4e9ef',
  buildingFill:    '#ffffff',
  buildingOutline: '#ccd3dc',
  bldg3d:          ['#ffffff', '#f4f7fa', '#e7ecf1'],
  bldg3dOpacity:   0.95,
  // Kasalar gövdeden bir ton koyu → yol kenarı zeminde kaybolmaz.
  motorwayCasing:  '#5c6675',
  primaryCasing:   '#6e7887',
  minorCasing:     '#98a2b0',
  motorway:        '#798493',
  primary:         '#8b95a4',
  secondary:       '#9ea7b5',
  minor:           '#b3bcc8',
  labelText:       '#22272f',
  labelHalo:       '#ffffff',
  townText:        '#333a45',
  townHalo:        '#ffffff',
  cityText:        '#151a23',
  cityHalo:        '#ffffff',
  poiStrong:       0.9,
  poiWeak:         0.75,
};

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
  let vectorTiles: string[];
  if (hasLocalPbf) {
    vectorTiles = ['smart-tile://{z}/{x}/{y}'];
  } else if (customUrl) {
    vectorTiles = [customUrl];
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
    name: 'Vector (Automotive Dark)',
    ...(includeLabels ? { glyphs: glyphsUrl } : {}),
    sources: {
      omv: {
        type: 'vector',
        tiles: vectorTiles,
        minzoom: 0,
        maxzoom: 14,
        attribution: '© OpenMapTiles © OpenStreetMap contributors',
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
          'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-ambient-occlusion-intensity': 0.35,
          'fill-extrusion-ambient-occlusion-radius':    10,
        },
      } as LayerSpecification,

      // ── Roads: casings (outlines) ─────────────────────────
      // OEM: otoyol kasası sıcak-koyu (sadece aktif rota altın renkte parlar)
      { id: 'road-motorway-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.motorwayCasing,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 12],
        } },
      { id: 'road-primary-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.primaryCasing,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 14, 9],
        } },
      { id: 'road-minor-casing',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['tertiary', 'minor', 'service']]],
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
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]],
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
        filter: ['==', ['get', 'class'], 'primary'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.primary,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.0, 12, 3, 14, 6.5, 18, 13],
        } },
      { id: 'road-secondary',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.secondary,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 12, 2, 14, 4, 18, 9],
        } },
      { id: 'road-minor',
        type: 'line',
        source: 'omv',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'track']]],
        minzoom: 12,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.minor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.4, 14, 2, 18, 6],
        } },

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

/** Arka plan token'ları — TEK KAYNAK `map/_mapState.ts` (paylaşılan sabitler evi).
 *  Burada yalnız yeniden dışa aktarılır ki stil kurucuları tek yerden okusun. */
export { MAP_BG_NIGHT, MAP_BG_DAY } from './map/_mapState';
import { MAP_BG_NIGHT, MAP_BG_DAY } from './map/_mapState';

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
