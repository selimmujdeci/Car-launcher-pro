// Wilson güven aralığı + ML/OSM footprint alan dağılımı (nesnel, göz kararı YOK).
import { readFileSync, writeFileSync } from 'node:fs';
const here = new URL('./', import.meta.url);
const score = JSON.parse(readFileSync(new URL('score.json', here), 'utf8'));
const F = JSON.parse(readFileSync(new URL('../../src/__tests__/fixtures/mapdataTarsusNear.json', here), 'utf8'));

/** Wilson skor aralığı — küçük n'de normal yaklaşımdan DOĞRU. */
function wilson(k, n, z = 1.959963985) {
  if (n === 0) return [null, null];
  const p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n);
  const h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}
const pct = (x) => (x === null ? null : Number((100 * x).toFixed(1)));

/* ── Alan dağılımı (yerel çerçevede shoelace — üretimle aynı yöntem) ─────── */
const R = 6371008.8, DEG = Math.PI / 180;
const ringsOf = (g) => (g.type === 'Polygon' ? g.coordinates
  : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);
function areaM2(g) {
  const rings = ringsOf(g);
  if (rings.length === 0) return null;
  const [lon0, lat0] = rings[0][0];
  const mLon = DEG * R * Math.cos(lat0 * DEG), mLat = DEG * R;
  const shoelace = (ring) => {
    let s = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = (ring[i][0] - lon0) * mLon, yi = (ring[i][1] - lat0) * mLat;
      const xj = (ring[j][0] - lon0) * mLon, yj = (ring[j][1] - lat0) * mLat;
      s += xj * yi - xi * yj;
    }
    return Math.abs(s / 2);
  };
  let a = shoelace(rings[0]);
  for (let i = 1; i < rings.length; i++) a -= shoelace(rings[i]);
  return a > 0 ? a : null;
}
const isOsm = (b) => (b.sources ?? []).some((s) => /openstreetmap/i.test(s.dataset ?? '') && s.record_id);
const stat = (xs) => {
  const a = xs.filter((v) => v !== null).sort((x, y) => x - y);
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))];
  return { n: a.length, min: Math.round(a[0]), p25: Math.round(q(0.25)), median: Math.round(q(0.5)),
    p75: Math.round(q(0.75)), max: Math.round(a[a.length - 1]),
    mean: Math.round(a.reduce((s, v) => s + v, 0) / a.length) };
};
const mlAreas = F.overtureBuildings.filter((b) => !isOsm(b)).map((b) => areaM2(b.geometry));
const ovOsmAreas = F.overtureBuildings.filter(isOsm).map((b) => areaM2(b.geometry));
const osmRawAreas = F.osmBuildings.map((w) => {
  const ring = w.ring.map((p) => [p[0], p[1]]);
  if (ring.length < 3) return null;
  const first = ring[0], last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return areaM2({ type: 'Polygon', coordinates: [ring] });
});

const ml = score.groups.ML, osm = score.groups.OSM;
const out = {
  sample: {
    ML: { n: ml.n, yok: ml.YOK, kayik: ml.KAYIK, belirsiz: ml.BELIRSIZ, var: ml.VAR },
    OSM: { n: osm.n, yok: osm.YOK, kayik: osm.KAYIK, belirsiz: osm.BELIRSIZ, var: osm.VAR },
  },
  wilson95: {
    ML_yanlisPozitif: wilson(ml.YOK, ml.n).map(pct),
    ML_acikKusur: wilson(ml.YOK + ml.KAYIK, ml.n).map(pct),
    ML_enKotu: wilson(ml.YOK + ml.KAYIK + ml.BELIRSIZ, ml.n).map(pct),
    OSM_acikKusur: wilson(osm.YOK + osm.KAYIK, osm.n).map(pct),
  },
  areaM2: {
    overtureML: stat(mlAreas),
    overtureOsmKokenli: stat(ovOsmAreas),
    osmUpstream: stat(osmRawAreas),
  },
};
writeFileSync(new URL('stats.json', here), JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
