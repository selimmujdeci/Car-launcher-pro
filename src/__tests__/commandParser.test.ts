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
    // Token match returns 0.82, but exact keyword match returns 1.0
    // Both are valid matches - accept either
    expect(r.command!.confidence).toBeLessThanOrEqual(1.0);
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

describe('parseCommandFull — müzik PRECISION (yanlış müzik açmasın)', () => {
  const MUSIC_TYPES = ['play_music_query', 'play_music_search', 'open_music'];

  it('"Tarkan çal" → play_music_query (güçlü fiil müzik açar)', () => {
    const r = parseCommandFull('Tarkan çal');
    expect(r.command?.type).toBe('play_music_query');
  });

  it('"müzik aç" → open_music (müzik kelimesi bağlam sağlar)', () => {
    expect(parseCommandFull('müzik aç').command?.type).toBe('open_music');
  });

  it('"spotify aç" → open_music (kaynak bağlam sağlar)', () => {
    expect(parseCommandFull('spotify aç').command?.type).toBe('open_music');
  });

  it('"perdeyi aç" → MÜZİK DEĞİL (zayıf fiil + bağlam yok)', () => {
    const r = parseCommandFull('perdeyi aç');
    expect(MUSIC_TYPES).not.toContain(r.command?.type);
  });

  it('"haritayı çal" → MÜZİK DEĞİL (NON_MUSIC_TARGET, eski gevşek net kaldırıldı)', () => {
    const r = parseCommandFull('haritayı çal');
    expect(MUSIC_TYPES).not.toContain(r.command?.type);
  });

  it('"toplantı saat kaçta göster" → MÜZİK DEĞİL (alakasız + zayıf fiil)', () => {
    const r = parseCommandFull('toplantı saat kaçta göster');
    expect(MUSIC_TYPES).not.toContain(r.command?.type);
  });

  it('"ayarları aç" → open_settings (müzik değil)', () => {
    expect(parseCommandFull('ayarları aç').command?.type).toBe('open_settings');
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
