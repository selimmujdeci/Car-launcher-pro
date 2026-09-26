/* SAHA KARESİNİN ÖLÇÜMÜ — kullanıcının gönderdiği ekran (Mersin, Mavi Bulvar).
 * Soru: "bina dokusu" veri yokluğundan mı, yoksa biz mi söndürüyoruz? */
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] || process.cwd();
globalThis.__VITE_ENV__ = { VITE_VECTOR_TILE_URL: 'https://tiles.openfreemap.org/planet' };
const S = await import('./style.mjs');
const mlJs = fs.readFileSync(path.join(ROOT, 'node_modules/maplibre-gl/dist/maplibre-gl.js'), 'utf8');
const W = 900, H = 1900;                       // kullanıcının telefonu (dikey)
const CENTER = [34.6060, 36.7830];             // Mersin Yenişehir · Mavi Bulvar civarı
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(`<style>html,body{margin:0;height:100%}#m{position:absolute;inset:0}</style><div id="m"></div><script>${mlJs}</script>`);
const style = S.buildVectorStyle(new Map(), () => ({ version: 8, sources: {}, layers: [] }), true);
style.glyphs = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';
await page.evaluate(({ style, CENTER }) => {
  window.map = new maplibregl.Map({ container: 'm', style, center: CENTER, zoom: 17,
    bearing: 0, pitch: 44, maxPitch: 85, attributionControl: false, fadeDuration: 0 });
  return new Promise((r) => window.map.once('idle', r));
}, { style, CENTER });

const stats = await page.evaluate(() => {
  const q = (id) => { try { return window.map.getLayer(id) ? window.map.queryRenderedFeatures({ layers: [id] }).length : -1; } catch { return -1; } };
  const src = (sl, f) => { try { return window.map.querySourceFeatures('omv', { sourceLayer: sl, ...(f ? { filter: f } : {}) }).length; } catch { return -1; } };
  return {
    ekranda_building: q('building'), ekranda_building3d: q('building-3d'),
    ekranda_yol_minor: q('road-minor'), ekranda_yol_primary: q('road-primary'),
    KARODA_building: src('building'),
    KARODA_transportation: src('transportation'),
    KARODA_landuse: src('landuse'),
  };
});
console.log('— Mersin Yenişehir z17 —');
console.table([stats]);

/* Bina opaklığı: navigasyon profili (0,50) ↔ tam (1,0) */
const shot = async (name, op3d, opFill) => {
  await page.evaluate(({ op3d, opFill }) => {
    if (window.map.getLayer('building')) window.map.setPaintProperty('building', 'fill-opacity', opFill);
    if (window.map.getLayer('building-3d')) window.map.setPaintProperty('building-3d', 'fill-extrusion-opacity', op3d);
    window.map.triggerRepaint();
    return new Promise((r) => window.map.once('idle', r));
  }, { op3d, opFill });
  await page.screenshot({ path: path.join(HERE, `mersin-${name}.png`) });
};
await shot('nav050', 0.40, 0.50);     // BUGÜNKÜ navigasyon profili
await shot('tam100', 1.00, 1.00);     // bina tam opak
await browser.close();
