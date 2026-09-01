import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRuntimeEvidenceEnvelope, detectRuntimeContradictions, retainRuntimeEvidence, resolveEvidenceFreshness } from '../platform/runtime/runtimeObservability';
import { readRuntimeServiceRegistryGraph } from '../platform/devtools/runtimeServiceRegistrySources';

describe('ARCH-01/F8 canonical observability', () => {
  const base = { serviceId: 'svc', lifecycleDomain: 'DOMAIN_SERVICE' as const, kind: 'HEALTH' as const, lifecycleEpoch: 4, observedAt: 1000, nowMs: 1100, provenance: ['test'], sourceAuthority: 'test', evidenceState: 'OBSERVED' as const, typedPayload: { health: 'HEALTHY' } };

  it('creates deterministic typed envelopes without mutating payloads', () => {
    const a = createRuntimeEvidenceEnvelope(base); const b = createRuntimeEvidenceEnvelope(base);
    expect(a.evidenceId).toBe(b.evidenceId); expect(a.freshness).toBe('CURRENT'); expect(a.kind).toBe('HEALTH'); expect(Object.isFrozen(a)).toBe(true); expect(Object.isFrozen(a.provenance)).toBe(true);
  });
  it('maps all F8 routing kinds without semantic reinterpretation', () => {
    const kinds = ['LIFECYCLE', 'READINESS', 'HEALTH', 'DEPENDENCY', 'FAULT', 'RECOVERY', 'SHUTDOWN', 'RESOURCE', 'UNKNOWN'] as const;
    expect(kinds.map((kind) => createRuntimeEvidenceEnvelope({ ...base, kind }).kind)).toEqual(kinds);
  });
  it('rejects missing timestamp as CURRENT and distinguishes unavailable', () => {
    expect(resolveEvidenceFreshness({ ...base, observedAt: null })).toBe('UNKNOWN');
    expect(resolveEvidenceFreshness({ ...base, evidenceState: 'UNAVAILABLE' })).toBe('UNAVAILABLE');
  });
  it('rejects mismatched lifecycle epochs as stale', () => {
    expect(resolveEvidenceFreshness({ ...base, expectedEpoch: 3 })).toBe('STALE');
  });
  it('builds reference-only correlation and never causal text', () => {
    const e = createRuntimeEvidenceEnvelope({ ...base, operationId: 'op-1', runRef: 'run-1', correlationRefs: ['health-1', 'recovery-1'] });
    expect(e.correlationRefs).toEqual(['health-1', 'recovery-1']); expect(e.evidenceId).toContain('op-1|run-1'); expect(JSON.stringify(e)).not.toContain('because');
  });
  it('detects STOPPED/READY, DISPOSED/HEALTHY and FAILED/READY contradictions', () => {
    const findings = detectRuntimeContradictions([
      { serviceId: 'a', lifecycle: 'STOPPED', readiness: 'READY', health: 'UNKNOWN', freshness: 'CURRENT', evidenceRefs: ['a-l'] },
      { serviceId: 'b', lifecycle: 'DISPOSED', readiness: 'UNKNOWN', health: 'HEALTHY', freshness: 'CURRENT', evidenceRefs: ['b-h'], activeWorker: true },
      { serviceId: 'c', lifecycle: 'READY', readiness: 'READY', health: 'FAILED', freshness: 'CURRENT', evidenceRefs: ['c-h'] },
    ]);
    expect(findings.map((x) => x.rule)).toEqual(['STOPPED_READY', 'DISPOSED_HEALTHY', 'DISPOSED_ACTIVE_WORKER', 'FAILED_READY']); expect(findings.every((x) => x.status === 'CONTRADICTORY')).toBe(true);
  });
  it('detects completed shutdown with active recovery and unknown resource normal claims', () => {
    const findings = detectRuntimeContradictions([], { shutdownComplete: true, recoveryActive: true, resourceFreshness: 'UNKNOWN', resourceHealthyClaim: true });
    expect(findings.map((x) => x.rule)).toEqual(['SHUTDOWN_COMPLETE_RECOVERY_ACTIVE', 'UNKNOWN_RESOURCE_NORMAL']);
    expect(findings.every((x) => x.status === 'CONTRADICTORY' || x.status === 'INSUFFICIENT_EVIDENCE')).toBe(true);
  });
  it('detects unregistered active evidence without changing state', () => {
    const findings = detectRuntimeContradictions([{ serviceId: 'x', lifecycle: 'UNREGISTERED', readiness: 'UNKNOWN', health: 'UNKNOWN', freshness: 'CURRENT', evidenceRefs: ['x-active'], activeEvidence: true }]);
    expect(findings[0].rule).toBe('UNREGISTERED_ACTIVE_EVIDENCE');
  });
  it('marks stale and unknown contradiction evidence fail-closed', () => {
    expect(detectRuntimeContradictions([{ serviceId: 's', lifecycle: 'STOPPED', readiness: 'READY', health: 'UNKNOWN', freshness: 'STALE', evidenceRefs: [] }])[0].status).toBe('STALE_EVIDENCE');
    expect(detectRuntimeContradictions([{ serviceId: 's', lifecycle: 'STOPPED', readiness: 'READY', health: 'UNKNOWN', freshness: 'UNKNOWN', evidenceRefs: [] }])[0].status).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('retains bounded latest evidence deterministically and keeps groups separate', () => {
    const many = [1, 2, 3, 4, 5].map((n) => createRuntimeEvidenceEnvelope({ ...base, operationId: `op-${n}`, observedAt: n * 100 }));
    const retained = retainRuntimeEvidence(many, 2);
    expect(retained).toHaveLength(2); expect(retained.map((x) => x.observedAt)).toEqual([400, 500]); expect(retainRuntimeEvidence(many, 2)).toEqual(retained);
  });
  it('does not expose executable functions or mutate state', () => {
    const payload = { value: 1 }; const e = createRuntimeEvidenceEnvelope({ ...base, typedPayload: payload });
    expect(Object.values(e).some((x) => typeof x === 'function')).toBe(false); expect(payload.value).toBe(1);
  });
  it('live registry exposes one read-only observability projection and preserves unknown freshness', () => {
    const snapshot = readRuntimeServiceRegistryGraph();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.observability.system.evidenceKinds).toContain('LIFECYCLE');
    expect(snapshot?.observability.system.evidenceKinds).toContain('RESOURCE');
    expect(snapshot?.observability.services.every((row) => row.freshness !== 'CURRENT')).toBe(true);
  });
  it('LAB observability surface is read-only and does not expose execution controls', () => {
    const source = readFileSync('src/components/devtools/screens/RuntimeServiceRegistryScreen.tsx', 'utf8');
    expect(source).toContain('rsr-observability');
    expect(source).toContain('freshness=');
    expect(source).not.toMatch(/restart|fault.?inject|force.?run|priority.?override/i);
  });
});
