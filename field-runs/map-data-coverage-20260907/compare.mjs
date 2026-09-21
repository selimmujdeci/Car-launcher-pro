// Kaydedilmiş OSM/production verisini ortak alanda karşılaştırır; ağ kullanmaz.
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import { histogram, summarize } from './audit.mjs';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const save = (name, value) => writeFileSync(new URL(name, import.meta.url), JSON.stringify(value, null, 2));
const summary = read('summary.json');
for (const r of summary.records) Object.assign(r, summarize(read(`${r.z}-${r.x}-${r.y}.geojson.json`)));
save('summary.json', summary);
const tile = read('14-9778-6381.geojson.json');
const osm = read('osm-api-map.json');
const nodes = new Map(osm.elements.filter(x => x.type === 'node').map(x => [x.id, [x.lon, x.lat]]));
const coords = way => (way.nodes ?? []).map(id => nodes.get(id)).filter(Boolean);
const extent = points => [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
const middle = ring => { const b = extent(ring); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };
const inside = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
function inRing(p, ring) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}
function interiorPoint(ring) {
  const center = middle(ring);
  if (inRing(center, ring)) return center;
  const [w, s, e, n] = extent(ring);
  for (let y = 1; y < 20; y++) for (let x = 1; x < 20; x++) {
    const p = [w + (e - w) * x / 20, s + (n - s) * y / 20];
    if (inRing(p, ring)) return p;
  }
  throw Error('Bina içinde doğrulanmış örnek nokta bulunamadı');
}
const polygons = tile.building.flatMap(f => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map(p => ({ id: f.id, properties: f.properties, rings: p })));
const sourceBuildings = osm.elements.filter(x => x.tags?.building && x.type === 'way' && coords(x).length >= 4);
const buildingMatches = sourceBuildings.map(b => {
  const p = interiorPoint(coords(b));
  const matches = polygons.filter(f => inRing(p, f.rings[0]) && !f.rings.slice(1).some(r => inRing(p, r)));
  return { id: b.id, timestamp: b.timestamp, tags: b.tags, point: p, tileIds: matches.map(x => x.id) };
});
const roads = osm.elements.filter(x => x.tags?.highway && x.type === 'way');
const focalBounds = [34.85985, 36.9157, 34.86435, 36.9193];
const names = tile.transportation_name;
const named = roads.filter(x => x.tags.name);
const normalize = s => s.toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
const byName = name => names.filter(f => f.properties.name && normalize(f.properties.name) === normalize(name));
const nameMatches = named.map(r => ({ id: r.id, timestamp: r.timestamp, name: r.tags.name, highway: r.tags.highway,
  tiles: byName(r.tags.name).map(f => ({ id: f.id, class: f.properties.class, name: f.properties.name })) }));
const source = readFileSync(new URL('../../src/platform/mapStyleBuilders.ts', import.meta.url), 'utf8')
  .replaceAll('import.meta.env', '({VITE_VECTOR_TILE_URL:"https://tiles.openfreemap.org/planet"})')
  .replaceAll("'./map/_mapIds'", JSON.stringify(new URL('../../src/platform/map/_mapIds.ts', import.meta.url).href));
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, removeComments: true } }).outputText;
const builder = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const styles = {};
for (const night of [false, true]) {
  const style = builder.buildVectorStyle(new Map(), () => { throw Error('Beklenmeyen raster fallback'); }, night);
  const key = night ? 'night' : 'day';
  save(`style-${key}.json`, style);
  styles[key] = [14, 15, 16].map(zoom => ({ zoom, layers: style.layers.filter(l => ['building','building-3d','road-label','road-label-major'].includes(l.id)).map(l => {
    const features = tile[l['source-layer']] ?? [];
    const filter = featureFilter(l.filter);
    const accepted = features.filter(f => filter.filter({ zoom }, { type: f.geometry.type.includes('Polygon') ? 3 : f.geometry.type.includes('Line') ? 2 : 1, properties: f.properties }));
    return { id: l.id, minzoom: l.minzoom, maxzoom: l.maxzoom ?? null, visibility: l.layout?.visibility ?? 'visible', accepted: accepted.length, zoomEligible: zoom >= (l.minzoom ?? 0) && zoom < (l.maxzoom ?? 24) };
  }) }));
}
const fullBounds = summary.records[4].bounds;
const inCore = buildingMatches.filter(b => inside(b.point, fullBounds));
const report = {
  method: 'OSM map API yollarını node koordinatlarından kurar; kaynak bina içinde doğrulanmış örnek nokta production polygon içinde mi ölçer. Concave polygon için bbox ortası içeride değilse iç nokta taranır. Bu tam polygon özdeşliği değildir. Yol adı eşleşmesi geometri özdeşliği kanıtı değildir.',
  upstream: { provenance: read('osm-api-provenance.json'), elements: osm.elements.length,
    buildings: sourceBuildings.length, buildingRelations: osm.elements.filter(x => x.type === 'relation' && x.tags?.building).length,
    buildingPoints: osm.elements.filter(x => x.type === 'node' && x.tags?.building).length,
    roads: roads.length, namedRoads: named.length, unnamedRoads: roads.length - named.length,
    roadClasses: histogram(roads.map(x => x.tags.highway)), unnamedRoadClasses: histogram(roads.filter(x => !x.tags.name).map(x => x.tags.highway)),
    addresses: osm.elements.filter(x => x.tags?.['addr:housenumber']).map(x => ({ type: x.type, id: x.id, tags: x.tags })),
    interpolation: osm.elements.filter(x => x.tags?.['addr:interpolation']).length,
    buildingAddressAttributes: sourceBuildings.filter(x => Object.keys(x.tags).some(k => k.startsWith('addr:'))).length,
    places: osm.elements.filter(x => x.tags?.place).map(x => ({ id: x.id, tags: x.tags })),
    overpassBase: read('upstream.json').osm3s,
  },
  buildings: { coreCentroids: inCore.length, coreMatched: inCore.filter(b => b.tileIds.length).length, unmatched: inCore.filter(b => !b.tileIds.length), allMatches: buildingMatches },
  focal: { bounds: focalBounds, sourceBuildings: buildingMatches.filter(b => inside(b.point, focalBounds)),
    tilePolygons: polygons.filter(p => inside(middle(p.rings[0]), focalBounds)).length,
    roads: roads.filter(r => coords(r).some(p => inside(p, focalBounds))).map(r => ({ id: r.id, tags: r.tags })),
    houseNumbers: (tile.housenumber ?? []).filter(f => inside(f.geometry.coordinates, focalBounds)) },
  names: { matchedWays: nameMatches.filter(x => x.tiles.length).length, absentNames: nameMatches.filter(x => !x.tiles.length),
    numberedTileFeatures: names.filter(f => /^\d+[.\s]/.test(f.properties.name ?? '')).length,
    examples: nameMatches.filter(x => /0443|0469|Gazipaşa/.test(x.name)) },
  style: styles,
};
save('comparison.json', report);
console.log(JSON.stringify({ upstream: { ...report.upstream, provenance: undefined, addresses: report.upstream.addresses.length, places: report.upstream.places.length },
  buildings: { core: inCore.length, matched: report.buildings.coreMatched, unmatched: report.buildings.unmatched },
  focal: { buildings: report.focal.sourceBuildings.length, tilePolygons: report.focal.tilePolygons, roads: report.focal.roads.length, namedRoads: report.focal.roads.filter(r => r.tags.name).length, houseNumbers: report.focal.houseNumbers.length }, names: report.names, style: styles }, null, 2));
