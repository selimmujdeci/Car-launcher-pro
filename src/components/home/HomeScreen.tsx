import { useState, useEffect, memo } from 'react';
import { LayoutSwitcher } from './layouts/LayoutSwitcher';
import { registerCommandHandler } from '../../platform/voiceService';
import type { ParsedCommand } from '../../platform/commandParser';
import { startNavigation } from '../../platform/navigationService';
import { getFavoriteAddresses } from '../../platform/addressBookService';
import { FullMapView } from '../map/FullMapView';
import { VehicleReminderModal } from '../modals/VehicleReminderModal';

/* ── Ana bileşen ─────────────────────────────────────────── */
interface Props {
  favorites: string[];
  recentApps: string[];
  onLaunch: (id: string) => void;
  use24Hour: boolean;
  showSeconds: boolean;
  defaultMusic: import('../../data/apps').MusicOptionKey;
}

function HomeScreen(props: Props) {
  const [fullMapOpen, setFullMapOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);

  useEffect(() => {
    const cleanup = registerCommandHandler((cmd: ParsedCommand) => {
      if (cmd.type === 'navigate_home') {
        const homeAddress = getFavoriteAddresses().find((a) => a.category === 'home');
        if (homeAddress) {
          startNavigation(homeAddress);
          setFullMapOpen(true);
        }
      }
      if (cmd.type === 'vehicle_maintenance') {
        setReminderOpen(true);
      }
    });
    return cleanup;
  }, []);

  return (
    <div className="h-full w-full overflow-hidden bg-transparent">
      {/* 
          Tema değişiminde LayoutSwitcher içindeki 'key' değiştiği için 
          tüm UI sıfırdan mount olur. Bu gerçek "yeni uygulama" hissi sağlar.
      */}
      <LayoutSwitcher {...props} />

      {fullMapOpen && <FullMapView onClose={() => setFullMapOpen(false)} />}
      {reminderOpen && <VehicleReminderModal onClose={() => setReminderOpen(false)} />}
    </div>
  );
}

export default memo(HomeScreen);


