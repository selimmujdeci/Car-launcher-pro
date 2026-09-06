import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { writeFileSync } from 'node:fs';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const tj = await (await fetch(TILEJSON)).json();
console.log('TileJSON:', tj.name || '(ad yok)', '| minzoom', tj.minzoom, '| maxzoom', tj.maxzoom);
const tmpl = (tj.tiles && tj.tiles[0]) || null;
if (!tmpl) { console.error('tiles şablonu yok'); process.exit(2); }
console.log('şablon:', tmpl);

const LOC = { ad: 'Tarsus', lon: 34.8620, lat: 36.9178 };
const zooms = [8, 10, 12, 13, 14];
const toXY = (lon, lat, z) => {
  const n = 2 ** z;
  const x = Math.floor((lon + 180) / 360 * n);
  const r = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  return [x, y];
};

/** layer -> class -> { zoomlar, adet, subclass:Set, ornekProps:Set } */
const inv = new Map();
for (const z of zooms) {
  const [x, y] = toXY(LOC.lon, LOC.lat, z);
  const url = tmpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const res = await fetch(url);
  if (!res.ok) { console.log(`z${z} ${x}/${y} -> HTTP ${res.status}`); continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  const tile = new VectorTile(new Pbf(buf));
  const names = Object.keys(tile.layers);
  console.log(`z${z} ${x}/${y}  ${(buf.length/1024).toFixed(1)} KB  katman: ${names.length}`);
  for (const ln of names) {
    const layer = tile.layers[ln];
    if (!inv.has(ln)) inv.set(ln, new Map());
    const classes = inv.get(ln);
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      const p = f.properties || {};
      const cls = String(p['class'] ?? p['subclass'] ?? '(class yok)');
      if (!classes.has(cls)) classes.set(cls, { zooms: new Set(), n: 0, sub: new Set(), props: new Set(), geom: new Set() });
      const rec = classes.get(cls);
      rec.zooms.add(z); rec.n++;
      if (p['subclass']) rec.sub.add(String(p['subclass']));
      rec.geom.add(['?', 'point', 'line', 'polygon'][f.type] || '?');
      for (const k of Object.keys(p)) if (rec.props.size < 14) rec.props.add(k);
    }
  }
}

const out = [];
out.push('| Source layer | class | geometri | zoom görünürlüğü | karo başına adet | subclass örnekleri |');
out.push('|---|---|---|---|---|---|');
const rows = [];
for (const [ln, classes] of [...inv.entries()].sort()) {
  for (const [cls, r] of [...classes.entries()].sort((a, b) => b[1].n - a[1].n)) {
    rows.push({ ln, cls, geom: [...r.geom].join('/'), z: [...r.zooms].sort((a,b)=>a-b), n: r.n, sub: [...r.sub].slice(0, 6), props: [...r.props] });
  }
}
for (const r of rows) {
  out.push(`| \`${r.ln}\` | \`${r.cls}\` | ${r.geom} | z${r.z.join(' · z')} | ${r.n} | ${r.sub.join(', ') || '—'} |`);
}
writeFileSync('field-runs/carto-2026-09-06/schema-inventory.md', out.join('\n'));
writeFileSync('field-runs/carto-2026-09-06/schema-inventory.json', JSON.stringify(rows, null, 1));
console.log('\ntoplam satır:', rows.length);
console.log('katmanlar:', [...inv.keys()].sort().join(' · '));
