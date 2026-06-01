import { lazy, type ComponentType } from 'react';

/**
 * Dinamik import'lar için dayanıklı `lazy` sarmalayıcısı.
 *
 * Vite dev server yeniden başladığında ya da yeni bir build deploy edildiğinde
 * tarayıcının elindeki eski chunk hash'i 404/network hatası verir ve
 * "Failed to fetch dynamically imported module" hatası ErrorBoundary'e düşer.
 * Bu, head unit gibi ağ bağlantısı kesintili ortamlarda sürüş sırasında
 * tüm UI'ın çökmesine yol açar.
 *
 * Çözüm:
 *  1. Geçici hatada kısa gecikmelerle birkaç kez tekrar dener (network blip).
 *  2. Kalıcı chunk-yükleme hatasında (eski chunk artık sunucuda yok) sayfayı
 *     bir kez yeniden yükler — ama sonsuz reload döngüsünü sessionStorage
 *     bayrağıyla engeller.
 */
// NOT: kısıt `ComponentType<any>` — `unknown` props'lu kısıt, tipli props'a sahip
// bileşenlerde varyans çökmesine (default → never) yol açıp tüm lazy çağrı
// noktalarında "IntrinsicAttributes" hatası üretiyordu. `any` props'u korur.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  opts: { retries?: number; interval?: number } = {},
): ReturnType<typeof lazy<T>> {
  const { retries = 3, interval = 350 } = opts;

  return lazy(async () => {
    let lastErr: unknown;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const mod = await factory();
        // Başarılı yükleme → varsa reload bayrağını temizle
        try { sessionStorage.removeItem('chunk-reload'); } catch { /* ignore */ }
        return mod;
      } catch (err) {
        lastErr = err;
        // Son denemede değilsek kısa bekleyip tekrar dene (artan gecikme)
        if (attempt < retries - 1) {
          await new Promise((r) => setTimeout(r, interval * (attempt + 1)));
        }
      }
    }

    // Tüm denemeler başarısız — büyük olasılıkla yeni deploy ile eski chunk
    // artık sunucuda yok. Bir kez sayfayı yenile (döngüye girme).
    let alreadyReloaded = false;
    try {
      alreadyReloaded = sessionStorage.getItem('chunk-reload') === '1';
      if (!alreadyReloaded) sessionStorage.setItem('chunk-reload', '1');
    } catch { /* sessionStorage erişilemiyor — reload denemesini atla */ }

    if (!alreadyReloaded) {
      window.location.reload();
      // reload tetiklendi; Suspense'i askıda tutmak için asla resolve olmayan promise dön
      return new Promise<{ default: T }>(() => {});
    }

    // Zaten bir kez yenilendi ve hâlâ başarısız → ErrorBoundary'e bırak
    throw lastErr;
  });
}
