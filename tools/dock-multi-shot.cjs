// Çok-temalı dock önizleme — büyütülmüş dock boyut doğrulama.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:4173/';
const THEMES = ['expedition', 'horizon', 'pro'];

(async () => {
  const browser = await chromium.launch();
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: 1356, height: 582 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.addInitScript((t) => {
      localStorage.setItem('car-launcher-theme', JSON.stringify({ state: { theme: t }, version: 3 }));
    }, theme);
    await page.clock.install({ time: new Date('2026-06-12T13:40:30') });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.getByText('Anladım', { exact: false }).click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: `tools/dock-new-${theme}.png` });
    console.log('shot', theme);
    await ctx.close();
  }
  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error(e); process.exit(1); });
