// Expedition tam ekran (dock dahil) önizleme — dock boyut kontrolü.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:4173/';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1356, height: 582 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('car-launcher-theme', JSON.stringify({ state: { theme: 'expedition' }, version: 3 }));
  });
  await page.clock.install({ time: new Date('2026-06-12T22:40:30') });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator('[aria-label="Saat — Menü"]').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(800);
  // Güvenli mod bilgilendirme modalını kapat
  await page.getByText('Anladım', { exact: false }).click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tools/dock-full.png' });
  await ctx.close();
  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error(e); process.exit(1); });
