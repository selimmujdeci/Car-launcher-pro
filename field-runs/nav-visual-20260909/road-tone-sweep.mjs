/* GECE YOL TONU SÜPÜRMESİ — "ekranın en parlak öğesi neden yerel sokak?"
 *
 * Kullanıcı 2026-09-09'da Google gece navigasyonuyla yan yana koyup "amatör"
 * dedi. İki ekran arasındaki tek yapısal fark ölçüldü: bizde yol gövdesi SAF
 * BEYAZ ailesindedir ve ROTADAN PARLAKTIR; Google'da yollar orta tondadır,
 * ekranın en parlak öğesi ROTADIR.
 *
 * Bu script aynı sahneyi (rota dahil, üretim genişlikleriyle) aday paletlerle
 * render eder ve şu üç sayıyı ölçer:
 *   · rota_L / yol_L   → 1'in ALTI = yol rotadan parlak (bugünkü kusur)
 *   · yol ↔ zemin kontrastı (mevcut kilit: minor ≥ 3,0)
 *   · ekranda parlak (L>170) piksel oranı
 */
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] || process.cwd();
globalThis.__VITE_ENV__ = { VITE_VECTOR_TILE_URL: 'https://tiles.openfreemap.org/planet' };
const S = await import('./style.mjs');
const RW = await import('./routeWidth.mjs');
const mlJs = fs.readFileSync(path.join(ROOT, 'node_modules/maplibre-gl/dist/maplibre-gl.js'), 'utf8');
const W = 900, H = 1000;
const CENTER = [34.6060, 36.7830], ZOOM = 17, PITCH = 44;
const widths = RW.computeRouteWidths({ canvasMinPx: W, perspectiveScale: 1 + (PITCH / 72) * 0.4 });

/* Aday paletler — motorway · primary · secondary · tertiary · minor */
const ADAYLAR = {
  'A-mevcut':     ['#ffffff', '#f9fbfc', '#f2f5f8', '#ecf0f5', '#e9edf2'],
  'B-hafif':      ['#eaeff6', '#d9e0ea', '#c9d2df', '#bcc6d5', '#b3bdcd'],
  'C-google':     ['#d6dee9', '#bcc6d5', '#a7b2c3', '#98a4b7', '#8d99ac'],
  'D-agresif':    ['#c2cddc', '#a6b2c4', '#8f9cb0', '#8插'.slice(0,1) + '2909f', '#78849a'],
};
ADAYLAR['D-agresif'][3] = '#829099';

const lum = (hex) => {
  const v = parseInt(hex.slice(1), 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => {
    const s = x / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const BG = '#222c3c', ROTA_CORE = '#52A0F0';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(`<style>html,body{margin:0;height:100%}#m{position:absolute;inset:0}</style><div id="m"></div><script>${mlJs}</script>`);
const style = S.buildVectorStyle(new Map(), () => ({ version: 8, sources: {}, layers: [] }), true);
style.glyphs = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';
await page.evaluate(({ style, CENTER, ZOOM, PITCH }) => {
  window.map = new maplibregl.Map({ container: 'm', style, center: CENTER, zoom: ZOOM,
    bearing: 15, pitch: PITCH, maxPitch: 85, attributionControl: false, fadeDuration: 0,
    padding: { top: 300, bottom: 0, left: 0, right: 0 } });
  return new Promise((r) => window.map.once('idle', r));
}, { style, CENTER, ZOOM, PITCH });

/* Gerçek bir arter üzerine üretim rotası. */
await page.evaluate(({ widths }) => {
  const feats = window.map.queryRenderedFeatures({
    layers: ['road-primary', 'road-secondary'].filter((id) => window.map.getLayer(id)) });
  let best = null, bl = 0;
  for (const f of feats) {
    const g = f.geometry; if (!g || g.type !== 'LineString' || g.coordinates.length < 4) continue;
    let l = 0; for (let i = 1; i < g.coordinates.length; i++)
      l += Math.hypot(g.coordinates[i][0] - g.coordinates[i - 1][0], g.coordinates[i][1] - g.coordinates[i - 1][1]);
    if (l > bl) { bl = l; best = g; }
  }
  if (!best) return;
  window.map.addSource('r', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: best } });
  const w = (lw) => ['interpolate', ['linear'], ['zoom'], 12, lw.z12, 18, lw.z18];
  const L = { 'line-cap': 'round', 'line-join': 'round' };
  window.map.addLayer({ id: 'r-glow', type: 'line', source: 'r', layout: L,
    paint: { 'line-color': '#4285f4', 'line-width': w(widths.glow), 'line-blur': 8, 'line-opacity': 0.55 } });
  window.map.addLayer({ id: 'r-case', type: 'line', source: 'r', layout: L,
    paint: { 'line-color': '#ffffff', 'line-width': w(widths.casing) } });
  window.map.addLayer({ id: 'r-core', type: 'line', source: 'r', layout: L,
    paint: { 'line-color': '#52A0F0', 'line-width': w(widths.core) } });
}, { widths });

const rows = [];
for (const [ad, p] of Object.entries(ADAYLAR)) {
  const bright = await page.evaluate(({ p }) => {
    const map = { 'road-motorway': p[0], 'road-primary': p[1], 'road-secondary': p[2],
      'road-tertiary': p[3], 'road-minor': p[4], 'road-service': p[4] };
    for (const [id, c] of Object.entries(map)) {
      if (map && window.map.getLayer(id)) window.map.setPaintProperty(id, 'line-color', c);
    }
    window.map.triggerRepaint();
    return new Promise((res) => window.map.once('idle', () => {
      const cv = window.map.getCanvas(); const g = document.createElement('canvas');
      g.width = cv.width; g.height = cv.height;
      g.getContext('2d').drawImage(cv, 0, 0);
      const d = g.getContext('2d').getImageData(0, 0, g.width, g.height).data;
      let b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        n++; if (l > 170) b++;
      }
      res(+(100 * b / n).toFixed(2));
    }));
  }, { p });
  await page.screenshot({ path: path.join(HERE, `tone-${ad}.png`) });
  rows.push({
    aday: ad, minor: p[4],
    'rota/yol': +(lum(ROTA_CORE) / lum(p[4])).toFixed(2),
    'minor↔zemin': +cr(BG, p[4]).toFixed(2),
    'motorway↔zemin': +cr(BG, p[0]).toFixed(2),
    'rota↔yol': +cr(p[4], ROTA_CORE).toFixed(2),
    'parlak%': bright,
  });
}
console.table(rows);
fs.writeFileSync(path.join(HERE, 'road-tone-sweep.json'), JSON.stringify(rows, null, 2));
await browser.close();
