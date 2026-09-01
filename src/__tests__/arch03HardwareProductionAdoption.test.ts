import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('ARCH-03 hardware MediaSession ingress', () => {
  it('routes every browser MediaSession transport action through the existing media gateway', () => {
    const source = readFileSync('src/platform/mediaService.ts', 'utf8');
    expect(source).toContain("gateway.play(undefined, 'native_mediasession')");
    expect(source).toContain("gateway.pause(undefined, 'native_mediasession')");
    expect(source).toContain("gateway.next(undefined, 'native_mediasession')");
    expect(source).toContain("gateway.previous(undefined, 'native_mediasession')");
    expect(source).not.toMatch(/setActionHandler\('play',\s*\(\)\s*=>\s*\{\s*play\(\)/);
  });
});
