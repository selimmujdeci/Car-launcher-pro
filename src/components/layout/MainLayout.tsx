import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useStore } from '../../store/useStore';
import { useWakeWordState } from '../../platform/wakeWordService';
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
import { useOBDState } from '../../platform/obdService';
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
import { SleepOverlay } from './SleepOverlay';
import { DockBar, type DrawerType } from './DockBar';
// DriveHUD kaldırıldı
// DrawerPanel lazy-loaded — ilk render'da bundle parse yükü yoktur
const DrawerPanel      = lazy(() => import('./DrawerPanel').then((m) => ({ default: m.DrawerPanel })));
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
import { useSystemStore } from '../../store/useSystemStore';
import { TripSummaryBanner }  from '../trip/TripSummaryBanner';
import { TheaterOverlay }     from '../theater/TheaterOverlay';

/* ── Persistence ─────────────────────────────────────────── */

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      // Kota doldu — geçici verileri temizle ve yeniden dene
      try { localStorage.removeItem('car-trip-log'); } catch { /* ignore */ }
      try { localStorage.removeItem('car-crash-log'); } catch { /* ignore */ }
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
    }
  }
}

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

/* ── MainLayout ──────────────────────────────────────────── */

export default function MainLayout() {
  const { settings, updateSettings, updateParking } = useStore();
  const { apps: allApps, appMap, loading: appsLoading } = useApps();
  const obd      = useOBDState();
  const location = useGPSLocation();

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
  const hudMedia = useMediaState();
  useWakeWordState();

  // ── Service initialisation ────────────────────────────────
  useLayoutServices({ settings, updateSettings, location });

  useDayNightManager();

  // ── OBD lifecycle (toasts, park save, auto sleep) ─────────
  useOBDLifecycle({ obd, location, settings, updateSettings, updateParking });

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
  // navOpenTrigger her artışı bir kez "aç" komutudur
  useEffect(() => {
    if (navOpenTrigger !== navOpenSeenRef.current) {
      navOpenSeenRef.current = navOpenTrigger;
      setFullMapOpen(true);
    }
  }, [navOpenTrigger]);

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
    location?.speed != null ? location.speed * 3.6 : undefined,
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
  useEffect(() => {
    _remoteRef.current = { settings, smart, location, handleLaunch, updateSettings, setDrawer };
  });
  useEffect(() => {
    const ctx: CommandContext = {
      get vehicleCtx() {
        const { location: loc, smart: sm } = _remoteRef.current;
        return {
          speedKmh:    loc?.speed != null ? loc.speed * 3.6 : 0,
          drivingMode: sm.drivingMode,
          isDriving:   sm.drivingMode === 'driving',
        };
      },
      get defaultNav()   { return _remoteRef.current.settings.defaultNav   as NavOptionKey;   },
      get defaultMusic() { return _remoteRef.current.settings.defaultMusic as MusicOptionKey; },
      get recentAppId()  {
        return _remoteRef.current.smart.quickActions.find((a) => a.id.startsWith('last-'))?.appId;
      },
      launch:     (id)    => _remoteRef.current.handleLaunch(id),
      setTheme:   (theme) => _remoteRef.current.updateSettings({ theme }),
      openDrawer: (t)     => _remoteRef.current.setDrawer(t as DrawerType),
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
  const isTheaterActive = useSystemStore((s) => s.isTheaterModeActive);

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
      className="ultra-premium-root flex flex-col h-full w-full overflow-hidden"
    >
      {/* Ultra Premium Ambient Blobs — SAFE_MODE'da devre dışı (GPU tasarrufu) */}
      {!isSafeMode && (
        <div className="up-ambient-blobs">
          <div className="up-blob up-blob-1" />
          <div className="up-blob up-blob-2" />
          <div className="up-blob up-blob-3" />
        </div>
      )}

      <BootSplash phase={bootPhase} />
      <ErrorToast />
      <VolumeOverlay />

      {/* OBD simüle veri uyarısı */}
      {obd.source === 'mock' && bootPhase === 'done' && (
        <div data-obd-sim-warn className="fixed top-2 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 heavy-blur pointer-events-none">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
          <span className="text-amber-400 text-[10px] font-semibold tracking-wide uppercase">Simüle veri — OBD bağlı değil</span>
        </div>
      )}

      {/* 2-sıralı özellik dock'u — theater modda gizlenir */}
      <div style={theaterHide}>
        <DockBar
          smart={smart}
          appMap={appMap}
          onLaunch={handleLaunch}
          onOpenDrawer={setDrawer}
          onOpenApps={openApps}
          onOpenSettings={openSettings}
          onOpenSplit={() => {}}
          onOpenRearCam={() => setRearCamOpen(true)}
        />
      </div>

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

      {/* Adres navigasyon kartı — theater modda gizlenir */}
      <div style={theaterHide}>
        <AddressNavCard />
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
          fullMapOpen={fullMapOpen}
          onOpenRearCam={() => setRearCamOpen(true)}
          onOpenDashcam={() => setDrawer('dashcam')}
          smart={smart}
        />
      </div>
      {/* DockBar yüksekliği kadar boşluk — fixed DockBar'ın arkasına içerik kaymasını önler.
          paddingBottom yerine sibling spacer kullanılır: Android WebView'da h-full çocuklar
          padding-bottom dahil yüksekliği alır (percentage-height bug), sibling spacer güvenli. */}
      <div
        aria-hidden
        className="flex-shrink-0 pointer-events-none"
        style={{ height: 'calc(var(--lp-dock-h, 68px) + 12px + env(safe-area-inset-bottom, 0px))' }}
      />

      {/* Yolculuk özet banner — Orchestrator tetikler, store yönetir */}
      {showTripSummary && lastCompletedTrip && (
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


