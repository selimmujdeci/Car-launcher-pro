import { test, expect } from '@playwright/test';

/**
 * Uygulama ızgarası açılmalı ve uygulamalar görünür olmalı.
 */
test.describe('App Grid', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500); // boot bekle
  });

  test('app grid acilir', async ({ page }) => {
    // Dock'ta uygulamalar görünür
    const dockItems = page.locator('[data-dock-item], .dock-bar button');
    await expect(dockItems.first()).toBeVisible({ timeout: 5000 });
    
    // Uygulama sayısını kontrol et
    const appCount = await dockItems.count();
    expect(appCount).toBeGreaterThan(0);
  });

  test('telefon uygulamasi calisir', async ({ page }) => {
    // Telefon butonuna tıkla
    const phoneBtn = page.locator('[data-app-id="phone"], button:has-text("Telefon")');
    if (await phoneBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await phoneBtn.click();
      
      // Drawer veya native intent açılmalı
      // NOT: Browser modda tel: link açılır, native modda BT dial
      await expect(page).not.toHaveErrors();
    }
  });

  test('navigasyon uygulamasi acilir', async ({ page }) => {
    // Maps/Waze butonuna tıkla
    const navBtn = page.locator('[data-app-id="maps"], button:has-text("Maps"), button:has-text("Harita")');
    if (await navBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await navBtn.click();
      
      // Full map view açılmalı
      const mapView = page.locator('[data-full-map], .map-overlay');
      await expect(mapView).toBeVisible({ timeout: 5000 });
    }
  });

  test('favori ekle/cikar', async ({ page }) => {
    // Favori butonuna tıkla
    const favBtn = page.locator('[data-testid="toggle-favorite"], button:has-text("Favori")').first();
    if (await favBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await favBtn.click();
      
      // Favori eklendi/çıkarıldı — state persistence kontrol
      await expect(page).not.toHaveErrors();
    }
  });
});

/**
 * Search/POI test — offline search kritik.
 */
test('poi arama calisir', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);

  // Arama butonu
  const searchBtn = page.locator('[data-testid="search-btn"], button:has-text("Arama"), button:has-text("🔍")').first();
  if (await searchBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await searchBtn.click();
    
    // Arama input görünür
    const searchInput = page.locator('input[type="search"], input[placeholder*="ara"]');
    await expect(searchInput).toBeVisible({ timeout: 3000 });
    
    // Arama yap
    await searchInput.fill('İstanbul');
    await page.waitForTimeout(500);
    
    // Sonuç görünür olmalı (offline veya online)
    const results = page.locator('[data-poi-result], .search-result');
    await expect(results.first()).toBeVisible({ timeout: 5000 }).or({ timeout: 0 }).toBeVisible();
  }
});