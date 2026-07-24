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
const EvidenceViewerScreen = lazyWithRetry(() =>
  import('./screens/EvidenceViewerScreen').then((m) => ({ default: m.EvidenceViewerScreen })));
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
    case 'evidence-viewer':    return <EvidenceViewerScreen />;
    case 'performance':        return <PerformanceView />;
    case 'replay-log':         return <BlackBoxReplayView />;
    case 'discovery-database': return <DiscoveryDashboard />;
    default:                   return null;
  }
}
