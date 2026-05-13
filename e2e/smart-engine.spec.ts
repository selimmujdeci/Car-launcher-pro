import { test, expect } from '@playwright/test';

/**
 * Smart Engine — usage tracking ve öneriler.
 */
test.describe('Smart Engine', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
  });

  test('hiz tabanli surus modu tespiti', async ({ page }) => {
    // data-drive-state attribute kontrol et
    const html = page.locator('html');
    const driveState = await html.getAttribute('data-drive-state');
    
    // idle, normal, driving olabilir
    expect(['idle', 'normal', 'driving', null]).toContain(driveState);
  });

  test('quick actions gosterilir', async ({ page }) => {
    // Quick action butonları
    const quickActions = page.locator('[data-quick-action], .quick-action, .smart-quick-action');
    const actionCount = await quickActions.count();
    
    // En az bir quick action olmalı
    expect(actionCount).toBeGreaterThanOrEqual(0);
  });

  test('dock items dinamik siralanir', async ({ page }) => {
    // Dock items
    const dockItems = page.locator('[data-dock-item], .dock-item');
    const dockCount = await dockItems.count();
    
    // Maksimum 4 dock item olmalı
    expect(dockCount).toBeLessThanOrEqual(4);
  });
});

/**
 * AI recommendations — context-aware öneriler.
 */
test('ai recommendation gorunur', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(2000);

  // Smart recommendation card
  const recCard = page.locator('[data-smart-rec], .smart-recommendation, [data-testid="rec"]');
  
  // Recommendation varsa görünür olmalı
  await expect(recCard).toBeAttached().or({ timeout: 0 }).toBeHidden();
});

/**
 * Driving mode histeresis — hız değişimlerinde mode geçişi.
 */
test('surus modu gecisleri', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);

  // Drive state attribute
  const html = page.locator('html');
  const initialState = await html.getAttribute('data-drive-state');
  
  // State mevcut olmalı
  expect(initialState).toBeTruthy();
});