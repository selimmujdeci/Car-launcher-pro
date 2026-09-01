/** ARCH-01/F9.2 — read-only domain evidence adapters. */
import { getRouteState } from '../routingService';
import { getNavigationState } from '../navigationService';
import { getOfflineRoutingStatus } from '../navigation/offlineRoutingStatus';
import { getProviderReadinessSnapshot } from '../navigation/core/routeProviderReadiness';
import { getSnapshot as getMediaNativeSnapshot } from '../media/authority/nativeAuthorityBridge';
import { getMediaAuthorityEvidence } from '../media/authority/mediaAuthorityEvidence';
import { getPhoneHubLink, getPhoneHubLinkCachedAt } from '../phoneHub/phoneHubLink';
import { useHALStatusStore } from '../vehicleDataLayer/halStatusStore';
import { getDiagnosticAdmissionEvidence } from '../obd/diagnosticAdmission';
import { getOBDDataSnapshot } from '../obdService';
import { getMaviVoiceWiringDiagnostics } from '../system/platformCoreMaviVoiceWiring';
import { getSafeStorageDiagnostics } from '../../utils/safeStorage';
import type { RuntimeDomainAvailabilityEvidence } from './runtimeResilience';

function ageFreshness(atMs: number | null, nowMs: number): 'CURRENT' | 'STALE' | 'UNKNOWN' {
  if (atMs === null || !Number.isFinite(atMs)) return 'UNKNOWN';
  return nowMs - atMs <= 60_000 && nowMs >= atMs ? 'CURRENT' : 'STALE';
}

/** Every adapter below only reads an existing owner snapshot. */
export function readRuntimeDomainAvailabilityAdapters(nowMs: number): readonly RuntimeDomainAvailabilityEvidence[] {
  const out: RuntimeDomainAvailabilityEvidence[] = [];
  let halEvidence: RuntimeDomainAvailabilityEvidence | null = null;
  try {
    const hal = useHALStatusStore.getState();
    halEvidence = {
      serviceId: 'VehicleDataLayer', availability: hal.sourceHealth.canAlive === false && hal.sourceHealth.obdAlive === false ? 'DEGRADED' : 'UNKNOWN', freshness: 'UNKNOWN', allowedOperations: [], deniedOperations: [], fallback: null,
      reason: 'HAL source health is transport evidence only; it does not infer vehicle OFF.', provenance: ['halStatusStore.getState().sourceHealth'], readinessEvidence: `can=${String(hal.sourceHealth.canAlive)}; obd=${String(hal.sourceHealth.obdAlive)}; gps=${String(hal.sourceHealth.gpsAlive)}`, healthEvidence: 'HAL sourceHealth timestamp is monotonic/implementation-specific and is not compared to wall-clock time.'
    };
  } catch { /* HAL source unavailable */ }
  try {
    const route = getRouteState(); const nav = getNavigationState(); const offline = getOfflineRoutingStatus(); const provider = getProviderReadinessSnapshot();
    if (offline.state === 'AVAILABLE' && offline.lastAttemptAt !== null) {
      out.push({ serviceId: 'NavigationSessionRuntime', availability: 'LIMITED', freshness: ageFreshness(offline.lastAttemptAt, nowMs), allowedOperations: ['offline-route'], deniedOperations: ['online-reroute'], fallback: null, reason: 'Offline routing graph is observed; full guidance readiness is not implied.', provenance: ['offlineRoutingStatus.getOfflineRoutingStatus()', 'routeProviderReadiness.getProviderReadinessSnapshot()'], readinessEvidence: `offline=${offline.state}; provider=${provider.localState}`, healthEvidence: 'Navigation health source is not exposed.' });
    } else if (route.geometry !== null && nav.isGuidanceActive) {
      out.push({ serviceId: 'NavigationSessionRuntime', availability: 'UNKNOWN', freshness: 'UNKNOWN', allowedOperations: [], deniedOperations: [], fallback: null, reason: 'Route and guidance are active, but no timestamped readiness evidence is exposed.', provenance: ['routingService.getRouteState()', 'navigationService.getNavigationState()'], readinessEvidence: `guidance=${String(nav.isGuidanceActive)}; geometry=present`, healthEvidence: 'Navigation health source is not exposed.' });
    } else if (provider.localState === 'NO_ROUTE_PROVIDER' && route.error !== null) {
      out.push({ serviceId: 'NavigationSessionRuntime', availability: 'UNAVAILABLE', freshness: 'UNKNOWN', allowedOperations: [], deniedOperations: ['route'], fallback: null, reason: 'Navigation owner reports route error and no provider.', provenance: ['routingService.getRouteState()', 'routeProviderReadiness.getProviderReadinessSnapshot()'], readinessEvidence: `provider=${provider.localState}`, healthEvidence: 'Navigation health source is not exposed.' });
    }
  } catch { /* domain evidence remains UNKNOWN */ }
  try {
    const media = getMediaNativeSnapshot(); const evidence = getMediaAuthorityEvidence();
    const latestAt = evidence.recentCommands.length > 0 ? evidence.recentCommands[evidence.recentCommands.length - 1].atMs : null;
    const current = ageFreshness(latestAt, nowMs) === 'CURRENT';
    const available = media.authorityAvailable && media.renderingVerified === true && current;
    out.push({ serviceId: 'media-authority', availability: available ? 'FULL' : media.authorityAvailable && evidence.status === 'OBSERVED' ? 'DEGRADED' : 'UNKNOWN', freshness: ageFreshness(latestAt, nowMs), allowedOperations: available ? ['playback-transport'] : [], deniedOperations: available ? [] : ['playback-transport'], fallback: null, reason: available ? 'Native authority and rendering evidence are current.' : media.authorityAvailable ? 'Authority exists but current rendering/health evidence is insufficient.' : 'Native media authority is unavailable.', provenance: ['nativeAuthorityBridge.getSnapshot()', 'getMediaAuthorityEvidence()'], readinessEvidence: `authorityAvailable=${String(media.authorityAvailable)}; renderingVerified=${String(media.renderingVerified)}`, healthEvidence: `mediaEvidence=${evidence.status}; latestCommandAt=${latestAt === null ? 'UNKNOWN' : String(latestAt)}` });
  } catch { /* media remains registry-derived */ }
  try {
    const admission = getDiagnosticAdmissionEvidence();
    const obd = getOBDDataSnapshot();
    const freshness = ageFreshness(obd.lastSeenMs > 0 ? obd.lastSeenMs : null, nowMs);
    out.push({ serviceId: 'VehicleDataLayer', availability: admission.admission === 'READY' ? 'LIMITED' : admission.admission === 'TRANSPORT_DOWN' ? 'UNAVAILABLE' : 'UNKNOWN', freshness, allowedOperations: admission.admission === 'READY' ? ['diagnostic-read'] : [], deniedOperations: admission.admission === 'READY' ? [] : ['diagnostic-read'], fallback: null, reason: `OBD diagnostic admission=${admission.admission}; transport connected is not diagnostic readiness.`, provenance: ['diagnosticAdmission.getDiagnosticAdmissionEvidence()', 'obdService.getOBDDataSnapshot().lastSeenMs', ...(halEvidence?.provenance ?? [])], readinessEvidence: `admission=${admission.admission}${halEvidence ? `; ${halEvidence.readinessEvidence}` : ''}`, healthEvidence: `OBD session health is embedded in admission evidence; ${halEvidence?.healthEvidence ?? 'HAL source health unavailable.'}` });
  } catch { /* OBD evidence unavailable */ }
  try {
    const phone = getPhoneHubLink(); const cachedAt = getPhoneHubLinkCachedAt();
    const established = phone.present === true && phone.preconditions?.ready === true && phone.session?.trulyEstablished === true && phone.session?.disposed !== true;
    const capabilityCount = Array.isArray(phone.session?.grantedCapabilities) ? phone.session!.grantedCapabilities!.length : 0;
    out.push({ serviceId: 'PhoneLink', availability: established ? 'FULL' : 'UNKNOWN', freshness: cachedAt === 0 ? 'UNKNOWN' : ageFreshness(cachedAt, nowMs), allowedOperations: established ? ['phone-link-control-plane'] : [], deniedOperations: established ? [] : ['phone-link-control-plane'], fallback: null, reason: established ? 'Current native Phone Hub snapshot proves preconditions and established session.' : phone.present ? 'Phone Hub cache exists, but preconditions/session establishment are not proven.' : 'Phone Link active authority is not exposed.', provenance: ['phoneHubLink.getPhoneHubLink()', 'phoneHubLink.getPhoneHubLinkCachedAt()'], readinessEvidence: `present=${String(phone.present)}; preconditionsReady=${String(phone.preconditions?.ready)}; trulyEstablished=${String(phone.session?.trulyEstablished)}; generation=${String(phone.session?.generation ?? 'UNKNOWN')}; capabilities=${capabilityCount}`, healthEvidence: `server=${String(phone.server?.state ?? 'UNKNOWN')}; error=${String(phone.lastErrorCode ?? phone.session?.lastErrorCode ?? 'NONE')}`, lifecycleEpoch: phone.session?.generation ?? null });
  } catch { /* passive probe unavailable */ }
  try {
    const mavi = getMaviVoiceWiringDiagnostics();
    out.push({ serviceId: 'MaviRuntime', availability: 'UNKNOWN', freshness: 'UNKNOWN', allowedOperations: [], deniedOperations: [], fallback: null, reason: mavi.active ? 'Mavi wiring is active, but lifecycle/listening/action readiness has no current owner timestamp.' : 'Mavi wiring is not active; assistant availability cannot be inferred.', provenance: [...mavi.provenance], readinessEvidence: `active=${String(mavi.active)}; mode=${mavi.mode ?? 'UNKNOWN'}; generation=${mavi.generation ?? 'UNKNOWN'}; session=${mavi.sessionId ?? 'UNKNOWN'}`, healthEvidence: 'Mavi provider/dependency health is not exposed as a canonical owner snapshot.', lifecycleEpoch: mavi.generation });
  } catch { /* Mavi owner evidence unavailable */ }
  try {
    const storage = getSafeStorageDiagnostics();
    out.push({ serviceId: 'safe-storage', availability: 'UNKNOWN', freshness: 'UNKNOWN', allowedOperations: storage.readable === true ? ['runtime-read'] : [], deniedOperations: ['persistence-write'], fallback: null, reason: storage.readable === true ? 'Read surface is available, but writable persistence is intentionally unproven without an I/O probe.' : 'Storage read surface is unavailable or unmeasured.', provenance: [...storage.provenance], readinessEvidence: `platform=${storage.platform}; nativeCacheHydrated=${String(storage.nativeCacheHydrated)}; readable=${String(storage.readable)}`, healthEvidence: `writable=${storage.writable}; observedAt=${String(storage.observedAt)}` });
  } catch { /* storage evidence unavailable */ }
  try {
    const browserOnline = typeof navigator === 'undefined' ? null : navigator.onLine;
    if (browserOnline === false) {
      out.push({ serviceId: 'CommunityService', availability: 'UNAVAILABLE', freshness: 'CURRENT', allowedOperations: [], deniedOperations: ['network-community-sync'], fallback: null, reason: 'Community service checks the browser connectivity hint and it is explicitly offline.', provenance: ['navigator.onLine (CommunityService hard network gate)'], readinessEvidence: 'navigator.onLine=false', healthEvidence: 'Network reachability beyond the explicit offline hint is not claimed.' });
    }
  } catch { /* network evidence unavailable */ }
  return Object.freeze(out);
}
