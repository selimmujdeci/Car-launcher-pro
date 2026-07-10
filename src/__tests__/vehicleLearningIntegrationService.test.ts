/**
 * vehicleLearningIntegrationService.test.ts — Öğrenme Entegrasyon Katmanı (P2-5).
 *
 * Kilitler: diagnostic learning context ekleniyor · veri yoksa insight korunuyor ·
 * safety/severity/driveSafe DEĞİŞMİYOR · strong PID/DID doğru · manual-review/conflict doğru ·
 * dashboard rozet/filtre doğru · Expert summary doğru · stale decay sonrası doğru · BASIC_JS
 * ağır detay üretmiyor · BALANCED/HIGH tam detay · memoization · girdi mutate edilmiyor ·
 * boş/bozuk fail-soft · dispose.
 */
import { describe, it, expect } from 'vitest';
import {
  VehicleLearningIntegrationService,
  learningBadgesFor,
  type LearningDiscoveryAnnotation,
} from '../platform/vehicleLearningIntegrationService';
import { buildPatterns } from '../platform/vehicleLearningPatternEngine';
import { type LearningEvidence } from '../platform/vehicleLearningEngine';
import { type DiagnosticInsight } from '../platform/diagnosticKnowledgeEngine';
import {
  filterObservations,
  selectVisible,
  isLearningFilter,
  type DiscoveryFilter,
} from '../components/discovery/discoveryDashboardModel';

const DAY = 86_400_000;
const NOW = 100 * DAY;

/** Kanıt fabrikası. */
function ev(over: Partial<LearningEvidence> = {}): LearningEvidence {
  const manufacturer = over.manufacturer ?? 'Renault';
  const protocol = over.protocol ?? '6';
  const source = over.discoverySource ?? 'PID';
  const pidOrDid = over.pidOrDid ?? 'A5';
  const mode = over.mode ?? (source === 'DID' ? '22' : '01');
  const hashes = over.supportingVehicleHashes ?? ['v1'];
  return {
    evidenceId: over.evidenceId ?? `${manufacturer}|${protocol}|${source}|${pidOrDid}|${mode}`,
    manufacturer, profileHint: over.profileHint ?? manufacturer, protocol,
    discoverySource: source, pidOrDid, mode,
    ecuAddresses: over.ecuAddresses ?? ['7E8'],
    supportingVehicleHashes: hashes,
    vehicleCount: over.vehicleCount ?? hashes.length,
    observationCount: over.observationCount ?? 6,
    firstSeen: over.firstSeen ?? (NOW - 5 * DAY),
    lastSeen: over.lastSeen ?? NOW,
    confidence: over.confidence ?? 0.8,
    status: over.status ?? 'candidate',
    createdAt: over.createdAt ?? (NOW - 5 * DAY),
    updatedAt: over.updatedAt ?? NOW,
  };
}

function svc(list: LearningEvidence[], tier: 'low' | 'mid' | 'high' = 'high', now = NOW): VehicleLearningIntegrationService {
  return new VehicleLearningIntegrationService(() => list, () => now, () => tier);
}

/** Diagnostic Insight fixture (yalnız gerekli alanlar; gerçek şekle uygun). */
function insight(over: Partial<DiagnosticInsight> = {}): DiagnosticInsight {
  return {
    dtc: 'P0401', description: 'EGR', severity: 'warning', confidence: 0.6,
    manufacturer: 'Renault', profileHint: 'Renault',
    likelySystems: ['EGR'], relatedPids: over.relatedPids ?? ['A5'], relatedDids: over.relatedDids ?? [],
    discoveredOnVehicle: over.discoveredOnVehicle ?? false, manufacturerSeenCount: 0, vehicleSeenCount: 0,
    possibleCauses: [], recommendedChecks: [], driveSafe: over.driveSafe ?? true,
    firstSeen: 0, lastSeen: 0,
    ...over,
  };
}

/* ── Diagnostic entegrasyonu ─────────────────────────────────────────────── */
describe('diagnostic learning context', () => {
  it('learning context insight’a EKLENİYOR (eşleşen evidence var)', () => {
    const s = svc([ev({ pidOrDid: 'A5', supportingVehicleHashes: ['v1', 'v2'] })]);
    const out = s.enrichInsight(insight({ relatedPids: ['A5'] }));
    expect(out.learning).toBeTruthy();
    expect(out.learning!.learnedEvidenceCount).toBe(1);
    expect(out.learning!.learnedOnManufacturer).toBe(true);
  });

  it('learning verisi YOKSA insight AYNEN korunuyor (learning undefined)', () => {
    const s = svc([ev({ pidOrDid: 'ZZ' })]); // ilgisiz sinyal
    const base = insight({ relatedPids: ['A5'] });
    const out = s.enrichInsight(base);
    expect(out.learning).toBeUndefined();
    expect(out).toBe(base); // aynı referans → değişmedi
  });

  it('safety/severity/driveSafe/confidence learning nedeniyle DEĞİŞMİYOR', () => {
    const s = svc([ev({ pidOrDid: 'A5', supportingVehicleHashes: ['v1', 'v2', 'v3'] })]);
    const base = insight({ relatedPids: ['A5'], severity: 'critical', driveSafe: false, confidence: 0.42 });
    const out = s.enrichInsight(base);
    expect(out.severity).toBe('critical');
    expect(out.driveSafe).toBe(false);
    expect(out.confidence).toBe(0.42);
    expect(out.learning).toBeTruthy(); // ek bağlam eklendi ama karar aynı
  });

  it('strong PID/DID alanları DOĞRU', () => {
    const s = svc([
      ev({ evidenceId: 'p', discoverySource: 'PID', pidOrDid: 'A5', supportingVehicleHashes: ['v1', 'v2', 'v3'], firstSeen: NOW - 5 * DAY, lastSeen: NOW }),
      ev({ evidenceId: 'd', discoverySource: 'DID', pidOrDid: 'F190', supportingVehicleHashes: ['v1', 'v2', 'v3'], firstSeen: NOW - 5 * DAY, lastSeen: NOW }),
    ]);
    const ctx = s.buildDiagnosticLearningContext(insight({ relatedPids: ['A5'], relatedDids: ['F190'] }));
    expect(ctx!.relatedStrongPids).toContain('A5');
    expect(ctx!.relatedStrongDids).toContain('F190');
  });

  it('manual-review / conflict uyarıları DOĞRU (aynı PID iki markada)', () => {
    const s = svc([
      ev({ evidenceId: 'r', manufacturer: 'Renault', pidOrDid: 'A5', supportingVehicleHashes: ['v1', 'v2'] }),
      ev({ evidenceId: 't', manufacturer: 'Toyota', pidOrDid: 'A5', supportingVehicleHashes: ['w1', 'w2'] }),
    ]);
    const ctx = s.buildDiagnosticLearningContext(insight({ relatedPids: ['A5'] }));
    expect(ctx!.requiresManualReview).toBe(true);
    expect(ctx!.learningWarnings.length).toBeGreaterThan(0);
  });
});

/* ── Dashboard rozet / filtre ────────────────────────────────────────────── */
describe('dashboard annotation + badges + filters', () => {
  it('annotateDiscovery doğru statü/decay döndürüyor', () => {
    const s = svc([ev({ pidOrDid: 'A5', supportingVehicleHashes: ['v1', 'v2', 'v3'], status: 'strong' })]);
    const ann = s.annotateDiscovery('PID', 'A5');
    expect(ann).toBeTruthy();
    expect(ann!.evidenceStatus).toBe('strong');
    expect(ann!.decayedConfidence).toBeGreaterThan(0);
  });

  it('learningBadgesFor doğru rozetleri üretiyor', () => {
    const ann: LearningDiscoveryAnnotation = {
      pidOrDid: 'A5', discoverySource: 'PID', evidenceStatus: 'strong', patternStatus: 'strong',
      confidence: 0.8, decayedConfidence: 0.75, vehicleCount: 3, observationCount: 6, ecuCount: 1,
      firstSeen: 0, lastSeen: NOW, stale: false, requiresManualReview: true,
      conflictReasons: ['CROSS_MANUFACTURER_MEANING'],
    };
    const badges = learningBadgesFor(ann);
    expect(badges).toContain('STRONG');
    expect(badges).toContain('CONFLICT');
    expect(badges).toContain('MANUAL_REVIEW');
    expect(learningBadgesFor(null)).toEqual([]);
  });

  it('dashboard öğrenme filtreleri annotation ile DOĞRU süzüyor', () => {
    // Sahte gözlemler (yalnız record.discoverySource + pidOrDid önemli)
    const obs = [
      { record: { discoverySource: 'PID', pidOrDid: 'A5' }, status: 'new', seenCount: 1, firstAt: 0, lastAt: 0 },
      { record: { discoverySource: 'PID', pidOrDid: 'B2' }, status: 'new', seenCount: 1, firstAt: 0, lastAt: 0 },
    ] as unknown as Parameters<typeof filterObservations>[0];
    const annMap = new Map<string, LearningDiscoveryAnnotation>([
      ['PID:A5', { pidOrDid: 'A5', discoverySource: 'PID', evidenceStatus: 'strong', patternStatus: 'strong', confidence: 0.8, decayedConfidence: 0.7, vehicleCount: 3, observationCount: 6, ecuCount: 1, firstSeen: 0, lastSeen: 0, stale: false, requiresManualReview: false, conflictReasons: [] }],
      ['PID:B2', { pidOrDid: 'B2', discoverySource: 'PID', evidenceStatus: 'weak', patternStatus: 'weak', confidence: 0.3, decayedConfidence: 0.3, vehicleCount: 1, observationCount: 1, ecuCount: 1, firstSeen: 0, lastSeen: 0, stale: false, requiresManualReview: true, conflictReasons: ['CROSS_MANUFACTURER_MEANING'] }],
    ]);
    const resolver = (o: { record: { discoverySource: string; pidOrDid: string } }) => annMap.get(`${o.record.discoverySource}:${o.record.pidOrDid}`) ?? null;

    expect(filterObservations(obs, 'strong', resolver)).toHaveLength(1);
    expect(filterObservations(obs, 'manual', resolver)).toHaveLength(1);
    expect(filterObservations(obs, 'conflict', resolver)).toHaveLength(1);
    // resolver YOKSA fail-soft tümü (mevcut davranış korunur)
    expect(filterObservations(obs, 'strong')).toHaveLength(2);
    // mevcut filtreler bozulmadı
    expect(filterObservations(obs, 'pid')).toHaveLength(2);
    expect(selectVisible(obs, 'strong', '', resolver)).toHaveLength(1);
    expect(isLearningFilter('strong')).toBe(true);
    expect(isLearningFilter('pid' as DiscoveryFilter)).toBe(false);
  });
});

/* ── Expert summary ──────────────────────────────────────────────────────── */
describe('expert summary', () => {
  it('sayımlar DOĞRU (weak/candidate/strong + son öğrenme)', () => {
    const s = svc([
      ev({ evidenceId: 'a', status: 'weak', pidOrDid: 'A1' }),
      ev({ evidenceId: 'b', status: 'candidate', pidOrDid: 'A2' }),
      ev({ evidenceId: 'c', status: 'strong', pidOrDid: 'A3', supportingVehicleHashes: ['v1', 'v2', 'v3'] }),
    ]);
    const sum = s.getExpertSummary();
    expect(sum.totalEvidence).toBe(3);
    expect(sum.weakCount).toBe(1);
    expect(sum.candidateCount).toBe(1);
    expect(sum.strongCount).toBe(1);
    expect(sum.lastLearnedAt).toBe(NOW);
    expect(sum.manufacturerClusters.length).toBeGreaterThanOrEqual(1);
  });

  it('decay sonrası STALE durumu doğru (çok eski kanıt)', () => {
    const s = svc([ev({ status: 'weak', confidence: 0.3, lastSeen: 0, firstSeen: 0 })], 'high', 3000 * DAY);
    const sum = s.getExpertSummary();
    expect(sum.staleCount).toBe(1);
    expect(sum.pruneCandidateCount).toBe(1);
  });
});

/* ── DeviceTier ──────────────────────────────────────────────────────────── */
describe('DeviceTier davranışı', () => {
  const conflicting = () => [
    ev({ evidenceId: 'r', manufacturer: 'Renault', pidOrDid: 'A5', supportingVehicleHashes: ['v1', 'v2', 'v3'] }),
    ev({ evidenceId: 't', manufacturer: 'Toyota', pidOrDid: 'A5', supportingVehicleHashes: ['w1', 'w2', 'w3'] }),
  ];

  it('BASIC_JS (low) AĞIR detay ÜRETMİYOR (manual/conflict=0, patternDetail kapalı)', () => {
    const sum = svc(conflicting(), 'low').getExpertSummary();
    expect(sum.patternDetailEnabled).toBe(false);
    expect(sum.manualReviewCount).toBe(0);
    expect(sum.conflictCount).toBe(0);
    // annotation'da conflict/manual detayı da yok
    const ann = svc(conflicting(), 'low').annotateDiscovery('PID', 'A5');
    expect(ann!.conflictReasons).toEqual([]);
    expect(ann!.requiresManualReview).toBe(false);
  });

  it('BALANCED/HIGH TAM detay üretiyor (conflict işaretli)', () => {
    const sum = svc(conflicting(), 'high').getExpertSummary();
    expect(sum.patternDetailEnabled).toBe(true);
    expect(sum.conflictCount).toBeGreaterThan(0);
    const ann = svc(conflicting(), 'high').annotateDiscovery('PID', 'A5');
    expect(ann!.conflictReasons.length).toBeGreaterThan(0);
    expect(ann!.requiresManualReview).toBe(true);
  });
});

/* ── Memoization / immutability / fail-soft / dispose ────────────────────── */
describe('memoization + immutability + fail-soft + dispose', () => {
  it('memoization: aynı veri → ağır pattern hesabı TEK KEZ (buildPatterns memoize)', () => {
    let builds = 0;
    const list = [ev({ pidOrDid: 'A5', supportingVehicleHashes: ['v1', 'v2'] })];
    const s = new VehicleLearningIntegrationService(
      () => list, () => NOW, () => 'high',
      (evList, opts) => { builds++; return buildPatterns(evList, opts); },
    );
    s.getExpertSummary();
    s.getExpertSummary();
    s.annotateDiscovery('PID', 'A5');
    expect(builds).toBe(1); // memo → ağır adım tek kez
    s.invalidate();
    s.getExpertSummary();
    expect(builds).toBe(2); // invalidate sonrası taze hesap
  });

  it('girdi evidence MUTATE EDİLMİYOR', () => {
    const list = [ev({ pidOrDid: 'A5', supportingVehicleHashes: ['v1', 'v2'], ecuAddresses: ['7E8'] })];
    const snap = JSON.parse(JSON.stringify(list));
    const s = svc(list);
    s.getExpertSummary();
    s.annotateDiscovery('PID', 'A5');
    s.buildDiagnosticLearningContext(insight({ relatedPids: ['A5'] }));
    expect(list).toEqual(snap);
  });

  it('boş / bozuk veri FAIL-SOFT', () => {
    const empty = svc([]);
    expect(empty.getExpertSummary().totalEvidence).toBe(0);
    expect(empty.annotateDiscovery('PID', 'A5')).toBeNull();
    expect(empty.buildDiagnosticLearningContext(insight())).toBeNull();

    const broken = new VehicleLearningIntegrationService(
      () => ([null, { evidenceId: '' }, ev({ pidOrDid: 'A5' })] as unknown as LearningEvidence[]),
      () => NOW, () => 'high',
    );
    expect(() => broken.getExpertSummary()).not.toThrow();
    expect(broken.getExpertSummary().totalEvidence).toBe(3); // bozuklar sayıda ama fail-soft

    // reader throw → fail-soft boş
    const throwing = new VehicleLearningIntegrationService(() => { throw new Error('x'); }, () => NOW, () => 'high');
    expect(throwing.getExpertSummary().totalEvidence).toBe(0);
    expect(throwing.annotateDiscovery('PID', 'A5')).toBeNull();
  });

  it('enrichInsight null insight’ta çökmüyor + dispose temizliyor', () => {
    const s = svc([ev({ pidOrDid: 'A5', supportingVehicleHashes: ['v1', 'v2'] })]);
    expect(() => s.enrichInsight(null as unknown as DiagnosticInsight)).not.toThrow();
    s.getExpertSummary();
    expect(() => s.dispose()).not.toThrow();
    // dispose sonrası tekrar çalışır (fail-soft)
    expect(s.getExpertSummary().totalEvidence).toBe(1);
  });
});
