/**
 * #1318 ÇAKIŞMA ÖLÇÜTÜ — kapı numarası katmanı sokak adı ELİYOR MU?
 *
 * SALT OKUNUR host ölçümü. Üretim kodunu DEĞİŞTİRMEZ.
 *
 * Kütük #1318'in kabul ölçütü (3) şudur:
 *   "numara hiçbir sokak adını EKRANDAN SİLMEMELİ — aynı sahnede z17'de sokak
 *    adı sayısı, numara katmanı kapalıyken ölçülenle AYNI kalmalı"
 *
 * Bu ölçüt CİHAZ GEREKTİRMEZ: aynı stil, aynı karo, aynı viewport'ta katman
 * AÇIK/KAPALI iki koşu yeterlidir. Burada tam olarak o yapılır.
 *
 * NE KANITLAMAZ: okunabilirlik, güneş altında kontrast, gerçek DPR'de metin
 * boyutu ve gerçek NAV kamerası. #1318'in diğer ölçütleri cihazda kalır.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const TILES = fileURLToPath(new URL('../map-data-coverage-20260907/', import.meta.url));

const source = readFileSync(new URL('../../src/platform/mapStyleBuilders.ts', import.meta.url), 'utf8')
  .replaceAll('import.meta.env', '({VITE_VECTOR_TILE_URL:"https://tiles.openfreemap.org/planet"})')
  .replaceAll("'./map/_mapIds'", JSON.stringify(new URL('../../src/platform/map/_mapIds.ts', import.meta.url).href));
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const builder = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

/**
 * MERKEZ SEÇİMİ — kanonik nokta (36.9175/34.8621) çevresinde kapı numarası
 * YOKTUR (audit §6: yakın 400×400 m alanda 0 numara). İlk koşu bunu doğruladı:
 * 24/24 sahnede 0 numara yerleşti. Bu bir KUSUR DEĞİL, kaynak kapsamıdır.
 * Bu yüzden ölçüm, kaydedilmiş karolarda numaraların GERÇEKTEN bulunduğu
 * en yoğun kümede (4 numara: "4" · "6" · "8" · "10") de tekrarlanır.
 */
const CENTERS = [
  { lon: 34.8621, lat: 36.9175, tag: 'kanonik' },
  { lon: 34.87115, lat: 36.92690, tag: 'numara-kumesi' },
];
const VIEWPORTS = [{ w: 904, h: 406, tag: '904x406' }, { w: 800, h: 480, tag: '800x480' }];
const ZOOMS = [16, 17, 18];
const PITCHES = [0, 45];

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const rows = [];

try {
  for (const night of [false, true]) {
    const style = builder.buildVectorStyle(
      new Map([['local', { id: 'local', name: 'local', type: 'offline', description: '', isAvailable: true }]]),
      () => { throw new Error('raster fallback konu dışı'); }, night);
    style.sources.omv = { type: 'vector', tiles: ['https://hn.local/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 };
    style.glyphs = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

    for (const vp of VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
      await page.route('https://hn.local/**', async (route) => {
        const path = new URL(route.request().url()).pathname.slice(1).replaceAll('/', '-');
        if (!existsSync(TILES + path)) { errors.push('Eksik tile: ' + path); await route.abort(); return; }
        await route.fulfill({ body: readFileSync(TILES + path), contentType: 'application/vnd.mapbox-vector-tile' });
      });
      await page.route('https://demotiles.maplibre.org/**', async (route) => {
        const url = route.request().url();
        const path = TILES + 'glyph-' + createHash('sha256').update(url).digest('hex').slice(0, 16) + '.pbf';
        try {
          if (!existsSync(path)) {
            const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
            if (!r.ok) throw new Error(`Glyph HTTP ${r.status}`);
            writeFileSync(path, Buffer.from(await r.arrayBuffer()));
          }
          await route.fulfill({ body: readFileSync(path), contentType: 'application/x-protobuf' });
        } catch (e) { errors.push(String(e)); await route.abort(); }
      });
      await page.setContent(
        `<html><body style="margin:0"><div id="map" style="width:${vp.w}px;height:${vp.h}px"></div></body></html>`);
      await page.addStyleTag({ path: fileURLToPath(new URL('../../node_modules/maplibre-gl/dist/maplibre-gl.css', import.meta.url)) });
      await page.addScriptTag({ path: fileURLToPath(new URL('../../node_modules/maplibre-gl/dist/maplibre-gl.js', import.meta.url)) });
      await page.evaluate((s) => {
        window.hnErrors = [];
        window.m = new window.maplibregl.Map({
          container: 'map', style: s, center: [34.8621, 36.9175], zoom: 17,
          pitch: 0, bearing: 0, attributionControl: false, fadeDuration: 0,
        });
        window.m.on('error', (e) => window.hnErrors.push(String(e.error)));
      }, style);
      await page.waitForFunction(() => window.m.loaded(), { timeout: 60000 });

      for (const center of CENTERS) {
      for (const pitch of PITCHES) {
        for (const zoom of ZOOMS) {
          for (const hnVisible of [false, true]) {
            const measured = await page.evaluate(async (cfg) => {
              const map = window.m;
              const idle = new Promise((r) => map.once('idle', r));
              map.setLayoutProperty('housenumber', 'visibility', cfg.hnVisible ? 'visible' : 'none');
              map.jumpTo({ center: [cfg.lon, cfg.lat], zoom: cfg.zoom, pitch: cfg.pitch, bearing: 0 });
              await idle;
              const names = (id) => {
                const f = map.queryRenderedFeatures(undefined, { layers: [id] });
                return [...new Set(f.map((x) => x.properties.name).filter(Boolean))].sort();
              };
              const hn = cfg.hnVisible
                ? map.queryRenderedFeatures(undefined, { layers: ['housenumber'] })
                : [];
              return {
                local: names('road-label'),
                major: names('road-label-major'),
                housenumbers: [...new Set(hn.map((x) => x.properties.housenumber).filter(Boolean))].sort(),
                hnInstances: hn.length,
              };
            }, { zoom, pitch, hnVisible, lon: center.lon, lat: center.lat });
            rows.push({
              theme: night ? 'night' : 'day', viewport: vp.tag, center: center.tag, pitch, zoom,
              housenumberVisible: hnVisible,
              localDistinct: measured.local.length,
              majorDistinct: measured.major.length,
              hnRendered: measured.housenumbers.length,
              hnInstances: measured.hnInstances,
              localNames: measured.local,
              majorNames: measured.major,
              housenumbers: measured.housenumbers,
            });
          }
        }
      }
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
}

/* ── AÇIK/KAPALI karşılaştırması ─────────────────────────────────────────── */
const key = (r) => `${r.theme}|${r.viewport}|${r.center}|${r.pitch}|${r.zoom}`;
const off = new Map();
for (const r of rows) if (!r.housenumberVisible) off.set(key(r), r);

const comparisons = [];
for (const r of rows) {
  if (!r.housenumberVisible) continue;
  const b = off.get(key(r));
  const bLocal = new Set(b.localNames);
  const bMajor = new Set(b.majorNames);
  comparisons.push({
    theme: r.theme, viewport: r.viewport, center: r.center, pitch: r.pitch, zoom: r.zoom,
    localOff: b.localDistinct, localOn: r.localDistinct,
    majorOff: b.majorDistinct, majorOn: r.majorDistinct,
    lostLocal: b.localNames.filter((n) => !new Set(r.localNames).has(n)),
    lostMajor: b.majorNames.filter((n) => !new Set(r.majorNames).has(n)),
    hnRendered: r.hnRendered, housenumbers: r.housenumbers,
  });
}
const anyLoss = comparisons.filter((c) => c.lostLocal.length > 0 || c.lostMajor.length > 0);

writeFileSync(HERE + 'housenumber-collision.json', JSON.stringify({
  environment: 'Headless Chromium + SwiftShader · DPR1 · üretim stili KAYNAKTAN derlendi · kaydedilmiş z14 PBF · NAV/runtime YOK',
  criterion: '#1318 kabul ölçütü (3): numara katmanı AÇIKken sokak adı sayısı KAPALIyken ölçülenle AYNI kalmalı.',
  limits: [
    'CİHAZ KANITI DEĞİLDİR: okunabilirlik, kontrast, gerçek DPR ve NAV kamerası ölçülmedi.',
    'queryRenderedFeatures yerleşim çıktısıdır; piksel doğrulaması değildir.',
    'Tek sahne (Tarsus merkez, 9 kaydedilmiş z14 karosu).',
  ],
  errors, comparisons, rows,
}, null, 2), 'utf8');

console.log('tema  viewport  merkez         pitch  z | yerel KAPALI→AÇIK  major | numara | KAYIP');
for (const c of comparisons) {
  if (c.theme === 'night') continue;   // gece stili aynı katman listesini üretir
  console.log(
    `${c.theme.padEnd(5)} ${c.viewport} ${c.center.padEnd(14)} ${String(c.pitch).padStart(5)} ${String(c.zoom).padStart(2)} | ` +
    `${String(c.localOff).padStart(3)} → ${String(c.localOn).padStart(3)}   ` +
    `${String(c.majorOff).padStart(3)} → ${String(c.majorOn).padStart(3)} | ` +
    `${String(c.hnRendered).padStart(2)} | ` +
    `${c.lostLocal.length + c.lostMajor.length === 0 ? 'YOK' : 'yerel:' + c.lostLocal.join(',') + ' major:' + c.lostMajor.join(',')}`);
}
console.log('\nKAYIP GÖZLENEN SAHNE:', anyLoss.length, '/', comparisons.length, '· harita hatası:', errors.length);
console.log('-> housenumber-collision.json');
