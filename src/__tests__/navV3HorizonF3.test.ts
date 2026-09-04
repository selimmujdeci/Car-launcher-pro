/**
 * navV3HorizonF3.test.ts — NAV v3 · F3 · L3 CEH / ELECTRONIC HORIZON KİLİTLERİ.
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F3.
 *
 * Kapsam:
 *  0) C1 — jiro/yaw çekirdeği (yerçekimi kapısı · ±π sarmalı · işaret öğrenme)
 *  1) C2 — canlı ego entegrasyonu (ikinci abonelik YOK · dengeli ömür)
 *  2) CEH sözleşmesi — durum · köken · bütçe · bozulma eşlemesi
 *  3) Ufuk motoru — niyet ≠ fiziksel gerçek · çelişki → belirsizlik
 *  4) CEH otoritesi — fail-closed · generation · teşhis
 *  5) Mimari kilitler (16 madde)
 *
 * SAHA: bu testin yeşili F3'ü "tamam" YAPMAZ — kütük #1220–#1231
 * `UNKNOWN / DEVICE VALIDATION REQUIRED`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/* Üretim GPS/VDL zincirini teste sokmadan mockla — F3 çekirdeği bunlara
   DEĞİL, port'lara ve itilen niyete bağlıdır; mock bunu da kanıtlar. */
vi.mock('../platform/gpsService', () => ({
  LOCATION_STALE_MS: 5_000,
  getLocationEvidence: vi.fn(() => ({
    lat: null, lng: null, accuracyM: null, fixAgeMs: null, observedAtWallMs: null,
    source: 'NONE', stale: true, headingDeg: null, speedMs: null,
  })),
}));
vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => ({
  useUnifiedVehicleStore: { getState: () => ({ speed: null }) },
}));

import {
  createYawRateState, noteMotionSample, noteHeadingObservation, resolveYawRate,
  GRAVITY_MIN_MS2, GRAVITY_MAX_MS2, POLARITY_LOCK_COUNT, POLARITY_UNLOCK_COUNT,
  POLARITY_MIN_TURN_RAD, YAW_WINDOW_MS,
  type YawRateState,
} from '../platform/navigation/ego/yawRateModel';
import {
  CEH_HORIZON_STATES, HORIZON_PATH_PROVENANCES, MPP_PATH_ID,
  HORIZON_MIN_M, HORIZON_MAX_M, HORIZON_TIME_HEADWAY_S,
  horizonBudgetM, provenanceIsPhysical, cehStateAllowsAheadClaim,
  degradationForHorizonState, isElectronicHorizon, mostProbablePath,
  ambiguityContractHolds,
  type CehHorizonState,
} from '../platform/navigation/contracts/navHorizon';
import {
  buildHorizon, maneuverObjects, matchedDistanceToRouteM,
  ROUTE_INTENT_CONFIDENCE_CEIL, MPP_MIN_CONFIDENCE,
  BRANCH_ROUTE_PATH_ID, BRANCH_MATCHED_PATH_ID,
  type HorizonBuildInput,
} from '../platform/navigation/horizon/horizonModel';
import {
  NO_ROUTE_INTENT, routeIntentCarriesDistance,
  type RouteIntentSnapshot,
} from '../platform/navigation/horizon/routeIntent';
import {
  UNAVAILABLE_HORIZON_ATTRIBUTE_PORTS, productionHorizonAttributePorts,
  outcomeIsMeasuredAbsence,
  type HorizonAttributePorts,
} from '../platform/navigation/horizon/horizonAttributePorts';
import { createCehAuthority } from '../platform/navigation/horizon/cehAuthority';
import type { EgoAuthority } from '../platform/navigation/ego/egoAuthority';
import type { MapStore } from '../platform/navigation/map/store';
import { asMonotonic, type MonotonicMs } from '../platform/navigation/contracts/navMonotonicTime';
import { observedNav, derivedNav, unavailableNav } from '../platform/navigation/contracts/navEvidence';
import type { MatchedRoadPose, RealtimeEgoPose } from '../platform/navigation/contracts/navEgoPose';
import { toCanonicalEdgeId } from '../platform/navigation/map/store/legacyEdgeIdAdapter';
import {
  acquireNavOrientationFeed, readYawRate, getNavOrientationFeedSnapshot,
  _resetNavOrientationFeedForTest,
} from '../platform/navigation/navOrientationFeed';
import { getSubscriberCounts, reset as resetSensorGate }
  from '../platform/sensors/orientationSensorGate';

/* ══════════════════════════════════════════════════════════════════════════
   KAYNAK TARAMA YARDIMCILARI
   ══════════════════════════════════════════════════════════════════════════ */

const SRC = resolve(__dirname, '..');
const readSrc = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const L3_DIRS = ['platform/navigation/horizon'];

function filesIn(dirs: readonly string[]): string[] {
  const out: string[] = [];
  for (const d of dirs) {
    const abs = resolve(SRC, d);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) {
      if (f.endsWith('.ts')) out.push(`${d}/${f}`);
    }
  }
  return out;
}
const l3Files = () => filesIn(L3_DIRS);

/** `src/` ağacındaki tüm `.ts`/`.tsx` dosyaları (test klasörü hariç). */
function walkSrc(rel = ''): string[] {
  const out: string[] = [];
  const abs = resolve(SRC, rel);
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
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

function ego(over: Partial<RealtimeEgoPose> = {}): RealtimeEgoPose {
  return {
    kind: 'REALTIME_EGO',
    tsMonoMs: T0,
    lat: derivedNav<number>(41.0, { source: 'GNSS', confidence: 0.9, observedAtMonoMs: T0, freshnessBudgetMs: 5_000 }),
    lon: derivedNav<number>(29.0, { source: 'GNSS', confidence: 0.9, observedAtMonoMs: T0, freshnessBudgetMs: 5_000 }),
    headingDeg: derivedNav<number>(90, { source: 'GNSS', confidence: 0.8, observedAtMonoMs: T0, freshnessBudgetMs: 5_000 }),
    speedMps: observedNav<number>(20, { source: 'VEHICLE_BUS', confidence: 0.9, observedAtMonoMs: T0, freshnessBudgetMs: 5_000 }),
    mode: 'GNSS',
    horizontalSigmaM: 4,
    ...over,
  };
}

const EDGE = toCanonicalEdgeId(7, 1);

function matched(over: Partial<MatchedRoadPose> = {}): MatchedRoadPose {
  return {
    kind: 'MATCHED_ROAD',
    tsMonoMs: T0,
    matchState: 'MATCHED',
    edgeId: EDGE,
    alongEdgeM: derivedNav<number>(12, { source: 'MAP_MATCH', confidence: 0.8, observedAtMonoMs: T0, freshnessBudgetMs: 5_000 }),
    snappedLat: derivedNav<number>(41.0, { source: 'MAP_MATCH', confidence: 0.8, observedAtMonoMs: T0, freshnessBudgetMs: 5_000 }),
    snappedLon: derivedNav<number>(29.0, { source: 'MAP_MATCH', confidence: 0.8, observedAtMonoMs: T0, freshnessBudgetMs: 5_000 }),
    rawPose: ego(),
    lateralOffsetM: 2,
    ...over,
  };
}

/** ~41.0/29.0 çevresinde doğu yönlü basit rota çizgisi. */
const ROUTE_GEOMETRY: readonly (readonly [number, number])[] = [
  [29.0, 41.0], [29.01, 41.0], [29.02, 41.0], [29.03, 41.0],
];

function routeIntent(over: Partial<RouteIntentSnapshot> = {}): RouteIntentSnapshot {
  return {
    available: true,
    sessionId: 42,
    routeRevision: 3,
    observedAtMonoMs: T0,
    vehicleAlongRemainingM: 3_000,
    totalDistanceM: 5_000,
    maneuvers: [
      { stepIndex: 1, alongRemainingM: 2_800, maneuverType: 'turn', maneuverModifier: 'left' },
      { stepIndex: 2, alongRemainingM: 2_000, maneuverType: 'turn', maneuverModifier: 'right' },
      { stepIndex: 3, alongRemainingM: 100, maneuverType: 'arrive', maneuverModifier: 'straight' },
    ],
    geometry: ROUTE_GEOMETRY,
    onCorridor: true,
    conflictThresholdM: 55,
    ...over,
  };
}

function input(over: Partial<HorizonBuildInput> = {}): HorizonBuildInput {
  return {
    nowMonoMs: T0,
    generation: 1,
    ego: ego(),
    matched: null,
    route: NO_ROUTE_INTENT,
    mapAvailable: null,
    attributes: UNAVAILABLE_HORIZON_ATTRIBUTE_PORTS,
    egoFreshnessBudgetMs: 5_000,
    routeConflictThresholdM: 55,
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   0) C1 — JİRO / YAW ÇEKİRDEĞİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F3.1 · yaw çekirdeği — kanıtsız sapma hızı YAYINLANMAZ', () => {
  let st: YawRateState;
  beforeEach(() => { st = createYawRateState(); });

  const motion = (t: number, wz: number, g = 9.81) => ({
    rotXDps: 0, rotYDps: 0, rotZDps: wz,
    accXMs2: 0, accYMs2: 0, accZMs2: g,
    tsMonoMs: t,
  });

  it('jiro alanı YOKSA örnek reddedilir (başarı sayılmaz)', () => {
    noteMotionSample(st, { ...motion(0, 0), rotXDps: null, rotYDps: null, rotZDps: null });
    expect(st.accepted).toBe(0);
    expect(st.rejectedNoGyro).toBe(1);
    expect(resolveYawRate(st, 10).radPerSec).toBeNull();
  });

  it('monotonik zaman damgası yoksa örnek reddedilir (duvar saati YOK)', () => {
    noteMotionSample(st, { ...motion(0, 10), tsMonoMs: null });
    expect(st.accepted).toBe(0);
    expect(st.rejectedTime).toBe(1);
  });

  it('yerçekimi kapısı — bant dışı ivme düşey ekseni ölçemez, REDDEDİLİR', () => {
    noteMotionSample(st, motion(0, 10, GRAVITY_MIN_MS2 - 1));
    noteMotionSample(st, motion(10, 10, GRAVITY_MAX_MS2 + 1));
    expect(st.accepted).toBe(0);
    expect(st.rejectedGravity).toBe(2);
  });

  it('işaret KANITLANMADAN sapma hızı yayınlanmaz (fail-closed)', () => {
    for (let i = 0; i < 10; i++) noteMotionSample(st, motion(i * 50, 10));
    const v = resolveYawRate(st, 450);
    expect(st.accepted).toBe(10);
    expect(v.radPerSec).toBeNull();
    expect(v.reason).toBe('POLARITY_UNRESOLVED');
    expect(v.polarity).toBe(0);
  });

  it('işaret GNSS yön değişimiyle ÖĞRENİLİR ve kilitlenir', () => {
    /* Referans: 0 → 1000 ms arası +10 °/s jiro = +10° dönüş.
       GNSS aynı aralıkta pusulada +20° görürse (oran 0.5 bandın içinde)
       işaret POZİTİF adayıdır. */
    const feed = (t0: number, headingFrom: number, headingTo: number) => {
      noteHeadingObservation(st, headingFrom, 20, t0);
      for (let t = t0 + 50; t <= t0 + 1000; t += 50) noteMotionSample(st, motion(t, 20));
      return noteHeadingObservation(st, headingTo, 20, t0 + 1000);
    };
    /* +20°/s × 1 s ≈ 0.349 rad jiro; GNSS 20° = 0.349 rad → oran ≈ 1. */
    expect(feed(0, 10, 30)).toBe('AGREE');
    expect(st.polarity).toBe(0);
    expect(feed(2_000, 40, 60)).toBe('LOCKED');
    expect(st.polarity).toBe(1);
    expect(POLARITY_LOCK_COUNT).toBe(2);
  });

  it('kilitten sonra sapma hızı işaretle YAYINLANIR', () => {
    noteHeadingObservation(st, 0, 20, 0);
    for (let t = 50; t <= 1000; t += 50) noteMotionSample(st, motion(t, 20));
    noteHeadingObservation(st, 20, 20, 1000);
    noteHeadingObservation(st, 20, 20, 2000);
    for (let t = 2050; t <= 3000; t += 50) noteMotionSample(st, motion(t, 20));
    noteHeadingObservation(st, 40, 20, 3000);
    expect(st.polarity).toBe(1);

    for (let t = 3050; t <= 3400; t += 50) noteMotionSample(st, motion(t, 20));
    const v = resolveYawRate(st, 3400);
    expect(v.reason).toBe('OK');
    expect(v.radPerSec).toBeCloseTo((20 * Math.PI) / 180, 5);
  });

  it('±π SARMALI — 350° → 10° geçişi +20°dir, −340° DEĞİL', () => {
    /* Sarmasız fark −340° olurdu ve işaret TERS öğrenilirdi. */
    noteHeadingObservation(st, 350, 20, 0);
    for (let t = 50; t <= 1000; t += 50) noteMotionSample(st, motion(t, 20));
    const d = noteHeadingObservation(st, 10, 20, 1000);
    expect(d).toBe('AGREE');
    expect(st.lastCandidate).toBe(1);   // ters öğrenilseydi -1 olurdu
  });

  it('durakta GNSS yönü kanıt SAYILMAZ (yavaşta yön gürültüdür)', () => {
    expect(noteHeadingObservation(st, 10, 0.5, 0)).toBe('NO_EVIDENCE');
    expect(st.headingObservations).toBe(0);
  });

  it('küçük dönüş işaret kanıtı DEĞİLDİR', () => {
    noteHeadingObservation(st, 0, 20, 0);
    for (let t = 50; t <= 1000; t += 50) noteMotionSample(st, motion(t, 1));
    const smallTurnDeg = ((POLARITY_MIN_TURN_RAD * 180) / Math.PI) - 5;
    expect(noteHeadingObservation(st, smallTurnDeg, 20, 1000)).toBe('NO_EVIDENCE');
    expect(st.polarity).toBe(0);
  });

  it('büyüklükler uyuşmuyorsa (oran bandı dışı) KARAR VERİLMEZ', () => {
    noteHeadingObservation(st, 0, 20, 0);
    /* Jiro 1 °/s → 1°; GNSS 40° iddia ediyor → oran 0.025 → kanıt yok. */
    for (let t = 50; t <= 1000; t += 50) noteMotionSample(st, motion(t, 1));
    expect(noteHeadingObservation(st, 40, 20, 1000)).toBe('NO_EVIDENCE');
    expect(st.polarity).toBe(0);
  });

  it('ısrarlı çelişki işaret KİLİDİNİ DÜŞÜRÜR (yanlış yön öğretilmez)', () => {
    /* Önce +1 kilitle. */
    for (let k = 0; k < 2; k++) {
      const t0 = k * 2_000;
      noteHeadingObservation(st, 0, 20, t0);
      for (let t = t0 + 50; t <= t0 + 1000; t += 50) noteMotionSample(st, motion(t, 20));
      noteHeadingObservation(st, 20, 20, t0 + 1000);
    }
    expect(st.polarity).toBe(1);

    /* Sonra ters yönlü kanıt: jiro +, GNSS −. */
    for (let k = 0; k < POLARITY_UNLOCK_COUNT; k++) {
      const t0 = 10_000 + k * 2_000;
      noteHeadingObservation(st, 100, 20, t0);
      for (let t = t0 + 50; t <= t0 + 1000; t += 50) noteMotionSample(st, motion(t, 20));
      noteHeadingObservation(st, 80, 20, t0 + 1000);
    }
    expect(st.polarity).toBe(0);
    expect(resolveYawRate(st, 12_000).radPerSec).toBeNull();
  });

  it('iz penceresi dışındaki örnek BAYATTIR — taze gibi sunulmaz', () => {
    for (let t = 0; t <= 200; t += 50) noteMotionSample(st, motion(t, 20));
    const v = resolveYawRate(st, 200 + YAW_WINDOW_MS + 1);
    expect(v.radPerSec).toBeNull();
    expect(v.reason).toBe('STALE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   1) C2 — CANLI EGO ENTEGRASYONU / ORIENTATION ÖMRÜ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F3.0/C2 · orientation ömrü — dengeli acquire/release', () => {
  beforeEach(() => {
    _resetNavOrientationFeedForTest();
    resetSensorGate();
  });

  it('acquire TEK fiziksel abonelik açar; ikinci acquire İKİNCİSİNİ AÇMAZ', () => {
    const before = getSubscriberCounts().motion;
    const r1 = acquireNavOrientationFeed();
    const afterFirst = getSubscriberCounts().motion;
    const r2 = acquireNavOrientationFeed();
    expect(getSubscriberCounts().motion).toBe(afterFirst);
    expect(afterFirst).toBe(before + 1);
    r1(); r2();
    expect(getSubscriberCounts().motion).toBe(before);
  });

  it('release SONRASI sensör sızıntısı YOK (holders 0, abonelik düştü)', () => {
    const r = acquireNavOrientationFeed();
    expect(getNavOrientationFeedSnapshot().holders).toBe(1);
    r();
    const snap = getNavOrientationFeedSnapshot();
    expect(snap.holders).toBe(0);
    expect(snap.attached).toBe(false);
    expect(getSubscriberCounts().motion).toBe(0);
  });

  it('release IDEMPOTENT — çift çağrı sayacı NEGATİFE düşürmez', () => {
    const r = acquireNavOrientationFeed();
    r(); r(); r();
    expect(getNavOrientationFeedSnapshot().holders).toBe(0);
  });

  it('oturum kapanınca jiro geçmişi TAŞINMAZ (yeni oturum yeni kanıt)', () => {
    const r = acquireNavOrientationFeed();
    window.dispatchEvent(Object.assign(new Event('devicemotion'), {
      rotationRate: { alpha: 10, beta: 0, gamma: 0 },
      accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
    }));
    r();
    expect(getNavOrientationFeedSnapshot().accepted).toBe(0);
    expect(readYawRate(1).radPerSec).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) CEH SÖZLEŞMESİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F3.2 · CEH sözleşmesi', () => {
  it('her ufuk durumunun KANONİK bozulma karşılığı vardır', () => {
    for (const s of CEH_HORIZON_STATES) {
      const d = degradationForHorizonState(s);
      expect(typeof d).toBe('string');
      expect(d.length).toBeGreaterThan(0);
    }
  });

  it('yalnız AVAILABLE/PARTIAL "önümde şu var" iddiasına izin verir', () => {
    const allowed = CEH_HORIZON_STATES.filter(cehStateAllowsAheadClaim);
    expect([...allowed].sort()).toEqual(['HORIZON_AVAILABLE', 'HORIZON_PARTIAL']);
  });

  it('BELİRSİZ kol kesin iddiaya izin VERMEZ', () => {
    expect(cehStateAllowsAheadClaim('AMBIGUOUS_PATH')).toBe(false);
  });

  it('yalnız fiziksel kökenler "araç bu yolda" der', () => {
    const physical = HORIZON_PATH_PROVENANCES.filter(provenanceIsPhysical);
    expect([...physical].sort()).toEqual(['MATCHED_ROAD_TOPOLOGY', 'ROUTE_INTENT_CONFIRMED']);
    expect(provenanceIsPhysical('ROUTE_INTENT')).toBe(false);
  });

  it('ufuk bütçesi hız × zaman-başlığı, tabanı/tavanı korunur', () => {
    expect(horizonBudgetM(null)).toBe(HORIZON_MIN_M);
    expect(horizonBudgetM(0)).toBe(HORIZON_MIN_M);
    expect(horizonBudgetM(1)).toBe(HORIZON_MIN_M);
    expect(horizonBudgetM(10)).toBe(10 * HORIZON_TIME_HEADWAY_S);
    expect(horizonBudgetM(1_000)).toBe(HORIZON_MAX_M);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) UFUK MOTORU
   ══════════════════════════════════════════════════════════════════════════ */

describe('F3.3/F3.9 · ufuk motoru', () => {
  it('ego YOKSA ufuk yok — çapa uydurulmaz', () => {
    const h = buildHorizon(input({ ego: null }));
    expect(h.state).toBe('EGO_UNAVAILABLE');
    expect(h.egoAnchor).toBeNull();
    expect(h.paths).toHaveLength(0);
    expect(h.degradation).toBe('NO_POSITION');
  });

  it('LAST_KNOWN ego ufuk ÇAPASI OLAMAZ', () => {
    const h = buildHorizon(input({ ego: ego({ mode: 'LAST_KNOWN' }) }));
    expect(h.state).toBe('EGO_UNAVAILABLE');
  });

  it('BAYAT ego taze ufuk üretemez', () => {
    const h = buildHorizon(input({ nowMonoMs: asMonotonic((T0 as number) + 6_000) }));
    expect(h.state).toBe('EGO_STALE');
    expect(h.paths).toHaveLength(0);
  });

  it('rota YOK + eşleşme YOK → ufuk kaynağı yok, ama EGO KORUNUR', () => {
    const h = buildHorizon(input({ mapAvailable: false }));
    expect(h.state).toBe('MAP_UNAVAILABLE');
    expect(h.egoAnchor).not.toBeNull();      // degradation ≠ fabrication
    expect(h.paths).toHaveLength(0);
  });

  it('harita VAR ama eşleşme yok → MATCH_UNAVAILABLE ("yol dışısın" DEĞİL)', () => {
    const h = buildHorizon(input({
      mapAvailable: true,
      matched: matched({ matchState: 'UNAVAILABLE', edgeId: null }),
    }));
    expect(h.state).toBe('MATCH_UNAVAILABLE');
  });

  it('harita ÖLÇÜLMEDİ → "yok" denmez, MAP_UNAVAILABLE + NO_SOURCE gerekçesi', () => {
    const h = buildHorizon(input({ mapAvailable: null }));
    expect(h.state).toBe('MAP_UNAVAILABLE');
    expect(h.reason).toBe('NO_SOURCE');
  });

  it('YALNIZ rota niyeti → MPP var ama FİZİKSEL DOĞRULAMA YOK', () => {
    const h = buildHorizon(input({ route: routeIntent() }));
    expect(h.state).toBe('HORIZON_PARTIAL');      // "AVAILABLE" DEĞİL
    expect(h.mppPathId).toBe(MPP_PATH_ID);
    const mpp = mostProbablePath(h)!;
    expect(mpp.provenance).toBe('ROUTE_INTENT');
    expect(mpp.physicallyConfirmed).toBe(false);
    expect(mpp.confidence).toBeLessThanOrEqual(ROUTE_INTENT_CONFIDENCE_CEIL);
    expect(mpp.startEdgeId).toBeNull();
  });

  it('F6 — port ÖLÇÜM üretmezse kol o alanı "ölçüldü" SAYMAZ', () => {
    /* Port bağlı ve `ENFORCEMENT` kapasitesi var, ama bu tik'te ölçüm YOK
       (kesik koridor · paket hazır değil). Kol bunu saklamaz. */
    const h = buildHorizon(input({
      route: routeIntent(),
      matched: matched(),
      attributes: {
        boundDomains: ['ENFORCEMENT'],
        readAhead: () => ({ outcome: 'NOT_MEASURED', objects: [], reason: 'NO_SOURCE' }),
      },
    }));
    const mpp = mostProbablePath(h)!;
    expect(mpp.measuredKinds).toContain('MANEUVER');          // rota niyeti okundu
    expect(mpp.measuredKinds).not.toContain('ENFORCEMENT');   // kaynak bakamadı
  });

  it('F6 — port "baktım, yok" derse (NO_OBJECTS_IN_RANGE) alan ÖLÇÜLDÜ sayılır', () => {
    const h = buildHorizon(input({
      route: routeIntent(),
      matched: matched(),
      attributes: {
        boundDomains: ['ENFORCEMENT'],
        readAhead: () => ({ outcome: 'NO_OBJECTS_IN_RANGE', objects: [], reason: 'COVERAGE_NONE' }),
      },
    }));
    const mpp = mostProbablePath(h)!;
    expect(mpp.measuredKinds).toContain('ENFORCEMENT');
    /* Bağlanmamış alanlar UYDURULMAZ — port yalnız ENFORCEMENT taşıyor. */
    expect(mpp.measuredKinds).not.toContain('SPEED_LIMIT');
    expect(mpp.measuredKinds).not.toContain('CURVE');
  });

  it('F6 — rota YOKKEN manevra alanı ÖLÇÜLMÜŞ sayılmaz (soru sorulmadı)', () => {
    const h = buildHorizon(input({ mapAvailable: true, matched: matched() }));
    const mpp = mostProbablePath(h)!;
    expect(mpp.measuredKinds).not.toContain('MANEUVER');
  });

  it('rota + UYUŞAN fiziksel eşleşme → doğrulanmış MPP', () => {
    const h = buildHorizon(input({ route: routeIntent(), matched: matched() }));
    expect(h.state).toBe('HORIZON_AVAILABLE');
    const mpp = mostProbablePath(h)!;
    expect(mpp.provenance).toBe('ROUTE_INTENT_CONFIRMED');
    expect(mpp.physicallyConfirmed).toBe(true);
    expect(mpp.startEdgeId).toBe(EDGE);
  });

  it('rota ↔ fiziksel yol ÇELİŞKİSİ → belirsizlik, ZORLA MPP YOK', () => {
    /* Eşleşmiş konum rotadan ~1.1 km kuzeyde (paralel yol senaryosu). */
    const far = matched({
      snappedLat: derivedNav<number>(41.01, { source: 'MAP_MATCH', confidence: 0.8, observedAtMonoMs: T0, freshnessBudgetMs: 5_000 }),
    });
    const h = buildHorizon(input({ route: routeIntent(), matched: far }));
    expect(h.state).toBe('AMBIGUOUS_PATH');
    expect(h.ambiguous).toBe(true);
    expect(h.mppPathId).toBeNull();
    expect(h.paths).toHaveLength(2);
    expect(h.paths.map((p) => p.pathId).sort())
      .toEqual([BRANCH_MATCHED_PATH_ID, BRANCH_ROUTE_PATH_ID].sort());
    expect(h.paths.every((p) => p.isMostProbable === false)).toBe(true);
    expect(ambiguityContractHolds(h)).toBe(true);
    expect(mostProbablePath(h)).toBeNull();
  });

  it('çelişki EŞİĞİ yoksa ne doğrulama ne çelişki iddia edilir', () => {
    const h = buildHorizon(input({
      route: routeIntent({ conflictThresholdM: null }),
      matched: matched(),
      routeConflictThresholdM: null,
    }));
    expect(h.state).toBe('HORIZON_PARTIAL');
    expect(mostProbablePath(h)!.physicallyConfirmed).toBe(false);
  });

  it('rota geometrisi yoksa çelişki kontrolü YAPILAMAZ (varsayım üretilmez)', () => {
    const h = buildHorizon(input({
      route: routeIntent({ geometry: null }),
      matched: matched(),
    }));
    expect(h.ambiguous).toBe(false);
    expect(mostProbablePath(h)!.physicallyConfirmed).toBe(false);
  });

  it('ilerleme ölçülemiyorsa rota MESAFE ÜRETMEZ', () => {
    const r = routeIntent({ vehicleAlongRemainingM: null });
    expect(routeIntentCarriesDistance(r)).toBe(false);
    const h = buildHorizon(input({ route: r, mapAvailable: true }));
    expect(h.paths).toHaveLength(0);
  });

  it('manevra mesafeleri yol-boyudur; geride kalan ve bütçe dışı ATILIR', () => {
    const objs = maneuverObjects(routeIntent(), MPP_PATH_ID, 900, T0, 0.5);
    /* vehicleRemaining 3000 → 2800 = 200 m ileride (bütçe içi),
       2000 = 1000 m (bütçe DIŞI), 100 = 2900 m (bütçe DIŞI). */
    expect(objs).toHaveLength(1);
    expect(objs[0].distanceFromEgoM.value).toBe(200);
    expect(objs[0].label.value).toBe('turn:left');
  });

  it('çapası çözülmemiş manevra ATLANIR (uydurma mesafe yok)', () => {
    const r = routeIntent({
      maneuvers: [{ stepIndex: 1, alongRemainingM: null, maneuverType: 'turn', maneuverModifier: 'left' }],
    });
    expect(maneuverObjects(r, MPP_PATH_ID, 5_000, T0, 0.5)).toHaveLength(0);
  });

  it('UNKNOWN ≠ NONE — manevranın sayısal büyüklüğü UNAVAILABLE, 0 DEĞİL', () => {
    const objs = maneuverObjects(routeIntent(), MPP_PATH_ID, 5_000, T0, 0.5);
    expect(objs.length).toBeGreaterThan(0);
    for (const o of objs) {
      expect(o.magnitude.grade).toBe('UNAVAILABLE');
      expect(o.magnitude.value).toBeNull();
    }
  });

  it('öznitelik kaynağı ÖLÇÜLMEDİ ise "ileride yok" DENMEZ', () => {
    const h = buildHorizon(input({ route: routeIntent(), matched: matched() }));
    /* Üretim portu her sorguya NOT_MEASURED der → ölçülmüş yokluk DEĞİL. */
    expect(outcomeIsMeasuredAbsence('NOT_MEASURED')).toBe(false);
    expect(outcomeIsMeasuredAbsence('NO_OBJECTS_IN_RANGE')).toBe(true);
    expect(h.reason).toBe('NO_SOURCE');
  });

  it('öznitelik portu PATLARSA ufuk düşmez (fail-soft)', () => {
    const boom: HorizonAttributePorts = {
      readAhead: () => { throw new Error('port patladı'); },
    };
    const h = buildHorizon(input({ route: routeIntent(), matched: matched(), attributes: boom }));
    expect(isElectronicHorizon(h)).toBe(true);
    expect(h.paths.length).toBeGreaterThan(0);
  });

  it('AYNI GİRDİ = AYNI ÇIKTI (deterministik)', () => {
    const a = buildHorizon(input({ route: routeIntent(), matched: matched() }));
    const b = buildHorizon(input({ route: routeIntent(), matched: matched() }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('bütçe EGO HIZINDAN gelir', () => {
    const h = buildHorizon(input({ ego: ego({
      speedMps: observedNav<number>(30, { source: 'VEHICLE_BUS', confidence: 0.9, observedAtMonoMs: T0, freshnessBudgetMs: 5_000 }),
    }) }));
    expect(h.budgetM).toBe(30 * HORIZON_TIME_HEADWAY_S);
  });

  it('rota yok + eşleşme VAR → serbest sürüş kolu; ileri kapsam ÜRETİLMEZ', () => {
    const h = buildHorizon(input({ matched: matched(), mapAvailable: true }));
    expect(h.paths).toHaveLength(1);
    const p = h.paths[0];
    expect(p.provenance).toBe('MATCHED_ROAD_TOPOLOGY');
    /* Topoloji (ardıl kenar) L1'de YOK → uzunluk iddiası edilemez. */
    expect(p.lengthM.grade).toBe('UNAVAILABLE');
    expect(p.lengthM.value).toBeNull();
    expect(h.state).toBe('INSUFFICIENT_METADATA');
  });

  it('düşük güven MPP eşiğini geçemez → kol taşınır, MPP İLAN EDİLMEZ', () => {
    const weak = ego({
      lat: derivedNav<number>(41, { source: 'DEAD_RECKONING', confidence: MPP_MIN_CONFIDENCE / 2, observedAtMonoMs: T0, freshnessBudgetMs: 5_000 }),
    });
    const h = buildHorizon(input({ ego: weak, route: routeIntent() }));
    expect(h.mppPathId).toBeNull();
    expect(h.paths).toHaveLength(1);
    expect(h.paths[0].isMostProbable).toBe(false);
  });

  it('eşleşmiş konumun rotaya uzaklığı ölçülebilir; eşleşme yoksa `null`', () => {
    expect(matchedDistanceToRouteM(matched(), ROUTE_GEOMETRY)).toBeCloseTo(0, 0);
    expect(matchedDistanceToRouteM(matched({ matchState: 'MATCH_UNCERTAIN' }), ROUTE_GEOMETRY)).toBeNull();
    expect(matchedDistanceToRouteM(matched(), null)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) CEH OTORİTESİ
   ══════════════════════════════════════════════════════════════════════════ */

function fakeEgo(pose: RealtimeEgoPose | null, m: MatchedRoadPose | null = null): EgoAuthority {
  return {
    observe: () => { /* tik sahibi çağırır */ },
    getRealtimeEgoPose: () => pose,
    getMatchedRoadPose: () => m,
    getDiagnostics: () => ({} as never),
    reset: () => { /* no-op */ },
  };
}

function fakeMap(avail: 'AVAILABLE_FRESH' | 'UNAVAILABLE' | null): MapStore {
  return {
    getDatasetStatus: () => (avail === null
      ? unavailableNav('MAP_PACKAGE', 'NO_SOURCE')
      : observedNav({ dataset: 'ROUTING_GRAPH', availability: avail, provenance: 1 }, {
        source: 'MAP_PACKAGE', confidence: 1, observedAtMonoMs: T0, freshnessBudgetMs: null,
      })) as never,
    hasTile: () => unavailableNav<boolean>('MAP_PACKAGE', 'NO_SOURCE'),
    getEdgeMetadata: () => unavailableNav('MAP_PACKAGE', 'NO_SOURCE') as never,
    getSnapshot: () => ({ datasets: [], provenance: 0 }),
  };
}

describe('F3.5 · CEH otoritesi', () => {
  it('monotonik saat YOKSA hiçbir ufuk yayınlanmaz (fail-closed)', () => {
    const a = createCehAuthority({
      ego: fakeEgo(ego()), map: fakeMap('AVAILABLE_FRESH'), clock: () => null,
    });
    a.observe();
    expect(a.getHorizon()).toBeNull();
    expect(a.getDiagnostics().monotonicClock).toBe(false);
  });

  it('generation her yayında MONOTONİK artar (eski ufuk yeni sanılamaz)', () => {
    const a = createCehAuthority({
      ego: fakeEgo(ego()), map: fakeMap('AVAILABLE_FRESH'), clock: () => T0,
    });
    a.observe();
    const g1 = a.getHorizon()!.generation;
    a.observe();
    const g2 = a.getHorizon()!.generation;
    expect(g2).toBeGreaterThan(g1);
  });

  it('rota niyeti İTİLİR ve bir sonraki ufuğa girer', () => {
    const a = createCehAuthority({
      ego: fakeEgo(ego()), map: fakeMap('AVAILABLE_FRESH'), clock: () => T0,
    });
    a.observe();
    expect(a.getHorizon()!.paths).toHaveLength(0);
    a.noteRouteIntent(routeIntent());
    a.observe();
    expect(a.getHorizon()!.paths).toHaveLength(1);
    expect(a.getDiagnostics().routeIntentAvailable).toBe(true);
    expect(a.getDiagnostics().routeIntentPushes).toBe(1);
  });

  it('bozuk niyet itilirse rota YOK sayılır (yarım niyetle mesafe üretilmez)', () => {
    const a = createCehAuthority({
      ego: fakeEgo(ego()), map: fakeMap('AVAILABLE_FRESH'), clock: () => T0,
    });
    a.noteRouteIntent(null as never);
    a.observe();
    expect(a.getHorizon()!.paths).toHaveLength(0);
  });

  it('harita ÖLÇÜLMEDİ hükmü teşhiste `null` taşır ("yok" DEĞİL)', () => {
    const a = createCehAuthority({
      ego: fakeEgo(ego()), map: fakeMap(null), clock: () => T0,
    });
    a.observe();
    expect(a.getDiagnostics().mapAvailable).toBeNull();
  });

  it('reset sonrası ufuk ve sayaçlar sıfırlanır', () => {
    const a = createCehAuthority({
      ego: fakeEgo(ego()), map: fakeMap('AVAILABLE_FRESH'), clock: () => T0,
    });
    a.observe();
    expect(a.getHorizon()).not.toBeNull();
    a.reset();
    expect(a.getHorizon()).toBeNull();
    expect(a.getDiagnostics().observations).toBe(0);
  });

  it('ego cephesi PATLARSA ufuk üretimi düşmez (fail-soft)', () => {
    const broken: EgoAuthority = {
      observe: () => { /* no-op */ },
      getRealtimeEgoPose: () => { throw new Error('ego patladı'); },
      getMatchedRoadPose: () => null,
      getDiagnostics: () => ({} as never),
      reset: () => { /* no-op */ },
    };
    const a = createCehAuthority({ ego: broken, map: fakeMap('AVAILABLE_FRESH'), clock: () => T0 });
    a.observe();
    expect(a.getHorizon()!.state).toBe('EGO_UNAVAILABLE');
    expect(a.getDiagnostics().errorCount).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) MİMARİ KİLİTLER
   ══════════════════════════════════════════════════════════════════════════ */

describe('F3 · mimari kilitler', () => {
  it('K1 — L3 ham HARİTA kaynaklarını import EDEMEZ (yalnız L1 MapStore)', () => {
    const forbidden = [
      'routing-graph', 'NavigationCompute.worker', 'mapSourceManager', 'mapSourceStore',
      'mapTileProbe', 'offlineTileDownloader', 'overpass', 'maplibre-gl',
      'offlineRoutingService', 'CacheLRUManager', 'serviceWorkerManager',
      'offlinePoiService',
    ];
    for (const f of l3Files()) {
      const src = strip(readSrc(f));
      for (const bad of forbidden) {
        expect(src, `${f}: yasak harita kaynağı "${bad}"`).not.toContain(bad);
      }
    }
  });

  it('K2 — L3 ham GPS/native sağlayıcı SAHİPLENEMEZ', () => {
    const forbidden = [
      'navigator.geolocation', 'watchPosition', 'getCurrentPosition',
      '@capacitor', 'Capacitor', 'deviceorientation', 'devicemotion',
      'addEventListener', 'subscribeMotion', 'subscribeOrientation',
      'startGPSTracking', 'onGPSLocation', 'gpsService',
    ];
    for (const f of l3Files()) {
      const src = strip(readSrc(f));
      for (const bad of forbidden) {
        expect(src, `${f}: ham sağlayıcı "${bad}"`).not.toContain(bad);
      }
    }
  });

  it('K3 — CEH timer/scheduler SAHİBİ DEĞİLDİR', () => {
    for (const f of l3Files()) {
      const src = strip(readSrc(f));
      for (const bad of ['setInterval(', 'setTimeout(', 'requestAnimationFrame(', 'scheduleTask', 'new Worker']) {
        expect(src, `${f}: ${bad}`).not.toContain(bad);
      }
    }
  });

  it('K4 — CEH React/UI bağımlılığı İÇERMEZ', () => {
    for (const f of l3Files()) {
      expect(readSrc(f), `${f}: React`).not.toMatch(/from ['"]react['"]/);
      expect(strip(readSrc(f)), `${f}: zustand`).not.toContain('zustand');
    }
  });

  it('K5 — CEH duvar saatiyle tazelik hesaplayamaz', () => {
    for (const f of l3Files()) {
      const src = strip(readSrc(f));
      expect(src, `${f}: Date.now`).not.toContain('Date.now(');
      expect(src, `${f}: new Date`).not.toContain('new Date(');
    }
  });

  it('K6 — kanonik CEH cephesi TEK tanımlıdır', () => {
    const decls = [
      'export function createCehAuthority',
      'export interface CehAuthority',
      'export function getCehAuthority',
      'export function buildHorizon',
      'export interface RouteIntentSnapshot',
      'export interface HorizonAttributePorts',
    ];
    for (const decl of decls) {
      const hits = walkSrc().filter((f) => readSrc(f).includes(decl));
      expect(hits.length, `${decl} → ${hits.join(', ')}`).toBe(1);
    }
  });

  it('K7 — sözleşme tipleri KOPYALANAMAZ (src genelinde tek tanım)', () => {
    const decls = [
      'export interface ElectronicHorizon',
      'export interface HorizonPath ',
      'export interface HorizonObject ',
      'export type CehHorizonState',
      'export interface RealtimeEgoPose',
      'export interface MatchedRoadPose',
      'export interface Evidenced<T>',
      'export type EvidenceGrade',
      'export interface EdgeId {',
    ];
    for (const decl of decls) {
      const hits = walkSrc().filter((f) => readSrc(f).includes(decl));
      expect(hits.length, `${decl} → ${hits.join(', ')}`).toBe(1);
    }
  });

  it('K8 — L3 L4 modüllerini import EDEMEZ (bağımlılık yasası yönlüdür)', () => {
    const forbidden = ['routingService', 'navigationService', 'navigationSessionRuntime', 'guardian'];
    for (const f of l3Files()) {
      const imports = [...readSrc(f).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const imp of imports) {
        for (const bad of forbidden) {
          expect(imp.includes(bad), `${f}: L4 importu ${imp}`).toBe(false);
        }
      }
    }
  });

  it('K9 — navigasyon ağacında İKİNCİ GPS aboneliği YOK', () => {
    const navFiles = walkSrc().filter((f) => f.startsWith('platform/navigation/'));
    const subs = navFiles.filter((f) => strip(readSrc(f)).includes('onGPSLocation('));
    expect(subs).toEqual(['platform/navigation/navigationSessionRuntime.ts']);
  });

  it('K10 — orientation ömrü TEK sahiplikte (navigasyon ağacında tek abone)', () => {
    const navFiles = walkSrc().filter((f) => f.startsWith('platform/navigation/'));
    const subs = navFiles.filter((f) => strip(readSrc(f)).includes('subscribeMotion('));
    expect(subs).toEqual(['platform/navigation/navOrientationFeed.ts']);
  });

  it('K11 — oturum kapanınca orientation BIRAKILIR (kaynak kanıtı)', () => {
    const rt = strip(readSrc('platform/navigation/navigationSessionRuntime.ts'));
    expect(rt).toContain('acquireEgoHorizonSession()');
    expect(rt).toContain('releaseEgoHorizonSession()');
    const bridge = strip(readSrc('platform/navigation/navEgoHorizonBridge.ts'));
    expect(bridge).toContain('acquireNavOrientationFeed');
  });

  it('K12 — mevcut ROTA-GÖRELİ eşleştirici semantiği KORUNDU', () => {
    const mm = readSrc('platform/navigation/core/mapMatchModel.ts');
    /* F2 K12 ile aynı kilit: bu dosya hâlâ rota-göreli ilerlemeyi yanıtlar ve
       yol-ağı eşleştirmesine DÖNÜŞTÜRÜLMEDİ. */
    expect(mm).toContain('export interface MapMatchFix');
    expect(mm).toContain("'OFF_NETWORK'");
    expect(strip(mm)).not.toContain('EgoAuthority');
    expect(strip(mm)).not.toContain('ElectronicHorizon');
  });

  it('K13 — CEH tik sahibi DEĞİLDİR: gözlem yalnız köprüden gelir', () => {
    const bridge = strip(readSrc('platform/navigation/navEgoHorizonBridge.ts'));
    for (const bad of ['setInterval(', 'setTimeout(', 'onGPSLocation(', 'requestAnimationFrame(']) {
      expect(bridge, `köprü ${bad} sahiplenemez`).not.toContain(bad);
    }
    expect(bridge).toContain('tickEgoHorizon');
  });

  it('K14 — YENİ ham "ileride" sağlayıcısı doğmadı (enforcement tek kaynak)', () => {
    /* ÖLÇÜLMÜŞ taban (2026-09-03). Yeni bir tüketici eklenirse bu kilit düşer
       ve o kod CEH portundan sormaya zorlanır (F3.5).
       F6 GÜNCELLEMESİ (2026-09-03): `enforcementHorizonPort.ts` BİLİNÇLİ
       eklendi — bu, F3 yorumunun beklediği "port bir gün gerçekten
       bağlandığında" tüketicisidir; `horizon/**` DIŞINDA bir bileşim kökü
       dosyasıdır (K1/K14'ün asıl korumak istediği "L4+ kod ham sağlayıcıdan
       sorar" ihlali DEĞİL — bkz. `navV3CorridorEnforcementF6.test.ts`). */
    const allow = new Set([
      'platform/navigation/enforcement/enforcementPointsSource.ts',
      'platform/navigation/guardian/providers/concrete/enforcementMapSource.ts',
      'platform/navigation/guardian/runtime/guardianRuntime.ts',
      'platform/devtools/enforcementPointsModel.ts',
      'platform/devtools/enforcementPointsSources.ts',
      'components/devtools/screens/EnforcementPointsScreen.tsx',
      'platform/navigation/enforcementHorizonPort.ts',
    ]);
    const users = walkSrc().filter((f) => readSrc(f).includes('enforcementPointsSource'));
    for (const u of users) {
      expect(allow.has(u), `yeni ham ahead-provider tüketicisi: ${u}`).toBe(true);
    }
  });

  it('K15 — ÜRETİM öznitelik portu bugün dürüstçe ölçülmemiştir', () => {
    const r = productionHorizonAttributePorts.readAhead({
      pathId: MPP_PATH_ID, provenance: 'ROUTE_INTENT', startEdgeId: null,
      budgetM: 500, nowMonoMs: T0 as MonotonicMs,
    });
    expect(r.outcome).toBe('NOT_MEASURED');
    expect(r.objects).toHaveLength(0);
  });

  it('K16 — AKTİF ROTA fiziksel localization truth SAYILAMAZ', () => {
    const h = buildHorizon(input({ route: routeIntent({ onCorridor: true }) }));
    const mpp = mostProbablePath(h)!;
    /* Koridorda olmak fiziksel doğrulama DEĞİLDİR. */
    expect(mpp.physicallyConfirmed).toBe(false);
    expect(provenanceIsPhysical(mpp.provenance)).toBe(false);
    expect(cehStateAllowsAheadClaim(h.state as CehHorizonState)).toBe(true);
    expect(h.state).not.toBe('HORIZON_AVAILABLE');
  });
});
