/**
 * carosLabScreenMap — araç id → GERÇEK ekran eşlemesi (tek yer).
 *
 * Ağır ekranlar `lazyWithRetry` ile ayrı chunk'ta: yalnız AÇILAN aracın kodu inER
 * (Mali-400 / düşük-uç bütçesi). Eşlemesi olmayan id null döner → host sahte
 * "çalışıyor" göstermez, bilgi ekranına düşer.
 *
 * Bileşen EXPORT ETMEZ (yalnız eşleme fonksiyonu) — HMR/fast-refresh temiz kalır.
 */

import type { ReactElement } from 'react';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import type { CarosLabToolId } from '../../platform/devtools/carosLabCatalog';

const LiveDataScreen = lazyWithRetry(() =>
  import('./screens/LiveDataScreen').then((m) => ({ default: m.LiveDataScreen })));
const PidDidExplorerScreen = lazyWithRetry(() =>
  import('./screens/PidDidExplorerScreen').then((m) => ({ default: m.PidDidExplorerScreen })));
const RawObdTrafficScreen = lazyWithRetry(() =>
  import('./screens/RawObdTrafficScreen').then((m) => ({ default: m.RawObdTrafficScreen })));
const CanMonitorScreen = lazyWithRetry(() =>
  import('./screens/CanMonitorScreen').then((m) => ({ default: m.CanMonitorScreen })));
const SessionInspectorScreen = lazyWithRetry(() =>
  import('./screens/SessionInspectorScreen').then((m) => ({ default: m.SessionInspectorScreen })));
const PidTimingExperimentScreen = lazyWithRetry(() =>
  import('./screens/PidTimingExperimentScreen').then((m) => ({ default: m.PidTimingExperimentScreen })));
const TripCostScreen = lazyWithRetry(() =>
  import('./screens/TripCostScreen').then((m) => ({ default: m.TripCostScreen })));
const FleetConnectivityScreen = lazyWithRetry(() =>
  import('./screens/FleetConnectivityScreen'));
const FleetIdentityScreen = lazyWithRetry(() =>
  import('./screens/FleetIdentityScreen'));
const FleetDriverIdentityScreen = lazyWithRetry(() =>
  import('./screens/FleetDriverIdentityScreen'));
const FleetPresenceHistoryScreen = lazyWithRetry(() =>
  import('./screens/FleetPresenceHistoryScreen'));
const FleetDriverAuthenticationScreen = lazyWithRetry(() =>
  import('./screens/FleetDriverAuthenticationScreen'));
const FleetDriverDnaScreen = lazyWithRetry(() =>
  import('./screens/FleetDriverDnaScreen'));
const FleetIntelligenceScreen = lazyWithRetry(() =>
  import('./screens/FleetIntelligenceScreen'));
const AiEvidenceEngineScreen = lazyWithRetry(() =>
  import('./screens/AiEvidenceEngineScreen'));
const LocationEngineScreen = lazyWithRetry(() =>
  import('./screens/LocationEngineScreen'));
const NavigationCoreScreen = lazyWithRetry(() =>
  import('./screens/NavigationCoreScreen'));
const TripEngineScreen = lazyWithRetry(() =>
  import('./screens/TripEngineScreen'));
const KwpMonitorScreen = lazyWithRetry(() =>
  import('./screens/KwpMonitorScreen').then((m) => ({ default: m.KwpMonitorScreen })));
const VehicleFingerprintScreen = lazyWithRetry(() =>
  import('./screens/VehicleFingerprintScreen').then((m) => ({ default: m.VehicleFingerprintScreen })));
const PhoneHubProbeScreen = lazyWithRetry(() =>
  import('./screens/PhoneHubProbeScreen').then((m) => ({ default: m.PhoneHubProbeScreen })));
const PhoneHubFieldValidationScreen = lazyWithRetry(() =>
  import('./screens/PhoneHubFieldValidationScreen').then((m) => ({ default: m.PhoneHubFieldValidationScreen })));
const PhoneHubLinkScreen = lazyWithRetry(() =>
  import('./screens/PhoneHubLinkScreen').then((m) => ({ default: m.PhoneHubLinkScreen })));
const AdapterDiagnosticsScreen = lazyWithRetry(() =>
  import('./screens/AdapterDiagnosticsScreen').then((m) => ({ default: m.AdapterDiagnosticsScreen })));
const MaviConsoleScreen = lazyWithRetry(() =>
  import('./screens/MaviConsoleScreen').then((m) => ({ default: m.MaviConsoleScreen })));
const MaviReasoningEngineScreen = lazyWithRetry(() =>
  import('./screens/MaviReasoningEngineScreen'));
const AiMechanicScreen = lazyWithRetry(() =>
  import('./screens/AiMechanicScreen'));
const CapabilityGatesScreen = lazyWithRetry(() =>
  import('./screens/CapabilityGatesScreen'));
const ActionAuthorityScreen = lazyWithRetry(() =>
  import('./screens/ActionAuthorityScreen').then((m) => ({ default: m.ActionAuthorityScreen })));
const SttMicScreen = lazyWithRetry(() =>
  import('./screens/SttMicScreen').then((m) => ({ default: m.SttMicScreen })));
const RuntimeSchedulingScreen = lazyWithRetry(() =>
  import('./screens/RuntimeSchedulingScreen').then((m) => ({ default: m.RuntimeSchedulingScreen })));
const DecoderRegistryScreen = lazyWithRetry(() =>
  import('./screens/DecoderRegistryScreen').then((m) => ({ default: m.DecoderRegistryScreen })));
const LongRoadFieldValidationScreen = lazyWithRetry(() =>
  import('./screens/LongRoadFieldValidationScreen'));
const EvidenceViewerScreen = lazyWithRetry(() =>
  import('./screens/EvidenceViewerScreen').then((m) => ({ default: m.EvidenceViewerScreen })));
const MediaAuthorityScreen = lazyWithRetry(() =>
  import('./screens/MediaAuthorityScreen').then((m) => ({ default: m.MediaAuthorityScreen })));
const PerformanceView = lazyWithRetry(() =>
  import('../debug/PerformanceView').then((m) => ({ default: m.PerformanceView })));
const BlackBoxReplayView = lazyWithRetry(() =>
  import('../debug/BlackBoxReplayView').then((m) => ({ default: m.BlackBoxReplayView })));
const DiscoveryDashboard = lazyWithRetry(() =>
  import('../discovery/DiscoveryDashboard').then((m) => ({ default: m.DiscoveryDashboard })));

/** AVAILABLE araç → ekran. Eşleme yoksa null (katalog↔kod ayrışmasını görünür kılar). */
export function renderAvailableTool(id: CarosLabToolId): ReactElement | null {
  switch (id) {
    case 'live-data':          return <LiveDataScreen />;
    case 'pid-did-explorer':   return <PidDidExplorerScreen />;
    case 'raw-obd-traffic':    return <RawObdTrafficScreen />;
    case 'can-monitor':        return <CanMonitorScreen />;
    case 'session-inspector':  return <SessionInspectorScreen />;
    case 'fleet-connectivity': return <FleetConnectivityScreen />;
    case 'fleet-identity':     return <FleetIdentityScreen />;
    case 'fleet-driver-identity':         return <FleetDriverIdentityScreen />;
    case 'fleet-presence-history':        return <FleetPresenceHistoryScreen />;
    case 'fleet-driver-authentication':   return <FleetDriverAuthenticationScreen />;
    case 'fleet-driver-dna':   return <FleetDriverDnaScreen />;
    case 'fleet-intelligence': return <FleetIntelligenceScreen />;
    case 'ai-evidence-engine': return <AiEvidenceEngineScreen />;
    case 'location-engine':    return <LocationEngineScreen />;
    case 'navigation-core':    return <NavigationCoreScreen />;
    case 'trip-engine':        return <TripEngineScreen />;
    case 'trip-cost':          return <TripCostScreen />;
    case 'pid-timing-experiment': return <PidTimingExperimentScreen />;
    case 'kwp-monitor':        return <KwpMonitorScreen />;
    case 'vehicle-fingerprint': return <VehicleFingerprintScreen />;
    case 'adapter-diagnostics': return <AdapterDiagnosticsScreen />;
    case 'phone-hub-probe':    return <PhoneHubProbeScreen />;
    case 'phone-hub-field-validation': return <PhoneHubFieldValidationScreen />;
    case 'phone-hub-link':     return <PhoneHubLinkScreen />;
    // Queue Monitor ve Poll Scheduler ORTAK görünümü paylaşır; odak farklıdır.
    case 'queue-monitor':      return <RuntimeSchedulingScreen focus="queue-monitor" />;
    case 'poll-scheduler':     return <RuntimeSchedulingScreen focus="poll-scheduler" />;
    case 'mavi-console':       return <MaviConsoleScreen />;
    case 'mavi-reasoning-engine': return <MaviReasoningEngineScreen />;
    case 'ai-mechanic':        return <AiMechanicScreen />;
    case 'capability-gates':   return <CapabilityGatesScreen />;
    case 'action-registry':    return <ActionAuthorityScreen />;
    case 'stt-mic':            return <SttMicScreen />;
    case 'evidence-viewer':    return <EvidenceViewerScreen />;
    case 'media-authority':    return <MediaAuthorityScreen />;
    case 'performance':        return <PerformanceView />;
    case 'replay-log':         return <BlackBoxReplayView />;
    case 'decoder-registry':   return <DecoderRegistryScreen />;
    case 'long-road-field-validation': return <LongRoadFieldValidationScreen />;
    case 'discovery-database': return <DiscoveryDashboard />;
    default:                   return null;
  }
}
