import { memo } from 'react';
import type { ThemePack } from '../../store/useStore';
import { TeslaLayout } from '../themes/TeslaLayout';
import { AudiLayout } from '../themes/AudiLayout';
import { MercedesLayout } from '../themes/MercedesLayout';
import { CockpitLayout } from '../themes/CockpitLayout';
import { ProLayout } from '../themes/ProLayout';
import type { AppItem } from '../../data/apps';
import type { SmartSnapshot } from '../../platform/smartEngine';

interface Props {
  themePack:      ThemePack;
  onOpenMap:      () => void;
  onOpenApps:     () => void;
  onOpenSettings: () => void;
  onLaunch:       (id: string) => void;
  appMap:         Record<string, AppItem>;
  dockIds:        string[];
  fullMapOpen?:   boolean;
  onOpenRearCam?: () => void;
  onOpenDashcam?: () => void;
  smart?:         SmartSnapshot;
}

const MAP_FOCUS_PACKS: ThemePack[]  = ['tesla'];
const COCKPIT_PACKS: ThemePack[]    = ['bmw'];
const BALANCED_PACKS: ThemePack[]   = ['mercedes', 'glass-pro'];
const SPORT_PACKS: ThemePack[]      = ['audi'];

export const ThemeLayoutRenderer = memo(function ThemeLayoutRenderer(props: Props) {
  const { themePack } = props;

  if (MAP_FOCUS_PACKS.includes(themePack)) {
    return <TeslaLayout {...props} />;
  }
  if (COCKPIT_PACKS.includes(themePack)) {
    return <CockpitLayout {...props} />;
  }
  if (BALANCED_PACKS.includes(themePack)) {
    if (themePack === 'mercedes') return <MercedesLayout {...props} />;
    return <ProLayout {...props} />;
  }
  if (SPORT_PACKS.includes(themePack)) {
    return <AudiLayout {...props} />;
  }

  // Fallback
  return <ProLayout {...props} />;
});
