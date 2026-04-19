import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox','--disable-setuid-sandbox','--enable-webgl','--ignore-gpu-blocklist'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();

await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded', timeout: 10000 });
await page.evaluate(() => {
  const key = 'car-launcher-storage';
  const d = JSON.parse(localStorage.getItem(key) || '{"state":{"settings":{}}}');
  if (!d.state) d.state = {};
  if (!d.state.settings) d.state.settings = {};
  Object.assign(d.state.settings, {
    hasCompletedSetup: true,
    themePack: 'bmw',
    offlineMap: false,
    autoNavOnStart: false,
    themeStyle: 'glass',
    dayNightMode: 'night',
    theme: 'dark',
  });
  localStorage.setItem(key, JSON.stringify(d));
});
await page.reload({ waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 4000));

// Harita açıksa kapat
const closed = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const closeBtn = btns.find(b => b.textContent?.trim().includes('Çıkış') || b.textContent?.trim() === 'X');
  if (closeBtn) { closeBtn.click(); return true; }
  return false;
});
if (closed) await new Promise(r => setTimeout(r, 1000));

// Ana ekran
await page.screenshot({ path: 'ss_main.png' });
console.log('HOME saved');

// Ayarlar butonunu bul ve tıkla
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const s = btns.find(b => b.getAttribute('aria-label') === 'Ayarlar' || b.title === 'Ayarlar');
  if (s) s.click();
});
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: 'ss_settings.png' });
console.log('SETTINGS saved');

// Görünüm tabına geç
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const t = btns.find(b => b.textContent?.trim() === 'Görünüm');
  if (t) t.click();
});
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: 'ss_settings_appearance.png' });
console.log('SETTINGS APPEARANCE saved');

await browser.close();
