import { describe, it, expect } from 'vitest';
import {
  PID_DESCRIPTION_MISSING_TR,
  parseToMode01PidKey,
  parseToMode22DidKey,
  explainPidSafeForDisplay,
  getVerifiedPidTurkishDescription,
  sanitizePidAiExplanationBlob,
  listValidatedPidKeys,
} from '../platform/ai/pidDescriptionGate';

describe('pidDescriptionGate', () => {
  it('Mode 22 DID: 22F190 ve 22-F1-90 → kayıtlı açıklama', () => {
    const t = explainPidSafeForDisplay('22F190');
    expect(t).not.toBe(PID_DESCRIPTION_MISSING_TR);
    expect(explainPidSafeForDisplay('22-F1-90')).toBe(t);
  });

  it('Mode 22 şema dışı DID için sabit metin', () => {
    expect(explainPidSafeForDisplay('22-DE-AD')).toBe(PID_DESCRIPTION_MISSING_TR);
    expect(parseToMode22DidKey('22-DE-AD')).toBe('22-DE-AD');
  });

  it('geçerli PID için doğrulanmış Türkçe metin döner', () => {
    const t = explainPidSafeForDisplay('0x0C');
    expect(t).not.toBe(PID_DESCRIPTION_MISSING_TR);
    expect(t.length).toBeGreaterThan(10);
  });

  it('şema dışı PID için zorunlu sabit metin', () => {
    expect(explainPidSafeForDisplay('01-FF')).toBe(PID_DESCRIPTION_MISSING_TR);
    expect(getVerifiedPidTurkishDescription('01-FF')).toBe(PID_DESCRIPTION_MISSING_TR);
  });

  it('çözümlenemeyen girdi için sabit metin', () => {
    expect(explainPidSafeForDisplay('')).toBe(PID_DESCRIPTION_MISSING_TR);
    expect(explainPidSafeForDisplay('   ')).toBe(PID_DESCRIPTION_MISSING_TR);
    expect(parseToMode01PidKey('xyz')).toBeNull();
  });

  it('normalize: 010C, 01-0D, 0x0D; iki hex rakam OBD hex PID olarak okunur', () => {
    expect(parseToMode01PidKey('010C')).toBe('01-0C');
    expect(parseToMode01PidKey('01-0D')).toBe('01-0D');
    expect(parseToMode01PidKey('0x0D')).toBe('01-0D');
    expect(parseToMode01PidKey('13')).toBe('01-13');
  });

  it('sanitizePidAiExplanationBlob yalnızca kayıtlı anahtarları ve registry metnini tutar', () => {
    const dirty = {
      pidAciklama: {
        '01-0C': { insancilAciklama: 'Uydurma açıklama', kisaAd: 'X' },
        '01-99': { insancilAciklama: 'Yasak anahtar' },
      },
    };
    const clean = sanitizePidAiExplanationBlob(dirty);
    expect(Object.keys(clean)).toEqual(['01-0C']);
    expect(clean['01-0C']!.insancilAciklama).toBe(getVerifiedPidTurkishDescription('01-0C'));
    expect(clean['01-0C']!.kisaAd).toBeTruthy();
  });

  it('liste boş değil ve sıralı', () => {
    const k = [...listValidatedPidKeys()];
    expect(k.length).toBeGreaterThan(0);
    const sorted = [...k].sort();
    expect(k).toEqual(sorted);
  });
});
