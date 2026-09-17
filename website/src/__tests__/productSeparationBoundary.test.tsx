/**
 * productSeparationBoundary — ARABAM CEBİMDE ↔ FİLO ÜRÜN SINIRI.
 *
 * ── ÖLÇÜLEN KUSURLAR (canlı üretimde doğrulandı, 2026-09-17) ─────────────
 *  1. Manifest kök layout'tan TÜM sayfalara bağlıydı: `carospro.com/login`
 *     (filo yüzeyi) HTML'inde `rel="manifest"` çıkıyordu ve manifest
 *     `{"name":"Arabam Cebimde","start_url":"/kumanda"}` döndürüyordu →
 *     filo kullanıcısı telefonuna tüketici ürününü kurabiliyordu.
 *  2. `scope` tanımsızdı (varsayılan `/`) → kurulu tüketici uygulaması filo
 *     panelini de standalone açıyordu.
 *  3. `sw.js` bildirim allowlist'i YALNIZ `/dashboard`a izin veriyordu; oysa
 *     `push-notify` Edge Function tüketici bildirimini `${appUrl}/kumanda`
 *     olarak gönderiyor → tüketici bildirimi sessizce filo paneline düşüyordu.
 *
 * Testler davranışa bakar: gerçek `sw.js` sandbox'ta yürütülür, gerçek
 * manifest fonksiyonu çağrılır, bileşenler render edilir.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { metadata as pwaMetadata } from '@/app/(pwa)/layout';
import PWAInstallButton from '@/components/PWAInstallButton';
import PwaInstallPrompt from '@/components/pwa/PwaInstallPrompt';

/* ── Gerçek service worker'ı izole bir kapsamda yükle ── */
type SwApi = {
  safeNotificationTarget: (raw: unknown) => string;
  productTitleFor: (url: string) => string;
};
type SwHarness = {
  api: SwApi;
  listeners: Record<string, (event: unknown) => void>;
  shown: Array<{ title: string; options: { data?: { url?: string } } }>;
};

function loadServiceWorker(origin = 'https://carospro.com'): SwHarness {
  const source = readFileSync(
    resolve(process.cwd(), 'public', 'sw.js'), 'utf8',
  );
  const listeners: Record<string, (event: unknown) => void> = {};
  const shown: SwHarness['shown'] = [];
  const selfStub = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    },
    location: { origin },
    skipWaiting: () => Promise.resolve(),
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve([]),
      openWindow: (url: string) => Promise.resolve({ url }),
    },
    registration: {
      showNotification: (title: string, options: { data?: { url?: string } }) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
  };
  const factory = new Function(
    'self',
    `${source}\n;return { safeNotificationTarget, productTitleFor };`,
  ) as (s: unknown) => SwApi;
  return { api: factory(selfStub), listeners, shown };
}

/**
 * Manifest artık STATİK dosyadır (`public/manifest.webmanifest`).
 *
 * Bunun sebebi ölçülmüştür: `app/manifest.ts` (Next dosya-tabanlı metadata)
 * mevcutken Next, `<link rel="manifest">` etiketini `metadata.manifest`
 * ayarından BAĞIMSIZ olarak HER sayfaya ekliyor — kök layout'tan kaldırmak
 * filo sayfalarındaki manifest'i kaldırmıyordu (build çıktısında doğrulandı).
 * Statik dosya + yalnız `(pwa)` layout'ta `metadata.manifest` = route-scoped
 * kurulum için tek güvenilir yol.
 */
function readManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(
    resolve(process.cwd(), 'public', 'manifest.webmanifest'), 'utf8',
  )) as Record<string, unknown>;
}

describe('ürün sınırı · manifest yalnız tüketici ürününü tarif eder', () => {
  it('manifest kimliği, start_url ve scope Arabam Cebimde yüzeyine bağlıdır', () => {
    const m = readManifest();
    expect(m.name).toBe('Arabam Cebimde');
    expect(m.start_url).toBe('/kumanda');
    /* scope olmadan kurulu uygulama TÜM siteyi (filo dahil) standalone açardı. */
    expect(m.scope).toBe('/kumanda');
    /* `id` sabit: start_url ileride değişse bile aynı uygulama sayılır ve
       native APK'ya geçişte kimlik sürekliliği korunur. */
    expect(m.id).toBe('/kumanda');
  });

  it('start_url scope İÇİNDEDİR (aksi hâlde kurulum açılışta scope dışına düşer)', () => {
    const m = readManifest();
    const scope = String(m.scope);
    expect(String(m.start_url).startsWith(scope)).toBe(true);
  });

  it('dosya-tabanlı manifest route\'u YOKTUR (yoksa Next her sayfaya link ekler)', () => {
    /* Bu dosya geri gelirse filo sayfaları yeniden kurulabilir hâle gelir —
       kusurun tam olarak ölçülen sebebi budur. */
    expect(existsSync(resolve(process.cwd(), 'src', 'app', 'manifest.ts')))
      .toBe(false);
  });

  it('manifest tüketici route grubundan bağlanır', () => {
    expect(pwaMetadata.manifest).toBe('/manifest.webmanifest');
    /* iOS ana ekran adı da tüketici yüzeyine aittir. */
    expect(pwaMetadata.appleWebApp).toMatchObject({ title: 'Arabam Cebimde' });
  });

  it('kök layout manifest/iOS ürün adı YAYINLAMAZ (filo yüzeyi kurulamaz)', () => {
    /* Kök layout `next/font` kullandığı için import edilmez; sözleşme
       dosyanın kendisinde kilitlenir: bu iki alan köke geri eklenirse filo
       sayfaları yeniden kurulabilir hâle gelir. */
    const source = readFileSync(
      resolve(process.cwd(), 'src', 'app', 'layout.tsx'), 'utf8',
    );
    const code = source.split('\n')
      .filter((line) => {
        const t = line.trimStart();
        return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
      })
      .join('\n');
    expect(code).not.toMatch(/manifest:\s*'/);
    expect(code).not.toMatch(/appleWebApp:/);
  });
});

describe('ürün sınırı · service worker bildirimleri doğru ürüne götürür', () => {
  it('tüketici bildirimi filoya DÜŞÜRÜLMEZ', () => {
    const { api } = loadServiceWorker();
    /* `push-notify` Edge Function tam olarak bu şekli gönderiyor. */
    expect(api.safeNotificationTarget('https://carospro.com/kumanda'))
      .toBe('/kumanda');
  });

  it('filo bildirimi eskisi gibi filoya gider (davranış korundu)', () => {
    const { api } = loadServiceWorker();
    expect(api.safeNotificationTarget('https://carospro.com/dashboard'))
      .toBe('/dashboard');
    expect(api.safeNotificationTarget('https://carospro.com/dashboard/fleet'))
      .toBe('/dashboard/fleet');
  });

  it('yabancı origin ve allowlist dışı yol reddedilir (açık yönlendirme yok)', () => {
    const { api } = loadServiceWorker();
    expect(api.safeNotificationTarget('https://evil.example.com/kumanda'))
      .toBe('/dashboard');
    expect(api.safeNotificationTarget('/admin')).toBe('/dashboard');
    expect(api.safeNotificationTarget(undefined)).toBe('/dashboard');
    /* Önek taklidi: `/kumandaXYZ` tüketici yolu DEĞİLDİR. */
    expect(api.safeNotificationTarget('https://carospro.com/kumandaXYZ'))
      .toBe('/dashboard');
  });

  it('başlıksız bildirimde ürün adı hedefe göre seçilir', () => {
    const { api } = loadServiceWorker();
    expect(api.productTitleFor('/kumanda')).toBe('Arabam Cebimde');
    expect(api.productTitleFor('/dashboard')).toBe('CarOS Pro');
  });

  it('push olayı tüketici hedefini bildirimde KORUR', async () => {
    const { listeners, shown } = loadServiceWorker();
    const waits: Array<Promise<unknown>> = [];
    listeners['push']?.({
      data: { json: () => ({ body: 'Araç kilitlendi', url: 'https://carospro.com/kumanda' }) },
      waitUntil: (p: Promise<unknown>) => { waits.push(p); },
    });
    await Promise.all(waits);

    expect(shown).toHaveLength(1);
    expect(shown[0].options.data?.url).toBe('/kumanda');
    expect(shown[0].title).toBe('Arabam Cebimde');
  });
});

describe('ürün sınırı · kurulum tek kanonik yoldan yapılır', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.clearAllMocks();
  });

  it('site genelindeki düğme kurulumu AÇMAZ; tüketici yüzeyine götürür', async () => {
    await act(async () => { root.render(createElement(PWAInstallButton)); });
    const link = host.querySelector('a');
    /* Pazarlama sayfasında manifest yok; kurulum orada teklif edilirse
       tarayıcı ya hiç prompt vermez ya da yanlış kimlikle kurar. */
    expect(link?.getAttribute('href')).toBe('/kumanda');
    expect(host.querySelector('button')).toBeNull();
  });

  it('tüketici yüzeyi kurulumu YALNIZ tarayıcı teklif edince gösterir', async () => {
    await act(async () => { root.render(createElement(PwaInstallPrompt)); });
    /* Olay yoksa sahte bir "yükle" düğmesi ÜRETİLMEZ. */
    expect(host.querySelector('[data-testid="pwa-install-prompt"]')).toBeNull();

    await act(async () => {
      const event = new Event('beforeinstallprompt');
      window.dispatchEvent(event);
    });
    expect(host.querySelector('[data-testid="pwa-install-prompt"]')).not.toBeNull();
  });
});
