/**
 * F1 pilot adapter for existing SystemBoot diagnostics.
 * SAF mapping only: it neither calls start/stop nor claims boot readiness that
 * the current diagnostics do not expose.
 */
import type { SystemBootLifecycleDiagnostics } from '../system/SystemBoot';
import type {
  LifecycleGeneration, LifecycleHealth, LifecycleReadiness, LifecycleState,
  LifecycleTransitionEvidence,
} from './lifecycleContract';

export interface SystemBootLifecyclePilot {
  readonly state: LifecycleState;
  readonly readiness: LifecycleReadiness;
  readonly health: LifecycleHealth;
  readonly generation: LifecycleGeneration;
  readonly invalidTransitionCount: number;
  readonly unknownSources: readonly string[];
  readonly evidence: LifecycleTransitionEvidence;
}

export function adaptSystemBootLifecycle(
  d: SystemBootLifecycleDiagnostics,
): SystemBootLifecyclePilot {
  // `_started` is set before waves complete, so it is never mapped to READY.
  const state: LifecycleState = d.started ? 'STARTING' : d.starts === 0 && d.stops === 0 ? 'UNREGISTERED' : 'STOPPED';
  const generation: LifecycleGeneration = Object.freeze({
    serviceId: 'system-boot', lifecycleEpoch: d.starts, operationId: `boot:${d.starts}`, transitionToken: d.stops,
  });
  const unknownSources = Object.freeze([
    'SystemBootLifecycleDiagnostics has no boot-complete/readiness field.',
    'SystemBootLifecycleDiagnostics has no canonical health field.',
  ]);
  return Object.freeze({
    state,
    readiness: 'UNKNOWN',
    health: 'UNKNOWN',
    generation,
    invalidTransitionCount: 0,
    unknownSources,
    evidence: Object.freeze({
      serviceId: 'system-boot', oldState: 'UNKNOWN', newState: state,
      reason: 'adapter_snapshot', generation, readiness: 'UNKNOWN', health: 'UNKNOWN',
      owner: 'SystemBoot', atMs: null, durationMs: null, violation: null,
      source: 'SystemBoot.getLifecycleDiagnostics()',
    }),
  });
}
