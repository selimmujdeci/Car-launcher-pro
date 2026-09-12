/** Gerçek veriden sahne SVG'leri üretir. */
import { collect, camera, topdown, rot, buffer, bufferPx, projPoly, pts, ptsI, alan, inView, CLASS, PAL } from './gen.mjs';
import { writeFileSync } from 'node:fs';

const W = 904, H = 406;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ── rota kurucu ───────────────────────────────────────────
   Tek karo parçası rota değildir: OMT geometrisi karo sınırında kesilir. Gerçek
   rota, uç noktaları birbirine değen parçaları ZINCIRLEYEREK kurulur — aynı ada
   ve aynı sınıf tercih edilir, aksi hâlde en düz devam seçilir. */
const KEY = (p) => p[0].toFixed(1) + '|' + p[1].toFixed(1);
const DIST = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function chain(world, seed, cls, name) {
  const parts = [];
  for (const f of world.roads) {
    if (f.p.brunnel === 'tunnel') continue;
    const sameName = name && f.p.name === name;
    if (!sameName && f.p['class'] !== cls) continue;
    for (const ln of f.g) if (ln.length > 1) parts.push({ ln, used: false, name: f.p.name, cls: f.p['class'] });
  }
  for (const p of parts) if (KEY(p.ln[0]) === KEY(seed[0]) && KEY(p.ln[p.ln.length - 1]) === KEY(seed[seed.length - 1])) p.used = true;
  let out = seed.slice();
  for (const dir of [1, 0]) {                    // 1 = ileri ucu uzat, 0 = geri ucu
    for (let step = 0; step < 24; step++) {
      const tip = dir ? out[out.length - 1] : out[0];
      const prev = dir ? out[out.length - 2] : out[1];
      const hx = tip[0] - prev[0], hy = tip[1] - prev[1];
      const hl = Math.hypot(hx, hy) || 1;
      let best = null;
      for (const p of parts) {
        if (p.used) continue;
        const A = p.ln[0], B = p.ln[p.ln.length - 1];
        for (const [head, seg] of [[A, p.ln], [B, p.ln.slice().reverse()]]) {
          const gap = DIST(tip, head);
          if (gap > 12) continue;
          const nx = seg[1][0] - seg[0][0], ny = seg[1][1] - seg[0][1];
          const nl = Math.hypot(nx, ny) || 1;
          const cosang = (hx * nx + hy * ny) / (hl * nl);          // düzlük
          if (cosang < 0.55) continue;
          const score = cosang * 2 + (p.name === name ? 1.2 : 0) - gap / 12;
          if (!best || score > best.score) best = { p, seg, score };
        }
      }
      if (!best) break;
      best.p.used = true;
      const add = best.seg.slice(1);
      out = dir ? out.concat(add) : add.slice().reverse().concat(out);
    }
  }
  return out;
}

/* Zincir açgözlüdür: paralel/geri parçayı yakalayabilir. Gerçek rota kendi
   üzerine KATLANMAZ — baş açısı 110°'den fazla dönen ya da 3 adım öncesine 18 m'den
   yaklaşan tepe noktasında zincir KESİLİR. */
function temizle(line, ni) {
  const kes = (bas, adim) => {
    let son = bas;
    for (let i = bas + adim; i > 0 && i < line.length - 1; i += adim) {
      const h1 = Math.atan2(line[i][0] - line[i - adim][0], line[i][1] - line[i - adim][1]);
      const h2 = Math.atan2(line[i + adim][0] - line[i][0], line[i + adim][1] - line[i][1]);
      let d = h2 - h1;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) > 2.27) break;              // 130° üzeri = gerçek geri dönüş
      let dolan = false;
      for (let j = bas; Math.abs(j - i) > 8; j += adim)   // yoğun tepe dizisinde yanlış pozitif olmasın
        if (DIST(line[j], line[i]) < 25) { dolan = true; break; }
      if (dolan) break;
      son = i;
    }
    return son;
  };
  const bit = kes(ni, 1), bas = kes(ni, -1);
  return { line: line.slice(bas, bit + 1), ni: ni - bas };
}

export function pickRoute(world, prefer = ['primary', 'trunk', 'secondary']) {
  let best = null;
  for (const cls of prefer) {
    for (const f of world.roads) {
      if (f.p['class'] !== cls || f.p.brunnel === 'tunnel') continue;
      for (const ln of f.g) {
        if (ln.length < 4) continue;
        let len = 0, near = Infinity, ni = 0;
        for (let i = 0; i < ln.length; i++) {
          const d = Math.hypot(ln[i][0], ln[i][1]);
          if (d < near) { near = d; ni = i; }
          if (i) len += DIST(ln[i], ln[i - 1]);
        }
        const score = len - near * 3;
        if (near < 420 && (!best || score > best.score)) best = { line: ln, ni, score, cls, p: f.p };
      }
    }
    if (best) break;
  }
  if (!best) return null;
  const full = chain(world, best.line, best.cls, best.p.name);
  let near = Infinity, ni = 0;
  for (let i = 0; i < full.length; i++) {
    const d = Math.hypot(full[i][0], full[i][1]);
    if (d < near) { near = d; ni = i; }
  }
  const uz = (a2, b2) => { let v = 0; for (let i = a2 + 1; i <= b2; i++) v += DIST(full[i], full[i - 1]); return v; };
  let line = full, idx = ni;
  if (uz(ni, full.length - 1) < uz(0, ni)) {          // önde kalan yol arkadakinden kısaysa yönü çevir
    line = full.slice().reverse();
    idx = full.length - 1 - ni;
  }
  const tz = temizle(line, idx); line = tz.line; idx = tz.ni;
  let L = 0; for (let i = 1; i < line.length; i++) L += DIST(line[i], line[i - 1]);
  let ileri = 0; for (let i = idx + 1; i < line.length; i++) ileri += DIST(line[i], line[i - 1]);
  return { line, ni: idx, cls: best.cls, p: best.p, metre: L, ileri };
}

/* ── yol adı sözlüğü: geometriye en yakın ismi eşle ───────────────────────── */
function nameFor(world, line) {
  const mid = line[Math.floor(line.length / 2)];
  let best = null, bd = 260;
  for (const n of world.names) {
    if (!n.p.name || n.p.subclass === 'junction') continue;
    for (const g of n.g) for (const p of g) {
      const d = Math.hypot(p[0] - mid[0], p[1] - mid[1]);
      if (d < bd) { bd = d; best = n.p; }
    }
  }
  return best;
}

/* ── perspektif sahne ──────────────────────────────────────
   Çizim sırası gerçek motorun sırasıdır: zemin → alan → yol → ROTA (hepsi yer
   düzleminde) → ardından çıkarılmış binalar. Bina uzaktaki rotayı kapatır — bu
   hata değil, doğru oklüzyondur; yakın rota zaten hiçbir kütlenin arkasında değildir. */
/* ── dışbükey kabuk (Andrew monotone chain) + içinde-mi testi ──────────── */
function kabuk(P) {
  const p = P.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const alt = [], ust = [];
  for (const q of p) { while (alt.length > 1 && cr(alt[alt.length - 2], alt[alt.length - 1], q) <= 0) alt.pop(); alt.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (ust.length > 1 && cr(ust[ust.length - 2], ust[ust.length - 1], q) <= 0) ust.pop(); ust.push(q); }
  alt.pop(); ust.pop();
  return alt.concat(ust);
}
function icinde(H, x, y) {
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length];
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
  }
  return true;
}

const BINA_MENZIL = 900;                                    // 3B bina görünürlük menzili (m)

export function perspective(world, route, night, opts = {}) {
  const t = night ? PAL.night : PAL.day;
  const cam = camera(Object.assign({ pitch: 60, F: 692, horizon: 52, h: 60, d: 150 }, opts.cam || {}));
  const line = route.line, i0 = route.ni;
  const a = line[Math.max(0, i0 - 1)], b = line[Math.min(line.length - 1, i0 + 1)];
  const th = Math.atan2(b[0] - a[0], b[1] - a[1]);          // kuzeyden saat yönü
  const Rt = rot(th);
  const o = line[i0];
  const wx = (p) => Rt(p[0] - o[0], p[1] - o[1]);           // ego merkezli, rota yukarı

  const S = [];
  S.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="url(#sky)"/>`);
  S.push(`<rect x="0" y="${cam.horizon}" width="${W}" height="${H - cam.horizon}" fill="${t.ground}"/>`);

  /* — alanlar: yeşil + su — */
  const areas = [];
  for (const f of world.green) {
    const c = f.p['class'], sub = f.p.subclass;
    if (!['grass', 'wood', 'forest', 'park', 'meadow', 'scrub'].includes(c) && sub !== 'park') continue;
    areas.push({ g: f.g, fill: (c === 'wood' || c === 'forest') ? t.forest : t.park });
  }
  for (const f of world.water) {
    if (f.line || f.p['class'] === 'swimming_pool') continue;
    areas.push({ g: f.g, fill: t.water });
  }
  for (const A of areas) for (const ring of A.g) {
    const pp = projPoly(cam, ring.map((p) => wx(p)));
    if (pp && pp.length > 2 && inView(pp)) S.push(`<polygon points="${pts(pp)}" fill="${A.fill}"/>`);
  }
  for (const f of world.water) {
    if (!f.line) continue;
    for (const ln of f.g) {
      const poly = buffer(ln.map((p) => wx(p)), f.p['class'] === 'river' ? 9 : 3.5);
      const pp = poly && projPoly(cam, poly);
      if (pp && inView(pp)) S.push(`<polygon points="${pts(pp)}" fill="${t.water}"/>`);
    }
  }

  /* — yollar: gövde dünya metresinde, kasa sabit ekran pikselinde — */
  const segs = [];
  for (const f of world.roads) {
    const c = CLASS[f.p['class']]; if (!c) continue;
    if (f.p.brunnel === 'tunnel') continue;
    const ramp = f.p.ramp === 1;
    for (const ln of f.g) {
      const w = (ramp ? c.w * 0.55 : c.w) / 2;
      const world2 = ln.map((p) => wx(p));
      const bp = buffer(world2, w), cpoly = bufferPx(world2, w, 1.6, cam);
      const pb = bp && projPoly(cam, bp), pc = cpoly && projPoly(cam, cpoly);
      if (!pb || !pc || !inView(pb) || alan(pb) < 3) continue;
      segs.push({ k: c.k, body: pts(pb), cas: pts(pc), layer: f.p.layer || 0 });
    }
  }
  segs.sort((p, q) => (p.layer - q.layer) || (q.k - p.k));
  for (const s of segs) S.push(`<polygon points="${s.cas}" fill="${t.cas[s.k]}"/>`);
  for (const s of segs) S.push(`<polygon points="${s.body}" fill="${t.body[s.k]}"/>`);

  /* — 3B binalar: gerçek ayak izi + render_height, uzaktan yakına — */
  const bl = [];
  for (const f of world.blds) {
    const hgt = Math.max(4, f.p.render_height || 9);
    const bas = Math.max(0, f.p.render_min_height || 0);
    for (const ring of f.g) {
      const wr = ring.map((p) => wx(p));
      const base = projPoly(cam, wr, bas), roof = projPoly(cam, wr, hgt);
      if (!base || !roof || !inView(roof)) continue;
      const depth = base.reduce((s, p) => s + p[2], 0) / base.length;
      if (depth > BINA_MENZIL) continue;
      if (alan(roof) < 9 && alan(base) < 9) continue;   // görünmeyecek kütle çizilmez
      bl.push({ depth, base, roof });
    }
  }
  bl.sort((p, q) => q.depth - p.depth);
  /* OKLÜZYON MASKESİ — 8 px hücre ızgarasına çatı derinliği yazılır. Etiket motoru
     bu maskeye bakar: bir kütlenin arkasında kalan yolun adı çatının üstünde
     asılı kalamaz. Gerçek motorun derinlik tamponunun ucuz karşılığıdır. */
  const MC = 8, MW = Math.ceil(W / MC), MH = Math.ceil(H / MC);
  const mask = new Float32Array(MW * MH).fill(Infinity);
  /* Bina bir kütledir, konu değildir: menzil sonunda saydamlıkla siliner ki
     ufka doğru yol ağı ve rota okunur kalsın — sert kesim çizgisi oluşmaz. */
  const solma = (d) => Math.max(0, Math.min(1, (BINA_MENZIL - d) / (BINA_MENZIL * 0.15)));
  for (const b of bl) {
    const al = solma(b.depth).toFixed(3);
    const walls = [];
    for (let i = 0; i < b.base.length; i++) {
      const j = (i + 1) % b.base.length;
      const q = [b.base[i], b.base[j], b.roof[j], b.roof[i]];
      const ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
      walls.push({ d: (b.base[i][2] + b.base[j][2]) / 2, q, front: ar < 0 });
    }
    walls.sort((p, q2) => q2.d - p.d);
    for (const w of walls) { if (alan(w.q) < 6) continue; S.push(`<polygon points="${ptsI(w.q)}" fill="${w.front ? t.wallA : t.wallB}" opacity="${al}"/>`); }
    if (+al > 0.35) {
      /* Siluet = taban ∪ çatı noktalarının dışbükey kabuğu. Bbox ile doldurmak
         maskı şişirir ve tüm etiketleri yutar (ölçüldü: 9 → 1). */
      const hull = kabuk(b.base.concat(b.roof));
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const q of hull) {
        if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0];
        if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1];
      }
      for (let gy = Math.max(0, Math.floor(y0 / MC)); gy <= Math.min(MH - 1, Math.floor(y1 / MC)); gy++)
        for (let gx = Math.max(0, Math.floor(x0 / MC)); gx <= Math.min(MW - 1, Math.floor(x1 / MC)); gx++) {
          if (!icinde(hull, gx * MC + MC / 2, gy * MC + MC / 2)) continue;
          const i = gy * MW + gx;
          if (b.depth < mask[i]) mask[i] = b.depth;
        }
    }
  }

  /* — ROTA — EN ÜSTTE
     Rota yer düzleminde yaşar ama binadan SONRA çizilir: ticari navigasyonda
     rota kaybolmaz, kapatan kütle onu gizleyemez. Bu bilinçli bir oklüzyon
     ihlalidir — görev kritikliği geometrik doğruluğun üstündedir. */
  const ahead = [];
  for (let i = i0; i < line.length; i++) {
    const p = wx(line[i]);
    ahead.push(p);
    if (p[1] > 1400) break;
  }
  const behind = i0 > 0 ? [wx(line[i0 - 1])] : [];
  const rl = behind.concat(ahead);
  const rotaEkran = (projPoly(cam, rl) || []).filter((q) => q);
  if (rl.length > 1) {
    const rb = buffer(rl, 4.1), rc = bufferPx(rl, 4.1, 2.2, cam);
    const pc = rc && projPoly(cam, rc), pb = rb && projPoly(cam, rb);
    if (pc) S.push(`<polygon points="${pts(pc)}" fill="${t.routeCase}"/>`);
    if (pb) S.push(`<polygon points="${pts(pb)}" fill="url(#rot)"/>`);
  }

  /* — atmosferik derinlik: ufuk bandı dar tutulur, sahneyi yıkamaz — */
  S.push(`<rect x="0" y="${cam.horizon - 2}" width="${W}" height="38" fill="url(#fog)"/>`);
  const kapali = (x, y, derinlik) => {
    const gx = Math.floor(x / MC), gy = Math.floor(y / MC);
    if (gx < 0 || gy < 0 || gx >= MW || gy >= MH) return false;
    return mask[gy * MW + gx] < derinlik - 6;
  };
  return { svg: S.join(String.fromCharCode(10)), cam, wx, th, heading: th, kapali, rotaEkran };
}

/* ── kuş bakışı sahne ─────────────────────────────────────────────────────── */
export function plan(world, center, night, scale = 0.62) {
  const t = night ? PAL.night : PAL.day;
  const cam = topdown({ scale });
  const wx = (p) => [p[0] - center[0], p[1] - center[1]];
  const S = [`<rect x="0" y="0" width="${W}" height="${H}" fill="${t.ground}"/>`];
  const areas = [];
  for (const f of world.green) {
    const c = f.p['class'];
    if (!['grass', 'wood', 'forest', 'park', 'meadow', 'scrub'].includes(c) && f.p.subclass !== 'park') continue;
    areas.push({ g: f.g, fill: (c === 'wood' || c === 'forest') ? t.forest : t.park });
  }
  for (const f of world.water) { if (!f.line && f.p['class'] !== 'swimming_pool') areas.push({ g: f.g, fill: t.water }); }
  for (const A of areas) for (const ring of A.g) {
    const pp = projPoly(cam, ring.map(wx));
    if (pp && pp.length > 2 && inView(pp)) S.push(`<polygon points="${pts(pp)}" fill="${A.fill}"/>`);
  }
  for (const f of world.water) {
    if (!f.line) continue;
    for (const ln of f.g) {
      const poly = buffer(ln.map(wx), f.p['class'] === 'river' ? 10 : 4);
      const pp = poly && projPoly(cam, poly);
      if (pp && inView(pp)) S.push(`<polygon points="${pts(pp)}" fill="${t.water}"/>`);
    }
  }
  const segs = [];
  for (const f of world.roads) {
    const c = CLASS[f.p['class']]; if (!c) continue;
    if (f.p.brunnel === 'tunnel') continue;
    for (const ln of f.g) {
      const wl = ln.map(wx);
      const b = buffer(wl, (f.p.ramp === 1 ? c.w * 0.55 : c.w) / 2);
      const cp = bufferPx(wl, (f.p.ramp === 1 ? c.w * 0.55 : c.w) / 2, 1.5, cam);
      const pb = b && projPoly(cam, b), pc = cp && projPoly(cam, cp);
      if (!pb || !pc || !inView(pb)) continue;
      segs.push({ k: c.k, body: pts(pb), cas: pts(pc) });
    }
  }
  segs.sort((p, q) => q.k - p.k);
  for (const s of segs) S.push(`<polygon points="${s.cas}" fill="${t.cas[s.k]}"/>`);
  for (const s of segs) S.push(`<polygon points="${s.body}" fill="${t.body[s.k]}"/>`);
  for (const f of world.blds) for (const ring of f.g) {
    const pp = projPoly(cam, ring.map(wx));
    if (pp && pp.length > 2 && inView(pp))
      { if (alan(pp) < 6) continue; S.push(`<polygon points="${ptsI(pp)}" fill="${t.roof}" stroke="${t.bldgLine}" stroke-width="0.5"/>`); }
  }
  return { svg: S.join('\n'), cam, wx };
}

export { esc, nameFor, W, H };
