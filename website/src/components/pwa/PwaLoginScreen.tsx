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

/** Rol rengini saydamlaştırır — hex'e alfa eklemek `var(--md-*)` ile çalışmaz. */
function mix(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

export default function PwaLoginScreen({
  /** Cihazda eski anonim oturum var mı — araçların taşınacağını söyleriz. */
  hasPendingAnonymousData = false,
}: {
  hasPendingAnonymousData?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  /* Kullanıcının seçtiği tema girişte de korunur (varsayılan gece). Yalnız
     görünüm tercihi — oturum/giriş akışına etkisi yok. */
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('pwa-theme');
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch { /* depolama yok — gece kalır */ }
  }, []);
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
      data-pwa-theme={theme}
      data-testid="pwa-login-screen"
      className="h-[100dvh] flex flex-col items-center justify-center px-6"
      style={{ background: 'var(--md-surface)', color: 'var(--md-on-surface)' }}
    >
      <div className="relative z-10 w-full max-w-sm flex flex-col items-center">
        {/* Ürün logosu (yalnız tüketici yüzeyi — layout ikonuyla aynı dosya) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/arabam-cebimde-192.png" alt="" width={96} height={96}
          className="mb-6" style={{ borderRadius: 'var(--md-shape-full)' }} />

        <h1 className="md-headline-m md-on-surface">Arabam Cebimde</h1>
        <p className="mt-2 text-center md-body-l md-on-surface-variant">
          Aracınızı avucunuzun içinden yönetin.
        </p>

        <button
          type="button"
          onClick={() => { void handleGoogle(); }}
          disabled={busy}
          /* Google marka kılavuzu renkleri (açık: beyaz/#747775 kenar ·
             koyu: #131314/#8E918F kenar) — yalnız bu düğmede. */
          className="md-state mt-10 w-full flex items-center justify-center gap-3 md-label-l disabled:opacity-60"
          style={{
            minHeight: 52, borderRadius: 'var(--md-shape-full)', fontSize: 16,
            background: theme === 'dark' ? '#131314' : '#ffffff',
            color: theme === 'dark' ? '#e3e3e3' : '#1f1f1f',
            border: `1px solid ${theme === 'dark' ? '#8e918f' : '#747775'}`,
          }}
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
          <p className="mt-3 text-center md-body-s md-on-surface-variant">
            Bu cihazdaki araçlarınız Google hesabınıza taşınacak.
          </p>
        )}

        {errorCode && (
          <p
            role="alert"
            className="mt-4 text-center md-body-s" style={{ color: 'var(--md-error)' }}
          >
            {describeGoogleSignInFailure(errorCode)}
          </p>
        )}

        {/* Kurulum teklifi tüketici yüzeyine aittir; tarayıcı teklif etmiyorsa
            (zaten kurulu / desteklenmiyor) hiçbir şey göstermez. */}
        <div className="mt-8 w-full">
          <PwaInstallPrompt />
        </div>

        <p className="mt-10 text-center md-body-s md-on-surface-variant">
          Giriş yaptıktan sonra bir daha sorulmaz. Araçlarınız hesabınıza bağlı
          kalır; telefon değiştirseniz de aynı hesapla geri gelir.
        </p>
      </div>
    </div>
  );
}
