import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import PWARegistration from '@/components/layout/PWARegistration';
import { AuthRecoveryHandler } from '@/components/auth/AuthRecoveryHandler';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-mono',
});

// İlk boyamadan önce temayı uygula → flash yok. Varsayılan koyu (marka kimliği).
// Ayrıca <meta name="theme-color">'ı aktif temaya göre kur → tarayıcı/PWA sistem
// çubuğu tema ile uyumlu (iOS Safari 15+, Android Chrome). Tek kaynak: bu script.
const THEME_BG = { dark: '#060d1a', light: '#f6f8fb' };
const themeScript = `(function(){try{var t=localStorage.getItem('caros-theme');if(t!=='light'&&t!=='dark'){t='dark';}var d=document.documentElement;d.setAttribute('data-theme',t);var c=t==='light'?'${THEME_BG.light}':'${THEME_BG.dark}';var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement('meta');m.setAttribute('name','theme-color');document.head.appendChild(m);}m.setAttribute('content',c);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export const metadata: Metadata = {
  title: 'Caros Pro — Araç İçi Yazılım Platformu',
  description: 'Filo yönetimi, araç verisi entegrasyonu ve kurumsal kontrol paneli.',
  keywords: 'araç yazılımı, filo yönetimi, OBD, navigasyon, kurumsal',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'CLP Dashboard',
  },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
  // Sayfa zaten Türkçe; tarayıcı çevirisi DOM'u bozup React'i çökertiyor
  // (removeChild NotFoundError). Çeviriyi tamamen devre dışı bırak.
  other: { google: 'notranslate' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  // theme-color statik değil — no-flash script aktif temaya göre <meta>'yı kurar.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="tr"
      data-theme="dark"
      translate="no"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-bg text-ink antialiased">
        <PWARegistration />
        <AuthRecoveryHandler />
        {children}
      </body>
    </html>
  );
}
