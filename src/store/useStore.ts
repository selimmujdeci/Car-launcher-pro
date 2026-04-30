import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MusicOptionKey } from '../data/apps';
import type { RuntimeOverride } from '../core/runtime/runtimeTypes';
import { RuntimeMode }           from '../core/runtime/runtimeTypes';
import { runtimeManager }        from '../core/runtime/AdaptiveRuntimeManager';
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


/* ── SmartCard (runtime, persist edilmez) ──────────────────── */

export interface SmartCard {
  id:       string;
  kind:     string;
  title:    string;
  subtitle: string;
  color:    string;   // hex renk
  priority: number;   // 0–100
  eta?:     string;   // "~12 dk"
  badge?:   string;   // "ACİL" | "%12" vb.
  cta:      string;   // CTA buton etiketi
  action:
    | { type: 'navigate';    destination: string }
    | { type: 'launch';      appId: string }
    | { type: 'open-drawer'; drawer: string }
    | { type: 'search-poi';  query: string };
}

export type ThemeStyle = 'glass' | 'neon' | 'minimal';
export type WidgetStyle = 'elevated' | 'flat' | 'outlined';
export type ThemePack = 'tesla' | 'bmw' | 'mercedes' | 'audi' | 'glass-pro' | 'oled-pro';
export type ClockStyle = 'digital' | 'analog';
export type VolumeStyle = 'bmw_polished' | 'tesla_ultra' | 'glass_orb' | 'ambient_line' | 'minimal_pro';
export type GestureVolumeSide = 'left' | 'right' | 'off';
export type UnitSystem = 'metric' | 'imperial';

export interface MaintenanceInfo {
  lastOilChangeKm: number;
  nextOilChangeKm: number;
  lastServiceDate: string;
  fuelConsumptionAvg: number;
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

export type OilType = 'conventional' | 'synthetic' | 'long-life';

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
  /** Araç boşta devir sayısı (rpm) — varsayılan 700 */
  idleRpm?: number;
  /** Motor normal çalışma sıcaklığı (°C) — varsayılan 90 */
  normalTemp?: number;
  /** Kullanılan yağ tipi — yağ ömrü hesabını etkiler */
  oilType?: OilType;
  /** İkinci el araç için başlangıç aşınma oranı (0–1); 0 = sıfır km */
  initialWearOffset?: number;
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
  /** Araç başlangıcında telefon hotspot bağlantı davranışı */
  hotspotMode: 'auto' | 'ask' | 'off';
  /**
   * Adaptive Runtime Engine mod seçimi.
   * 'AUTO' → cihaz metriğine göre otomatik algılama.
   * RuntimeMode değeri → kullanıcı zorlaması (ayarlar ekranı).
   */
  runtimeOverride: RuntimeOverride;
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
  // ── Runtime state (persist edilmez, oturum sonunda sıfırlanır) ──
  activeSmartCards:       SmartCard[];
  _dismissedCardIds:      string[];
  setSmartCards:         (cards: SmartCard[]) => void;
  dismissSmartCard:      (id: string) => void;
  /** fuelAdvisorService tarafından enjekte edilen istasyon önerisi kartı */
  fuelSuggestionCard:       SmartCard | null;
  setFuelSuggestionCard:    (card: SmartCard | null) => void;
  /** theaterModeService tarafından enjekte edilen Theater Mode öneri kartı */
  theaterSuggestionCard:    SmartCard | null;
  setTheaterSuggestionCard: (card: SmartCard | null) => void;
  /** Theater Mode aktif mi? Araç dururken medya odaklı tam ekran mod. */
  isTheaterModeActive:      boolean;
  setIsTheaterModeActive:   (v: boolean) => void;
  /** Termal koruma veya kullanıcı seçimiyle düşük güç/kaynak modu */
  isEcoMode:                boolean;
  setIsEcoMode:             (v: boolean) => void;
  /** Global hedef FPS kısıtlaması (0 = kısıtlama yok) */
  targetFPS:                number;
  setTargetFPS:             (v: number) => void;
  /**
   * Adaptive Runtime Engine'nin anlık aktif modu.
   * Persist edilmez — runtimeManager.subscribe() ile senkronize tutulur.
   * Bileşenler bu değeri okuyarak UI kararları alabilir (ör. blur göster/gizle).
   */
  runtimeMode:              RuntimeMode;
  setRuntimeMode:           (mode: RuntimeMode) => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  language: 'tr',
  unitSystem: 'metric',
  brightness: 100,
  volume: 60,
  volumeStyle: 'minimal_pro',
  theme: 'light',
  themePack: 'tesla',
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
  wakeWordEnabled: true,         // Sesli asistan varsayılan açık
  wakeWord: 'hey car',
  breakReminderEnabled: false,
  breakReminderIntervalMin: 120,
  autoBrightnessEnabled: true,   // Otomatik parlaklık varsayılan açık
  autoThemeEnabled: true,
  autoBrightnessMin: 15,
  autoBrightnessMax: 100,
  gestureVolumeSide: 'left',
  homeLocation: null,
  workLocation: null,
  recentDestinations: [],
  smartContextEnabled: true,     // Smart Engine varsayılan açık
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
  hotspotMode: 'ask',
  runtimeOverride: 'AUTO',
};

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      // Runtime smart card state
      activeSmartCards:       [],
      _dismissedCardIds:      [],
      fuelSuggestionCard:       null,
      theaterSuggestionCard:    null,
      isTheaterModeActive:      false,
      setSmartCards:            (cards) => set({ activeSmartCards: cards }),
      setFuelSuggestionCard:    (card)  => set({ fuelSuggestionCard: card }),
      setTheaterSuggestionCard: (card)  => set({ theaterSuggestionCard: card }),
      setIsTheaterModeActive:   (v)     => set({ isTheaterModeActive: v }),
      dismissSmartCard: (id) =>
        set((state) => ({
          activeSmartCards:  state.activeSmartCards.filter((c) => c.id !== id),
          _dismissedCardIds: [...state._dismissedCardIds, id],
        })),
      updateSettings: (partial) =>
        set((state) => {
          // Negative Delta Guard (CLAUDE.md §4): maintenance km değerleri geri gidemez
          if (partial.maintenance !== undefined) {
            const cur = state.settings.maintenance;
            if (
              (partial.maintenance.lastOilChangeKm !== undefined &&
               partial.maintenance.lastOilChangeKm < cur.lastOilChangeKm) ||
              (partial.maintenance.nextOilChangeKm !== undefined &&
               partial.maintenance.nextOilChangeKm < cur.lastOilChangeKm)
            ) return state; // saat atlama / veri bozulması — reddet
          }
          return { settings: { ...state.settings, ...partial } };
        }),
      updateMaintenance: (partial) =>
        set((state) => {
          const cur = state.settings.maintenance;
          // Negative Delta Guard (CLAUDE.md §4): km kayıtları monoton artan olmalı
          if (partial.lastOilChangeKm !== undefined &&
              partial.lastOilChangeKm < cur.lastOilChangeKm) return state;
          return { settings: { ...state.settings, maintenance: { ...cur, ...partial } } };
        }),
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
      isEcoMode:    false,
      setIsEcoMode: (v) => set({ isEcoMode: v }),
      targetFPS:    0,
      setTargetFPS: (v) => set({ targetFPS: v }),
      // Açılışta runtimeManager'ın capability-detected modunu al
      runtimeMode:     runtimeManager.getMode(),
      setRuntimeMode:  (mode) => set({ runtimeMode: mode }),
    }),
    {
      name: 'car-launcher-storage',
      storage: createJSONStorage(() => ({
        getItem: (name) => safeStorage.getItem(name),
        setItem: (name, value) => safeStorage.setItem(name, value),
        removeItem: (name) => safeStorage.removeItem(name),
      })),
      version: 11,
      migrate: (persistedState: unknown, fromVersion: number) => {
        const ps = (persistedState as { settings?: Partial<AppSettings> }) ?? {};
        const settings: AppSettings = { ...DEFAULT_SETTINGS, ...(ps.settings ?? {}) };
        const persisted = (ps.settings ?? {}) as Record<string, unknown>;

        if (fromVersion < 9) {
          settings.language    = settings.language    ?? 'tr';
          settings.unitSystem  = settings.unitSystem  ?? 'metric';
        }
        if (fromVersion < 10) {
          // v10: akıllı servisler varsayılan açık
          if (persisted['wakeWordEnabled']      === undefined) settings.wakeWordEnabled      = true;
          if (persisted['autoBrightnessEnabled'] === undefined) settings.autoBrightnessEnabled = true;
          if (persisted['smartContextEnabled']   === undefined) settings.smartContextEnabled   = true;
        }
        if (fromVersion < 11) {
          // v11: Adaptive Runtime Engine — yeni alan, varsayılan 'AUTO'
          if (persisted['runtimeOverride'] === undefined) settings.runtimeOverride = 'AUTO';
        }
        return { ...ps, settings };
      },
      merge: (persistedState: unknown, currentState) => {
        const ps = persistedState as Partial<typeof currentState> | null | undefined;
        if (!ps) return currentState;
        const merged = deepMergeSettings(currentState.settings as unknown as Record<string, unknown>, (ps.settings || {}) as Record<string, unknown>) as unknown as typeof currentState.settings;
        merged.sleepMode = false;
        merged.editMode = false;
        return {
          ...currentState, ...ps, settings: merged,
          // Runtime state — oturum başında her zaman sıfırla
          activeSmartCards:      [],
          _dismissedCardIds:     [],
          fuelSuggestionCard:    null,
          theaterSuggestionCard: null,
          isTheaterModeActive:   false,
          isEcoMode:             false,
          targetFPS:             0,
          runtimeMode:           runtimeManager.getMode(), // persist değil — manager'dan al
        };
      },
    }
  )
);
