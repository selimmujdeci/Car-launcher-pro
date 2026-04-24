import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Admin Panel — Car Launcher Pro',
};

export default function AdminRedirect() {
  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden px-6">
      <div className="absolute inset-0 grid-bg opacity-60" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_50%,rgba(59,130,246,0.06)_0%,transparent_70%)]" />

      <div className="relative w-full max-w-md text-center">
        {/* Icon */}
        <div className="w-16 h-16 rounded-2xl bg-accent/15 border border-accent/25 flex items-center justify-center mx-auto mb-8">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect x="3" y="8" width="22" height="16" rx="3" stroke="#3b82f6" strokeWidth="1.5"/>
            <path d="M10 8V6a4 4 0 018 0v2" stroke="#3b82f6" strokeWidth="1.5"/>
            <circle cx="14" cy="16" r="2.5" stroke="#3b82f6" strokeWidth="1.5"/>
            <path d="M14 18.5v2" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-gradient mb-3">Admin Paneli</h1>
        <p className="text-white/40 text-sm mb-8 leading-relaxed max-w-xs mx-auto">
          Admin paneline erişmek için önce giriş yapmanız gerekiyor.
          Kurumsal hesabınızla devam edin.
        </p>

        <div className="flex flex-col gap-3">
          <Link
            href="/login"
            className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-3.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3H13a1 1 0 011 1v8a1 1 0 01-1 1h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M7 11l3-3-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M10 8H3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Giriş Yap
          </Link>
          <Link
            href="/"
            className="w-full glass border border-white/[0.08] hover:border-white/[0.15] text-white/60 hover:text-white font-medium py-3.5 rounded-xl transition-all text-sm flex items-center justify-center gap-2"
          >
            Ana Sayfaya Dön
          </Link>
        </div>

        <div className="mt-8 p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <p className="text-xs text-white/25">
            Hesabınız yok mu?{' '}
            <Link href="/contact" className="text-accent/60 hover:text-accent transition-colors">
              Kurumsal teklif alın
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
