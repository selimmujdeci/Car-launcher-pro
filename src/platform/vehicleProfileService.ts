/**
 * Vehicle Profile Service — araç tanıma ve profil uygulama.
 *
 * Çalışma prensibi:
 *  1. Bluetooth cihaz adı, Wi-Fi SSID veya OBD MAC ile profil eşleştirme
 *  2. Eşleşme bulunduğunda store'a aktif profil ID'si yazılır
 *  3. Tema, navigasyon, müzik gibi tercihler profil ayarlarına güncellenir
 *  4. Her 15 saniyede bir yeniden kontrol — bağlantı değişimlerini yakalar
 *  5. Eşleşme yoksa activeVehicleProfileId null kalır (fallback: mevcut ayarlar)
 */

import { CarLauncher } from './nativePlugin';
import { isNative } from './bridge';
import { logError } from './crashLogger';
import { useStore } from '../store/useStore';
import type { VehicleProfile, AppSettings } from '../store/useStore';
import type { HeadUnitPlatform } from './headUnitPlatform';

/* ── Preset araç profilleri — platforma göre otomatik oluşturulur ── */

export const PRESET_VEHICLE_PROFILES: Record<string, Omit<VehicleProfile, 'id' | 'createdAt' | 'lastUsedAt'>> = {
  /** Fiat Doblo 2016+ (1. Nesil) — Hiworld H1W0FT050A */
  hiworld_fiat_doblo: {
    name:          'Fiat Doblo (Hiworld)',
    btDeviceName:  'HIWORLD',          // H1W0FT ünitesinin BT yayın adı
    wifiSSID:      'HIWORLD',          // WiFi hotspot adı (varsa)
    themePack:     'glass-pro',         // Düşük güçlü ARM — en hafif tema paketi
    defaultNav:    'maps',
    defaultMusic:  'spotify',
    dockAppIds:    ['phone', 'radio', 'navigation'],
  },
  /** FYT/SYU platformu — Joying, ATOTO, Mekede, Junsun, T507/Dacia */
  fyt_generic: {
    name:         'FYT / SYU Ünite',
    btDeviceName: 'SYU',
    themePack:    'glass-pro',
    defaultNav:   'maps',
    defaultMusic: 'spotify',
  },
  /** Microntek — MTCD/MTCE PX3/PX5/PX6 */
  microntek_generic: {
    name:         'Microntek Ünite',
    btDeviceName: 'MTCD',
    themePack:    'glass-pro',
    defaultNav:   'maps',
    defaultMusic: 'spotify',
  },
};

/* ── Types ───────────────────────────────────────────────── */

export interface VehicleDetectionState {
  detectedProfileId: string | null;
  matchMethod: 'bluetooth' | 'wifi' | 'none';
  lastCheckedAt: number;
}

/* ── Module state ────────────────────────────────────────── */

let _state: VehicleDetectionState = {
  detectedProfileId: null,
  matchMethod: 'none',
  lastCheckedAt: 0,
};

const _listeners = new Set<(s: VehicleDetectionState) => void>();
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _running = false;

/* ── Internal helpers ────────────────────────────────────── */

function _notify(): void {
  const snap = { ..._state };
  _listeners.forEach((fn) => fn(snap));
}

function _applyProfileSettings(profile: VehicleProfile): void {
  const { updateSettings } = useStore.getState();
  const overrides: Partial<AppSettings> = {};
  if (profile.themePack)    overrides.themePack    = profile.themePack;
  if (profile.defaultNav)   overrides.defaultNav   = profile.defaultNav;
  if (profile.defaultMusic) overrides.defaultMusic = profile.defaultMusic;
  if (Object.keys(overrides).length) updateSettings(overrides);

  // lastUsedAt güncelle
  useStore.getState().updateVehicleProfile(profile.id, {
    lastUsedAt: new Date().toISOString(),
  });
}

async function _detectProfile(): Promise<void> {
  if (!_running) return;

  const { settings, setActiveVehicleProfile } = useStore.getState();
  const { vehicleProfiles } = settings;

  if (!vehicleProfiles.length) {
    _state = { detectedProfileId: null, matchMethod: 'none', lastCheckedAt: Date.now() };
    _notify();
    return;
  }

  let btDevice = '';
  let wifiName = '';

  if (isNative) {
    try {
      const status = await CarLauncher.getDeviceStatus();
      btDevice = status.btConnected ? (status.btDevice ?? '') : '';
      wifiName = status.wifiConnected ? (status.wifiName ?? '') : '';
    } catch (e) {
      logError('VehicleProfile:getDeviceStatus', e);
    }
  } else {
    // Demo modu — her zaman ilk profili simüle et
    if (vehicleProfiles.length > 0) {
      const first = vehicleProfiles[0];
      btDevice = first.btDeviceName ?? '';
      wifiName = first.wifiSSID ?? '';
    }
  }

  let matched: VehicleProfile | null = null;
  let matchMethod: VehicleDetectionState['matchMethod'] = 'none';

  // 1. Bluetooth cihaz adı ile eşleştir
  if (btDevice) {
    const lower = btDevice.toLowerCase();
    matched = vehicleProfiles.find((p) =>
      p.btDeviceName && lower.includes(p.btDeviceName.toLowerCase()),
    ) ?? null;
    if (matched) matchMethod = 'bluetooth';
  }

  // 2. Wi-Fi SSID ile eşleştir
  if (!matched && wifiName) {
    const lower = wifiName.toLowerCase();
    matched = vehicleProfiles.find((p) =>
      p.wifiSSID && lower.includes(p.wifiSSID.toLowerCase()),
    ) ?? null;
    if (matched) matchMethod = 'wifi';
  }

  const newId = matched?.id ?? null;
  const prevId = _state.detectedProfileId;

  _state = { detectedProfileId: newId, matchMethod, lastCheckedAt: Date.now() };
  _notify();

  // Sadece profil değiştiğinde uygula — tekrar tekrar üzerine yazma
  if (newId !== prevId) {
    setActiveVehicleProfile(newId);
    if (matched) _applyProfileSettings(matched);
  }
}

/* ── Otomatik profil tohumlama ───────────────────────────── */

const SEED_KEY = 'cl_vp_seeded_platform';

/**
 * Tespit edilen head unit platformuna göre, eğer hiç profil yoksa
 * varsayılan bir araç profili oluşturur (tek seferlik).
 * Kullanıcı daha sonra profili düzenleyebilir veya silebilir.
 */
export function seedDefaultProfile(platform: HeadUnitPlatform): void {
  try {
    // Zaten tohumlandıysa tekrar oluşturma
    if (localStorage.getItem(SEED_KEY) === platform) return;

    const { settings, addVehicleProfile, setActiveVehicleProfile } = useStore.getState();
    if (settings.vehicleProfiles.length > 0) return; // Kullanıcının profili varsa dokunma

    const presetKey =
      platform === 'hiworld'    ? 'hiworld_fiat_doblo'   :
      platform === 'fyt'        ? 'fyt_generic'          :
      platform === 'microntek'  ? 'microntek_generic'    :
      null;

    if (!presetKey) return;

    const preset = PRESET_VEHICLE_PROFILES[presetKey];
    if (!preset) return;

    const profile: VehicleProfile = {
      ...preset,
      id:          `preset_${presetKey}_${Date.now()}`,
      createdAt:   new Date().toISOString(),
      lastUsedAt:  null,
    };

    addVehicleProfile(profile);
    setActiveVehicleProfile(profile.id);
    localStorage.setItem(SEED_KEY, platform);
  } catch {
    // Store hazır değilse sessizce geç
  }
}

/* ── Public API ──────────────────────────────────────────── */

/**
 * Araç algılama servisini başlat.
 * - Hemen bir kontrol yapar, ardından 15 saniyede bir tekrar kontrol eder.
 * - İdempotent: çalışırken tekrar çağrılırsa etki etmez.
 */
export function startVehicleDetection(): void {
  if (_running) return;
  _running = true;

  void _detectProfile();
  _intervalId = setInterval(() => { void _detectProfile(); }, 15_000);
}

/**
 * Araç algılamayı durdur ve durumu temizle.
 */
export function stopVehicleDetection(): void {
  _running = false;
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}

/**
 * Araç algılama durumu değişikliklerini dinle.
 * Hemen mevcut snapshot ile çağrılır. Cleanup fonksiyonu döner.
 */
export function onVehicleDetection(fn: (s: VehicleDetectionState) => void): () => void {
  _listeners.add(fn);
  fn({ ..._state });
  return () => { _listeners.delete(fn); };
}

/** Mevcut algılama durumunu senkron döner. */
export function getVehicleDetectionSnapshot(): VehicleDetectionState {
  return { ..._state };
}

/**
 * Profili manuel olarak zorla uygula (kullanıcı listeden seçtiğinde).
 */
export function forceApplyVehicleProfile(profileId: string): void {
  const { settings, setActiveVehicleProfile } = useStore.getState();
  const profile = settings.vehicleProfiles.find((p) => p.id === profileId);
  if (!profile) return;

  _state = { detectedProfileId: profileId, matchMethod: 'none', lastCheckedAt: Date.now() };
  setActiveVehicleProfile(profileId);
  _applyProfileSettings(profile);
  _notify();
}
