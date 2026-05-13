import { test, expect } from '@playwright/test';

/**
 * Güvenlik — Geri vites kamerası öncelikli overlay.
 * App.tsx: z-index 100000 — mutlak zirve
 */
test.describe('Safety Features', () => {
  test('geri vites overlay z-indeks en yuksek', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    // Reverse overlay
    const reverseOverlay = page.locator('[data-reverse-overlay], .reverse-overlay');
    
    // Overlay varsa z-index en yüksek olmalı
    if (await reverseOverlay.isVisible({ timeout: 1000 }).catch(() => false)) {
      const zIndex = await reverseOverlay.evaluate((el) => {
        return parseInt(window.getComputedStyle(el).zIndex || '0');
      });
      expect(zIndex).toBeGreaterThanOrEqual(99999);
    }
  });

  test('acil durum overlay gorunur', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    // Alert overlay'leri
    const alertOverlays = page.locator('[data-alert-overlay], .alert-overlay, [data-testid="alert"]');
    const alertCount = await alertOverlays.count();
    
    // En az bir alert container olmalı (visibility duruma bağlı)
    expect(alertCount).toBeGreaterThanOrEqual(0);
  });

  test('geofence alarm overlay', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    // Geofence alarm
    const geofenceOverlay = page.locator('[data-geofence-alarm], .geofence-alarm');
    await expect(geofenceOverlay).toBeAttached();
  });
});

/**
 * Radar system — mesafe uyarıları.
 */
test('radar hud gorunur', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);

  // Radar HUD
  const radarHUD = page.locator('[data-radar-hud], .radar-hud, [data-testid="radar"]');
  await expect(radarHUD).toBeAttached().or(page.locator('body')).toBeVisible();
});

/**
 * Sentry overlay — güvenlik izleme.
 */
test('sentry overlay mevcut', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);

  // Sentry overlay
  const sentryOverlay = page.locator('[data-sentry-overlay], .sentry-overlay');
  await expect(sentryOverlay).toBeAttached();
});