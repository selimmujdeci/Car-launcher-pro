/* GERİ ÇEKİLEN YEREL AĞ RENK DENETİMİ — saydamlaşan beyaz gövde, altındaki
   yüzeylerle karışırken RENK KAYMASI üretiyor mu? (amber/sepya yasağı) */
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
  window.map = new maplibregl.Map({ container: 'm', style, center: [29.03, 40.99], zoom: 15.5,
    bearing: 20, pitch: 47, maxPitch: 85, attributionControl: false, fadeDuration: 0 });
  return new Promise((r) => window.map.once('idle', r));
}, style);

/* Yalnız `road-minor` katmanının kattığı pikselleri izole et: katman açık/kapalı
   iki kare farkı → o katmanın GERÇEK ekran rengi. Tahmin yok. */
const res = await page.evaluate(() => new Promise((resolve) => {
  const grab = () => {
    const cv = window.map.getCanvas(); const g = document.createElement('canvas');
    g.width = cv.width; g.height = cv.height;
    g.getContext('2d').drawImage(cv, 0, 0);
    return g.getContext('2d').getImageData(0, 0, g.width, g.height).data;
  };
  window.map.triggerRepaint();
  window.map.once('idle', () => {
    const withMinor = grab();
    window.map.setLayoutProperty('road-minor', 'visibility', 'none');
    window.map.triggerRepaint();
    window.map.once('idle', () => {
      const without = grab();
      let n = 0, R = 0, G = 0, B = 0;
      for (let i = 0; i < withMinor.length; i += 4) {
        const d = Math.abs(withMinor[i] - without[i]) + Math.abs(withMinor[i + 1] - without[i + 1]) + Math.abs(withMinor[i + 2] - without[i + 2]);
        if (d > 24) { n++; R += withMinor[i]; G += withMinor[i + 1]; B += withMinor[i + 2]; }
      }
      resolve(n ? { n, r: Math.round(R / n), g: Math.round(G / n), b: Math.round(B / n) } : { n: 0 });
    });
  });
}));
const { r, g, b } = res;
const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
console.log(`geri çekilmiş yerel yol ekran rengi: rgb(${r},${g},${b})  piksel=${res.n}`);
console.log(`  doygunluk (max-min)/max = ${(100 * (mx - mn) / mx).toFixed(1)}%  ` +
  `${b >= r ? 'SERİN (mavi ailesi) ✓' : 'SICAK (amber/sepya riski) ✗'}`);
await browser.close();
