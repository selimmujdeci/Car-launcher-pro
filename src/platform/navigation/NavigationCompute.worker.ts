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
  remapViaWayMask, RTG3_VIA_WAY_MASK_ABSENT,
  type RoutingGraphView,
}
  from './map/graph/rtg2Reader';
import { REGION_WINDOW_NO_LOCAL, distanceToBoxM, type RegionWindowIdentity }
  from './map/graph/turkeyGraphManifest';
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
  version:   1 | 2 | 3 | 4;
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
  if (g.version >= 3) return routeRtg3EdgeState(g, startIdx, goalIdx);
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

/* ══════════════════════════════════════════════════════════════════════════
   BOUNDED ON-DEMAND CROSS-REGION OTURUMU (RTG4)

   ── TEK ROTA OTORİTESİ ────────────────────────────────────────────────────
   Aşağıda İKİNCİ bir yönlendirici YOKTUR. Uzun rota, `routeRtg3EdgeState`in
   TAM OLARAK AYNI kenar-durumlu A*'ı tarafından çözülür; tek fark, aramanın
   bir pencerede tükenmeyip **askıya alınıp devam etmesidir**.

   ── NEDEN ASKIYA ALMA, NEDEN DİKİŞ DEĞİL ─────────────────────────────────
   Bölge bölge ayrı rotalar hesaplayıp uç uca eklemek (dikiş), her sınırda
   yerel olarak en iyi ama küresel olarak yanlış bir seçim yapar ve dönüş
   kısıtı zincirini sıfırlar. Burada `gScore`, öncül zinciri ve via-way durumu
   pencere boyunca KESİNTİSİZ taşınır: aynı mantıksal arama devam eder.

   ── GRAF SAKİNLİĞİ ≠ ARAMA SAKİNLİĞİ ─────────────────────────────────────
   Büyük tipli diziler ana iş parçacığındaki residency authority'ye aittir ve
   tahliye edilir. Arama durumu BURADA yaşar ve tahliyeden sağ çıkar; yeniden
   kurma kaydı pencere-BAĞIMSIZ (koordinat + maliyet + sınıf) tutulur, bu
   yüzden bir bölge belleği bıraktıktan sonra da rota kurulabilir.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Pencere-bağımsız yeniden kurma arşivi — ordinal DEĞİL, ölçülmüş değer taşır.
 *
 * ── NEDEN BU GENİŞLİKLER ─────────────────────────────────────────────────
 * Koordinat zaten grafta `Float32Array`tir; arşivde `Float64` tutmak baytı
 * ikiye katlıyor ama TEK BİT bilgi eklemiyordu. Maliyet `edgeCostM` gibi
 * tamsayı metredir. Kayıt 33 bayta indi (önce 29 B'lık dar kayıt + 8 B'lık
 * çift hassasiyet israfı; ölçülen arşiv 121 MB'a çıkabiliyordu).
 *
 * `nodeId`/`wayId` KARARLI KİMLİKTİR: rota yeniden kurulduktan sonra bağımsız
 * yasallık denetimi ancak bunlarla yapılabilir (koordinat eşleşmesi belirsizlik
 * üretir). Bunlar rota otoritesi DEĞİL, kanıttır.
 */
interface ReconArchive {
  prev:   Int32Array;      // öncül global durum kimliği (-1 = başlangıç)
  lon:    Float32Array;    // graf ile AYNI hassasiyet (fazlası bilgi taşımaz)
  lat:    Float32Array;
  cost:   Uint32Array;     // BU duruma giren kenarın metre maliyeti
  cls:    Uint8Array;      // aynı kenarın yol sınıfı (ETA için)
  nodeId: BigUint64Array;  // kararlı OSM düğüm kimliği (denetim kanıtı)
  wayId:  BigUint64Array;  // kararlı OSM yol kimliği (denetim kanıtı)
  count:  number;
  /** Kayıt tavanı; aşılırsa rota UYDURULMAZ, fail-closed edilir. */
  capacity: number;
}

const _RECON_INITIAL = 4096;

function _reconCreate(capacity: number): ReconArchive {
  return {
    prev: new Int32Array(_RECON_INITIAL), lon: new Float32Array(_RECON_INITIAL),
    lat: new Float32Array(_RECON_INITIAL), cost: new Uint32Array(_RECON_INITIAL),
    cls: new Uint8Array(_RECON_INITIAL),
    nodeId: new BigUint64Array(_RECON_INITIAL), wayId: new BigUint64Array(_RECON_INITIAL),
    count: 0, capacity,
  };
}

/** Kayıt eklenemezse `-1` döner (tavan aşıldı) — çağıran fail-closed eder. */
function _reconPush(
  a: ReconArchive, prev: number, lon: number, lat: number, cost: number, cls: number,
  nodeId: bigint, wayId: bigint,
): number {
  if (a.count === a.prev.length) {
    if (a.count >= a.capacity) return -1;
    /* 1,5 kat büyüme: ikiye katlama tavana yakınken yarısı boş bir dizi ayırıp
       ölçülen belleği gereksiz yere şişiriyordu. */
    const size = Math.min(a.capacity, Math.max(a.prev.length + 1, Math.floor(a.prev.length * 1.5)));
    const prevNext = new Int32Array(size); prevNext.set(a.prev); a.prev = prevNext;
    const lonNext = new Float32Array(size); lonNext.set(a.lon); a.lon = lonNext;
    const latNext = new Float32Array(size); latNext.set(a.lat); a.lat = latNext;
    const costNext = new Uint32Array(size); costNext.set(a.cost); a.cost = costNext;
    const clsNext = new Uint8Array(size); clsNext.set(a.cls); a.cls = clsNext;
    const nodeNext = new BigUint64Array(size); nodeNext.set(a.nodeId); a.nodeId = nodeNext;
    const wayNext = new BigUint64Array(size); wayNext.set(a.wayId); a.wayId = wayNext;
  }
  const id = a.count++;
  a.prev[id] = prev; a.lon[id] = lon; a.lat[id] = lat;
  a.cost[id] = cost; a.cls[id] = cls; a.nodeId[id] = nodeId; a.wayId[id] = wayId;
  return id;
}

/** Arşiv baytı — ölçüm (uydurma değil, gerçek dizi boyutları). */
function _reconBytes(a: ReconArchive): number {
  return a.prev.byteLength + a.lon.byteLength + a.lat.byteLength + a.cost.byteLength
    + a.cls.byteLength + a.nodeId.byteLength + a.wayId.byteLength;
}

type CrossRegionEntry = [number, number, number, number, string];

type CrossRegionOutcome =
  | { kind: 'GOAL'; globalId: number }
  /** Sınır portalına ulaşıldı: bu bölgelerden biri yerleşmeden ilerlenemez. */
  | { kind: 'NEED_WINDOW'; regionIds: readonly string[]; fromRegionIds: readonly string[] }
  /** Pencere içinde genişletilecek durum kalmadı ve hedef bulunamadı. */
  | { kind: 'EXHAUSTED' }
  | { kind: 'CLOSED_LIMIT' }
  | { kind: 'FAIL_CLOSED'; reason: string };

interface CrossRegionSession {
  requestId: string;
  fromLat: number; fromLon: number;
  toLat: number; toLon: number;
  windowIndex: number;
  windowCount: number;
  graph: RoutingGraph | null;
  identity: RegionWindowIdentity | null;
  /**
   * Pencereden ÇIKIŞ portalları: düğüm kimliği → gidilebilecek bölge(ler).
   * Hangi bölgenin sıradaki olacağını PLAN değil, aramanın ulaştığı portal
   * söyler — bölge düzeyi en kısa koridor karayoluyla geçilebilir olmayabilir.
   */
  boundary: Map<bigint, readonly string[]>;
  isFinal: boolean;
  started: boolean;
  /**
   * Sezgisel ağırlığı. ÜRÜN DAİMA `HEURISTIC_WEIGHT` (1,2) kullanır; alan
   * yalnız gölge ölçüm koşumunun ağırlık/rota-kalitesi taraması yapabilmesi
   * içindir (`maxClosed` ile aynı desen). Ürün sürücüsü DEĞER GÖNDERMEZ.
   */
  weight: number;
  /**
   * SON pencerenin ağırlığı. Ara pencerelerde sezgisel, aşılması ZORUNLU sınır
   * kutusuna olan uzaklıktır — güçlü bir gradyan. Son pencerede kutu yoktur,
   * geriye zayıf kuş uçuşu kalır ve arama hedef metropolüne yayılır: ölçüldü,
   * İstanbul son penceresi tek başına 94 489 durum yiyordu (aynı koşumda
   * ara koridor pencerelerinin tamamı ~50 000). Bu yüzden ağırlık YALNIZ son
   * pencerede ayrıca ayarlanabilir; gönderilmezse `weight` ile aynıdır.
   */
  finalWeight: number;
  /**
   * BÜTÇE-FARKINDA AĞIRLIK TIRMANMASI.
   *
   * ── ÖLÇÜLEN SORUN ──────────────────────────────────────────────────────
   * Koridorun bir penceresi araziye takılabilir: Mersin→İstanbul'un 18.
   * penceresi (Bolu geçişi) tek başına 135 759 durum yer — aynı koşumda
   * DİĞER 19 pencerenin toplamı ~137 000. Sabit ağırlıkla bu tek pencere
   * bütçenin tamamını yutuyor ve rota HİÇ bulunamıyordu.
   *
   * ── DAVRANIŞ ───────────────────────────────────────────────────────────
   * Bir pencerede kapatılan durum `escalateAfter`ı aşarsa ağırlık
   * `escalateFactor` ile çarpılır (tavan `escalateMaxWeight`). Arama daha
   * hızlı hedefe yönelir; karşılığında rota bir miktar uzayabilir. Bu bir
   * DEĞİŞ TOKUŞTUR ve ölçülür: fail-closed yerine ölçülmüş kalite kaybı.
   * Ağırlık pencere sonunda taban değerine döner. `escalateAfter = 0` iken
   * mekanizma KAPALIDIR (davranış birebir eskisi).
   */
  baseWeight: number;
  escalateAfter: number;
  escalateFactor: number;
  escalateMaxWeight: number;
  /** Bu pencerede tırmanmanın uygulandığı basamak sayısı (ölçüm). */
  escalations: number;
  /**
   * Bu pencerede AŞILMASI ZORUNLU portal düğümlerinin KÜMELENMİŞ sınır
   * kutuları; son pencerede boş. Karo kenarının tamamı yerine GERÇEK portal
   * konumları kullanılır — aradaki fark ölçüldü (aşağıya bakınız).
   */
  boundaryBoxes: readonly (readonly [number, number, number, number])[];
  /**
   * KUTU BAŞINA kalan alt sınır (m) — `boundaryBoxes` ile aynı sırada.
   *
   * ── NEDEN KUTU BAŞINA (ÖLÇÜLDÜ) ────────────────────────────────────────
   * Sınır portalları bir karo kenarı boyunca en çok 6 kümeye ayrılır. TEK bir
   * `remainingLowerBoundM` kullanılırken bu kümelerin hepsi eşit derecede
   * "iyi" görünüyordu ve arama sınır boyunca AYNI ANDA altı hedefe yayılıyordu
   * (Bolu geçişi penceresi tek başına ~94 000 durum). Kutunun kendisinden
   * hedefe olan kuş uçuşu da kalan yolun alt sınırıdır; ikisinin MAKSİMUMU
   * hâlâ asla fazla tahmin etmez ama hedeften uzak kümeyi CEZALANDIRIR.
   */
  boundaryRemainingM: readonly number[];
  /** Sınır aşıldıktan sonra hedefe kalan yolun kabul edilebilir alt sınırı (m). */
  remainingLowerBoundM: number;
  /**
   * KORİDOR OMURGA UYGUNLUĞU — bu tur genişletilebilecek EN DÜŞÜK yol sınıfı
   * (RTG3 sınıfı: 1 motorway … 9 service). `0` = sınırsız (budama YOK).
   *
   * ── NEDEN VAR (ÖLÇÜLDÜ) ────────────────────────────────────────────────
   * Ürün bütçesiyle (200 000) koşulan uzun rotada kapatılan durumların
   * sınıf dağılımı: motorway+trunk+primary %2,4 · tertiary ve altı %94,6
   * (residential tek başına %52). Yani arama bütçesinin neredeyse tamamı,
   * şehirlerarası bir rotanın ASLA kullanmayacağı sokak ağını süpürmeye
   * gidiyordu ve rota bulunmadan tavana çarpıyordu.
   *
   * ── NEDEN ROTA GERÇEĞİNİ BOZMAZ ────────────────────────────────────────
   * Bu bir MALİYET değişikliği değildir; uygunluk (admission) filtresidir:
   * kenar maliyeti, tek yön, erişim, via-node/via-way kısıtları AYNEN
   * uygulanır. Filtre KADEMELİDİR: tur sonuç bulamazsa çağıran daha gevşek
   * bir turla yeniden dener ve son tur DAİMA budamasızdır — yani budama bir
   * rotayı yok edemez, yalnız bulunma SIRASINI değiştirir.
   */
  classLimit: number;
  /**
   * Katman ofseti (m). SONSUZ DEĞİLDİR (ölçüldü): ofset 1e9 iken hedefe son
   * yaklaşmadaki sokak durumları koridorun TAMAMINDAKİ omurga durumlarının
   * ardına düşüyor ve İstanbul penceresi tek başına 86 000 durum yiyordu.
   * Ölçülü ofset "bu yolu ancak gerçekten gerekiyorsa aç" anlamına gelir.
   */
  tierOffsetM: number;
  /**
   * Sınıf filtresinin UYGULANMADIĞI yarıçap (m): başlangıç, hedef ve bu
   * pencerede aşılması zorunlu sınır kutuları çevresi. İlk/son kilometre ve
   * portal erişimi sokak ağından geçebilir; oralarda budama yapılmaz.
   */
  freeRadiusM: number;
  heap: CrossRegionEntry[];
  gCost: Map<string, number>;
  closed: Set<string>;
  keyToGlobal: Map<string, number>;
  recon: ReconArchive;
  maxClosed: number;
  outcome: CrossRegionOutcome | null;
  stats: {
    expansions: number; windowsUsed: number; migratedStates: number;
    droppedStates: number; peakOpen: number; peakGCost: number;
    /** Yığından çekilen toplam kayıt (kapalı durumlar dâhil). */
    pops: number;
    /** Zaten kapalı olduğu için atılan pop — bayat yığın kaydı ölçüsü. */
    stalePops: number;
    /** Kenar gevşetme sayısı = arşive yazılan kayıt sayısı. */
    relaxations: number;
    /** Pencere başına kapatılan durum (koridor süpürmesinin dağılımı). */
    closedPerWindow: number[];
    /**
     * ÖLÇÜM — kapatılan durumun GİRİŞ kenarının RTG3 yol sınıfı histogramı
     * (indis = sınıf: 1 motorway … 9 service; 0 = başlangıç/bilinmeyen).
     *
     * Aramanın nereye harcandığını KANITLAR: uzun rotada süpürmenin hangi
     * oranda şehirlerarası omurgaya, hangi oranda yerel sokağa gittiği başka
     * türlü görülemez. Karar üretmez; yalnız gözlem (bir dizi artırımı).
     */
    closedByClass: number[];
  };
}

let _crossSession: CrossRegionSession | null = null;

/**
 * KORİDOR YÖNELİMLİ KABUL EDİLEBİLİR ALT SINIR.
 *
 * ── ÖLÇÜLEN SORUN ────────────────────────────────────────────────────────
 * Kuş uçuşu sezgisel, uzun ve dolambaçlı koridorda kalan yolu ÇOK DÜŞÜK
 * tahmin eder; A* uzak hedefe doğru geniş bir elips tarar. Mersin→İstanbul
 * 1 597 469 durum açıyordu — cihaz bütçesi 200 000.
 *
 * ── ÇÖZÜM ────────────────────────────────────────────────────────────────
 * Bölgeler coğrafi karolardır: bir sonraki bölgeye geçen HER yol, iki karo
 * arasındaki sınır doğrusunu FİZİKSEL OLARAK KESER. Bu yüzden
 * "sınıra uzaklık + sınırdan sonra kalan alt sınır" kabul edilebilir bir
 * alt sınırdır.
 *
 * ── NEDEN KUŞ UÇUŞUYLA MAKSİMUM ALINMAZ (ÖLÇÜLDÜ) ────────────────────────
 * İkisinin maksimumunu almak MAGNİTÜD olarak daha sıkı bir sınır verir ama
 * ARAMAYA YÖN VERMEZ: uzak hedefe olan kuş uçuşu, bir pencerenin içindeki tüm
 * düğümler için neredeyse aynıdır (gradyan ~0) → A* pencere içinde Dijkstra'ya
 * dönüşür. Ölçüldü: pencere başına ~80 bin durum, yani pencerenin TAMAMI.
 *
 * Bu yüzden sınır kutusu varken DOĞRUDAN koridor alt sınırı kullanılır. Daha
 * küçük bir alt sınır olması kabul edilebilirliği bozmaz (hâlâ asla fazla
 * tahmin etmez); kazanç, `distanceToBoxM` teriminin pencere içinde GERÇEK bir
 * gradyan üretmesidir — arama sıradaki zorunlu sınıra yönelir.
 *
 * `HEURISTIC_WEIGHT` DEĞİŞMEDİ; rota gerçeği aynı kanonik A*'tan gelir.
 * Sınır kutusu YOKSA (tek pencereli rota veya son pencere) davranış eskisiyle
 * BİREBİR aynıdır.
 */
/**
 * Sınıf filtresinin uygulanmadığı bölge: başlangıç, hedef ve bu pencerede
 * aşılması zorunlu sınır kutuları çevresi. Budama buralarda YAPILMAZ, çünkü
 * ilk/son kilometre ve portal erişimi sokak ağından geçebilir.
 */
function _inCorridorFreeZone(session: CrossRegionSession, lat: number, lon: number): boolean {
  const r = session.freeRadiusM;
  if (r <= 0) return false;
  if (_havM(lat, lon, session.fromLat, session.fromLon) <= r) return true;
  if (_havM(lat, lon, session.toLat, session.toLon) <= r) return true;
  const boxes = session.boundaryBoxes;
  for (let i = 0; i < boxes.length; i++) {
    if (distanceToBoxM(lat, lon, boxes[i]) <= r) return true;
  }
  return false;
}

/**
 * KADEMELİ ERTELEME KATMANI — yığın sırası değişir, ARAMA UZAYI DEĞİŞMEZ.
 *
 * ── ÖLÇÜLEN SORUN ────────────────────────────────────────────────────────
 * Ürün bütçesiyle (200 000) koşulan uzun rotalarda kapatılan durumların
 * sınıf dağılımı ölçüldü: motorway+trunk+primary %2,4 · tertiary ve altı
 * %94,6 (yalnız residential %52). Bütçe, şehirlerarası bir rotanın hiç
 * kullanmayacağı sokak ağını süpürerek tükeniyor ve rota BULUNAMADAN
 * `CLOSED_LIMIT`e çarpıyordu.
 *
 * ── NEDEN FİLTRE DEĞİL, ERTELEME (ÖLÇÜLDÜ) ───────────────────────────────
 * Düşük sınıfları GENİŞLETMEDEN ELEMEK denendi: koridor koptu, arama
 * `EXHAUSTED` verdi (sınıf ≤4: 83 793 durumda tükendi; ≤5: 159 691). Yani
 * sert budama bir rotayı YOK EDEBİLİR. Bu yüzden durum atılmaz, yalnız
 * yığında GERİYE alınır: `f`ye katman ofseti eklenir. Omurga katmanı
 * tükenmeden alt katman açılmaz; omurga hedefe ulaşamazsa alt katman
 * kendiliğinden devreye girer → rota kaybı YOK, fail-soft korunur.
 *
 * `gCost` ve yasallık kuralları DEĞİŞMEZ; ofset yalnız `f` sıralamasındadır.
 * `classLimit = 0` iken (ürün varsayılanı değişmeden) davranış BİREBİR eskisidir.
 */
/* ── UZUN ROTA ARAMA PROFİLİ (ölçülmüş ürün varsayılanları) ───────────────
   Değerler `field-runs/rtg4-device-budget-20260908` (öncesi) ve
   `field-runs/rtg4-e20000f1.8-20260908` (sonrası) koşumlarından seçildi:
   ürün bütçesi 200 000 kapalı durumda ülke korpusunun TAMAMI çözülür.
   Yalnız ÇOK PENCERELİ (bölgeler arası) rotada uygulanır. */
const CORRIDOR_BASE_WEIGHT = 1.6;
const CORRIDOR_CLASS_LIMIT = 4;            // secondary ve üstü = omurga katmanı
const CORRIDOR_FREE_RADIUS_M = 2_000;      // ilk/son kilometre ve portal erişimi
const CORRIDOR_TIER_OFFSET_M = 150_000;
const CORRIDOR_ESCALATE_AFTER = 20_000;
const CORRIDOR_ESCALATE_FACTOR = 1.8;
const CORRIDOR_ESCALATE_MAX_WEIGHT = 4;

/** Ölçüm koşumu ağırlık gönderebilir; ürün sürücüsü GÖNDERMEZ. */
function _corridorBaseWeight(sent: number | undefined, multiWindow: boolean): number {
  if (Number.isFinite(sent) && Number(sent) > 0) return Number(sent);
  return multiWindow ? CORRIDOR_BASE_WEIGHT : HEURISTIC_WEIGHT;
}

function _corridorTier(
  session: CrossRegionSession, view: RoutingGraphView, ordinal: number, lat: number, lon: number,
): number {
  if (session.classLimit <= 0 || ordinal < 0) return 0;
  const cls = edgeRoadClass(view, ordinal);
  if (cls <= session.classLimit) return 0;
  if (_inCorridorFreeZone(session, lat, lon)) return 0;
  return cls <= session.classLimit + 2 ? 1 : 2;
}

function _crossRegionHeuristicM(session: CrossRegionSession, lat: number, lon: number): number {
  const boxes = session.isFinal ? null : session.boundaryBoxes;
  if (boxes === null || boxes.length === 0) return _havM(lat, lon, session.toLat, session.toLon);
  const remaining = session.boundaryRemainingM;
  let best = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const d = distanceToBoxM(lat, lon, boxes[i]) + (remaining[i] ?? session.remainingLowerBoundM);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Portal düğümlerini en fazla `RTG4_BOUNDARY_CLUSTERS` sıkı kutuya böler.
 *
 * ── NEDEN KÜMELEME ───────────────────────────────────────────────────────
 * Karo kenarının TAMAMINI (≈55 km'lik doğru) hedef almak, pencere içinde yine
 * zayıf bir gradyan verir: doğrunun her noktası eşit derecede "iyi" görünür ve
 * arama sınır boyunca YAYILIR. Ölçüldü: pencere başına ~65 bin durum.
 * Gerçek portal düğümleri ise birkaç yol geçişinde KÜMELENİR; onları küçük
 * kutulara ayırmak hedefi noktaya yaklaştırır.
 *
 * Kabul edilebilirlik korunur: her kutu kendi portallarını KAPSAR, dolayısıyla
 * kutuya uzaklık o portallara olan uzaklıktan büyük olamaz. Kutu sayısı
 * sınırlıdır → sıcak yolda sabit maliyet.
 */
const RTG4_BOUNDARY_CLUSTERS = 6;


function _clusterBoundaryBoxes(
  points: readonly number[],   // [lat0, lon0, lat1, lon1, ...]
): (readonly [number, number, number, number])[] {
  const count = points.length >> 1;
  if (count === 0) return [];
  const index = Array.from({ length: count }, (_, i) => i);
  /* Portallar bir karo kenarı boyunca dizilir; baskın eksene göre sıralayıp
     eşit sayıda parçaya bölmek, o doğruyu sıkı parçalara ayırır. */
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (let i = 0; i < count; i++) {
    const lat = points[i * 2], lon = points[i * 2 + 1];
    if (lat < latMin) latMin = lat; if (lat > latMax) latMax = lat;
    if (lon < lonMin) lonMin = lon; if (lon > lonMax) lonMax = lon;
  }
  const byLat = (latMax - latMin) >= (lonMax - lonMin);
  index.sort((a, b) => byLat
    ? points[a * 2] - points[b * 2]
    : points[a * 2 + 1] - points[b * 2 + 1]);

  const clusters = Math.min(RTG4_BOUNDARY_CLUSTERS, count);
  const boxes: (readonly [number, number, number, number])[] = [];
  for (let c = 0; c < clusters; c++) {
    const start = Math.floor((c * count) / clusters);
    const end = Math.floor(((c + 1) * count) / clusters);
    if (end <= start) continue;
    let bLatMin = Infinity, bLatMax = -Infinity, bLonMin = Infinity, bLonMax = -Infinity;
    for (let k = start; k < end; k++) {
      const lat = points[index[k] * 2], lon = points[index[k] * 2 + 1];
      if (lat < bLatMin) bLatMin = lat; if (lat > bLatMax) bLatMax = lat;
      if (lon < bLonMin) bLonMin = lon; if (lon > bLonMax) bLonMax = lon;
    }
    boxes.push([bLonMin, bLatMin, bLonMax, bLatMax]);
  }
  return boxes;
}

/** `${node}:${ordinal}` / `${node}:${ordinal}:${mask}` anahtarını çözer. */
function _parseStateKey(key: string): [number, number, number] {
  const first = key.indexOf(':');
  const second = key.indexOf(':', first + 1);
  const node = Number(key.slice(0, first));
  if (second < 0) return [node, Number(key.slice(first + 1)), 0];
  return [node, Number(key.slice(first + 1, second)), Number(key.slice(second + 1))];
}

/**
 * Canlı arama durumunu ESKİ pencereden YENİ pencereye taşır.
 *
 * Çeviri bölge-yerel indeks üzerinden KESİNDİR (aynı bölge dosyası, SHA ile
 * doğrulanmış). Pencerede kalmayan bölgedeki durumlar düşer — onlar süpürmenin
 * GERİSİNDE kalmıştır ve yeni pencerede yeniden üretilemezler; yeniden kurma
 * kayıtları ise arşivde DURUR, bu yüzden rota geometrisi kaybolmaz.
 *
 * Via-way maskesi tahmin edilmez: kanonik `remapViaWayMask` tek ve kesin
 * eşleşme bulamazsa TÜM rota fail-closed edilir.
 */
function _migrateCrossRegionWindow(
  session: CrossRegionSession, nextGraph: RoutingGraph, nextIdentity: RegionWindowIdentity,
): string | null {
  const previousGraph = session.graph, previousIdentity = session.identity;
  if (!previousGraph || !previousIdentity) return null;      // ilk pencere: taşıma yok
  const oldView = previousGraph.view, newView = nextGraph.view;

  const slotMap: number[] = previousIdentity.regionIds.map(
    (id) => nextIdentity.regionIds.indexOf(id));

  const mapNode = (node: number): number => {
    for (let slot = 0; slot < slotMap.length; slot++) {
      const target = slotMap[slot];
      if (target < 0) continue;
      const local = previousIdentity.nodeMergedToLocal[slot][node];
      if (local === REGION_WINDOW_NO_LOCAL) continue;
      return nextIdentity.nodeLocalToMerged[target][local];
    }
    return -1;
  };
  const mapEdge = (edge: number): number => {
    if (edge < 0) return -1;
    for (let slot = 0; slot < slotMap.length; slot++) {
      const target = slotMap[slot];
      if (target < 0) continue;
      const local = previousIdentity.edgeMergedToLocal[slot][edge];
      if (local === REGION_WINDOW_NO_LOCAL) continue;
      return nextIdentity.edgeLocalToMerged[target][local];
    }
    return -1;
  };

  const translate = (key: string): string | null | undefined => {
    const [node, ordinal, mask] = _parseStateKey(key);
    const to = mapNode(node);
    if (to < 0) return undefined;                              // pencere gerisinde kaldı
    const nextOrdinal = ordinal < 0 ? -1 : mapEdge(ordinal);
    if (ordinal >= 0 && nextOrdinal < 0) return undefined;
    if (mask === 0) return `${to}:${nextOrdinal}`;
    const nextMask = remapViaWayMask(oldView, ordinal, mask, newView, nextOrdinal, mapEdge, mapNode);
    if (nextMask === null) return null;                        // belirsiz → fail-closed
    /* Zincir yeni pencerede YOK: durum DÜŞÜRÜLÜR. Maskeyi 0'a indirip devam
       etmek, aktif bir `only_*`/`no_*` dizisini sessizce iptal etmek olurdu. */
    if (nextMask === RTG3_VIA_WAY_MASK_ABSENT) return undefined;
    return nextMask === 0 ? `${to}:${nextOrdinal}` : `${to}:${nextOrdinal}:${nextMask}`;
  };

  const gCost = new Map<string, number>();
  const closed = new Set<string>();
  const keyToGlobal = new Map<string, number>();
  for (const [key, cost] of session.gCost) {
    const next = translate(key);
    if (next === null) return 'VIA_WAY_STATE_NOT_TRANSLATABLE';
    if (next === undefined) { session.stats.droppedStates++; continue; }
    gCost.set(next, cost);
    const global = session.keyToGlobal.get(key);
    if (global === undefined) return 'RECONSTRUCTION_RECORD_MISSING';
    keyToGlobal.set(next, global);
    if (session.closed.has(key)) closed.add(next);
    session.stats.migratedStates++;
  }

  /* `f` YENİ pencerenin sezgiseliyle yeniden hesaplanır: sınır kutusu ve kalan
     alt sınır değişmiştir, eski `f` artık aynı sıralamayı ifade etmez. */
  const heap: CrossRegionEntry[] = [];
  for (const entry of session.heap) {
    const next = translate(entry[4]);
    if (next === null) return 'VIA_WAY_STATE_NOT_TRANSLATABLE';
    if (next === undefined) continue;
    const cost = gCost.get(next);
    if (cost === undefined) continue;
    const [node, ordinal, mask] = _parseStateKey(next);
    heap.push([
      cost + session.weight * _crossRegionHeuristicM(
        session, newView.nodeLat[node], newView.nodeLon[node])
        /* Katman ofseti YENİ pencerede yeniden uygulanır: serbest bölge
           (sınır kutuları) değişmiştir, eski katman artık geçerli değildir. */
        + _corridorTier(session, newView, ordinal, newView.nodeLat[node], newView.nodeLon[node])
          * session.tierOffsetM,
      node, ordinal, mask, next,
    ]);
  }
  heap.sort((a, b) => a[0] - b[0]);   // ikili yığın invaryantı: sıralı dizi geçerli bir min-heap'tir

  session.gCost = gCost;
  session.closed = closed;
  session.keyToGlobal = keyToGlobal;
  session.heap = heap;
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
function routeRtg3EdgeState(
  g: RoutingGraph, startIdx: number, goalIdx: number, session?: CrossRegionSession,
): number[] | null {
  const { view, adjacency } = g;
  /* Uzun rotada hedef düğüm yalnız SON pencerede vardır; sezgisel bu yüzden
     düğüm ordinali yerine hedefin coğrafi konumunu kullanır. Tek pencerede
     ikisi AYNI değerdir (ölçülen parite) — davranış değişmez. */
  const goalLat = session ? session.toLat : view.nodeLat[goalIdx];
  const goalLon = session ? session.toLon : view.nodeLon[goalIdx];
  /* Uzun rotada sezgisel koridor alt sınırıyla SIKILAŞTIRILIR; tek pencerede
     ve son pencerede sonuç kuş uçuşuyla BİREBİR aynıdır (parite). */
  const heuristicM = session
    ? (lat: number, lon: number) => _crossRegionHeuristicM(session, lat, lon)
    : (lat: number, lon: number) => _havM(lat, lon, goalLat, goalLon);
  /* Ağırlık DÖNGÜ İÇİNDE okunur: bütçe-farkında tırmanma onu değiştirebilir. */
  const weightOf = () => (session ? session.weight : HEURISTIC_WEIGHT);
  type Entry = [number, number, number, number, string]; // f, node, previous edge, via-way mask, state key
  const startKey = `${startIdx}:-1`;
  const heap: Entry[] = session ? session.heap : [[0, startIdx, -1, 0, startKey]];
  const gCost = session ? session.gCost : new Map<string, number>([[startKey, 0]]);
  const previous = new Map<string, string>();
  const stateNode = new Map<string, number>([[startKey, startIdx]]);
  const closed = session ? session.closed : new Set<string>();
  const maxClosed = session ? session.maxClosed : MAX_CLOSED;
  if (session && !session.started) {
    session.started = true;
    heap.push([0, startIdx, -1, 0, startKey]);
    gCost.set(startKey, 0);
    const startRecord = _reconPush(
      session.recon, -1, view.nodeLon[startIdx], view.nodeLat[startIdx], 0, 0,
      view.nodeSourceId[startIdx], 0n);
    if (startRecord < 0) {
      session.outcome = { kind: 'FAIL_CLOSED', reason: 'CROSS_REGION_RECONSTRUCTION_BUDGET' };
      return null;
    }
    session.keyToGlobal.set(startKey, startRecord);
    session.stats.relaxations++;
  }

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
    if (session) session.stats.peakOpen = Math.max(session.stats.peakOpen, heap.length);
    const entry = pop(); if (!entry) break;
    if (session) session.stats.pops++;
    const [, cur, previousEdge, viaWayMask, key] = entry;
    if (closed.has(key)) { if (session) session.stats.stalePops++; continue; }
    if (session) {
      if (session.isFinal && cur === goalIdx) {
        const globalId = session.keyToGlobal.get(key);
        session.outcome = globalId === undefined
          ? { kind: 'FAIL_CLOSED', reason: 'RECONSTRUCTION_RECORD_MISSING' }
          : { kind: 'GOAL', globalId };
        return null;
      }
      /* Sınır portalı: bu durum ancak SONRAKİ bölge yerleşince ilerleyebilir.
         En düşük `f` ile açıldığı için ileri yönde EN UMUT VERİCİ durumdur —
         pencereyi tam burada kaydırmak, aramayı boşuna tüketmeden ilerletir. */
      const exitRegions = session.isFinal ? undefined : session.boundary.get(view.nodeSourceId[cur]);
      if (exitRegions !== undefined) {
        push(entry);                       // durum KAYBOLMAZ: yeni pencerede yeniden açılır
        /* Bu düğümü TAŞIYAN bölge yeni pencerede KALMALI; yoksa sınıra kadar
           yapılmış arama tahliyeyle düşer ve süpürme yerinde sayar. */
        const fromRegionIds: string[] = [];
        const identity = session.identity;
        if (identity) for (let slot = 0; slot < identity.regionIds.length; slot++) {
          if (identity.nodeMergedToLocal[slot][cur] !== REGION_WINDOW_NO_LOCAL) {
            fromRegionIds.push(identity.regionIds[slot]);
          }
        }
        session.outcome = { kind: 'NEED_WINDOW', regionIds: exitRegions, fromRegionIds };
        return null;
      }
    } else if (cur === goalIdx) {
      const path: number[] = [];
      let cursor: string | undefined = key;
      while (cursor !== undefined) {
        path.unshift(stateNode.get(cursor)!);
        cursor = previous.get(cursor);
      }
      return path;
    }
    closed.add(key);
    if (session) {
      session.stats.expansions++;
      session.stats.closedByClass[previousEdge >= 0 ? edgeRoadClass(view, previousEdge) : 0]++;
      session.stats.peakGCost = Math.max(session.stats.peakGCost, gCost.size);
      const windowSlot = session.stats.closedPerWindow.length - 1;
      if (windowSlot >= 0) {
        const closedHere = ++session.stats.closedPerWindow[windowSlot];
        /* Tırmanma: bu PENCEREDE harcanan durum eşiği katladıkça ağırlık artar. */
        if (session.escalateAfter > 0 && closedHere % session.escalateAfter === 0 &&
            session.weight < session.escalateMaxWeight) {
          session.weight = Math.min(session.escalateMaxWeight, session.weight * session.escalateFactor);
          session.escalations++;
        }
      }
    }
    /* RAM koruması uzun rotada TOPLAM iş üzerinden ölçülür: `closed` pencere
       tahliyesinde küçülür, bu yüzden tek başına küresel bir tavan DEĞİLDİR.
       `expansions` ise hiç azalmaz — dürüst sınır odur. */
    if (closed.size > maxClosed || (session !== undefined && session.stats.expansions > maxClosed)) {
      if (session) session.outcome = { kind: 'CLOSED_LIMIT' };
      return null;
    }
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
        if (session) {
          const parent = session.keyToGlobal.get(key);
          if (parent === undefined) {
            session.outcome = { kind: 'FAIL_CLOSED', reason: 'RECONSTRUCTION_RECORD_MISSING' };
            return null;
          }
          /* Yeniden kurma kaydı ORDİNAL DEĞİL, ölçülmüş değer saklar; bu yüzden
             kaydı üreten bölge tahliye edildikten sonra da geçerlidir. */
          const record = _reconPush(
            session.recon, parent, view.nodeLon[to], view.nodeLat[to],
            edgeCost, edgeRoadClass(view, ordinal),
            view.nodeSourceId[to], view.edgeSourceWayId[ordinal]);
          if (record < 0) {
            session.outcome = { kind: 'FAIL_CLOSED', reason: 'CROSS_REGION_RECONSTRUCTION_BUDGET' };
            return null;
          }
          session.keyToGlobal.set(nextKey, record);
          session.stats.relaxations++;
        } else {
          previous.set(nextKey, key);
          stateNode.set(nextKey, to);
        }
        const priority = newG + weightOf() * heuristicM(view.nodeLat[to], view.nodeLon[to]);
        push([
          session === undefined ? priority
            : priority + _corridorTier(session, view, ordinal, view.nodeLat[to], view.nodeLon[to])
              * session.tierOffsetM,
          to, ordinal, nextMask, nextKey,
        ]);
      }
    }
  }
  if (session) session.outcome = { kind: 'EXHAUSTED' };
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
function _edgeSeconds(costM: number, roadClass: number, version: 1 | 2 | 3 | 4): number {
  const speeds = version >= 3 ? RTG3_ROAD_CLASS_SPEED_MS : ROAD_CLASS_SPEED_MS;
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

/* ══════════════════════════════════════════════════════════════════════════
   CROSS-REGION PROTOKOLÜ (worker tarafı)

   Graf sakinliğinin SAHİBİ ana iş parçacığıdır (`graphResidencyRuntime`).
   Worker hangi pencereye ihtiyacı olduğunu SÖYLER, kendi indirmez — ikinci bir
   residency/bütçe otoritesi kurulmaz. Arama durumu ise burada kalır ve pencere
   tahliyesinden sağ çıkar.
   ══════════════════════════════════════════════════════════════════════════ */

function _crossRegionFail(requestId: string, reason: string): void {
  _crossSession = null;
  (self as unknown as Worker).postMessage({ type: 'ROUTE_ERROR', requestId, reason });
}

/**
 * Kanonik yeniden kurma: rota, arşivdeki ÖLÇÜLMÜŞ kenar dizisinden kurulur.
 * Portal koridoru burada KULLANILMAZ — o yalnız hangi bölgenin yükleneceğini
 * söyleyen budama kanıtıydı; kullanıcının süreceği yol bu dizidir.
 */
function _reconstructCrossRegionRoute(session: CrossRegionSession, globalId: number): {
  geometry: [number, number][]; distanceM: number; durationS: number;
  nodeIds: string[]; wayIds: string[];
} | null {
  const archive = session.recon;
  if (globalId < 0 || globalId >= archive.count) return null;
  const geometry: [number, number][] = [];
  /* Kararlı kimlik dizisi BAĞIMSIZ yasallık denetimi içindir; rota otoritesi
     değildir. Denetleyici bu kimliklerle bölge grafını kendisi okur. */
  const nodeIds: string[] = [], wayIds: string[] = [];
  let distanceM = 0, durationS = 0, cursor = globalId, guard = 0;
  while (cursor >= 0) {
    if (++guard > archive.count + 1) return null;      // bozuk zincir → fail-closed
    geometry.push([archive.lon[cursor], archive.lat[cursor]]);
    nodeIds.push(String(archive.nodeId[cursor]));
    wayIds.push(String(archive.wayId[cursor]));
    distanceM += archive.cost[cursor];
    durationS += _edgeSeconds(archive.cost[cursor], archive.cls[cursor], 4);
    cursor = archive.prev[cursor];
  }
  geometry.reverse(); nodeIds.reverse(); wayIds.reverse();
  return geometry.length >= 2 ? { geometry, distanceM, durationS, nodeIds, wayIds } : null;
}

/* Ayrı fonksiyon: çağrı yerinde `session.outcome = null` daraltması sonucu
   gizlemesin — hüküm aramadan gelir, çağıranın varsayımından değil. */
function _takeCrossRegionOutcome(session: CrossRegionSession): CrossRegionOutcome {
  return session.outcome ?? { kind: 'FAIL_CLOSED', reason: 'CROSS_REGION_NO_OUTCOME' };
}

function _crossRegionStats(session: CrossRegionSession): Record<string, number> {
  return {
    expansions: session.stats.expansions,
    windowsUsed: session.stats.windowsUsed,
    migratedStates: session.stats.migratedStates,
    droppedStates: session.stats.droppedStates,
    peakOpenStates: session.stats.peakOpen,
    peakSearchStates: session.stats.peakGCost,
    reconstructionRecords: session.recon.count,
    reconstructionBytes: _reconBytes(session.recon),
    closedStates: session.closed.size,
    pops: session.stats.pops,
    stalePops: session.stats.stalePops,
    relaxations: session.stats.relaxations,
    maxClosedBudget: session.maxClosed,
    weightEscalations: session.escalations,
    /* Sınıf histogramı düz alan olarak yayılır (mesaj sözleşmesi sayı taşır). */
    ...Object.fromEntries(session.stats.closedByClass.map((n, i) => [`closedClass${i}`, n])),
  };
}

/** Pencere kurulur/kaydırılır ve AYNI mantıksal arama devam eder. */
function _crossRegionAdvance(
  session: CrossRegionSession, windowIndex: number, view: RoutingGraphView,
  identity: RegionWindowIdentity,
  exitPortals: readonly { readonly nodeId: string; readonly regionIds: readonly string[] }[],
  isFinal: boolean,
  boundaryBox: readonly [number, number, number, number] | null,
  remainingLowerBoundM: number,
): void {
  let graph: RoutingGraph;
  try {
    graph = { view, adjacency: buildGraphAdjacency(view), version: view.version };
  } catch {
    _crossRegionFail(session.requestId, 'CROSS_REGION_ADJACENCY_FAILED');
    return;
  }
  if (view.version !== 4) { _crossRegionFail(session.requestId, 'CROSS_REGION_REQUIRES_RTG4'); return; }

  /* Sezgisel girdileri taşımadan ÖNCE kurulur: `f` yeniden hesabı YENİ
     pencerenin sınırına göre yapılmalıdır. Portal düğümleri BU pencerede
     yerleşiktir; koordinatları buradan okunur — manifest koordinat taşımaz. */
  session.isFinal = isFinal;
  /* Ağırlık her pencerede TABANA döner: bir penceredeki arazi cezası sonraki
     pencerenin rota kalitesini bozmaz. */
  session.weight = isFinal ? session.finalWeight : session.baseWeight;
  session.remainingLowerBoundM = isFinal ? 0 : remainingLowerBoundM;
  if (isFinal) { session.boundaryBoxes = []; session.boundaryRemainingM = []; }
  else {
    const wanted = new Set(exitPortals.map((portal) => BigInt(portal.nodeId)));
    const points: number[] = [];
    for (let i = 0; i < view.nodeCount && wanted.size > 0; i++) {
      if (!wanted.has(view.nodeSourceId[i])) continue;
      points.push(view.nodeLat[i], view.nodeLon[i]);
      wanted.delete(view.nodeSourceId[i]);
    }
    /* Portal düğümü bu pencerede bulunamazsa karo kenarına düşülür: daha geniş
       ama HÂLÂ kabul edilebilir bir hedef — uydurma yapılmaz. */
    session.boundaryBoxes = points.length > 0
      ? _clusterBoundaryBoxes(points)
      : (boundaryBox ? [boundaryBox] : []);
    /* Kutu başına kalan alt sınır: koridor terimi ile "kutudan hedefe kuş
       uçuşu" teriminin MAKSİMUMU — ikisi de alt sınırdır, büyüğü daha sıkıdır. */
    session.boundaryRemainingM = session.boundaryBoxes.map((box) => Math.max(
      remainingLowerBoundM, distanceToBoxM(session.toLat, session.toLon, box)));
  }

  const migrationError = _migrateCrossRegionWindow(session, graph, identity);
  if (migrationError !== null) { _crossRegionFail(session.requestId, migrationError); return; }

  session.graph = graph;
  session.identity = identity;
  session.windowIndex = windowIndex;
  session.boundary = new Map(exitPortals.map((portal) => [BigInt(portal.nodeId), portal.regionIds]));
  session.stats.windowsUsed++;
  session.stats.closedPerWindow.push(0);

  const startIdx = session.started ? -1 : _nearest(graph, session.fromLat, session.fromLon);
  const goalIdx = isFinal ? _nearest(graph, session.toLat, session.toLon) : -1;
  session.outcome = null;
  try {
    routeRtg3EdgeState(graph, startIdx, goalIdx, session);
  } catch (error) {
    _crossRegionFail(session.requestId, error instanceof Error ? error.message : 'CROSS_REGION_SEARCH_THREW');
    return;
  }

  const outcome = _takeCrossRegionOutcome(session);
  if (outcome.kind === 'NEED_WINDOW') {
    (self as unknown as Worker).postMessage({
      type: 'CROSS_REGION_NEED_WINDOW', requestId: session.requestId,
      windowIndex: windowIndex + 1, requestedRegionIds: outcome.regionIds,
      fromRegionIds: outcome.fromRegionIds, stats: _crossRegionStats(session),
    });
    return;
  }
  if (outcome.kind === 'GOAL') {
    const route = _reconstructCrossRegionRoute(session, outcome.globalId);
    if (!route) { _crossRegionFail(session.requestId, 'CROSS_REGION_RECONSTRUCTION_FAILED'); return; }
    const stats = _crossRegionStats(session);
    _crossSession = null;
    (self as unknown as Worker).postMessage({
      type: 'ROUTE_RESULT', requestId: session.requestId,
      geometry: route.geometry, distanceM: route.distanceM, durationS: route.durationS,
      steps: [], crossRegion: stats,
      crossRegionClosedPerWindow: [...session.stats.closedPerWindow],
      /* Denetim kanıtı — ürün tüketicisi bu alanları OKUMAZ. */
      routeNodeIds: route.nodeIds, routeWayIds: route.wayIds,
    });
    return;
  }
  /* EXHAUSTED · CLOSED_LIMIT · FAIL_CLOSED → rota UYDURULMAZ. */
  const stats = _crossRegionStats(session);
  const reason = outcome.kind === 'FAIL_CLOSED' ? outcome.reason : `CROSS_REGION_${outcome.kind}`;
  _crossSession = null;
  (self as unknown as Worker).postMessage({
    type: 'ROUTE_ERROR', requestId: session.requestId, reason, crossRegion: stats,
    crossRegionClosedPerWindow: [...session.stats.closedPerWindow],
  });
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
    identity?: RegionWindowIdentity;
    exitPortals?: { nodeId: string; regionIds: string[] }[];
    boundaryBox?: [number, number, number, number] | null;
    remainingLowerBoundM?: number;
    corridorClassLimit?: number;
    corridorFreeRadiusM?: number;
    corridorTierOffsetM?: number;
    finalHeuristicWeight?: number;
    escalateAfterStates?: number;
    escalateFactor?: number;
    escalateMaxWeight?: number;
    isFinal?: boolean;
    windowIndex?: number;
    windowCount?: number;
    maxClosedStates?: number;
    heuristicWeight?: number;
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
    if (!view || view.version < 3 || view.nodeCount < 1 || view.edgeCount < 1 ||
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

  if (msg.type === 'CROSS_REGION_BEGIN' && msg.requestId != null &&
      msg.fromLat != null && msg.fromLon != null && msg.toLat != null && msg.toLon != null) {
    /* ── UZUN ROTA ÜRÜN VARSAYILANLARI ────────────────────────────────────
       Aşağıdaki değerler ölçümle seçildi (bkz. `_corridorTier` ve
       `escalateAfter` başlıkları). ÇOK PENCERELİ rotada uygulanır; TEK
       pencereli (bölge içi) rotada mekanizmalar KAPALIDIR ve davranış birebir
       eski sürümdür — kısa rota kalitesi bu değişiklikten etkilenmez. */
    const multiWindow = Number(msg.windowCount ?? 0) > 1;
    _crossSession = {
      requestId: msg.requestId,
      fromLat: msg.fromLat, fromLon: msg.fromLon, toLat: msg.toLat, toLon: msg.toLon,
      windowIndex: -1, windowCount: Number(msg.windowCount ?? 0),
      graph: null, identity: null, boundary: new Map<bigint, readonly string[]>(), isFinal: false, started: false,
      heap: [], gCost: new Map(), closed: new Set(), keyToGlobal: new Map(),
      boundaryBoxes: [], boundaryRemainingM: [], remainingLowerBoundM: 0,
      classLimit: Number.isFinite(msg.corridorClassLimit) ? Number(msg.corridorClassLimit)
        : (multiWindow ? CORRIDOR_CLASS_LIMIT : 0),
      tierOffsetM: Number.isFinite(msg.corridorTierOffsetM) && Number(msg.corridorTierOffsetM) > 0
        ? Number(msg.corridorTierOffsetM) : CORRIDOR_TIER_OFFSET_M,
      freeRadiusM: Number.isFinite(msg.corridorFreeRadiusM) ? Number(msg.corridorFreeRadiusM)
        : (multiWindow ? CORRIDOR_FREE_RADIUS_M : 0),
      weight: _corridorBaseWeight(msg.heuristicWeight, multiWindow),
      baseWeight: _corridorBaseWeight(msg.heuristicWeight, multiWindow),
      escalateAfter: Number.isFinite(msg.escalateAfterStates) && Number(msg.escalateAfterStates) > 0
        ? Number(msg.escalateAfterStates) : (multiWindow ? CORRIDOR_ESCALATE_AFTER : 0),
      escalateFactor: Number.isFinite(msg.escalateFactor) && Number(msg.escalateFactor) > 1
        ? Number(msg.escalateFactor) : CORRIDOR_ESCALATE_FACTOR,
      escalateMaxWeight: Number.isFinite(msg.escalateMaxWeight) && Number(msg.escalateMaxWeight) > 0
        ? Number(msg.escalateMaxWeight) : CORRIDOR_ESCALATE_MAX_WEIGHT,
      escalations: 0,
      finalWeight: Number.isFinite(msg.finalHeuristicWeight) && Number(msg.finalHeuristicWeight) > 0
        ? Number(msg.finalHeuristicWeight) : _corridorBaseWeight(msg.heuristicWeight, multiWindow),
      /* Varsayılan cihaz koruması DEĞİŞMEDİ. Gölge ölçüm koşumu bu tavanı
         AÇIKÇA yükseltebilir; ürün sürücüsü bunu ASLA göndermez, böylece
         "ölçüm için gerekli" ile "cihazda geçerli" birbirine karışmaz. */
      maxClosed: 0,
      recon: _reconCreate(0),
      outcome: null,
      stats: {
        expansions: 0, windowsUsed: 0, migratedStates: 0, droppedStates: 0,
        closedByClass: new Array<number>(10).fill(0),
        peakOpen: 0, peakGCost: 0, pops: 0, stalePops: 0, relaxations: 0,
        closedPerWindow: [],
      },
    };
    const budget = Number.isFinite(msg.maxClosedStates) && Number(msg.maxClosedStates) > 0
      ? Number(msg.maxClosedStates) : MAX_CLOSED;
    _crossSession.maxClosed = budget;
    /* Arşiv tavanı arama tavanına BAĞLIDIR: her kapatılan durum en fazla birkaç
       gevşetme üretir. Tavan aşılırsa rota uydurulmaz, fail-closed edilir. */
    _crossSession.recon = _reconCreate(budget * 4);
    (self as unknown as Worker).postMessage({
      type: 'CROSS_REGION_NEED_WINDOW', requestId: msg.requestId, windowIndex: 0,
      requestedRegionIds: [], fromRegionIds: [], stats: null,
    });
    return;
  }

  if (msg.type === 'CROSS_REGION_WINDOW' && msg.requestId != null) {
    const session = _crossSession;
    if (!session || session.requestId !== msg.requestId) {
      (self as unknown as Worker).postMessage({
        type: 'ROUTE_ERROR', requestId: msg.requestId, reason: 'CROSS_REGION_SESSION_MISSING' });
      return;
    }
    const view = msg.graphView;
    if (!view || !msg.identity || !Array.isArray(msg.exitPortals)) {
      _crossRegionFail(session.requestId, 'CROSS_REGION_WINDOW_INVALID');
      return;
    }
    _crossRegionAdvance(
      session, Number(msg.windowIndex ?? 0), view, msg.identity,
      msg.exitPortals, msg.isFinal === true,
      msg.boundaryBox ?? null, Number(msg.remainingLowerBoundM ?? 0));
    return;
  }

  if (msg.type === 'CROSS_REGION_ABORT') { _crossSession = null; return; }

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
