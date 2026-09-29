// @vitest-environment node
/**
 * K24 WebView (Chrome 101, `perf-low`) renk uyumluluğu kilitleri.
 *
 * KÖK (inceleme 2026-09-29):
 *  1. Inline stilde `oklch()` Chrome 111+ ister; derleme yalnız .css dosyalarını
 *     düşürür → TSX'teki 67 oklch rengi (Medya, Bölünmüş ekran, Ayarlar, Uyku)
 *     cihazda SESSİZCE düşüyordu (ilerleme dolgusu, oynat düğmesi, çerçeveler).
 *  2. `.perf-low * { background-image: none }` degradeyi siler; kuralın öngördüğü
 *     düz renk yedeği (`backgroundColor`) yoksa öğe saydamlaşır (Pro albüm ikonu
 *     gündüz beyaz üstüne beyaz, Horizon yakıt dolgusu ve dönüş oku görünmez).
 *     Yedek, `background` KISAYOLUNDAN ÖNCE yazılırsa kısayol onu sıfırlar.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { oklchRgb } from '../utils/cssCompat';

const ROOT = join(__dirname, '../..');
const srcFiles = (): string[] =>
  execFileSync('git', ['ls-files', 'src/*.ts', 'src/*.tsx', 'src/**/*.ts', 'src/**/*.tsx'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => f && !f.includes('__tests__'));

describe('WebView renk uyumluluğu', () => {
  it('TS/TSX kaynaklarında inline oklch() yok (yalnız dönüştürücü)', () => {
    const hits = srcFiles()
      .filter((f) => !f.endsWith('utils/cssCompat.ts'))
      .filter((f) => /oklch\(/.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(hits).toEqual([]);
  });

  it('oklchRgb Chrome ile aynı sRGB değerini üretir', () => {
    // Beklenenler Chromium canvas'ında oklch() boyanıp okunarak ölçüldü.
    expect(oklchRgb(0.80, 0.13, 60)).toBe('rgb(251,169,98)');
    expect(oklchRgb(0.66, 0.11, 250)).toBe('rgb(91,151,211)');
    expect(oklchRgb(0.28, 0.08, 90)).toBe('rgb(56,38,0)');
    expect(oklchRgb(0.80, 0.13, 60, 0.55)).toBe('rgba(251,169,98,0.55)');
  });

  it('düz renk yedeği background kısayoluyla sıfırlanmaz', () => {
    const hits = srcFiles().filter((f) =>
      /backgroundColor:[^,}]+,\s*background:/.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(hits).toEqual([]);
  });

  it('perf-low\'da içerik taşıyan degradeler düz renk yedeğine sahip', () => {
    const read = (f: string) => readFileSync(join(ROOT, 'src/components', f), 'utf8');
    expect(read('themes/ProLayout.tsx')).toContain("backgroundColor: '#7c3aed', backgroundImage: 'linear-gradient(135deg,#7c3aed");
    expect(read('themes/HorizonLayout.tsx').match(/backgroundColor: p\.accent, backgroundImage: `linear-gradient/g)).toHaveLength(2);
    expect(read('common/VolumeGestureLayer.tsx')).toMatch(/backgroundColor: '#3b82f6', backgroundImage:/);
    expect(read('common/IncomingCallOverlay.tsx')).toMatch(/backgroundColor: '#0d1f0f', backgroundImage:/);
    expect(read('security/GeofenceAlarmOverlay.tsx')).toMatch(/backgroundColor: '#7f1d1d', backgroundImage:/);
  });
});
