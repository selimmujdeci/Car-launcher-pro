import { describe, expect, it } from 'vitest'; import { readFileSync } from 'node:fs'; import { resolve } from 'node:path';
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
describe('ARCH-03/F9 Mavi/UI command boundaries', () => it('routes Mavi media work through its port and preserves native playback authority', () => {
  expect(read('src/platform/maviCore/wiring/maviMediaPort.ts')).toContain('MediaNextPortDeps');
  expect(read('src/platform/media/authority/playbackTruth.ts')).toContain('observedState');
  expect(read('src/platform/media/authority/mediaAuthorityRuntime.ts')).toContain('applySnapshotToMediaState');
}));
