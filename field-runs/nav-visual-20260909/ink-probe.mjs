/* MÜREKKEP BÜTÇESİ ÖLÇÜMÜ — "beyaz tel kafes" hangi katmandan geliyor?
 *
 * Yöntem: tek değişkenli. Aynı kare, sırayla TEK katman gizlenir; ekrandaki
 * PARLAK piksel oranındaki düşüş o katmanın mürekkep payıdır. Tahmin yok.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] || process.cwd();
globalThis.__VITE_ENV__ = { VITE_VECTOR_TILE_URL: 'https://tiles.openfreemap.org/planet' };
const S = await import('./style.mjs');
const mlJs = fs.readFileSync(path.join(ROOT, 'node_modules/maplibre-gl/dist/maplibre-gl.js'), 'utf8');

const W = 904, H = 406, CENTER = [29.03, 40.99], BEARING = 20;
const ZOOM = +(process.env.ZOOM ?? 15.5), PITCH = +(process.env.PITCH ?? 47);
const NIGHT = process.env.NIGHT !== '0';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(`<style>html,body{margin:0;height:100%}#m{position:absolute;inset:0}</style><div id="m"></div><script>${mlJs}</script>`);

const style = S.buildVectorStyle(new Map(), () => ({ version: 8, sources: {}, layers: [] }), NIGHT);
style.glyphs = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

await page.evaluate(({ style, CENTER, ZOOM, BEARING, PITCH }) => {
  window.map = new maplibregl.Map({ container: 'm', style, center: CENTER, zoom: ZOOM,
    bearing: BEARING, pitch: PITCH, maxPitch: 85, attributionControl: false, fadeDuration: 0 });
  return new Promise((r) => window.map.once('idle', r));
}, { style, CENTER, ZOOM, BEARING, PITCH });

/** Parlaklık histogramı — canvas'tan doğrudan (PNG çözmeye gerek yok). */
async function measure() {
  return page.evaluate(() => new Promise((res) => {
    window.map.triggerRepaint();
    window.map.once('idle', () => {
      const cv = window.map.getCanvas();
      const g = document.createElement('canvas');
      g.width = cv.width; g.height = cv.height;
      const ctx = g.getContext('2d');
      ctx.drawImage(cv, 0, 0);
      const d = ctx.getImageData(0, 0, g.width, g.height).data;
      let bright = 0, sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        sum += l; n++;
        if (l > 170) bright++;               // "beyaz tel" eşiği
      }
      res({ brightPct: +(100 * bright / n).toFixed(2), meanL: +(sum / n).toFixed(1) });
    });
  }));
}

const base = await measure();
console.log(`TABAN (z${ZOOM} pitch${PITCH} ${NIGHT ? 'gece' : 'gündüz'}): parlak=%${base.brightPct} ortL=${base.meanL}`);

const LAYERS = ['road-minor', 'road-service', 'road-tertiary', 'road-secondary',
  'road-primary', 'road-motorway', 'road-minor-casing', 'building', 'road-path'];
const rows = [];
for (const id of LAYERS) {
  const ok = await page.evaluate((id) => {
    if (!window.map.getLayer(id)) return false;
    window.map.setLayoutProperty(id, 'visibility', 'none'); return true;
  }, id);
  if (!ok) { rows.push({ katman: id, durum: 'KATMAN YOK' }); continue; }
  const m = await measure();
  await page.evaluate((id) => window.map.setLayoutProperty(id, 'visibility', 'visible'), id);
  rows.push({ katman: id, parlakPay: +(base.brightPct - m.brightPct).toFixed(2),
    payYuzde: +(100 * (base.brightPct - m.brightPct) / base.brightPct).toFixed(1) });
}
console.table(rows);
fs.writeFileSync(path.join(HERE, `ink-z${ZOOM}-p${PITCH}-${NIGHT ? 'gece' : 'gun'}.json`),
  JSON.stringify({ base, rows }, null, 2));
await browser.close();
