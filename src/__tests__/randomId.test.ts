/** randomId.test — kayıt kimlikleri tek kriptografik yardımcıdan (CodeQL, 2026-09-25). */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomToken, randomUuid } from '../utils/randomId';

describe('randomId', () => {
  it('istenen uzunlukta [0-9a-v] parça üretir', () => {
    for (const n of [5, 8, 12]) expect(randomToken(n)).toMatch(new RegExp(`^[0-9a-v]{${n}}$`));
  });
  it('1000 parça çakışmaz', () => {
    expect(new Set(Array.from({ length: 1000 }, () => randomToken(8))).size).toBe(1000);
  });
  it('UUID v4 biçimi', () => {
    expect(randomUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('🔒 kripto yoksa Math.random KULLANILMAZ, yine benzersiz', () => {
    const spy = vi.spyOn(Math, 'random');
    const orig = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      const a = randomToken(8), b = randomToken(8);
      expect(a).not.toBe(b);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: orig, configurable: true });
      spy.mockRestore();
    }
  });
  it('🔒 kimlik üreten yerlerde Math.random().toString(36) kalmadı', () => {
    for (const f of ['platform/bridge.ts', 'platform/connectivityService.ts', 'platform/errorBus.ts',
      'platform/notificationService.ts', 'platform/driverProfileService.ts', 'platform/tripLogService.ts',
      'platform/security/sentryEngine.ts', 'platform/remoteLogService.ts', 'platform/communityService.ts',
      'platform/devtools/navFieldBridge.ts', 'platform/media/playlist/musicPlaylistAuthority.ts']) {
      expect(readFileSync(join(__dirname, '..', f), 'utf8'), f).not.toMatch(/Math\.random\(\)/);
    }
  });
});
