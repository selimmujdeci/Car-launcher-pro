/**
 * ARCH-01/F1 — canonical lifecycle vocabulary, deliberately SAF.
 * No registry, orchestration, timers, service calls, mutable state or wall clock.
 * Domain truth remains owned by its domain service.
 */

export type LifecycleState =
  | 'UNREGISTERED' | 'REGISTERED' | 'PREPARING' | 'STARTING' | 'READY'
  | 'DEGRADED' | 'QUIESCING' | 'STOPPING' | 'STOPPED' | 'FAILED'
  | 'BLOCKED' | 'UNKNOWN' | 'DISPOSED';

export type LifecycleReadiness = 'READY' | 'NOT_READY' | 'DEGRADED' | 'UNKNOWN';
export type LifecycleHealth = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'FAILED' | 'UNKNOWN';
export type LifecycleDomain =
  | 'APP_PROCESS' | 'APP_UI' | 'ANDROID_NATIVE' | 'VEHICLE_SESSION'
  | 'TRANSPORT' | 'DOMAIN_SERVICE' | 'POWER' | 'UNKNOWN';
export type RuntimeCriticality = 'CORE' | 'VEHICLE_DATA' | 'EXPERIENCE' | 'OPTIONAL' | 'DEVTOOLS';
export type RestartClass = 'NONE' | 'DOMAIN_OWNED' | 'RUNTIME_REQUESTABLE' | 'UNKNOWN';
export type ResourceClass = 'CORE' | 'DRIVE_CONTEXT' | 'EXPERIENCE' | 'OPTIONAL' | 'DEVTOOLS';
export type ShutdownClass = 'LIFO_CLEANUP' | 'DOMAIN_DISPOSE' | 'NATIVE_LIFECYCLE' | 'UNKNOWN';
export type FaultDomain = 'APP_CORE' | 'STORAGE' | 'VEHICLE_DATA' | 'NAVIGATION' | 'MEDIA' | 'VOICE' | 'PHONE_LINK' | 'DOMAIN_LOCAL' | 'UNKNOWN';
export type IsolationBoundary = 'PROCESS_LOCAL' | 'DOMAIN_LOCAL' | 'SHARED_RESOURCE' | 'UNKNOWN';
export type PropagationClass = 'HARD_DEPENDENCY_ONLY' | 'SOFT_DEGRADATION_ONLY' | 'OBSERVATION_ONLY' | 'NO_PROPAGATION' | 'UNKNOWN';

export interface RuntimeServiceDescriptor {
  readonly id: string;
  readonly owner: string;
  readonly lifecycleDomain: LifecycleDomain;
  readonly criticality: RuntimeCriticality;
  readonly hardDependencies: readonly string[];
  readonly softDependencies: readonly string[];
  readonly observationDependencies: readonly string[];
  readonly unknownDependencies: readonly string[];
  readonly readinessKind: string;
  readonly restartClass: RestartClass;
  readonly resourceClass: ResourceClass;
  readonly shutdownClass: ShutdownClass;
  readonly bootWave: number | null;
  readonly faultDomain: FaultDomain;
  readonly isolationBoundary: IsolationBoundary;
  readonly propagationClass: PropagationClass;
  readonly recoveryEligibility: 'DOMAIN_OWNED' | 'RUNTIME_FUTURE' | 'UNKNOWN';
}

export interface LifecycleGeneration {
  readonly serviceId: string;
  readonly lifecycleEpoch: number;
  readonly operationId: string;
  readonly transitionToken: number;
}

export interface LifecycleTransitionEvidence {
  readonly serviceId: string;
  readonly oldState: LifecycleState;
  readonly newState: LifecycleState;
  readonly reason: string;
  readonly generation: LifecycleGeneration;
  readonly readiness: LifecycleReadiness;
  readonly health: LifecycleHealth;
  readonly owner: string;
  readonly atMs: number | null;
  readonly durationMs: number | null;
  readonly violation: string | null;
  readonly source: string;
}

export interface TransitionDecision {
  readonly allowed: boolean;
  readonly state: LifecycleState;
  readonly violation: string | null;
}

/** Whitelist only; UNKNOWN is an explicit integrity outcome, not an implicit retry state. */
const ALLOWED: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = Object.freeze({
  UNREGISTERED: ['REGISTERED'],
  REGISTERED: ['PREPARING', 'STOPPED', 'DISPOSED'],
  PREPARING: ['STARTING', 'BLOCKED', 'FAILED', 'STOPPING'],
  STARTING: ['READY', 'DEGRADED', 'BLOCKED', 'FAILED', 'STOPPING'],
  READY: ['DEGRADED', 'QUIESCING', 'FAILED', 'STOPPING'],
  DEGRADED: ['READY', 'QUIESCING', 'FAILED', 'STOPPING'],
  QUIESCING: ['STOPPING', 'FAILED'],
  STOPPING: ['STOPPED', 'FAILED'],
  STOPPED: ['PREPARING', 'DISPOSED'],
  FAILED: ['PREPARING', 'STOPPING', 'DISPOSED'],
  BLOCKED: ['PREPARING', 'STOPPING', 'DISPOSED'],
  UNKNOWN: ['PREPARING', 'STOPPING', 'DISPOSED'],
  DISPOSED: [],
});

export const LIFECYCLE_STATES: readonly LifecycleState[] = Object.freeze(Object.keys(ALLOWED) as LifecycleState[]);

export function allowedTransitions(from: LifecycleState): readonly LifecycleState[] {
  return ALLOWED[from] ?? [];
}

export function decideTransition(from: LifecycleState, to: LifecycleState): TransitionDecision {
  if (ALLOWED[from]?.includes(to)) return { allowed: true, state: to, violation: null };
  return {
    allowed: false,
    state: 'UNKNOWN',
    violation: `invalid_transition:${from}->${to}`,
  };
}

/** A completion is current only when it belongs to the exact same service operation/generation. */
export function isTransitionCurrent(
  completion: LifecycleGeneration,
  current: LifecycleGeneration,
): boolean {
  return completion.serviceId === current.serviceId
    && completion.lifecycleEpoch === current.lifecycleEpoch
    && completion.operationId === current.operationId
    && completion.transitionToken === current.transitionToken;
}

/** F1 pilot metadata only; no DAG is evaluated and no service is started. */
export const LIFECYCLE_PILOT_DESCRIPTORS: readonly RuntimeServiceDescriptor[] = Object.freeze([
  Object.freeze({
    id: 'system-boot', owner: 'SystemBoot', lifecycleDomain: 'APP_PROCESS',
    criticality: 'CORE', hardDependencies: Object.freeze([]), softDependencies: Object.freeze([]),
    observationDependencies: Object.freeze([]), unknownDependencies: Object.freeze([]),
    readinessKind: 'boot-complete-event (not exposed by current diagnostics)',
    restartClass: 'RUNTIME_REQUESTABLE', resourceClass: 'CORE', shutdownClass: 'LIFO_CLEANUP', bootWave: 0,
    faultDomain: 'APP_CORE', isolationBoundary: 'PROCESS_LOCAL', propagationClass: 'UNKNOWN', recoveryEligibility: 'RUNTIME_FUTURE',
  }),
  Object.freeze({
    id: 'safe-storage', owner: 'SystemBoot → initSafeStorageAsync', lifecycleDomain: 'DOMAIN_SERVICE',
    criticality: 'CORE', hardDependencies: Object.freeze([]), softDependencies: Object.freeze([]),
    observationDependencies: Object.freeze([]), unknownDependencies: Object.freeze([]),
    readinessKind: 'storage self-evidence (not yet exposed)',
    restartClass: 'UNKNOWN', resourceClass: 'CORE', shutdownClass: 'UNKNOWN', bootWave: 1,
    faultDomain: 'STORAGE', isolationBoundary: 'SHARED_RESOURCE', propagationClass: 'UNKNOWN', recoveryEligibility: 'UNKNOWN',
  }),
] as const);
