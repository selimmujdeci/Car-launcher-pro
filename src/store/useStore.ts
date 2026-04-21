import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MusicOptionKey } from '../data/apps';
import { setObdVehicleType } from '../platform/obdService';
import { safeStorage } from '../utils/safeStorage';

/**
 * Shallow merge helper — plain objeleri recursive merge eder.
 * Yeni eklenen alan varsayılan değerini korur, eski persist verisi üzerine yazar.
 * Array'ler ve primitive'ler persisted değeri (varsa) tutar.
 */
function deepMergeSettings<T extends Record<string, unknown>>(defaults: T, persisted: Partial<T>): T {
  const result = { ...defaults };
  for (const key in persisted) {
    const d = defaults[key];
    const p = persisted[key];
    if (p !== undefined && d !== null && typeof d === 'object' && !Array.isArray(d) &&
        p !== null && typeof p === 'object' && !Array.isArray(p)) {
      (result as Record<string, unknown>)[key] = deepMergeSettings(
        d as Record<string, unknown>,
        p as Record<string, unknown>,
      );
    } else if (p !== undefined) {
      (result as Record<string, unknown>)[key] = p;
    }
  }
  return result;
}


export type ThemeStyle = 'glass' | 'neon' | 'minimal';
export type WidgetStyle = 'elevated' | 'flat' | 'outlined';
export type ThemePack = 'tesla' | 'bmw' | 'mercedes' | 'audi' | 'glass-pro';
export type ClockStyle = 'digital' | 'analog';
export type VolumeStyle = 'bmw_polished' | 'tesla_ultra' | 'glass_orb' | 'ambient_line' | 'minimal_pro';
export type GestureVolumeSide = 'left' | 'right' | 'off';
export type UnitSystem = 'metric' | 'imperial';

export interface MaintenanceInfo {
  lastOilChangeKm: number;
  nextOilChangeKm: number;
  lastServiceDate: string;
  fuelConsumptionAvg: number;
  currentKm: number;
  inspectionDate: string;
  insuranceExpiry: string;
  kaskoExpiry: string;
}

export interface TireData {
  pressure: number;
  temp: number;
  status: 'normal' | 'low' | 'high';
}

export interface TPMSData {
  fl: TireData; fr: TireData; rl: TireData; rr: TireData;
}

export interface ParkingLocation {
  lat: number; lng: number; timestamp: number; address?: string;
}

export interface PinnedCard {
  uid: string; type: 'app' | 'tool'; id: string; label: string; icon: string; color?: string;
}

export type VehicleType = 'ice' | 'diesel' | 'ev' | 'hybrid' | 'phev';

export interface VehicleProfile {
  id: string;
  name: string;
  vehicleType?: VehicleType;
  fuelTankL?: number;
  batteryCapacityKwh?: number;
  engineCapacityL?: number;
  motorPowerKw?: number;
  vehicleMassKg?: number;
  maxSpeedKmh?: number;
  maxRpm?: number;
  btDeviceName?: string;
  wifiSSID?: string;
  obdDeviceAddress?: string;
  obdDeviceName?: string;
  avgConsumptionL100?: number;
  themePack?: ThemePack;
  defaultNav?: string;
  defaultMusic?: MusicOptionKey;
  dockAppIds?: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AppSettings {
  language: string;
  unitSystem: UnitSystem;
  brightness: number;
  volume: number;
  volumeStyle: VolumeStyle;
  theme: 'dark' | 'oled' | 'light';
  themePack: ThemePack;
  themeStyle: ThemeStyle;
  widgetStyle: WidgetStyle;
  wallpaper: string;
  hiddenApps: string[];
  appOrder: string[];
  folders: Record<string, { name: string; icon: string; appIds: string[] }>;
  use24Hour: boolean;
  showSeconds: boolean;
  clockStyle: ClockStyle;
  gridColumns: number;
  defaultNav: string;
  defaultMusic: MusicOptionKey;
  sleepMode: boolean;
  offlineMap: boolean;
  widgetVisible: Record<string, boolean>;
  widgetOrder: string[];
  widgetSizes: Record<string, 'small' | 'medium' | 'large'>;
  activeMapSourceId: string | null;
  hasCompletedSetup: boolean;
  performanceMode: boolean;
  maintenance: MaintenanceInfo;
  tpms: TPMSData;
  parkingLocation: ParkingLocation | null;
  wakeWordEnabled: boolean;
  wakeWord: string;
  breakReminderEnabled: boolean;
  breakReminderIntervalMin: number;
  autoBrightnessEnabled: boolean;
  autoThemeEnabled: boolean;
  autoBrightnessMin: number;
  autoBrightnessMax: number;
  gestureVolumeSide: GestureVolumeSide;
  homeLocation: { lat: number; lng: number; name: string } | null;
  workLocation: { lat: number; lng: number; name: string } | null;
  recentDestinations: { lat: number; lng: number; name: string; timestamp: number }[];
  smartContextEnabled: boolean;
  pinnedCards: PinnedCard[];
  dayNightMode: 'day' | 'night';
  editMode: boolean;
  obdAutoSleep: boolean;
  obdSleepDelayMin: number;
  weatherFallbackCity: { lat: number; lng: number; name: string } | null;
  vehicleProfiles: VehicleProfile[];
  activeVehicleProfileId: string | null;
  autoNavOnStart: boolean;
  activeMediaSourceKey: string;
  musicFavorites: MusicFavorite[];
  aiVoiceProvider: 'gemini' | 'haiku' | 'none';
  geminiApiKey: string;
  claudeHaikuApiKey: string;
}

export interface MusicFavorite {
  title: string; artist: string; albumArt?: string; source: string; addedAt: number;
}

interface StoreState {
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  updateMaintenance: (partial: Partial<MaintenanceInfo>) => void;
  updateTPMS: (partial: Partial<TPMSData>) => void;
  updateParking: (location: ParkingLocation | null) => void;
  resetSettings: () => void;
  addVehicleProfile: (profile: VehicleProfile) => void;
  updateVehicleProfile: (id: string, partial: Partial<VehicleProfile>) => void;
  removeVehicleProfile: (id: string) => void;
  setActiveVehicleProfile: (id: string | null) => void;
  addMusicFavorite: (fav: MusicFavorite) => void;
  removeMusicFavorite: (title: string, artist: string) => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  language: 'tr',
  unitSystem: 'metric',
  brightness: 100,
  volume: 60,
  volumeStyle: 'minimal_pro',
  theme: 'light',
  themePack: 'glass-pro',
  themeStyle: 'glass',
  widgetStyle: 'elevated',
  wallpaper: 'none',
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
  widgetVisible: { nav: true, media: true, shortcuts: true, obd: true },
  widgetOrder: ['nav', 'speed', 'media'],
  widgetSizes: { media: 'medium', shortcuts: 'small' },
  activeMapSourceId: null,
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
  autoThemeEnabled: true,
  autoBrightnessMin: 15,
  autoBrightnessMax: 100,
  gestureVolumeSide: 'left',
  homeLocation: null,
  workLocation: null,
  recentDestinations: [],
  smartContextEnabled: false,
  pinnedCards: [],
  dayNightMode: 'day',
  editMode: false,
  obdAutoSleep: false,
  obdSleepDelayMin: 5,
  weatherFallbackCity: null,
  vehicleProfiles: [],
  activeVehicleProfileId: null,
  autoNavOnStart: false,
  activeMediaSourceKey: 'spotify',
  musicFavorites: [],
  aiVoiceProvider: 'gemini',
  geminiApiKey: '',
  claudeHaikuApiKey: '',
};

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      updateSettings: (partial) =>
        set((state) => ({ settings: { ...state.settings, ...partial } })),
      updateMaintenance: (partial) =>
        set((state) => ({ settings: { ...state.settings, maintenance: { ...state.settings.maintenance, ...partial } } })),
      updateTPMS: (partial) =>
        set((state) => ({ settings: { ...state.settings, tpms: { ...state.settings.tpms, ...partial } } })),
      updateParking: (location) =>
        set((state) => ({ settings: { ...state.settings, parkingLocation: location } })),
      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
      addVehicleProfile: (profile) =>
        set((state) => ({ settings: { ...state.settings, vehicleProfiles: [...state.settings.vehicleProfiles, profile] } })),
      updateVehicleProfile: (id, partial) =>
        set((state) => ({ settings: { ...state.settings, vehicleProfiles: state.settings.vehicleProfiles.map((p) => p.id === id ? { ...p, ...partial } : p) } })),
      removeVehicleProfile: (id) =>
        set((state) => ({
          settings: {
            ...state.settings,
            vehicleProfiles: state.settings.vehicleProfiles.filter((p) => p.id !== id),
            activeVehicleProfileId: state.settings.activeVehicleProfileId === id ? null : state.settings.activeVehicleProfileId,
          }
        })),
      setActiveVehicleProfile: (id) =>
        set((state) => {
          if (id !== null) {
            const profile = state.settings.vehicleProfiles.find((p) => p.id === id);
            if (profile?.vehicleType) setObdVehicleType(profile.vehicleType);
          }
          return { settings: { ...state.settings, activeVehicleProfileId: id } };
        }),
      addMusicFavorite: (fav) =>
        set((state) => {
          const exists = state.settings.musicFavorites.some((f) => f.title === fav.title && f.artist === fav.artist);
          if (exists) return state;
          return { settings: { ...state.settings, musicFavorites: [fav, ...state.settings.musicFavorites].slice(0, 100) } };
        }),
      removeMusicFavorite: (title, artist) =>
        set((state) => ({ settings: { ...state.settings, musicFavorites: state.settings.musicFavorites.filter((f) => !(f.title === title && f.artist === artist)) } })),
    }),
    {
      name: 'car-launcher-storage',
      storage: createJSONStorage(() => safeStorage),
      version: 9,
      migrate: (persistedState: unknown, fromVersion: number) => {
        const ps = (persistedState as { settings?: Partial<AppSettings> }) ?? {};
        const settings: AppSettings = { ...DEFAULT_SETTINGS, ...(ps.settings ?? {}) };
        if (fromVersion < 9) {
          settings.language = settings.language ?? 'tr';
          settings.unitSystem = settings.unitSystem ?? 'metric';
        }
        return { ...ps, settings };
      },
      merge: (persistedState: unknown, currentState) => {
        const ps = persistedState as Partial<typeof currentState> | null | undefined;
        if (!ps) return currentState;
        const merged = deepMergeSettings(currentState.settings as unknown as Record<string, unknown>, (ps.settings || {}) as Record<string, unknown>) as unknown as typeof currentState.settings;
        merged.sleepMode = false;
        merged.editMode = false;
        return { ...currentState, ...ps, settings: merged };
      },
    }
  )
);
