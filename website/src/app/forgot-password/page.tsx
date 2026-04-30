'use client';

import { useState, FormEvent, Suspense } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabaseBrowser';

function ForgotPasswordForm() {
  const [email,   setEmail]   = useState('');
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email) { setError('E-posta adresinizi girin.'); return; }

    setLoading(true);
    try {
      if (!isSupabaseConfigured) {
        setError('Kimlik doğrulama servisi yapılandırılmamış.');
        return;
      }
      const supabase = getSupabaseBrowserClient();
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl}/auth/callback`,
      });
      if (authError) {
        setError('Şifre sıfırlama e-postası gönderilemedi.');
        return;
      }
      setDone(true);
    } catch {
      setError('Bir hata oluştu. Lütfen tekrar deneyin.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden px-6">
      <div className="absolute inset-0 grid-bg" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_50%,rgba(59,130,246,0.07)_0%,transparent_70%)]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-accent/[0.04] blur-[100px] pointer-events-none" />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-10">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-accent/20 border border-accent/30 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 2C6.686 2 4 4.686 4 8c0 4.5 6 10 6 10s6-5.5 6-10c0-3.314-2.686-6-6-6z" stroke="#3b82f6" strokeWidth="1.5"/>
                <circle cx="10" cy="8" r="2" stroke="#3b82f6" strokeWidth="1.5"/>
              </svg>
            </div>
            <span className="font-semibold text-base">
              Caros <span className="text-accent">Pro</span>
            </span>
          </Link>
          <p className="text-white/35 text-sm mt-4">Şifre sıfırlama</p>
        </div>

        {done ? (
          <div className="p-8 rounded-2xl bg-white/[0.03] border border-white/[0.09] shadow-[0_0_60px_rgba(0,0,0,0.5)] text-center flex flex-col items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <path d="M4 14l6 7L24 7" stroke="#34d399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <p className="text-white font-semibold">E-posta gönderildi!</p>
              <p className="text-white/40 text-sm mt-1">
                Gelen kutunuzu kontrol edin.<br />
                Link 1 saat geçerlidir.
              </p>
            </div>
            <Link
              href="/login"
              className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-3 rounded-xl transition-colors text-sm text-center"
            >
              Giriş Sayfasına Dön
            </Link>
          </div>
        ) : (
          <div className="p-8 rounded-2xl bg-white/[0.03] border border-white/[0.09] shadow-[0_0_60px_rgba(0,0,0,0.5)]">
            <p className="text-white/40 text-sm mb-6">
              Kayıtlı e-posta adresinizi girin, şifre sıfırlama bağlantısı gönderelim.
            </p>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              <div>
                <label className="block text-xs text-white/40 mb-2 font-medium tracking-wide">E-posta</label>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="ornek@sirket.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/[0.1] rounded-xl px-4 py-3.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-accent/50 focus:bg-white/[0.07] transition-all"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/[0.08] border border-red-500/20 rounded-xl px-3 py-2.5">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
                    <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
                    <path d="M7 4.5v3M7 9.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-accent hover:bg-accent/90 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-colors text-sm mt-1 shadow-[0_0_20px_rgba(59,130,246,0.15)] flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin" width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="28" strokeDashoffset="8" opacity="0.4"/>
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="8" strokeDashoffset="0"/>
                    </svg>
                    Gönderiliyor…
                  </>
                ) : (
                  'Sıfırlama Bağlantısı Gönder'
                )}
              </button>
            </form>
          </div>
        )}

        <p className="text-center text-white/20 text-xs mt-8">
          <Link href="/login" className="text-accent/60 hover:text-accent transition-colors">
            ← Giriş sayfasına dön
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function ForgotPassword() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  );
}
