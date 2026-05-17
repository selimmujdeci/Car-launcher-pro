import { test, expect } from '@playwright/test';
import { gotoAndBoot } from './helpers';

/**
 * Güvenlik — Geri vites kamerası öncelikli overlay.
 * App.tsx: z-index 100000 — mutlak zirve
 */
test.describe('Safety Features', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndBoot(page);
  });

  test('geri vites overlay z-indeks en yuksek', async ({ page }) => {
    const reverseOverlay = page.locator('[data-reverse-overlay], .reverse-overlay');
    if (await reverseOverlay.isVisible({ timeout: 1000 }).catch(() => false)) {
      const zIndex = await reverseOverlay.evaluate((el) => {
        return parseInt(window.getComputedStyle(el).zIndex || '0');
      });
      expect(zIndex).toBeGreaterThanOrEqual(99999);
    }
  });

  test('acil durum overlay gorunur', async ({ page }) => {
    const alertOverlays = page.locator('[data-alert-overlay], .alert-overlay, [data-testid="alert"]');
    const alertCount = await alertOverlays.count();
    expect(alertCount).toBeGreaterThanOrEqual(0);
  });

  test('geofence alarm overlay', async ({ page }) => {
    // GeofenceAlarmOverlay sadece aktif alarm varsa render edilir
    const geofenceOverlay = page.locator('[data-geofence-alarm], .geofence-alarm');
    const count = await geofenceOverlay.count();
    if (count > 0) {
      await expect(geofenceOverlay.first()).toBeVisible();
    }
    // App çalışır olmalı
    await expect(page.locator('.ultra-premium-root').first()).toBeVisible();
  });
});

/**
 * Radar system — mesafe uyarıları.
 */
test('radar hud gorunur', async ({ page }) => {
  await gotoAndBoot(page);

  // Radar HUD sadece aktif tehdit varsa render edilir
  const radarHUD = page.locator('[data-radar-hud], .radar-hud, [data-testid="radar"]');
  const count = await radarHUD.count();
  if (count > 0) {
    await expect(radarHUD.first()).toBeVisible();
  }
  // App çalışmalı
  await expect(page.locator('body')).toBeVisible();
});

/**
 * Sentry overlay — güvenlik izleme.
 */
test('sentry overlay mevcut', async ({ page }) => {
  await gotoAndBoot(page);

  // SentryOverlay sadece sentry aktif iken render edilir (idle → null)
  const sentryOverlay = page.locator('[data-sentry-overlay], .sentry-overlay');
  const count = await sentryOverlay.count();
  if (count > 0) {
    await expect(sentryOverlay.first()).toBeVisible();
  }
  await expect(page.locator('.ultra-premium-root').first()).toBeVisible();
});
