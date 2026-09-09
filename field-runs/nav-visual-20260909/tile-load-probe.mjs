/* KARO YÜKÜ ÖLÇÜMÜ — fov/pitch değişiminin maliyeti (bütçe kanıtı).
   `transform.coveringTiles` gerçek karo kaplamasını verir; tahmin değildir. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || process.cwd();
const mlJs = fs.readFileSync(path.join(ROOT, 'node_modules/maplibre-gl/dist/maplibre-gl.js'), 'utf8');
const W = 904, H = 406;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(`<style>html,body{margin:0;height:100%}#m{position:absolute;inset:0}</style><div id="m"></div><script>${mlJs}</script>`);
await page.evaluate(() => {
  window.map = new maplibregl.Map({ container: 'm',
    style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: {} }] },
    center: [29.03, 40.99], zoom: 16, pitch: 0, maxPitch: 85, attributionControl: false });
  return new Promise((r) => window.map.on('load', r));
});

const rows = [];
for (const fov of [36.87, 45, 50, 55, 60]) {
  for (const pitch of [30, 40, 47, 55, 60]) {
    const r = await page.evaluate(({ fov, pitch }) => {
      const t = window.map.transform;
      t.fov = fov; window.map.setPitch(pitch);
      /* OMT kaynağı: tileSize 512, maxzoom 14 (overzoom edilir). */
      const tiles = t.coveringTiles({ tileSize: 512, minzoom: 0, maxzoom: 14, roundZoom: false });
      return { tiles: tiles.length, horizon: +(t.height / 2 + t.getHorizon()).toFixed(0) };
    }, { fov, pitch });
    rows.push({ fov, pitch, ...r });
  }
}
console.table(rows);
await browser.close();
