// Masaüstü kontrollü collision deneyi; cihaz veya runtime doğrulaması değildir.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const dir = fileURLToPath(new URL('./', import.meta.url));
const style = JSON.parse(readFileSync(dir + 'style-day.json'));
style.sources.omv = { type: 'vector', tiles: ['https://audit.local/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 };
style.glyphs = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const requests = [], errors = [], results = [];
try {
  const page = await browser.newPage({ viewport: { width: 904, height: 406 }, deviceScaleFactor: 1 });
  await page.route('https://audit.local/**', async route => {
    const path = new URL(route.request().url()).pathname.slice(1).replaceAll('/', '-');
    requests.push(path);
    if (!existsSync(dir + path)) { errors.push('Eksik tile: ' + path); await route.abort(); return; }
    await route.fulfill({ body: readFileSync(dir + path), contentType: 'application/vnd.mapbox-vector-tile' });
  });
  await page.route('https://demotiles.maplibre.org/**', async route => {
    const url = route.request().url();
    const path = dir + 'glyph-' + createHash('sha256').update(url).digest('hex').slice(0,16) + '.pbf';
    try {
      if (!existsSync(path)) {
        const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw Error(`Glyph HTTP ${r.status}`);
        writeFileSync(path, Buffer.from(await r.arrayBuffer()));
      }
      await route.fulfill({ body: readFileSync(path), contentType: 'application/x-protobuf' });
    } catch (e) { errors.push(String(e)); await route.abort(); }
  });
  await page.setContent('<html><body style="margin:0"><div id="map" style="width:904px;height:406px"></div></body></html>');
  await page.addStyleTag({ path: fileURLToPath(new URL('../../node_modules/maplibre-gl/dist/maplibre-gl.css', import.meta.url)) });
  await page.addScriptTag({ path: fileURLToPath(new URL('../../node_modules/maplibre-gl/dist/maplibre-gl.js', import.meta.url)) });
  await page.evaluate(style => {
    window.auditErrors = [];
    window.auditMap = new window.maplibregl.Map({ container: 'map', style, center: [34.8621,36.9175], zoom: 16, pitch: 0, bearing: 0, attributionControl: false, fadeDuration: 0, preserveDrawingBuffer: true });
    window.auditMap.on('error', e => window.auditErrors.push(String(e.error)));
  }, style);
  await page.waitForFunction(() => window.auditMap.loaded(), { timeout: 30000 });
  for (const [variant, zoom] of [['base-z14',14],['base-z15',15],['base-z16',16],['overlap-z16',16],['spacing-z16',16],['base-z16.4',16.4]]) {
    await page.evaluate(async ({ variant, zoom }) => {
      const map = window.auditMap;
      const idle = new Promise(resolve => map.once('idle', resolve));
      map.setLayoutProperty('road-label', 'text-allow-overlap', variant.startsWith('overlap'));
      map.setLayoutProperty('road-label', 'symbol-spacing', variant.startsWith('spacing') ? 100 : 460);
      map.jumpTo({ zoom });
      await idle;
    }, { variant, zoom });
    const measured = await page.evaluate(() => {
      const map = window.auditMap;
      const sample = id => {
        const f = map.queryRenderedFeatures(undefined, { layers: [id] });
        return { featureCount: f.length, ids: [...new Set(f.map(x => x.id))], names: [...new Set(f.map(x => x.properties.name).filter(Boolean))].sort() };
      };
      return { zoom: map.getZoom(), pitch: map.getPitch(), bounds: map.getBounds().toArray(), building: sample('building'), local: sample('road-label'), major: sample('road-label-major'), mapErrors: window.auditErrors };
    });
    results.push({ variant, ...measured });
    const pixels = await page.evaluate(() => new Promise(resolve => {
      const map = window.auditMap;
      map.once('render', () => resolve(map.getCanvas().toDataURL('image/png')));
      map.triggerRepaint();
    }));
    writeFileSync(dir + 'host-' + variant + '.png', Buffer.from(pixels.split(',')[1], 'base64'));
    console.log(JSON.stringify({ variant, local: measured.local.names, major: measured.major.names, buildingFeatures: measured.building.featureCount }));
  }
  writeFileSync(dir + 'render-results.json', JSON.stringify({ environment: 'Headless Chromium, 904x406 DPR1, production base DAY style, pitch0 bearing0; runtime/nav/route/UI yok; cihaz closure değildir', pixelEvidence: 'UNVERIFIED: PNG varlığı piksel doğrulaması değildir; bu hostta boş/tutarsız yakalama gözlendi. Sayılar queryRenderedFeatures yerleşim ölçümüdür.', requests: [...new Set(requests)], errors, results }, null, 2));
} finally { await browser.close(); }
