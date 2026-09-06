import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const tmpl = tj.tiles[0];
const toXY = (lon, lat, z) => { const n = 2 ** z, r = lat * Math.PI / 180;
  return [Math.floor((lon + 180) / 360 * n),
          Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)]; };
const [x, y] = toXY(34.8620, 36.9178, 14);
const buf = Buffer.from(await (await fetch(tmpl.replace('{z}',14).replace('{x}',x).replace('{y}',y))).arrayBuffer());
const t = new VectorTile(new Pbf(buf));
for (const ln of ['building', 'transportation', 'transportation_name', 'water', 'landcover']) {
  const L = t.layers[ln]; if (!L) { console.log(ln, 'YOK'); continue; }
  console.log('=== ' + ln + ' · ' + L.length + ' feature · extent ' + L.extent);
  const seen = new Set();
  for (let i = 0; i < Math.min(L.length, 400); i++) {
    const f = L.feature(i);
    const k = Object.keys(f.properties).sort().join(',');
    if (seen.has(k)) continue; seen.add(k);
    console.log('   tip', f.type, '|', JSON.stringify(f.properties).slice(0, 190));
    if (seen.size > 5) break;
  }
}
