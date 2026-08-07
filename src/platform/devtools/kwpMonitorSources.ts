/**
 * kwpMonitorSources.ts — KWP İzleyici'nin TEK okuma noktası (Faz A4).
 *
 * ── PAZARLIKSIZ SINIRLAR (Session Inspector ile AYNI sözleşme) ──────────────
 *  · YALNIZ SENKRON getter çağrılır. Async native pull BURADA yapılmaz.
 *  · Hiçbir servis BAŞLATILMAZ/DURDURULMAZ, hiçbir abonelik açılmaz.
 *  · Hiçbir bağlantı/reconnect/reset/recovery/AT komutu yolu tetiklenmez.
 *    (KWP kurtarması NATIVE'dedir; bu modül onu ne tetikler ne de değiştirir.)
 *  · Her okuma try/catch içindedir; kaynak patlarsa `null` → alan UNAVAILABLE.
 *  · Yeni global store / singleton / KWP oturum motoru KURULMAZ.
 *
 * `classifyProtocol` / `isSlowSerialProtocol` SAF fonksiyonlardır (protocolProfile);
 * çağrılmaları hiçbir yan etki üretmez.
 */

import {
  getOBDDataSnapshot, getObdSessionHealth, getHandshakeDiagnostics, getObdFreshWindowMs,
} from '../obdService';
import { getKwpRecoveryEvidence } from '../obd/kwpRecoveryEvidence';
import { classifyProtocol, isSlowSerialProtocol } from '../obd/protocolProfile';
import type { KwpRawSnapshot } from './kwpMonitorModel';

function _safe<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

/**
 * Tüm kaynakların TEK seferlik senkron okuması. Bounded: yalnız sabit sayıda skaler
 * alan kopyalanır (ham telemetri/geçmiş dizileri taşınmaz).
 */
export function readKwpRawSnapshot(): KwpRawSnapshot {
  const readAt = Date.now();

  const data  = _safe(() => getOBDDataSnapshot());
  const sess  = _safe(() => getObdSessionHealth());
  const hs    = _safe(() => getHandshakeDiagnostics());
  const fresh = _safe(() => getObdFreshWindowMs());
  const kwp   = _safe(() => getKwpRecoveryEvidence());

  const protocolActive = hs?.protocolActive ?? null;
  // Protokol BİLİNMİYORSA sınıf da uygulanabilirlik de null kalır — CAN VARSAYILMAZ.
  const known = typeof protocolActive === 'string' && protocolActive.trim() !== ''
    && classifyProtocol(protocolActive) !== 'unknown';

  return {
    readAt,

    protocolActive,
    protocolTried:  hs?.protocolTried ?? null,
    protocolClass:  known ? classifyProtocol(protocolActive) : null,
    slowSerial:     known ? isSlowSerialProtocol(protocolActive) : null,

    transportConnected: data ? data.transportConnected === true : null,
    connectionState:    data ? String(data.connectionState) : null,
    dataFresh:          data ? data.dataFresh === true : null,
    lastRxAt:           data && Number(data.lastRxAt) > 0 ? Number(data.lastRxAt) : null,

    freshWindowMs: typeof fresh === 'number' && Number.isFinite(fresh) && fresh > 0 ? fresh : null,
    pollingActive: sess ? sess.pollingActive === true : null,

    recovery: kwp ? {
      status:                   String(kwp.status),
      coreNoDataStreak:         Number(kwp.coreNoDataStreak) || 0,
      maxCoreNoDataStreak:      Number(kwp.maxCoreNoDataStreak) || 0,
      recoveryCount:            Number(kwp.recoveryCount) || 0,
      suppressedCount:          Number(kwp.suppressedCount) || 0,
      atpcSendFailures:         Number(kwp.atpcSendFailures) || 0,
      lastRecoveryAt:           Number(kwp.lastRecoveryAt) || 0,
      lastRecoveryToFirstPidMs: typeof kwp.lastRecoveryToFirstPidMs === 'number' ? kwp.lastRecoveryToFirstPidMs : -1,
      killedByDataGate:         Number(kwp.killedByDataGate) || 0,
      protocolAtRecovery:       kwp.protocolAtRecovery ?? null,
      threshold:                Number(kwp.threshold) || 0,
      maxPerSession:            Number(kwp.maxPerSession) || 0,
    } : null,
  };
}
