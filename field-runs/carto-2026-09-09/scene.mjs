/**
 * scene.mjs — GÜNDÜZ KARTOGRAFİSİ REFERANS SAHNELERİ (2026-09-09).
 *
 * Sentetik ızgara YOK: gerçek OpenFreeMap/OpenMapTiles vektör karoları indirilir
 * (`carto-2026-09-06/gen.mjs` içindeki ölçülmüş toplayıcı yeniden kullanılır —
 * ikinci bir veri yolu kurulmadı).
 *
 * PALET İKİNCİ KAYNAKTAN GELMEZ: `DAY_PALETTE` doğrudan ÜRÜN KODUNDAN
 * (`src/platform/mapStyleBuilders.ts`) import edilir. "Önce" karesi ise bu turdan
 * önceki paletin donmuş kopyasıdır (`BEFORE`), çünkü o değerler artık kodda yok.
 *
 * Koşum:
 *   node --experimental-strip-types --no-warnings \
 *        --loader ./scripts/nodeTsResolve.mjs \
 *        field-runs/carto-2026-09-09/scene.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { collect, topdown, projPoly, pts, inView, CLASS } from '../carto-2026-09-06/gen.mjs';
import { DAY_PALETTE, buildVectorLayers } from '../../src/platform/mapStyleBuilders.ts';
import { ROUTE_CORE_STOPS_LIGHT_BASEMAP, ROUTE_CASING_LIGHT_BASEMAP }
  from '../../src/platform/map/core/routeColorModel.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 904, H = 406;

/** Bu turdan ÖNCEKİ gündüz paleti — "önce" karesi için donmuş kopya. */
const BEFORE = {
  bg: '#e9eef3', farmland: '#e9eaeb', residential: '#e7e8e9', urban: '#dedfe1',
  park: '#c1d7b1', forest: '#adcb9a', water: '#9cc7dc',
  buildingFill: '#d5d7d9', buildingOutline: '#bcbec0',
  body: ['#ffffff', '#fcfcfc', '#f8f8f8', '#f6f6f7', '#f4f4f5'],
  cas: ['#929496', '#9c9ea0', '#a8aaac', '#b5b7b9', '#c2c3c4'],
};
const AFTER = {
  bg: DAY_PALETTE.bg, farmland: DAY_PALETTE.farmland, residential: DAY_PALETTE.residential,
  urban: DAY_PALETTE.urban, park: DAY_PALETTE.park, forest: DAY_PALETTE.forest,
  water: DAY_PALETTE.water, buildingFill: DAY_PALETTE.buildingFill,
  buildingOutline: DAY_PALETTE.buildingOutline,
  body: [DAY_PALETTE.motorway, DAY_PALETTE.primary, DAY_PALETTE.secondary, DAY_PALETTE.tertiary, DAY_PALETTE.minor],
  cas: [DAY_PALETTE.motorwayCasing, DAY_PALETTE.primaryCasing, DAY_PALETTE.secondaryCasing,
    DAY_PALETTE.tertiaryCasing, DAY_PALETTE.minorCasing],
};

/* ── ÖLÇEK KARO ZOOM'UNDAN DEĞİL, BAKIŞ ZOOM'UNDAN GELİR ─────────────
   ÖLÇÜLEN TUZAK (2026-09-09): sahneler önceden `z: 14` ile üretiliyordu ama
   `topdown({scale: 0.62})` px/metre demektir ve 0,62 px/m = 1,61 m/px → gerçek
   BAKIŞ zoom'u **z16,2** idi. Yani kareler z16'da bakılıyor, yol genişlikleri
   ise z14'ten okunuyordu — kasa/gövde oranı cihazdakinden farklı çıkıyordu.
   Artık iki zoom AYRI ve açık:
     · `zTile` — hangi karo indirilecek (OMT kaynağının maxzoom'u 14'tür;
                  z15+ karosu YOKTUR, z14 karosu büyütülerek çizilir)
     · `zView` — ekranda hangi zoom görünüyor: ölçek DE bu, yol genişliği DE bu.
   `scale`, `zView`den türetilir; elle yazılmış ikinci bir ölçek kalmadı. */
const D2R = Math.PI / 180;
const scaleFor = (lat, zView) => 2 ** zView / (156543.03392 * Math.cos(lat * D2R));

/** GERÇEK koordinatlar — hepsi Mersin/İçel bölgesi. */
const SCENES = [
  /* ── SÜRÜŞ DETAYI BANDI (z16) — kabul için kritik bant ─────────────── */
  { id: 'A-camliyayla',  ad: 'Çamlıyayla — dağ/orman (z16)',   lon: 34.6088, lat: 37.1707, zTile: 14, zView: 16 },
  { id: 'B-kirsal',      ad: 'Kırsal yerel ağ — Gözne (z16)',  lon: 34.5300, lat: 36.9800, zTile: 14, zView: 16 },
  { id: 'C-mersin',      ad: 'Mersin merkez — yoğun kent (z16)', lon: 34.6415, lat: 36.8121, zTile: 14, zView: 16 },
  { id: 'D-gazipasa',    ad: 'Gazipaşa — cihaz konumu (z16)',  lon: 34.8621, lat: 36.9175, zTile: 14, zView: 16 },
  { id: 'E-sahil',       ad: 'Sahil — su komşuluğu (z16)',     lon: 34.6200, lat: 36.7850, zTile: 14, zView: 16 },
  { id: 'F-tarsus',      ad: 'Tarsus — karma ağ (z16)',        lon: 34.8951, lat: 36.9177, zTile: 14, zView: 16 },
  /* ── ZOOM BANDI (P4) — tek zoomda kalibre edilen palet diğerinde çökebilir ── */
  { id: 'G-mersin-z12',  ad: 'Mersin — bölgesel yapı (z12)',   lon: 34.6415, lat: 36.8121, zTile: 12, zView: 12 },
  { id: 'H-camliyayla-z15', ad: 'Çamlıyayla — kasaba yaklaşımı (z15)', lon: 34.6088, lat: 37.1707, zTile: 14, zView: 15 },
  { id: 'I-mersin-z17',  ad: 'Mersin — yerel detay (z17)',    lon: 34.6415, lat: 36.8121, zTile: 14, zView: 17 },
];

/** ── NAVİGASYON SAHNESİ (P5/P9-F) ────────────────────────────────
 *  Rota çizgisi GERÇEK yol geometrisi üzerine çizilir (karodaki en uzun
 *  transportation parçası). Bu bir ROTA MOTORU ÇIKTISI DEĞİLDİR — amacı yalnız
 *  SUNUM ilişkisini göstermektir: rota baskın mı, basemap onun altında yaşamaya
 *  devam ediyor mu. Renkler ÜRÜN kodundan gelir (`routeColorModel`). */
const NAV_SCENE = { id: 'J-navigasyon', ad: 'Mersin — etkin rota (z16)', lon: 34.6415, lat: 36.8121, zTile: 14, zView: 16 };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Sınıf → merdiven indeksi (0 otoyol … 4 yerel). */
const rank = (cls) => (CLASS[cls]?.k ?? 4);

/* ── GENİŞLİKLER DE ÜRÜNDEN OKUNUR (ikinci gerçek yok) ────────────────────
   Ürün stilindeki `line-width` bir zoom-`interpolate`tir ve durak DEĞERLERİNİN
   içinde rampa `case`i taşır; burada rampa OLMAYAN (normal yol) dal okunur. */
const DAY_LAYERS = buildVectorLayers(false);
const layerPaint = (id) => (DAY_LAYERS.find((l) => l.id === id)?.paint ?? {});
function evalZoom(expr, zoom) {
  if (typeof expr === 'number') return expr;
  if (!Array.isArray(expr)) throw new Error('ifade degil');
  if (expr[0] === 'interpolate') {
    const st = [];
    for (let i = 3; i < expr.length; i += 2) st.push([expr[i], expr[i + 1]]);
    if (zoom <= st[0][0]) return evalZoom(st[0][1], zoom);
    if (zoom >= st[st.length - 1][0]) return evalZoom(st[st.length - 1][1], zoom);
    for (let i = 1; i < st.length; i++) {
      if (zoom <= st[i][0]) {
        const t = (zoom - st[i - 1][0]) / (st[i][0] - st[i - 1][0]);
        return evalZoom(st[i - 1][1], zoom) + (evalZoom(st[i][1], zoom) - evalZoom(st[i - 1][1], zoom)) * t;
      }
    }
  }
  if (expr[0] === 'case') return evalZoom(expr[expr.length - 1], zoom);   // rampa dışı dal
  throw new Error('desteklenmeyen ifade: ' + expr[0]);
}
const BODY_IDS = ['road-motorway', 'road-primary', 'road-secondary', 'road-tertiary', 'road-minor'];
const CAS_IDS = ['road-motorway-casing', 'road-primary-casing', 'road-secondary-casing',
  'road-tertiary-casing', 'road-minor-casing'];
/* ── GÖRÜNÜRLÜK EŞİKLERİ DE ÜRÜNDEN OKUNUR ───────────────────────
   ÖLÇÜLEN TUZAK: sahne üreticisi önceden karodaki TÜM yolları çiziyordu. z12
   karesinde ürün `road-minor`ı (minzoom 13) ve `road-service`ı (15) ÇİZMEZ ama
   sahne çiziyordu → kare üründen DAHA KALABALIK görünüyordu. Kartografi kanıtı
   üründen AYRI şey gösteremez (P7); eşikler bu yüzden stil katmanlarından gelir. */
const MINZOOM = BODY_IDS.map((id) => DAY_LAYERS.find((l) => l.id === id)?.minzoom ?? 0);
const SERVICE_MINZOOM = DAY_LAYERS.find((l) => l.id === 'road-service')?.minzoom ?? 15;
const BUILDING_MINZOOM = DAY_LAYERS.find((l) => l.id === 'building')?.minzoom ?? 14;
const widthsAt = (z) => ({
  body: BODY_IDS.map((id) => evalZoom(layerPaint(id)['line-width'], z)),
  cas: CAS_IDS.map((id) => evalZoom(layerPaint(id)['line-width'], z)),
});
/** ÖNCEKİ turun genişlikleri — "önce" karesi için donmuş kopya. */
const BEFORE_W = {
  body: [[[4, 0.8], [10, 3], [14, 9], [18, 20]], [[7, 0.9], [12, 3.2], [14, 6.4], [18, 15]],
    [[9, 0.8], [12, 2.2], [14, 4.2], [18, 10.5]], [[11, 0.5], [13, 1.5], [14, 3.0], [18, 8.8]],
    [[13, 0.9], [14, 2.2], [16, 4], [18, 7.4]]],
  cas: [[[5, 2.4], [10, 5], [14, 11.5], [18, 24]], [[8, 2.2], [14, 8.4], [18, 18]],
    [[9, 1.5], [12, 3.3], [14, 5.2], [18, 13]], [[12, 1.2], [14, 3.6], [18, 9.6]],
    [[14, 2.6], [16, 4.6], [18, 9]]],
};
const stopsAt = (st, z) => {
  if (z <= st[0][0]) return st[0][1];
  if (z >= st[st.length - 1][0]) return st[st.length - 1][1];
  for (let i = 1; i < st.length; i++) {
    if (z <= st[i][0]) { const t = (z - st[i - 1][0]) / (st[i][0] - st[i - 1][0]); return st[i - 1][1] + (st[i][1] - st[i - 1][1]) * t; }
  }
};

function render(world, cam, PAL, title, WID, route, zView) {
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  out.push(`<rect width="${W}" height="${H}" fill="${PAL.bg}"/>`);

  /* ── doğa / arazi ───────────────────────────────────────────── */
  const areaFill = (f) => {
    const c = f.p.class ?? f.p.subclass;
    if (c === 'wood' || c === 'forest') return PAL.forest;
    if (c === 'farmland') return PAL.farmland;
    if (c === 'grass' || c === 'park' || c === 'meadow') return PAL.park;
    return PAL.park;
  };
  for (const f of world.green) {
    for (const ring of f.g) {
      const pp = projPoly(cam, ring); if (!pp || !inView(pp, W, H)) continue;
      out.push(`<polygon points="${pts(pp)}" fill="${areaFill(f)}" fill-opacity="0.85"/>`);
    }
  }
  for (const f of world.water) {
    for (const ring of f.g) {
      const pp = projPoly(cam, ring); if (!pp || !inView(pp, W, H)) continue;
      if (f.line) out.push(`<polyline points="${pts(pp)}" fill="none" stroke="${PAL.water}" stroke-width="2"/>`);
      else out.push(`<polygon points="${pts(pp)}" fill="${PAL.water}"/>`);
    }
  }
  /* ── binalar ────────────────────────────────────────────────── */
  for (const f of (zView >= BUILDING_MINZOOM ? world.blds : [])) {
    for (const ring of f.g) {
      const pp = projPoly(cam, ring); if (!pp || !inView(pp, W, H)) continue;
      out.push(`<polygon points="${pts(pp)}" fill="${PAL.buildingFill}" stroke="${PAL.buildingOutline}" stroke-width="0.6"/>`);
    }
  }
  /* ── yol KASALARI (küçükten büyüğe) sonra GÖVDELER ─────────── */
  const roads = world.roads.filter((f) => {
    if (f.p.brunnel === 'tunnel' || !CLASS[f.p.class]) return false;
    /* ÜRÜN eşiği: sınıf bu zoom'da henüz açılmadıysa çıkarılır. */
    if (f.p.class === 'service' || f.p.class === 'track') return zView >= SERVICE_MINZOOM;
    return zView >= MINZOOM[rank(f.p.class)];
  });
  const order = [4, 3, 2, 1, 0];
  for (const pass of ['cas', 'body']) {
    for (const k of order) {
      for (const f of roads) {
        if (rank(f.p.class) !== k) continue;
        for (const ln of f.g) {
          const pp = projPoly(cam, ln); if (!pp || !inView(pp, W, H)) continue;
          const w = pass === 'cas' ? WID.cas[k] : WID.body[k];
          const col = pass === 'cas' ? PAL.cas[k] : PAL.body[k];
          out.push(`<polyline points="${pts(pp)}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`);
        }
      }
    }
  }
  /* ── ETKİN ROTA — basemap'in ÜSTÜNDE, ürün renkleriyle ────────────────── */
  if (route) {
    const pp = projPoly(cam, route);
    if (pp) {
      out.push(`<polyline points="${pts(pp)}" fill="none" stroke="${ROUTE_CASING_LIGHT_BASEMAP}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`);
      out.push(`<polyline points="${pts(pp)}" fill="none" stroke="${ROUTE_CORE_STOPS_LIGHT_BASEMAP[0]}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  }
  out.push(`<text x="10" y="20" font-family="monospace" font-size="12" fill="#333">${esc(title)}</text>`);
  out.push('</svg>');
  return out.join('\n');
}

mkdirSync(HERE, { recursive: true });
const index = [];
for (const sc of SCENES) {
  process.stdout.write(`· ${sc.ad} … `);
  let world;
  try {
    world = await collect(sc.lon, sc.lat, sc.zTile, sc.zTile);
  } catch (e) {
    console.log('KARO ALINAMADI: ' + e.message);
    index.push({ ...sc, hata: String(e.message) });
    continue;
  }
  const cam = topdown({ scale: scaleFor(sc.lat, sc.zView) });
  const say = {
    yol: world.roads.length, bina: world.blds.length,
    yesil: world.green.length, su: world.water.length,
  };
  const wBefore = { body: BEFORE_W.body.map((st) => stopsAt(st, sc.zView)), cas: BEFORE_W.cas.map((st) => stopsAt(st, sc.zView)) };
  const wAfter = widthsAt(sc.zView);
  writeFileSync(join(HERE, `${sc.id}-BEFORE.svg`), render(world, cam, BEFORE, `${sc.ad} · ÖNCE`, wBefore, null, sc.zView));
  writeFileSync(join(HERE, `${sc.id}-AFTER.svg`), render(world, cam, AFTER, `${sc.ad} · SONRA`, wAfter, null, sc.zView));
  console.log(`yol ${say.yol} · bina ${say.bina} · yeşil ${say.yesil} · su ${say.su}`);
  index.push({ ...sc, ...say });
}

/* ── NAVİGASYON KARESİ: AYNI sahne · rotasız ↔ rotalı ───────────────────── */
let navOk = null;
try {
  const world = await collect(NAV_SCENE.lon, NAV_SCENE.lat, NAV_SCENE.zTile, NAV_SCENE.zTile);
  const cam = topdown({ scale: scaleFor(NAV_SCENE.lat, NAV_SCENE.zView) });
  /* Rota gövdesi = karodaki EN UZUN ana/tali yol parçası (gerçek geometri). */
  let best = null, bestLen = 0;
  for (const f of world.roads) {
    if (!['motorway', 'trunk', 'primary', 'secondary'].includes(f.p.class)) continue;
    for (const ln of f.g) {
      const pp = projPoly(cam, ln);
      if (!pp || !inView(pp, W, H)) continue;
      let L = 0;
      for (let i = 1; i < pp.length; i++) L += Math.hypot(pp[i][0] - pp[i - 1][0], pp[i][1] - pp[i - 1][1]);
      if (L > bestLen) { bestLen = L; best = ln; }
    }
  }
  const wid = widthsAt(NAV_SCENE.zView);
  writeFileSync(join(HERE, `${NAV_SCENE.id}-BROWSE.svg`),
    render(world, cam, AFTER, `${NAV_SCENE.ad} · SERBEST SÜRÜŞ`, wid, null, NAV_SCENE.zView));
  writeFileSync(join(HERE, `${NAV_SCENE.id}-ROTA.svg`),
    render(world, cam, AFTER, `${NAV_SCENE.ad} · ETKİN ROTA`, wid, best, NAV_SCENE.zView));
  navOk = { ...NAV_SCENE, rotaPikselUzunlugu: Math.round(bestLen), rotaBulundu: !!best };
  console.log(`· ${NAV_SCENE.ad} … rota ${best ? Math.round(bestLen) + ' px' : 'BULUNAMADI'}`);
} catch (e) {
  navOk = { ...NAV_SCENE, hata: String(e.message) };
  console.log('· navigasyon sahnesi: ' + e.message);
}

writeFileSync(join(HERE, 'scenes.json'), JSON.stringify({
  uretildi: new Date().toISOString(),
  kaynak: 'OpenFreeMap planet (OpenMapTiles şeması) — gerçek karolar',
  not: 'AFTER paleti ÜRÜN KODUNDAN (DAY_PALETTE) import edilir; BEFORE bu turdan önceki donmuş kopyadır.',
  before: BEFORE, after: AFTER, sahneler: index, navigasyon: navOk,
}, null, 2));

const html = ['<!doctype html><meta charset="utf-8"><title>CarOS gündüz kartografi — önce/sonra</title>',
  '<style>body{font-family:system-ui;background:#1b1b1b;color:#eee;margin:24px}h2{font-size:15px;margin:22px 0 8px}',
  '.p{display:flex;gap:12px}.p div{flex:1}img{width:100%;border:1px solid #444}small{color:#aaa}</style>',
  '<h1>CarOS — gündüz basemap kalibrasyonu (2026-09-09)</h1>',
  '<small>Gerçek OpenMapTiles karoları · sol ÖNCE · sağ SONRA</small>'];
for (const sc of index) {
  if (sc.hata) { html.push(`<h2>${esc(sc.ad)} — karo alınamadı: ${esc(sc.hata)}</h2>`); continue; }
  html.push(`<h2>${esc(sc.ad)} <small>(yol ${sc.yol} · bina ${sc.bina} · yeşil ${sc.yesil} · su ${sc.su})</small></h2>`);
  html.push(`<div class="p"><div><img src="${sc.id}-BEFORE.svg"></div><div><img src="${sc.id}-AFTER.svg"></div></div>`);
}
if (navOk && !navOk.hata) {
  html.push(`<h2>${esc(navOk.ad)} <small>(sol serbest sürüş · sağ etkin rota — aynı basemap)</small></h2>`);
  html.push(`<div class="p"><div><img src="${navOk.id}-BROWSE.svg"></div><div><img src="${navOk.id}-ROTA.svg"></div></div>`);
}
writeFileSync(join(HERE, 'index.html'), html.join('\n'));
console.log('\nyazıldı: ' + HERE);
