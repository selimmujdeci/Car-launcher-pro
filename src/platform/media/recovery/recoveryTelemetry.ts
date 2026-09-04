/**
 * recoveryTelemetry.ts — MUSIC F21 · Süreklilik kanıt deposu (bounded, salt gözlem).
 *
 * GİZLİLİK: parça/sanatçı adı · URI BURAYA GİRMEZ. Yalnız adet, sınıf ve karar.
 * OTORİTE SINIRI: sayaçlar hiçbir kurtarma kararına GERİ BESLENMEZ.
 */

import type { AutoResumeDecision, AutoResumeOutcome, EntryFreshness } from './recoveryModel';

export interface RecoveryCounters {
  /** Geri yükleme denemesi ve sonucu. */
  restoreAttempts: number;
  restoreSucceeded: number;
  restoreRejected: number;
  /**
   * Açılışta geri yükleme girişinin KAÇ KEZ koştuğu. Exactly-once sözleşmesi
   * gereği üretimde 1'i AŞAMAZ; >1 bir ARIZADIR.
   */
  bootRestoreRuns: number;
  /**
   * Native oturum HÂLÂ CANLI olduğu için geri yükleme ATLANDI. Bu bir hata
   * değildir: canlı native truth varken kayıttan ikinci bir kuyruk/oturum
   * kurmak duplicate authority olurdu (§1 · §13).
   */
  bootRestoreSkippedNativeLive: number;
  /** Geri yüklemede sınıflandırılan girdiler. */
  entriesLocal: number;
  entriesResolveAtPlay: number;
  /** Süresi dolmuş olabilecek uzak adres — DÜŞÜRÜLÜR. */
  entriesExpiringDropped: number;
  entriesUnknownDropped: number;
  /** Otomatik devam kararları. */
  autoResumeHold: number;
  autoResumeOffer: number;
  autoResumeResume: number;
  /** Kontak kanıtı ölçülemedi (uydurulmadı). */
  ignitionUnknown: number;
  /** Çevrimdışıyken ağ gerektiren kaynak istendi. */
  offlineBlocked: number;
}

const counters: RecoveryCounters = {
  restoreAttempts: 0, restoreSucceeded: 0, restoreRejected: 0,
  bootRestoreRuns: 0, bootRestoreSkippedNativeLive: 0,
  entriesLocal: 0, entriesResolveAtPlay: 0,
  entriesExpiringDropped: 0, entriesUnknownDropped: 0,
  autoResumeHold: 0, autoResumeOffer: 0, autoResumeResume: 0,
  ignitionUnknown: 0, offlineBlocked: 0,
};

let lastDecision: AutoResumeDecision | null = null;
let lastReason: AutoResumeOutcome['reason'] | null = null;
let lastIgnition: string | null = null;
let lastOnline: boolean | null = null;
let lastRestoreRejection: string | null = null;
let lastAtMs: number | null = null;

export function noteRestoreAttempt(succeeded: boolean, rejection: string | null): void {
  counters.restoreAttempts += 1;
  if (succeeded) counters.restoreSucceeded += 1; else counters.restoreRejected += 1;
  lastRestoreRejection = rejection;
}

/** Açılış geri yükleme girişinin koştuğunu kaydeder (exactly-once kanıtı). */
export function noteBootRestoreRun(): void { counters.bootRestoreRuns += 1; }

/** Native canlı olduğu için geri yükleme atlandı. */
export function noteBootRestoreSkippedNativeLive(): void {
  counters.bootRestoreSkippedNativeLive += 1;
}

export function noteEntryFreshness(freshness: EntryFreshness, dropped: boolean): void {
  if (freshness === 'LOCAL') counters.entriesLocal += 1;
  else if (freshness === 'RESOLVE_AT_PLAY') counters.entriesResolveAtPlay += 1;
  else if (dropped && freshness === 'EXPIRING_REMOTE') counters.entriesExpiringDropped += 1;
  else if (dropped) counters.entriesUnknownDropped += 1;
}

export function noteAutoResume(input: {
  readonly outcome: AutoResumeOutcome;
  readonly ignition: string;
  readonly online: boolean;
  readonly atMs: number;
}): void {
  const d = input.outcome.decision;
  if (d === 'HOLD') counters.autoResumeHold += 1;
  else if (d === 'OFFER') counters.autoResumeOffer += 1;
  else counters.autoResumeResume += 1;

  if (input.ignition === 'UNKNOWN') counters.ignitionUnknown += 1;
  if (input.outcome.reason === 'OFFLINE') counters.offlineBlocked += 1;

  lastDecision = d;
  lastReason = input.outcome.reason;
  lastIgnition = input.ignition;
  lastOnline = input.online;
  lastAtMs = Number.isFinite(input.atMs) ? input.atMs : null;
}

export interface RecoveryTelemetrySnapshot {
  readonly counters: Readonly<RecoveryCounters>;
  readonly lastDecision: AutoResumeDecision | null;
  readonly lastReason: AutoResumeOutcome['reason'] | null;
  readonly lastIgnition: string | null;
  readonly lastOnline: boolean | null;
  readonly lastRestoreRejection: string | null;
  readonly lastAtMs: number | null;
}

export function getRecoveryTelemetry(): RecoveryTelemetrySnapshot {
  return Object.freeze({
    counters: Object.freeze({ ...counters }),
    lastDecision, lastReason, lastIgnition, lastOnline, lastRestoreRejection, lastAtMs,
  });
}

export function _resetRecoveryTelemetryForTest(): void {
  (Object.keys(counters) as (keyof RecoveryCounters)[]).forEach((k) => { counters[k] = 0; });
  lastDecision = null; lastReason = null; lastIgnition = null;
  lastOnline = null; lastRestoreRejection = null; lastAtMs = null;
}
