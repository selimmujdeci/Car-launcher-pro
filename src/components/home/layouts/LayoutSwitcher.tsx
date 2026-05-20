import { useStore } from '../../../store/useStore';
import type { MusicOptionKey } from '../../../data/apps';
import { SportCockpit } from './SportCockpit';
import { LuxuryCockpit } from './LuxuryCockpit';
import { MinimalCockpit } from './MinimalCockpit';
import { ReplicationCockpit } from './ReplicationCockpit';

interface LayoutSwitcherProps {
  favorites: string[];
  recentApps: string[];
  onLaunch: (id: string) => void;
  use24Hour: boolean;
  showSeconds: boolean;
  defaultMusic: MusicOptionKey;
}

export function LayoutSwitcher(props: LayoutSwitcherProps) {
  const themePack = useStore(s => s.settings.themePack);

  // Tema Gruplandırması
  // Sport: bmw, porsche, redline, carbon, cyberpunk
  // Luxury: mercedes, audi, range-rover, glass-pro, ambient, sunset
  // Minimal: tesla, minimal-dark, minimal-light, monochrome, arctic
  // Replication: replication, pixel-perfect

  if (['replication', 'pixel-perfect'].includes(themePack)) {
    return <ReplicationCockpit key="replication" {...props} />;
  }

  if (['bmw', 'porsche', 'redline', 'carbon', 'cyberpunk', 'electric'].includes(themePack)) {
    return <SportCockpit key="sport" {...props} />;
  }

  if (['mercedes', 'audi', 'range-rover', 'glass-pro', 'ambient', 'sunset', 'galaxy'].includes(themePack)) {
    return <LuxuryCockpit key="luxury" {...props} />;
  }

  if (['tesla', 'minimal-dark', 'minimal-light', 'monochrome', 'arctic', 'tesla-x-night'].includes(themePack)) {
    return <MinimalCockpit key="minimal" {...props} />;
  }

  // Varsayılan
  return <SportCockpit key="default" {...props} />;
}



