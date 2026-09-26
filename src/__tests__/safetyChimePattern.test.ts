/**
 * safetyChimePattern.test — uyarı tonu tarzları (Ses › Uyarı Tonları).
 *
 * 2026-09-24: ayar satırı sabit "OEM Varsayılan" yazısıydı, seçim yoktu.
 * Artık tarz seçilebilir; güvenlik kilitleri: kritik uyarı hiçbir tarzda
 * SESSİZ değil ve uyarıdan (warning) ayırt edilebilir.
 */
import { describe, it, expect } from 'vitest';
import { chimePattern, type AlertToneStyle } from '../platform/safety/safetyChime';

const STYLES: AlertToneStyle[] = ['classic', 'soft', 'bright'];

describe('uyarı tonu kalıpları', () => {
  it('🔒 klasik tarz eski davranışla BİREBİR (2×440 Hz kritik, 1×880 Hz uyarı)', () => {
    expect(chimePattern('critical', 'classic').map((n) => [n.freq, n.start, n.dur]))
      .toEqual([[440, 0, 0.15], [440, 0.18, 0.15]]);
    expect(chimePattern('warning', 'classic').map((n) => [n.freq, n.start, n.dur]))
      .toEqual([[880, 0, 0.12]]);
  });

  for (const st of STYLES) {
    it(`🔒 ${st}: kritik sessiz değil ve uyarıdan fazla notalı; bilgi sessiz`, () => {
      const c = chimePattern('critical', st);
      const w = chimePattern('warning', st);
      expect(c.length).toBeGreaterThan(w.length);
      expect(w.length).toBeGreaterThan(0);
      expect(c.every((n) => n.gain > 0 && n.dur > 0)).toBe(true);
      expect(chimePattern('info', st)).toEqual([]);
    });
  }

  it('bilinmeyen tarz klasik sayılır (bozuk kayıt sessizlik üretmez)', () => {
    expect(chimePattern('critical', 'yok' as AlertToneStyle)).toEqual(chimePattern('critical', 'classic'));
  });
});
