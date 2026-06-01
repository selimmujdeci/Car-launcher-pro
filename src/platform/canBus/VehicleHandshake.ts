/**
 * VehicleHandshake.ts — Patch 2
 *
 * Sorumluluklar:
 *   1. VIN'i decode et → marka + model yılı tahmin et
 *   2. Desteklenen PID'leri (Mode 01 PID 00) profil sinyalleriyle karşılaştır
 *   3. Profile eşleşme confidence hesapla
 *   4. Eşleşme yoksa / düşük confidence → standard_obd + SafeMode flag
 *
 * Bağımlılıklar (import):
 *   ← OBDHandshake.ts   : parseVIN, parseSupportedPIDs (mevcut, değişmez)
 *   ← VehicleProfileService : listAvailableProfiles, loadProfileById
 *   ← canProfileTypes   : tipler
 *
 * CAN write/command tarafına dokunmaz.
 * VehicleSignalResolver'a bağlanmaz.
 */

import { parseVIN, parseSupportedPIDs } from '../../core/val/OBDHandshake';
import { logInfo } from '../debug';
import { listAvailableProfiles, loadProfileById } from './VehicleProfileService';
import type { VehicleCanProfile } from './canProfileTypes';
import { logError } from '../crashLogger';
import { SafeModeReason } from './ProfileSignalGate';

// ── Eşik ─────────────────────────────────────────────────────────────────────

/** Bu değerin altında → Safe Mode zorunlu */
const SAFE_MODE_CONFIDENCE_THRESHOLD = 0.65;

// ── Çıktı tipi ────────────────────────────────────────────────────────────────

export interface HandshakeOutcome {
  profile: VehicleCanProfile;
  safeMode: boolean;             // true → bilinmeyen araç, sadece OBD-II PID modu
  safeModeReason: SafeModeReason; // enum — gate kararı için tip güvenli neden
  confidence: number;            // 0.0 – 1.0
  vin: string | null;
  make: string | null;           // VIN'den tahmin edilen marka
  modelYear: number | null;
  supportedPids: Set<number>;
  reason: string;                // detaylı açıklama — loglama için
}

// ── WMI (ISO 3779) → marka eşleme ────────────────────────────────────────────
// Minimum set: profil index'te karşılığı olan markalar.
// CAN ID veya araç spesifik veri yok — sadece 3 char WMI.

const WMI_MAKE: Readonly<Record<string, string>> = {
  // Fiat / Alfa / Lancia
  'ZFA': 'Fiat', 'ZAR': 'Alfa', 'ZLA': 'Lancia',
  // VW Grubu
  'WVW': 'VW', 'WV1': 'VW', 'WV2': 'VW',
  'TMB': 'Skoda', 'VSS': 'SEAT',
  'WAU': 'Audi', 'TRU': 'Audi',
  // BMW
  'WBA': 'BMW', 'WBS': 'BMW', 'WBW': 'BMW', 'WBY': 'BMW',
  // Mercedes
  'WDD': 'Mercedes', 'WDB': 'Mercedes', 'WDC': 'Mercedes',
  // Ford
  'WF0': 'Ford', '1FA': 'Ford', '1FB': 'Ford', '1FC': 'Ford',
  // Opel / Vauxhall
  'W0L': 'Opel',
  // Renault / Dacia
  'VF1': 'Renault', 'VF3': 'Peugeot', 'VF7': 'Citroën',
  'UU1': 'Dacia',
  // Toyota / Lexus
  'JT2': 'Toyota', 'JT3': 'Toyota', 'JT4': 'Toyota',
  'JT6': 'Toyota', 'SB1': 'Toyota', 'TMT': 'Toyota',
  // Honda
  'JHM': 'Honda', 'SHH': 'Honda',
  // Nissan / Infiniti
  'JN1': 'Nissan', 'JN6': 'Nissan', 'SJN': 'Nissan',
  // Hyundai / Kia
  'KMH': 'Hyundai', 'KNA': 'Kia', 'KNB': 'Kia',
  // Subaru
  'JF1': 'Subaru', 'JF2': 'Subaru',
  // Mazda
  'JM1': 'Mazda', 'JM3': 'Mazda',
  // Volvo
  'YV1': 'Volvo', 'YV2': 'Volvo',
};

// ── VIN yılı decode (ISO 3779 §5.3) ──────────────────────────────────────────
// Pozisyon 10 (0-indexed: 9) = model yılı

const VIN_YEAR_MAP: Readonly<Record<string, number>> = {
  'A': 2010, 'B': 2011, 'C': 2012, 'D': 2013, 'E': 2014,
  'F': 2015, 'G': 2016, 'H': 2017, 'J': 2018, 'K': 2019,
  'L': 2020, 'M': 2021, 'N': 2022, 'P': 2023, 'R': 2024,
  'S': 1995, 'T': 1996, 'V': 1997, 'W': 1998, 'X': 1999, 'Y': 2000,
  '1': 2001, '2': 2002, '3': 2003, '4': 2004, '5': 2005,
  '6': 2006, '7': 2007, '8': 2008, '9': 2009,
};

function _decodeVinYear(vin: string): number | null {
  const char = vin[9]?.toUpperCase();
  if (!char) return null;
  return VIN_YEAR_MAP[char] ?? null;
}

function _decodeWmi(vin: string): string | null {
  const wmi = vin.substring(0, 3).toUpperCase();
  return WMI_MAKE[wmi] ?? null;
}

// ── OBD PID → sinyal ismi eşleme ─────────────────────────────────────────────
// Sadece standart Mode 01 PID'leri. CAN ID'ye dokunmaz.

const PID_TO_SIGNAL: Readonly<Record<number, string>> = {
  0x0C: 'rpm',
  0x0D: 'speed',
  0x05: 'coolant',
  0x2F: 'fuel',
  0x04: 'throttle',
  0x5C: 'oilTemp',
  0x42: 'battVolt',
};

// ── Confidence hesaplama ──────────────────────────────────────────────────────

function _computeConfidence(
  profile: VehicleCanProfile,
  make: string | null,
  modelYear: number | null,
  supportedPids: Set<number>,
): number {
  let score = 0;

  // WMI marka eşleşmesi → 0.45
  if (make && profile.make !== '*') {
    if (profile.make.toLowerCase() === make.toLowerCase()) score += 0.45;
  } else if (profile.make === '*') {
    score += 0.20; // wildcard (standard_obd)
  }

  // Model yılı aralığı → 0.35
  if (modelYear !== null) {
    if (modelYear >= profile.yearFrom && modelYear <= profile.yearTo) {
      score += 0.35;
    } else {
      // Yakın yıl: 3 yıl tolerans → yarım puan
      const nearFrom = Math.abs(modelYear - profile.yearFrom);
      const nearTo   = Math.abs(modelYear - profile.yearTo);
      if (Math.min(nearFrom, nearTo) <= 3) score += 0.15;
    }
  }

  // Desteklenen PID'ler profil sinyalleriyle örtüşüyor mu → max 0.20
  const profileSignalNames = new Set<string>(profile.signals.map(s => s.name));
  let pidMatchCount = 0;
  let pidCheckCount = 0;
  for (const [pid, sigName] of Object.entries(PID_TO_SIGNAL)) {
    if (profileSignalNames.has(sigName)) {
      pidCheckCount++;
      if (supportedPids.has(Number(pid))) pidMatchCount++;
    }
  }
  if (pidCheckCount > 0) {
    score += (pidMatchCount / pidCheckCount) * 0.20;
  }

  return Math.min(score, 1.0);
}

// ── Ana fonksiyon ─────────────────────────────────────────────────────────────

/**
 * Ham ELM327 yanıtlarını alır, araç profilini seçer.
 *
 * @param raw09   - Mode 09 PID 02 ham yanıtı (VIN)
 * @param raw0100 - Mode 01 PID 00 ham yanıtı (desteklenen PID'ler)
 * @returns       HandshakeOutcome — her zaman bir profil döner, asla fırlatmaz
 */
export async function runVehicleHandshake(
  raw09: string,
  raw0100: string,
): Promise<HandshakeOutcome> {
  // 1. VIN + PID parse (mevcut OBDHandshake — değişmez)
  const vin           = parseVIN(raw09);
  const supportedPids = parseSupportedPIDs(raw0100);
  const make          = vin ? _decodeWmi(vin)      : null;
  const modelYear     = vin ? _decodeVinYear(vin)   : null;

  const _log = (msg: string) => {
    logInfo(`[VehicleHandshake] ${msg}`);
  };

  _log(`VIN=${vin ?? 'yok'} make=${make ?? '?'} year=${modelYear ?? '?'} PIDs=${supportedPids.size}`);

  // 2. Profil listesini yükle
  let profiles: Awaited<ReturnType<typeof listAvailableProfiles>> = [];
  try {
    profiles = await listAvailableProfiles();
  } catch (e) {
    logError('VehicleHandshake:listProfiles', e);
  }

  // standard_obd'yi listeden çıkar — fallback olarak ayrıca tutulur
  const candidates = profiles.filter(p => p.id !== 'standard_obd');

  // 3. Marka eşleşen adayları öne çek, sonra tüm listeyi tara
  let bestId         = '';
  let bestConfidence = 0;

  for (const entry of candidates) {
    try {
      const result = await loadProfileById(entry.id);
      if (!result.ok) continue;

      const conf = _computeConfidence(result.profile, make, modelYear, supportedPids);
      _log(`  ${entry.id} → confidence=${conf.toFixed(2)}`);

      if (conf > bestConfidence) {
        bestConfidence = conf;
        bestId         = entry.id;
      }
    } catch (e) {
      logError(`VehicleHandshake:probe:${entry.id}`, e);
    }
  }

  // 4. Threshold kontrolü
  if (bestConfidence >= SAFE_MODE_CONFIDENCE_THRESHOLD && bestId) {
    const result = await loadProfileById(bestId);
    if (result.ok) {
      _log(`Eşleşme: ${bestId} (conf=${bestConfidence.toFixed(2)})`);
      return {
        profile: result.profile, safeMode: false,
        safeModeReason: SafeModeReason.NONE,
        confidence: bestConfidence, vin, make, modelYear, supportedPids,
        reason: `VIN eşleşmesi: ${bestId} (conf=${bestConfidence.toFixed(2)})`,
      };
    }
  }

  // 5. Eşleşme yok veya düşük confidence → standard_obd fallback + Safe Mode
  const reason = bestId
    ? `En yüksek eşleşme ${bestId} conf=${bestConfidence.toFixed(2)} < ${SAFE_MODE_CONFIDENCE_THRESHOLD} → Safe Mode`
    : `Hiçbir profil aday bulunamadı${vin ? ` (VIN=${vin})` : ' (VIN yok)'}`;

  _log(reason);

  const fallbackResult = await loadProfileById('standard_obd');
  const fallbackProfile = fallbackResult.ok
    ? fallbackResult.profile
    : {
        id: 'standard_obd', version: '1.0.0',
        make: '*', model: '*', yearFrom: 1996, yearTo: 9999,
        protocol: 'OBD2_AUTO' as const, confidenceScore: 1.0,
        safetyLevel: 'verified' as const, fallbackProfile: null, signals: [],
      };

  const safeModeReason = !vin
    ? SafeModeReason.NO_VIN_MATCH
    : bestId
      ? SafeModeReason.LOW_PROFILE_CONFIDENCE
      : SafeModeReason.NO_VIN_MATCH;

  return {
    profile: fallbackProfile, safeMode: true,
    safeModeReason,
    confidence: bestConfidence, vin, make, modelYear, supportedPids,
    reason,
  };
}
