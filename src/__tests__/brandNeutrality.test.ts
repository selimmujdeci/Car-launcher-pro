// @vitest-environment node
/**
 * Kullanıcıya görünen tema / duvar kâğıdı / çeviri adlarında üçüncü taraf otomobil
 * markası YOKTUR (uluslararası çıkış — marka ihlali riski, 2026-09-29).
 *
 * Kapsam dışı (meşru, betimleyici kullanım): kullanıcının KENDİ aracını tanıyan
 * üretici eşlemeleri (VIN/WMI → "BMW"), yorumlar ve dahili kimlikler (`tesla`
 * tema kimliği kayıtlı ayarlar ve Tema Stüdyosu yerleşimleri için korunur).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const BRANDS = /\b(Tesla|TESLA|Audi|AUDI|MMI|MBUX|BMW|Mercedes|Porsche|Ferrari|Lamborghini|McLaren|Bugatti|Maserati|Bentley)\b/;

/** Dosyadaki `label:` / `desc:` / `sub:` dizge değerleri + çeviri değerleri. */
function visibleStrings(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\b(?:label|desc|sub|description)\s*:\s*'([^']*)'/g)) out.push(m[1]);
  return out;
}

describe('marka nötrlüğü', () => {
  it.each([
    'src/components/settings/SettingsPage.tsx',
    'src/platform/theme/themeManifest.ts',
    'src/store/useCarTheme.ts',
    'src/platform/themeLayoutEngine.ts',
  ])('%s: görünen etiketlerde marka yok', (f) => {
    expect(visibleStrings(read(f)).filter((s) => BRANDS.test(s))).toEqual([]);
  });

  it('tema adı eşlemeleri "Terra" der (Tesla değil)', () => {
    for (const f of ['src/components/settings/SettingsPage.tsx', 'src/platform/voice/appControlExecutor.ts']) {
      expect(read(f)).toContain("tesla: 'Terra'");
    }
  });

  it('çeviri değerlerinde marka yok', () => {
    const values = [...read('src/i18n/config.ts').matchAll(/"[^"]+":\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(values.length).toBeGreaterThan(20);
    expect(values.filter((v) => BRANDS.test(v))).toEqual([]);
  });
});
