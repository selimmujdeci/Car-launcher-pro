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

const DebugPanel = lazy(() =>
  import('./components/debug/DebugPanel').then((m) => ({ default: m.DebugPanel })),
);

function App() {
  const { i18n } = useTranslation();
  const language = useStore((s) => s.settings.language);
  const canDebug = usePermission('canDebug');

  const [debugOpen, setDebugOpen] = useState(false);
  const tapCountRef  = useRef(0);
  const tapTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language, i18n]);

  useEffect(() => {
    return startVehicleDataLayer();
  }, []);

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
