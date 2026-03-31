import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { applyCompatMode } from './platform/headUnitCompat.ts'
import { initNativeCore } from './platform/nativeCoreService.ts'

/* ── Bootstrap Launcher ── */
try {
  /* ── Head unit / eski WebView uyumluluk modu — React öncesi çağrılmalı ── */
  applyCompatMode();

  /* ── Native Core: cihaz profili + ekran ölçüleri + performans modu ── */
  initNativeCore(); // fire-and-forget — non-blocking

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
} catch (err) {
  console.error("FATAL INITIALIZATION ERROR:", err);
  // Hata durumunda #root'a acil durum mesajı bas
  var rootEl = document.getElementById('root');
  if (rootEl) {
    rootEl.innerHTML = '<div style="padding:40px;color:white;font-family:sans-serif;text-align:center"><h1>Kritik Hata</h1><p>Uygulama başlatılamadı.</p><code style="font-size:10px;color:#ff6b6b">' + (err instanceof Error ? err.message : String(err)) + '</code></div>';
  }
}
