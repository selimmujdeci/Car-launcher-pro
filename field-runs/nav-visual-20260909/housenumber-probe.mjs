/* KAPI NUMARASI EŞİĞİ — sürüş zoom bandında ekranı dolduruyor mu?
 * cameraEngine ölçülen zoom eğrisi: 0 km/sa → 18,5 · 30 → 17,5 · 60 → 16,7. */
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
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
  window.map = new maplibregl.Map({ container: 'm', style, center: [29.03, 40.99], zoom: 17,
    bearing: 20, pitch: 44, maxPitch: 85, attributionControl: false, fadeDuration: 0 });
  return new Promise((r) => window.map.once('idle', r));
}, style);
const rows = [];
for (const [zoom, hiz] of [[16.7, '60 km/sa'], [17.5, '30 km/sa'], [18.0, '~15 km/sa'], [18.5, 'DURAK']]) {
  const r = await page.evaluate((zoom) => {
    window.map.jumpTo({ zoom, padding: { top: 130, bottom: 0, left: 0, right: 0 } });
    return new Promise((res) => window.map.once('idle', () => {
      const q = (id) => { try { return window.map.getLayer(id) ? window.map.queryRenderedFeatures({ layers: [id] }).length : -1; } catch { return -1; } };
      res({ kapiNo: q('housenumber'), sokakAdi: q('road-label'), anaYol: q('road-label-major') });
    }));
  }, zoom);
  rows.push({ zoom, hiz, ...r, toplam: Math.max(0, r.kapiNo) + Math.max(0, r.sokakAdi) + Math.max(0, r.anaYol) });
}
console.table(rows);
await browser.close();
