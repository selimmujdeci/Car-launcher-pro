// #1321 — footprint alan dağılımı (ML vs OSM), Region1 + Region2, TÜM havuz (örneklem gerektirmez).
import { readFileSync, writeFileSync } from 'node:fs';

function ringsOf(g) {
  return g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.geometry?.coordinates?.flat() ?? g.coordinates.flat() : [];
}
// Yerel metre çerçevesinde alan (küçük alan varsayımı — bu enlemde ~400x400m ölçek, kabul edilebilir).
function areaM2(geom, lat0) {
  const rings = ringsOf(geom);
  if (!rings.length) return null;
  const R = 6371000;
  const mPerDegLat = (Math.PI / 180) * R;
  const mPerDegLon = mPerDegLat * Math.cos(lat0 * Math.PI / 180);
  let total = 0;
  for (const ring of rings) {
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = [ring[i][0] * mPerDegLon, ring[i][1] * mPerDegLat];
      const [x2, y2] = [ring[i + 1][0] * mPerDegLon, ring[i + 1][1] * mPerDegLat];
      a += x1 * y2 - x2 * y1;
    }
    total += Math.abs(a) / 2;
  }
  return total;
}
function stats(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { n: s.length, min: +q(0).toFixed(0), p25: +q(0.25).toFixed(0), median: +q(0.5).toFixed(0), p75: +q(0.75).toFixed(0), max: +s[s.length - 1].toFixed(0), mean: +mean.toFixed(0) };
}
const isOsm = (b) => (b.sources ?? []).some((s) => /openstreetmap/i.test(s.dataset ?? '') && s.record_id);

function regionStats(fixturePath, lat0, label) {
  const fx = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const bl = fx.overtureBuildings;
  const ml = bl.filter((b) => !isOsm(b)).map((b) => areaM2(b.geometry, lat0)).filter((v) => v != null && v > 0);
  const osm = bl.filter((b) => isOsm(b)).map((b) => areaM2(b.geometry, lat0)).filter((v) => v != null && v > 0);
  return { label, ml: stats(ml), osm: stats(osm), ratio: osm.length && ml.length ? +(stats(osm).median / stats(ml).median).toFixed(2) : null };
}

const r1 = regionStats(new URL('../../src/__tests__/fixtures/mapdataTarsusNear.json', import.meta.url), 36.9175, 'Region1-Tarsus');
const r2 = regionStats('region2/fixture-r2.json', 36.812, 'Region2-Mersin');

writeFileSync('area-bias.json', JSON.stringify({ r1, r2 }, null, 2), 'utf8');
console.log(JSON.stringify({ r1, r2 }, null, 2));
