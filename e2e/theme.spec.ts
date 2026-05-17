import { test, expect } from '@playwright/test';
import { gotoAndBoot } from './helpers';

/**
 * Tema değişimi — Tesla, BMW, Mercedes, Audi, Glass Pro, OLED Pro.
 */
test.describe('Theme System', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndBoot(page);
  });

  test('tema degistirme calisir', async ({ page }) => {
    const settingsBtn = page.locator('[data-drawer-trigger="settings"], button:has-text("Ayarlar")').first();
    const themeOptions = page.locator('[data-theme-option], .theme-option, [data-testid="theme"]');

    if (await settingsBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await settingsBtn.click({ force: true });
      // Tema seçenekleri görünene kadar bekle
      await themeOptions.first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    }

    const themeCount = await themeOptions.count();
    if (themeCount > 0) {
      await themeOptions.first().click();

      // Tema değişikliği uygulanmış olmalı
      const html = page.locator('html');
      const themePack = await html.getAttribute('data-theme-pack');
      expect(themePack).toBeTruthy();
    }
  });

  test('gece modu aktif', async ({ page }) => {
    const nightModeToggle = page.locator('[data-night-mode], .night-mode-toggle, input[type="checkbox"][data-setting="autoTheme"]');
    if (await nightModeToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      const isChecked = await nightModeToggle.isChecked();

      await nightModeToggle.click();

      // State değişmiş olmalı — isChecked() kendi auto-wait'iyle güvenli
      const newState = await nightModeToggle.isChecked();
      expect(newState).not.toBe(isChecked);
    }
  });

  test('widget stil degisimi', async ({ page }) => {
    const widgetStyleOptions = page.locator('[data-widget-style], .widget-style-option');
    const styleCount = await widgetStyleOptions.count();

    if (styleCount > 1) {
      await widgetStyleOptions.nth(1).click();

      // Değişiklik uygulandı — app çalışır olmalı
      await expect(page.locator('.ultra-premium-root').first()).toBeVisible();
    }
  });
});

/**
 * Widget visibility — widget'ların show/hide durumu.
 */
test('widget gosterim ayarlari', async ({ page }) => {
  await gotoAndBoot(page);

  const widgetToggles = page.locator('[data-widget-toggle], .widget-toggle');
  const toggleCount = await widgetToggles.count();

  if (toggleCount > 0) {
    const firstToggle = widgetToggles.first();
    const initialVisible = await firstToggle.isChecked();

    await firstToggle.click();

    // Durum değişmiş olmalı
    const newVisible = await firstToggle.isChecked();
    expect(newVisible).not.toBe(initialVisible);
  }
});
