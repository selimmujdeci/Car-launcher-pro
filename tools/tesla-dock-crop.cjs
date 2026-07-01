const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:4173/';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1356, height: 582 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('car-launcher-theme', JSON.stringify({ state: { theme: 'tesla' }, version: 3 })));
  await page.clock.install({ time: new Date('2026-06-12T22:40:30') });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator('[aria-label="Saat — Menü"]').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.getByText('Anladım', { exact: false }).click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(700);
  const clip = { x: 0, y: 430, width: 1356, height: 152 };
  await page.screenshot({ path: 'tools/tesla-dock-crop-p1.png', clip });
  await page.evaluate(() => {
    const nav = [...document.querySelectorAll('button')].find(b => /Navigasyon/i.test(b.textContent || ''));
    let el = nav; while (el && el.scrollWidth <= el.clientWidth + 4) el = el.parentElement;
    el && el.scrollTo({ left: el.clientWidth, behavior: 'instant' });
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'tools/tesla-dock-crop-p2.png', clip });
  await ctx.close(); await browser.close(); console.log('DONE');
})().catch((e) => { console.error(e); process.exit(1); });
