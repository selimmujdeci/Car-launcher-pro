/* ROTA BASKINLIĞI ÖLÇÜMÜ (P1/P9) — rota gerçekten "tek bakışta dominant" mı?
 *
 * Rota geometrisi UYDURULMAZ: ekranda çizili gerçek bir arter
 * (`road-primary`/`road-secondary`) `querySourceFeatures` ile alınır ve rota
 * ONUN üzerinde çizilir. Genişlikler `routeWidthModel`in ÜRETİM çekirdeğinden,
 * renkler `routeColorModel` sabitlerinden gelir — sahne ikinci bir gerçek
 * kurmaz. */
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] || process.cwd();
globalThis.__VITE_ENV__ = { VITE_VECTOR_TILE_URL: 'https://tiles.openfreemap.org/planet' };
const S = await import('./style.mjs');
const RW = await import('./routeWidth.mjs');
const mlJs = fs.readFileSync(path.join(ROOT, 'node_modules/maplibre-gl/dist/maplibre-gl.js'), 'utf8');
const W = 904, H = 406;
const NIGHT = process.env.NIGHT !== '0';
const PITCH = +(process.env.PITCH ?? 44), ZOOM = +(process.env.ZOOM ?? 16.7);

/* ÜRETİM genişlikleri: canvas kısa kenarı 406, perspektif = 1 + (pitch/72)·0,4 */
const widths = RW.computeRouteWidths({ canvasMinPx: H, perspectiveScale: 1 + (PITCH / 72) * 0.4 });
const CASING = NIGHT ? '#ffffff' : '#0A0C10';
const CORE   = NIGHT ? '#52A0F0' : '#006CFF';
const GLOW   = '#4285f4';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(`<style>html,body{margin:0;height:100%}#m{position:absolute;inset:0}</style><div id="m"></div><script>${mlJs}</script>`);
const style = S.buildVectorStyle(new Map(), () => ({ version: 8, sources: {}, layers: [] }), NIGHT);
style.glyphs = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

await page.evaluate(({ style, ZOOM, PITCH }) => {
  window.map = new maplibregl.Map({ container: 'm', style, center: [29.03, 40.99], zoom: ZOOM,
    bearing: 20, pitch: PITCH, maxPitch: 85, attributionControl: false, fadeDuration: 0,
    padding: { top: 130, bottom: 0, left: 0, right: 0 } });
  return new Promise((r) => window.map.once('idle', r));
}, { style, ZOOM, PITCH });

const measure = () => page.evaluate(() => new Promise((res) => {
  window.map.triggerRepaint();
  window.map.once('idle', () => {
    const cv = window.map.getCanvas(); const g = document.createElement('canvas');
    g.width = cv.width; g.height = cv.height;
    g.getContext('2d').drawImage(cv, 0, 0);
    const d = g.getContext('2d').getImageData(0, 0, g.width, g.height).data;
    res(Array.from(d));
  });
}));

const before = await measure();

/* Ekrandaki en uzun arteri rota olarak kullan. */
const ok = await page.evaluate(({ widths, CASING, CORE, GLOW }) => {
  /* EKRANDA ÇİZİLİ olanlar (querySourceFeatures kadraj dışını da döndürüyordu). */
  const feats = window.map.queryRenderedFeatures({
    layers: ['road-primary', 'road-secondary'].filter((id) => window.map.getLayer(id)),
  });
  let best = null, bestLen = 0;
  for (const f of feats) {
    const g = f.geometry;
    if (!g || g.type !== 'LineString' || g.coordinates.length < 4) continue;
    let len = 0;
    for (let i = 1; i < g.coordinates.length; i++) {
      const [x1, y1] = g.coordinates[i - 1], [x2, y2] = g.coordinates[i];
      len += Math.hypot(x2 - x1, y2 - y1);
    }
    if (len > bestLen) { bestLen = len; best = g; }
  }
  if (!best) return false;
  window.map.addSource('caros-route', { type: 'geojson',
    data: { type: 'Feature', properties: {}, geometry: best } });
  const w = (lw) => ['interpolate', ['linear'], ['zoom'], 12, lw.z12, 18, lw.z18];
  const L = { 'line-cap': 'round', 'line-join': 'round' };
  window.map.addLayer({ id: 'r-glow', type: 'line', source: 'caros-route', layout: L,
    paint: { 'line-color': GLOW, 'line-width': w(widths.glow), 'line-blur': 8, 'line-opacity': 0.55 } });
  window.map.addLayer({ id: 'r-case', type: 'line', source: 'caros-route', layout: L,
    paint: { 'line-color': CASING, 'line-width': w(widths.casing) } });
  window.map.addLayer({ id: 'r-core', type: 'line', source: 'caros-route', layout: L,
    paint: { 'line-color': CORE, 'line-width': w(widths.core) } });
  return true;
}, { widths, CASING, CORE, GLOW });
if (!ok) { console.log('arter bulunamadı'); await browser.close(); process.exit(1); }

const after = await measure();
await page.screenshot({ path: path.join(HERE, `route-${NIGHT ? 'gece' : 'gun'}-z${ZOOM}.png`) });

/* Rota pikselleri = iki kare arasındaki fark. */
let n = 0, R = 0, G = 0, B = 0, tot = 0;
for (let i = 0; i < before.length; i += 4) {
  tot++;
  const d = Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]);
  if (d > 30) { n++; R += after[i]; G += after[i + 1]; B += after[i + 2]; }
}
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/* Çevre = rota OLMAYAN pikseller (öncesi kareden). */
let sn = 0, sl = 0, bright = 0;
for (let i = 0; i < before.length; i += 4) {
  const l = lum(before[i], before[i + 1], before[i + 2]);
  sn++; sl += l; if (l > 170) bright++;
}
const rl = lum(R / n, G / n, B / n);
console.log(`rota piksel oranı : %${(100 * n / tot).toFixed(2)}`);
console.log(`ekranda parlak yol: %${(100 * bright / sn).toFixed(2)}`);
console.log(`rota ort. renk    : rgb(${Math.round(R / n)},${Math.round(G / n)},${Math.round(B / n)})  L=${rl.toFixed(1)}`);
console.log(`basemap ort. L    : ${(sl / sn).toFixed(1)}`);
console.log(`rota/basemap L    : ${(rl / (sl / sn)).toFixed(2)}×`);
console.log(`rota genişlikleri : core z18=${widths.core.z18} casing=${widths.casing.z18} glow=${widths.glow.z18} (scale ${widths.scale})`);
fs.writeFileSync(path.join(HERE, `route-dominance-${NIGHT ? 'gece' : 'gun'}.json`),
  JSON.stringify({ zoom: ZOOM, pitch: PITCH, night: NIGHT, rotaPikselYuzde: +(100 * n / tot).toFixed(2),
    parlakYolYuzde: +(100 * bright / sn).toFixed(2), rotaL: +rl.toFixed(1),
    basemapL: +(sl / sn).toFixed(1), widths }, null, 2));
await browser.close();
