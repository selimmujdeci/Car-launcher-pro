/**
 * validate-rtg4-alt-product-path.ts — ALT'İN ÜRÜN YOLUNDA ÖLÇÜMÜ.
 *
 * ── ÖNCEKİ KOŞUMDAN FARKI (kritik) ───────────────────────────────────────
 * `validate-rtg4-ondemand-longroute.ts` worker'ı doğrudan sürer ve ALT
 * kanıtını KENDİSİ enjekte eder — o bir GÖLGE koşumudur. Bu dosya ise gerçek
 * ürün girişini çağırır:
 *
 *   offlineRoutingService.computeCrossRegionOfflineRoute
 *     → planCrossRegionSearchEnvelope
 *     → graphResidencyRuntime.resolveAltTargetRow      (ALT hedef satırı)
 *     → graphResidencyRuntime.acquireRegionWindow      (graf + ALT dilimi)
 *     → NavigationCompute.worker → routeRtg3EdgeState
 *
 * Enjekte edilen TEK şey worker TAŞIYICISIDIR (`_setNavWorkerForTest`):
 * Node'da `new Worker(new URL(...))` yoktur. ALT kanıtını ürün kodu kendisi
 * yükler ve kendisi doğrular; bu dosya hiçbir ALT alanı göndermez.
 *
 * Koşum:
 *   node --max-old-space-size=8192 --experimental-strip-types --no-warnings
 *        --loader ./scripts/nodeTsResolve.mjs scripts/validate-rtg4-alt-product-path.ts
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  getGraphResidencySnapshot, _resetGraphResidencyForTest,
  REGIONAL_GRAPH_MAX_BYTES, REGIONAL_GRAPH_MAX_RESIDENT,
} from '../src/platform/navigation/map/graph/graphResidencyRuntime';
import {
  planCrossRegionSearchEnvelope, validateTurkeyGraphManifest,
} from '../src/platform/navigation/map/graph/turkeyGraphManifest';
import { auditRouteLegality, type RouteLegalityReport } from './rtg4RouteLegalityAudit';

const RUN = resolve(process.env.RTG4_RUN_DIR ?? 'field-runs/rtg4-alt-l8-20260908');
const GRAPH_RUN = resolve(process.env.RTG4_GRAPH_DIR ?? 'field-runs/rtg4-portal-v2-national-20260908');
const OUT = resolve(process.env.RTG4_OUT_DIR ?? 'field-runs/rtg4-alt-productpath-20260908');
/** ALT'yi KASITLI olarak kullanılamaz kılar (P12 kontrol koşumu). */
const ALT_DISABLED = process.env.RTG4_ALT_DISABLED === '1';
const BUDGET = Number(process.env.RTG4_BUDGET ?? 200_000);
const DISTRIBUTION = process.env.RTG4_DISTRIBUTION === '1' || process.argv.includes('--distribution');
mkdirSync(OUT, { recursive: true });

const manifestPath = resolve(RUN, 'turkey-graph-manifest.json');
if (!existsSync(manifestPath)) throw new Error(`Manifest yok: ${manifestPath}`);
const manifestRaw = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
/* ALT'siz kontrol koşumu: manifest ALT iddiasını TAMAMEN bırakır (yarım kanıt
   üretmek yerine). Böylece ürün yolu "ALT yok" dalını gerçekten yürür. */
if (ALT_DISABLED) {
  delete manifestRaw.altLandmarkSet;
  manifestRaw.regions = (manifestRaw.regions as Record<string, unknown>[]).map((region) => {
    const copy = { ...region }; delete copy.alt; return copy;
  });
}
const manifest = validateTurkeyGraphManifest(manifestRaw);
if (!manifest) throw new Error('MANIFEST_INVALID — kanonik doğrulayıcı reddetti');

/* ── Worker taşıyıcısı (gerçek worker modülü, gerçek mesaj sözleşmesi) ──── */

type Listener = (event: MessageEvent) => void;
/* Worker→host mesajları burada GÖZLENİR (değiştirilmez): bağımsız yasallık
   denetimi rota düğüm/yol kimliklerini ister, ürün `OfflineRouteResult` tipi
   ise onları taşımaz. Kimlikler GERÇEK rotanın kendisinden okunur; ürün tipi
   ölçüm uğruna şişirilmez. */
let lastRouteNodeIds: string[] | null = null;
let lastRouteWayIds: string[] | null = null;
let lastAltWindowBytes = 0;

const workerSelf = {
  navigator: { deviceMemory: 8 },
  postMessage: (message: unknown) => {
    const msg = message as { type?: string; routeNodeIds?: string[]; routeWayIds?: string[] };
    if (msg?.type === 'ROUTE_RESULT') {
      lastRouteNodeIds = msg.routeNodeIds ?? null;
      lastRouteWayIds = msg.routeWayIds ?? null;
    }
    queueMicrotask(() => hostOnMessage?.({ data: message } as MessageEvent));
  },
  close: () => {},
  onmessage: null as Listener | null,
};
/* ── Koşum ortamı shim'leri ───────────────────────────────────────────────
   Ürün modülleri tarayıcı API'leri bekler; Node'da yoklar. Bunlar ÖLÇÜM
   ORTAMI kurulumudur — ürün davranışını değiştirmez, yalnız modüllerin
   yüklenmesini sağlar. Rota mantığının hiçbiri buradan gelmez. */
const memoryStore = new Map<string, string>();
const storageShim = {
  getItem: (key: string) => memoryStore.get(key) ?? null,
  setItem: (key: string, value: string) => { memoryStore.set(key, String(value)); },
  removeItem: (key: string) => { memoryStore.delete(key); },
  clear: () => { memoryStore.clear(); },
  key: (index: number) => [...memoryStore.keys()][index] ?? null,
  get length() { return memoryStore.size; },
};
Object.assign(globalThis, {
  self: workerSelf,
  __VITE_ENV__: { DEV: false, PROD: true, MODE: 'production' },
  localStorage: storageShim,
  sessionStorage: storageShim,
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
});
/* `navigator` Node'da yalnız okunur bir getter'dır; alanı tanımlayarak ekleriz. */
Object.defineProperty(globalThis, 'navigator', {
  value: { deviceMemory: 8, userAgent: 'node-validation', onLine: true },
  configurable: true, writable: true,
});
await import('../src/platform/navigation/NavigationCompute.worker');

let hostOnMessage: Listener | null = null;
const workerTransport = {
  postMessage: (message: unknown) => {
    /* Pencere mesajındaki ALT dizisi ÖLÇÜLÜR: dilim önbelleğinden AYRI bir
       tahsistir; gerçek worker'da ayrıca structured-clone kopyası olur. */
    const window = (message as { altWindow?: Uint16Array | null }).altWindow;
    if (window) lastAltWindowBytes = Math.max(lastAltWindowBytes, window.byteLength);
    workerSelf.onmessage?.({ data: message } as MessageEvent);
  },
  terminate: () => {},
  set onmessage(listener: Listener | null) { hostOnMessage = listener; },
  get onmessage() { return hostOnMessage; },
  onerror: null,
  onmessageerror: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
} as unknown as Worker;

const { computeCrossRegionOfflineRoute, computeDiscoveredCrossRegionOfflineRoute,
  _setNavWorkerForTest, getCrossRegionSearchSnapshot } =
  await import('../src/platform/offlineRoutingService');
_setNavWorkerForTest(workerTransport);
const { _resetRegionalDataForTest, _restartRegionalDataRuntimeForTest,
  _setRegionalDataStorageAdapterForTest, getRegionalDataSnapshot } =
  await import('../src/platform/navigation/map/graph/regionalDataDistribution');

type ValidationStored = string | ArrayBuffer;
const validationRegionalStore = new Map<string, ValidationStored>();
const validationStorageAdapter = {
  readBytes: async (path: string) => {
    const value = validationRegionalStore.get(path);
    if (value === undefined) return null;
    if (typeof value === 'string') return new TextEncoder().encode(value).buffer;
    return value.slice(0);
  },
  writeBytes: async (path: string, bytes: ArrayBuffer) => { validationRegionalStore.set(path, bytes.slice(0)); },
  readText: async (path: string) => {
    const value = validationRegionalStore.get(path);
    if (value === undefined) return null;
    return typeof value === 'string' ? value : new TextDecoder().decode(value);
  },
  writeText: async (path: string, value: string) => { validationRegionalStore.set(path, value); },
  remove: async (path: string) => { validationRegionalStore.delete(path); },
  rename: async (from: string, to: string) => {
    const value = validationRegionalStore.get(from);
    if (value === undefined) throw new Error(`Kaynak yok: ${from}`);
    validationRegionalStore.set(to, value); validationRegionalStore.delete(from);
  },
  list: async (path: string) => {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    return [...new Set([...validationRegionalStore.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length).split('/')[0])
      .filter(Boolean))];
  },
  mkdir: async () => {},
};

/* ── Bölge/ALT dosyaları diskten servis edilir (ürün `fetch` yolu) ──────── */

let fetchBytes = 0;
let distributionServer: Server | null = null;
let distributionConfig: { manifestUrl:string;channel:string;expectedDatasetId:string;expectedGraphManifestSha256:string } | null = null;
if (!DISTRIBUTION) globalThis.fetch = (async (input: RequestInfo | URL) => {
  const file = String(input).replace(/^.*\/(regions\/[^/]+)$/, '$1');
  /* Graf `.rtg4` grafik koşumunda, `.alt` ALT koşumunda üretildi; ikisi de
     aynı sanal `/maps/rtg3/` kökünden servis edilir. */
  const candidates = [resolve(RUN, file), resolve(GRAPH_RUN, file)];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const bytes = readFileSync(path);
    fetchBytes += bytes.byteLength;
    return new Response(bytes);
  }
  return new Response(null, { status: 404 });
}) as typeof fetch;
else {
  _resetRegionalDataForTest();
  _setRegionalDataStorageAdapterForTest(validationStorageAdapter);
  const graphManifestSha256 = createHash('sha256').update(JSON.stringify(manifestRaw)).digest('hex');
  distributionServer = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (requestUrl.pathname === '/manifest.json') {
      const origin = `http://127.0.0.1:${(distributionServer!.address() as { port:number }).port}`;
      const body = JSON.stringify({ schemaVersion:1, datasetId:manifest.datasetId,
        datasetVersion:manifest.buildTimestamp, policyVersion:manifest.policyVersion,
        graphManifestSha256, graphManifest:manifestRaw,
        regions:manifest.regions.map((region) => ({ regionId:region.regionId,
          generation:graphManifestSha256.slice(0,16), graphUrl:`${origin}/${region.graphFile}`,
          ...(region.alt ? { altUrl:`${origin}/${region.alt.file}` } : {}) })) });
      response.setHeader('content-type','application/json'); response.setHeader('content-length',Buffer.byteLength(body)); response.end(body); return;
    }
    const relative = decodeURIComponent(requestUrl.pathname.replace(/^\//,''));
    const path = [resolve(RUN, relative), resolve(GRAPH_RUN, relative)].find(existsSync);
    if (!path) { response.statusCode=404; response.end(); return; }
    const bytes=readFileSync(path); fetchBytes += bytes.byteLength;
    response.setHeader('content-length',bytes.byteLength); response.end(bytes);
  });
  await new Promise<void>((done) => distributionServer!.listen(0,'127.0.0.1',done));
  const port = (distributionServer.address() as { port:number }).port;
  distributionConfig = { manifestUrl:`http://127.0.0.1:${port}/manifest.json`, channel:'validation',
    expectedDatasetId:manifest.datasetId, expectedGraphManifestSha256:graphManifestSha256 };
}

const CITY: Record<string, readonly [number, number]> = {
  'Mersin':       [36.8121, 34.6415],
  'Mersin-yerel': [36.7950, 34.6210],
  'Tarsus':       [36.9177, 34.8953],
  'Adana':        [37.0000, 35.3213],
  'Ankara':       [39.9334, 32.8597],
  'İstanbul':     [41.0082, 28.9784],
  'Antalya':      [36.8969, 30.7133],
  'Eskişehir':    [39.7767, 30.5206],
};

const PAIRS: Array<[string, string]> = [
  ['Mersin', 'Mersin-yerel'], ['Mersin', 'Tarsus'], ['Mersin', 'Adana'],
  ['Mersin', 'Ankara'], ['Mersin', 'Antalya'], ['İstanbul', 'Ankara'],
  ['Mersin', 'İstanbul'], ['Eskişehir', 'İstanbul'],
];
const ONLY = (process.env.RTG4_PAIRS ?? '').split(',').map((v) => v.trim()).filter(Boolean);
if (process.argv.includes('--mersin-istanbul')) ONLY.push('Mersin>İstanbul');

interface ProductRouteRow {
  from: string; to: string;
  heuristicMode: 'ALT' | 'GEOMETRIC' | 'UNKNOWN';
  altSliceLoads: number | null;
  /** Pencere ALT dizisinin baytı (dilim önbelleğinden AYRI tahsis). */
  altWindowBytes: number | null;
  altPeakResidentBytes: number | null;
  altUnavailableReason: string | null;
  closedStates: number | null;
  maxClosedBudget: number | null;
  weightEscalations: number | null;
  windowsUsed: number | null;
  peakResidentRegions: number | null;
  peakResidentGraphBytes: number | null;
  onDemandRegionLoads: number | null;
  regionEvictions: number | null;
  reconstructionBytes: number | null;
  fetchBytes: number;
  loadMs: number | null;
  solveMs: number | null;
  totalMs: number | null;
  distanceM: number | null;
  endpointErrorM: number | null;
  geometryPoints: number | null;
  budgetRespected: boolean | null;
  legality: RouteLegalityReport | null;
  result: string;
}

async function measure(fromName: string, toName: string): Promise<ProductRouteRow> {
  const from = CITY[fromName], to = CITY[toName];
  _resetGraphResidencyForTest();
  fetchBytes = 0;
  lastRouteNodeIds = null; lastRouteWayIds = null; lastAltWindowBytes = 0;
  const started = performance.now();
  const distributed = DISTRIBUTION ? await computeDiscoveredCrossRegionOfflineRoute(
    from[0], from[1], to[0], to[1], { allowDownload:true, maxClosedStates:BUDGET,
      distributionConfig:distributionConfig! }) : null;
  const route = distributed?.outcome === 'ROUTE_RESULT' ? distributed.route : DISTRIBUTION ? null
    : await computeCrossRegionOfflineRoute(manifest, from[0], from[1], to[0], to[1], '/maps/rtg3/', { maxClosedStates: BUDGET });
  const totalMs = performance.now() - started;
  const snapshot = getGraphResidencySnapshot();
  const search = getCrossRegionSearchSnapshot();

  const row: ProductRouteRow = {
    from: fromName, to: toName,
    heuristicMode: search === null || search.altActive === null
      ? 'UNKNOWN' : (search.altActive ? 'ALT' : 'GEOMETRIC'),
    altSliceLoads: snapshot.altSliceLoads,
    altWindowBytes: lastAltWindowBytes > 0 ? lastAltWindowBytes : null,
    altPeakResidentBytes: snapshot.altPeakResidentBytes,
    altUnavailableReason: snapshot.altUnavailableReason,
    closedStates: search?.closedStates ?? null,
    maxClosedBudget: search?.maxClosedBudget ?? null,
    weightEscalations: search?.weightEscalations ?? null,
    windowsUsed: search?.windowsUsed ?? null,
    peakResidentRegions: snapshot.peakResidentRegions,
    peakResidentGraphBytes: snapshot.peakResidentGraphBytes,
    onDemandRegionLoads: snapshot.onDemandRegionLoads,
    regionEvictions: snapshot.regionEvictions,
    reconstructionBytes: search?.reconstructionBytes ?? null,
    fetchBytes,
    loadMs: null, solveMs: null,
    totalMs: Number(totalMs.toFixed(1)),
    distanceM: route ? Math.round(route.distanceM) : null,
    endpointErrorM: null, geometryPoints: route ? route.geometry.length : null,
    budgetRespected: snapshot.peakResidentRegions <= REGIONAL_GRAPH_MAX_RESIDENT &&
      snapshot.peakResidentGraphBytes <= REGIONAL_GRAPH_MAX_BYTES,
    legality: null,
    result: route ? 'ROUTE_RESULT' : (distributed?.outcome ?? 'ROUTE_FAIL_CLOSED'),
  };
  if (route) {
    const endpoint = route.geometry.at(-1)!;
    row.endpointErrorM = Number(Math.hypot(
      (endpoint[1] - to[0]) * 111_000, (endpoint[0] - to[1]) * 90_000).toFixed(1));
    /* Bağımsız yasallık denetimi rota düğüm/yol kimliklerini ister; ürün
       sonucu bunları taşımıyorsa denetim ATLANMAZ, `null` bırakılır. */
    const nodeIds = lastRouteNodeIds, wayIds = lastRouteWayIds;
    if (nodeIds && wayIds) {
      /* Denetim kapsamı ROTA KORİDORUDUR. Kanonik zarf planlayıcısı burada
         yalnız "hangi bölgeler taranacak" sorusunu yanıtlamak için ÇAĞRILIR
         (yan etkisiz, saf); 402 bölgenin tamamını taramak ölçümü dakikalarca
         bloklardı ve denetimin kapsamını genişletmezdi. */
      const scope = planCrossRegionSearchEnvelope(
        manifest!, [from[0], from[1]], [to[0], to[1]], REGIONAL_GRAPH_MAX_RESIDENT);
      const scopeRegions = scope?.corridorRegionIds ?? manifest!.regions.map((r) => r.regionId);
      row.legality = auditRouteLegality(
        scopeRegions.map((regionId) => {
          const region = manifest!.regions.find((candidate) => candidate.regionId === regionId)!;
          return {
            regionId,
            path: existsSync(resolve(RUN, region.graphFile))
              ? resolve(RUN, region.graphFile) : resolve(GRAPH_RUN, region.graphFile),
          };
        }), nodeIds, wayIds);
    }
  }
  return row;
}

const rows: ProductRouteRow[] = [];
for (const [fromName, toName] of PAIRS) {
  if (ONLY.length && !ONLY.includes(`${fromName}>${toName}`)) continue;
  const row = await measure(fromName, toName);
  rows.push(row);
  console.log(
    `[ürün] ${fromName} → ${toName}: ${row.result} · mod ${row.heuristicMode} · ` +
    `kapatılan ${row.closedStates ?? '—'}/${row.maxClosedBudget ?? '—'} · ` +
    `ALT ${row.altPeakResidentBytes ?? '—'} B (${row.altSliceLoads ?? '—'} dilim) · ` +
    `graf ${row.peakResidentGraphBytes} B · mesafe ${row.distanceM ?? '—'} m · ` +
    `${row.totalMs} ms` + (row.altUnavailableReason ? ` · ALT yok: ${row.altUnavailableReason}` : ''));
}
const distributionSnapshot = DISTRIBUTION ? await getRegionalDataSnapshot() : null;
if (distributionServer) await new Promise<void>((done) => distributionServer!.close(() => done()));
let offlineRestart: Record<string, unknown> | null = null;
if (DISTRIBUTION) {
  validationRegionalStore.delete('navigation/regional-routing/installed-regions.json');
  validationRegionalStore.delete('navigation/regional-routing/installed-regions.json.next');
  _restartRegionalDataRuntimeForTest();
  _resetGraphResidencyForTest(); lastRouteNodeIds=null; lastRouteWayIds=null;
  const before=fetchBytes, from=CITY.Mersin, to=CITY['İstanbul'];
  const started=performance.now();
  const repeated=await computeDiscoveredCrossRegionOfflineRoute(from[0],from[1],to[0],to[1],{
    allowDownload:false,maxClosedStates:BUDGET,distributionConfig:distributionConfig! });
  const search=getCrossRegionSearchSnapshot(), residency=getGraphResidencySnapshot();
  const recoveredDistribution=await getRegionalDataSnapshot();
  offlineRestart={ outcome:repeated.outcome, networkArtifactBytes:fetchBytes-before,
    registryRecoveryStatus:recoveredDistribution.registryRecoveryStatus,
    recoveredGenerations:recoveredDistribution.recoveredGenerations,
    rejectedGenerations:recoveredDistribution.rejectedGenerations,
    orphanGenerations:recoveredDistribution.orphanGenerations,
    lastRebuildFailure:recoveredDistribution.lastRebuildFailure,
    lastPublishFailure:recoveredDistribution.lastPublishFailure,
    installedRegionsAfterRebuild:recoveredDistribution.installedRegions,
    heuristicMode:search?.altActive?'ALT':'GEOMETRIC', closedStates:search?.closedStates ?? null,
    distanceM:repeated.outcome==='ROUTE_RESULT'?Math.round(repeated.route.distanceM):null,
    peakResidentRegions:residency.peakResidentRegions,peakResidentGraphBytes:residency.peakResidentGraphBytes,
    totalMs:Number((performance.now()-started).toFixed(1)) };
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const productionGraphPath = resolve('public/maps/routing-graph.bin');
const productionGraph = readFileSync(productionGraphPath);

writeFileSync(resolve(OUT, 'alt-product-path-validation.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  manifestPath, graphRunDir: GRAPH_RUN, altDisabled: ALT_DISABLED, budget: BUDGET,
  distribution: distributionSnapshot,
  offlineRestart,
  altLandmarkSet: manifest.altLandmarkSet
    ? {
        landmarkSetId: manifest.altLandmarkSet.landmarkSetId,
        landmarkCount: manifest.altLandmarkSet.landmarkCount,
        scaleM: manifest.altLandmarkSet.scaleM,
        regionsWithSlice: manifest.regions.filter((region) => region.alt !== undefined).length,
        totalRegions: manifest.regions.length,
      }
    : null,
  residencyPolicy: {
    maxResidentRegions: REGIONAL_GRAPH_MAX_RESIDENT,
    maxResidentGraphBytes: REGIONAL_GRAPH_MAX_BYTES,
  },
  routes: rows,
  productionGraph: {
    bytes: productionGraph.byteLength, sha256: sha(productionGraph),
    unchanged: sha(productionGraph) === 'e7713f7575fb587386858db44b2e9ab84278686a06d42d04cd16e8663af691da',
  },
}, null, 2));
console.log(`\nYazıldı: ${resolve(OUT, 'alt-product-path-validation.json')}`);
