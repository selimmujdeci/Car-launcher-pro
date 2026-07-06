/**
 * diagnosticSections — tanı raporunun "geniş" boyutları için toplayıcılar.
 *
 * Her biri mevcut servislerin snapshot'larını harmanlayıp PII'siz, kompakt bir
 * rapor bölümü üretir. Hepsi FAIL-SOFT: bir kaynak düşse bölüm yine döner
 * (kısmi > hiç). remoteLogService bunları support_snapshot payload'ına gömer,
 * IncidentCenter (/admin/tani) renkli gösterir.
 *
 * MERKEZİ + DÜŞÜK-TEMAS: alt sistemlere dokunmaz, yalnız okur.
 * PII yok — koordinat/VIN/plaka/MAC/token bölümlere hiç girmez.
 */

import { getOBDStatusSnapshot, getOBDDataSnapshot } from './obdService';
import { getObdHealth } from './obd/ObdHealthMonitor';
import { getSupportedPids, getPidValue } from './obd/extendedPidService';
import { getDTCStateSnapshot } from './dtcService';
import { getAiHealthSnapshot } from './aiHealth';
import { getProviderQuotaSnapshot } from './companion/companionChatProvider';
import { getGPSState, isDeadReckoningActive } from './gpsService';
import { getVoiceSnapshot, getLastSttOutcome } from './voiceService';
import { getWakeWordState, isVoskModelReady } from './wakeWordService';
import { getGeofenceStatus } from './security/geofenceService';
import { connectivityService } from './connectivityService';

/* ── OBD DERİN ───────────────────────────────────────────────── */

export interface ObdDeepSnapshot {
  adapter: {
    source: string; connectionState: string; vehicleType: string; lastSeenMs: number;
  };
  health: {
    connectionQuality: number; lastPacketAgeMs: number; reconnectPressure: number;
    sensorReliability: Record<string, number>;
  };
  /** Anahtar canlı sinyaller — geçersiz (-1) olanlar "yok" say. */
  live: Record<string, number>;
  extended: {
    discovered: boolean; supportedCount: number;
    samples: { pid: string; name: string; value: number; ageMs: number }[];
  };
  dtc: {
    count: number; isStale: boolean; error: string | null; lastReadAt: number | null;
    codes: { code: string; severity: string; system: string }[];
  };
}

// Genişlik-kaçağını önlemek için tavan (payload kompakt kalsın).
const MAX_EXT_SAMPLES = 8;
const MAX_DTC = 10;

// Canlı raporlanacak anahtar OBD alanları (EV+ICE karışık; -1 = yok/atla).
const LIVE_KEYS = [
  'speed', 'rpm', 'engineTemp', 'fuelLevel', 'throttle', 'intakeTemp',
  'boostPressure', 'batteryLevel', 'range', 'motorPower',
] as const;

export function buildObdDeepSnapshot(): ObdDeepSnapshot {
  const status = _safe(() => getOBDStatusSnapshot(), {
    connectionState: 'unknown', source: 'none', vehicleType: 'ice', lastSeenMs: 0,
  });
  const health = _safe(() => getObdHealth(), {
    connectionQuality: 0, lastPacketAgeMs: -1, reconnectPressure: 0,
    sensorReliability: {} as Record<string, number>,
  });

  const data = _safe(() => getOBDDataSnapshot(), null as ReturnType<typeof getOBDDataSnapshot> | null);
  const live: Record<string, number> = {};
  if (data) {
    for (const k of LIVE_KEYS) {
      const v = (data as unknown as Record<string, number>)[k];
      if (typeof v === 'number' && v !== -1) live[k] = Math.round(v * 10) / 10;
    }
  }

  const supported = _safe(() => getSupportedPids(), null as Set<string> | null);
  const now = Date.now();
  const samples: ObdDeepSnapshot['extended']['samples'] = [];
  if (supported) {
    let n = 0;
    for (const pid of supported) {
      if (n >= MAX_EXT_SAMPLES) break;
      const val = _safe(() => getPidValue(pid), undefined);
      if (val) {
        samples.push({
          pid, name: val.def?.name ?? pid,
          value: Number.isFinite(val.value) ? Math.round(val.value * 10) / 10 : NaN,
          ageMs: Math.max(0, now - (val.updatedAt ?? now)),
        });
        n++;
      }
    }
  }

  // DTC — yalnız PII'siz alanları al (description/possibleCauses BİLİNÇLİ dışarıda).
  let dtcCount = 0;
  let dtcIsStale = false;
  let dtcError: string | null = null;
  let dtcLastReadAt: number | null = null;
  let codes: { code: string; severity: string; system: string }[] = [];
  try {
    const s = getDTCStateSnapshot();
    dtcCount = s.codes.length;
    dtcIsStale = s.isStale;
    dtcError = s.error;
    dtcLastReadAt = s.lastReadAt;
    codes = s.codes.slice(0, MAX_DTC).map((c) => ({
      code: c.code, severity: c.severity, system: c.system,
    }));
  } catch { /* fail-soft — DTC kaynağı yoksa boş */ }

  return {
    adapter: {
      source: status.source, connectionState: status.connectionState,
      vehicleType: status.vehicleType, lastSeenMs: status.lastSeenMs,
    },
    health: {
      connectionQuality: health.connectionQuality,
      lastPacketAgeMs:   health.lastPacketAgeMs,
      reconnectPressure: Math.round((health.reconnectPressure ?? 0) * 100) / 100,
      sensorReliability: health.sensorReliability ?? {},
    },
    live,
    extended: {
      discovered: supported !== null,
      supportedCount: supported ? supported.size : 0,
      samples,
    },
    dtc: {
      count: dtcCount, isStale: dtcIsStale, error: dtcError,
      lastReadAt: dtcLastReadAt, codes,
    },
  };
}

/* ── AĞ / AI SAĞLIĞI ─────────────────────────────────────────── */

export interface NetAiSnapshot {
  online: boolean;
  ai: { healthy: boolean; consecFails: number; blockedForMs: number };
  quota: { geminiCooldownMs: number; groqCooldownMs: number; haikuCooldownMs: number };
}

export function buildNetAiSnapshot(): NetAiSnapshot {
  const online = _safe(
    () => (typeof navigator !== 'undefined' ? !!navigator.onLine : true), true,
  );
  const ai = _safe(() => getAiHealthSnapshot(), { healthy: true, consecFails: 0, blockedForMs: 0 });
  const quota = _safe(() => getProviderQuotaSnapshot(), {
    geminiCooldownMs: 0, groqCooldownMs: 0, haikuCooldownMs: 0,
  });
  return { online, ai, quota };
}

/* ── GPS DERİN ───────────────────────────────────────────────── */

export interface GpsDeepSnapshot {
  /** Konum izni durumu — 🔒 KOORDİNAT YOK (mahremiyet kilidi, CLAUDE.md). */
  permission: 'granted' | 'denied' | 'prompt' | 'unknown';
  /** Son fix'in yaşı (ms) — hiç fix yoksa -1. */
  fixAgeMs: number;
  /** GPS doğruluğu (metre) — fix yoksa -1. */
  accuracyM: number;
  source: string;
  drActive: boolean;
  tracking: boolean;
}

export async function buildGpsDeepSnapshot(): Promise<GpsDeepSnapshot> {
  const state = _safe(() => getGPSState(), {
    location: null, heading: null, isTracking: false, error: null,
    unavailable: false, source: null,
  } as ReturnType<typeof getGPSState>);

  // İzin durumu — Capacitor API'si yalnız native'de gerçek anlam taşır;
  // web/test ortamında (plugin kayıtsız) fail-soft 'unknown' döner.
  let permission: GpsDeepSnapshot['permission'] = 'unknown';
  try {
    const { Geolocation } = await import('@capacitor/geolocation');
    const perms = await Geolocation.checkPermissions();
    if (perms.location === 'granted' || perms.location === 'denied' || perms.location === 'prompt') {
      permission = perms.location;
    } else if (perms.location === 'prompt-with-rationale') {
      permission = 'prompt';
    }
  } catch { /* API yoksa/erişilemezse 'unknown' kalır (fail-soft) */ }

  const now = Date.now();
  const loc = state.location;
  const acc = loc?.accuracy;

  return {
    permission,
    fixAgeMs:  loc ? Math.max(0, now - loc.timestamp) : -1,
    accuracyM: loc && Number.isFinite(acc) ? Math.round(acc as number) : -1,
    source:    state.source ?? 'none',
    drActive:  _safe(() => isDeadReckoningActive(), false),
    tracking:  state.isTracking,
  };
}

/* ── SESLİ / STT ─────────────────────────────────────────────── */

export interface VoiceDiagSnapshot {
  voskReady: boolean;
  wakeWordEnabled: boolean;
  /** Anlık asistan durumu (idle/listening/processing/success/error/throttled). */
  status: string;
  /** Son STT sonucundan (başarı/hata) bu yana geçen süre — hiç olmadıysa -1. */
  lastSttAgeMs: number;
  /** Son STT sonucu başarılı mı — hiç olmadıysa null. Ham transkript YOK (PII). */
  lastSttOk: boolean | null;
}

export function buildVoiceSnapshot(): VoiceDiagSnapshot {
  const voskReady       = _safe(() => isVoskModelReady(), true);
  const wakeWordEnabled = _safe(() => getWakeWordState().enabled, false);
  const status          = _safe(() => getVoiceSnapshot().status as string, 'idle');
  const outcome         = _safe(() => getLastSttOutcome(), { atMs: -1, ok: null as boolean | null });

  return {
    voskReady,
    wakeWordEnabled,
    status,
    lastSttAgeMs: outcome.atMs >= 0 ? Date.now() - outcome.atMs : -1,
    lastSttOk:    outcome.ok,
  };
}

/* ── GÜVENLİ BÖLGE (GEOFENCE) ───────────────────────────────── */

export interface GeofenceDiagSnapshot {
  readState: string;
  zoneCount: number;
  cloudSync: boolean;
}

export function buildGeofenceSnapshot(): GeofenceDiagSnapshot {
  return _safe(() => getGeofenceStatus(), { readState: 'idle', zoneCount: 0, cloudSync: false });
}

/* ── DEPOLAMA + KUYRUK ───────────────────────────────────────── */

export interface StorageQueueSnapshot {
  queuePending: number;
  /** Kullanılan depolama yüzdesi (navigator.storage.estimate) — yoksa -1. */
  storagePct: number;
  storageWarn: boolean;
}

const STORAGE_WARN_PCT = 90;

export async function buildStorageQueueSnapshot(): Promise<StorageQueueSnapshot> {
  let queuePending = 0;
  try { queuePending = await connectivityService.queueSize(); } catch { /* fail-soft */ }

  let storagePct = -1;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (typeof est.usage === 'number' && typeof est.quota === 'number' && est.quota > 0) {
        storagePct = Math.round((est.usage / est.quota) * 100);
      }
    }
  } catch { /* storage API yoksa -1 kalır (fail-soft) */ }

  return {
    queuePending,
    storagePct,
    storageWarn: storagePct >= STORAGE_WARN_PCT,
  };
}

/* ── util ────────────────────────────────────────────────────── */

function _safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}
