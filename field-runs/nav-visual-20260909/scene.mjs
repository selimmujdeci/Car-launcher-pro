/* REFERANS SAHNE ÜRETECİ — ÜRETİM stiliyle, GERÇEK vektör karolarla.
 *
 * Amaç: "kamera düz/yukarıdan" şikâyetini ölçülebilir kılmak. Aynı sahne,
 * aynı zoom, yalnız FOV ve PITCH değişkeniyle üretilir → tek değişkenli deney.
 * Tasarım tuvali (field-runs/carto-2026-09-06) DEĞİL, üretim stili ölçülür.
 *
 * Kullanım: node field-runs/nav-visual-20260909/scene.mjs <repo-kök>
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] || process.cwd();
globalThis.__VITE_ENV__ = { VITE_VECTOR_TILE_URL: 'https://tiles.openfreemap.org/planet' };
const S = await import('./style.mjs');

const mlJs  = fs.readFileSync(path.join(ROOT, 'node_modules/maplibre-gl/dist/maplibre-gl.js'), 'utf8');
const mlCss = fs.readFileSync(path.join(ROOT, 'node_modules/maplibre-gl/dist/maplibre-gl.css'), 'utf8');

const W = 904, H = 406;                       // ölçülen cihaz görüntü alanı
const CENTER = [29.0300, 40.9900];            // Kadıköy — tasarım sahnesiyle aynı
const BEARING = 20;

/* Ölçüm matrisi: MEVCUT kamera ↔ adaylar. */
const CASES = [
  { id: 'mevcut-sehir',  night: true,  zoom: 16.7, fov: 36.87, pitch: 30 },
  { id: 'mevcut-yol',    night: true,  zoom: 16.0, fov: 36.87, pitch: 40 },
  { id: 'mevcut-otoyol', night: true,  zoom: 15.5, fov: 36.87, pitch: 47 },
  { id: 'aday50-sehir',  night: true,  zoom: 16.7, fov: 50,    pitch: 30 },
  { id: 'aday50-yol',    night: true,  zoom: 16.0, fov: 50,    pitch: 40 },
  { id: 'aday50-otoyol', night: true,  zoom: 15.5, fov: 50,    pitch: 47 },
  { id: 'gun-mevcut',    night: false, zoom: 16.7, fov: 36.87, pitch: 30 },
  { id: 'gun-aday50',    night: false, zoom: 16.7, fov: 50,    pitch: 30 },
];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
let tileErrors = 0;
page.on('console', (m) => { if (m.type() === 'error') { tileErrors++; if (tileErrors < 4) console.log('  [err]', m.text().slice(0, 160)); } });

await page.setContent(`<style>${mlCss}
  html,body{margin:0;height:100%;background:#000}#m{position:absolute;inset:0}</style>
  <div id="m"></div><script>${mlJs}</script>`);

const results = [];
for (const c of CASES) {
  const style = S.buildVectorStyle(new Map(), () => ({ version: 8, sources: {}, layers: [] }), c.night);
  /* Uygulama-içi protokoller (`glyph-cache://`) tarayıcıda yok → gerçek uca çevrilir.
     Ölçülen şey KARTOGRAFYA ve KAMERA; glyph taşıyıcısı değil. */
  style.glyphs = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

  await page.evaluate(({ style, c, CENTER, BEARING }) => {
    if (window.map) window.map.remove();
    window.map = new maplibregl.Map({
      container: 'm', style, center: CENTER, zoom: c.zoom, bearing: BEARING,
      pitch: c.pitch, maxPitch: 85, attributionControl: false, fadeDuration: 0,
    });
    window.map.transform.fov = c.fov;
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('idle timeout')), 45000);
      window.map.once('idle', () => { clearTimeout(t); res(); });
    });
  }, { style, c, CENTER, BEARING });

  const geom = await page.evaluate(() => {
    const t = window.map.transform;
    return {
      horizonFromBottom: +(t.height / 2 + t.getHorizon()).toFixed(0),
      tiles: t.coveringTiles({ tileSize: 512, minzoom: 0, maxzoom: 14 }).length,
      /* İleri görüş: ekranın ÜST kenarındaki noktanın araçtan (alt orta) metre uzaklığı. */
      lookAheadM: (() => {
        const bottom = window.map.unproject([t.width / 2, t.height - 1]);
        const top    = window.map.unproject([t.width / 2, 1]);
        return +bottom.distanceTo(top).toFixed(0);
      })(),
    };
  });
  const file = path.join(HERE, `scene-${c.id}.png`);
  await page.screenshot({ path: file });
  results.push({ id: c.id, fov: c.fov, pitch: c.pitch, zoom: c.zoom, ...geom });
  console.log(`${c.id.padEnd(14)} ufuk=${geom.horizonFromBottom}px karo=${geom.tiles} ileriGörüş=${geom.lookAheadM}m`);
}
console.table(results);
fs.writeFileSync(path.join(HERE, 'scene-metrics.json'), JSON.stringify(results, null, 2));
console.log('konsol hatası:', tileErrors);
await browser.close();
