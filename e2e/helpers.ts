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
 * Supabase'i AĞ SEVİYESİNDE keser — kütük #679.
 *
 * NEDEN GEREKLİ: CI'da secret yoksa `VITE_SUPABASE_URL` fallback'i
 * `https://placeholder.supabase.co`'dur ve o alan adı ÇÖZÜLMEZ. Sonuç: her boot'ta
 * üç `net::ERR_NAME_NOT_RESOLVED` + bir realtime WebSocket hatası konsola düşüyordu.
 * `error-handling.spec.ts` "console error yok" kilidi bu yüzden CI'da YAPISAL OLARAK
 * geçemiyordu — E2E workflow'u 2026-07-10'dan beri bir kez bile yeşil olmadı
 * (42/43 koşum failure) ve kimse fark etmedi.
 *
 * NEDEN FİLTRE DEĞİL MOCK: kilide `ERR_NAME_NOT_RESOLVED` istisnası eklemek testi
 * yeşile boyardı ama GERÇEK ağ hatalarına da kör ederdi. Doğru olan ortamı
 * düzeltmektir: E2E zaten canlı Supabase'i test etmez, etmemelidir de.
 *
 * KAPSAM DAR: yalnız `*.supabase.co` yakalanır. Uygulamanın kendi istekleri
 * (harita karoları, yerel varlıklar) DOKUNULMADAN geçer.
 */
async function stubSupabaseNetwork(page: Page): Promise<void> {
  /* REST/Auth/Storage → boş ama GEÇERLİ JSON. `route.abort()` KULLANILMAZ:
     abort da konsola ağ hatası basar, yani kusuru çözmez yerini değiştirir. */
  await page.route('**://*.supabase.co/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: '[]',
    }),
  );

  /* Realtime WebSocket ayrı bir yoldur: page.route onu YAKALAMAZ.
     Handler boş bırakılır → soket mock'ta açık kalır, gerçek sunucuya gidilmez,
     bağlantı hatası üretilmez. */
  await page.routeWebSocket('**://*.supabase.co/**', () => {});
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
  await stubSupabaseNetwork(page);
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
