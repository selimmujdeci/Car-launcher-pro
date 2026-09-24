/**
 * linkingCodeNoFake.test — sunucu yokken SAHTE eşleşme kodu üretilmez.
 *
 * 2026-09-25 (CodeQL js/insecure-randomness incelemesi): `_mockCode()`
 * sunucuya ulaşılamayınca `Math.random` ile 6 haneli kod basıyordu; sunucuda
 * olmayan kod telefona girilince eşleşme sessizce düşüyordu.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../platform/sensitiveKeyStore', () => ({
  sensitiveKeyStore: { get: vi.fn(async () => null), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
}));

import { registerVehicle, refreshLinkingCode } from '../platform/vehicleIdentityService';

describe('eşleşme kodu dürüstlüğü', () => {
  it('🔒 kod alınamazsa HATA — 6 haneli sahte kod dönmez', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('ağ yok'); }) as unknown as typeof fetch;
    await expect(registerVehicle()).rejects.toThrow(/eşleşme kodu|Sunucu/);
    await expect(refreshLinkingCode()).rejects.toThrow(/eşleşme kodu|kayıtlı değil|Sunucu/);
  });

  it('🔒 kaynakta Math.random ile kod üretimi YOK', () => {
    const src = readFileSync(join(__dirname, '../platform/vehicleIdentityService.ts'), 'utf8');
    expect(src).not.toMatch(/Math\.random\(\)\s*\*\s*1_?000_?000/);
    expect(src).not.toMatch(/return _mockCode\(\)/);
  });
});
