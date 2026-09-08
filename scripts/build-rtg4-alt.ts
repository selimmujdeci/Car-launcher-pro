/**
 * build-rtg4-alt.ts — RTG4 ALT (A*, Landmarks, Triangle inequality) ÖN İŞLEME.
 *
 * ── NE ÜRETİR ─────────────────────────────────────────────────────────────
 * Ülke çapı yönlü karayolu grafında seçilmiş K landmark için düğüm başına iki
 * GERÇEK YOL mesafesi: `d(L → v)` ve `d(v → L)`. Bunlar çalışma zamanında
 * kanonik A*'ın sezgiseline KABUL EDİLEBİLİR bir alt sınır verir:
 *
 *   h(v) = max_L max( d(v→L) − d(t→L), d(L→t) − d(L→v), 0 )
 *
 * ── NEDEN ALT SINIR GEÇERLİ (KANIT) ───────────────────────────────────────
 * Yönlü üçgen eşitsizliği: d(v→t) ≥ d(v→L) − d(t→L) ve d(v→t) ≥ d(L→t) − d(L→v).
 * Ön işleme metriği KASITLI OLARAK EN GEVŞEK graftır: yalnız tek-yön uygulanır;
 * dönüş yasağı, via-way zinciri ve destination-only transit cezası UYGULANMAZ.
 * Kanonik A*'ın gerçek maliyeti bu metrikten ASLA küçük olamaz
 * (kısıt eklemek yolu kısaltamaz, `accessPenalty` yalnız maliyeti artırır),
 * dolayısıyla üretilen sınır fazla tahmin edemez.
 *
 * Ölçek: mesafeler `scaleM` metrelik kovalara AŞAĞI yuvarlanır (floor) →
 * yuvarlama da sınırı yalnız küçültür, kabul edilebilirlik korunur.
 *
 * Bu dosya bir ÖN İŞLEMEDİR; rota otoritesi DEĞİLDİR. Rota gerçeği kanonik
 * `routeRtg3EdgeState`ten gelir.
 *
 * Koşum:
 *   node --max-old-space-size=8192 --experimental-strip-types --no-warnings
 *        --loader ./scripts/nodeTsResolve.mjs scripts/build-rtg4-alt.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseRoutingGraph, edgeIsOneway } from '../src/platform/navigation/map/graph/rtg2Reader';

const RUN = resolve(process.env.RTG4_RUN_DIR ?? 'field-runs/rtg4-portal-v2-national-20260908');
const OUT = resolve(process.env.ALT_OUT_DIR ?? RUN);
const LANDMARKS = Number(process.env.ALT_LANDMARKS ?? 16);
/* Kova ölçeği: 65 534 × 50 m = 3 276 km — Türkiye çapı (~1 600 km) rahat sığar.
   25 m denendi ve REDDEDİLDİ: 1 638 km'de taşıyordu ve taşan değeri kırpmak
   `d(t→L)` terimini KÜÇÜLTÜP sınırı FAZLA TAHMİN ettirebilirdi. */
const SCALE_M = Number(process.env.ALT_SCALE_M ?? 50);
const SCHEMA_VERSION = 1;
const ALT_MAGIC = 0x414c5431;                       // "ALT1"
const UNREACHABLE = 0xffff;                         // Uint16 kovasında "yok"

const manifestPath = resolve(RUN, 'turkey-graph-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  datasetId: string; policyVersion: string;
  regions: { regionId: string; graphFile: string; sha256: string; nodeCount: number; edgeCount: number }[];
};
mkdirSync(OUT, { recursive: true });

const log = (m: string) => console.log(`[alt] ${(performance.now() / 1000).toFixed(1)}s ${m}`);

/* ── 1) Küresel düğüm kimliği ─────────────────────────────────────────────
   Bölgeler ÖRTÜŞEN düğüm taşır (karo sınırındaki aynı OSM düğümü iki dosyada
   bulunur). Küresel graf, kararlı OSM kimliği üzerinden birleştirilir; bu
   birleştirme portal kanıtından BAĞIMSIZDIR ve yalnız ön işleme içindir. */
const totalNodes = manifest.regions.reduce((a, r) => a + r.nodeCount, 0);
const totalEdges = manifest.regions.reduce((a, r) => a + r.edgeCount, 0);
log(`manifest: ${manifest.regions.length} bölge · ${totalNodes} düğüm · ${totalEdges} kenar`);

const readRegion = (region: typeof manifest.regions[number]) => {
  const buf = readFileSync(resolve(RUN, region.graphFile));
  const parsed = parseRoutingGraph(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  if (!parsed.view) throw new Error(`RTG4 okunamadı: ${region.regionId} — ${parsed.error ?? '?'}`);
  return parsed.view;
};

const allIds = new Float64Array(totalNodes);        // OSM id < 2^53 → Float64 KESİN
let idCursor = 0;
const regionNodeIds: { regionId: string; nodeIds: Float64Array; lat: Float32Array; lon: Float32Array }[] = [];

let pass1 = 0;
for (const region of manifest.regions) {
  const view = readRegion(region);
  const ids = new Float64Array(view.nodeCount);
  const lat = new Float32Array(view.nodeCount), lon = new Float32Array(view.nodeCount);
  for (let i = 0; i < view.nodeCount; i++) {
    const id = Number(view.nodeSourceId[i]);
    ids[i] = id; lat[i] = view.nodeLat[i]; lon[i] = view.nodeLon[i];
    allIds[idCursor++] = id;
  }
  regionNodeIds.push({ regionId: region.regionId, nodeIds: ids, lat, lon });
  if (++pass1 % 100 === 0) log(`geçiş 1: ${pass1}/${manifest.regions.length}`);
}
log(`geçiş 1 bitti: ${idCursor} düğüm kaydı`);

const sorted = allIds.slice(0, idCursor);
sorted.sort();
let unique = 0;
for (let i = 0; i < sorted.length; i++) if (i === 0 || sorted[i] !== sorted[i - 1]) sorted[unique++] = sorted[i];
const globalIds = sorted.slice(0, unique);
log(`küresel düğüm: ${unique} benzersiz (${idCursor - unique} örtüşen kayıt birleşti)`);

const indexOfId = (id: number): number => {
  let lo = 0, hi = unique - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, v = globalIds[mid];
    if (v === id) return mid;
    if (v < id) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
};

const regionToGlobal = new Map<string, Uint32Array>();
const globalLat = new Float32Array(unique), globalLon = new Float32Array(unique);
for (const cache of regionNodeIds) {
  const map = new Uint32Array(cache.nodeIds.length);
  for (let i = 0; i < cache.nodeIds.length; i++) {
    const g = indexOfId(cache.nodeIds[i]);
    if (g < 0) throw new Error(`küresel indeks yok: ${cache.regionId}#${i}`);
    map[i] = g; globalLat[g] = cache.lat[i]; globalLon[g] = cache.lon[i];
  }
  regionToGlobal.set(cache.regionId, map);
}
regionNodeIds.length = 0;
log('bölge→küresel eşleme kuruldu');

/* ── 2) Kenarlar ──────────────────────────────────────────────────────────
   Metrik KASITLI olarak en gevşektir: yalnız tek-yön. Dönüş/via-way/erişim
   cezaları UYGULANMAZ → üretilen mesafe gerçek maliyetin ALT sınırıdır. */
const edgeFrom = new Uint32Array(totalEdges);
const edgeTo = new Uint32Array(totalEdges);
const edgeCost = new Uint32Array(totalEdges);
const edgeOneway = new Uint8Array(totalEdges);
const backboneNode = new Uint8Array(unique);
let edgeCursor = 0, maxEdgeCost = 0, pass2 = 0;
for (const region of manifest.regions) {
  const view = readRegion(region);
  const map = regionToGlobal.get(region.regionId)!;
  for (let i = 0; i < view.edgeCount; i++) {
    const cost = view.edgeCostM[i];
    if (cost > maxEdgeCost) maxEdgeCost = cost;
    const from = map[view.edgeFrom[i]], to = map[view.edgeTo[i]];
    edgeFrom[edgeCursor] = from;
    edgeTo[edgeCursor] = to;
    edgeCost[edgeCursor] = cost;
    edgeOneway[edgeCursor] = edgeIsOneway(view, i) ? 1 : 0;
    edgeCursor++;
    /* Landmark aday havuzu: şehirlerarası omurga (1 motorway · 2 trunk · 3 primary). */
    if (view.edgeRoadClassV3[i] <= 3 && view.edgeRoadClassV3[i] >= 1) {
      backboneNode[from] = 1; backboneNode[to] = 1;
    }
  }
  if (++pass2 % 100 === 0) log(`geçiş 2: ${pass2}/${manifest.regions.length}`);
}
log(`geçiş 2 bitti: ${edgeCursor} kenar · en uzun kenar ${maxEdgeCost} m`);

/* ── 3) CSR (ileri ve geri) ──────────────────────────────────────────────── */
function buildCsr(reverse: boolean) {
  const counts = new Uint32Array(unique + 1);
  for (let i = 0; i < edgeCursor; i++) {
    const a = reverse ? edgeTo[i] : edgeFrom[i];
    const b = reverse ? edgeFrom[i] : edgeTo[i];
    counts[a]++;
    if (!edgeOneway[i]) counts[b]++;
  }
  const offsets = new Uint32Array(unique + 1);
  let acc = 0;
  for (let i = 0; i < unique; i++) { offsets[i] = acc; acc += counts[i]; }
  offsets[unique] = acc;
  const target = new Uint32Array(acc), cost = new Uint32Array(acc);
  const cursor = new Uint32Array(unique);
  for (let i = 0; i < edgeCursor; i++) {
    const a = reverse ? edgeTo[i] : edgeFrom[i];
    const b = reverse ? edgeFrom[i] : edgeTo[i];
    let slot = offsets[a] + cursor[a]++;
    target[slot] = b; cost[slot] = edgeCost[i];
    if (!edgeOneway[i]) { slot = offsets[b] + cursor[b]++; target[slot] = a; cost[slot] = edgeCost[i]; }
  }
  return { offsets, target, cost, halfEdges: acc };
}
const forward = buildCsr(false);
log(`ileri CSR: ${forward.halfEdges} yarım kenar`);
const backward = buildCsr(true);
log(`geri CSR: ${backward.halfEdges} yarım kenar`);

/* ── 4) Dijkstra (ikili yığın, tembel silme) ─────────────────────────────── */
const INF = 0xfffffffe;
const dist = new Uint32Array(unique);
let heapNode = new Uint32Array(1 << 16), heapKey = new Uint32Array(1 << 16);

function dijkstra(csr: { offsets: Uint32Array; target: Uint32Array; cost: Uint32Array }, source: number): number {
  dist.fill(INF);
  dist[source] = 0;
  let size = 0;
  const push = (node: number, key: number) => {
    if (size === heapNode.length) {
      const n2 = new Uint32Array(size * 2); n2.set(heapNode); heapNode = n2;
      const k2 = new Uint32Array(size * 2); k2.set(heapKey); heapKey = k2;
    }
    let i = size++;
    heapNode[i] = node; heapKey[i] = key;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapKey[p] <= heapKey[i]) break;
      const tn = heapNode[p], tk = heapKey[p];
      heapNode[p] = heapNode[i]; heapKey[p] = heapKey[i];
      heapNode[i] = tn; heapKey[i] = tk; i = p;
    }
  };
  push(source, 0);
  let settled = 0;
  while (size > 0) {
    const node = heapNode[0], key = heapKey[0];
    size--;
    if (size > 0) {
      heapNode[0] = heapNode[size]; heapKey[0] = heapKey[size];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < size && heapKey[l] < heapKey[s]) s = l;
        if (r < size && heapKey[r] < heapKey[s]) s = r;
        if (s === i) break;
        const tn = heapNode[s], tk = heapKey[s];
        heapNode[s] = heapNode[i]; heapKey[s] = heapKey[i];
        heapNode[i] = tn; heapKey[i] = tk; i = s;
      }
    }
    if (key > dist[node]) continue;                 // bayat yığın kaydı
    settled++;
    const end = csr.offsets[node + 1];
    for (let k = csr.offsets[node]; k < end; k++) {
      const to = csr.target[k], nd = key + csr.cost[k];
      if (nd < dist[to]) { dist[to] = nd; push(to, nd); }
    }
  }
  return settled;
}

/* ── 5) Landmark seçimi — DETERMİNİSTİK ──────────────────────────────────
   Yöntem: omurga kısıtlı en-uzak-nokta (farthest-point) örneklemesi.
   · Aday havuzu: motorway/trunk/primary kenarına dokunan düğümler. Gerekçe:
     izole bir düğüm landmark olursa mesafelerin çoğu ULAŞILAMAZ çıkar ve o
     landmark hiçbir sınır üretmez; omurga düğümü ülke çapında erişilebilirdir.
   · İlk landmark: aday havuzunun coğrafi uç noktası (en küçük lon, eşitlikte
     en küçük lat, eşitlikte en küçük OSM id) — rastgelelik YOK.
   · Sonraki her landmark: mevcut kümeye KUŞ UÇUŞU en uzak aday.
   Şehir adı sabitlenmez; seçim tamamen veriden gelir. */
const candidates: number[] = [];
for (let g = 0; g < unique; g++) if (backboneNode[g]) candidates.push(g);
log(`omurga aday düğümü: ${candidates.length}`);
if (candidates.length < LANDMARKS) throw new Error('ALT_INSUFFICIENT_BACKBONE_CANDIDATES');

const havM = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const rad = Math.PI / 180, dLa = (bLat - aLat) * rad, dLo = (bLon - aLon) * rad;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLo / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

let first = candidates[0];
for (const g of candidates) {
  if (globalLon[g] < globalLon[first]) { first = g; continue; }
  if (globalLon[g] > globalLon[first]) continue;
  if (globalLat[g] < globalLat[first]) { first = g; continue; }
  if (globalLat[g] > globalLat[first]) continue;
  if (globalIds[g] < globalIds[first]) first = g;
}
/* Aday SIRASI (en-uzak-nokta) üretilir; kabul kararı ERİŞİLEBİLİRLİK ÖLÇÜMÜYLE
   verilir. Ölçüldü: yalnız coğrafi uzaklığa bakan seçim, çıkışı olmayan bir uç
   düğümü landmark yapabiliyordu (ileri Dijkstra 1 düğüm çözdü → o landmark
   hiçbir sınır üretmez). Bu yüzden aday, ülke düğümlerinin en az yarısını
   ÇÖZEMİYORSA reddedilir ve sıradaki en uzak aday denenir. */
const ACCEPT_RATIO = 0.5;
const orderedCandidates: number[] = [first];
{
  const nearestM = new Float64Array(candidates.length).fill(Infinity);
  const wanted = Math.min(candidates.length, LANDMARKS * 4);
  while (orderedCandidates.length < wanted) {
    const last = orderedCandidates[orderedCandidates.length - 1];
    let bestIdx = -1, bestD = -1;
    for (let c = 0; c < candidates.length; c++) {
      const g = candidates[c];
      const d = havM(globalLat[g], globalLon[g], globalLat[last], globalLon[last]);
      if (d < nearestM[c]) nearestM[c] = d;
      if (nearestM[c] > bestD) { bestD = nearestM[c]; bestIdx = c; }
      else if (nearestM[c] === bestD && bestIdx >= 0 && globalIds[g] < globalIds[candidates[bestIdx]]) bestIdx = c;
    }
    if (bestIdx < 0) break;
    orderedCandidates.push(candidates[bestIdx]);
    nearestM[bestIdx] = -1;                        // aynı aday iki kez seçilmesin
  }
}
log(`aday sırası: ${orderedCandidates.length}`);

/* ── 6) Mesafeler ────────────────────────────────────────────────────────
   Landmark başına iki koşum: `d(L→v)` ileri CSR'de, `d(v→L)` geri CSR'de. */
const pack = (): Uint16Array => {
  const out = new Uint16Array(unique);
  for (let i = 0; i < unique; i++) {
    if (dist[i] >= INF) { out[i] = UNREACHABLE; continue; }
    const bucket = Math.floor(dist[i] / SCALE_M);   // AŞAĞI yuvarlama → sınır küçülür
    /* Taşma KIRPILMAZ, BİLİNMİYOR yazılır: kırpılmış bir `d(t→L)` sınırı fazla
       tahmin ettirebilir. Bilinmeyen terim sınıra hiç katılmaz → güvenli. */
    out[i] = bucket >= UNREACHABLE ? UNREACHABLE : bucket;
  }
  return out;
};
const fromL: Uint16Array[] = [], toL: Uint16Array[] = [];
const reach: { forward: number; backward: number }[] = [];
const landmarks: number[] = [];
const rejected: { nodeId: string; settledForward: number; settledBackward: number }[] = [];
const minSettled = Math.floor(unique * ACCEPT_RATIO);
for (const candidate of orderedCandidates) {
  if (landmarks.length >= LANDMARKS) break;
  const f = dijkstra(forward, candidate);
  if (f < minSettled) {
    rejected.push({ nodeId: String(globalIds[candidate]), settledForward: f, settledBackward: -1 });
    log(`aday ${globalIds[candidate]} REDDEDİLDİ · ileri ${f} < ${minSettled}`);
    continue;
  }
  const packedForward = pack();
  const b = dijkstra(backward, candidate);
  if (b < minSettled) {
    rejected.push({ nodeId: String(globalIds[candidate]), settledForward: f, settledBackward: b });
    log(`aday ${globalIds[candidate]} REDDEDİLDİ · geri ${b} < ${minSettled}`);
    continue;
  }
  fromL.push(packedForward);
  toL.push(pack());
  reach.push({ forward: f, backward: b });
  landmarks.push(candidate);
  log(`L${landmarks.length - 1} kabul · ileri ${f} · geri ${b}`);
}
if (landmarks.length === 0) throw new Error('ALT_NO_REACHABLE_LANDMARK');
log(`landmark kabul: ${landmarks.length} · reddedilen ${rejected.length}`);

/* ── 7) Bölgesel dilimler ────────────────────────────────────────────────
   Dilim, bölgenin KENDİ düğüm sırasındadır: çalışma zamanı ek eşleme yapmaz.
   Düzen: düğüm başına [d(L0→v), d(v→L0), d(L1→v), d(v→L1), …] — 2K Uint16. */
const sha = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex');
const K = landmarks.length;
const slices: { regionId: string; file: string; sha256: string; byteSize: number; nodeCount: number }[] = [];
mkdirSync(resolve(OUT, 'regions'), { recursive: true });
for (const region of manifest.regions) {
  const map = regionToGlobal.get(region.regionId)!;
  const n = map.length;
  const header = new Uint32Array(6);
  header[0] = ALT_MAGIC; header[1] = SCHEMA_VERSION; header[2] = K;
  header[3] = SCALE_M; header[4] = n; header[5] = UNREACHABLE;
  const body = new Uint16Array(n * K * 2);
  for (let i = 0; i < n; i++) {
    const g = map[i];
    for (let li = 0; li < K; li++) {
      body[(i * K + li) * 2] = fromL[li][g];
      body[(i * K + li) * 2 + 1] = toL[li][g];
    }
  }
  const bytes = Buffer.concat([Buffer.from(header.buffer), Buffer.from(body.buffer)]);
  const file = `regions/${region.regionId}.alt`;
  writeFileSync(resolve(OUT, file), bytes);
  slices.push({ regionId: region.regionId, file, sha256: sha(bytes), byteSize: bytes.byteLength, nodeCount: n });
}
log(`dilimler yazıldı: ${slices.length}`);

/* ── 8) ALT manifesti (köken kanıtı + fail-closed bağları) ───────────────── */
const altManifest = {
  schemaVersion: SCHEMA_VERSION,
  kind: 'RTG4_ALT_LANDMARKS',
  datasetId: manifest.datasetId,
  graphPolicyVersion: manifest.policyVersion,
  graphManifestSha256: sha(readFileSync(manifestPath)),
  buildTimestamp: new Date().toISOString(),
  landmarkCount: K,
  scaleM: SCALE_M,
  unreachableBucket: UNREACHABLE,
  metric: 'ONEWAY_ONLY_BASE_COST_M',
  metricContract:
    'Ön işleme metriği yalnız tek-yön uygular; dönüş yasağı, via-way zinciri ve ' +
    'destination-only cezası UYGULANMAZ. Kanonik A* maliyeti bu metrikten küçük ' +
    'olamaz → üretilen sınır fazla tahmin etmez (kabul edilebilir).',
  selection: 'BACKBONE_CONSTRAINED_FARTHEST_POINT_REACHABILITY_VERIFIED',
  acceptRatio: ACCEPT_RATIO,
  rejectedCandidates: rejected,
  globalNodeCount: unique,
  landmarks: landmarks.map((g, i) => ({
    index: i, nodeId: String(globalIds[g]), lat: globalLat[g], lon: globalLon[g],
    settledForward: reach[i].forward, settledBackward: reach[i].backward,
  })),
  slices,
};
writeFileSync(resolve(OUT, 'turkey-alt-manifest.json'), JSON.stringify(altManifest, null, 2));
log(`ALT manifesti yazıldı · toplam dilim baytı ${slices.reduce((a, s) => a + s.byteSize, 0)}`);
