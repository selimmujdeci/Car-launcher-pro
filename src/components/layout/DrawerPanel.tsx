import { memo, lazy, Suspense } from 'react';
import { DrawerShell } from './DrawerShell';
import { TrafficPanel } from '../traffic/TrafficPanel';
import { AppGrid } from '../apps/AppGrid';
import { SettingsPage } from '../settings/SettingsPage';
import { DTCPanel } from '../obd/DTCPanel';
import { NotificationCenter } from '../notifications/NotificationCenter';
import { TripLogView } from '../trip/TripLogView';
import { WeatherWidget } from '../weather/WeatherWidget';
import { SportModePanel } from '../sport/SportModePanel';
import { MediaScreen } from '../media/MediaScreen';
import { PhoneScreen } from '../phone/PhoneScreen';
import type { AppItem, MusicOptionKey } from '../../data/apps';
import type { DrawerType } from './DockBar';

// Ağır paneller — ilk render'da yüklenmez, ilk açılışta indir
const SecuritySuite      = lazy(() => import('../security/SecuritySuite').then((m) => ({ default: m.SecuritySuite })));
const EntertainmentPortal = lazy(() => import('../entertainment/EntertainmentPortal').then((m) => ({ default: m.EntertainmentPortal })));
const BreakAlertOverlay   = lazy(() => import('../entertainment/EntertainmentPortal').then((m) => ({ default: m.BreakAlertOverlay })));
const DashcamView        = lazy(() => import('../dashcam/DashcamView').then((m) => ({ default: m.DashcamView })));
const SplitScreen        = lazy(() => import('../split/SplitScreen').then((m) => ({ default: m.SplitScreen })));
const RearViewCamera     = lazy(() => import('../camera/RearViewCamera').then((m) => ({ default: m.RearViewCamera })));
const FullMapView        = lazy(() => import('../map/FullMapView').then((m) => ({ default: m.FullMapView })));
const PassengerQRModal   = lazy(() => import('../modals/PassengerQRModal').then((m) => ({ default: m.PassengerQRModal })));

interface Props {
  drawer:         DrawerType;
  onClose:        () => void;
  defaultMusic:   MusicOptionKey;
  allApps:        AppItem[];
  favorites:      string[];
  gridColumns:    3 | 4 | 5;
  onToggleFav:    (id: string) => void;
  onLaunch:       (id: string) => void;
  onOpenMap:      () => void;
  splitOpen:      boolean;
  onCloseSplit:   () => void;
  rearCamOpen:    boolean;
  onCloseRearCam: () => void;
  fullMapOpen:    boolean;
  onCloseMap:     () => void;
  passengerOpen:  boolean;
  onClosePassenger: () => void;
  /** Navigasyon alt çubuğundan drawer açma — FullMapView'e iletilir */
  onOpenDrawerFromMap?: (type: 'music' | 'phone' | 'apps' | 'settings') => void;
}

export const DrawerPanel = memo(function DrawerPanel({
  drawer, onClose, defaultMusic, allApps, favorites, gridColumns, onToggleFav, onLaunch,
  onOpenMap, splitOpen, onCloseSplit, rearCamOpen, onCloseRearCam,
  fullMapOpen, onCloseMap, passengerOpen, onClosePassenger,
  onOpenDrawerFromMap,
}: Props) {
  return (
    <>
      <DrawerShell open={drawer === 'apps'} onClose={onClose}>
        <AppGrid apps={allApps} favorites={favorites} onToggleFavorite={onToggleFav} onLaunch={onLaunch} gridColumns={gridColumns} />
      </DrawerShell>

      <DrawerShell open={drawer === 'settings'} onClose={onClose}>
        <SettingsPage onClose={onClose} onOpenMap={() => { onClose(); onOpenMap(); }} />
      </DrawerShell>

      <DrawerShell open={drawer === 'dtc'} onClose={onClose}>
        <DTCPanel />
      </DrawerShell>

      <DrawerShell open={drawer === 'notifications'} onClose={onClose}>
        <NotificationCenter />
      </DrawerShell>

      <DrawerShell open={drawer === 'triplog'} onClose={onClose}>
        <TripLogView />
      </DrawerShell>

      <DrawerShell open={drawer === 'weather'} onClose={onClose}>
        <WeatherWidget />
      </DrawerShell>

      <DrawerShell open={drawer === 'sport'} onClose={onClose}>
        <SportModePanel />
      </DrawerShell>

      <DrawerShell open={drawer === 'security'} onClose={onClose}>
        <Suspense fallback={null}>
          <SecuritySuite />
        </Suspense>
      </DrawerShell>

      <DrawerShell open={drawer === 'entertainment'} onClose={onClose}>
        <Suspense fallback={null}>
          <EntertainmentPortal />
        </Suspense>
      </DrawerShell>

      <DrawerShell open={drawer === 'traffic'} onClose={onClose}>
        <TrafficPanel />
      </DrawerShell>

      <DrawerShell open={drawer === 'music'} onClose={onClose}>
        <MediaScreen defaultMusic={defaultMusic} />
      </DrawerShell>

      <DrawerShell open={drawer === 'phone'} onClose={onClose}>
        <PhoneScreen />
      </DrawerShell>

      <Suspense fallback={null}>
        <BreakAlertOverlay />
      </Suspense>

      {splitOpen && (
        <Suspense fallback={null}>
          <SplitScreen onClose={onCloseSplit} />
        </Suspense>
      )}
      {rearCamOpen && (
        <Suspense fallback={null}>
          <RearViewCamera onClose={onCloseRearCam} />
        </Suspense>
      )}

      {drawer === 'dashcam' && (
        <div className="fixed inset-4 bottom-20 top-10 z-[1000] rounded-[32px] overflow-hidden glass-card">
          <Suspense fallback={null}>
            <DashcamView onClose={onClose} />
          </Suspense>
        </div>
      )}

      {fullMapOpen && (
        <Suspense fallback={null}>
          <FullMapView
            onClose={onCloseMap}
            onOpenDrawer={onOpenDrawerFromMap}
          />
        </Suspense>
      )}
      {passengerOpen && (
        <Suspense fallback={null}>
          <PassengerQRModal onClose={onClosePassenger} />
        </Suspense>
      )}
    </>
  );
});


