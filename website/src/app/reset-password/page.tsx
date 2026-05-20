'use client';

import { useState, useEffect, FormEvent, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabaseBrowser';

function ResetPasswordForm() {
  const router = useRouter();
  const [password,      setPassword]      = useState('');
  const [confirm,       setConfirm]       = useState('');
  const [error,         setError]         = useState('');
  const [loading,       setLoading]       = useState(false);
  const [done,          setDone]          = useState(false);
  const [sessionReady,  setSessionReady]  = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);

  // Sayfa yüklenince URL hash'teki recovery token'ı session'a set et
  useEffect(() => {
    if (!isSupabaseConfigured) { setSessionChecked(true); return; }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setSessionChecked(true); return; }

    // URL hash'ten access_token + refresh_token oku
    const hash   = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    const params = new URLSearchParams(hash);
    const accessToken  = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const type         = params.get('type');

    if (type === 'recovery' && accessToken && refreshToken) {
      supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error: e }) => {
          if (!e) setSessionReady(true);
          else setError('Bağlantı geçersiz veya süresi dolmuş. Yeni sıfırlama linki isteyin.');
          setSessionChecked(true);
        });
    } else {
      // Hash yoksa mevcut session'ı kontrol et (onAuthStateChange fallback)
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') {
          setSessionReady(true);
          setSessionChecked(true);
          subscription.unsubscribe();
        }
      });
      // 3 saniye içinde event gelmezse expired say
      const t = setTimeout(() => {
        setSessionChecked(true);
        subscription.unsubscribe();
      }, 3000);
      return () => { clearTimeout(t); subscription.unsubscribe(); };
    }
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Şifre en az 8 karakter olmalı.'); return; }
    if (password !== confirm)  { setError('Şifreler eşleşmiyor.'); return; }

    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) { setError('Kimlik doğrulama servisi başlatılamadı.'); return; }
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) {
        setError('Şifre güncellenemedi: ' + authError.message);
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
          <p className="text-white/35 text-sm mt-4">Yeni şifre belirle</p>
        </div>

        {/* Session kontrol ediliyor */}
        {!sessionChecked && (
          <div className="p-8 rounded-2xl bg-white/[0.03] border border-white/[0.09] text-center text-white/40 text-sm">
            Bağlantı doğrulanıyor…
          </div>
        )}

        {/* Session yok / expired */}
        {sessionChecked && !sessionReady && !done && (
          <div className="p-8 rounded-2xl bg-white/[0.03] border border-red-500/20 text-center flex flex-col gap-3">
            <p className="text-red-400 text-sm">Bağlantı geçersiz veya süresi dolmuş.</p>
            <p className="text-white/40 text-xs">Şifre sıfırlama ekranından yeni link isteyin.</p>
            <button
              onClick={() => router.push('/login')}
              className="w-full bg-white/[0.06] hover:bg-white/[0.1] text-white/60 font-medium py-3 rounded-xl transition-colors text-sm"
            >
              Giriş Ekranına Dön
            </button>
          </div>
        )}

        {done ? (
          <div className="p-8 rounded-2xl bg-white/[0.03] border border-white/[0.09] shadow-[0_0_60px_rgba(0,0,0,0.5)] text-center flex flex-col items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <path d="M4 14l6 7L24 7" stroke="#34d399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <p className="text-white font-semibold">Şifreniz güncellendi!</p>
              <p className="text-white/40 text-sm mt-1">Yeni şifrenizle giriş yapabilirsiniz.</p>
            </div>
            <button
              onClick={() => router.push('/login')}
              className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              Giriş Yap
            </button>
          </div>
        ) : sessionChecked && sessionReady ? (
          <div className="p-8 rounded-2xl bg-white/[0.03] border border-white/[0.09] shadow-[0_0_60px_rgba(0,0,0,0.5)]">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              <div>
                <label className="block text-xs text-white/40 mb-2 font-medium tracking-wide">Yeni Şifre</label>
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
                    Güncelleniyor…
                  </>
                ) : (
                  'Şifremi Güncelle'
                )}
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function ResetPassword() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
