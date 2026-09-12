/* MİNİ HARİTA PİTCH DENETİMİ — aynı kamera eğrisi 440×210 yüzeyde ne yapıyor?
 * Ölçülen: ileri görüş · ufkun ekrana uzaklığı · karo yükü. */
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] || process.cwd();
globalThis.__VITE_ENV__ = { VITE_VECTOR_TILE_URL: 'https://tiles.openfreemap.org/planet' };
const S = await import('./style.mjs');
const mlJs = fs.readFileSync(path.join(ROOT, 'node_modules/maplibre-gl/dist/maplibre-gl.js'), 'utf8');
const W = 440, H = 210;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(`<style>html,body{margin:0;height:100%}#m{position:absolute;inset:0}</style><div id="m"></div><script>${mlJs}</script>`);
const style = S.buildVectorStyle(new Map(), () => ({ version: 8, sources: {}, layers: [] }), true);
style.glyphs = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';
await page.evaluate((style) => {
  window.map = new maplibregl.Map({ container: 'm', style, center: [29.03, 40.99], zoom: 16.7,
    bearing: 20, pitch: 30, maxPitch: 85, attributionControl: false, fadeDuration: 0 });
  return new Promise((r) => window.map.once('idle', r));
}, style);
const rows = [];
for (const pitch of [20, 30, 38, 44, 50]) {
  const anchorY = 0.58;
  const topPad = Math.max(0, Math.round(H * (2 * anchorY - 1)));
  const r = await page.evaluate(({ pitch, topPad }) => {
    window.map.jumpTo({ pitch, padding: { top: topPad, bottom: 0, left: 0, right: 0 } });
    return new Promise((res) => window.map.once('idle', () => {
      const t = window.map.transform;
      const vehY = (t.height + topPad) / 2;
      const veh = window.map.unproject([t.width / 2, vehY]);
      const top = window.map.unproject([t.width / 2, 1]);
      res({ ileriM: Math.round(veh.distanceTo(top)),
        ufukEkranUstunden: Math.round((t.height / 2 + t.getHorizon()) - t.height),
        karo: t.coveringTiles({ tileSize: 512, minzoom: 0, maxzoom: 14 }).length });
    }));
  }, { pitch, topPad });
  rows.push({ pitch, ...r });
  if (pitch === 30 || pitch === 44) await page.screenshot({ path: path.join(HERE, `mini-p${pitch}.png`) });
}
console.table(rows);
await browser.close();
