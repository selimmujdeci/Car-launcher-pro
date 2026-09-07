/**
 * #1318 — kapı numarası FİLTRESİ doğrulaması (salt okunur ölçüm).
 *
 * Üretim stilini kaynaktan derler ve kaydedilmiş DOKUZ gerçek üretim
 * karosundaki TÜM `housenumber` kayıtlarını filtreden geçirir. Amaç: filtrenin
 * yalnız makul olmayan değeri elediğini, meşru numaraları KESMEDİĞİNİ kanıtlamak.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import ts from 'typescript';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const TILES = fileURLToPath(new URL('../map-data-coverage-20260907/', import.meta.url));

const source = readFileSync(new URL('../../src/platform/mapStyleBuilders.ts', import.meta.url), 'utf8')
  .replaceAll('import.meta.env', '({VITE_VECTOR_TILE_URL:"https://tiles.openfreemap.org/planet"})')
  .replaceAll("'./map/_mapIds'", JSON.stringify(new URL('../../src/platform/map/_mapIds.ts', import.meta.url).href));
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const builder = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

const style = builder.buildVectorStyle(
  new Map([['local', { id: 'local', name: 'local', type: 'offline', description: '', isAvailable: true }]]),
  () => { throw new Error('raster fallback konu dışı'); }, false);
const layer = style.layers.find((l) => l.id === 'housenumber');
const filter = featureFilter(layer.filter);

const accepted = [];
const rejected = [];
for (const file of readdirSync(TILES).filter((n) => n.startsWith('14-') && n.endsWith('.pbf'))) {
  const [z, x, y] = file.replace('.pbf', '').split('-').map(Number);
  const L = new VectorTile(new Pbf(readFileSync(TILES + file))).layers.housenumber;
  if (!L) continue;
  for (let i = 0; i < L.length; i++) {
    const g = L.feature(i).toGeoJSON(x, y, z);
    const value = g.properties.housenumber;
    const coords = g.geometry.type === 'Point' ? g.geometry.coordinates : null;
    const row = {
      tile: file, value,
      lon: coords ? Number(coords[0].toFixed(6)) : null,
      lat: coords ? Number(coords[1].toFixed(6)) : null,
    };
    if (filter.filter({ zoom: 17 }, { properties: g.properties, type: 1 })) accepted.push(row);
    else rejected.push(row);
  }
}

const uniq = (rows) => [...new Set(rows.map((r) => String(r.value)))].sort();
const out = {
  filter: JSON.stringify(layer.filter),
  minzoom: layer.minzoom,
  totalRecords: accepted.length + rejected.length,
  acceptedRecords: accepted.length,
  rejectedRecords: rejected.length,
  acceptedValues: uniq(accepted),
  rejectedValues: uniq(rejected),
  longestAcceptedValue: uniq(accepted).reduce((a, b) => (b.length > a.length ? b : a), ''),
  accepted, rejected,
};
writeFileSync(HERE + 'housenumber-filter-check.json', JSON.stringify(out, null, 2), 'utf8');

console.log('filtre           :', out.filter);
console.log('toplam kayıt     :', out.totalRecords);
console.log('GEÇEN            :', out.acceptedRecords, '· en uzun değer:', JSON.stringify(out.longestAcceptedValue));
console.log('REDDEDİLEN       :', out.rejectedRecords, JSON.stringify(out.rejectedValues));
console.log('-> housenumber-filter-check.json');
