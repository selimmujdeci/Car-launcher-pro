// MAPDATA-F1 — Tarsus çok kaynaklı karşılaştırma (SALT OKUNUR).
// Girdi: bu klasördeki Overture çekimi + ../map-data-coverage-20260907/ OSM &
// OpenFreeMap kanıtları. Çıktı: shootout.json + konsol özeti. Üretimi değiştirmez.
import { readFileSync, writeFileSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const prev = new URL('../map-data-coverage-20260907/', import.meta.url);
const read = (base, name) => JSON.parse(readFileSync(new URL(name, base), 'utf8'));

const TILE_BBOX = [34.8486328125, 36.91476428895592, 34.87060546875, 36.93233006150314];
const NEAR_BBOX = [34.85985, 36.9157, 36.9193 && 34.86435, 36.9193];
const NEAR = { xmin: 34.85985, ymin: 36.9157, xmax: 34.86435, ymax: 36.9193 };
const ROOFS = [
  [34.861475229263306, 36.918384129749924],
  [34.86132502555847, 36.9179295146294],
  [34.8616361618042, 36.91821257719264],
];

/* ── yardımcılar ─────────────────────────────────────────────────────────── */
const hist = (arr) => arr.reduce((m, v) => (m[v] = (m[v] ?? 0) + 1, m), {});
const parseSources = (json) => { try { return JSON.parse(json) ?? []; } catch { return []; } };

function ringsOf(geojson) {
  const g = JSON.parse(geojson);
  if (g.type === 'Polygon') return g.coordinates;
  if (g.type === 'MultiPolygon') return g.coordinates.flat();
  return [];
}
function coordsOf(geojson) {
  const g = JSON.parse(geojson);
  if (g.type === 'LineString') return g.coordinates;
  if (g.type === 'MultiLineString') return g.coordinates.flat();
  if (g.type === 'Point') return [g.coordinates];
  if (g.type === 'Polygon') return g.coordinates.flat();
  return [];
}
function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1])
      && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const R = 6371000;
function metres(a, b) {
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const lat = (a[1] + b[1]) / 2 * Math.PI / 180;
  return Math.hypot(dLat, dLon * Math.cos(lat)) * R;
}
const inNear = (lon, lat) => lon >= NEAR.xmin && lon <= NEAR.xmax && lat >= NEAR.ymin && lat <= NEAR.ymax;

/* ── 1) OSM tabanı (önceki denetimin kaydettiği ham yanıt) ───────────────── */
const osm = read(prev, 'osm-api-map.json');
const osmEls = osm.elements ?? [];
const osmWays = osmEls.filter((e) => e.type === 'way');
const osmBuildingWays = osmWays.filter((w) => w.tags?.building);
const osmHighwayWays = osmWays.filter((w) => w.tags?.highway);
const osmNamedHighways = osmHighwayWays.filter((w) => w.tags?.name);
const osmNodes = new Map(osmEls.filter((e) => e.type === 'node').map((n) => [n.id, [n.lon, n.lat]]));
const osmBuildingWayIds = new Set(osmBuildingWays.map((w) => w.id));
const osmHighwayWayIds = new Set(osmHighwayWays.map((w) => w.id));
const osmAddrNodes = osmEls.filter((e) => e.tags?.['addr:housenumber']);

const wayPts = (w) => (w.nodes ?? []).map((id) => osmNodes.get(id)).filter(Boolean);
const osmBuildingsNear = osmBuildingWays.filter((w) => wayPts(w).some(([lo, la]) => inNear(lo, la)));

/* ── 2) OpenFreeMap üretim karosu (önceki denetimin özeti) ───────────────── */
const summary = read(prev, 'summary.json');
const center = (summary.records ?? []).find((r) => r.z === 14 && r.x === 9778 && r.y === 6381) ?? {};
const centerKey = center.url ?? null;

/* ── 3) Overture ─────────────────────────────────────────────────────────── */
const buildings = read(here, 'overture-buildings.json');
const segments = read(here, 'overture-segments.json');
const addresses = read(here, 'overture-addresses.json');
const places = read(here, 'overture-places.json');

const datasetOf = (r) => parseSources(r.sources_json).map((s) => s.dataset ?? 'UNKNOWN');
const licenseOf = (r) => parseSources(r.sources_json).map((s) => s.license ?? 'UNKNOWN');
const osmRecordIds = (r) => parseSources(r.sources_json)
  .filter((s) => /openstreetmap/i.test(s.dataset ?? ''))
  .map((s) => String(s.record_id ?? ''))
  .filter(Boolean);

const buildingDatasets = hist(buildings.flatMap(datasetOf));
const buildingLicenses = hist(buildings.flatMap(licenseOf));
const segmentDatasets = hist(segments.flatMap(datasetOf));
const placeDatasets = hist(places.flatMap(datasetOf));

// OSM kökenli Overture binası: record_id `w<id>@<ver>` biçimindedir.
const wayIdOf = (rec) => { const m = /^w(\d+)/.exec(rec); return m ? Number(m[1]) : null; };
let osmBacked = 0, osmBackedMatchingOurSet = 0, nonOsm = 0;
for (const b of buildings) {
  const ids = osmRecordIds(b).map(wayIdOf).filter((n) => n !== null);
  if (ids.length > 0) {
    osmBacked += 1;
    if (ids.some((id) => osmBuildingWayIds.has(id))) osmBackedMatchingOurSet += 1;
  } else nonOsm += 1;
}

// Yakın 400x400 m alan.
const buildingsNear = buildings.filter((b) => ringsOf(b.geojson)
  .some((ring) => ring.some(([lo, la]) => inNear(lo, la))));
const buildingsNearNonOsm = buildingsNear.filter((b) => osmRecordIds(b).length === 0);

/* ── 4) Uydu çatı örnekleri — Overture'da var mı ─────────────────────────── */
const roofProbe = ROOFS.map((pt, i) => {
  let containing = null, nearestM = Infinity, nearestId = null, nearestDatasets = null;
  for (const b of buildings) {
    const rings = ringsOf(b.geojson);
    if (rings.length > 0 && pointInRing(pt, rings[0])) { containing = b; break; }
    for (const ring of rings) {
      for (const c of ring) {
        const d = metres(pt, c);
        if (d < nearestM) { nearestM = d; nearestId = b.id; nearestDatasets = datasetOf(b); }
      }
    }
  }
  // Piksel üzerinden ELLE seçilen nokta ±10 m sapabilir; bu yüzden "içinde mi"
  // sorusunun yanında 30 m yarıçapta KAÇ Overture binası olduğu da ölçülür.
  let within30 = 0;
  for (const b of buildings) {
    let close = false;
    for (const ring of ringsOf(b.geojson)) {
      for (const c of ring) { if (metres(pt, c) <= 30) { close = true; break; } }
      if (close) break;
    }
    if (close) within30 += 1;
  }
  return {
    index: i, lon: pt[0], lat: pt[1],
    overtureContains: containing ? { id: containing.id, datasets: datasetOf(containing) } : null,
    nearestOvertureVertexMetres: containing ? 0 : Number(nearestM.toFixed(1)),
    nearestOvertureId: containing ? containing.id : nearestId,
    nearestOvertureDatasets: containing ? datasetOf(containing) : nearestDatasets,
    overtureBuildingsWithin30m: within30,
    priorOsmNearestVertexMetres: [111.2, 111.1, 128.3][i],
  };
});

/* ── 5) Yollar ───────────────────────────────────────────────────────────── */
const segNamed = segments.filter((s) => s.name);
const segRoads = segments.filter((s) => s.subtype === 'road');
const segRoadsNamed = segRoads.filter((s) => s.name);
const segByClass = hist(segments.map((s) => s.class ?? 'UNKNOWN'));
const overtureNames = new Set(segNamed.map((s) => String(s.name).trim()));
const osmNames = new Set(osmNamedHighways.map((w) => String(w.tags.name).trim()));
const namesOnlyInOverture = [...overtureNames].filter((n) => !osmNames.has(n)).sort();
const namesOnlyInOsm = [...osmNames].filter((n) => !overtureNames.has(n)).sort();

// Overture segmentlerinin OSM kökeni.
const segOsmBacked = segments.filter((s) => osmRecordIds(s).length > 0).length;

/* ── 6) Adres / POI ──────────────────────────────────────────────────────── */
const addressCount = Array.isArray(addresses) ? addresses.length : 0;
const centerHousenumbers = center?.counts?.housenumber ?? null;
const placesNamed = places.filter((p) => p.name).length;
const placesNonOsm = places.filter((p) => osmRecordIds(p).length === 0).length;

/* ── 7) Rapor ────────────────────────────────────────────────────────────── */
const report = {
  measuredAt: new Date().toISOString().slice(0, 10),
  area: { tileBbox: TILE_BBOX, nearBbox: NEAR, tile: '14/9778/6381', canonicalPoint: [36.9175, 34.8621] },
  baselines: {
    osm: {
      source: 'field-runs/map-data-coverage-20260907/osm-api-map.json',
      buildingWays: osmBuildingWays.length,
      highwayWays: osmHighwayWays.length,
      namedHighwayWays: osmNamedHighways.length,
      unnamedHighwayWays: osmHighwayWays.length - osmNamedHighways.length,
      addrHousenumberElements: osmAddrNodes.length,
      buildingWaysInNearArea: osmBuildingsNear.length,
    },
    openfreemap: {
      source: 'field-runs/map-data-coverage-20260907/summary.json',
      tile: centerKey ?? null,
      buildingFeatures: center?.counts?.building ?? null,
      buildingPolygonParts: center?.geometryParts?.building ?? null,
      transportationFeatures: center?.counts?.transportation ?? null,
      transportationNameFeatures: center?.counts?.transportation_name ?? null,
      housenumberFeatures: centerHousenumbers,
      poiFeatures: center?.counts?.poi ?? null,
      maxzoom: 14,
      note: 'z15/z16 üretimde bu z14 karosundan overzoom edilir — bağımsız veri yok.',
    },
  },
  overture: {
    release: '2026-08-19.0',
    buildings: {
      total: buildings.length,
      osmBacked,
      osmBackedAlsoInOurOsmSet: osmBackedMatchingOurSet,
      nonOsmSourced: nonOsm,
      datasets: buildingDatasets,
      recordLicenses: buildingLicenses,
      withHeight: buildings.filter((b) => b.height !== null).length,
      withNumFloors: buildings.filter((b) => b.num_floors !== null).length,
      withName: buildings.filter((b) => b.name).length,
      inNearArea: buildingsNear.length,
      inNearAreaNonOsm: buildingsNearNonOsm.length,
    },
    segments: {
      total: segments.length,
      road: segRoads.length,
      named: segNamed.length,
      roadNamed: segRoadsNamed.length,
      osmBacked: segOsmBacked,
      datasets: segmentDatasets,
      byClass: segByClass,
      distinctNames: overtureNames.size,
      namesOnlyInOverture: namesOnlyInOverture.length,
      namesOnlyInOsm: namesOnlyInOsm.length,
      namesOnlyInOvertureSample: namesOnlyInOverture.slice(0, 25),
      namesOnlyInOsmSample: namesOnlyInOsm.slice(0, 25),
    },
    addresses: { total: addressCount, note: addressCount === 0 ? 'Bu bbox için Overture adres kaydı YOK (ölçüldü).' : null },
    places: { total: places.length, named: placesNamed, nonOsmSourced: placesNonOsm, datasets: placeDatasets },
  },
  roofProbe,
  incrementalGain: {
    buildingsAbsolute: buildings.length - osmBuildingWays.length,
    buildingsRatio: Number((buildings.length / Math.max(1, osmBuildingWays.length)).toFixed(2)),
    buildingsNonOsmSourced: nonOsm,
    namedRoadsDelta: namesOnlyInOverture.length - namesOnlyInOsm.length,
    addressesDelta: addressCount - (centerHousenumbers ?? 0),
    placesVsProductionPoi: places.length - (center?.counts?.poi ?? 0),
  },
  limits: [
    'OSM tabanı `map.json?bbox` yanıtıdır: bbox içinde EN AZ BİR düğümü olan way\'leri döndürür; Overture sorgusu ise feature bbox kesişimidir. İki sayım birebir aynı kural değildir.',
    'OpenFreeMap sayıları TILE FEATURE sayısıdır; sağlayıcı aynı nitelikteki geometrileri birleştirir (merkezde 11 feature = 351 polygon). Feature ≠ bina.',
    'Overture bina sayısı ML türevi footprint içerir; bunlar gerçek bina KANITI değil, ALGORİTMA ÇIKTISIDIR — doğruluk bu turda yer gerçeği ile ölçülmedi.',
    'Çatı örnekleri uydu üzerinde ELLE seçilmiş üç noktadır; alan geneli kapsam yüzdesi değildir.',
  ],
};

writeFileSync(new URL('shootout.json', here), JSON.stringify(report, null, 2), 'utf8');

/* ── konsol özeti ────────────────────────────────────────────────────────── */
const L = (k, v) => console.log(k.padEnd(42), v);
console.log('=== MAPDATA-F1 · TARSUS SHOOTOUT · z14/9778/6381 ===');
L('OSM building way', osmBuildingWays.length);
L('OpenFreeMap building feature / polygon', `${center?.counts?.building} / ${center?.geometryParts?.building}`);
L('Overture building', buildings.length);
L('  - OSM kökenli', osmBacked);
L('  - OSM DIŞI (gerçek artış)', nonOsm);
L('  - dataset dağılımı', JSON.stringify(buildingDatasets));
L('  - kayıt lisansları', JSON.stringify(buildingLicenses));
console.log('---');
L('OSM highway way (adlı/adsız)', `${osmHighwayWays.length} (${osmNamedHighways.length}/${osmHighwayWays.length - osmNamedHighways.length})`);
L('OpenFreeMap transportation_name feature', center?.counts?.transportation_name);
L('Overture segment (adlı)', `${segments.length} (${segNamed.length})`);
L('  - yalnız Overture\'da olan ad', namesOnlyInOverture.length);
L('  - yalnız OSM\'de olan ad', namesOnlyInOsm.length);
console.log('---');
L('OpenFreeMap housenumber feature', centerHousenumbers);
L('OSM addr:housenumber element', osmAddrNodes.length);
L('Overture address', addressCount);
console.log('---');
L('OpenFreeMap poi feature', center?.counts?.poi);
L('Overture place (adlı / OSM dışı)', `${places.length} (${placesNamed} / ${placesNonOsm})`);
console.log('--- uydu çatı örnekleri ---');
for (const r of roofProbe) {
  L(`roof[${r.index}]`, r.overtureContains
    ? `POLİGON İÇİNDE · ${r.overtureContains.datasets.join(',')}`
    : `poligon içinde değil · en yakın köşe ${r.nearestOvertureVertexMetres} m · 30 m'de ${r.overtureBuildingsWithin30m} bina (OSM: ${r.priorOsmNearestVertexMetres} m)`);
}
console.log('\n-> shootout.json yazıldı');
