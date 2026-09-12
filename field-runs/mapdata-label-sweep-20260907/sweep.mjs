/**
 * MAPDATA — YEREL SOKAK ADI EŞİK/ARALIK TARAMASI (#1319 analitik boşluğu).
 *
 * SALT OKUNUR host ölçümü. Üretim kodunu DEĞİŞTİRMEZ.
 *
 * ── NEDEN ─────────────────────────────────────────────────────────────────
 * `../map-data-coverage-20260907/REPORT.md` §5 host deneyinde `symbol-spacing`
 * 460→100 yapılınca z16'da görünen ayrık yerel ad 10→16 çıkmıştı. Ama o deney
 * **KAYBOLAN adı ölçmedi**: aralık küçültmek yalnız tekrar sıklığını değil
 * ANCHOR ADAYLARINI da değiştirir, dolayısıyla kazanılan adın yanında
 * kaybedilen ad olabilir. Kütük #1319 tam olarak bu boşluk için açıldı.
 *
 * Bu tarama o boşluğu kapatır: her varyantta görünen ad KÜMESİ kaydedilir ve
 * taban (spacing 460) kümesiyle karşılaştırılarak **kazanılan / KAYBOLAN**
 * adlar ayrı ayrı çıkarılır. Ayrıca ana arter adının (`road-label-major`)
 * elenip elenmediği izlenir — yerel ad kazanmak uğruna arter bağlamı
 * kaybedilirse bu bir KAZANÇ DEĞİL, gerilemedir.
 *
 * ── FARKLAR (önceki deneye göre) ──────────────────────────────────────────
 *  · Stil KAYNAKTAN derlenir → F4'te eklenen `housenumber` katmanı da
 *    çakışmaya KATILIR (kaydedilmiş eski style-day.json kullanılmaz).
 *  · İki viewport: 904×406 (ölçülmüş cihaz) ve 800×480 (head unit hedefi).
 *  · İki pitch: 0 (tarama) ve 45 (sürüş kompozisyonuna yakın).
 *  · Zoom 15 · 16 · 17 ve ayrıca EŞİK ekseni (minzoom 16 → 15).
 *
 * ── BU BİR CİHAZ KANITI DEĞİLDİR ──────────────────────────────────────────
 * Headless Chromium + SwiftShader; gerçek GPU, gerçek DPR ve gerçek NAV
 * runtime yoktur. `queryRenderedFeatures` YERLEŞİM çıktısıdır, piksel
 * doğrulaması değildir. #1319 cihazda ölçülene kadar 🔴 kalır.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const TILES = fileURLToPath(new URL('../map-data-coverage-20260907/', import.meta.url));
mkdirSync(HERE, { recursive: true });

/* ── Üretim stilini KAYNAKTAN derle ──────────────────────────────────────── */
const source = readFileSync(new URL('../../src/platform/mapStyleBuilders.ts', import.meta.url), 'utf8')
  .replaceAll('import.meta.env', '({VITE_VECTOR_TILE_URL:"https://tiles.openfreemap.org/planet"})')
  .replaceAll("'./map/_mapIds'", JSON.stringify(new URL('../../src/platform/map/_mapIds.ts', import.meta.url).href));
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const builder = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

const style = builder.buildVectorStyle(
  new Map([['local', { id: 'local', name: 'local', type: 'offline', description: '', isAvailable: true }]]),
  () => { throw new Error('raster fallback konu dışı'); }, false);
style.sources.omv = { type: 'vector', tiles: ['https://sweep.local/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 };
style.glyphs = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

const BASELINE_SPACING = Number(
  style.layers.find((l) => l.id === 'road-label').layout['symbol-spacing']);
const BASELINE_MINZOOM = style.layers.find((l) => l.id === 'road-label').minzoom;

/* ── Tarama eksenleri ────────────────────────────────────────────────────── */
const SPACINGS = [BASELINE_SPACING, 380, 340, 280, 240, 180];
const ZOOMS = [15, 16, 17];
const VIEWPORTS = [{ w: 904, h: 406, tag: '904x406' }, { w: 800, h: 480, tag: '800x480' }];
const PITCHES = [0, 45];
const MINZOOMS = [BASELINE_MINZOOM, 15];

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const rows = [];

try {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    await page.route('https://sweep.local/**', async (route) => {
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
      window.swErrors = [];
      window.m = new window.maplibregl.Map({
        container: 'map', style: s, center: [34.8621, 36.9175], zoom: 16,
        pitch: 0, bearing: 0, attributionControl: false, fadeDuration: 0,
      });
      window.m.on('error', (e) => window.swErrors.push(String(e.error)));
    }, style);
    await page.waitForFunction(() => window.m.loaded(), { timeout: 60000 });

    for (const minzoom of MINZOOMS) {
      for (const pitch of PITCHES) {
        for (const zoom of ZOOMS) {
          for (const spacing of SPACINGS) {
            const measured = await page.evaluate(async (cfg) => {
              const map = window.m;
              const idle = new Promise((r) => map.once('idle', r));
              map.setLayerZoomRange('road-label', cfg.minzoom, 24);
              map.setLayoutProperty('road-label', 'symbol-spacing', cfg.spacing);
              map.jumpTo({ zoom: cfg.zoom, pitch: cfg.pitch, bearing: 0 });
              await idle;
              const sample = (id) => {
                const f = map.queryRenderedFeatures(undefined, { layers: [id] });
                return {
                  instances: f.length,
                  names: [...new Set(f.map((x) => x.properties.name).filter(Boolean))].sort(),
                };
              };
              return {
                local: sample('road-label'),
                major: sample('road-label-major'),
                housenumber: (() => {
                  const f = map.queryRenderedFeatures(undefined, { layers: ['housenumber'] });
                  return { instances: f.length,
                    values: [...new Set(f.map((x) => x.properties.housenumber).filter(Boolean))].sort() };
                })(),
                mapErrors: window.swErrors.slice(),
              };
            }, { spacing, zoom, pitch, minzoom });
            rows.push({
              viewport: vp.tag, minzoom, pitch, zoom, spacing,
              localDistinct: measured.local.names.length,
              localInstances: measured.local.instances,
              majorDistinct: measured.major.names.length,
              majorInstances: measured.major.instances,
              housenumberInstances: measured.housenumber.instances,
              localNames: measured.local.names,
              majorNames: measured.major.names,
            });
          }
        }
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}

/* ── Taban ile karşılaştırma: KAZANILAN / KAYBOLAN ad ────────────────────── */
const keyOf = (r) => `${r.viewport}|${r.minzoom}|${r.pitch}|${r.zoom}`;
const baseline = new Map();
for (const r of rows) if (r.spacing === BASELINE_SPACING) baseline.set(keyOf(r), r);

for (const r of rows) {
  const b = baseline.get(keyOf(r));
  const bset = new Set(b.localNames);
  const rset = new Set(r.localNames);
  r.gainedLocal = r.localNames.filter((n) => !bset.has(n));
  r.lostLocal = b.localNames.filter((n) => !rset.has(n));
  r.netLocal = r.localDistinct - b.localDistinct;
  const bmaj = new Set(b.majorNames);
  r.lostMajor = b.majorNames.filter((n) => !new Set(r.majorNames).has(n));
}

writeFileSync(HERE + 'sweep-results.json', JSON.stringify({
  environment: 'Headless Chromium + SwiftShader · DPR1 · üretim DAY stili KAYNAKTAN derlendi (housenumber katmanı DAHİL) · kaydedilmiş z14 PBF · NAV/runtime/rota/UI YOK',
  limits: [
    'Gerçek GPU/DPR/NAV runtime YOK — bu bir CİHAZ kanıtı DEĞİLDİR.',
    'queryRenderedFeatures YERLEŞİM çıktısıdır; piksel doğrulaması değildir.',
    'Karo kaynağı maxzoom 14 — z15/16/17 overzoom edilir (üretimle aynı).',
    'symbol-spacing CSS px cinsindendir; DPR yerleşimi CSS px uzayında değiştirmez, bu yüzden DPR1 ölçümü DPR3 cihazda AYNI yerleşimi vermelidir — ama bu iddia cihazda DOĞRULANMADI.',
  ],
  baselineSpacing: BASELINE_SPACING,
  baselineMinzoom: BASELINE_MINZOOM,
  axes: { SPACINGS, ZOOMS, VIEWPORTS: VIEWPORTS.map((v) => v.tag), PITCHES, MINZOOMS },
  errors,
  rows,
}, null, 2), 'utf8');

/* ── Konsol özeti ────────────────────────────────────────────────────────── */
const fmt = (n) => String(n).padStart(3);
console.log('viewport  mz pitch  z  spacing | yerel(ayrık/örnek) major(ayrık) | net kazanılan kaybolan majorKayıp');
for (const r of rows) {
  if (r.localDistinct === 0 && r.spacing !== BASELINE_SPACING) continue;
  console.log(
    `${r.viewport} ${fmt(r.minzoom)} ${fmt(r.pitch)} ${fmt(r.zoom)} ${fmt(r.spacing)} | ` +
    `${fmt(r.localDistinct)}/${fmt(r.localInstances)} ${fmt(r.majorDistinct)} | ` +
    `${fmt(r.netLocal)} ${fmt(r.gainedLocal.length)} ${fmt(r.lostLocal.length)} ${fmt(r.lostMajor.length)}`);
}
console.log('\nhata:', errors.length, '· satır:', rows.length, '-> sweep-results.json');
