'use client';

import { useState, FormEvent, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabaseBrowser';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') ?? '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('E-posta ve şifre giriniz.');
      return;
    }

    setLoading(true);

    try {
      if (!isSupabaseConfigured) {
        setError('Kimlik doğrulama servisi yapılandırılmamış.');
        return;
      }
      const supabase = getSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError('E-posta veya şifre hatalı.');
        return;
      }

      router.push(redirect);
    } catch {
      setError('Giriş sırasında bir hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  const handleSSOLogin = async () => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabaseBrowserClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${siteUrl}/auth/callback` },
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden px-6">
      <div className="absolute inset-0 grid-bg" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_50%,rgba(59,130,246,0.07)_0%,transparent_70%)]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-accent/[0.04] blur-[100px] pointer-events-none" />

      <div className="relative w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-10">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-accent/20 border border-accent/30 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 2C6.686 2 4 4.686 4 8c0 4.5 6 10 6 10s6-5.5 6-10c0-3.314-2.686-6-6-6z" stroke="#3b82f6" strokeWidth="1.5"/>
                <circle cx="10" cy="8" r="2" stroke="#3b82f6" strokeWidth="1.5"/>
              </svg>
            </div>
            <span className="font-semibold text-base">
              Car Launcher <span className="text-accent">Pro</span>
            </span>
          </Link>
          <p className="text-white/35 text-sm mt-4">Kurumsal kontrol paneli girişi</p>
        </div>

        {/* Card */}
        <div className="p-8 rounded-2xl bg-white/[0.03] border border-white/[0.09] shadow-[0_0_60px_rgba(0,0,0,0.5)]">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
            <div>
              <label className="block text-xs text-white/40 mb-2 font-medium tracking-wide">
                E-posta
              </label>
              <input
                type="email"
                autoComplete="email"
                placeholder="ornek@sirket.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/[0.05] border border-white/[0.1] rounded-xl px-4 py-3.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-accent/50 focus:bg-white/[0.07] transition-all"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-white/40 font-medium tracking-wide">Şifre</label>
                <Link href="#" className="text-xs text-accent/70 hover:text-accent transition-colors">
                  Şifremi unuttum
                </Link>
              </div>
              <input
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/[0.05] border border-white/[0.1] rounded-xl px-4 py-3.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50 focus:bg-white/[0.07] transition-all"
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
                  Giriş yapılıyor…
                </>
              ) : (
                'Giriş Yap'
              )}
            </button>
          </form>

          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-white/[0.06]" />
            <span className="text-white/20 text-xs">veya</span>
            <div className="flex-1 h-px bg-white/[0.06]" />
          </div>

          <button
            type="button"
            onClick={handleSSOLogin}
            disabled={!isSupabaseConfigured}
            className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.05] disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm text-white/50 hover:text-white/70"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="4" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M5 4V3a3 3 0 016 0v1" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
            Kurumsal SSO ile Giriş
          </button>
        </div>

        <p className="text-center text-white/20 text-xs mt-8">
          Hesabınız yok mu?{' '}
          <Link href="/register" className="text-accent/60 hover:text-accent transition-colors">
            Kayıt Ol
          </Link>
        </p>

        {!isSupabaseConfigured && (
          <div className="mt-4 p-3 rounded-xl border border-red-500/20 bg-red-500/[0.06] text-center">
            <p className="text-[11px] text-red-300/80">
              Supabase ortam değişkenleri eksik. Giriş devre dışı.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
