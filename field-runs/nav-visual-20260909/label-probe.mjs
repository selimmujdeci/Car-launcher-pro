/* ETİKET BÜTÇESİ ÖLÇÜMÜ — hangi zoomda ekranda kaç etiket çiziliyor,
 * hangileri sürüş kararına girer? `queryRenderedFeatures` GERÇEKTEN çizilmiş
 * sembolleri döndürür (collision motorundan geçmiş olanları). */
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] || process.cwd();
globalThis.__VITE_ENV__ = { VITE_VECTOR_TILE_URL: 'https://tiles.openfreemap.org/planet' };
const S = await import('./style.mjs');
const mlJs = fs.readFileSync(path.join(ROOT, 'node_modules/maplibre-gl/dist/maplibre-gl.js'), 'utf8');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 904, height: 406 }, deviceScaleFactor: 1 });
await page.setContent(`<style>html,body{margin:0;height:100%}#m{position:absolute;inset:0}</style><div id="m"></div><script>${mlJs}</script>`);
const style = S.buildVectorStyle(new Map(), () => ({ version: 8, sources: {}, layers: [] }), true);
style.glyphs = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';
await page.evaluate((style) => {
  window.map = new maplibregl.Map({ container: 'm', style, center: [29.03, 40.99], zoom: 16.7,
    bearing: 20, pitch: 44, maxPitch: 85, attributionControl: false, fadeDuration: 0 });
  return new Promise((r) => window.map.once('idle', r));
}, style);

const SYMBOL_LAYERS = ['road-label', 'road-label-major', 'road-shield', 'place-city',
  'place-town', 'place-village', 'place-suburb', 'water-label', 'housenumber',
  'poi-gas', 'poi-hospital', 'poi-police', 'poi-parking'];
const rows = [];
for (const [zoom, pitch] of [[14, 44], [15.5, 47], [16.7, 44], [17.5, 40]]) {
  const r = await page.evaluate(({ zoom, pitch, SYMBOL_LAYERS }) => {
    window.map.jumpTo({ zoom, pitch, padding: { top: 130, bottom: 0, left: 0, right: 0 } });
    return new Promise((res) => window.map.once('idle', () => {
      const out = {}; let total = 0;
      for (const id of SYMBOL_LAYERS) {
        if (!window.map.getLayer(id)) continue;
        let n = 0;
        try { n = window.map.queryRenderedFeatures({ layers: [id] }).length; } catch { n = -1; }
        if (n > 0) out[id] = n;
        if (n > 0) total += n;
      }
      res({ total, ...out });
    }));
  }, { zoom, pitch, SYMBOL_LAYERS });
  rows.push({ zoom, pitch, ...r });
}
console.table(rows);
fs.writeFileSync(path.join(HERE, 'label-probe.json'), JSON.stringify(rows, null, 2));
await browser.close();
