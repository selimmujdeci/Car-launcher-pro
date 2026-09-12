/**
 * navV3CehShadowF5.test.ts — NAV v3 · F5 · CEH TÜKETİCİ GÖÇÜ / GÖLGE OTORİTE.
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F5 · CLAUDE.md §CROSS-DOMAIN 1/2/3/6/7/12.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NEYİ KİLİTLER ────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F5'in tek vaadi şudur: **üretim kararı DEĞİŞMEDEN** CEH aynı soruyu gölgede
 * cevaplar ve fark ÖLÇÜLÜR. Bu dosya o vaadin bozulamayacağını kilitler:
 *   · gölge yolundan sürücüye ses/uyarı ÇIKAMAZ,
 *   · F4 saha kapısı kapalıyken CEH üretim otoritesi OLAMAZ,
 *   · `NOT_MEASURED` → `NONE` dönüşümü YAPILAMAZ,
 *   · belirsiz ufuk kesin iddia/uyarı ÜRETEMEZ,
 *   · aynı olay sürücüye İKİ KEZ çıkamaz,
 *   · cutover kapısı varsayılan KAPALIdır ve ölçülmemiş şart onu AÇAMAZ.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { asMonotonic } from '../platform/navigation/contracts/navMonotonicTime';
import { derivedNav, observedNav, unavailableNav } from '../platform/navigation/contracts/navEvidence';
import type {
  ElectronicHorizon, HorizonObject, HorizonPath,
} from '../platform/navigation/contracts/navHorizon';
import { HORIZON_OBJECT_KINDS, MPP_PATH_ID } from '../platform/navigation/contracts/navHorizon';
import type { CehAheadClaim } from '../platform/navigation/horizon/cehConsumerContract';
import {
  CEH_AHEAD_DOMAINS, aheadDomainMatchesKind, cehClaimIsActionable,
  cehClaimIsMeasuredAbsence, cehClaimIsUnmeasured, cehClaimStillValid,
  nearestObjectInPath, noCehAheadClaim, pathMeasuresDomain, readCehAhead,
} from '../platform/navigation/horizon/cehConsumerContract';
import type { LegacyAheadClaim } from '../platform/navigation/shadow/cehShadowModel';
import {
  EMPTY_SHADOW_COUNTERS, compareAhead, foldShadowSample, legacyAheadUnanswered,
  shadowDistanceToleranceM, shadowDivergenceRatio, verdictIsComparable,
  verdictIsDivergence,
} from '../platform/navigation/shadow/cehShadowModel';
import {
  CEH_CUTOVER_DEFAULT_OPEN, CEH_CUTOVER_CONDITIONS, CEH_CUTOVER_MIN_SHADOW_SAMPLES,
  evaluateCehCutoverGate, isCehProductionAuthority,
} from '../platform/navigation/shadow/cehCutoverGate';
import {
  EMPTY_SUPPRESSION_COUNTERS, classifySuppression, dispositionKeepsAlive,
  dispositionReachedDriver, foldSuppression,
} from '../platform/navigation/shadow/cehSuppressionContract';
import { buildCehShadowGuardianVerdict } from '../platform/navigation/shadow/cehGuardianShadowAdapter';
import {
  _resetCehShadowForTest, cehAttributePortsBound, getCehCutoverVerdict,
  getCehShadowSnapshot, noteCehShadowTick,
} from '../platform/navigation/shadow/cehShadowRuntime';

/* ══════════════════════════════════════════════════════════════════════════
   KAYNAK TARAMA ALTYAPISI
   ══════════════════════════════════════════════════════════════════════════ */

const SRC = resolve(__dirname, '..');
const readSrc = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const SHADOW_DIR = 'platform/navigation/shadow';

function shadowFiles(): string[] {
  const abs = resolve(SRC, SHADOW_DIR);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).filter((f) => f.endsWith('.ts')).map((f) => `${SHADOW_DIR}/${f}`);
}

function walkSrc(rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(SRC, rel), { withFileTypes: true })) {
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...walkSrc(next));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(next);
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   FİKSTÜRLER
   ══════════════════════════════════════════════════════════════════════════ */

const T0 = asMonotonic(1_000_000);

function obj(over: Partial<HorizonObject> = {}): HorizonObject {
  return {
    kind: 'MANEUVER',
    id: 'mnv:1:2',
    pathId: MPP_PATH_ID,
    distanceFromEgoM: derivedNav<number>(300, {
      source: 'ROUTE_PROVIDER', confidence: 0.8, observedAtMonoMs: T0, freshnessBudgetMs: null,
    }),
    label: derivedNav<string>('turn:left', {
      source: 'ROUTE_PROVIDER', confidence: 0.8, observedAtMonoMs: T0, freshnessBudgetMs: null,
    }),
    magnitude: unavailableNav<number>('ROUTE_PROVIDER', 'NO_SOURCE'),
    ...over,
  };
}

function path(over: Partial<HorizonPath> = {}): HorizonPath {
  return {
    pathId: MPP_PATH_ID,
    provenance: 'ROUTE_INTENT',
    isMostProbable: true,
    confidence: 0.6,
    physicallyConfirmed: false,
    lengthM: derivedNav<number>(1_000, {
      source: 'ROUTE_PROVIDER', confidence: 0.6, observedAtMonoMs: T0, freshnessBudgetMs: null,
    }),
    startEdgeId: null,
    objects: [obj()],
    /* F6: bu fixture "kaynak HER alanda ölçüm üretti" senaryosudur — mevcut
       kilitler tam olarak bunu test ediyordu ve aynı şeyi test etmeye devam
       eder. Ölçülmemiş alan davranışı AYRI kilitlerde denenir (aşağıda). */
    measuredKinds: [...HORIZON_OBJECT_KINDS],
    ...over,
  };
}

function horizon(over: Partial<ElectronicHorizon> = {}): ElectronicHorizon {
  return {
    kind: 'ELECTRONIC_HORIZON',
    generation: 7,
    tsMonoMs: T0,
    state: 'HORIZON_PARTIAL',
    reason: 'DETERMINISTIC_DERIVATION',
    egoAnchor: null,
    matchedAnchor: null,
    paths: [path()],
    mppPathId: MPP_PATH_ID,
    ambiguous: false,
    degradation: 'STALE_MAP_DATA',
    budgetM: 600,
    ...over,
  };
}

const MEASURED = { validityBudgetMs: 5_000, domainMeasured: true } as const;
const UNBOUND = { validityBudgetMs: 5_000, domainMeasured: false } as const;

function legacy(over: Partial<LegacyAheadClaim> = {}): LegacyAheadClaim {
  return {
    domain: 'MANEUVER', outcome: 'CLAIM', distanceM: 300,
    label: 'turn:left', method: 'ALONG_ROUTE', ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   1) TÜKETİCİ SÖZLEŞMESİ — "ölçülmedi" ile "yok" AYRI
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5.1 · CEH tüketici sözleşmesi', () => {
  it('ufuk YOKSA tüketici kendi cevabını üretemez (fail-closed)', () => {
    const c = readCehAhead(null, 'MANEUVER', MEASURED);
    expect(c.outcome).toBe('HORIZON_UNAVAILABLE');
    expect(c.distanceM).toBeNull();
    expect(cehClaimIsActionable(c)).toBe(false);
  });

  it('BELİRSİZ ufuk kesin iddiaya izin VERMEZ (zorla indirgeme yok)', () => {
    const c = readCehAhead(
      horizon({ ambiguous: true, mppPathId: null, state: 'AMBIGUOUS_PATH' }),
      'MANEUVER', MEASURED,
    );
    expect(c.outcome).toBe('AMBIGUOUS');
    expect(c.distanceM).toBeNull();
    expect(cehClaimIsActionable(c)).toBe(false);
  });

  it('durum kesin iddiaya izin vermiyorsa (bayat ego) iddia ÜRETİLMEZ', () => {
    for (const state of ['EGO_STALE', 'EGO_UNAVAILABLE', 'MAP_UNAVAILABLE',
      'MATCH_UNAVAILABLE', 'NO_HORIZON_SOURCE', 'INSUFFICIENT_METADATA'] as const) {
      const c = readCehAhead(horizon({ state }), 'MANEUVER', MEASURED);
      expect(c.outcome, state).toBe('HORIZON_UNAVAILABLE');
    }
  });

  it('ÖLÇÜLMEDİ ≠ YOK — port bağlanmamışken boş liste "ileride yok" DEĞİLDİR', () => {
    const c = readCehAhead(horizon(), 'ENFORCEMENT', UNBOUND);
    expect(c.outcome).toBe('NOT_MEASURED');
    expect(cehClaimIsUnmeasured(c)).toBe(true);
    expect(cehClaimIsMeasuredAbsence(c)).toBe(false);
    expect(c.distanceM).toBeNull();
  });

  it('ÖLÇÜLDÜ ve nesne yoksa AYRI hüküm verilir (ölçülmüş yokluk)', () => {
    const c = readCehAhead(horizon(), 'ENFORCEMENT', MEASURED);
    expect(c.outcome).toBe('NO_OBJECT_IN_HORIZON');
    expect(cehClaimIsMeasuredAbsence(c)).toBe(true);
    expect(cehClaimIsUnmeasured(c)).toBe(false);
  });

  it('F6 — ölçülmemiş alanda boş liste "yok" DEĞİLDİR (port bağlı olsa bile)', () => {
    /* Port bağlı (`MEASURED`) ama kol BU alanda ölçüm üretmedi: kesik
       koridor · paket hazır değil · fiziksel çapa yok. Eskiden bu durum
       `NO_OBJECT_IN_HORIZON` (ölçülmüş yokluk) olarak sunuluyordu. */
    const p = path({ measuredKinds: ['MANEUVER'] });          // ENFORCEMENT YOK
    const c = readCehAhead(horizon({ paths: [p] }), 'ENFORCEMENT', MEASURED);
    expect(c.outcome).toBe('NOT_MEASURED');
    expect(cehClaimIsMeasuredAbsence(c)).toBe(false);
    expect(cehClaimIsUnmeasured(c)).toBe(true);
  });

  it('F6 — kilit KÖR DEĞİL: alan ölçüldüyse aynı kol ölçülmüş yokluk verir', () => {
    const p = path({ measuredKinds: ['MANEUVER', 'ENFORCEMENT'] });
    const c = readCehAhead(horizon({ paths: [p] }), 'ENFORCEMENT', MEASURED);
    expect(c.outcome).toBe('NO_OBJECT_IN_HORIZON');
    expect(cehClaimIsMeasuredAbsence(c)).toBe(true);
  });

  it('F6 — `pathMeasuresDomain` FAIL-CLOSED: şekil eksik/kol yok → ölçülmedi', () => {
    expect(pathMeasuresDomain(null, 'ENFORCEMENT')).toBe(false);
    expect(pathMeasuresDomain(
      { ...path(), measuredKinds: undefined as unknown as [] }, 'ENFORCEMENT',
    )).toBe(false);
    expect(pathMeasuresDomain(path({ measuredKinds: [] }), 'ENFORCEMENT')).toBe(false);
    /* ROAD_PROFILE iki türü de kabul eder — eşleme tek kaynaktan okunur. */
    expect(pathMeasuresDomain(path({ measuredKinds: ['SLOPE'] }), 'ROAD_PROFILE')).toBe(true);
  });

  it('iddia MPP kolundan gelir ve mesafe/etiket taşınır', () => {
    const c = readCehAhead(horizon(), 'MANEUVER', MEASURED);
    expect(c.outcome).toBe('CLAIM');
    expect(c.distanceM).toBe(300);
    expect(c.label).toBe('turn:left');
    expect(c.generation).toBe(7);
    expect(c.provenance).toBe('ROUTE_INTENT');
  });

  it('güven ZİNCİRİN EN ZAYIF halkasıdır (kol güveni nesneyi yükseltemez)', () => {
    const c = readCehAhead(
      horizon({ paths: [path({ confidence: 0.2 })] }), 'MANEUVER', MEASURED,
    );
    expect(c.confidence).toBeCloseTo(0.2, 5);
  });

  it('mesafesi ÖLÇÜLEMEYEN nesne iddia ÜRETMEZ (uydurma mesafe yok)', () => {
    const noDist = obj({ distanceFromEgoM: unavailableNav<number>('ROUTE_PROVIDER', 'NO_SOURCE') });
    const c = readCehAhead(
      horizon({ paths: [path({ objects: [noDist] })] }), 'MANEUVER', MEASURED,
    );
    expect(c.outcome).toBe('NO_OBJECT_IN_HORIZON');
    expect(c.distanceM).toBeNull();
  });

  it('EN YAKIN nesne seçilir; geride kalan (negatif) nesne ATLANIR', () => {
    const near = obj({ id: 'a', distanceFromEgoM: observedNav<number>(120, { source: 'ROUTE_PROVIDER', confidence: 0.9, observedAtMonoMs: T0, freshnessBudgetMs: null }) });
    const far = obj({ id: 'b', distanceFromEgoM: observedNav<number>(500, { source: 'ROUTE_PROVIDER', confidence: 0.9, observedAtMonoMs: T0, freshnessBudgetMs: null }) });
    const behind = obj({ id: 'c', distanceFromEgoM: observedNav<number>(-10, { source: 'ROUTE_PROVIDER', confidence: 0.9, observedAtMonoMs: T0, freshnessBudgetMs: null }) });
    const p = path({ objects: [far, behind, near] });
    expect(nearestObjectInPath(p, 'MANEUVER')!.id).toBe('a');
  });

  it('alan ↔ nesne türü eşlemesi tek yerdedir (ROAD_PROFILE iki türü kapsar)', () => {
    expect(aheadDomainMatchesKind('ROAD_PROFILE', 'SLOPE')).toBe(true);
    expect(aheadDomainMatchesKind('ROAD_PROFILE', 'ROAD_CLASS')).toBe(true);
    expect(aheadDomainMatchesKind('MANEUVER', 'ENFORCEMENT')).toBe(false);
  });

  it('MUTLAK-DOĞRULUK alanları fiziksel doğrulama olmadan karar ÜRETEMEZ', () => {
    const routeOnly = readCehAhead(
      horizon({ paths: [path({ objects: [obj({ kind: 'ENFORCEMENT', label: derivedNav<string>('camera:fixed', { source: 'MAP_PACKAGE', confidence: 0.9, observedAtMonoMs: T0, freshnessBudgetMs: null }) })] })] }),
      'ENFORCEMENT', MEASURED,
    );
    expect(routeOnly.outcome).toBe('CLAIM');
    expect(routeOnly.physicallyConfirmed).toBe(false);
    /* Rota niyeti bir gözlem DEĞİLDİR → denetim uyarısı üretemez. */
    expect(cehClaimIsActionable(routeOnly)).toBe(false);

    const confirmed = readCehAhead(
      horizon({ paths: [path({ provenance: 'ROUTE_INTENT_CONFIRMED', physicallyConfirmed: true, objects: [obj({ kind: 'ENFORCEMENT' })] })] }),
      'ENFORCEMENT', MEASURED,
    );
    expect(cehClaimIsActionable(confirmed)).toBe(true);
  });

  it('MANEVRA rehberliği fiziksel doğrulama ŞARTI ARAMAZ (rota niyeti yeter)', () => {
    const c = readCehAhead(horizon(), 'MANEUVER', MEASURED);
    expect(c.physicallyConfirmed).toBe(false);
    expect(cehClaimIsActionable(c)).toBe(true);
  });

  it('geçerlilik ufku bütçeden gelir; bütçe yoksa erteleme hakkı DOĞMAZ', () => {
    const withBudget = readCehAhead(horizon(), 'MANEUVER', MEASURED);
    expect(withBudget.validUntilMonoMs).toBe(T0 + 5_000);
    expect(cehClaimStillValid(withBudget, T0 + 4_999)).toBe(true);
    expect(cehClaimStillValid(withBudget, T0 + 5_001)).toBe(false);

    const noBudget = readCehAhead(horizon(), 'MANEUVER', { validityBudgetMs: null, domainMeasured: true });
    expect(noBudget.validUntilMonoMs).toBeNull();
    expect(cehClaimStillValid(noBudget, T0)).toBe(false);
  });

  it('boş iddia şekli SABİTTİR (V8 hidden-class — alan silinmez)', () => {
    const empty = noCehAheadClaim('CURVE', 'NOT_MEASURED', null);
    for (const k of ['domain', 'outcome', 'generation', 'distanceM', 'label',
      'confidence', 'provenance', 'physicallyConfirmed', 'validUntilMonoMs']) {
      expect(Object.prototype.hasOwnProperty.call(empty, k), k).toBe(true);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) GÖLGE KARŞILAŞTIRMA
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5.3 · gölge karşılaştırma çekirdeği', () => {
  const cehClaim = (over: Partial<CehAheadClaim> = {}): CehAheadClaim => ({
    ...noCehAheadClaim('MANEUVER', 'CLAIM', 7), distanceM: 300, label: 'turn:left',
    confidence: 0.8, provenance: 'ROUTE_INTENT', ...over,
  });

  it('tolerans içindeki fark UYUM sayılır', () => {
    const s = compareAhead(legacy({ distanceM: 310 }), cehClaim());
    expect(s.verdict).toBe('AGREE');
    expect(s.deltaM).toBe(10);
  });

  it('tolerans DIŞINDAKİ fark ayrı sınıfa yazılır', () => {
    const s = compareAhead(legacy({ distanceM: 900 }), cehClaim());
    expect(s.verdict).toBe('DIVERGE_DISTANCE');
    expect(s.deltaM).toBe(600);
    expect(verdictIsDivergence(s.verdict)).toBe(true);
  });

  it('tolerans mesafeyle ORANTILI büyür (yakında mutlak, uzakta oransal)', () => {
    expect(shadowDistanceToleranceM(0)).toBe(25);
    expect(shadowDistanceToleranceM(1_000)).toBe(125);
  });

  it('aynı mesafe FARKLI etiket ayrı kanıt olarak sayılır', () => {
    const s = compareAhead(legacy({ label: 'turn:right' }), cehClaim());
    expect(s.verdict).toBe('AGREE');
    expect(s.labelMismatch).toBe(true);
  });

  it('biri "var" diğeri ÖLÇEREK "yok" derse GERÇEK çelişkidir', () => {
    const a = compareAhead(legacy(), cehClaim({ outcome: 'NO_OBJECT_IN_HORIZON', distanceM: null }));
    expect(a.verdict).toBe('DIVERGE_PRESENCE');
    const b = compareAhead(legacy({ outcome: 'MEASURED_ABSENT', distanceM: null }), cehClaim());
    expect(b.verdict).toBe('DIVERGE_PRESENCE');
  });

  it('tek taraflı iddia AYRI sınıftır (fark ile karıştırılmaz)', () => {
    expect(compareAhead(legacy(), cehClaim({ outcome: 'NOT_MEASURED', distanceM: null })).verdict)
      .toBe('LEGACY_ONLY');
    expect(compareAhead(legacy({ outcome: 'NOT_MEASURED', distanceM: null }), cehClaim()).verdict)
      .toBe('CEH_ONLY');
  });

  it('CEH BELİRSİZLİĞİ bir fark DEĞİLDİR — karar reddidir', () => {
    const s = compareAhead(legacy(), cehClaim({ outcome: 'AMBIGUOUS', distanceM: null }));
    expect(s.verdict).toBe('CEH_AMBIGUOUS');
    expect(verdictIsDivergence(s.verdict)).toBe(false);
  });

  it('üretimde soruyu soran YOKSA karşılaştırma paydaya GİRMEZ', () => {
    const s = compareAhead(legacyAheadUnanswered('SPEED_LIMIT'), cehClaim({ domain: 'SPEED_LIMIT' }));
    expect(s.verdict).toBe('NOT_COMPARABLE');
    expect(verdictIsComparable(s.verdict)).toBe(false);
  });

  it('ORTAK BİLGİSİZLİK uyum SAYILMAZ ve paydaya girmez', () => {
    const s = compareAhead(
      legacy({ outcome: 'NOT_MEASURED', distanceM: null }),
      cehClaim({ outcome: 'NOT_MEASURED', distanceM: null }),
    );
    expect(s.verdict).toBe('BOTH_UNMEASURED');
    expect(verdictIsComparable(s.verdict)).toBe(false);
  });

  it('ikisi de ölçüp "yok" derse UYUŞMA sayılır ve paydaya girer', () => {
    const s = compareAhead(
      legacy({ outcome: 'MEASURED_ABSENT', distanceM: null }),
      cehClaim({ outcome: 'NO_OBJECT_IN_HORIZON', distanceM: null }),
    );
    expect(s.verdict).toBe('BOTH_ABSENT');
    expect(verdictIsComparable(s.verdict)).toBe(true);
    expect(verdictIsDivergence(s.verdict)).toBe(false);
  });

  it('defter SAFTIR: girdi değişmez, sayaçlar ve maxΔ birikir', () => {
    const s1 = compareAhead(legacy({ distanceM: 310 }), cehClaim());
    const s2 = compareAhead(legacy({ distanceM: 900 }), cehClaim());
    const c1 = foldShadowSample(EMPTY_SHADOW_COUNTERS, s1);
    const c2 = foldShadowSample(c1, s2);
    expect(EMPTY_SHADOW_COUNTERS.samples).toBe(0);      // girdi bozulmadı
    expect(c2.samples).toBe(2);
    expect(c2.agree).toBe(1);
    expect(c2.divergeDistance).toBe(1);
    expect(c2.maxAbsDeltaM).toBe(600);
    expect(c2.comparable).toBe(2);
    expect(c2.divergences).toBe(1);
    expect(shadowDivergenceRatio(c2)).toBeCloseTo(0.5, 6);
  });

  it('KARŞILAŞTIRILABİLİR örnek yoksa oran `null` — "%0 sapma" İDDİA EDİLMEZ', () => {
    const s = compareAhead(legacyAheadUnanswered('CURVE'), cehClaim({ domain: 'CURVE' }));
    const c = foldShadowSample(EMPTY_SHADOW_COUNTERS, s);
    expect(c.samples).toBe(1);
    expect(c.comparable).toBe(0);
    expect(shadowDivergenceRatio(c)).toBeNull();
    expect(c.maxAbsDeltaM).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) GUARDIAN GÖLGE ADAPTÖRÜ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5.5 · Guardian gölge adaptörü', () => {
  const POLICY = { radiusM: 700, minConfidence: 0.3, sourceId: 'EGM_EDS_MAP' } as const;
  const enf = (over: Partial<CehAheadClaim> = {}): CehAheadClaim => ({
    ...noCehAheadClaim('ENFORCEMENT', 'CLAIM', 3), distanceM: 400, label: 'camera:fixed',
    confidence: 0.8, provenance: 'ROUTE_INTENT_CONFIRMED', physicallyConfirmed: true, ...over,
  });

  it('CUTOVER KAPALIYKEN hiçbir girdi uyarı üretemez (tek gerekçe kapıdır)', () => {
    const v = buildCehShadowGuardianVerdict(enf(), POLICY, false);
    expect(v.shadow).toBe(true);
    expect(v.wouldEmit).toBe(false);
    expect(v.blockedBy).toBe('CUTOVER_GATE_CLOSED');
    expect(v.eventKey).toBeNull();
  });

  it('kapı açık + kanıtlı iddia → gölgede uyarırdı (yan etki YİNE yok)', () => {
    const v = buildCehShadowGuardianVerdict(enf(), POLICY, true);
    expect(v.wouldEmit).toBe(true);
    expect(v.blockedBy).toBeNull();
    expect(v.eventKey).toContain('EGM_EDS_MAP');
  });

  it('BELİRSİZLİK kesin Guardian hükmü ÜRETEMEZ', () => {
    const v = buildCehShadowGuardianVerdict(enf({ outcome: 'AMBIGUOUS', distanceM: null }), POLICY, true);
    expect(v.wouldEmit).toBe(false);
    expect(v.blockedBy).toBe('AMBIGUOUS');
  });

  it('ÖLÇÜLMEDİ hükmü "güvenli/yok" varsayımına DÖNÜŞTÜRÜLEMEZ', () => {
    const v = buildCehShadowGuardianVerdict(enf({ outcome: 'NOT_MEASURED', distanceM: null }), POLICY, true);
    expect(v.wouldEmit).toBe(false);
    expect(v.blockedBy).toBe('NOT_MEASURED');
    expect(v.distanceM).toBeNull();       // sahte 0 YOK
    expect(v.confidence).toBeNull();
  });

  it('ölçülmüş yokluk AYRI gerekçe taşır (kusur değil)', () => {
    const v = buildCehShadowGuardianVerdict(enf({ outcome: 'NO_OBJECT_IN_HORIZON', distanceM: null }), POLICY, true);
    expect(v.blockedBy).toBe('NO_OBJECT_IN_HORIZON');
  });

  it('FİZİKSEL DOĞRULAMA olmadan denetim uyarısı üretilemez', () => {
    const v = buildCehShadowGuardianVerdict(
      enf({ physicallyConfirmed: false, provenance: 'ROUTE_INTENT' }), POLICY, true,
    );
    expect(v.blockedBy).toBe('NOT_PHYSICALLY_CONFIRMED');
  });

  it('güven ölçülmediyse veya eşiğin altındaysa kural KOŞMAZ', () => {
    expect(buildCehShadowGuardianVerdict(enf({ confidence: null }), POLICY, true).blockedBy)
      .toBe('BELOW_CONFIDENCE');
    expect(buildCehShadowGuardianVerdict(enf({ confidence: 0.1 }), POLICY, true).blockedBy)
      .toBe('BELOW_CONFIDENCE');
  });

  it('menzil dışı nesne uyarı üretmez', () => {
    expect(buildCehShadowGuardianVerdict(enf({ distanceM: 5_000 }), POLICY, true).blockedBy)
      .toBe('OUT_OF_RANGE');
  });

  it('girdi YOKSA fail-closed davranır (throw etmez)', () => {
    const v = buildCehShadowGuardianVerdict(null, POLICY, true);
    expect(v.wouldEmit).toBe(false);
    expect(v.blockedBy).toBe('NOT_MEASURED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) BASTIRMA / DEFER SÖZLEŞMESİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5.7 · bastırılan olay sözleşmesi', () => {
  const base = {
    key: 'k1', presented: false, alreadyDelivered: false, superseded: false,
    validUntilMonoMs: asMonotonic(T0 + 5_000), nowMonoMs: T0,
  };

  it('AYNI OLAY İKİ KEZ sürücüye çıkamaz', () => {
    expect(classifySuppression({ ...base, alreadyDelivered: true, presented: true }))
      .toBe('DROPPED_ALREADY_DELIVERED');
  });

  it('sunulan olay DELIVERED sayılır (ve bir daha sunulamaz)', () => {
    const d = classifySuppression({ ...base, presented: true });
    expect(d).toBe('DELIVERED');
    expect(dispositionReachedDriver(d)).toBe(true);
  });

  it('geçerlilik ufku İÇİNDE bastırılan olay ERTELENEBİLİR', () => {
    const d = classifySuppression(base);
    expect(d).toBe('DEFERRED');
    expect(dispositionKeepsAlive(d)).toBe(true);
  });

  it('geçerlilik ufku GEÇMİŞSE olay bir daha sunulmaz', () => {
    expect(classifySuppression({ ...base, nowMonoMs: T0 + 5_001 })).toBe('DROPPED_EXPIRED');
  });

  it('geçerlilik ufku YOKSA erteleme HAKKI DOĞMAZ (fail-closed)', () => {
    expect(classifySuppression({ ...base, validUntilMonoMs: null })).toBe('DROPPED_NO_VALIDITY');
    expect(classifySuppression({ ...base, nowMonoMs: null })).toBe('DROPPED_NO_VALIDITY');
  });

  it('daha güncel olay varsa eski olay taşınmaz', () => {
    expect(classifySuppression({ ...base, superseded: true })).toBe('DROPPED_SUPERSEDED');
  });

  it('defter saftır ve son akıbeti korur', () => {
    const c = foldSuppression(foldSuppression(EMPTY_SUPPRESSION_COUNTERS, 'DEFERRED'), 'DROPPED_EXPIRED');
    expect(EMPTY_SUPPRESSION_COUNTERS.evaluated).toBe(0);
    expect(c.evaluated).toBe(2);
    expect(c.deferred).toBe(1);
    expect(c.droppedExpired).toBe(1);
    expect(c.lastDisposition).toBe('DROPPED_EXPIRED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) CUTOVER KAPISI
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5.10 · cutover kapısı', () => {
  const ALL_PROVEN = {
    f4FieldValidationPassed: true,
    comparableSamples: CEH_CUTOVER_MIN_SHADOW_SAMPLES,
    divergenceRatio: 0,
    ambiguityFailClosedProven: true,
    regressionGuardsPassed: true,
    attributePortsBound: true,
  } as const;

  it('VARSAYILAN KAPALI — pazarlıksız', () => {
    expect(CEH_CUTOVER_DEFAULT_OPEN).toBe(false);
  });

  it('TÜM şartlar kanıtlansa BİLE bu fazda kapı AÇILMAZ', () => {
    const v = evaluateCehCutoverGate(ALL_PROVEN);
    expect(v.unmet).toEqual([]);
    expect(v.met.length).toBe(CEH_CUTOVER_CONDITIONS.length);
    expect(v.open).toBe(false);           // `CEH_CUTOVER_DEFAULT_OPEN === false`
    expect(v.state).toBe('CLOSED');
    expect(isCehProductionAuthority(v)).toBe(false);
  });

  it('ÖLÇÜLMEMİŞ şart kapıyı AÇMAZ ve "düştü" ile AYRI sayılır', () => {
    const v = evaluateCehCutoverGate({ ...ALL_PROVEN, f4FieldValidationPassed: null });
    expect(v.unmet).toContain('F4_FIELD_VALIDATION');
    expect(v.unmeasuredCount).toBe(1);

    const failed = evaluateCehCutoverGate({ ...ALL_PROVEN, f4FieldValidationPassed: false });
    expect(failed.unmet).toContain('F4_FIELD_VALIDATION');
    expect(failed.unmeasuredCount).toBe(0);
  });

  it('yetersiz örnek ve hesaplanamayan oran şartı KARŞILAMAZ', () => {
    expect(evaluateCehCutoverGate({ ...ALL_PROVEN, comparableSamples: 1 }).unmet)
      .toContain('SHADOW_SAMPLE_VOLUME');
    expect(evaluateCehCutoverGate({ ...ALL_PROVEN, divergenceRatio: null }).unmet)
      .toContain('SHADOW_DIVERGENCE');
    expect(evaluateCehCutoverGate({ ...ALL_PROVEN, divergenceRatio: 0.9 }).unmet)
      .toContain('SHADOW_DIVERGENCE');
  });

  it('öznitelik portu bağlı değilse şart DÜŞER (ölçülmedi sayılmaz)', () => {
    const v = evaluateCehCutoverGate({ ...ALL_PROVEN, attributePortsBound: false });
    expect(v.unmet).toContain('ATTRIBUTE_PORTS_BOUND');
  });

  it('girdi YOKSA tüm şartlar ölçülmemiş sayılır (fail-closed)', () => {
    const v = evaluateCehCutoverGate(null);
    expect(v.open).toBe(false);
    expect(v.unmet.length).toBe(CEH_CUTOVER_CONDITIONS.length);
    /* `attributePortsBound` üç değerli DEĞİLDİR (boolean) → ölçülmedi sayılmaz. */
    expect(v.unmeasuredCount).toBe(CEH_CUTOVER_CONDITIONS.length - 1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) GÖLGE KOŞUM ZAMANI
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5.6 · gölge koşum zamanı', () => {
  beforeEach(() => { _resetCehShadowForTest(); });

  it('başlangıçta hiçbir şey İDDİA ETMEZ (sahte 0 oran yok)', () => {
    const s = getCehShadowSnapshot();
    expect(s.active).toBe(false);
    expect(s.ticks).toBe(0);
    expect(s.divergenceRatio).toBeNull();
    expect(s.total.maxAbsDeltaM).toBeNull();
    expect(s.guardianShadow).toBeNull();
    expect(s.sideEffectCount).toBe(0);
  });

  it('bir tik ölçüm üretir ve HİÇBİR yan etki doğurmaz', () => {
    noteCehShadowTick();
    const s = getCehShadowSnapshot();
    expect(s.active).toBe(true);
    expect(s.ticks).toBe(1);
    expect(s.sideEffectCount).toBe(0);
    /* Ufuk yokken bile her alan bir hüküm üretir — sessizce atlanmaz. */
    for (const d of CEH_AHEAD_DOMAINS) {
      if (d === 'ENFORCEMENT') continue;   // yalnız Guardian yeni okuyunca örneklenir
      expect(s.domains[d].samples, d).toBe(1);
    }
  });

  it('üretim otoritesi CEH DEĞİLDİR — kapı yapısal olarak KAPALI', () => {
    noteCehShadowTick();
    const v = getCehCutoverVerdict();
    expect(v.open).toBe(false);
    expect(v.state).toBe('CLOSED');
    expect(v.unmet).toContain('F4_FIELD_VALIDATION');
    expect(getCehShadowSnapshot().guardianShadow?.blockedBy).toBe('CUTOVER_GATE_CLOSED');
    expect(getCehShadowSnapshot().guardianWouldEmitCount).toBe(0);
  });

  it('öznitelik portu bağlı DEĞİL — bu bir ÖLÇÜMDÜR, beyan değil', () => {
    expect(cehAttributePortsBound()).toBe(false);
    expect(getCehShadowSnapshot().attributePortsBound).toBe(false);
  });

  it('limit/viraj/eğim alanları KARŞILAŞTIRILAMAZ sayılır (oran şişirilmez)', () => {
    noteCehShadowTick();
    const s = getCehShadowSnapshot();
    for (const d of ['SPEED_LIMIT', 'CURVE', 'ROAD_PROFILE'] as const) {
      expect(s.domains[d].notComparable, d).toBe(1);
      expect(s.domains[d].comparable, d).toBe(0);
    }
  });

  it('reset defteri TAMAMEN düşürür (eski oturum yeni kanıt sayılmaz)', () => {
    noteCehShadowTick();
    noteCehShadowTick();
    expect(getCehShadowSnapshot().ticks).toBe(2);
    _resetCehShadowForTest();
    const s = getCehShadowSnapshot();
    expect(s.ticks).toBe(0);
    expect(s.active).toBe(false);
    expect(s.total.samples).toBe(0);
    expect(s.suppression.evaluated).toBe(0);
  });

  it('gölge tikleri sürücüye HİÇ olay SUNMAZ (yapısal 0)', () => {
    for (let i = 0; i < 25; i++) noteCehShadowTick();
    const s = getCehShadowSnapshot();
    expect(s.suppression.delivered).toBe(0);
    expect(s.guardianWouldEmitCount).toBe(0);
    expect(s.sideEffectCount).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) MİMARİ KİLİTLER
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5 · mimari kilitler', () => {
  it('S1 — gölge katmanı SES/UYARI/SUNUM üretemez', () => {
    const forbidden = [
      'ttsService', 'speakNavigation', 'speak(', 'voiceGuidanceRuntime',
      'notificationService', 'showToast', 'vibrate', 'Haptics',
    ];
    for (const f of shadowFiles()) {
      const src = strip(readSrc(f));
      for (const bad of forbidden) {
        expect(src, `${f}: yasak sunum çağrısı "${bad}"`).not.toContain(bad);
      }
    }
  });

  it('S2 — gölge katmanı DURUM YAZMAZ (store/zustand/setState yok)', () => {
    const forbidden = [
      'useUnifiedVehicleStore', 'setState(', 'zustand', 'useRouteStore',
      'safeStorage', 'localStorage', 'supabase',
    ];
    for (const f of shadowFiles()) {
      const src = strip(readSrc(f));
      for (const bad of forbidden) {
        expect(src, `${f}: yasak yazma yolu "${bad}"`).not.toContain(bad);
      }
    }
  });

  it('S3 — gölge katmanı TİK/ABONELİK SAHİBİ DEĞİLDİR', () => {
    const forbidden = [
      'setInterval(', 'setTimeout(', 'requestAnimationFrame(', 'scheduleTask',
      'new Worker', 'onGPSLocation(', 'watchPosition', 'addEventListener',
    ];
    for (const f of shadowFiles()) {
      const src = strip(readSrc(f));
      for (const bad of forbidden) {
        expect(src, `${f}: ${bad}`).not.toContain(bad);
      }
    }
  });

  it('S4 — gölge katmanı DUVAR SAATİYLE tazelik hesaplayamaz', () => {
    for (const f of shadowFiles()) {
      const src = strip(readSrc(f));
      expect(src, `${f}: Date.now`).not.toContain('Date.now(');
      expect(src, `${f}: new Date`).not.toContain('new Date(');
    }
  });

  it('S5 — gölge katmanı React/UI bağımlılığı İÇERMEZ', () => {
    for (const f of shadowFiles()) {
      expect(readSrc(f), `${f}: React`).not.toMatch(/from ['"]react['"]/);
    }
  });

  it('S6 — gölge katmanı İKİNCİ ham kaynak (graf/tile/Overpass) KURMAZ', () => {
    const forbidden = [
      'routing-graph', 'NavigationCompute.worker', 'mapSourceManager',
      'overpass', 'maplibre-gl', 'offlineTileDownloader', 'rtg2Reader',
      'edgeSpatialIndex', 'gpsService',
    ];
    for (const f of shadowFiles()) {
      const src = strip(readSrc(f));
      for (const bad of forbidden) {
        expect(src, `${f}: ikinci kaynak "${bad}"`).not.toContain(bad);
      }
    }
  });

  it('S7 — GUARDIAN ÜRETİM YOLU gölgeyi GÖRMEZ (ters bağımlılık yok)', () => {
    const guardianFiles = walkSrc().filter((f) => f.startsWith('platform/navigation/guardian/'));
    expect(guardianFiles.length).toBeGreaterThan(0);
    for (const f of guardianFiles) {
      const imports = [...readSrc(f).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const imp of imports) {
        expect(imp.includes('/shadow/') || imp.includes('cehShadow') || imp.includes('cehConsumerContract'),
          `${f}: Guardian üretim yolu gölgeyi import ediyor (${imp})`).toBe(false);
      }
    }
  });

  it('S8 — SESLİ YÖNLENDİRME sahibi değişmedi (gölge girdi olamaz)', () => {
    const vg = strip(readSrc('platform/navigation/voiceGuidanceRuntime.ts'));
    expect(vg).not.toContain('cehShadow');
    expect(vg).not.toContain('ElectronicHorizon');
    expect(vg).not.toContain('cehConsumerContract');
    /* Ses sahipliği hâlâ tek yerde ve tek sahiptedir. */
    expect(vg).toContain("owner: 'NAV_SESSION_RUNTIME'");
  });

  it('S9 — gölge tiki TEK yerden, ego/ufuk köprüsünden çağrılır', () => {
    const callers = walkSrc().filter((f) => strip(readSrc(f)).includes('noteCehShadowTick('));
    expect(callers.sort()).toEqual([
      'platform/navigation/navEgoHorizonBridge.ts',
      'platform/navigation/shadow/cehShadowRuntime.ts',
    ]);
  });

  it('S10 — gölge oturumla BIRAKILIR (bayat defter yeni oturuma taşınmaz)', () => {
    const bridge = strip(readSrc('platform/navigation/navEgoHorizonBridge.ts'));
    expect(bridge).toContain('resetCehShadow()');
  });

  it('S11 — cutover kapısı ve tüketici sözleşmesi TEK tanımlıdır', () => {
    const decls = [
      'export const CEH_CUTOVER_DEFAULT_OPEN',
      'export function evaluateCehCutoverGate',
      'export function readCehAhead',
      'export interface CehAheadClaim',
      'export type CehAheadOutcome',
      'export function compareAhead',
      'export function classifySuppression',
    ];
    for (const decl of decls) {
      const hits = walkSrc().filter((f) => readSrc(f).includes(decl));
      expect(hits.length, `${decl} → ${hits.join(', ')}`).toBe(1);
    }
  });

  it('S12 — L3 ufuk ağacı gölgeyi import ETMEZ (bağımlılık yönü korunur)', () => {
    const l3 = readdirSync(resolve(SRC, 'platform/navigation/horizon'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => `platform/navigation/horizon/${f}`);
    for (const f of l3) {
      const imports = [...readSrc(f).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const imp of imports) {
        expect(imp.includes('shadow'), `${f}: L3 gölgeyi import ediyor (${imp})`).toBe(false);
      }
    }
  });

  it('S13 — Guardian üretim zinciri AYNEN duruyor (legacy otorite sökülmedi)', () => {
    const rt = strip(readSrc('platform/navigation/guardian/runtime/guardianRuntime.ts'));
    expect(rt).toContain('buildGuardianRawPlatformData');
    expect(rt).toContain('buildGuardianRegistryInput');
    expect(rt).toContain('buildGuardianRuleResults');
    expect(rt).toContain('runGuardian(');
    expect(rt).toContain('createEnforcementMapSource');
  });

  it('S14 — gölge katmanı Guardian MOTORUNU/KURALLARINI çağırmaz', () => {
    const forbidden = [
      'runGuardian(', 'buildGuardianRuleResults', 'buildGuardianRegistryInput',
      'buildGuardianRawPlatformData', 'rankGuardianAlerts', 'startGuardianRuntime',
    ];
    for (const f of shadowFiles()) {
      const src = strip(readSrc(f));
      for (const bad of forbidden) {
        expect(src, `${f}: Guardian üretim çağrısı "${bad}"`).not.toContain(bad);
      }
    }
  });
});
