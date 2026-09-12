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
import { initThemePreviewBridge } from './platform/themePreviewBridge.ts'
import { initThemeRuntime } from './platform/theme/themeRuntime.ts'
/* ARCH-06/F1 — SALT ÖLÇÜM. Hiçbir servis başlatmaz, hiçbir sırayı
   değiştirmez; yalnız monotonik damga alır (bkz. bootTimingRecorder). */
import { markBootMilestone } from './platform/bootTimingRecorder.ts'

/* ── Bootstrap Launcher ── */
(async () => {
try {
  /* ── ARCH-06/F1 · PROCESS_STARTED ────────────────────────────────────────
   * Ölçülebilen EN ERKEN nokta burasıdır: modül grafiği yüklendi, IIFE
   * başladı. Daha erkeni (HTML parse · script fetch) JS'ten görülemez ve
   * uydurulmaz. `markBootMilestone` ilk-çağrı-kazanır: yeniden giriş olsa
   * bile taban İLERİ ATILMAZ, aksi halde tüm elapsed değerleri küçülürdü. */
  markBootMilestone('PROCESS_STARTED', 'main.tsx:bootstrap');

  /* ── Log gate: düşük runtime modunda (head unit) debug log'larını sustur.
   * Capable cihaz/tarayıcı (BALANCED/PERF) tam log korur. En başta kurulur ki
   * boot logları da gate'lensin; console.error her zaman geçer (silent hariç). */
  installConsoleGate();

  /* ── Tema Stüdyo iframe canlı önizleme köprüsü (carospro.com'dan postMessage) ── */
  initThemePreviewBridge();

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

  /* ── Tema Manifesti çalışma zamanı — saklanmış özelleştirmeyi geri yükle.
   * safeStorage HAZIR olduktan SONRA çağrılır (native'de _fsCache gerekir).
   * Baz temayı ZORLAMAZ: yalnız aktif temaya ait tokenlar/bileşen stilleri döner. */
  try { initThemeRuntime(); } catch (e) { console.error('[ThemeRuntime]', e); }

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

    /* ARCH-06/F2 · KALDIRILDI — GÖVDESİ BOŞ `obdData` DİNLEYİCİSİ.
       KANIT: gövde yalnız bir yorum taşıyordu (hiçbir iş yapmıyordu), handle
       atılıyordu (cleanup YOK, ARCH-04 kayıt/yaşam-döngüsü kanıtına BAĞLI
       DEĞİLDİ) ve geri vites sinyalinin gerçek kaynağı yukarıdaki `canData`
       ile `App.tsx`tir (`signalReverse`). Yani her OBD olayında bir köprü
       dağıtımı + JS çağrısı HİÇBİR ŞEY için ödeniyordu.
       Geri vites davranışı DEĞİŞMEDİ: `canData` yolu aynen duruyor. */
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

  /* ── ARCH-06/F1 · FIRST_FRAME ────────────────────────────────────────────
   * `render()` çağrısının DÖNMESİ boyama DEĞİLDİR: React o anda yalnız işi
   * kuyruğa alır. Gerçek boyamaya en yakın ölçülebilir sınır ÇİFT rAF'tır:
   * ilk rAF bir sonraki karenin BAŞINDA koşar, ikinci rAF o karenin
   * boyanmasından SONRA koşar. Bu, tarayıcının verdiği en dürüst sınırdır;
   * "gerçek piksel zamanı" iddiası edilmez.
   *
   * MALİYET: tam iki kare, bir kez, ömür boyu. Kalıcı rAF döngüsü KURULMAZ
   * (boşta-render ısı anti-pattern'i — perfSeriesRecorder başlığı). */
  try {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => markBootMilestone('FIRST_FRAME', 'main.tsx:double-rAF'));
      });
    }
  } catch { /* ölçüm alınamadı → taş null KALIR, sahte değer YAZILMAZ */ }

  /* ── ARCH-06/F1 · SHELL_INTERACTIVE ──────────────────────────────────────
   * İKİ TETİKLEYİCİ, İLK OLAN KAZANIR (`markBootMilestone` idempotent):
   *
   *  (a) GERÇEK GİRDİ — ana döngü bir kullanıcı olayını GERÇEKTEN işledi.
   *      En güçlü kanıt budur. `once` + `passive`: dinleyici ilk olayda
   *      kendini söker, scroll/dokunma davranışını ETKİLEMEZ.
   *
   *  (b) SINIRLI HAZIRLIK — kullanıcı hiçbir şeye dokunmazsa (park hâlinde
   *      açılış, otomatik test, kiosk) taş sonsuza dek `null` kalırdı ve
   *      metrik ölçülemez olurdu. Bu yüzden ilk boyamadan sonra ana döngünün
   *      BOŞ olduğu ilk an (`requestIdleCallback`) sınır olarak damgalanır.
   *
   * Bu bir "uygulama hazır" iddiası DEĞİLDİR: yalnız kabuk çizildi ve ana
   * döngü girdi işleyebiliyor demektir. `BACKGROUND_COMPLETE` ayrı taştır.
   * Kaynak ayrımı `provenance` alanında taşınır — hangi yolun damgaladığı
   * LAB'da görünür, ikisi karıştırılmaz. */
  try {
    const markShell = (src: string) => () => markBootMilestone('SHELL_INTERACTIVE', src);
    const opts = { once: true, passive: true } as const;
    window.addEventListener('pointerdown', markShell('main.tsx:input:pointerdown'), opts);
    window.addEventListener('keydown',     markShell('main.tsx:input:keydown'),     opts);
    window.addEventListener('touchstart',  markShell('main.tsx:input:touchstart'),  opts);
    const idle = (window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void;
    }).requestIdleCallback;
    if (typeof idle === 'function') {
      idle(markShell('main.tsx:idle-boundary'), { timeout: 10_000 });
    }
  } catch { /* ölçüm alınamadı → taş null KALIR */ }
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
