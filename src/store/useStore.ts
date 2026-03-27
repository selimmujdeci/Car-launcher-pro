import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeStyle = 'glass' | 'neon' | 'minimal';
export type WidgetStyle = 'elevated' | 'flat' | 'outlined';
export type ThemePack = 'tesla' | 'big-cards' | 'ai-center' | 'bmw' | 'mercedes';
export type ClockStyle = 'digital' | 'analog';

export interface MaintenanceInfo {
  lastOilChangeKm: number;
  nextOilChangeKm: number;
  lastServiceDate: string;
  fuelConsumptionAvg: number;
}

export interface TireData {
  pressure: number;
  temp: number;
  status: 'normal' | 'low' | 'high';
}

export interface TPMSData {
  fl: TireData;
  fr: TireData;
  rl: TireData;
  rr: TireData;
}

export interface ParkingLocation {
  lat: number;
  lng: number;
  timestamp: number;
  address?: string;
}

export interface AppSettings {
  brightness: number;
  volume: number;
  theme: 'dark' | 'oled';
  themePack: ThemePack;
  themeStyle: ThemeStyle;
  widgetStyle: WidgetStyle;
  wallpaper: string;
  use24Hour: boolean;
  showSeconds: boolean;
  clockStyle: ClockStyle;
  gridColumns: number;
  defaultNav: string;
  defaultMusic: string;
  sleepMode: boolean;
  offlineMap: boolean;
  editMode: boolean;
  widgetVisible: Record<string, boolean>;
  /** Sağ panel alt satır widget sırası: ['music', 'notifications'] */
  widgetOrder: string[];
  maintenance: MaintenanceInfo;
  tpms: TPMSData;
  parkingLocation: ParkingLocation | null;
}

interface StoreState {
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  updateMaintenance: (partial: Partial<MaintenanceInfo>) => void;
  updateTPMS: (partial: Partial<TPMSData>) => void;
  updateParking: (location: ParkingLocation | null) => void;
  resetSettings: () => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  brightness: 100,
  volume: 60,
  theme: 'dark',
  themePack: 'tesla',
  themeStyle: 'glass',
  widgetStyle: 'elevated',
  wallpaper: 'none',
  use24Hour: true,
  showSeconds: false,
  clockStyle: 'digital',
  gridColumns: 3,
  defaultNav: 'maps',
  defaultMusic: 'spotify',
  sleepMode: false,
  offlineMap: true,
  editMode: false,
  widgetVisible: {
    nav: true,
    media: true,
    shortcuts: true,
    obd: true,
  },
  widgetOrder: ['music', 'notifications'],
  maintenance: {
    lastOilChangeKm: 0,
    nextOilChangeKm: 10000,
    lastServiceDate: new Date().toISOString().split('T')[0],
    fuelConsumptionAvg: 8.5,
  },
  tpms: {
    fl: { pressure: 32, temp: 24, status: 'normal' },
    fr: { pressure: 32, temp: 24, status: 'normal' },
    rl: { pressure: 31, temp: 25, status: 'normal' },
    rr: { pressure: 31, temp: 25, status: 'normal' },
  },
  parkingLocation: null,
};

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      updateSettings: (partial) =>
        set((state) => ({
          settings: { ...state.settings, ...partial },
        })),
      updateMaintenance: (partial) =>
        set((state) => ({
          settings: {
            ...state.settings,
            maintenance: { ...state.settings.maintenance, ...partial },
          },
        })),
      updateTPMS: (partial) =>
        set((state) => ({
          settings: {
            ...state.settings,
            tpms: { ...state.settings.tpms, ...partial },
          },
        })),
      updateParking: (location) =>
        set((state) => ({
          settings: { ...state.settings, parkingLocation: location },
        })),
      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    {
      name: 'car-launcher-storage',
      // Ensure new default fields are merged into existing persisted storage
      merge: (persistedState: unknown, currentState) => {
        const ps = persistedState as Partial<typeof currentState> | null | undefined;
        if (!ps) return currentState;
        return {
          ...currentState,
          ...ps,
          settings: {
            ...currentState.settings,
            ...(ps.settings || {}),
            // Explicitly merge objects that might be missing in older versions
            maintenance: {
              ...currentState.settings.maintenance,
              ...(ps.settings?.maintenance || {}),
            },
            tpms: {
              ...currentState.settings.tpms,
              ...(ps.settings?.tpms || {}),
            },
            widgetVisible: {
              ...currentState.settings.widgetVisible,
              ...(ps.settings?.widgetVisible || {}),
            },
            widgetOrder: ps.settings?.widgetOrder ?? currentState.settings.widgetOrder,
          }
        };
      },
    }
  )
);
