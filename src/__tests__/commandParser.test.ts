/**
 * commandParser.test.ts — Sesli asistan komut parser testleri.
 *
 * Test kapsamı:
 *  - Türkçe exact substring eşleşmeleri
 *  - Token bazlı eşleşmeler
 *  - Accent-normalize edilmiş giriş (ş/s, ı/i, ü/u, ç/c, ğ/g)
 *  - Eşleşme bulunamayan durumda öneri listesi
 *  - Güven skoru (confidence) sınırları
 */

import { describe, it, expect } from 'vitest';
import { parseCommandFull, parseCommand } from '../platform/commandParser';

describe('parseCommandFull — exact match', () => {
  it('"eve git" → navigate_home', () => {
    const r = parseCommandFull('eve git');
    expect(r.command?.type).toBe('navigate_home');
    expect(r.command?.confidence).toBe(1.0);
  });

  it('"haritayı aç" → open_maps', () => {
    const r = parseCommandFull('haritayı aç');
    expect(r.command?.type).toBe('open_maps');
  });

  it('"müziği aç" → open_music', () => {
    const r = parseCommandFull('müziği aç');
    expect(r.command?.type).toBe('open_music');
  });

  it('"spotify aç" → open_music (spotify keyword in music command)', () => {
    const r = parseCommandFull('spotify aç');
    expect(r.command?.type).toBe('open_music');
  });

  it('"ayarları aç" → open_settings', () => {
    const r = parseCommandFull('ayarları aç');
    expect(r.command?.type).toBe('open_settings');
  });
});

describe('parseCommandFull — accent normalized input', () => {
  it('"haritayi ac" (accent-free) → open_maps', () => {
    // Kullanıcı aksanları atlayabilir
    const r = parseCommandFull('haritayi ac');
    expect(r.command?.type).toBe('open_maps');
  });

  it('"muzigi ac" (accent-free) → open_music', () => {
    const r = parseCommandFull('muzigi ac');
    expect(r.command?.type).toBe('open_music');
  });

  it('"spotify ac" (accent-free) → open_music', () => {
    const r = parseCommandFull('spotify ac');
    expect(r.command?.type).toBe('open_music');
  });
});

describe('parseCommandFull — token match', () => {
  it('"navigate" → open_maps (token match)', () => {
    const r = parseCommandFull('navigate');
    expect(r.command?.type).toBe('open_maps');
    expect(r.command!.confidence).toBeLessThan(1.0);
  });

  it('"harita" → open_maps (token)', () => {
    const r = parseCommandFull('harita');
    expect(r.command?.type).toBe('open_maps');
  });

  it('"spotify" alone → open_music (token match via spotify keyword)', () => {
    const r = parseCommandFull('spotify');
    expect(r.command?.type).toBe('open_music');
  });
});

describe('parseCommandFull — no match → suggestions', () => {
  it('gibberish input → no command, has suggestions', () => {
    const r = parseCommandFull('xyzabcdef');
    expect(r.command).toBeNull();
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions.length).toBeLessThanOrEqual(3);
  });

  it('empty string → no command', () => {
    const r = parseCommandFull('');
    expect(r.command).toBeNull();
  });
});

describe('parseCommandFull — priority / feedback', () => {
  it('navigate_home has critical priority', () => {
    const r = parseCommandFull('eve git');
    expect(r.command?.priority).toBe('critical');
  });

  it('command has feedback string', () => {
    const r = parseCommandFull('haritayı aç');
    expect(typeof r.command?.feedback).toBe('string');
    expect(r.command!.feedback.length).toBeGreaterThan(0);
  });

  it('raw field preserves original input casing', () => {
    const input = 'Haritayı Aç';
    const r = parseCommandFull(input);
    expect(r.command?.raw).toBe(input);
  });
});

describe('parseCommand (shorthand)', () => {
  it('returns ParsedCommand directly', () => {
    const c = parseCommand('müzik aç');
    expect(c).not.toBeNull();
    expect(c?.type).toBe('open_music');
  });

  it('returns null on no match', () => {
    const c = parseCommand('bbbbbbbbb');
    expect(c).toBeNull();
  });
});
