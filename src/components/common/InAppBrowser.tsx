import { useState, useEffect, useRef } from 'react';
import { X, RefreshCw, ExternalLink, ArrowLeft, Home } from 'lucide-react';
import { subscribeInApp, closeInApp } from '../../platform/inAppBrowser';

export function InAppBrowser() {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => subscribeInApp(setUrl), []);

  // Her yeni URL açıldığında loading sıfırla
  useEffect(() => {
    if (url) setLoading(true);
  }, [url]);

  if (!url) return null;

  const displayUrl = (() => {
    try { return new URL(url).hostname; } catch { return url; }
  })();

  const handleReload = () => {
    if (iframeRef.current) {
      setLoading(true);
      iframeRef.current.src = url;
    }
  };

  const handleOpenExternal = () => {
    window.open(url, '_blank');
  };

  return (
    <div className="fixed inset-0 z-[200] flex flex-col glass-card border-none !shadow-none bg-[var(--oem-surface-0)] backdrop-blur-3xl animate-fade-in">
      {/* Üst bar */}
      <div className="flex items-center gap-4 px-6 py-4 bg-[var(--oem-surface-0)] border-b border-[var(--oem-line)] flex-shrink-0">
        <button
          onClick={closeInApp}
          className="w-11 h-11 flex items-center justify-center rounded-2xl bg-[var(--oem-surface-2)] border border-[var(--oem-line)] text-[color:var(--oem-ink)] hover:bg-[var(--oem-surface-3)] active:scale-90 transition-all shadow-md"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>

        {/* URL bar */}
        <div className="flex-1 flex items-center gap-3 bg-[var(--oem-surface-2)] backdrop-blur-md rounded-2xl px-5 py-2.5 border border-[var(--oem-line)] min-w-0 shadow-inner">
          {loading && (
            <div className="w-4 h-4 rounded-full border-2 border-[var(--oem-info)] border-t-transparent animate-spin flex-shrink-0" />
          )}
          <span className="text-[color:var(--oem-ink)] text-base font-black truncate uppercase tracking-widest opacity-60">{displayUrl}</span>
        </div>

        <button
          onClick={handleReload}
          className="w-11 h-11 flex items-center justify-center rounded-2xl bg-[var(--oem-surface-2)] border border-[var(--oem-line)] text-[color:var(--oem-ink)] hover:bg-[var(--oem-surface-3)] active:scale-90 transition-all shadow-md"
        >
          <RefreshCw className="w-5 h-5" />
        </button>

        <button
          onClick={handleOpenExternal}
          className="w-11 h-11 flex items-center justify-center rounded-2xl bg-[var(--oem-surface-2)] border border-[var(--oem-line)] text-[color:var(--oem-ink)] hover:bg-[var(--oem-surface-3)] active:scale-90 transition-all shadow-md"
          title="Tarayıcıda aç"
        >
          <ExternalLink className="w-5 h-5" />
        </button>

        <button
          onClick={closeInApp}
          className="w-11 h-11 flex items-center justify-center rounded-2xl bg-[var(--oem-surface-2)] border border-[var(--oem-line)] text-[color:var(--oem-ink)] hover:bg-[var(--oem-surface-3)] active:scale-90 transition-all shadow-md"
        >
          <Home className="w-6 h-6" />
        </button>

        <button
          onClick={closeInApp}
          className="w-11 h-11 flex items-center justify-center rounded-2xl bg-[var(--oem-danger-soft)] border border-[var(--oem-danger)] text-[color:var(--oem-danger)] hover:opacity-80 active:scale-90 transition-all shadow-md"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* iframe */}
      <div className="flex-1 relative bg-[var(--oem-surface-0)]">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--oem-surface-0)] backdrop-blur-xl z-10">
            <div className="flex flex-col items-center gap-6">
              <div className="w-16 h-16 rounded-[1.5rem] bg-[var(--oem-info-soft)] flex items-center justify-center border border-[var(--oem-info)] animate-pulse">
                <RefreshCw className="w-8 h-8 text-[color:var(--oem-info)] animate-spin" />
              </div>
              <span className="text-[color:var(--oem-ink)] text-sm font-black uppercase tracking-[0.2em] opacity-40">{displayUrl} Yükleniyor</span>
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={url}
          className="w-full h-full border-none"
          onLoad={() => setLoading(false)}
          allow="geolocation 'src'"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  );
}


