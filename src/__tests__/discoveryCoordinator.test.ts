/**
 * discoveryCoordinator.test — P0 Deep PID/DID Explorer Faz-1 · orkestrasyon + Mavi entegrasyonu.
 * Kapsam: #5 hareket kapısı, #6 bilinmeyen DID otomatik eklenmez, #7 bilinen+doğrulanan
 *         VERIFIED, #11 iptal, #13 KWP bütçesi, #17/#18 Mavi Action Registry + SafetyGate,
 *         #19 protokol-sınıfı bütçe seçimi.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _store = new Map<string, string>();
vi.mock('../utils/safeStorage', () => ({
  safeGetRaw: (k: string) => _store.get(k) ?? null,
  safeSetRaw: (k: string, v: string) => { _store.set(k, v); },
}));

import { createDiscoveryCoordinator, type CoordinatorDeps } from '../platform/obd/discovery/discoveryCoordinator';
import { upsertDiscoveredRecord } from '../platform/obd/discovery/discoveredDataRepository';
import type { VehicleDidProfile } from '../platform/obd/vehicleDidProfile';
import type { DiscoveryHealthSnapshot } from '../platform/obd/discovery/discoverySafetyPolicy';
import type { DidScanOutcome } from '../platform/obd/discovery/readOnlyDidScanner';

import { createActionRegistry } from '../platform/maviCore/actionRegistry';
import { createAiSafetyGate } from '../platform/aiCore/safetyGate';
import { evaluateActionIdSafety } from '../platform/maviCore/actionSafety';
import {
  registerDiscoveryActions, DISCOVERY_ACTION_START, DISCOVERY_ACTION_APPLY_VERIFIED,
} from '../platform/maviCore/discoveryActions';

function toHex(str: string): string {
  return [...str].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

const HEALTHY: DiscoveryHealthSnapshot = { connectionState: 'connected', source: 'real', dataFresh: true, speedKmh: 0 };
const MOVING: DiscoveryHealthSnapshot = { connectionState: 'connected', source: 'real', dataFresh: true, speedKmh: 12 };

const VIN_PROFILE: VehicleDidProfile = {
  brand: 'Test VIN', source: 'test', protocols: ['can'],
  ecus: [{ id: 'engine', name: 'Motor', tx: '7E0', rx: '7E8' }],
  dids: [{ did: 'F190', ecu: 'engine', name: 'VIN', unit: '', bytes: 17, min: 0, max: 0, category: 'kimlik', decode: { fn: 'ascii' } }],
};

function baseDeps(overrides: Partial<CoordinatorDeps> = {}): CoordinatorDeps {
  return {
    getHealthSnapshot: () => HEALTHY,
    getActiveProtocol: () => '6', // CAN
    getFingerprint: async () => null,
    getProfiles: () => [],
    getAutoDiscovered: () => [],
    runStandardPidDiscovery: async () => [],
    scanDidCandidates: async () => [],
    ...overrides,
  };
}

beforeEach(() => {
  _store.clear();
});

describe('DiscoveryCoordinator — güvenlik kapıları', () => {
  it('#5 araç hareketliyken start() taramayı BAŞLATMAZ (scanDidCandidates hiç çağrılmaz)', async () => {
    const scanDidCandidates = vi.fn(async () => []);
    const coordinator = createDiscoveryCoordinator(baseDeps({
      getHealthSnapshot: () => MOVING, scanDidCandidates,
    }));

    const result = await coordinator.start();

    expect(result.stopReason).toBe('unsafe');
    expect(scanDidCandidates).not.toHaveBeenCalled();
  });

  it('sağlıklı + park iken aday yoksa "no_candidates" ile dürüstçe tamamlanır', async () => {
    const coordinator = createDiscoveryCoordinator(baseDeps());
    const result = await coordinator.start();
    expect(result.stopReason).toBe('no_candidates');
  });
});

describe('DiscoveryCoordinator — #6 bilinmeyen DID otomatik eklenmez / #7 bilinen+doğrulanan VERIFIED', () => {
  it('#6 decoder BİLİNMEYEN DID pozitif yanıt verse bile DISCOVERED_UNKNOWN kalır, applyVerified DIŞINDA', async () => {
    const coordinator = createDiscoveryCoordinator(baseDeps({
      getAutoDiscovered: () => [{ did: '2201', dataHex: 'AABB', ecuRx: '7E8' }],
      scanDidCandidates: async (candidates): Promise<DidScanOutcome[]> => [
        { candidate: candidates[0]!, outcome: 'working', dataHex: 'AABB', latencyMs: 10 },
      ],
    }));

    const result = await coordinator.start();

    expect(result.didResults).toHaveLength(1);
    expect(result.didResults[0]!.status).toBe('DISCOVERED_UNKNOWN');
    expect(coordinator.applyVerified()).toHaveLength(0);
  });

  it('#7 bilinen decoder + doğru byte uzunluğu + ÖNCEKİ oturumdan bağımsız örnek → VERIFIED', async () => {
    const fingerprint = 'fp-verified-test';
    // Önceki oturumdan BAĞIMSIZ bir başarılı okuma (stableAcrossSamples koşulu için).
    upsertDiscoveredRecord(fingerprint, {
      kind: 'did', identifier: 'F190', ecuAddress: 'engine', service: '22', protocolClass: 'can',
      vinHash: fingerprint, rawRequestSample: '22F190', rawResponseSample: toHex('VF1CDACIA00000012'),
      decoderId: 'F190', validationStatus: 'DECODER_KNOWN', confidence: 0.5, latencyMs: 100,
      success: true, recommendedPollClass: 'DISCOVERY_ONLY', discoverySource: 'profile_candidate',
    });

    const vinHex = toHex('VF1CDACIA00000012'); // 17 karakter
    const coordinator = createDiscoveryCoordinator(baseDeps({
      getFingerprint: async () => fingerprint,
      getProfiles: () => [VIN_PROFILE],
      scanDidCandidates: async (candidates) => [
        { candidate: candidates[0]!, outcome: 'working', dataHex: vinHex, latencyMs: 50 },
      ],
    }));

    const result = await coordinator.start();

    expect(result.didResults).toHaveLength(1);
    expect(result.didResults[0]!.status).toBe('VERIFIED');
    expect(coordinator.applyVerified()).toHaveLength(1);
  });
});

describe('DiscoveryCoordinator — #11 iptal', () => {
  it('cancel() sonraki adaylara GEÇİLMESİNİ durdurur', async () => {
    const ref: { current: ReturnType<typeof createDiscoveryCoordinator> | null } = { current: null };
    const autoDiscovered = [
      { did: '2201', dataHex: '00', ecuRx: '7E8' },
      { did: '2202', dataHex: '00', ecuRx: '7E8' },
      { did: '2203', dataHex: '00', ecuRx: '7E8' },
    ];
    const scanDidCandidates = vi.fn(async (candidates: readonly { did: string }[]) => {
      // İlk aday taranırken taramayı İPTAL ET (kullanıcı butona bastı senaryosu).
      if (candidates[0]!.did === '2201') ref.current!.cancel();
      return [{ candidate: candidates[0] as never, outcome: 'working' as const, dataHex: '00', latencyMs: 1 }];
    });
    ref.current = createDiscoveryCoordinator(baseDeps({
      getAutoDiscovered: () => autoDiscovered,
      scanDidCandidates,
    }));

    const result = await ref.current.start();

    expect(result.stopReason).toBe('cancelled');
    expect(result.didResults.length).toBeLessThan(autoDiscovered.length);
    expect(scanDidCandidates).toHaveBeenCalledTimes(1); // 2. adaya HİÇ geçilmedi
  });
});

describe('DiscoveryCoordinator — #13/#19 protokol-sınıfı komut bütçesi', () => {
  it('#13 KWP\'de düşük bütçe erken durur (aşılmaz), stopReason "completed" (nazik dur)', async () => {
    const autoDiscovered = [
      { did: '2201', dataHex: '00', ecuRx: '7E8' },
      { did: '2202', dataHex: '00', ecuRx: '7E8' },
      { did: '2203', dataHex: '00', ecuRx: '7E8' },
    ];
    const scanDidCandidates = vi.fn(async (candidates: readonly { did: string }[]) => [
      { candidate: candidates[0] as never, outcome: 'working' as const, dataHex: '00', latencyMs: 1 },
    ]);
    const coordinator = createDiscoveryCoordinator(baseDeps({
      getActiveProtocol: () => '4', // KWP (5-baud init)
      getAutoDiscovered: () => autoDiscovered,
      scanDidCandidates,
      kwpMaxCommands: 1, kwpWindowMs: 60_000,
    }));

    const result = await coordinator.start();

    expect(scanDidCandidates).toHaveBeenCalledTimes(1); // bütçe (1) AŞILMADI
    expect(result.didResults.length).toBe(1);
    expect(result.stopReason).toBe('completed');
  });

  it('#19 CAN\'de varsayılan bütçe KWP\'den DAHA GENİŞ — düşük sayıda adayın hepsi taranır', async () => {
    const autoDiscovered = [
      { did: '2201', dataHex: '00', ecuRx: '7E8' },
      { did: '2202', dataHex: '00', ecuRx: '7E8' },
      { did: '2203', dataHex: '00', ecuRx: '7E8' },
    ];
    const scanDidCandidates = vi.fn(async (candidates: readonly { did: string }[]) => [
      { candidate: candidates[0] as never, outcome: 'unsupported' as const, dataHex: null, latencyMs: 1 },
    ]);
    const coordinator = createDiscoveryCoordinator(baseDeps({
      getActiveProtocol: () => '6', // CAN — varsayılan bütçe DEFAULT_CAN_DISCOVERY_BUDGET (40)
      getAutoDiscovered: () => autoDiscovered,
      scanDidCandidates,
    }));

    const result = await coordinator.start();

    expect(scanDidCandidates).toHaveBeenCalledTimes(3); // hiçbiri bütçeyle KESİLMEDİ
    expect(result.didResults).toHaveLength(3);
  });
});

describe('Mavi Action Registry entegrasyonu — #17/#18', () => {
  it('#17 Mavi yalnız kayıtlı action üzerinden başlatabilir (bilinmeyen id fail-closed)', () => {
    const registry = createActionRegistry();
    registerDiscoveryActions(registry);
    expect(registry.has(DISCOVERY_ACTION_START)).toBe(true);
    expect(registry.has('vehicle.discovery.unknownAction')).toBe(false);
  });

  it('#18 SafetyGate reddederse hiçbir OBD komutu için ALLOW dönmez', () => {
    const registry = createActionRegistry();
    registerDiscoveryActions(registry);
    const denyingGate = { evaluate: () => ({ allowed: false, scope: 'read' as const, reason: 'test_denied' }) };

    const decision = evaluateActionIdSafety(registry, denyingGate as never, DISCOVERY_ACTION_START);

    expect(decision.outcome).toBe('deny');
    expect(decision.gateReason).toBe('test_denied');
  });

  it('varsayılan (read-izinli) SafetyGate ile low-risk eylemler ALLOW döner', () => {
    const registry = createActionRegistry();
    registerDiscoveryActions(registry);
    const gate = createAiSafetyGate();

    const decision = evaluateActionIdSafety(registry, gate, DISCOVERY_ACTION_START);

    expect(decision.outcome).toBe('allow');
  });

  it('orta risk (applyVerified) onaysız CONFIRM ister — sessizce uygulanmaz', () => {
    const registry = createActionRegistry();
    registerDiscoveryActions(registry);
    const gate = createAiSafetyGate();

    const decision = evaluateActionIdSafety(registry, gate, DISCOVERY_ACTION_APPLY_VERIFIED);

    expect(decision.outcome).toBe('confirm');
  });
});
