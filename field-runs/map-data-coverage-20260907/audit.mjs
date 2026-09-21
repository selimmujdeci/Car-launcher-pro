// Salt okunur ağ ölçümü; yalnız bu klasöre kanıt yazar, üretimi değiştirmez.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

export const point = { lat: 36.9175, lon: 34.8621 };
export function tileAt(lat, lon, z) {
  const n = 2 ** z;
  return { z, x: Math.floor((lon + 180) / 360 * n),
    y: Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n) };
}
export function bounds({ z, x, y }) {
  const lon = x0 => x0 / 2 ** z * 360 - 180;
  const lat = y0 => Math.atan(Math.sinh(Math.PI * (1 - 2 * y0 / 2 ** z))) * 180 / Math.PI;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}
export function histogram(values) {
  const result = {};
  for (const value of values) { const key = String(value ?? 'MISSING'); result[key] = (result[key] ?? 0) + 1; }
  return result;
}
export function partCount(geometry) {
  return geometry.type.startsWith('Multi') ? geometry.coordinates.length : 1;
}
export function decode(bytes, tile) {
  const decoded = new VectorTile(new Pbf(bytes));
  const layers = {};
  for (const [name, layer] of Object.entries(decoded.layers)) {
    layers[name] = Array.from({ length: layer.length }, (_, i) => layer.feature(i).toGeoJSON(tile.x, tile.y, tile.z));
  }
  return layers;
}
export function summarize(layers) {
  const props = name => (layers[name] ?? []).map(f => f.properties);
  const buildings = props('building');
  const names = props('transportation_name');
  return {
    counts: Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, v.length])),
    geometryParts: Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, v.reduce((n, f) => n + partCount(f.geometry), 0)])),
    buildingRenderHeight: histogram(buildings.map(p => p.render_height)),
    buildingHeight: histogram(buildings.map(p => p.height)),
    buildingHide3d: histogram(buildings.map(p => p.hide_3d)),
    building3dAccepted: buildings.filter(p => p.hide_3d !== true).length,
    roadClasses: histogram(props('transportation').map(p => p.class)),
    roadClassParts: histogram((layers.transportation ?? []).flatMap(f => Array(partCount(f.geometry)).fill(f.properties.class))),
    nameClasses: histogram(names.map(p => p.class)),
    streetNameFields: [...new Set(names.flatMap(p => Object.keys(p).filter(k => k.startsWith('name') || k === 'ref')))].sort(),
    distinctNames: [...new Set(names.map(p => p.name).filter(Boolean))].sort(),
    addressFields: Object.fromEntries(Object.entries(layers).map(([k, v]) => [k,
      histogram(v.flatMap(f => Object.keys(f.properties).filter(p => /addr|housenumber/i.test(p))))]).filter(([, v]) => Object.keys(v).length)),
  };
}
async function run() {
  const dir = fileURLToPath(new URL('./', import.meta.url));
  mkdirSync(dir, { recursive: true });
  const save = (name, data) => writeFileSync(dir + name, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2));
  const fetchBytes = async (url, body) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(55000),
      headers: { 'User-Agent': 'CarOSPro-MapCoverageAudit/1.0 (manual regional OSM comparison)', ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      ...(body ? { method: 'POST', body } : {}) });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return { bytes: Buffer.from(await r.arrayBuffer()), headers: Object.fromEntries(r.headers) };
  };
  const authority = 'https://tiles.openfreemap.org/planet';
  const metadata = await fetchBytes(authority);
  save('tilejson.json', metadata.bytes);
  const tj = JSON.parse(metadata.bytes);
  const center = tileAt(point.lat, point.lon, 14);
  const records = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const tile = { z: 14, x: center.x + dx, y: center.y + dy };
    const key = `${tile.z}-${tile.x}-${tile.y}`;
    const url = tj.tiles[0].replace('{z}', tile.z).replace('{x}', tile.x).replace('{y}', tile.y);
    const { bytes, headers } = await fetchBytes(url);
    save(`${key}.pbf`, bytes);
    const layers = decode(bytes, tile);
    save(`${key}.geojson.json`, layers);
    const record = { ...tile, bounds: bounds(tile), url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), headers, ...summarize(layers) };
    records.push(record);
    console.log(JSON.stringify({ tile, counts: record.counts, roadClasses: record.roadClasses }));
  }
  const summary = { measuredAt: new Date().toISOString(), point, coordinatePrecision: '7 Eylül 01-fullscreen-open.png üzerinde dört ondalık; daha yüksek hassasiyet kanıtlanmadı', authority,
    metadataHeaders: metadata.headers, providerMaxzoom: tj.maxzoom,
    displayZooms: [14, 15, 16].map(z => ({ displayZoom: z, geographicTile: tileAt(point.lat, point.lon, z), requestedSourceTile: center })), records };
  save('summary.json', summary);
  const [w, s, e, n] = bounds(center);
  const bbox = `${s},${w},${n},${e}`;
  const query = `[out:json][timeout:45];(nwr[building](${bbox});nwr["building:part"](${bbox});way[highway](${bbox});nwr["addr:housenumber"](${bbox});nwr["addr:interpolation"](${bbox});nwr[place](${bbox}););out meta geom;`;
  save('upstream-query.overpass', query);
  const osmUrl = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${[w, s, e, n].join(',')}`;
  try {
    const result = await fetchBytes(osmUrl);
    save('osm-api-map.json', result.bytes);
    save('osm-api-provenance.json', { url: osmUrl, at: new Date().toISOString(), headers: result.headers });
  } catch (error) { save('osm-api-error.json', { error: String(error) }); }
  const attempts = [];
  for (const endpoint of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
    try {
      const { bytes, headers } = await fetchBytes(endpoint, new URLSearchParams({ data: query }));
      const osm = JSON.parse(bytes);
      if (osm.remark || !Array.isArray(osm.elements)) throw new Error(osm.remark ?? 'Geçersiz yanıt');
      save('upstream.json', bytes);
      const elements = osm.elements;
      const b = elements.filter(x => x.tags?.building);
      const r = elements.filter(x => x.tags?.highway);
      const a = elements.filter(x => x.tags?.['addr:housenumber']);
      const upstream = { endpoint, headers, osm3s: osm.osm3s, sha256: createHash('sha256').update(bytes).digest('hex'), bounds: bounds(center), total: elements.length,
        buildings: b.length, buildingParts: elements.filter(x => x.tags?.['building:part']).length,
        roads: r.length, roadClasses: histogram(r.map(x => x.tags.highway)), namedRoads: r.filter(x => x.tags.name).length,
        unnamedRoads: r.filter(x => !x.tags.name).length, houseNumbers: a.length,
        addressedBuildings: b.filter(x => x.tags['addr:housenumber']).length,
        interpolation: elements.filter(x => x.tags?.['addr:interpolation']).length,
        places: elements.filter(x => x.tags?.place).length,
        roadEvidence: r.map(x => ({ type: x.type, id: x.id, timestamp: x.timestamp, tags: x.tags })),
        addressEvidence: a.map(x => ({ type: x.type, id: x.id, timestamp: x.timestamp, tags: x.tags })) };
      save('upstream-summary.json', upstream);
      console.log(JSON.stringify({ upstream: { ...upstream, roadEvidence: undefined, addressEvidence: undefined } }));
      return;
    } catch (error) { attempts.push({ endpoint, error: String(error) }); console.log(String(error)); }
  }
  save('upstream-errors.json', attempts);
  process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await run();
