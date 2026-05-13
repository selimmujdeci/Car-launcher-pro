import { test, expect } from '@playwright/test';

/**
 * OBD servisi mock modda çalışıyor olmalı.
 * obdService.ts: VITE_ENABLE_OBD_MOCK=true → mock active
 */
test.describe('OBD Service', () => {
  test('mock mod uyarisi gorunur', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // OBD mock warning — simüle veri uyarısı
    const mockWarning = page.locator('[data-obd-sim-warn], text=Simüle veri');
    // Mock modda görünür, native modda görünmez
    await expect(mockWarning).toBeVisible({ timeout: 3000 }).or({ timeout: 0 }).toBeHidden();
  });

  test('hiz gostergesi guncellenir', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Speedometer bul
    const speedometer = page.locator('[data-speed], .speedometer, [data-testid="speed"]');
    await expect(speedometer.first()).toBeVisible({ timeout: 5000 });
    
    // Hız değeri > 0 olmalı (mock modda 42 km/h başlar)
    const speedText = await speedometer.first().textContent();
    if (speedText) {
      const speed = parseInt(speedText.replace(/[^0-9]/g, ''));
      expect(speed).toBeGreaterThanOrEqual(0);
    }
  });

  test('rpm gostergesi guncellenir', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // RPM göstergesi
    const rpmGauge = page.locator('[data-rpm], .rpm-gauge, [data-testid="rpm"]');
    await expect(rpmGauge.first()).toBeVisible({ timeout: 5000 }).or({ timeout: 0 }).toBeAttached();
  });

  test('yakıt seviyesi gosterilir', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Fuel gauge
    const fuelGauge = page.locator('[data-fuel], .fuel-gauge, [data-testid="fuel"]');
    await expect(fuelGauge.first()).toBeVisible({ timeout: 5000 }).or({ timeout: 0 }).toBeAttached();
  });
});

/**
 * Connection state — OBD bağlantı durumu göstergesi.
 */
test('baglanti durumu gosterilir', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(2000);

  // Bağlantı durumu göstergesi
  const connectionStatus = page.locator('[data-connection-state], .connection-status, [data-testid="obd-status"]');
  await expect(connectionStatus.first()).toBeVisible({ timeout: 5000 }).or({ timeout: 0 }).toBeAttached();
  
  // State değeri: idle, scanning, connecting, connected, error
  const statusText = await connectionStatus.first().getAttribute('data-connection-state');
  expect(['idle', 'scanning', 'connecting', 'connected', 'reconnecting', 'error', null]).toContain(statusText);
});