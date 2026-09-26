import type { Metadata } from 'next';

/**
 * "Arabam Cebimde" tüketici ürününün KENDİ kimliği — ve TEK kurulum yüzeyi.
 *
 * Kök metadata pazarlama sitesini ve filo panelini tarif eder ("Caros Pro —
 * Araç İçi Yazılım Platformu"); bu başlık Arabam Cebimde kullanıcısına yanlış
 * ürünü gösteriyordu. Next iç içe layout metadata'sı kökü YALNIZ bu route
 * grubu için geçersiz kılar — filo/admin metadata'sı DEĞİŞMEZ.
 *
 * ── KURULUM NEDEN BURADA (tek kanonik yol) ───────────────────────────────
 * Tarayıcı kurulum akışı (`beforeinstallprompt`) sayfaya BAĞLI manifest'e
 * göre çalışır ve kurulan uygulamanın kimliği o manifest'ten gelir. Manifest
 * kökten bağlanınca filo sayfaları da kurulabilir hâle geliyordu. Manifest'i
 * yalnız buraya bağlamak kurulumu tüketici yüzeyinde toplar; site genelindeki
 * "Arabam Cebimde'yi Yükle" düğmesi de kullanıcıyı önce buraya getirir
 * (bkz. `components/PWAInstallButton.tsx`), böylece kurulum HER ZAMAN doğru
 * manifest ve scope altında gerçekleşir.
 */
export const metadata: Metadata = {
  title: 'Arabam Cebimde',
  description: 'Arabam Cebimde — Aracınızı avucunuzun içinden yönetin.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    /* iOS ana ekran kısayolunun adı. Eski "CLP Dashboard" hiçbir ürünle
       eşleşmiyordu ve filo yüzeyinde de yayınlanıyordu. */
    title: 'Arabam Cebimde',
  },
};

// Minimal layout for PWA full-screen pages — no Navbar or Footer
export default function PwaLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
