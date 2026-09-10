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
