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
import { getOBDDataSnapshot, getHandshakeDiagnostics, onOBDData } from '../../obdService';
import { getAutoDiscoveredDids } from '../autoDidDiscovery';
import { MANUFACTURER_DID_PROFILES, setLearnedDidOverlay } from '../profiles';
import { DidLearningEngine } from '../didLearning/didLearningEngine';
import type { ReferenceKey } from '../didLearning/referenceCatalog';
import { discoverEcus } from '../multiEcuScan';
import { getPidValue } from '../extendedPidService';
import { getHandshakeVin } from '../../safety/vinContext';
import { hashVin } from './discoveredDataRepository';
import { safeGetRaw, safeSetRaw } from '../../../utils/safeStorage';
import { logError } from '../../crashLogger';
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

/* ══════════════════════════════════════════════════════════════════════════
 * OTOMATİK DID ÖĞRENME (didLearningEngine) — AKTİF TARAMA OTORİTESİ BURADA
 * ══════════════════════════════════════════════════════════════════════════
 * Motor her araçta: maske zinciriyle DID sayar (yalnız parkta), üçlü okumayla
 * bütçeli örnekler, referans sinyallerle anlamlandırır, kanıtlananı profil
 * katmanına verir. Kayıt araç/ECU başına kalıcıdır (didLearningStore).
 * Açma/kapama: CAROS LAB (`obd:didLearn:enabled`, varsayılan AÇIK — geliştirme). */

const ENABLED_KEY = 'obd:didLearn:enabled';
/** Bağlantı bu kadar kesintisiz sağlıklı olunca öğrenme başlar (çekirdek poll otursun). */
const LEARN_STABLE_MS = 20_000;
/** Aynı ECU'da en fazla bu kadar hedef (motor + birkaç modül). */
const MAX_LEARN_ECUS = 4;
/** Çekirdek referansların extended karşılıkları (PID → referans). */
const EXT_REFS: ReadonlyArray<[string, ReferenceKey]> = [
  ['5C', 'oil'], ['46', 'ambient'], ['3C', 'catalyst'], ['23', 'fuelRail'], ['0B', 'map'],
  ['42', 'ecuVoltage'], ['49', 'pedal'], ['45', 'relThrottle'], ['31', 'distSinceClear'],
  ['21', 'distMil'], ['1F', 'runtime'],
];

export function isDidLearningEnabled(): boolean {
  try { return safeGetRaw(ENABLED_KEY) !== '0'; } catch { return true; }
}
export function setDidLearningEnabled(on: boolean): void {
  try { safeSetRaw(ENABLED_KEY, on ? '1' : '0', 0, true); } catch { /* fail-soft */ }
  if (!on) _learnEngine?.stop();
}

const _refQueue: Array<{ key: ReferenceKey; t: number; value: number }> = [];
const _extSeen = new Map<string, number>();

function pushCoreRefs(): void {
  const s = getOBDDataSnapshot();
  if (!s.dataFresh || s.source !== 'real') return;
  const t = Date.now();
  const add = (key: ReferenceKey, v: number, ok: boolean) => { if (ok && Number.isFinite(v)) _refQueue.push({ key, t, value: v }); };
  add('speed', s.speed, s.speed >= 0);
  add('rpm', s.rpm, s.rpm >= 0);
  add('coolant', s.engineTemp, s.engineTemp !== -1);
  add('throttle', s.throttle, s.throttle >= 0);
  add('intake', s.intakeTemp, s.intakeTemp !== -1);
  add('fuelLevel', s.fuelLevel, s.fuelLevel >= 0);
  if (_refQueue.length > 5000) _refQueue.splice(0, _refQueue.length - 5000);
}

function drainLiveReferences(): Array<{ key: ReferenceKey; t: number; value: number }> {
  for (const [pid, key] of EXT_REFS) {
    const v = getPidValue(pid);
    if (!v || !Number.isFinite(v.value)) continue;
    if (_extSeen.get(pid) === v.updatedAt) continue;
    _extSeen.set(pid, v.updatedAt);
    _refQueue.push({ key, t: v.updatedAt, value: v.value });
  }
  _refQueue.sort((a, b) => a.t - b.t);
  return _refQueue.splice(0);
}

let _learnEngine: DidLearningEngine | null = null;

/** Tekil canlı öğrenme motoru — LAB paneli ve izleyici AYNI örneği kullanır. */
export function getLiveDidLearningEngine(): DidLearningEngine {
  if (_learnEngine) return _learnEngine;
  _learnEngine = new DidLearningEngine({
    readObdDid: async (o) => liveReadObdDid(o),
    getHealth: liveHealthSnapshot,
    listEcus: async () => {
      try {
        const topo = await discoverEcus();
        const list = topo.ecus.map((e) => ({ tx: e.txHeader, rx: e.rxHeader }));
        // Motor (7E0/7E8) önce — en zengin veri; topoloji boşsa tek hedef o.
        list.sort((a, b) => (a.rx === '7E8' ? -1 : 0) - (b.rx === '7E8' ? -1 : 0));
        return list.length > 0 ? list.slice(0, MAX_LEARN_ECUS) : [{ tx: '7E0', rx: '7E8' }];
      } catch { return [{ tx: '7E0', rx: '7E8' }]; }
    },
    getVinHash: () => { const v = getHandshakeVin(); return v ? hashVin(v) : null; },
    drainReferences: drainLiveReferences,
    onProvenProfile: (fragment) => setLearnedDidOverlay(fragment),
    isEnabled: isDidLearningEnabled,
  });
  return _learnEngine;
}

let _learnWatcherUnsub: (() => void) | null = null;

/**
 * Bağlantı LEARN_STABLE_MS kesintisiz sağlıklı olunca öğrenmeyi başlatır; oturum bitince
 * motor kendiliğinden durur, yeni bağlantıda YENİ oturumla tekrar başlar. İdempotent.
 */
export function startDidLearningWatcher(): () => void {
  if (_learnWatcherUnsub) return _learnWatcherUnsub;
  let healthySince = 0;
  let running = false;
  const unsub = onOBDData(() => {
    pushCoreRefs();
    const s = getOBDDataSnapshot();
    const healthy = s.connectionState === 'connected' && s.source === 'real' && s.dataFresh === true;
    if (!healthy) { healthySince = 0; return; }
    if (healthySince === 0) healthySince = Date.now();
    if (running || !isDidLearningEnabled() || Date.now() - healthySince < LEARN_STABLE_MS) return;
    running = true;
    void getLiveDidLearningEngine().start()
      .catch((e: unknown) => logError('OBD:DidLearning', e))
      .finally(() => { running = false; healthySince = 0; });
  });
  _learnWatcherUnsub = () => { unsub(); _learnEngine?.stop(); _learnWatcherUnsub = null; };
  return _learnWatcherUnsub;
}
