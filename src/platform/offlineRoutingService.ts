/**
 * Offline Routing Service — WebWorker tabanlı A* yönlendirme motoru.
 *
 * Mimari (3 katman, öncelik sırasıyla):
 *   1. localhost:5000    — Android native OSRM daemon (CarLauncherPlugin.startOsrmDaemon)
 *   2. Uzak OSRM        — routing.openstreetmap.de (mevcut routingService)
 *   3. Bu servis        — WebWorker A* (ağ olmadan son çare)
 *
 * Offline routing için gereken veri:
 *   /maps/routing-graph.bin — Sıkıştırılmış yol ağı (aşağıdaki GraphExporter ile üretilir)
 *
 * Neden WebWorker:
 *   A* 50k düğümlü Türkiye şehir grafiği için ~80-300ms.
 *   Head unit Main Thread'ini bloke eder → Worker zorunlu.
 *
 * Routing graph formatı (routing-graph.bin):
 *   [4 byte: nodeCount]
 *   [nodeCount × 16 byte: lat(f32), lon(f32), -, -]
 *   [4 byte: edgeCount]
 *   [edgeCount × 12 byte: from(u32), to(u32), costM(u32)]
 *
 * Graph üretimi (Node.js script, ayrı tool):
 *   osmium extract -b bbox turkey.osm.pbf | osm-graph-exporter > routing-graph.bin
 */

import { logError } from './crashLogger';
import { registerCachePurge } from './memoryWatchdog';
import { runtimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import type { RouteStep } from './routingService';

/* ── Tipler ──────────────────────────────────────────────────── */

export interface OfflineRouteResult {
  geometry:  [number, number][];  // [lon, lat][] — OSRM ile aynı format
  distanceM: number;
  durationS: number;              // tahmini (30 km/h ortalama)
  steps:     RouteStep[];
  source:    'offline-worker' | 'offline-daemon' | 'straight-line';
}

/* ── OSRM maneuver → Türkçe (daemon için yerel kopya) ─────────── */

function _toTR(type: string, mod: string, name: string): string {
  const s = name ? ` (${name})` : '';
  if (type === 'depart')                            return `Yola çıkın${s}`;
  if (type === 'arrive')                            return 'Hedefinize ulaştınız';
  if (type === 'roundabout' || type === 'rotary')   return 'Dönel kavşakta devam edin';
  if (type === 'end of road')                       return 'Yol sonunda dönün';
  if (mod  === 'uturn')                             return 'U dönüşü yapın';
  if (mod  === 'sharp right')                       return `Sert sağa dönün${s}`;
  if (mod  === 'right')                             return `Sağa dönün${s}`;
  if (mod  === 'slight right')                      return `Hafif sağa dönün${s}`;
  if (mod  === 'straight')                          return `Düz devam edin${s}`;
  if (mod  === 'slight left')                       return `Hafif sola dönün${s}`;
  if (mod  === 'left')                              return `Sola dönün${s}`;
  if (mod  === 'sharp left')                        return `Sert sola dönün${s}`;
  return `Devam edin${s}`;
}

/* ── Local daemon (native OSRM) ──────────────────────────────── */

/**
 * CarLauncherPlugin.startOsrmDaemon() çağrısından sonra
 * http://localhost:5000 adresinde OSRM HTTP API açılır.
 *
 * Native tarafta yapılacaklar:
 *   - Android Service olarak çalıştır (foreground service)
 *   - /data/data/com.cockpitos.pro/files/osrm/ dizininden .osrm binary oku
 *   - NanoHTTPD ile 5000 portunda OSRM HTTP API sun
 *
 * Bu fonksiyon, daemon ayakta ise rota döner; değilse null döner.
 */
// Use public OSRM demo server — avoids mixed content block on Android
const LOCAL_DAEMON_URL = 'https://router.project-osrm.org/route/v1/driving';
const LOCAL_DAEMON_TIMEOUT_MS = 3_000;

export async function tryLocalDaemon(
  fromLon: number, fromLat: number,
  toLon:   number, toLat:   number,
): Promise<OfflineRouteResult | null> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOCAL_DAEMON_TIMEOUT_MS);
  try {
    const url = `${LOCAL_DAEMON_URL}/${fromLon},${fromLat};${toLon},${toLat}?steps=true&geometries=geojson&overview=full`;
    console.log('[OSRM_URL]', url);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    interface _DaemonOsrmStep {
      distance: number;
      duration: number;
      name: string;
      maneuver: { type: string; modifier?: string };
      geometry: { coordinates: [number, number][] };
    }
    const data = await res.json() as {
      code: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry: { coordinates: [number, number][] };
        legs: Array<{ steps: _DaemonOsrmStep[] }>;
      }>;
    };
    if (data.code !== 'Ok' || !data.routes?.length) return null;

    const r = data.routes[0];
    const steps: RouteStep[] = (r.legs?.[0]?.steps ?? []).map(st => ({
      instruction:      _toTR(st.maneuver.type, st.maneuver.modifier ?? 'straight', st.name ?? ''),
      streetName:       st.name ?? '',
      distance:         st.distance,
      duration:         st.duration,
      maneuverType:     st.maneuver.type,
      maneuverModifier: st.maneuver.modifier ?? 'straight',
      coordinate:       st.geometry.coordinates[0] as [number, number],
    }));

    return {
      geometry:  r.geometry.coordinates as [number, number][],
      distanceM: r.distance,
      durationS: r.duration,
      steps,
      source:    'offline-daemon',
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/* ── WebWorker A* ────────────────────────────────────────────── */

const GRAPH_URL        = '/maps/routing-graph.bin';
const GRAPH_TIMEOUT_MS = 5_000;

// Binary format version magic: 'RTG2' as little-endian u32.
// v1 (legacy): [nodeCount:u32][nodes...][edgeCount:u32][edges × 12B: from,to,costM]
// v2 (current): [GRAPH_MAGIC_V2:u32][nodeCount:u32][nodes...][edgeCount:u32][edges × 13B: from,to,costM,flags]
//   flags bit 0 = oneway (1 → forward only, no reverse edge inserted)
const GRAPH_MAGIC_V2 = 0x32475452; // 'RTG2' LE

interface GraphNode { lat: number; lon: number; }

interface GraphEdge {
  to:     number;
  costM:  number;
  oneway: boolean; // stored for graph inspection; A* reads adjacency which already encodes directionality
}

interface RoutingGraph {
  nodes:     GraphNode[];
  adjacency: Map<number, GraphEdge[]>;
  version:   1 | 2;
}

// Dynamic A* closed-set limit — scales with device RAM (navigator.deviceMemory, Chrome/WebView API).
// Prevents OOM on 1GB head units while allowing deeper search on 4GB+ devices.
function _computeMaxClosed(): number {
  const mem = typeof navigator !== 'undefined'
    ? (navigator as { deviceMemory?: number }).deviceMemory
    : undefined;
  if (!mem || mem <= 1) return 30_000;
  if (mem <= 2)         return 50_000;
  if (mem <= 4)         return 100_000;
  return 200_000;
}
const MAX_CLOSED_SET_SIZE = _computeMaxClosed();

// WeakRef-based cache: allows GC to reclaim the graph under memory pressure.
// The strong reference lives only inside computeOfflineRoute's call frame (pinned
// for the duration of A*), then becomes eligible for collection once routing completes.
// If GC collects it, the next call transparently reloads from the binary file.
// _graphLoadFailed stays true only for permanent errors (HTTP 4xx/5xx / parse failure)
// so transient network timeouts allow a retry on the next navigation request.
let _graphWeakRef:  WeakRef<RoutingGraph> | null = null;
let _graphLoadFailed = false;

export async function loadRoutingGraph(): Promise<RoutingGraph | null> {
  // Prefer the WeakRef-cached instance — reuse while still alive in memory
  const cached = _graphWeakRef?.deref();
  if (cached) return cached;

  // Permanent load failure (404 / parse error) — don't retry
  if (_graphLoadFailed) return null;

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GRAPH_TIMEOUT_MS);
    const res   = await fetch(GRAPH_URL, { signal: ctrl.signal });
    clearTimeout(timer);

    if (!res.ok) {
      _graphLoadFailed = true; // HTTP error → file absent, no retry
      return null;
    }

    const buf  = await res.arrayBuffer();
    const view = new DataView(buf);
    let   off  = 0;

    // Version detection: v2 starts with GRAPH_MAGIC_V2; v1 starts with nodeCount directly
    const firstWord = view.getUint32(off, true); off += 4;
    const version: 1 | 2 = firstWord === GRAPH_MAGIC_V2 ? 2 : 1;
    const nodeCount = version === 2 ? (off += 4, view.getUint32(off - 4, true)) : firstWord;

    const nodes: GraphNode[] = [];
    for (let i = 0; i < nodeCount; i++) {
      const lat = view.getFloat32(off, true); off += 4;
      const lon = view.getFloat32(off, true); off += 4;
      off += 8; // reserved
      nodes.push({ lat, lon });
    }

    const edgeCount = view.getUint32(off, true); off += 4;
    const adjacency = new Map<number, GraphEdge[]>();

    for (let i = 0; i < edgeCount; i++) {
      const from  = view.getUint32(off, true); off += 4;
      const to    = view.getUint32(off, true); off += 4;
      const costM = view.getUint32(off, true); off += 4;

      // v2: flags byte — bit 0 = oneway (1 = forward only)
      // v1: all edges assumed bidirectional (OSM oneway:no default)
      const oneway = version === 2 ? ((view.getUint8(off++) & 0x01) === 1) : false;

      if (!adjacency.has(from)) adjacency.set(from, []);
      adjacency.get(from)!.push({ to, costM, oneway });

      if (!oneway) {
        if (!adjacency.has(to)) adjacency.set(to, []);
        adjacency.get(to)!.push({ to: from, costM, oneway: false });
      }
    }

    const graph: RoutingGraph = { nodes, adjacency, version };
    _graphWeakRef = new WeakRef(graph);
    return graph;
  } catch {
    // Network / parse error — allow retry (transient failure)
    return null;
  }
}

/* ── Haversine (graph-internal) ──────────────────────────────── */

function havM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── En yakın düğüm ──────────────────────────────────────────── */

export function nearestNode(graph: RoutingGraph, lat: number, lon: number): number {
  let bestIdx  = 0;
  let bestDist = Infinity;
  for (let i = 0; i < graph.nodes.length; i++) {
    const d = havM(lat, lon, graph.nodes[i].lat, graph.nodes[i].lon);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx;
}

/* ── A* algoritması ──────────────────────────────────────────── */

/**
 * Basit A* — ikili heap (priority queue) ile O((V+E) log V).
 * Heuristic: Haversine mesafesi (admissible — asla overestimate etmez).
 */
export function aStar(
  graph: RoutingGraph,
  startIdx: number,
  goalIdx:  number,
): number[] | null {
  const { nodes, adjacency } = graph;
  const goalNode = nodes[goalIdx];

  // Min-heap: [fcost, nodeIdx]
  const heap: [number, number][] = [[0, startIdx]];
  const gCost = new Map<number, number>([[startIdx, 0]]);
  const prev  = new Map<number, number>();
  const closed = new Set<number>();

  const heapPush = (item: [number, number]) => {
    heap.push(item);
    // Bubble up
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };

  const heapPop = (): [number, number] | undefined => {
    if (!heap.length) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      // Bubble down
      let i = 0;
      while (true) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let smallest = i;
        if (l < heap.length && heap[l][0] < heap[smallest][0]) smallest = l;
        if (r < heap.length && heap[r][0] < heap[smallest][0]) smallest = r;
        if (smallest === i) break;
        [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
        i = smallest;
      }
    }
    return top;
  };

  while (heap.length) {
    const entry = heapPop();
    if (!entry) break;
    const [, cur] = entry;

    if (cur === goalIdx) {
      // Yolu geri izle
      const path: number[] = [];
      let node: number | undefined = goalIdx;
      while (node !== undefined) {
        path.unshift(node);
        node = prev.get(node);
      }
      return path;
    }

    if (closed.has(cur)) continue;
    closed.add(cur);

    const edges = adjacency.get(cur) ?? [];
    const curG  = gCost.get(cur) ?? Infinity;

    for (const { to, costM } of edges) {
      if (closed.has(to)) continue;
      const newG = curG + costM;
      if (newG < (gCost.get(to) ?? Infinity)) {
        gCost.set(to, newG);
        prev.set(to, cur);
        const h = havM(nodes[to].lat, nodes[to].lon, goalNode.lat, goalNode.lon);
        heapPush([newG + h, to]);
      }
    }

    // Early exit: dynamic limit scaled to device RAM (30k–200k nodes)
    if (closed.size > MAX_CLOSED_SET_SIZE) return null;
  }

  return null; // Rota bulunamadı
}

/* ── Public: WebWorker offline routing ───────────────────────── */

/* ── NavigationCompute Worker (A* off-main-thread) ───────────────────────── */

let _navWorker:   Worker | null = null;
let _reqCounter   = 0;

/** Bekleyen istek listesi: requestId → {resolve, reject, timer} */
const _pending = new Map<string, {
  resolve: (r: OfflineRouteResult | null) => void;
  reject:  (e: Error) => void;
  timer:   ReturnType<typeof setTimeout>;
}>();

const NAV_WORKER_TIMEOUT_MS = 8_000; // 8s — büyük graph + yavaş cihaz

function _getOrCreateNavWorker(): Worker | null {
  if (_navWorker) return _navWorker;
  try {
    const w = new Worker(
      new URL('./navigation/NavigationCompute.worker.ts', import.meta.url),
      { type: 'module', name: 'NavigationCompute' },
    );

    w.onmessage = (e: MessageEvent) => {
      const msg = e.data as {
        type: string;
        requestId?: string;
        geometry?: [number, number][];
        distanceM?: number;
        durationS?: number;
        steps?: RouteStep[];
        reason?: string;
      };
      const req = msg.requestId ? _pending.get(msg.requestId) : undefined;
      if (!req) return;
      clearTimeout(req.timer);
      _pending.delete(msg.requestId!);

      if (msg.type === 'ROUTE_RESULT') {
        req.resolve({
          geometry:  msg.geometry  ?? [],
          distanceM: msg.distanceM ?? 0,
          durationS: msg.durationS ?? 0,
          steps:     msg.steps     ?? [],
          source:    'offline-worker',
        });
      } else {
        req.resolve(null); // ROUTE_ERROR → null (fallback zinciri devam eder)
      }
    };

    w.onerror = (err) => {
      logError('NavigationCompute:onerror', new Error(err.message ?? 'crash'));
      runtimeManager.reportFailure('NavigationCompute');
      // Bekleyen tüm istekleri reddet
      for (const [id, req] of _pending.entries()) {
        clearTimeout(req.timer);
        req.resolve(null);
        _pending.delete(id);
      }
      _navWorker = null; // Stability Guard
    };

    w.onmessageerror = () => {
      logError('NavigationCompute:messageerror', new Error('Deserialize failed'));
    };

    _navWorker = w;
    runtimeManager.registerWorker('NavigationCompute', w, 'OPTIONAL');
    return w;
  } catch (e) {
    logError('NavigationCompute:create', e);
    return null;
  }
}

/**
 * Offline A* rota hesaplama — NavigationCompute Worker üzerinden.
 *
 * Ana thread bloklama sıfır; A* (~100–300ms) ve binary parse (~50ms)
 * tamamen worker thread'de çalışır.
 * Worker crash'ta Stability Guard devreye girer, null döner.
 */
export async function computeOfflineRoute(
  fromLat: number,
  fromLon: number,
  toLat:   number,
  toLon:   number,
): Promise<OfflineRouteResult | null> {
  const w = _getOrCreateNavWorker();
  if (!w) return null;

  const requestId = `r${++_reqCounter}`;

  return new Promise<OfflineRouteResult | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      _pending.delete(requestId);
      logError('NavigationCompute:timeout', new Error(`Request ${requestId} timed out`));
      resolve(null);
    }, NAV_WORKER_TIMEOUT_MS);

    _pending.set(requestId, { resolve, reject, timer });
    w.postMessage({ type: 'COMPUTE_ROUTE', requestId, fromLat, fromLon, toLat, toLon });
  });
}

/* ── Straight-line fallback (son çare) ───────────────────────── */

export function straightLineRoute(
  fromLat: number,
  fromLon: number,
  toLat:   number,
  toLon:   number,
): OfflineRouteResult {
  const distanceM = havM(fromLat, fromLon, toLat, toLon);
  return {
    geometry:  [[fromLon, fromLat], [toLon, toLat]],
    distanceM,
    durationS: distanceM / (40 / 3.6), // 40 km/h kestirme tahmini
    steps:     [],
    source:    'straight-line',
  };
}

/* ── Graph önbellekten temizle (bellek baskısı) ──────────────── */

export function resetRoutingGraphCache(): void {
  _graphWeakRef    = null;
  _graphLoadFailed = false;
}

/**
 * RAM krizi sırasında A* routing graph'ını bellekten düşür.
 * WeakRef zaten GC'ye izin verir; bu çağrı referansı açıkça sıfırlar.
 * Bir sonraki rota isteğinde graph dosyadan yeniden yüklenir.
 */
export function clearCache(): void {
  _graphWeakRef    = null;
  // _graphLoadFailed sıfırlanmaz: kalıcı hata → yeniden yükleme çabası olmaz
}

// RAM krizi: memoryWatchdog cache temizleme sinyaline kaydol
registerCachePurge(clearCache);
