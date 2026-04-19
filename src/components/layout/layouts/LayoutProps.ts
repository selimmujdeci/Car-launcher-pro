import type { AppSettings } from '../../../store/useStore';
import type { SmartSnapshot } from '../../../platform/smartEngine';
import type { AppItem } from '../../../data/apps';

export interface LayoutProps {
  settings: AppSettings;
  smart: SmartSnapshot;
  appMap: Record<string, AppItem>;
  handleLaunch: (id: string) => void;
  setFullMapOpen: (open: boolean) => void;
  /** FullMapView açıkken MiniMapWidget'ı unmount etmek için kullanılır */
  fullMapOpen: boolean;
  updateSettings: (partial: Partial<AppSettings>) => void;
  dragId: string | null;
  dropId: string | null;
  handleDragStart: (id: string) => void;
  handleDragOver: (id: string) => void;
  handleDrop: () => void;
}
