/**
 * verify-routing-graph.mjs — üretilen `routing-graph.bin` GERÇEKTEN rota
 * üretiyor mu? (build-zamanı doğrulama · ürün kodundan import EDİLMEZ)
 *
 * ── NEDEN AYRI BİR DOĞRULAYICI ──────────────────────────────────────────────
 * "Dosya üretildi ve boyutu makul" bir yetenek KANITI DEĞİLDİR. Grafik topolojik
 * olarak kopuk olabilir (kavşaklar birleşmemiş), tek-yön bayrakları ters
 * olabilir, maliyet birimi yanlış olabilir — hepsi sessizce "rota bulunamadı"
 * ya da saçma mesafe üretir. Bu script worker'ın YAPTIĞI İŞİ (parse + A*) aynı
 * sözleşmeyle tekrarlar ve BİLİNEN şehir çiftlerinde ölçer.
 *
 * ⚠️ Bu bir KOPYA implementasyondur ve VERİYİ doğrular, worker'ı değil.
 * Worker'ın kendi davranışı `src/__tests__` altındaki birim testlerle kilitlenir.
 *
 * Kullanım:
 *   node scripts/verify-routing-graph.mjs [--graph public/maps/routing-graph.bin]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GRAPH_MAGIC_V2 = 0x32475452;

/* Worker ile BİREBİR aynı olmalı (NavigationCompute.worker.ts HEURISTIC_WEIGHT).
   Doğrulayıcı gerçek arama bütçesini sınamazsa yeşil vermesi ANLAMSIZDIR. */
const HEURISTIC_WEIGHT = 1.2;

/* Worker ile BİREBİR aynı tablo (NavigationCompute.worker.ts). */
const ROAD_CLASS_SPEED_MS = [
  30 / 3.6, 110 / 3.6, 85 / 3.6, 65 / 3.6,
  50 / 3.6, 40 / 3.6, 30 / 3.6, 45 / 3.6,
];

/** Gerçek şehir çiftleri — kabaca beklenen karayolu mesafesiyle. */
const CASES = [
  { name: 'Konya → Tarsus',      from: [37.8746, 32.4932], to: [36.9177, 34.8953], expectKmMin: 280, expectKmMax: 420 },
  { name: 'Ankara → İstanbul',   from: [39.9334, 32.8597], to: [41.0082, 28.9784], expectKmMin: 400, expectKmMax: 560 },
  { name: 'İzmir → Aydın',       from: [38.4237, 27.1428], to: [37.8560, 27.8416], expectKmMin:  95, expectKmMax: 170 },
  { name: 'Adana → Gaziantep',   from: [37.0000, 35.3213], to: [37.0662, 37.3833], expectKmMin: 180, expectKmMax: 280 },
  { name: 'Bursa → Balıkesir',   from: [40.1885, 29.0610], to: [39.6484, 27.8826], expectKmMin: 110, expectKmMax: 200 },
];

function havM(la1, lo1, la2, lo2) {
  const R = 6_371_000;
  const dLa = (la2 - la1) * (Math.PI / 180);
  const dLo = (lo2 - lo1) * (Math.PI / 180);
  const a = Math.sin(dLa / 2) ** 2
    + Math.cos(la1 * (Math.PI / 180)) * Math.cos(la2 * (Math.PI / 180)) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function loadGraph(path) {
  const buf = readFileSync(path);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 0;
  const magic = view.getUint32(off, true); off += 4;
  if (magic !== GRAPH_MAGIC_V2) throw new Error(`RTG2 sihirli sayısı yok (0x${magic.toString(16)})`);
  const nodeCount = view.getUint32(off, true); off += 4;

  const lat = new Float32Array(nodeCount);
  const lon = new Float32Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    lat[i] = view.getFloat32(off, true); off += 4;
    lon[i] = view.getFloat32(off, true); off += 4;
    off += 8;
  }

  const edgeCount = view.getUint32(off, true); off += 4;
  const adjacency = new Map();
  let onewayCount = 0;
  const classHist = new Array(8).fill(0);

  for (let i = 0; i < edgeCount; i++) {
    const from = view.getUint32(off, true); off += 4;
    const to = view.getUint32(off, true); off += 4;
    const costM = view.getUint32(off, true); off += 4;
    const flags = view.getUint8(off++);
    const oneway = (flags & 0x01) === 1;
    const roadClass = (flags >> 1) & 0x07;
    if (oneway) onewayCount++;
    classHist[roadClass]++;

    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ to, costM, roadClass });
    if (!oneway) {
      if (!adjacency.has(to)) adjacency.set(to, []);
      adjacency.get(to).push({ to: from, costM, roadClass });
    }
  }
  return { lat, lon, nodeCount, edgeCount, adjacency, onewayCount, classHist };
}

function nearest(g, la, lo) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < g.nodeCount; i++) {
    const d = havM(la, lo, g.lat[i], g.lon[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { idx: best, distM: bestD };
}

/** Worker ile aynı A* (binary min-heap + haversine sezgisel). */
function aStar(g, startIdx, goalIdx, maxClosed) {
  const heap = [[0, startIdx]];
  const gCost = new Map([[startIdx, 0]]);
  const prev = new Map();
  const closed = new Set();

  const push = (it) => {
    heap.push(it);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    if (!heap.length) return undefined;
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2; let s = i;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]]; i = s;
      }
    }
    return top;
  };

  while (heap.length) {
    const e = pop(); if (!e) break;
    const cur = e[1];
    if (cur === goalIdx) {
      const path = []; let n = goalIdx;
      while (n !== undefined) { path.unshift(n); n = prev.get(n); }
      return { path, closed: closed.size };
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    if (closed.size > maxClosed) return { path: null, closed: closed.size, exhausted: true };

    const curG = gCost.get(cur) ?? Infinity;
    for (const { to, costM } of (g.adjacency.get(cur) ?? [])) {
      if (closed.has(to)) continue;
      const ng = curG + costM;
      if (ng < (gCost.get(to) ?? Infinity)) {
        gCost.set(to, ng); prev.set(to, cur);
        push([ng + HEURISTIC_WEIGHT * havM(g.lat[to], g.lon[to], g.lat[goalIdx], g.lon[goalIdx]), to]);
      }
    }
  }
  return { path: null, closed: closed.size, exhausted: false };
}

function main() {
  const gi = process.argv.indexOf('--graph');
  const path = resolve(gi >= 0 ? process.argv[gi + 1] : 'public/maps/routing-graph.bin');

  console.log(`Grafik: ${path}`);
  const g = loadGraph(path);
  const names = ['UNKNOWN', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'link'];
  console.log(`Düğüm: ${g.nodeCount.toLocaleString('tr-TR')} · Kenar: ${g.edgeCount.toLocaleString('tr-TR')} · tek yön: ${g.onewayCount.toLocaleString('tr-TR')}`);
  console.log('Sınıf dağılımı: ' + g.classHist.map((n, i) => n ? `${names[i]}=${n.toLocaleString('tr-TR')}` : null).filter(Boolean).join(' · '));

  if (g.classHist[0] === g.edgeCount) {
    console.error('\nHATA: hiçbir kenarda yol sınıfı yok — ETA sabit hıza düşer (uydurma süre riski).');
    process.exit(3);
  }

  /* Düşük-uç cihazın RAM koruması: worker `deviceMemory<=1` iken 30.000 kapatır. */
  const MAX_CLOSED_LOWEND = 30_000;
  let failed = 0;

  console.log('\nRota denemeleri (düşük-uç bütçesi: MAX_CLOSED=30.000):');
  for (const c of CASES) {
    const s = nearest(g, c.from[0], c.from[1]);
    const t = nearest(g, c.to[0], c.to[1]);
    const t0 = Date.now();
    const r = aStar(g, s.idx, t.idx, MAX_CLOSED_LOWEND);
    const ms = Date.now() - t0;

    if (!r.path) {
      console.log(`  ✗ ${c.name}: ROTA YOK (kapatılan ${r.closed.toLocaleString('tr-TR')}${r.exhausted ? ' — TAVAN' : ''}, ${ms} ms)`);
      failed++; continue;
    }

    let distM = 0, durS = 0;
    for (let i = 1; i < r.path.length; i++) {
      const e = (g.adjacency.get(r.path[i - 1]) ?? []).find(x => x.to === r.path[i]);
      if (e) { distM += e.costM; durS += e.costM / (ROAD_CLASS_SPEED_MS[e.roadClass] || ROAD_CLASS_SPEED_MS[0]); }
    }
    const km = distM / 1000;
    const ok = km >= c.expectKmMin && km <= c.expectKmMax;
    if (!ok) failed++;
    console.log(
      `  ${ok ? '✓' : '✗'} ${c.name}: ${km.toFixed(0)} km · ${(durS / 3600).toFixed(1)} sa · ` +
      `${r.path.length.toLocaleString('tr-TR')} düğüm · kapatılan ${r.closed.toLocaleString('tr-TR')} · ${ms} ms ` +
      `(beklenen ${c.expectKmMin}–${c.expectKmMax} km · en yakın düğüm ${(s.distM / 1000).toFixed(1)}/${(t.distM / 1000).toFixed(1)} km)`,
    );
  }

  if (failed) {
    console.error(`\nDOĞRULAMA DÜŞTÜ: ${failed}/${CASES.length} deneme başarısız.`);
    process.exit(3);
  }
  console.log(`\nDOĞRULAMA GEÇTİ: ${CASES.length}/${CASES.length}`);
}

main();
