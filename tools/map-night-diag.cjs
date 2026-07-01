// Harita gece teşhisi — console loglarını yakala (KOD DEĞİŞTİRMEDEN analiz).
// [MAP_STYLE_RESOLVE] {night} + MAP_READY + gün/gece izleri.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:5173/';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { logs.push(m.text()); });
  await page.addInitScript(() => {
    localStorage.setItem('car-launcher-theme', JSON.stringify({ state: { theme: 'expedition' }, version: 3 }));
  });
  await page.clock.install({ time: new Date('2026-06-25T23:00:00') });
  await page.goto(URL, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(4000);
  // DOM gerçeği + store gerçeği
  const dn = await page.evaluate(() => document.documentElement.getAttribute('data-day-night'));
  const hour = await page.evaluate(() => new Date().getHours());
  const hasMap = await page.evaluate(() => document.querySelectorAll('.maplibregl-map').length);
  console.log('=== DOM data-day-night:', dn, '| getHours():', hour, '| maplibregl-map sayısı:', hasMap);
  console.log('=== Harita/gece/stil ilgili loglar ===');
  const rel = logs.filter((l) => /map|style|night|tile|raster|webgl|gpu|day/i.test(l));
  for (const l of rel.slice(0, 50)) console.log('  ', l);
  console.log('=== Toplam log:', logs.length, '| ilgili:', rel.length);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
