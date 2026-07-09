/**
 * diagnosticKnowledgeEngine.test.ts — Tanı Bilgi Motoru TEMELİ (PR-31).
 *
 * Kilitlenen davranışlar: DTC insight üretimi · manufacturer/vehicle bilgisi · related PID/DID ·
 * deterministik öneri · confidence birleşimi · severity korunur · fail-soft · boş knowledge ·
 * mevcut modüller/girdi DEĞİŞMEZ (salt-okunur, LLM YOK).
 */
import { describe, it, expect } from 'vitest';
import {
  buildDiagnosticInsight,
  combineConfidence,
  likelySystemsFor,
  relatedPidsFor,
  DiagnosticKnowledgeEngine,
} from '../platform/diagnosticKnowledgeEngine';
import { type DtcRecord } from '../platform/obd/dtcDataSource';
import { type VehicleKnowledgeRecord } from '../platform/vehicleKnowledgeBase';
import { type ManufacturerKnowledge, type CandidatePidDid } from '../platform/manufacturerIntelligenceEngine';
import { type DiscoveredSignal } from '../platform/autoLearningEngine';

function sig(firstSeen: number, lastSeen: number, seenCount: number): DiscoveredSignal {
  return { firstSeen, lastSeen, seenCount, confidence: 0.6 };
}

function dtcRec(over: Partial<DtcRecord> = {}): DtcRecord {
  return {
    description:    over.description ?? 'EGR Akışı Yetersiz',
    system:        over.system ?? 'Emisyon',
    severity:      over.severity ?? 'warning',
    possibleCauses: over.possibleCauses ?? ['EGR valfi tıkalı', 'MAP sensörü'],
    driveSafe:     over.driveSafe,
    repairSuggestions: over.repairSuggestions,
    relatedPids:   over.relatedPids,
  };
}

function vrec(over: { profileHint?: string; confidence?: number; pids?: Record<string, DiscoveredSignal>; dids?: Record<string, DiscoveredSignal>; firstSeen?: number; lastSeen?: number } = {}): VehicleKnowledgeRecord {
  return {
    fingerprintHash: 'h-1', vehicleSignature: '6::7E8', vin: '', profileHint: over.profileHint ?? '', protocol: '6',
    discoveredPids: over.pids ?? {}, discoveredDids: over.dids ?? {}, discoveredEcus: ['7E8'],
    firstSeen: over.firstSeen ?? 500, lastSeen: over.lastSeen ?? 600,
    totalConnections: 1, totalDiscoveries: 0, confidence: over.confidence ?? 0.5, firmwareVersions: [], supportedModes: [],
  };
}

function cand(over: Partial<CandidatePidDid> & { source?: 'PID' | 'DID' } = {}): CandidatePidDid {
  const source = over.discoverySource ?? over.source ?? 'PID';
  return {
    pidOrDid: over.pidOrDid ?? '0B', discoverySource: source, mode: source === 'DID' ? '22' : '01',
    ecuAddresses: over.ecuAddresses ?? ['7E8'], seenCount: over.seenCount ?? 5, vehicleCount: over.vehicleCount ?? 2,
    firstSeen: over.firstSeen ?? 1000, lastSeen: over.lastSeen ?? 2000, confidence: over.confidence ?? 0.8, status: over.status ?? 'strong',
  };
}

function mfr(over: { manufacturer?: string; profileHint?: string; confidence?: number; pids?: CandidatePidDid[]; dids?: CandidatePidDid[] } = {}): ManufacturerKnowledge {
  return {
    manufacturer: over.manufacturer ?? 'Renault', profileHint: over.profileHint ?? 'Renault', vehicleCount: 2,
    ecuAddresses: ['7E8'], observedPids: over.pids ?? [], observedDids: over.dids ?? [],
    firstSeen: 1000, lastSeen: 2000, confidence: over.confidence ?? 0.7,
  };
}

/* ── Korelasyon tabloları ─────────────────────────────────────────────────── */
describe('likelySystemsFor / relatedPidsFor', () => {
  it('P0401 → EGR/MAP/MAF/DPF ve ilgili PID\'ler (0B, 10)', () => {
    const systems = likelySystemsFor('P0401', dtcRec());
    expect(systems).toEqual(expect.arrayContaining(['EGR', 'MAP', 'MAF', 'DPF']));
    const pids = relatedPidsFor(systems);
    expect(pids).toContain('0B'); // MAP
    expect(pids).toContain('10'); // MAF
  });
  it('bilinmeyen kod → aile fallback (P04 → Emisyon/EGR)', () => {
    expect(likelySystemsFor('P0499', null)).toEqual(expect.arrayContaining(['Emisyon', 'EGR']));
  });
});

/* ── combineConfidence ────────────────────────────────────────────────────── */
describe('combineConfidence (deterministik)', () => {
  it('severity ağırlıklı; kanıt arttıkça artar; [0,1]', () => {
    expect(combineConfidence({ severity: 'critical', manufacturerConfidence: 0, vehicleConfidence: 0, discoveryConfidence: 0 })).toBeCloseTo(0.45);
    expect(combineConfidence({ severity: 'critical', manufacturerConfidence: 1, vehicleConfidence: 1, discoveryConfidence: 1 })).toBeCloseTo(0.95);
    const low = combineConfidence({ severity: 'warning', manufacturerConfidence: 0, vehicleConfidence: 0, discoveryConfidence: 0 });
    const high = combineConfidence({ severity: 'warning', manufacturerConfidence: 0.8, vehicleConfidence: 0.8, discoveryConfidence: 0.8 });
    expect(high).toBeGreaterThan(low);
  });
});

/* ── buildDiagnosticInsight ───────────────────────────────────────────────── */
describe('buildDiagnosticInsight', () => {
  it('DTC insight oluşuyor (dtc/description/severity/systems/pids/öneri/confidence)', () => {
    const ins = buildDiagnosticInsight('P0401', { dtcRecord: dtcRec({ severity: 'warning', description: 'EGR Akışı Yetersiz' }) });
    expect(ins.dtc).toBe('P0401');
    expect(ins.description).toBe('EGR Akışı Yetersiz');
    expect(ins.severity).toBe('warning');
    expect(ins.likelySystems).toContain('EGR');
    expect(ins.relatedPids).toContain('0B');
    expect(ins.relatedPids).toContain('10');
    expect(ins.recommendedChecks.length).toBeGreaterThan(0);
    expect(ins.confidence).toBeGreaterThan(0);
    expect(ins.confidence).toBeLessThanOrEqual(1);
    expect(ins.possibleCauses).toEqual(['EGR valfi tıkalı', 'MAP sensörü']);
  });

  it('Manufacturer bilgisi geliyor (manufacturer + manufacturerSeenCount)', () => {
    const ins = buildDiagnosticInsight('P0401', {
      dtcRecord: dtcRec(),
      manufacturer: mfr({ manufacturer: 'Renault', confidence: 0.8, pids: [cand({ pidOrDid: '0B', seenCount: 5 })] }),
    });
    expect(ins.manufacturer).toBe('Renault');
    expect(ins.profileHint).toBe('Renault');
    expect(ins.manufacturerSeenCount).toBe(5); // 0B relatedPid, üreticide 5 kez
  });

  it('Vehicle bilgisi geliyor (vehicleSeenCount + discoveredOnVehicle + first/lastSeen)', () => {
    const ins = buildDiagnosticInsight('P0401', {
      dtcRecord: dtcRec(),
      vehicle: vrec({ profileHint: 'Renault', confidence: 0.7, pids: { '0B': sig(1000, 2000, 4) } }),
    });
    expect(ins.vehicleSeenCount).toBe(4);
    expect(ins.discoveredOnVehicle).toBe(true);
    expect(ins.firstSeen).toBe(1000);
    expect(ins.lastSeen).toBe(2000);
  });

  it('related DID geliyor (araç/üretici üretici-özel DID\'leri)', () => {
    const ins = buildDiagnosticInsight('P0401', {
      dtcRecord: dtcRec(),
      vehicle: vrec({ dids: { '242E': sig(1, 1, 1) } }),
      manufacturer: mfr({ dids: [cand({ pidOrDid: 'F190', source: 'DID' })] }),
    });
    expect(ins.relatedDids).toContain('242E');
    expect(ins.relatedDids).toContain('F190');
  });

  it('severity korunuyor + kritik → driveSafe=false', () => {
    const ins = buildDiagnosticInsight('P0300', { dtcRecord: dtcRec({ severity: 'critical', description: 'Ateşleme Hatası' }) });
    expect(ins.severity).toBe('critical');
    expect(ins.driveSafe).toBe(false);
  });

  it('boş knowledge ile çalışıyor (kaynak yok → yine insight)', () => {
    const ins = buildDiagnosticInsight('P0401', {});
    expect(ins.dtc).toBe('P0401');
    expect(ins.description).toContain('Bilinmeyen');
    expect(ins.likelySystems.length).toBeGreaterThan(0); // aile fallback
    expect(ins.manufacturer).toBe('');
    expect(ins.vehicleSeenCount).toBe(0);
    expect(ins.confidence).toBeGreaterThanOrEqual(0);
  });

  it('girdi (vehicle/manufacturer/dtcRecord) DEĞİŞMİYOR (salt-okunur)', () => {
    const vehicle = vrec({ pids: { '0B': sig(1, 2, 3) } });
    const manufacturer = mfr({ pids: [cand({ pidOrDid: '0B' })] });
    const record = dtcRec();
    const snap = JSON.parse(JSON.stringify({ vehicle, manufacturer, record }));
    buildDiagnosticInsight('P0401', { dtcRecord: record, vehicle, manufacturer });
    expect({ vehicle, manufacturer, record }).toEqual(snap);
  });
});

/* ── DiagnosticKnowledgeEngine ────────────────────────────────────────────── */
describe('DiagnosticKnowledgeEngine', () => {
  it('kaynakları birleştirir (vehicle + manufacturer eşleşmesi)', () => {
    const vehicle = vrec({ profileHint: 'Renault', confidence: 0.6, pids: { '0B': sig(1, 2, 3) } });
    const manufacturer = mfr({ manufacturer: 'Renault', confidence: 0.7, pids: [cand({ pidOrDid: '0B', seenCount: 4 })] });
    const eng = new DiagnosticKnowledgeEngine(
      () => dtcRec({ severity: 'warning' }),
      () => vehicle,
      () => [manufacturer],
    );
    const ins = eng.diagnose('P0401');
    expect(ins.manufacturer).toBe('Renault');
    expect(ins.vehicleSeenCount).toBe(3);
    expect(ins.manufacturerSeenCount).toBe(4);
  });

  it('FAIL-SOFT: tüm kaynaklar hata fırlatsa da çökmeden insight döner', () => {
    const eng = new DiagnosticKnowledgeEngine(
      () => { throw new Error('dtc'); },
      () => { throw new Error('veh'); },
      () => { throw new Error('mfr'); },
    );
    let ins!: ReturnType<typeof eng.diagnose>;
    expect(() => { ins = eng.diagnose('P0401'); }).not.toThrow();
    expect(ins.dtc).toBe('P0401');
    expect(ins.likelySystems.length).toBeGreaterThan(0); // yine deterministik korelasyon
  });
});
