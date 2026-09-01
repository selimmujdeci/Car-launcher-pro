/** ARCH-01/F2 registry evidence collector — synchronous, read-only, no polling. */
import { systemBoot } from '../system/SystemBoot';
import { getVehicleDataLayerLifecycleDiagnostics } from '../vehicleDataLayer';
import { getNavigationSessionRuntimeSnapshot } from '../navigation/navigationSessionRuntime';
import { isAuthorityAvailable } from '../media/authority/mediaAuthorityRuntime';
import { healthMonitor } from '../system/SystemHealthMonitor';
import { buildRuntimeServiceRegistry, type HealthEvidence, type RuntimeRegistryEntry } from '../runtime/runtimeServiceRegistry';
import { buildRuntimeDependencyGraph, waveConsistency, type RuntimeDependencyGraph, type WaveConsistency } from '../runtime/runtimeDependencyGraph';
import { evaluateReadinessBlockers, type ReadinessBlockerResult } from '../runtime/runtimeReadinessBlocker';
import { buildRuntimeFaultContainment, type RuntimeFaultContainmentSnapshot } from '../runtime/runtimeFaultContainment';
import { runtimeRecoverySupervisor, type RuntimeRecoverySnapshot } from '../runtime/runtimeRecoverySupervisor';
import { getSystemBootShutdownSnapshot, type ShutdownRunSnapshot } from '../runtime/runtimeShutdownEvidence';
import { readRuntimeResourceEvidence, type ResourceEvidenceSnapshot } from '../runtime/runtimeResourceEvidence';
import { buildRuntimeObservabilitySnapshot, type RuntimeObservabilitySnapshot } from '../runtime/runtimeObservability';
import { buildRuntimeResilienceSnapshot, type RuntimeResilienceSnapshot } from '../runtime/runtimeResilience';
import { readRuntimeDomainAvailabilityAdapters } from '../runtime/runtimeDomainAvailabilityAdapters';

export interface RuntimeServiceRegistryGraphSnapshot {
  readonly entries: readonly RuntimeRegistryEntry[];
  readonly graph: RuntimeDependencyGraph;
  readonly blockers: readonly ReadinessBlockerResult[];
  readonly faultContainment: RuntimeFaultContainmentSnapshot;
  readonly recovery: RuntimeRecoverySnapshot;
  readonly shutdown: ShutdownRunSnapshot;
  readonly resources: ResourceEvidenceSnapshot;
  readonly observability: RuntimeObservabilitySnapshot;
  readonly resilience: RuntimeResilienceSnapshot;
  readonly waveConsistencyByEdge: Readonly<Record<string, WaveConsistency>>;
}

export function readRuntimeServiceRegistry(): readonly RuntimeRegistryEntry[] | null {
  try {
    const boot = systemBoot.getLifecycleDiagnostics();
    const vdl = getVehicleDataLayerLifecycleDiagnostics();
    const nav = getNavigationSessionRuntimeSnapshot();
    const healthByService: Record<string, HealthEvidence> = {};
    try {
      for (const item of healthMonitor.getGlobalHealthSnapshot().services) {
        healthByService[item.name] = { known: true, healthy: item.healthy, source: 'SystemHealthMonitor.getGlobalHealthSnapshot().services' };
      }
    } catch { /* individual health remains UNKNOWN */ }
    return buildRuntimeServiceRegistry({
      systemBoot: boot,
      vehicleData: { active: vdl.active, source: 'getVehicleDataLayerLifecycleDiagnostics().active' },
      navigation: { running: nav.running, source: 'getNavigationSessionRuntimeSnapshot().running' },
      media: { authorityAvailable: isAuthorityAvailable(), source: 'mediaAuthorityRuntime.isAuthorityAvailable()' },
      healthByService,
    });
  } catch { return null; }
}

/** F3 additive read-only graph projection. It never schedules or controls a service. */
export function readRuntimeServiceRegistryGraph(): RuntimeServiceRegistryGraphSnapshot | null {
  const entries = readRuntimeServiceRegistry();
  if (entries === null) return null;
  const graph = buildRuntimeDependencyGraph(entries);
  const waveConsistencyByEdge = Object.freeze(Object.fromEntries(graph.edges.map((edge) => [
    `${edge.from}|${edge.to}|${edge.kind}`, waveConsistency(edge, graph.nodes),
  ])));
  const snapshot = Object.freeze({
    entries,
    graph,
    blockers: evaluateReadinessBlockers(entries, graph),
    faultContainment: buildRuntimeFaultContainment(entries, graph),
    recovery: runtimeRecoverySupervisor.snapshot(),
    shutdown: getSystemBootShutdownSnapshot(),
    resources: readRuntimeResourceEvidence(),
    waveConsistencyByEdge,
  });
  const nowMs = Date.now();
  const adapters = readRuntimeDomainAvailabilityAdapters(nowMs);
  return Object.freeze({ ...snapshot, observability: buildRuntimeObservabilitySnapshot({ ...snapshot, nowMs }), resilience: buildRuntimeResilienceSnapshot(snapshot.entries, snapshot.graph, snapshot.blockers, adapters) });
}
