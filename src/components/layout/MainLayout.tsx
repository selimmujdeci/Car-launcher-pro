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
  const [fullMapOpen,   setFullMapOpen]   = useState(false);
  const [splitOpen,     setSplitOpen]     = useState(false);
  const [rearCamOpen,   setRearCamOpen]   = useState(false);
  const [passengerOpen, setPassengerOpen] = useState(false);


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

  // ── Render ────────────────────────────────────────────────
  return (
    <div
      data-theme="light"
      data-theme-pack={settings.themePack}
      data-drive-state={smart.drivingMode}
      data-performance-mode={perfMode}
      data-edit-mode={settings.editMode}
      data-media-active={String(smart.mediaProminent)}
      data-nav-active={String(smart.mapPriority)}
      className="ultra-premium-root flex flex-col h-full w-full overflow-hidden"
      style={{
        '--pack-bg': (settings.wallpaper && settings.wallpaper !== 'none')
          ? (settings.wallpaper.startsWith('linear-gradient') ? settings.wallpaper : `url(${settings.wallpaper})`)
          : undefined,
      } as any}
    >
      {/* Ultra Premium Ambient Blobs */}
      <div className="up-ambient-blobs">
        <div className="up-blob up-blob-1" />
        <div className="up-blob up-blob-2" />
        <div className="up-blob up-blob-3" />
      </div>

      <BootSplash phase={bootPhase} />
      <ErrorToast />
      <VolumeOverlay />

      {/* OBD simüle veri uyarısı */}
      {obd.source === 'mock' && bootPhase === 'done' && (
        <div data-obd-sim-warn className="fixed top-2 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 backdrop-blur-sm pointer-events-none">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
          <span className="text-amber-400 text-[10px] font-semibold tracking-wide uppercase">Simüle veri — OBD bağlı değil</span>
        </div>
      )}

      {/* 2-sıralı özellik dock'u */}
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

      {/* Settings ve theme toggle dock'a taşındı */}

      {settings.gestureVolumeSide !== 'off' && (
        <GestureVolumeZone side={settings.gestureVolumeSide} volume={settings.volume} onVolumeChange={(v) => updateSettings({ volume: v })} />
      )}


      {settings.sleepMode && (
        <SleepOverlay
          use24Hour={settings.use24Hour}
          showSeconds={settings.showSeconds}
          clockStyle={settings.clockStyle}
          onWake={() => updateSettings({ sleepMode: false })}
        />
      )}

      {/* Adres navigasyon kartı */}
      <AddressNavCard />

      {/* New Home Layout */}
      <div
        className="flex-1 min-h-0 overflow-hidden relative z-10"
        style={{ paddingBottom: 'calc(var(--lp-dock-h, 68px) + 12px)' }}
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
        />
      </div>

      {/* Gelen arama overlay */}
      <IncomingCallOverlay />

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


