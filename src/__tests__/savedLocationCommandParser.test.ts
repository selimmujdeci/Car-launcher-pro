import { describe, it, expect } from 'vitest';
import { tryParseSavedLocationCommand } from '../platform/savedLocationCommandParser';

describe('savedLocationCommandParser', () => {
  it('KAYDET — "adı X olsun"', () => {
    const r = tryParseSavedLocationCommand('Burayı kaydet, adı Mavi Göl olsun');
    expect(r?.verb).toBe('save');
    expect(r?.name).toBe('Mavi Göl');
  });

  it('KAYDET — "X olarak kaydet"', () => {
    const r = tryParseSavedLocationCommand('Konumumu Mavi Göl olarak kaydet');
    expect(r?.verb).toBe('save');
    expect(r?.name).toBe('Mavi Göl');
  });

  it('KAYDET — "X diye kaydet"', () => {
    const r = tryParseSavedLocationCommand('Burasını Annemler diye kaydet');
    expect(r?.verb).toBe('save');
    expect(r?.name).toBe('Annemler');
  });

  it('KAYDET — isimsiz fallback', () => {
    const r = tryParseSavedLocationCommand('Burayı kaydet');
    expect(r?.verb).toBe('save');
    expect(r?.name).toBeNull();
  });

  it('SİL — "X\'i sil"', () => {
    const r = tryParseSavedLocationCommand("Mavi Göl'ü sil");
    expect(r?.verb).toBe('delete');
    expect(r?.name).toBe('Mavi Göl');
  });

  it('SİL — "X konumunu sil"', () => {
    const r = tryParseSavedLocationCommand('Depo konumunu sil');
    expect(r?.verb).toBe('delete');
    expect(r?.name).toBe('Depo');
  });

  it('PAYLAŞ — "X\'i paylaş"', () => {
    const r = tryParseSavedLocationCommand("Mavi Göl'ü paylaş");
    expect(r?.verb).toBe('share');
    expect(r?.name).toBe('Mavi Göl');
  });

  it('PAYLAŞ — "X\'in konumunu paylaş"', () => {
    const r = tryParseSavedLocationCommand("Annemlerin konumunu paylaş");
    expect(r?.verb).toBe('share');
    expect(r?.name).toBe('Annemlerin');
  });

  it('YENİDEN ADLANDIR — "X\'in adını Y yap"', () => {
    const r = tryParseSavedLocationCommand("Mavi Göl'ün adını Piknik Alanı yap");
    expect(r?.verb).toBe('rename');
    expect(r?.name).toBe('Mavi Göl');
    expect(r?.newName).toBe('Piknik Alanı');
  });

  it('YENİDEN ADLANDIR — "X konumunu Y olarak değiştir"', () => {
    const r = tryParseSavedLocationCommand('Depo konumunu Atölye olarak değiştir');
    expect(r?.verb).toBe('rename');
    expect(r?.name).toBe('Depo');
    expect(r?.newName).toBe('Atölye');
  });

  it('eşleşmeyen metin null döner', () => {
    expect(tryParseSavedLocationCommand('bugün hava nasıl')).toBeNull();
    expect(tryParseSavedLocationCommand("Mavi Göl'e git")).toBeNull();
  });

  it('boş girdi null döner', () => {
    expect(tryParseSavedLocationCommand('')).toBeNull();
    expect(tryParseSavedLocationCommand('   ')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SAHA KUSURU (2026-09-11) — doğal Türkçe konum özneleri kapıdan geçemiyordu
 *
 * Ölçülen (parseCommand çıktısı, düzeltme ÖNCESİ):
 *   "yerimi kaydet"                                → add_music_favorite (0.82)
 *   "bulunduğum yeri kaydet"                       → add_music_favorite (0.82)
 *   "buraya ev diye kaydet"                        → navigate_home      (0.82)
 *   "şu an bulunduğum yeri annemler olarak kaydet" → add_music_favorite (0.82)
 *   "Bulunduğum konumu ev olarak kaydet"           → name "Bulunduğum konumu ev"
 *   "Burayı Mavi Göl adıyla kaydet"                → name null (isim KAYBOLUYOR)
 * 0.82 ≥ AUTO_DISPATCH_MIN (0.7) olduğu için yanlış komut ONAYSIZ yürütülüyordu.
 * ════════════════════════════════════════════════════════════════════════ */
describe('savedLocationCommandParser — doğal Türkçe konum özneleri (SAHA 2026-09-11)', () => {
  const SAVE_CASES: ReadonlyArray<readonly [string, string | null]> = [
    ['Şu anki konumumu kaydet',                      null],
    ['Burayı kaydet',                                null],
    ['yerimi kaydet',                                null],
    ['şu anki yerimi kaydet',                        null],
    ['bulunduğum yeri kaydet',                       null],
    ['şurayı kaydet',                                null],
    ['konumumuzu kaydet',                            null],
    ['Burayı ev olarak kaydet',                      'ev'],
    ['Konumumu ev diye kaydet',                      'ev'],
    ['buraya ev diye kaydet',                        'ev'],
    ['Konumumu annemler olarak kaydet',              'annemler'],
    ['Bulunduğum konumu ev olarak kaydet',           'ev'],
    ['Şu an bulunduğum yeri annemler olarak kaydet', 'annemler'],
    ['Burayı Mavi Göl adıyla kaydet',                'Mavi Göl'],
  ];

  for (const [text, expectedName] of SAVE_CASES) {
    it(`"${text}" → save${expectedName ? ` (ad: ${expectedName})` : ' (isimsiz)'}`, () => {
      const r = tryParseSavedLocationCommand(text);
      expect(r).not.toBeNull();
      expect(r?.verb).toBe('save');
      expect(r?.name).toBe(expectedName);
    });
  }

  it('MEDYA cümleleri konum kaydına DÜŞMEZ (çapraz kirlenme yok)', () => {
    expect(tryParseSavedLocationCommand('bu şarkıyı kaydet')).toBeNull();
    expect(tryParseSavedLocationCommand('şarkıyı favorilere kaydet')).toBeNull();
    expect(tryParseSavedLocationCommand('beğendim ekle')).toBeNull();
  });
});
