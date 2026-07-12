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

import { getOBDStatusSnapshot, getOBDDataSnapshot, getTransportStats } from './obdService';
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
import { getVoltageStats } from './power/BatteryProtectionService';
import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';
import { useHALStatusStore } from './vehicleDataLayer/halStatusStore';
import type { SignalSource } from './vehicleDataLayer/valTypes';
import {
  getBootTimingSnapshot as _getBootTimingSnapshot,
  type BootTimingSnapshot,
} from './bootTimingRecorder';
// Platform runtime wiring — YALNIZ bounded status accessor'ları (import YAN ETKİSİZ:
// bu modüller çağrılmadan bus/adapter YARATMAZ; teşhis okuma runtime instance oluşturmaz).
import { getEventBusStatus } from './system/platformCoreEventBusWiring';
import { getVehicleHalWiringStatus } from './system/platformCoreVehicleHalWiring';
import { getVehicleHalBridgeStatus } from './system/platformCoreVehicleHalBridgeWiring';

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

/* ── GÜÇ / AKÜ SAĞLIĞI ───────────────────────────────────────── */

export interface PowerSnapshot {
  /** Voltajın geldiği kaynak — CAN gövde veriyolu OBD'den önceliklidir (daha evrensel). */
  source: 'CAN' | 'OBD' | 'none';
  /** 12V akü voltajı (V) — kaynak yoksa null (sahte değer YASAK). */
  voltageV: number | null;
  severity: 'critical' | 'low' | 'normal' | 'unknown';
  /** Alternatör şarj ediyor gibi görünüyor mu (voltaj eşik üstü). */
  charging: boolean;
  /** Son 10sn penceresinde min/max — ani düşüş (marş/güç sorunu) işareti. Örnek yoksa null. */
  stats: { minV: number; maxV: number; sampleCount: number; windowMs: number } | null;
}

// Eşikler (task-spec): kritik <11.8V · düşük <12.2V · normal 12.2–14.8V · şarj >13.2V.
const VOLT_CRITICAL_V = 11.8;
const VOLT_LOW_V      = 12.2;
const VOLT_CHARGING_V = 13.2;

export function buildPowerSnapshot(): PowerSnapshot {
  // CAN (gövde veriyolu, ProfileSignalGate → UnifiedVehicleStore.canBatteryVolt)
  const canV = _safe(() => useUnifiedVehicleStore.getState().canBatteryVolt, null as number | null);
  // OBD (PID 0x42 ATRV, obdSanitizer → OBDData.batteryVoltage; -1 = desteklenmiyor)
  const obdV = _safe(() => getOBDDataSnapshot().batteryVoltage, undefined as number | undefined);

  let source: PowerSnapshot['source'] = 'none';
  let voltageV: number | null = null;
  if (canV != null && Number.isFinite(canV) && canV > 0) {
    source = 'CAN'; voltageV = canV;
  } else if (obdV != null && Number.isFinite(obdV) && obdV > 0 && obdV !== -1) {
    source = 'OBD'; voltageV = obdV;
  }

  let severity: PowerSnapshot['severity'] = 'unknown';
  if (voltageV != null) {
    severity = voltageV < VOLT_CRITICAL_V ? 'critical' : voltageV < VOLT_LOW_V ? 'low' : 'normal';
  }

  return {
    source,
    voltageV,
    severity,
    charging: voltageV != null && voltageV > VOLT_CHARGING_V,
    stats: _safe(() => getVoltageStats(), null),
  };
}

/* ── SENSÖR FÜZYON TUTARLILIĞI ───────────────────────────────── */

export interface FusionSnapshot {
  /** VehicleCompute worker'ın seçtiği aktif hız kaynağı (HAL/CAN/OBD/GPS/FUSED). */
  activeSource: string;
  /** GPS Doppler hızı (km/h) — fix yoksa null. */
  gpsSpeedKmh: number | null;
  /** Donanım (OBD ham PID) hızı (km/h) — desteklenmiyorsa null. */
  vehicleSpeedKmh: number | null;
  /** İki kaynak arası mutlak fark (km/h) — ikisi de yoksa null. */
  diffKmh: number | null;
  /** Zero-trust güven rozeti: fark büyüdükçe düşer; tek kaynak varsa 'unknown'. */
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  drActive: boolean;
}

const FUSION_DIFF_HIGH_KMH = 5;   // ≤5 km/h fark → yüksek güven
const FUSION_DIFF_MED_KMH  = 15;  // ≤15 km/h fark → orta güven, üstü düşük

export function buildFusionSnapshot(): FusionSnapshot {
  const activeSource = _safe<SignalSource | null>(
    () => useHALStatusStore.getState().activeSource, null,
  ) ?? 'none';

  const gpsState = _safe(() => getGPSState(), { location: null } as ReturnType<typeof getGPSState>);
  const gpsSpeedRawMs = gpsState.location?.speed;
  const gpsSpeedKmh = typeof gpsSpeedRawMs === 'number' && Number.isFinite(gpsSpeedRawMs)
    ? Math.round(gpsSpeedRawMs * 3.6 * 10) / 10
    : null;

  const obdSpeedRaw = _safe(() => getOBDDataSnapshot().speed, -1);
  const vehicleSpeedKmh = typeof obdSpeedRaw === 'number' && obdSpeedRaw !== -1
    ? Math.round(obdSpeedRaw * 10) / 10
    : null;

  let diffKmh: number | null = null;
  let confidence: FusionSnapshot['confidence'] = 'unknown';
  if (gpsSpeedKmh != null && vehicleSpeedKmh != null) {
    diffKmh = Math.round(Math.abs(gpsSpeedKmh - vehicleSpeedKmh) * 10) / 10;
    confidence = diffKmh <= FUSION_DIFF_HIGH_KMH ? 'high'
      : diffKmh <= FUSION_DIFF_MED_KMH ? 'medium' : 'low';
  }

  return {
    activeSource,
    gpsSpeedKmh,
    vehicleSpeedKmh,
    diffKmh,
    confidence,
    drActive: _safe(() => isDeadReckoningActive(), false),
  };
}

/* ── BOOT ZAMAN ÇİZELGESİ ────────────────────────────────────── */

export function buildBootTimingSnapshot(): BootTimingSnapshot {
  return _safe(() => _getBootTimingSnapshot(), { waves: [], totalMs: 0, slowestWave: null });
}

/* ── TRANSPORT / BAĞLANTI SAĞLIĞI ────────────────────────────── */

export interface TransportSnapshot {
  /** Aktif transport — CAN (gövde) OBD-BT transport'undan önceliklidir. */
  transport: string;
  connected: boolean;
  /** Oturum boyu OBD reconnect deneme sayısı. */
  reconnectAttempts: number;
  /** Son kopma/hata nedeni (kısa statik etiket) — hiç yoksa null. */
  lastDisconnectReason: string | null;
}

export function buildTransportSnapshot(): TransportSnapshot {
  const obd = _safe(() => getTransportStats(), {
    transport: 'none' as const, connected: false, reconnectAttempts: 0,
    lastDisconnectReason: null as string | null,
  });
  const canConnected = _safe(() => useHALStatusStore.getState().halConnected, false);

  if (canConnected) {
    return {
      transport: 'CAN', connected: true,
      reconnectAttempts: obd.reconnectAttempts, lastDisconnectReason: obd.lastDisconnectReason,
    };
  }
  return {
    transport: obd.transport, connected: obd.connected,
    reconnectAttempts: obd.reconnectAttempts, lastDisconnectReason: obd.lastDisconnectReason,
  };
}

/* ── PLATFORM RUNTIME (Event Bus + Vehicle HAL wiring) ───────── */

/**
 * Platform runtime wiring katmanlarının BOUNDED durum sayaçları (W4E).
 *
 * AMAÇ: "tek instance / tek abonelik / event sayaçları" gibi invaryantların cihazda
 * ADB, CDP veya geçici global debug expose OLMADAN okunabilmesi.
 *
 * YALNIZ SAYAÇ VE DURUM: event payload'ı · event history içeriği · topic detayı ·
 * correlation/causation · VIN · fingerprint · koordinat · MAC · CAN frame · ham hex ·
 * araç sinyal DEĞERLERİ (hız/RPM/konum) · stack trace BURAYA GİRMEZ. Runtime status
 * nesnesi asla doğrudan spread EDİLMEZ — her alan tek tek whitelist'lenir.
 *
 * "0" ile "ölçülemiyor" AYRIDIR: wiring yoksa sayaçlar `null` döner (0 değil).
 * `lastErrorCode` kaynaktaki SABİT kod kümesinden gelir (serbest metin/stack değil).
 *
 * ⚠️ Bridge (Vehicle HAL → Event Bus) üretimde HENÜZ BAĞLI DEĞİL ve status accessor'ı
 * YOK → bridge bölümü ÜRETİLMEZ (sahte "started"/present üretmek yerine W4C'ye bırakıldı).
 *
 * FAIL-SOFT: accessor throw ederse bölüm `present:false` + null sayaçlarla döner ve
 * raporun diğer bölümleri ETKİLENMEZ. Import YAN ETKİSİZ: wiring modülleri yalnız
 * accessor sağlar, çağrılmaları runtime instance YARATMAZ.
 */
export interface PlatformEventBusDiag {
  present: boolean;
  disposed: boolean;
  publishedCount: number | null;
  deliveredCount: number | null;
  droppedCount: number | null;
  listenerErrorCount: number | null;
  duplicateSubscriptionCount: number | null;
  recursionDropCount: number | null;
  activeListenerCount: number | null;
  retainedEventCount: number | null;
  historyCount: number | null;
  lastEventAt: number | null;
  runtimeStartedPublished: boolean;
  runtimeStoppedPublished: boolean;
}

export interface PlatformHalWiringDiag {
  started: boolean;
  lastRefreshAt: number | null;
  refreshCount: number | null;
  ingestedSignalCount: number | null;
  activeSubscriptionCount: number | null;
  /** Sabit kod: 'init_failed' | 'cleanup_failed' | null (serbest metin/stack DEĞİL). */
  lastErrorCode: string | null;
}

/**
 * Vehicle HAL → Event Bus bridge (W4C). `present:false` = bridge RUNTIME'DA YOK
 * ("ölçülemiyor"); `present:true` + `publishedCount:0` = bridge var ama henüz event yok.
 * Bu ikisi KARIŞTIRILMAZ. Event payload'ı / signal id-değer listesi / topic detayı GİRMEZ.
 */
export interface PlatformHalBridgeDiag {
  present: boolean;
  started: boolean;
  disposed: boolean;
  publishedCount: number | null;
  droppedCount: number | null;
  lastPublishAt: number | null;
}

export interface PlatformRuntimeSnapshot {
  eventBus: PlatformEventBusDiag;
  halWiring: PlatformHalWiringDiag;
  halBridge: PlatformHalBridgeDiag;
}

const _EVENT_BUS_ABSENT: PlatformEventBusDiag = {
  present: false, disposed: false,
  publishedCount: null, deliveredCount: null, droppedCount: null, listenerErrorCount: null,
  duplicateSubscriptionCount: null, recursionDropCount: null, activeListenerCount: null,
  retainedEventCount: null, historyCount: null, lastEventAt: null,
  runtimeStartedPublished: false, runtimeStoppedPublished: false,
};

const _HAL_BRIDGE_ABSENT: PlatformHalBridgeDiag = {
  present: false, started: false, disposed: false,
  publishedCount: null, droppedCount: null, lastPublishAt: null,
};

const _HAL_WIRING_ABSENT: PlatformHalWiringDiag = {
  started: false, lastRefreshAt: null, refreshCount: null,
  ingestedSignalCount: null, activeSubscriptionCount: null, lastErrorCode: null,
};

/** Sayaç normalizasyonu: NaN/Infinity/negatif-olmayan olmayan → null (ölçülemiyor). */
function _count(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Zaman damgası: yalnız sonlu sayı (payload/metin YOK). */
function _ts(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Sabit hata kodu — bilinmeyen/serbest metin KABUL EDİLMEZ. */
function _errCode(v: unknown): string | null {
  return v === 'init_failed' || v === 'cleanup_failed' ? v : null;
}

export function buildPlatformRuntimeSnapshot(): PlatformRuntimeSnapshot {
  const bus = _safe<PlatformEventBusDiag>(() => {
    const s = getEventBusStatus();
    if (!s || s.present !== true) return _EVENT_BUS_ABSENT;   // wiring yok → sayaç YOK (0 değil)
    return {
      present: true,
      disposed: s.disposed === true,
      publishedCount:             _count(s.publishedCount),
      deliveredCount:             _count(s.deliveredCount),
      droppedCount:               _count(s.droppedCount),
      listenerErrorCount:         _count(s.listenerErrorCount),
      duplicateSubscriptionCount: _count(s.duplicateSubscriptionCount),
      recursionDropCount:         _count(s.recursionDropCount),
      activeListenerCount:        _count(s.activeListenerCount),
      retainedEventCount:         _count(s.retainedEventCount),
      historyCount:               _count(s.historyCount),
      lastEventAt:                _ts(s.lastEventAt),
      runtimeStartedPublished:    s.runtimeStartedPublished === true,
      runtimeStoppedPublished:    s.runtimeStoppedPublished === true,
    };
  }, _EVENT_BUS_ABSENT);

  const halWiring = _safe<PlatformHalWiringDiag>(() => {
    const s = getVehicleHalWiringStatus();
    if (!s || s.started !== true) return _HAL_WIRING_ABSENT;  // wiring yok/durmuş → sayaç YOK
    return {
      started: true,
      lastRefreshAt:           _ts(s.lastRefreshAt),
      refreshCount:            _count(s.refreshCount),
      ingestedSignalCount:     _count(s.ingestedSignalCount),
      activeSubscriptionCount: _count(s.activeSubscriptionCount),
      lastErrorCode:           _errCode(s.lastErrorCode),
    };
  }, _HAL_WIRING_ABSENT);

  const halBridge = _safe<PlatformHalBridgeDiag>(() => {
    const s = getVehicleHalBridgeStatus();
    if (!s || s.present !== true) return _HAL_BRIDGE_ABSENT;   // bridge yok → sayaç YOK (0 değil)
    return {
      present: true,
      started: s.started === true,
      disposed: s.disposed === true,
      publishedCount: _count(s.publishedCount),
      droppedCount:   _count(s.droppedCount),
      lastPublishAt:  _ts(s.lastPublishAt),
    };
  }, _HAL_BRIDGE_ABSENT);

  return { eventBus: bus, halWiring, halBridge };
}

/* ── util ────────────────────────────────────────────────────── */

function _safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}
