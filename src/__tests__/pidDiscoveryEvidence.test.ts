/**
 * pidDiscoveryEvidence — PR-OBD-DIAG-2 kanıt sözleşmesi kilidi.
 *
 * buildDiscoveryEvidence SALT-türetilmiştir (ek OBD komutu yok): her bitmap bloğu
 * için outcome + continuation (SET/CLEAR/UNKNOWN) + stopReason üretir. "attempted"
 * belirsizliği continuation ZİNCİRİ yeniden kurularak çözülür — boş yanıt zincir
 * canlıysa TIMEOUT_NO_BYTES, zincir ölüyse NOT_ATTEMPTED. Kanıt eksikse (UNKNOWN)
 * evidenceComplete=false → "desteklenmiyor" çıkarımı YASAK.
 */
import { describe, it, expect } from 'vitest';
import { buildDiscoveryEvidence } from '../core/val/OBDHandshake';
import type { RawHandshake } from '../core/val/OBDHandshake';

// Bitmap kurucu: son data baytı bit0 = continuation. SET → "...13", CLEAR → "...00".
const B00_SET   = '4100BE1FB813'; // byte D=0x13 bit0=1 → SET
const B20_SET   = '4120A005B011'; // SET
const B20_CLEAR = '412000000000'; // byte D=0x00 → CLEAR
const B40_CLEAR = '414080000000'; // CLEAR
const B80_SET   = '418000000001'; // SET (son blok değil A0 var)
const BA0_SET   = '41A000000001'; // A0 SET → MAX_STANDARD_BLOCK

function mk(partial: Partial<RawHandshake>): RawHandshake {
  return {
    raw09: '', raw0100: B00_SET,
    raw0120: '', raw0140: '', raw0160: '', raw0180: '', raw01A0: '',
    ...partial,
  };
}
const block = (ev: ReturnType<typeof buildDiscoveryEvidence>, cmd: string) =>
  ev.blocks.find((b) => b.command === cmd)!;

describe('buildDiscoveryEvidence — continuation & outcome', () => {
  it('1) geçerli 0100 continuation SET → 20 sorgulanır', () => {
    const ev = buildDiscoveryEvidence(mk({ raw0100: B00_SET, raw0120: B20_CLEAR }));
    const b00 = block(ev, '0100');
    expect(b00.outcome).toBe('OK');
    expect(b00.continuation).toBe('SET');
    expect(b00.nextBlockAttempted).toBe(true);
    expect(b00.bitmapBytes).toBe('BE1FB813');
  });

  it('2) geçerli 0120 continuation CLEAR → zincir kesin durur, kanıt TAM', () => {
    const ev = buildDiscoveryEvidence(mk({ raw0120: B20_CLEAR }));
    const b20 = block(ev, '0120');
    expect(b20.outcome).toBe('OK');
    expect(b20.continuation).toBe('CLEAR');
    expect(b20.stopReason).toBe('CONTINUATION_CLEAR');
    expect(ev.finalStopReason).toBe('CONTINUATION_CLEAR');
    expect(ev.evidenceComplete).toBe(true);
    expect(block(ev, '0140').outcome).toBe('NOT_ATTEMPTED');
    expect(block(ev, '0140').stopReason).toBe('NOT_REACHED');
  });

  it('3) 0120 SET → 0140 attempted', () => {
    const ev = buildDiscoveryEvidence(mk({ raw0120: B20_SET, raw0140: B40_CLEAR }));
    expect(block(ev, '0120').continuation).toBe('SET');
    expect(block(ev, '0120').nextBlockAttempted).toBe(true);
    expect(block(ev, '0140').attempted).toBe(true);
    expect(block(ev, '0140').outcome).toBe('OK');
    expect(block(ev, '0140').continuation).toBe('CLEAR');
  });

  it('4) 0120 NO_DATA → continuation UNKNOWN, kanıt EKSİK', () => {
    const ev = buildDiscoveryEvidence(mk({ raw0120: 'NO DATA' }));
    const b20 = block(ev, '0120');
    expect(b20.outcome).toBe('NO_DATA');
    expect(b20.continuation).toBe('UNKNOWN');
    expect(b20.stopReason).toBe('OUTCOME_UNKNOWN');
    expect(ev.evidenceComplete).toBe(false);
  });

  it('5) 0120 boş (zincir canlı) → TIMEOUT_NO_BYTES, UNKNOWN', () => {
    const ev = buildDiscoveryEvidence(mk({ raw0120: '' }));
    const b20 = block(ev, '0120');
    expect(b20.attempted).toBe(true);            // 00 SET olduğu için sorgulandı
    expect(b20.outcome).toBe('TIMEOUT_NO_BYTES');
    expect(b20.continuation).toBe('UNKNOWN');
    expect(ev.evidenceComplete).toBe(false);
  });

  it('6) 0120 partial (başlıksız bayt) → TIMEOUT_PARTIAL, responseLength görünür', () => {
    const ev = buildDiscoveryEvidence(mk({ raw0120: 'ABCD' }));
    const b20 = block(ev, '0120');
    expect(b20.outcome).toBe('TIMEOUT_PARTIAL');
    expect(b20.responseLength).toBe(4);
    expect(b20.continuation).toBe('UNKNOWN');
  });

  it('7) 0120 bozuk hex (başlık var, data geçersiz) → PARSE_ERROR', () => {
    const ev = buildDiscoveryEvidence(mk({ raw0120: '4120ZZ' }));
    const b20 = block(ev, '0120');
    expect(b20.outcome).toBe('PARSE_ERROR');
    expect(b20.continuation).toBe('UNKNOWN');
    expect(b20.stopReason).toBe('RESPONSE_INVALID');
  });

  it('8) 4 bayttan kısa bitmap → PARSE_ERROR / UNKNOWN', () => {
    const ev = buildDiscoveryEvidence(mk({ raw0120: '412000' }));
    const b20 = block(ev, '0120');
    expect(b20.outcome).toBe('PARSE_ERROR');
    expect(b20.bitmapBytes).toBeNull();
    expect(b20.continuation).toBe('UNKNOWN');
  });

  it('9) evidence listesi 6 blokla bounded', () => {
    const ev = buildDiscoveryEvidence(mk({
      raw0120: B20_SET, raw0140: '414080000001', raw0160: '416000000001',
      raw0180: B80_SET, raw01A0: BA0_SET,
    }));
    expect(ev.blocks.length).toBe(6);
    expect(block(ev, '01A0').stopReason).toBe('MAX_STANDARD_BLOCK');
    expect(ev.finalStopReason).toBe('MAX_STANDARD_BLOCK');
    expect(ev.evidenceComplete).toBe(true);
  });

  it('10) response preview bounded (≤24 hane)', () => {
    const longHex = '4120' + 'AB'.repeat(40); // çok uzun
    const ev = buildDiscoveryEvidence(mk({ raw0120: longHex }));
    expect(block(ev, '0120').normalizedResponsePreview.length).toBeLessThanOrEqual(24);
  });

  it('11) JSON serialize edilebilir (bounded/düz veri)', () => {
    const ev = buildDiscoveryEvidence(mk({ raw0120: B20_CLEAR }));
    expect(() => JSON.parse(JSON.stringify(ev))).not.toThrow();
  });

  it('12) 0100 CLEAR ise 0120 verisi olsa bile NOT_ATTEMPTED (zincire güven)', () => {
    const ev = buildDiscoveryEvidence(mk({ raw0100: '410000000000', raw0120: B20_SET }));
    expect(block(ev, '0100').continuation).toBe('CLEAR');
    expect(block(ev, '0120').outcome).toBe('NOT_ATTEMPTED');
    expect(ev.evidenceComplete).toBe(true); // CLEAR → kesin
  });

  it('13) PII-güvenli: preview yalnız hex, bitmapBytes yalnız hex', () => {
    const ev = buildDiscoveryEvidence(mk({ raw0120: B20_CLEAR }));
    for (const b of ev.blocks) {
      expect(b.normalizedResponsePreview).toMatch(/^[0-9A-F]*$/);
      if (b.bitmapBytes) expect(b.bitmapBytes).toMatch(/^[0-9A-F]+$/);
    }
  });

  it('14) eski plugin (raw0120 undefined) zincir canlıyken → kanıt EKSİK, dur', () => {
    const ev = buildDiscoveryEvidence(mk({ raw0120: undefined }));
    const b20 = block(ev, '0120');
    expect(b20.outcome).toBe('NOT_ATTEMPTED');
    expect(ev.finalStopReason).toBe('OUTCOME_UNKNOWN');
    expect(ev.evidenceComplete).toBe(false);
  });

  it('15) saha senaryosu — readBlocks ["0","20"], 20 CLEAR → doğru durdu (kanıt TAM)', () => {
    const ev = buildDiscoveryEvidence(mk({ raw0100: B00_SET, raw0120: B20_CLEAR }));
    expect(block(ev, '0100').outcome).toBe('OK');
    expect(block(ev, '0120').outcome).toBe('OK');
    expect(block(ev, '0120').continuation).toBe('CLEAR');
    expect(block(ev, '0140').outcome).toBe('NOT_ATTEMPTED');
    expect(ev.finalStopReason).toBe('CONTINUATION_CLEAR');
    expect(ev.evidenceComplete).toBe(true); // "40 sorgulanmadı çünkü ECU 0x40 desteklemiyor"
  });
});
