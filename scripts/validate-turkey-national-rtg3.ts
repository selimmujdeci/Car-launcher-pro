/**
 * validate-turkey-national-rtg3.ts — ÜLKE ÇAPI RTG3 GÖLGE DOĞRULAMASI.
 *
 * İkinci router / ikinci manifest otoritesi YOKTUR. Bütünlük, topoloji ve
 * rotalar yalnız kanonik modüllerle ölçülür:
 *   `validateTurkeyGraphManifest` → `selectRegionalRouteCorridor`
 *   → `graphResidencyRuntime` → `NavigationCompute.worker` → edge-state A*.
 *
 * Bellek sınırı bilinçlidir: ülke grafı TEK PARÇA belleğe ALINMAZ. Topoloji
 * denetimi bölge bölge (streaming) yapılır; ülke düzeyi bağlantılılık bölge
 * komşuluk grafı üzerinden ölçülür. Global düğüm-düzeyi union-find ~50M düğüm
 * demektir ve bu ölçümün kendisi bütçeyi aşardı — o yüzden YAPILMAZ ve
 * "ölçüldü" diye SUNULMAZ.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseRoutingGraph, type RoutingGraphView } from '../src/platform/navigation/map/graph/rtg2Reader';
import {
  acquireRegionalRoutingGraph, releaseRoutingGraph, _resetGraphResidencyForTest,
  REGIONAL_GRAPH_MAX_BYTES, REGIONAL_GRAPH_MAX_RESIDENT,
} from '../src/platform/navigation/map/graph/graphResidencyRuntime';
import {
  selectRegionalRouteCorridor, validateTurkeyGraphManifest,
} from '../src/platform/navigation/map/graph/turkeyGraphManifest';

const RUN = resolve(process.env.RTG3_RUN_DIR ?? 'field-runs/turkey-rtg3-national-20260908');
const manifestPath = resolve(RUN, 'turkey-graph-manifest.json');
const benchmarkPath = resolve(RUN, 'benchmark.json');
if (!existsSync(manifestPath)) throw new Error(`Manifest yok: ${manifestPath}`);

const manifestRaw = readFileSync(manifestPath);
const manifest = validateTurkeyGraphManifest(JSON.parse(manifestRaw.toString('utf8')));
if (!manifest) throw new Error('MANIFEST_INVALID — kanonik doğrulayıcı reddetti');
const benchmark = existsSync(benchmarkPath) ? JSON.parse(readFileSync(benchmarkPath, 'utf8')) : null;

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const regionPath = (file: string) => resolve(RUN, file);

/* ── Worker köprüsü (kanonik) ───────────────────────────────────────────── */

type Posted = { type: string; requestId?: string; geometry?: [number, number][]; distanceM?: number; durationS?: number; reason?: string; postedAtMs?: number };
const posted: Posted[] = [];
const workerSelf = {
  navigator: { deviceMemory: 8 },
  postMessage: (m: Posted) => posted.push({ ...m, postedAtMs: performance.now() }),
  close: () => {},
  onmessage: null as ((event: MessageEvent) => void) | null,
};
Object.assign(globalThis, { self: workerSelf });
await import('../src/platform/navigation/NavigationCompute.worker');

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const file = String(input).replace(/^.*\/(regions\/[^/]+)$/, '$1');
  const path = regionPath(file);
  if (!existsSync(path)) return new Response(null, { status: 404 });
  return new Response(readFileSync(path));
}) as typeof fetch;

/* ══════════════════════════════════════════════════════════════════════════
   P5/P7 — BÖLGE ENVANTERİ + MANİFEST BÜTÜNLÜĞÜ
   ══════════════════════════════════════════════════════════════════════════ */

const integrity: Array<{ check: string; measured: string; result: 'PASS' | 'FAIL' }> = [];
const push = (check: string, measured: string, ok: boolean) =>
  integrity.push({ check, measured, result: ok ? 'PASS' : 'FAIL' });

const ids = new Set(manifest.regions.map((r) => r.regionId));
push('region-ids-unique', `${ids.size}/${manifest.regions.length}`, ids.size === manifest.regions.length);
push('graph-format', manifest.graphFormat, manifest.graphFormat === 'RTG3');
push('manifest-schema', String(manifest.schemaVersion), manifest.schemaVersion === 1);
const sourceHashes = new Set(manifest.regions.map((r) => r.sourceHash));
push('source-hash-consistent', `${sourceHashes.size} farklı`, sourceHashes.size === 1);

let missingFiles = 0, sizeMismatch = 0, shaMismatch = 0, parseFail = 0;
const inventory: Array<{ regionId: string; bbox: readonly number[]; nodeCount: number; edgeCount: number; byteSize: number; sha256: string; neighbors: number }> = [];
type Topology = { components: number; largestPct: number; selfLoops: number; zeroLength: number; duplicates: number; invalidRefs: number; deadEnds: number };
const topologies: Array<{ regionId: string } & Topology> = [];
const roadClassTotals: Record<string, number> = {};
const metadataTotals = { oneway: 0, destinationOnly: 0, bridge: 0, tunnel: 0, layered: 0, restrictionRecords: 0, viaWayChains: 0 };
let totalNodes = 0, totalEdges = 0, totalBytes = 0;

const CLASS_NAME = ['UNKNOWN', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service/road'];

function topology(view: RoutingGraphView): Topology {
  const degree = new Uint32Array(view.nodeCount);
  const seen = new Set<string>();
  let selfLoops = 0, zeroLength = 0, duplicates = 0, invalidRefs = 0;
  const head = new Int32Array(view.nodeCount).fill(-1);
  const next = new Int32Array(view.edgeCount * 2).fill(-1);
  const target = new Int32Array(view.edgeCount * 2);
  let slot = 0;
  const link = (from: number, to: number) => { target[slot] = to; next[slot] = head[from]; head[from] = slot; slot++; };
  for (let i = 0; i < view.edgeCount; i++) {
    const a = view.edgeFrom[i], b = view.edgeTo[i];
    if (a >= view.nodeCount || b >= view.nodeCount) { invalidRefs++; continue; }
    if (a === b) selfLoops++;
    if (view.edgeCostM[i] <= 0) zeroLength++;
    const key = `${a}:${b}:${view.edgeSourceWayId[i]}`;
    if (seen.has(key)) duplicates++; else seen.add(key);
    degree[a]++; degree[b]++;
    /* Bağlantılılık YÖNSÜZ ölçülür: "bu graf parçalara ayrılmış mı" sorusu
       yön kısıtından bağımsızdır; yönlü erişilebilirlik ayrı bir sorudur. */
    link(a, b); link(b, a);
  }
  const visited = new Uint8Array(view.nodeCount);
  const stack = new Int32Array(view.nodeCount);
  let components = 0, largest = 0;
  for (let s = 0; s < view.nodeCount; s++) {
    if (visited[s]) continue;
    components++; visited[s] = 1; let top = 0, size = 0;
    stack[top++] = s;
    while (top > 0) {
      const u = stack[--top]; size++;
      for (let e = head[u]; e !== -1; e = next[e]) {
        const v = target[e];
        if (!visited[v]) { visited[v] = 1; stack[top++] = v; }
      }
    }
    if (size > largest) largest = size;
  }
  let deadEnds = 0;
  for (let i = 0; i < view.nodeCount; i++) if (degree[i] === 1) deadEnds++;
  return {
    components, largestPct: view.nodeCount ? (100 * largest) / view.nodeCount : 0,
    selfLoops, zeroLength, duplicates, invalidRefs, deadEnds,
  };
}

for (const region of manifest.regions) {
  const path = regionPath(region.graphFile);
  if (!existsSync(path)) { missingFiles++; continue; }
  const bytes = readFileSync(path);
  if (bytes.byteLength !== region.byteSize) sizeMismatch++;
  if (sha(bytes) !== region.sha256) shaMismatch++;
  const parsed = parseRoutingGraph(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  if (parsed.outcome !== 'OK' || !parsed.view) { parseFail++; continue; }
  const view = parsed.view;
  totalNodes += view.nodeCount; totalEdges += view.edgeCount; totalBytes += bytes.byteLength;
  metadataTotals.restrictionRecords += view.restrictionCount;
  metadataTotals.viaWayChains += view.viaWay?.chainCount ?? 0;
  for (let i = 0; i < view.edgeCount; i++) {
    roadClassTotals[CLASS_NAME[view.edgeRoadClassV3[i]] ?? 'UNKNOWN'] = (roadClassTotals[CLASS_NAME[view.edgeRoadClassV3[i]] ?? 'UNKNOWN'] ?? 0) + 1;
    if (view.edgeDirection[i] === 1) metadataTotals.oneway++;
    if (view.edgeAccessRole[i] === 2) metadataTotals.destinationOnly++;
    if (view.edgeStructure[i] & 1) metadataTotals.bridge++;
    if (view.edgeStructure[i] & 2) metadataTotals.tunnel++;
    if (view.edgeLayer[i] !== 0) metadataTotals.layered++;
  }
  inventory.push({ regionId: region.regionId, bbox: region.bbox, nodeCount: view.nodeCount, edgeCount: view.edgeCount, byteSize: bytes.byteLength, sha256: region.sha256, neighbors: region.neighbors.length });
  topologies.push({ regionId: region.regionId, ...topology(view) });
}

push('all-region-files-exist', `${manifest.regions.length - missingFiles}/${manifest.regions.length}`, missingFiles === 0);
push('byte-sizes-match', `${sizeMismatch} uyumsuz`, sizeMismatch === 0);
push('sha256-match', `${shaMismatch} uyumsuz`, shaMismatch === 0);
push('all-regions-parse', `${parseFail} ayrıştırılamadı`, parseFail === 0);

let dangling = 0, nonReciprocal = 0, selfNeighbor = 0;
for (const region of manifest.regions) {
  for (const neighbor of region.neighbors) {
    if (neighbor === region.regionId) selfNeighbor++;
    if (!ids.has(neighbor)) { dangling++; continue; }
    const other = manifest.regions.find((r) => r.regionId === neighbor)!;
    if (!other.neighbors.includes(region.regionId)) nonReciprocal++;
  }
}
push('no-dangling-neighbor', `${dangling}`, dangling === 0);
push('reciprocal-neighbors', `${nonReciprocal} tek yönlü`, nonReciprocal === 0);
push('no-self-neighbor', `${selfNeighbor}`, selfNeighbor === 0);

/* Sınır portal kimliği: komşu bölgeler GERÇEKTEN ortak OSM düğümü paylaşıyor
   mu? Manifest "komşu" diyor diye varsaymak, sahte bir birleşme demektir. */
const portalSample: Array<{ pair: string; sharedNodes: number }> = [];
const sampledPairs = new Set<string>();
const nodeIdsOf = (file: string): Set<bigint> => {
  const bytes = readFileSync(regionPath(file));
  const parsed = parseRoutingGraph(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return new Set(parsed.view ? [...parsed.view.nodeSourceId] : []);
};
const PORTAL_SAMPLE = Number(process.env.RTG3_PORTAL_SAMPLE ?? 12);
for (const region of manifest.regions) {
  if (portalSample.length >= PORTAL_SAMPLE) break;
  for (const neighbor of region.neighbors) {
    const key = [region.regionId, neighbor].sort().join('|');
    if (sampledPairs.has(key) || portalSample.length >= PORTAL_SAMPLE) continue;
    sampledPairs.add(key);
    const other = manifest.regions.find((r) => r.regionId === neighbor)!;
    const a = nodeIdsOf(region.graphFile), b = nodeIdsOf(other.graphFile);
    let shared = 0;
    for (const id of a) if (b.has(id)) shared++;
    portalSample.push({ pair: key, sharedNodes: shared });
  }
}
push('boundary-portal-identity', `${portalSample.filter((p) => p.sharedNodes > 0).length}/${portalSample.length} çiftte ortak OSM düğümü`, portalSample.length > 0 && portalSample.every((p) => p.sharedNodes > 0));

/* Bölge komşuluk grafının bağlantılılığı (ülke düzeyi). */
const regionComponents: string[][] = [];
{
  const seen = new Set<string>();
  for (const region of manifest.regions) {
    if (seen.has(region.regionId)) continue;
    const stack = [region.regionId]; const group: string[] = []; seen.add(region.regionId);
    while (stack.length) {
      const current = stack.pop()!; group.push(current);
      for (const n of manifest.regions.find((r) => r.regionId === current)?.neighbors ?? []) {
        if (!seen.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    regionComponents.push(group);
  }
  regionComponents.sort((a, b) => b.length - a.length);
}
const isolatedRegions = manifest.regions.filter((r) => r.neighbors.length === 0).map((r) => r.regionId);

/* ── Bölge boyut dağılımı ────────────────────────────────────────────────── */
const sortedBytes = inventory.map((r) => r.byteSize).sort((a, b) => a - b);
const pct = (p: number) => sortedBytes.length ? sortedBytes[Math.min(sortedBytes.length - 1, Math.floor((sortedBytes.length - 1) * p))] : null;
const largestRegion = [...inventory].sort((a, b) => b.byteSize - a.byteSize)[0] ?? null;
const smallestRegion = [...inventory].sort((a, b) => a.byteSize - b.byteSize)[0] ?? null;

/* ══════════════════════════════════════════════════════════════════════════
   P9/P10/P11 — ÜLKE ÇAPI ROTA KORPUSU (kanonik zincir)
   ══════════════════════════════════════════════════════════════════════════ */

const CITY: Record<string, readonly [number, number]> = {
  'Mersin': [36.8121, 34.6415],
  'Mersin-yerel': [36.7950, 34.6210],
  'Tarsus': [36.9177, 34.8953],
  'Adana': [37.0000, 35.3213],
  'Ankara': [39.9334, 32.8597],
  'İstanbul': [41.0082, 28.9784],
  'Antalya': [36.8969, 30.7133],
};
const regionOf = (p: readonly [number, number]) =>
  manifest.regions.find((r) => p[1] >= r.bbox[0] && p[1] <= r.bbox[2] && p[0] >= r.bbox[1] && p[0] <= r.bbox[3]) ?? null;

/** Bölge komşuluk grafında SINIRSIZ en kısa yol — gerçek koridor uzunluğu. */
function trueCorridor(from: string, to: string): string[] | null {
  if (from === to) return [from];
  const queue: string[][] = [[from]]; const seen = new Set([from]);
  while (queue.length) {
    const path = queue.shift()!; const current = path[path.length - 1];
    for (const n of manifest.regions.find((r) => r.regionId === current)?.neighbors ?? []) {
      if (seen.has(n)) continue;
      if (n === to) return [...path, n];
      seen.add(n); queue.push([...path, n]);
    }
  }
  return null;
}

async function solve(id: string, from: readonly [number, number], to: readonly [number, number]) {
  const start = performance.now();
  workerSelf.onmessage!({ data: { type: 'COMPUTE_ROUTE', requestId: id, fromLat: from[0], fromLon: from[1], toLat: to[0], toLon: to[1] } } as MessageEvent);
  for (let i = 0; i < 3000 && !posted.some((m) => m.requestId === id); i++) await new Promise((r) => setTimeout(r, 2));
  const result = posted.splice(0).find((m) => m.requestId === id);
  return { result, ms: (result?.postedAtMs ?? performance.now()) - start };
}

const routes: Array<Record<string, unknown>> = [];
const PAIRS: Array<[string, string]> = [
  ['Mersin', 'Mersin-yerel'],
  ['Mersin', 'Tarsus'],
  ['Mersin', 'Adana'],
  ['Mersin', 'Ankara'],
  ['Mersin', 'İstanbul'],
  ['Mersin', 'Antalya'],
  ['İstanbul', 'Ankara'],
];

for (const [fromName, toName] of PAIRS) {
  const from = CITY[fromName], to = CITY[toName];
  const originRegion = regionOf(from), destinationRegion = regionOf(to);
  const record: Record<string, unknown> = {
    from: fromName, to: toName,
    originRegionId: originRegion?.regionId ?? null,
    destinationRegionId: destinationRegion?.regionId ?? null,
  };
  if (!originRegion || !destinationRegion) {
    record.result = 'BLOCKED_NO_REGION_COVERAGE';
    routes.push(record); continue;
  }
  const corridor = trueCorridor(originRegion.regionId, destinationRegion.regionId);
  record.trueCorridorRegions = corridor?.length ?? null;
  record.trueCorridor = corridor && corridor.length <= 12 ? corridor : null;
  if (!corridor) { record.result = 'BLOCKED_REGION_GRAPH_DISCONNECTED'; routes.push(record); continue; }

  const selected = selectRegionalRouteCorridor(manifest, from, to, REGIONAL_GRAPH_MAX_RESIDENT);
  record.residencyMaxRegions = REGIONAL_GRAPH_MAX_RESIDENT;
  if (!selected) {
    record.result = 'BLOCKED_RESIDENCY_BUDGET';
    record.detail = `gerçek koridor ${corridor.length} bölge · residency tavanı ${REGIONAL_GRAPH_MAX_RESIDENT}`;
    routes.push(record); continue;
  }
  const requiredIds = [...selected.requiredRegionIds];
  const residentBytes = requiredIds.reduce((n, id) => n + (manifest.regions.find((r) => r.regionId === id)?.byteSize ?? 0), 0);
  record.selectedRegions = requiredIds;
  record.residentBytes = residentBytes;
  if (residentBytes > REGIONAL_GRAPH_MAX_BYTES) {
    record.result = 'BLOCKED_RESIDENCY_BYTES';
    record.detail = `${residentBytes} B > ${REGIONAL_GRAPH_MAX_BYTES} B`;
    routes.push(record); continue;
  }

  _resetGraphResidencyForTest();
  const loadStart = performance.now();
  const view = await acquireRegionalRoutingGraph(manifest, requiredIds, '/fixture');
  record.loadMs = Number((performance.now() - loadStart).toFixed(2));
  if (!view) { record.result = 'BLOCKED_RESIDENCY_LOAD'; routes.push(record); continue; }
  record.mergedNodes = view.nodeCount; record.mergedEdges = view.edgeCount;
  const installId = `install-${fromName}-${toName}`;
  workerSelf.onmessage!({ data: { type: 'INSTALL_REGIONAL_GRAPH', requestId: installId, graphView: view } } as MessageEvent);
  const installed = posted.splice(0).some((m) => m.type === 'GRAPH_INSTALLED' && m.requestId === installId);
  if (!installed) { record.result = 'BLOCKED_WORKER_INSTALL'; releaseRoutingGraph(); routes.push(record); continue; }

  const run = await solve(`route-${fromName}-${toName}`, from, to);
  releaseRoutingGraph();
  record.solveMs = Number(run.ms.toFixed(2));
  if (run.result?.type === 'ROUTE_RESULT' && run.result.geometry) {
    const endpoint = run.result.geometry.at(-1)!;
    record.distanceM = run.result.distanceM;
    record.endpointErrorM = Number(Math.hypot((endpoint[1] - to[0]) * 111_000, (endpoint[0] - to[1]) * 90_000).toFixed(1));
    record.result = 'ROUTE_RESULT';
  } else {
    record.result = run.result?.type === 'ROUTE_ERROR' ? `ROUTE_ERROR:${run.result.reason ?? '?'}` : 'NO_RESPONSE';
  }
  routes.push(record);
}

/* ══════════════════════════════════════════════════════════════════════════
   ÖZET
   ══════════════════════════════════════════════════════════════════════════ */

const topologyTotals = topologies.reduce((acc, t) => ({
  regions: acc.regions + 1,
  components: acc.components + t.components,
  selfLoops: acc.selfLoops + t.selfLoops,
  zeroLength: acc.zeroLength + t.zeroLength,
  duplicates: acc.duplicates + t.duplicates,
  invalidRefs: acc.invalidRefs + t.invalidRefs,
  deadEnds: acc.deadEnds + t.deadEnds,
  minLargestPct: Math.min(acc.minLargestPct, t.largestPct),
}), { regions: 0, components: 0, selfLoops: 0, zeroLength: 0, duplicates: 0, invalidRefs: 0, deadEnds: 0, minLargestPct: 100 });

const evidence = {
  generatedAt: new Date().toISOString(),
  runDir: RUN,
  manifest: {
    path: manifestPath, bytes: manifestRaw.byteLength, sha256: sha(manifestRaw),
    datasetId: manifest.datasetId, sourceTimestamp: manifest.sourceTimestamp,
    buildTimestamp: manifest.buildTimestamp, regions: manifest.regions.length,
    neighborLinks: manifest.regions.reduce((n, r) => n + r.neighbors.length, 0) / 2,
  },
  country: { totalNodes, totalEdges, totalBytes, regions: inventory.length },
  regionStats: {
    count: inventory.length,
    minBytes: sortedBytes[0] ?? null, medianBytes: pct(0.5), p95Bytes: pct(0.95), maxBytes: sortedBytes.at(-1) ?? null,
    largestRegion, smallestRegion,
  },
  roadClassTotals, metadataTotals,
  restrictionStats: benchmark?.restrictionStats ?? null,
  integrity,
  integrityPass: integrity.every((c) => c.result === 'PASS'),
  topology: { totals: topologyTotals, regionComponents: regionComponents.length, largestRegionComponent: regionComponents[0]?.length ?? 0, isolatedRegions },
  residencyPolicy: { maxResidentRegions: REGIONAL_GRAPH_MAX_RESIDENT, maxBytes: REGIONAL_GRAPH_MAX_BYTES },
  routes,
  build: benchmark ? {
    buildMs: Math.round(benchmark.buildMs), peakProcessTreeRssBytes: benchmark.peakProcessTreeRssBytes,
    peakNodeRssBytes: benchmark.peakNodeRssBytes, peakChildRssBytes: benchmark.peakChildRssBytes,
    peakTempBytes: benchmark.peakTempBytes, selectedWays: benchmark.selectedWays,
    deniedWays: benchmark.deniedWays, requiredCoordinates: benchmark.requiredCoordinates,
    memoryBudgetMiB: benchmark.memoryBudgetMiB, source: benchmark.source,
  } : null,
  productionGraph: (() => {
    const p = resolve('public/maps/routing-graph.bin');
    if (!existsSync(p)) return null;
    const b = readFileSync(p);
    return { bytes: statSync(p).size, sha256: sha(b), unchanged: sha(b) === 'e7713f7575fb587386858db44b2e9ab84278686a06d42d04cd16e8663af691da' };
  })(),
};

writeFileSync(resolve(RUN, 'national-validation.json'), JSON.stringify(evidence, null, 2));
writeFileSync(resolve(RUN, 'region-inventory.json'), JSON.stringify({ regions: inventory, topologies }, null, 2));
console.log(JSON.stringify({ ...evidence, roadClassTotals, routes }, null, 2));
