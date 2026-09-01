/**
 * runtimeAuthorityModel — ARCH-01/F0 CAROS LAB authority inventory (SAF).
 *
 * This is a static, reviewable map of code-owned authorities. It is deliberately
 * not a runtime registry: no imports from services, no I/O, no timers, no state
 * and no lifecycle control. UNKNOWN is represented explicitly rather than
 * inferred from an absent source.
 */

export type RuntimeAuthorityKind =
  | 'BOOT' | 'LIFECYCLE' | 'HEALTH' | 'RECOVERY' | 'RESOURCE'
  | 'STORAGE' | 'APP_LIFECYCLE' | 'DOMAIN_LIFECYCLE' | 'SCHEDULER'
  | 'HYDRATION' | 'SHUTDOWN';

export type AuthorityEvidence = 'CODE_CONFIRMED' | 'KNOWN_OVERLAP' | 'UNKNOWN';

export interface RuntimeAuthorityRow {
  readonly id: string;
  readonly authority: string;
  readonly kind: RuntimeAuthorityKind;
  readonly canonicalOwner: string;
  readonly competingOwner: string | null;
  readonly lifecycleDomain: string;
  readonly timerOwner: string | null;
  readonly recoveryOwner: string | null;
  readonly evidence: AuthorityEvidence;
  readonly codeEvidence: string;
  readonly knownDebt: string | null;
}

/** F0 inventory: every row is code evidence, never a claim about field state. */
export const RUNTIME_AUTHORITY_MAP: readonly RuntimeAuthorityRow[] = Object.freeze([
  { id: 'app-bootstrap', authority: 'App bootstrap', kind: 'BOOT', canonicalOwner: 'App.tsx → systemBoot.start/stop', competingOwner: null, lifecycleDomain: 'React application', timerOwner: null, recoveryOwner: null, evidence: 'CODE_CONFIRMED', codeEvidence: 'src/App.tsx:83-88', knownDebt: null },
  { id: 'boot', authority: 'Boot waves', kind: 'BOOT', canonicalOwner: 'SystemBoot', competingOwner: null, lifecycleDomain: 'TS runtime', timerOwner: 'SystemBoot worker-backoff', recoveryOwner: 'SystemBoot.restartService (legacy F0 owner)', evidence: 'CODE_CONFIRMED', codeEvidence: 'src/platform/system/SystemBoot.ts:546-632', knownDebt: null },
  { id: 'health', authority: 'Health observation', kind: 'HEALTH', canonicalOwner: 'SystemHealthMonitor', competingOwner: null, lifecycleDomain: 'TS runtime', timerOwner: 'SystemHealthMonitor watchdog/UI/soak timers', recoveryOwner: 'SystemHealthMonitor currently invokes restartFn', evidence: 'KNOWN_OVERLAP', codeEvidence: 'src/platform/system/SystemHealthMonitor.ts:310-321,668-726', knownDebt: 'I4: health observation and recovery authorization are currently coupled through restartFn.' },
  { id: 'resource', authority: 'Runtime resource / thermal execution', kind: 'RESOURCE', canonicalOwner: 'AdaptiveRuntimeManager', competingOwner: 'thermalWatchdog and memoryWatchdog supply direct mode requests', lifecycleDomain: 'resource pressure', timerOwner: 'AdaptiveRuntimeManager task wheel/zombie timers', recoveryOwner: 'AdaptiveRuntimeManager zombie callback requests SystemBoot restart', evidence: 'KNOWN_OVERLAP', codeEvidence: 'src/core/runtime/AdaptiveRuntimeManager.ts:597-645,927-985,1225-1258', knownDebt: 'I2: execution owner is single, but resource policy ingress is not yet centralized.' },
  { id: 'storage', authority: 'Storage initialization', kind: 'STORAGE', canonicalOwner: 'SystemBoot invokes initSafeStorageAsync', competingOwner: 'domain-local persistence/hydration', lifecycleDomain: 'persistent state', timerOwner: null, recoveryOwner: null, evidence: 'KNOWN_OVERLAP', codeEvidence: 'src/platform/system/SystemBoot.ts:686-719', knownDebt: 'Storage readiness is not yet a formal runtime readiness contract.' },
  { id: 'android-app', authority: 'Android / Capacitor application facts', kind: 'APP_LIFECYCLE', canonicalOwner: 'MainActivity + Capacitor adapters', competingOwner: null, lifecycleDomain: 'Android process/activity', timerOwner: 'MainActivity ANR watchdog', recoveryOwner: 'MainActivity native restart path', evidence: 'KNOWN_OVERLAP', codeEvidence: 'android/app/src/main/java/com/cockpitos/pro/MainActivity.java:78-107,224-269,594-676', knownDebt: 'I5: native process restart is outside SystemBoot recovery arbitration.' },
  { id: 'foreground-service', authority: 'Foreground service bootstrap', kind: 'LIFECYCLE', canonicalOwner: 'No single owner', competingOwner: 'MainActivity · BootReceiver · CommandService · CarLauncherPlugin', lifecycleDomain: 'Android foreground service', timerOwner: 'CarLauncherForegroundService watchdog', recoveryOwner: null, evidence: 'KNOWN_OVERLAP', codeEvidence: 'BootReceiver.java:86-99; MainActivity.java:402-408; CommandService.java:155-240; CarLauncherPlugin.java:4929-4962', knownDebt: 'I7: multiple native start callers exist; F0 records rather than hides this legacy overlap.' },
  { id: 'vehicle-data', authority: 'CAN / OBD / GPS lifecycle', kind: 'DOMAIN_LIFECYCLE', canonicalOwner: 'VehicleDataLayer / VehicleSignalResolver', competingOwner: null, lifecycleDomain: 'vehicle acquisition', timerOwner: 'resolver SAB polling and adapter timers', recoveryOwner: 'SystemBoot worker restart; domain transport recovery', evidence: 'CODE_CONFIRMED', codeEvidence: 'src/platform/vehicleDataLayer/index.ts:144-344; VehicleSignalResolver.ts:123-222', knownDebt: 'Vehicle transport session is distinct from app/process lifecycle.' },
  { id: 'navigation', authority: 'Navigation session lifecycle', kind: 'DOMAIN_LIFECYCLE', canonicalOwner: 'NavigationSessionRuntime', competingOwner: null, lifecycleDomain: 'navigation session', timerOwner: 'NavigationSessionRuntime dead-reckoning timer', recoveryOwner: 'navigationService restore path', evidence: 'CODE_CONFIRMED', codeEvidence: 'src/platform/navigation/navigationSessionRuntime.ts:228-490; navigationService.ts:578-611', knownDebt: null },
  { id: 'music', authority: 'Media authority lifecycle', kind: 'DOMAIN_LIFECYCLE', canonicalOwner: 'mediaAuthorityRuntime + CarosPlaybackService', competingOwner: 'legacy rollback path only when explicitly flagged', lifecycleDomain: 'audio/media', timerOwner: 'media persistence/interpolation timers', recoveryOwner: 'media authority recovery policy', evidence: 'CODE_CONFIRMED', codeEvidence: 'src/platform/system/SystemBoot.ts:690-698; src/platform/media/authority/mediaAuthorityRuntime.ts:249-266', knownDebt: 'F0 Music field validation remains separate from ARCH-01.' },
  { id: 'mavi', authority: 'Mavi lifecycle', kind: 'DOMAIN_LIFECYCLE', canonicalOwner: 'MaviLifecycle / MaviOrchestrator', competingOwner: null, lifecycleDomain: 'voice/assistant', timerOwner: 'domain-owned only', recoveryOwner: 'MaviLifecycle recover/restart', evidence: 'CODE_CONFIRMED', codeEvidence: 'src/platform/maviCore/maviLifecycle.ts:91-239; maviOrchestrator.ts:107-123', knownDebt: null },
  { id: 'phone-link', authority: 'Phone-link lifecycle', kind: 'DOMAIN_LIFECYCLE', canonicalOwner: 'UNKNOWN — passive observation only', competingOwner: null, lifecycleDomain: 'phone/peripheral', timerOwner: null, recoveryOwner: null, evidence: 'UNKNOWN', codeEvidence: 'src/platform/phoneHub/phoneHubLink.ts:1-306', knownDebt: 'I6: no active control-plane authority is asserted from a passive probe.' },
  { id: 'hydration', authority: 'Crash / restore hydration', kind: 'HYDRATION', canonicalOwner: 'SystemBoot crash recovery helpers', competingOwner: 'native Activity restart marker/path', lifecycleDomain: 'process restore', timerOwner: null, recoveryOwner: 'SystemBoot + native MainActivity', evidence: 'KNOWN_OVERLAP', codeEvidence: 'src/platform/system/SystemBoot.ts:1297-1333; MainActivity.java:592-615', knownDebt: 'I9: app, service and vehicle-session epochs are not yet one explicit contract.' },
  { id: 'shutdown', authority: 'TS shutdown / cleanup', kind: 'SHUTDOWN', canonicalOwner: 'SystemBoot LIFO cleanup', competingOwner: 'native Service/Activity onDestroy cleanup', lifecycleDomain: 'TS and native shutdown', timerOwner: 'SystemBoot clears worker backoff timers', recoveryOwner: null, evidence: 'KNOWN_OVERLAP', codeEvidence: 'src/platform/system/SystemBoot.ts:604-632; CarosPlaybackService.java:176-201; CarLauncherForegroundService.java:217-223', knownDebt: 'I10: abrupt process/power loss is not a graceful shutdown contract.' },
] as const);

export const RUNTIME_AUTHORITY_INVARIANTS = Object.freeze([
  'I1 SINGLE_BOOT_AUTHORITY: SystemBoot is the only TS top-level boot authority.',
  'I2 SINGLE_RESOURCE_AUTHORITY: AdaptiveRuntimeManager is the only runtime resource execution authority.',
  'I3 NO_DOMAIN_TRUTH_MIGRATION: ARCH-01 does not own OBD/CAN/navigation/media/Mavi/phone truth.',
  'I4 HEALTH_NE_RECOVERY: observers may report recovery requests but cannot become a new recovery authority.',
  'I5 APP_NE_VEHICLE_LIFECYCLE: app, process, transport, vehicle session and ignition facts stay distinct.',
  'I6 UNKNOWN_IS_REAL: absent evidence cannot become OFF/ON/READY.',
  'I7 NO_DOUBLE_START: competing start callers are explicit KNOWN_DEBT until consolidated.',
  'I8 NO_HIDDEN_TIMER_OWNERSHIP: lifecycle/recovery timers require a named owner.',
  'I9 STALE_ASYNC_RISK: stale completion risks require evidence and future epoch gating.',
  'I10 SHUTDOWN_MUST_BE_EXPLICIT: cleanup ownership is recorded; process death is not cleanup.',
] as const);
