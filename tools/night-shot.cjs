// Gece ergonomi analizi — 4 temanın GECE görünümünü yakala (token DEĞİŞTİRMEDEN).
// Kullanım: node tools/night-shot.cjs  (dev server :5173 ayakta olmalı)
const { chromium } = require('playwright');
const path = require('path');

const URL = process.env.SHOT_URL || 'http://127.0.0.1:5173/';
const OUT = process.env.SHOT_OUT || path.resolve(__dirname, 'night-shots');
const THEMES = (process.env.SHOT_THEMES || 'expedition,horizon,tesla,pro').split(',');
// HD head unit (1280×720) — en temsili kabin çözünürlüğü
const VIEWPORT = { width: 1280, height: 720 };

const fs = require('fs');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    // Tema = gece base adı (örn. 'expedition' = Night varyantı)
    await page.addInitScript((t) => {
      localStorage.setItem('car-launcher-theme', JSON.stringify({ state: { theme: t }, version: 3 }));
    }, theme);
    // Saat 23:00 → useDayNightManager 'night' hesaplar, light-ui kaldırılır
    await page.clock.install({ time: new Date('2026-06-25T23:00:00') });
    await page.goto(URL, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(2500);
    // Disclaimer/uyarı kapat — birkaç kez dene + kaybolmasını bekle
    for (let i = 0; i < 4; i++) {
      const btn = page.getByText('Anladım', { exact: false }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 1500, force: true }).catch(() => {});
        await page.waitForTimeout(500);
      } else break;
    }
    await page.waitForTimeout(1200);
    // Gece teyidi
    const dn = await page.evaluate(() => document.documentElement.getAttribute('data-day-night'));
    const dt = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const file = path.join(OUT, `night-${theme}.png`);
    await page.screenshot({ path: file });
    console.log(`shot ${theme} → data-theme=${dt} data-day-night=${dn} → ${file}`);

    // Sokak-seviyesi gece harita paleti için zoom'lu kare (harita merkezine wheel-zoom)
    const map = page.locator('.maplibregl-map').first();
    if (await map.isVisible().catch(() => false)) {
      const box = await map.boundingBox().catch(() => null);
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        for (let z = 0; z < 9; z++) { await page.mouse.wheel(0, -260); await page.waitForTimeout(180); }
        await page.waitForTimeout(1400);
        await page.screenshot({ path: path.join(OUT, `night-${theme}-mapzoom.png`) });
        console.log(`  mapzoom ${theme}`);
      }
    }
    await ctx.close();
  }
  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error(e); process.exit(1); });
