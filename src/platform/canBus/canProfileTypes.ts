/**
 * canProfileTypes.ts
 *
 * Araç CAN profili tip tanımları.
 * Gerçek profil verileri JSON dosyalarında (public/canProfiles/).
 * Bu dosyada sadece interface/type — hiç CAN ID, hiç araç verisi yok.
 */

// ── Temel tipler ──────────────────────────────────────────────────────────────

export type CanSignalName =
  | 'speed' | 'rpm' | 'reverse' | 'fuel' | 'coolant'
  | 'doorFl' | 'doorFr' | 'doorRl' | 'doorRr'
  | 'headlights' | 'parkingBrake' | 'seatbelt'
  | 'throttle' | 'oilTemp' | 'battVolt';

export type CanProtocol =
  | 'CAN11_500'   // 11-bit, 500 kbps (en yaygın)
  | 'CAN11_250'   // 11-bit, 250 kbps
  | 'CAN29_500'   // 29-bit extended, 500 kbps
  | 'CAN29_250'   // 29-bit extended, 250 kbps
  | 'OBD2_AUTO'   // Standart OBD-II PID modu (raw CAN değil)
  | 'AUTO';       // ELM327 otomatik algılama

/** Profilin doğrulama seviyesi — güvenlik kararlarında kullanılır */
export type SafetyLevel =
  | 'verified'      // resmi/topluluk tarafından test edilmiş
  | 'community'     // topluluk katkılı, kısmen doğrulanmış
  | 'experimental'; // deneysel, Safe Mode zorunlu

// ── Sinyal tanımı ─────────────────────────────────────────────────────────────

export interface CanSignalDef {
  name: CanSignalName;
  canId: number;         // 11/29-bit CAN ID (onaltılık, JSON'da "0x1D0" desteklenir)
  startByte: number;     // 0-indexed
  length: number;        // byte cinsinden (1 veya 2)
  bitOffset?: number;    // boolean sinyaller için bit pozisyonu
  bitMask?: number;      // boolean sinyaller için maske
  scale: number;         // ham × scale = gerçek değer
  offset: number;        // gerçek değer + offset
  unit: string;          // 'km/h' | 'rpm' | '°C' | '%' | 'bool' | 'V'
  signed?: boolean;      // negatif değer alabilir mi
}

// ── Profil meta ───────────────────────────────────────────────────────────────

export interface CanProfileMeta {
  id: string;                    // benzersiz slug: 'fiat_doblo_2016'
  version: string;               // semver: '1.0.0'
  make: string;                  // 'Fiat' | '*' (wildcard = tüm markalar)
  model: string;                 // 'Doblò' | '*'
  yearFrom: number;
  yearTo: number;
  protocol: CanProtocol;
  confidenceScore: number;       // 0.0 – 1.0 (< 0.7 → Safe Mode zorunlu)
  safetyLevel: SafetyLevel;
  fallbackProfile: string | null; // eşleşme yoksa hangi profile dön
  notes?: string;
}

// ── Tam profil (meta + sinyaller) ─────────────────────────────────────────────

export interface VehicleCanProfile extends CanProfileMeta {
  signals: CanSignalDef[];       // OBD2_AUTO profilinde boş dizi
}

// ── Profil dizini (_index.json) ───────────────────────────────────────────────

export interface ProfileIndexEntry {
  id: string;
  file: string;              // 'fiat_doblo_2016.json'
  make: string;
  model: string;
  yearFrom: number;
  yearTo: number;
  safetyLevel: SafetyLevel;
}

export interface ProfileIndex {
  version: string;
  profiles: ProfileIndexEntry[];
}

// ── Profil yükleme sonucu (Safe Mode altyapısı — Patch 2'de kullanılacak) ────

export type ProfileLoadResult =
  | { ok: true;  profile: VehicleCanProfile }
  | { ok: false; reason: string; fallback: 'standard_obd' };
