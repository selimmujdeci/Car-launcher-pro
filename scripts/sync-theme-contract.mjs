/**
 * sync-theme-contract.mjs — Tema sözleşmesinin araç → PWA kopyasını senkronlar.
 *
 * Neden var: `themeManifest.ts` ve `themeComponentRegistry.ts` iki ayrı pakette
 * (araç Vite / PWA Next) YAŞAMAK ZORUNDA. Elle kopyalamak sessiz ayrışma üretir;
 * bu script kanonik dosyayı alır, PWA başlığını korur, gövdeyi birebir yazar.
 * `themeManifestParity` testi ayrışmayı ayrıca KİLİTLER.
 *
 * Kullanım:  node scripts/sync-theme-contract.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MARK = '---8<--- PARITY-START --->8---';

const PAIRS = [
  ['src/platform/theme/themeManifest.ts', 'website/src/lib/theme/themeManifest.ts'],
  ['src/platform/theme/themeComponentRegistry.ts', 'website/src/lib/theme/themeComponentRegistry.ts'],
];

let changed = 0;
for (const [src, dst] of PAIRS) {
  const s = readFileSync(src, 'utf8');
  const i = s.indexOf(MARK);
  if (i < 0) throw new Error(`PARITY-START işareti yok: ${src}`);
  const body = s.slice(i + MARK.length);

  const existing = (() => {
    try { return readFileSync(dst, 'utf8'); } catch { return null; }
  })();
  const header = existing && existing.includes(MARK)
    ? existing.slice(0, existing.indexOf(MARK))
    : `/**\n * ${src} dosyasının PWA kopyası — ilk yorum bloğu dışında BİREBİR aynıdır.\n *\n */\n`;

  const next = header + MARK + body;
  if (existing !== next) {
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, next);
    changed++;
    console.log(`güncellendi: ${dst}`);
  }
}
console.log(changed === 0 ? 'Senkron — değişiklik yok.' : `${changed} dosya senkronlandı.`);
