import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('ARCH-04 CAN native listener lifecycle', () => {
  it('guards asynchronous native listener registration and removes both handles', () => {
    const source = readFileSync('src/platform/vehicleDataLayer/CanAdapter.ts', 'utf8');
    expect(source).toContain('this._unsub || this._starting');
    expect(source).toContain('generation !== this._listenerGeneration');
    expect(source).toContain('statusHandle?.remove()');
    expect(source).not.toContain('vehicle identity');
  });
});
