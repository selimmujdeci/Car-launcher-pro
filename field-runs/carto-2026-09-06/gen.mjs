/**
 * CarOS — GERÇEK VERİDEN SAHNE ÜRETİCİ
 *
 * Sentetik ızgara YOK. Gerçek vektör karolar (OpenFreeMap planet / OpenMapTiles
 * şeması) indirilir, `@mapbox/vector-tile` ile çözülür, Web Mercator'dan yerel
 * metreye çevrilir, rota yönüne döndürülür ve GERÇEK bir perspektif kamerayla
 * projekte edilir.
 *
 * Kamera (nadir'den pitch P, odak F px, yer düzlemi z=0):
 *   L = (0, sinP, -cosP)   U = (0, cosP, sinP)   R = (1,0,0)   C = (0,-d,h)
 *   x_cam = X
 *   y_cam = (Y+d)cosP + (Z-h)sinP
 *   z_cam = (Y+d)sinP + (h-Z)cosP
 *   sx = CX + F·x_cam/z_cam        sy = CY - F·y_cam/z_cam
 *   ufuk:  sy → CY - F/tan(P)   ⇒   CY = ufuk + F/tan(P)
 *
 * Yol genişlikleri METREDİR; kasa da metre cinsinden tampondur. Böylece uzaktaki
 * yol kendiliğinden incelir — perspektif fizikseldir, taklit değildir.
 */
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { writeFileSync } from 'node:fs';

const R = 6378137;
const D2R = Math.PI / 180;

/* ── karo indirme ─────────────────────────────────────────────────────────── */
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const TMPL = tj.tiles[0];
const tileXY = (lon, lat, z) => {
  const n = 2 ** z, r = lat * D2R;
  return [Math.floor((lon + 180) / 360 * n),
          Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)];
};
const tileCache = new Map();
async function tile(z, x, y) {
  const k = z + '/' + x + '/' + y;
  if (tileCache.has(k)) return tileCache.get(k);
  const res = await fetch(TMPL.replace('{z}', z).replace('{x}', x).replace('{y}', y));
  const t = res.ok ? new VectorTile(new Pbf(Buffer.from(await res.arrayBuffer()))) : null;
  tileCache.set(k, t);
  return t;
}

/* ── tile px → lon/lat ────────────────────────────────────────────────────── */
const tileToLL = (z, tx, ty, extent, px, py) => {
  const n = 2 ** z;
  const lon = ((tx + px / extent) / n) * 360 - 180;
  const m = Math.PI * (1 - 2 * (ty + py / extent) / n);
  const lat = Math.atan(Math.sinh(m)) / D2R;
  return [lon, lat];
};

/* ── yerel metre çerçevesi ────────────────────────────────── */
export function frame(lon0, lat0) {
  const X0 = R * lon0 * D2R;
  const Y0 = R * Math.log(Math.tan(Math.PI / 4 + lat0 * D2R / 2));
  const k = 1 / Math.cos(lat0 * D2R);           // Mercator → gerçek metre
  return (lon, lat) => {
    const X = R * lon * D2R;
    const Y = R * Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2));
    return [(X - X0) / k, (Y - Y0) / k];        // [doğu m, kuzey m]
  };
}

/* ── katman toplama: her katman KENDİ zoom'undan ────────────────────
   Bina ayak izleri z14'te ADA BAZINDA birleşiktir (9 karoda 210 dev poligon);
   gerçek bina geometrisi z16'da açılır. Bu yüzden zoom katman başına seçilir. */
async function sweep(lon0, lat0, z, span, toM, cb) {
  const [cx, cy] = tileXY(lon0, lat0, z);
  const jobs = [];
  for (let dx = -span; dx <= span; dx++) for (let dy = -span; dy <= span; dy++)
    jobs.push(tile(z, cx + dx, cy + dy).then((t) => [t, cx + dx, cy + dy]));
  for (const [t, tx, ty] of await Promise.all(jobs)) {
    if (!t) continue;
    cb((layer, fn) => {
      const L = t.layers[layer]; if (!L) return;
      for (let i = 0; i < L.length; i++) {
        const f = L.feature(i);
        const geo = f.loadGeometry().map((ring) =>
          ring.map((p) => toM(...tileToLL(z, tx, ty, L.extent, p.x, p.y))));
        fn(f.properties, geo, f.type);
      }
    });
  }
}

export async function collect(lon0, lat0, z = 14, zBld = 14) {
  const toM = frame(lon0, lat0);
  const out = { roads: [], names: [], water: [], green: [], blds: [] };
  await sweep(lon0, lat0, z, 1, toM, (grab) => {
    grab('transportation', (p, g) => out.roads.push({ p, g }));
    grab('transportation_name', (p, g) => out.names.push({ p, g }));
    grab('water', (p, g, ty) => { if (ty === 3) out.water.push({ p, g }); });
    grab('waterway', (p, g, ty) => { if (ty === 2) out.water.push({ p, g, line: true }); });
    grab('landcover', (p, g) => out.green.push({ p, g }));
    grab('park', (p, g, ty) => { if (ty === 3) out.green.push({ p, g }); });
  });
  // bina: kaynak maxzoom = 14 → aynı zoom, ama daha geniş kapsama (5×5 karo)
  await sweep(lon0, lat0, zBld, 2, toM, (grab) => {
    grab('building', (p, g, ty) => { if (ty === 3) out.blds.push({ p, g }); });
  });
  return out;
}

/* ── kamera ───────────────────────────────────────────────────────────────── */
export function camera({ pitch = 60, F = 692, horizon = 52, h = 60, d = 150, CX = 452 }) {
  const P = pitch * D2R, sP = Math.sin(P), cP = Math.cos(P);
  const CY = horizon + F / Math.tan(P);
  const z0 = d * sP + h * cP;                    // ego'nun kamera derinliği
  return {
    horizon, CX, CY, F, z0, pitch, h, d,
    prj(X, Y, Z = 0) {
      const dy = Y + d;
      const yc = dy * cP + (Z - h) * sP;
      const zc = dy * sP + (h - Z) * cP;
      if (zc < 4) return null;
      return [CX + F * X / zc, CY - F * yc / zc, zc];
    },
  };
}
/** Kuş bakışı (serbest gezinme) — ölçek: px/metre. */
export function topdown({ scale = 0.62, CX = 452, CY = 203 }) {
  /* Kuş bakışında ufuk YOKTUR; etiket motoru ufuk eşiğini okuduğu için
     -∞ verilir — aksi hâlde tüm adaylar sessizce elenir (ölçüldü: 8 → 0). */
  return {
    CX, CY, F: 1 / scale, horizon: -1e9, z0: 0, topdown: true, scale,
    prj: (X, Y) => [CX + X * scale, CY - Y * scale, 1],
  };
}

/* ── yön döndürme ─────────────────────────────────────────────────────────── */
export const rot = (th) => {
  const s = Math.sin(th), c = Math.cos(th);
  return (e, n) => [e * c - n * s, e * s + n * c];
};

/* ── polyline → metre cinsinden şerit poligonu ────────────────────────────── */
export function bufferPx(pts, halfW, extraPx, cam) {
  /* Kasa DÜNYA metresi değil EKRAN pikseli olmalı: gerçek harita motorları
     kasayı sabit px çizer. Her tepe noktasının derinliği (z_cam) bilindiğinden
     dünya karşılığı = extraPx · z / F. Böylece kasa her mesafede AYNI
     kalınlıkta görünür, gövde ise perspektifle incelir. */
  if (pts.length < 2) return null;
  const L = [], Rr = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const nx = -dy, ny = dx;
    const pr = cam.prj(pts[i][0], pts[i][1], 0);
    const w = halfW + (pr ? extraPx * pr[2] / cam.F : extraPx * 0.12);
    L.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
    Rr.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
  }
  return L.concat(Rr.reverse());
}

export function buffer(pts, halfW) {
  if (pts.length < 2) return null;
  const L = [], Rr = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy, ny = dx;
    L.push([pts[i][0] + nx * halfW, pts[i][1] + ny * halfW]);
    Rr.push([pts[i][0] - nx * halfW, pts[i][1] - ny * halfW]);
  }
  return L.concat(Rr.reverse());
}

/* ── projeksiyon + SVG ────────────────────────────────────────────────────── */
export const projPoly = (cam, ring, Z = 0) => {
  const out = [];
  for (const [X, Y] of ring) { const p = cam.prj(X, Y, Z); if (!p) return null; out.push(p); }
  return out;
};
export const pts = (pp) => pp.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
/* Bina cephesi için tam sayı yeter: alt piksel kesinliği görünmez ama dosyayı
   iki kat büyütür. Yol ve rota kenarı ondalık kalır — orada titreme görünür. */
export const ptsI = (pp) => pp.map((p) => Math.round(p[0]) + ',' + Math.round(p[1])).join(' ');
/* Ekran alanı (mutlak) — görünmeyecek kadar küçük yüzüpolygon çizilmez. */
export const alan = (pp) => {
  let a = 0;
  for (let i = 0; i < pp.length; i++) {
    const j = (i + 1) % pp.length;
    a += pp[i][0] * pp[j][1] - pp[j][0] * pp[i][1];
  }
  return Math.abs(a) / 2;
};
export const inView = (pp, W = 904, H = 406, pad = 240) =>
  pp.some((p) => p[0] > -pad && p[0] < W + pad && p[1] > -pad && p[1] < H + pad);

/* ── sınıf sözleşmesi: ölçülmüş palet ─────────────────────────────────────── */
export const CLASS = {
  motorway:  { k: 0, w: 15 }, trunk: { k: 0, w: 13 }, primary: { k: 1, w: 11 },
  secondary: { k: 2, w: 9 },  tertiary: { k: 3, w: 7 }, minor: { k: 4, w: 5.4 },
  service:   { k: 4, w: 4 },  track: { k: 4, w: 3.4 }, busway: { k: 3, w: 6 },
};
export const PAL = {
  day: {
    ground: '#e9eef3', fog: '#eef2f6', water: '#9cc7dc', park: '#c1d7b1', forest: '#adcb9a',
    body: ['#ffffff', '#fcfcfc', '#f8f8f8', '#f6f6f7', '#f4f4f5'],
    cas:  ['#929496', '#9c9ea0', '#a8aaac', '#b5b7b9', '#c2c3c4'],
    roof: '#ced3d8', wallA: '#b6bcc3', wallB: '#a0a7af', bldgLine: '#949ba3',
    routeCase: '#0A0C10', label: '#3a3b3c', halo: '#ffffff',
  },
  night: {
    ground: '#222c3c', fog: '#2b3547', water: '#245e85', park: '#36543f', forest: '#2b4732',
    body: ['#ffffff', '#f9fbfc', '#f2f5f8', '#ecf0f5', '#e9edf2'],
    cas:  ['#1a212c', '#181e29', '#161c26', '#111620', '#0e131b'],
    roof: '#3d4963', wallA: '#313b50', wallB: '#262e3e', bldgLine: '#4e5a72',
    routeCase: '#ffffff', label: '#e9edf2', halo: '#141a26',
  },
};
