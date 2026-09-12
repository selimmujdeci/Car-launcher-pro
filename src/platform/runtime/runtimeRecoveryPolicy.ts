/** ARCH-01/F5 — pure, deterministic recovery policy. No executor, clock, timer, or mutable state. */
import type { FaultDomain, LifecycleHealth, LifecycleReadiness, LifecycleState, RuntimeServiceDescriptor } from './lifecycleContract';

export type RecoverySource = 'HEALTH_MONITOR' | 'RESOURCE_RUNTIME' | 'BOOT' | 'DOMAIN' | 'MANUAL_INTERNAL';
export type RecoveryDecisionKind = 'NO_ACTION' | 'DELEGATE_DOMAIN_RECOVERY' | 'RESTART_SERVICE' | 'WAIT_BACKOFF' | 'BLOCKED_DEPENDENCY' | 'CIRCUIT_OPEN' | 'BUDGET_EXHAUSTED' | 'STALE_REQUEST' | 'DENIED' | 'UNKNOWN';
export type RecoveryCircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export interface RecoveryRequest {
  readonly requestId: string;
  readonly serviceId: string;
  readonly source: RecoverySource;
  readonly faultDomain: FaultDomain;
  readonly observedLifecycle: LifecycleState;
  readonly observedReadiness: LifecycleReadiness;
  readonly observedHealth: LifecycleHealth;
  readonly reason: string;
  readonly lifecycleEpoch: number | null;
  readonly faultEvidenceRef: string;
  readonly requestedAt: number;
  readonly provenance: readonly string[];
  /**
   * ARCH-05 — isteği DOĞURAN çağıran sınıfı.
   *
   * Otomatik kaynaklar (`HEALTH_MONITOR` · `RESOURCE_RUNTIME` · `BOOT` ·
   * `DOMAIN`) süreç-içidir ve alan VERİLMEZSE `SYSTEM_INTERNAL` sayılır —
   * mevcut kurtarma mekanizması AYNEN çalışmaya devam eder. `MANUAL_INTERNAL`
   * ise ELLE tetiklenen yönetimsel bir eylemdir: sınıfı AÇIKÇA taşımak
   * ZORUNDADIR, aksi halde `RUNTIME_ADMIN` yetkisi bulunamaz ve reddedilir.
   */
  readonly principal?: 'LOCAL_UI' | 'MAVI' | 'PHONE_LINK' | 'PHONE_REMOTE' | 'SYSTEM_INTERNAL' | 'LAB' | 'REPLAY' | 'IMPORTED' | 'UNKNOWN';
}
export interface RecoveryLedger {
  readonly attempts: number;
  readonly windowStartedAt: number | null;
  readonly lastAttemptAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly circuitState: RecoveryCircuitState;
  readonly inFlightKey: string | null;
  readonly dedupCount: number;
  readonly staleRejectCount: number;
}
export interface RecoveryPolicy { readonly maxAttempts: number; readonly windowMs: number; readonly baseBackoffMs: number; readonly maxBackoffMs: number; }
export interface RecoveryDecision { readonly kind: RecoveryDecisionKind; readonly reason: string; readonly recoveryKey: string; readonly attempt: number; readonly remaining: number; readonly backoffUntil: number | null; readonly circuitState: RecoveryCircuitState; readonly dependencyBlocker: string | null; }
export const DEFAULT_RECOVERY_POLICY: RecoveryPolicy = Object.freeze({ maxAttempts: 2, windowMs: 300_000, baseBackoffMs: 5_000, maxBackoffMs: 160_000 });

export function normalizeFaultIdentity(request: RecoveryRequest): string {
  return `${request.source}:${request.faultDomain}:${request.reason.trim().toLowerCase() || 'unknown'}:${request.faultEvidenceRef}`;
}
export function recoveryKey(request: RecoveryRequest): string { return `${request.serviceId}:${request.lifecycleEpoch ?? 'UNKNOWN'}:${normalizeFaultIdentity(request)}`; }
export function exponentialBackoffMs(attempts: number, policy: RecoveryPolicy = DEFAULT_RECOVERY_POLICY): number {
  if (attempts <= 0) return 0;
  return Math.min(policy.baseBackoffMs * (2 ** (attempts - 1)), policy.maxBackoffMs);
}
export function emptyRecoveryLedger(): RecoveryLedger { return Object.freeze({ attempts: 0, windowStartedAt: null, lastAttemptAt: null, lastSuccessAt: null, circuitState: 'CLOSED', inFlightKey: null, dedupCount: 0, staleRejectCount: 0 }); }

export function decideRecovery(input: { readonly request: RecoveryRequest; readonly descriptor: RuntimeServiceDescriptor | null; readonly currentEpoch: number | null; readonly dependencyBlocker: string | null; readonly ledger: RecoveryLedger; readonly now: number; readonly policy?: RecoveryPolicy; }): RecoveryDecision {
  const { request, descriptor, currentEpoch, dependencyBlocker, ledger, now } = input; const policy = input.policy ?? DEFAULT_RECOVERY_POLICY; const key = recoveryKey(request);
  const base = (kind: RecoveryDecisionKind, reason: string, backoffUntil: number | null = null): RecoveryDecision => Object.freeze({ kind, reason, recoveryKey: key, attempt: ledger.attempts, remaining: Math.max(0, policy.maxAttempts - ledger.attempts), backoffUntil, circuitState: ledger.circuitState, dependencyBlocker });
  if (!descriptor || request.lifecycleEpoch === null || currentEpoch === null || request.lifecycleEpoch !== currentEpoch) return base('STALE_REQUEST', 'Current lifecycle epoch is not proven.');
  if (request.observedHealth === 'HEALTHY' || request.observedHealth === 'DEGRADED') return base('NO_ACTION', 'Healthy/degraded evidence alone is not restart evidence.');
  if (dependencyBlocker) return base('BLOCKED_DEPENDENCY', 'Canonical HARD dependency is not recoverable yet.');
  if (descriptor.restartClass === 'UNKNOWN' || descriptor.restartClass === 'NONE') return base('DENIED', 'Restart class is fail-closed.');
  if (descriptor.restartClass === 'DOMAIN_OWNED') return base('DELEGATE_DOMAIN_RECOVERY', 'Recovery remains owned by the domain state machine.');
  const windowExpired = ledger.windowStartedAt !== null && now - ledger.windowStartedAt >= policy.windowMs;
  const attempts = windowExpired ? 0 : ledger.attempts;
  if (ledger.inFlightKey === key) return base('WAIT_BACKOFF', 'Equivalent recovery is already in flight.');
  if (ledger.circuitState === 'OPEN' && !windowExpired) return base('CIRCUIT_OPEN', 'Recovery circuit is OPEN.');
  if (attempts >= policy.maxAttempts) return base('BUDGET_EXHAUSTED', 'Bounded restart budget is exhausted.');
  const backoffUntil = ledger.lastAttemptAt === null ? null : ledger.lastAttemptAt + exponentialBackoffMs(attempts, policy);
  if (backoffUntil !== null && now < backoffUntil) return base('WAIT_BACKOFF', 'Deterministic backoff window is active.', backoffUntil);
  if (ledger.circuitState === 'OPEN' && windowExpired) return Object.freeze({ ...base('RESTART_SERVICE', 'Circuit cool-off elapsed; one HALF_OPEN probe is eligible.'), circuitState: 'HALF_OPEN', attempt: 0, remaining: policy.maxAttempts });
  return base('RESTART_SERVICE', 'Canonical restart eligibility is proven.');
}
