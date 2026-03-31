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
    <div className="fixed inset-0 z-[200] flex flex-col bg-[#080d1a] animate-fade-in">
      {/* Üst bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#0d1628] border-b border-white/10 flex-shrink-0">
        <button
          onClick={closeInApp}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 active:scale-90 transition-all"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* URL bar */}
        <div className="flex-1 flex items-center gap-2 bg-black/40 rounded-xl px-4 py-2 border border-white/5 min-w-0">
          {loading && (
            <div className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin flex-shrink-0" />
          )}
          <span className="text-slate-300 text-sm font-medium truncate">{displayUrl}</span>
        </div>

        <button
          onClick={handleReload}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 active:scale-90 transition-all"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        <button
          onClick={handleOpenExternal}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 active:scale-90 transition-all"
          title="Tarayıcıda aç"
        >
          <ExternalLink className="w-4 h-4" />
        </button>

        <button
          onClick={closeInApp}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 active:scale-90 transition-all"
        >
          <Home className="w-5 h-5" />
        </button>

        <button
          onClick={closeInApp}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 active:scale-90 transition-all"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* iframe */}
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#080d1a] z-10">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin" />
              <span className="text-slate-400 text-sm font-medium">{displayUrl} yükleniyor…</span>
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={url}
          className="w-full h-full border-none"
          onLoad={() => setLoading(false)}
          allow="geolocation; microphone; camera"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        />
      </div>
    </div>
  );
}
