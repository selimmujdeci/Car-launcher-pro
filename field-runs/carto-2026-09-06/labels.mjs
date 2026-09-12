/**
 * ETİKET MOTORU — gerçek adlar, çakışmasız, bütçeli.
 *
 * Kural (cartographyAuthority ile aynı): etiket sayısı BÜTÇELİDİR. Sürücü
 * ekranında okunmayan etiket zarardır — çakışan atılır, uzaktaki atılır,
 * bütçe dolunca durulur. Ad UYDURULMAZ: yalnız karodan gelen `name` yazılır.
 */
import { projPoly } from './gen.mjs';

/* Kısaltma gerçek bir kartografya tekniğidir: sürücü ekranında ad TAM okunmaz,
   TANINIR. Tür eki kısalır, özel ad asla dokunulmaz. */
const KISALT = {
  'Caddesi': 'Cd.', 'Cadde': 'Cd.', 'Sokak': 'Sk.', 'Sokağı': 'Sk.',
  'Bulvarı': 'Bul.', 'Bulvar': 'Bul.', 'Mahallesi': 'Mah.', 'Meydanı': 'Mey.',
  'Köprüsü': 'Köp.', 'Otoyolu': 'Oto.',
};
const kisa = (ad) => {
  const par = ad.trim().split(/\s+/);
  const son = par[par.length - 1];
  if (KISALT[son] && par.length > 1) par[par.length - 1] = KISALT[son];
  return par.join(' ');
};

const RANK = { motorway: 0, trunk: 0, primary: 1, secondary: 2, tertiary: 3, minor: 4 };
/* Alt sınıf uzaktan yazılmaz: yerel sokak adı 500 m ötede bilgi değil gürültüdür. */
const MENZIL = [700, 700, 600, 430, 300];

/** Basit dikdörtgen çakışma kasası. */
function box() {
  const R = [];
  return {
    dene(x, y, w, h) {
      const a = [x - w / 2 - 6, y - h / 2 - 4, x + w / 2 + 6, y + h / 2 + 4];
      for (const b of R) if (a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]) return false;
      R.push(a); return true;
    },
    say: () => R.length,
  };
}

/**
 * @param opts.butce  en fazla kaç etiket
 * @param opts.derinlik  bu metreden uzaktaki etiket yazılmaz
 */
export function labels(world, cam, wx, t, opts = {}) {
  const kapali = opts.kapali || (() => false);
  /* Rota üzerine ad YAZILMAZ: mavi şerit ekrandaki en önemli nesnedir, üzerine
     düşen etiket onu şık değil okunmaz yapar. */
  const rota = opts.rota || [];
  /* Chrome'un altına etiket YAZILMAZ. Panelin arkasında kalan ad, yerini işgal
     eder ama okunmaz — bütçeyi boşa harcar. */
  const yasak = opts.yasak || [];
  const serbest = (x, y) => {
    for (const r of yasak) if (x > r[0] && x < r[2] && y > r[1] && y < r[3]) return false;
    return true;
  };
  const rotaUzak = (x, y) => {
    for (const p of rota) if (Math.abs(p[0] - x) < 34 && Math.abs(p[1] - y) < 22) return false;
    return true;
  };
  const BUTCE = opts.butce ?? 6;
  const DERIN = opts.derinlik ?? 620;
  const W = opts.W ?? 904, H = opts.H ?? 406;
  const aday = [];

  for (const f of world.names) {
    const p = f.p;
    if (!p.name || p.subclass === 'junction') continue;
    const r = RANK[p['class']];
    if (r === undefined) continue;
    for (const ln of f.g) {
      if (ln.length < 2) continue;
      const pr = projPoly(cam, ln.map((q) => wx(q)));
      if (!pr) continue;
      // ekran içi en uzun parçanın ortası
      let i0 = -1, best = 0, cur = 0, st = 0;
      for (let i = 0; i < pr.length; i++) {
        const ok = pr[i][0] > 30 && pr[i][0] < W - 30 && pr[i][1] > cam.horizon + 16 && pr[i][1] < H - 16;
        if (ok) { if (cur === 0) st = i; cur++; if (cur > best) { best = cur; i0 = st; } }
        else cur = 0;
      }
      if (best < 2) continue;
      /* Tek orta noktaya mahkûm değiliz: gerçek motorlar etiketi yol boyunca
         KAYDIRIR. Ekran içi parçanın beş konumu denenir; ilk temiz olan kazanır. */
      const a = pr[i0], b = pr[i0 + best - 1];
      const uzunluk = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (uzunluk < 40) continue;
      let ac = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
      if (ac > 90) ac -= 180; if (ac < -90) ac += 180;
      const capalar = [];
      for (const oran of [0.5, 0.35, 0.65, 0.22, 0.78]) {
        const k = i0 + Math.round((best - 1) * oran);
        const q = pr[k];
        capalar.push({ mx: q[0], my: q[1], derinlik: q[2] - cam.z0 });
      }
      const dr = (a[2] + b[2]) / 2 - cam.z0;
      if (dr > Math.min(DERIN, MENZIL[r])) continue;
      aday.push({ ad: kisa(p.name), ref: p.ref || null, r, ac, derinlik: dr, uzunluk, capalar });
    }
  }

  // öncelik: sınıf → yakınlık → ekrandaki uzunluk
  aday.sort((x, y) => (x.r - y.r) || (x.derinlik - y.derinlik) || (y.uzunluk - x.uzunluk));

  const gorulen = new Set();
  const kasa = box();
  const S = [];
  for (const c of aday) {
    if (S.length >= BUTCE) break;
    if (gorulen.has(c.ad)) continue;
    const fs = c.r <= 1 ? 13 : c.r === 2 ? 12 : c.r === 3 ? 11 : 10;
    const w = c.ad.length * fs * 0.52, h = fs * 1.25;
    if (w > c.uzunluk * 2.1) continue;                  // yola hiç sığmayan ad yazılmaz
    const rad = c.ac * Math.PI / 180;
    const yx = Math.abs(w / 2 * Math.cos(rad)) + Math.abs(h / 2 * Math.sin(rad));
    const yy = Math.abs(w / 2 * Math.sin(rad)) + Math.abs(h / 2 * Math.cos(rad));
    let yer = null;
    for (const cp of c.capalar) {
      if (cp.mx - yx < 8 || cp.mx + yx > W - 8 || cp.my - yy < 8 || cp.my + yy > H - 8) continue;
      if (kapali(cp.mx, cp.my, cp.derinlik)) continue;
      if (!serbest(cp.mx, cp.my)) continue;
      if (!rotaUzak(cp.mx, cp.my)) continue;
      if (!kasa.dene(cp.mx, cp.my, w, h)) continue;
      yer = cp; break;
    }
    if (!yer) continue;
    gorulen.add(c.ad);
    const kal = c.r <= 1 ? 600 : c.r <= 2 ? 550 : 500;
    S.push(
      `<g transform="translate(${yer.mx.toFixed(1)},${yer.my.toFixed(1)}) rotate(${c.ac.toFixed(1)})">` +
      `<text x="0" y="${(fs * 0.36).toFixed(1)}" font-family="Archivo,Helvetica Neue,Arial,sans-serif" ` +
      `font-size="${fs}" font-weight="${kal}" text-anchor="middle" ` +
      `fill="${t.label}" stroke="${t.halo}" stroke-width="3" stroke-linejoin="round" ` +
      `paint-order="stroke">${esc(c.ad)}</text></g>`
    );
  }
  return { svg: S.join(String.fromCharCode(10)), adet: S.length };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
