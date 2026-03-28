import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeStyle = 'glass' | 'neon' | 'minimal';
export type WidgetStyle = 'elevated' | 'flat' | 'outlined';
export type ThemePack = 
  | 'tesla' | 'bmw' | 'mercedes' | 'audi' | 'porsche' 
  | 'range-rover' | 'cyberpunk' | 'midnight' | 'glass-pro' | 'ambient' 
  | 'redline' | 'electric' | 'carbon' | 'minimal-dark' | 'minimal-light' 
  | 'monochrome' | 'sunset' | 'night-city' | 'arctic' | 'galaxy';
export type ClockStyle = 'digital' | 'analog';
export type VolumeStyle = 'bmw_polished' | 'tesla_ultra' | 'glass_orb' | 'ambient_line' | 'minimal_pro';
export type GestureVolumeSide = 'left' | 'right' | 'off';

export interface MaintenanceInfo {
  lastOilChangeKm: number;
  nextOilChangeKm: number;
  lastServiceDate: string;
  fuelConsumptionAvg: number;
  /** Güncel kilometre (kullanıcı girişi) */
  currentKm: number;
  /** Sonraki araç muayene tarihi (YYYY-MM-DD) */
  inspectionDate: string;
  /** Trafik sigortası bitiş tarihi (YYYY-MM-DD) */
  insuranceExpiry: string;
  /** Kasko bitiş tarihi (YYYY-MM-DD) */
  kaskoExpiry: string;
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
  volumeStyle: VolumeStyle;
  theme: 'dark' | 'oled';
  themePack: ThemePack;
  themeStyle: ThemeStyle;
  widgetStyle: WidgetStyle;
  wallpaper: string;
  favorites: string[];
  hiddenApps: string[];
  appOrder: string[];
  folders: Record<string, { name: string; icon: string; appIds: string[] }>;
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
  hasCompletedSetup: boolean;
  performanceMode: boolean;
  maintenance: MaintenanceInfo;
  tpms: TPMSData;
  parkingLocation: ParkingLocation | null;
  /** Sesli asistan uyandırma kelimesi */
  wakeWordEnabled: boolean;
  wakeWord: string;
  /** Mola hatırlatıcı */
  breakReminderEnabled: boolean;
  breakReminderIntervalMin: number;
  /** Otomatik parlaklık (gün/gece) */
  autoBrightnessEnabled: boolean;
  autoThemeEnabled: boolean;
  autoBrightnessMin: number;
  autoBrightnessMax: number;
  /** Kenar swipe ile ses kontrolü tarafı */
  gestureVolumeSide: GestureVolumeSide;
  /** Navigasyon hızlı hedefleri */
  homeLocation: { lat: number; lng: number; name: string } | null;
  workLocation: { lat: number; lng: number; name: string } | null;
  recentDestinations: { lat: number; lng: number; name: string; timestamp: number }[];
  /** Bağlam-farkındı akıllı launcher davranışları */
  smartContextEnabled: boolean;
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
  volumeStyle: 'minimal_pro',
  theme: 'dark',
  themePack: 'tesla',
  themeStyle: 'glass',
  widgetStyle: 'elevated',
  wallpaper: 'none',
  favorites: [],
  hiddenApps: [],
  appOrder: [],
  folders: {},
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
  hasCompletedSetup: false,
  performanceMode: false,
  maintenance: {
    lastOilChangeKm: 0,
    nextOilChangeKm: 10000,
    lastServiceDate: new Date().toISOString().split('T')[0],
    fuelConsumptionAvg: 8.5,
    currentKm: 0,
    inspectionDate: '',
    insuranceExpiry: '',
    kaskoExpiry: '',
  },
  tpms: {
    fl: { pressure: 32, temp: 24, status: 'normal' },
    fr: { pressure: 32, temp: 24, status: 'normal' },
    rl: { pressure: 31, temp: 25, status: 'normal' },
    rr: { pressure: 31, temp: 25, status: 'normal' },
  },
  parkingLocation: null,
  wakeWordEnabled: false,
  wakeWord: 'hey car',
  breakReminderEnabled: false,
  breakReminderIntervalMin: 120,
  autoBrightnessEnabled: false,
  autoThemeEnabled: false,
  autoBrightnessMin: 15,
  autoBrightnessMax: 100,
  gestureVolumeSide: 'left',
  homeLocation: null,
  workLocation: null,
  recentDestinations: [],
  smartContextEnabled: true,
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
            hasCompletedSetup: ps.settings?.hasCompletedSetup ?? currentState.settings.hasCompletedSetup,
            performanceMode: ps.settings?.performanceMode ?? currentState.settings.performanceMode,
          }
        };
      },
    }
  )
);
