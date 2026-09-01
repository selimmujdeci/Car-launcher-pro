/**
 * ARCH-05 canonical security contract.  This module is deliberately pure: it
 * describes evidence and makes a fail-closed decision; domain owners retain
 * execution and native gates retain their independent final decision.
 */
export type PrincipalType = 'LOCAL_UI' | 'MAVI' | 'PHONE_DEVICE' | 'NATIVE_SYSTEM' | 'SYSTEM_INTERNAL' | 'REPLAY_SOURCE' | 'IMPORTED_SOURCE' | 'LAB' | 'UNKNOWN';
export type AuthenticationState = 'AUTHENTICATED' | 'NOT_AUTHENTICATED' | 'UNKNOWN';
export type Provenance = 'LIVE' | 'REPLAY' | 'IMPORTED' | 'SYNTHETIC' | 'LAB' | 'UNKNOWN';
export type Capability = 'MEDIA_CONTROL' | 'NAVIGATION_CONTROL' | 'PHONE_CONTROL' | 'VEHICLE_READ' | 'DIAGNOSTIC_READ' | 'CLEAR_DTC' | 'DIAGNOSTIC_PRIVILEGED' | 'RUNTIME_ADMIN' | 'SETTINGS_WRITE' | 'STORAGE_ADMIN' | 'REMOTE_INPUT' | 'SCREEN_PROJECTION' | 'HARDWARE_MEDIA' | 'UNKNOWN';
export type RiskClass = 'READ_ONLY' | 'USER_CONTROL' | 'VEHICLE_CONTROL' | 'PRIVILEGED' | 'DESTRUCTIVE' | 'SECURITY_SENSITIVE' | 'UNKNOWN';
export type MotionClass = 'MOVING' | 'PARKED' | 'UNKNOWN';
export type AuthorizationDecision = 'ALLOW' | 'DENY' | 'BLOCKED' | 'STALE' | 'NOT_AUTHENTICATED' | 'NOT_ATTACHED' | 'CAPABILITY_NOT_GRANTED' | 'MOTION_RESTRICTED' | 'NOT_SUPPORTED' | 'UNAVAILABLE' | 'UNKNOWN';

export interface Principal {
  readonly principalType: PrincipalType;
  /** Opaque reference only; never a raw phone id, VIN, token, or credential. */
  readonly principalIdRef: string | null;
  readonly deviceIdentityRef?: string | null;
  readonly personIdentityRef?: string | null;
  readonly vehicleRef?: string | null;
  readonly sessionRef?: string | null;
  readonly generation?: number | null;
  readonly authenticationState: AuthenticationState;
  readonly provenance: Provenance;
}

export interface CapabilityDescriptor {
  readonly id: Capability;
  readonly owner: string;
  readonly riskClass: RiskClass;
  readonly requiresAuthenticatedPrincipal: boolean;
  readonly requiresAttachedSession: boolean;
  readonly requiresVehicleScope: boolean;
  readonly parkedOnly: boolean;
  readonly requiresNativePermission: boolean;
  readonly replayAllowed: boolean;
}

export const CAPABILITIES: Readonly<Record<Capability, CapabilityDescriptor>> = Object.freeze({
  MEDIA_CONTROL: { id: 'MEDIA_CONTROL', owner: 'MediaAuthority', riskClass: 'USER_CONTROL', requiresAuthenticatedPrincipal: false, requiresAttachedSession: false, requiresVehicleScope: false, parkedOnly: false, requiresNativePermission: false, replayAllowed: false },
  NAVIGATION_CONTROL: { id: 'NAVIGATION_CONTROL', owner: 'NavigationOwner', riskClass: 'USER_CONTROL', requiresAuthenticatedPrincipal: false, requiresAttachedSession: false, requiresVehicleScope: false, parkedOnly: false, requiresNativePermission: false, replayAllowed: false },
  PHONE_CONTROL: { id: 'PHONE_CONTROL', owner: 'PhoneHub', riskClass: 'USER_CONTROL', requiresAuthenticatedPrincipal: true, requiresAttachedSession: true, requiresVehicleScope: false, parkedOnly: false, requiresNativePermission: true, replayAllowed: false },
  VEHICLE_READ: { id: 'VEHICLE_READ', owner: 'VehicleDataLayer', riskClass: 'READ_ONLY', requiresAuthenticatedPrincipal: false, requiresAttachedSession: false, requiresVehicleScope: true, parkedOnly: false, requiresNativePermission: false, replayAllowed: false },
  /* ── DIAGNOSTIC_READ politikası (ARCH-05 üretim uyarlaması) ──────────────
     `requiresVehicleScope` DÖNGÜSEL olurdu: aracın kimliği ancak OKUYARAK
     çözülür (VIN/DID/parmak izi hepsi salt-okunur teşhis sorgularıdır).
     Kimlik şartı koymak, kimliği üreten işlemi yasaklamak demektir.
     `requiresNativePermission` de JS'ten ÖLÇÜLEMEZ (OBD satırının izin durumu
     `UNKNOWN`dur) — ölçülemeyen bir şartı zorunlu kılmak her okumayı sessizce
     UNAVAILABLE yapardı. Salt-okuma yolu KAPISIZ DEĞİLDİR: açık yetenek
     kapısı burada da işler ve native `DiagnosticServiceGate` ayrıca/bağımsız
     son kapıdır — çift kapı GEVŞETİLMEDİ. Yazan/yıkıcı yeteneklerde
     (CLEAR_DTC · DIAGNOSTIC_PRIVILEGED) araç kapsamı ve native izin
     ZORUNLU KALIR. */
  DIAGNOSTIC_READ: { id: 'DIAGNOSTIC_READ', owner: 'DiagnosticTransaction', riskClass: 'READ_ONLY', requiresAuthenticatedPrincipal: false, requiresAttachedSession: false, requiresVehicleScope: false, parkedOnly: false, requiresNativePermission: false, replayAllowed: false },
  CLEAR_DTC: { id: 'CLEAR_DTC', owner: 'DtcWriteGate', riskClass: 'DESTRUCTIVE', requiresAuthenticatedPrincipal: true, requiresAttachedSession: false, requiresVehicleScope: true, parkedOnly: true, requiresNativePermission: true, replayAllowed: false },
  DIAGNOSTIC_PRIVILEGED: { id: 'DIAGNOSTIC_PRIVILEGED', owner: 'DiagnosticServiceGate', riskClass: 'SECURITY_SENSITIVE', requiresAuthenticatedPrincipal: true, requiresAttachedSession: true, requiresVehicleScope: true, parkedOnly: true, requiresNativePermission: true, replayAllowed: false },
  /* Yeniden başlatma SÜREÇ-İÇİ bir eylemdir; hiçbir Android iznine bağlı
     değildir ve JS'ten ölçülebilir bir izin durumu YOKTUR. Ölçülemeyen bir
     şartı zorunlu kılmak, iç kurtarmayı sessizce UNAVAILABLE yapardı. Kapı
     yine güçlüdür: `RUNTIME_ADMIN` yetkisi YALNIZ `SYSTEM_INTERNAL`e verilir. */
  RUNTIME_ADMIN: { id: 'RUNTIME_ADMIN', owner: 'RuntimeRecoverySupervisor', riskClass: 'PRIVILEGED', requiresAuthenticatedPrincipal: true, requiresAttachedSession: false, requiresVehicleScope: false, parkedOnly: false, requiresNativePermission: false, replayAllowed: false },
  SETTINGS_WRITE: { id: 'SETTINGS_WRITE', owner: 'SettingsOwner', riskClass: 'USER_CONTROL', requiresAuthenticatedPrincipal: true, requiresAttachedSession: false, requiresVehicleScope: false, parkedOnly: false, requiresNativePermission: false, replayAllowed: false },
  /* Uygulama-özel depolama (Capacitor Filesystem + localStorage) OS izni
     GEREKTİRMEZ — ARCH-04 `SAFE_STORAGE` satırı da izni `NOT_APPLICABLE`
     ölçer. Yetki kapısı yerinde durur: `STORAGE_ADMIN` yalnız `LOCAL_UI`ye
     verilir; Mavi, telefon ve replay bunu ASLA alamaz. */
  STORAGE_ADMIN: { id: 'STORAGE_ADMIN', owner: 'StorageOwner', riskClass: 'DESTRUCTIVE', requiresAuthenticatedPrincipal: true, requiresAttachedSession: false, requiresVehicleScope: false, parkedOnly: false, requiresNativePermission: false, replayAllowed: false },
  REMOTE_INPUT: { id: 'REMOTE_INPUT', owner: 'PhoneHub', riskClass: 'PRIVILEGED', requiresAuthenticatedPrincipal: true, requiresAttachedSession: true, requiresVehicleScope: true, parkedOnly: true, requiresNativePermission: true, replayAllowed: false },
  SCREEN_PROJECTION: { id: 'SCREEN_PROJECTION', owner: 'PhoneHub', riskClass: 'USER_CONTROL', requiresAuthenticatedPrincipal: true, requiresAttachedSession: true, requiresVehicleScope: false, parkedOnly: false, requiresNativePermission: true, replayAllowed: false },
  HARDWARE_MEDIA: { id: 'HARDWARE_MEDIA', owner: 'MediaAuthority', riskClass: 'USER_CONTROL', requiresAuthenticatedPrincipal: false, requiresAttachedSession: false, requiresVehicleScope: false, parkedOnly: false, requiresNativePermission: true, replayAllowed: false },
  UNKNOWN: { id: 'UNKNOWN', owner: 'Unknown', riskClass: 'UNKNOWN', requiresAuthenticatedPrincipal: true, requiresAttachedSession: true, requiresVehicleScope: true, parkedOnly: true, requiresNativePermission: true, replayAllowed: false },
});

export interface AuthorizationInput {
  readonly principal: Principal;
  readonly capability: Capability;
  readonly targetRef: string | null;
  readonly vehicleRef: string | null;
  readonly attached: boolean;
  readonly currentGeneration: number | null;
  readonly grantedCapabilities: readonly Capability[];
  readonly motion: MotionClass;
  readonly nativePermission: boolean | null;
  readonly available: boolean;
  readonly operationId?: string | null;
}

export interface SecurityDecisionEvidence {
  readonly decisionId: string;
  readonly principalRef: string | null;
  readonly capability: Capability;
  readonly targetRef: string | null;
  readonly decision: AuthorizationDecision;
  readonly reason: string;
  readonly generation: number | null;
  readonly vehicleRef: string | null;
  readonly motionClass: MotionClass;
  readonly provenance: Provenance;
  readonly atMs: number;
  readonly correlationId: string | null;
}

const MAX_DECISION_EVIDENCE = 40;
let recentDecisions: readonly SecurityDecisionEvidence[] = [];
/** Bounded, privacy-safe audit projection. It is never consulted by authorize. */
export function getRecentSecurityDecisions(): readonly SecurityDecisionEvidence[] { return recentDecisions; }
export function _resetSecurityDecisionsForTest(): void { recentDecisions = []; }

export function authorize(input: AuthorizationInput, nowMs = Date.now()): SecurityDecisionEvidence {
  const d = CAPABILITIES[input.capability] ?? CAPABILITIES.UNKNOWN;
  let decision: AuthorizationDecision = 'ALLOW'; let reason = 'policy_satisfied';
  if (input.principal.principalType === 'UNKNOWN' || input.capability === 'UNKNOWN') [decision, reason] = ['DENY', 'unknown_principal_or_capability'];
  else if (input.principal.provenance !== 'LIVE' && !d.replayAllowed) [decision, reason] = ['DENY', 'non_live_provenance_cannot_authorize'];
  else if (d.requiresAuthenticatedPrincipal && input.principal.authenticationState !== 'AUTHENTICATED') [decision, reason] = ['NOT_AUTHENTICATED', 'authentication_evidence_missing'];
  else if (d.requiresAttachedSession && !input.attached) [decision, reason] = ['NOT_ATTACHED', 'attached_session_evidence_missing'];
  else if (input.principal.generation !== null && input.currentGeneration !== null && input.principal.generation !== input.currentGeneration) [decision, reason] = ['STALE', 'session_generation_changed'];
  else if (d.requiresVehicleScope && (!input.vehicleRef || input.principal.vehicleRef !== input.vehicleRef)) [decision, reason] = ['DENY', 'vehicle_scope_mismatch'];
  else if (d.parkedOnly && input.motion !== 'PARKED') [decision, reason] = ['MOTION_RESTRICTED', 'verified_parked_evidence_required'];
  else if (d.requiresNativePermission && input.nativePermission !== true) [decision, reason] = ['UNAVAILABLE', 'native_permission_or_capability_missing'];
  else if (!input.available) [decision, reason] = ['UNAVAILABLE', 'owner_unavailable'];
  else if (!input.grantedCapabilities.includes(input.capability)) [decision, reason] = ['CAPABILITY_NOT_GRANTED', 'explicit_capability_grant_missing'];
  const evidence = Object.freeze({ decisionId: `sec-${nowMs}-${input.capability}`, principalRef: input.principal.principalIdRef, capability: input.capability, targetRef: input.targetRef, decision, reason, generation: input.principal.generation ?? null, vehicleRef: input.vehicleRef, motionClass: input.motion, provenance: input.principal.provenance, atMs: nowMs, correlationId: input.operationId ?? null });
  recentDecisions = Object.freeze([evidence, ...recentDecisions].slice(0, MAX_DECISION_EVIDENCE));
  return evidence;
}

/** Recheck immediately before side effects to close session/vehicle TOCTOU. */
export function canExecute(evidence: SecurityDecisionEvidence, current: Pick<AuthorizationInput, 'principal' | 'vehicleRef' | 'currentGeneration'>): boolean {
  return evidence.decision === 'ALLOW' && evidence.provenance === 'LIVE' && evidence.vehicleRef === current.vehicleRef && evidence.generation === (current.principal.generation ?? null) && (evidence.generation === null || evidence.generation === current.currentGeneration);
}
