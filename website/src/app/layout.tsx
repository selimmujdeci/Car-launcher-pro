import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import PWARegistration from '@/components/layout/PWARegistration';
import { AuthRecoveryHandler } from '@/components/auth/AuthRecoveryHandler';
import { CONSOLE_THEME_BOOT_SCRIPT } from '@/lib/console/consoleTheme';

/* Fontlar repoda (./fonts, SIL OFL 1.1) — build sırasında Google Fonts'a
   gidilmez. Google loader'ının build-time fetch'i aralıklı olarak
   "Cannot read properties of null (reading '1')" ile build'i düşürüyordu.
   Dosyalar google/fonts değişken fontlarının latin + latin-ext alt kümesi
   (Türkçe ğ ş ı İ ç ö ü dahil). Aileler: Inter · JetBrains Mono · Fraunces. */
const inter = localFont({
  src: './fonts/Inter-Variable.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-sans',
});
const jetbrainsMono = localFont({
  src: './fonts/JetBrainsMono-Variable.woff2',
  weight: '400 700',
  display: 'swap',
  variable: '--font-mono',
});
/* KANIT KONSOLU başlık/marka/plaka yüzü — serif ağırlık, enstrüman paneli
   kimliği. Yalnız konsol yüzeylerinde kullanılır; pazarlama sayfaları Inter
   ile kalır (mevcut kimlik DEĞİŞMEZ). */
const fraunces = localFont({
  src: './fonts/Fraunces-Variable.woff2',
  weight: '500 700',
  display: 'swap',
  variable: '--font-display',
  adjustFontFallback: 'Times New Roman',
});

// İlk boyamadan önce temayı uygula → flash yok. Varsayılan koyu (marka kimliği).
// Ayrıca <meta name="theme-color">'ı aktif temaya göre kur → tarayıcı/PWA sistem
// çubuğu tema ile uyumlu (iOS Safari 15+, Android Chrome). Tek kaynak: bu script.
const THEME_BG = { dark: '#060d1a', light: '#f6f8fb' };
const themeScript = `(function(){try{var t=localStorage.getItem('caros-theme');if(t!=='light'&&t!=='dark'){t='dark';}var d=document.documentElement;d.setAttribute('data-theme',t);var c=t==='light'?'${THEME_BG.light}':'${THEME_BG.dark}';var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement('meta');m.setAttribute('name','theme-color');document.head.appendChild(m);}m.setAttribute('content',c);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

/* KANIT KONSOLU teması — ilk boyamadan ÖNCE `<html data-console>` basılır.
   Effect'te uygulanırsa gündüz tercihinde bir kare siyah flaşlar (#663). */
const consoleThemeScript = CONSOLE_THEME_BOOT_SCRIPT;

export const metadata: Metadata = {
  title: 'Caros Pro — Araç İçi Yazılım Platformu',
  description: 'Filo yönetimi, araç verisi entegrasyonu ve kurumsal kontrol paneli.',
  keywords: 'araç yazılımı, filo yönetimi, OBD, navigasyon, kurumsal',
  /* MANIFEST BURADA BAĞLANMAZ.
     Manifest "Arabam Cebimde" tüketici ürününü tarif eder; kökten bağlanınca
     filo/pazarlama sayfalarında da sunuluyor ve filo kullanıcısı "Ana ekrana
     ekle" dediğinde telefonuna tüketici ürünü kuruluyordu (canlı üretimde
     doğrulandı). Artık yalnız `app/(pwa)/layout.tsx` bağlar.
     iOS `appleWebApp` başlığı da aynı sebeple oraya taşındı: bu alan da
     ürün adı yayar ve filo yüzeyinde yanlış marka gösteriyordu. */
  icons: {
    // public/'te yalnız SVG var; .png referansı 404 veriyordu (konsol hatası → BP).
    icon: '/icons/icon-192.svg',
    apple: '/icons/icon-192.svg',
  },
  // Sayfa zaten Türkçe; tarayıcı çevirisi DOM'u bozup React'i çökertiyor
  // (removeChild NotFoundError). Çeviriyi tamamen devre dışı bırak.
  other: { google: 'notranslate' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Yakınlaştırma serbest (WCAG 1.4.4) — maximum-scale/user-scalable kilidi kaldırıldı.
  viewportFit: 'cover',
  // theme-color statik değil — no-flash script aktif temaya göre <meta>'yı kurar.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="tr"
      data-theme="dark"
      translate="no"
      className={`${inter.variable} ${jetbrainsMono.variable} ${fraunces.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: consoleThemeScript }} />
      </head>
      <body className="bg-bg text-ink antialiased">
        <PWARegistration />
        <AuthRecoveryHandler />
        {children}
      </body>
    </html>
  );
}
