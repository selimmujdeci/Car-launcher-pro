import { collect } from './gen.mjs';
import { perspective, pickRoute, nameFor, plan } from './scene.mjs';
import { labels } from './labels.mjs';
import { PAL } from './gen.mjs';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const LON = 29.0300, LAT = 40.9900;                       // Kadıköy
console.log('karolar indiriliyor…');
const world = await collect(LON, LAT, 14);
console.log('yol', world.roads.length, '· isim', world.names.length,
            '· su', world.water.length, '· yeşil', world.green.length, '· bina', world.blds.length);

const route = pickRoute(world);
console.log('rota sınıfı:', route && route.cls, '| nokta', route && route.line.length,
            '| ad:', route ? JSON.stringify((nameFor(world, route.line) || {}).name) : '-');

const day = perspective(world, route, false);
const night = perspective(world, route, true);
const ldD = labels(world, day.cam, day.wx, PAL.day, { kapali: day.kapali });
const ldN = labels(world, night.cam, night.wx, PAL.night, { kapali: night.kapali });
console.log('etiket — gündüz', ldD.adet, '· gece', ldN.adet);
day.svg += String.fromCharCode(10) + ldD.svg;
night.svg += String.fromCharCode(10) + ldN.svg;
const pl = plan(world, route.line[route.ni], false, 0.62);

const SKY = {
  day:   ['#cfdcea', '#e4ebf2'],   // üst → ufuk
  night: ['#0d1420', '#1d2738'],
};
const wrap = (svg, bg, k) => `<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#111">
<svg width="904" height="406" viewBox="0 0 904 406" style="display:block;background:${bg}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${SKY[k][0]}"/><stop offset="1" stop-color="${SKY[k][1]}"/>
</linearGradient>
<linearGradient id="rot" x1="0" y1="1" x2="0" y2="0">
<stop offset="0" stop-color="#006CFF"/><stop offset=".55" stop-color="#0057D9"/><stop offset="1" stop-color="#00A6FF"/>
</linearGradient>
<linearGradient id="fog" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${bg}" stop-opacity=".92"/><stop offset="1" stop-color="${bg}" stop-opacity="0"/>
</linearGradient>
</defs>
${svg}
</svg></body>`;

writeFileSync('_p_day.html', wrap(day.svg, '#e4ebf2', 'day'));
writeFileSync('_p_night.html', wrap(night.svg, '#1d2738', 'night'));
writeFileSync('_p_plan.html', wrap(pl.svg, '#e9eef3', 'day'));

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 904, height: 406 }, deviceScaleFactor: 2 });
for (const [f, out] of [['_p_day.html', 'r-nav-day.png'], ['_p_night.html', 'r-nav-night.png'], ['_p_plan.html', 'r-plan-day.png']]) {
  await pg.goto(pathToFileURL(process.cwd() + '/' + f).href);
  await pg.waitForTimeout(250);
  await pg.screenshot({ path: out });
  console.log('yazıldı', out);
}
await b.close();
