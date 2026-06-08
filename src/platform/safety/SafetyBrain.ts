/**
 * SafetyBrain — VIN başına yerel risk profili (Supabase yok).
 *
 * Aynı FaultId 3 kez → ilgili FeatureId o VIN için devre dışı.
 * Kalıcılık: safeStorage `car-safety-brain-v1`
 */

import { normalizeVin } from '../expert/TrustEngine';
import { safeGetRaw, safeSetRaw } from '../../utils/safeStorage';
import { logError } from '../crashLogger';
import { useStore } from '../../store/useStore';
import { getHandshakeVin } from './vinContext';

export const SAFETY_BRAIN_STORAGE_KEY = 'car-safety-brain-v1';
export const NO_VIN_KEY               = '__NO_VIN__';

const STRIKE_THRESHOLD = 3;
const FLUSH_DEBOUNCE_MS = 8_000;

export type FaultId =
  | 'TILE_ROLLBACK'
  | 'MAP_TILE_CRC_FAIL'
  | 'OBD_DATA_GATE_TIMEOUT'
  | 'CORRIDOR_PREFETCH_TIMEOUT';

export type FeatureId =
  | 'corridorPrefetch'
  | 'offlineTileAutoRollback'
  | 'mapManifestIntegrityVerify'
  | 'obdDataGateAutoReconnect';

/** DiagnosticPanel / UI — devre dışı özellik etiketleri (Türkçe) */
export const FEATURE_LABEL_TR: Record<FeatureId, string> = {
  corridorPrefetch:            'Koridor ön getirme',
  offlineTileAutoRollback:     'Çevrimdışı harita karosu otomatik geri alma',
  mapManifestIntegrityVerify:  'Harita bildirimi bütünlük doğrulaması',
  obdDataGateAutoReconnect:    'OBD veri kapısı otomatik yeniden bağlanma',
};

const FAULT_TO_FEATURE: Record<FaultId, FeatureId> = {
  TILE_ROLLBACK:             'offlineTileAutoRollback',
  MAP_TILE_CRC_FAIL:         'mapManifestIntegrityVerify',
  OBD_DATA_GATE_TIMEOUT:     'obdDataGateAutoReconnect',
  CORRIDOR_PREFETCH_TIMEOUT: 'corridorPrefetch',
};

export interface VinSafetyProfile {
  counters: {
    rollback: number;
    timeout:  number;
    crc:      number;
  };
  faults: Record<string, { count: number; lastTs: number }>;
  disabledFeatures: FeatureId[];
  updatedAt: number;
}

export interface SafetyBrainRoot {
  schemaVersion: 1;
  profiles: Record<string, VinSafetyProfile>;
}

function emptyProfile(): VinSafetyProfile {
  return {
    counters:         { rollback: 0, timeout: 0, crc: 0 },
    faults:           {},
    disabledFeatures: [],
    updatedAt:        Date.now(),
  };
}

function defaultRoot(): SafetyBrainRoot {
  return { schemaVersion: 1, profiles: {} };
}

let _root: SafetyBrainRoot = defaultRoot();
let _flushTimer: ReturnType<typeof setTimeout> | null = null;

const _listeners = new Set<() => void>();

function notifySafetyListeners(): void {
  _listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

export function subscribeSafetyBrain(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

function bumpCounter(profile: VinSafetyProfile, fault: FaultId): void {
  if (fault === 'TILE_ROLLBACK') profile.counters.rollback += 1;
  else if (fault === 'OBD_DATA_GATE_TIMEOUT' || fault === 'CORRIDOR_PREFETCH_TIMEOUT') {
    profile.counters.timeout += 1;
  } else if (fault === 'MAP_TILE_CRC_FAIL') profile.counters.crc += 1;
}

function ensureProfile(vinKey: string): VinSafetyProfile {
  if (!_root.profiles[vinKey]) {
    _root.profiles[vinKey] = emptyProfile();
  }
  return _root.profiles[vinKey]!;
}

export function normalizeVinKey(vin: string | null | undefined): string {
  if (!vin) return NO_VIN_KEY;
  const n = normalizeVin(vin);
  if (!n || !/^[A-HJ-NPR-Z0-9]{17}$/.test(n)) return NO_VIN_KEY;
  return n;
}

/** Öncelik: aktif profil VIN → son handshake VIN → yer tutucu */
export function getCurrentVinKey(): string {
  const { settings } = useStore.getState();
  const activeId = settings.activeVehicleProfileId;
  if (activeId) {
    const p = settings.vehicleProfiles.find((x) => x.id === activeId);
    if (p?.vin) {
      const k = normalizeVinKey(p.vin);
      if (k !== NO_VIN_KEY) return k;
    }
  }
  const h = getHandshakeVin();
  if (h) {
    const k = normalizeVinKey(h);
    if (k !== NO_VIN_KEY) return k;
  }
  return NO_VIN_KEY;
}

export function isFeatureEnabled(feature: FeatureId): boolean {
  const vinKey = getCurrentVinKey();
  const prof   = _root.profiles[vinKey];
  if (!prof) return true;
  return !prof.disabledFeatures.includes(feature);
}

/** DiagnosticPanel vb. — geçerli VIN profilinde devre dışı kalan özellik uyarı metinleri */
export function listSafetyDisabledFeatureWarnings(): string[] {
  const vinKey = getCurrentVinKey();
  const prof   = _root.profiles[vinKey];
  if (!prof || prof.disabledFeatures.length === 0) return [];
  return prof.disabledFeatures.map((fid) => {
    const label = FEATURE_LABEL_TR[fid] ?? fid;
    // #7: Devre dışı bırakma KALICIDIR (tekrarlayan arıza → STRIKE_THRESHOLD); yalnız
    // araç profili sıfırlanınca geri gelir. Otomatik zaman-recovery yok → "geçici" demiyoruz.
    return `Güvenlik nedeniyle ${label} özelliği kapatıldı (tekrarlayan arıza tespiti).`;
  });
}

export function recordFault(faultId: FaultId): void {
  const vinKey = getCurrentVinKey();
  const profile  = ensureProfile(vinKey);
  const now      = Date.now();

  bumpCounter(profile, faultId);

  const prev = profile.faults[faultId] ?? { count: 0, lastTs: 0 };
  profile.faults[faultId] = { count: prev.count + 1, lastTs: now };
  profile.updatedAt = now;

  const feat = FAULT_TO_FEATURE[faultId];
  if (profile.faults[faultId]!.count >= STRIKE_THRESHOLD && !profile.disabledFeatures.includes(feat)) {
    profile.disabledFeatures.push(feat);
    notifySafetyListeners();
    logError('SafetyBrain:featureDisabled', new Error(`${feat} devre dışı (VIN ${vinKey}, ${faultId}×${STRIKE_THRESHOLD})`));
  }

  scheduleFlush();
}

export function resetVinProfile(vin: string): void {
  const k = normalizeVinKey(vin);
  delete _root.profiles[k];
  notifySafetyListeners();
  scheduleFlush();
}

function scheduleFlush(): void {
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    try {
      safeSetRaw(SAFETY_BRAIN_STORAGE_KEY, JSON.stringify(_root));
    } catch (e) {
      logError('SafetyBrain:flush', e);
    }
  }, FLUSH_DEBOUNCE_MS);
}

export function hydrateSafetyBrainFromStorage(): void {
  const raw = safeGetRaw(SAFETY_BRAIN_STORAGE_KEY);
  if (!raw) {
    _root = defaultRoot();
    notifySafetyListeners();
    return;
  }
  try {
    const parsed = JSON.parse(raw) as SafetyBrainRoot;
    if (parsed?.schemaVersion !== 1 || typeof parsed.profiles !== 'object' || parsed.profiles === null) {
      _root = defaultRoot();
    } else {
      _root = { schemaVersion: 1, profiles: { ...parsed.profiles } };
    }
  } catch {
    _root = defaultRoot();
  }
  notifySafetyListeners();
}

/** Testler: bellek + depo sıfırlama */
export function __unsafeResetSafetyBrainForTests(): void {
  _root = defaultRoot();
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  notifySafetyListeners();
}

export function __unsafeGetRootForTests(): SafetyBrainRoot {
  return _root;
}

/** Test / kritik flush — debounce zamanlayıcısını atlar */
export function __unsafeFlushSafetyBrainForTests(): void {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  try {
    safeSetRaw(SAFETY_BRAIN_STORAGE_KEY, JSON.stringify(_root));
  } catch (e) {
    logError('SafetyBrain:flush', e);
  }
}
