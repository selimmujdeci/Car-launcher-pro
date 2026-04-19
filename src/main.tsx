import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { applyCompatMode } from './platform/headUnitCompat.ts'
import { initNativeCore } from './platform/nativeCoreService.ts'
import { initPlatformDetection } from './platform/headUnitPlatform.ts'
import { isNative } from './platform/bridge.ts'

/* ── Bootstrap Launcher ── */
try {
  /* ── Head unit / eski WebView uyumluluk modu — React öncesi çağrılmalı ── */
  applyCompatMode();

  /* ── Native Core: cihaz profili + ekran ölçüleri + performans modu ── */
  initNativeCore().catch((e) => console.error('[NativeCore]', e));

  /* ── Head unit platform tespiti: FYT/SYU, Microntek, KSW, RoadRover, Hiworld ── */
  if (isNative) initPlatformDetection().catch((e) => console.error('[PlatformDetect]', e));

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
  const rootEl = document.getElementById('root');
  if (rootEl) {
    const div  = document.createElement('div');
    div.style.cssText = 'padding:40px;color:white;font-family:sans-serif;text-align:center';
    const h1   = document.createElement('h1');  h1.textContent  = 'Kritik Hata';
    const p    = document.createElement('p');   p.textContent   = 'Uygulama başlatılamadı.';
    const code = document.createElement('code');
    code.style.cssText = 'font-size:10px;color:#ff6b6b';
    code.textContent   = err instanceof Error ? err.message : String(err);
    div.append(h1, p, code);
    rootEl.replaceChildren(div);
  }
}


