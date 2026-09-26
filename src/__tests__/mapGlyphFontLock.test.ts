/**
 * mapGlyphFontLock.test — harita etiketleri glyph sunucusunun VERDİĞİ fontu kullanır.
 * Telefon smoke 2026-09-25: alternatif rota rozeti "Open Sans Bold" istiyordu,
 * sunucu 404 → yazısız koyu kutu. Sunucu Noto Sans ailesini verir.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe('harita font kilidi', () => {
  it('🔒 her text-font Noto Sans ailesinden', () => {
    const bad: string[] = [];
    for (const f of files(join(__dirname, '../platform'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/'text-font'\s*:\s*\[([^\]]*)\]/g)) {
        const fonts = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
        if (fonts.some((x) => !x.startsWith('Noto Sans'))) bad.push(`${f}: ${fonts.join(', ')}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
