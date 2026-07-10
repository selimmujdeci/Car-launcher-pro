/**
 * vehicleLearningEngine.test.ts — Araç Öğrenme Motoru TEMELİ (P2-1).
 *
 * Kilitlenen davranışlar: marka bazlı PID/DID evidence · farklı markalar karışmaz · aynı araç
 * tekrar → vehicleCount sabit / observationCount↑ · ECU normalize · hash tekilleştirme ·
 * firstSeen korunur · lastSeen güncellenir · weak/candidate/strong · confidence clamp ·
 * boş/bozuk input fail-soft · girdi mutate edilmez.
 */
import { describe, it, expect } from 'vitest';
import {
  buildEvidenceFromRecords,
  evidenceConfidence,
  evidenceStatus,
  VehicleLearningEngine,
} from '../platform/vehicleLearningEngine';
import { type VehicleKnowledgeRecord } from '../platform/vehicleKnowledgeBase';
import { type DiscoveredSignal } from '../platform/autoLearningEngine';

let _i = 0;
function sig(firstSeen: number, lastSeen: number, seenCount: number): DiscoveredSignal {
  return { firstSeen, lastSeen, seenCount, confidence: 0.5 };
}
function rec(over: {
  hash?: string; vin?: string; profileHint?: string; protocol?: string;
  ecus?: string[]; pids?: Record<string, DiscoveredSignal>; dids?: Record<string, DiscoveredSignal>;
  firstSeen?: number; lastSeen?: number;
} = {}): VehicleKnowledgeRecord {
  return {
    fingerprintHash:  over.hash ?? `h-${_i++}`,
    vehicleSignature: '6::7E8',
    vin:              over.vin ?? '',
    profileHint:      over.profileHint ?? '',
    protocol:         over.protocol ?? '6',
    discoveredPids:   over.pids ?? {},
    discoveredDids:   over.dids ?? {},
    discoveredEcus:   over.ecus ?? ['7E8'],
    firstSeen:        over.firstSeen ?? 1000,
    lastSeen:         over.lastSeen ?? 1000,
    totalConnections: 1, totalDiscoveries: 0, confidence: 0.5, firmwareVersions: [], supportedModes: [],
  };
}

/* ── confidence / status ──────────────────────────────────────────────────── */
describe('evidenceConfidence / evidenceStatus', () => {
  it('confidence [0,1] + tek araç çok tekrar ŞİŞMEZ', () => {
    expect(evidenceConfidence(1, 100, 2)).toBeLessThanOrEqual(0.5); // tek araç → tavan düşük
    expect(evidenceConfidence(3, 5, 2)).toBeGreaterThan(evidenceConfidence(1, 5, 2));
    expect(evidenceConfidence(99, 99, 99)).toBeLessThanOrEqual(1);
  });
  it('status: 1 araç weak · 2+2ECU strong · 3 araç strong · 2+1ECU candidate', () => {
    expect(evidenceStatus(1, 3)).toBe('weak');
    expect(evidenceStatus(2, 2)).toBe('strong');
    expect(evidenceStatus(3, 1)).toBe('strong');
    expect(evidenceStatus(2, 1)).toBe('candidate');
  });
});

/* ── evidence üretimi ─────────────────────────────────────────────────────── */
describe('buildEvidenceFromRecords', () => {
  it('aynı marka PID evidence\'i oluşuyor (vehicleCount + evidenceId)', () => {
    const out = buildEvidenceFromRecords([
      rec({ profileHint: 'Renault', hash: 'v1', pids: { A5: sig(1000, 2000, 2) } }),
      rec({ profileHint: 'Renault', hash: 'v2', pids: { A5: sig(1500, 3000, 3) }, ecus: ['7E9'] }),
    ], { now: 5000 });
    expect(out).toHaveLength(1);
    const e = out[0];
    expect(e.evidenceId).toBe('Renault|6|PID|A5|01');
    expect(e.manufacturer).toBe('Renault');
    expect(e.discoverySource).toBe('PID');
    expect(e.mode).toBe('01');
    expect(e.vehicleCount).toBe(2);
    expect(e.observationCount).toBe(5);            // 2 + 3
    expect(e.ecuAddresses).toEqual(['7E8', '7E9']); // iki araç ECU birleşti
    expect(e.supportingVehicleHashes).toEqual(['v1', 'v2']);
    expect(e.firstSeen).toBe(1000);
    expect(e.lastSeen).toBe(3000);
    expect(e.status).toBe('strong');               // 2 araç + 2 ECU
    expect(e.createdAt).toBe(5000);
  });

  it('aynı marka DID evidence\'i (mode 22)', () => {
    const out = buildEvidenceFromRecords([
      rec({ profileHint: 'Renault', hash: 'v1', dids: { F190: sig(1, 1, 1) } }),
    ]);
    expect(out[0].discoverySource).toBe('DID');
    expect(out[0].mode).toBe('22');
    expect(out[0].evidenceId).toBe('Renault|6|DID|F190|22');
  });

  it('farklı markalar KARIŞMIYOR', () => {
    const out = buildEvidenceFromRecords([
      rec({ profileHint: 'Renault', hash: 'v1', pids: { A5: sig(1, 1, 1) } }),
      rec({ profileHint: 'Ford', hash: 'v2', pids: { A5: sig(1, 1, 1) } }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.manufacturer).sort()).toEqual(['Ford', 'Renault']);
    for (const e of out) expect(e.vehicleCount).toBe(1);
  });

  it('aynı araç tekrar görünce vehicleCount ARTMAZ; observationCount artar; firstSeen korunur; lastSeen güncellenir', () => {
    const out = buildEvidenceFromRecords([
      rec({ profileHint: 'Renault', hash: 'v1', pids: { A5: sig(1000, 2000, 2) } }),
      rec({ profileHint: 'Renault', hash: 'v1', pids: { A5: sig(500, 4000, 3) } }), // AYNI hash
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].vehicleCount).toBe(1);            // artmadı
    expect(out[0].supportingVehicleHashes).toEqual(['v1']); // tekilleştirildi
    expect(out[0].observationCount).toBe(5);        // 2 + 3
    expect(out[0].firstSeen).toBe(500);             // min korundu
    expect(out[0].lastSeen).toBe(4000);             // max güncellendi
  });

  it('ECU adresleri normalize ediliyor (boşluk/küçük/0x)', () => {
    const out = buildEvidenceFromRecords([
      rec({ profileHint: 'Renault', hash: 'v1', pids: { A5: sig(1, 1, 1) }, ecus: [' 7e8 ', '0x7E9', '7E8'] }),
    ]);
    expect(out[0].ecuAddresses).toEqual(['7E8', '7E9']);
  });

  it('boş / null / undefined input → [] (fail-soft)', () => {
    expect(buildEvidenceFromRecords([])).toEqual([]);
    expect(buildEvidenceFromRecords(null)).toEqual([]);
    expect(buildEvidenceFromRecords(undefined)).toEqual([]);
  });

  it('bozuk kayıt atlanır, geçerli işlenir (fail-soft)', () => {
    const recs = [null, { foo: 'bar' }, rec({ profileHint: 'Renault', hash: 'v1', pids: { A5: sig(1, 1, 1) } })] as unknown as VehicleKnowledgeRecord[];
    const out = buildEvidenceFromRecords(recs);
    expect(out).toHaveLength(1);
    expect(out[0].manufacturer).toBe('Renault');
  });

  it('girdi kayıtları MUTATE EDİLMİYOR', () => {
    const input = [rec({ profileHint: 'Renault', hash: 'v1', pids: { A5: sig(1000, 2000, 2) }, ecus: ['7E8', '7E9'] })];
    const snap = JSON.parse(JSON.stringify(input));
    buildEvidenceFromRecords(input);
    expect(input).toEqual(snap);
  });

  it('VIN WMI ile marka çözümleniyor (profileHint boş olsa da)', () => {
    const out = buildEvidenceFromRecords([
      rec({ vin: 'VF1BM0A0H12345678', hash: 'v1', pids: { A5: sig(1, 1, 1) } }),
    ]);
    expect(out[0].manufacturer).toBe('Renault');
  });
});

/* ── Motor ────────────────────────────────────────────────────────────────── */
describe('VehicleLearningEngine', () => {
  it('computeEvidence VKB + MIE okuyarak üretir; strong/candidate ayrımı', () => {
    const records = [
      rec({ profileHint: 'Renault', hash: 'v1', pids: { A5: sig(1, 1, 1) }, ecus: ['7E8'] }),
      rec({ profileHint: 'Renault', hash: 'v2', pids: { A5: sig(1, 2, 1) }, ecus: ['7E9'] }), // A5 → 2 araç+2 ECU strong
      rec({ profileHint: 'Ford', hash: 'v3', pids: { B0: sig(1, 1, 1) } }),                    // tek araç weak
    ];
    const eng = new VehicleLearningEngine(() => records, () => [], () => 9000);
    const all = eng.computeEvidence();
    expect(all.length).toBe(2); // Renault/A5 + Ford/B0
    expect(eng.getStrong().map((e) => e.manufacturer)).toEqual(['Renault']);
    expect(eng.getByManufacturer('ford')[0].status).toBe('weak');
  });

  it('FAIL-SOFT: reader hata fırlatsa da [] döner, çökmez', () => {
    const eng = new VehicleLearningEngine(() => { throw new Error('boom'); });
    expect(() => eng.computeEvidence()).not.toThrow();
    expect(eng.computeEvidence()).toEqual([]);
  });

  it('MIE profileHint zenginleştirmesi (kayıt profileHint boşsa)', () => {
    // profileHint boş, VIN yok → resolveManufacturer 'Unknown'; MIE hint eşleşmez → boş kalır (güvenli).
    const records = [rec({ hash: 'v1', protocol: '6', pids: { A5: sig(1, 1, 1) } })];
    const eng = new VehicleLearningEngine(() => records, () => [], () => 1);
    const out = eng.computeEvidence();
    expect(out[0].manufacturer).toBe('Unknown');
    expect(out[0].profileHint).toBe('');
  });
});
