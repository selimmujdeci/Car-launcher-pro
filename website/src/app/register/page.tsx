'use client';

import { useState, FormEvent, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabaseBrowser';

function RegisterForm() {
  const router = useRouter();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [fullName, setFullName] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [done,     setDone]     = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!fullName.trim()) { setError('Ad Soyad giriniz.'); return; }
    if (!email)           { setError('E-posta giriniz.'); return; }
    if (password.length < 8) { setError('Şifre en az 8 karakter olmalı.'); return; }
    if (password !== confirm) { setError('Şifreler eşleşmiyor.'); return; }

    setLoading(true);
    try {
      if (!isSupabaseConfigured) {
        setError('Kimlik doğrulama servisi yapılandırılmamış.');
        return;
      }
      const supabase = getSupabaseBrowserClient();
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: `${siteUrl}/auth/callback`,
        },
      });
      if (authError) {
        setError(authError.message === 'User already registered'
          ? 'Bu e-posta zaten kayıtlı. Giriş yapmayı deneyin.'
          : 'Kayıt sırasında hata oluştu.');
        return;
      }
      setDone(true);
    } catch {
      setError('Kayıt sırasında bir hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
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
              Caros <span className="text-accent">Pro</span>
            </span>
          </Link>
          <p className="text-white/35 text-sm mt-4">Yeni hesap oluştur</p>
        </div>

        {/* Done state */}
        {done ? (
          <div className="p-8 rounded-2xl bg-white/[0.03] border border-white/[0.09] shadow-[0_0_60px_rgba(0,0,0,0.5)] text-center flex flex-col items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <path d="M5 14l6 6L23 8" stroke="#34d399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <p className="text-white font-semibold">Hesabınız oluşturuldu!</p>
              <p className="text-white/40 text-sm mt-1">
                Doğrulama e-postası gönderildi.<br />
                E-postanızı kontrol edin.
              </p>
            </div>
            <button
              onClick={() => router.push('/login')}
              className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              Giriş Yap
            </button>
          </div>
        ) : (
          <div className="p-8 rounded-2xl bg-white/[0.03] border border-white/[0.09] shadow-[0_0_60px_rgba(0,0,0,0.5)]">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              <div>
                <label className="block text-xs text-white/40 mb-2 font-medium tracking-wide">Ad Soyad</label>
                <input
                  type="text"
                  autoComplete="name"
                  placeholder="Adınız Soyadınız"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/[0.1] rounded-xl px-4 py-3.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-accent/50 focus:bg-white/[0.07] transition-all"
                />
              </div>

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

              <div>
                <label className="block text-xs text-white/40 mb-2 font-medium tracking-wide">Şifre</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="En az 8 karakter"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/[0.1] rounded-xl px-4 py-3.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50 focus:bg-white/[0.07] transition-all"
                />
              </div>

              <div>
                <label className="block text-xs text-white/40 mb-2 font-medium tracking-wide">Şifre Tekrar</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Şifrenizi tekrar girin"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
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
                    Hesap oluşturuluyor…
                  </>
                ) : (
                  'Kayıt Ol'
                )}
              </button>
            </form>

            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-white/[0.06]" />
              <span className="text-white/20 text-xs">veya</span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>

            <button
              type="button"
              onClick={handleGoogle}
              disabled={!isSupabaseConfigured}
              className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.05] disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm text-white/50 hover:text-white/70"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M14.5 8.16c0-.49-.04-.96-.12-1.41H8v2.67h3.65a3.12 3.12 0 01-1.35 2.05v1.7h2.18c1.28-1.18 2.02-2.91 2.02-5.01z" fill="#4285F4"/>
                <path d="M8 15c1.83 0 3.36-.61 4.48-1.64l-2.18-1.7c-.61.41-1.38.65-2.3.65-1.77 0-3.27-1.2-3.8-2.8H1.96v1.75A7 7 0 008 15z" fill="#34A853"/>
                <path d="M4.2 9.51A4.2 4.2 0 014 8c0-.52.09-1.03.2-1.51V4.74H1.96A7 7 0 001 8c0 1.13.27 2.2.96 3.26l2.24-1.75z" fill="#FBBC05"/>
                <path d="M8 3.2c1 0 1.89.34 2.6 1.01l1.94-1.94A7 7 0 001.96 4.74L4.2 6.49C4.73 4.9 6.23 3.2 8 3.2z" fill="#EA4335"/>
              </svg>
              Google ile Kayıt Ol
            </button>

            {!isSupabaseConfigured && (
              <div className="mt-4 p-3 rounded-xl border border-red-500/20 bg-red-500/[0.06] text-center">
                <p className="text-[11px] text-red-300/80">
                  Supabase ortam değişkenleri eksik. Kayıt devre dışı.
                </p>
              </div>
            )}
          </div>
        )}

        <p className="text-center text-white/20 text-xs mt-8">
          Zaten hesabınız var mı?{' '}
          <Link href="/login" className="text-accent/60 hover:text-accent transition-colors">
            Giriş Yap
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function Register() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
