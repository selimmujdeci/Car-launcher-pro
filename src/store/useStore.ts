import { create } from 'zustand';
import { persist, type StorageValue } from 'zustand/middleware';
import type { MusicOptionKey } from '../data/apps';
import { setObdVehicleType } from '../platform/obdService';

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

/* ── Güvenli localStorage sarmalayıcısı — LRU Eviction ──────────────────
 *
 * Araç ekranları günlerce açık kalır; localStorage dolması kaçınılmazdır.
 * LRU stratejisi: kota dolduğunda en eski "geçici" verileri silerek yer açar.
 *
 * Eviction Öncelik Sırası (önce silinir → sona kalır):
 *   1. car-crash-log-*   (hata logları — en sık büyür)
 *   2. car-trip-*        (geçmiş rotalar)
 *   3. car-cache-*       (geçici önbellek verileri)
 *   4. car-glyph-*       (harita glyph önbellek)
 *   5. car-gps-*         (GPS geçmiş — last_known korunur istisnai olarak)
 *
 * Korunan anahtarlar: 'car-launcher-storage' (Zustand ana state)
 * ─────────────────────────────────────────────────────────────────────── */

/** Geçici veri önekleri — LRU eviction sırası (index küçük = önce silinir) */
const LRU_EVICT_PREFIXES = [
  'car-crash-log',
  'car-trip-',
  'car-cache-',
  'car-glyph-',
];

/** Silinmemesi gereken kritik anahtarlar */
const LRU_PROTECTED = new Set(['car-launcher-storage', 'car-gps-last-known', 'cl_usageMap', 'cl_usagePruneTs']);

/**
 * LRU eviction — öneklerine göre eskiden yeniye siler.
 * @returns Silinen anahtar sayısı
 */
function lruEvict(): number {
  let evicted = 0;
  for (const prefix of LRU_EVICT_PREFIXES) {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && !LRU_PROTECTED.has(k) && k.startsWith(prefix)) {
        toRemove.push(k);
      }
    }
    toRemove.forEach((k) => { try { localStorage.removeItem(k); evicted++; } catch { /* ignore */ } });
    if (evicted > 0) break; // İlk kategoride yer açıldıysa dur
  }
  return evicted;
}

const safeStorage = {
  getItem(name: string): StorageValue<unknown> | null {
    try {
      const v = localStorage.getItem(name);
      return v ? (JSON.parse(v) as StorageValue<unknown>) : null;
    } catch {
      return null;
    }
  },
  setItem(name: string, value: StorageValue<unknown>): void {
    const serialized = JSON.stringify(value);
    try {
      localStorage.setItem(name, serialized);
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        // Kota doldu — LRU eviction ile yer aç, sonra yeniden dene
        let freed = lruEvict();
        try {
          localStorage.setItem(name, serialized);
          return; // Başarılı
        } catch {
          // İlk eviction yetmedi — tüm kategorileri temizle
          for (const prefix of LRU_EVICT_PREFIXES) {
            for (let i = localStorage.length - 1; i >= 0; i--) {
              const k = localStorage.key(i);
              if (k && !LRU_PROTECTED.has(k) && k.startsWith(prefix)) {
                try { localStorage.removeItem(k); freed++; } catch { /* ignore */ }
              }
            }
          }
          // Son deneme — yine de başarısız olursa sessizce geç
          try { localStorage.setItem(name, serialized); } catch { /* quota tamamen doldu */ }
        }
        void freed; // TypeScript unused var uyarısını bastır
      }
    }
  },
  removeItem(name: string): void {
    try { localStorage.removeItem(name); } catch { /* ignore */ }
  },
};

export type ThemeStyle = 'glass' | 'neon' | 'minimal';
export type WidgetStyle = 'elevated' | 'flat' | 'outlined';
export type ThemePack =
  | 'tesla' | 'bmw' | 'mercedes' | 'audi' | 'porsche'
  | 'range-rover' | 'cyberpunk' | 'midnight' | 'glass-pro' | 'ambient'
  | 'redline' | 'electric' | 'carbon' | 'minimal-dark' | 'minimal-light'
  | 'monochrome' | 'sunset' | 'night-city' | 'arctic' | 'galaxy'
  | 'big-cards' | 'ai-center' | 'tesla-x-night';
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

/** Dock'tan ana ekrana sabitlenmiş kart */
export interface PinnedCard {
  uid: string;
  type: 'app' | 'tool';
  id: string;
  label: string;
  icon: string;
  color?: string;
}

/** Araç tahrik tipi */
export type VehicleType = 'ice' | 'diesel' | 'ev' | 'hybrid' | 'phev';

/** Araç bağlantı profili — bir araç ile ilgili tüm tercihler */
export interface VehicleProfile {
  id: string;
  name: string;
  /** Araç tahrik tipi: ICE (benzin) | Diesel | EV (elektrik) | Hybrid | PHEV */
  vehicleType?: VehicleType;
  /** Yakıt deposu / batarya kapasitesi */
  fuelTankL?: number;         // ICE/Diesel: litre
  batteryCapacityKwh?: number; // EV/Hybrid: kWh
  /** Motor hacmi (ICE/Diesel) */
  engineCapacityL?: number;
  /** Motor gücü (kW) */
  motorPowerKw?: number;
  /** Toplam araç ağırlığı — ticari araç desteği için (kg) */
  vehicleMassKg?: number;
  /** Hız göstergesi maksimumu (varsayılan 240) */
  maxSpeedKmh?: number;
  /** RPM maksimumu (varsayılan 8000) */
  maxRpm?: number;
  /** Bluetooth cihaz adında aranacak anahtar kelime (ör. "OBD" veya "Samsung Galaxy") */
  btDeviceName?: string;
  /** Araç Wi-Fi SSID'si (kısmi eşleşme) */
  wifiSSID?: string;
  /** OBD Bluetooth adaptör MAC adresi */
  obdDeviceAddress?: string;
  /** OBD adaptör adı */
  obdDeviceName?: string;
  /**
   * Ortalama yakıt tüketimi (L/100 km) — ICE/Diesel/Hybrid.
   * obdService bunu fuelRemainingL → estimatedRangeKm hesabında kullanır.
   * Varsayılan: 8.0 L/100 km (ortalama binek araç değeri).
   */
  avgConsumptionL100?: number;
  /** Profil aktivasyonunda uygulanacak tema */
  themePack?: ThemePack;
  /** Profil aktivasyonunda uygulanacak varsayılan navigasyon */
  defaultNav?: string;
  /** Profil aktivasyonunda uygulanacak varsayılan müzik uygulaması */
  defaultMusic?: MusicOptionKey;
  /** Profil aktivasyonunda dock'ta gösterilecek uygulama ID'leri */
  dockAppIds?: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AppSettings {
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
  /** Sağ panel alt satır widget sırası: ['music', 'notifications'] */
  widgetOrder: string[];
  /** Her widget'ın boyut tercihi: small | medium | large */
  widgetSizes: Record<string, 'small' | 'medium' | 'large'>;
  /** Aktif harita kaynağı ID'si (local | cached | online) */
  activeMapSourceId: string | null;
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
  /** Dock'tan ana ekrana sabitlenmiş kartlar */
  pinnedCards: PinnedCard[];
  /** Gece/gündüz modu */
  dayNightMode: 'day' | 'night';
  /** Widget düzenleme modu */
  editMode: boolean;
  /** OBD tabanlı otomatik uyku: RPM 0'da kaldığında uyku moduna geç */
  obdAutoSleep: boolean;
  /** OBD uyku gecikmesi (dakika) — RPM 0'dan bu süre sonra uyku moduna girer */
  obdSleepDelayMin: number;
  /**
   * GPS yokken hava durumu için varsayılan şehir koordinatları.
   * Boş bırakılırsa İstanbul kullanılır.
   */
  weatherFallbackCity: { lat: number; lng: number; name: string } | null;
  /** Kayıtlı araç profilleri */
  vehicleProfiles: VehicleProfile[];
  /** Şu an aktif araç profili ID'si; eşleşme yoksa null */
  activeVehicleProfileId: string | null;
  /** Uygulama açılışında haritayı otomatik aç (Tesla davranışı) */
  autoNavOnStart: boolean;
  /** Media Hub'da seçili/tercih edilen kaynak anahtarı */
  activeMediaSourceKey: string;
  /** Sesli komutla veya manuel favorilere eklenen şarkılar */
  musicFavorites: MusicFavorite[];
  /** AI sesli asistan sağlayıcısı */
  aiVoiceProvider: 'gemini' | 'haiku' | 'none';
  /** Gemini API key (aistudio.google.com'dan ücretsiz) */
  geminiApiKey: string;
  /** Claude Haiku API key (console.anthropic.com) */
  claudeHaikuApiKey: string;
}

export interface MusicFavorite {
  title:     string;
  artist:    string;
  albumArt?: string;
  source:    string;   // 'spotify' | 'youtube_music' | vb.
  addedAt:   number;   // Date.now()
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
  widgetVisible: {
    nav: true,
    media: true,
    shortcuts: true,
    obd: true,
  },
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
      addVehicleProfile: (profile) =>
        set((state) => ({
          settings: {
            ...state.settings,
            vehicleProfiles: [...state.settings.vehicleProfiles, profile],
          },
        })),
      updateVehicleProfile: (id, partial) =>
        set((state) => ({
          settings: {
            ...state.settings,
            vehicleProfiles: state.settings.vehicleProfiles.map((p) =>
              p.id === id ? { ...p, ...partial } : p,
            ),
          },
        })),
      removeVehicleProfile: (id) =>
        set((state) => ({
          settings: {
            ...state.settings,
            vehicleProfiles: state.settings.vehicleProfiles.filter((p) => p.id !== id),
            activeVehicleProfileId:
              state.settings.activeVehicleProfileId === id
                ? null
                : state.settings.activeVehicleProfileId,
          },
        })),
      setActiveVehicleProfile: (id) =>
        set((state) => {
          // Araç tipini OBD servisine bildir — mock/real veri buna göre şekillensin
          if (id !== null) {
            const profile = state.settings.vehicleProfiles.find((p) => p.id === id);
            if (profile?.vehicleType) {
              setObdVehicleType(profile.vehicleType);
            }
          }
          return { settings: { ...state.settings, activeVehicleProfileId: id } };
        }),
      addMusicFavorite: (fav) =>
        set((state) => {
          // Aynı şarkı zaten var mı kontrol et
          const exists = state.settings.musicFavorites.some(
            (f) => f.title === fav.title && f.artist === fav.artist,
          );
          if (exists) return state;
          return {
            settings: {
              ...state.settings,
              musicFavorites: [fav, ...state.settings.musicFavorites].slice(0, 100),
            },
          };
        }),
      removeMusicFavorite: (title, artist) =>
        set((state) => ({
          settings: {
            ...state.settings,
            musicFavorites: state.settings.musicFavorites.filter(
              (f) => !(f.title === title && f.artist === artist),
            ),
          },
        })),
    }),
    {
      name: 'car-launcher-storage',
      storage: safeStorage,
      version: 8,
      migrate: (persistedState: unknown, fromVersion: number) => {
        // Her sürümde yeni alanlar DEFAULT_SETTINGS'ten gelir.
        // Eski sürümlerde eksik alanları burada düzelt.
        const ps = (persistedState as { settings?: Partial<AppSettings> }) ?? {};
        const settings: AppSettings = { ...DEFAULT_SETTINGS, ...(ps.settings ?? {}) };

        if (fromVersion < 2) {
          // v2: pinnedCards eklendi
          settings.pinnedCards = settings.pinnedCards ?? [];
        }
        if (fromVersion < 3) {
          // v3: editMode eklendi
          settings.editMode = false;
        }
        if (fromVersion < 4) {
          // v4: dayNightMode eklendi — saate göre başlat
          const h = new Date().getHours();
          settings.dayNightMode = settings.dayNightMode ?? (h >= 7 && h < 19 ? 'day' : 'night');
          // Oturum durumları sıfırla
          settings.sleepMode = false;
        }
        if (fromVersion < 5) {
          // v5: araç profil sistemi eklendi
          settings.vehicleProfiles = settings.vehicleProfiles ?? [];
          settings.activeVehicleProfileId = settings.activeVehicleProfileId ?? null;
        }
        if (fromVersion < 6) {
          // v6: startup banner ve otomatik nav devre dışı — kullanıcı isteği
          settings.smartContextEnabled = false;
          settings.autoNavOnStart = false;
        }
        if (fromVersion < 7) {
          // v7: autoThemeEnabled varsayılan true + saate göre dayNightMode
          settings.autoThemeEnabled = true;
          const h = new Date().getHours();
          settings.dayNightMode = h >= 7 && h < 19 ? 'day' : 'night';
        }
        if (fromVersion < 8) {
          // v8: tek tema — BalancedLayout kullanan glass-pro'ya geç
          settings.themePack = 'glass-pro';
        }
        return { ...ps, settings };
      },
      // Yeni ayar alanları eklendiğinde otomatik olarak varsayılan değerini alır.
      // deepMergeSettings tüm iç içe objeleri recursive merge eder.
      merge: (persistedState: unknown, currentState) => {
        const ps = persistedState as Partial<typeof currentState> | null | undefined;
        if (!ps) return currentState;
        const merged = deepMergeSettings(
          currentState.settings as unknown as Record<string, unknown>,
          (ps.settings || {}) as Record<string, unknown>,
        ) as unknown as typeof currentState.settings;
        // Oturum durumları: her yeniden başlatmada sıfırla
        merged.sleepMode = false;
        merged.editMode  = false;
        return { ...currentState, ...ps, settings: merged };
      },
    }
  )
);
