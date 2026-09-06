import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const tmpl = tj.tiles[0];
const toXY = (lon, lat, z) => { const n = 2 ** z, r = lat * Math.PI / 180;
  return [Math.floor((lon + 180) / 360 * n),
          Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)]; };
const LOCS = [
  ['Tarsus merkez', 34.8951, 36.9177], ['Tarsus ev', 34.8620, 36.9178],
  ['Mersin merkez', 34.6333, 36.8000], ['Adana merkez', 35.3213, 37.0000],
  ['Kadıköy', 29.0300, 40.9900], ['Beşiktaş', 29.0060, 41.0430],
];
for (const [ad, lon, lat] of LOCS) {
  const [x, y] = toXY(lon, lat, 14);
  const res = await fetch(tmpl.replace('{z}', 14).replace('{x}', x).replace('{y}', y));
  if (!res.ok) { console.log(ad, 'HTTP', res.status); continue; }
  const t = new VectorTile(new Pbf(Buffer.from(await res.arrayBuffer())));
  const c = {}; const cls = {};
  for (const ln of Object.keys(t.layers)) c[ln] = t.layers[ln].length;
  const T = t.layers['transportation'];
  if (T) for (let i = 0; i < T.length; i++) { const k = T.feature(i).properties['class']; cls[k] = (cls[k] || 0) + 1; }
  let hMax = 0; const B = t.layers['building'];
  if (B) for (let i = 0; i < B.length; i++) hMax = Math.max(hMax, B.feature(i).properties['render_height'] || 0);
  console.log(ad.padEnd(14), 'bina', String(c.building || 0).padStart(4),
    '(maks h ' + hMax + 'm)', '| yol', String(c.transportation || 0).padStart(4),
    '| su', String(c.water || 0).padStart(3), '| yeşil', String((c.landcover||0)+(c.park||0)).padStart(3),
    '|', JSON.stringify(cls).slice(0, 120));
}
