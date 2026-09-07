// Kör hükümleri anahtarla eşleştirir ve grup bazında oran üretir.
import { readFileSync, writeFileSync } from 'node:fs';
const here = new URL('./', import.meta.url);
const read = (n) => JSON.parse(readFileSync(new URL(n, here), 'utf8'));
const key = read('sample-key-full.json');
const verdicts = read('blind-verdicts-full.json');
const byCell = new Map(key.cells.map((c) => [c.cell, c]));

const rows = verdicts.cells.map((v) => {
  const k = byCell.get(v.cell);
  return { cell: v.cell, verdict: v.verdict, origin: k.origin, id: k.id, datasets: k.datasets };
});

const groups = {};
for (const r of rows) {
  const g = (groups[r.origin] ??= { n: 0, VAR: 0, KAYIK: 0, BELIRSIZ: 0, YOK: 0, cells: [] });
  g.n += 1; g[r.verdict] += 1; g.cells.push(r.cell);
}
const pct = (a, b) => (b === 0 ? null : Number((100 * a / b).toFixed(1)));
for (const [name, g] of Object.entries(groups)) {
  g.varPct = pct(g.VAR, g.n);
  g.yokPct = pct(g.YOK, g.n);
  g.problemPct = pct(g.YOK + g.KAYIK, g.n);          // açık kusur
  g.worstCasePct = pct(g.YOK + g.KAYIK + g.BELIRSIZ, g.n); // belirsizler de kusur sayılırsa
}
const out = { seed: key.seed, poolSizes: key.poolSizes, groups, rows };
writeFileSync(new URL('score-full.json', here), JSON.stringify(out, null, 2), 'utf8');

console.log('=== KÖR ÖRNEKLEM SONUCU ===');
for (const [name, g] of Object.entries(groups)) {
  console.log(`${name.padEnd(4)} n=${g.n}  VAR ${g.VAR}  KAYIK ${g.KAYIK}  BELIRSIZ ${g.BELIRSIZ}  YOK ${g.YOK}` +
    `  | VAR %${g.varPct}  açık kusur %${g.problemPct}  en kötü %${g.worstCasePct}`);
  console.log('     hücreler:', g.cells.join(','));
}
console.log('\nhücre bazında:');
for (const r of rows) console.log(' ', String(r.cell).padStart(2), r.origin.padEnd(4), r.verdict.padEnd(9), r.datasets.join(','));
