'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PWAInstallButton() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => setInstalled(true));
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setPrompt(null);
  };

  if (installed) {
    return (
      <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-emerald-400 border border-emerald-500/20 bg-emerald-500/[0.07]">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2.5 7l3 3 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Uygulama yüklendi
      </span>
    );
  }

  // Prompt var mı yok mu her iki durumda da göster — prompt yoksa /kumanda'ya yönlendir
  return (
    <button
      onClick={prompt ? install : () => window.location.href = '/kumanda'}
      className="group inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-ink bg-accent/10 border border-accent/30 shadow-glow-sm hover:bg-accent/[0.16] hover:border-accent/40 transition-all active:scale-95"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-accent-ink">
        <path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2 11v1.5A1.5 1.5 0 003.5 14h9a1.5 1.5 0 001.5-1.5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      <span>Arabam Cebimde</span>
      <span className="text-ink-3 text-xs font-normal">— Ücretsiz İndir</span>
    </button>
  );
}
