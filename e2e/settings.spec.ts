import { test, expect } from '@playwright/test';
import { gotoAndBoot } from './helpers';

/**
 * Settings drawer — ayarlar sayfası.
 * DockBar'daki "Ayarlar" butonu horizontally scrollable container içinde — force click kullanılır.
 */
test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndBoot(page);
  });

  /** Ayarlar panelini aç ve içerik görünene kadar bekle. */
  async function openSettings(page: import('@playwright/test').Page): Promise<void> {
    const settingsBtn = page.getByRole('button', { name: 'Ayarlar' }).first();
    const panel = page.locator('[data-theme-surface="settings"]').first();

    /* METNE DEĞİL SÖZLEŞMEYE bakılır (kütük #679): eski hâli `text=Sistem` /
       `text=Arayüz` arıyordu ve o başlıklar üründe ARTIK YOK (grep: 0 eşleşme) —
       panel açılıyor olmasına rağmen test düşüyordu. `data-theme-surface="settings"`
       SettingsPage kökünde duran kararlı işarettir; bölüm adları değişse de kalır.

       TIKLAMA TEKRARLANIR — sebebi ölçüldü: ilk CI koşumunda (run 32485763054) bu
       test chromium ve Mobile Chrome'da **2 flaky** olarak geçti; yani ilk deneme
       düştü, retry kurtardı. Retry ile gizlenen kararsızlık KAPANMIŞ SAYILMAZ.
       İki olasılık AYRILAMADI (yerelde tekrar üretilemedi, CI'da tek gözlem):
         (a) panel lazy-load'u yavaş runner'da 5 sn'yi aşıyor,
         (b) dock yatay kaydırmalı ve `force` tıklama bazen etkisiz kalıyor.
       `toPass` ikisini de kapsar: panel görünene kadar tıklama yeniden denenir.
       ⚠️ (b) doğruysa bu bir ÜRÜN şüphesidir (gerçek kullanıcı da ıskalayabilir) —
       test onu ÖRTMESİN diye burada açıkça yazılıdır. */
    await expect(async () => {
      await settingsBtn.scrollIntoViewIfNeeded().catch(() => {});
      await settingsBtn.click({ force: true });
      await expect(panel).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 25_000 });
  }

  test('ayarlar drawer acilir', async ({ page }) => {
    await openSettings(page);

    const settingsContent = page.locator('[data-theme-surface="settings"]').first();
    await expect(settingsContent).toBeVisible({ timeout: 5000 });
  });

  test('dil degistirme', async ({ page }) => {
    await openSettings(page);

    const languageSelect = page.locator('[data-setting="language"], select[name="language"]');
    if (await languageSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await languageSelect.selectOption('en');
      // UI güncellenmeli — app çalışır olmalı
      await expect(page.locator('.ultra-premium-root').first()).toBeVisible();
    }
  });

  test('ses seviyesi ayarlandi', async ({ page }) => {
    await openSettings(page);

    const volumeSlider = page.locator('[data-setting="volume"], input[type="range"][name="volume"]');
    if (await volumeSlider.isVisible({ timeout: 2000 }).catch(() => false)) {
      await volumeSlider.fill('80');
      const newValue = await volumeSlider.inputValue();
      expect(newValue).toBe('80');
    }
  });

  test('performans modu toggle', async ({ page }) => {
    await openSettings(page);

    const perfToggle = page.locator('[data-setting="performanceMode"], input[type="checkbox"][data-setting="performanceMode"]');
    if (await perfToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      const initialState = await perfToggle.isChecked();
      await perfToggle.click();
      expect(initialState).not.toBe(await perfToggle.isChecked());
    }
  });
});

/**
 * Maintenance settings — bakım hatırlatıcıları.
 */
test('bakim hatirlatici ayarlari', async ({ page }) => {
  await gotoAndBoot(page);

  const maintenanceSection = page.locator('[data-section="maintenance"], .maintenance-section');
  if (await maintenanceSection.isVisible({ timeout: 2000 }).catch(() => false)) {
    const kmInput = page.locator('input[name*="km"], input[placeholder*="km"]').first();
    if (await kmInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await kmInput.fill('50000');
      const value = await kmInput.inputValue();
      expect(value).toBe('50000');
    }
  }
});
