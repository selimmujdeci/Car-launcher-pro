import { memo } from 'react';
import { DrawerShell } from './DrawerShell';
import { useTrafficState, TRAFFIC_COLORS } from '../../platform/trafficService';
import { AppGrid } from '../apps/AppGrid';
import { SettingsPage } from '../settings/SettingsPage';
import { DTCPanel } from '../obd/DTCPanel';
import { NotificationCenter } from '../notifications/NotificationCenter';
import { TripLogView } from '../trip/TripLogView';
import { WeatherWidget } from '../weather/WeatherWidget';
import { SportModePanel } from '../sport/SportModePanel';
import { SecuritySuite } from '../security/SecuritySuite';
import { EntertainmentPortal, BreakAlertOverlay } from '../entertainment/EntertainmentPortal';
import { DashcamView } from '../dashcam/DashcamView';
import { SplitScreen } from '../split/SplitScreen';
import { RearViewCamera } from '../camera/RearViewCamera';
import { FullMapView } from '../map/FullMapView';
import { PassengerQRModal } from '../modals/PassengerQRModal';
import type { AppItem } from '../../data/apps';
import type { DrawerType } from './DockBar';

interface Props {
  drawer:         DrawerType;
  onClose:        () => void;
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
}

const LEVEL_LABELS: Record<string, string> = {
  free: 'Akıcı', moderate: 'Orta', heavy: 'Yoğun', standstill: 'Tıkalı',
};

function TrafficPanel() {
  const traffic = useTrafficState();
  const s = traffic.summary;
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-white text-xl font-bold">Trafik Durumu</h2>
        <span className="text-[10px] text-amber-400/70 border border-amber-400/30 rounded px-2 py-0.5 uppercase tracking-widest font-bold">
          Simülasyon
        </span>
      </div>
      {!s ? (
        <p className="text-white/40 text-sm">Trafik verisi yükleniyor…</p>
      ) : (
        <>
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-white/5">
            <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: TRAFFIC_COLORS[s.level] }} />
            <div>
              <p className="text-white font-semibold text-lg">{LEVEL_LABELS[s.level] ?? s.level}</p>
              {s.delayMin > 0 && (
                <p className="text-white/50 text-sm">Tahmini gecikme: ~{s.delayMin} dk</p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {s.segments.map((seg, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03]">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: TRAFFIC_COLORS[seg.level] }} />
                <div className="flex-1 min-w-0">
                  <p className="text-white/80 text-sm font-medium truncate">{seg.label}</p>
                  <p className="text-white/40 text-xs truncate">{seg.direction}</p>
                </div>
                {seg.delayMin > 0 && (
                  <span className="text-white/50 text-xs flex-shrink-0">+{seg.delayMin} dk</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-white/25 text-xs text-center pt-2">
            Gerçek trafik verisi değildir — saat bazlı simülasyon
          </p>
        </>
      )}
    </div>
  );
}

export const DrawerPanel = memo(function DrawerPanel({
  drawer, onClose, allApps, favorites, gridColumns, onToggleFav, onLaunch,
  onOpenMap, splitOpen, onCloseSplit, rearCamOpen, onCloseRearCam,
  fullMapOpen, onCloseMap, passengerOpen, onClosePassenger,
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
        <SecuritySuite />
      </DrawerShell>

      <DrawerShell open={drawer === 'entertainment'} onClose={onClose}>
        <EntertainmentPortal />
      </DrawerShell>

      <DrawerShell open={drawer === 'traffic'} onClose={onClose}>
        <TrafficPanel />
      </DrawerShell>

      <BreakAlertOverlay />

      {splitOpen    && <SplitScreen onClose={onCloseSplit} />}
      {rearCamOpen  && <RearViewCamera onClose={onCloseRearCam} />}

      {drawer === 'dashcam' && (
        <div className="fixed inset-0 z-40 bg-[#060d1a]">
          <DashcamView onClose={onClose} />
        </div>
      )}

      {fullMapOpen   && <FullMapView onClose={onCloseMap} />}
      {passengerOpen && <PassengerQRModal onClose={onClosePassenger} />}
    </>
  );
});
