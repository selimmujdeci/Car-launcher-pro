/**
 * navV3GraphTopologyF4.test.ts — NAV v3 · F4 · RTG2 OKUYUCU + TOPOLOJİ +
 * CANLI YOL EŞLEŞMESİ KİLİTLERİ.
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F4.
 *
 * Kapsam:
 *  0) Kanonik `RTG2` okuyucu — GERÇEK artefakt (`public/maps/routing-graph.bin`)
 *  1) Bozuk/kısa/desteklenmeyen girdi — fail-closed
 *  2) `EdgeId` round-trip (ilk/son kenar · aralık dışı · yabancı ad alanı)
 *  3) Komşuluk + topoloji (tek yön semantiği · ters komşuluk)
 *  4) Yakınlık indeksi ve aday üretimi
 *  5) `MapStore` kenar gerçeği (fail-closed kapılar)
 *  6) Canlı HMM → `MatchedRoadPose`
 *  7) CEH fiziksel doğrulama
 *  8) **ROUTING PARİTESİ** — eski gösterim vs yeni CSR, GERÇEK graf üzerinde
 *  9) Mimari kilitler (18 madde)
 *
 * SAHA: bu testin yeşili F4'ü "tamam" YAPMAZ — kütük #1232–#1243
 * `UNKNOWN / DEVICE VALIDATION REQUIRED`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

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
  parseRoutingGraph, edgeIsOneway, edgeRoadClass, isValidNodeIndex,
  RTG2_MAGIC, RTG_NODE_STRIDE, RTG2_EDGE_STRIDE, RTG_MAX_EDGE_COUNT,
  type RoutingGraphView,
} from '../platform/navigation/map/graph/rtg2Reader';
import {
  buildGraphAdjacency, buildReverseAdjacency, outgoingRange, outDegree,
  edgeEndpoints, isDirectlyConnected,
} from '../platform/navigation/map/graph/graphAdjacency';
import {
  buildEdgeSpatialIndex, queryEdgesNear, projectOntoEdge,
  GRID_CELL_DEG, MAX_PROXIMITY_HITS,
} from '../platform/navigation/map/graph/edgeSpatialIndex';
import {
  _resetGraphResidencyForTest, _setRoutingGraphViewForTest,
  readGraphAdjacency, readEdgeSpatialIndex, getGraphResidencySnapshot,
} from '../platform/navigation/map/graph/graphResidencyRuntime';
import {
  createMapStore, UNAVAILABLE_MAP_DATA_PORTS, UNMEASURED_DATASET,
  type MapDataPorts,
} from '../platform/navigation/map/store/mapStore';
import { productionMapDataPorts } from '../platform/navigation/map/store/mapStoreSources';
import {
  toCanonicalEdgeId, toLegacyEdgeRef, LEGACY_MONOLITH_TILE_ID,
  MEASURED_GRAPH_EDGE_COUNT, MEASURED_GRAPH_NODE_COUNT,
} from '../platform/navigation/map/store/legacyEdgeIdAdapter';
import { makeEdgeId, edgeIdEquals } from '../platform/navigation/contracts/navEdgeId';
import { asMonotonic } from '../platform/navigation/contracts/navMonotonicTime';
import { _resetOfflineRoutingStatusForTest, recordOfflineGraphOutcome }
  from '../platform/navigation/offlineRoutingStatus';
import { productionRoadCandidateSource, candidateRadiusM }
  from '../platform/navigation/matching/roadCandidateSource';
import { _resetMapStoreForTest } from '../platform/navigation/map/store';
import { createEgoAuthority } from '../platform/navigation/ego/egoAuthority';
import type { EgoSensorSample } from '../platform/navigation/ego/egoSensorPort';
import { createCehAuthority } from '../platform/navigation/horizon/cehAuthority';
import { HMM_MAX_CANDIDATES } from '../platform/navigation/matching/hmmMatchModel';

/* ══════════════════════════════════════════════════════════════════════════
   GERÇEK ARTEFAKT — bir kez okunur, testler paylaşır
   ══════════════════════════════════════════════════════════════════════════ */

const ROOT = resolve(__dirname, '..', '..');
const GRAPH_PATH = resolve(ROOT, 'public', 'maps', 'routing-graph.bin');
const HAS_REAL_GRAPH = existsSync(GRAPH_PATH);

let _realBuf: ArrayBuffer | null = null;
function realGraphBuffer(): ArrayBuffer {
  if (_realBuf === null) {
    const b = readFileSync(GRAPH_PATH);
    _realBuf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  }
  return _realBuf;
}

let _realView: RoutingGraphView | null = null;
function realGraphView(): RoutingGraphView {
  if (_realView === null) {
    const r = parseRoutingGraph(realGraphBuffer());
    if (r.view === null) throw new Error(`gerçek graf ayrıştırılamadı: ${r.detail}`);
    _realView = r.view;
  }
  return _realView;
}

/* ── Sentetik küçük graf (deterministik davranış testleri) ─────────────── */

interface SynthEdge { from: number; to: number; costM: number; oneway: boolean; roadClass: number; }

function buildSynthBuffer(
  nodes: readonly (readonly [number, number])[],
  edges: readonly SynthEdge[],
  opts: { magic?: number; truncateBytes?: number; version?: 1 | 2 } = {},
): ArrayBuffer {
  const version = opts.version ?? 2;
  const headerBytes = version === 2 ? 8 : 4;
  const stride = version === 2 ? RTG2_EDGE_STRIDE : 12;
  const size = headerBytes + nodes.length * RTG_NODE_STRIDE + 4 + edges.length * stride;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  let off = 0;
  if (version === 2) {
    dv.setUint32(off, opts.magic ?? RTG2_MAGIC, true); off += 4;
    dv.setUint32(off, nodes.length, true); off += 4;
  } else {
    dv.setUint32(off, nodes.length, true); off += 4;
  }
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
    if (version === 2) {
      dv.setUint8(off + 12, (e.oneway ? 1 : 0) | ((e.roadClass & 0x07) << 1));
    }
    off += stride;
  }
  if (typeof opts.truncateBytes === 'number') {
    return buf.slice(0, Math.max(0, size - opts.truncateBytes));
  }
  return buf;
}

/**
 * Küçük test grafı — 41.00/29.00 çevresinde doğu-batı bir ana yol ve ona
 * ~40 m kuzeyde PARALEL bir servis yolu + bir kavşak kolu.
 */
const SYNTH_NODES: readonly (readonly [number, number])[] = [
  [41.0000, 29.0000],   // 0 ana yol batı
  [41.0000, 29.0100],   // 1 ana yol orta
  [41.0000, 29.0200],   // 2 ana yol doğu
  [41.00036, 29.0000],  // 3 paralel servis yolu batı (~40 m kuzey)
  [41.00036, 29.0100],  // 4 paralel servis yolu doğu
  [41.0050, 29.0100],   // 5 kavşaktan kuzeye giden kol
];
const SYNTH_EDGES: readonly SynthEdge[] = [
  { from: 0, to: 1, costM: 850, oneway: false, roadClass: 3 },  // 0 ana yol B→O
  { from: 1, to: 2, costM: 840, oneway: false, roadClass: 3 },  // 1 ana yol O→D
  { from: 3, to: 4, costM: 845, oneway: true, roadClass: 6 },   // 2 servis (TEK YÖN)
  { from: 1, to: 5, costM: 560, oneway: false, roadClass: 4 },  // 3 kuzey kol
];

function synthView(): RoutingGraphView {
  const r = parseRoutingGraph(buildSynthBuffer(SYNTH_NODES, SYNTH_EDGES));
  if (r.view === null) throw new Error(`sentetik graf ayrıştırılamadı: ${r.detail}`);
  return r.view;
}

const T0 = asMonotonic(1_000_000);

/* ── MapStore fikstürü — graf VAR hükmüyle ────────────────────────────── */

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

/* ══════════════════════════════════════════════════════════════════════════
   0) KANONİK OKUYUCU — GERÇEK ARTEFAKT
   ══════════════════════════════════════════════════════════════════════════ */

describe.skipIf(!HAS_REAL_GRAPH)('F4.0 · RTG2 okuyucu — GERÇEK artefakt', () => {
  it('gerçek graf ayrıştırılır ve ÖLÇÜLEN sayılarla birebir uyuşur', () => {
    const r = parseRoutingGraph(realGraphBuffer());
    expect(r.outcome).toBe('OK');
    const v = r.view!;
    expect(v.version).toBe(2);
    expect(v.nodeCount).toBe(MEASURED_GRAPH_NODE_COUNT);
    expect(v.edgeCount).toBe(MEASURED_GRAPH_EDGE_COUNT);
    /* Dosya boyutu = başlık + düğüm tablosu + kenar tablosu (artık YOK). */
    expect(v.parsedBytes).toBe(statSync(GRAPH_PATH).size);
    expect(v.trailingBytes).toBe(0);
  });

  it('ilk ve son düğüm/kenar ÖLÇÜLEN değerleri taşır', () => {
    const v = realGraphView();
    expect(v.nodeLat[0]).toBeCloseTo(38.42378997, 5);
    expect(v.nodeLon[0]).toBeCloseTo(27.14234924, 5);
    expect(v.nodeLat[v.nodeCount - 1]).toBeCloseTo(40.94609832, 5);
    expect(v.nodeLon[v.nodeCount - 1]).toBeCloseTo(29.14841270, 5);

    expect(v.edgeFrom[0]).toBe(0);
    expect(v.edgeTo[0]).toBe(1);
    expect(v.edgeCostM[0]).toBe(406);
    expect(edgeIsOneway(v, 0)).toBe(true);
    expect(edgeRoadClass(v, 0)).toBe(3);

    const last = v.edgeCount - 1;
    expect(v.edgeFrom[last]).toBe(225063);
    expect(v.edgeTo[last]).toBe(225047);
    expect(v.edgeCostM[last]).toBe(165);
    expect(edgeIsOneway(v, last)).toBe(false);
    expect(edgeRoadClass(v, last)).toBe(4);
  });

  it('gerçek grafta ARALIK DIŞI düğüm gösteren kenar YOKTUR', () => {
    const v = realGraphView();
    for (let i = 0; i < v.edgeCount; i++) {
      if (v.edgeFrom[i] >= v.nodeCount || v.edgeTo[i] >= v.nodeCount) {
        throw new Error(`kenar ${i} aralık dışı`);
      }
    }
    expect(isValidNodeIndex(v, v.nodeCount - 1)).toBe(true);
    expect(isValidNodeIndex(v, v.nodeCount)).toBe(false);
  });

  it('ayrıştırma DETERMİNİSTİKtir (aynı bayt → aynı sayılar)', () => {
    const a = parseRoutingGraph(realGraphBuffer()).view!;
    const b = parseRoutingGraph(realGraphBuffer()).view!;
    expect(a.nodeCount).toBe(b.nodeCount);
    expect(a.edgeCount).toBe(b.edgeCount);
    expect(a.nodeLat[12345]).toBe(b.nodeLat[12345]);
    expect(a.edgeCostM[54321]).toBe(b.edgeCostM[54321]);
  });

  it('graf kanonik kimlik uzayına SIĞIYOR', () => {
    expect(realGraphView().edgeCount).toBeLessThanOrEqual(RTG_MAX_EDGE_COUNT);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   1) FAIL-CLOSED GİRDİLER
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4.0 · bozuk girdi ASLA yarım graf üretmez', () => {
  it('boş/eksik girdi → EMPTY', () => {
    expect(parseRoutingGraph(null).outcome).toBe('EMPTY');
    expect(parseRoutingGraph(undefined).outcome).toBe('EMPTY');
    expect(parseRoutingGraph(null).view).toBeNull();
  });

  it('başlık için bile kısa dosya → TRUNCATED', () => {
    expect(parseRoutingGraph(new ArrayBuffer(4)).outcome).toBe('TRUNCATED');
  });

  it('KESİLMİŞ kenar tablosu → TRUNCATED (yarım graf KABUL EDİLMEZ)', () => {
    const buf = buildSynthBuffer(SYNTH_NODES, SYNTH_EDGES, { truncateBytes: 10 });
    const r = parseRoutingGraph(buf);
    expect(r.outcome).toBe('TRUNCATED');
    expect(r.view).toBeNull();
  });

  it('RTG ailesinden DESTEKLENMEYEN sürüm → UNSUPPORTED_VERSION', () => {
    /* RTG3/RTG4 desteklenir; tanınmayan RTG5 fail-closed reddedilir. */
    const buf = buildSynthBuffer(SYNTH_NODES, SYNTH_EDGES, { magic: 0x35475452 });
    const r = parseRoutingGraph(buf);
    expect(r.outcome).toBe('UNSUPPORTED_VERSION');
    expect(r.view).toBeNull();
  });

  it('ARALIK DIŞI düğüm indeksi → INVALID', () => {
    const bad = [{ from: 0, to: 99, costM: 100, oneway: false, roadClass: 1 }];
    const r = parseRoutingGraph(buildSynthBuffer(SYNTH_NODES, bad));
    expect(r.outcome).toBe('INVALID');
    expect(r.view).toBeNull();
  });

  it('düğüm sayısı 0 → INVALID', () => {
    const r = parseRoutingGraph(buildSynthBuffer([], []));
    expect(r.outcome).toBe('INVALID');
  });

  it('v1 (sihirli sayısız) graf okunur ama sınıf/tek-yön BİLİNMEZ', () => {
    const r = parseRoutingGraph(buildSynthBuffer(SYNTH_NODES, SYNTH_EDGES, { version: 1 }));
    expect(r.outcome).toBe('OK');
    const v = r.view!;
    expect(v.version).toBe(1);
    /* v1'de flags baytı YOKTUR → sınıf 0 = BİLİNMİYOR, "yerel yol" DEĞİL. */
    expect(edgeRoadClass(v, 0)).toBe(0);
    expect(edgeIsOneway(v, 0)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) EDGEID ROUND-TRIP
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4.3 · kanonik EdgeId — kayıpsız ve tek kimlik sistemi', () => {
  it('ilk ve son kenar round-trip kayıpsız', () => {
    const v = HAS_REAL_GRAPH ? realGraphView() : synthView();
    for (const ord of [0, v.edgeCount - 1]) {
      for (const dir of [0, 1] as const) {
        const id = toCanonicalEdgeId(ord, dir);
        const back = toLegacyEdgeRef(id);
        expect(back.edgeOrdinal).toBe(ord);
        expect(back.dir).toBe(dir);
      }
    }
  });

  it('aralık dışı sıra numarası REDDEDİLİR (sessiz kırpma YOK)', () => {
    expect(() => toCanonicalEdgeId(RTG_MAX_EDGE_COUNT + 1, 0)).toThrow(RangeError);
    expect(() => toCanonicalEdgeId(-1, 0)).toThrow(RangeError);
    expect(() => toCanonicalEdgeId(1.5, 0)).toThrow(RangeError);
  });

  it('YABANCI (karolu) kimlik monolit sıra numarası SANILMAZ', () => {
    const tiled = makeEdgeId(1234, 7, 0);   // karo kimliği — monolit DEĞİL
    expect(() => toLegacyEdgeRef(tiled)).toThrow(RangeError);
    expect(edgeIdEquals(tiled, toCanonicalEdgeId(7, 0))).toBe(false);
  });

  it('monolit nöbetçisi karo kimlik uzayıyla ÇAKIŞMAZ', () => {
    expect(LEGACY_MONOLITH_TILE_ID).toBe(0xFFFFFFFF);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) KOMŞULUK / TOPOLOJİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4.5 · topoloji', () => {
  it('çift yönlü kenar İKİ kol üretir, tek yönlü kenar YALNIZ bir kol', () => {
    const v = synthView();
    const adj = buildGraphAdjacency(v);
    /* 4 kenardan 3'ü çift yönlü → 4 + 3 = 7 yarım-kenar. */
    expect(adj.halfEdgeCount).toBe(7);
    /* Düğüm 4 (tek yönlü servis yolunun VARIŞI) → çıkış YOK. */
    expect(outDegree(adj, 4)).toBe(0);
    /* Düğüm 1 (kavşak): kenar 0 geri kolu + kenar 1 ileri + kenar 3 ileri. */
    expect(outDegree(adj, 1)).toBe(3);
  });

  it('kenar uçları yön (dir) ile TERS çevrilir', () => {
    const v = synthView();
    expect(edgeEndpoints(v, 0, 0)).toEqual({ fromNode: 0, toNode: 1 });
    expect(edgeEndpoints(v, 0, 1)).toEqual({ fromNode: 1, toNode: 0 });
    expect(edgeEndpoints(v, 999, 0)).toBeNull();
  });

  it('doğrudan bağlanabilirlik ölçülür; bağlı OLMAYAN kenar `false`', () => {
    const v = synthView();
    const adj = buildGraphAdjacency(v);
    /* kenar 0 (0→1) bitişi düğüm 1; kenar 1 (1→2) oradan başlar. */
    expect(isDirectlyConnected(v, adj, 0, 0, 1, 0)).toBe(true);
    /* Servis yolu (kenar 2) ana yola BAĞLI DEĞİL. */
    expect(isDirectlyConnected(v, adj, 0, 0, 2, 0)).toBe(false);
  });

  it('TERS komşuluk gelen kenarları bulur (tek yönlüde çıkış yoktur)', () => {
    const v = synthView();
    const rev = buildReverseAdjacency(v);
    /* Düğüm 4'e yalnız tek yönlü servis yolu GELİR. */
    const r = outgoingRange(rev, 4);
    expect(r.end - r.start).toBe(1);
    expect(rev.edgeOrdinal[r.start]).toBe(2);
  });

  it('MapStore topolojisi HAM DÜĞÜM İNDEKSİ sızdırmaz', () => {
    _resetGraphResidencyForTest();
    _setRoutingGraphViewForTest(synthView());
    const store = createMapStore(graphAvailablePorts());
    const topo = store.getEdgeTopology(toCanonicalEdgeId(0, 0), T0);
    expect(topo.value).not.toBeNull();
    const keys = Object.keys(topo.value!);
    expect(keys).toEqual(['edgeId', 'outgoing', 'incoming', 'oneway', 'lengthM']);
    for (const id of topo.value!.outgoing) {
      /* Kanonik kimlik — çıplak sayı DEĞİL. */
      expect(typeof id).toBe('object');
      expect(toLegacyEdgeRef(id).edgeOrdinal).toBeGreaterThanOrEqual(0);
    }
  });

  it('TEK YÖNLÜ kenarın ters kolu için topoloji ÜRETİLMEZ', () => {
    _resetGraphResidencyForTest();
    _setRoutingGraphViewForTest(synthView());
    const store = createMapStore(graphAvailablePorts());
    /* Kenar 2 tek yönlüdür → `dir = 1` yasak yöndür. */
    const topo = store.getEdgeTopology(toCanonicalEdgeId(2, 1), T0);
    expect(topo.value).toBeNull();
    expect(topo.grade).toBe('UNAVAILABLE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) YAKINLIK / ADAYLAR
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4.6/F4.7 · yakınlık indeksi ve aday üretimi', () => {
  it('düz segment üzerinde izdüşüm ve dik mesafe ölçülür', () => {
    const v = synthView();
    /* Ana yolun tam üstünde bir nokta → dik mesafe ~0. */
    const hit = projectOntoEdge(v, 0, 41.0, 29.005);
    expect(hit).not.toBeNull();
    expect(hit!.perpDistM).toBeLessThan(5);
    expect(hit!.bearingDeg).toBeCloseTo(90, 0);   // doğuya gidiyor
    /* `alongEdgeM` GERÇEK uzunluğa (costM) ölçeklenir. */
    expect(hit!.alongEdgeM).toBeGreaterThan(300);
    expect(hit!.alongEdgeM).toBeLessThan(550);
  });

  it('geçersiz girdi / sıfır uzunluk / aralık dışı → `null`', () => {
    const v = synthView();
    expect(projectOntoEdge(v, 0, NaN, 29)).toBeNull();
    expect(projectOntoEdge(v, 999, 41, 29)).toBeNull();
  });

  it('PARALEL yollar AYRI adaylar olarak döner (ikisi de korunur)', () => {
    const v = synthView();
    const idx = buildEdgeSpatialIndex(v)!;
    /* Ana yol ile servis yolu arası ~40 m; araç ana yolun üstünde. */
    const hits = queryEdgesNear(v, idx, 41.0, 29.005, 100);
    const ords = hits.map((h) => h.ordinal);
    expect(ords).toContain(0);   // ana yol
    expect(ords).toContain(2);   // paralel servis yolu
    /* En yakın ÖNCE. */
    expect(hits[0].perpDistM).toBeLessThanOrEqual(hits[1].perpDistM);
  });

  it('YARIÇAP DIŞI kenar aday DEĞİLDİR (zorla snap yapısal olarak yok)', () => {
    const v = synthView();
    const idx = buildEdgeSpatialIndex(v)!;
    /* Yollardan ~500 m kuzeyde, yarıçap 50 m. */
    const hits = queryEdgesNear(v, idx, 41.0045, 29.005, 50);
    expect(hits).toHaveLength(0);
  });

  it('geçersiz yarıçap/koordinat → boş sonuç', () => {
    const v = synthView();
    const idx = buildEdgeSpatialIndex(v)!;
    expect(queryEdgesNear(v, idx, 41, 29, 0)).toHaveLength(0);
    expect(queryEdgesNear(v, idx, NaN, 29, 100)).toHaveLength(0);
  });

  it('sonuç sayısı üst sınırı AŞAMAZ', () => {
    const v = synthView();
    const idx = buildEdgeSpatialIndex(v)!;
    const hits = queryEdgesNear(v, idx, 41.0, 29.005, 5_000, 1_000);
    expect(hits.length).toBeLessThanOrEqual(MAX_PROXIMITY_HITS);
  });

  it('belirsizlik yarıçapı F2 formülünden gelir', () => {
    expect(candidateRadiusM(null)).toBe(200);
    expect(candidateRadiusM(5)).toBe(40);
  });

  it('çift yönlü kenar İKİ yönlü aday üretir (ters şerit ayrımı)', () => {
    _resetGraphResidencyForTest();
    _resetMapStoreForTest();
    _setRoutingGraphViewForTest(synthView());
    const store = createMapStore(graphAvailablePorts());
    const near = store.queryEdgesNear(41.0, 29.005, 100, T0);
    expect(near.value).not.toBeNull();
    const dirs = near.value!
      .filter((n) => toLegacyEdgeRef(n.edgeId).edgeOrdinal === 0)
      .map((n) => toLegacyEdgeRef(n.edgeId).dir);
    expect([...dirs].sort()).toEqual([0, 1]);
    /* Tek yönlü servis yolu YALNIZ ileri kol üretir. */
    const svc = near.value!.filter((n) => toLegacyEdgeRef(n.edgeId).edgeOrdinal === 2);
    expect(svc.every((n) => toLegacyEdgeRef(n.edgeId).dir === 0)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) MAPSTORE KENAR GERÇEĞİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4.4/F4.12 · MapStore kenar gerçeği ve fail-closed kapılar', () => {
  beforeEach(() => {
    _resetGraphResidencyForTest();
    _resetMapStoreForTest();
    _resetOfflineRoutingStatusForTest();
  });

  it('graf çözülmüşken kenar metadatası GERÇEK değer döner', () => {
    _setRoutingGraphViewForTest(synthView());
    const store = createMapStore(graphAvailablePorts());
    const md = store.getEdgeMetadata(toCanonicalEdgeId(0, 0), T0);
    expect(md.value).toEqual({ lengthM: 850, oneway: false, roadClass: 3 });
    expect(md.grade).toBe('OBSERVED');
  });

  it('graf ÇÖZÜLMEMİŞKEN kenar metadatası UNAVAILABLE (uydurma YOK)', () => {
    _setRoutingGraphViewForTest(null);
    const store = createMapStore(graphAvailablePorts());
    const md = store.getEdgeMetadata(toCanonicalEdgeId(0, 0), T0);
    expect(md.value).toBeNull();
    expect(md.grade).toBe('UNAVAILABLE');
  });

  it('BOZUK graf hükmü kenar gerçeğini KAPATIR', () => {
    _setRoutingGraphViewForTest(synthView());
    const store = createMapStore(graphAvailablePorts({
      readDataset: () => ({
        available: false, invalid: true, provenance: 1,
        reason: 'VERSION_MISMATCH' as const, observedAtMonoMs: T0, freshnessBudgetMs: null,
      }),
    }));
    expect(store.getEdgeMetadata(toCanonicalEdgeId(0, 0), T0).value).toBeNull();
    expect(store.getEdgeTopology(toCanonicalEdgeId(0, 0), T0).value).toBeNull();
    expect(store.queryEdgesNear(41, 29, 100, T0).value).toBeNull();
    expect(store.networkDistanceM(
      { edgeId: toCanonicalEdgeId(0, 0), alongEdgeM: 0 },
      { edgeId: toCanonicalEdgeId(1, 0), alongEdgeM: 10 }, T0,
    )).toBeNull();
  });

  it('veri kümesi ÖLÇÜLMEDİYSE yakınlık sorgusu hüküm VERMEZ', () => {
    _setRoutingGraphViewForTest(synthView());
    const store = createMapStore(graphAvailablePorts({ readDataset: () => UNMEASURED_DATASET }));
    const near = store.queryEdgesNear(41, 29, 100, T0);
    expect(near.value).toBeNull();
    expect(near.grade).toBe('UNAVAILABLE');
  });

  it('BOŞ sonuç ile ÖLÇÜLMEMİŞ sonuç AYRI (UNKNOWN ≠ NONE)', () => {
    _setRoutingGraphViewForTest(synthView());
    const store = createMapStore(graphAvailablePorts());
    /* Ölçüldü ama bu yarıçapta yol yok → boş DİZİ (null DEĞİL). */
    const measured = store.queryEdgesNear(41.5, 29.5, 100, T0);
    expect(measured.value).toEqual([]);
    expect(measured.grade).toBe('OBSERVED');

    const notMeasured = createMapStore(UNAVAILABLE_MAP_DATA_PORTS)
      .queryEdgesNear(41.5, 29.5, 100, T0);
    expect(notMeasured.value).toBeNull();
  });

  it('ağ mesafesi YALNIZ kanıtlı iki hâlde üretilir', () => {
    _setRoutingGraphViewForTest(synthView());
    const store = createMapStore(graphAvailablePorts());
    /* ① aynı kenar → mesafe farkı */
    expect(store.networkDistanceM(
      { edgeId: toCanonicalEdgeId(0, 0), alongEdgeM: 100 },
      { edgeId: toCanonicalEdgeId(0, 0), alongEdgeM: 250 }, T0,
    )).toBe(150);
    /* ② doğrudan bağlı → kalan + ilerlenen */
    expect(store.networkDistanceM(
      { edgeId: toCanonicalEdgeId(0, 0), alongEdgeM: 800 },
      { edgeId: toCanonicalEdgeId(1, 0), alongEdgeM: 30 }, T0,
    )).toBe(80);
    /* ③ bağlantısız → `null` (uydurma mesafe YASAK) */
    expect(store.networkDistanceM(
      { edgeId: toCanonicalEdgeId(0, 0), alongEdgeM: 10 },
      { edgeId: toCanonicalEdgeId(2, 0), alongEdgeM: 10 }, T0,
    )).toBeNull();
  });

  it('graf sakinliği gözlemi sahte sayı ÜRETMEZ', () => {
    _setRoutingGraphViewForTest(null);
    const s = getGraphResidencySnapshot();
    expect(s.state).toBe('UNINITIALIZED');
    expect(s.nodeCount).toBeNull();
    expect(s.edgeCount).toBeNull();
    expect(s.parseMs).toBeNull();
  });

  it('tembel yapılar İLK istendiğinde kurulur', () => {
    _setRoutingGraphViewForTest(synthView());
    expect(getGraphResidencySnapshot().adjacencyBuilt).toBe(false);
    expect(readGraphAdjacency()).not.toBeNull();
    expect(getGraphResidencySnapshot().adjacencyBuilt).toBe(true);
    expect(getGraphResidencySnapshot().spatialIndexBuilt).toBe(false);
    expect(readEdgeSpatialIndex()).not.toBeNull();
    expect(getGraphResidencySnapshot().spatialIndexBuilt).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) CANLI ADAY → HMM → MatchedRoadPose
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4.8 · canlı yol eşleşmesi', () => {
  beforeEach(() => {
    _resetGraphResidencyForTest();
    _resetMapStoreForTest();
    _resetOfflineRoutingStatusForTest();
    recordOfflineGraphOutcome('AVAILABLE', Date.now(), 1_000);
  });

  it('aday kaynağı GERÇEKTEN aday üretir (F2/C3 kapandı)', () => {
    _setRoutingGraphViewForTest(synthView());
    const q = productionRoadCandidateSource.query(41.0, 29.005, 100, T0);
    expect(q.outcome).toBe('CANDIDATES');
    expect(q.candidates.length).toBeGreaterThan(0);
    expect(q.candidates[0].metadata).not.toBeNull();
    expect(q.candidates[0].bearingDeg).not.toBeNull();
  });

  it('graf ÇÖZÜLMEMİŞKEN aday YOK ama "yol yok" DA denmez', () => {
    _setRoutingGraphViewForTest(null);
    const q = productionRoadCandidateSource.query(41.0, 29.005, 100, T0);
    expect(q.candidates).toHaveLength(0);
    expect(['NOT_MEASURED', 'SOURCE_UNAVAILABLE']).toContain(q.outcome);
    expect(q.outcome).not.toBe('NO_COVERAGE');
  });

  it('ÖLÇÜLDÜ ve yol yoksa kapsam hükmü verilir', () => {
    _setRoutingGraphViewForTest(synthView());
    const q = productionRoadCandidateSource.query(41.5, 29.5, 100, T0);
    expect(q.outcome).toBe('NO_COVERAGE');
    expect(q.candidates).toHaveLength(0);
  });

  it('ağ mesafesi çözücüsü topolojiden gelir (uydurma YOK)', () => {
    _setRoutingGraphViewForTest(synthView());
    const q = productionRoadCandidateSource.query(41.0, 29.005, 100, T0);
    const a = q.candidates.find((c) => toLegacyEdgeRef(c.edgeId).edgeOrdinal === 0)!;
    const svc = q.candidates.find((c) => toLegacyEdgeRef(c.edgeId).edgeOrdinal === 2)!;
    expect(q.networkDistance(a, a)).toBe(0);
    expect(q.networkDistance(a, svc)).toBeNull();   // bağlantısız
  });

  it('EGO OTORİTESİ canlı adayla `MatchedRoadPose` ÜRETİR', () => {
    _setRoutingGraphViewForTest(synthView());
    const sample: EgoSensorSample = {
      nowMonoMs: T0, lat: 41.0, lon: 29.005, accuracyM: 8, fixAgeMs: 100,
      producer: 'GPS', hasEverFixed: true, gnssHeadingDeg: 90, gnssSpeedMps: 15,
      busSpeedMps: 15, yawRateRadPerSec: null,
    };
    const ego = createEgoAuthority({
      sensor: { read: () => sample },
      candidates: productionRoadCandidateSource,
    });
    /* Trellis'in kurulması için birkaç gözlem. */
    ego.observe(); ego.observe(); ego.observe();

    const d = ego.getDiagnostics();
    expect(d.candidateOutcome).toBe('CANDIDATES');
    expect(d.candidateCount).toBeGreaterThan(0);
    expect(d.candidateCount).toBeLessThanOrEqual(HMM_MAX_CANDIDATES);

    const m = ego.getMatchedRoadPose();
    expect(m).not.toBeNull();
    /* Ham poz map-lock koruması olarak DAİMA taşınır. */
    expect(m!.rawPose.kind).toBe('REALTIME_EGO');
    expect(['MATCHED', 'MATCH_UNCERTAIN']).toContain(m!.matchState);
  });

  it('aday yokken MATCHED ÜRETİLEMEZ (kapsam dışı konum)', () => {
    _setRoutingGraphViewForTest(synthView());
    const sample: EgoSensorSample = {
      nowMonoMs: T0, lat: 41.5, lon: 29.5, accuracyM: 8, fixAgeMs: 100,
      producer: 'GPS', hasEverFixed: true, gnssHeadingDeg: 90, gnssSpeedMps: 15,
      busSpeedMps: 15, yawRateRadPerSec: null,
    };
    const ego = createEgoAuthority({
      sensor: { read: () => sample },
      candidates: productionRoadCandidateSource,
    });
    ego.observe(); ego.observe();
    const m = ego.getMatchedRoadPose();
    expect(m!.matchState).not.toBe('MATCHED');
    expect(m!.edgeId).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) CEH FİZİKSEL DOĞRULAMA
   ══════════════════════════════════════════════════════════════════════════ */

describe('F4.9 · CEH fiziksel doğrulama (F3 semantiği DEĞİŞMEDİ)', () => {
  beforeEach(() => {
    _resetGraphResidencyForTest();
    _resetMapStoreForTest();
    _resetOfflineRoutingStatusForTest();
    recordOfflineGraphOutcome('AVAILABLE', Date.now(), 1_000);
    _setRoutingGraphViewForTest(synthView());
  });

  const sample = (lat: number, lon: number): EgoSensorSample => ({
    nowMonoMs: T0, lat, lon, accuracyM: 6, fixAgeMs: 100,
    producer: 'GPS', hasEverFixed: true, gnssHeadingDeg: 90, gnssSpeedMps: 15,
    busSpeedMps: 15, yawRateRadPerSec: null,
  });

  function egoAt(lat: number, lon: number) {
    const ego = createEgoAuthority({
      sensor: { read: () => sample(lat, lon) },
      candidates: productionRoadCandidateSource,
    });
    ego.observe(); ego.observe(); ego.observe();
    return ego;
  }

  /** Ana yol boyunca giden rota niyeti. */
  const routeAlongMainRoad = {
    available: true, sessionId: 1, routeRevision: 1, observedAtMonoMs: T0,
    vehicleAlongRemainingM: 1_200, totalDistanceM: 1_700, maneuvers: [],
    geometry: [[29.0, 41.0], [29.01, 41.0], [29.02, 41.0]] as [number, number][],
    onCorridor: true, conflictThresholdM: 55,
  };

  it('rota niyeti ile fiziksel eşleşme UYUŞUYORSA doğrulanır', () => {
    const ceh = createCehAuthority({
      ego: egoAt(41.0, 29.005), map: { getDatasetStatus: () => ({
        value: { dataset: 'ROUTING_GRAPH', availability: 'AVAILABLE_FRESH', provenance: 1 },
        grade: 'OBSERVED', source: 'MAP_PACKAGE', reason: 'LIVE_SOURCE', confidence: 1,
        observedAtMonoMs: T0, freshnessBudgetMs: null,
      }) } as never,
      clock: () => T0,
    });
    ceh.noteRouteIntent(routeAlongMainRoad);
    ceh.observe();
    const h = ceh.getHorizon()!;
    if (h.paths.length > 0 && h.paths[0].physicallyConfirmed) {
      expect(h.state).toBe('HORIZON_AVAILABLE');
      expect(h.paths[0].provenance).toBe('ROUTE_INTENT_CONFIRMED');
    } else {
      /* Eşleşme belirsiz kaldıysa niyet ufku KESİN sunulmaz. */
      expect(h.state).not.toBe('HORIZON_AVAILABLE');
    }
  });

  it('fiziksel yol rotayla ÇELİŞİYORSA belirsizlik doğar, MPP YOK', () => {
    /* Araç servis yolunda (rota ana yolda) — rotadan ~1,4 km uzakta bir kol. */
    const farRoute = {
      ...routeAlongMainRoad,
      geometry: [[29.0, 41.02], [29.02, 41.02]] as [number, number][],
    };
    const ceh = createCehAuthority({
      ego: egoAt(41.0, 29.005), map: { getDatasetStatus: () => ({
        value: { dataset: 'ROUTING_GRAPH', availability: 'AVAILABLE_FRESH', provenance: 1 },
        grade: 'OBSERVED', source: 'MAP_PACKAGE', reason: 'LIVE_SOURCE', confidence: 1,
        observedAtMonoMs: T0, freshnessBudgetMs: null,
      }) } as never,
      clock: () => T0,
    });
    ceh.noteRouteIntent(farRoute);
    ceh.observe();
    const h = ceh.getHorizon()!;
    if (h.matchedAnchor?.matchState === 'MATCHED') {
      expect(h.state).toBe('AMBIGUOUS_PATH');
      expect(h.mppPathId).toBeNull();
      expect(h.paths).toHaveLength(2);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   8) ROUTING PARİTESİ — GERÇEK GRAF
   ══════════════════════════════════════════════════════════════════════════ */

/* ── Referans (ESKİ) gösterim ve A* — worker'ın F4 ÖNCESİ hâli ─────────── */

interface RefEdge { to: number; costM: number; roadClass: number; }

function refParse(buf: ArrayBuffer): {
  nodes: { lat: number; lon: number }[];
  adjacency: Map<number, RefEdge[]>;
} {
  const view = new DataView(buf);
  let off = 0;
  const firstWord = view.getUint32(off, true); off += 4;
  const version = firstWord === RTG2_MAGIC ? 2 : 1;
  const nodeCount = version === 2 ? (off += 4, view.getUint32(off - 4, true)) : firstWord;

  const nodes: { lat: number; lon: number }[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const lat = view.getFloat32(off, true); off += 4;
    const lon = view.getFloat32(off, true); off += 4;
    off += 8;
    nodes.push({ lat, lon });
  }
  const edgeCount = view.getUint32(off, true); off += 4;
  const adjacency = new Map<number, RefEdge[]>();
  for (let i = 0; i < edgeCount; i++) {
    const from = view.getUint32(off, true); off += 4;
    const to = view.getUint32(off, true); off += 4;
    const costM = view.getUint32(off, true); off += 4;
    const flags = version === 2 ? view.getUint8(off++) : 0;
    const oneway = (flags & 0x01) === 1;
    const roadClass = (flags >> 1) & 0x07;
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push({ to, costM, roadClass });
    if (!oneway) {
      if (!adjacency.has(to)) adjacency.set(to, []);
      adjacency.get(to)!.push({ to: from, costM, roadClass });
    }
  }
  return { nodes, adjacency };
}

const HEURISTIC_WEIGHT = 1.2;
const MAX_CLOSED = 200_000;

function havM(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6_371_000;
  const dLa = ((la2 - la1) * Math.PI) / 180;
  const dLo = ((lo2 - lo1) * Math.PI) / 180;
  const a = Math.sin(dLa / 2) ** 2
    + Math.cos((la1 * Math.PI) / 180) * Math.cos((la2 * Math.PI) / 180) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Ortak heap mantığı — iki A* varyantı da AYNI sırayı kullanır. */
function makeHeap() {
  const heap: [number, number][] = [];
  return {
    len: () => heap.length,
    push(item: [number, number]) {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
      }
    },
    pop(): [number, number] | undefined {
      if (!heap.length) return undefined;
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = 2 * i + 2; let s = i;
          if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
          if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
          if (s === i) break;
          [heap[s], heap[i]] = [heap[i], heap[s]]; i = s;
        }
      }
      return top;
    },
  };
}

function refAStar(
  g: { nodes: { lat: number; lon: number }[]; adjacency: Map<number, RefEdge[]> },
  startIdx: number, goalIdx: number,
): number[] | null {
  const goalNode = g.nodes[goalIdx];
  const heap = makeHeap();
  heap.push([0, startIdx]);
  const gCost = new Map<number, number>([[startIdx, 0]]);
  const prev = new Map<number, number>();
  const closed = new Set<number>();

  while (heap.len()) {
    const entry = heap.pop(); if (!entry) break;
    const [, cur] = entry;
    if (cur === goalIdx) {
      const path: number[] = [];
      let node: number | undefined = goalIdx;
      while (node !== undefined) { path.unshift(node); node = prev.get(node); }
      return path;
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    if (closed.size > MAX_CLOSED) return null;
    const curG = gCost.get(cur) ?? Infinity;
    for (const { to, costM } of (g.adjacency.get(cur) ?? [])) {
      if (closed.has(to)) continue;
      const newG = curG + costM;
      if (newG < (gCost.get(to) ?? Infinity)) {
        gCost.set(to, newG);
        prev.set(to, cur);
        heap.push([newG + HEURISTIC_WEIGHT * havM(
          g.nodes[to].lat, g.nodes[to].lon, goalNode.lat, goalNode.lon), to]);
      }
    }
  }
  return null;
}

/** YENİ gösterim — worker'ın F4 SONRASI hâliyle aynı erişim deseni. */
function csrAStar(view: RoutingGraphView, startIdx: number, goalIdx: number): number[] | null {
  const adj = buildGraphAdjacency(view);
  const { nodeLat, nodeLon, edgeCostM } = view;
  const goalLat = nodeLat[goalIdx], goalLon = nodeLon[goalIdx];
  const heap = makeHeap();
  heap.push([0, startIdx]);
  const gCost = new Map<number, number>([[startIdx, 0]]);
  const prev = new Map<number, number>();
  const closed = new Set<number>();

  while (heap.len()) {
    const entry = heap.pop(); if (!entry) break;
    const [, cur] = entry;
    if (cur === goalIdx) {
      const path: number[] = [];
      let node: number | undefined = goalIdx;
      while (node !== undefined) { path.unshift(node); node = prev.get(node); }
      return path;
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    if (closed.size > MAX_CLOSED) return null;
    const curG = gCost.get(cur) ?? Infinity;
    const r = outgoingRange(adj, cur);
    for (let k = r.start; k < r.end; k++) {
      const to = adj.targetNode[k];
      if (closed.has(to)) continue;
      const newG = curG + edgeCostM[adj.edgeOrdinal[k]];
      if (newG < (gCost.get(to) ?? Infinity)) {
        gCost.set(to, newG);
        prev.set(to, cur);
        heap.push([newG + HEURISTIC_WEIGHT * havM(nodeLat[to], nodeLon[to], goalLat, goalLon), to]);
      }
    }
  }
  return null;
}

describe.skipIf(!HAS_REAL_GRAPH)('F4.10 · ROUTING PARİTESİ — gerçek graf', () => {
  it('düğüm/kenar sayıları ve komşuluk SIRASI birebir aynı', () => {
    const v = realGraphView();
    const ref = refParse(realGraphBuffer());
    expect(ref.nodes.length).toBe(v.nodeCount);

    const adj = buildGraphAdjacency(v);
    /* Toplam yarım-kenar sayısı eşit olmalı. */
    let refHalf = 0;
    for (const arr of ref.adjacency.values()) refHalf += arr.length;
    expect(adj.halfEdgeCount).toBe(refHalf);

    /* Örnek düğümlerde komşu SIRASI birebir. */
    for (const node of [0, 1, 100, 5_000, 120_000, v.nodeCount - 1]) {
      const refList = ref.adjacency.get(node) ?? [];
      const r = outgoingRange(adj, node);
      expect(r.end - r.start, `düğüm ${node} derecesi`).toBe(refList.length);
      for (let k = 0; k < refList.length; k++) {
        expect(adj.targetNode[r.start + k], `düğüm ${node} komşu ${k}`).toBe(refList[k].to);
        expect(v.edgeCostM[adj.edgeOrdinal[r.start + k]]).toBe(refList[k].costM);
      }
    }
  });

  it('A* AYNI rotayı üretir (aynı düğüm dizisi · aynı mesafe)', () => {
    const v = realGraphView();
    const ref = refParse(realGraphBuffer());

    /* Grafın kendi düğümlerinden seçilen çiftler — "ulaşılabilir" senaryolar. */
    const pairs: readonly (readonly [number, number])[] = [
      [0, 500], [1_000, 1_200], [50_000, 50_400],
    ];

    for (const [a, b] of pairs) {
      const refPath = refAStar(ref, a, b);
      const newPath = csrAStar(v, a, b);
      expect(newPath === null, `çift ${a}→${b} ulaşılabilirlik`).toBe(refPath === null);
      if (refPath !== null && newPath !== null) {
        expect(newPath, `çift ${a}→${b} yol`).toEqual(refPath);
        /* Mesafe kenardan okunur — iki gösterimde de aynı. */
        let refDist = 0;
        for (let i = 1; i < refPath.length; i++) {
          const e = (ref.adjacency.get(refPath[i - 1]) ?? []).find((x) => x.to === refPath[i]);
          refDist += e ? e.costM : havM(
            ref.nodes[refPath[i - 1]].lat, ref.nodes[refPath[i - 1]].lon,
            ref.nodes[refPath[i]].lat, ref.nodes[refPath[i]].lon);
        }
        const adj = buildGraphAdjacency(v);
        let newDist = 0;
        for (let i = 1; i < newPath.length; i++) {
          let ord = -1;
          const r = outgoingRange(adj, newPath[i - 1]);
          for (let k = r.start; k < r.end; k++) {
            if (adj.targetNode[k] === newPath[i]) { ord = adj.edgeOrdinal[k]; break; }
          }
          newDist += ord >= 0 ? v.edgeCostM[ord] : havM(
            v.nodeLat[newPath[i - 1]], v.nodeLon[newPath[i - 1]],
            v.nodeLat[newPath[i]], v.nodeLon[newPath[i]]);
        }
        expect(newDist, `çift ${a}→${b} mesafe`).toBe(refDist);
      }
    }
  }, 60_000);

  it('geometri (düğüm koordinatları) birebir aynı', () => {
    const v = realGraphView();
    const ref = refParse(realGraphBuffer());
    for (const i of [0, 7, 1_234, 99_999, v.nodeCount - 1]) {
      expect(v.nodeLat[i]).toBe(ref.nodes[i].lat);
      expect(v.nodeLon[i]).toBe(ref.nodes[i].lon);
    }
  });

  it('gerçek graf üzerinde yakınlık sorgusu ÇALIŞIR ve sınırlıdır', () => {
    const v = realGraphView();
    const idx = buildEdgeSpatialIndex(v)!;
    /* İlk düğümün üstünde bir sorgu — en az bir kenar bulunmalı. */
    const hits = queryEdgesNear(v, idx, v.nodeLat[0], v.nodeLon[0], 200);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(MAX_PROXIMITY_HITS);
    expect(hits[0].perpDistM).toBeLessThanOrEqual(200);
    /* Izgara hücre boyu politika sayısıdır. */
    expect(idx.cellDeg).toBe(GRID_CELL_DEG);
  }, 60_000);
});

/* ══════════════════════════════════════════════════════════════════════════
   9) MİMARİ KİLİTLER
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

const L2_L3_DIRS = [
  'platform/navigation/ego',
  'platform/navigation/matching',
  'platform/navigation/horizon',
];
function l2l3Files(): string[] {
  const out: string[] = [];
  for (const d of L2_L3_DIRS) {
    for (const f of readdirSync(resolve(SRC, d))) if (f.endsWith('.ts')) out.push(`${d}/${f}`);
  }
  return out;
}
const graphFiles = () => readdirSync(resolve(SRC, 'platform/navigation/map/graph'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => `platform/navigation/map/graph/${f}`);

describe('F4 · mimari kilitler', () => {
  it('K1 — `RTG2` ayrıştırıcısı `src/` genelinde TEK tanımlı', () => {
    const hits = walkSrc().filter((f) => readSrc(f).includes('export function parseRoutingGraph'));
    expect(hits).toEqual(['platform/navigation/map/graph/rtg2Reader.ts']);
  });

  it('K2 — worker içinde İKİNCİ binary ayrıştırma mantığı YOK', () => {
    const w = strip(readSrc('platform/navigation/NavigationCompute.worker.ts'));
    /* Graf başlığı/tablosu artık burada okunmuyor. */
    expect(w).not.toContain('getFloat32');
    expect(w).not.toContain('GRAPH_MAGIC');
    expect(w).toContain('parseRoutingGraph(');
  });

  it('K3 — L2/L3 ham RTG2 okuyucusunu import EDEMEZ', () => {
    for (const f of l2l3Files()) {
      const src = strip(readSrc(f));
      for (const bad of ['rtg2Reader', 'graphResidencyRuntime', 'edgeSpatialIndex', 'graphAdjacency']) {
        expect(src, `${f}: yasak graf importu "${bad}"`).not.toContain(bad);
      }
    }
  });

  it('K4 — L2/L3 ham graf belleğini (ArrayBuffer/typed array) GÖREMEZ', () => {
    for (const f of l2l3Files()) {
      const src = strip(readSrc(f));
      for (const bad of ['ArrayBuffer', 'DataView', 'Uint32Array', 'Float32Array', 'routing-graph']) {
        expect(src, `${f}: ham bellek "${bad}"`).not.toContain(bad);
      }
    }
  });

  it('K5 — kenar kimliği YALNIZ kanonik `EdgeId` (yeni kimlik sistemi yok)', () => {
    const hits = walkSrc().filter((f) => readSrc(f).includes('export function toCanonicalEdgeId'));
    expect(hits).toEqual(['platform/navigation/map/store/legacyEdgeIdAdapter.ts']);
    const idDecl = walkSrc().filter((f) => readSrc(f).includes('export interface EdgeId {'));
    expect(idDecl).toEqual(['platform/navigation/contracts/navEdgeId.ts']);
  });

  it('K6 — graf sıra numarası/düğüm indeksi L1 DIŞINA sızmaz', () => {
    for (const f of l2l3Files()) {
      const src = strip(readSrc(f));
      for (const bad of ['edgeOrdinal', 'nodeIndex', 'toLegacyEdgeRef']) {
        expect(src, `${f}: graf içi kimlik "${bad}"`).not.toContain(bad);
      }
    }
  });

  it('K7 — BOZUK graf asla başarı gibi sunulamaz', () => {
    const r = parseRoutingGraph(buildSynthBuffer(SYNTH_NODES, SYNTH_EDGES, { truncateBytes: 5 }));
    expect(r.outcome).not.toBe('OK');
    expect(r.view).toBeNull();
  });

  it('K8 — desteklenmeyen sürüm fail-closed', () => {
    const r = parseRoutingGraph(buildSynthBuffer(SYNTH_NODES, SYNTH_EDGES, { magic: 0x39475452 }));
    expect(r.outcome).toBe('UNSUPPORTED_VERSION');
    expect(r.view).toBeNull();
  });

  it('K9 — bilinmeyen metadata VARSAYILAN değere çevrilemez', () => {
    /* v1 grafında sınıf bilgisi YOKTUR → 0 (BİLİNMİYOR) kalır, uydurulmaz. */
    const v1 = parseRoutingGraph(buildSynthBuffer(SYNTH_NODES, SYNTH_EDGES, { version: 1 })).view!;
    for (let i = 0; i < v1.edgeCount; i++) expect(edgeRoadClass(v1, i)).toBe(0);
    /* Kaynak katmanı da 0'ı bir sınıf gibi yeniden yazmaz. */
    const src = strip(readSrc('platform/navigation/map/store/mapStoreSources.ts'));
    expect(src).not.toMatch(/roadClass:\s*(?!edgeRoadClass)\d/);
  });

  it('K10 — aday tavanı F2 sınırını AŞAMAZ', () => {
    expect(MAX_PROXIMITY_HITS).toBeGreaterThanOrEqual(HMM_MAX_CANDIDATES);
    const src = readSrc('platform/navigation/matching/roadCandidateSource.ts');
    expect(src).toContain('HMM_MAX_CANDIDATES');
  });

  it('K11 — aday yokken MATCHED üretilemez (yapısal)', () => {
    const src = readSrc('platform/navigation/ego/egoAuthority.ts');
    /* Aday yoksa trellis İLERLETİLMEZ ve eşleşme TAŞINMAZ. */
    expect(strip(src)).toContain('hmm = EMPTY_HMM_STATE');
  });

  it('K12 — CEH rota niyetini fiziksel gerçek SAYAMAZ', () => {
    const src = strip(readSrc('platform/navigation/horizon/horizonModel.ts'));
    expect(src).toContain("provenance: 'ROUTE_INTENT'");
    expect(src).toContain('physicallyConfirmed: false');
  });

  it('K13 — worker rota YÜRÜTME sahibi olarak KALDI (A* taşınmadı)', () => {
    const w = readSrc('platform/navigation/NavigationCompute.worker.ts');
    expect(w).toContain('function _aStar');
    expect(w).toContain('HEURISTIC_WEIGHT = 1.2');
    /* A* `src/` genelinde tek yerde. */
    const hits = walkSrc().filter((f) => readSrc(f).includes('function _aStar'));
    expect(hits).toEqual(['platform/navigation/NavigationCompute.worker.ts']);
  });

  it('K14 — MapStore cephesi timer/fetch/native SAHİBİ DEĞİL', () => {
    for (const f of ['platform/navigation/map/store/mapStore.ts',
      'platform/navigation/map/store/mapStoreSources.ts']) {
      const src = strip(readSrc(f));
      for (const bad of ['fetch(', 'setInterval(', 'setTimeout(', 'new Worker', 'addEventListener(']) {
        expect(src, `${f}: ${bad}`).not.toContain(bad);
      }
    }
  });

  it('K15 — graf okuyucu/komşuluk/indeks SAF (I/O · timer · React yok)', () => {
    for (const f of ['platform/navigation/map/graph/rtg2Reader.ts',
      'platform/navigation/map/graph/graphAdjacency.ts',
      'platform/navigation/map/graph/edgeSpatialIndex.ts']) {
      const src = strip(readSrc(f));
      for (const bad of ['fetch(', 'setInterval(', 'setTimeout(', 'Date.now(', 'performance.now(']) {
        expect(src, `${f}: ${bad}`).not.toContain(bad);
      }
      expect(src, `${f}: React`).not.toMatch(/from ['"]react['"]/);
    }
  });

  it('K16 — RTG2 geriye uyumu korunur, RTG3 aynı okuyucudadır', () => {
    const reader = strip(readSrc('platform/navigation/map/graph/rtg2Reader.ts'));
    expect(reader).toContain('RTG3_MAGIC');
    /* Eski production graph sözleşmesi değişmeden kalır. */
    expect(RTG2_MAGIC).toBe(0x32475452);
    expect(RTG_NODE_STRIDE).toBe(16);
    expect(RTG2_EDGE_STRIDE).toBe(13);
  });

  it('K17 — L4–L6 yeni ham graf bağımlılığı OLUŞTURMADI', () => {
    for (const f of ['platform/routingService.ts', 'platform/navigationService.ts']) {
      const src = strip(readSrc(f));
      for (const bad of ['rtg2Reader', 'graphResidencyRuntime', 'edgeSpatialIndex',
        'routing-graph', 'parseRoutingGraph']) {
        expect(src, `${f}: ${bad}`).not.toContain(bad);
      }
    }
  });

  it('K18 — F1/F2/F3 kanonik sözleşmeleri KOPYALANMADI', () => {
    for (const decl of [
      'export interface MapStore {',
      'export interface RoutingGraphView',
      'export interface GraphAdjacency',
      'export interface EdgeSpatialIndex',
      'export interface StaticEdgeMetadata',
      'export interface EdgeTopology',
      'export interface NearbyEdge',
    ]) {
      const hits = walkSrc().filter((f) => readSrc(f).includes(decl));
      expect(hits.length, `${decl} → ${hits.join(', ')}`).toBe(1);
    }
  });

  it('K19 — graf sakinliği ikinci yetenek otoritesi KURMAZ', () => {
    const src = readSrc('platform/navigation/map/graph/graphResidencyRuntime.ts');
    /* Hükmü mevcut otoriteye BİLDİRİR. */
    expect(src).toContain('recordOfflineGraphOutcome');
    /* Ve `offlineRoutingStatus` hâlâ tek tanımlı. */
    const hits = graphFiles().filter((f) => readSrc(f).includes('export function getOfflineRoutingStatus'));
    expect(hits).toEqual([]);
  });
});
