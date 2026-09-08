/**
 * validate-rtg4-ondemand-longroute.ts — RTG4 SINIRLI SAKİNLİKLİ UZUN ROTA ÖLÇÜMÜ.
 *
 * İkinci router / ikinci residency otoritesi YOKTUR. Ölçüm zinciri tamamen
 * kanonik modüllerdir:
 *   `validateTurkeyGraphManifest` → `planCrossRegionSearchEnvelope`
 *   → `acquireRegionWindow` (graphResidencyRuntime) → `NavigationCompute.worker`
 *   → `routeRtg3EdgeState` (tek kenar-durumlu A*).
 *
 * Bu dosya bir DOĞRULAMA koşumudur; ürün kararı üretmez. Ölçtüğü her sayı
 * gerçek artefakttan gelir — sabit/örnek değer YOKTUR. Ölçülemeyen alan
 * `null` kalır, "0" diye yazılmaz.
 *
 * Koşum:
 *   node --max-old-space-size=6144 --experimental-strip-types --no-warnings \n *        --loader ./scripts/nodeTsResolve.mjs scripts/validate-rtg4-ondemand-longroute.ts
 */
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { RoutingGraphView } from '../src/platform/navigation/map/graph/rtg2Reader';
import {
  acquireRegionWindow, releaseRegionWindow, getGraphResidencySnapshot,
  _resetGraphResidencyForTest,
  REGIONAL_GRAPH_MAX_BYTES, REGIONAL_GRAPH_MAX_RESIDENT,
} from '../src/platform/navigation/map/graph/graphResidencyRuntime';
import {
  planCrossRegionSearchEnvelope, validateTurkeyGraphManifest,
  type RegionWindowIdentity, type TurkeyGraphManifest,
} from '../src/platform/navigation/map/graph/turkeyGraphManifest';
import { auditRouteLegality, type RouteLegalityReport } from './rtg4RouteLegalityAudit';

const RUN = resolve(process.env.RTG4_RUN_DIR ?? 'field-runs/rtg4-portal-v2-national-20260908');
const OUT = resolve(process.env.RTG4_OUT_DIR ?? 'field-runs/rtg4-ondemand-longroute-20260908');
const manifestPath = resolve(RUN, 'turkey-graph-manifest.json');
if (!existsSync(manifestPath)) throw new Error(`Manifest yok: ${manifestPath}`);
mkdirSync(OUT, { recursive: true });

const manifestRaw = readFileSync(manifestPath);
const manifest: TurkeyGraphManifest | null =
  validateTurkeyGraphManifest(JSON.parse(manifestRaw.toString('utf8')));
if (!manifest) throw new Error('MANIFEST_INVALID — kanonik doğrulayıcı reddetti');

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/* ── Worker köprüsü (kanonik worker, gerçek mesaj protokolü) ─────────────── */

type Posted = {
  type: string; requestId?: string; windowIndex?: number;
  requestedRegionIds?: string[]; fromRegionIds?: string[];
  geometry?: [number, number][]; distanceM?: number; durationS?: number;
  reason?: string; crossRegion?: Record<string, number> | null;
  routeNodeIds?: string[]; routeWayIds?: string[];
  crossRegionClosedPerWindow?: number[];
};

const posted: Posted[] = [];
const workerSelf = {
  navigator: { deviceMemory: 8 },
  postMessage: (m: Posted) => posted.push(m),
  close: () => {},
  onmessage: null as ((event: MessageEvent) => void) | null,
};
Object.assign(globalThis, { self: workerSelf });
await import('../src/platform/navigation/NavigationCompute.worker');

/** Bölge dosyaları diskten servis edilir; SHA doğrulaması kanonik koddadır. */
let fetchBase = RUN;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const file = String(input).replace(/^.*\/(regions\/[^/]+)$/, '$1');
  const path = resolve(fetchBase, file);
  if (!existsSync(path)) return new Response(null, { status: 404 });
  return new Response(readFileSync(path));
}) as typeof fetch;

const send = (data: Record<string, unknown>) =>
  workerSelf.onmessage!({ data } as MessageEvent);

/* ── Ölçüm birimi: TEK uzun rota koşumu ─────────────────────────────────── */

const CITY: Record<string, readonly [number, number]> = {
  'Mersin':       [36.8121, 34.6415],
  'Mersin-yerel': [36.7950, 34.6210],
  'Tarsus':       [36.9177, 34.8953],
  'Adana':        [37.0000, 35.3213],
  'Ankara':       [39.9334, 32.8597],
  'İstanbul':     [41.0082, 28.9784],
  'Antalya':      [36.8969, 30.7133],
  /* P16 — uzun rota sapması: koridorun ORTASINDAN yeniden çözüm. Yeniden
     rotalama ayrı bir motor DEĞİLDİR; yeni ego konumuyla AYNI on-demand
     zarf/pencere/A* zinciri baştan koşar, ülke grafı yüklenmez. */
  'Eskişehir':    [39.7767, 30.5206],
};

/**
 * Cihaz varsayılanı `MAX_CLOSED`tır (deviceMemory'e göre 30k–200k). Gölge
 * ölçümde tavan AÇIKÇA yükseltilebilir; amaç "cihazda geçerli" ile "bu rotanın
 * gerçekte ne kadar arama gerektirdiği" ölçümünü BİRBİRİNE KARIŞTIRMAMAKTIR.
 * Rapor her iki sayıyı da ayrı verir.
 */
/** Ölçülecek arama bütçeleri. Varsayılan cihaz profilleri + ürün bütçesi. */
const BUDGETS = (process.env.RTG4_BUDGETS ?? '30000,50000,100000,200000')
  .split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0);
/** Bağımsız yasallık denetiminin koşulacağı bütçe (ürün bütçesi). */
const AUDIT_BUDGET = Number(process.env.RTG4_AUDIT_BUDGET ?? 200_000);
/** Ağırlık/rota-kalitesi taraması — ürün DAİMA 1,2 kullanır (gönderilmez). */
const SWEEP_WEIGHT = process.env.RTG4_W ? Number(process.env.RTG4_W) : null;
/** Omurga uygunluk taraması: sınıf tavanı ve budamasız yarıçap (0 = kapalı). */
const SWEEP_CLASS_LIMIT = Number(process.env.RTG4_CLASS_LIMIT ?? 0);
const SWEEP_FREE_RADIUS_M = Number(process.env.RTG4_FREE_RADIUS_M ?? 0);
const SWEEP_TIER_OFFSET_M = Number(process.env.RTG4_TIER_OFFSET_M ?? 0);
const SWEEP_FINAL_W = process.env.RTG4_FINAL_W ? Number(process.env.RTG4_FINAL_W) : null;
const SWEEP_ESCALATE_AFTER = Number(process.env.RTG4_ESCALATE_AFTER ?? 0);
const SWEEP_ESCALATE_FACTOR = Number(process.env.RTG4_ESCALATE_FACTOR ?? 0);
const SWEEP_ESCALATE_MAX_W = Number(process.env.RTG4_ESCALATE_MAX_W ?? 0);
/** Temel çizgi ölçümü: koridor alt sınırını kapatıp eski davranışı ölç. */
const CORRIDOR_BOUND_OFF = process.env.RTG4_NO_CORRIDOR_BOUND === '1';
const DEVICE_DEFAULT_MAX_CLOSED = 200_000;   // deviceMemory=8 dalı (worker `_computeMaxClosed`)

interface RouteMeasurement {
  from: string; to: string;
  originRegionId: string | null;
  destinationRegionId: string | null;
  envelopeRegions: number | null;
  windowCount: number | null;
  touchedRegions: number | null;
  peakResidentRegions: number | null;
  peakResidentGraphBytes: number | null;
  onDemandRegionLoads: number | null;
  regionEvictions: number | null;
  portalTransitions: number | null;
  windowAdvances: number | null;
  loadMs: number | null;
  solveMs: number | null;
  totalMs: number | null;
  distanceM: number | null;
  endpointErrorM: number | null;
  searchStateBytesEstimate: number | null;
  reconstructionBytes: number | null;
  reconstructionRecords: number | null;
  budget: number;
  expansions: number | null;
  pops: number | null;
  stalePops: number | null;
  relaxations: number | null;
  peakSearchStates: number | null;
  migratedStates: number | null;
  droppedStates: number | null;
  geometryPoints: number | null;
  budgetRespected: boolean | null;
  legality: RouteLegalityReport | null;
  closedPerWindow: number[] | null;
  /** Kapatılan durumların GİRİŞ kenar sınıfı histogramı (indis = RTG3 sınıfı). */
  closedByClass: number[] | null;
  result: string;
  detail?: string;
}

async function measureRoute(
  fromName: string, toName: string, budget: number, audit = false,
): Promise<RouteMeasurement> {
  const from = CITY[fromName], to = CITY[toName];
  const record: RouteMeasurement = {
    from: fromName, to: toName, budget, legality: null, closedPerWindow: null,
    originRegionId: null, destinationRegionId: null,
    envelopeRegions: null, windowCount: null, touchedRegions: null,
    peakResidentRegions: null, peakResidentGraphBytes: null,
    onDemandRegionLoads: null, regionEvictions: null, portalTransitions: null,
    windowAdvances: null, pops: null, stalePops: null, relaxations: null,
    loadMs: null, solveMs: null, totalMs: null,
    distanceM: null, endpointErrorM: null,
    searchStateBytesEstimate: null, reconstructionBytes: null, reconstructionRecords: null,
    expansions: null, peakSearchStates: null, migratedStates: null, droppedStates: null,
    geometryPoints: null, budgetRespected: null, closedByClass: null,
    result: 'NOT_RUN',
  };

  const envelope = planCrossRegionSearchEnvelope(manifest!, from, to, REGIONAL_GRAPH_MAX_RESIDENT);
  if (!envelope) { record.result = 'BLOCKED_NO_DIRECTED_PORTAL_ENVELOPE'; return record; }
  record.originRegionId = envelope.originRegionId;
  record.destinationRegionId = envelope.destinationRegionId;
  record.envelopeRegions = envelope.corridorRegionIds.length;
  record.windowCount = envelope.windows.length;
  record.portalTransitions = envelope.transitions.length;

  _resetGraphResidencyForTest();
  posted.length = 0;
  const requestId = `x-${fromName}-${toName}`;
  const touched = new Set<string>();
  let loadMs = 0, solveMs = 0, budgetRespected = true;
  const started = performance.now();

  send({
    type: 'CROSS_REGION_BEGIN', requestId,
    fromLat: from[0], fromLon: from[1], toLat: to[0], toLon: to[1],
    windowCount: envelope.windows.length, maxClosedStates: budget,
    ...(SWEEP_WEIGHT === null ? {} : { heuristicWeight: SWEEP_WEIGHT }),
    ...(SWEEP_FINAL_W === null ? {} : { finalHeuristicWeight: SWEEP_FINAL_W }),
    ...(SWEEP_ESCALATE_AFTER > 0 ? { escalateAfterStates: SWEEP_ESCALATE_AFTER } : {}),
    ...(SWEEP_ESCALATE_FACTOR > 1 ? { escalateFactor: SWEEP_ESCALATE_FACTOR } : {}),
    ...(SWEEP_ESCALATE_MAX_W > 0 ? { escalateMaxWeight: SWEEP_ESCALATE_MAX_W } : {}),
    ...(SWEEP_CLASS_LIMIT > 0
      ? {
          corridorClassLimit: SWEEP_CLASS_LIMIT, corridorFreeRadiusM: SWEEP_FREE_RADIUS_M,
          ...(SWEEP_TIER_OFFSET_M > 0 ? { corridorTierOffsetM: SWEEP_TIER_OFFSET_M } : {}),
        }
      : {}),
  });

  /* Sürücüyle AYNI politika (ürün: `computeCrossRegionOfflineRoute`). */
  let advances = 0;
  for (let round = 0; round < envelope.windows.length + 2; round++) {
    const message = posted.shift();
    if (!message) { record.result = 'NO_RESPONSE'; break; }

    if (message.type === 'CROSS_REGION_NEED_WINDOW') {
      const windowIndex = Number(message.windowIndex ?? 0);
      if (windowIndex < 0 || windowIndex >= envelope.windows.length) {
        record.result = 'BLOCKED_ENVELOPE_EXHAUSTED';
        break;
      }
      advances = windowIndex;
      const regionIds = envelope.windows[windowIndex];
      const loadStart = performance.now();
      const residency = await acquireRegionWindow(manifest!, regionIds, '/fixture');
      loadMs += performance.now() - loadStart;
      if (!residency) {
        record.result = `BLOCKED_WINDOW_LOAD:${getGraphResidencySnapshot().windowFailClosedReason ?? '?'}`;
        break;
      }
      for (const id of regionIds) touched.add(id);
      const snapshot = getGraphResidencySnapshot();
      if (snapshot.residentRegions.length > REGIONAL_GRAPH_MAX_RESIDENT ||
          snapshot.residentGraphBytes > REGIONAL_GRAPH_MAX_BYTES) budgetRespected = false;

      const isFinal = windowIndex === envelope.windows.length - 1;
      const solveStart = performance.now();
      send({
        type: 'CROSS_REGION_WINDOW', requestId, windowIndex,
        graphView: residency.view as RoutingGraphView,
        identity: residency.identity as RegionWindowIdentity,
        exitPortals: isFinal ? [] : envelope.transitions[windowIndex].portalNodeIds.map(
          (nodeId) => ({ nodeId, regionIds: [envelope.transitions[windowIndex].toRegionId] })),
        /* Ölçüm koşumu koridor alt sınırını KAPATABİLİR (`RTG4_NO_CORRIDOR_BOUND=1`);
           bu, optimizasyon ÖNCESİ temel çizgiyi aynı kodla ölçmek içindir. */
        boundaryBox: isFinal || CORRIDOR_BOUND_OFF ? null : envelope.transitions[windowIndex].boundaryBox,
        remainingLowerBoundM: isFinal || CORRIDOR_BOUND_OFF ? 0 : envelope.transitions[windowIndex].remainingLowerBoundM,
        isFinal,
      });
      solveMs += performance.now() - solveStart;
      continue;
    }

    if (message.type === 'ROUTE_RESULT' && message.geometry) {
      const endpoint = message.geometry.at(-1)!;
      record.distanceM = Math.round(message.distanceM ?? 0);
      record.endpointErrorM = Number(Math.hypot(
        (endpoint[1] - to[0]) * 111_000, (endpoint[0] - to[1]) * 90_000).toFixed(1));
      record.geometryPoints = message.geometry.length;
      record.result = 'ROUTE_RESULT';
    } else if (message.type === 'ROUTE_ERROR') {
      record.result = `ROUTE_ERROR:${message.reason ?? '?'}`;
    } else {
      record.result = `UNEXPECTED:${message.type}`;
    }
    if (message.type === 'ROUTE_RESULT' && audit && message.routeNodeIds && message.routeWayIds) {
      /* BAĞIMSIZ denetim: worker'ın kararına güvenmez, bölge artefaktlarını
         kendisi okur. Rota otoritesi DEĞİLDİR. */
      record.legality = auditRouteLegality(
        envelope.corridorRegionIds.map((regionId) => ({
          regionId,
          path: resolve(RUN, manifest!.regions.find((r) => r.regionId === regionId)!.graphFile),
        })),
        message.routeNodeIds, message.routeWayIds);
    }
    record.closedPerWindow = message.crossRegionClosedPerWindow ?? null;
    if (message.crossRegion) {
      record.expansions = message.crossRegion.expansions ?? null;
      record.pops = message.crossRegion.pops ?? null;
      record.stalePops = message.crossRegion.stalePops ?? null;
      record.relaxations = message.crossRegion.relaxations ?? null;
      record.peakSearchStates = message.crossRegion.peakSearchStates ?? null;
      record.migratedStates = message.crossRegion.migratedStates ?? null;
      record.droppedStates = message.crossRegion.droppedStates ?? null;
      record.reconstructionBytes = message.crossRegion.reconstructionBytes ?? null;
      record.reconstructionRecords = message.crossRegion.reconstructionRecords ?? null;
      /* Arama durumu belleği: anahtar dizgesi + Map girdisi kaba tahminidir.
         ÖLÇÜLEN değil TAHMİN olduğu adıyla da belirtilir. */
      record.searchStateBytesEstimate = Math.round((message.crossRegion.peakSearchStates ?? 0) * 96);
      const histogram = Array.from({ length: 10 }, (_v, i) =>
        Number(message.crossRegion![`closedClass${i}`] ?? 0));
      record.closedByClass = histogram.some((n) => n > 0) ? histogram : null;
    }
    break;
  }

  const snapshot = getGraphResidencySnapshot();
  record.touchedRegions = touched.size;
  record.windowAdvances = advances;   // kullanılan son pencere indisi
  record.peakResidentRegions = snapshot.peakResidentRegions;
  record.peakResidentGraphBytes = snapshot.peakResidentGraphBytes;
  record.onDemandRegionLoads = snapshot.onDemandRegionLoads;
  record.regionEvictions = snapshot.regionEvictions;
  record.loadMs = Number(loadMs.toFixed(1));
  record.solveMs = Number(solveMs.toFixed(1));
  record.totalMs = Number((performance.now() - started).toFixed(1));
  record.budgetRespected = budgetRespected &&
    snapshot.peakResidentRegions <= REGIONAL_GRAPH_MAX_RESIDENT &&
    snapshot.peakResidentGraphBytes <= REGIONAL_GRAPH_MAX_BYTES;
  send({ type: 'CROSS_REGION_ABORT', requestId });
  releaseRegionWindow();
  if (global.gc) global.gc();
  return record;
}

/* ── P11 · ÜLKE ROTA KORPUSU ────────────────────────────────────────────── */

const ONLY = (process.env.RTG4_PAIRS ?? '').split(',').map((v) => v.trim()).filter(Boolean);
const PAIRS: Array<[string, string]> = [
  ['Mersin', 'Mersin-yerel'],
  ['Mersin', 'Tarsus'],
  ['Mersin', 'Adana'],
  ['Mersin', 'Ankara'],
  ['Mersin', 'Antalya'],
  ['İstanbul', 'Ankara'],
  ['Mersin', 'İstanbul'],
  ['Eskişehir', 'İstanbul'],
];

const routesByBudget: Record<string, RouteMeasurement[]> = {};
for (const budget of BUDGETS) {
  const rows: RouteMeasurement[] = [];
  for (const [fromName, toName] of PAIRS) {
    if (ONLY.length && !ONLY.includes(`${fromName}>${toName}`)) continue;
    const measurement = await measureRoute(fromName, toName, budget, budget === AUDIT_BUDGET);
    rows.push(measurement);
    console.log(`[${budget}] ${fromName} → ${toName}: ${measurement.result} · ` +
      `kapatılan ${measurement.expansions ?? '—'} · zarf ${measurement.envelopeRegions} · ` +
      `tepe yerleşik ${measurement.peakResidentRegions} · ${measurement.peakResidentGraphBytes} B · ` +
      `arşiv ${measurement.reconstructionBytes ?? '—'} B · mesafe ${measurement.distanceM ?? '—'} m · ` +
      `${measurement.totalMs} ms` +
      (measurement.legality ? ` · ihlal ${measurement.legality.totalViolations}` : ''));
  }
  routesByBudget[String(budget)] = rows;
}
const routes = routesByBudget[String(AUDIT_BUDGET)] ?? routesByBudget[String(BUDGETS.at(-1))] ?? [];

/* ── P13 · GERÇEK VERİYLE ARIZA KORPUSU (fabrikasyon rota OLMAMALI) ─────── */

const failures: Array<{ case: string; expected: string; actual: string; result: 'PASS' | 'FAIL' }> = [];
const expectFail = (name: string, expected: string, actual: string, ok: boolean) =>
  failures.push({ case: name, expected, actual, result: ok ? 'PASS' : 'FAIL' });

{
  /* Bölge dosyası YOK → pencere yüklenemez, rota uydurulmaz. */
  _resetGraphResidencyForTest();
  fetchBase = resolve(RUN, 'regions-does-not-exist');
  const missing = await measureRoute('Mersin', 'Adana', AUDIT_BUDGET);
  fetchBase = RUN;
  expectFail('next-region-missing', 'BLOCKED_WINDOW_LOAD', missing.result,
    missing.result.startsWith('BLOCKED_WINDOW_LOAD') && missing.distanceM === null);
}

{
  /* Manifestte olmayan bölge → bütçe/kimlik reddi. */
  _resetGraphResidencyForTest();
  const bogus = await acquireRegionWindow(manifest, ['tr-00-00'], '/fixture');
  expectFail('unknown-region-id', 'null + WINDOW_REGION_MISSING',
    `${bogus === null ? 'null' : 'view'} + ${getGraphResidencySnapshot().windowFailClosedReason}`,
    bogus === null && getGraphResidencySnapshot().windowFailClosedReason === 'WINDOW_REGION_MISSING');
}

{
  /* Residency tavanının üstünde pencere talebi → fail-closed. */
  _resetGraphResidencyForTest();
  const corridor = planCrossRegionSearchEnvelope(
    manifest, CITY['Mersin'], CITY['Ankara'], REGIONAL_GRAPH_MAX_RESIDENT);
  const tooMany = corridor
    ? await acquireRegionWindow(manifest, corridor.corridorRegionIds.slice(0, REGIONAL_GRAPH_MAX_RESIDENT + 1), '/fixture')
    : null;
  expectFail('resident-region-cap-exceeded', 'null + WINDOW_REGION_BUDGET',
    `${tooMany === null ? 'null' : 'view'} + ${getGraphResidencySnapshot().windowFailClosedReason}`,
    tooMany === null && getGraphResidencySnapshot().windowFailClosedReason === 'WINDOW_REGION_BUDGET');
}

{
  /* Zarf yok (deniz/kapsam dışı hedef) → rota DEĞİL, planlayıcı reddi. */
  const offshore = planCrossRegionSearchEnvelope(manifest, CITY['Mersin'], [0, 0], REGIONAL_GRAPH_MAX_RESIDENT);
  expectFail('no-region-coverage', 'null', offshore === null ? 'null' : 'envelope', offshore === null);
}

{
  /* Ayrık bölge (`tr-51-80` komşusuz) → yönlü portal kanıtı YOK. */
  const isolated = manifest.regions.find((region) => region.neighbors.length === 0);
  const target = isolated
    ? ([(isolated.bbox[1] + isolated.bbox[3]) / 2, (isolated.bbox[0] + isolated.bbox[2]) / 2] as [number, number])
    : null;
  const envelope = target ? planCrossRegionSearchEnvelope(manifest, CITY['Mersin'], target, REGIONAL_GRAPH_MAX_RESIDENT) : null;
  expectFail('disconnected-envelope', 'null', envelope === null ? 'null' : 'envelope',
    isolated !== null && envelope === null);
}

/* ── ÖZET ───────────────────────────────────────────────────────────────── */

const productionGraphPath = resolve('public/maps/routing-graph.bin');
const evidence = {
  generatedAt: new Date().toISOString(),
  runDir: RUN,
  manifest: {
    path: manifestPath, bytes: manifestRaw.byteLength, sha256: sha(manifestRaw),
    datasetId: manifest.datasetId, regions: manifest.regions.length,
    portals: manifest.portals?.length ?? null,
  },
  residencyPolicy: {
    maxResidentRegions: REGIONAL_GRAPH_MAX_RESIDENT,
    maxResidentGraphBytes: REGIONAL_GRAPH_MAX_BYTES,
    deviceDefaultMaxClosedStates: DEVICE_DEFAULT_MAX_CLOSED,
    measuredBudgets: BUDGETS,
    auditBudget: AUDIT_BUDGET,
    corridorLowerBoundEnabled: !CORRIDOR_BOUND_OFF,
    heuristicWeightUsed: SWEEP_WEIGHT ?? 1.2,
  },
  routes,
  routesByBudget,
  failures,
  failureCorpusPass: failures.every((f) => f.result === 'PASS'),
  process: {
    /* MASAÜSTÜ ölçümüdür — CİHAZ sonucu DEĞİLDİR. */
    peakRssBytes: process.memoryUsage().rss,
    heapUsedBytes: process.memoryUsage().heapUsed,
    node: process.version,
  },
  productionGraph: existsSync(productionGraphPath) ? {
    bytes: statSync(productionGraphPath).size,
    sha256: sha(readFileSync(productionGraphPath)),
    unchanged: sha(readFileSync(productionGraphPath)) ===
      'e7713f7575fb587386858db44b2e9ab84278686a06d42d04cd16e8663af691da',
  } : null,
};

writeFileSync(resolve(OUT, 'ondemand-longroute-validation.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ residencyPolicy: evidence.residencyPolicy, failures, productionGraph: evidence.productionGraph }, null, 2));
