/**
 * MAPDATA — ML FOOTPRINT DOĞRULUK ÖRNEKLEMİ · kör kontak sayfası üreticisi.
 *
 * SALT OKUNUR ölçüm. Üretim kodunu DEĞİŞTİRMEZ; yalnız bu klasöre yazar.
 *
 * NE YAPAR
 *  1. Tarsus yakın alanı için Esri World Imagery z18 mozaiği indirir
 *     (ölçüm amaçlı; provenance + SHA-256 kaydedilir).
 *  2. `src/__tests__/fixtures/mapdataTarsusNear.json` içindeki GERÇEK Overture
 *     footprint'lerini iki gruba ayırır: ML kökenli (OSM record_id YOK) ve
 *     OSM kökenli (kontrol grubu).
 *  3. Deterministik tohumlu karıştırmayla N_ML + N_OSM örnek seçer, sırayı
 *     KARIŞTIRIR ve 1..N numaralı hücrelerden oluşan tek bir kontak sayfası
 *     (PNG) üretir. Her hücrede uydu görüntüsü + footprint dış çizgisi vardır.
 *  4. Hücre → gerçek kimlik/köken eşlemesini AYRI bir dosyaya yazar
 *     (`sample-key.json`). Değerlendirme KÖR yapılabilsin diye konsola
 *     BASILMAZ.
 *
 * NEDEN KÖR: "bu ML footprint'i doğru mu" sorusunu, kaynağını bilerek
 * yanıtlamak yanlılık üretir. Kontrol grubu (insan çizimi OSM footprint'leri)
 * aynı sayfada, ayırt edilemez biçimde durur; ML grubunun hata oranı ancak
 * kontrol grubunun hata oranıyla KIYASLANARAK anlam kazanır.
 *
 * SINIR: Esri World Imagery bu konumda z18'e kadar gerçek görüntü sağlar
 * (z19/z20 boş döndü → 2521 B placeholder). Çözünürlük ~0,48 m/px.
 * Görüntünün TARİHİ bilinmiyor; footprint ile görüntü arasındaki uyuşmazlık
 * "footprint yanlış" DEĞİL, "görüntü daha eski/yeni" de olabilir. Bu sınır
 * rapora yazılır.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const FIXTURE = JSON.parse(readFileSync(
  new URL('../../src/__tests__/fixtures/mapdataTarsusNear.json', import.meta.url), 'utf8'));

/* ── Ölçüm parametreleri (deterministik) ─────────────────────────────────── */
const Z = 18;
const NEAR = { xmin: 34.85985, ymin: 36.9157, xmax: 34.86435, ymax: 36.9193 };
const SEED = 20260907;            // sabit tohum — örneklem tekrar üretilebilir
const N_ML = 20;                  // ML kökenli örnek
const N_OSM = 5;                  // insan çizimi kontrol grubu
const CELL = 240;                 // hücre kenarı (px)
const SCALE = 2;                  // uydu görüntüsü büyütme (0,48 → 0,24 m/px görsel)
const COLS = 5;

/* ── Web Mercator ────────────────────────────────────────────────────────── */
const WORLD = 256 * 2 ** Z;
const lonToPx = (lon) => (lon + 180) / 360 * WORLD;
const latToPx = (lat) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * WORLD;

/* ── Deterministik PRNG (mulberry32) ─────────────────────────────────────── */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── Footprint yardımcıları ──────────────────────────────────────────────── */
const ringsOf = (g) => (g.type === 'Polygon' ? g.coordinates
  : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);

/**
 * Hücre merkezlemesi için footprint merkezi.
 *
 * ⚠️ ÖLÇÜM ARACI HATASI (ilk turda yakalandı ve düzeltildi): lon/lat
 * koordinatları üzerinde DOĞRUDAN shoelace centroid hesabı KATASTROFİK KAYAN
 * NOKTA İPTALİ üretir — çarpım terimleri ~1287 mertebesinde, toplamları ise
 * alanla orantılı olarak ~1e-9. Ölçülen sapma 25 hücrenin 24'ünde >3 px,
 * en kötüsü 11 px'lik bir bina için **302 px**. İlk kontak sayfası bu yüzden
 * ATILDI.
 *
 * NOT: ÜRETİM KODU BU HATADAN ETKİLENMEZ — `mapdata/resolvers/buildingGeometry`
 * `polygonCentroid` hesabı önce `makeLocalFrame`/`toLocalXY` ile metre uzayına
 * geçer (değerler ~0-50 m), dolayısıyla iptal oluşmaz.
 *
 * Burada kırpma merkezi için bbox ortası KULLANILIR: sunum amaçlı en sağlam
 * seçimdir ve alan ağırlığı gerektirmez.
 */
function centroid(g) {
  const rings = ringsOf(g);
  if (rings.length === 0) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p[0] < minx) minx = p[0];
      if (p[0] > maxx) maxx = p[0];
      if (p[1] < miny) miny = p[1];
      if (p[1] > maxy) maxy = p[1];
    }
  }
  if (!Number.isFinite(minx)) return null;
  return [(minx + maxx) / 2, (miny + maxy) / 2];
}

const isOsmSourced = (b) => (b.sources ?? []).some(
  (s) => /openstreetmap/i.test(s.dataset ?? '') && s.record_id);

/* ── 1) Mozaik karolarını indir ──────────────────────────────────────────── */
const tx0 = Math.floor(lonToPx(NEAR.xmin) / 256);
const tx1 = Math.floor(lonToPx(NEAR.xmax) / 256);
const ty0 = Math.floor(latToPx(NEAR.ymax) / 256);   // kuzey = küçük y
const ty1 = Math.floor(latToPx(NEAR.ymin) / 256);
const originPx = { x: tx0 * 256, y: ty0 * 256 };
const mosaic = { w: (tx1 - tx0 + 1) * 256, h: (ty1 - ty0 + 1) * 256 };

mkdirSync(HERE + 'tiles', { recursive: true });
const tiles = [];
for (let ty = ty0; ty <= ty1; ty++) {
  for (let tx = tx0; tx <= tx1; tx++) {
    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${ty}/${tx}`;
    const file = `tiles/${Z}-${tx}-${ty}.jpg`;
    let bytes;
    if (existsSync(HERE + file)) {
      bytes = readFileSync(HERE + file);
    } else {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`karo indirilemedi ${url} → ${res.status}`);
      bytes = Buffer.from(await res.arrayBuffer());
      writeFileSync(HERE + file, bytes);
    }
    tiles.push({
      z: Z, x: tx, y: ty, url, file, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      // 2521 B = Esri "görüntü yok" yer tutucusu (z19/z20 probunda ölçüldü)
      placeholder: bytes.length === 2521,
      left: tx * 256 - originPx.x,
      top: ty * 256 - originPx.y,
    });
  }
}
const placeholders = tiles.filter((t) => t.placeholder).length;

/* ── 2) Adayları seç ─────────────────────────────────────────────────────── */
const marginPx = CELL / (2 * SCALE) + 8;   // hücre kenarına taşmasın
const inMosaic = (c) => {
  const px = lonToPx(c[0]) - originPx.x;
  const py = latToPx(c[1]) - originPx.y;
  return px > marginPx && py > marginPx && px < mosaic.w - marginPx && py < mosaic.h - marginPx;
};

const enriched = FIXTURE.overtureBuildings.map((b) => {
  const c = centroid(b.geometry);
  return {
    id: b.id,
    origin: isOsmSourced(b) ? 'OSM' : 'ML',
    datasets: (b.sources ?? []).map((s) => s.dataset ?? 'UNKNOWN'),
    centroid: c,
    rings: ringsOf(b.geometry),
  };
}).filter((b) => b.centroid && inMosaic(b.centroid));

const rand = rng(SEED);
const mlPool = shuffled(enriched.filter((b) => b.origin === 'ML'), rand);
const osmPool = shuffled(enriched.filter((b) => b.origin === 'OSM'), rand);
const picked = shuffled([...mlPool.slice(0, N_ML), ...osmPool.slice(0, N_OSM)], rand);

/* ── 3) Kontak sayfası HTML'i ────────────────────────────────────────────── */
const cells = picked.map((b, i) => {
  const cx = lonToPx(b.centroid[0]) - originPx.x;
  const cy = latToPx(b.centroid[1]) - originPx.y;
  const offX = CELL / 2 - cx * SCALE;
  const offY = CELL / 2 - cy * SCALE;
  const poly = b.rings.map((ring) => ring
    .map((p) => `${((lonToPx(p[0]) - originPx.x) * SCALE + offX).toFixed(1)},${((latToPx(p[1]) - originPx.y) * SCALE + offY).toFixed(1)}`)
    .join(' ')).join('" /><polyline class="fp" points="');
  const imgs = tiles.map((t) =>
    `<img src="${t.file}" style="left:${t.left * SCALE + offX}px;top:${t.top * SCALE + offY}px;width:${256 * SCALE}px;height:${256 * SCALE}px">`).join('');
  return `<div class="cell"><div class="sat">${imgs}</div>
  <svg width="${CELL}" height="${CELL}"><polyline class="fp" points="${poly}" /></svg>
  <div class="num">${i + 1}</div></div>`;
}).join('\n');

const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#111;font:12px/1.2 monospace;color:#eee}
.grid{display:grid;grid-template-columns:repeat(${COLS},${CELL}px);gap:6px;padding:6px}
.cell{position:relative;width:${CELL}px;height:${CELL}px;overflow:hidden;background:#000;outline:1px solid #444}
.sat{position:absolute;inset:0}
.sat img{position:absolute;image-rendering:auto}
svg{position:absolute;inset:0}
polyline.fp{fill:none;stroke:#ff2d55;stroke-width:2;stroke-opacity:.95}
.num{position:absolute;left:0;top:0;background:#000c;padding:2px 6px;font-weight:bold;font-size:14px}
</style><div class="grid">${cells}</div>`;
writeFileSync(HERE + 'sheet.html', html, 'utf8');

/* ── 4) Kanıt dosyaları ──────────────────────────────────────────────────── */
writeFileSync(HERE + 'mosaic-provenance.json', JSON.stringify({
  measuredAt: new Date().toISOString().slice(0, 10),
  provider: 'Esri World Imagery (ArcGIS Online) — ÖLÇÜM AMAÇLI, ürüne gömülmedi',
  zoom: Z,
  note: 'z19/z20 bu konumda 2521 B yer tutucu döndürdü → gerçek görüntü tavanı z18.',
  nearBbox: NEAR,
  tileRange: { tx0, tx1, ty0, ty1 },
  mosaicPx: mosaic,
  placeholderTiles: placeholders,
  tiles: tiles.map(({ left, top, ...t }) => t),
}, null, 2), 'utf8');

writeFileSync(HERE + 'sample-key.json', JSON.stringify({
  seed: SEED, nMl: N_ML, nOsm: N_OSM,
  poolSizes: { ml: mlPool.length, osm: osmPool.length, totalInMosaic: enriched.length },
  cells: picked.map((b, i) => ({
    cell: i + 1, id: b.id, origin: b.origin, datasets: b.datasets,
    centroid: b.centroid.map((v) => Number(v.toFixed(7))),
  })),
}, null, 2), 'utf8');

console.log('mozaik karo      :', tiles.length, '· yer tutucu:', placeholders);
console.log('mozaik boyutu    :', mosaic.w + 'x' + mosaic.h, 'px @ z' + Z);
console.log('mozaikteki bina  :', enriched.length, '(ML', mlPool.length, '· OSM', osmPool.length + ')');
console.log('örneklem         :', picked.length, 'hücre · tohum', SEED);
console.log('-> sheet.html · mosaic-provenance.json · sample-key.json (KÖR: anahtar basılmadı)');
