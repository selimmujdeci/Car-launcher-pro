/* ADAY E — "rota ekranın EN PARLAK öğesi olsun" (Google sözleşmesi).
 * Yol ailesinin TAMAMI rota çekirdeğinin ALTINA indirilir; bina/yapılı alan
 * navigasyonda daha az söndürülür. Aynı sahne, mevcut ↔ aday karşılaştırması. */
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] || process.cwd();
globalThis.__VITE_ENV__ = { VITE_VECTOR_TILE_URL: 'https://tiles.openfreemap.org/planet' };
const S = await import('./style.mjs');
const RW = await import('./routeWidth.mjs');
const mlJs = fs.readFileSync(path.join(ROOT, 'node_modules/maplibre-gl/dist/maplibre-gl.js'), 'utf8');
const W = 900, H = 1000, CENTER = [34.6060, 36.7830], ZOOM = 17, PITCH = 44;
const widths = RW.computeRouteWidths({ canvasMinPx: W, perspectiveScale: 1 + (PITCH / 72) * 0.4 });
const E = { motorway: '#8792a5', primary: '#7d8898', secondary: '#737d8d', tertiary: '#6a7383', minor: '#5c6575' };

const lum = (hex) => { const v = parseInt(hex.slice(1), 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => { const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(`<style>html,body{margin:0;height:100%}#m{position:absolute;inset:0}</style><div id="m"></div><script>${mlJs}</script>`);
const style = S.buildVectorStyle(new Map(), () => ({ version: 8, sources: {}, layers: [] }), true);
style.glyphs = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';
await page.evaluate(({ style, CENTER, ZOOM, PITCH }) => {
  window.map = new maplibregl.Map({ container: 'm', style, center: CENTER, zoom: ZOOM, bearing: 15,
    pitch: PITCH, maxPitch: 85, attributionControl: false, fadeDuration: 0,
    padding: { top: 300, bottom: 0, left: 0, right: 0 } });
  return new Promise((r) => window.map.once('idle', r));
}, { style, CENTER, ZOOM, PITCH });

await page.evaluate(({ widths }) => {
  const feats = window.map.queryRenderedFeatures({ layers: ['road-primary', 'road-secondary'].filter((i) => window.map.getLayer(i)) });
  let best = null, bl = 0;
  for (const f of feats) { const g = f.geometry; if (!g || g.type !== 'LineString' || g.coordinates.length < 4) continue;
    let l = 0; for (let i = 1; i < g.coordinates.length; i++) l += Math.hypot(g.coordinates[i][0] - g.coordinates[i-1][0], g.coordinates[i][1] - g.coordinates[i-1][1]);
    if (l > bl) { bl = l; best = g; } }
  window.map.addSource('r', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: best } });
  const w = (lw) => ['interpolate', ['linear'], ['zoom'], 12, lw.z12, 18, lw.z18];
  const L = { 'line-cap': 'round', 'line-join': 'round' };
  window.map.addLayer({ id: 'r-glow', type: 'line', source: 'r', layout: L, paint: { 'line-color': '#4285f4', 'line-width': w(widths.glow), 'line-blur': 8, 'line-opacity': 0.55 } });
  window.map.addLayer({ id: 'r-case', type: 'line', source: 'r', layout: L, paint: { 'line-color': '#ffffff', 'line-width': w(widths.casing) } });
  window.map.addLayer({ id: 'r-core', type: 'line', source: 'r', layout: L, paint: { 'line-color': '#52A0F0', 'line-width': w(widths.core) } });
}, { widths });

/* ÖNCE: bugünkü üretim + navigasyon declutter profili (bina 0,50 / 3B 0,40) */
await page.evaluate(() => {
  window.map.setPaintProperty('building', 'fill-opacity', 0.50);
  window.map.setPaintProperty('building-3d', 'fill-extrusion-opacity', 0.40);
  window.map.triggerRepaint(); return new Promise((r) => window.map.once('idle', r));
});
await page.screenshot({ path: path.join(HERE, 'FINAL-once.png') });

/* SONRA: aday E yol tonu + bina navigasyonda daha az söndürülür */
await page.evaluate((E) => {
  const m = { 'road-motorway': E.motorway, 'road-primary': E.primary, 'road-secondary': E.secondary,
    'road-tertiary': E.tertiary, 'road-minor': E.minor, 'road-service': E.minor };
  for (const [id, c] of Object.entries(m)) if (window.map.getLayer(id)) window.map.setPaintProperty(id, 'line-color', c);
  window.map.setPaintProperty('building', 'fill-opacity', 0.85);
  window.map.setPaintProperty('building-3d', 'fill-extrusion-opacity', 0.70);
  window.map.triggerRepaint(); return new Promise((r) => window.map.once('idle', r));
}, E);
await page.screenshot({ path: path.join(HERE, 'FINAL-sonra.png') });

const BG = '#222c3c', R = '#52A0F0';
console.table([
  { ölçüt: 'rota / yerel yol parlaklık', mevcut: +(lum(R) / lum('#e9edf2')).toFixed(2), adayE: +(lum(R) / lum(E.minor)).toFixed(2), hedef: '>1 = rota daha parlak' },
  { ölçüt: 'rota / OTOYOL parlaklık',    mevcut: +(lum(R) / lum('#ffffff')).toFixed(2), adayE: +(lum(R) / lum(E.motorway)).toFixed(2), hedef: '>1' },
  { ölçüt: 'rota ↔ yerel yol kontrast',  mevcut: +cr('#e9edf2', R).toFixed(2), adayE: +cr(E.minor, R).toFixed(2), hedef: '≥1,9 (kilit)' },
  { ölçüt: 'yerel yol ↔ zemin',          mevcut: +cr(BG, '#e9edf2').toFixed(2), adayE: +cr(BG, E.minor).toFixed(2), hedef: 'Google 1,31' },
  { ölçüt: 'otoyol ↔ zemin',             mevcut: +cr(BG, '#ffffff').toFixed(2), adayE: +cr(BG, E.motorway).toFixed(2), hedef: 'Google 2,48' },
  { ölçüt: 'kasa ↔ yerel gövde',         mevcut: +cr('#0e131b', '#e9edf2').toFixed(2), adayE: +cr('#0e131b', E.minor).toFixed(2), hedef: '≥3,0 (kilit)' },
]);
await browser.close();
