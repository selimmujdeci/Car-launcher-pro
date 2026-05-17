import { Page } from '@playwright/test';

/**
 * DisclaimerBanner (z-[200]) localStorage state'ini addInitScript ile önceden set eder.
 * Banner hiç render edilmez → tıklama interception olmaz.
 */
async function injectDisclaimerSeen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'car-launcher-disclaimer',
      JSON.stringify({ state: { seen: true }, version: 0 }),
    );
  });
}

/**
 * Sayfaya gidip boot sequence'i bekler ve DisclaimerBanner'ı kapatır.
 * Tüm beforeEach bloklarında kullanılır.
 *
 * @param page    Playwright Page
 * @param path    Hedef URL (default: '/')
 * @param timeout Boot flag için maksimum bekleme süresi (ms)
 */
export async function gotoAndBoot(page: Page, path = '/', timeout = 10_000): Promise<void> {
  await injectDisclaimerSeen(page);
  await page.goto(path);

  // SystemBoot.start() tamamlandığında window.__APP_READY__ = true set edilir.
  await page.waitForFunction(() => window.__APP_READY__ === true, { timeout });

  // Fallback: disclaimer yine de render edildiyse butona tıkla
  const disclaimerBtn = page.getByRole('button', { name: 'Anladım' });
  if (await disclaimerBtn.isVisible({ timeout: 500 }).catch(() => false)) {
    await disclaimerBtn.click();
    await page.waitForTimeout(300);
  }
}
