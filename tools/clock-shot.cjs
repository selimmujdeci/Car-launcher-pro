// 3 tema × gündüz/gece dock saatlerini yakalar.
// Mod, useDayNightManager'ın saat-tabanlı mantığını taklit etmek için
// Playwright fake-clock ile sabitlenen saatten gelir (gece 22:40 / gündüz 13:20).
const { chromium } = require('playwright');

const URL = 'http://127.0.0.1:4173/';
const NIGHT_T = '2026-06-12T22:40:30';
const DAY_T   = '2026-06-12T13:20:30';
const COMBOS = [
  ['expedition', 'night', NIGHT_T], ['expedition', 'day', DAY_T],
  ['tesla', 'night', NIGHT_T],      ['tesla', 'day', DAY_T],
  ['horizon', 'night', NIGHT_T],    ['horizon', 'day', DAY_T],
];

async function shot(browser, theme, mode, iso) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    localStorage.setItem('car-launcher-theme', JSON.stringify({ state: { theme: t }, version: 3 }));
  }, theme);
  // Saati sabitle — useDayNightManager getHours() ile gün/gece kararı verir
  await page.clock.install({ time: new Date(iso) });

  await page.goto(URL, { waitUntil: 'networkidle' });
  const clock = page.locator('[aria-label="Saat — Menü"]').first();
  await clock.waitFor({ state: 'visible', timeout: 30000 });
  // useDayNightManager mount override'ının store'a yansıması için kısa bekle
  await page.waitForTimeout(1500);

  const box = await clock.boundingBox();
  const pad = 22;
  const out = `tools/clock-${theme}-${mode}.png`;
  await page.screenshot({
    path: out,
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.width + pad * 2,
      height: box.height + pad * 2,
    },
  });
  await ctx.close();
  console.log('shot', out);
}

(async () => {
  const browser = await chromium.launch();
  for (const [t, m, iso] of COMBOS) {
    try { await shot(browser, t, m, iso); }
    catch (e) { console.error('FAIL', t, m, e.message); }
  }
  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error(e); process.exit(1); });
