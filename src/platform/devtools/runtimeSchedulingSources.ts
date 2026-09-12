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
import { getPollCostSnapshot, getPollCostRefreshedAt } from '../obd/pollCost';
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
      /* B2 · NİYET ile SON TUR gözlemi AYRI taşınır (tek alan iki anlamı eziyordu). */
      burstIntent:        typeof poll.burstIntent === 'boolean' ? poll.burstIntent : null,
      lastCycleWasBurst:  typeof poll.lastCycleWasBurst === 'boolean' ? poll.lastCycleWasBurst : null,
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

    /* ── P0-VDK-B3 · POLL MALİYETİ (salt-okunur) ──────────────────────────
       Native `PollCostLedger`ın ZATEN ölçtüğü sayaçlar. Bu okuma hiçbir OBD/AT
       komutu TETİKLEMEZ; önbellek yalnız LAB yenilemesinde doldurulur (mevcut
       `pollEvidence` deseniyle birebir aynı). */
    pollCost:            _safe(() => getPollCostSnapshot()) ?? null,
    /* B3 · BÜTÇE ve AÇLIK telemetrisi — native `AdaptivePidScheduler`ın ZATEN
       ürettiği sayaçlar. Bugüne kadar köprüden geçiyor ama LAB'a hiç TAŞINMIYORDU
       (`deferredTotal`/`lineBudgetMs` yalnız tipte vardı, hiçbir ekran okumuyordu). */
    schedulerBudget: _safe(() => {
      const sc = poll && poll.present ? poll.scheduler : null;
      if (!sc) return null;
      const pids = Array.isArray(sc.pids) ? sc.pids : [];
      return {
        activePollCount:    Number(sc.activePollCount) || 0,
        deferredTotal:      Number(sc.deferredTotal) || 0,
        recoveryPauseCount: Number(sc.recoveryPauseCount) || 0,
        lineBudgetMs:       Number(sc.lineBudgetMs) || 0,
        /* Açlık kanıtı: yaşlanma birikmiş PID adedi ve en uzun bekleyen. */
        agingPidCount:      pids.filter((x) => Number(x.agingMs ?? 0) > 0).length,
        maxAgingMs:         pids.reduce((m, x) => Math.max(m, Number(x.agingMs ?? 0)), 0),
        maxAgeMs:           pids.reduce((m, x) => Math.max(m, Number(x.maxAgeMs) || 0), 0),
        deadlineMissTotal:  pids.reduce((m, x) => m + (Number(x.deadlineMisses) || 0), 0),
        /* Eski APK bu alanı taşımaz → `null` (ölçülmedi), 0 DEĞİL. */
        notYetDueTotal:     pids.some((x) => x.notYetDue === undefined)
          ? null
          : pids.reduce((m, x) => m + (Number(x.notYetDue) || 0), 0),
        neverSucceededCount: pids.filter((x) => (Number(x.successes) || 0) === 0).length,
        pidCount:           pids.length,
      };
    }) ?? null,
    pollCostRefreshedAt: _safe(() => getPollCostRefreshedAt()) ?? null,

    extGate: gate ? {
      supportedKnown:   gate.supportedKnown === true,
      supportedCount:   Number(gate.supportedCount) || 0,
      watchedCount:     Number(gate.watchedCount) || 0,
      gatedCount:       Number(gate.gatedCount) || 0,
      gatedPids:        Array.isArray(gate.gatedPids) ? gate.gatedPids.slice(0, 16).map(String) : [],
      /* ── E · BOUNDED LİSTE KENDİNİ AÇIKLASIN ────────────────────────────
         SAHA (2026-08-30 · TAM KOPYA): `gatedCount: 25` ile 16 elemanlı
         `gatedPids` YAN YANA çıktı. Kırpma bilgisi YALNIZ LAB ekranının
         "Bounded liste (≤16)" notundaydı; kopyaya TAŞINMIYORDU → kopyayı tek
         başına okuyan SAHTE BİR ÇELİŞKİ görüyordu. Sayılar artık listenin
         yanında yolculuk eder. */
      gatedPidsShown:     Array.isArray(gate.gatedPids)
        ? Math.min(gate.gatedPids.length, 16) : 0,
      gatedPidsTotal:     Array.isArray(gate.gatedPids)
        ? gate.gatedPids.length : (Number(gate.gatedCount) || 0),
      gatedPidsTruncated: Array.isArray(gate.gatedPids) && gate.gatedPids.length > 16,
      discoveryPending: Number(gate.discoveryPending) || 0,
      nativeListCount:  Number(gate.nativeListCount) || 0,
      burst:            gate.burst === true,
      /* P0-OBD-CORE-06: kanıtın BÜTÜNLÜĞÜ. Eski APK bu alanı taşımaz →
         'not_run' (dürüst boşluk); sahte 'complete' ÜRETİLMEZ. */
      discoveryCompleteness:
        gate.discoveryCompleteness === 'complete' || gate.discoveryCompleteness === 'incomplete'
          ? gate.discoveryCompleteness
          : 'not_run',
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
      /* #642 — tavan sayacı; eski APK vermezse null kalır (BİLİNMİYOR). */
      consecutiveFailedRecoveries: _num(kwp.consecutiveFailedRecoveries),
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
