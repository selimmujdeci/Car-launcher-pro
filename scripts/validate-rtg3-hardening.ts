/**
 * validate-rtg3-hardening.ts — RTG3 gölge doğrulaması (KANONİK worker ile).
 *
 * İkinci router YOKTUR: rotalar `NavigationCompute.worker` içindeki tek A*
 * otoritesiyle çözülür. Bu dosya yalnız ölçer ve kanıt yazar.
 *
 * BEFORE/AFTER: `BEFORE` bacağı, `git show HEAD:` ile üretilmiş via-way
 * KAYITSIZ artefaktları kullanır (aynı kod, via-way'siz graf). Böylece ölçülen
 * fark yalnız via-way desteğinin maliyetidir.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  edgeAccessRole, parseRoutingGraph, turnIsAllowed, viaWayStep,
  type RoutingGraphView,
} from '../src/platform/navigation/map/graph/rtg2Reader';
import {
  acquireRegionalRoutingGraph, releaseRoutingGraph, _resetGraphResidencyForTest,
} from '../src/platform/navigation/map/graph/graphResidencyRuntime';
import {
  validateTurkeyGraphManifest, type TurkeyGraphManifest,
} from '../src/platform/navigation/map/graph/turkeyGraphManifest';

const root = resolve('field-runs/pbf-streaming-rtg3-20260908');
const beforeRoot = resolve(root, 'tmp/before');
const REPEATS = Number(process.env.RTG3_ROUTE_REPEATS ?? 15);

type Posted = { type: string; requestId?: string; geometry?: [number, number][]; distanceM?: number; durationS?: number; reason?: string; postedAtMs?: number };
const posted: Posted[] = [];
const workerSelf = {
  navigator: { deviceMemory: 8 },
  /* Cozum suresi POLLING granulasyonundan degil, postMessage anindan olculur. */
  postMessage: (message: Posted) => posted.push({ ...message, postedAtMs: performance.now() }),
  close: () => {},
  onmessage: null as ((event: MessageEvent) => void) | null,
};
Object.assign(globalThis, { self: workerSelf });
await import('../src/platform/navigation/NavigationCompute.worker');

/* ── Artefakt yükleyici ──────────────────────────────────────────────────── */

interface Leg {
  readonly label: 'BEFORE' | 'AFTER';
  readonly manifest: TurkeyGraphManifest;
  readonly buffers: Map<string, Buffer>;
}

function leg(label: 'BEFORE' | 'AFTER', dir: string): Leg | null {
  const manifestPath = resolve(dir, 'turkey-graph-manifest.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = validateTurkeyGraphManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  if (!manifest) throw new Error(`${label}: manifest geçersiz`);
  const buffers = new Map(manifest.regions.map((r) => [r.graphFile, readFileSync(resolve(dir, r.graphFile))]));
  return { label, manifest, buffers };
}

const after = leg('AFTER', root)!;
const before = leg('BEFORE', beforeRoot);
let active: Leg = after;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const key = String(input).replace(/^.*\/regions\//, 'regions/');
  const data = active.buffers.get(key);
  return data ? new Response(data) : new Response(null, { status: 404 });
}) as typeof fetch;

const rawView = (legToRead: Leg, regionId: string): RoutingGraphView => {
  const region = legToRead.manifest.regions.find((r) => r.regionId === regionId)!;
  const buffer = legToRead.buffers.get(region.graphFile)!;
  const parsed = parseRoutingGraph(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
  if (!parsed.view) throw new Error(`${regionId}: ${parsed.outcome} ${parsed.detail}`);
  return parsed.view;
};

/* ── Worker köprüsü ─────────────────────────────────────────────────────── */

async function install(ids: string[]): Promise<RoutingGraphView> {
  _resetGraphResidencyForTest();
  const view = await acquireRegionalRoutingGraph(active.manifest, ids, '/fixture');
  if (!view) throw new Error(`Residency düştü: ${ids}`);
  const requestId = `install-${active.label}-${ids.join('-')}`;
  workerSelf.onmessage!({ data: { type: 'INSTALL_REGIONAL_GRAPH', requestId, graphView: view } } as MessageEvent);
  if (!posted.splice(0).some((m) => m.type === 'GRAPH_INSTALLED' && m.requestId === requestId)) throw new Error('Worker install düştü');
  return view;
}

async function solve(name: string, from: readonly [number, number], to: readonly [number, number]): Promise<{ result: Posted | undefined; ms: number }> {
  const requestId = `route-${name}-${Math.random().toString(36).slice(2)}`;
  const start = performance.now();
  workerSelf.onmessage!({ data: { type: 'COMPUTE_ROUTE', requestId, fromLat: from[0], fromLon: from[1], toLat: to[0], toLon: to[1] } } as MessageEvent);
  for (let i = 0; i < 800 && !posted.some((m) => m.requestId === requestId); i++) await new Promise((r) => setTimeout(r, 2));
  const result = posted.splice(0).find((m) => m.requestId === requestId);
  return { result, ms: (result?.postedAtMs ?? performance.now()) - start };
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))].toFixed(2)) : null;
};

/** Rota geometrisini kenar sıra numaralarına çözer (kanonik görünüm üzerinden). */
function edgeSequence(view: RoutingGraphView, geometry: [number, number][]): { ordinals: number[]; nodes: number[] } {
  const nodeByCoordinate = new Map<string, number>();
  for (let i = 0; i < view.nodeCount; i++) nodeByCoordinate.set(`${view.nodeLat[i]},${view.nodeLon[i]}`, i);
  const edgeByPair = new Map<string, number>();
  for (let i = 0; i < view.edgeCount; i++) {
    edgeByPair.set(`${view.edgeFrom[i]}:${view.edgeTo[i]}`, i);
    if (view.edgeDirection[i] === 0) edgeByPair.set(`${view.edgeTo[i]}:${view.edgeFrom[i]}`, i);
  }
  const ordinals: number[] = [];
  const nodes: number[] = [];
  for (let i = 1; i < geometry.length; i++) {
    const a = nodeByCoordinate.get(`${geometry[i - 1][1]},${geometry[i - 1][0]}`);
    const b = nodeByCoordinate.get(`${geometry[i][1]},${geometry[i][0]}`);
    ordinals.push(a === undefined || b === undefined ? -1 : (edgeByPair.get(`${a}:${b}`) ?? -1));
    nodes.push(a ?? -1);
  }
  return { ordinals, nodes };
}

const WARMUP = Number(process.env.RTG3_ROUTE_WARMUP ?? 3);

async function routeCorpus(name: string, ids: string[], from: readonly [number, number], to: readonly [number, number]) {
  const view = await install(ids);
  const samples: number[] = [];
  let last: Posted | undefined;
  /* JIT/GC isinmasi olcumden DISLANIR; aksi halde ilk bacak sistematik olarak
     yavas gorunur ve BEFORE/AFTER karsilastirmasi anlamsizlasir. */
  for (let i = 0; i < WARMUP; i++) await solve(name, from, to);
  for (let i = 0; i < REPEATS; i++) { const run = await solve(name, from, to); samples.push(run.ms); last = run.result; }
  releaseRoutingGraph();
  if (last?.type !== 'ROUTE_RESULT' || !last.geometry || !last.distanceM) throw new Error(`${name}: ${last?.reason ?? 'rota yok'}`);
  const endpoint = last.geometry.at(-1)!;
  const { ordinals, nodes } = edgeSequence(view, last.geometry);
  let previousEdge = -1, accessLegal = true, onewayLegal = true, restrictionLegal = true, viaWayMask = 0;
  for (let i = 0; i < ordinals.length; i++) {
    const edge = ordinals[i];
    if (edge < 0 || nodes[i] < 0) { onewayLegal = false; continue; }
    if (edgeAccessRole(view, edge) !== 1 && !(i === ordinals.length - 1 && edgeAccessRole(view, edge) === 2)) accessLegal = false;
    if (!turnIsAllowed(view, previousEdge, edge, nodes[i])) restrictionLegal = false;
    const next = viaWayStep(view, previousEdge, viaWayMask, nodes[i], edge);
    if (next < 0) restrictionLegal = false; else viaWayMask = next;
    previousEdge = edge;
  }
  return {
    name, regions: ids, distanceM: last.distanceM,
    solveP50Ms: percentile(samples, 0.5), solveP95Ms: percentile(samples, 0.95), samples: samples.length,
    endpointErrorM: Number(Math.hypot((endpoint[1] - to[0]) * 111_000, (endpoint[0] - to[1]) * 90_000).toFixed(2)),
    accessLegal, onewayLegal, restrictionLegal,
    nodeCount: view.nodeCount, edgeCount: view.edgeCount, restrictionCount: view.restrictionCount,
    viaWayChains: view.viaWay?.chainCount ?? 0,
  };
}

/* ── Rota noktaları (BEFORE/AFTER için AYNI seçim kuralı) ────────────────── */

const inside = (region: TurkeyGraphManifest['regions'][number], lat: number, lon: number) =>
  lon > region.bbox[0] + 0.01 && lon < region.bbox[2] - 0.01 && lat > region.bbox[1] + 0.01 && lat < region.bbox[3] - 0.01;
function point(legToRead: Leg, regionId: string, local: boolean): readonly [number, number] {
  const region = legToRead.manifest.regions.find((r) => r.regionId === regionId)!;
  const view = rawView(legToRead, regionId);
  for (let i = 0; i < view.edgeCount; i++) {
    if (local && view.edgeRoadClassV3[i] < 6) continue;
    const n = view.edgeFrom[i];
    if (inside(region, view.nodeLat[n], view.nodeLon[n])) return [view.nodeLat[n], view.nodeLon[n]];
  }
  for (let i = 0; i < view.edgeCount; i++) {
    if (local && view.edgeRoadClassV3[i] < 6) continue;
    return [view.nodeLat[view.edgeFrom[i]], view.nodeLon[view.edgeFrom[i]]];
  }
  throw new Error(`${regionId}: yol noktası yok`);
}

const chains: string[][] = [];
for (const a of after.manifest.regions) {
  for (const b of a.neighbors) {
    for (const c of after.manifest.regions.find((r) => r.regionId === b)?.neighbors ?? []) if (c !== a.regionId) chains.push([a.regionId, b, c]);
  }
}
const chain = chains[0];
if (!chain) throw new Error('Üç region zinciri yok');
const two = chain.slice(0, 2);

/* BEFORE ve AFTER bacaklari ROTA BAZINDA donusumlu olculur (bir bacagi bastan
   sona kosmak, olcume sistematik isinma yanliligi sokar). */
const ROUTE_SPECS: ReadonlyArray<{ name: string; ids: string[]; from: (l: Leg) => readonly [number, number]; to: (l: Leg) => readonly [number, number] }> = [
  { name: 'cross-region-arterial-to-residential', ids: two, from: (l) => point(l, two[0], false), to: (l) => point(l, two[1], true) },
  { name: 'cross-region-residential-to-residential', ids: two, from: (l) => point(l, two[0], true), to: (l) => point(l, two[1], true) },
  { name: 'three-region-local-to-arterial', ids: chain, from: (l) => point(l, chain[0], true), to: (l) => point(l, chain[2], false) },
];
/* Pilot gecis: V8 IC/tier gecisleri ilk olculen bacagi sistematik olarak
   yavas gosteriyordu (ayni rota, sirasi degistiginde 3x fark). Olcum oncesi
   her bacak/rota bir kez kosulur ve ATILIR. */
for (const spec of ROUTE_SPECS) {
  if (before) { active = before; await routeCorpus(spec.name, spec.ids, spec.from(before), spec.to(before)); }
  active = after; await routeCorpus(spec.name, spec.ids, spec.from(after), spec.to(after));
}

const afterRoutes = [];
const beforeRoutes = before ? [] : null;
for (const spec of ROUTE_SPECS) {
  if (before && beforeRoutes) {
    active = before;
    beforeRoutes.push(await routeCorpus(spec.name, spec.ids, spec.from(before), spec.to(before)));
  }
  active = after;
  afterRoutes.push(await routeCorpus(spec.name, spec.ids, spec.from(after), spec.to(after)));
}
active = after;

/* ── Gerçek via-node kısıt uygulaması (regresyon) ────────────────────────── */

const benchmark = JSON.parse(readFileSync(resolve(root, 'benchmark.json'), 'utf8')) as {
  restrictionStats: Record<string, number>;
  restrictionEvidence: Array<{ relationId: number; restrictionType: string; regionId: string; viaNodeId: number; fromEdge: number; toEdge: number }>;
  viaWayEvidence: Array<Record<string, unknown>>;
};
const viaNodeCase = benchmark.restrictionEvidence.find((item) => item.restrictionType.startsWith('no_'));
if (!viaNodeCase) throw new Error('Gerçek no_* via-node kanıtı yok');
const viaNodeView = rawView(after, viaNodeCase.regionId);
const viaNodeIndex = [...viaNodeView.nodeSourceId].findIndex((id) => id === BigInt(viaNodeCase.viaNodeId));
const viaNodeEvidence = {
  ...viaNodeCase,
  directTurnAllowed: turnIsAllowed(viaNodeView, viaNodeCase.fromEdge, viaNodeCase.toEdge, viaNodeIndex),
  outcome: turnIsAllowed(viaNodeView, viaNodeCase.fromEdge, viaNodeCase.toEdge, viaNodeIndex) ? 'NOT_ENFORCED' : 'FORBIDDEN_DIRECT_TURN',
};

/* ── Gerçek via-way kısıt uygulaması ─────────────────────────────────────── */

interface ViaWayCase {
  relationId: number; regionId: string; restrictionType: string; kind: 'NO' | 'ONLY';
  chainLinks: number; linkEdges: number[]; linkNodes: number[];
  /** `no_*`: yasak dizinin son gecisi REDDEDILMELI. `only_*`: zorunlu devam
   *  KABUL, alternatif devam RED edilmeli. */
  automatonEnforced: boolean;
  /** Zincire girilmemisken ayni via kenari uzerinden gecis SERBEST kalmali. */
  unrelatedEntryAllowed: boolean;
  /** `no_*` icin alakasiz kavsak alternatifleri bloklanmamali. */
  intermediateAlternativesFree: boolean;
  workerOutcome: string;
  /** Donen rota otomatta ihlal uretiyor mu (her iki tur icin de FALSE olmali). */
  workerAutomatonViolation: boolean | null;
  /** `no_*` icin: yasak kenar dizisi rotada var mi (FALSE olmali). */
  workerContainsForbiddenSequence: boolean | null;
}

const viaWayCases: ViaWayCase[] = [];
for (const evidence of benchmark.viaWayEvidence) {
  if (evidence.outcome !== 'SUPPORTED_VIA_WAY') continue;
  const regionId = String(evidence.regionId);
  const view = rawView(after, regionId);
  const index = view.viaWay;
  if (!index) throw new Error(`${regionId}: via-way indeksi yok`);
  const chainId = (evidence.chainIds as number[])[0] - 1;    // manifest 1-tabanli, indeks 0-tabanli
  const start = index.chainStart[chainId], links = index.chainLength[chainId];
  const linkEdges = [index.linkFromEdge[start], ...Array.from({ length: links }, (_, j) => index.linkToEdge[start + j])];
  const linkNodes = Array.from({ length: links }, (_, j) => index.linkViaNode[start + j]);
  const isOnly = index.chainType[chainId] >= 5;

  const alternativeAt = (node: number, exclude: number): number => {
    for (let e = 0; e < view.edgeCount; e++) {
      if (e === exclude) continue;
      if (view.edgeFrom[e] === node || (view.edgeDirection[e] === 0 && view.edgeTo[e] === node)) return e;
    }
    return -1;
  };

  /* 1) Otomat: zincire girilir ve her kavsakta hem zorunlu hem alternatif
        gecis denenir. Uydurma yok — karar `viaWayStep`in kendisidir. */
  let mask = viaWayStep(view, -1, 0, linkNodes[0], linkEdges[0]);
  let automatonEnforced = mask > 0;
  let intermediateFree = true;
  for (let j = 0; j < links; j++) {
    const here = mask;
    const alternative = alternativeAt(linkNodes[j], linkEdges[j + 1]);
    const probe = alternative >= 0 ? viaWayStep(view, linkEdges[j], here, linkNodes[j], alternative) : 0;
    if (isOnly) { if (alternative >= 0 && probe >= 0) automatonEnforced = false; }
    else if (probe < 0) intermediateFree = false;
    const next = viaWayStep(view, linkEdges[j], here, linkNodes[j], linkEdges[j + 1]);
    if (isOnly) { if (next < 0) automatonEnforced = false; }
    else if (j === links - 1 && next >= 0) automatonEnforced = false;
    if (next < 0) break;
    mask = next;
  }

  /* 2) Negatif kontrol: via kenarina BASKA yerden girilirse kisit uygulanmaz. */
  const unrelatedMask = viaWayStep(view, -1, 0, linkNodes[0], linkEdges[1]);
  const unrelatedAllowed = viaWayStep(view, linkEdges[1], unrelatedMask, linkNodes[links - 1], linkEdges[links]) >= 0;

  /* 3) Kanonik worker ucu uca. */
  active = after;
  await install([regionId]);
  const originNode = view.edgeFrom[linkEdges[0]] === linkNodes[0] ? view.edgeTo[linkEdges[0]] : view.edgeFrom[linkEdges[0]];
  const lastEdge = linkEdges[links];
  const targetNode = view.edgeFrom[lastEdge] === linkNodes[links - 1] ? view.edgeTo[lastEdge] : view.edgeFrom[lastEdge];
  const run = await solve(`viaway-${evidence.relationId}`, [view.nodeLat[originNode], view.nodeLon[originNode]], [view.nodeLat[targetNode], view.nodeLon[targetNode]]);
  releaseRoutingGraph();
  let containsForbidden: boolean | null = null;
  let automatonViolation: boolean | null = null;
  let workerOutcome = run.result?.type ?? 'NO_RESPONSE';
  if (run.result?.type === 'ROUTE_RESULT' && run.result.geometry) {
    const { ordinals, nodes } = edgeSequence(view, run.result.geometry);
    containsForbidden = false;
    for (let i = 0; i + links < ordinals.length; i++) {
      let match = true;
      for (let j = 0; j <= links && match; j++) if (ordinals[i + j] !== linkEdges[j]) match = false;
      if (match) { containsForbidden = true; break; }
    }
    automatonViolation = false;
    let replayMask = 0, replayPrevious = -1;
    for (let i = 0; i < ordinals.length; i++) {
      if (ordinals[i] < 0 || nodes[i] < 0) continue;
      const next = viaWayStep(view, replayPrevious, replayMask, nodes[i], ordinals[i]);
      if (next < 0) { automatonViolation = true; break; }
      replayMask = next; replayPrevious = ordinals[i];
    }
    workerOutcome = automatonViolation ? 'AUTOMATON_VIOLATION_IN_ROUTE'
      : (isOnly ? 'MANDATED_CONTINUATION_HONOURED' : (containsForbidden ? 'FORBIDDEN_SEQUENCE_IN_ROUTE' : 'LEGAL_ALTERNATE_ROUTE'));
  } else if (run.result?.type === 'ROUTE_ERROR') {
    workerOutcome = `ROUTE_ERROR:${run.result.reason ?? '?'}`;
  }

  viaWayCases.push({
    relationId: Number(evidence.relationId), regionId, restrictionType: String(evidence.restrictionType),
    kind: isOnly ? 'ONLY' : 'NO',
    chainLinks: links, linkEdges, linkNodes,
    automatonEnforced, unrelatedEntryAllowed: unrelatedAllowed, intermediateAlternativesFree: intermediateFree,
    workerOutcome, workerAutomatonViolation: automatonViolation, workerContainsForbiddenSequence: containsForbidden,
  });
}

/* ── Fail-closed ────────────────────────────────────────────────────────── */

const failures: Array<{ name: string; rejected: boolean }> = [];
const originalFetch = globalThis.fetch;
async function expectFail(name: string, value: unknown, ids: string[]) {
  _resetGraphResidencyForTest();
  const view = await acquireRegionalRoutingGraph(value, ids, '/fixture');
  failures.push({ name, rejected: view === null });
  releaseRoutingGraph();
}
const brokenNeighbor = structuredClone(after.manifest) as TurkeyGraphManifest;
(brokenNeighbor.regions[0].neighbors as string[]).push('missing');
await expectFail('manifest-missing-neighbor', brokenNeighbor, [chain[0]]);
const shaMismatch = structuredClone(after.manifest) as TurkeyGraphManifest;
(shaMismatch.regions.find((r) => r.regionId === chain[0]) as { sha256: string }).sha256 = '0'.repeat(64);
await expectFail('sha-mismatch', shaMismatch, [chain[0]]);
globalThis.fetch = (async () => new Response(new Uint8Array([1, 2, 3]))) as typeof fetch;
await expectFail('corrupt-truncated-rtg3', after.manifest, [chain[0]]);
globalThis.fetch = originalFetch;
await expectFail('missing-required-region', after.manifest, ['tr-33-missing']);
await expectFail('unsupported-manifest-version', { ...after.manifest, schemaVersion: 2 }, [chain[0]]);
/* Bozuk via-way zinciri: son halka işareti silinirse graf TÜMDEN reddedilmeli. */
const region = after.manifest.regions.find((r) => (rawView(after, r.regionId).viaWay?.chainCount ?? 0) > 0)!;
const corrupted = Buffer.from(after.buffers.get(region.graphFile)!);
{
  const view = new DataView(corrupted.buffer, corrupted.byteOffset, corrupted.byteLength);
  const nodeCount = view.getUint32(4, true), edgeCount = view.getUint32(8, true), restrictionCount = view.getUint32(12, true);
  let base = 16 + nodeCount * 16 + edgeCount * 28;
  for (let i = 0; i < restrictionCount; i++) {
    const type = view.getUint8(base + i * 16 + 12);
    if ((type & 0x80) !== 0 && (type & 0x40) !== 0) { view.setUint8(base + i * 16 + 12, type & ~0x40); break; }
  }
}
const chainParse = parseRoutingGraph(corrupted.buffer.slice(corrupted.byteOffset, corrupted.byteOffset + corrupted.byteLength) as ArrayBuffer);
failures.push({ name: 'corrupt-via-way-chain', rejected: chainParse.outcome === 'INVALID' });

const restrictionTotals = after.manifest.regions.reduce((sum, r) => {
  const view = rawView(after, r.regionId);
  return { records: sum.records + view.restrictionCount, chains: sum.chains + (view.viaWay?.chainCount ?? 0) };
}, { records: 0, chains: 0 });

const evidence = {
  generatedAt: new Date().toISOString(),
  chain, repeats: REPEATS,
  routes: afterRoutes,
  routesBefore: beforeRoutes,
  beforeAvailable: before !== null,
  restrictionStats: benchmark.restrictionStats,
  restrictionTotals,
  viaNodeEvidence,
  viaWayCases,
  failures,
};
writeFileSync(resolve(root, 'hardening-validation.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
