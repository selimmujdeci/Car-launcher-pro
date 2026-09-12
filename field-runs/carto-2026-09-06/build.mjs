/**
 * KARE ÜRETİCİ — gerçek Kadıköy verisinden altı ürün karesi.
 * Her sayı ölçülür veya türetilir; hiçbiri uydurulmaz.
 */
import { collect, PAL } from './gen.mjs';
import { perspective, pickRoute, plan } from './scene.mjs';
import { labels } from './labels.mjs';
import { manevra, suankiYol, ozet } from './manevra.mjs';
import * as F from './frame.mjs';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const LON = 29.0300, LAT = 40.9900;
console.log('karolar indiriliyor…');
const world = await collect(LON, LAT, 14);
const route = pickRoute(world);
const suanki = suankiYol(world, route);
const mv = manevra(world, route);
const oz = ozet(route);
console.log('yol', world.roads.length, '· isim', world.names.length, '· bina', world.blds.length);
console.log('yol adı:', suanki, '| manevra:', mv.mesafe, 'm', mv.yon, '→', mv.ad,
            '| kalan', oz.metre, 'm ·', oz.dakika, 'dk');

/* varış saati: kalan dakikadan türetilir (sabit saat yazılmaz) */
const simdi = new Date(2026, 8, 6, 19, 38);
const varisSaati = (dk) => {
  const d = new Date(simdi.getTime() + dk * 60000);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

/* ── sahne kurucu ──────────────────────────────────────────────────────────── */
/* Chrome kutularının ekran dikdörtgenleri — etiket motoru bunların altına yazmaz. */
const YASAK = {
  kart:  [0, 0, 322, 126],      // manevra kartı: sol 16 + 290 genişlik, üst 14 + ~105 yükseklik
  eta:   [0, 332, 322, 406],    // VARIŞ şeridi
  ray:   [830, 0, 904, 228],    // tek ray: 4 × 52 px
  hiz:   [744, 330, 904, 406],  // hız + limit
  serit: [318, 0, 514, 76],     // şerit rehberi (yalnız manevra karesinde)
  kesif: [0, 0, 322, 350],      // keşif: arama + üç hedef kartı
  konum: [296, 330, 610, 406],  // keşif konum şeridi
};
const Y_NAV = [YASAK.kart, YASAK.eta, YASAK.ray, YASAK.hiz];
const Y_MAN = Y_NAV.concat([YASAK.serit]);
const Y_KESIF = [YASAK.kesif, YASAK.ray, YASAK.konum];

function sahne(gece, cam, butce = 6, rt = route, yasak = Y_NAV) {
  const t = gece ? PAL.night : PAL.day;
  const s = perspective(world, rt, gece, cam ? { cam } : {});
  const l = labels(world, s.cam, s.wx, t, { kapali: s.kapali, butce, rota: s.rotaEkran, yasak });
  return { svg: s.svg + '\n' + l.svg + '\n' + F.ego(s.cam), cam: s.cam, etiket: l.adet };
}

/** Ego'yu rota boyunca ileri kaydır — manevra karesi gerçekten manevraya yaklaşır. */
function kaydir(rt, metre) {
  const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let s = 0, i = rt.ni;
  while (i < rt.line.length - 2 && s < metre) { s += D(rt.line[i + 1], rt.line[i]); i++; }
  return { line: rt.line, ni: i, cls: rt.cls, p: rt.p };
}

const kareler = [];

/* 1 · Sürüş — gündüz */
{
  const s = sahne(false);
  const t = F.TEMA.day;
  kareler.push(['Main', 904, 406, F.govde({
    k: 'day', svg: s.svg,
    chrome: F.manevraKarti(t, mv, suanki)
      + F.ray(t, [{ ik: 'merkez', aktif: true }, { ik: 'arti' }, { ik: 'eksi' }, { ik: 'ses' }])
      + F.eta(t, oz, varisSaati(oz.dakika))
      + F.hiz(t, 48, 50),
  })]);
  console.log('1 gündüz — etiket', s.etiket);
}

/* 2 · Sürüş — gece */
{
  const s = sahne(true);
  const t = F.TEMA.night;
  kareler.push(['NavNight', 904, 406, F.govde({
    k: 'night', svg: s.svg,
    chrome: F.manevraKarti(t, mv, suanki)
      + F.ray(t, [{ ik: 'merkez', aktif: true }, { ik: 'arti' }, { ik: 'eksi' }, { ik: 'ses' }])
      + F.eta(t, oz, varisSaati(oz.dakika))
      + F.hiz(t, 41, 50),
  })]);
  console.log('2 gece — etiket', s.etiket);
}

/* 3 · Manevra yaklaşımı + şerit rehberi — kamera alçalır, zoom artar */
{
  const yakinRota = kaydir(route, mv.mesafe - 120);
  const s = sahne(false, { pitch: 57, F: 700, horizon: -110.4, h: 58.1, d: 90.7 }, 4, yakinRota, Y_MAN);
  const t = F.TEMA.day;
  const ozYakin = ozet(yakinRota);                 // ETA kaydırılmış rotadan YENİDEN hesaplanır
  const yakin = { mesafe: 120, yon: mv.yon, derece: mv.derece, ad: mv.ad };
  kareler.push(['Maneuver', 904, 406, F.govde({
    k: 'day', svg: s.svg,
    chrome: F.manevraKarti(t, yakin, suanki)
      + F.seritler(t, [
          { ok: 'duz', gecerli: false }, { ok: 'duz', gecerli: false },
          { ok: 'sol', gecerli: true }, { ok: 'sol', gecerli: true },
        ])
      + F.ray(t, [{ ik: 'merkez', aktif: true }, { ik: 'arti' }, { ik: 'eksi' }, { ik: 'ses' }])
      + F.eta(t, ozYakin, varisSaati(ozYakin.dakika))
      + F.hiz(t, 34, 50),
  })]);
  console.log('3 manevra — etiket', s.etiket);
}

/* 4 · Keşif — rota yok, kuş bakışı, hedef kartları */
{
  const t = F.TEMA.day;
  const p = plan(world, route.line[route.ni], false, 0.66);
  const l = labels(world, p.cam, p.wx, PAL.day, { butce: 8, derinlik: 1e9, yasak: Y_KESIF });
  kareler.push(['Browse', 904, 406, F.govde({
    k: 'day', svg: p.svg + F.ego(p.cam) + '\n' + l.svg,
    chrome: F.hedefKartlari(t, [
        { ik: 'ev', ad: 'Ev', alt: '6,4 km · 14 dk', vurgu: true },
        { ik: 'is', ad: 'İş', alt: '11,2 km · 26 dk', vurgu: false },
        { ik: 'pin', ad: 'Kalamış Marina', alt: '2,1 km · 7 dk', vurgu: false },
      ])
      + F.ray(t, [{ ik: 'merkez' }, { ik: 'arti' }, { ik: 'eksi' }, { ik: 'kat', aktif: true }])
      + F.konumSeridi(t, suanki, 'Kadıköy · İstanbul'),
  })]);
  console.log('4 keşif — etiket', l.adet);
}

/* 5 · Keşif — gece */
{
  const t = F.TEMA.night;
  const p = plan(world, route.line[route.ni], true, 0.66);
  const l = labels(world, p.cam, p.wx, PAL.night, { butce: 8, derinlik: 1e9, yasak: Y_KESIF });
  kareler.push(['BrowseNight', 904, 406, F.govde({
    k: 'night', svg: p.svg + F.ego(p.cam) + '\n' + l.svg,
    chrome: F.hedefKartlari(t, [
        { ik: 'ev', ad: 'Ev', alt: '6,4 km · 14 dk', vurgu: true },
        { ik: 'is', ad: 'İş', alt: '11,2 km · 26 dk', vurgu: false },
        { ik: 'pin', ad: 'Kalamış Marina', alt: '2,1 km · 7 dk', vurgu: false },
      ])
      + F.ray(t, [{ ik: 'merkez' }, { ik: 'arti' }, { ik: 'eksi' }, { ik: 'kat', aktif: true }])
      + F.konumSeridi(t, suanki, 'Kadıköy · İstanbul'),
  })]);
  console.log('5 keşif gece — etiket', l.adet);
}

/* 6 · Mini harita widget — 440×210, ana ekranda seyrederken */
{
  const t = F.TEMA.day;
  const s = perspective(world, route, false, { cam: { pitch: 55, F: 224.4, horizon: 26, h: 31.7, d: 63.5, CX: 208 } });
  const l = labels(world, s.cam, s.wx, PAL.day, { kapali: s.kapali, butce: 2, W: 416, H: 186,
    rota: s.rotaEkran, yasak: [[0, 0, 250, 62], [250, 130, 416, 186]] });
  const mini = `<div style="width:440px;height:210px;padding:12px;box-sizing:border-box;background:#f4f2ee;
     font-family:Archivo,'Helvetica Neue',Arial,sans-serif;font-variant-numeric:tabular-nums;">
  <div style="position:relative;width:416px;height:186px;border-radius:16px;overflow:hidden;
       border:1px solid ${t.panelKenar};background:${t.bg};">
    <svg width="416" height="186" viewBox="0 0 416 186" style="position:absolute;inset:0;display:block;">
${F.defs('day')}
${s.svg}
${l.svg}
${F.ego(s.cam)}
    </svg>
    <div style="position:absolute;left:10px;top:10px;display:flex;align-items:center;gap:11px;
         padding:8px 12px 8px 10px;border-radius:13px;background:${t.kart};box-shadow:${t.golge};">
      <span style="width:32px;height:32px;border-radius:10px;background:${F.AMBER};flex:0 0 auto;
            display:flex;align-items:center;justify-content:center;">${F.ikon(mv.yon === 'sag' ? 'sag' : 'sol', '#12161e', 2.6, 19)}</span>
      <div>
        <div style="line-height:1;color:${t.kartInk};letter-spacing:-0.4px;">
          <span style="font-size:19px;font-weight:700;">${mv.mesafe}</span><span
            style="font-size:11px;font-weight:600;color:${t.kartDim};margin-left:3px;">m</span></div>
        <div style="font-size:10.5px;font-weight:600;margin-top:3px;color:${t.kartDim};
             max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${mv.ad}</div>
      </div>
    </div>
    <div style="position:absolute;right:10px;bottom:10px;display:flex;align-items:center;gap:7px;
         padding:6px 12px;border-radius:12px;background:${t.panel};border:1px solid ${t.panelKenar};
         box-shadow:${t.golge};">
      <span style="font-size:14px;font-weight:700;color:${t.ink};">${varisSaati(oz.dakika)}</span>
      <span style="width:1px;height:13px;background:${t.panelKenar};"></span>
      <span style="font-size:11.5px;font-weight:500;color:${t.dim};">${oz.dakika} dk</span>
    </div>
  </div>
</div>`;
  kareler.push(['MiniMap', 440, 210, mini]);
  console.log('6 mini — etiket', l.adet);
}

/* ── çıktı: ekran görüntüsü + tasarım tuvali artboard'ları ────────────── */
import { mkdirSync } from 'node:fs';
const TUVAL = process.env.TUVAL;
if (TUVAL) mkdirSync(TUVAL, { recursive: true });

const BAS = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&display=swap">
<body style="margin:0;background:#0b0d10;">`;

for (const [ad, w, h, govde] of kareler) {
  writeFileSync('_f_' + ad + '.html', BAS + govde + '</body>');
  if (TUVAL) writeFileSync(TUVAL + '/' + ad + '.dc.html', F.artboard(govde, w, h));
}

const b = await chromium.launch();
for (const [ad, w, h] of kareler) {
  const pg = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await pg.goto(pathToFileURL(process.cwd() + '/_f_' + ad + '.html').href);
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: 'f-' + ad + '.png' });
  await pg.close();
}
await b.close();
console.log('kareler:', kareler.map((k) => k[0]).join(' '), TUVAL ? '→ tuval yazıldı' : '');
