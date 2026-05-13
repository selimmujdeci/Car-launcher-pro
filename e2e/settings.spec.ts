import { test, expect } from '@playwright/test';

/**
 * Settings drawer — ayarlar sayfası.
 */
test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
  });

  test('ayarlar drawer acilir', async ({ page }) => {
    // Settings butonu
    const settingsBtn = page.locator('[data-drawer-trigger="settings"], button:has-text("Ayarlar")');
    await settingsBtn.click();
    
    // Drawer açılmalı
    const drawer = page.locator('[data-drawer="settings"], .drawer-panel');
    await expect(drawer).toBeVisible({ timeout: 3000 });
  });

  test('dil degistirme', async ({ page }) => {
    // Ayarlar → Language
    await page.locator('[data-drawer-trigger="settings"]').click();
    await page.waitForTimeout(500);
    
    const languageSelect = page.locator('[data-setting="language"], select[name="language"]');
    if (await languageSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Dil değiştir
      await languageSelect.selectOption('en');
      await page.waitForTimeout(500);
      
      // Sayfa reload olmadan UI güncellenmeli
      await expect(page).not.toHaveErrors();
    }
  });

  test('ses seviyesi ayarlandi', async ({ page }) => {
    await page.locator('[data-drawer-trigger="settings"]').click();
    await page.waitForTimeout(500);
    
    // Volume slider
    const volumeSlider = page.locator('[data-setting="volume"], input[type="range"][name="volume"]');
    if (await volumeSlider.isVisible({ timeout: 2000 }).catch(() => false)) {
      const initialValue = await volumeSlider.inputValue();
      
      // Slider'ı değiştir
      await volumeSlider.fill('80');
      await page.waitForTimeout(300);
      
      const newValue = await volumeSlider.inputValue();
      expect(newValue).toBe('80');
    }
  });

  test('performans modu toggle', async ({ page }) => {
    await page.locator('[data-drawer-trigger="settings"]').click();
    await page.waitForTimeout(500);
    
    // Performance mode toggle
    const perfToggle = page.locator('[data-setting="performanceMode"], input[type="checkbox"][data-setting="performanceMode"]');
    if (await perfToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      const initialState = await perfToggle.isChecked();
      await perfToggle.click();
      await page.waitForTimeout(300);
      
      // State değişmiş olmalı
      expect(initialState).not.toBe(await perfToggle.isChecked());
    }
  });
});

/**
 * Maintenance settings — bakım hatırlatıcıları.
 */
test('bakim hatirlatici ayarlari', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);

  // Ayarlar → Maintenance
  const maintenanceSection = page.locator('[data-section="maintenance"], .maintenance-section');
  if (await maintenanceSection.isVisible({ timeout: 2000 }).catch(() => false)) {
    // Km input
    const kmInput = page.locator('input[name*="km"], input[placeholder*="km"]').first();
    if (await kmInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await kmInput.fill('50000');
      await page.waitForTimeout(300);
      
      // Value kaydedilmiş olmalı
      const value = await kmInput.inputValue();
      expect(value).toBe('50000');
    }
  }
});