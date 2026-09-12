import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync('src/platform/mapStyleBuilders.ts', 'utf8');
const start = src.indexOf('export function buildVectorLayers');
const body = src.slice(start);
// { id: 'x', ... } bloklarını kabaca ayıkla
const re = /\{\s*id:\s*'([^']+)'[\s\S]*?\}/g;
const ids = [...body.matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]);
const rows = [];
for (const id of ids) {
  const i = body.indexOf(`id: '${id}'`);
  const seg = body.slice(i, i + 900);
  const type = (seg.match(/type:\s*'([a-z-]+)'/) || [])[1] || '?';
  const sl = (seg.match(/'source-layer':\s*'([^']+)'/) || [])[1] || '—';
  const minz = (seg.match(/minzoom:\s*([A-Za-z0-9_.]+)/) || [])[1] || '0';
  const maxz = (seg.match(/maxzoom:\s*([A-Za-z0-9_.]+)/) || [])[1] || '—';
  const filt = (seg.match(/filter:\s*([^\n]+)/) || [])[1] || '—';
  rows.push({ id, type, sl, minz, maxz, filter: filt.slice(0, 78) });
}
console.log('toplam katman:', rows.length);
console.log('id'.padEnd(26), 'tip'.padEnd(15), 'source-layer'.padEnd(20), 'minz'.padEnd(28), 'filtre');
for (const r of rows) console.log(r.id.padEnd(26), r.type.padEnd(15), r.sl.padEnd(20), String(r.minz).padEnd(28), r.filter);
writeFileSync('field-runs/carto-2026-09-06/style-layers.json', JSON.stringify(rows, null, 1));
