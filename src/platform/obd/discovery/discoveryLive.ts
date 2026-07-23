/**
 * discoveryLive — P0 Deep PID/DID Explorer Faz-1 · GERÇEK bağımlılıklarla DiscoveryCoordinator.
 *
 * `discoveryCoordinator.ts` tamamen DI'lıdır (test edilebilirlik). Bu dosya TEK yerde gerçek
 * servisleri (obdService/extendedPidService/nativePlugin/profiles/autoDidDiscovery/mevcut
 * DiscoveryCaptureService) bağlar — Mavi action handler'ları ve UI BUNU kullanır.
 *
 * Hiçbir servis DEĞİŞTİRİLMEDİ — yalnız MEVCUT dışa aktarılan fonksiyonlar tüketilir
 * (autoDidDiscovery.ts/obdService.ts/didDiscoveryService.ts KORUMALI dosyalardır, bu modül
 * onları yalnız İTHAL eder, asla düzenlemez).
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../../nativePlugin';
import { getOBDDataSnapshot, getHandshakeDiagnostics } from '../../obdService';
import { getAutoDiscoveredDids } from '../autoDidDiscovery';
import { MANUFACTURER_DID_PROFILES } from '../profiles';
import { discoveryCaptureService } from '.';
import { createDiscoveryCoordinator, DiscoveryCoordinator } from './discoveryCoordinator';
import { getVehicleFingerprint } from './discoveryFingerprint';
import { runStandardPidDiscovery } from './standardPidDiscovery';
import { scanDidCandidates } from './readOnlyDidScanner';
import type { DiscoveryHealthSnapshot } from './discoverySafetyPolicy';

function liveHealthSnapshot(): DiscoveryHealthSnapshot {
  const snap = getOBDDataSnapshot();
  return {
    connectionState: snap.connectionState,
    source: snap.source,
    dataFresh: snap.dataFresh,
    // speed=0 GERÇEK bir okumadır (dataFresh true iken) — bilinmiyor değildir.
    speedKmh: snap.dataFresh ? snap.speed : null,
  };
}

async function liveReadObdDid(opts: { tx: string; rx: string; did: string; service: '22' | '21' }) {
  if (!Capacitor.isNativePlatform() || !CarLauncher.readObdDid) {
    return { data: null, supported: false };
  }
  return CarLauncher.readObdDid(opts);
}

let _instance: DiscoveryCoordinator | null = null;

/** Tekil (singleton) canlı koordinatör — Mavi action port'u ve UI AYNI örneği paylaşır. */
export function getLiveDiscoveryCoordinator(): DiscoveryCoordinator {
  if (_instance) return _instance;
  _instance = createDiscoveryCoordinator({
    getHealthSnapshot: liveHealthSnapshot,
    getActiveProtocol: () => {
      const diag = getHandshakeDiagnostics();
      return diag.protocolActive ?? diag.protocolTried;
    },
    getFingerprint: () => getVehicleFingerprint({ readObdDid: liveReadObdDid }),
    getProfiles: () => Object.values(MANUFACTURER_DID_PROFILES),
    getAutoDiscovered: () => getAutoDiscoveredDids(),
    runStandardPidDiscovery: (opts) => runStandardPidDiscovery(opts),
    scanDidCandidates: (candidates, opts) => scanDidCandidates(candidates, { readObdDid: liveReadObdDid }, opts),
    captureObservation: (input) => {
      try { discoveryCaptureService.capture(input); } catch { /* pasif dashboard beslemesi — fail-soft */ }
    },
  });
  return _instance;
}

/** @internal — testler arası izolasyon (yalnız test dosyaları çağırır). */
export function _resetLiveDiscoveryCoordinatorForTest(): void {
  _instance = null;
}
