/* YEREL AĞ (minor) MÜREKKEP SÜPÜRMESİ — tek değişkenli.
 * Soru: z15–16 bandında yerel gövdeyi daraltmak "beyaz tel kafes"i ne kadar keser,
 * ve sürüş zoom'unda (z16.7) yerel sokak OKUNUR kalır mı? */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] || process.cwd();
globalThis.__VITE_ENV__ = { VITE_VECTOR_TILE_URL: 'https://tiles.openfreemap.org/planet' };
const S = await import('./style.mjs');
const mlJs = fs.readFileSync(path.join(ROOT, 'node_modules/maplibre-gl/dist/maplibre-gl.js'), 'utf8');
const W = 904, H = 406, CENTER = [29.03, 40.99], BEARING = 20;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(`<style>html,body{margin:0;height:100%}#m{position:absolute;inset:0}</style><div id="m"></div><script>${mlJs}</script>`);

const style = S.buildVectorStyle(new Map(), () => ({ version: 8, sources: {}, layers: [] }), true);
style.glyphs = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

async function load(zoom, pitch) {
  await page.evaluate(({ style, CENTER, zoom, BEARING, pitch }) => {
    if (window.map) window.map.remove();
    window.map = new maplibregl.Map({ container: 'm', style, center: CENTER, zoom,
      bearing: BEARING, pitch, maxPitch: 85, attributionControl: false, fadeDuration: 0 });
    return new Promise((r) => window.map.once('idle', r));
  }, { style, CENTER, zoom, BEARING, pitch });
}
async function measure() {
  return page.evaluate(() => new Promise((res) => {
    window.map.triggerRepaint();
    window.map.once('idle', () => {
      const cv = window.map.getCanvas(); const g = document.createElement('canvas');
      g.width = cv.width; g.height = cv.height;
      const ctx = g.getContext('2d'); ctx.drawImage(cv, 0, 0);
      const d = ctx.getImageData(0, 0, g.width, g.height).data;
      let bright = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        n++; if (l > 170) bright++;
      }
      res(+(100 * bright / n).toFixed(2));
    });
  }));
}
/** `road-minor` gövdesini k çarpanıyla yeniden yazar (yalnız ÖLÇÜM için). */
async function setMinorScale(k) {
  await page.evaluate((k) => {
    const stops = [[13, 0.9], [14, 2.2], [16, 4], [18, 7.4]];
    const expr = ['interpolate', ['linear'], ['zoom']];
    for (const [z, w] of stops) expr.push(z, Math.round(w * 0.72 * k * 100) / 100);
    window.map.setPaintProperty('road-minor', 'line-width', expr);
  }, k);
}

const rows = [];
for (const [zoom, pitch, ad] of [[15.5, 47, 'uzak/otoyol'], [16.0, 40, 'yol'], [16.7, 30, 'sürüş/şehir']]) {
  await load(zoom, pitch);
  for (const k of [1.0, 0.85, 0.7, 0.55]) {
    await setMinorScale(k);
    const b = await measure();
    rows.push({ sahne: ad, zoom, minorCarpan: k,
      minorGenislikPx: +(0.72 * k * (zoom <= 14 ? 2.2 : 2.2 + (4 - 2.2) * (zoom - 14) / 2)).toFixed(2),
      parlakYuzde: b });
    if (k === 0.7 || k === 1.0) {
      await page.screenshot({ path: path.join(HERE, `minor-${ad.replace(/[^a-z]/gi, '')}-k${k}.png`) });
    }
  }
}
console.table(rows);
fs.writeFileSync(path.join(HERE, 'minor-sweep.json'), JSON.stringify(rows, null, 2));
await browser.close();
