/**
 * ARCH-04/F1 — data-only native-boundary vocabulary.  This is deliberately
 * neither a plugin router nor a domain owner: native bridges remain transports
 * and existing domains retain execution and truth authority.
 */
export type NativeOperationClass =
  | 'READ_ONLY_QUERY' | 'OBSERVATION_STREAM' | 'IDEMPOTENT_COMMAND'
  | 'STATEFUL_COMMAND' | 'PRIVILEGED_COMMAND' | 'TRANSPORT_OPERATION'
  | 'BACKGROUND_SERVICE_OPERATION' | 'PERSISTENCE_OPERATION' | 'UNKNOWN';
export type NativeAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
export type NativeConformanceStatus = 'PASS' | 'PARTIAL' | 'UNKNOWN';

export interface NativeCapabilityDescriptor {
  readonly id: string;
  readonly domain: string;
  readonly owner: string;
  readonly bridge: string;
  readonly operationClass: NativeOperationClass;
  readonly sideEffect: boolean;
  readonly hotStream: boolean;
  readonly permission: string | null;
  readonly sessionGuard: string | null;
  readonly fallback: string | null;
  readonly privacy: 'REFERENCE_ONLY' | 'SENSITIVE' | 'NONE';
}

export interface NativeBoundaryConformance {
  readonly capabilityId: string;
  readonly ownerKnown: boolean;
  readonly bridgeKnown: boolean;
  readonly requestSemanticsKnown: boolean;
  readonly resultSemanticsKnown: boolean;
  readonly staleGuard: boolean;
  readonly permissionGuard: boolean;
  readonly privacyGuard: boolean;
  readonly fallbackKnown: boolean;
  readonly authorityBypass: boolean;
  readonly status: NativeConformanceStatus;
}

const CAPABILITIES: readonly NativeCapabilityDescriptor[] = Object.freeze([
  { id: 'gps.location', domain: 'GPS', owner: 'gpsService→VDL', bridge: 'CarLauncherPlugin', operationClass: 'OBSERVATION_STREAM', sideEffect: false, hotStream: true, permission: 'LOCATION', sessionGuard: 'gpsGeneration', fallback: 'web_geolocation_limited', privacy: 'SENSITIVE' },
  { id: 'obd.diagnostic_pdu', domain: 'OBD', owner: 'DiagnosticTransaction', bridge: 'CarLauncher.sendDiagnosticPdu', operationClass: 'TRANSPORT_OPERATION', sideEffect: true, hotStream: false, permission: 'BLUETOOTH', sessionGuard: 'sessionEpoch', fallback: null, privacy: 'SENSITIVE' },
  { id: 'media.playback', domain: 'MEDIA', owner: 'native playback service/playbackTruth', bridge: 'CarLauncher.mediaAuthority*', operationClass: 'STATEFUL_COMMAND', sideEffect: true, hotStream: false, permission: null, sessionGuard: 'media session/revision', fallback: 'unavailable', privacy: 'REFERENCE_ONLY' },
  { id: 'foreground.location_service', domain: 'RUNTIME', owner: 'CarLauncherForegroundService', bridge: 'CarLauncherPlugin', operationClass: 'BACKGROUND_SERVICE_OPERATION', sideEffect: true, hotStream: false, permission: 'FOREGROUND_LOCATION', sessionGuard: 'lifecycle epoch', fallback: null, privacy: 'NONE' },
  { id: 'phone.session', domain: 'PHONE_LINK', owner: 'companionSessionManager', bridge: 'PhoneHubLinkPlugin', operationClass: 'TRANSPORT_OPERATION', sideEffect: true, hotStream: false, permission: 'NEARBY_DEVICES', sessionGuard: 'companion generation', fallback: 'unavailable', privacy: 'SENSITIVE' },
  { id: 'can.acquire', domain: 'CAN', owner: 'CanAdapter→VDL', bridge: 'CarLauncher.canData', operationClass: 'OBSERVATION_STREAM', sideEffect: false, hotStream: true, permission: null, sessionGuard: 'CAN listener generation', fallback: 'unavailable', privacy: 'REFERENCE_ONLY' },
  { id: 'safe_storage.atomic_write', domain: 'STORAGE', owner: 'safeStorage', bridge: 'Capacitor Filesystem', operationClass: 'PERSISTENCE_OPERATION', sideEffect: true, hotStream: false, permission: 'APP_STORAGE', sessionGuard: null, fallback: 'localStorage backup', privacy: 'SENSITIVE' },
  { id: 'hardware.media_action', domain: 'MEDIA', owner: 'mediaCommandGateway', bridge: 'Android MediaSession', operationClass: 'IDEMPOTENT_COMMAND', sideEffect: true, hotStream: false, permission: null, sessionGuard: 'media command id', fallback: 'unavailable', privacy: 'REFERENCE_ONLY' },
]);

export function getNativeCapabilityDescriptors(): readonly NativeCapabilityDescriptor[] {
  return CAPABILITIES;
}

export function assessNativeBoundaryConformance(capability: NativeCapabilityDescriptor): NativeBoundaryConformance {
  const staleGuard = capability.sessionGuard !== null || capability.operationClass === 'READ_ONLY_QUERY';
  const permissionGuard = capability.permission !== null || capability.operationClass !== 'PRIVILEGED_COMMAND';
  const privacyGuard = capability.privacy !== 'SENSITIVE' || capability.bridge !== '';
  const fallbackKnown = capability.fallback !== null || capability.operationClass === 'TRANSPORT_OPERATION';
  const status: NativeConformanceStatus = staleGuard && permissionGuard && privacyGuard ? 'PASS' : 'PARTIAL';
  return Object.freeze({ capabilityId: capability.id, ownerKnown: capability.owner.length > 0, bridgeKnown: capability.bridge.length > 0, requestSemanticsKnown: capability.operationClass !== 'OBSERVATION_STREAM', resultSemanticsKnown: capability.operationClass !== 'OBSERVATION_STREAM', staleGuard, permissionGuard, privacyGuard, fallbackKnown, authorityBypass: false, status });
}
