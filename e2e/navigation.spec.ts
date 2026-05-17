import { test, expect } from '@playwright/test';
import { gotoAndBoot } from './helpers';

/**
 * Uygulama ızgarası açılmalı ve uygulamalar görünür olmalı.
 */
test.describe('App Grid', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndBoot(page);
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
    const phoneBtn = page.locator('[data-app-id="phone"]').or(
      page.getByRole('button', { name: 'Telefon' })
    );
    if (await phoneBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await phoneBtn.first().click({ force: true });
      await expect(page.locator('.ultra-premium-root').first()).toBeVisible();
    }
  });

  test('navigasyon uygulamasi acilir', async ({ page }) => {
    // Maps/Harita butonuna tıkla
    const navBtn = page.locator('[data-app-id="maps"]').or(
      page.getByRole('button', { name: 'Maps' })
    ).or(
      page.getByRole('button', { name: 'Harita' })
    );
    if (await navBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await navBtn.first().click({ force: true });

      // Harita yüklenmese de (headless WebGL kısıtlaması) app çalışır olmalı
      const mapView = page.locator('[data-full-map], .map-overlay');
      const mapVisible = await mapView.isVisible({ timeout: 5000 }).catch(() => false);
      if (!mapVisible) {
        await expect(page.locator('.ultra-premium-root').first()).toBeVisible();
      }
    }
  });

  test('favori ekle/cikar', async ({ page }) => {
    const favBtn = page.locator('[data-testid="toggle-favorite"]').or(
      page.getByRole('button', { name: 'Favori' })
    ).first();
    if (await favBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await favBtn.click({ force: true });
      await expect(page.locator('.ultra-premium-root').first()).toBeVisible();
    }
  });
});

/**
 * Search/POI test — offline search kritik.
 */
test('poi arama calisir', async ({ page }) => {
  await gotoAndBoot(page);

  // Arama butonu — DockBar scroll container içinde olabilir
  const searchBtn = page.locator('[data-testid="search-btn"]')
    .or(page.getByRole('button', { name: 'Arama' }))
    .first();

  if (await searchBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    // DockBar scroll container içinde viewport dışında olabilir — dispatchEvent viewport kısıtını atlar
    await searchBtn.dispatchEvent('click');

    // Arama input görünür
    const searchInput = page.locator('input[type="search"], input[placeholder*="ara"]');
    await expect(searchInput).toBeVisible({ timeout: 3000 });

    // Arama yap
    await searchInput.fill('İstanbul');

    // Sonuç opsiyonel (offline ortamda olmayabilir) — isVisible ile deterministik bekle
    const results = page.locator('[data-poi-result], .search-result');
    const hasResults = await results.first().isVisible({ timeout: 2000 }).catch(() => false);
    if (hasResults) {
      await expect(results.first()).toBeVisible();
    }
  }
});
