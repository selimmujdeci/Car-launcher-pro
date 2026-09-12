/** ARCH-01/F5 — sole runtime recovery policy authority. It owns no boot, health, or domain truth. */
import type { RuntimeServiceDescriptor } from './lifecycleContract';
import { DEFAULT_RECOVERY_POLICY, decideRecovery, emptyRecoveryLedger, type RecoveryDecision, type RecoveryLedger, type RecoveryRequest } from './runtimeRecoveryPolicy';
import { OwnerCommandEvidence, type CommandMessage } from '../message';
/* ARCH-05 — YALNIZ elle tetiklenen yönetimsel kurtarma için yetki kapısı.
   Otomatik (süreç-içi) kurtarma yolu DEĞİŞMEDİ: sahiplik ve politika
   `decideRecovery`de kalır, bu kapı onun ÖNÜNE değil YANINA eklenir. */
import { authorizeOperation } from '../security/enforcement';

export interface RecoveryExecution { readonly executeRestart: (serviceId: string, request: RecoveryRequest) => Promise<boolean>; readonly currentEpoch: (serviceId: string) => number | null; readonly dependencyBlocker?: (serviceId: string) => string | null; readonly onStaleCompletion?: () => void; }
export interface RecoveryEvidence { readonly request: RecoveryRequest; readonly decision: RecoveryDecision; readonly executionStarted: boolean; readonly executionOutcome: 'NOT_RUN' | 'SUCCEEDED' | 'FAILED'; readonly finishedAt: number | null; }
export interface RuntimeRecoverySnapshot { readonly evidence: readonly RecoveryEvidence[]; readonly ledgers: Readonly<Record<string, RecoveryLedger>>; }

class RuntimeRecoverySupervisor {
  private _descriptors = new Map<string, RuntimeServiceDescriptor>();
  private _ledgers = new Map<string, RecoveryLedger>();
  private _evidence: RecoveryEvidence[] = [];
  private _execution: RecoveryExecution | null = null;
  private _shutdownActive = false;
  /** Observability only; policy and the existing execution adapter remain unchanged. */
  private readonly _commandEvidence = new OwnerCommandEvidence('RuntimeRecoverySupervisor');
  setShutdownActive(active: boolean): void { this._shutdownActive = active; }
  configure(descriptors: readonly RuntimeServiceDescriptor[], execution: RecoveryExecution): void { this._descriptors = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor])); this._execution = execution; }
  request(request: RecoveryRequest): RecoveryDecision {
    this._commandEvidence.record({ id: `${request.requestId}:request`, kind: 'REQUEST', name: 'runtime.recovery.request', source: request.source.toLowerCase(), target: 'runtime_recovery_supervisor', operationId: request.requestId, correlationId: request.requestId, sessionId: null, generation: null, epoch: request.lifecycleEpoch, reason: null, nowMs: request.requestedAt });
    /* ── ARCH-05 · RUNTIME_ADMIN KAPISI ──────────────────────────────────
       Yalnız ELLE tetiklenen istek yetki sorar. Otomatik kaynaklar (sağlık
       izleyici · kaynak yönetimi · boot · domain) süreç-içidir ve bu kapıya
       HİÇ girmez — güvenlik kapısı iç kurtarmayı bozmamalıdır (§9). Normal
       UI · Mavi · telefon `RUNTIME_ADMIN` yetkisine SAHİP DEĞİLDİR, dolayısıyla
       elle yeniden başlatma onlardan gelemez. */
    if (request.source === 'MANUAL_INTERNAL') {
      const principalClass = request.principal ?? 'UNKNOWN';
      const authz = authorizeOperation({
        principalClass, capability: 'RUNTIME_ADMIN', operationId: request.requestId,
        targetRef: `runtime:${request.serviceId}`,
      });
      if (!authz.allowed) {
        const denied = Object.freeze({ kind: 'DENIED' as const, reason: `SECURITY_DENIED: ${authz.evidence.decision}`, recoveryKey: `${request.serviceId}:${request.lifecycleEpoch ?? 'UNKNOWN'}:security`, attempt: 0, remaining: 0, backoffUntil: null, circuitState: 'CLOSED' as const, dependencyBlocker: null });
        this._commandEvidence.record({ id: `${request.requestId}:decision`, kind: 'RESULT', name: 'runtime.recovery.decision', source: 'runtime_recovery_supervisor', target: null, operationId: request.requestId, correlationId: request.requestId, sessionId: null, generation: null, epoch: request.lifecycleEpoch, reason: 'DENIED', nowMs: request.requestedAt });
        this._record(request, denied, false, 'NOT_RUN', null);
        return denied;
      }
    }
    const descriptor = this._descriptors.get(request.serviceId) ?? null; const existing = this._ledgers.get(request.serviceId) ?? emptyRecoveryLedger(); const ledger = existing.windowStartedAt !== null && request.requestedAt - existing.windowStartedAt >= DEFAULT_RECOVERY_POLICY.windowMs && existing.circuitState !== 'OPEN' ? Object.freeze({ ...existing, attempts: 0, windowStartedAt: null, circuitState: 'CLOSED' }) : existing;
    const decision = this._shutdownActive ? Object.freeze({ kind: 'DENIED' as const, reason: 'SHUTDOWN_ACTIVE: recovery execution suppressed.', recoveryKey: `${request.serviceId}:${request.lifecycleEpoch ?? 'UNKNOWN'}:shutdown`, attempt: ledger.attempts, remaining: Math.max(0, DEFAULT_RECOVERY_POLICY.maxAttempts - ledger.attempts), backoffUntil: null, circuitState: ledger.circuitState, dependencyBlocker: null }) : decideRecovery({ request, descriptor, currentEpoch: this._execution?.currentEpoch(request.serviceId) ?? null, dependencyBlocker: this._execution?.dependencyBlocker?.(request.serviceId) ?? null, ledger, now: request.requestedAt, policy: DEFAULT_RECOVERY_POLICY });
    this._commandEvidence.record({ id: `${request.requestId}:decision`, kind: 'RESULT', name: 'runtime.recovery.decision', source: 'runtime_recovery_supervisor', target: null, operationId: request.requestId, correlationId: request.requestId, sessionId: null, generation: null, epoch: request.lifecycleEpoch, reason: decision.kind === 'RESTART_SERVICE' ? null : decision.kind, nowMs: request.requestedAt });
    if (decision.kind !== 'RESTART_SERVICE') { this._record(request, decision, false, 'NOT_RUN', null); if (decision.kind === 'STALE_REQUEST') this._ledgers.set(request.serviceId, Object.freeze({ ...ledger, staleRejectCount: ledger.staleRejectCount + 1 })); else if (ledger.inFlightKey === decision.recoveryKey) this._ledgers.set(request.serviceId, Object.freeze({ ...ledger, dedupCount: ledger.dedupCount + 1 })); return decision; }
    const key = decision.recoveryKey; const next: RecoveryLedger = Object.freeze({ ...ledger, attempts: (decision.circuitState === 'HALF_OPEN' ? 0 : ledger.attempts) + 1, windowStartedAt: decision.circuitState === 'HALF_OPEN' ? request.requestedAt : ledger.windowStartedAt ?? request.requestedAt, lastAttemptAt: request.requestedAt, circuitState: decision.circuitState === 'HALF_OPEN' ? 'HALF_OPEN' : ledger.circuitState, inFlightKey: key }); this._ledgers.set(request.serviceId, next); this._record(request, decision, true, 'NOT_RUN', null);
    void this._execute(request, decision, next); return decision;
  }
  private async _execute(request: RecoveryRequest, decision: RecoveryDecision, ledger: RecoveryLedger): Promise<void> {
    const stillCurrent = this._execution?.currentEpoch(request.serviceId) === request.lifecycleEpoch;
    let success = false; if (stillCurrent && this._execution) { try { success = await this._execution.executeRestart(request.serviceId, request); } catch { success = false; } }
    const completionCurrent = this._execution?.currentEpoch(request.serviceId) === request.lifecycleEpoch;
    if (success && !completionCurrent) this._execution?.onStaleCompletion?.();
    success = success && completionCurrent;
    const current = this._ledgers.get(request.serviceId) ?? ledger;
    const finalized: RecoveryLedger = success ? Object.freeze({ ...current, attempts: 0, windowStartedAt: null, lastSuccessAt: request.requestedAt, circuitState: 'CLOSED', inFlightKey: null }) : Object.freeze({ ...current, circuitState: current.attempts >= DEFAULT_RECOVERY_POLICY.maxAttempts ? 'OPEN' : current.circuitState, inFlightKey: null });
    this._ledgers.set(request.serviceId, finalized); this._record(request, decision, true, success ? 'SUCCEEDED' : 'FAILED', request.requestedAt);
    this._commandEvidence.record({ id: `${request.requestId}:execution`, kind: 'RESULT', name: 'runtime.recovery.execution', source: 'system_boot', target: null, operationId: request.requestId, correlationId: request.requestId, sessionId: null, generation: null, epoch: request.lifecycleEpoch, reason: success ? null : (completionCurrent ? 'EXECUTION_FAILED' : 'STALE_EPOCH'), nowMs: request.requestedAt });
  }
  private _record(request: RecoveryRequest, decision: RecoveryDecision, executionStarted: boolean, executionOutcome: RecoveryEvidence['executionOutcome'], finishedAt: number | null): void { this._evidence = [...this._evidence.slice(-63), Object.freeze({ request, decision, executionStarted, executionOutcome, finishedAt })]; }
  snapshot(): RuntimeRecoverySnapshot { return Object.freeze({ evidence: Object.freeze([...this._evidence]), ledgers: Object.freeze(Object.fromEntries([...this._ledgers.entries()].sort(([a], [b]) => a.localeCompare(b)))) }); }
  getCommandFlowEvidence(): readonly CommandMessage[] { return this._commandEvidence.recent(); }
  resetForTest(): void { this._ledgers.clear(); this._evidence = []; this._execution = null; this._descriptors.clear(); this._shutdownActive = false; }
}
export const runtimeRecoverySupervisor = new RuntimeRecoverySupervisor();
