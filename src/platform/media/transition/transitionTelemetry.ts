/**
 * transitionTelemetry.ts — MUSIC F20 · Geçiş kanıt deposu (bounded, salt gözlem).
 *
 * GİZLİLİK: parça/sanatçı adı · URI BURAYA GİRMEZ. Yalnız adet, karar kodu ve süre.
 * OTORİTE SINIRI: sayaçlar hiçbir geçiş kararına GERİ BESLENMEZ.
 */

import type { TransitionKind, TransitionReason } from './transitionModel';

export interface TransitionCounters {
  decisions: number;
  gapless: number;
  fade: number;
  none: number;
  /** Neden uygulanmadı. */
  skippedDisabled: number;
  skippedLive: number;
  skippedDuck: number;
  /** Süre GERÇEK ölçüme dayanarak seçildi. */
  evidenceBacked: number;
  /** Native'e politika yazımı: kabul · reddedildi · yazılamadı. */
  pushAccepted: number;
  pushRejected: number;
  pushFailed: number;
  /** Politika DEĞİŞMEDİĞİ için yazılmadı (gereksiz komut yok). */
  unchangedSkipped: number;
  /** Kullanıcı tercihi kalıcılığı. */
  persistWriteFailures: number;
  persistLoadRejected: number;
}

const counters: TransitionCounters = {
  decisions: 0, gapless: 0, fade: 0, none: 0,
  skippedDisabled: 0, skippedLive: 0, skippedDuck: 0,
  evidenceBacked: 0,
  pushAccepted: 0, pushRejected: 0, pushFailed: 0, unchangedSkipped: 0,
  persistWriteFailures: 0, persistLoadRejected: 0,
};

let lastKind: TransitionKind | null = null;
let lastReason: TransitionReason | null = null;
let lastFadeMs: number | null = null;
let lastAtMs: number | null = null;

export function noteTransitionDecision(input: {
  readonly kind: TransitionKind;
  readonly reason: TransitionReason;
  readonly fadeMs: number;
  readonly evidenceBacked: boolean;
  readonly atMs: number;
}): void {
  counters.decisions += 1;
  if (input.kind === 'GAPLESS') counters.gapless += 1;
  else if (input.kind === 'FADE') counters.fade += 1;
  else counters.none += 1;

  if (input.reason === 'DISABLED') counters.skippedDisabled += 1;
  else if (input.reason === 'LIVE_CONTENT') counters.skippedLive += 1;
  else if (input.reason === 'DUCK_ACTIVE') counters.skippedDuck += 1;

  if (input.evidenceBacked) counters.evidenceBacked += 1;

  lastKind = input.kind;
  lastReason = input.reason;
  lastFadeMs = input.fadeMs;
  lastAtMs = Number.isFinite(input.atMs) ? input.atMs : null;
}

export function noteTransitionPush(kind: 'ACCEPTED' | 'REJECTED' | 'FAILED' | 'UNCHANGED'): void {
  if (kind === 'ACCEPTED') counters.pushAccepted += 1;
  else if (kind === 'REJECTED') counters.pushRejected += 1;
  else if (kind === 'FAILED') counters.pushFailed += 1;
  else counters.unchangedSkipped += 1;
}

export function noteTransitionPersistFailure(): void { counters.persistWriteFailures += 1; }
export function noteTransitionPersistRejected(): void { counters.persistLoadRejected += 1; }

export interface TransitionTelemetrySnapshot {
  readonly counters: Readonly<TransitionCounters>;
  readonly lastKind: TransitionKind | null;
  readonly lastReason: TransitionReason | null;
  readonly lastFadeMs: number | null;
  readonly lastAtMs: number | null;
}

export function getTransitionTelemetry(): TransitionTelemetrySnapshot {
  return Object.freeze({
    counters: Object.freeze({ ...counters }),
    lastKind, lastReason, lastFadeMs, lastAtMs,
  });
}

export function _resetTransitionTelemetryForTest(): void {
  (Object.keys(counters) as (keyof TransitionCounters)[]).forEach((k) => { counters[k] = 0; });
  lastKind = null; lastReason = null; lastFadeMs = null; lastAtMs = null;
}
