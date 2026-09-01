/**
 * ARCH-01/F2 — SAF service-registry projection.
 * It is not a registry executor: descriptors are metadata and snapshots are
 * deterministic projections of evidence supplied by read-only adapters.
 */
import type {
  LifecycleHealth, LifecycleReadiness, LifecycleState, RuntimeServiceDescriptor,
} from './lifecycleContract';

export interface HealthEvidence { readonly known: boolean; readonly healthy: boolean | null; readonly source: string; }
export interface RuntimeServiceEvidenceInput {
  readonly systemBoot: { readonly started: boolean; readonly starts: number; readonly stops: number; readonly namedCleanupKeys: readonly string[]; };
  readonly vehicleData: { readonly active: boolean; readonly source: string; };
  readonly navigation: { readonly running: boolean; readonly source: string; };
  readonly media: { readonly authorityAvailable: boolean; readonly source: string; };
  readonly healthByService: Readonly<Record<string, HealthEvidence>>;
}

export interface RuntimeRegistryEntry {
  readonly descriptor: RuntimeServiceDescriptor;
  readonly lifecycle: LifecycleState;
  readonly readiness: LifecycleReadiness;
  readonly health: LifecycleHealth;
  readonly reason: string;
  readonly provenance: readonly string[];
  readonly registeredBySystemBoot: boolean;
}

const none = Object.freeze([] as string[]);
const desc = (
  id: string, owner: string, lifecycleDomain: RuntimeServiceDescriptor['lifecycleDomain'],
  criticality: RuntimeServiceDescriptor['criticality'], readinessKind: string,
): RuntimeServiceDescriptor => Object.freeze({
  id, owner, lifecycleDomain, criticality, hardDependencies: none, softDependencies: none, observationDependencies: none, unknownDependencies: none,
  readinessKind, restartClass: 'DOMAIN_OWNED', resourceClass: criticality === 'OPTIONAL' ? 'OPTIONAL' : criticality === 'DEVTOOLS' ? 'DEVTOOLS' : 'CORE', shutdownClass: 'LIFO_CLEANUP', bootWave: null,
  faultDomain: 'UNKNOWN', isolationBoundary: 'UNKNOWN', propagationClass: 'UNKNOWN', recoveryEligibility: 'DOMAIN_OWNED',
});

/** Names are exact SystemBoot `_regNamed` keys; no name is invented from a UI label. */
export const SYSTEM_BOOT_SERVICE_DESCRIPTORS: readonly RuntimeServiceDescriptor[] = Object.freeze([
  Object.freeze({ ...desc('system-boot', 'SystemBoot', 'APP_PROCESS', 'CORE', 'boot-complete event (not yet exposed)'), bootWave: 0, faultDomain: 'APP_CORE', isolationBoundary: 'PROCESS_LOCAL', recoveryEligibility: 'RUNTIME_FUTURE' }),
  Object.freeze({ ...desc('safe-storage', 'SystemBoot → initSafeStorageAsync', 'DOMAIN_SERVICE', 'CORE', 'storage readiness not exposed'), bootWave: 1, faultDomain: 'STORAGE', isolationBoundary: 'SHARED_RESOURCE', recoveryEligibility: 'UNKNOWN' }),
  desc('CommunityService', 'SystemBoot / communityService', 'DOMAIN_SERVICE', 'OPTIONAL', 'domain evidence not exposed'),
  desc('OfflineAutoCache', 'SystemBoot / offlineAutoCache', 'DOMAIN_SERVICE', 'OPTIONAL', 'domain evidence not exposed'),
  Object.freeze({ ...desc('VehicleDataLayer', 'VehicleDataLayer / VehicleSignalResolver', 'TRANSPORT', 'VEHICLE_DATA', 'resolver lifecycle diagnostics'), bootWave: 2, restartClass: 'RUNTIME_REQUESTABLE', faultDomain: 'VEHICLE_DATA', isolationBoundary: 'DOMAIN_LOCAL', propagationClass: 'NO_PROPAGATION', recoveryEligibility: 'RUNTIME_FUTURE' }),
  desc('MaintenanceBrain', 'MaintenanceBrain', 'DOMAIN_SERVICE', 'VEHICLE_DATA', 'domain evidence not exposed'),
  desc('BatteryEvidenceSource', 'BatteryEvidenceSource', 'DOMAIN_SERVICE', 'VEHICLE_DATA', 'domain evidence not exposed'),
  desc('BatteryVerdictService', 'BatteryVerdictService', 'DOMAIN_SERVICE', 'VEHICLE_DATA', 'domain evidence not exposed'),
  desc('FuelAdvisor', 'FuelAdvisor', 'DOMAIN_SERVICE', 'EXPERIENCE', 'domain evidence not exposed'),
  desc('GuardianRuntime', 'GuardianRuntime', 'DOMAIN_SERVICE', 'VEHICLE_DATA', 'domain evidence not exposed'),
  desc('RadarEngine', 'RadarEngine', 'DOMAIN_SERVICE', 'EXPERIENCE', 'domain evidence not exposed'),
  desc('VoiceService', 'VoiceService', 'DOMAIN_SERVICE', 'EXPERIENCE', 'domain evidence not exposed'),
  desc('CompanionEngine', 'CompanionEngine', 'DOMAIN_SERVICE', 'OPTIONAL', 'domain evidence not exposed'),
  Object.freeze({ ...desc('NavigationSessionRuntime', 'NavigationSessionRuntime', 'DOMAIN_SERVICE', 'EXPERIENCE', 'navigation runtime evidence'), observationDependencies: Object.freeze(['VehicleDataLayer']), bootWave: 3, faultDomain: 'NAVIGATION', isolationBoundary: 'DOMAIN_LOCAL', propagationClass: 'OBSERVATION_ONLY' }),
  Object.freeze({ ...desc('media-authority', 'mediaAuthorityRuntime / CarosPlaybackService', 'DOMAIN_SERVICE', 'EXPERIENCE', 'native authority availability'), bootWave: 1, faultDomain: 'MEDIA', isolationBoundary: 'DOMAIN_LOCAL', propagationClass: 'NO_PROPAGATION' }),
  Object.freeze({ ...desc('MaviRuntime', 'MaviLifecycle / MaviOrchestrator', 'DOMAIN_SERVICE', 'EXPERIENCE', 'runtime readiness not exposed'), faultDomain: 'VOICE', isolationBoundary: 'DOMAIN_LOCAL', propagationClass: 'NO_PROPAGATION' }),
  desc('PhoneLink', 'UNKNOWN — passive Phone Hub observation', 'TRANSPORT', 'EXPERIENCE', 'active lifecycle authority not exposed'),
] as const);

function mapHealth(e: HealthEvidence | undefined): LifecycleHealth {
  if (!e?.known || e.healthy === null) return 'UNKNOWN';
  return e.healthy ? 'HEALTHY' : 'DEGRADED';
}

function baseLifecycle(input: RuntimeServiceEvidenceInput, registered: boolean): LifecycleState {
  if (input.systemBoot.started) return registered ? 'STARTING' : 'UNKNOWN';
  return input.systemBoot.starts === 0 && input.systemBoot.stops === 0 ? 'UNREGISTERED' : 'STOPPED';
}

/** Active/running only proves registration/liveness, never readiness. */
export function buildRuntimeServiceRegistry(input: RuntimeServiceEvidenceInput): readonly RuntimeRegistryEntry[] {
  const named = new Set(input.systemBoot.namedCleanupKeys);
  return SYSTEM_BOOT_SERVICE_DESCRIPTORS.map((descriptor) => {
    const registered = descriptor.id === 'system-boot' || descriptor.id === 'safe-storage' ? input.systemBoot.started
      : descriptor.id === 'NavigationSessionRuntime' ? input.navigation.running
      : descriptor.id === 'media-authority' ? input.media.authorityAvailable || input.systemBoot.started
      : named.has(descriptor.id);
    let lifecycle = baseLifecycle(input, registered);
    let readiness: LifecycleReadiness = 'UNKNOWN';
    let reason = registered ? 'SystemBoot named cleanup registration observed; readiness evidence absent.' : 'No registration evidence in current SystemBoot diagnostics.';
    const provenance: string[] = ['SystemBoot.getLifecycleDiagnostics()'];

    if (descriptor.id === 'VehicleDataLayer') {
      provenance.push(input.vehicleData.source);
      if (input.vehicleData.active) reason = 'Resolver active observed; this is not transport/data readiness.';
    } else if (descriptor.id === 'NavigationSessionRuntime') {
      provenance.push(input.navigation.source);
      if (input.navigation.running) reason = 'Navigation runtime subscription observed; route/guidance readiness is not implied.';
    } else if (descriptor.id === 'media-authority') {
      provenance.push(input.media.source);
      if (input.media.authorityAvailable) {
        lifecycle = 'READY';
        readiness = 'READY';
        reason = 'Native authority availability observed.';
      } else if (input.systemBoot.started) {
        lifecycle = 'STARTING';
        reason = 'Boot active but native authority availability is not observed.';
      }
    }
    if (descriptor.id === 'system-boot') {
      lifecycle = input.systemBoot.started ? 'STARTING' : input.systemBoot.starts === 0 && input.systemBoot.stops === 0 ? 'UNREGISTERED' : 'STOPPED';
      reason = 'Current diagnostics do not expose boot-complete readiness.';
    }

    const healthEvidence = input.healthByService[descriptor.id];
    if (healthEvidence) provenance.push(healthEvidence.source);
    return Object.freeze({ descriptor, lifecycle, readiness, health: mapHealth(healthEvidence), reason, provenance: Object.freeze(provenance), registeredBySystemBoot: registered });
  });
}
