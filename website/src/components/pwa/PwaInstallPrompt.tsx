'use client';

/**
 * Arabam Cebimde kurulum teklifi — TÜKETİCİ YÜZEYİNİN KENDİ AKIŞI.
 *
 * Tarayıcı `beforeinstallprompt`i yalnız manifest'i BAĞLI olan sayfada
 * yayınlar. Manifest artık yalnız `app/(pwa)` altında bağlandığı için kurulum
 * da burada teklif edilir; kurulan uygulama böylece her zaman doğru kimlik
 * (`id: /kumanda`) ve scope ile kurulur, filo yüzeyi hiçbir zaman kurulabilir
 * hâle gelmez.
 *
 * Olay gelmezse (zaten kurulu, desteklemeyen tarayıcı, iOS) HİÇBİR ŞEY
 * göstermez — sahte bir "yükle" düğmesi üretmez.
 */

import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PwaInstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    /* Olay tek kullanımlıktır; sonucu ne olursa olsun tekrar kullanılamaz. */
    setPrompt(null);
  }, [prompt]);

  if (!prompt) return null;

  return (
    <button
      type="button"
      onClick={() => { void install(); }}
      data-testid="pwa-install-prompt"
      className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold transition-colors"
      style={{
        background: 'rgba(59,130,246,0.12)',
        border: '1px solid rgba(59,130,246,0.28)',
        color: '#93c5fd',
      }}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 11v1.5A1.5 1.5 0 003.5 14h9a1.5 1.5 0 001.5-1.5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      Arabam Cebimde&apos;yi telefonuna yükle
    </button>
  );
}
