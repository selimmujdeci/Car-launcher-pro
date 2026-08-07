/**
 * companion — Companion Foundation (PHONE-HUB P1-PREP) barrel.
 *
 * ── BU MODÜLÜ IMPORT ETMEK YAN ETKİSİZDİR ───────────────────────────────────
 * Timer kurulmaz · abonelik açılmaz · native çağrı yapılmaz · global singleton
 * OLUŞTURULMAZ · depolama okunmaz. Her şey açık fabrika çağrısıyla başlar.
 *
 * ── GERÇEK BAĞLANTI YOKTUR ──────────────────────────────────────────────────
 * Taşıma tamamen soyuttur. Bu derlemede UYGULANMIŞ tek adapter `MOCK`'tur;
 * BLE · RFCOMM · USB · Wi-Fi Direct · TCP · vendor servisi · MCU köprüsü için
 * yalnız SÖZLEŞME vardır. Eşleştirme · keşif · tarama · soket · medya komutu ·
 * çağrı · SMS · izin isteği bu katmanda GEÇMEZ (statik tarama ile kilitli).
 */

export {
  COMPANION_SCHEMA_VERSION, COMPANION_PROTOCOL_VERSION, COMPANION_MIN_PROTOCOL_VERSION,
  COMPANION_ENVELOPE_SCHEMA_VERSION,
  COMPANION_TRANSPORT_TYPES, IMPLEMENTED_TRANSPORT_TYPES, TRANSPORT_TYPE_LABEL,
  COMPANION_CAPABILITIES, CAPABILITY_LABEL, CAPABILITY_PRIVACY,
  COMPANION_PEER_ROLES, COMPANION_ERROR_LABEL,
  MAX_CAPABILITIES, MAX_PAYLOAD_CHARS, MAX_KNOWN_DEVICES,
  isTransportImplemented, normalizeTransportType, normalizePeerRole,
  isKnownCapability, isValidCapabilityToken, companionErrorLabel,
  clampText, fnv1aHex, stableStringify,
  type CompanionTransportType, type CompanionCapability, type CapabilityToken,
  type CapabilityPrivacyClass, type CompanionPeerRole, type CompanionErrorCode,
} from './companionDomain';

export {
  CONNECTION_STATES, CONNECTION_ACTIONS, CONNECTION_STATE_LABEL,
  CONNECTION_ACTION_LABEL, CONNECTION_TRANSITIONS,
  transition, allowedActions, transitionTable,
  isActiveState, isRestingState, canSendApplicationMessage, expectsHeartbeat,
  isValidState, isValidAction, normalizeState,
  type ConnectionState, type ConnectionAction, type TransitionResult,
} from './connectionStateMachine';

export {
  HANDSHAKE_TIMEOUT_MS, HEARTBEAT_INTERVAL_MS, HEARTBEAT_DEGRADE_MS,
  HEARTBEAT_LOSS_MS, SESSION_RESUME_WINDOW_MS,
  createPhoneHubSession, withStatus, withHeartbeat, withNegotiated, withTransport,
  withNextGeneration, assessHeartbeat, isHandshakeTimedOut, isResumable,
  connectDurationMs, migratePhoneHubSession, demoteRestoredSession,
  type PhoneHubSession, type CreateSessionInput, type HeartbeatVerdict,
} from './companionSession';

export {
  CompanionCapabilityRegistry, createCompanionCapabilityRegistry,
  LOCALLY_SUPPORTED_CAPABILITIES, CAPABILITY_STATUS_LABEL,
  capabilityDigest, capabilitiesChanged,
  type CapabilityStatus, type CapabilityRecord, type CapabilitySnapshot,
  type CompanionCapabilityRegistryDeps,
} from './companionCapabilityRegistry';

export {
  ENVELOPE_KINDS, SUPPORTED_COMPRESSION, SUPPORTED_ENCRYPTION,
  computeEnvelopeChecksum, buildEnvelope, buildRequest, buildResponse, buildAck,
  validateEnvelope, verifyChecksum, matchesRequest,
  type CompanionEnvelope, type EnvelopeKind, type EnvelopeCompression,
  type EnvelopeEncryption, type EnvelopeValidation, type BuildEnvelopeInput,
} from './messageEnvelope';

export {
  LOCAL_PROTOCOL_RANGE, HELLO_PAYLOAD_TYPE, HELLO_ACCEPT_PAYLOAD_TYPE,
  negotiateProtocol, negotiateFeatures, buildHelloPayload, parseHelloPayload,
  type ProtocolRange, type ProtocolNegotiationResult, type FeatureNegotiationResult,
  type CompanionHelloPayload, type ParsedHello,
} from './protocolNegotiation';

export {
  PAIRING_TRUST_LABEL, derivePeerKeyHash, createKnownDevice,
  withSeen, withUserTrust, withRevokedTrust, withConnectCount,
  isPairingAllowed, pairingDenialReason, upsertKnownDevice, findKnownDevice,
  migrateKnownDevice, migrateKnownDevices,
  type PairingTrust, type KnownDeviceRecord,
} from './pairingModel';

export {
  TRANSPORT_OK, transportFail, createUnimplementedTransport,
  type ConnectionTransport, type TransportResult, type TransportStatus,
  type TransportDescriptor, type TransportInbound, type TransportLinkState,
} from './connectionTransport';

export {
  MockTransport, createMockTransport, createScenarioTransport,
  scenarioScript, MOCK_SCENARIOS, MOCK_SCENARIO_LABEL,
  type MockStep, type MockStepKind, type MockTransportDeps, type MockScenarioName,
} from './mockTransport';

export {
  COMPANION_EVENTS, COMPANION_EVENT_NAMES, COMPANION_EVENT_CATALOG,
  CompanionEventBridge, createCompanionEventBridge,
  type CompanionEventKey, type CompanionEventName, type CompanionEventTarget,
  type CompanionEventBridgeStatus, type CompanionSessionEventPayload,
  type CompanionCapabilitiesEventPayload, type CompanionHeartbeatEventPayload,
  type CompanionErrorEventPayload, type CompanionMessageEventPayload,
} from './companionEvents';

export {
  COMPANION_ACTION_IDS, COMPANION_ACTIONS, COMPANION_ACTION_CAPABILITY,
  registerCompanionActions, isCompanionActionExecutable, companionActionPrivacy,
  type CompanionActionId, type CompanionActionRegistrationResult,
} from './companionActions';

export {
  CompanionTelemetry, createCompanionTelemetry, emptyTelemetrySnapshot,
  type CompanionTelemetrySnapshot,
} from './companionTelemetry';

export {
  COMPANION_KEY_SESSION, COMPANION_KEY_DEVICES, COMPANION_KEY_CAPS,
  COMPANION_KEY_TELEMETRY, COMPANION_STORAGE_KEYS,
  isDeniedStorageKey, sanitizeForStorage,
  saveCompanionSession, loadCompanionSession,
  saveKnownDevices, loadKnownDevices,
  saveCapabilityCache, loadCapabilityCache,
  saveCompanionTelemetry, loadCompanionTelemetryRaw,
  clearCompanionStorage, companionStorageHealth,
  type CapabilityCacheEntry, type CompanionStorageHealth,
} from './companionStore';

export {
  CompanionSessionManager, createCompanionSessionManager,
  type CompanionSessionManagerDeps, type CompanionOpResult,
  type PumpResult, type TickResult,
} from './companionSessionManager';

export {
  dumpSession, dumpCapabilities, dumpTransport, dumpTelemetry, assessFoundation,
  type SessionDump, type CapabilitiesDump, type TransportDump, type TelemetryDump,
  type FoundationReadiness, type FoundationVerdict, type FoundationCheckInput,
} from './companionStateDump';
