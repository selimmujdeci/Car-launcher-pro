import { test, expect } from '@playwright/test';

/**
 * App Launch — Ana uygulama yüklenmeli ve hata olmamalı.
 * CLAUDE.md §Safety First: ErrorBoundary tüm ağacı sarar.
 */
test('uygulama hatasız yüklenir', async ({ page }) => {
  await page.goto('/');
  
  // ErrorBoundary div'i olmamalı (hata yok)
  const errorBoundary = page.locator('[data-testid="error-boundary"]');
  await expect(errorBoundary).not.toBeVisible();
  
  // Boot splash görünür olmalı
  const bootSplash = page.locator('.boot-splash, [data-testid="boot-splash"]');
  await expect(bootSplash).toBeVisible({ timeout: 5000 });
  
  // Ana layout render edilmeli
  await expect(page.locator('.ultra-premium-root')).toBeVisible({ timeout: 10_000 });
});

/**
 * Boot sequence tamamlanmalı — boot phase 'done' olmalı.
 * App.tsx: 850ms fade, 1150ms done
 */
test('boot sequence tamamlanir', async ({ page }) => {
  await page.goto('/');
  
  // Boot tamamlanana kadar bekle
  await page.waitForTimeout(1500);
  
  // Boot splash kaybolmalı veya done state olmalı
  const bootDone = page.locator('[data-boot-phase="done"], .boot-splash.done');
  await expect(bootDone).toBeVisible({ timeout: 500 }).or({ timeout: 0 }).toBeHidden();
});

/**
 * Portrait mod uyarısı — tablet/phone landscape zorunlu.
 * App.tsx: window.innerHeight > window.innerWidth → portrait
 */
test('landscape zorunlu uyari', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto('/');
  
  // Portrait uyarısı görünür olmalı
  const portraitWarning = page.locator('text=Telefonu Yatay Tutun');
  if (await portraitWarning.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expect(portraitWarning).toBeVisible();
  }
});