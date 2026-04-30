import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n/config'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { applyCompatMode } from './platform/headUnitCompat.ts'
import { initNativeCore } from './platform/nativeCoreService.ts'
import { initPlatformDetection } from './platform/headUnitPlatform.ts'
import { isNative } from './platform/bridge.ts'
import { initGeofence } from './platform/geofenceService.ts'
import { initSafeStorageAsync } from './utils/safeStorage.ts'
import { signalReverse } from './platform/cameraService.ts'
import { CarLauncher } from './platform/nativePlugin.ts'

/* ── Bootstrap Launcher ── */
(async () => {
try {
  /* ── Head unit / eski WebView uyumluluk modu — React öncesi çağrılmalı ── */
  applyCompatMode();

  /* ── Safe Storage: Filesystem cache'ini React öncesi yükle (native) ── */
  /* Zustand store'ları ilk render'da safeGetRaw çağırır; _fsCache hazır olmalı. */
  if (isNative) await initSafeStorageAsync().catch((e) => console.error('[SafeStorage]', e));

  /* ── R-7 Boot-Split: React yüklenmeden geri vites tespiti ── */
  /* CAN ve OBD verisi dinlenir; reverse sinyali gelirse kamera anında açılır.        */
  /* window.__INITIAL_REVERSE__ = true → ReversePriorityOverlay ilk render'da aktif. */
  if (isNative) {
    // CAN bus — reverse boolean'ı doğrudan taşır (birincil kaynak)
    void CarLauncher.addListener('canData', (data) => {
      if (typeof data.reverse === 'boolean') {
        if (data.reverse) window.__INITIAL_REVERSE__ = true;
        signalReverse(data.reverse);
      }
    }).catch(() => {});

    // OBD — doğrudan reverse field'ı yok; ileride hız-çapraz-kontrol için açık
    // Sinyal cameraService içinde canData'ya dayanır; bu listener cross-check yeridir
    void CarLauncher.addListener('obdData', () => {
      // Placeholder: OBD'de reverse PID yok (SAE J1979); canData asıl kaynak
    }).catch(() => {});
  }

  /* ── Geofence: Sanal çit + vale modu ayarlarını yükle ── */
  initGeofence().catch((e) => console.error('[GeofenceInit]', e));

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
})();
