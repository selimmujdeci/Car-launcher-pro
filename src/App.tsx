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

  const [debugOpen, setDebugOpen]         = useState(false);
  const [showHotspotPrompt, setShowPrompt] = useState(false);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language, i18n]);

  useEffect(() => {
    return startVehicleDataLayer();
  }, []);

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
      <ErrorBoundary>
        <EditController>
          <MainLayout />
          <InAppBrowser />
        </EditController>
        <ReverseOverlay />
        <DisclaimerBanner />

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
