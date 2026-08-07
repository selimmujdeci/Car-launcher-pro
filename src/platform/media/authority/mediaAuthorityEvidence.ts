/**
 * mediaAuthorityEvidence.ts — MÜZİK HUB PAKET A · Bounded kanıt deposu.
 *
 * CLAUDE.md gözlemlenebilirlik kuralı: "gözlemlenemeyen özellik tamamlanmış
 * değildir." Bu modül CAROS LAB'ın okuyacağı SINIRLI, salt-okunur anlık
 * görüntüyü üretir.
 *
 * GİZLİLİK (kural 6): parça başlığı · sanatçı · URI · kapak · kullanıcı verisi
 * BURAYA GİRMEZ. Yalnız kaynak sınıfı, backend, komut adı, sonuç, hata kodu,
 * süre ve SAYILAR tutulur.
 *
 * DÜRÜSTLÜK (kural 5): bilinmeyen alan `UNKNOWN` kalır; sahte 0 / sahte
 * "sağlıklı" üretilmez.
 *
 * Bellek: sabit boyutlu halka tampon — sınırsız büyüme YOK.
 */

import type { CommandTruth } from './playbackTruth';
import type { SourceClass } from './sourceCapabilities';

/** Saklanan en fazla komut kaydı — bounded. */
export const MAX_TRUTH_RECORDS = 30;

/** Kayıtta tutulan sadeleştirilmiş komut izi (PII YOK). */
export interface TruthRecord {
  readonly commandId: string;
  readonly command: string;
  readonly sourceId: string;
  readonly backend: string;
  readonly desiredState: string;
  readonly observedState: string;
  readonly outcome: string;
  readonly verificationLevel: string;
  readonly elapsedMs: number;
  readonly failureCode: string | null;
  readonly retryable: boolean;
  readonly atMs: number;
}

interface Counters {
  commandsTotal: number;
  verified: number;
  acceptedUnverified: number;
  failed: number;
  timedOut: number;
  superseded: number;
  rejected: number;
  duplicateBackendDetected: number;
  recoveryCount: number;
  handoverTotal: number;
  handoverFailed: number;
}

const _records: TruthRecord[] = [];
const _counters: Counters = {
  commandsTotal: 0,
  verified: 0,
  acceptedUnverified: 0,
  failed: 0,
  timedOut: 0,
  superseded: 0,
  rejected: 0,
  duplicateBackendDetected: 0,
  recoveryCount: 0,
  handoverTotal: 0,
  handoverFailed: 0,
};

/** null = HENÜZ ÖLÇÜLMEDİ (sahte 0 değil). */
let _lastSourceSwitchLatencyMs: number | null = null;
let _lastPlayStartLatencyMs: number | null = null;
let _lastFailure: { code: string; command: string; atMs: number } | null = null;

export function recordTruth(t: CommandTruth): void {
  try {
    _counters.commandsTotal += 1;
    switch (t.outcome) {
      case 'VERIFIED':            _counters.verified += 1; break;
      case 'ACCEPTED_UNVERIFIED': _counters.acceptedUnverified += 1; break;
      case 'FAILED':              _counters.failed += 1; break;
      case 'TIMED_OUT':           _counters.timedOut += 1; break;
      case 'SUPERSEDED':          _counters.superseded += 1; break;
      case 'REJECTED':            _counters.rejected += 1; break;
      default: break;
    }

    if (t.failureCode) {
      _lastFailure = { code: t.failureCode, command: t.command, atMs: t.endedAtMs };
    }
    if (t.command === 'play' || t.command === 'playSource') {
      if (t.outcome === 'VERIFIED') _lastPlayStartLatencyMs = t.elapsedMs;
    }

    _records.push({
      commandId: t.commandId,
      command: t.command,
      sourceId: t.sourceId,
      backend: t.backend,
      desiredState: t.desiredState,
      observedState: t.observedState,
      outcome: t.outcome,
      verificationLevel: t.verificationLevel,
      elapsedMs: t.elapsedMs,
      failureCode: t.failureCode,
      retryable: t.retryable,
      atMs: t.endedAtMs,
    });
    while (_records.length > MAX_TRUTH_RECORDS) _records.shift();
  } catch { /* kanıt yazımı ASLA medya akışını bozmaz */ }
}

export function recordHandover(input: {
  ok: boolean;
  elapsedMs: number;
  target: SourceClass;
}): void {
  try {
    _counters.handoverTotal += 1;
    if (!input.ok) _counters.handoverFailed += 1;
    _lastSourceSwitchLatencyMs = input.elapsedMs;
  } catch { /* fail-soft */ }
}

/** Sözleşme ihlali: aynı anda 1'den fazla audible backend gözlendi. */
export function recordDuplicateBackend(): void {
  _counters.duplicateBackendDetected += 1;
}

export function recordRecovery(): void {
  _counters.recoveryCount += 1;
}

export type EvidenceStatus = 'OBSERVED' | 'DERIVED' | 'UNAVAILABLE' | 'STALE';

export interface MediaAuthorityEvidence {
  readonly status: EvidenceStatus;
  readonly counters: Readonly<Counters>;
  /** null = HENÜZ ÖLÇÜLMEDİ. */
  readonly sourceSwitchLatencyMs: number | null;
  readonly playStartLatencyMs: number | null;
  readonly lastFailure: { code: string; command: string; atMs: number } | null;
  readonly recentCommands: readonly TruthRecord[];
  readonly recordCapacity: number;
}

/**
 * Bounded anlık görüntü. `status`:
 *   OBSERVED     — en az bir komut gözlendi
 *   UNAVAILABLE  — hiç veri yok (uydurma "sağlıklı" DEĞİL)
 */
export function getMediaAuthorityEvidence(): MediaAuthorityEvidence {
  return {
    status: _counters.commandsTotal > 0 ? 'OBSERVED' : 'UNAVAILABLE',
    counters: { ..._counters },
    sourceSwitchLatencyMs: _lastSourceSwitchLatencyMs,
    playStartLatencyMs: _lastPlayStartLatencyMs,
    lastFailure: _lastFailure ? { ..._lastFailure } : null,
    recentCommands: _records.slice(),
    recordCapacity: MAX_TRUTH_RECORDS,
  };
}

/** Test/teardown — sayaçları ve halkayı sıfırlar. */
export function __resetEvidenceForTest(): void {
  _records.length = 0;
  (Object.keys(_counters) as (keyof Counters)[]).forEach((k) => { _counters[k] = 0; });
  _lastSourceSwitchLatencyMs = null;
  _lastPlayStartLatencyMs = null;
  _lastFailure = null;
}
