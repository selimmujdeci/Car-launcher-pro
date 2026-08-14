/**
 * runtimeSchedulingSources.ts — MEVCUT yan etkisiz senkron getter'ların tek okuma noktası.
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · YALNIZ senkron + YAN ETKİSİZ getter çağrılır.
 *  · `refreshExtendedPollEvidence()` ve `refreshKwpRecoveryEvidence()` ASYNC native
 *    PULL'dur → BİLEREK çağrılmaz (önbellek neyse o okunur, boşsa UNAVAILABLE).
 *  · `getLiveDiscoveryCoordinator()` tekil nesneyi TEMBEL OLUŞTURUR (üretim modül
 *    durumunu değiştirir) → BİLEREK çağrılmaz; ilgili alan UNSAFE_TO_OBSERVE'dur.
 *    Bu yüzden `discoveryLive` bu dosyada IMPORT DAHİ EDİLMEZ.
 *  · Hiçbir motor başlatılmaz/durdurulmaz, hiçbir komut gönderilmez, hiçbir
 *    zamanlayıcı kurulmaz, kuyruk boşaltılmaz.
 *  · Her okuma try/catch içindedir; kaynak patlarsa null → ekran UNAVAILABLE gösterir.
 */

import { getOBDStatusSnapshot, getObdSessionHealth, getHandshakeDiagnostics, getObdFreshWindowMs } from '../obdService';
import { getObdHealth } from '../obd/ObdHealthMonitor';
import { getExtendedPollEvidence, getPollEvidenceRefreshedAt } from '../obd/extendedPollEvidence';
import { getExtendedGateState } from '../obd/extendedPidService';
import { getExtendedElimination, getExtendedEliminationState,
         getExtendedEliminationRefreshedAt } from '../obd/extendedElimination';
import {
  readExtendedTimeline, summarizeExtendedTimeline,
} from '../obd/extendedPollTimeline';
import { getKwpRecoveryEvidence } from '../obd/kwpRecoveryEvidence';
import { deepScanRuntimeService } from '../deepScan/deepScanRuntimeService';
import { getDevtoolsCaptureStatus } from './devtoolsCapture';
import { useDebugStore } from '../debug';
import type { SchedRawSnapshot } from './runtimeSchedulingBuild';

/** debugStore halka tamponunun bilinen üst sınırı. */
const CAN_BUFFER_MAX = 500;

/**
 * Sayı okuma — **sahte 0 ÜRETMEZ** (bkz. E-19/E-22). Alan yoksa `null`.
 */
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

/** Tüm kanalların TEK seferlik senkron, yan etkisiz okuması. Bounded skaler kopya. */
export function readSchedRawSnapshot(): SchedRawSnapshot {
  const readAt = Date.now();

  const status = _safe(() => getOBDStatusSnapshot());
  const sess   = _safe(() => getObdSessionHealth());
  const hs     = _safe(() => getHandshakeDiagnostics());
  const fresh  = _safe(() => getObdFreshWindowMs());
  const health = _safe(() => getObdHealth());
  const poll   = _safe(() => getExtendedPollEvidence());
  // #506: JS-tarafı sorgu KAPISI — saf sayım, yan etkisi yok (native'e hiçbir şey gitmez).
  const gate   = _safe(() => getExtendedGateState());
  const kwp    = _safe(() => getKwpRecoveryEvidence());
  const deep   = _safe(() => deepScanRuntimeService.getSnapshot());
  const cap    = _safe(() => getDevtoolsCaptureStatus());
  const dbg    = _safe(() => useDebugStore.getState());
  /* #512 · saha hipotezi 2: eleme ↔ tazelik AYNI ZAMAN EKSENİNDE. Kaydedici zaten
     var olan olaylara iliştirilmiştir — burada hiçbir şey TETİKLENMEZ, yalnız okunur. */
  const tl     = _safe(() => {
    const samples = readExtendedTimeline();
    return { summary: summarizeExtendedTimeline(samples), tail: samples.slice(-12) };
  });

  return {
    readAt,

    pollEvidence: poll ? {
      present:            poll.present === true,
      evidenceComplete:   poll.evidenceComplete === true,
      cacheState:         poll.cacheState,
      evidenceState:      poll.evidenceState,
      // T6: kanıt yoksa NULL taşınır — `|| 0` sahte sıfır üretiyordu (bkz.
      // ExtendedPollEvidenceSnapshot.configuredPidCount yorumu).
      transport:          poll.transport ?? null,
      burstEnabled:       typeof poll.burstEnabled === 'boolean' ? poll.burstEnabled : null,
      configuredPidCount: typeof poll.configuredPidCount === 'number' ? poll.configuredPidCount : null,
      counters:           poll.counters ?? null,
      lastAttemptedPid:   poll.lastAttempts?.length ? poll.lastAttempts[poll.lastAttempts.length - 1].pid : null,
      lastSuccessfulPid:  poll.lastSuccessfulPid ?? null,
      lastOutcome:        poll.lastAttempts?.length ? poll.lastAttempts[poll.lastAttempts.length - 1].outcome : null,
      lastElapsedMs:      poll.lastAttempts?.length ? poll.lastAttempts[poll.lastAttempts.length - 1].elapsedMs : null,
      lastPollAt:         typeof poll.lastPollAt === 'number' && poll.lastPollAt > 0 ? poll.lastPollAt : null,
      decisionLabel:      String(poll.decision?.label ?? ''),
      /* T6 düzeltmesi BURAYA DA uygulandı (envanter denetimi E-22): yukarıdaki
         alanlar `null` taşırken bu blok `|| 0` ile sahte sıfır üretiyordu →
         modelin "null → UNAVAILABLE" kapısı tetiklenemez hâle geliyordu
         (yarım düzeltme). Artık okunamayan sayaç `null`dır. */
      js: {
        eventsReceived: _num(poll.js?.eventsReceived),
        decodeFailures: _num(poll.js?.decodeFailures),
        valuesStored:   _num(poll.js?.valuesStored),
        valuesCached:   _num(poll.js?.valuesCached),
      },
    } : null,

    /* #524 — ELEME DURUMU. `null` = OKUNMADI ("eleme yok" DEĞİL); durum ayrı
       alanda taşınır ki eski APK ile gerçek sıfır karışmasın. */
    elimState: getExtendedEliminationState(),
    /* #526 — SNAPSHOT YAŞI. Durum ('ok') tek başına yanıltıcıdır: 5 dakikalık
       bir önbellek de 'ok' der. Yaş olmadan okuyucu bayat veriyi canlı sanar. */
    elimRefreshedAt: _safe(() => getExtendedEliminationRefreshedAt()) ?? null,
    pollEvidenceRefreshedAt: _safe(() => getPollEvidenceRefreshedAt()) ?? null,
    elim: _safe(() => getExtendedElimination()) ?? null,

    extGate: gate ? {
      supportedKnown:   gate.supportedKnown === true,
      supportedCount:   Number(gate.supportedCount) || 0,
      watchedCount:     Number(gate.watchedCount) || 0,
      gatedCount:       Number(gate.gatedCount) || 0,
      gatedPids:        Array.isArray(gate.gatedPids) ? gate.gatedPids.slice(0, 16).map(String) : [],
      discoveryPending: Number(gate.discoveryPending) || 0,
      nativeListCount:  Number(gate.nativeListCount) || 0,
      burst:            gate.burst === true,
    } : null,

    timeline: tl ? {
      summary: tl.summary,
      tail: tl.tail.map((x) => ({
        atMs: x.atMs, watched: x.watched, demoted: x.demoted,
        pollable: x.pollable, valued: x.valued,
        avgAgeMs: x.avgAgeMs, maxAgeMs: x.maxAgeMs,
      })),
    } : null,

    sessionHealth: sess ? {
      pollingActive:  sess.pollingActive === true,
      dataFresh:      sess.dataFresh === true,
      transportReady: sess.transportReady === true,
      sessionReady:   sess.sessionReady === true,
    } : null,

    obdStatus: status ? {
      connectionState: String(status.connectionState),
      source:          String(status.source),
      lastSeenMs:      Number(status.lastSeenMs) || 0,
    } : null,

    health: health ? {
      isStale:         health.isStale === true,
      lastPacketAgeMs: typeof health.lastPacketAgeMs === 'number' ? health.lastPacketAgeMs : -1,
    } : null,

    freshWindowMs: typeof fresh === 'number' && Number.isFinite(fresh) ? fresh : null,

    handshake: hs ? {
      outcome:       String(hs.outcome),
      ranAt:         typeof hs.ranAt === 'number' ? hs.ranAt : null,
      durationMs:    typeof hs.durationMs === 'number' ? hs.durationMs : null,
      timeoutStage:  hs.timeoutStage ?? null,
      failReason:    hs.failReason ?? null,
      lastSuccessAt: typeof hs.lastSuccessAt === 'number' ? hs.lastSuccessAt : null,
    } : null,

    kwp: kwp ? {
      status:           String(kwp.status),
      recoveryCount:    _num(kwp.recoveryCount),
      maxPerSession:    _num(kwp.maxPerSession),
      suppressedCount:  _num(kwp.suppressedCount),
      atpcSendFailures: _num(kwp.atpcSendFailures),
      lastRecoveryAt:   _num(kwp.lastRecoveryAt),
      coreNoDataStreak: _num(kwp.coreNoDataStreak),
      threshold:        _num(kwp.threshold),
    } : null,

    deepScan: deep ? {
      status:          String(deep.status),
      phase:           deep.phase ?? null,
      progressPercent: Number(deep.progressPercent) || 0,
      startedAt:       typeof deep.startedAt === 'number' ? deep.startedAt : null,
      updatedAt:       typeof deep.updatedAt === 'number' ? deep.updatedAt : null,
      completedAt:     typeof deep.completedAt === 'number' ? deep.completedAt : null,
      warningsCount:   Array.isArray(deep.warnings) ? deep.warnings.length : 0,
      errorCode:       deep.errorCode ?? null,
    } : null,

    canCollect: dbg ? {
      collecting: dbg.collecting === true,
      bufferLen:  Array.isArray(dbg.canRawLog) ? dbg.canRawLog.length : 0,
      bufferMax:  CAN_BUFFER_MAX,
    } : null,

    capture: cap ? { obdRefs: Number(cap.obdRefs) || 0, canRefs: Number(cap.canRefs) || 0 } : null,
  };
}
