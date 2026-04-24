import type { Metadata, Viewport } from 'next';
import './globals.css';
import PWARegistration from '@/components/layout/PWARegistration';

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
    <html lang="tr" className="dark">
      <body className="bg-black text-white antialiased selection:bg-blue-500/30">
        <PWARegistration />
        {children}
      </body>
    </html>
  );
}
