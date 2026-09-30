/**
 * cssTransformFallback — Chrome 101 (K24) için bağımsız transform yedeği.
 * Ölçüm ve gerekçe: scripts/lib/cssTransformFallback.mjs başlığı.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addTransformFallback, FALLBACK_PRELUDE, toFallbackValue } from '../../scripts/lib/cssTransformFallback.mjs';

const T = 'transform:translate(var(--tw-fb-t)) rotate(var(--tw-fb-r)) scale(var(--tw-fb-s))';

describe('addTransformFallback', () => {
  it('transform özelliği yoksa CSS AYNEN döner', () => {
    const css = '.a{color:red}.b{transform:translateX(1px)}';
    expect(addTransformFallback(css)).toBe(css);
  });

  it('Tailwind translate kuralı → @supports not altında değişkenli yedek; orijinal korunur', () => {
    const css = '.-translate-x-1\\/2{--tw-translate-x:calc(calc(1 / 2 * 100%) * -1);translate:var(--tw-translate-x) var(--tw-translate-y)}';
    const out = addTransformFallback(css);
    expect(out.startsWith(css)).toBe(true);
    expect(out).toContain(FALLBACK_PRELUDE);
    expect(out).toContain(`@supports not (translate:0){.-translate-x-1\\/2{--tw-fb-t:var(--tw-translate-x),var(--tw-translate-y);${T}}}`);
  });

  it('@media zinciri korunur, sabit scale/rotate çevrilir', () => {
    const out = addTransformFallback('@media (hover:hover){.h\\:scale-\\[1\\.03\\]:hover{scale:1.03}}.rotate-90{rotate:90deg}');
    expect(out).toContain(`@media (hover:hover){@supports not (translate:0){.h\\:scale-\\[1\\.03\\]:hover{--tw-fb-s:1.03,1.03;${T}}}}`);
    expect(out).toContain(`@supports not (translate:0){.rotate-90{--tw-fb-r:90deg;${T}}}`);
  });

  it('@keyframes içi atlanır; !important taşınır', () => {
    const out = addTransformFallback('@keyframes k{from{scale:.5}to{scale:1}}.i{scale:.9!important}');
    expect(out).not.toContain('--tw-fb-s:.5');
    expect(out).toContain(`.i{--tw-fb-s:.9,.9!important;${T}!important}`);
  });

  it('yedek değişkenleri çocuğa SIZMAZ (inherits:false) ve bir kez kaydedilir', () => {
    const out = addTransformFallback('.a{scale:.9}.b{scale:.8}');
    expect(out.split('@property --tw-fb-s').length - 1).toBe(1);
    expect(FALLBACK_PRELUDE).toMatch(/--tw-fb-t\{syntax:"\*";inherits:false/);
    expect(FALLBACK_PRELUDE).toMatch(/--tw-fb-s\{syntax:"\*";inherits:false/);
    expect(FALLBACK_PRELUDE).toMatch(/--tw-fb-r\{syntax:"\*";inherits:false/);
  });
});

describe('toFallbackValue', () => {
  it('none ve tek/çift değer', () => {
    expect(toFallbackValue('translate', 'none')).toBe('0px,0px');
    expect(toFallbackValue('translate', '10px')).toBe('10px,0px');
    expect(toFallbackValue('scale', '95%')).toBe('95%,95%');
    expect(toFallbackValue('scale', 'none')).toBe('1,1');
    expect(toFallbackValue('rotate', '-90deg')).toBe('-90deg');
  });
  it('eksenli rotate yedeklenmez (null)', () => {
    expect(toFallbackValue('rotate', 'x 45deg')).toBeNull();
  });
});

describe('vite.config bağlantısı', () => {
  it('transformFallback, @layer düzleştirmeden SONRA çalışır', () => {
    const src = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');
    const flat = src.indexOf('    flattenCssLayers(),');
    const fb = src.indexOf('    transformFallback(),');
    expect(flat).toBeGreaterThan(0);
    expect(fb).toBeGreaterThan(flat);
  });
});
