import { useState, useEffect, useCallback, memo } from 'react';
import {
  MapPin, Map as MapIcon,
  SkipBack, SkipForward, Play, Pause,
  LayoutGrid, SlidersHorizontal, Check, X,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { VoiceMicButton } from '../modals/VoiceAssistant';
import { useWakeWordState } from '../../platform/wakeWordService';
import { OBDPanel } from '../obd/OBDPanel';
import { DigitalCluster } from '../obd/DigitalCluster';
import {
  NAV_OPTIONS, MUSIC_OPTIONS,
  type NavOptionKey, type MusicOptionKey, type AppItem,
} from '../../data/apps';
import { openApp } from '../../platform/appLauncher';
import { useDeviceStatus } from '../../platform/deviceApi';
import {
  useMediaState, togglePlayPause, next, previous,
} from '../../platform/mediaService';
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
import { MiniMapWidget } from '../map/MiniMapWidget';
// ── Extracted layout components ──────────────────────────────
import { BootSplash, type BootPhase } from './BootSplash';
import { SleepOverlay } from './SleepOverlay';
import { HeaderBar } from './HeaderBar';
import { DockBar, type DrawerType } from './DockBar';
import { DrawerPanel } from './DrawerPanel';
import { DriveHUD } from './DriveHUD';
import { DraggableWidget } from './DraggableWidget';
// ── Custom hooks ──────────────────────────────────────────────
import { useLayoutServices } from '../../hooks/useLayoutServices';
import { useOBDLifecycle } from '../../hooks/useOBDLifecycle';
import { useDriveModeDetection } from '../../hooks/useDriveModeDetection';
import { useVoiceCommandHandler } from '../../hooks/useVoiceCommandHandler';

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

/* ── NavHero ─────────────────────────────────────────────── */

const NavHero = memo(function NavHero({
  defaultNav, onLaunch, onOpenMap, offlineMap,
}: {
  defaultNav:  NavOptionKey;
  onLaunch:    (id: string) => void;
  onOpenMap?:  () => void;
  offlineMap?: boolean;
}) {
  const nav = NAV_OPTIONS[defaultNav];

  if (offlineMap && onOpenMap) {
    return (
      <div className="min-h-0 w-full h-full transform transition-all duration-300 hover:scale-[1.002] active:scale-[0.995]">
        <MiniMapWidget onFullScreenClick={onOpenMap} />
      </div>
    );
  }

  return (
    <div
      className="flex flex-col rounded-[2.5rem] border border-white/[0.14] p-8 overflow-hidden relative min-h-0 w-full h-full group transition-all duration-300 shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:border-white/25 hover:shadow-[0_16px_50px_rgba(0,0,0,0.5)]"
      style={{ background: 'linear-gradient(165deg, rgba(20,34,62,0.9) 0%, rgba(14,24,46,0.97) 100%)', backdropFilter: 'blur(50px)' }}
    >
      <div className="flex items-center justify-between mb-10 flex-shrink-0 relative z-10">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 rounded-[1.5rem] bg-blue-600/15 border border-blue-500/30 flex items-center justify-center flex-shrink-0 shadow-[0_10px_30px_rgba(59,130,246,0.25)] group-hover:border-blue-500/50 transition-colors duration-300">
            <span className="text-4xl leading-none drop-shadow-2xl">{nav.icon}</span>
          </div>
          <div>
            <div className="text-blue-400 font-black text-xs uppercase tracking-[0.5em] mb-1.5">NAVİGASYON ÜNİTESİ</div>
            <div className="text-white text-3xl font-black tracking-tighter uppercase">{nav.name}</div>
          </div>
        </div>
        {onOpenMap && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenMap(); }}
            className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 hover:border-white/40 active:scale-90 active:bg-white/20 transition-all duration-150 shadow-xl group/map"
          >
            <MapIcon className="w-7 h-7 transform group-hover/map:scale-110 transition-transform duration-200" />
          </button>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onLaunch(defaultNav); }}
        className="relative flex flex-col items-center justify-center rounded-[3rem] overflow-hidden active:scale-[0.975] active:brightness-90 transition-all duration-200 gap-8 min-h-0 flex-1 group/btn shadow-[0_30px_70px_rgba(37,99,235,0.4)] hover:shadow-[0_35px_80px_rgba(37,99,235,0.5)]"
        style={{ background: 'linear-gradient(145deg, #1e3a8a 0%, #2563eb 50%, #1e3a8a 100%)', border: '1px solid rgba(255,255,255,0.2)' }}
      >
        <div className="absolute inset-0 bg-white/10 opacity-0 group-hover/btn:opacity-100 transition-opacity duration-300" />
        <div className="relative flex flex-col items-center gap-8 pointer-events-none">
          <MapPin className="w-36 h-36 text-white relative drop-shadow-[0_15px_40px_rgba(0,0,0,0.6)] transform group-hover/btn:scale-105 transition-transform duration-500" />
          <div className="text-white text-6xl font-black tracking-tighter uppercase" style={{ textShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>NAVİGASYONU AÇ</div>
        </div>
      </button>
    </div>
  );
});

/* ── MediaPanel ──────────────────────────────────────────── */

const MediaPanel = memo(function MediaPanel({ defaultMusic }: { defaultMusic: MusicOptionKey }) {
  const { playing, track } = useMediaState();
  const music = MUSIC_OPTIONS[defaultMusic];

  return (
    <div
      className="flex flex-col rounded-[2.5rem] border border-white/[0.14] p-8 min-h-0 w-full h-full overflow-hidden relative group transition-all duration-300 shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:border-white/25"
      style={{ background: 'linear-gradient(165deg, rgba(20,34,62,0.9) 0%, rgba(14,24,46,0.97) 100%)', backdropFilter: 'blur(50px)' }}
    >
      <div className="flex-1 flex flex-col justify-center min-h-0 relative z-10">
        <div className="text-white font-black leading-none truncate text-[2.2rem] tracking-tight mb-2 group-hover:text-blue-50 transition-colors duration-300">{track.title}</div>
        <div className="text-blue-200/40 truncate text-base font-black uppercase tracking-[0.2em] mb-4">{track.artist}</div>
        <div className="flex items-center justify-center gap-6 flex-shrink-0 mt-4">
          <button onClick={(e) => { e.stopPropagation(); previous(); }} className="w-14 h-14 flex items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 hover:border-white/30 active:scale-90 active:bg-white/20 transition-all duration-150 shadow-md">
            <SkipBack className="w-7 h-7" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); togglePlayPause(); }}
            className="w-20 h-20 flex items-center justify-center rounded-[2rem] text-white active:scale-[0.94] active:brightness-90 transition-all duration-200"
            style={{ background: `linear-gradient(145deg, ${music.color}cc, ${music.color}88)`, border: '1px solid rgba(255,255,255,0.2)' }}
          >
            {playing ? <Pause className="w-9 h-9" /> : <Play className="w-9 h-9 ml-1.5 fill-white" />}
          </button>
          <button onClick={(e) => { e.stopPropagation(); next(); }} className="w-14 h-14 flex items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 hover:border-white/30 active:scale-90 active:bg-white/20 transition-all duration-150 shadow-md">
            <SkipForward className="w-7 h-7" />
          </button>
        </div>
      </div>
    </div>
  );
});

/* ── DockShortcuts ───────────────────────────────────────── */

const DockShortcuts = memo(function DockShortcuts({
  dockIds, onLaunch, appMap,
}: { dockIds: string[]; onLaunch: (id: string) => void; appMap: Record<string, AppItem> }) {
  const apps = dockIds.slice(0, 4).map((id) => ({ id, app: appMap[id] })).filter((x) => x.app);
  return (
    <div
      className="flex flex-col rounded-[2.5rem] border border-white/10 p-6 flex-1 w-full overflow-hidden relative group transition-all duration-700 shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
      style={{ background: 'linear-gradient(165deg, rgba(15,23,42,0.6) 0%, rgba(10,15,30,0.8) 100%)', backdropFilter: 'blur(40px)' }}
    >
      <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-blue-600/5 rounded-full blur-[60px] pointer-events-none" />
      <div className="text-blue-400 font-black text-[9px] uppercase tracking-[0.3em] mb-4 opacity-70 px-1">Kısayollar</div>
      <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
        {apps.map(({ id, app }) => (
          <button
            key={id}
            onClick={() => onLaunch(id)}
            className="flex flex-col items-center justify-center gap-2.5 rounded-[1.8rem] bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.15] active:scale-[0.94] transition-all duration-300 min-h-0 group/item shadow-sm hover:shadow-blue-500/10"
          >
            <span className="text-[2rem] leading-none transform group-hover/item:scale-110 transition-transform duration-500">{app!.icon}</span>
            <span className="text-white/40 group-hover:text-white/80 text-[10px] font-bold uppercase tracking-widest truncate px-2 transition-colors">{app!.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

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
  const [dragId,        setDragId]        = useState<string | null>(null);
  const [dropId,        setDropId]        = useState<string | null>(null);

  const { isNavigating } = useNavigation();
  const hudMedia = useMediaState();
  useWakeWordState();

  // ── Service initialisation ────────────────────────────────
  useLayoutServices({ settings, updateSettings, location });

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

  useEffect(() => {
    const t1 = setTimeout(() => setBootPhase('fade'), 850);
    const t2 = setTimeout(() => setBootPhase('done'), 1150);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('performance-mode', !!settings.performanceMode);
  }, [settings.performanceMode]);

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
    if (app.internalPage === 'settings') { setDrawer('settings'); return; }
    trackLaunch(id);
    openApp(app);
    setDrawer('none');
  }, [appMap]);

  const openApps     = useCallback(() => setDrawer('apps'),     []);
  const openSettings = useCallback(() => setDrawer('settings'), []);
  const closeDrawer  = useCallback(() => setDrawer('none'),     []);

  // ── Drag & drop ───────────────────────────────────────────
  const handleDragStart = useCallback((id: string) => { setDragId(id); setDropId(null); }, []);
  const handleDragOver  = useCallback((id: string) => { setDropId(id); }, []);
  const handleDrop      = useCallback(() => {
    if (dragId && dropId && dragId !== dropId) {
      const order = [...(settings.widgetOrder ?? ['media', 'shortcuts'])];
      const fi = order.indexOf(dragId), ti = order.indexOf(dropId);
      if (fi !== -1 && ti !== -1) { [order[fi], order[ti]] = [order[ti], order[fi]]; updateSettings({ widgetOrder: order }); }
    }
    setDragId(null); setDropId(null);
  }, [dragId, dropId, settings.widgetOrder, updateSettings]);

  // ── Voice command handler ─────────────────────────────────
  useVoiceCommandHandler({ settings, smart, handleLaunch, updateSettings, setDrawer });

  // ── Wallpaper ─────────────────────────────────────────────
  const wallpaperStyle = settings.wallpaper !== 'none' ? {
    backgroundImage: `url(${settings.wallpaper})`, backgroundSize: 'cover',
    backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
  } : {};

  // ── Render ────────────────────────────────────────────────
  return (
    <div
      data-theme={settings.theme}
      data-theme-pack={settings.themePack}
      data-theme-style={settings.themeStyle}
      data-widget-style={settings.widgetStyle}
      data-drive-state={smart.drivingMode}
      data-performance-mode={perfMode}
      data-edit-mode={settings.editMode}
      data-media-active={String(smart.mediaProminent)}
      data-nav-active={String(smart.mapPriority)}
      className={`flex flex-col h-full w-full overflow-hidden transition-all duration-500 ${settings.theme === 'light' ? 'text-slate-800' : 'text-white'}`}
      style={{
        background: settings.theme === 'oled' ? '#000' : settings.theme === 'light' ? '#eef2f7' : '#060d1a',
        ...wallpaperStyle,
      }}
    >
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

      <VoiceMicButton floating />

      {/* Settings shortcut */}
      <button data-drive-secondary onClick={openSettings} className="fixed bottom-3 left-3 z-[45] group w-9 h-9 flex items-center justify-center rounded-xl bg-black/30 border border-white/[0.08] hover:bg-white/10 hover:border-white/20 active:scale-90 transition-all duration-200 opacity-40 hover:opacity-100" aria-label="Ayarlar">
        <SlidersHorizontal className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
      </button>

      {/* Theme toggle */}
      <button data-drive-secondary onClick={() => updateSettings({ theme: settings.theme === 'light' ? 'dark' : 'light' })} className="fixed bottom-14 left-3 z-[45] w-9 h-9 flex items-center justify-center rounded-xl bg-black/30 border border-white/[0.08] hover:bg-white/10 active:scale-90 transition-all duration-200 opacity-40 hover:opacity-100" aria-label="Ekran modu" title={settings.theme === 'light' ? 'Karanlık moda geç' : 'Aydınlık moda geç'}>
        <span className="text-base leading-none select-none">{settings.theme === 'light' ? '🌙' : '☀️'}</span>
      </button>

      {settings.gestureVolumeSide !== 'off' && (
        <GestureVolumeZone side={settings.gestureVolumeSide} volume={settings.volume} onVolumeChange={(v) => updateSettings({ volume: v })} />
      )}

      {/* Edit mode banner */}
      {settings.editMode && (
        <div className="edit-mode-banner fixed top-0 inset-x-0 z-[60] h-12 bg-blue-600 flex items-center justify-between px-6 shadow-2xl">
          <div className="flex items-center gap-2">
            <LayoutGrid className="w-4 h-4 text-white animate-pulse" />
            <span className="text-white text-sm font-bold tracking-wider uppercase">DÜZENLEME MODU AKTİF</span>
          </div>
          <button onClick={() => updateSettings({ editMode: false })} className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-1.5 rounded-full transition-colors active:scale-95">
            <Check className="w-4 h-4 text-white" />
            <span className="text-white text-xs font-bold uppercase">BİTTİ</span>
          </button>
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

      {/* Header */}
      <HeaderBar smart={smart} onLaunch={handleLaunch} />

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0 relative z-10" data-theme-layout="main">
        {/* OBD Row */}
        <div className="px-3 pt-1 flex-shrink-0 relative" data-section="obd" data-hidden={!settings.widgetVisible.obd}>
          {settings.widgetVisible.obd && (
            (settings.themePack === 'bmw' || settings.themePack === 'mercedes') ? <DigitalCluster /> : <OBDPanel />
          )}
          {settings.editMode && (
            <div className="absolute top-4 right-4 z-50">
              <button onClick={() => updateSettings({ widgetVisible: { ...settings.widgetVisible, obd: !settings.widgetVisible.obd } })}
                className={`w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md border border-white/20 transition-all ${settings.widgetVisible.obd ? 'bg-red-500/80 text-white' : 'bg-green-500/80 text-white'}`}>
                {settings.widgetVisible.obd ? <X className="w-5 h-5" /> : <Check className="w-5 h-5" />}
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-hidden flex gap-3 px-3 pt-1 pb-1">
          {/* Left — Navigation / Map */}
          <div
            className={`min-w-0 min-h-0 flex relative transition-[flex] duration-700 ${
              settings.smartContextEnabled
                ? smart.layoutWeights.navFlex === 4 ? 'flex-[2.5]'
                  : smart.layoutWeights.navFlex === 2 ? 'flex-[1.2]'
                  : 'flex-[1.8]'
                : 'flex-[1.8]'
            }`}
            data-section="hero"
            data-hidden={!settings.widgetVisible.nav}
          >
            {settings.widgetVisible.nav && (
              <NavHero
                defaultNav={settings.defaultNav as NavOptionKey}
                onLaunch={handleLaunch}
                onOpenMap={() => setFullMapOpen(true)}
                offlineMap={settings.offlineMap}
              />
            )}
            {settings.editMode && (
              <div className="absolute top-4 right-4 z-50">
                <button onClick={() => updateSettings({ widgetVisible: { ...settings.widgetVisible, nav: !settings.widgetVisible.nav } })}
                  className={`w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md border border-white/20 transition-all ${settings.widgetVisible.nav ? 'bg-red-500/80 text-white' : 'bg-green-500/80 text-white'}`}>
                  {settings.widgetVisible.nav ? <X className="w-5 h-5" /> : <Check className="w-5 h-5" />}
                </button>
              </div>
            )}
          </div>

          {/* Right — Widgets (drag & drop) */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-3" data-section="sidebar">
            {(settings.widgetOrder ?? ['media', 'shortcuts']).map((widgetId, index) => {
              const flex = index === 0 ? 'flex-[1.5]' : 'flex-1';
              if (widgetId === 'media') {
                return (
                  <DraggableWidget key="media" id="media" editMode={settings.editMode} dragId={dragId} dropId={dropId} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} className={`${flex} min-h-0`}>
                    <div className="flex-1 min-h-0 flex flex-col relative w-full" data-section="media" data-hidden={!settings.widgetVisible.media}>
                      {settings.widgetVisible.media && <MediaPanel defaultMusic={settings.defaultMusic as MusicOptionKey} />}
                      {settings.editMode && (
                        <div className="absolute top-4 right-4 z-50">
                          <button onClick={() => updateSettings({ widgetVisible: { ...settings.widgetVisible, media: !settings.widgetVisible.media } })}
                            className={`w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md border border-white/20 transition-all ${settings.widgetVisible.media ? 'bg-red-500/80 text-white' : 'bg-green-500/80 text-white'}`}>
                            {settings.widgetVisible.media ? <X className="w-5 h-5" /> : <Check className="w-5 h-5" />}
                          </button>
                        </div>
                      )}
                    </div>
                  </DraggableWidget>
                );
              }
              if (widgetId === 'shortcuts') {
                return (
                  <DraggableWidget key="shortcuts" id="shortcuts" editMode={settings.editMode} dragId={dragId} dropId={dropId} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} className={`${flex} min-h-0`}>
                    <div className="flex-1 min-h-0 flex flex-col relative w-full" data-section="shortcuts" data-hidden={!settings.widgetVisible.shortcuts}>
                      {settings.widgetVisible.shortcuts && <DockShortcuts dockIds={smart.dockIds} onLaunch={handleLaunch} appMap={appMap} />}
                      {settings.editMode && (
                        <div className="absolute top-4 right-4 z-50">
                          <button onClick={() => updateSettings({ widgetVisible: { ...settings.widgetVisible, shortcuts: !settings.widgetVisible.shortcuts } })}
                            className={`w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md border border-white/20 transition-all ${settings.widgetVisible.shortcuts ? 'bg-red-500/80 text-white' : 'bg-green-500/80 text-white'}`}>
                            {settings.widgetVisible.shortcuts ? <X className="w-5 h-5" /> : <Check className="w-5 h-5" />}
                          </button>
                        </div>
                      )}
                    </div>
                  </DraggableWidget>
                );
              }
              return null;
            })}
          </div>
        </div>
      </div>

      {/* Drive HUD */}
      <DriveHUD />

      {/* Dock */}
      <DockBar
        smart={smart}
        appMap={appMap}
        onLaunch={handleLaunch}
        onOpenDrawer={setDrawer}
        onOpenApps={openApps}
        onOpenSettings={openSettings}
        onOpenSplit={() => setSplitOpen(true)}
        onOpenRearCam={() => setRearCamOpen(true)}
        onOpenPassenger={() => setPassengerOpen(true)}
      />

      {/* Drawers + Modals */}
      <DrawerPanel
        drawer={drawer}
        onClose={closeDrawer}
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
      />

    </div>
  );
}
