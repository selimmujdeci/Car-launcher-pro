import type { Metadata, Viewport } from 'next';
import './globals.css';
import PWARegistration from '@/components/layout/PWARegistration';
import { AuthRecoveryHandler } from '@/components/auth/AuthRecoveryHandler';

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
  themeColor: '#000000',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className="dark" translate="no">
      <body className="bg-black text-white antialiased selection:bg-blue-500/30">
        <PWARegistration />
        <AuthRecoveryHandler />
        {children}
      </body>
    </html>
  );
}
