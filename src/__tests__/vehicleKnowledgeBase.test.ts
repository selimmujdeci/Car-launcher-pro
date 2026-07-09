/**
 * vehicleKnowledgeBase.test.ts — Araç Bilgi Tabanı TEMELİ (PR-28).
 *
 * Kilitlenen davranışlar: yeni araç kaydı · duplicate yok · PID/DID istatistikleri ·
 * firstSeen korunur · lastSeen güncellenir · confidence↑ · toplam discovery/PID/DID ·
 * fail-soft · bounded(8) LRU · safeStorage kalıcılığı.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildKnowledgeRecord,
  upsertKnowledge,
  vehicleStats,
  VehicleKnowledgeBaseStore,
  VehicleKnowledgeBase,
  MAX_KNOWLEDGE_RECORDS,
} from '../platform/vehicleKnowledgeBase';
import { buildFingerprint, VehicleFingerprintStore } from '../platform/vehicleFingerprintService';
import { type VehicleKnowledge, type DiscoveredSignal } from '../platform/autoLearningEngine';
import { useVidStore } from '../store/useVidStore';

let _k = 0;
function kbStore() { return new VehicleKnowledgeBaseStore(`vkb-test-${_k++}`); }

function sig(firstSeen: number, lastSeen: number, seenCount: number, confidence = 0.5): DiscoveredSignal {
  return { firstSeen, lastSeen, seenCount, confidence };
}

function knowledge(over: {
  vin?: string; protocol?: string; ecu?: string[]; fw?: string;
  sourceCount?: number; confidence?: number; now?: number;
  pids?: Record<string, DiscoveredSignal>; dids?: Record<string, DiscoveredSignal>;
} = {}): VehicleKnowledge {
  const base = buildFingerprint({
    vin: over.vin ?? '',
    protocol: over.protocol ?? '6',
    ecuAddresses: over.ecu ?? ['7E8'],
    metadata: over.fw ? { firmwareVersion: over.fw } : undefined,
  }, over.now ?? 1000);
  return {
    ...base,
    createdAt: over.now ?? 1000,
    sourceCount: over.sourceCount ?? 1,
    confidence: over.confidence ?? 0.5,
    profileHint: 'Renault',
    discoveredPids: over.pids ?? {},
    discoveredDids: over.dids ?? {},
  };
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom */ }
  useVidStore.getState().resetStore();
});

/* ── buildKnowledgeRecord (SAF) ───────────────────────────────────────────── */
describe('buildKnowledgeRecord', () => {
  it('yeni araç → tam kayıt (fingerprintHash/vin/protocol/istatistik/mod)', () => {
    const k = knowledge({ vin: 'VF1BM0A0H12345678', ecu: ['7E8', '7E9'], fw: 'CAL-1',
      pids: { A5: sig(1000, 1000, 1) }, dids: { F190: sig(1000, 1000, 1) } });
    const r = buildKnowledgeRecord(null, k, 1000);
    expect(r.fingerprintHash).toBe(k.hash);
    expect(r.vin).toBe('VF1BM0A0H12345678');
    expect(r.protocol).toBe('6');
    expect(r.vehicleSignature).toBe('6::7E8,7E9');
    expect(r.discoveredEcus).toEqual(['7E8', '7E9']);
    expect(r.firmwareVersions).toEqual(['CAL-1']);
    expect(r.supportedModes).toEqual(['01', '22']);
    expect(r.totalDiscoveries).toBe(2); // 1 PID + 1 DID seenCount
  });

  it('aynı araç güncelleme: duplicate yok, firstSeen korunur, lastSeen güncellenir', () => {
    const k1 = knowledge({ vin: 'X', pids: { A5: sig(1000, 1000, 1) }, now: 1000 });
    const r1 = buildKnowledgeRecord(null, k1, 1000);
    const k2 = knowledge({ vin: 'X', pids: { A5: sig(1000, 5000, 2) }, now: 5000 });
    const r2 = buildKnowledgeRecord(r1, k2, 5000);
    expect(Object.keys(r2.discoveredPids)).toHaveLength(1); // duplicate sinyal yok
    expect(r2.discoveredPids['A5'].firstSeen).toBe(1000);   // korundu
    expect(r2.discoveredPids['A5'].lastSeen).toBe(5000);    // güncellendi
    expect(r2.firstSeen).toBe(1000);
    expect(r2.lastSeen).toBe(5000);
  });

  it('confidence artıyor (seenCount arttıkça)', () => {
    const r1 = buildKnowledgeRecord(null, knowledge({ pids: { A5: sig(1000, 1000, 1) } }), 1000);
    const r2 = buildKnowledgeRecord(r1, knowledge({ pids: { A5: sig(1000, 5000, 3) } }), 5000);
    expect(r2.discoveredPids['A5'].confidence).toBeGreaterThan(r1.discoveredPids['A5'].confidence);
    expect(r2.confidence).toBeGreaterThanOrEqual(r1.confidence);
  });

  it('totalConnections fingerprint sourceCount ile beslenir', () => {
    const r = buildKnowledgeRecord(null, knowledge({ sourceCount: 4 }), 1000);
    expect(r.totalConnections).toBe(4);
  });
});

/* ── vehicleStats ─────────────────────────────────────────────────────────── */
describe('vehicleStats', () => {
  it('toplam PID/DID/ECU/Discovery doğru', () => {
    const k = knowledge({
      ecu: ['7E8', '7E9', '7EA'],
      pids: { A5: sig(1, 1, 2), A6: sig(1, 1, 3) },
      dids: { F190: sig(1, 1, 1) },
    });
    const r = buildKnowledgeRecord(null, k, 1000);
    const s = vehicleStats(r);
    expect(s.totalPids).toBe(2);
    expect(s.totalDids).toBe(1);
    expect(s.totalEcus).toBe(3);
    expect(s.totalDiscoveries).toBe(6); // 2 + 3 + 1
  });
});

/* ── upsertKnowledge + depo ───────────────────────────────────────────────── */
describe('upsertKnowledge + VehicleKnowledgeBaseStore', () => {
  it('yeni araç knowledge oluşturuyor', () => {
    const s = kbStore();
    upsertKnowledge(knowledge({ vin: 'X', pids: { A5: sig(1000, 1000, 1) } }), s, 1000);
    expect(s.size).toBe(1);
  });

  it('aynı araç DUPLICATE oluşturmuyor (upsert)', () => {
    const s = kbStore();
    const k = knowledge({ vin: 'X', pids: { A5: sig(1000, 1000, 1) } });
    upsertKnowledge(k, s, 1000);
    upsertKnowledge(knowledge({ vin: 'X', pids: { A5: sig(1000, 5000, 2) }, now: 5000 }), s, 5000);
    expect(s.size).toBe(1);
    const rec = s.get(k.hash)!;
    expect(rec.discoveredPids['A5'].seenCount).toBe(2);
    expect(rec.firstSeen).toBe(1000);
    expect(rec.lastSeen).toBe(5000);
  });

  it('PID ve DID istatistikleri doğru saklanır', () => {
    const s = kbStore();
    const k = knowledge({ pids: { A5: sig(1000, 2000, 3) }, dids: { '242E': sig(1500, 2500, 2) } });
    upsertKnowledge(k, s, 2500);
    const rec = s.get(k.hash)!;
    expect(rec.discoveredPids['A5']).toMatchObject({ firstSeen: 1000, lastSeen: 2000, seenCount: 3 });
    expect(rec.discoveredDids['242E']).toMatchObject({ firstSeen: 1500, lastSeen: 2500, seenCount: 2 });
  });

  it('bounded cache (max 8) — taşınca en eski düşer', () => {
    const s = kbStore();
    const records: VehicleKnowledge[] = Array.from({ length: 10 }, (_, i) =>
      knowledge({ vin: `VIN-${i}`, pids: { A5: sig(1000, 1000, 1) } }));
    records.forEach((k) => upsertKnowledge(k, s, 1000));
    expect(s.size).toBe(MAX_KNOWLEDGE_RECORDS); // 8
    expect(s.get(records[0].hash)).toBeNull();  // en eski düştü
    expect(s.get(records[9].hash)).not.toBeNull();
  });

  it('safeStorage kalıcılığı — aynı anahtarla yeni örnek diskten yükler', () => {
    const key = `vkb-persist-${_k++}`;
    const a = new VehicleKnowledgeBaseStore(key);
    const k = knowledge({ vin: 'PERSIST', pids: { A5: sig(1000, 1000, 1) } });
    upsertKnowledge(k, a, 1000);
    const b = new VehicleKnowledgeBaseStore(key);
    expect(b.size).toBe(1);
    expect(b.get(k.hash)?.vin).toBe('PERSIST');
  });

  it('bozuk disk verisi → fail-soft boş liste', () => {
    const key = `vkb-corrupt-${_k++}`;
    try { localStorage.setItem(key, '{bozuk'); } catch { /* jsdom */ }
    expect(new VehicleKnowledgeBaseStore(key).size).toBe(0);
  });
});

/* ── VehicleKnowledgeBase (canlı, SALT-OKUNUR projeksiyon) ────────────────── */
describe('VehicleKnowledgeBase — canlı', () => {
  it('bağlı araç fingerprint\'i öğrenilmişse KB kaydı oluşur', () => {
    const fp = new VehicleFingerprintStore(`vkb-fp2-${_k++}`);
    const kb = kbStore();
    const observations = [] as never[];
    const engine = new VehicleKnowledgeBase(kb, fp, () => useVidStore.getState(), () => observations, () => 5000);
    const stop = engine.start();
    // VID durumu (ECU discovery'den gelmiyor → assemble ecu=[]) — fp'yi TAM bu çözülen kimliğe koy:
    useVidStore.getState().updateVehicleInfo({ vin: 'VF1BM0A0H12345678' });
    useVidStore.getState().updateObdAdapterInfo({ isTransportVerified: true, lastProtocolNum: '6' });
    // Şimdi çözülen input: vin + proto '6' + ecu [] → o hash'e uygun bir knowledge yerleştir.
    const resolved = knowledge({ vin: 'VF1BM0A0H12345678', ecu: [], pids: { A5: sig(1000, 1000, 1) } });
    fp.save(resolved);
    // Bir tick daha tetikle → KB'ye projekte olsun.
    useVidStore.getState().updateTelemetryInfo({ trustScore: 0.9 });
    expect(kb.size).toBe(1);
    expect(kb.get(resolved.hash)?.discoveredPids['A5'].seenCount).toBe(1);
    stop();
  });

  it('FAIL-SOFT: KB deposu hata fırlatsa da akış çökmez', () => {
    const fp = new VehicleFingerprintStore(`vkb-fp3-${_k++}`);
    fp.save(knowledge({ vin: 'VF1BM0A0H12345678', ecu: [], pids: { A5: sig(1000, 1000, 1) } }));
    const throwing = {
      get: () => { throw new Error('disk'); },
      save: () => { throw new Error('disk'); },
    } as unknown as VehicleKnowledgeBaseStore;
    const engine = new VehicleKnowledgeBase(throwing, fp, () => useVidStore.getState(), () => [], () => 5000);
    const stop = engine.start();
    expect(() => {
      useVidStore.getState().updateVehicleInfo({ vin: 'VF1BM0A0H12345678' });
      useVidStore.getState().updateObdAdapterInfo({ isTransportVerified: true, lastProtocolNum: '6' });
    }).not.toThrow();
    stop();
  });

  it('stop() sonrası projeksiyon durur (zero-leak)', () => {
    const fp = new VehicleFingerprintStore(`vkb-fp4-${_k++}`);
    fp.save(knowledge({ vin: 'VF1BM0A0H12345678', ecu: [], pids: { A5: sig(1000, 1000, 1) } }));
    const kb = kbStore();
    const engine = new VehicleKnowledgeBase(kb, fp, () => useVidStore.getState(), () => [], () => 5000);
    const stop = engine.start();
    stop();
    useVidStore.getState().updateVehicleInfo({ vin: 'VF1BM0A0H12345678' });
    useVidStore.getState().updateObdAdapterInfo({ isTransportVerified: true, lastProtocolNum: '6' });
    expect(kb.size).toBe(0);
  });
});
