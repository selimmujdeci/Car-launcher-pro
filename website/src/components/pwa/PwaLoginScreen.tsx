'use client';

/**
 * PwaLoginScreen — Arabam Cebimde giriş yüzeyi (F1).
 *
 * Tek aksiyon: Google ile giriş. Kullanıcı adı/parola, kayıt-giriş ayrımı veya
 * ikinci hesap sistemi YOKTUR. Ham OAuth hatası ekrana BASILMAZ; kullanıcıya
 * ne olduğunu ve verisinin durumunu söyleyen Türkçe cümle gösterilir.
 */

import { useCallback, useEffect, useState } from 'react';
import PwaInstallPrompt from '@/components/pwa/PwaInstallPrompt';
import {
  describeGoogleSignInFailure,
  startGoogleSignIn,
  type GoogleSignInFailureCode,
} from '@/lib/pwaAuth';

export default function PwaLoginScreen({
  /** Cihazda eski anonim oturum var mı — araçların taşınacağını söyleriz. */
  hasPendingAnonymousData = false,
}: {
  hasPendingAnonymousData?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] =
    useState<GoogleSignInFailureCode | null>(null);

  /* OAuth dönüşü başarısızsa callback bizi `?auth_error=...` ile buraya
     getirir. Sunucunun ham gerekçesi kullanıcıya BASILMAZ; tek tip dürüst
     cümleye indirgenir. */
  useEffect(() => {
    try {
      const reason = new URLSearchParams(window.location.search).get('auth_error');
      if (reason) setErrorCode('SIGN_IN_FAILED');
    } catch { /* URL okunamadı — sessiz geç */ }
  }, []);

  const handleGoogle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErrorCode(null);
    const result = await startGoogleSignIn(window.location.origin);
    if (!result.ok) {
      setErrorCode(result.code);
      setBusy(false);
      return;
    }
    /* Başarıdaysa tarayıcı Google'a yönlendirilir; `busy` bilerek AÇIK kalır
       (yönlendirme sırasında düğme tekrar tıklanabilir görünmemeli). */
  }, [busy]);

  return (
    <div
      data-pwa-theme="dark"
      data-testid="pwa-login-screen"
      className="h-[100dvh] flex flex-col items-center justify-center px-6"
      style={{ background: 'var(--pwa-bg, #060d1a)', color: 'var(--pwa-text, #e8eefc)' }}
    >
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-64 rounded-full bg-blue-500/[0.07] blur-[90px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm flex flex-col items-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
          style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)' }}
        >
          <svg width="30" height="30" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M2 11L4.5 6Q5.5 4 7 4H11Q12.5 4 13.5 6L16 11V13.5Q16 15 14.5 15H3.5Q2 15 2 13.5Z"
              stroke="#3b82f6" strokeWidth="1.5" strokeLinejoin="round" />
            <circle cx="5.5" cy="15" r="1.8" stroke="#3b82f6" strokeWidth="1.5" />
            <circle cx="12.5" cy="15" r="1.8" stroke="#3b82f6" strokeWidth="1.5" />
            <rect x="6.5" y="7.5" width="5" height="3.5" rx="1.2" stroke="#3b82f6" strokeWidth="1.2" />
          </svg>
        </div>

        <h1 className="text-xl font-bold">Arabam Cebimde</h1>
        <p className="mt-2 text-center text-[13px] opacity-60">
          Aracınızı avucunuzun içinden yönetin.
        </p>

        <button
          type="button"
          onClick={() => { void handleGoogle(); }}
          disabled={busy}
          className="mt-8 w-full flex items-center justify-center gap-3 rounded-2xl py-3.5 font-semibold text-[15px] transition-colors disabled:opacity-60"
          style={{ background: '#ffffff', color: '#1f2937' }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.91c1.71-1.57 2.69-3.89 2.69-6.62z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 009 18z" />
            <path fill="#FBBC05" d="M3.96 10.71a5.41 5.41 0 010-3.42V4.96H.96a9 9 0 000 8.08l3-2.33z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 00.96 4.96l3 2.33C4.67 5.16 6.65 3.58 9 3.58z" />
          </svg>
          {busy ? 'Yönlendiriliyor…' : 'Google ile Giriş Yap'}
        </button>

        {hasPendingAnonymousData && (
          <p className="mt-3 text-center text-[12px] opacity-55">
            Bu cihazdaki araçlarınız Google hesabınıza taşınacak.
          </p>
        )}

        {errorCode && (
          <p
            role="alert"
            className="mt-4 text-center text-[12px] text-red-300/90 leading-relaxed"
          >
            {describeGoogleSignInFailure(errorCode)}
          </p>
        )}

        {/* Kurulum teklifi tüketici yüzeyine aittir; tarayıcı teklif etmiyorsa
            (zaten kurulu / desteklenmiyor) hiçbir şey göstermez. */}
        <div className="mt-8 w-full">
          <PwaInstallPrompt />
        </div>

        <p className="mt-10 text-center text-[11px] opacity-35 leading-relaxed">
          Giriş yaptıktan sonra bir daha sorulmaz. Araçlarınız hesabınıza bağlı
          kalır; telefon değiştirseniz de aynı hesapla geri gelir.
        </p>
      </div>
    </div>
  );
}
