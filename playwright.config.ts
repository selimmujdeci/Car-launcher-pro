import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    /* ⚠️ VIEWPORT AÇIKÇA ÇEVRİLİR — kütük #679.
       `isLandscape: true` tek başına YETMEZ: Playwright'ta o bayrak yalnız
       `screen.orientation`ı etkiler, viewport'u DÖNDÜRMEZ. Ölçüldü: bayrak
       varken viewport 393x727 (PORTRE) kalıyordu. Uygulama ise landscape
       zorunludur (App.tsx: innerHeight > innerWidth -> portre uyarısı), bu yüzden
       mobil projeler ürünün DESTEKLEMEDİĞİ bir yönde koşuyor ve ayarlar paneli
       hiç açılmıyordu. Niyet baştan landscape'ti; artık gerçekten öyle. */
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'], viewport: { width: 851, height: 393 }, isLandscape: true },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'], viewport: { width: 844, height: 390 }, isLandscape: true },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});