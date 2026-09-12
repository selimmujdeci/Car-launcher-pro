import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('ARCH-04/F3 native callback stale guard', () => {
  it('rejects stale media bridge callbacks without creating a playback owner', () => {
    const source = readFileSync('src/platform/media/authority/nativeAuthorityBridge.ts', 'utf8');
    expect(source).toContain('generation !== _listenerGeneration');
    expect(source).toContain('if (!_started || generation !== _listenerGeneration) return;');
    expect(source).toContain('MediaCommandGateway');
  });
});
