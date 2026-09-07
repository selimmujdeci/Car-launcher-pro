/**
 * İKİNCİ GEÇİŞ — birinci turda DÜŞÜK GÜVENLE işaretlenen hücreleri büyütür.
 *
 * Kör kalır: yalnız hücre NUMARALARI verilir, köken bilgisi okunmaz.
 * Aynı mozaik ve aynı örneklem kullanılır; yalnız büyütme ve hücre boyu artar.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const KEY = JSON.parse(readFileSync(HERE + 'sample-key.json', 'utf8'));
const FIXTURE = JSON.parse(readFileSync(
  new URL('../../src/__tests__/fixtures/mapdataTarsusNear.json', import.meta.url), 'utf8'));
const PROV = JSON.parse(readFileSync(HERE + 'mosaic-provenance.json', 'utf8'));

/** Birinci turda düşük güvenli bulunan hücreler (görsel değerlendirme). */
const CELLS = (process.argv[2] ?? '1,8,9,13,18,20,22,23,25').split(',').map(Number);

const Z = PROV.zoom;
const WORLD = 256 * 2 ** Z;
const lonToPx = (lon) => (lon + 180) / 360 * WORLD;
const latToPx = (lat) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * WORLD;
const originPx = { x: PROV.tileRange.tx0 * 256, y: PROV.tileRange.ty0 * 256 };

const CELL = 420;
const SCALE = 5;   // ~0,10 m/px görsel
const COLS = 3;

const ringsOf = (g) => (g.type === 'Polygon' ? g.coordinates
  : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);
const byId = new Map(FIXTURE.overtureBuildings.map((b) => [b.id, b]));

const cells = CELLS.map((n) => {
  const entry = KEY.cells.find((c) => c.cell === n);
  const rings = ringsOf(byId.get(entry.id).geometry);
  const cx = lonToPx(entry.centroid[0]) - originPx.x;
  const cy = latToPx(entry.centroid[1]) - originPx.y;
  const offX = CELL / 2 - cx * SCALE;
  const offY = CELL / 2 - cy * SCALE;
  const poly = rings.map((ring) => ring
    .map((p) => `${((lonToPx(p[0]) - originPx.x) * SCALE + offX).toFixed(1)},${((latToPx(p[1]) - originPx.y) * SCALE + offY).toFixed(1)}`)
    .join(' ')).join('" /><polyline class="fp" points="');
  const imgs = PROV.tiles.map((t) => {
    const left = (t.x * 256 - originPx.x) * SCALE + offX;
    const top = (t.y * 256 - originPx.y) * SCALE + offY;
    if (left > CELL || top > CELL || left + 256 * SCALE < 0 || top + 256 * SCALE < 0) return '';
    return `<img src="${t.file}" style="left:${left}px;top:${top}px;width:${256 * SCALE}px;height:${256 * SCALE}px">`;
  }).join('');
  // 10 m ölçek çubuğu (bu enlemde z18 px → metre)
  const mPerPx = 40075016.686 * Math.cos(36.9175 * Math.PI / 180) / (256 * 2 ** Z);
  const barPx = (10 / mPerPx) * SCALE;
  return `<div class="cell"><div class="sat">${imgs}</div>
  <svg width="${CELL}" height="${CELL}"><polyline class="fp" points="${poly}" /></svg>
  <div class="num">${n}</div>
  <div class="bar" style="width:${barPx.toFixed(1)}px">10 m</div></div>`;
}).join('\n');

writeFileSync(HERE + 'zoom.html', `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#111;font:12px/1.2 monospace;color:#eee}
.grid{display:grid;grid-template-columns:repeat(${COLS},${CELL}px);gap:6px;padding:6px}
.cell{position:relative;width:${CELL}px;height:${CELL}px;overflow:hidden;background:#000;outline:1px solid #444}
.sat{position:absolute;inset:0}.sat img{position:absolute}
svg{position:absolute;inset:0}
polyline.fp{fill:none;stroke:#ff2d55;stroke-width:2.5;stroke-opacity:.95}
.num{position:absolute;left:0;top:0;background:#000c;padding:3px 8px;font-weight:bold;font-size:16px}
.bar{position:absolute;left:10px;bottom:10px;border-bottom:3px solid #fff;color:#fff;text-align:center;
     text-shadow:0 0 3px #000;font-size:11px;padding-bottom:2px}
</style><div class="grid">${cells}</div>`, 'utf8');
console.log('zoom.html yazıldı · hücreler:', CELLS.join(','));
