import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from './store/useStore';
import MainLayout from './components/layout/MainLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InAppBrowser } from './components/common/InAppBrowser';
import { EditController } from './components/edit/EditController';
import { LayoutProvider } from './context/LayoutContext';
import { startVehicleDataLayer } from './platform/vehicleDataLayer';
import { ReverseOverlay } from './components/camera/ReverseOverlay';
import { DisclaimerBanner } from './components/legal/DisclaimerBanner';
import { usePermission } from './platform/roleSystem';
import { DEBUG_ENABLED } from './platform/debug';
import { HotspotPromptModal } from './components/modals/HotspotPromptModal';
import { isAlreadyConnected, openHotspotSettings } from './platform/tetherService';
import { isNative } from './platform/bridge';
import { startRadarEngine, stopRadarEngine } from './platform/radar/radarEngine';
import { turkiyeStaticRadars } from './platform/radar/staticRadarData';
import { useRadarSystem } from './hooks/useRadarSystem';
import { RadarAlertHUD } from './components/layout/RadarAlertHUD';
import { SentryOverlay } from './components/security/SentryOverlay';
import { startSmartCardEngine, stopSmartCardEngine } from './platform/ai/smartCardEngine';
import { initPushService }                          from './platform/pushService';
import { GlobalAlert } from './components/common/GlobalAlert';
import { startSystemOrchestrator }  from './platform/system/SystemOrchestrator';
import { startMaintenanceBrain }    from './platform/diagnostic/maintenanceBrain';
import { startFuelAdvisor }         from './platform/diagnostic/fuelAdvisorService';
import { startTheaterService }      from './platform/theaterModeService';
import { startBlackBox }           from './platform/security/blackBoxService';
import { signalReverse }           from './platform/cameraService';
import { ReversePriorityOverlay }  from './components/layout/ReversePriorityOverlay';
import { useSystemStore }          from './store/useSystemStore';
import { startGeofenceService, stopGeofenceService } from './platform/security/geofenceService';
import { GeofenceAlarmOverlay }    from './components/security/GeofenceAlarmOverlay';
import { runtimeManager }          from './core/runtime/AdaptiveRuntimeManager';

const DebugPanel = lazy(() =>
  import('./components/debug/DebugPanel').then((m) => ({ default: m.DebugPanel })),
);

// Uygulama oturumu başına yalnızca bir kez sor (state değil module-level flag)
let _hotspotChecked = false;

function App() {
  const { i18n } = useTranslation();
  const language    = useStore((s) => s.settings.language);
  const hotspotMode = useStore((s) => s.settings.hotspotMode);
  const updateSettings = useStore((s) => s.updateSettings);
  const canDebug    = usePermission('canDebug');
  // R-7: VehicleDataLayer reverse sinyalini cameraService'e ilet (post-React yolu)
  const storeReverse = useSystemStore((s) => s.isReverseActive);

  const [debugOpen, setDebugOpen]         = useState(false);
  const [showHotspotPrompt, setShowPrompt] = useState(false);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language, i18n]);

  // Runtime Engine — crash recovery + ilk mod logu (tüm servislerden önce)
  useEffect(() => {
    runtimeManager.start();
  }, []);

  useEffect(() => {
    return startVehicleDataLayer();
  }, []);

  // SystemOrchestrator — VehicleDataLayer başladıktan sonra, aynı tick'te devreye girer
  useEffect(() => {
    return startSystemOrchestrator();
  }, []);

  // MaintenanceBrain — OBD verisi üzerinden sağlık skoru + yağ ömrü hesabı
  useEffect(() => {
    return startMaintenanceBrain();
  }, []);

  // BlackBox — 60s rolling buffer + darbe algılama kara kutusu
  useEffect(() => {
    return startBlackBox();
  }, []);

  // Smart Fuel Advisor — LOW_FUEL olayında yakın istasyon önerisi
  useEffect(() => {
    return startFuelAdvisor();
  }, []);

  // Theater Mode — araç 30s durduğunda medya odaklı mod önerisi
  useEffect(() => {
    return startTheaterService();
  }, []);

  // Push-to-Wake (S-2) — FCM token kaydı + CommandListener wake entegrasyonu
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void initPushService().then((fn) => { cleanup = fn; });
    return () => { cleanup?.(); };
  }, []);

  // R-7: Store → cameraService köprüsü (VehicleDataLayer kaynaklı sinyal)
  // main.tsx boot-path'in gözden kaçırdığı post-React reverse olaylarını iletir
  useEffect(() => {
    signalReverse(storeReverse);
  }, [storeReverse]);

  useEffect(() => {
    startSmartCardEngine();
    return () => { stopSmartCardEngine(); };
  }, []);

  // Geofence güvenlik servisi — araç bağlıysa Supabase'den zona çeker
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void startGeofenceService().then((fn) => { cleanup = fn; });
    return () => { cleanup ? cleanup() : stopGeofenceService(); };
  }, []);

  // Eagle Eye radar engine — starts community sync + loads Turkish static data
  useEffect(() => {
    startRadarEngine(turkiyeStaticRadars);
    return () => { stopRadarEngine(); };
  }, []);

  // GPS subscription + TTS voice alerts (must run at app root, not in FullMapView)
  useRadarSystem();

  /* ── Hotspot kontrolü — sadece native Android'de, oturum başına 1x ── */
  useEffect(() => {
    if (!isNative || _hotspotChecked || hotspotMode === 'off') return;
    _hotspotChecked = true;

    // Zaten bağlıysa hiçbir şey yapma
    if (isAlreadyConnected()) return;

    if (hotspotMode === 'auto') {
      // Kısa gecikme: uygulama UI'ı tam yüklendikten sonra aç
      const t = setTimeout(() => openHotspotSettings(), 1200);
      return () => clearTimeout(t);
    }

    if (hotspotMode === 'ask') {
      const t = setTimeout(() => setShowPrompt(true), 1500);
      return () => clearTimeout(t);
    }
  }, [hotspotMode]);

  function handleDebugTap() {
    if (!DEBUG_ENABLED || !canDebug) return;
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 3000);
    if (tapCountRef.current >= 5) {
      tapCountRef.current = 0;
      setDebugOpen(true);
    }
  }

  return (
    <LayoutProvider>
      {/* R-7: Sıfır gecikmeli geri vites overlay — z-9999, Zustand/Context bağımlı değil */}
      <ReversePriorityOverlay />
      <ErrorBoundary>
        {/* R-7: Geri vites aktifken MainLayout GPU bütçesini kameraya bırakır */}
        <div style={storeReverse ? { display: 'none' } : undefined}>
          <EditController>
            <MainLayout />
            <InAppBrowser />
          </EditController>
        </div>
        <ReverseOverlay />
        <GlobalAlert />
        <DisclaimerBanner />
        <RadarAlertHUD />
        <SentryOverlay />
        <GeofenceAlarmOverlay />

        {/* Hotspot bağlantı sorusu */}
        {showHotspotPrompt && (
          <HotspotPromptModal
            onDismiss={() => setShowPrompt(false)}
            onAutoEnable={() => {
              updateSettings({ hotspotMode: 'auto' });
              setShowPrompt(false);
            }}
          />
        )}

        {/* Hidden 5-tap debug trigger — top-right corner */}
        {DEBUG_ENABLED && canDebug && (
          <div
            onClick={handleDebugTap}
            className="fixed top-0 right-0 w-11 h-11 z-[9998]"
            aria-hidden="true"
          />
        )}

        {/* Debug panel — lazy mounted, only when open */}
        {debugOpen && DEBUG_ENABLED && canDebug && (
          <Suspense fallback={null}>
            <DebugPanel onClose={() => setDebugOpen(false)} />
          </Suspense>
        )}
      </ErrorBoundary>
    </LayoutProvider>
  );
}

export default App;
