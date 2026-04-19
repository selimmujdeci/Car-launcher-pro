/**
 * Head Unit Platform Detection
 *
 * Android head unit ekosisteminde desteklenen platformlar:
 *   FYT/SYU   — com.syu.*          — Joying, ATOTO, Mekede, Funrover, Junsun, T507/Dacia
 *   Microntek — com.microntek.*    — MTCD, MTCE, PX3/PX5/PX6 (RK serisi)
 *   KSW/ZXW   — com.kswcar.*       — BMW/Benz/Audi aftermarket, Snapdragon 625
 *   RoadRover — com.roadrover.*    — RoadRover IVI (kendi SDK'sı)
 *   Hiworld   — com.hiworld.*      — Fiat/Jeep/Alfa OEM (Doblo, Egea, Renegade…)
 *                                    H1W0FT serisi: K2401_NWD firmware
 *   Stock     — standart Android   — tablet, emülatör, genel Android
 *
 * Tespit: getApps() ile yüklü paketleri tara → imza paketi varsa platform belirle
 * Cache: localStorage'da sakla, her boot'ta tekrar sorgulamayı önle
 */

import { CarLauncher } from './nativePlugin';
import { seedDefaultProfile } from './vehicleProfileService';

/* ── Platform tipleri ──────────────────────────────────────── */

export type HeadUnitPlatform = 'fyt' | 'microntek' | 'ksw' | 'roadrover' | 'hiworld' | 'stock';

export interface PlatformInfo {
  platform:  HeadUnitPlatform;
  phone:     string | null;   // BT telefon paketi
  radio:     string | null;   // Radyo paketi
  carInfo:   string | null;   // Araç bilgisi / CAN bus paketi
  launcher:  string | null;   // Native launcher paketi
}

/* ── Platform imzaları — bu paketlerden biri varsa platform tespiti yapılır ── */

const PLATFORM_SIGNATURES: Record<HeadUnitPlatform, string[]> = {
  fyt:       ['com.syu.bt', 'com.syu.radio', 'com.syu.launcher', 'com.syu.carinfo'],
  microntek: ['com.microntek.bluetooth', 'com.microntek.radio', 'com.microntek.music'],
  ksw:       ['com.kswcar.service', 'com.kswcar.bluetooth', 'com.zxw.launcher'],
  roadrover: ['com.roadrover.services', 'com.roadrover.sdk'],
  // Hiworld: Fiat/Jeep/Alfa OEM — H1W0FT050A (Doblo, Egea, Renegade, 500X vb.)
  // K2401_NWD_S212802 firmware — paket imzaları:
  hiworld:   [
    'com.hiworld.launcher',
    'com.hiworld.bt',
    'com.hiworld.radio',
    'com.hiworld.carlife',
    'com.hiworld.canbox',     // CAN bus köprüsü
    'com.hiworld.settings',
    'com.hiworld.navi',
    'com.fiat.hiworld',       // Fiat OEM overlay
    'com.stellantis.hiworld', // Stellantis (Fiat/Jeep grubu)
    'it.fiat.connect',        // Fiat Connect
    'com.mopar.uconnect',     // Jeep/Dodge/Fiat Uconnect varyantı
  ],
  stock:     [],
};

/* ── Platform başına uygulama paketleri ──────────────────── */

const PLATFORM_APPS: Record<HeadUnitPlatform, Omit<PlatformInfo, 'platform'>> = {
  fyt: {
    phone:    'com.syu.bt',
    radio:    'com.syu.radio',
    carInfo:  'com.syu.carinfo',
    launcher: 'com.syu.launcher',
  },
  microntek: {
    phone:    'com.microntek.bluetooth',
    radio:    'com.microntek.radio',
    carInfo:  null,
    launcher: null,
  },
  ksw: {
    phone:    'com.kswcar.bluetooth',
    radio:    null,
    carInfo:  'com.kswcar.service',
    launcher: null,
  },
  roadrover: {
    phone:    'com.roadrover.services',
    radio:    null,
    carInfo:  'com.roadrover.services',
    launcher: null,
  },
  // Hiworld — Fiat Doblo/Egea/Renegade H1W0FT050A
  hiworld: {
    phone:    'com.hiworld.bt',
    radio:    'com.hiworld.radio',
    carInfo:  'com.hiworld.canbox',
    launcher: 'com.hiworld.launcher',
  },
  stock: {
    phone:    null,
    radio:    null,
    carInfo:  null,
    launcher: null,
  },
};

/* ── Fallback zinciri — telefon için ────────────────────── */

/** Öncelik sırasıyla denenecek telefon paketleri */
export const PHONE_FALLBACK_PACKAGES = [
  'com.hiworld.bt',               // Hiworld (Fiat/Jeep OEM — Doblo, Egea…)
  'com.hiworld.carlife',          // Hiworld CarLife alternatif BT
  'com.syu.bt',                   // FYT/SYU (T507/Dacia dahil)
  'com.microntek.bluetooth',      // Microntek/MTCD
  'com.kswcar.bluetooth',         // KSW (BMW/Benz aftermarket)
  'com.roadrover.services',       // RoadRover IVI
];

/** Öncelik sırasıyla denenecek radyo paketleri */
export const RADIO_FALLBACK_PACKAGES = [
  'com.hiworld.radio',            // Hiworld (Fiat/Jeep OEM)
  'com.syu.radio',
  'com.syu.carradio',
  'com.microntek.radio',
];

/* ── Cache ────────────────────────────────────────────── */

const CACHE_KEY = 'cl_head_unit_platform';
let _platformInfo: PlatformInfo | null = null;

function saveToCache(info: PlatformInfo): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(info)); } catch { /* quota */ }
}

function loadFromCache(): PlatformInfo | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as PlatformInfo) : null;
  } catch { return null; }
}

/* ── Tespit ───────────────────────────────────────────── */

function detectFromPackageList(packageNames: Set<string>): HeadUnitPlatform {
  for (const [platform, sigs] of Object.entries(PLATFORM_SIGNATURES) as [HeadUnitPlatform, string[]][]) {
    if (platform === 'stock') continue;
    if (sigs.some(p => packageNames.has(p))) return platform;
  }
  return 'stock';
}

/**
 * Cihazda yüklü paketleri tarayarak head unit platformunu tespit eder.
 * Sonuç localStorage'a cache'lenir; bir sonraki açılışta anında döner.
 * Web modunda veya getApps() başarısız olursa 'stock' döner.
 */
export async function initPlatformDetection(): Promise<PlatformInfo> {
  if (_platformInfo) return _platformInfo;

  // Cache'den yükle
  const cached = loadFromCache();
  if (cached) { _platformInfo = cached; return cached; }

  try {
    const { apps } = await CarLauncher.getApps();
    const pkgSet = new Set(apps.map(a => a.packageName));
    const platform = detectFromPackageList(pkgSet);
    const info: PlatformInfo = { platform, ...PLATFORM_APPS[platform] };
    _platformInfo = info;
    saveToCache(info);
    // Platforma göre varsayılan araç profili oluştur (ilk kurulum)
    seedDefaultProfile(platform);
    return info;
  } catch {
    // Native yoksa veya hata varsa stock döner
    const info: PlatformInfo = { platform: 'stock', ...PLATFORM_APPS.stock };
    _platformInfo = info;
    return info;
  }
}

/**
 * Mevcut platform bilgisini döner.
 * initPlatformDetection() çağrılmadan önce null döner.
 */
export function getPlatformInfo(): PlatformInfo | null {
  return _platformInfo ?? loadFromCache();
}

/**
 * Telefon uygulamasının paket adını döner.
 * Platform tespiti yoksa null döner → bridge ACTION_DIAL fallback'e düşer.
 */
export function getPhonePackage(): string | null {
  return getPlatformInfo()?.phone ?? null;
}

/**
 * Radyo uygulamasının paket adını döner.
 */
export function getRadioPackage(): string | null {
  return getPlatformInfo()?.radio ?? null;
}
