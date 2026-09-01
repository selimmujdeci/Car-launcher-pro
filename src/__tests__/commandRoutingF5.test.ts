import { describe, expect, it } from 'vitest'; import { readFileSync } from 'node:fs'; import { resolve } from 'node:path';
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
describe('ARCH-03/F5 cross-domain routing', () => it('keeps Mavi as a requester and preserves companion correlation', () => {
  expect(read('src/platform/maviCore/wiring/maviMediaPort.ts')).toContain('correlationId');
  const companion = read('src/platform/companion/messageEnvelope.ts'); expect(companion).toContain('correlationId'); expect(companion).toContain('response');
}));
