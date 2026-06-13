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
import { captureSpotifyRedirect } from './platform/spotify/spotifyAuth.ts'
import { installConsoleGate } from './platform/system/logGate.ts'

/* ── Bootstrap Launcher ── */
(async () => {
try {
  /* ── Log gate: düşük runtime modunda (head unit) debug log'larını sustur.
   * Capable cihaz/tarayıcı (BALANCED/PERF) tam log korur. En başta kurulur ki
   * boot logları da gate'lensin; console.error her zaman geçer (silent hariç). */
  installConsoleGate();

  /* ── Head unit / eski WebView uyumluluk modu — React öncesi çağrılmalı ── */
  applyCompatMode();

  /* ── Gün/Gece + light-ui boot senkronu ───────────────────────────────────
   * light-ui (--oem-* açık palet + light-theme override'ları) ARTIK data-day-night
   * ile senkron yönetilir (useDayNightManager.applyDayNightDOM). Boot'ta ilk boyamanın
   * tutarlı olması için saatten gün/gece hesaplanıp İKİSİ birden set edilir
   * (07–19 gündüz). Böylece gece beyaz-kart-koyu-pano flaşı olmaz. */
  try {
    const _h = new Date().getHours();
    const _isDay = _h >= 7 && _h < 19;
    document.documentElement.setAttribute('data-day-night', _isDay ? 'day' : 'night');
    document.documentElement.classList.toggle('light-ui', _isDay);
  } catch { /* no-op */ }

  /* ── Spotify OAuth dönüşü: URL'de ?code= varsa token'a çevir, URL'yi temizle ── */
  /* Kod yoksa anında çıkar (no-op). React render'dan önce URL temizlenmeli. */
  await captureSpotifyRedirect().catch((e) => console.error('[SpotifyAuth]', e));

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
