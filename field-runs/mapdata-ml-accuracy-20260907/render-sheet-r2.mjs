// Kontak sayfasını PNG'ye çevirir (salt okunur ölçüm aracı).
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('./', import.meta.url));
const pageUrl = new URL('./sheet-r2.html', import.meta.url).href;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 2000 }, deviceScaleFactor: 1 });
await page.goto(pageUrl);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1500);
const grid = await page.$('.grid');
await grid.screenshot({ path: dir + 'contact-sheet-r2.png' });
console.log('yazıldı: contact-sheet.png');
await browser.close();
