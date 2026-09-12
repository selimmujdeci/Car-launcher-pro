/* Sis ölçümü: bant bant ortalama parlaklık + yapı kontrastı (std sapma).
   Sis = ortalama yükselir, std çöker (her şey tek tona yaklaşır). */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
const dosya = process.argv[2];
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 960, height: 460 } });
await pg.goto(pathToFileURL(process.cwd() + '/' + dosya).href);
const r = await pg.evaluate(async () => {
  const im = document.querySelector('img');
  await im.decode();
  const c = document.createElement('canvas');
  c.width = im.naturalWidth; c.height = im.naturalHeight;
  c.getContext('2d').drawImage(im, 0, 0);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const H = c.height, W = c.width;
  const bant = [];
  for (const [ad, y0, y1] of [['ufuk 52-90', 52, 90], ['uzak 90-160', 90, 160],
                              ['orta 160-260', 160, 260], ['yakin 260-400', 260, 400]]) {
    let n = 0, s = 0, s2 = 0;
    for (let y = Math.round(y0 * H / 406); y < Math.round(y1 * H / 406); y++)
      for (let x = 0; x < W; x += 2) {
        const i = (y * W + x) * 4;
        const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        n++; s += L; s2 += L * L;
      }
    const ort = s / n, std = Math.sqrt(s2 / n - ort * ort);
    bant.push(ad.padEnd(14) + 'ort ' + ort.toFixed(1).padStart(6) + '  std ' + std.toFixed(1).padStart(5));
  }
  return bant;
});
console.log(dosya);
for (const l of r) console.log('  ' + l);
await b.close();
