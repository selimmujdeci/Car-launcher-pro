import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore }           from './store/useStore';
import MainLayout             from './components/layout/MainLayout';
import { ErrorBoundary }      from './components/ErrorBoundary';
import { InAppBrowser }       from './components/common/InAppBrowser';
import { EditController }     from './components/edit/EditController';
import { LayoutProvider }     from './context/LayoutContext';
import { ReverseOverlay }     from './components/camera/ReverseOverlay';
import { DisclaimerBanner }   from './components/legal/DisclaimerBanner';
import { usePermission }      from './platform/roleSystem';
import { DEBUG_ENABLED }      from './platform/debug';
import { HotspotPromptModal } from './components/modals/HotspotPromptModal';
import { isAlreadyConnected, openHotspotSettings } from './platform/tetherService';
import { isNative }           from './platform/bridge';
import { useRadarSystem }     from './hooks/useRadarSystem';
import { RadarAlertHUD }      from './components/layout/RadarAlertHUD';
import { SentryOverlay }      from './components/security/SentryOverlay';
import { GlobalAlert }        from './components/common/GlobalAlert';
import { signalReverse }      from './platform/cameraService';
import { ReversePriorityOverlay } from './components/layout/ReversePriorityOverlay';
import { useSystemStore }     from './store/useSystemStore';
import { GeofenceAlarmOverlay } from './components/security/GeofenceAlarmOverlay';
import { systemBoot }         from './platform/system/SystemBoot';

const DebugPanel = lazy(() =>
  import('./components/debug/DebugPanel').then((m) => ({ default: m.DebugPanel })),
);

// Uygulama oturumu başına yalnızca bir kez sor (state değil module-level flag)
let _hotspotChecked = false;

function App() {
  const { i18n }        = useTranslation();
  const language        = useStore((s) => s.settings.language);
  const hotspotMode     = useStore((s) => s.settings.hotspotMode);
  const updateSettings  = useStore((s) => s.updateSettings);
  const canDebug        = usePermission('canDebug');
  const storeReverse    = useSystemStore((s) => s.isReverseActive);

  const [debugOpen,        setDebugOpen]  = useState(false);
  const [showHotspotPrompt, setShowPrompt] = useState(false);

  // ── Portrait mod tespiti — araç ekranları her zaman yatay ────────────────
  const [isPortrait, setIsPortrait] = useState(() => window.innerHeight > window.innerWidth);
  useEffect(() => {
    const check = () => setIsPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Dil değişimi ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (i18n.language !== language) i18n.changeLanguage(language);
  }, [language, i18n]);

  // ── SystemBoot: tüm servisleri dalgalar halinde başlat ────────────────────
  // Wave 1 (Core) → Wave 2 (Backbone) → Wave 3 (Intelligence) → Wave 4 (UI)
  // Her dalga bir sonrakinin tamamlanmasını bekler; stop() LIFO sırasıyla temizler.
  useEffect(() => {
    void systemBoot.start();
    return () => systemBoot.stop();
  }, []);

  // ── R-7: Store → cameraService köprüsü ───────────────────────────────────
  // VehicleDataLayer kaynaklı reverse sinyalini cameraService'e ilet
  useEffect(() => {
    signalReverse(storeReverse);
  }, [storeReverse]);

  // ── GPS radar sistemi (hook — React bileşen içinde kalmalı) ───────────────
  useRadarSystem();

  // ── Hotspot kontrolü — sadece native Android, oturum başına 1x ───────────
  useEffect(() => {
    if (!isNative || _hotspotChecked || hotspotMode === 'off') return;
    _hotspotChecked = true;

    if (isAlreadyConnected()) return;

    if (hotspotMode === 'auto') {
      const t = setTimeout(() => openHotspotSettings(), 1200);
      return () => clearTimeout(t);
    }

    if (hotspotMode === 'ask') {
      const t = setTimeout(() => setShowPrompt(true), 1500);
      return () => clearTimeout(t);
    }
  }, [hotspotMode]);

  // ── 5-parmak debug tetikleyici ─────────────────────────────────────────────
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
        {/* R-7: Geri vites aktifken MainLayout GPU bütçesini kameraya bırakır */}
        <div style={storeReverse ? { display: 'none' } : undefined}>
          <EditController>
            <MainLayout />
            <InAppBrowser />
          </EditController>
        </div>
        <ReverseOverlay />

        {/*
         * ── Z-Index Hiyerarşi Kuralı ─────────────────────────────────────────
         * ReversePriorityOverlay: z-[100000] — mutlak zirve, hiçbir şey binemez.
         * Tüm global alert/modal/bildirimler geri vites aktifken programatik
         * olarak bastırılır (conditional render). Kamera görüntüsü kesinlikle
         * temiz kalır — CLAUDE.md §Safety First.
         */}
        {!storeReverse && <GlobalAlert />}
        {!storeReverse && <DisclaimerBanner />}
        {!storeReverse && <RadarAlertHUD />}
        {!storeReverse && <SentryOverlay />}
        {!storeReverse && <GeofenceAlarmOverlay />}

        {/* Portrait mod uyarısı — geri vites aktifken gösterme */}
        {isPortrait && !storeReverse && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 99999,
            background: 'rgba(5,10,20,0.97)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: '1.5rem', color: '#fff', fontFamily: 'system-ui,sans-serif',
          }}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="7" y="2" width="10" height="18" rx="2"/>
              <path d="M12 18v.01"/>
              <path d="M5 8l-2 2 2 2" opacity="0.5"/>
              <path d="M19 8l2 2-2 2" opacity="0.5"/>
              <path d="M3 10h4M17 10h4" opacity="0.5"/>
            </svg>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                Telefonu Yatay Tutun
              </div>
              <div style={{ fontSize: '0.8rem', opacity: 0.5, maxWidth: 200 }}>
                CockpitOS araç ekranı için tasarlanmıştır
              </div>
            </div>
          </div>
        )}

        {showHotspotPrompt && !storeReverse && (
          <HotspotPromptModal
            onDismiss={() => setShowPrompt(false)}
            onAutoEnable={() => {
              updateSettings({ hotspotMode: 'auto' });
              setShowPrompt(false);
            }}
          />
        )}

        {DEBUG_ENABLED && canDebug && (
          <div
            onClick={handleDebugTap}
            className="fixed top-0 right-0 w-11 h-11 z-[9998]"
            aria-hidden="true"
          />
        )}

        {debugOpen && DEBUG_ENABLED && canDebug && (
          <Suspense fallback={null}>
            <DebugPanel onClose={() => setDebugOpen(false)} />
          </Suspense>
        )}
      </ErrorBoundary>

      {/*
       * ── Mutlak Zirve: Geri Vites Kamerası ───────────────────────────────
       * z-[100000] → kendi yalıtılmış stacking context'i oluşturur.
       * ErrorBoundary dışında: hata durumunda bile kamera görüntüsü çalışır.
       * pointer-events-none wrapper → kamera dışı alanda yanlışlıkla dokunma engeli.
       */}
      <div className="fixed inset-0 z-[100000] pointer-events-none">
        <div className="pointer-events-none size-full">
          <ReversePriorityOverlay />
        </div>
      </div>
    </LayoutProvider>
  );
}

export default App;
