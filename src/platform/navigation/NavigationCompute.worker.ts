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

/* Arama katlaması: `poi.db`yi YAZAN kuralla AYNI olmak zorunda
   (ikizi `scripts/lib/turkishFold.mjs`; kilidi `turkishFold.test.ts`). */
import { foldTr } from './core/turkishFold';
/* NAV v3 · F4 — `RTG2` ayrıştırma artık BURADA DEĞİL: tek kanonik okuyucuda.
   Worker graf YÜRÜTME (A*) sahibidir; graf OKUMA sahibi değildir. */
import {
  parseRoutingGraph, edgeAccessRole, edgeRoadClass, turnIsAllowed, viaWayStep,
  type RoutingGraphView,
}
  from './map/graph/rtg2Reader';
import { buildGraphAdjacency, outgoingRange, type GraphAdjacency }
  from './map/graph/graphAdjacency';

/* ── Tipler ──────────────────────────────────────────────────────────────── */

/**
 * Worker'ın çalışma birimi: kanonik görünüm + CSR komşuluk.
 *
 * ── NEDEN DEĞİŞTİ (F4 · F1 borcu B2) ────────────────────────────────────
 * Eskiden binary ayrıştırma bu dosyanın İÇİNDEYDİ; sonuç olarak ana iş
 * parçacığı grafı okuyamıyor, `MapStore.getEdgeMetadata` üretimde daima
 * `UNAVAILABLE` dönüyordu. Ayrıştırma tek otoriteye taşındı; **A* algoritması
 * ve sezgisel ağırlık DEĞİŞMEDİ** (parite testi gerçek artefaktla doğrular).
 */
interface RoutingGraph {
  view:      RoutingGraphView;
  adjacency: GraphAdjacency;
  version:   1 | 2 | 3;
}

/* ── Sabitler ────────────────────────────────────────────────────────────── */

const GRAPH_URL        = '/maps/routing-graph.bin';
const GRAPH_TIMEOUT_MS = 5_000;

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
let _installedRegionalGraph: RoutingGraph | null = null;

async function _loadGraph(): Promise<RoutingGraph | null> {
  if (_installedRegionalGraph) return _installedRegionalGraph;
  const cached = _graphWeakRef?.deref();
  if (cached) return cached;
  if (_graphFailed) return null;

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GRAPH_TIMEOUT_MS);
    const res   = await fetch(GRAPH_URL, { signal: ctrl.signal });
    clearTimeout(timer);

    if (!res.ok) { _graphFailed = true; return null; } // 404/500 → kalıcı hata

    const buf = await res.arrayBuffer();

    /* TEK ayrıştırma otoritesi. Bozuk/kısa/desteklenmeyen girdi burada
       AÇIKÇA reddedilir — eskiden aralık dışı düğüm indeksi A* içinde
       `nodes[to] === undefined` olarak patlıyordu. */
    const parsed = parseRoutingGraph(buf);
    if (parsed.outcome !== 'OK' || parsed.view === null) {
      /* Biçim hatası KALICIDIR: aynı artefakt her denemede aynı sonucu verir. */
      _graphFailed = true;
      return null;
    }
    const view = parsed.view;
    const adjacency = buildGraphAdjacency(view);
    const version = view.version;

    const graph: RoutingGraph = { view, adjacency, version };
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
  const { nodeLat, nodeLon, nodeCount } = g.view;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < nodeCount; i++) {
    const d = _havM(lat, lon, nodeLat[i], nodeLon[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * SEZGİSEL AĞIRLIĞI (ε-kabul edilebilir A*).
 *
 * ── NEDEN 1.0 DEĞİL ─────────────────────────────────────────────────────────
 * Türkiye grafiği (238k düğüm · 295k kenar) devreye girince ÖLÇÜLDÜ: saf A*
 * (W=1.0) Ankara→İstanbul için **33.592 düğüm** kapatıyor. Düşük-uç RAM koruması
 * `MAX_CLOSED = 30.000` olduğu için arama tavana çarpıyor ve rota HİÇ
 * bulunamıyordu — kullanıcı için sonuç "çevrimdışı rota yok"tur.
 *
 * ── ÖLÇÜM (aynı grafik, aynı çift) ──────────────────────────────────────────
 *   W=1.00 → 33.592 kapatılan · 435 km   ← düşük-uçta DÜŞER
 *   W=1.10 → 28.477 kapatılan · 437 km
 *   W=1.20 → 15.095 kapatılan · 446 km   ← seçilen
 *   W=1.50 →  4.194 kapatılan · 463 km
 *
 * W=1.20 aramayı YARIYA indirir, rota yalnız **%2,5** uzar. ε-kabul edilebilir
 * A* teorik olarak en iyi rotanın W katından kötü olamaz (yani ≤ %20); ölçülen
 * sapma %2,5'tir. Takas BİLİNÇLİDİR: "biraz daha uzun ama VAR olan rota",
 * "en kısa ama hesaplanamayan rota"dan iyidir.
 *
 * DİKKAT: bu değeri büyütmek rotayı sessizce uzatır, küçültmek uzun mesafede
 * "rota bulunamadı"yı geri getirir. Değiştirilecekse ÖLÇÜLEREK değiştirilmeli
 * (`scripts/verify-routing-graph.mjs` aynı bütçeyle sınar).
 */
const HEURISTIC_WEIGHT = 1.2;

/* ── A* algoritması (binary min-heap) ────────────────────────────────────── */

function _aStar(g: RoutingGraph, startIdx: number, goalIdx: number): number[] | null {
  if (g.version === 3) return routeRtg3EdgeState(g, startIdx, goalIdx);
  const { view, adjacency } = g;
  const { nodeLat, nodeLon, edgeCostM } = view;
  const goalLat = nodeLat[goalIdx];
  const goalLon = nodeLon[goalIdx];

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
    /* Komşu SIRASI eski `Map<number, GraphEdge[]>` gösterimiyle BİREBİR
       aynıdır (CSR aynı kenar ekleme düzeninde kurulur) → eşit maliyetli
       rotalarda seçim de aynı kalır. */
    const r = outgoingRange(adjacency, cur);
    for (let k = r.start; k < r.end; k++) {
      const to = adjacency.targetNode[k];
      if (closed.has(to)) continue;
      const costM = edgeCostM[adjacency.edgeOrdinal[k]];
      const newG = curG + costM;
      if (newG < (gCost.get(to) ?? Infinity)) {
        gCost.set(to, newG);
        prev.set(to, cur);
        heapPush([newG + HEURISTIC_WEIGHT * _havM(nodeLat[to], nodeLon[to], goalLat, goalLon), to]);
      }
    }
  }
  return null;
}

/**
 * RTG3'te dönüş yasağı önceki kenara bağlıdır; düğüm tek başına arama durumu
 * olamaz. Bu genişleme aynı route authority içinde `(node, previousEdge)`
 * durumu kullanır. Destination-only kenar yalnız hedefe son girişte açılır;
 * böylece driveway/service transit kestirme olamaz.
 *
 * ── VIA-WAY (bounded) ────────────────────────────────────────────────────
 * `from way → via way(lar) → to way` kısıtı tek kavşakta yanıtlanamaz: yasak
 * olan, DİZİNİN tamamlanmasıdır. Bu yüzden duruma ÜÇÜNCÜ bir bileşen eklenir:
 * `viaWayStep`in döndürdüğü **maske** — o kenar üzerindeki en fazla 8 zincir
 * yuvasından hangilerinin izlenmekte olduğu. Sınırsız rota geçmişi TUTULMAZ.
 *
 * Maske via-way kaydı olmayan grafta DAİMA 0'dır → durum anahtarı ve arama
 * davranışı önceki sürümle birebir aynı kalır (ölçülen parite).
 */
function routeRtg3EdgeState(g: RoutingGraph, startIdx: number, goalIdx: number): number[] | null {
  const { view, adjacency } = g;
  const goalLat = view.nodeLat[goalIdx], goalLon = view.nodeLon[goalIdx];
  type Entry = [number, number, number, number, string]; // f, node, previous edge, via-way mask, state key
  const startKey = `${startIdx}:-1`;
  const heap: Entry[] = [[0, startIdx, -1, 0, startKey]];
  const gCost = new Map<string, number>([[startKey, 0]]);
  const previous = new Map<string, string>();
  const stateNode = new Map<string, number>([[startKey, startIdx]]);
  const closed = new Set<string>();

  const push = (item: Entry) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
    }
  };
  const pop = (): Entry | undefined => {
    if (!heap.length) return undefined;
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let s = i;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]]; i = s;
      }
    }
    return top;
  };

  while (heap.length) {
    const entry = pop(); if (!entry) break;
    const [, cur, previousEdge, viaWayMask, key] = entry;
    if (closed.has(key)) continue;
    if (cur === goalIdx) {
      const path: number[] = [];
      let cursor: string | undefined = key;
      while (cursor !== undefined) {
        path.unshift(stateNode.get(cursor)!);
        cursor = previous.get(cursor);
      }
      return path;
    }
    closed.add(key);
    if (closed.size > MAX_CLOSED) return null;
    const curG = gCost.get(key) ?? Infinity;
    const range = outgoingRange(adjacency, cur);
    for (let k = range.start; k < range.end; k++) {
      const ordinal = adjacency.edgeOrdinal[k];
      const to = adjacency.targetNode[k];
      if (!turnIsAllowed(view, previousEdge, ordinal, cur)) continue;
      const nextMask = viaWayStep(view, previousEdge, viaWayMask, cur, ordinal);
      if (nextMask < 0) continue;                        // via-way dizisi yasak/zorunlu ihlali
      const accessRole = edgeAccessRole(view, ordinal);
      if (accessRole === 2 && to !== goalIdx) continue;
      if (accessRole !== 1 && accessRole !== 2) continue; // bilinmeyen RTG3 rolü fail-closed
      const nextKey = nextMask === 0 ? `${to}:${ordinal}` : `${to}:${ordinal}:${nextMask}`;
      if (closed.has(nextKey)) continue;
      const edgeCost = view.edgeCostM[ordinal];
      const accessPenalty = accessRole === 2 ? edgeCost * 20 : 0;
      const newG = curG + edgeCost + accessPenalty;
      if (newG < (gCost.get(nextKey) ?? Infinity)) {
        gCost.set(nextKey, newG);
        previous.set(nextKey, key);
        stateNode.set(nextKey, to);
        push([
          newG + HEURISTIC_WEIGHT * _havM(view.nodeLat[to], view.nodeLon[to], goalLat, goalLon),
          to, ordinal, nextMask, nextKey,
        ]);
      }
    }
  }
  return null;
}

/* ── Rota hesaplama ──────────────────────────────────────────────────────── */

/**
 * ETA tahmini.
 *
 * ── ESKİ DURUM (#14) ────────────────────────────────────────────────────────
 * Format yol sınıfı taşımadığı için ETA sabit 30 km/h ile hesaplanıyordu ve
 * kodun kendi yorumu *"yol sınıfı verisi eklenirse hız buradan türetilmeli"*
 * diyordu. Türkiye grafiği devreye girince bu sabit UYDURMA SÜRE üretirdi:
 * 350 km'lik bir otoyol rotası **11,7 saat** görünürdü.
 *
 * ── YENİ ────────────────────────────────────────────────────────────────────
 * `flags` baytının bit 1-3'ü yol sınıfını taşır (üretici:
 * `scripts/build-routing-graph.mjs`). Süre KENAR BAŞINA, o kenarın sınıf
 * hızıyla toplanır. Hızlar SERBEST AKIŞ değil, gerçekçi SEYAHAT ortalamalarıdır
 * (kavşak, şehir geçişi, yavaşlama dahil) — "en iyi hâl" ETA'sı vermek, geç
 * kalan sürücüye yalan söylemektir.
 *
 * `UNKNOWN` (0) eski grafiklerin ve sınıfsız kenarların yoludur: eski sabit
 * korunur, böylece bu değişiklik hiçbir mevcut davranışı sessizce bozmaz.
 */
const ROAD_CLASS_SPEED_MS: readonly number[] = [
  30 / 3.6,   // 0 UNKNOWN     — eski sabit (geriye uyum)
  110 / 3.6,  // 1 motorway
  85 / 3.6,   // 2 trunk
  65 / 3.6,   // 3 primary
  50 / 3.6,   // 4 secondary
  40 / 3.6,   // 5 tertiary
  30 / 3.6,   // 6 residential
  45 / 3.6,   // 7 link/other  — bağlantı kolları ve rampa
];

const RTG3_ROAD_CLASS_SPEED_MS: readonly number[] = [
  30 / 3.6, 110 / 3.6, 85 / 3.6, 65 / 3.6, 50 / 3.6,
  40 / 3.6, 35 / 3.6, 30 / 3.6, 10 / 3.6, 15 / 3.6,
];

/** Sınıfsız/eski yol için ortalama — düz çizgi rehberliğinde de kullanılır. */
const AVG_ROUTE_SPEED_MS = ROAD_CLASS_SPEED_MS[0];

/** Kenar süresini saniye olarak verir; sınıf bilinmiyorsa sabit hıza düşer. */
function _edgeSeconds(costM: number, roadClass: number, version: 1 | 2 | 3): number {
  const speeds = version === 3 ? RTG3_ROAD_CLASS_SPEED_MS : ROAD_CLASS_SPEED_MS;
  const v = speeds[roadClass] ?? AVG_ROUTE_SPEED_MS;
  return v > 0 ? costM / v : costM / AVG_ROUTE_SPEED_MS;
}

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
        durationS: d / AVG_ROUTE_SPEED_MS,
        steps: [],
      });
      return;
    }

    const path = _aStar(graph, startIdx, goalIdx);
    if (!path) {
      (self as unknown as Worker).postMessage({ type: 'ROUTE_ERROR', requestId, reason: 'Rota bulunamadı' });
      return;
    }

    const geometry: [number, number][] = path.map(
      idx => [graph.view.nodeLon[idx], graph.view.nodeLat[idx]] as [number, number],
    );

    /* MESAFE KENARDAN OKUNUR, DÜĞÜMDEN TÜRETİLMEZ. Grafik üretimi ara geometri
       düğümlerini seyreltir; `costM` ise seyreltmeden ÖNCEKİ tam poliline
       üzerinden toplanmıştır. İki kısaltılmış düğüm arasını haversine ile
       ölçmek kıvrımlı yolu KISA gösterirdi (sistematik eksik mesafe → eksik
       ETA). Kenar bulunamazsa haversine yalnız SON ÇARE olarak kullanılır. */
    let distanceM = 0;
    let durationS = 0;
    for (let i = 1; i < path.length; i++) {
      const fromIdx = path[i - 1], toIdx = path[i];
      /* `find` ile AYNI semantik: aralıktaki İLK eşleşen kol. */
      let ordinal = -1;
      const r = outgoingRange(graph.adjacency, fromIdx);
      for (let k = r.start; k < r.end; k++) {
        if (graph.adjacency.targetNode[k] === toIdx) {
          ordinal = graph.adjacency.edgeOrdinal[k];
          break;
        }
      }
      if (ordinal >= 0) {
        const costM = graph.view.edgeCostM[ordinal];
        distanceM += costM;
        durationS += _edgeSeconds(costM, edgeRoadClass(graph.view, ordinal), graph.version);
      } else {
        const d = _havM(
          graph.view.nodeLat[fromIdx], graph.view.nodeLon[fromIdx],
          graph.view.nodeLat[toIdx], graph.view.nodeLon[toIdx],
        );
        distanceM += d;
        durationS += d / AVG_ROUTE_SPEED_MS;
      }
    }

    (self as unknown as Worker).postMessage({
      type: 'ROUTE_RESULT', requestId, geometry,
      distanceM,
      durationS,
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

    /* Şema varlık kontrolü — tablo yoksa sahte "sonuç yok" yerine AÇIK hata. */
    const rows = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='poi'");
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
  // UTF-8 güvenli kesme (#10): maxLen-1 (null-terminator yeri) sınırı çok-byte karakter
  // ortasına denk gelirse continuation byte'ları geri sar — Türkçe ç/ğ/ş/ü/ö/İ bozulmasın.
  let cut = Math.min(maxLen - 1, bytes.length);
  while (cut > 0 && (bytes[cut] & 0xC0) === 0x80) cut--;
  u8.set(bytes.subarray(0, cut), start);
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
    /* Arama anahtarı ÜRETİMLE AYNI kuralla katlanır (`turkishFold`); aksi
       hâlde "İstanbul" yazan kullanıcı "istanbul" yazılmış kaydı bulamaz.
       LIKE joker karakterleri (`%` `_`) ve kaçış karakteri NÖTRLENİR — yoksa
       kullanıcının yazdığı `%` tüm tabloyu tarar. */
    const term = foldTr(query).replace(/[%_\\]/g, ' ').trim();
    if (!term) {
      if (sab) { Atomics.store(new Int32Array(sab), 0, 0); Atomics.store(new Int32Array(sab), 1, 0); }
      (self as unknown as Worker).postMessage({ type: 'SEARCH_RESULT', requestId, count: 0 });
      return;
    }

    let sql: string;
    let params: (string | number)[];

    if (lat != null && lon != null) {
      /* SIRALAMA MESAFEYE GÖRE — metin benzerliğine göre DEĞİL.
         Eski sorgu `ORDER BY bm25(...)` kullanıyordu; "en yakın benzinlik"
         için bu YANLIŞTIR: en alakalı ad, en yakın nokta demek değildir.
         Skor düzlemsel yaklaşık mesafenin KARESİDİR (karekök gereksiz — aynı
         sırayı verir, ucuzdur); boylam farkı enleme göre `cos²` ile ölçeklenir,
         yoksa kuzeyde doğu-batı mesafesi olduğundan büyük görünür.
         ~50 km kutu: tüm Türkiye RAM'e alınmaz, indeks kullanılır. */
      const cos = Math.cos(lat * (Math.PI / 180));
      const lonScale = cos * cos;
      sql = `
        SELECT id, name, address, lat, lon, category,
               ((lat - ?) * (lat - ?)) + ((lon - ?) * (lon - ?) * ?) AS score
        FROM poi
        WHERE search LIKE ?
          AND lat BETWEEN ? AND ?
          AND lon BETWEEN ? AND ?
        ORDER BY score LIMIT ?`;
      params = [
        lat, lat, lon, lon, lonScale,
        `%${term}%`,
        lat - 0.45, lat + 0.45, lon - 0.60, lon + 0.60,
        maxResults,
      ];
    } else {
      /* Konum YOKSA mesafe sıralaması MÜMKÜN DEĞİLDİR. Uydurma bir yakınlık
         skoru üretmek yerine kısa ad önceliklendirilir (daha spesifik eşleşme
         göstergesi) — bu bir SIRALAMA tercihi olarak dürüstçe sınırlıdır. */
      sql = `
        SELECT id, name, address, lat, lon, category, length(name) AS score
        FROM poi
        WHERE search LIKE ?
        ORDER BY score LIMIT ?`;
      params = [`%${term}%`, maxResults];
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
    graphView?: RoutingGraphView;
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

  if (msg.type === 'INSTALL_REGIONAL_GRAPH' && msg.requestId != null) {
    const view = msg.graphView;
    if (!view || view.version !== 3 || view.nodeCount < 1 || view.edgeCount < 1 ||
        view.nodeLat.length !== view.nodeCount || view.edgeFrom.length !== view.edgeCount) {
      (self as unknown as Worker).postMessage({ type:'GRAPH_INSTALL_ERROR', requestId:msg.requestId, reason:'RTG3 görünümü geçersiz' });
      return;
    }
    try {
      _installedRegionalGraph = { view, adjacency:buildGraphAdjacency(view), version:3 };
      _graphWeakRef = new WeakRef(_installedRegionalGraph);
      _graphFailed = false;
      (self as unknown as Worker).postMessage({ type:'GRAPH_INSTALLED', requestId:msg.requestId });
    } catch {
      _installedRegionalGraph = null;
      (self as unknown as Worker).postMessage({ type:'GRAPH_INSTALL_ERROR', requestId:msg.requestId, reason:'RTG3 komşuluğu kurulamadı' });
    }
    return;
  }

  if (msg.type === 'CLEAR_REGIONAL_GRAPH') {
    _installedRegionalGraph = null;
    _graphWeakRef = null;
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
