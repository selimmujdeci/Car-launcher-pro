/**
 * routeLayerInspector.test.ts — #623 KİLİDİ (CAROS LAB · Rota Katman Denetçisi)
 *
 * Bu ekran #622'nin açık borcunu kapatmak için var: cihazda rota EKRANDA soluk
 * ölçüldü (çekirdek lum 0,128–0,184 · hedef 0,42) ama kök teşhis edilemedi,
 * çünkü `apk:safe` artefaktında CDP kapalıdır ve MapLibre'nin GERÇEK paint
 * değerleri okunamıyordu.
 *
 * KİLİTLENEN SÖZLEŞMELER:
 *   1. Gözlem yolu SALT-OKUNURDUR — haritaya tek bir yazma bile yapmaz.
 *   2. Kanıtsız bilgi ÜRETİLMEZ — okunamayan alan UNAVAILABLE, sahte 0/renk YOK.
 *   3. Model SAFTIR — `Date.now`/I/O/timer yok; zaman DIŞARIDAN verilir.
 *   4. Teşhis kuralları gerçekten TETİKLENİR (kural yazıp körlemesine geçmek yok).
 *
 * Kilitler ZAYIFLATILMAZ/SİLİNMEZ; davranış bilinçli değişirse GÜNCELLENİR.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  captureRouteLayerProbe, rememberRouteLayerProbe, getLastRouteLayerProbe,
  _resetRouteLayerProbeForTest, ROUTE_LAYER_ORDER, type RouteLayerProbe,
} from '../platform/map/routeLayerProbe';
import {
  buildRouteLayerView, deriveRouteFindings, hexLuminance,
  ROUTE_PROBE_FRESH_WINDOW_MS,
} from '../platform/devtools/routeLayerModel';
import { CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';
import { resolveRouteColor } from '../platform/map/core/routeColorModel';

/* ── Sahte MapLibre — YAZMA çağrılarını SAYAR ─────────────────────────────── */
interface FakePaint { [k: string]: unknown }

function makeFakeMap(opts: {
  layers?: Record<string, FakePaint>;
  lineMetrics?: boolean | undefined;
  sourcePresent?: boolean;
  styleLoaded?: boolean;
}) {
  const layers = opts.layers ?? {};
  const writes: string[] = [];
  const order = Object.keys(layers);
  const map = {
    isStyleLoaded: () => opts.styleLoaded !== false,
    getLayer: (id: string) => (layers[id] ? { id } : undefined),
    getSource: (_id: string) => (opts.sourcePresent === false ? undefined : { id: _id }),
    getPaintProperty: (id: string, prop: string) => layers[id]?.[prop],
    getStyle: () => ({
      layers: order.map((id) => ({ id })),
      sources: {
        'selected-route-source': opts.sourcePresent === false
          ? undefined
          : (opts.lineMetrics === undefined ? { type: 'geojson' } : { type: 'geojson', lineMetrics: opts.lineMetrics }),
      },
    }),
    // Yazma yüzeyleri — çağrılırsa kilit DÜŞER.
    setPaintProperty: (...a: unknown[]) => { writes.push(`setPaintProperty:${String(a[0])}`); },
    addLayer:   () => { writes.push('addLayer'); },
    removeLayer:() => { writes.push('removeLayer'); },
    addSource:  () => { writes.push('addSource'); },
    setStyle:   () => { writes.push('setStyle'); },
  };
  return { map, writes };
}

const CORE = 'selected-route-layer';
const FLOW = 'car-route-flow';
const CASE = 'car-route-casing';

describe('#623 — probe SALT-OKUNURDUR', () => {
  it('🔒 fotoğraf çekmek haritaya TEK BİR YAZMA bile yapmaz', () => {
    const { map, writes } = makeFakeMap({
      layers: {
        [CASE]: { 'line-color': '#ffffff', 'line-opacity': 0.95 },
        [CORE]: { 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#79b0ff', 1, '#34d399'], 'line-opacity': 1 },
      },
      lineMetrics: true,
    });
    captureRouteLayerProbe(map as never, 'test');
    expect(writes, `gözlem yolu haritaya yazdı: ${writes.join(', ')}`).toEqual([]);
  });

  it('🔒 harita yoksa UYDURMAZ — mapPresent:false, katman listesi boş', () => {
    const p = captureRouteLayerProbe(null, 'test');
    expect(p.mapPresent).toBe(false);
    expect(p.layers).toEqual([]);
    expect(p.sourceLineMetrics).toBeNull();
  });

  it('🔒 olmayan katman `present:false` — sahte renk/opaklık ÜRETİLMEZ', () => {
    const { map } = makeFakeMap({ layers: {}, lineMetrics: true });
    const p = captureRouteLayerProbe(map as never, 'test');
    for (const l of p.layers) {
      expect(l.present).toBe(false);
      expect(l.lineColor).toBeNull();
      expect(l.lineOpacity).toBeNull();
      expect(l.lineBlur).toBeNull();
    }
  });

  it('🔒 `line-color` AYARLANMAMIŞ ile "okunamadı" AYRIMI korunur', () => {
    /* Bu ayrım kusurun kendisidir: ayarlanmamış demek MapLibre'nin SİYAH
       varsayılanını çizdiği demektir — sessiz ölüm koşulu. */
    const { map } = makeFakeMap({ layers: { [CORE]: { 'line-opacity': 1 } }, lineMetrics: true });
    const p = captureRouteLayerProbe(map as never, 'test');
    const core = p.layers.find((l) => l.id === CORE)!;
    expect(core.present).toBe(true);
    expect(core.lineColorUnset).toBe(true);
    expect(core.hasGradient).toBe(false);
  });

  it('🔒 kaynakta `lineMetrics` alanı YOKSA `false` beyan edilir (MapLibre varsayılanı)', () => {
    const { map } = makeFakeMap({ layers: { [CORE]: {} }, lineMetrics: undefined });
    const p = captureRouteLayerProbe(map as never, 'test');
    expect(p.sourceLineMetrics).toBe(false);
  });

  it('🔒 gradient durakları okunur ve BOUNDED (en çok 8)', () => {
    const many = ['interpolate', ['linear'], ['line-progress']];
    for (let i = 0; i < 20; i++) many.push(i / 20, `#0000${(10 + i).toString(16)}`);
    const { map } = makeFakeMap({ layers: { [CORE]: { 'line-gradient': many } }, lineMetrics: true });
    const p = captureRouteLayerProbe(map as never, 'test');
    const core = p.layers.find((l) => l.id === CORE)!;
    expect(core.hasGradient).toBe(true);
    expect(core.gradientStops.length).toBeLessThanOrEqual(8);
  });

  it('🔒 z-sırası stil sırasından OKUNUR (örtme teşhisi buna dayanır)', () => {
    const { map } = makeFakeMap({
      layers: { [CORE]: { 'line-opacity': 1 }, [FLOW]: { 'line-opacity': 0.85 } },
      lineMetrics: true,
    });
    const p = captureRouteLayerProbe(map as never, 'test');
    const core = p.layers.find((l) => l.id === CORE)!;
    const flow = p.layers.find((l) => l.id === FLOW)!;
    expect(core.zIndex).not.toBeNull();
    expect(flow.zIndex).not.toBeNull();
    expect(flow.zIndex!).toBeGreaterThan(core.zIndex!);
  });

  it('🔒 katman sırası kurulum sırasıyla AYNI (alt → üst)', () => {
    expect([...ROUTE_LAYER_ORDER]).toEqual([
      'car-route-shadow', 'car-route-glow-sel', 'car-route-casing',
      'selected-route-layer', 'car-route-flow',
    ]);
  });

  it('son fotoğraf saklanır ve okunur (LAB harita unmount olsa da gösterebilsin)', () => {
    _resetRouteLayerProbeForTest();
    expect(getLastRouteLayerProbe()).toBeNull();
    const { map } = makeFakeMap({ layers: { [CORE]: { 'line-opacity': 1 } }, lineMetrics: true });
    const p = captureRouteLayerProbe(map as never, 'color');
    rememberRouteLayerProbe(p);
    expect(getLastRouteLayerProbe()?.reason).toBe('color');
    _resetRouteLayerProbeForTest();
  });
});

describe('#623 — teşhis kuralları GERÇEKTEN tetiklenir', () => {
  const base = (layers: Record<string, FakePaint>, lineMetrics: boolean | undefined) => {
    const { map } = makeFakeMap({ layers, lineMetrics });
    return captureRouteLayerProbe(map as never, 'test');
  };

  it('🔒 KÖK: gradient var ama `lineMetrics` KAPALI (sessiz ölüm koşulu)', () => {
    const p = base({
      [CORE]: { 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#79b0ff'], 'line-opacity': 1 },
    }, false);
    const f = deriveRouteFindings(p, null);
    const hit = f.find((x) => x.id === 'gradient-without-linemetrics');
    expect(hit, 'kural tetiklenmedi').toBeTruthy();
    expect(hit!.severity).toBe('ROOT');
  });

  it('🔒 `lineMetrics` AÇIKKEN aynı kural tetiklenmez (yanlış alarm yok)', () => {
    const p = base({
      [CORE]: { 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#79b0ff'], 'line-opacity': 1 },
    }, true);
    expect(deriveRouteFindings(p, null).some((x) => x.id === 'gradient-without-linemetrics')).toBe(false);
  });

  it('🔒 KÖK: çekirdek rengi AYARLANMAMIŞ → MapLibre siyahı', () => {
    const p = base({ [CORE]: { 'line-opacity': 1 } }, true);
    const hit = deriveRouteFindings(p, null).find((x) => x.id === 'core-color-unset');
    expect(hit?.severity).toBe('ROOT');
  });

  it('🔒 KÖK: çekirdek opaklığı 1,00 değil', () => {
    const p = base({ [CORE]: { 'line-color': '#79b0ff', 'line-opacity': 0.4 } }, true);
    const hit = deriveRouteFindings(p, null).find((x) => x.id === 'core-opacity-low');
    expect(hit?.severity).toBe('ROOT');
    expect(hit!.evidence).toContain('0.40');
  });

  it('🔒 KÖK: akış katmanı çekirdeğin üstünde ve gradient TAŞIMIYOR', () => {
    const p = base({
      [CORE]: { 'line-color': '#79b0ff', 'line-opacity': 1 },
      [FLOW]: { 'line-color': '#8899aa', 'line-opacity': 0.85 },
    }, true);
    const hit = deriveRouteFindings(p, null).find((x) => x.id === 'flow-masks-core');
    expect(hit?.severity).toBe('ROOT');
  });

  it('🔒 akış gradient TAŞIYORSA örtme kuralı tetiklenmez (pulse normaldir)', () => {
    const p = base({
      [CORE]: { 'line-color': '#79b0ff', 'line-opacity': 1 },
      [FLOW]: { 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(255,255,255,0)'], 'line-opacity': 0.85 },
    }, true);
    expect(deriveRouteFindings(p, null).some((x) => x.id === 'flow-masks-core')).toBe(false);
  });

  it('🔒 UYARI: haritadaki kılıf rengi KARARDAN farklıysa yakalanır', () => {
    const p = base({ [CASE]: { 'line-color': '#123456', 'line-opacity': 0.95 } }, true);
    const d = resolveRouteColor({ maneuverTier: 0, hazardHigh: false, lightBasemap: false });
    const hit = deriveRouteFindings(p, d).find((x) => x.id === 'casing-mismatch');
    expect(hit?.severity).toBe('WARN');
  });

  it('🔒 UYARI: çekirdek gradient ilk durağı karardan farklıysa yakalanır', () => {
    const p = base({
      [CORE]: { 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#000000'], 'line-opacity': 1 },
    }, true);
    const d = resolveRouteColor({ maneuverTier: 0, hazardHigh: false, lightBasemap: false });
    const hit = deriveRouteFindings(p, d).find((x) => x.id === 'core-gradient-mismatch');
    expect(hit?.severity).toBe('WARN');
  });

  it('SAĞLIKLI yığında hiçbir KÖK bulgusu ÜRETİLMEZ (yanlış alarm kilidi)', () => {
    const d = resolveRouteColor({ maneuverTier: 0, hazardHigh: false, lightBasemap: false });
    const p = base({
      'car-route-shadow':   { 'line-color': '#000000', 'line-opacity': 0.2, 'line-blur': 8 },
      'car-route-glow-sel': { 'line-color': d.glow, 'line-opacity': 0.2, 'line-blur': 10 },
      [CASE]: { 'line-color': d.casing, 'line-opacity': 0.95 },
      [CORE]: {
        'line-gradient': ['interpolate', ['linear'], ['line-progress'],
          0, d.coreStops[0], 0.5, d.coreStops[1], 1, d.coreStops[2]],
        'line-opacity': 1,
      },
      [FLOW]: { 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(255,255,255,0)'], 'line-opacity': 0.85 },
    }, true);
    const roots = deriveRouteFindings(p, d).filter((x) => x.severity === 'ROOT');
    expect(roots, `beklenmedik kök: ${roots.map((r) => r.id).join(', ')}`).toEqual([]);
  });
});

describe('#623 — model SAF ve DÜRÜST', () => {
  it('🔒 model dosyasında I/O · timer · Date.now · React YOK', () => {
    const src = readFileSync(join(process.cwd(), 'src/platform/devtools/routeLayerModel.ts'), 'utf8');
    const kod = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    for (const bad of ['Date.now', 'setTimeout', 'setInterval', 'fetch(', 'localStorage', "from 'react'"]) {
      expect(kod, `saf model içinde ${bad} var`).not.toContain(bad);
    }
  });

  it('🔒 fotoğraf yoksa UNAVAILABLE — "sağlıklı" DEMEZ', () => {
    const v = buildRouteLayerView(null, null, 1_000_000);
    expect(v.probeKlass).toBe('UNAVAILABLE');
    expect(v.findings).toEqual([]);
    expect(v.layerRows).toEqual([]);
  });

  it('🔒 STALE yalnız GERÇEK damga + TANIMLI eşikle verilir', () => {
    const { map } = makeFakeMap({ layers: { [CORE]: { 'line-opacity': 1 } }, lineMetrics: true });
    const p = captureRouteLayerProbe(map as never, 'color');
    const fresh = buildRouteLayerView(p, null, p.capturedAt + 1_000);
    const stale = buildRouteLayerView(p, null, p.capturedAt + ROUTE_PROBE_FRESH_WINDOW_MS + 1);
    expect(fresh.probeKlass).toBe('OBSERVED');
    expect(stale.probeKlass).toBe('STALE');
  });

  it('🔒 beklenen çekirdek parlaklığı DERIVED olarak gösterilir (#622 karşılaştırması)', () => {
    const d = resolveRouteColor({ maneuverTier: 0, hazardHigh: false, lightBasemap: false });
    const v = buildRouteLayerView(
      captureRouteLayerProbe(makeFakeMap({ layers: { [CORE]: {} }, lineMetrics: true }).map as never, 'test'),
      d, 1_000_000,
    );
    const row = v.rows.find((r) => r.id === 'decision-lum');
    expect(row?.klass).toBe('DERIVED');
    expect(Number(row!.value)).toBeGreaterThan(0.3);
  });

  it('parlaklık hesabı geçersiz renkte UYDURMAZ', () => {
    expect(hexLuminance('#ffffff')).toBeCloseTo(1, 3);
    expect(hexLuminance('yok')).toBeNull();
    expect(hexLuminance('rgba(1,2,3,0.5)')).toBeNull();
  });
});

describe('#623 — CAROS LAB kaydı', () => {
  it('🔒 katalogda AVAILABLE olarak kayıtlı', () => {
    const tool = CAROS_LAB_TOOLS.find((t) => t.id === 'route-layer-inspector');
    expect(tool, 'katalogda yok').toBeTruthy();
    expect(tool!.status).toBe('AVAILABLE');
    expect(tool!.category).toBe('runtime');
  });

  it('🔒 ekran haritasına bağlı (AVAILABLE ama ekranı yok tuzağı)', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/devtools/carosLabScreenMap.tsx'), 'utf8');
    expect(src).toContain("case 'route-layer-inspector':");
    expect(src).toContain('RouteLayerInspectorScreen');
  });

  it('🔒 ekran KOMUT göndermez — yazma API\'si içermez', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/devtools/screens/RouteLayerInspectorScreen.tsx'), 'utf8');
    const kod = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    for (const bad of ['setPaintProperty', 'addLayer', 'removeLayer', 'setStyle', 'setData', 'fetch(']) {
      expect(kod, `LAB ekranında yazma çağrısı: ${bad}`).not.toContain(bad);
    }
  });

  it('🔒 ekranda TIMER/POLLING yok (LAB deseni)', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/devtools/screens/RouteLayerInspectorScreen.tsx'), 'utf8');
    const kod = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    expect(kod).not.toContain('setInterval');
    expect(kod).not.toContain('setTimeout');
    // Unmount sonrası setState koruması ŞART (zero-leak).
    expect(kod).toContain('mountedRef');
  });
});

/* Yardımcı: probe tipini test içinde daralt (derleyici sözleşmesi). */
export type _EnsureProbeType = RouteLayerProbe;
