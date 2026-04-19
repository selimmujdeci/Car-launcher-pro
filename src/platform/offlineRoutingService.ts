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

/* ── Tipler ──────────────────────────────────────────────────── */

export interface OfflineRouteResult {
  geometry:  [number, number][];  // [lon, lat][] — OSRM ile aynı format
  distanceM: number;
  durationS: number;              // tahmini (30 km/h ortalama)
  source:    'offline-worker' | 'offline-daemon' | 'straight-line';
}

/* ── Local daemon (native OSRM) ──────────────────────────────── */

/**
 * CarLauncherPlugin.startOsrmDaemon() çağrısından sonra
 * http://localhost:5000 adresinde OSRM HTTP API açılır.
 *
 * Native tarafta yapılacaklar:
 *   - Android Service olarak çalıştır (foreground service)
 *   - /data/data/com.carlauncher.pro/files/osrm/ dizininden .osrm binary oku
 *   - NanoHTTPD ile 5000 portunda OSRM HTTP API sun
 *
 * Bu fonksiyon, daemon ayakta ise rota döner; değilse null döner.
 */
const LOCAL_DAEMON_URL = 'http://127.0.0.1:5000/route/v1/driving';
const LOCAL_DAEMON_TIMEOUT_MS = 3_000;

export async function tryLocalDaemon(
  fromLon: number, fromLat: number,
  toLon:   number, toLat:   number,
): Promise<OfflineRouteResult | null> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOCAL_DAEMON_TIMEOUT_MS);
  try {
    const url = `${LOCAL_DAEMON_URL}/${fromLon},${fromLat};${toLon},${toLat}?steps=true&geometries=geojson&overview=full`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    const data = await res.json() as {
      code: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry: { coordinates: [number, number][] };
      }>;
    };
    if (data.code !== 'Ok' || !data.routes?.length) return null;

    const r = data.routes[0];
    return {
      geometry:  r.geometry.coordinates as [number, number][],
      distanceM: r.distance,
      durationS: r.duration,
      source:    'offline-daemon',
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/* ── WebWorker A* ────────────────────────────────────────────── */

/**
 * Routing graph cache — bir kez yüklenir, Worker ömrü boyunca saklanır.
 * Ayrı module-level değişken çünkü Worker context'te global state yeterli.
 */
const GRAPH_URL = '/maps/routing-graph.bin';
const GRAPH_TIMEOUT_MS = 5_000;

interface GraphNode { lat: number; lon: number; }

interface RoutingGraph {
  nodes:     GraphNode[];
  adjacency: Map<number, Array<{ to: number; costM: number }>>;
}

let _cachedGraph: RoutingGraph | null = null;
let _graphLoadAttempted = false;

async function loadRoutingGraph(): Promise<RoutingGraph | null> {
  if (_cachedGraph)          return _cachedGraph;
  if (_graphLoadAttempted)   return null;
  _graphLoadAttempted = true;

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GRAPH_TIMEOUT_MS);
    const res   = await fetch(GRAPH_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    const buf  = await res.arrayBuffer();
    const view = new DataView(buf);
    let   off  = 0;

    const nodeCount = view.getUint32(off, true); off += 4;
    const nodes: GraphNode[] = [];
    for (let i = 0; i < nodeCount; i++) {
      const lat = view.getFloat32(off, true); off += 4;
      const lon = view.getFloat32(off, true); off += 4;
      off += 8; // reserved
      nodes.push({ lat, lon });
    }

    const edgeCount = view.getUint32(off, true); off += 4;
    const adjacency = new Map<number, Array<{ to: number; costM: number }>>();
    for (let i = 0; i < edgeCount; i++) {
      const from  = view.getUint32(off, true); off += 4;
      const to    = view.getUint32(off, true); off += 4;
      const costM = view.getUint32(off, true); off += 4;

      if (!adjacency.has(from)) adjacency.set(from, []);
      adjacency.get(from)!.push({ to, costM });
      // Çift yönlü — OSM oneway:no varsayımı (basit versiyon)
      if (!adjacency.has(to)) adjacency.set(to, []);
      adjacency.get(to)!.push({ to: from, costM });
    }

    _cachedGraph = { nodes, adjacency };
    return _cachedGraph;
  } catch {
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

function nearestNode(graph: RoutingGraph, lat: number, lon: number): number {
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
function aStar(
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

    // Erken çıkış: 50k düğüm sınırı (head unit güvenliği)
    if (closed.size > 50_000) return null;
  }

  return null; // Rota bulunamadı
}

/* ── Public: WebWorker offline routing ───────────────────────── */

/**
 * Offline A* rota hesaplama.
 * /maps/routing-graph.bin yoksa → null döner.
 * Varsa → yol ağı üzerinden gerçek rota döner.
 *
 * Dikkat: Bu fonksiyon ~100-500ms blocking olabilir.
 * Üretimde bir SharedWorker içine taşınmalıdır.
 * Şimdilik Ana Thread'de çalışır — rota UI güncellemesi zaten async.
 */
export async function computeOfflineRoute(
  fromLat: number,
  fromLon: number,
  toLat:   number,
  toLon:   number,
): Promise<OfflineRouteResult | null> {
  const graph = await loadRoutingGraph();
  if (!graph) return null;

  try {
    const startIdx = nearestNode(graph, fromLat, fromLon);
    const goalIdx  = nearestNode(graph, toLat, toLon);

    if (startIdx === goalIdx) {
      return {
        geometry:  [[fromLon, fromLat], [toLon, toLat]],
        distanceM: havM(fromLat, fromLon, toLat, toLon),
        durationS: havM(fromLat, fromLon, toLat, toLon) / (30 / 3.6),
        source:    'offline-worker',
      };
    }

    const path = aStar(graph, startIdx, goalIdx);
    if (!path) return null;

    const geometry: [number, number][] = path.map(idx =>
      [graph.nodes[idx].lon, graph.nodes[idx].lat]
    );

    // Toplam mesafe
    let distanceM = 0;
    for (let i = 1; i < path.length; i++) {
      const a = graph.nodes[path[i - 1]];
      const b = graph.nodes[path[i]];
      distanceM += havM(a.lat, a.lon, b.lat, b.lon);
    }

    return {
      geometry,
      distanceM,
      durationS: distanceM / (30 / 3.6), // 30 km/h tahmini
      source:    'offline-worker',
    };
  } catch (e) {
    logError('OfflineRouting:A*', e);
    return null;
  }
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
    source:    'straight-line',
  };
}

/* ── Graph önbellekten temizle (bellek baskısı) ──────────────── */

export function resetRoutingGraphCache(): void {
  _cachedGraph = null;
  _graphLoadAttempted = false;
}
