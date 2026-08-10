/**
 * adapterDiagnosticsSources.ts — Adaptör Tanılama'nın TEK okuma noktası (Faz A6).
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · YALNIZ SENKRON, YAN ETKİSİZ getter. Araca/adaptöre AT veya OBD komutu YOK.
 *  · reconnect / reset / recovery / disconnect TETİKLENMEZ.
 *  · Hiçbir servis başlatılmaz, abonelik/timer açılmaz.
 *  · Her okuma try/catch içinde; kaynak patlarsa `null` → alan KAYNAK YOK.
 *  · Yeni store/singleton/sağlık motoru KURULMAZ.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 *  `OBDData.deviceName` adaptörün Bluetooth adıdır ve bu katmandan DIŞARI ÇIKMAZ:
 *  yalnız VARLIĞI (`adapterNamePresent: boolean`) taşınır. Repo'nun kendi
 *  `getTransportStats()` fonksiyonu da aynı gerekçeyle adres/cihaz adını bilinçli
 *  olarak DIŞARIDA bırakır ("uzak log gizlilik kuralı") — o çizgi burada korunur.
 *  MAC / adres / seri numarası taşıyan HİÇBİR alan bu snapshot'ta yoktur.
 *
 * ── İKİ AYRI SAĞLIK MOTORU ──────────────────────────────────────────────────
 *  `obdService` (adaptif tazelik penceresi) ve `ObdHealthMonitor` (MUTLAK 4 sn
 *  donma eşiği) AYRI motorlardır ve farklı hüküm verebilirler. Bu katman ikisini
 *  BİRLEŞTİRMEZ; ayrı alanlar olarak taşır, model çelişkiyi açıkça gösterir.
 */

import {
  getTransportStats, getObdConnLifecycle, getOBDStatusSnapshot,
  getOBDDataSnapshot, getObdSessionHealth, getObdFreshWindowMs,
} from '../obdService';
import { getObdHealth } from '../obd/ObdHealthMonitor';
import type { AdRawSnapshot } from './adapterDiagnosticsModel';

function _safe<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

/**
 * Tüm kaynakların TEK seferlik senkron okuması.
 *
 * SENTINEL KORUNUR (model dürüst karar verebilsin diye ham hâliyle taşınır):
 *   · `lastPacketAgeMs === -1` → hiç paket YOK (0 ms DEĞİL)
 *   · `connectionQuality === -1` → bağlantı hiç kurulmadı (0 puan DEĞİL)
 *   · `lastSeenMs / lastRxAt / lastResetAt … === 0` → damga YOK (epoch 0 DEĞİL)
 */
export function readAdapterDiagnosticsSnapshot(): AdRawSnapshot {
  const readAt = Date.now();

  const trans  = _safe(() => getTransportStats());
  const life   = _safe(() => getObdConnLifecycle());
  const status = _safe(() => getOBDStatusSnapshot());
  const data   = _safe(() => getOBDDataSnapshot());
  const sess   = _safe(() => getObdSessionHealth());
  const fresh  = _safe(() => getObdFreshWindowMs());
  const health = _safe(() => getObdHealth());

  return {
    readAt,

    transport: trans ? {
      transport:            String(trans.transport),
      connected:            trans.connected === true,
      reconnectAttempts:    Number(trans.reconnectAttempts) || 0,
      lastDisconnectReason: trans.lastDisconnectReason ?? null,
    } : null,

    status: status ? {
      connectionState: String(status.connectionState),
      source:          String(status.source),
      vehicleType:     String(status.vehicleType),
      // Duvar saati damgası; 0 = hiç görülmedi → null (epoch 0 DEĞİL).
      lastSeenAt:      Number(status.lastSeenMs) > 0 ? Number(status.lastSeenMs) : null,
    } : null,

    data: data ? {
      transportConnected: data.transportConnected === true,
      dataFresh:          data.dataFresh === true,
      lastRxAt:           Number(data.lastRxAt) > 0 ? Number(data.lastRxAt) : null,
      /* GİZLİLİK: adaptör adının KENDİSİ taşınmaz — yalnız var olup olmadığı. */
      adapterNamePresent: typeof data.deviceName === 'string' && data.deviceName.length > 0,
    } : null,

    session: sess ? {
      transportReady: sess.transportReady === true,
      sessionReady:   sess.sessionReady === true,
      pollingActive:  sess.pollingActive === true,
      dataFresh:      sess.dataFresh === true,
      ready:          sess.ready === true,
    } : null,

    freshWindowMs: typeof fresh === 'number' && Number.isFinite(fresh) && fresh > 0 ? fresh : null,

    lifecycle: life ? {
      resetRequestedCount:     Number(life.resetRequestedCount) || 0,
      resetCompletedCount:     Number(life.resetCompletedCount) || 0,
      disconnectCalledCount:   Number(life.disconnectCalledCount) || 0,
      reconnectRequestedCount: Number(life.reconnectRequestedCount) || 0,
      lastResetReason:         life.lastResetReason ?? null,
      lastResetAt:             Number(life.lastResetAt) > 0 ? Number(life.lastResetAt) : null,
      lastDisconnectAt:        Number(life.lastDisconnectAt) > 0 ? Number(life.lastDisconnectAt) : null,
      lastReconnectAt:         Number(life.lastReconnectAt) > 0 ? Number(life.lastReconnectAt) : null,
      // -1 sentinel AYNEN korunur — model "hiç paket yok" ile "0 ms" ayrımını yapar.
      /* #517: ECU verisi yaşı (ATRV HARİÇ) — link paketiyle KARIŞTIRILMAZ. */
      lastEcuDataAgeMs:        typeof life.lastEcuDataAgeMs === 'number' ? life.lastEcuDataAgeMs : -1,
    } : null,

    health: health ? {
      // -1 sentinel AYNEN korunur — "hiç bağlanmadı" ile "kalite 0" AYRI şeydir.
      connectionQuality: typeof health.connectionQuality === 'number' ? health.connectionQuality : -1,
      /* #517: LINK paketi (ATRV DAHİL) — ECU verisi yaşıyla KARIŞTIRILMAZ. */
      lastLinkPacketAgeMs: typeof health.lastPacketAgeMs === 'number' ? health.lastPacketAgeMs : -1,
      isStale:           health.isStale === true,
      reconnectPressure: Number(health.reconnectPressure) || 0,
      /** Hiç veri görmemiş alanlar haritada YOKTUR → sayısı da dürüst bir sinyaldir. */
      reliabilityFieldCount: health.sensorReliability
        ? Object.keys(health.sensorReliability).length
        : null,
    } : null,
  };
}
