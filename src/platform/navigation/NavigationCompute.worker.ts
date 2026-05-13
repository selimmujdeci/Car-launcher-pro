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

/* ── SQLite WASM FTS5 POI Arama ──────────────────────────────────────────── */

// SAB layout — offlineSearchService.ts ile senkron (değiştirme, birlikte güncelle)
const _SAB_HEADER    = 8;    // [count:u32][status:u32]
const _SAB_STRIDE    = 256;  // bytes/kayıt
const _SAB_MAX       = 20;   // maksimum sonuç
const _SAB_OFF_NAME  = 0;   const _SAB_LEN_NAME  = 64;
const _SAB_OFF_ADDR  = 64;  const _SAB_LEN_ADDR  = 64;
const _SAB_OFF_LAT   = 128; // float64
const _SAB_OFF_LON   = 136; // float64
const _SAB_OFF_SCORE = 144; // float32
const _SAB_OFF_CAT   = 148; const _SAB_LEN_CAT   = 32;
const _SAB_OFF_ID    = 180; const _SAB_LEN_ID    = 32;

const POI_DB_URL        = '/maps/poi.db';
const POI_DB_TIMEOUT_MS = 5_000;

type _SqlJsStatic   = import('sql.js').SqlJsStatic;
type _SqlJsDatabase = import('sql.js').Database;

let _sqlJs:           _SqlJsStatic | null = null;
let _sqlJsPromise:    Promise<_SqlJsStatic | null> | null = null;
let _poiDbRef:        WeakRef<_SqlJsDatabase> | null = null;
let _poiDbFailed      = false;
const _enc            = new TextEncoder();

async function _initSqlJs(): Promise<_SqlJsStatic | null> {
  if (_sqlJs) return _sqlJs;
  if (_sqlJsPromise) return _sqlJsPromise;

  _sqlJsPromise = (async () => {
    try {
      const { default: init } = await import('sql.js');
      _sqlJs = await init({ locateFile: (f: string) => `/wasm/${f}` });
      return _sqlJs;
    } catch {
      _sqlJsPromise = null;
      return null;
    }
  })();

  return _sqlJsPromise;
}

async function _getPoiDb(): Promise<_SqlJsDatabase | null> {
  const cached = _poiDbRef?.deref();
  if (cached) return cached;
  if (_poiDbFailed) return null;

  const SQL = await _initSqlJs();
  if (!SQL) return null;

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), POI_DB_TIMEOUT_MS);
    const res   = await fetch(POI_DB_URL, { signal: ctrl.signal });
    clearTimeout(timer);

    if (!res.ok) { _poiDbFailed = true; return null; }

    const buf = await res.arrayBuffer();
    const db  = new SQL.Database(new Uint8Array(buf));

    // FTS5 tablosu varlık kontrolü
    const rows = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='poi_fts'");
    if (!rows.length || !rows[0].values.length) {
      db.close();
      _poiDbFailed = true;
      return null;
    }

    _poiDbRef = new WeakRef(db);
    return db;
  } catch {
    return null;
  }
}

function _writeStr(u8: Uint8Array, base: number, off: number, maxLen: number, s: string): void {
  const bytes = _enc.encode(s);
  const start = base + off;
  u8.fill(0, start, start + maxLen);
  u8.set(bytes.slice(0, maxLen - 1), start);
}

interface _POIRow { id: string; name: string; address: string; lat: number; lon: number; score: number; category: string; }

function _writeSAB(sab: SharedArrayBuffer, results: _POIRow[]): number {
  const view  = new DataView(sab);
  const u8    = new Uint8Array(sab);
  const count = Math.min(results.length, _SAB_MAX, Math.floor((sab.byteLength - _SAB_HEADER) / _SAB_STRIDE));

  for (let i = 0; i < count; i++) {
    const base = _SAB_HEADER + i * _SAB_STRIDE;
    const r    = results[i];
    _writeStr(u8, base, _SAB_OFF_NAME,  _SAB_LEN_NAME,  r.name);
    _writeStr(u8, base, _SAB_OFF_ADDR,  _SAB_LEN_ADDR,  r.address);
    view.setFloat64(base + _SAB_OFF_LAT,  r.lat,   true);
    view.setFloat64(base + _SAB_OFF_LON,  r.lon,   true);
    view.setFloat32(base + _SAB_OFF_SCORE, r.score, true);
    _writeStr(u8, base, _SAB_OFF_CAT,   _SAB_LEN_CAT,   r.category);
    _writeStr(u8, base, _SAB_OFF_ID,    _SAB_LEN_ID,    r.id);
  }

  // Veriyi yazdıktan SONRA atomik header güncelle (thread-safe görünürlük)
  Atomics.store(new Int32Array(sab), 0, count); // count
  Atomics.store(new Int32Array(sab), 1, 0);     // status=ok
  return count;
}

async function _handleSearch(
  requestId:  string,
  query:      string,
  lat:        number | undefined,
  lon:        number | undefined,
  maxResults: number,
  sab:        SharedArrayBuffer | null,
): Promise<void> {
  const db = await _getPoiDb();

  if (!db) {
    if (sab) { Atomics.store(new Int32Array(sab), 0, 0); Atomics.store(new Int32Array(sab), 1, 1); }
    (self as unknown as Worker).postMessage({ type: 'SEARCH_ERROR', requestId, reason: 'poi.db yüklenemedi' });
    return;
  }

  try {
    // FTS5 özel karakterlerini temizle; prefix arama için * ekle
    const term = query.replace(/["'*^()[\]{}\\]/g, ' ').trim();
    if (!term) {
      if (sab) { Atomics.store(new Int32Array(sab), 0, 0); Atomics.store(new Int32Array(sab), 1, 0); }
      (self as unknown as Worker).postMessage({ type: 'SEARCH_RESULT', requestId, count: 0 });
      return;
    }

    let sql: string;
    let params: (string | number)[];

    if (lat != null && lon != null) {
      // ~50km bbox: sadece aktif bölgeyi tara → tüm Türkiye'yi RAM'e yükleme
      sql = `
        SELECT id, name, address, lat, lon, category, bm25(poi_fts) AS score
        FROM poi_fts
        WHERE poi_fts MATCH ?
          AND lat BETWEEN ? AND ?
          AND lon BETWEEN ? AND ?
        ORDER BY score LIMIT ?`;
      params = [`${term}*`, lat - 0.45, lat + 0.45, lon - 0.60, lon + 0.60, maxResults];
    } else {
      sql = `
        SELECT id, name, address, lat, lon, category, bm25(poi_fts) AS score
        FROM poi_fts
        WHERE poi_fts MATCH ?
        ORDER BY score LIMIT ?`;
      params = [`${term}*`, maxResults];
    }

    const res  = db.exec(sql, params);
    const rows = res[0]?.values ?? [];

    const results: _POIRow[] = rows.map((row) => ({
      id:       String(row[0] ?? ''),
      name:     String(row[1] ?? ''),
      address:  String(row[2] ?? ''),
      lat:      Number(row[3]),
      lon:      Number(row[4]),
      category: String(row[5] ?? ''),
      score:    Math.abs(Number(row[6] ?? 0)), // bm25 negatif → abs ile normalize
    }));

    const count = sab ? _writeSAB(sab, results) : results.length;
    (self as unknown as Worker).postMessage({
      type: 'SEARCH_RESULT',
      requestId,
      count,
      results: sab ? undefined : results, // SAB yoksa JSON fallback
    });
  } catch (err) {
    if (sab) { Atomics.store(new Int32Array(sab), 0, 0); Atomics.store(new Int32Array(sab), 1, 1); }
    (self as unknown as Worker).postMessage({
      type: 'SEARCH_ERROR',
      requestId,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

/* ── Mesaj işleyici ──────────────────────────────────────────────────────── */

self.onmessage = (e: MessageEvent): void => {
  const msg = e.data as {
    type: string;
    requestId?: string;
    fromLat?: number; fromLon?: number;
    toLat?: number;   toLon?: number;
    query?: string;
    lat?: number; lon?: number;
    maxResults?: number;
    sab?: SharedArrayBuffer;
  };

  if (msg.type === 'STOP') { self.close(); return; }

  // RAM CRITICAL: SQLite bağlantısını temiz kapat; RAM serbest kalır.
  // _poiDbFailed = false bırakılır: baskı geçince yeniden yüklemeye izin ver.
  if (msg.type === 'CLOSE_DB') {
    const existing = _poiDbRef?.deref();
    if (existing) { try { existing.close(); } catch { /* ignore */ } }
    _poiDbRef = null;
    return;
  }

  if (
    msg.type === 'COMPUTE_ROUTE' &&
    msg.requestId != null &&
    msg.fromLat != null && msg.fromLon != null &&
    msg.toLat   != null && msg.toLon   != null
  ) {
    void _handleRoute(msg.requestId, msg.fromLat, msg.fromLon, msg.toLat, msg.toLon);
    return;
  }

  if (msg.type === 'SEARCH_POI' && msg.requestId != null) {
    void _handleSearch(
      msg.requestId,
      String(msg.query ?? ''),
      msg.lat,
      msg.lon,
      Math.min(Number(msg.maxResults ?? 10), _SAB_MAX),
      msg.sab ?? null,
    );
  }
};
