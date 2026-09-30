/**
 * Tailwind v4 CSS değişkeni yazımı kilidi.
 *
 * ÖLÇÜLEN KUSUR (2026-09-30, derlenmiş CSS): v3 kısaltması `text-[--adm-muted]`
 * v4'te `color:--adm-muted` olarak derleniyordu — geçersiz bildirim, tarayıcı
 * atar. Yönetim panelinde 74 sınıf (yazı/kenarlık/zemin/köşe) bu yüzden hiç
 * uygulanmıyordu. v4 yazımı `text-(--adm-muted)` → `color:var(--adm-muted)`.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('Tailwind v4 değişken yazımı', () => {
  it('src altında v3 kısaltması `util-[--değişken]` yok', () => {
    let out = '';
    try {
      out = execFileSync('git', ['grep', '-nE', String.raw`[a-z]-\[--[a-zA-Z0-9-]+\]`, '--', 'src/*.tsx', 'src/*.ts', ':!src/__tests__'], { encoding: 'utf8' });
    } catch { out = ''; } // git grep eşleşme yoksa 1 ile çıkar
    expect(out.trim(), `v4'te geçersiz CSS üretir — (--değişken) yazımını kullanın:\n${out}`).toBe('');
  });
});
