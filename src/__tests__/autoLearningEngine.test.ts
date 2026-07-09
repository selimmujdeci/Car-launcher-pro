/**
 * autoLearningEngine.test.ts — Otomatik Öğrenme Motoru TEMELİ (PR-27).
 *
 * Kilitlenen davranışlar: aynı PID/DID tekrar → seenCount↑ · confidence↑ · firstSeen korunur ·
 * lastSeen güncellenir · staged VIN merge (duplicate kalmaz) · farklı araçlar birleşmez ·
 * fail-soft · OBD/Discovery akışı etkilenmez (SALT-OKUNUR).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  deriveConfidence,
  initKnowledge,
  applyObservationsToKnowledge,
  isLikelySameVehicle,
  mergeKnowledge,
  AutoLearningEngine,
  type VehicleKnowledge,
} from '../platform/autoLearningEngine';
import { ingestVehicleFingerprint } from '../platform/vehicleFingerprintBuilder';
import { VehicleFingerprintStore, normalizeVin } from '../platform/vehicleFingerprintService';
import { useVidStore } from '../store/useVidStore';
import {
  createDiscoveryRecord,
  DiscoveryCaptureService,
  DiscoveryQueue,
  DiscoveryCache,
  type DiscoveryObservation,
  type DiscoverySource,
} from '../platform/obd/discovery';

let _k = 0;
function fpStore() { return new VehicleFingerprintStore(`ale-test-${_k++}`); }

function obs(source: DiscoverySource, id: string, seenCount = 1, firstAt = 1000, lastAt = 1000, ecu = '7E8'): DiscoveryObservation {
  return {
    record: createDiscoveryRecord({ pidOrDid: id, discoverySource: source, ecuAddress: ecu, mode: source === 'DID' ? '22' : '01' }),
    status: 'new',
    seenCount,
    firstAt,
    lastAt,
  };
}

/** Öğrenilebilir boş bilgi (VIN'li/VIN'siz) üretir. */
function knowledge(over: { vin?: string; protocol?: string; ecu?: string[]; mac?: string } = {}): VehicleKnowledge {
  return initKnowledge(ingestVehicleFingerprint({
    vin: over.vin ?? '',
    protocol: over.protocol ?? '6',
    ecuAddresses: over.ecu ?? ['7E8'],
    metadata: over.mac ? { adapterMac: over.mac } : undefined,
  }, fpStore(), 1000));
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom */ }
  useVidStore.getState().resetStore();
});

/* ── deriveConfidence ─────────────────────────────────────────────────────── */
describe('deriveConfidence', () => {
  it('görülme arttıkça artar, tavan 1.0', () => {
    expect(deriveConfidence(1)).toBeCloseTo(0.5);
    expect(deriveConfidence(2)).toBeCloseTo(0.6);
    expect(deriveConfidence(3)).toBeCloseTo(0.7);
    expect(deriveConfidence(20)).toBe(1.0);
    expect(deriveConfidence(0)).toBeCloseTo(0.5); // güvenli taban
  });
});

/* ── applyObservationsToKnowledge (SAF öğrenme) ───────────────────────────── */
describe('applyObservationsToKnowledge', () => {
  it('yeni PID → discoveredPids kaydı (firstSeen/lastSeen/seenCount/confidence)', () => {
    const k = applyObservationsToKnowledge(knowledge(), [obs('PID', 'A5', 1, 1000, 1000)], 1000);
    expect(k.discoveredPids['A5']).toEqual({ firstSeen: 1000, lastSeen: 1000, seenCount: 1, confidence: 0.5 });
    expect(k.discoveredDids['A5']).toBeUndefined();
  });

  it('yeni DID → discoveredDids kaydı', () => {
    const k = applyObservationsToKnowledge(knowledge(), [obs('DID', 'F190', 1, 1000, 1000)], 1000);
    expect(k.discoveredDids['F190'].seenCount).toBe(1);
    expect(k.discoveredPids['F190']).toBeUndefined();
  });

  it('aynı PID tekrar görülünce seenCount↑, confidence↑, firstSeen korunur, lastSeen güncellenir', () => {
    let k = applyObservationsToKnowledge(knowledge(), [obs('PID', 'A5', 1, 1000, 1000)], 1000);
    k = applyObservationsToKnowledge(k, [obs('PID', 'A5', 2, 1000, 5000)], 5000);
    expect(k.discoveredPids['A5'].seenCount).toBe(2);
    expect(k.discoveredPids['A5'].confidence).toBeCloseTo(0.6);
    expect(k.discoveredPids['A5'].firstSeen).toBe(1000); // korundu
    expect(k.discoveredPids['A5'].lastSeen).toBe(5000);  // güncellendi
    expect(k.lastSeen).toBe(5000);
  });
});

/* ── isLikelySameVehicle ──────────────────────────────────────────────────── */
describe('isLikelySameVehicle', () => {
  it('VIN\'siz + VIN\'li, aynı protocol+ECU → aynı araç', () => {
    const a = knowledge({ vin: 'VF1BM0A0H12345678', ecu: ['7E8'] });
    const b = knowledge({ vin: '', ecu: ['7E8'] });
    expect(isLikelySameVehicle(a, b)).toBe(true);
  });
  it('farklı ECU → farklı araç', () => {
    expect(isLikelySameVehicle(knowledge({ vin: 'X', ecu: ['7E8'] }), knowledge({ vin: '', ecu: ['7E0'] }))).toBe(false);
  });
  it('farklı protocol → farklı araç', () => {
    expect(isLikelySameVehicle(knowledge({ vin: 'X', protocol: '6' }), knowledge({ vin: '', protocol: '7' }))).toBe(false);
  });
  it('iki farklı VIN → birleşmez', () => {
    expect(isLikelySameVehicle(knowledge({ vin: 'AAA' }), knowledge({ vin: 'BBB' }))).toBe(false);
  });
  it('adaptör MAC\'leri çelişirse → farklı araç', () => {
    const a = knowledge({ vin: 'X', ecu: ['7E8'], mac: 'MAC1' });
    const b = knowledge({ vin: '', ecu: ['7E8'], mac: 'MAC2' });
    expect(isLikelySameVehicle(a, b)).toBe(false);
  });
});

/* ── mergeKnowledge ───────────────────────────────────────────────────────── */
describe('mergeKnowledge', () => {
  it('sinyalleri birleştirir (toplam seenCount, min firstSeen, max lastSeen), VIN korunur', () => {
    const vinFul = knowledge({ vin: 'VF1BM0A0H12345678' });
    vinFul.discoveredPids['A5'] = { firstSeen: 3000, lastSeen: 4000, seenCount: 1, confidence: 0.5 };
    const vinLess = knowledge({ vin: '' });
    vinLess.firstSeen = 1000;
    vinLess.discoveredPids['A5'] = { firstSeen: 1000, lastSeen: 2000, seenCount: 2, confidence: 0.6 };
    vinLess.discoveredDids['F190'] = { firstSeen: 1500, lastSeen: 1500, seenCount: 1, confidence: 0.5 };

    const m = mergeKnowledge(vinFul, vinLess);
    expect(normalizeVin(m.vin)).toBe('VF1BM0A0H12345678'); // survivor VIN'li
    expect(m.firstSeen).toBe(1000);                        // min
    expect(m.discoveredPids['A5'].seenCount).toBe(3);      // 1 + 2
    expect(m.discoveredPids['A5'].firstSeen).toBe(1000);   // min
    expect(m.discoveredPids['A5'].lastSeen).toBe(4000);    // max
    expect(m.discoveredDids['F190'].seenCount).toBe(1);    // yalnız vinLess'te
  });
});

/* ── AutoLearningEngine (canlı) ───────────────────────────────────────────── */
describe('AutoLearningEngine', () => {
  function connect(vin = '') {
    useVidStore.getState().updateObdAdapterInfo({ isTransportVerified: true, lastProtocolNum: '6' });
    if (vin) useVidStore.getState().updateVehicleInfo({ vin });
  }
  function poke() { useVidStore.getState().updateTelemetryInfo({ trustScore: Math.random() }); }

  it('aynı PID tekrar görülünce seenCount + confidence artıyor', () => {
    const s = fpStore();
    let observations: DiscoveryObservation[] = [];
    const eng = new AutoLearningEngine(s, () => useVidStore.getState(), () => observations, () => 5000);
    const stop = eng.start();
    observations = [obs('PID', 'A5', 1, 1000, 1000)];
    connect('VF1BM0A0H12345678'); // bağlantı tamam → tick
    let fp = s.list()[0] as VehicleKnowledge;
    expect(fp.discoveredPids['A5'].seenCount).toBe(1);
    // aynı PID ikinci kez (discovery seenCount 2)
    observations = [obs('PID', 'A5', 2, 1000, 6000)];
    poke();
    fp = s.list()[0] as VehicleKnowledge;
    expect(fp.discoveredPids['A5'].seenCount).toBe(2);
    expect(fp.discoveredPids['A5'].confidence).toBeCloseTo(0.6);
    expect(fp.discoveredPids['A5'].firstSeen).toBe(1000); // korundu
    stop();
  });

  it('aynı DID tekrar görülünce seenCount artıyor', () => {
    const s = fpStore();
    let observations: DiscoveryObservation[] = [];
    const eng = new AutoLearningEngine(s, () => useVidStore.getState(), () => observations, () => 5000);
    const stop = eng.start();
    observations = [obs('DID', '242E', 1, 1000, 1000, '7E0')];
    connect('VF1BM0A0H12345678');
    expect((s.list()[0] as VehicleKnowledge).discoveredDids['242E'].seenCount).toBe(1);
    observations = [obs('DID', '242E', 3, 1000, 6000, '7E0')];
    poke();
    expect((s.list()[0] as VehicleKnowledge).discoveredDids['242E'].seenCount).toBe(3);
    stop();
  });

  it('VIN merge: staged VIN\'siz kayıt VIN gelince birleşir, duplicate kalmaz, firstSeen korunur', () => {
    const s = fpStore();
    // Önce VIN'siz fingerprint (bağlantı VIN'den önce tamamlanmış) — öğrenilmiş bir PID ile.
    const vinLess = ingestVehicleFingerprint({ vin: '', protocol: '6', ecuAddresses: ['7E8'] }, s, 1000);
    const k = initKnowledge(s.load(vinLess.hash)!);
    k.discoveredPids['A5'] = { firstSeen: 1000, lastSeen: 1000, seenCount: 2, confidence: 0.6 };
    s.save(k);
    expect(s.size).toBe(1);

    const observations: DiscoveryObservation[] = [obs('PID', 'A5', 2, 1000, 5000, '7E8')];
    const eng = new AutoLearningEngine(s, () => useVidStore.getState(), () => observations, () => 5000);
    const stop = eng.start();
    // ECU obs'tan (7E8) → aynı imza; VIN geldi → merge
    useVidStore.getState().updateVehicleInfo({ vin: 'VF1BM0A0H12345678', make: 'Renault' });
    useVidStore.getState().updateObdAdapterInfo({ isTransportVerified: true, lastProtocolNum: '6' });

    expect(s.size).toBe(1); // DUPLICATE YOK
    const survivor = s.list()[0] as VehicleKnowledge;
    expect(normalizeVin(survivor.vin)).toBe('VF1BM0A0H12345678'); // VIN'li kalan
    expect(survivor.firstSeen).toBe(1000);                        // firstSeen korundu
    expect(survivor.discoveredPids['A5']).toBeDefined();          // öğrenilen bilgi taşındı
    stop();
  });

  it('farklı araçlar birleşmiyor (farklı ECU)', () => {
    const s = fpStore();
    ingestVehicleFingerprint({ vin: '', protocol: '6', ecuAddresses: ['7E0'] }, s, 1000); // farklı ECU
    const observations: DiscoveryObservation[] = [obs('PID', 'A5', 1, 1000, 5000, '7E8')];
    const eng = new AutoLearningEngine(s, () => useVidStore.getState(), () => observations, () => 5000);
    const stop = eng.start();
    useVidStore.getState().updateVehicleInfo({ vin: 'VF1BM0A0H12345678' });
    useVidStore.getState().updateObdAdapterInfo({ isTransportVerified: true, lastProtocolNum: '6' });
    expect(s.size).toBe(2); // birleşmedi — iki ayrı araç
    stop();
  });

  it('FAIL-SOFT: depo hata fırlatsa da akış çökmez', () => {
    const throwing = {
      load: () => { throw new Error('disk fail'); },
      save: () => { throw new Error('disk fail'); },
      list: () => { throw new Error('disk fail'); },
      remove: () => { throw new Error('disk fail'); },
    } as unknown as VehicleFingerprintStore;
    const eng = new AutoLearningEngine(throwing, () => useVidStore.getState(), () => [obs('PID', 'A5')], () => 5000);
    const stop = eng.start();
    expect(() => {
      useVidStore.getState().updateObdAdapterInfo({ isTransportVerified: true, lastProtocolNum: '6' });
      useVidStore.getState().updateVehicleInfo({ vin: 'VF1BM0A0H12345678' });
    }).not.toThrow();
    stop();
  });

  it('OBD/Discovery akışı etkilenmez (öğrenme SALT-OKUNUR)', () => {
    // Gerçek discovery servisi — capture/queue davranışı öğrenmeden bağımsız kalmalı.
    const disc = new DiscoveryCaptureService({ cache: new DiscoveryCache(), queue: new DiscoveryQueue(`ale-disc-${_k++}`), emitDiagnostic: vi.fn() });
    disc.capture({ pidOrDid: '242E', discoverySource: 'DID', mode: '22', ecuAddress: '7E0' });
    const capturedBefore = disc.getCaptured().length;
    const obsBefore = disc.getObservations().length;

    const s = fpStore();
    const eng = new AutoLearningEngine(s, () => useVidStore.getState(), () => disc.getObservations(), () => 5000);
    const stop = eng.start();
    useVidStore.getState().updateVehicleInfo({ vin: 'VF1BM0A0H12345678' });
    useVidStore.getState().updateObdAdapterInfo({ isTransportVerified: true, lastProtocolNum: '6' });

    expect(s.size).toBe(1);                                   // öğrenildi
    expect(disc.getCaptured().length).toBe(capturedBefore);  // queue DEĞİŞMEDİ
    expect(disc.getObservations().length).toBe(obsBefore);   // capture DEĞİŞMEDİ
    stop();
  });

  it('stop() sonrası öğrenme durur (zero-leak)', () => {
    const s = fpStore();
    const observations: DiscoveryObservation[] = [obs('PID', 'A5')];
    const eng = new AutoLearningEngine(s, () => useVidStore.getState(), () => observations, () => 5000);
    const stop = eng.start();
    stop();
    useVidStore.getState().updateObdAdapterInfo({ isTransportVerified: true, lastProtocolNum: '6' });
    useVidStore.getState().updateVehicleInfo({ vin: 'VF1BM0A0H12345678' });
    expect(s.size).toBe(0);
  });
});
