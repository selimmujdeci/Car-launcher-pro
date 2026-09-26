/**
 * commandQueueTruthN7.test.ts — MRI N-7: "sıraya alındı" vaadi ile TTL aynı sayıyı söyler.
 *
 * Araç tarafı kripto kabul penceresi (`src/platform/commandCrypto.COMMAND_VALIDITY_WINDOW_MS`)
 * ile telefonun yazdığı `vehicle_commands.ttl` (`COMMAND_TTL_MS`) BİREBİR aynı olmak
 * zorundadır; kullanıcıya gösterilen kuyruk metni de bu sayıyı taşır.
 */
import { describe, it, expect } from 'vitest';
import { COMMAND_TTL_MS, COMMAND_TTL_MINUTES } from '../lib/commandService';
import { EVIDENCE_DETAIL, EVIDENCE_TITLE } from '../lib/commandEvidence';

describe('MRI N-7 · kuyruk vaadi == TTL == araç kabul penceresi', () => {
  it('TTL 5 dk — araç tarafı COMMAND_VALIDITY_WINDOW_MS ile aynı sayı', () => {
    expect(COMMAND_TTL_MS).toBe(5 * 60_000);
    expect(COMMAND_TTL_MINUTES).toBe(5);
  });

  it('7) kuyruk açıklaması süreyi ve iptali DÜRÜSTÇE söyler ("otomatik çalışacak" vaadi yok)', () => {
    expect(EVIDENCE_DETAIL.QUEUED).toContain(`${COMMAND_TTL_MINUTES} dk`);
    expect(EVIDENCE_DETAIL.QUEUED).toContain('iptal');
    expect(EVIDENCE_DETAIL.QUEUED).not.toMatch(/otomatik çalışacak$/);
    expect(EVIDENCE_TITLE.QUEUED).toBe('Sıraya alındı');
  });

  it('sent ≠ executed: DELIVERED metni fiziksel doğrulama İDDİA ETMEZ', () => {
    expect(EVIDENCE_DETAIL.DELIVERED).toContain('sonucu araçtan kontrol edin');
    expect(EVIDENCE_TITLE.VERIFIED).not.toBe(EVIDENCE_TITLE.DELIVERED);
  });
});
