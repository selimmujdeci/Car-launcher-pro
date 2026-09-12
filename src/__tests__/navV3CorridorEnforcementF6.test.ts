/**
 * navV3CorridorEnforcementF6.test.ts — NAV v3 · F6 · SINIRLI KORİDOR +
 * KENAR-TABANLI DENETİM NOKTASI + CEH ÖZNİTELİK BAĞLAMA KİLİTLERİ.
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F6.
 *
 * Kapsam:
 *  1) `boundedCorridor.expandBoundedCorridor` — SAF gezinme (bütçe/kenar/
 *     düğüm/derinlik tavanları · döngü koruması · tek yön · determinizm)
 *  2) `enforcementEdgeIndex.matchEnforcementPointToEdge` — SAF eşleştirici
 *     (5 hüküm · belirsizlik marjı · yön uygulanabilirliği)
 *  3) `mapStore` F6 cephesi — `expandCorridor`/`queryEdgesNear` fail-closed
 *     kapıları + `RoadCorridorOutcome` (L1 kendi vocabulary'si)
 *  4) `enforcementHorizonPort` — UÇTAN UCA (gerçek tekiller: `getMapStore()` ·
 *     `enforcementPointsSource` · sentetik graf + paket)
 *  5) `cehAuthority.bindAttributePorts` — SONRADAN bağlama, canlı `boundDomains`
 *  6) `cehShadowRuntime` — kapı şartı DÖRDÜ de ister, alan bazlı ölçüm TEKİ yeter
 *  7) Mimari kilitler (F6 görev maddesi 10 — 18 ihlal sınıfı)
 *
 * SAHA: bu testin yeşili F6'yı "tamam" YAPMAZ — gerçek araç ölçümü kütükte
 * ayrı maddeler olarak kalır (#1232–#1251 + F6 maddeleri).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseRoutingGraph, RTG2_MAGIC, RTG_NODE_STRIDE, RTG2_EDGE_STRIDE,
  type RoutingGraphView,
} from '../platform/navigation/map/graph/rtg2Reader';
import { buildGraphAdjacency, type GraphAdjacency } from '../platform/navigation/map/graph/graphAdjacency';
import {
  expandBoundedCorridor, corridorLimits, corridorIsScanComplete,
  CORRIDOR_HARD_MAX_BUDGET_M, CORRIDOR_MAX_EDGES, CORRIDOR_MAX_NODE_EXPANSIONS,
  CORRIDOR_MAX_DEPTH,
  type CorridorLimits, type RawCorridor,
} from '../platform/navigation/map/graph/boundedCorridor';
import {
  matchEnforcementPointToEdge, foldEnforcementMatch, EMPTY_ENFORCEMENT_MATCH_COUNTERS,
  matchIsMeasuredAbsence, ENFORCEMENT_EDGE_MAX_PERP_M, ENFORCEMENT_EDGE_AMBIGUITY_MARGIN_M,
} from '../platform/navigation/enforcement/enforcementEdgeIndex';
import type { EnforcementPoint } from '../platform/navigation/enforcement/enforcementPointsPackage';
import type { NearbyEdge } from '../platform/navigation/map/store/mapStore';
import {
  createMapStore, UNAVAILABLE_MAP_DATA_PORTS, UNMEASURED_DATASET,
  type MapDataPorts,
} from '../platform/navigation/map/store/mapStore';
import { productionMapDataPorts } from '../platform/navigation/map/store/mapStoreSources';
import { _resetMapStoreForTest } from '../platform/navigation/map/store';
import {
  _resetGraphResidencyForTest, _setRoutingGraphViewForTest,
} from '../platform/navigation/map/graph/graphResidencyRuntime';
import { _resetOfflineRoutingStatusForTest, recordOfflineGraphOutcome }
  from '../platform/navigation/offlineRoutingStatus';
import { makeEdgeId } from '../platform/navigation/contracts/navEdgeId';
import { toCanonicalEdgeId } from '../platform/navigation/map/store/legacyEdgeIdAdapter';
import { asMonotonic } from '../platform/navigation/contracts/navMonotonicTime';
import {
  createEnforcementHorizonAttributePorts, getEnforcementHorizonPortSnapshot,
  _resetEnforcementHorizonPortForTest,
} from '../platform/navigation/enforcementHorizonPort';
import {
  ensureEnforcementPointsLoaded, _resetEnforcementSourceForTest,
} from '../platform/navigation/enforcement/enforcementPointsSource';
import { ENFORCEMENT_SCHEMA_VERSION } from '../platform/navigation/enforcement/enforcementPointsPackage';
import {
  createCehAuthority, getCehAuthority, _resetCehAuthorityForTest,
} from '../platform/navigation/horizon/cehAuthority';
import { UNAVAILABLE_HORIZON_ATTRIBUTE_PORTS } from '../platform/navigation/horizon/horizonAttributePorts';
import { createEgoAuthority } from '../platform/navigation/ego/egoAuthority';
import {
  cehAttributePortsBound, resetCehShadow, _resetCehShadowForTest,
} from '../platform/navigation/shadow/cehShadowRuntime';

/* ══════════════════════════════════════════════════════════════════════════
   SENTETİK GRAF — küçük, elle izlenebilir topoloji
   ══════════════════════════════════════════════════════════════════════════
   0 ──e0(100m)──▶ 1 ──e1(100m)──▶ 2 ──e2(100m, TEK YÖN)──▶ 4
                   │                                        │
                   └──e3(100m)──▶ 3                    e4(100m, TEK YÖN)
                                                              │
                                                              ▼
                                                              1  (döngü: 1→2→4→1)
   Düğüm 1 İKİ dala ayrılır (e1 → 2, e3 → 3) — determinizm/branch testi.
   e2/e4 TEK YÖNLÜ — döngü koruması + yasak yön testi.
   ══════════════════════════════════════════════════════════════════════════ */

interface SynthEdge { from: number; to: number; costM: number; oneway: boolean; roadClass: number; }

function buildSynthBuffer(
  nodes: readonly (readonly [number, number])[],
  edges: readonly SynthEdge[],
): ArrayBuffer {
  const headerBytes = 8;
  const stride = RTG2_EDGE_STRIDE;
  const size = headerBytes + nodes.length * RTG_NODE_STRIDE + 4 + edges.length * stride;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  let off = 0;
  dv.setUint32(off, RTG2_MAGIC, true); off += 4;
  dv.setUint32(off, nodes.length, true); off += 4;
  for (const [lat, lon] of nodes) {
    dv.setFloat32(off, lat, true);
    dv.setFloat32(off + 4, lon, true);
    off += RTG_NODE_STRIDE;
  }
  dv.setUint32(off, edges.length, true); off += 4;
  for (const e of edges) {
    dv.setUint32(off, e.from, true);
    dv.setUint32(off + 4, e.to, true);
    dv.setUint32(off + 8, e.costM, true);
    dv.setUint8(off + 12, (e.oneway ? 1 : 0) | ((e.roadClass & 0x07) << 1));
    off += stride;
  }
  return buf;
}

/* Koordinatlar 41.000x/29.000x civarında; ~0.00090 lon ≈ 75 m bu enlemde
   (mevcut F4 testinin 0.0100 lon ≈ 850 m oranıyla TUTARLI ölçek). */
const NODES: readonly (readonly [number, number])[] = [
  [41.00000, 29.00000], // 0
  [41.00000, 29.00090], // 1
  [41.00000, 29.00180], // 2
  [41.00090, 29.00090], // 3 (1'den kuzeye dal)
  [41.00000, 29.00270], // 4
];
const EDGES: readonly SynthEdge[] = [
  { from: 0, to: 1, costM: 100, oneway: false, roadClass: 3 }, // e0
  { from: 1, to: 2, costM: 100, oneway: false, roadClass: 3 }, // e1
  { from: 1, to: 3, costM: 100, oneway: false, roadClass: 4 }, // e2
  { from: 2, to: 4, costM: 100, oneway: true,  roadClass: 3 }, // e3 (TEK YÖN)
  { from: 4, to: 1, costM: 100, oneway: true,  roadClass: 3 }, // e4 (TEK YÖN — döngü)
];

function synthView(): RoutingGraphView {
  const r = parseRoutingGraph(buildSynthBuffer(NODES, EDGES));
  if (r.view === null) throw new Error(`sentetik graf ayrıştırılamadı: ${r.detail}`);
  return r.view;
}
function synthAdj(view: RoutingGraphView): GraphAdjacency {
  return buildGraphAdjacency(view);
}

const T0 = asMonotonic(1_000_000);

/* ══════════════════════════════════════════════════════════════════════════
   1) `boundedCorridor.expandBoundedCorridor` — SAF gezinme
   ══════════════════════════════════════════════════════════════════════════ */

describe('F6.1 · boundedCorridor — sınırlı gezinme', () => {
  let view: RoutingGraphView;
  let adj: GraphAdjacency;
  beforeEach(() => { view = synthView(); adj = synthAdj(view); });

  it('e0 başından tam bütçeyle: dallanma korunur, İKİ kol da taşınır', () => {
    /* 500 m: grafın en uzak ucuna (e0→e1→e3→e4, kümülatif 400 m) TAM ULAŞIR
       — hiçbir tavan kesmez, `COMPLETE` beklenir. */
    const r = expandBoundedCorridor(view, adj, 0, 0, 0, corridorLimits(500));
    expect(r.outcome).toBe('COMPLETE');
    expect(r.truncated).toBe(false);
    const ords = r.edges.map((e) => e.ordinal);
    expect(ords).toContain(1); // e1 (1→2)
    expect(ords).toContain(2); // e2 (1→3)
    expect(r.branchCount).toBeGreaterThanOrEqual(1);
  });

  it('BÜTÇE dolunca BUDGET_EXHAUSTED — kesme SAYILMAZ (`truncated=false`)', () => {
    const r = expandBoundedCorridor(view, adj, 0, 0, 0, corridorLimits(50));
    expect(r.outcome).toBe('BUDGET_EXHAUSTED');
    expect(r.truncated).toBe(false);
    expect(corridorIsScanComplete(r.outcome)).toBe(true);
    /* Yalnız başlangıç kenarı — 50 m bütçe onun bitişine (100 m) ULAŞMAZ. */
    expect(r.edges.length).toBe(1);
  });

  it('KENAR tavanı dolunca EDGE_LIMIT — bu bir KESMEDİR (`truncated=true`)', () => {
    const tight: CorridorLimits = { ...corridorLimits(1000), maxEdges: 2 };
    const r = expandBoundedCorridor(view, adj, 0, 0, 0, tight);
    expect(r.outcome).toBe('EDGE_LIMIT');
    expect(r.truncated).toBe(true);
    expect(corridorIsScanComplete(r.outcome)).toBe(false);
    expect(r.edges.length).toBe(2);
  });

  it('DÜĞÜM genişletme tavanı dolunca NODE_LIMIT', () => {
    const tight: CorridorLimits = { ...corridorLimits(1000), maxNodeExpansions: 1 };
    const r = expandBoundedCorridor(view, adj, 0, 0, 0, tight);
    expect(r.outcome).toBe('NODE_LIMIT');
    expect(r.truncated).toBe(true);
  });

  it('DERİNLİK tavanı dolunca DEPTH_LIMIT', () => {
    const tight: CorridorLimits = { ...corridorLimits(1000), maxDepth: 1 };
    const r = expandBoundedCorridor(view, adj, 0, 0, 0, tight);
    expect(r.outcome).toBe('DEPTH_LIMIT');
    expect(r.truncated).toBe(true);
    /* Derinlik 1 → başlangıcın komşuları taşınır, onların ÖTESİ YOK. */
    for (const e of r.edges) expect(e.depth).toBeLessThanOrEqual(1);
  });

  it('DÖNGÜ (1→2→4→1) sonsuz genişlemeye YOL AÇMAZ ve sahte U-turn üretmez', () => {
    const r = expandBoundedCorridor(view, adj, 0, 0, 0, corridorLimits(1000));
    expect(corridorIsScanComplete(r.outcome)).toBe(true);
    /* e0 (0→1) aynı yönde İKİNCİ KEZ görünmez (döngü koruması). */
    const e0Count = r.edges.filter((e) => e.ordinal === 0 && e.dir === 0).length;
    expect(e0Count).toBe(1);
  });

  it('TEK YÖNLÜ kenarın TERS kolundan başlamak INVALID_START üretir', () => {
    /* e3 (2→4) tek yönlü — ters kolu (dir=1) yoktur. */
    const r = expandBoundedCorridor(view, adj, 3, 1, 0, corridorLimits(200));
    expect(r.outcome).toBe('INVALID_START');
    expect(r.edges.length).toBe(0);
  });

  it('Aralık dışı başlangıç ordinal → INVALID_START (uydurma yok)', () => {
    const r = expandBoundedCorridor(view, adj, 999, 0, 0, corridorLimits(200));
    expect(r.outcome).toBe('INVALID_START');
  });

  it('graf/komşuluk `null` → NO_TOPOLOGY (kuş uçuşuna sessiz düşüş YOK)', () => {
    expect(expandBoundedCorridor(null, adj, 0, 0, 0, corridorLimits(200)).outcome)
      .toBe('NO_TOPOLOGY');
    expect(expandBoundedCorridor(view, null, 0, 0, 0, corridorLimits(200)).outcome)
      .toBe('NO_TOPOLOGY');
  });

  it('DETERMİNİSTİK: eşit-mesafeli iki dal HER ZAMAN aynı sırada döner', () => {
    const r1 = expandBoundedCorridor(view, adj, 0, 0, 0, corridorLimits(1000));
    const r2 = expandBoundedCorridor(view, adj, 0, 0, 0, corridorLimits(1000));
    expect(r1.edges.map((e) => `${e.ordinal}:${e.dir}`))
      .toEqual(r2.edges.map((e) => `${e.ordinal}:${e.dir}`));
    /* e1 (1→2, ordinal 1) e2'den (1→3, ordinal 2) ÖNCE gelir (ordinal tie-break). */
    const idx1 = r1.edges.findIndex((e) => e.ordinal === 1);
    const idx2 = r1.edges.findIndex((e) => e.ordinal === 2);
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx1).toBeLessThan(idx2);
  });

  it('bütçe `CORRIDOR_HARD_MAX_BUDGET_M`i AŞAMAZ (güvenlik tavanı)', () => {
    const l = corridorLimits(CORRIDOR_HARD_MAX_BUDGET_M * 10);
    expect(l.budgetM).toBe(CORRIDOR_HARD_MAX_BUDGET_M);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) `enforcementEdgeIndex.matchEnforcementPointToEdge` — SAF eşleştirici
   ══════════════════════════════════════════════════════════════════════════ */

function point(over: Partial<EnforcementPoint> = {}): EnforcementPoint {
  return {
    id: 'p-0', lat: 41.0, lng: 29.0, type: 'AVERAGE_SPEED', role: null,
    speedLimitKph: null, directionHint: null, label: 'test', ...over,
  };
}
function nb(over: Partial<NearbyEdge> = {}): NearbyEdge {
  return {
    edgeId: makeEdgeId(0, 1, 0), perpDistM: 5, snappedLat: 41.0, snappedLon: 29.0,
    alongEdgeM: 10, bearingDeg: 90, metadata: null, ...over,
  };
}

describe('F6.2 · enforcementEdgeIndex — nokta ↔ kenar eşleştirici', () => {
  it('`nearby === null` → NOT_MEASURED (ölçülmedi ≠ yok)', () => {
    const m = matchEnforcementPointToEdge(point(), null);
    expect(m.outcome).toBe('NOT_MEASURED');
    expect(matchIsMeasuredAbsence(m.outcome)).toBe(false);
  });

  it('`nearby === []` → OUTSIDE_COVERAGE — bu bir ÖLÇÜLMÜŞ YOKLUKTUR', () => {
    const m = matchEnforcementPointToEdge(point(), []);
    expect(m.outcome).toBe('OUTSIDE_COVERAGE');
    expect(matchIsMeasuredAbsence(m.outcome)).toBe(true);
  });

  it('eşik dışı tek aday → NO_EDGE_MATCH (yol var, yeterince yakın değil)', () => {
    const m = matchEnforcementPointToEdge(point(), [nb({ perpDistM: ENFORCEMENT_EDGE_MAX_PERP_M + 5 })]);
    expect(m.outcome).toBe('NO_EDGE_MATCH');
    expect(matchIsMeasuredAbsence(m.outcome)).toBe(false);
  });

  it('TEK açık aday → MATCHED_TO_EDGE, ONEWAY_IMPLIED (geri kol yok)', () => {
    const forward = nb({ edgeId: makeEdgeId(0, 1, 0), perpDistM: 3, alongEdgeM: 40 });
    const m = matchEnforcementPointToEdge(point(), [forward]);
    expect(m.outcome).toBe('MATCHED_TO_EDGE');
    expect(m.forward?.alongEdgeM).toBe(40);
    expect(m.backward).toBeNull();
    expect(m.directionApplicability).toBe('ONEWAY_IMPLIED');
    expect(m.perpDistM).toBe(3);
  });

  it('ÇİFT yönlü kenarın iki kolu birden → MATCHED_TO_EDGE, UNKNOWN_DIRECTION', () => {
    const fwd = nb({ edgeId: makeEdgeId(0, 1, 0), perpDistM: 4, alongEdgeM: 20 });
    const bwd = nb({ edgeId: makeEdgeId(0, 1, 1), perpDistM: 4, alongEdgeM: 80 });
    const m = matchEnforcementPointToEdge(point(), [fwd, bwd]);
    expect(m.outcome).toBe('MATCHED_TO_EDGE');
    expect(m.forward?.alongEdgeM).toBe(20);
    expect(m.backward?.alongEdgeM).toBe(80);
    expect(m.directionApplicability).toBe('UNKNOWN_DIRECTION');
  });

  it('İKİ AYRI yol MARJ İÇİNDE yakınsa → AMBIGUOUS_EDGE (yanlış carriageway koruması)', () => {
    const near = nb({ edgeId: makeEdgeId(0, 1, 0), perpDistM: 5 });
    const rival = nb({
      edgeId: makeEdgeId(0, 2, 0), perpDistM: 5 + ENFORCEMENT_EDGE_AMBIGUITY_MARGIN_M - 1,
    });
    const m = matchEnforcementPointToEdge(point(), [near, rival]);
    expect(m.outcome).toBe('AMBIGUOUS_EDGE');
    expect(m.forward).toBeNull();
    expect(m.backward).toBeNull();
    expect(m.distinctRoadCount).toBe(2);
  });

  it('İKİ AYRI yol marj DIŞINDA ayrışıyorsa → en yakına MATCHED_TO_EDGE', () => {
    const near = nb({ edgeId: makeEdgeId(0, 1, 0), perpDistM: 3 });
    const far = nb({
      edgeId: makeEdgeId(0, 2, 0), perpDistM: 3 + ENFORCEMENT_EDGE_AMBIGUITY_MARGIN_M + 5,
    });
    const m = matchEnforcementPointToEdge(point(), [near, far]);
    expect(m.outcome).toBe('MATCHED_TO_EDGE');
    expect(m.perpDistM).toBe(3);
  });

  it('aynı kenarın İKİ kolu birbirini rakip SAYMAZ (yapay belirsizlik üretmez)', () => {
    const fwd = nb({ edgeId: makeEdgeId(0, 1, 0), perpDistM: 5, alongEdgeM: 10 });
    const bwd = nb({ edgeId: makeEdgeId(0, 1, 1), perpDistM: 5.5, alongEdgeM: 90 });
    const m = matchEnforcementPointToEdge(point(), [fwd, bwd]);
    expect(m.outcome).toBe('MATCHED_TO_EDGE');
  });

  it('`foldEnforcementMatch` sayaçları DOĞRU biriktirir', () => {
    let c = EMPTY_ENFORCEMENT_MATCH_COUNTERS;
    c = foldEnforcementMatch(c, matchEnforcementPointToEdge(point(), null));
    c = foldEnforcementMatch(c, matchEnforcementPointToEdge(point(), []));
    c = foldEnforcementMatch(c, matchEnforcementPointToEdge(point(), [nb({ perpDistM: 2 })]));
    expect(c.notMeasured).toBe(1);
    expect(c.outsideCoverage).toBe(1);
    expect(c.matchedToEdge).toBe(1);
    expect(c.onewayImplied).toBe(1);
    expect(c.lastOutcome).toBe('MATCHED_TO_EDGE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) `mapStore` F6 cephesi — fail-closed kapılar
   ══════════════════════════════════════════════════════════════════════════ */

function graphAvailablePorts(over: Partial<MapDataPorts> = {}): MapDataPorts {
  return {
    ...productionMapDataPorts,
    readDataset: (d) => (d === 'ROUTING_GRAPH'
      ? {
        available: true, invalid: false, provenance: 1, reason: 'LIVE_SOURCE' as const,
        observedAtMonoMs: T0, freshnessBudgetMs: null,
      }
      : UNMEASURED_DATASET),
    ...over,
  };
}

describe('F6.3 · mapStore — expandCorridor/queryEdgesNear fail-closed kapıları', () => {
  it('port `UNAVAILABLE_MAP_DATA_PORTS` iken expandCorridor UNAVAILABLE döner', () => {
    const store = createMapStore(UNAVAILABLE_MAP_DATA_PORTS);
    const ev = store.expandCorridor({ edgeId: makeEdgeId(0, 1, 0), alongEdgeM: 0 }, 200, T0);
    expect(ev.grade).toBe('UNAVAILABLE');
    expect(ev.value).toBeNull();
  });

  it('graf hükmü yoksa (`readDataset` ölçülmedi) queryEdgesNear UNAVAILABLE döner', () => {
    const store = createMapStore({
      ...productionMapDataPorts,
      readDataset: () => UNMEASURED_DATASET,
    });
    const ev = store.queryEdgesNear(41, 29, 50, T0);
    expect(ev.grade).toBe('UNAVAILABLE');
  });

  it('geçersiz bütçe (`<=0`) BELOW_QUALITY_GATE ile reddedilir', () => {
    const store = createMapStore(graphAvailablePorts());
    const ev = store.expandCorridor({ edgeId: makeEdgeId(0, 1, 0), alongEdgeM: 0 }, -5, T0);
    expect(ev.value).toBeNull();
    expect(ev.reason).toBe('BELOW_QUALITY_GATE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) `enforcementHorizonPort` — UÇTAN UCA (gerçek tekiller)
   ══════════════════════════════════════════════════════════════════════════ */

function rawPoint(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lat: 41.0000, lng: 29.00045, type: 'AVERAGE_SPEED', role: null,
    speedLimitKph: null, directionHint: null, label: 'F6 test', ...over,
  };
}
function rawPackage(points: Record<string, unknown>[]): Record<string, unknown> {
  return {
    schemaVersion: ENFORCEMENT_SCHEMA_VERSION,
    sourceId: 'EGM_EDS_MAP',
    sourceUrl: 'https://example.invalid/eds',
    sourceNote: 'F6 test',
    fetchedAt: '2026-09-03T00:00:00.000Z',
    count: points.length,
    typeCounts: { AVERAGE_SPEED: points.length },
    points,
  };
}
async function loadFixturePackage(points: Record<string, unknown>[]): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true, text: async () => JSON.stringify(rawPackage(points)),
  })) as unknown as typeof fetch;
  await ensureEnforcementPointsLoaded('/f6-test-package.json');
  globalThis.fetch = original;
}

/**
 * YOĞUN IZGARA GRAF — koridor tavanlarını GERÇEKTEN dolduran topoloji.
 *
 * 5 kenarlık sentetik graf hiçbir tavanı doldurmaz, bu yüzden "kesilmiş
 * koridor" davranışını KANITLAYAMAZ. `n × n` düğümlü, hepsi çift yönlü
 * `spacingM` metrelik ızgara, 2 000 m bütçede kenar/düğüm tavanını doldurur —
 * gerçek şehir ağının (ölçüldü: 300 örneğin 74'ü `NODE_LIMIT`) küçük ölçekli
 * ama aynı sınıftan bir örneğidir.
 */
function gridView(n: number, spacingM: number): RoutingGraphView {
  const dLat = spacingM / 111_132;            // 1° enlem ≈ 111 132 m
  const dLon = spacingM / 84_000;             // 1° boylam ≈ 84 000 m (41°'de)
  const nodes: (readonly [number, number])[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) nodes.push([41 + i * dLat, 29 + j * dLon]);
  }
  const edges: SynthEdge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const id = i * n + j;
      if (j + 1 < n) edges.push({ from: id, to: id + 1, costM: spacingM, oneway: false, roadClass: 3 });
      if (i + 1 < n) edges.push({ from: id, to: id + n, costM: spacingM, oneway: false, roadClass: 3 });
    }
  }
  const r = parseRoutingGraph(buildSynthBuffer(nodes, edges));
  if (r.view === null) throw new Error(`ızgara graf ayrıştırılamadı: ${r.detail}`);
  return r.view;
}

describe('F6.4 · enforcementHorizonPort — uçtan uca (gerçek tekiller)', () => {
  beforeEach(() => {
    _resetGraphResidencyForTest();
    _resetMapStoreForTest();
    _resetOfflineRoutingStatusForTest();
    _resetEnforcementSourceForTest();
    _resetEnforcementHorizonPortForTest();
    recordOfflineGraphOutcome('AVAILABLE', Date.now(), 1_000);
    _setRoutingGraphViewForTest(synthView());
  });

  it('paket hiç yüklenmediyse NOT_MEASURED (SOURCE_UNAVAILABLE DEĞİL)', () => {
    const port = createEnforcementHorizonAttributePorts();
    const r = port.readAhead({
      pathId: 'MPP', provenance: 'MATCHED_ROAD_TOPOLOGY',
      startEdgeId: toCanonicalEdgeId(0, 0), startAlongEdgeM: 10,
      anchorLat: 41.0, anchorLon: 29.0, budgetM: 200, nowMonoMs: T0,
    });
    expect(r.outcome).toBe('NOT_MEASURED');
    expect(r.objects).toEqual([]);
  });

  it('fiziksel çapa yoksa (startEdgeId null) NOT_MEASURED — uydurma çapa YOK', async () => {
    await loadFixturePackage([rawPoint()]);
    const port = createEnforcementHorizonAttributePorts();
    const r = port.readAhead({
      pathId: 'MPP', provenance: 'ROUTE_INTENT',
      startEdgeId: null, startAlongEdgeM: null,
      anchorLat: null, anchorLon: null, budgetM: 200, nowMonoMs: T0,
    });
    expect(r.outcome).toBe('NOT_MEASURED');
  });

  it('yol ağında MATCHED nokta bütçe içindeyse → OBJECTS (edgeId + along mesafe taşır)', async () => {
    /* Nokta e0 (0→1) üzerinde, kenarın başından ~37 m ileride. */
    await loadFixturePackage([rawPoint({ lat: 41.0000, lng: 29.00045 })]);
    const port = createEnforcementHorizonAttributePorts();
    const r = port.readAhead({
      pathId: 'MPP', provenance: 'MATCHED_ROAD_TOPOLOGY',
      startEdgeId: toCanonicalEdgeId(0, 0), startAlongEdgeM: 0,
      anchorLat: 41.0, anchorLon: 29.0, budgetM: 300, nowMonoMs: T0,
    });
    expect(r.outcome).toBe('OBJECTS');
    expect(r.objects.length).toBeGreaterThanOrEqual(1);
    const obj = r.objects[0];
    expect(obj.kind).toBe('ENFORCEMENT');
    expect(obj.edgeId).not.toBeNull();
    expect(obj.distanceFromEgoM.grade).not.toBe('UNAVAILABLE');
    expect(obj.distanceFromEgoM.value).toBeGreaterThan(0);
    expect(obj.magnitude.grade).toBe('UNAVAILABLE'); // sayısal büyüklük kaynakta YOK
    expect(obj.label.value).toContain('enforcement:AVERAGE_SPEED');

    const snap = getEnforcementHorizonPortSnapshot();
    expect(snap.calls).toBe(1);
    expect(snap.lastOutcome).toBe('OBJECTS');
    expect(snap.cumulativeMatch.matchedToEdge).toBeGreaterThanOrEqual(1);
  });

  it('yol ağında hiçbir nokta yoksa → NO_OBJECTS_IN_RANGE (bilgisizlik DEĞİL)', async () => {
    await loadFixturePackage([rawPoint({ lat: 50.0, lng: 50.0 })]); // çok uzakta
    const port = createEnforcementHorizonAttributePorts();
    const r = port.readAhead({
      pathId: 'MPP', provenance: 'MATCHED_ROAD_TOPOLOGY',
      startEdgeId: toCanonicalEdgeId(0, 0), startAlongEdgeM: 0,
      anchorLat: 41.0, anchorLon: 29.0, budgetM: 300, nowMonoMs: T0,
    });
    expect(r.outcome).toBe('NO_OBJECTS_IN_RANGE');
    expect(r.objects).toEqual([]);
  });

  it('koridor TAVANLA kesildiyse boş sonuç NOT_MEASURED — "ileride yok" DENMEZ', async () => {
    /* ÖLÇÜMLE BULUNDU (§F6.8): gerçek grafta 2 000 m bütçeyle 300 örneğin 74'ü
       (%24,7) `NODE_LIMIT` ile kesiliyor. Kesik koridorda "denetim yok" demek
       her dört sorgudan birinde bilgisizliği ölçülmüş yokluk gibi sunmaktır. */
    _setRoutingGraphViewForTest(gridView(10, 30));
    await loadFixturePackage([rawPoint({ lat: 50.0, lng: 50.0 })]);   // ağda nokta YOK
    const port = createEnforcementHorizonAttributePorts();
    const r = port.readAhead({
      pathId: 'MPP', provenance: 'MATCHED_ROAD_TOPOLOGY',
      startEdgeId: toCanonicalEdgeId(0, 0), startAlongEdgeM: 0,
      anchorLat: 41.0, anchorLon: 29.0, budgetM: 2_000, nowMonoMs: T0,
    });

    const snap = getEnforcementHorizonPortSnapshot();
    expect(snap.lastCorridorTruncated).toBe(true);
    expect(['EDGE_LIMIT', 'NODE_LIMIT', 'DEPTH_LIMIT'])
      .toContain(snap.lastCorridorOutcome);
    expect(r.outcome).toBe('NOT_MEASURED');
    expect(r.outcome).not.toBe('NO_OBJECTS_IN_RANGE');
    expect(r.objects).toEqual([]);
  });

  it('koridor EKSİKSİZ tarandıysa boş sonuç NO_OBJECTS_IN_RANGE kalır (kilit körelmedi)', async () => {
    await loadFixturePackage([rawPoint({ lat: 50.0, lng: 50.0 })]);
    const port = createEnforcementHorizonAttributePorts();
    const r = port.readAhead({
      pathId: 'MPP', provenance: 'MATCHED_ROAD_TOPOLOGY',
      startEdgeId: toCanonicalEdgeId(0, 0), startAlongEdgeM: 0,
      anchorLat: 41.0, anchorLon: 29.0, budgetM: 300, nowMonoMs: T0,
    });
    expect(getEnforcementHorizonPortSnapshot().lastCorridorTruncated).toBe(false);
    expect(r.outcome).toBe('NO_OBJECTS_IN_RANGE');
  });

  it('bozuk başlangıç (INVALID_START) → SOURCE_UNAVAILABLE, throw YOK', async () => {
    await loadFixturePackage([rawPoint()]);
    const port = createEnforcementHorizonAttributePorts();
    expect(() => port.readAhead({
      pathId: 'MPP', provenance: 'MATCHED_ROAD_TOPOLOGY',
      startEdgeId: toCanonicalEdgeId(999_999, 0), startAlongEdgeM: 0,
      anchorLat: 41.0, anchorLon: 29.0, budgetM: 300, nowMonoMs: T0,
    })).not.toThrow();
    const r = port.readAhead({
      pathId: 'MPP', provenance: 'MATCHED_ROAD_TOPOLOGY',
      startEdgeId: toCanonicalEdgeId(999_999, 0), startAlongEdgeM: 0,
      anchorLat: 41.0, anchorLon: 29.0, budgetM: 300, nowMonoMs: T0,
    });
    expect(r.outcome).toBe('SOURCE_UNAVAILABLE');
  });

  it('`boundDomains` YALNIZ `ENFORCEMENT` taşır — diğer alanları UYDURMAZ', () => {
    const port = createEnforcementHorizonAttributePorts();
    expect(port.boundDomains).toEqual(['ENFORCEMENT']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) `cehAuthority.bindAttributePorts` — SONRADAN bağlama
   ══════════════════════════════════════════════════════════════════════════ */

describe('F6.5 · cehAuthority — öznitelik portu sonradan bağlama', () => {
  it('bağlanmadan ÖNCE `boundDomains` boştur (üretim varsayılanı)', () => {
    const ceh = createCehAuthority({ ego: createEgoAuthority(), map: getMapStoreFixture() });
    expect(ceh.getDiagnostics().boundDomains).toEqual([]);
  });

  it('bağlandıktan SONRA `boundDomains` CANLI yansır — `observe()` BEKLEMEZ', () => {
    const ceh = createCehAuthority({ ego: createEgoAuthority(), map: getMapStoreFixture() });
    ceh.bindAttributePorts(createEnforcementHorizonAttributePorts());
    expect(ceh.getDiagnostics().boundDomains).toEqual(['ENFORCEMENT']);
  });

  it('bozuk port SESSİZCE reddedilir — üretim varsayılanı korunur', () => {
    const ceh = createCehAuthority({ ego: createEgoAuthority(), map: getMapStoreFixture() });
    // @ts-expect-error kasıtlı bozuk girdi
    ceh.bindAttributePorts({ readAhead: 'not-a-function' });
    expect(ceh.getDiagnostics().boundDomains).toEqual([]);
  });
});

function getMapStoreFixture() {
  return createMapStore(UNAVAILABLE_MAP_DATA_PORTS);
}

/* ══════════════════════════════════════════════════════════════════════════
   6) `cehShadowRuntime` — kapı DÖRDÜNÜ ister, alan bazlı ölçüm TEKİ yeter
   ══════════════════════════════════════════════════════════════════════════ */

describe('F6.6 · cehShadowRuntime — ATTRIBUTE_PORTS_BOUND dürüstlüğü', () => {
  beforeEach(() => {
    _resetCehAuthorityForTest();
    _resetCehShadowForTest();
    resetCehShadow();
  });

  it('hiçbir port bağlı değilken kapı şartı false', () => {
    expect(cehAttributePortsBound()).toBe(false);
  });

  it('YALNIZ ENFORCEMENT bağlıyken kapı şartı HÂLÂ false ("sadece enforcement bağlandı diye tüm portları bound sayma")', () => {
    getCehAuthority().bindAttributePorts(createEnforcementHorizonAttributePorts());
    expect(cehAttributePortsBound()).toBe(false);
    /* Ama ALAN BAZINDA CEH gerçekten ENFORCEMENT ölçüyor — bunu diagnostics'ten doğrula. */
    expect(getCehAuthority().getDiagnostics().boundDomains).toContain('ENFORCEMENT');
  });

  it('sahte/boş port `UNAVAILABLE_HORIZON_ATTRIBUTE_PORTS` referansıyla AYNI kalır', () => {
    expect(getCehAuthority().getDiagnostics().boundDomains)
      .toEqual(UNAVAILABLE_HORIZON_ATTRIBUTE_PORTS.boundDomains);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) MİMARİ KİLİTLER (F6 görev maddesi 10)
   ══════════════════════════════════════════════════════════════════════════ */

const SRC = resolve(__dirname, '..');
const readSrc = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

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

const GUARDIAN_DIR = 'platform/navigation/guardian';
function guardianFiles(): string[] {
  return walkSrc(GUARDIAN_DIR);
}

describe('F6.7 · mimari kilitler', () => {
  it('G1 — `boundedCorridor.ts` TEK tanımlı (ikinci graph parser/traversal yok)', () => {
    const hits = walkSrc().filter((f) => readSrc(f).includes('export function expandBoundedCorridor'));
    expect(hits).toEqual(['platform/navigation/map/graph/boundedCorridor.ts']);
  });

  it('G2 — Guardian ağacı `boundedCorridor`/`rtg2Reader`/`graphAdjacency` import EDEMEZ (kendi topoloji gezintisini kuramaz)', () => {
    for (const f of guardianFiles()) {
      const src = strip(readSrc(f));
      for (const bad of ['boundedCorridor', 'rtg2Reader', 'graphAdjacency', 'edgeSpatialIndex']) {
        expect(src, `${f}: yasak graf importu "${bad}"`).not.toContain(bad);
      }
    }
  });

  it('G3 — `enforcementHorizonPort.ts` DIŞINDA hiçbir dosya `expandBoundedCorridor`ı ÇAĞIRMAZ (mapStoreSources hariç, saf çekirdek çağırır)', () => {
    const callers = walkSrc().filter((f) => readSrc(f).includes('expandBoundedCorridor('));
    for (const c of callers) {
      expect(
        c === 'platform/navigation/map/graph/boundedCorridor.ts'
        || c === 'platform/navigation/map/store/mapStoreSources.ts',
        `${c}: beklenmeyen expandBoundedCorridor çağrısı`,
      ).toBe(true);
    }
  });

  it('G4 — koridor SINIRSIZ DEĞİL: dört bağımsız tavan da kaynakta sabit', () => {
    const src = readSrc('platform/navigation/map/graph/boundedCorridor.ts');
    for (const bad of ['CORRIDOR_MAX_EDGES', 'CORRIDOR_MAX_NODE_EXPANSIONS',
      'CORRIDOR_MAX_DEPTH', 'CORRIDOR_HARD_MAX_BUDGET_M']) {
      expect(src).toContain(bad);
    }
  });

  it('G5 — traversal döngü-güvenli: `visited` kümesi olmadan expand ÇAĞRILAMAZ', () => {
    const src = readSrc('platform/navigation/map/graph/boundedCorridor.ts');
    expect(src).toContain('visited.has(key)');
    expect(src).toContain('visited.add(key)');
  });

  it('G6 — raw kenar sıra numarası (`ordinal`) L1 DIŞINA (enforcementHorizonPort dahil) sızmaz', () => {
    const outsideL1 = walkSrc().filter((f) => !f.startsWith('platform/navigation/map/')
      && (f === 'platform/navigation/enforcementHorizonPort.ts'
        || f.startsWith('platform/navigation/horizon/')
        || f.startsWith('platform/navigation/shadow/')
        || f.startsWith('platform/navigation/enforcement/')));
    for (const f of outsideL1) {
      const src = strip(readSrc(f));
      for (const bad of ['.ordinal', 'edgeOrdinal', 'nodeIndex']) {
        /* `.ordinal` yalnız `EnforcementRadiusHit`/graf DIŞI bağlamlarda YASAK;
           bu paketlerin hiçbiri graf sıra numarası taşımaz. */
        expect(src, `${f}: graf içi kimlik "${bad}"`).not.toContain(bad);
      }
    }
  });

  it('G7 — düz çizgi mesafesi ASLA yol-boyu mesafe yerine "along" alanına yazılmaz', () => {
    const src = strip(readSrc('platform/navigation/enforcementHorizonPort.ts'));
    /* Tek mesafe kaynağı `alongCorridorDistanceM` — `straightDistanceMeters`
       DOĞRUDAN `distanceFromEgoM`e AKITILMAZ. */
    expect(src).not.toMatch(/distanceFromEgoM:\s*derivedNav[^)]*straightDistanceMeters/);
    expect(src).toContain('alongCorridorDistanceM(');
  });

  it('G8 — belirsiz (`AMBIGUOUS_EDGE`) eşleşme kesin ahead-object ÜRETEMEZ', () => {
    const src = strip(readSrc('platform/navigation/enforcementHorizonPort.ts'));
    expect(src).toContain("match.outcome !== 'MATCHED_TO_EDGE'");
  });

  it('G9 — `NOT_MEASURED → ABSENT` dönüşümü YASAK: port NOT_MEASURED asla NO_OBJECTS_IN_RANGE OLARAK dönmez', () => {
    const src = strip(readSrc('platform/navigation/enforcementHorizonPort.ts'));
    /* Paket hazır değilken NOT_MEASURED/SOURCE_UNAVAILABLE döner, ASLA
       NO_OBJECTS_IN_RANGE — kaynak metninde bu iki dal AYRI tutulur. */
    expect(src).toContain("'NOT_MEASURED'");
    expect(src).toContain("'NO_OBJECTS_IN_RANGE'");
  });

  it('G10 — gölge (`shadow/**`) hiçbir yan etki üretmez: `enforcementHorizonPort.ts` ses/uyarı/DOM YOK', () => {
    const src = strip(readSrc('platform/navigation/enforcementHorizonPort.ts'));
    for (const bad of ['speak(', 'Audio(', 'alert(', 'dispatch(', 'setState(']) {
      expect(src, `port: yasak yan etki "${bad}"`).not.toContain(bad);
    }
  });

  it('G11 — CEH production cutover HÂLÂ kapalı (F6 bunu AÇMADI)', () => {
    const src = readSrc('platform/navigation/shadow/cehCutoverGate.ts');
    expect(src).toMatch(/CEH_CUTOVER_DEFAULT_OPEN\s*(:\s*boolean\s*)?=\s*false/);
  });

  it('G12 — yeni timer/interval YOK: `enforcementHorizonPort.ts` ve `cehAuthority.ts` zamanlayıcı KURMAZ', () => {
    for (const f of [
      'platform/navigation/enforcementHorizonPort.ts',
      'platform/navigation/horizon/cehAuthority.ts',
    ]) {
      const src = strip(readSrc(f));
      expect(src, `${f}: setInterval`).not.toContain('setInterval(');
      expect(src, `${f}: setTimeout`).not.toContain('setTimeout(');
    }
  });

  it('G13 — tazelik/karar İÇİN duvar saati YOK (`Date.now`/`performance.now` yalnız TANI amaçlı, `nowMonoMs`e YAZILMAZ)', () => {
    const src = strip(readSrc('platform/navigation/enforcementHorizonPort.ts'));
    expect(src).not.toMatch(/nowMonoMs:\s*(Date\.now|performance\.now)\(\)/);
  });

  it('G14 — SAF çekirdek dosyalar (`boundedCorridor.ts` · `enforcementEdgeIndex.ts`) I/O · timer · saat İÇERMEZ', () => {
    for (const f of [
      'platform/navigation/map/graph/boundedCorridor.ts',
      'platform/navigation/enforcement/enforcementEdgeIndex.ts',
    ]) {
      const src = strip(readSrc(f));
      for (const bad of ['fetch(', 'setInterval(', 'setTimeout(', 'Date.now(', 'performance.now(',
        "from 'react'", 'addEventListener(']) {
        expect(src, `${f}: SAF ihlali "${bad}"`).not.toContain(bad);
      }
    }
  });

  it('G15 — legacy Guardian enforcement sağlayıcısı (`enforcementMapSource.ts`) DEĞİŞMEDİ / hâlâ ÜRETİM sahibi', () => {
    const src = readSrc('platform/navigation/guardian/providers/concrete/enforcementMapSource.ts');
    expect(src).toContain('RawSpeedCameraData');
  });

  it('G16 — F5 gölge dürüstlük sözlüğü BOZULMADI (compareAhead 9 hüküm hâlâ tam)', () => {
    const src = readSrc('platform/navigation/shadow/cehShadowModel.ts');
    for (const v of ['AGREE', 'DIVERGE_DISTANCE', 'DIVERGE_PRESENCE', 'LEGACY_ONLY',
      'CEH_ONLY', 'BOTH_ABSENT', 'BOTH_UNMEASURED', 'CEH_AMBIGUOUS', 'NOT_COMPARABLE']) {
      expect(src, `cehShadowModel: "${v}" hükmü eksik`).toContain(v);
    }
  });

  it('G17 — `horizon/**` hiçbir dosya `enforcementHorizonPort` veya ham `enforcement/**` sağlayıcısını import ETMEZ', () => {
    const horizonFiles = walkSrc('platform/navigation/horizon');
    for (const f of horizonFiles) {
      const src = strip(readSrc(f));
      expect(src, `${f}: L3 bileşim kökünü/ham sağlayıcıyı import ETMEZ`)
        .not.toMatch(/from\s+['"].*enforcementHorizonPort['"]/);
      expect(src, `${f}: L3 ham enforcement paketini import ETMEZ`)
        .not.toMatch(/from\s+['"].*\/enforcement\//);
    }
  });

  it('G18 — aynı olay iki kez kullanıcıya ÇIKAMAZ: port hiçbir ses/store yazımı API\'si import ETMEZ', () => {
    const src = strip(readSrc('platform/navigation/enforcementHorizonPort.ts'));
    for (const bad of ['voiceGuidance', 'speak', 'TextToSpeech', 'Zustand', 'useStore']) {
      expect(src, `port: yasak tüketici API "${bad}"`).not.toContain(bad);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   8) GERÇEK GRAF ÜZERİNDE SICAK-YOL BÜTÇE ÖLÇÜMÜ (F6 görev maddesi 20)
   ══════════════════════════════════════════════════════════════════════════
   Sentetik graf (5 kenar) koridorun DAVRANIŞINI kanıtlar ama MALİYETİNİ
   kanıtlamaz. Tavanların (96 kenar · 64 düğüm · 32 derinlik · 5 km) varlık
   sebebi 295 346 kenarlı GERÇEK graftır; bu yüzden ölçüm gerçek artefakt
   üzerinde yapılır.

   ⚠️ **HOST ÖLÇÜMÜ CİHAZ ÖLÇÜMÜ DEĞİLDİR.** Buradaki süreler geliştirme
   makinesinin V8'inde alınmıştır; head unit'in CPU'su, belleği ve termal
   davranışı BAŞKADIR. Kütükteki cihaz maddeleri bu ölçümle 🟢 OLMAZ.

   Zaman EŞİĞİ bir kilit DEĞİLDİR (makineye göre değişir → kırılgan guard
   olurdu): kilitlenen şey YAPISAL tavanlar, determinizm ve sızıntısızlıktır;
   süre ÖLÇÜLÜR ve RAPORLANIR. */

const REPO_ROOT = resolve(SRC, '..');
const REAL_GRAPH_PATH = resolve(REPO_ROOT, 'public', 'maps', 'routing-graph.bin');
const HAS_REAL_GRAPH = existsSync(REAL_GRAPH_PATH);

let _realView: RoutingGraphView | null = null;
let _realAdj: GraphAdjacency | null = null;

function realGraph(): { view: RoutingGraphView; adj: GraphAdjacency } {
  if (_realView === null || _realAdj === null) {
    const b = readFileSync(REAL_GRAPH_PATH);
    const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    const r = parseRoutingGraph(buf);
    if (r.view === null) throw new Error(`gerçek graf ayrıştırılamadı: ${r.detail}`);
    _realView = r.view;
    _realAdj = buildGraphAdjacency(r.view);
  }
  return { view: _realView, adj: _realAdj };
}

/** Grafa YAYILMIŞ, deterministik başlangıç kenarları (rastgele DEĞİL). */
function sampleOrdinals(edgeCount: number, count: number): number[] {
  const stride = Math.max(1, Math.floor(edgeCount / count));
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((i * stride) % edgeCount);
  return out;
}

const MEASURE_SAMPLES = 300;
/** Ürünün EN BÜYÜK ufuk bütçesi — en kötü hâl ölçülür (`HORIZON_MAX_M`). */
const MEASURE_BUDGET_M = 2_000;

interface MeasureRun {
  readonly corridors: RawCorridor[];
  readonly durationsMs: number[];
  readonly outcomes: Record<string, number>;
  readonly maxEdges: number;
  readonly maxNodeExpansions: number;
  readonly maxDepth: number;
  readonly maxCoveredM: number;
  readonly branchedSamples: number;
  readonly multiEdgeSamples: number;
}

function measureRun(ordinals: readonly number[], keepCorridors: boolean): MeasureRun {
  const { view, adj } = realGraph();
  const limits = corridorLimits(MEASURE_BUDGET_M);
  const corridors: RawCorridor[] = [];
  const durationsMs: number[] = [];
  const outcomes: Record<string, number> = {};
  let maxEdges = 0, maxNodeExpansions = 0, maxDepth = 0, maxCoveredM = 0;
  let branchedSamples = 0, multiEdgeSamples = 0;

  for (const ordinal of ordinals) {
    const halfway = Math.max(0, view.edgeCostM[ordinal] ?? 0) / 2;
    const t0 = performance.now();
    const c = expandBoundedCorridor(view, adj, ordinal, 0, halfway, limits);
    durationsMs.push(performance.now() - t0);

    outcomes[c.outcome] = (outcomes[c.outcome] ?? 0) + 1;
    if (c.edges.length > maxEdges) maxEdges = c.edges.length;
    if (c.nodeExpansions > maxNodeExpansions) maxNodeExpansions = c.nodeExpansions;
    if (c.coveredM > maxCoveredM) maxCoveredM = c.coveredM;
    for (const e of c.edges) if (e.depth > maxDepth) maxDepth = e.depth;
    if (c.branchCount > 0) branchedSamples++;
    if (c.edges.length > 1) multiEdgeSamples++;
    if (keepCorridors) corridors.push(c);
  }

  return {
    corridors, durationsMs, outcomes,
    maxEdges, maxNodeExpansions, maxDepth, maxCoveredM,
    branchedSamples, multiEdgeSamples,
  };
}

function percentileMs(values: readonly number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[i];
}

const describeReal = HAS_REAL_GRAPH ? describe : describe.skip;

describeReal('F6.8 · gerçek graf — sıcak-yol CPU/bellek ölçümü', () => {
  it('M0 — gerçek artefakt okunuyor ve komşuluk kuruluyor (ölçümün ön koşulu)', () => {
    const { view, adj } = realGraph();
    expect(view.edgeCount).toBeGreaterThan(100_000);
    expect(adj.halfEdgeCount).toBeGreaterThan(view.edgeCount);

    const graphBytes = view.nodeLat.byteLength + view.nodeLon.byteLength
      + view.edgeFrom.byteLength + view.edgeTo.byteLength
      + view.edgeCostM.byteLength + view.edgeFlags.byteLength;
    const adjBytes = adj.offsets.byteLength + adj.targetNode.byteLength
      + adj.edgeOrdinal.byteLength + adj.dir.byteLength;

    /* RAPOR — kalıcı bellek, ölçüm (tahmin değil). */
    console.log(
      `[F6 OLCUM] graf: ${view.nodeCount} dugum · ${view.edgeCount} kenar · `
      + `v${view.version} · tipli dizi ${(graphBytes / 1048576).toFixed(2)} MB · `
      + `komsuluk ${(adjBytes / 1048576).toFixed(2)} MB · `
      + `yarim-kenar ${adj.halfEdgeCount}`,
    );
    /* Komşuluk graf boyutunun KATI olamaz — sınırsız türev yapı yasak. */
    expect(adjBytes).toBeLessThan(graphBytes * 3);
  });

  it('M1 — 300 gerçek örnekte DÖRT tavanın DÖRDÜ de aşılamaz', () => {
    const { view } = realGraph();
    const r = measureRun(sampleOrdinals(view.edgeCount, MEASURE_SAMPLES), false);

    expect(r.maxEdges).toBeLessThanOrEqual(CORRIDOR_MAX_EDGES);
    expect(r.maxNodeExpansions).toBeLessThanOrEqual(CORRIDOR_MAX_NODE_EXPANSIONS);
    expect(r.maxDepth).toBeLessThanOrEqual(CORRIDOR_MAX_DEPTH);
    expect(r.maxCoveredM).toBeLessThanOrEqual(MEASURE_BUDGET_M);
    /* Gerçek grafta topoloji VARDIR — `NO_TOPOLOGY` çıkarsa okuma bozuktur. */
    expect(r.outcomes.NO_TOPOLOGY ?? 0).toBe(0);

    console.log(
      `[F6 OLCUM] ${MEASURE_SAMPLES} ornek @ ${MEASURE_BUDGET_M} m — hukum dagilimi: `
      + Object.entries(r.outcomes).map(([k, v]) => `${k}=${v}`).join(' · ')
      + ` · en cok kenar ${r.maxEdges}/${CORRIDOR_MAX_EDGES}`
      + ` · en cok dugum genisletme ${r.maxNodeExpansions}/${CORRIDOR_MAX_NODE_EXPANSIONS}`
      + ` · en cok derinlik ${r.maxDepth}/${CORRIDOR_MAX_DEPTH}`,
    );
  });

  it('M2 — ölçüm KÖR DEĞİL: örnekler gerçekten çok-kenarlı/dallanan koridor üretir', () => {
    const { view } = realGraph();
    const r = measureRun(sampleOrdinals(view.edgeCount, MEASURE_SAMPLES), false);
    /* Tek kenarlık koridorlar ölçülseydi "ucuz" sonucu ANLAMSIZ olurdu. */
    expect(r.multiEdgeSamples).toBeGreaterThan(MEASURE_SAMPLES / 2);
    expect(r.branchedSamples).toBeGreaterThan(0);
    console.log(
      `[F6 OLCUM] cok-kenarli ornek ${r.multiEdgeSamples}/${MEASURE_SAMPLES} · `
      + `dallanan ornek ${r.branchedSamples}/${MEASURE_SAMPLES}`,
    );
  });

  it('M3 — DETERMİNİZM: aynı 300 örnek ikinci koşuda BİREBİR aynı koridoru verir', () => {
    const { view } = realGraph();
    const ords = sampleOrdinals(view.edgeCount, MEASURE_SAMPLES);
    const a = measureRun(ords, true);
    const b = measureRun(ords, true);
    for (let i = 0; i < ords.length; i++) {
      expect(b.corridors[i].outcome).toBe(a.corridors[i].outcome);
      expect(b.corridors[i].coveredM).toBe(a.corridors[i].coveredM);
      expect(b.corridors[i].edges).toEqual(a.corridors[i].edges);
    }
  });

  it('M4 — CPU: çağrı başına süre ÖLÇÜLÜR ve raporlanır (eşik kilit DEĞİL)', () => {
    const { view } = realGraph();
    const ords = sampleOrdinals(view.edgeCount, MEASURE_SAMPLES);
    measureRun(ords, false);                          // ısınma (JIT)
    const r = measureRun(ords, false);

    const total = r.durationsMs.reduce((s, v) => s + v, 0);
    const p50 = percentileMs(r.durationsMs, 0.5);
    const p95 = percentileMs(r.durationsMs, 0.95);
    const max = Math.max(...r.durationsMs);
    console.log(
      `[F6 OLCUM] genisletme maliyeti (host) — p50 ${p50.toFixed(3)} ms · `
      + `p95 ${p95.toFixed(3)} ms · max ${max.toFixed(3)} ms · `
      + `ortalama ${(total / r.durationsMs.length).toFixed(3)} ms · `
      + `${MEASURE_SAMPLES} cagri toplam ${total.toFixed(1)} ms`,
    );

    /* Kaba SAĞLIK tavanı — kalibrasyon DEĞİL. Tavanlar çalışıyorken tek bir
       genişletme host'ta 250 ms sürüyorsa gezinme sınırsızlaşmış demektir. */
    expect(max).toBeLessThan(250);
    expect(Number.isFinite(total)).toBe(true);
  });

  it('M5 — BELLEK: yinelenen genişletmeden sonra kalıcı yığın artışı sınırlı (sızıntı yok)', () => {
    const { view } = realGraph();
    const ords = sampleOrdinals(view.edgeCount, MEASURE_SAMPLES);
    measureRun(ords, false);                          // ısınma + graf/komşuluk yerleşsin

    const before = process.memoryUsage().heapUsed;
    for (let round = 0; round < 6; round++) measureRun(ords, false);   // 1800 çağrı
    const after = process.memoryUsage().heapUsed;
    const deltaMb = (after - before) / 1048576;

    console.log(
      `[F6 OLCUM] bellek — 1800 genisletme sonrasi yigin farki `
      + `${deltaMb.toFixed(2)} MB (GC belirsizligi dahil)`,
    );

    /* Genişletme MODÜL DURUMU TUTMAZ (G14/saflık kilidi); tek çağrının ürettiği
       her şey çöp olur. Kalıcı büyüme burada bir SIZINTI imzasıdır — bu tavan
       cömerttir, performans kalibrasyonu DEĞİLDİR. */
    expect(deltaMb).toBeLessThan(96);
  });
});
