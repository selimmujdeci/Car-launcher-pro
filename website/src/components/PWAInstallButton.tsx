import Link from 'next/link';

/**
 * Site genelindeki "Arabam Cebimde'yi Yükle" giriş noktası.
 *
 * ── NEDEN BURADA KURULUM PROMPT'U AÇILMIYOR ──────────────────────────────
 * Eskiden bu düğme `beforeinstallprompt` olayını yakalayıp kurulumu pazarlama
 * sayfasında başlatıyordu. Bu, kurulumun KÖKTEN bağlanan manifest'e bağlı
 * olmasını gerektiriyordu ve o manifest filo sayfalarında da yayınlandığı
 * için filo kullanıcısı telefonuna tüketici ürününü kurabiliyordu.
 *
 * Manifest artık yalnız tüketici yüzeyine (`app/(pwa)`) bağlı. Tarayıcı
 * kurulum akışı sayfaya bağlı manifest'e göre çalıştığından, kurulum da
 * orada teklif edilir (`components/pwa/PwaInstallPrompt.tsx`). Bu düğme
 * kullanıcıyı oraya götürür: tek kanonik yol, tarayıcı farklarından bağımsız
 * ve kurulan uygulama HER ZAMAN doğru kimlik/scope ile kurulur.
 */
export default function PWAInstallButton() {
  return (
    <Link
      href="/kumanda"
      className="group inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-ink bg-accent/10 border border-accent/30 shadow-glow-sm hover:bg-accent/[0.16] hover:border-accent/40 transition-all active:scale-95"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-accent-ink">
        <path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2 11v1.5A1.5 1.5 0 003.5 14h9a1.5 1.5 0 001.5-1.5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      <span>Arabam Cebimde</span>
      <span className="text-ink-3 text-xs font-normal">— Ücretsiz İndir</span>
    </Link>
  );
}
