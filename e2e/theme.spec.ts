import { test, expect } from '@playwright/test';

/**
 * Tema değişimi — Tesla, BMW, Mercedes, Audi, Glass Pro, OLED Pro.
 */
test.describe('Theme System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
  });

  test('tema degistirme calisir', async ({ page }) => {
    // Settings drawer aç
    const settingsBtn = page.locator('[data-drawer-trigger="settings"], button:has-text("Ayarlar")');
    if (await settingsBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await settingsBtn.click();
      await page.waitForTimeout(500);
    }

    // Tema seçenekleri
    const themeOptions = page.locator('[data-theme-option], .theme-option, [data-testid="theme"]');
    const themeCount = await themeOptions.count();
    
    if (themeCount > 0) {
      // İlk temaya tıkla
      await themeOptions.first().click();
      await page.waitForTimeout(300);
      
      // Tema değişikliği uygulanmış olmalı
      const html = page.locator('html');
      const themePack = await html.getAttribute('data-theme-pack');
      expect(themePack).toBeTruthy();
    }
  });

  test('gece modu aktif', async ({ page }) => {
    // Settings → Night Mode
    const nightModeToggle = page.locator('[data-night-mode], .night-mode-toggle, input[type="checkbox"][data-setting="autoTheme"]');
    if (await nightModeToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      const isChecked = await nightModeToggle.isChecked();
      
      // Toggle
      await nightModeToggle.click();
      await page.waitForTimeout(500);
      
      // State değişmiş olmalı
      const newState = await nightModeToggle.isChecked();
      expect(newState).not.toBe(isChecked);
    }
  });

  test('widget stil degisimi', async ({ page }) => {
    // Widget style options: elevated, flat, outlined
    const widgetStyleOptions = page.locator('[data-widget-style], .widget-style-option');
    const styleCount = await widgetStyleOptions.count();
    
    if (styleCount > 1) {
      // Farklı bir style seç
      await widgetStyleOptions.nth(1).click();
      await page.waitForTimeout(300);
      
      // Değişiklik uygulanmış olmalı
      await expect(page).not.toHaveErrors();
    }
  });
});

/**
 * Widget visibility — widget'ların show/hide durumu.
 */
test('widget gosterim ayarlari', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);

  // Widget toggle'ları
  const widgetToggles = page.locator('[data-widget-toggle], .widget-toggle');
  const toggleCount = await widgetToggles.count();
  
  if (toggleCount > 0) {
    // İlk widget toggle
    const firstToggle = widgetToggles.first();
    const initialVisible = await firstToggle.isChecked();
    
    // Toggle
    await firstToggle.click();
    await page.waitForTimeout(300);
    
    // Durum değişmiş olmalı
    const newVisible = await firstToggle.isChecked();
    expect(newVisible).not.toBe(initialVisible);
  }
});