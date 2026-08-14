/**
 * mediaAuthoritySources.ts — CAROS LAB · Medya Otoritesi TEK okuma katmanı.
 *
 * Desen (A3–A8 turlarıyla aynı): senkron getter'lar, her biri kendi try/catch'i
 * içinde. HİÇBİR komut göndermez, hiçbir şeyi başlatmaz, timer kurmaz.
 *
 * GİZLİLİK (CLAUDE.md gözlemlenebilirlik kuralı 6): parça başlığı · sanatçı ·
 * URI · kapak · kullanıcı verisi BU KATMANDAN GEÇMEZ. Yalnız VAR/YOK, ADET,
 * durum kodu ve süre okunur.
 */

import { getSnapshot } from '../media/authority/nativeAuthorityBridge';
import {
  getMediaAuthorityEvidence, type MediaAuthorityEvidence,
} from '../media/authority/mediaAuthorityEvidence';
import { getActiveSource, getActiveDuckReasons, getEffectiveVolume } from '../media/authority/mediaCommandGateway';
import { readPersistedRaw, decideRecovery } from '../media/authority/mediaRecovery';
import { reconcileQueue, type QueueDrift } from '../media/authority/queueReconciliation';
import { getUiQueueView } from '../media/carosMediaLayer';
import { isKnownSourceClass } from '../media/authority/sourceCapabilities';
import { getProjectedQueueView } from '../media/authority/mediaAuthorityRuntime';
import {
  getLastRecovery, getRecoveryLedger,
} from '../media/authority/queueRecoveryRuntime';
import {
  isHandoverInFlight, isUserCommandInFlight, getAuthorityGeneration,
} from '../media/authority/mediaCommandGateway';
import { getMediaEvents, type MediaEvent } from '../media/authority/mediaAuthorityEvents';
import {
  summarize, latestResults,
  type ScenarioResult, type ValidationSummary,
} from '../media/authority/deviceValidationModel';
import { listSessions, getActiveSession } from '../media/authority/deviceValidationStore';
import { isNative } from '../bridge';

/** Native tarafın bildirdiği ham durum — hiçbir alan uydurulmaz. */
export interface MediaAuthorityRawSnapshot {
  readonly readAt: number;
  readonly isNativePlatform: boolean;
  /** Native servis erişilebilir mi (false → diğer alanlar ANLAMSIZ). */
  readonly authorityAvailable: boolean;
  readonly activeSourceNative: string;
  readonly activeSourceGateway: string | null;
  readonly focusState: string;
  readonly hasAudioFocus: boolean | null;
  readonly userPaused: boolean | null;
  readonly pausedByFocus: boolean | null;
  readonly playing: boolean;
  readonly playWhenReady: boolean | null;
  readonly renderingVerified: boolean;
  readonly buffering: boolean | null;
  readonly audioRoute: string;
  readonly noisyReceiverActive: boolean | null;
  readonly duckVolume: number | null;
  readonly duckReasonsNative: readonly string[];
  readonly duckReasonsGateway: readonly string[];
  readonly effectiveVolumeNative: number | null;
  readonly effectiveVolumeGateway: number | null;
  readonly userVolumeNative: number | null;
  readonly queueRevision: number | null;
  readonly queueLength: number | null;
  readonly currentIndex: number | null;
  readonly positionMs: number | null;
  readonly durationMs: number | null;
  readonly shuffle: boolean | null;
  readonly repeat: string;
  readonly lastPauseReason: string;
  readonly lastFailureCode: string;
  readonly recoveryCountNative: number | null;
  /** Parça başlığı DEĞİL — yalnız "metadata var mı" bilgisi. */
  readonly hasTrackMetadata: boolean;
  readonly evidence: MediaAuthorityEvidence;
  /** Kalıcı kurtarma kaydının kararı (içeriği DEĞİL). */
  readonly recoveryDecision: string;
  readonly recoveryItemCount: number | null;
  /* ── Kuyruk uzlaştırma (projeksiyon ↔ native timeline) ────────────────── */
  readonly uiQueueRevision: number | null;
  readonly uiQueueLength: number | null;
  readonly uiQueueIndex: number | null;
  /** Native'e GÖNDERİLEN pencere — uzlaştırmanın gerçek girdisi. */
  readonly projectedRevision: number | null;
  readonly projectedLength: number | null;
  readonly projectedIndex: number | null;
  readonly queueDrift: QueueDrift;
  readonly queueDriftReason: string;
  /* ── PAKET B · Kurtarma ───────────────────────────────────────────────── */
  readonly recoveryOutcome: string;
  readonly recoveryAction: string;
  readonly recoveryCode: string;
  readonly recoveryReason: string;
  readonly recoveryAtMs: number | null;
  /** Devre kesici açık olan sapma imzası sayısı. */
  readonly recoveryBreakersOpen: number;
  readonly recoveryLedgerSize: number;
  readonly handoverInFlight: boolean;
  readonly userCommandInFlight: boolean;
  readonly authorityGeneration: number | null;
  /* ── PAKET B · Olay izi ───────────────────────────────────────────────── */
  readonly eventTotal: number;
  readonly eventDropped: number;
  readonly eventCapacity: number;
  readonly recentEvents: readonly MediaEvent[];
  /* ── PAKET B · Cihaz doğrulama ────────────────────────────────────────── */
  readonly validationSummary: ValidationSummary;
  readonly validationActiveState: string;
  readonly validationActiveScenario: string;
  readonly validationResults: Readonly<Record<string, ScenarioResult>>;
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

/** Açılışta / elle YENİLE'de çağrılan TEK okuma. */
export function readMediaAuthoritySnapshot(): MediaAuthorityRawSnapshot {
  const readAt = Date.now();
  const s = safe(() => getSnapshot(), {
    authorityAvailable: false, activeSource: 'NONE', focusState: 'NONE',
    audioRoute: 'UNKNOWN', playing: false, renderingVerified: false,
  });

  const recovery = safe(() => {
    const decision = decideRecovery(readPersistedRaw(), readAt);
    return decision.action === 'NONE'
      ? { label: `YOK (${decision.reason})`, count: null as number | null }
      : { label: 'DURAKLATILMIŞ GERİ YÜKLEME', count: decision.state.items.length };
  }, { label: 'OKUNAMADI', count: null as number | null });

  /* Kuyruk uzlaştırma. GİRDİ: native'e GÖNDERİLEN pencere (UI'nin tamamı DEĞİL).
     Yerel müzikte UI kuyruğu binlerce parça olabilirken native'e 120'lik pencere
     yazılır; tüm listeyle karşılaştırma SÜREKLİ yanlış "uzunluk sapması" üretirdi.
     Projeksiyon okunamazsa sonuç "uyumlu" DEĞİL, KARŞILAŞTIRILAMADI olur. */
  const uiQueue = safe(() => getUiQueueView(), null);
  const projected = safe(() => getProjectedQueueView(), null);
  const reconciliation = safe(() => reconcileQueue(
    projected
      ? {
        revision: projected.revision,
        length: projected.length,
        currentIndex: projected.currentIndex,
        source: projected.source,
        currentItemId: projected.currentItemId,
      }
      : null,
    s.authorityAvailable === true
      ? {
        revision: s.queueRevision ?? 0,
        length: s.queueLength ?? 0,
        currentIndex: s.currentIndex ?? -1,
        source: isKnownSourceClass(s.activeSource) ? s.activeSource : null,
        currentItemId: s.currentTrackId ? s.currentTrackId : null,
      }
      : null,
  ), {
    drift: 'UNKNOWN' as QueueDrift,
    authoritative: 'none' as const,
    reason: 'Uzlaştırma okunamadı.',
  });

  /* PAKET B kaynakları — her biri kendi try/catch'i içinde, hiçbiri komut GÖNDERMEZ. */
  const lastRecovery = safe(() => getLastRecovery(), null);
  const ledger = safe(() => getRecoveryLedger(), { entries: [] as const });
  const events = safe(() => getMediaEvents(), {
    events: [] as readonly MediaEvent[], capacity: 0, dropped: 0, total: 0,
  });
  const sessions = safe(() => listSessions(), [] as const);
  const validation = safe(() => summarize(sessions), {
    total: 0, pass: 0, fail: 0, blocked: 0, notRun: 0,
    coveredScenarios: 0, totalScenarios: 0,
  });
  const results = safe(() => latestResults(sessions), {} as Record<string, ScenarioResult>);
  const activeSession = safe(() => getActiveSession(), null);

  return {
    readAt,
    isNativePlatform: safe(() => isNative, false),
    authorityAvailable: s.authorityAvailable === true,
    activeSourceNative: s.activeSource ?? 'NONE',
    activeSourceGateway: safe(() => getActiveSource(), null),
    focusState: s.focusState ?? 'NONE',
    hasAudioFocus: s.hasAudioFocus ?? null,
    userPaused: s.userPaused ?? null,
    pausedByFocus: s.pausedByFocus ?? null,
    playing: s.playing === true,
    playWhenReady: s.playWhenReady ?? null,
    renderingVerified: s.renderingVerified === true,
    buffering: s.buffering ?? null,
    audioRoute: s.audioRoute ?? 'UNKNOWN',
    noisyReceiverActive: s.noisyReceiver ?? null,
    duckVolume: s.duckVolume ?? null,
    duckReasonsNative: s.duckReasons ?? [],
    duckReasonsGateway: safe(() => getActiveDuckReasons(), []),
    effectiveVolumeNative: s.effectiveVolume ?? null,
    effectiveVolumeGateway: safe(() => getEffectiveVolume(), null),
    userVolumeNative: s.userVolume ?? null,
    queueRevision: s.queueRevision ?? null,
    queueLength: s.queueLength ?? null,
    currentIndex: s.currentIndex ?? null,
    positionMs: s.positionMs ?? null,
    durationMs: s.durationMs ?? null,
    shuffle: s.shuffle ?? null,
    repeat: s.repeat ?? 'off',
    lastPauseReason: s.lastPauseReason ?? '',
    lastFailureCode: s.lastFailureCode ?? '',
    recoveryCountNative: s.recoveryCount ?? null,
    // Başlık/sanatçının KENDİSİ değil, yalnız varlığı taşınır.
    hasTrackMetadata: Boolean(s.title) || Boolean(s.artist),
    evidence: safe(() => getMediaAuthorityEvidence(), {
      status: 'UNAVAILABLE',
      counters: {
        commandsTotal: 0, verified: 0, acceptedUnverified: 0, failed: 0,
        timedOut: 0, superseded: 0, rejected: 0, duplicateBackendDetected: 0,
        recoveryCount: 0, recoverySucceeded: 0,
        handoverTotal: 0, handoverFailed: 0,
      },
      sourceSwitchLatencyMs: null,
      playStartLatencyMs: null,
      lastFailure: null,
      recentCommands: [],
      recordCapacity: 0,
    }),
    recoveryDecision: recovery.label,
    recoveryItemCount: recovery.count,
    uiQueueRevision: uiQueue ? uiQueue.revision : null,
    uiQueueLength: uiQueue ? uiQueue.length : null,
    uiQueueIndex: uiQueue ? uiQueue.currentIndex : null,
    projectedRevision: projected ? projected.revision : null,
    projectedLength: projected ? projected.length : null,
    projectedIndex: projected ? projected.currentIndex : null,
    queueDrift: reconciliation.drift,
    queueDriftReason: reconciliation.reason,

    recoveryOutcome: lastRecovery ? lastRecovery.outcome : 'HENÜZ ÇALIŞMADI',
    recoveryAction: lastRecovery ? lastRecovery.decision.action : '',
    recoveryCode: lastRecovery ? lastRecovery.decision.code : '',
    recoveryReason: lastRecovery ? lastRecovery.decision.reason : '',
    recoveryAtMs: lastRecovery ? lastRecovery.appliedAtMs : null,
    recoveryBreakersOpen: ledger.entries.filter(
      (e) => e.breakerOpenUntilMs !== null && e.breakerOpenUntilMs > readAt,
    ).length,
    recoveryLedgerSize: ledger.entries.length,
    handoverInFlight: safe(() => isHandoverInFlight(), false),
    userCommandInFlight: safe(() => isUserCommandInFlight(), false),
    authorityGeneration: safe(() => getAuthorityGeneration(), null),

    eventTotal: events.total,
    eventDropped: events.dropped,
    eventCapacity: events.capacity,
    // Bounded: LAB yalnız SON 30 olayı görür (render maliyeti + bellek).
    recentEvents: events.events.slice(-30),

    validationSummary: validation,
    validationActiveState: activeSession ? activeSession.state : 'idle',
    validationActiveScenario: activeSession ? activeSession.scenarioId : '',
    validationResults: results,
  };
}
