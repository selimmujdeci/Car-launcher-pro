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
  getOBDDataSnapshot, getObdSessionHealth, getObdFreshWindowMs, getLinkLossLedger,
} from '../obdService';
import { getObdHealth } from '../obd/ObdHealthMonitor';
import {
  LINK_LOSS_CANDIDATE_LABEL, LINK_LOSS_GAP_LABEL, type LinkLossCandidate,
} from '../obd/linkLossLedger';
import type { AdRawSnapshot } from './adapterDiagnosticsModel';

/** Sayı okuma — sahte 0 ÜRETMEZ (E-21). Alan yoksa `null`. */
function _num(v: unknown): number | null {
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
  /* #536: kopma kanıt defteri — SALT-OKUNUR ve senkron; reconnect TETİKLEMEZ. */
  const loss   = _safe(() => getLinkLossLedger());

  return {
    readAt,

    transport: trans ? {
      transport:            String(trans.transport),
      connected:            trans.connected === true,
      reconnectAttempts:    _num(trans.reconnectAttempts),
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

    /* DİSİPLİN TUTARLILIĞI (envanter denetimi E-21): bu dosya `-1` sentinel'ini
       iki kritik alan için bilinçle koruyordu ama ALTI sayacı `|| 0` ile sahte
       sıfıra düşürüyordu — üstelik model o sıfırlar üzerinden gerekçe cümlesi
       kuruyordu ("0 reconnect denemesi oldu"). Artık okunamayan sayaç `null`. */
    lifecycle: life ? {
      resetRequestedCount:     _num(life.resetRequestedCount),
      resetCompletedCount:     _num(life.resetCompletedCount),
      disconnectCalledCount:   _num(life.disconnectCalledCount),
      reconnectRequestedCount: _num(life.reconnectRequestedCount),
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
      reconnectPressure: _num(health.reconnectPressure),
      /** Hiç veri görmemiş alanlar haritada YOKTUR → sayısı da dürüst bir sinyaldir. */
      reliabilityFieldCount: health.sensorReliability
        ? Object.keys(health.sensorReliability).length
        : null,
    } : null,

    /* #536 — kopma kanıtı. Etiketler saf modelin KENDİ sözlüğünden gelir;
       bu katman ikinci bir adlandırma/sınıflandırma otoritesi KURMAZ. */
    linkLoss: loss ? {
      total:                loss.summary.total,
      dominant:             loss.summary.dominant !== null
        ? LINK_LOSS_CANDIDATE_LABEL[loss.summary.dominant] : null,
      unknownCount:         loss.summary.unknownCount,
      pendingRecoveryCount: loss.summary.pendingRecoveryCount,
      medianRecoveryMs:     loss.summary.medianRecoveryMs,
      maxRecoveryMs:        loss.summary.maxRecoveryMs,
      nextMeasurement:      loss.summary.nextMeasurement !== null
        ? LINK_LOSS_GAP_LABEL[loss.summary.nextMeasurement] : null,
      candidates: (Object.keys(loss.summary.byCandidate) as LinkLossCandidate[])
        .filter((k) => loss.summary.byCandidate[k] > 0)
        .map((k) => ({ key: k, count: loss.summary.byCandidate[k] })),
      lastNote: loss.records.length > 0 ? loss.records[loss.records.length - 1].note : null,
      lastAtMs: loss.records.length > 0 ? loss.records[loss.records.length - 1].atMs : null,
    } : null,
  };
}
