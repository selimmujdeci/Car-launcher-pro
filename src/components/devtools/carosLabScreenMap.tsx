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

const NativeBoundaryHalScreen = lazyWithRetry(() =>
  import('./screens/NativeBoundaryHalScreen').then((m) => ({ default: m.NativeBoundaryHalScreen })));
const SecurityTrustCapabilityScreen = lazyWithRetry(() =>
  import('./screens/SecurityTrustCapabilityScreen').then((m) => ({ default: m.SecurityTrustCapabilityScreen })));
const PerformanceProfilerScreen = lazyWithRetry(() =>
  import('./screens/PerformanceProfilerScreen').then((m) => ({ default: m.PerformanceProfilerScreen })));
const EarlyVehicleIdentityScreen = lazyWithRetry(() =>
  import('./screens/EarlyVehicleIdentityScreen').then((m) => ({ default: m.EarlyVehicleIdentityScreen })));
const EcuEndpointInventoryScreen = lazyWithRetry(() =>
  import('./screens/EcuEndpointInventoryScreen').then((m) => ({ default: m.EcuEndpointInventoryScreen })));
const MultiEcuDtcCoverageScreen = lazyWithRetry(() =>
  import('./screens/MultiEcuDtcCoverageScreen').then((m) => ({ default: m.MultiEcuDtcCoverageScreen })));
const CapabilityLearningScreen = lazyWithRetry(() =>
  import('./screens/CapabilityLearningScreen').then((m) => ({ default: m.CapabilityLearningScreen })));
const GapResolverScreen = lazyWithRetry(() =>
  import('./screens/GapResolverScreen').then((m) => ({ default: m.GapResolverScreen })));
const DiscoveryCapabilityScreen = lazyWithRetry(() =>
  import('./screens/DiscoveryCapabilityScreen').then((m) => ({ default: m.DiscoveryCapabilityScreen })));
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
const DeviceIdentityScreen = lazyWithRetry(() =>
  import('./screens/DeviceIdentityScreen'));
const ObdDataBridgeScreen = lazyWithRetry(() =>
  import('./screens/ObdDataBridgeScreen'));
const Mode06MonitorsScreen = lazyWithRetry(() =>
  import('./screens/Mode06MonitorsScreen'));
const DtcCoverageScreen = lazyWithRetry(() =>
  import('./screens/DtcCoverageScreen'));
const EcuCapabilityScreen = lazyWithRetry(() =>
  import('./screens/EcuCapabilityScreen'));
const DtcClearEvidenceScreen = lazyWithRetry(() =>
  import('./screens/DtcClearEvidenceScreen'));
const PidDiscoveryScreen = lazyWithRetry(() =>
  import('./screens/PidDiscoveryScreen'));
const DtcAuthorityScreen = lazyWithRetry(() =>
  import('./screens/DtcAuthorityScreen'));
const EcuInventoryScreen = lazyWithRetry(() =>
  import('./screens/EcuInventoryScreen'));
const OemEcuProfileScreen = lazyWithRetry(() =>
  import('./screens/OemEcuProfileScreen'));
const VehicleIdentityVinScreen = lazyWithRetry(() =>
  import('./screens/VehicleIdentityVinScreen'));
const ObdSignalHealthScreen = lazyWithRetry(() =>
  import('./screens/ObdSignalHealthScreen'));
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
const AddressSearchEvidenceScreen = lazyWithRetry(() =>
  import('./screens/AddressSearchEvidenceScreen'));
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
const BackgroundPowerScreen = lazyWithRetry(() =>
  import('./screens/BackgroundPowerScreen').then((m) => ({ default: m.BackgroundPowerScreen })));
const FleetKbScreen = lazyWithRetry(() =>
  import('./screens/FleetKbScreen').then((m) => ({ default: m.FleetKbScreen })));
const ServiceRoutineScreen = lazyWithRetry(() =>
  import('./screens/ServiceRoutineScreen').then((m) => ({ default: m.ServiceRoutineScreen })));
const ProfileCandidateScreen = lazyWithRetry(() =>
  import('./screens/ProfileCandidateScreen').then((m) => ({ default: m.ProfileCandidateScreen })));
const SignalAuthorityScreen = lazyWithRetry(() =>
  import('./screens/SignalAuthorityScreen').then((m) => ({ default: m.SignalAuthorityScreen })));
const AdapterDiagnosticsScreen = lazyWithRetry(() =>
  import('./screens/AdapterDiagnosticsScreen').then((m) => ({ default: m.AdapterDiagnosticsScreen })));
const VdkReplayScreen = lazyWithRetry(() =>
  import('./screens/VdkReplayScreen').then((m) => ({ default: m.VdkReplayScreen })));
const CddlInventoryScreen = lazyWithRetry(() =>
  import('./screens/CddlInventoryScreen').then((m) => ({ default: m.CddlInventoryScreen })));
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
const GuardianRuntimeScreen = lazyWithRetry(() =>
  import('./screens/GuardianRuntimeScreen').then((m) => ({ default: m.GuardianRuntimeScreen })));
const EnforcementPointsScreen = lazyWithRetry(() =>
  import('./screens/EnforcementPointsScreen').then((m) => ({ default: m.EnforcementPointsScreen })));
const ThemeRuntimeScreen = lazyWithRetry(() =>
  import('./screens/ThemeRuntimeScreen').then((m) => ({ default: m.ThemeRuntimeScreen })));
const ToolCallingScreen = lazyWithRetry(() =>
  import('./screens/ToolCallingScreen').then((m) => ({ default: m.ToolCallingScreen })));
const MaviLatencyScreen = lazyWithRetry(() =>
  import('./screens/MaviLatencyScreen').then((m) => ({ default: m.MaviLatencyScreen })));
const CapabilityFabricScreen = lazyWithRetry(() =>
  import('./screens/CapabilityFabricScreen').then((m) => ({ default: m.CapabilityFabricScreen })));
const ProvenanceScreen = lazyWithRetry(() =>
  import('./screens/ProvenanceScreen').then((m) => ({ default: m.ProvenanceScreen })));
const PredictionEngineScreen = lazyWithRetry(() =>
  import('./screens/PredictionEngineScreen').then((m) => ({ default: m.PredictionEngineScreen })));
const DeepScanScreen = lazyWithRetry(() =>
  import('./screens/DeepScanScreen').then((m) => ({ default: m.DeepScanScreen })));
const MemoryExplorerScreen = lazyWithRetry(() =>
  import('./screens/MemoryExplorerScreen').then((m) => ({ default: m.MemoryExplorerScreen })));
const KnowledgeExplorerScreen = lazyWithRetry(() =>
  import('./screens/KnowledgeExplorerScreen').then((m) => ({ default: m.KnowledgeExplorerScreen })));
const RuntimeModeScreen = lazyWithRetry(() =>
  import('./screens/RuntimeModeScreen').then((m) => ({ default: m.RuntimeModeScreen })));
const RuntimeAuthorityMapScreen = lazyWithRetry(() =>
  import('./screens/RuntimeAuthorityMapScreen').then((m) => ({ default: m.RuntimeAuthorityMapScreen })));
const RuntimeLifecycleContractScreen = lazyWithRetry(() =>
  import('./screens/RuntimeLifecycleContractScreen').then((m) => ({ default: m.RuntimeLifecycleContractScreen })));
const RuntimeServiceRegistryScreen = lazyWithRetry(() =>
  import('./screens/RuntimeServiceRegistryScreen').then((m) => ({ default: m.RuntimeServiceRegistryScreen })));
const RecoveryMonitorScreen = lazyWithRetry(() =>
  import('./screens/RecoveryMonitorScreen').then((m) => ({ default: m.RecoveryMonitorScreen })));
const RouteLayerInspectorScreen = lazyWithRetry(() =>
  import('./screens/RouteLayerInspectorScreen').then((m) => ({ default: m.RouteLayerInspectorScreen })));
const RemoteCommandScreen = lazyWithRetry(() =>
  import('./screens/RemoteCommandScreen').then((m) => ({ default: m.RemoteCommandScreen })));
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
    case 'discovery-capability': return <DiscoveryCapabilityScreen />;
    case 'early-vehicle-identity': return <EarlyVehicleIdentityScreen />;
    case 'ecu-endpoint-inventory': return <EcuEndpointInventoryScreen />;
    case 'multi-ecu-dtc-coverage': return <MultiEcuDtcCoverageScreen />;
    case 'capability-learning': return <CapabilityLearningScreen />;
    case 'gap-resolver': return <GapResolverScreen />;
    case 'address-search-evidence': return <AddressSearchEvidenceScreen />;
    case 'trip-engine':        return <TripEngineScreen />;
    case 'trip-cost':          return <TripCostScreen />;
    case 'pid-timing-experiment': return <PidTimingExperimentScreen />;
    case 'kwp-monitor':        return <KwpMonitorScreen />;
    case 'vehicle-fingerprint': return <VehicleFingerprintScreen />;
    case 'device-identity': return <DeviceIdentityScreen />;
    case 'obd-data-bridge': return <ObdDataBridgeScreen />;
    case 'mode06-monitors': return <Mode06MonitorsScreen />;
    case 'dtc-coverage': return <DtcCoverageScreen />;
    case 'ecu-capability': return <EcuCapabilityScreen />;
    case 'dtc-clear-evidence': return <DtcClearEvidenceScreen />;
    case 'pid-discovery': return <PidDiscoveryScreen />;
    case 'dtc-authority': return <DtcAuthorityScreen />;
    case 'ecu-inventory': return <EcuInventoryScreen />;
    case 'oem-ecu-profiles': return <OemEcuProfileScreen />;
    case 'vehicle-identity-vin': return <VehicleIdentityVinScreen />;
    case 'obd-signal-health': return <ObdSignalHealthScreen />;
    case 'signal-authority': return <SignalAuthorityScreen />;
    case 'profile-candidates': return <ProfileCandidateScreen />;
    case 'service-routines': return <ServiceRoutineScreen />;
    case 'fleet-kb': return <FleetKbScreen />;
    case 'background-power': return <BackgroundPowerScreen />;
    case 'adapter-diagnostics': return <AdapterDiagnosticsScreen />;
    case 'vdk-replay': return <VdkReplayScreen />;
    case 'cddl-inventory': return <CddlInventoryScreen />;
    case 'phone-hub-probe':    return <PhoneHubProbeScreen />;
    case 'phone-hub-field-validation': return <PhoneHubFieldValidationScreen />;
    case 'phone-hub-link':     return <PhoneHubLinkScreen />;
    // Queue Monitor ve Poll Scheduler ORTAK görünümü paylaşır; odak farklıdır.
    case 'queue-monitor':      return <RuntimeSchedulingScreen focus="queue-monitor" />;
    case 'poll-scheduler':     return <RuntimeSchedulingScreen focus="poll-scheduler" />;
    case 'recovery-monitor':   return <RecoveryMonitorScreen />;
    case 'runtime-mode':       return <RuntimeModeScreen />;
    case 'runtime-authority-map': return <RuntimeAuthorityMapScreen />;
    case 'security-trust-capability': return <SecurityTrustCapabilityScreen />;
    case 'performance-profiler': return <PerformanceProfilerScreen />;
    case 'runtime-lifecycle-contract': return <RuntimeLifecycleContractScreen />;
    case 'runtime-service-registry': return <RuntimeServiceRegistryScreen />;
    case 'native-boundary-hal': return <NativeBoundaryHalScreen />;
    case 'deep-scan':          return <DeepScanScreen />;
    case 'prediction-engine':  return <PredictionEngineScreen />;
    case 'signal-provenance':  return <ProvenanceScreen />;
    case 'tool-calling':       return <ToolCallingScreen />;
    case 'mavi-latency':       return <MaviLatencyScreen />;
    case 'capability-fabric': return <CapabilityFabricScreen />;
    case 'memory-explorer':    return <MemoryExplorerScreen />;
    case 'knowledge-explorer': return <KnowledgeExplorerScreen />;
    case 'mavi-console':       return <MaviConsoleScreen />;
    case 'mavi-reasoning-engine': return <MaviReasoningEngineScreen />;
    case 'ai-mechanic':        return <AiMechanicScreen />;
    case 'capability-gates':   return <CapabilityGatesScreen />;
    case 'action-registry':    return <ActionAuthorityScreen />;
    case 'stt-mic':            return <SttMicScreen />;
    case 'evidence-viewer':    return <EvidenceViewerScreen />;
    case 'media-authority':    return <MediaAuthorityScreen />;
    case 'guardian-runtime':   return <GuardianRuntimeScreen />;
    case 'theme-runtime':      return <ThemeRuntimeScreen />;
    case 'route-layer-inspector': return <RouteLayerInspectorScreen />;
    case 'enforcement-points': return <EnforcementPointsScreen />;
    case 'remote-command': return <RemoteCommandScreen />;
    case 'performance':        return <PerformanceView />;
    case 'replay-log':         return <BlackBoxReplayView />;
    case 'decoder-registry':   return <DecoderRegistryScreen />;
    case 'long-road-field-validation': return <LongRoadFieldValidationScreen />;
    case 'discovery-database': return <DiscoveryDashboard />;
    default:                   return null;
  }
}
