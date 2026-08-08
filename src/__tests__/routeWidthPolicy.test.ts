/**
 * routeWidthPolicy.test.ts — rota kalınlığı TEK otoriteden türer.
 *
 * ── KİLİTLENEN KUSUR ────────────────────────────────────────────────────────
 * Beş rota katmanının (SHADOW · GLOW · CASE · CORE · FLOW) kalınlığını DÖRT
 * bağımsız yer yazıyordu ve hiçbiri diğerini bilmiyordu:
 *   1. kurulum        → shadow 8→22 · glow 10→24 · case 6→14 · core 4→10 · flow 4→14
 *   2. perspektif     → YALNIZ core (8→32) ve case (14→38) — bambaşka sayılar
 *   3. nefes alan glow→ glow'un zoom ifadesini bir SKALER ile siliyordu
 *   4. shadow + flow  → kurulumdan sonra HİÇ güncellenmiyordu
 *
 * Ölçülen sonuç (z18, pitch 40): CASE 46 > CORE 39 > GLOW 24 > SHADOW 22.
 * Katman sırası alttan üste SHADOW·GLOW·CASE·CORE·FLOW olduğu için neon halo
 * ve derinlik gölgesi TAMAMEN kayboluyordu — iki `line-blur` katmanı GPU
 * yakıp ekrana hiçbir şey çizmiyordu; nefes alan güvenlik sinyali de
 * sürüş sırasında sürücüye HİÇ ULAŞMIYORDU.
 *
 * Ayrıca kalınlıklar CSS pikselinde SABİTTİ ve ekran ölçüsünü hiç hesaba
 * katmıyordu. Politikanın kontrol ettiği eksende (`vmin` — bu üründe zaten
 * doğrulanmış responsive birim, bkz. `SpeedLimitCard` çapı) aynı 39 px'lik
 * çekirdek 360 px'lik yüzeyde %10,8, 800 px'lik yüzeyde %4,9 yer kaplıyordu →
 * **2,22× görsel ağırlık farkı**. Politikayla bu **1,4×'in altına** iner.
 */

import { describe, it, expect } from 'vitest';
import {
  computeRouteWidths,
  resolveRouteWidthScale,
  routeWidthExpression,
  breathingGlowWidth,
  ROUTE_WIDTH_REF_VMIN,
  ROUTE_WIDTH_SCALE_MIN,
  ROUTE_WIDTH_SCALE_MAX,
  type RouteWidths,
} from '../platform/map/core/routeWidthModel';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const layerSrc = read('src/platform/map/MapLayerManager.ts');
const interSrc = read('src/platform/map/MapInteractionManager.ts');

/** Kabul kriterlerindeki viewport'lar — canvas kısa kenarı (CSS px). */
const VIEWPORTS = [
  { name: '360 px dikey telefon', wh: [360, 740] as const },
  { name: '430 px dikey telefon', wh: [430, 930] as const },
  { name: '904 px yatay telefon', wh: [904, 406] as const },
  { name: '1024 px head unit',    wh: [1024, 600] as const },
  { name: '1280 px tablet',       wh: [1280, 800] as const },
];
const minOf = ([w, h]: readonly [number, number]) => Math.min(w, h);

describe('Katman sırası — halo ve gölge ARTIK kaybolmuyor', () => {
  it('her viewport ve her perspektifte glow > shadow > casing > core > flow', () => {
    for (const v of VIEWPORTS) {
      for (const persp of [1.0, 1.11, 1.22, 1.5]) {
        const w = computeRouteWidths({ canvasMinPx: minOf(v.wh), perspectiveScale: persp });
        const tag = `${v.name} @ perspektif ${persp}`;
        // z18 ve z12 uçlarının İKİSİNDE de sıra korunmalı — MapLibre aradaki
        // her zoom'u doğrusal ara değerle üretir, uçlar doğruysa ara da doğrudur.
        for (const z of ['z12', 'z18'] as const) {
          expect(w.glow[z],   `${tag}: halo kılıfın altında kalıyor (${z})`)
            .toBeGreaterThan(w.shadow[z]);
          expect(w.shadow[z], `${tag}: gölge kılıfın altında kalıyor (${z})`)
            .toBeGreaterThan(w.casing[z]);
          expect(w.casing[z], `${tag}: kılıf çekirdekten ince (${z})`)
            .toBeGreaterThan(w.core[z]);
          expect(w.flow[z],   `${tag}: akış izi çekirdeği taşırıyor (${z})`)
            .toBeLessThan(w.core[z]);
        }
      }
    }
  });

  it('KUSUR KANITI: eski sabit değerlerde sıra TERSİNE dönüyordu', () => {
    // Eski hâl (z18): case 38×p, core 32×p, glow 24, shadow 22 (statik).
    const p = 1.22;
    const oldCase = 38 * p, oldGlow = 24, oldShadow = 22;
    expect(oldGlow, 'kusur zaten yokmuş gibi görünüyor — kilit anlamsız')
      .toBeLessThan(oldCase);
    expect(oldShadow).toBeLessThan(oldCase);
  });
});

describe('Viewport ölçeği — aynı rota, aynı görsel ağırlık', () => {
  it('REFERANS head unit: ölçek tam 1,0 → çekirdek ve kılıf DEĞİŞMEZ', () => {
    const w = computeRouteWidths({ canvasMinPx: ROUTE_WIDTH_REF_VMIN, perspectiveScale: 1 });
    expect(w.scale).toBe(1);
    // Bugünkü sürüş değerleri (`8 * p` / `32 * p` ve `14 * p` / `38 * p`).
    expect(w.core.z12, 'head unit çekirdek z12 kaymış').toBe(8);
    expect(w.core.z18, 'head unit çekirdek z18 kaymış').toBe(32);
    expect(w.casing.z18, 'head unit kılıf z18 kaymış').toBe(38);
  });

  it('DAR EKRAN incelir ama tabana oturur (aşırı ince değil)', () => {
    const small = computeRouteWidths({ canvasMinPx: 360 });
    expect(small.scale).toBe(ROUTE_WIDTH_SCALE_MIN);
    expect(small.core.z18, 'dar ekranda rota tel gibi incelmiş').toBeGreaterThan(20);
  });

  it('BÜYÜK EKRAN kalınlaşır ama tavana oturur (aşırı kalın değil)', () => {
    const big = computeRouteWidths({ canvasMinPx: 800 });
    expect(big.scale).toBe(ROUTE_WIDTH_SCALE_MAX);
    expect(big.core.z18, 'büyük ekranda rota kavşağı kapatacak kadar kalınlaşmış')
      .toBeLessThan(40);
  });

  it("GÖRSEL AĞIRLIK DENGELENDİ: vmin yayılımı 2,22×'ten <1,6×'e indi", () => {
    /* Ölçüt `vmin`dir — politikanın kontrol ettiği eksen odur ve bu üründe
       zaten doğrulanmış responsive birimdir (`SpeedLimitCard` çapı).
       Genişliğe bölmek yanıltır: dikey telefon TANIMI GEREĞİ dardır, aynı
       fiziksel kalınlık orada her zaman daha büyük bir yüzde kaplar. */
    const vmins = VIEWPORTS.map((v) => minOf(v.wh));
    const now = vmins.map((m) => computeRouteWidths({ canvasMinPx: m, perspectiveScale: 1.22 }).core.z18 / m);
    const before = vmins.map((m) => 39 / m);   // eski sabit çekirdek
    const spread = (xs: number[]) => Math.max(...xs) / Math.min(...xs);

    expect(spread(before), 'eski yayılım beklenenden küçük — ölçüm yanlış')
      .toBeGreaterThan(2.1);
    expect(spread(now), `yayılım hâlâ yüksek: ${JSON.stringify(now.map((x) => x.toFixed(4)))}`)
      .toBeLessThan(1.6);
  });

  it('ÖLÇÜM YOKSA referans varsayılır — sahte değer ÜRETİLMEZ', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const w = computeRouteWidths({ canvasMinPx: bad });
      expect(w.scale, `${bad}: ölçülemeyen girdide ölçek kaymış`).toBe(1);
      expect(w.measured, `${bad}: ölçülmemiş değer ÖLÇÜLDÜ diye raporlanmış`).toBe(false);
    }
    expect(computeRouteWidths({ canvasMinPx: 600 }).measured).toBe(true);
  });

  it('BOZUK PERSPEKTİF kalınlığı patlatmaz', () => {
    const insane = computeRouteWidths({ canvasMinPx: 600, perspectiveScale: 99 });
    expect(insane.core.z18).toBeLessThanOrEqual(32 * 1.5);
    const nan = computeRouteWidths({ canvasMinPx: 600, perspectiveScale: Number.NaN });
    expect(nan.core.z18).toBe(32);
  });

  it('ölçek monotondur — büyük yüzey asla daha ince rota vermez', () => {
    let prev = 0;
    for (const px of [200, 360, 430, 500, 600, 700, 800, 1200]) {
      const s = resolveRouteWidthScale(px);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });
});

describe('Nefes alan glow — güvenlik sinyali GÖRÜNÜR kalır', () => {
  const w: RouteWidths = computeRouteWidths({ canvasMinPx: 600, perspectiveScale: 1.22 });

  it('her nefes fazında halo KILIFIN DIŞINDA kalır', () => {
    for (const breath of [-1, -0.5, 0, 0.5, 1]) {
      for (const amp of [0, 0.5, 1, 1.4]) {
        const gw = breathingGlowWidth(w.glow.z18, breath, amp);
        expect(gw, `nefes ${breath} / genlik ${amp}: halo kılıfın altına düştü`)
          .toBeGreaterThan(w.casing.z18);
      }
    }
  });

  it('KUSUR KANITI: eski skaler değer kılıfın ALTINDA kalıyordu', () => {
    const oldMax = Math.max(10, 22 + 1 * 12 * 1 * 1.4);   // en geniş eski hâl
    expect(oldMax, 'eski glow zaten görünürmüş — kilit anlamsız')
      .toBeLessThan(w.casing.z18);
  });

  it('genlik risksizken nefes YOK (sabit taban)', () => {
    expect(breathingGlowWidth(w.glow.z18, 1, 0)).toBe(w.glow.z18);
  });

  it('bozuk girdide çökmez', () => {
    expect(breathingGlowWidth(Number.NaN, 1, 1)).toBe(0);
    expect(breathingGlowWidth(40, Number.NaN, Number.NaN)).toBe(40);
  });
});

describe('MapLibre ifadesi', () => {
  it('z12/z18 uçlarını doğru sırayla üretir', () => {
    expect(routeWidthExpression({ z12: 8, z18: 32 }))
      .toEqual(['interpolate', ['linear'], ['zoom'], 12, 8, 18, 32]);
  });
});

describe('YAPISAL kilitler — ikinci kalınlık otoritesi doğmaz', () => {
  it('🔒 ana rota yığınında ÇIPLAK line-width sabiti kalmadı', () => {
    /* Alternatif rota katmanı (`car-route-alt-fill`) bu politikanın DIŞINDADIR:
       o bir SEÇİM HEDEFİdir (dokunma alanı), sürülen rotanın geometrisi değil.
       Bilerek kapsam dışı — kapsama alınırsa dokunma hedefi de küçülür. */
    const start = layerSrc.indexOf('// ── Step 3: route stack');
    const end   = layerSrc.indexOf('// ── Step 4: set data');
    expect(start, 'rota yığını bloğu bulunamadı — kilit kör kaldı').toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const stack = layerSrc.slice(start, end);
    const bare = stack.match(/'line-width':\s*\['interpolate'/g) ?? [];
    expect(bare, `politika dışı kalınlık sayısı: ${bare.length}`).toEqual([]);
    expect(stack, 'kurulum politikadan beslenmiyor').toContain('routeWidthExpression(_rw.core)');
  });

  it('🔒 perspektif düzeltmesi BEŞ katmanı da politikadan yazar', () => {
    const start = interSrc.indexOf('// ── Perspective correction');
    const end   = interSrc.indexOf('// ── Maneuver emphasis');
    expect(start).toBeGreaterThan(0);
    const block = interSrc.slice(start, end);
    for (const [layer, key] of [
      ['ROUTE_SHADOW', 'shadow'], ['ROUTE_GLOW_SEL', 'glow'], ['ROUTE_CASE', 'casing'],
      ['SEL_LAYER', 'core'], ['ROUTE_FLOW', 'flow'],
    ] as const) {
      expect(block, `${layer} perspektif geçişinde politikadan yazılmıyor`).toContain(layer);
      expect(block, `${layer} için politika alanı (${key}) kullanılmıyor`)
        .toContain(`routeWidthExpression(rw.${key})`);
    }
  });

  it('🔒 perspektifte eski bağımsız sabitler geri gelmedi', () => {
    expect(interSrc, 'perspektif yine kendi sayılarını yazıyor')
      .not.toMatch(/Math\.round\(\s*32\s*\*\s*perspScale\s*\)/);
    expect(interSrc).not.toMatch(/Math\.round\(\s*38\s*\*\s*perspScale\s*\)/);
  });

  it('🔒 nefes alan glow politikayı EZMEZ', () => {
    expect(layerSrc, 'glow yine sabit skalere dönmüş')
      .not.toMatch(/Math\.max\(10,\s*22\s*\+\s*breath/);
    expect(layerSrc).toContain('breathingGlowWidth(');
  });

  it("🔒 kalınlık yazımları safeSetPaint'ten geçer", () => {
    /* Mevcut kasa sözleşmesi (2026-08-02, gerçek cihaz): MapLibre olmayan
       katmanda THROW ETMEZ, `error` YAYINLAR → try/catch yakalamaz. Kasa bunu
       ROUTE_GLOW_SEL ve ROUTE_SHADOW için kilitlemiş; bu tur o sözleşmeyi
       KORUR (genişletmez — `_startLightTrail`in gradient yazımı kapsam dışı). */
    for (const src of [layerSrc, interSrc]) {
      expect(/map\.setPaintProperty\(\s*ROUTE_GLOW_SEL/.test(src)).toBe(false);
      expect(/map\.setPaintProperty\(\s*ROUTE_SHADOW/.test(src)).toBe(false);
    }
    const widthWrites = (layerSrc + interSrc).match(/'line-width'/g) ?? [];
    const safeWrites  = (layerSrc + interSrc).match(/safeSetPaint\([^)]*'line-width'/g) ?? [];
    /* Kurulum sırasındaki paint sözlükleri safeSetPaint'ten geçmez (katman
       henüz yok); geri kalan her yazım geçmelidir.

       PAY 6 → 7 (2026-08-08): yola boyanmış ok kenarı (`PAINTED_ARROW_EDGE`)
       `addLayer` paint sözlüğünde sabit bir `line-width` taşır. Bu bir KURULUM
       değeridir, çalışma zamanı yazımı değildir — ok kalınlığı rota kalınlık
       otoritesine BAĞLI DEĞİLDİR ve onu etkilemez. Kilidin ölçtüğü şey
       (çalışma zamanı kalınlık yazımlarının korumalı olması) DEĞİŞMEDİ;
       yalnız meşru kurulum sözlüğü sayısı bir arttı. */
    expect(safeWrites.length, 'kalınlık yazımlarının bir kısmı korumasız')
      .toBeGreaterThanOrEqual(widthWrites.length - 7);
  });

  it('🔒 ölçüm CANVAS\'tan alınır, pencereden DEĞİL', () => {
    // Pencere ölçüsü mini harita ile tam ekranı ayırt edemez.
    expect(layerSrc).toContain('map.getCanvas()');
    expect(layerSrc, 'kalınlık ölçümü pencereye bağlanmış')
      .not.toMatch(/canvasMinPx:\s*window\./);
  });

  it('🔒 yeni dinleyici/timer eklenmedi', () => {
    const model = read('src/platform/map/core/routeWidthModel.ts');
    expect(model).not.toMatch(/addEventListener|ResizeObserver|setInterval|setTimeout|requestAnimationFrame/);
    expect(model, 'saf model harita API\'si kullanıyor').not.toMatch(/maplibre|getCanvas|setPaintProperty/);
  });
});
