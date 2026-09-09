/**
 * mapDayNightStyle.test.ts — Harita gündüz/gece stil karar zinciri.
 *
 * Kök neden regresyon koruması:
 *  - MapCore init eskiden sabit gece OSM_STYLE kullanıyordu ('osm-tiles' layer id'si)
 *    → applyMapDayNight ('tiles-layer' arar) no-op kalıyor, gündüz temada harita gece
 *    kalıyordu. Artık init getMapStyle() (tek kaynaklı resolver) kullanmak ZORUNDA.
 *  - FullMapView canvas CSS filtresi autoBrightness.phase'e bağlıydı (farklı sinyal);
 *    artık harita stiliyle aynı mapNight (settings.dayNightMode) sinyaline bağlı.
 *
 * Test kapsamı:
 *  1. theme='light'  → getMapStyle gündüz raster paleti (RASTER_PAINT_DAY + açık bg)
 *  2. theme='dark'   → getMapStyle gece raster paleti  (RASTER_PAINT_NIGHT + grafit bg)
 *  3. auto saat kuralı (isNightHour) — 07–19 gündüz bandı, useDayNightManager ile aynı
 *  4. vector + gündüz → gündüz raster fallback (koyu vektör palet GÜNDÜZ asla dönmez)
 *  5. son çare fallback (getOnlineTileStyle) varsayılanı GÜNDÜZ; night=true ile gece
 *  6. resolver deterministik — minimap/fullmap geçişi stili değiştirmez
 *  7. kaynak sözleşmeleri — MapCore init getMapStyle(), FullMapView filtresi mapNight
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* ── Mock'lar — DOM'suz ortamda maplibre/serviceWorker kullanılamaz ── */

vi.mock('maplibre-gl', () => ({
  default: { addProtocol: vi.fn(), removeProtocol: vi.fn() },
  Map: class {},
  Marker: class {},
}));

vi.mock('../platform/serviceWorkerManager', () => ({
  getTileCacheStats: vi.fn().mockResolvedValue({ totalTiles: 0, cacheSize: 0 }),
}));

/* ── Import ── */

import type { StyleSpecification } from 'maplibre-gl';
import {
  getMapStyle,
  setMapNight,
  getMapNight,
  isNightHour,
  useMapSourceStore,
} from '../platform/mapSourceManager';
import { getOnlineTileStyle } from '../platform/map/_mapState';
import {
  RASTER_PAINT_DAY, RASTER_PAINT_NIGHT, MAP_BG_NIGHT, MAP_BG_DAY_VECTOR, MAP_BG_DAY,
} from '../platform/mapStyleBuilders';

/* ── Yardımcılar ── */

function tilesPaint(style: StyleSpecification): Record<string, unknown> | undefined {
  const layer = style.layers.find((l) => l.id === 'tiles-layer') as { paint?: Record<string, unknown> } | undefined;
  return layer?.paint;
}

function backgroundColor(style: StyleSpecification): unknown {
  const layer = style.layers.find((l) => l.id === 'background') as { paint?: Record<string, unknown> } | undefined;
  return layer?.paint?.['background-color'];
}

/* ── 1-2. theme → raster palet ───────────────────────────────── */

describe('getMapStyle — gündüz/gece raster paleti', () => {
  it("theme='light' (mapNight=false) → GÜNDÜZ paleti: doğal açık raster + açık arka plan", () => {
    useMapSourceStore.setState({ mapMode: 'road', tileRender: 'raster' });
    setMapNight(false);
    const style = getMapStyle();
    expect(getMapNight()).toBe(false);
    expect(tilesPaint(style)).toEqual({ ...RASTER_PAINT_DAY });
    /* Zemin KANONİK TOKENDEN okunur — hex kopyalanmaz. (2026-09-09: token
       `#e9eef3` → `#eee9e3` olarak yeniden kalibre edildiğinde bu kilit
       değer kopyaladığı için düşmüştü; kilidin amacı "gündüzde gündüz zemini
       yazılır" davranışıdır, belirli bir hex DEĞİL.) */
    expect(backgroundColor(style)).toBe(MAP_BG_DAY);
  });

  it("theme='dark' (mapNight=true) → GECE paleti: grafit raster + koyu arka plan", () => {
    useMapSourceStore.setState({ mapMode: 'road', tileRender: 'raster' });
    setMapNight(true);
    const style = getMapStyle();
    expect(getMapNight()).toBe(true);
    expect(tilesPaint(style)).toEqual({ ...RASTER_PAINT_NIGHT });
    expect(backgroundColor(style)).toBe(MAP_BG_NIGHT);
  });
});

/* ── 3. auto mod saat kuralı ─────────────────────────────────── */

describe('isNightHour — otomatik gün/gece saat bandı (07–19)', () => {
  it('gündüz saatleri (07–18) → false (day style)', () => {
    for (const h of [7, 9, 12, 15, 18]) {
      expect(isNightHour(h)).toBe(false);
    }
  });

  it('gece saatleri (19–06) → true (night style)', () => {
    for (const h of [19, 21, 23, 0, 3, 6]) {
      expect(isNightHour(h)).toBe(true);
    }
  });
});

/* ── 4. vector + gündüz ──────────────────────────────────────── */

describe('getMapStyle — vector modda gündüz', () => {
  /*
   * ⚠️ KİLİT GÜNCELLENDİ (2026-08-08), KALDIRILMADI.
   *
   * ESKİ HÂLİ: "gündüzde vektör ASLA dönmez, raster fallback döner".
   * O kural, gündüz vektör paleti HENÜZ YOKKEN doğruydu: `buildVectorStyle`
   * tek (koyu) palet üretiyordu ve gündüz kullanılırsa harita gece gibi
   * görünürdü — bu yüzden gündüzde bilerek raster'a düşülüyordu.
   *
   * #482 ile gündüz paleti yazıldı ve `buildVectorStyle` içindeki gündüz→raster
   * kapısı kaldırıldı. Kilit bir süre YANLIŞ SEBEPLE yeşil kaldı: vektör karo
   * kaynağı hiç tanımlı olmadığı için (#486) stil zaten raster'a düşüyordu.
   * Kaynak bağlanınca gerçek davranış ortaya çıktı.
   *
   * KORUNAN ASIL KURAL DEĞİŞMEDİ: **gündüzde ekran gece paletiyle çizilemez.**
   * Ölçüt artık "vektör mü raster mı" değil — hangi motorla çizildiğinden
   * bağımsız olarak GÜNDÜZ PALETİ kullanılmış olmalı.
   */
  it('tileRender=vector + gündüz → gece paleti ASLA kullanılmaz', () => {
    useMapSourceStore.setState({ mapMode: 'road', tileRender: 'vector' });
    setMapNight(false);
    const style = getMapStyle();

    // Ad ne çizildiğini söylemeli — gündüzde "Night" adı dönemez.
    expect(style.name).not.toContain('Night');
    expect(style.name).not.toBe('Vector (Automotive Dark)');

    const bg = backgroundColor(style);
    // Gece zeminleri (vektör #161c28 · raster #131822) gündüzde YASAK.
    expect(bg).not.toBe(MAP_BG_NIGHT);
    expect(bg).not.toBe('#131822');

    // Hangi motor kullanılırsa kullanılsın zemin GÜNDÜZ tonunda olmalı:
    // vektör yolunda MAP_BG_DAY_VECTOR, raster yolunda MAP_BG_DAY.
    expect([MAP_BG_DAY_VECTOR, MAP_BG_DAY]).toContain(bg);

    // Raster yoluna düşüldüyse gündüz raster paint'i uygulanmalı.
    const paint = tilesPaint(style);
    if (paint) expect(paint).toEqual({ ...RASTER_PAINT_DAY });
  });
});

/* ── 5. Son çare fallback stili ──────────────────────────────── */

describe('getOnlineTileStyle — son çare fallback', () => {
  it('varsayılan (parametresiz) → GÜNDÜZ paleti (fallback asla koyu kurulmaz)', () => {
    const style = getOnlineTileStyle();
    expect(tilesPaint(style)).toEqual({ ...RASTER_PAINT_DAY });
    expect(backgroundColor(style)).toBe(MAP_BG_DAY);
  });

  it('night=true → GECE paleti', () => {
    const style = getOnlineTileStyle(true);
    expect(tilesPaint(style)).toEqual({ ...RASTER_PAINT_NIGHT });
    expect(backgroundColor(style)).toBe(MAP_BG_NIGHT);
  });

  it("layer id 'tiles-layer' — applyMapDayNight canlı geçişi fallback haritada da çalışır", () => {
    const style = getOnlineTileStyle();
    expect(style.layers.some((l) => l.id === 'tiles-layer')).toBe(true);
    expect(Object.keys(style.sources)).toContain('map-tiles');
  });
});

/* ── 6. Resolver deterministik — görünüm geçişi stili değiştirmez ── */

describe('getMapStyle — minimap/fullmap geçişinde stil kararlı', () => {
  it('aynı state ile ardışık iki çözümleme birebir aynı stili döner', () => {
    useMapSourceStore.setState({ mapMode: 'road', tileRender: 'raster' });
    setMapNight(false);
    const a = getMapStyle();
    const b = getMapStyle(); // ikinci view (minimap→fullmap) aynı resolver'ı çağırır
    expect(b).toEqual(a);
  });
});

/* ── 7. Kaynak sözleşmeleri — init zinciri + CSS filtre sinyali ── */

describe('kaynak sözleşmeleri — stil karar zinciri tek kaynaklı', () => {
  const mapCoreSrc = readFileSync(
    join(process.cwd(), 'src', 'platform', 'map', 'MapCore.ts'), 'utf-8');
  const fullMapSrc = readFileSync(
    join(process.cwd(), 'src', 'components', 'map', 'FullMapView.tsx'), 'utf-8');
  const layerMgrSrc = readFileSync(
    join(process.cwd(), 'src', 'platform', 'map', 'MapLayerManager.ts'), 'utf-8');

  it('MapCore init stili getMapStyle() resolver\'ından alır (sabit OSM_STYLE değil)', () => {
    expect(mapCoreSrc).toMatch(/const style = getMapStyle\(\)/);
    expect(mapCoreSrc).not.toMatch(/const style = OSM_STYLE/);
  });

  it('MapCore tile-error kurtarması da resolver kullanır', () => {
    expect(mapCoreSrc).toMatch(/switchMapStyle\(map, getMapStyle\(\)\)/);
    expect(mapCoreSrc).not.toMatch(/switchMapStyle\(map, OSM_STYLE\)/);
  });

  it('MapCore son çare fallback gün/gece farkındadır', () => {
    expect(mapCoreSrc).toMatch(/getOnlineTileStyle\(getMapNight\(\)\)/);
  });

  /**
   * #622 — KİLİT BİLİNÇLİ GÜNCELLENDİ (kaldırılmadı).
   *
   * Eski sözleşme "filtre `mapNight` sinyaline bağlı olsun" idi; amacı, filtrenin
   * YANLIŞ sinyalden (autoBrightness.phase) sürülüp gündüz de karartmasını
   * engellemekti. O kusur artık YAPISAL olarak imkânsız: gece karartma filtresi
   * TAMAMEN kaldırıldı, gece görünümü ölçülmüş paletten geliyor.
   * Ölçüm gerekçesi: Google gece zemini 0,028 lum · bizim ekranda 0,008 idi
   * (filtre × koyu palet) → yüzey 3,5 kat karanlıktı. Yeni kilit, karartma
   * filtresinin GERİ GELMEMESİNİ korur.
   */
  it('FullMapView haritayı KARARTAN bir CSS filtresi uygulamaz (#622)', () => {
    // Gece/gündüz ayrımı artık filtreyle YAPILMAZ.
    expect(fullMapSrc).not.toMatch(/filter: mapNight\s*\?/);
    expect(fullMapSrc).not.toMatch(/filter: isNight/);
    // Eski yanlış sinyal hâlâ yasak.
    expect(fullMapSrc).not.toMatch(/autoBrightness\.phase === 'night'/);
    /* Karartan/ton bozan primitifler harita kabında bulunmamalı.
       Yorumlar ÇIKARILIR: gerekçe metinleri eski değerleri anlatır ve kilidi
       yanıltmamalıdır (kilit KODA bakar, açıklamaya değil). */
    const kod = fullMapSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    for (const bad of ['brightness(0.', 'sepia(', 'hue-rotate(', 'grayscale(']) {
      expect(kod, `harita filtresinde ${bad} var`).not.toContain(bad);
    }
  });

  it("applyMapDayNight standart 'tiles-layer' id'sini canlı patch'ler", () => {
    expect(layerMgrSrc).toMatch(/'tiles-layer'/);
  });
});
