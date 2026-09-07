/**
 * build-routing-graph.mjs — OSM `.osm.pbf` → `public/maps/routing-graph.bin` (RTG2).
 *
 * ── NEDEN VAR (V-05) ────────────────────────────────────────────────────────
 * `NavigationCompute.worker.ts` içindeki A* motoru (binary min-heap, testli)
 * YAZILI ama VERİSİ HİÇ VAR OLMAMIŞTI: `/maps/routing-graph.bin` 404 dönüyor,
 * worker `_graphFailed = true` ile KALICI olarak pes ediyor ve her çevrimdışı
 * rota isteği `straightLineRoute()`e (kuş uçuşu) düşüyordu. Kod bunu dürüstçe
 * `STRAIGHT_LINE_GUIDANCE` diye etiketliyordu — dürüstlük ✅, yetenek ❌.
 * Bu script o veriyi üretir.
 *
 * ── FORMAT (worker'ın BEKLEDİĞİ — burada TEK KAYNAK) ────────────────────────
 *   u32  magic = 0x32475452 ('RTG2', LE)
 *   u32  nodeCount
 *   nodeCount ×  { f32 lat · f32 lon · 8 bayt ayrılmış }        (16 bayt)
 *   u32  edgeCount
 *   edgeCount ×  { u32 from · u32 to · u32 costM · u8 flags }   (13 bayt)
 *
 * `costM` METREDİR — A* sezgiseli haversine metre döndürür; birim uyuşmazlığı
 * aramayı sessizce bozar (bkz. `_aStar`: `newG + _havM(...)`).
 *
 * ── FLAGS BAYTI: bit 0 ONEWAY, bit 1-3 YOL SINIFI (bu turda eklendi) ────────
 * V2 yalnız bit 0'ı kullanıyordu; kalan 7 bit BOŞTU. Worker'daki yorum aynen
 * şunu istiyordu: *"graph binary formatı yol-sınıfı/hız-limiti taşımaz → ETA
 * mümkün değil; sabit 30 km/h kullanılır (#14). Yol sınıfı verisi eklenirse
 * hız buradan türetilmeli."*
 *
 * Sabit 30 km/h Türkiye çapında bir otoyol rotasında 350 km'yi **11,7 saat**
 * gösterirdi — bu UYDURMA SÜREDİR. Bu yüzden sınıf bit 1-3'e yazılır:
 *
 *   0 UNKNOWN · 1 motorway · 2 trunk · 3 primary · 4 secondary
 *   5 tertiary · 6 residential · 7 link/other
 *
 * GERİYE UYUMLU: eski grafiklerde bu bitler 0'dır → `UNKNOWN` → worker eski
 * sabit hıza düşer. Yeni bir sürüm numarası GEREKMEZ.
 *
 * ── KAPSAM KARARI ──────────────────────────────────────────────────────────
 * Varsayılan kapsam tertiary/unclassified/residential/living_street içerir.
 * `service` yalnız politika tarafından güvenli bulunan public türleri için
 * ayrıca istenir; driveway gibi destination-only yollar RTG2 rol biti
 * olmadığı için transit edge olarak sessizce terfi ettirilmez.
 *
 * ── A* BÜTÇESİ İLE ÇELİŞKİ (format kaynaklı, burada YÖNETİLİR) ──────────────
 * RTG2 kenar başına POLİLİNE TAŞIMAZ; rota geometrisi düğüm zincirinin
 * kendisidir. Bu yüzden ara geometri düğümleri hem ŞEKLİ hem A* arama uzayını
 * belirler. Worker'ın RAM koruması düşük-uçta `MAX_CLOSED = 30_000`'dir; 350 km
 * bir rotayı 15 m çözünürlükle taşımak tek başına ~23.000 düğüm eder ve arama
 * ZATEN tavana çarpar. Bu yüzden ara düğümler Douglas-Peucker ile
 * `--simplify` (varsayılan 100 m) toleransıyla seyreltilir; KAVŞAK düğümleri
 * (≥2 yolda geçen) ASLA atılmaz — topoloji korunur.
 * MESAFE KAYBI YOKTUR: `costM` seyreltmeden ÖNCEKİ tam poliline üzerinden
 * toplanır, yani kısaltılmış zincir gerçek yol uzunluğunu taşır.
 *
 * ── LİSANS (ZORUNLU) ────────────────────────────────────────────────────────
 * Kaynak OpenStreetMap'tir → **ODbL**. Üretilen dosyanın yanına
 * `routing-graph.license.txt` yazılır ve uygulama "© OpenStreetMap katkıcıları"
 * atıfını GÖSTERMEK ZORUNDADIR (CLAUDE.md §Ticari Lisans).
 *
 * ── KULLANIM ────────────────────────────────────────────────────────────────
 *   node --max-old-space-size=6144 scripts/build-routing-graph.mjs \
 *        --in <turkey.osm.pbf> [--out public/maps/routing-graph.bin]
 *        [--simplify 100] [--classes motorway,trunk,primary,secondary,tertiary,residential]
 *
 * Bu script BUILD ZAMANI çalışır; ürün kodundan ASLA import edilmez.
 */

import { createReadStream, createWriteStream, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import Pbf from 'pbf';
import { DEFAULT_GRAPH_CLASSES, classifyDrivableWay, onewaySemantics } from './routingGraphPolicy.mjs';

/* ── Sabitler ────────────────────────────────────────────────────────────── */

const GRAPH_MAGIC_V2 = 0x32475452; // 'RTG2' LE — worker ile BİREBİR aynı olmalı

/** Yol sınıfı → flags bit 1-3 değeri. Worker aynı tabloyu kullanır. */
export const ROAD_CLASS = Object.freeze({
  unknown:     0,
  motorway:    1,
  trunk:       2,
  primary:     3,
  secondary:   4,
  tertiary:    5,
  residential: 6,
  link:        7,
});

/** Varsayılan kapsam — bkz. başlıktaki kapsam kararı. */
const DEFAULT_CLASSES = DEFAULT_GRAPH_CLASSES;

/* ── Argümanlar ──────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = {
    in: null,
    out: 'public/maps/routing-graph.bin',
    simplify: 100,
    classes: DEFAULT_CLASSES.slice(),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in')        out.in = argv[++i];
    else if (a === '--out')  out.out = argv[++i];
    else if (a === '--simplify') out.simplify = Number(argv[++i]);
    else if (a === '--classes')  out.classes = String(argv[++i]).split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (!out.in) {
    console.error('HATA: --in <dosya.osm.pbf> zorunlu.');
    process.exit(2);
  }
  if (!Number.isFinite(out.simplify) || out.simplify < 0) {
    console.error('HATA: --simplify negatif olamaz.');
    process.exit(2);
  }
  return out;
}

/* ── Coğrafya ────────────────────────────────────────────────────────────── */

const R_EARTH = 6_371_000;

function havM(la1, lo1, la2, lo2) {
  const dLa = (la2 - la1) * (Math.PI / 180);
  const dLo = (lo2 - lo1) * (Math.PI / 180);
  const a = Math.sin(dLa / 2) ** 2
    + Math.cos(la1 * (Math.PI / 180)) * Math.cos(la2 * (Math.PI / 180)) * Math.sin(dLo / 2) ** 2;
  return R_EARTH * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Noktanın A–B doğru parçasına dik mesafesi (metre, küçük ölçekte düzlem kabulü). */
function perpDistM(pLat, pLon, aLat, aLon, bLat, bLon) {
  const kx = Math.cos(((aLat + bLat) / 2) * (Math.PI / 180)) * 111_320;
  const ky = 110_540;
  const ax = aLon * kx, ay = aLat * ky;
  const bx = bLon * kx, by = bLat * ky;
  const px = pLon * kx, py = pLat * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Douglas-Peucker — KORUNMASI ZORUNLU indeksler (`keep`) asla atılmaz.
 * Dönen dizi, girdideki indekslerin artan alt kümesidir.
 */
function simplifyIndices(lats, lons, tolM, keepSet) {
  const n = lats.length;
  if (n <= 2 || tolM <= 0) return [...Array(n).keys()];
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[n - 1] = 1;
  for (const i of keepSet) if (i > 0 && i < n - 1) keep[i] = 1;

  /* Korunan noktalar zinciri parçalara böler; her parça kendi içinde sadeleşir. */
  const anchors = [];
  for (let i = 0; i < n; i++) if (keep[i]) anchors.push(i);

  const stack = [];
  for (let s = 0; s < anchors.length - 1; s++) stack.push([anchors[s], anchors[s + 1]]);

  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    let maxD = -1, maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const d = perpDistM(lats[i], lons[i], lats[a], lons[a], lats[b], lons[b]);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tolM && maxI > 0) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }

  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/* ── PBF blok okuyucu ────────────────────────────────────────────────────── */

/**
 * `.osm.pbf` çerçevelemesi: [int32 BE headerLen][BlobHeader][Blob].
 * Akıştan okur, her OSMData bloğunu açıp `onBlock(PrimitiveBlock buffer)` çağırır.
 */
async function forEachBlock(path, onBlock) {
  const stream = createReadStream(path, { highWaterMark: 1 << 22 });
  let buf = Buffer.alloc(0);
  let pending = null; // { headerLen } | { header, dataLen }

  const readBlobHeader = (b) => {
    const p = new Pbf(b);
    const h = { type: '', datasize: 0 };
    p.readFields((tag, o, pb) => {
      if (tag === 1) o.type = pb.readString();
      else if (tag === 3) o.datasize = pb.readVarint();
    }, h);
    return h;
  };

  const readBlob = (b) => {
    const p = new Pbf(b);
    const o = { raw: null, zlib: null };
    p.readFields((tag, x, pb) => {
      if (tag === 1) x.raw = Buffer.from(pb.readBytes());
      else if (tag === 3) x.zlib = Buffer.from(pb.readBytes());
    }, o);
    if (o.raw) return o.raw;
    if (o.zlib) return inflateSync(o.zlib);
    return null;
  };

  for await (const chunk of stream) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (!pending) {
        if (buf.length < 4) break;
        const headerLen = buf.readInt32BE(0);
        if (buf.length < 4 + headerLen) break;
        const header = readBlobHeader(buf.subarray(4, 4 + headerLen));
        buf = buf.subarray(4 + headerLen);
        pending = header;
        continue;
      }
      if (buf.length < pending.datasize) break;
      const blobBuf = buf.subarray(0, pending.datasize);
      buf = buf.subarray(pending.datasize);
      const type = pending.type;
      pending = null;
      if (type === 'OSMData') {
        const inflated = readBlob(blobBuf);
        if (inflated) await onBlock(inflated);
      }
    }
  }
}

/** PrimitiveBlock → { stringtable, groups, granularity, latOff, lonOff } */
function readPrimitiveBlock(buf) {
  const p = new Pbf(buf);
  const blk = { st: [], groups: [], granularity: 100, latOff: 0, lonOff: 0 };
  p.readFields((tag, o, pb) => {
    if (tag === 1) {
      const end = pb.readVarint() + pb.pos;
      pb.readFields((t2, oo, p2) => {
        if (t2 === 1) oo.st.push(p2.readBytes());
      }, o, end);
    } else if (tag === 2) {
      /* SIRA KRİTİK: uzunluk varint'i ÖNCE okunmalı. `{ start: pb.pos, end:
         pb.readVarint() + pb.pos }` yazımı JS soldan-sağa değerlendirdiği için
         `start`i varint'in ÜZERİNE koyar; sonra o varint alan-anahtarı sanılıp
         tüm blok çöpe döner (ilk koşumda "0 yol görüldü" bunun kanıtıydı). */
      const len = pb.readVarint();
      const start = pb.pos;
      o.groups.push({ start, end: start + len });
      pb.pos = start + len;
    } else if (tag === 17) o.granularity = pb.readVarint();
    else if (tag === 19) o.latOff = pb.readVarint();
    else if (tag === 20) o.lonOff = pb.readVarint();
  }, blk);
  blk.buf = buf;
  return blk;
}

const dec = new TextDecoder();
const stStr = (blk, i) => (i >= 0 && i < blk.st.length ? dec.decode(blk.st[i]) : '');

/** Bir PrimitiveGroup içindeki WAY'leri gezer. */
function forEachWay(blk, g, cb) {
  const p = new Pbf(blk.buf);
  p.pos = g.start;
  p.readFields((tag, _o, pb) => {
    if (tag !== 3) return;
    const end = pb.readVarint() + pb.pos;
    const w = { keys: [], vals: [], refs: [] };
    pb.readFields((t2, o2, p2) => {
      if (t2 === 2) o2.keys = p2.readPackedVarint();
      else if (t2 === 3) o2.vals = p2.readPackedVarint();
      else if (t2 === 8) o2.refs = p2.readPackedSVarint();
    }, w, end);
    cb(w);
  }, null, g.end);
}

/** Bir PrimitiveGroup içindeki DENSE node'ları gezer (id/lat/lon delta çözülmüş). */
function forEachDenseNode(blk, g, cb) {
  const p = new Pbf(blk.buf);
  p.pos = g.start;
  p.readFields((tag, _o, pb) => {
    if (tag !== 2) return;
    const end = pb.readVarint() + pb.pos;
    const d = { id: [], lat: [], lon: [] };
    pb.readFields((t2, o2, p2) => {
      if (t2 === 1) o2.id = p2.readPackedSVarint();
      else if (t2 === 8) o2.lat = p2.readPackedSVarint();
      else if (t2 === 9) o2.lon = p2.readPackedSVarint();
    }, d, end);

    let id = 0, lat = 0, lon = 0;
    const gr = blk.granularity, la0 = blk.latOff, lo0 = blk.lonOff;
    for (let i = 0; i < d.id.length; i++) {
      id += d.id[i]; lat += d.lat[i]; lon += d.lon[i];
      cb(id, (la0 + gr * lat) / 1e9, (lo0 + gr * lon) / 1e9);
    }
  }, null, g.end);
}

/* ── Etiket yorumu ───────────────────────────────────────────────────────── */

function classIdOf(highway, allowed) {
  if (!highway) return null;
  const isLink = highway.endsWith('_link');
  const base = isLink ? highway.slice(0, -5) : highway;
  if (!allowed.has(base)) return null;
  if (isLink) return ROAD_CLASS.link;
  if (base === 'unclassified' || base === 'living_street') return ROAD_CLASS.residential;
  if (base === 'service' || base === 'road' || base === 'track') return ROAD_CLASS.link;
  return ROAD_CLASS[base] ?? ROAD_CLASS.unknown;
}

/** OSM `oneway` etiketi → {oneway, reversed}. `-1` ters yön demektir. */
function onewayOf(v, highway) {
  return onewaySemantics(v, highway);
}

/* ── Ana akış ────────────────────────────────────────────────────────────── */

async function main() {
  const args = parseArgs(process.argv);
  const allowed = new Set(args.classes);
  const inPath = resolve(args.in);
  const outPath = resolve(args.out);

  const srcSize = statSync(inPath).size;
  console.log(`[1/5] Kaynak: ${inPath} (${(srcSize / 1048576).toFixed(0)} MB)`);
  console.log(`      Sınıflar: ${[...allowed].join(', ')} · sadeleştirme: ${args.simplify} m`);

  /* ── GEÇİŞ 1: yolları topla, düğüm kullanım sayısını çıkar ── */
  const ways = [];              // { cls, oneway, reversed, refs:Float64Array }
  const useCount = new Map();   // nodeId → kaç yolda geçti (kavşak tespiti)
  let wayScanned = 0;

  await forEachBlock(inPath, (buf) => {
    const blk = readPrimitiveBlock(buf);
    for (const g of blk.groups) {
      forEachWay(blk, g, (w) => {
        wayScanned++;
        let highway = null, onewayTag = null;
        for (let i = 0; i < w.keys.length; i++) {
          const k = stStr(blk, w.keys[i]);
          if (k === 'highway') highway = stStr(blk, w.vals[i]);
          else if (k === 'oneway') onewayTag = stStr(blk, w.vals[i]);
        }
        const tags = {};
        for (let i = 0; i < w.keys.length; i++) tags[stStr(blk, w.keys[i])] = stStr(blk, w.vals[i]);
        const decision = classifyDrivableWay(tags, allowed);
        const cls = decision ? classIdOf(highway, allowed) : null;
        if (cls === null || w.refs.length < 2) return;

        const refs = new Float64Array(w.refs.length);
        let acc = 0;
        for (let i = 0; i < w.refs.length; i++) { acc += w.refs[i]; refs[i] = acc; }

        const ow = onewayOf(onewayTag, highway);
        ways.push({ cls, oneway: ow.oneway, reversed: ow.reversed, refs });

        for (let i = 0; i < refs.length; i++) {
          useCount.set(refs[i], (useCount.get(refs[i]) ?? 0) + 1);
        }
      });
    }
  });

  console.log(`[2/5] Yol taraması bitti: ${wayScanned.toLocaleString('tr-TR')} yol görüldü · ${ways.length.toLocaleString('tr-TR')} seçildi`);
  if (ways.length === 0) {
    console.error('HATA: seçilen sınıflarda hiç yol bulunamadı — kaynak veya --classes yanlış.');
    process.exit(3);
  }

  /* Gerekli düğüm kimlikleri: SIRALI tipli dizi (Set bellek yerdi). */
  const needed = new Float64Array(useCount.size);
  { let i = 0; for (const id of useCount.keys()) needed[i++] = id; }
  needed.sort();
  console.log(`      Gerekli düğüm: ${needed.length.toLocaleString('tr-TR')}`);

  const idxOf = (id) => {
    let lo = 0, hi = needed.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = needed[mid];
      if (v === id) return mid;
      if (v < id) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  };

  /* ── GEÇİŞ 2: yalnız gereken düğümlerin koordinatları ── */
  const nLat = new Float64Array(needed.length).fill(NaN);
  const nLon = new Float64Array(needed.length).fill(NaN);
  let found = 0;

  await forEachBlock(inPath, (buf) => {
    const blk = readPrimitiveBlock(buf);
    for (const g of blk.groups) {
      forEachDenseNode(blk, g, (id, lat, lon) => {
        const i = idxOf(id);
        if (i >= 0 && Number.isNaN(nLat[i])) { nLat[i] = lat; nLon[i] = lon; found++; }
      });
    }
  });

  console.log(`[3/5] Koordinat çözümü: ${found.toLocaleString('tr-TR')}/${needed.length.toLocaleString('tr-TR')}`);
  if (found === 0) {
    console.error('HATA: hiçbir düğüm koordinatı çözülemedi.');
    process.exit(3);
  }

  /* ── Grafik kurulumu: sadeleştir, kenar üret ── */
  const outIdx = new Int32Array(needed.length).fill(-1); // needed idx → grafik idx
  const gLat = [], gLon = [];
  const edges = [];  // { from, to, costM, flags }
  let droppedNodes = 0;

  const graphIdx = (nIdx) => {
    if (outIdx[nIdx] >= 0) return outIdx[nIdx];
    const gi = gLat.length;
    gLat.push(nLat[nIdx]); gLon.push(nLon[nIdx]);
    outIdx[nIdx] = gi;
    return gi;
  };

  for (const w of ways) {
    /* Koordinatı çözülmüş düğümleri sırayla topla. */
    const idxs = [], lats = [], lons = [];
    for (let i = 0; i < w.refs.length; i++) {
      const ni = idxOf(w.refs[i]);
      if (ni < 0 || Number.isNaN(nLat[ni])) continue;   // eksik düğüm → atla
      idxs.push(ni); lats.push(nLat[ni]); lons.push(nLon[ni]);
    }
    if (idxs.length < 2) continue;

    /* KAVŞAKLAR korunur: birden çok yolda geçen düğüm ASLA atılmaz. */
    const keepSet = [];
    for (let i = 0; i < idxs.length; i++) {
      if ((useCount.get(needed[idxs[i]]) ?? 0) > 1) keepSet.push(i);
    }

    const kept = simplifyIndices(lats, lons, args.simplify, keepSet);
    droppedNodes += idxs.length - kept.length;

    for (let s = 0; s < kept.length - 1; s++) {
      const a = kept[s], b = kept[s + 1];
      /* MESAFE SEYRELTMEDEN ETKİLENMEZ: maliyet TAM poliline üzerinden toplanır. */
      let costM = 0;
      for (let i = a; i < b; i++) costM += havM(lats[i], lons[i], lats[i + 1], lons[i + 1]);
      if (!(costM > 0)) continue;

      const fromN = idxs[a], toN = idxs[b];
      let from = graphIdx(fromN), to = graphIdx(toN);
      if (w.reversed) { const t = from; from = to; to = t; }

      const flags = (w.oneway ? 1 : 0) | ((w.cls & 0x07) << 1);
      edges.push({ from, to, costM: Math.min(0xFFFFFFFF, Math.round(costM)), flags });
    }
  }

  console.log(`[4/5] Grafik: ${gLat.length.toLocaleString('tr-TR')} düğüm · ${edges.length.toLocaleString('tr-TR')} kenar · sadeleştirmede atılan ${droppedNodes.toLocaleString('tr-TR')} ara düğüm`);
  if (gLat.length === 0 || edges.length === 0) {
    console.error('HATA: boş grafik üretildi.');
    process.exit(3);
  }
  if (gLat.length > 0xFFFFFFFF) {
    console.error('HATA: düğüm sayısı u32 sınırını aşıyor.');
    process.exit(3);
  }

  /* ── Binary yazımı ── */
  const size = 4 + 4 + gLat.length * 16 + 4 + edges.length * 13;
  const out = Buffer.alloc(size);
  let off = 0;
  out.writeUInt32LE(GRAPH_MAGIC_V2, off); off += 4;
  out.writeUInt32LE(gLat.length, off); off += 4;
  for (let i = 0; i < gLat.length; i++) {
    out.writeFloatLE(gLat[i], off); off += 4;
    out.writeFloatLE(gLon[i], off); off += 4;
    off += 8; // ayrılmış (sıfır)
  }
  out.writeUInt32LE(edges.length, off); off += 4;
  for (const e of edges) {
    out.writeUInt32LE(e.from, off); off += 4;
    out.writeUInt32LE(e.to, off); off += 4;
    out.writeUInt32LE(e.costM, off); off += 4;
    out.writeUInt8(e.flags, off); off += 1;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, out);

  /* ODbL atıfı — ZORUNLU (CLAUDE.md §Ticari Lisans). */
  writeFileSync(
    resolve(dirname(outPath), 'routing-graph.license.txt'),
    [
      'routing-graph.bin — çevrimdışı yönlendirme grafiği',
      '',
      'Kaynak veri: OpenStreetMap (https://www.openstreetmap.org)',
      'Lisans: Open Database License (ODbL) v1.0',
      '        https://opendatacommons.org/licenses/odbl/1-0/',
      '',
      'ZORUNLU ATIF: uygulama "© OpenStreetMap katkıcıları" ibaresini',
      'kullanıcıya GÖSTERMEK zorundadır. Bu dosyayı silmeyin.',
      '',
      `Üretim: scripts/build-routing-graph.mjs · sınıflar: ${[...allowed].join(', ')} · sadeleştirme: ${args.simplify} m`,
    ].join('\n'),
    'utf8',
  );

  console.log(`[5/5] Yazıldı: ${outPath} (${(size / 1048576).toFixed(2)} MB)`);
  console.log(`      Lisans dosyası: ${resolve(dirname(outPath), 'routing-graph.license.txt')}`);
}

main().catch((e) => {
  console.error('ÜRETİM DÜŞTÜ:', e?.stack || e);
  process.exit(1);
});
