/// <reference lib="webworker" />

/**
 * NavigationCompute.worker — Off-main-thread A* yönlendirme motoru.
 *
 * Ana thread `computeOfflineRoute()` için ağır binary parse (~50ms)
 * ve A* arama (~100–300ms) işlemlerini bu worker'a delege eder.
 * Ana thread sıfır bloklama garantisi.
 *
 * Protokol:
 *   IN  { type:'COMPUTE_ROUTE', requestId, fromLat, fromLon, toLat, toLon }
 *   IN  { type:'STOP' }
 *   OUT { type:'ROUTE_RESULT', requestId, geometry, distanceM, durationS, steps }
 *   OUT { type:'ROUTE_ERROR',  requestId, reason }
 */

/* ── Tipler ──────────────────────────────────────────────────────────────── */

interface GraphNode { lat: number; lon: number; }
interface GraphEdge { to: number; costM: number; oneway: boolean; }
interface RoutingGraph {
  nodes:     GraphNode[];
  adjacency: Map<number, GraphEdge[]>;
  version:   1 | 2;
}

/* ── Sabitler ────────────────────────────────────────────────────────────── */

const GRAPH_URL        = '/maps/routing-graph.bin';
const GRAPH_TIMEOUT_MS = 5_000;
const GRAPH_MAGIC_V2   = 0x32475452; // 'RTG2' LE

function _computeMaxClosed(): number {
  const mem = (self as unknown as { navigator?: { deviceMemory?: number } }).navigator?.deviceMemory;
  if (!mem || mem <= 1) return 30_000;
  if (mem <= 2)         return 50_000;
  if (mem <= 4)         return 100_000;
  return 200_000;
}
const MAX_CLOSED = _computeMaxClosed();

/* ── WeakRef cache — GC altında yeniden yükleme ─────────────────────────── */

let _graphWeakRef:  WeakRef<RoutingGraph> | null = null;
let _graphFailed    = false;

async function _loadGraph(): Promise<RoutingGraph | null> {
  const cached = _graphWeakRef?.deref();
  if (cached) return cached;
  if (_graphFailed) return null;

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GRAPH_TIMEOUT_MS);
    const res   = await fetch(GRAPH_URL, { signal: ctrl.signal });
    clearTimeout(timer);

    if (!res.ok) { _graphFailed = true; return null; } // 404/500 → kalıcı hata

    const buf  = await res.arrayBuffer();
    const view = new DataView(buf);
    let   off  = 0;

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

    const edgeCount  = view.getUint32(off, true); off += 4;
    const adjacency  = new Map<number, GraphEdge[]>();
    for (let i = 0; i < edgeCount; i++) {
      const from   = view.getUint32(off, true); off += 4;
      const to     = view.getUint32(off, true); off += 4;
      const costM  = view.getUint32(off, true); off += 4;
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
    return null; // geçici hata → bir sonraki çağrıda yeniden dene
  }
}

/* ── Haversine ───────────────────────────────────────────────────────────── */

function _havM(la1: number, lo1: number, la2: number, lo2: number): number {
  const R   = 6_371_000;
  const dLa = (la2 - la1) * (Math.PI / 180);
  const dLo = (lo2 - lo1) * (Math.PI / 180);
  const a   =
    Math.sin(dLa / 2) ** 2 +
    Math.cos(la1 * (Math.PI / 180)) * Math.cos(la2 * (Math.PI / 180)) *
    Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── En yakın düğüm ──────────────────────────────────────────────────────── */

function _nearest(g: RoutingGraph, lat: number, lon: number): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < g.nodes.length; i++) {
    const d = _havM(lat, lon, g.nodes[i].lat, g.nodes[i].lon);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/* ── A* algoritması (binary min-heap) ────────────────────────────────────── */

function _aStar(g: RoutingGraph, startIdx: number, goalIdx: number): number[] | null {
  const { nodes, adjacency } = g;
  const goalNode = nodes[goalIdx];

  const heap: [number, number][] = [[0, startIdx]];
  const gCost  = new Map<number, number>([[startIdx, 0]]);
  const prev   = new Map<number, number>();
  const closed = new Set<number>();

  const heapPush = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
    }
  };

  const heapPop = (): [number, number] | undefined => {
    if (!heap.length) return undefined;
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2*i+1, r = 2*i+2; let s = i;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]]; i = s;
      }
    }
    return top;
  };

  while (heap.length) {
    const entry = heapPop(); if (!entry) break;
    const [, cur] = entry;

    if (cur === goalIdx) {
      const path: number[] = [];
      let node: number | undefined = goalIdx;
      while (node !== undefined) { path.unshift(node); node = prev.get(node); }
      return path;
    }

    if (closed.has(cur)) continue;
    closed.add(cur);
    if (closed.size > MAX_CLOSED) return null; // RAM guard

    const curG = gCost.get(cur) ?? Infinity;
    for (const { to, costM } of (adjacency.get(cur) ?? [])) {
      if (closed.has(to)) continue;
      const newG = curG + costM;
      if (newG < (gCost.get(to) ?? Infinity)) {
        gCost.set(to, newG);
        prev.set(to, cur);
        heapPush([newG + _havM(nodes[to].lat, nodes[to].lon, goalNode.lat, goalNode.lon), to]);
      }
    }
  }
  return null;
}

/* ── Rota hesaplama ──────────────────────────────────────────────────────── */

async function _handleRoute(
  requestId: string,
  fromLat: number, fromLon: number,
  toLat:   number, toLon:   number,
): Promise<void> {
  const graph = await _loadGraph();
  if (!graph) {
    (self as unknown as Worker).postMessage({ type: 'ROUTE_ERROR', requestId, reason: 'Graph yüklenemedi' });
    return;
  }

  try {
    const startIdx = _nearest(graph, fromLat, fromLon);
    const goalIdx  = _nearest(graph, toLat, toLon);

    if (startIdx === goalIdx) {
      const d = _havM(fromLat, fromLon, toLat, toLon);
      (self as unknown as Worker).postMessage({
        type: 'ROUTE_RESULT', requestId,
        geometry:  [[fromLon, fromLat], [toLon, toLat]],
        distanceM: d,
        durationS: d / (30 / 3.6),
        steps: [],
      });
      return;
    }

    const path = _aStar(graph, startIdx, goalIdx);
    if (!path) {
      (self as unknown as Worker).postMessage({ type: 'ROUTE_ERROR', requestId, reason: 'Rota bulunamadı' });
      return;
    }

    const geometry: [number, number][] = path.map(idx => [graph.nodes[idx].lon, graph.nodes[idx].lat]);
    let distanceM = 0;
    for (let i = 1; i < path.length; i++) {
      const a = graph.nodes[path[i - 1]], b = graph.nodes[path[i]];
      distanceM += _havM(a.lat, a.lon, b.lat, b.lon);
    }

    (self as unknown as Worker).postMessage({
      type: 'ROUTE_RESULT', requestId, geometry,
      distanceM,
      durationS: distanceM / (30 / 3.6),
      steps: [],
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    (self as unknown as Worker).postMessage({ type: 'ROUTE_ERROR', requestId, reason });
  }
}

/* ── Mesaj işleyici ──────────────────────────────────────────────────────── */

self.onmessage = (e: MessageEvent): void => {
  const msg = e.data as {
    type: string;
    requestId?: string;
    fromLat?: number; fromLon?: number;
    toLat?: number;   toLon?: number;
  };

  if (msg.type === 'STOP') { self.close(); return; }

  if (
    msg.type === 'COMPUTE_ROUTE' &&
    msg.requestId != null &&
    msg.fromLat != null && msg.fromLon != null &&
    msg.toLat   != null && msg.toLon   != null
  ) {
    void _handleRoute(msg.requestId, msg.fromLat, msg.fromLon, msg.toLat, msg.toLon);
  }
};
