// MAPDATA-F2 — sınırlı Tarsus fixture üretici (deterministik, salt okunur).
// Çıktı: src/__tests__/fixtures/mapdataTarsusNear.json
import { readFileSync, writeFileSync } from 'node:fs';
const here = new URL('./', import.meta.url);
const prev = new URL('../map-data-coverage-20260907/', import.meta.url);
const read = (b, n) => JSON.parse(readFileSync(new URL(n, b), 'utf8'));
const NEAR = { xmin: 34.85985, ymin: 36.9157, xmax: 34.86435, ymax: 36.9193 };
const inNear = (lo, la) => lo >= NEAR.xmin && lo <= NEAR.xmax && la >= NEAR.ymin && la <= NEAR.ymax;

const ov = read(here, 'overture-buildings.json')
  .map((b) => ({ ...b, geometry: JSON.parse(b.geojson), sources: JSON.parse(b.sources_json) }))
  .filter((b) => {
    const c = b.geometry.type === 'Polygon' ? b.geometry.coordinates : b.geometry.coordinates.flat();
    return c.some((ring) => ring.some(([lo, la]) => inNear(lo, la)));
  })
  .map((b) => ({ id: b.id, name: b.name, height: b.height, num_floors: b.num_floors,
                 class: b.class, subtype: b.subtype, sources: b.sources, geometry: b.geometry }))
  .sort((a, b) => a.id.localeCompare(b.id));

const osm = read(prev, 'osm-api-map.json');
const nodes = new Map(osm.elements.filter((e) => e.type === 'node').map((n) => [n.id, [n.lon, n.lat]]));
const osmBuildings = osm.elements
  .filter((e) => e.type === 'way' && e.tags?.building)
  .map((w) => ({ id: w.id, type: 'way', timestamp: w.timestamp ?? null, version: w.version ?? null,
                 tags: w.tags, ring: (w.nodes ?? []).map((id) => nodes.get(id)).filter(Boolean) }))
  .filter((w) => w.ring.some(([lo, la]) => inNear(lo, la)))
  .sort((a, b) => a.id - b.id);

const out = {
  note: 'MAPDATA-F2 sınırlı fixture. Gerçek ölçümden türetildi; UYDURMA VERİ YOKTUR.',
  area: { bbox: [NEAR.xmin, NEAR.ymin, NEAR.xmax, NEAR.ymax], description: 'Tarsus ~400x400 m, canonical nokta 36.9175/34.8621' },
  provenance: {
    overtureRelease: '2026-08-19.0',
    overtureRetrievedFrom: 's3://overturemaps-us-west-2/release/2026-08-19.0/theme=buildings',
    osmSource: 'field-runs/map-data-coverage-20260907/osm-api-map.json (6 Eylül 2026 çekimi)',
    attribution: '© OpenStreetMap katkıcıları (ODbL) · © Overture Maps Foundation · Microsoft ML Buildings (ODbL-1.0)',
  },
  counts: { overtureBuildings: ov.length, osmBuildings: osmBuildings.length },
  overtureBuildings: ov,
  osmBuildings,
};
writeFileSync(new URL('../../src/__tests__/fixtures/mapdataTarsusNear.json', here), JSON.stringify(out, null, 1), 'utf8');
console.log('fixture:', out.counts);
