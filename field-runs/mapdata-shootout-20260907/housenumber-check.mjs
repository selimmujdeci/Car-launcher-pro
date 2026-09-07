// MAPDATA-F4 doğrulama — kaydedilmiş GERÇEK üretim karosunda kapı numarası
// katmanının ne çizeceğini ölçer. Salt okunur; ağ yok, üretim değişmez.
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const here = new URL('./', import.meta.url);
const prev = new URL('../map-data-coverage-20260907/', import.meta.url);

// 1) Gerçek üretim stilini kaynaktan derle (audit ile aynı yöntem).
const source = readFileSync(new URL('../../src/platform/mapStyleBuilders.ts', here), 'utf8')
  .replaceAll('import.meta.env', '({VITE_VECTOR_TILE_URL:"https://tiles.openfreemap.org/planet"})')
  .replaceAll("'./map/_mapIds'", JSON.stringify(new URL('../../src/platform/map/_mapIds.ts', here).href));
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const builder = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const style = (night) => builder.buildVectorStyle(
  new Map([['local', { id: 'local', name: 'local', type: 'offline', description: '', isAvailable: true }]]),
  () => { throw new Error('raster fallback konu dışı'); }, night);

// 2) Kaydedilmiş gerçek karoyu çöz.
const tile = { z: 14, x: 9778, y: 6381 };
const bytes = readFileSync(new URL('14-9778-6381.pbf', prev));
const decoded = new VectorTile(new Pbf(bytes));
const layer = decoded.layers.housenumber;
const features = layer
  ? Array.from({ length: layer.length }, (_, i) => layer.feature(i).toGeoJSON(tile.x, tile.y, tile.z))
  : [];

const out = { tile: '14/9778/6381', measuredAt: new Date().toISOString().slice(0, 10), themes: {} };
for (const night of [false, true]) {
  const s = style(night);
  const l = s.layers.find((x) => x.id === 'housenumber');
  const accepted = l
    ? features.filter((f) => (l.filter ? featureFilter(l.filter).filter({ zoom: 17 }, { properties: f.properties, type: 1 }) : true))
    : [];
  out.themes[night ? 'night' : 'day'] = {
    layerExists: !!l,
    sourceLayer: l?.['source-layer'] ?? null,
    minzoom: l?.minzoom ?? null,
    textField: JSON.stringify(l?.layout?.['text-field'] ?? null),
    textOpacity: l?.paint?.['text-opacity'] ?? null,
    // Katman listesindeki konum: küçük indeks = çakışmada DAHA DÜŞÜK öncelik.
    indexOfHousenumber: s.layers.findIndex((x) => x.id === 'housenumber'),
    indexOfRoadLabel: s.layers.findIndex((x) => x.id === 'road-label'),
    tileFeatureCount: features.length,
    acceptedAtZ17: accepted.length,
    values: accepted.map((f) => f.properties.housenumber ?? null),
  };
}
writeFileSync(new URL('housenumber-check.json', here), JSON.stringify(out, null, 2), 'utf8');
const d = out.themes.day;
console.log('katman var mı        :', d.layerExists, '· source-layer:', d.sourceLayer);
console.log('minzoom              :', d.minzoom);
console.log('text-field           :', d.textField);
console.log('karo housenumber      :', d.tileFeatureCount, '· z17 kabul:', d.acceptedAtZ17);
console.log('değerler             :', JSON.stringify(d.values));
console.log('çakışma sırası        : housenumber', d.indexOfHousenumber, '< road-label', d.indexOfRoadLabel,
  '→', d.indexOfHousenumber < d.indexOfRoadLabel ? 'sokak adı ÖNCELİKLİ (doğru)' : 'HATA');
console.log('gece opaklık          :', out.themes.night.textOpacity, '· gündüz:', d.textOpacity);
