// Sol panel (speedo + kartlar) kırpılmış yüksek-çözünürlük kare — gece kontrast/kritik değer doğrulama.
const { chromium } = require('playwright');
const path = require('path');
const URL = 'http://127.0.0.1:5173/';
const theme = process.env.CROP_THEME || 'tesla';
const out = process.env.CROP_OUT || path.resolve(__dirname, 'night-shots-p2', `crop-${theme}.png`);
const clip = (process.env.CROP_CLIP || '0,56,360,664').split(',').map(Number); // x,y,w,h (sol panel)

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    localStorage.setItem('car-launcher-theme', JSON.stringify({ state: { theme: t }, version: 3 }));
  }, theme);
  await page.clock.install({ time: new Date('2026-06-25T23:00:00') });
  await page.goto(URL, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2500);
  for (let i = 0; i < 4; i++) {
    const btn = page.getByText('Anladım', { exact: false }).first();
    if (await btn.isVisible().catch(() => false)) { await btn.click({ force: true }).catch(() => {}); await page.waitForTimeout(400); } else break;
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: out, clip: { x: clip[0], y: clip[1], width: clip[2], height: clip[3] } });
  console.log('crop', theme, '→', out);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
