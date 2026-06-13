import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { safeGetRaw, safeSetRaw } from '../../utils/safeStorage';
import { VIEWPORT_H } from '../../utils/cssCompat';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import {
  type NavOptionKey, type MusicOptionKey,
} from '../../data/apps';
import { openApp } from '../../platform/appLauncher';
import { registerMusicDrawerHandler, unregisterMusicDrawerHandler } from '../../platform/mediaUi';
import { useDeviceStatus } from '../../platform/deviceApi';
import { useMediaState } from '../../platform/mediaService';
import { useSmartEngine, trackLaunch } from '../../platform/smartEngine';
import { useNavigation } from '../../platform/navigationService';
import { useApps } from '../../platform/appDiscovery';
import { useOBDSource } from '../../platform/obdService';
import { useGPSLocation } from '../../platform/gpsService';
import { ErrorToast } from '../common/ErrorToast';
import { VolumeOverlay } from '../common/VolumeOverlay';
import { GestureVolumeZone } from '../common/GestureVolumeZone';
import {
  getPerformanceMode, onPerformanceModeChange, type PerformanceMode,
} from '../../platform/performanceMode';
import { RuntimeMode } from '../../core/runtime/runtimeTypes';
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
// ── Extracted layout components ──────────────────────────────
import { BootSplash, type BootPhase } from './BootSplash';
import { GoldenHourAccent } from './GoldenHourAccent';
import { SleepOverlay } from './SleepOverlay';
import type { DrawerType } from './DockBar';
import { registerDrawerHandler, unregisterDrawerHandler } from '../../platform/drawerBus';
// DriveHUD kaldırıldı
// DrawerPanel lazy-loaded — ilk render'da bundle parse yükü yoktur
const DrawerPanel      = lazyWithRetry(() => import('./DrawerPanel').then((m) => ({ default: m.DrawerPanel })));
import { NewHomeLayout } from './NewHomeLayout';
// ── Custom hooks ──────────────────────────────────────────────
import { useLayoutServices } from '../../hooks/useLayoutServices';
import { useOBDLifecycle } from '../../hooks/useOBDLifecycle';
import { useDriveModeDetection } from '../../hooks/useDriveModeDetection';
import { useVoiceCommandHandler } from '../../hooks/useVoiceCommandHandler';
import { useContextEngine } from '../../platform/contextEngine';
import { useAddressNavState, clearOpenMapFlag } from '../../platform/addressNavigationEngine';
import { AddressNavCard } from '../common/AddressNavCard';
import { useDayNightManager } from '../../hooks/useDayNightManager';
import { VehicleReminderModal } from '../modals/VehicleReminderModal';
import { IncomingCallOverlay } from '../common/IncomingCallOverlay';
import { setRemoteCommandContext } from '../../platform/vehicleDataLayer';
import type { CommandContext } from '../../platform/commandExecutor';
import { bridge } from '../../platform/bridge';
import { useSystemStore } from '../../store/useSystemStore';
import { TripSummaryBanner }  from '../trip/TripSummaryBanner';
import { TheaterOverlay }     from '../theater/TheaterOverlay';

/* ── Persistence ─────────────────────────────────────────── */

/* favorites gibi düşük frekanslı tercihler artık doğrudan localStorage yerine
   safeStorage üzerinden kalıcı kılınır: 5s write-debounce (WRITE_DEBOUNCE_MS) +
   kota/LRU koruması wrapper'ın içinde (CLAUDE.md §3 Atomic Persistence). */
function save(key: string, value: unknown) {
  safeSetRaw(key, JSON.stringify(value));
}

function load<T>(key: string, fallback: T): T {
  try {
    const v = safeGetRaw(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

/* ── MainLayout ──────────────────────────────────────────── */

export default function MainLayout() {
  // useShallow: runtime state değişimlerinde (isEcoMode, runtimeMode, smartCards) MainLayout re-render olmaz
  const { settings, updateSettings, updateParking } = useStore(
    useShallow((s) => ({ settings: s.settings, updateSettings: s.updateSettings, updateParking: s.updateParking }))
  );
  const { apps: allApps, appMap, loading: appsLoading } = useApps();
  const obdSource = useOBDSource();
  const location  = useGPSLocation();

  const [bootPhase,     setBootPhase]     = useState<BootPhase>('show');
  const [drawer,        setDrawer]        = useState<DrawerType>('none');
  const [favorites,     setFavorites]     = useState<string[]>(() => load<string[]>('favorites', []));
  const [perfMode,      setPerfMode]      = useState<PerformanceMode>(() => getPerformanceMode());
  const [runtimeMode,   setRuntimeMode]   = useState(() => runtimeManager.getMode());
  const [fullMapOpen,   setFullMapOpen]   = useState(false);
  const [splitOpen,     setSplitOpen]     = useState(false);
  const [rearCamOpen,   setRearCamOpen]   = useState(false);
  const [passengerOpen, setPassengerOpen] = useState(false);

  // SystemStore — Orchestrator tarafından yazılan kararlı durumlar
  const showTripSummary  = useSystemStore((s) => s.showTripSummary);
  const lastCompletedTrip = useSystemStore((s) => s.lastCompletedTrip);
  const navOpenTrigger   = useSystemStore((s) => s.navOpenTrigger);
  const navOpenSeenRef   = useRef(navOpenTrigger);


  const { isNavigating } = useNavigation();
  // Sadece playing alanı — şarkı metadata/position değişimlerinde MainLayout re-render olmasın
  const hudMedia = { playing: useMediaState().playing };
  // ── Service initialisation ────────────────────────────────
  useLayoutServices({ settings, updateSettings, location });

  useDayNightManager();

  // ── OBD lifecycle (toasts, park save, auto sleep) ─────────
  useOBDLifecycle({ location, settings, updateSettings, updateParking });

  // ── Auto drive mode detection ─────────────────────────────
  useDriveModeDetection({ location, settings });

  // Geçersiz favorileri filtrele
  useEffect(() => {
    if (!appsLoading && Object.keys(appMap).length > 0) {
      const valid = favorites.filter(id => id in appMap || id.startsWith('native-'));
      if (valid.length !== favorites.length) setFavorites(valid);
    }
  }, [appsLoading, appMap, favorites]);

  useEffect(() => { return onPerformanceModeChange(setPerfMode); }, []);
  useEffect(() => runtimeManager.subscribe((mode) => setRuntimeMode(mode)), []);

  // Preload DrawerPanel during idle time so first open is instant
  useEffect(() => {
    const cb = () => import('./DrawerPanel');
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(cb);
      return () => cancelIdleCallback(id);
    }
    const t = setTimeout(cb, 2000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const t1 = setTimeout(() => setBootPhase('fade'), 850);
    const t2 = setTimeout(() => setBootPhase('done'), 1150);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // ── Otomatik navigasyon açılışı (Tesla mantığı) ───────────
  const autoNavFiredRef = useRef(false);
  useEffect(() => {
    if (autoNavFiredRef.current) return;
    if (!settings.autoNavOnStart) return;
    if (bootPhase !== 'done') return;
    autoNavFiredRef.current = true;
    setFullMapOpen(true);
  }, [bootPhase, settings.autoNavOnStart]);

  // ── Orchestrator'dan gelen harita açma sinyali ───────────
  // navOpenTrigger her artışı bir kez "aç" komutudur (sürüş başlayınca tetiklenir).
  // Yalnızca kullanıcı "Hızlı Harita" (autoNavOnStart) açıksa haritayı aç — aksi
  // halde park/test sırasında sürüş yanlış algılanınca harita kendiliğinden tam
  // ekran açılıyordu. Tetik yine tüketilir (seen ref güncellenir) → birikmez.
  useEffect(() => {
    if (navOpenTrigger !== navOpenSeenRef.current) {
      navOpenSeenRef.current = navOpenTrigger;
      if (settings.autoNavOnStart) setFullMapOpen(true);
    }
  }, [navOpenTrigger, settings.autoNavOnStart]);

  useEffect(() => {
    document.body.classList.toggle('performance-mode', !!settings.performanceMode);
  }, [settings.performanceMode]);

  // ── Android hardware back button — çift basış ile çıkış ──────
  useEffect(() => {
    let lastBackAt = 0;
    const handler = () => {
      // Açık drawer/modal varsa önce onu kapat
      if (drawer !== 'none') { setDrawer('none'); return; }
      if (fullMapOpen)   { setFullMapOpen(false);   return; }
      if (splitOpen)     { setSplitOpen(false);     return; }
      if (rearCamOpen)   { setRearCamOpen(false);   return; }
      if (passengerOpen) { setPassengerOpen(false); return; }

      // Ana ekrandayken: çift basışta çık
      const now = Date.now();
      if (now - lastBackAt < 800) {
        (navigator as Navigator & { app?: { exitApp(): void } }).app?.exitApp?.();
      } else {
        lastBackAt = now;
        // toast yerine kısa bir visual cue — zaten errorBus var
        import('../../platform/errorBus').then(({ showToast }) =>
          showToast({ type: 'info', title: 'Çıkmak için tekrar basın' })
        );
      }
    };
    document.addEventListener('backbutton', handler);
    return () => document.removeEventListener('backbutton', handler);
  }, [drawer, fullMapOpen, splitOpen, rearCamOpen, passengerOpen]);

  // ── Smart engine ──────────────────────────────────────────
  const device = useDeviceStatus();
  const smart  = useSmartEngine(
    device, favorites,
    settings.defaultNav as NavOptionKey,
    settings.defaultMusic as MusicOptionKey,
    location?.speed != null ? Math.round(location.speed * 3.6) : undefined,
    hudMedia.playing,
    isNavigating,
  );

  useContextEngine(location, settings);

  // ── Action callbacks ──────────────────────────────────────
  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id];
      save('favorites', next);
      return next;
    });
  }, []);

  const handleLaunch = useCallback((id: string) => {
    if (!id) return;
    const app = appMap[id];
    if (!app) return;

    // ── Internal screen interceptors ─────────────────────────
    // Launcher'dan çıkmadan iç ekranları aç
    if (app.internalPage === 'settings')  { setDrawer('settings'); return; }
    if (app.category === 'media')         { setDrawer('music');    return; }  // spotify, youtube vb.
    if (app.category === 'navigation')    { setFullMapOpen(true);  return; }  // maps, waze, yandex
    if (id === 'phone' || id === 'contacts') { setDrawer('phone'); return; }  // telefon / rehber

    trackLaunch(id);
    openApp(app);
    setDrawer('none');
  }, [appMap]);

  const openApps     = useCallback(() => setDrawer('apps'),     []);
  const openSettings = useCallback(() => setDrawer('settings'), []);
  const closeDrawer  = useCallback(() => setDrawer('none'),     []);

  // Müzik drawer event bus kaydı
  useEffect(() => {
    registerMusicDrawerHandler(() => setDrawer('music'));
    return () => unregisterMusicDrawerHandler();
  }, []);

  // Drawer bus kaydı — tüm tema dockları buradan setDrawer çağırır
  useEffect(() => {
    registerDrawerHandler(setDrawer);
    return () => { unregisterDrawerHandler(); };
  }, []);


  // ── Remote Command Context Bridge ─────────────────────────
  // Ref her render'da güncellenir → stale closure riski sıfır (voiceCtxRef pattern).
  // setRemoteCommandContext mount'ta bir kez çağrılır; getter'lar her zaman
  // güncel ref değerini okur — Zero-Leak, CLAUDE.md §1.
  const _remoteRef = useRef<{
    settings:       typeof settings;
    smart:          typeof smart;
    location:       typeof location;
    handleLaunch:   typeof handleLaunch;
    updateSettings: typeof updateSettings;
    setDrawer:      typeof setDrawer;
  }>({ settings, smart, location, handleLaunch, updateSettings, setDrawer });
  // Intentional: dep array yok — her render'dan sonra ref güncellenir.
  // Remote command handler bu ref'i okur; dep array eklemek stale closure'a neden olur.
  useEffect(() => {
    _remoteRef.current = { settings, smart, location, handleLaunch, updateSettings, setDrawer };
  }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const ctx: CommandContext = {
      get vehicleCtx() {
        const { location: loc, smart: sm } = _remoteRef.current;
        return {
          speedKmh:    loc?.speed != null ? Math.round(loc.speed * 3.6) : 0,
          drivingMode: sm.drivingMode,
          isDriving:   sm.drivingMode === 'driving',
        };
      },
      get defaultNav()   { return _remoteRef.current.settings.defaultNav   as NavOptionKey;   },
      get defaultMusic() { return _remoteRef.current.settings.defaultMusic as MusicOptionKey; },
      get recentAppId()  {
        return _remoteRef.current.smart.quickActions.find((a) => a.id.startsWith('last-'))?.appId;
      },
      launch:         (id)    => _remoteRef.current.handleLaunch(id),
      setTheme:       (theme) => _remoteRef.current.updateSettings({
        theme: theme === 'day' ? 'light' : theme === 'night' ? 'dark' : theme,
      }),
      openDrawer:     (t)     => _remoteRef.current.setDrawer(t as DrawerType),
      hwLockDoors:    ()      => bridge.hwLockDoors(),
      hwUnlockDoors:  ()      => bridge.hwUnlockDoors(),
    };
    setRemoteCommandContext(ctx);
    // Temizlik: stopRemoteCommands() zaten App.tsx → vehicleDataLayer cleanup
    // zincirinde çağrılır; burada ek bir işlem gerekmez.
  }, []); // mount-only — ctx getter'ları ref üzerinden her zaman güncel kalır

  // ── Voice command handler ─────────────────────────────────
  useVoiceCommandHandler({ settings, smart, handleLaunch, updateSettings, setDrawer });

  // ── Adres navigasyon engine: haritayı otomatik aç ─────────
  const addressNavState = useAddressNavState();
  useEffect(() => {
    if (addressNavState.shouldOpenMap) {
      setFullMapOpen(true);
      clearOpenMapFlag();
    }
  }, [addressNavState.shouldOpenMap]);

  // ── Navigasyon başlarsa veya harita açılırsa trip banner'ı kapat ──
  useEffect(() => {
    if ((isNavigating || fullMapOpen) && showTripSummary) {
      useSystemStore.getState().closeTripSummary();
    }
  }, [isNavigating, fullMapOpen, showTripSummary]);

  // Wallpaper: html elementine CSS değişkeni + data attr. Tüm day/night/tema kurallarını geçersiz kılar.
  useEffect(() => {
    const html = document.documentElement;
    const wp = settings.wallpaper;
    if (wp && wp !== 'none') {
      const isGradient = wp.startsWith('linear-gradient') || wp.startsWith('radial-gradient') || wp.startsWith('conic-gradient');
      const val = isGradient ? wp : `url("${wp}") center/cover no-repeat`;
      html.style.setProperty('--pack-bg', val);
      html.setAttribute('data-has-wallpaper', '1');
    } else {
      html.style.removeProperty('--pack-bg');
      html.removeAttribute('data-has-wallpaper');
    }
    return () => {
      html.style.removeProperty('--pack-bg');
      html.removeAttribute('data-has-wallpaper');
    };
  }, [settings.wallpaper]);

  const isSafeMode     = runtimeMode === RuntimeMode.SAFE_MODE;
  // Mali-400 GPU guard: blur kapalıyken (low-end) ambient blob DOM'unu hiç render etme.
  // CSS guard (--rt-blur) blur'u 0'a indirir; bu ek olarak 3 kalıcı will-change
  // compositor layer'ını da DOM'dan kaldırır. runtimeMode değişiminde (satır 122
  // subscribe) yeniden hesaplanır — config mode ile senkron yazılır.
  const blurEnabled    = runtimeManager.getConfig().enableBlur;
  const isTheaterActive = useSystemStore((s) => s.isTheaterModeActive);

  // Mali-400 GPU guard: anasayfa TAMAMEN opak bir overlay ile kapandığında alttaki
  // MiniMapWidget'ın canlı MapLibre WebGL context'ini serbest bırak (sürekli çizim
  // döngüsü dokunma gecikmesine katkı veriyordu). Mevcut `fullMapOpen` unmount koşuluna
  // OR'lanır → 8 tema layout dosyasına dokunmadan, kanıtlanmış unmount yolu üzerinden.
  // YALNIZCA opak/tam-kapatan durumlar: settings & climate FullscreenDrawer (opak, z-9999),
  // split (kendi haritası var), rear-cam (kamera, tam ekran), theater (home opacity:0).
  // Yarı saydam NormalDrawer'lar (apps/music/phone) HARİÇ — anasayfa backdrop arkasından
  // görünür, orada unmount görünür kararmaya yol açar.
  const homeFullyHidden =
    isTheaterActive || splitOpen || rearCamOpen ||
    drawer === 'settings' || drawer === 'climate';

  // Theater mode: nav/widget'lar gizlenir; içerik alanı serbest kalır.
  // Giriş: 400ms fade-out (görsel geçiş).
  // Çıkış: 100ms fade-in (güvenlik — araç hareket etti, arayüz anında erişilebilir).
  const theaterHide = isTheaterActive
    ? { opacity: 0, pointerEvents: 'none' as const, transition: 'opacity 400ms ease' }
    : { transition: 'opacity 100ms ease' };

  // ── Render ────────────────────────────────────────────────
  return (
    <div
      data-theme-pack={settings.themePack}
      data-drive-state={smart.drivingMode}
      data-performance-mode={perfMode}
      data-edit-mode={settings.editMode}
      data-media-active={String(smart.mediaProminent)}
      data-nav-active={String(smart.mapPriority)}
      className="ultra-premium-root flex flex-col w-full overflow-hidden"
      style={{ height: VIEWPORT_H }}
    >
      {/* Ultra Premium Ambient Blobs — SAFE_MODE'da ve low-end (blur kapalı) cihazda
          devre dışı: Mali-400'de 3 kalıcı will-change compositor layer + 60px blur
          GPU fill-rate'i doyuruyordu (dokunma gecikmesi). */}
      {!isSafeMode && blurEnabled && (
        <div className="up-ambient-blobs">
          <div className="up-blob up-blob-1" />
          <div className="up-blob up-blob-2" />
          <div className="up-blob up-blob-3" />
        </div>
      )}

      <BootSplash phase={bootPhase} />
      <ErrorToast />
      <VolumeOverlay />
      {/* Living theme — sabah/akşam golden-hour üst şeridi (izole; root re-render yok) */}
      <GoldenHourAccent />

      {/* OBD simüle veri uyarısı */}
      {obdSource === 'mock' && bootPhase === 'done' && (
        <div data-obd-sim-warn className="fixed top-2 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 heavy-blur pointer-events-none">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
          <span className="text-amber-400 text-[10px] font-semibold tracking-wide uppercase">Simüle veri — OBD bağlı değil</span>
        </div>
      )}

      {settings.gestureVolumeSide !== 'off' && (
        <div style={theaterHide}>
          <GestureVolumeZone side={settings.gestureVolumeSide} volume={settings.volume} onVolumeChange={(v) => updateSettings({ volume: v })} />
        </div>
      )}


      {settings.sleepMode && (
        <SleepOverlay
          use24Hour={settings.use24Hour}
          showSeconds={settings.showSeconds}
          clockStyle={settings.clockStyle}
          onWake={() => updateSettings({ sleepMode: false })}
        />
      )}

      {/* Adres navigasyon kartı — fixed z-[9500]: harita tam ekranında da görünür */}
      <div className="fixed inset-x-0 top-2 z-[9500] pointer-events-none" style={theaterHide}>
        <div className="pointer-events-auto">
          <AddressNavCard />
        </div>
      </div>

      {/* New Home Layout — theater modda gizlenir (overlay tam ekranı kaplar) */}
      <div
        className="flex-1 min-h-0 overflow-hidden relative z-10"
        style={theaterHide}
        onContextMenu={(e) => e.preventDefault()}
      >
        <NewHomeLayout
          onOpenMap={() => setFullMapOpen(true)}
          onOpenApps={openApps}
          onOpenSettings={openSettings}
          onLaunch={handleLaunch}
          appMap={appMap}
          dockIds={smart.dockIds}
          fullMapOpen={fullMapOpen || homeFullyHidden}
          onOpenRearCam={() => setRearCamOpen(true)}
          onOpenDashcam={() => setDrawer('dashcam')}
          smart={smart}
        />
      </div>

      {/* Yolculuk özet banner — navigasyon veya tam ekran harita açıkken gizle */}
      {showTripSummary && lastCompletedTrip && !isNavigating && !fullMapOpen && (
        <TripSummaryBanner
          trip={lastCompletedTrip}
          onClose={() => useSystemStore.getState().closeTripSummary()}
          onViewDetails={() => setDrawer('triplog')}
        />
      )}

      {/* Gelen arama overlay */}
      <IncomingCallOverlay />

      {/* Theater Mode — araç dururken medya odaklı tam ekran (z-9990) */}
      <TheaterOverlay />

      {/* Bakım hatırlatıcı modal — Smart Recommendation banner'dan açılır */}
      {drawer === 'vehicle-reminder' && (
        <VehicleReminderModal onClose={closeDrawer} />
      )}

      {/* Drawers + Modals — lazy loaded, renders only when first opened */}
      <Suspense fallback={null}>
        <DrawerPanel
          drawer={drawer}
          onClose={closeDrawer}
          defaultMusic={settings.defaultMusic as MusicOptionKey}
          allApps={allApps}
          favorites={favorites}
          gridColumns={settings.gridColumns as 3 | 4 | 5}
          onToggleFav={toggleFavorite}
          onLaunch={handleLaunch}
          onOpenMap={() => setFullMapOpen(true)}
          splitOpen={splitOpen}
          onCloseSplit={() => setSplitOpen(false)}
          rearCamOpen={rearCamOpen}
          onCloseRearCam={() => setRearCamOpen(false)}
          fullMapOpen={fullMapOpen}
          onCloseMap={() => setFullMapOpen(false)}
          passengerOpen={passengerOpen}
          onClosePassenger={() => setPassengerOpen(false)}
          onOpenDrawerFromMap={(type) => {
            setFullMapOpen(false);
            if (type === 'music')    setDrawer('music');
            else if (type === 'phone')    setDrawer('phone');
            else if (type === 'apps')     setDrawer('apps');
            else if (type === 'settings') setDrawer('settings');
          }}
        />
      </Suspense>

    </div>
  );
}


