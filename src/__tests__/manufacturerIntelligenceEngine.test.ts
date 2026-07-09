/**
 * manufacturerIntelligenceEngine.test.ts — Üretici Zekâ Motoru TEMELİ (PR-29).
 *
 * Kilitlenen davranışlar: marka bazında gruplama · farklı markalar karışmaz · vehicleCount/
 * seenCount doğru · ECU normalize · confidence↑ · weak/candidate/strong status · firstSeen
 * korunur · lastSeen güncellenir · boş/bozuk liste fail-soft · VKB SALT-OKUNUR (değişmez).
 */
import { describe, it, expect } from 'vitest';
import {
  candidateConfidence,
  candidateStatus,
  resolveManufacturer,
  buildManufacturerIntelligence,
  getManufacturerIntelligence,
  ManufacturerIntelligenceEngine,
} from '../platform/manufacturerIntelligenceEngine';
import {
  VehicleKnowledgeBaseStore,
  type VehicleKnowledgeRecord,
} from '../platform/vehicleKnowledgeBase';
import { type DiscoveredSignal } from '../platform/autoLearningEngine';

function sig(firstSeen: number, lastSeen: number, seenCount: number): DiscoveredSignal {
  return { firstSeen, lastSeen, seenCount, confidence: 0.5 };
}

let _h = 0;
function rec(over: Partial<VehicleKnowledgeRecord> = {}): VehicleKnowledgeRecord {
  return {
    fingerprintHash:  over.fingerprintHash ?? `h-${_h++}`,
    vehicleSignature: over.vehicleSignature ?? '6::7E8',
    vin:              over.vin ?? '',
    profileHint:      over.profileHint ?? '',
    protocol:         over.protocol ?? '6',
    discoveredPids:   over.discoveredPids ?? {},
    discoveredDids:   over.discoveredDids ?? {},
    discoveredEcus:   over.discoveredEcus ?? ['7E8'],
    firstSeen:        over.firstSeen ?? 1000,
    lastSeen:         over.lastSeen ?? 1000,
    totalConnections: over.totalConnections ?? 1,
    totalDiscoveries: over.totalDiscoveries ?? 0,
    confidence:       over.confidence ?? 0.5,
    firmwareVersions: over.firmwareVersions ?? [],
    supportedModes:   over.supportedModes ?? [],
  };
}

/* ── Güven / durum ────────────────────────────────────────────────────────── */
describe('candidateConfidence / candidateStatus', () => {
  it('confidence araç sayısıyla artar', () => {
    expect(candidateConfidence(2, 2, 1)).toBeGreaterThan(candidateConfidence(1, 2, 1));
    expect(candidateConfidence(3, 2, 1)).toBeGreaterThan(candidateConfidence(2, 2, 1));
  });
  it('status: tek araç weak · 2 araç+1 ECU candidate · 2 araç+2 ECU strong · 3 araç strong', () => {
    expect(candidateStatus(1, 1)).toBe('weak');
    expect(candidateStatus(2, 1)).toBe('candidate');
    expect(candidateStatus(2, 2)).toBe('strong');
    expect(candidateStatus(3, 1)).toBe('strong');
  });
});

/* ── Marka çözümleme ──────────────────────────────────────────────────────── */
describe('resolveManufacturer', () => {
  it('profileHint önce; yoksa VIN WMI; yoksa Unknown::protocol', () => {
    expect(resolveManufacturer(rec({ profileHint: 'Renault' })).manufacturer).toBe('Renault');
    expect(resolveManufacturer(rec({ profileHint: '', vin: 'WF0AXXWPMA000000' })).manufacturer).toBe('Ford');
    const unk = resolveManufacturer(rec({ profileHint: '', vin: '', protocol: '6' }));
    expect(unk.manufacturer).toBe('Unknown');
    expect(unk.groupKey).toBe('Unknown::6');
  });
});

/* ── Gruplama + agregasyon ────────────────────────────────────────────────── */
describe('buildManufacturerIntelligence', () => {
  it('aynı marka için PID/DID gruplanıyor; vehicleCount/seenCount doğru', () => {
    const records = [
      rec({ profileHint: 'Renault', fingerprintHash: 'v1', discoveredPids: { A5: sig(1000, 2000, 2) }, discoveredEcus: ['7E8'] }),
      rec({ profileHint: 'Renault', fingerprintHash: 'v2', discoveredPids: { A5: sig(1500, 3000, 3) }, discoveredDids: { F190: sig(1500, 3000, 1) }, discoveredEcus: ['7E9'] }),
    ];
    const out = buildManufacturerIntelligence(records);
    expect(out).toHaveLength(1);
    const ren = out[0];
    expect(ren.manufacturer).toBe('Renault');
    expect(ren.vehicleCount).toBe(2);
    const a5 = ren.observedPids.find((c) => c.pidOrDid === 'A5')!;
    expect(a5.vehicleCount).toBe(2);           // iki araçta görüldü
    expect(a5.seenCount).toBe(5);              // 2 + 3
    expect(a5.ecuAddresses).toEqual(['7E8', '7E9']); // iki ECU birleşti
    expect(a5.firstSeen).toBe(1000);           // korundu
    expect(a5.lastSeen).toBe(3000);            // güncellendi
    expect(ren.observedDids.find((c) => c.pidOrDid === 'F190')!.vehicleCount).toBe(1);
  });

  it('farklı markalar KARIŞMIYOR', () => {
    const records = [
      rec({ profileHint: 'Renault', fingerprintHash: 'v1', discoveredPids: { A5: sig(1, 1, 1) } }),
      rec({ profileHint: 'Ford', fingerprintHash: 'v2', discoveredPids: { A5: sig(1, 1, 1) } }),
    ];
    const out = buildManufacturerIntelligence(records);
    expect(out).toHaveLength(2);
    const names = out.map((m) => m.manufacturer).sort();
    expect(names).toEqual(['Ford', 'Renault']);
    // Aynı PID iki ayrı markada → her birinde tek araç
    for (const m of out) expect(m.observedPids[0].vehicleCount).toBe(1);
  });

  it('ecuAddresses normalize ediliyor (boşluk/küçük harf)', () => {
    const out = buildManufacturerIntelligence([
      rec({ profileHint: 'Renault', discoveredPids: { A5: sig(1, 1, 1) }, discoveredEcus: [' 7e8 ', '0x7E9'] }),
    ]);
    expect(out[0].ecuAddresses).toEqual(['7E8', '7E9']);
    expect(out[0].observedPids[0].ecuAddresses).toEqual(['7E8', '7E9']);
  });

  it('status: tek araç weak; birden fazla araç+ECU strong', () => {
    const weak = buildManufacturerIntelligence([
      rec({ profileHint: 'Renault', fingerprintHash: 'v1', discoveredPids: { A5: sig(1, 1, 1) }, discoveredEcus: ['7E8'] }),
    ]);
    expect(weak[0].observedPids[0].status).toBe('weak');

    const strong = buildManufacturerIntelligence([
      rec({ profileHint: 'Renault', fingerprintHash: 'v1', discoveredPids: { A5: sig(1, 1, 1) }, discoveredEcus: ['7E8'] }),
      rec({ profileHint: 'Renault', fingerprintHash: 'v2', discoveredPids: { A5: sig(1, 2, 1) }, discoveredEcus: ['7E9'] }),
    ]);
    expect(strong[0].observedPids[0].status).toBe('strong'); // 2 araç + 2 ECU
    expect(strong[0].observedPids[0].confidence).toBeGreaterThan(weak[0].observedPids[0].confidence);
  });

  it('boş liste → [] (fail-soft)', () => {
    expect(buildManufacturerIntelligence([])).toEqual([]);
    // @ts-expect-error — undefined girdi de fail-soft
    expect(buildManufacturerIntelligence(undefined)).toEqual([]);
  });

  it('bozuk kayıt atlanır, geçerli kayıtlar işlenir (fail-soft)', () => {
    const records = [
      null,
      { foo: 'bar' },              // hash yok → atla
      rec({ profileHint: 'Renault', fingerprintHash: 'v1', discoveredPids: { A5: sig(1, 1, 1) } }),
    ] as unknown as VehicleKnowledgeRecord[];
    const out = buildManufacturerIntelligence(records);
    expect(out).toHaveLength(1);
    expect(out[0].manufacturer).toBe('Renault');
  });

  it('mevcut VehicleKnowledgeBase kayıtları DEĞİŞMİYOR (salt-okunur)', () => {
    const records = [
      rec({ profileHint: 'Renault', fingerprintHash: 'v1', discoveredPids: { A5: sig(1000, 1000, 1) }, discoveredEcus: ['7E8'] }),
    ];
    const snapshot = JSON.parse(JSON.stringify(records));
    buildManufacturerIntelligence(records);
    expect(records).toEqual(snapshot); // girdi mutasyona uğramadı
  });
});

/* ── Motor + VKB deposundan okuma ─────────────────────────────────────────── */
describe('ManufacturerIntelligenceEngine + getManufacturerIntelligence', () => {
  it('VKB deposundan on-demand hesaplar; depoyu değiştirmez', () => {
    const store = new VehicleKnowledgeBaseStore(`mie-test-${_h++}`);
    store.save({
      ...rec({ profileHint: 'Renault', fingerprintHash: 'v1', discoveredPids: { A5: sig(1, 1, 2) } }),
    });
    const sizeBefore = store.size;

    const eng = new ManufacturerIntelligenceEngine(() => store.list());
    const out = eng.refresh();
    expect(out).toHaveLength(1);
    expect(out[0].manufacturer).toBe('Renault');
    expect(eng.getManufacturer('renault')?.vehicleCount).toBe(1);
    expect(eng.getManufacturer('yok')).toBeNull();
    expect(store.size).toBe(sizeBefore); // VKB deposu değişmedi

    // Kısa yol
    expect(getManufacturerIntelligence(store)).toHaveLength(1);
  });

  it('refresh fail-soft: reader hata fırlatırsa [] döner, çökmez', () => {
    const eng = new ManufacturerIntelligenceEngine(() => { throw new Error('disk'); });
    expect(() => eng.refresh()).not.toThrow();
    expect(eng.getManufacturers()).toEqual([]);
  });
});
