/* SÜRÜŞ KAMERASI SÜPÜRMESİ — "düz/yukarıdan bakış" hissinin ölçüsü.
 * Değişkenler: pitch · anchorY (aracın ekrandaki dikey yeri) · fov.
 * Ölçülen: ileri görüş (m) · karo yükü · parlak piksel (mürekkep). */
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] || process.cwd();
globalThis.__VITE_ENV__ = { VITE_VECTOR_TILE_URL: 'https://tiles.openfreemap.org/planet' };
const S = await import('./style.mjs');
const mlJs = fs.readFileSync(path.join(ROOT, 'node_modules/maplibre-gl/dist/maplibre-gl.js'), 'utf8');
const W = 904, H = 406;
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

/* `anchorY` = aracın ekrandaki dikey oranı. MapLibre karşılığı padding.top:
   P = H·(2·anchorY − 1)  (cameraCompositionModel geometrisi, lookAhead=0). */
const rows = [];
for (const fov of [36.87, 50]) {
  for (const pitch of [30, 38, 45, 50]) {
    for (const anchorY of [0.58, 0.66]) {
      const topPad = Math.max(0, Math.round(H * (2 * anchorY - 1)));
      const r = await page.evaluate(({ fov, pitch, topPad }) => {
        const t = window.map.transform;
        t.fov = fov;
        window.map.jumpTo({ pitch, padding: { top: topPad, bottom: 0, left: 0, right: 0 } });
        return new Promise((res) => window.map.once('idle', () => {
          const tt = window.map.transform;
          /* Aracın ekran konumu: padding'li merkez → (H + P)/2. */
          const vehY = (tt.height + topPad) / 2;
          const veh  = window.map.unproject([tt.width / 2, vehY]);
          const top  = window.map.unproject([tt.width / 2, 1]);
          const cv = window.map.getCanvas(); const g = document.createElement('canvas');
          g.width = cv.width; g.height = cv.height;
          g.getContext('2d').drawImage(cv, 0, 0);
          const d = g.getContext('2d').getImageData(0, 0, g.width, g.height).data;
          let bright = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) {
            const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            n++; if (l > 170) bright++;
          }
          res({ ileriM: Math.round(veh.distanceTo(top)),
            karo: tt.coveringTiles({ tileSize: 512, minzoom: 0, maxzoom: 14 }).length,
            parlak: +(100 * bright / n).toFixed(2) });
        }));
      }, { fov, pitch, topPad });
      rows.push({ fov, pitch, anchorY, topPad, ...r });
      if (fov === 36.87 && anchorY === 0.58 && (pitch === 30 || pitch === 45)) {
        await page.screenshot({ path: path.join(HERE, `cam-p${pitch}-a58.png`) });
      }
      if (fov === 36.87 && anchorY === 0.66 && pitch === 45) {
        await page.screenshot({ path: path.join(HERE, `cam-p45-a66.png`) });
      }
    }
  }
}
console.table(rows);
fs.writeFileSync(path.join(HERE, 'camera-sweep.json'), JSON.stringify(rows, null, 2));
await browser.close();
