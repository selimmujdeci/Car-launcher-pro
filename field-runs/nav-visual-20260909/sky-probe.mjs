/* GÖK/UFUK GÖRÜNÜRLÜK ÖLÇÜMÜ — gerçek WebGL render (headless chromium).
   Soru: sürüş pitch/fov bandında MapLibre kök `sky` ekranda KAÇ piksel çiziyor? */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || process.cwd();
const mlJs  = fs.readFileSync(path.join(ROOT, 'node_modules/maplibre-gl/dist/maplibre-gl.js'), 'utf8');
const mlCss = fs.readFileSync(path.join(ROOT, 'node_modules/maplibre-gl/dist/maplibre-gl.css'), 'utf8');

const W = 904, H = 406;              // ölçülen cihaz görüntü alanı (Xiaomi 23090RA98I)
const SKY = '#151b26', HORIZON = '#3c4a63', BG = '#222c3c';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text()); });

await page.setContent(`<style>${mlCss}
  html,body{margin:0;height:100%;background:#000} #m{position:absolute;inset:0}</style>
  <div id="m"></div><script>${mlJs}</script>`);

await page.evaluate(({ SKY, HORIZON, BG }) => {
  window.map = new maplibregl.Map({
    container: 'm',
    style: {
      version: 8,
      sources: {},
      sky: { 'sky-color': SKY, 'horizon-color': HORIZON, 'sky-horizon-blend': 0.35 },
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': BG } }],
    },
    center: [29.03, 40.99], zoom: 16, bearing: 0, pitch: 0,
    maxPitch: 85, attributionControl: false, fadeDuration: 0,
  });
  return new Promise((res) => window.map.on('load', res));
}, { SKY, HORIZON, BG });

const rows = [];
for (const fov of [36.87, 50, 60]) {
  for (const pitch of [40, 47, 50, 55, 58, 60, 65, 70]) {
    await page.evaluate(({ fov, pitch }) => {
      window.map.transform.fov = fov;
      window.map.setPitch(pitch);
      window.map.triggerRepaint();
      return new Promise((res) => window.map.once('idle', res));
    }, { fov, pitch });
    const shot = await page.screenshot({ type: 'png' });
    const { horizonPx, skyPx } = await page.evaluate(() => {
      const t = window.map.transform;
      return { horizonPx: t.height / 2 + t.getHorizon(), skyPx: 0 };
    });
    /* Gök pikseli = zemin renginden FARKLI olan üst satırlar. */
    const png = shot;
    rows.push({ fov, pitch, horizonFromBottom: +horizonPx.toFixed(1),
      skyBandFromTopPct: +(100 * Math.max(0, (H - horizonPx) / H)).toFixed(1),
      png: png.length });
  }
}
console.table(rows);

/* Piksel doğrulaması: fov 60 · pitch 60 karesini kaydet. */
await page.evaluate(() => { window.map.transform.fov = 60; window.map.setPitch(60);
  window.map.triggerRepaint(); return new Promise((r) => window.map.once('idle', r)); });
const out = path.join(process.env.OUT_DIR || '.', 'sky-fov60-pitch60.png');
await page.screenshot({ path: out });
console.log('kare:', out);
await browser.close();
