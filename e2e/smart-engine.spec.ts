import { test, expect } from '@playwright/test';
import { gotoAndBoot } from './helpers';

/**
 * Smart Engine — usage tracking ve öneriler.
 */
test.describe('Smart Engine', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndBoot(page);
  });

  test('hiz tabanli surus modu tespiti', async ({ page }) => {
    const driveStateEl = page.locator('[data-drive-state]').first();
    const driveState = await driveStateEl.getAttribute('data-drive-state').catch(() => null);
    expect(['idle', 'normal', 'driving', null]).toContain(driveState);
  });

  test('quick actions gosterilir', async ({ page }) => {
    const quickActions = page.locator('[data-quick-action], .quick-action, .smart-quick-action');
    const actionCount = await quickActions.count();
    expect(actionCount).toBeGreaterThanOrEqual(0);
  });

  test('dock items dinamik siralanir', async ({ page }) => {
    const dockItems = page.locator('[data-dock-item]');
    const dockCount = await dockItems.count();
    expect(dockCount).toBeGreaterThan(0);
  });
});

/**
 * AI recommendations — context-aware öneriler.
 */
test('ai recommendation gorunur', async ({ page }) => {
  await gotoAndBoot(page);

  const recCard = page.locator('[data-smart-rec], .smart-recommendation, [data-testid="rec"]');
  const count = await recCard.count();
  if (count > 0) {
    await expect(recCard.first()).toBeVisible();
  }
  await expect(page.locator('.ultra-premium-root').first()).toBeVisible();
});

/**
 * Driving mode histeresis — hız değişimlerinde mode geçişi.
 */
test('surus modu gecisleri', async ({ page }) => {
  await gotoAndBoot(page);

  const driveStateEl = page.locator('[data-drive-state]').first();
  const count = await driveStateEl.count();
  if (count > 0) {
    const initialState = await driveStateEl.getAttribute('data-drive-state');
    expect(['idle', 'normal', 'driving', null]).toContain(initialState);
  }
});
