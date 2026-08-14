/**
 * sessionInspectorSources.ts — MEVCUT senkron snapshot getter'larının tek okuma noktası.
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · YALNIZ SENKRON getter çağrılır. Hiçbir async native pull yapılmaz
 *    (ör. `refreshKwpRecoveryEvidence()` BİLEREK çağrılmaz — o "Tanı Gönder"
 *    akışına aittir; buradan tetiklemek salt-okunurluğu bozardı).
 *  · Hiçbir servis BAŞLATILMAZ/DURDURULMAZ, hiçbir abonelik açılmaz.
 *  · Hiçbir bağlantı/reconnect/reset/recovery/komut yolu tetiklenmez.
 *  · Her okuma try/catch içindedir; kaynak patlarsa `null` döner → ekran
 *    o alanı UNAVAILABLE gösterir (uydurma YOK).
 *  · Yeni global store / singleton / birleşik session engine KURULMAZ.
 */

import {
  getOBDStatusSnapshot, getOBDDataSnapshot, getObdSessionHealth,
  getObdConnLifecycle, getTransportStats, getHandshakeDiagnostics, getObdFreshWindowMs,
  getObdFirstDataTiming,
} from '../obdService';
import { getObdHealth } from '../obd/ObdHealthMonitor';
import { getKwpRecoveryEvidence } from '../obd/kwpRecoveryEvidence';
import { useHALStatusStore } from '../vehicleDataLayer/halStatusStore';
import { getConnectivitySnapshot } from '../canBus/VehicleConnectivityManager';
import { getDevtoolsCaptureStatus } from './devtoolsCapture';
import { useDebugStore } from '../debug';
import type { SessionRawSnapshot } from './sessionInspectorBuild';

/** Halka tamponunun bilinen üst sınırı (debugStore ringPush sabiti). */
const TRAFFIC_BUFFER_MAX = 500;

/** Sayı okuma — sahte 0 ÜRETMEZ (E-19). Alan yoksa `null`. */
function _numOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function _safe<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

/**
 * Tüm kaynakların TEK seferlik senkron okuması. Bounded: yalnız sabit sayıda
 * skaler alan kopyalanır (ham telemetri dizisi/geçmiş taşınmaz).
 */
export function readSessionRawSnapshot(): SessionRawSnapshot {
  const readAt = Date.now();

  const status = _safe(() => getOBDStatusSnapshot());
  const data   = _safe(() => getOBDDataSnapshot());
  const sess   = _safe(() => getObdSessionHealth());
  const life   = _safe(() => getObdConnLifecycle());
  const trans  = _safe(() => getTransportStats());
  const hs     = _safe(() => getHandshakeDiagnostics());
  const health = _safe(() => getObdHealth());
  const fresh  = _safe(() => getObdFreshWindowMs());
  const kwp    = _safe(() => getKwpRecoveryEvidence());
  const hal    = _safe(() => useHALStatusStore.getState());
  const conn   = _safe(() => getConnectivitySnapshot());
  const cap    = _safe(() => getDevtoolsCaptureStatus());
  const dbg    = _safe(() => useDebugStore.getState());

  return {
    readAt,

    obdStatus: status ? {
      connectionState: String(status.connectionState),
      source:          String(status.source),
      vehicleType:     String(status.vehicleType),
      lastSeenMs:      Number(status.lastSeenMs) || 0,
    } : null,

    obdData: data ? {
      transportConnected: data.transportConnected === true,
      dataFresh:          data.dataFresh === true,
      lastRxAt:           Number(data.lastRxAt) || 0,
      lastSeenMs:         Number(data.lastSeenMs) || 0,
      source:             String(data.source),
      connectionState:    String(data.connectionState),
    } : null,

    sessionHealth: sess ? {
      transportReady: sess.transportReady === true,
      sessionReady:   sess.sessionReady === true,
      pollingActive:  sess.pollingActive === true,
      dataFresh:      sess.dataFresh === true,
      ready:          sess.ready === true,
    } : null,

    /* #526 — İLK VERİYE KADAR SÜRE. Saha şikâyeti "ilk 2 dakika veri yok"
       bugüne dek ÖLÇÜLEMİYORDU; artık iddia kanıtlanabilir/çürütülebilir. */
    firstDataTiming: _safe(() => getObdFirstDataTiming()) ?? null,

    connLifecycle: life ? {
      resetRequestedCount:     Number(life.resetRequestedCount) || 0,
      resetCompletedCount:     Number(life.resetCompletedCount) || 0,
      disconnectCalledCount:   Number(life.disconnectCalledCount) || 0,
      reconnectRequestedCount: Number(life.reconnectRequestedCount) || 0,
      lastResetReason:         life.lastResetReason ?? null,
      lastResetAt:             Number(life.lastResetAt) || 0,
      lastDisconnectAt:        Number(life.lastDisconnectAt) || 0,
      lastReconnectAt:         Number(life.lastReconnectAt) || 0,
      connectionState:         String(life.connectionState),
      lastEcuDataAgeMs:        typeof life.lastEcuDataAgeMs === 'number' ? life.lastEcuDataAgeMs : -1,
    } : null,

    transportStats: trans ? {
      transport:            String(trans.transport),
      connected:            trans.connected === true,
      reconnectAttempts:    Number(trans.reconnectAttempts) || 0,
      lastDisconnectReason: trans.lastDisconnectReason ?? null,
    } : null,

    handshake: hs ? {
      outcome:              String(hs.outcome),
      ranAt:                typeof hs.ranAt === 'number' ? hs.ranAt : null,
      vinPresent:           hs.vinPresent === true,
      vinClass:             hs.vinClass ?? null,
      bitmapClass:          hs.bitmapClass ?? null,
      readBlocksCount:      Array.isArray(hs.readBlocks) ? hs.readBlocks.length : 0,
      supportedCount:       Number(hs.supportedCount) || 0,
      failReason:           hs.failReason ?? null,
      timeoutStage:         hs.timeoutStage ?? null,
      durationMs:           typeof hs.durationMs === 'number' ? hs.durationMs : null,
      protocolTried:        hs.protocolTried ?? null,
      protocolActive:       hs.protocolActive ?? null,
      lastSuccessAt:        typeof hs.lastSuccessAt === 'number' ? hs.lastSuccessAt : null,
      reconnectReason:      hs.reconnectReason ?? null,
      reconnectHistoryCount: Array.isArray(hs.reconnectHistory) ? hs.reconnectHistory.length : 0,
    } : null,

    health: health ? {
      connectionQuality: Number(health.connectionQuality),
      lastLinkPacketAgeMs: Number(health.lastPacketAgeMs),
      isStale:           health.isStale === true,
      reconnectPressure: Number(health.reconnectPressure) || 0,
    } : null,

    freshWindowMs: typeof fresh === 'number' && Number.isFinite(fresh) ? fresh : null,

    /* SAHTE SIFIR YASAĞI (E-19 ile aynı kusur, ikinci okuma noktası): native
       alan yoksa sayaç `null` taşınır — "0 kez oldu" ile "ölçülemedi" ayrı. */
    kwp: kwp ? {
      status:                   String(kwp.status),
      coreNoDataStreak:         _numOrNull(kwp.coreNoDataStreak),
      maxCoreNoDataStreak:      _numOrNull(kwp.maxCoreNoDataStreak),
      recoveryCount:            _numOrNull(kwp.recoveryCount),
      suppressedCount:          _numOrNull(kwp.suppressedCount),
      atpcSendFailures:         _numOrNull(kwp.atpcSendFailures),
      lastRecoveryAt:           _numOrNull(kwp.lastRecoveryAt),
      lastRecoveryToFirstPidMs: _numOrNull(kwp.lastRecoveryToFirstPidMs),
      killedByDataGate:         _numOrNull(kwp.killedByDataGate),
      protocolAtRecovery:       kwp.protocolAtRecovery ?? null,
      threshold:                _numOrNull(kwp.threshold),
      maxPerSession:            _numOrNull(kwp.maxPerSession),
    } : null,

    hal: hal ? {
      halConnected:  hal.halConnected === true,
      halConf:       Number(hal.halConf) || 0,
      activeSource:  hal.activeSource ?? null,
      canPhase:      String(hal.canPhase),
      canRetryCount: Number(hal.canRetryCount) || 0,
      canAlive:      hal.sourceHealth ? hal.sourceHealth.canAlive : null,
      obdAlive:      hal.sourceHealth ? hal.sourceHealth.obdAlive : null,
      gpsAlive:      hal.sourceHealth ? hal.sourceHealth.gpsAlive : null,
      sourceHealthUpdatedAtMono: hal.sourceHealth ? hal.sourceHealth.updatedAt : null,
    } : null,

    connectivity: conn ? Object.values(conn).map((c) => ({
      source:       String(c.source),
      available:    c.available === true,
      connected:    c.connected === true,
      confidence:   Number(c.confidence) || 0,
      lastSignalAt: Number(c.lastSignalAt) || 0,
      errorReason:  c.errorReason ?? null,
    })) : null,

    capture: cap ? { obdRefs: Number(cap.obdRefs) || 0, canRefs: Number(cap.canRefs) || 0 } : null,

    debug: dbg ? {
      collecting:       dbg.collecting === true,
      trafficBufferLen: Array.isArray(dbg.obdTrafficLog) ? dbg.obdTrafficLog.length : 0,
      trafficBufferMax: TRAFFIC_BUFFER_MAX,
      listenerCount:    Number(dbg.perf?.listenerCount) || 0,
      obdDropped:       Number(dbg.perf?.obdDropped) || 0,
      hzCountersWritten: false,
      fallbackWritten:   false,
    } : null,
  };
}
