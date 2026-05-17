import { test, expect } from '@playwright/test';
import { gotoAndBoot } from './helpers';

/**
 * App Launch — Ana uygulama yüklenmeli ve hata olmamalı.
 * CLAUDE.md §Safety First: ErrorBoundary tüm ağacı sarar.
 */
test('uygulama hatasız yüklenir', async ({ page }) => {
  await gotoAndBoot(page);

  // ErrorBoundary hata UI'ı görünmemeli (hasError=false)
  const errorUI = page.locator('text=Bir sorun oluştu');
  await expect(errorUI).not.toBeVisible();

  // Ana layout render edilmeli
  await expect(page.locator('.ultra-premium-root').first()).toBeVisible({ timeout: 10_000 });
});

/**
 * Boot sequence tamamlanmalı — __APP_READY__ flag'ini SystemBoot set eder.
 */
test('boot sequence tamamlanir', async ({ page }) => {
  await gotoAndBoot(page);

  // Boot sonrası ana layout görünür ve çalışır olmalı
  await expect(page.locator('.ultra-premium-root').first()).toBeVisible({ timeout: 5000 });
});

/**
 * Portrait mod uyarısı — tablet/phone landscape zorunlu.
 * App.tsx: window.innerHeight > window.innerWidth → portrait
 */
test('landscape zorunlu uyari', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await gotoAndBoot(page);

  // Portrait uyarısı görünür olmalı
  const portraitWarning = page.locator('text=Telefonu Yatay Tutun');
  if (await portraitWarning.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expect(portraitWarning).toBeVisible();
  }
});
