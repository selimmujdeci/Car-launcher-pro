// #1321 — Region1(Tarsus, full-pool) + Region2(Mersin, hedefli) birleşik istatistik.
import { readFileSync, writeFileSync } from 'node:fs';
const r1 = JSON.parse(readFileSync('score-full.json', 'utf8'));
const r2 = JSON.parse(readFileSync('score-r2.json', 'utf8'));

function wilson(x, n, z = 1.96) {
  if (n === 0) return { p: null, lo: null, hi: null };
  const p = x / n;
  const denom = 1 + z * z / n;
  const center = p + z * z / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  return { p: +((100 * p).toFixed(2)), lo: +((100 * (center - margin) / denom).toFixed(2)), hi: +((100 * (center + margin) / denom).toFixed(2)) };
}

const mlN = r1.groups.ML.n + r2.groups.ML.n;
const mlYOK = r1.groups.ML.YOK + r2.groups.ML.YOK;
const mlKAYIK = r1.groups.ML.KAYIK + r2.groups.ML.KAYIK;
const mlBELIRSIZ = r1.groups.ML.BELIRSIZ + r2.groups.ML.BELIRSIZ;
const mlVAR = r1.groups.ML.VAR + r2.groups.ML.VAR;
const mlOpenDefect = mlYOK + mlKAYIK;

const osmN = r1.groups.OSM.n + r2.groups.OSM.n;
const osmYOK = r1.groups.OSM.YOK + r2.groups.OSM.YOK;
const osmKAYIK = r1.groups.OSM.KAYIK + r2.groups.OSM.KAYIK;

const out = {
  ml: {
    n: mlN, VAR: mlVAR, KAYIK: mlKAYIK, BELIRSIZ: mlBELIRSIZ, YOK: mlYOK,
    varPct: +((100 * mlVAR / mlN).toFixed(1)),
    falsePositive_Wilson95: wilson(mlYOK, mlN),
    openDefect_Wilson95: wilson(mlOpenDefect, mlN),
    worstCase_Wilson95: wilson(mlYOK + mlKAYIK + mlBELIRSIZ, mlN),
  },
  osm: {
    n: osmN, VAR: r1.groups.OSM.VAR + r2.groups.OSM.VAR, KAYIK: osmKAYIK, BELIRSIZ: r1.groups.OSM.BELIRSIZ + r2.groups.OSM.BELIRSIZ, YOK: osmYOK,
    openDefect_Wilson95: wilson(osmYOK + osmKAYIK, osmN),
  },
  byRegion: {
    region1_Tarsus: { ml: r1.groups.ML, osm: r1.groups.OSM },
    region2_Mersin: { ml: r2.groups.ML, osm: r2.groups.OSM },
  },
};
writeFileSync('combined-stats.json', JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
