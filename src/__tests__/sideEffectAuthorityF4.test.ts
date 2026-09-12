import { describe, expect, it } from 'vitest'; import { readFileSync } from 'node:fs'; import { resolve } from 'node:path';
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
describe('ARCH-03/F4 side-effect authority', () => it('keeps media, navigation and diagnostic execution at their owner boundaries', () => {
  expect(read('src/platform/media/authority/mediaCommandGateway.ts')).toContain('playSource');
  expect(read('src/platform/navigationService.ts')).toContain('export function activateNavigation');
  expect(read('src/platform/obd/diagnosticTransaction.ts')).toContain('sessionEpoch');
}));
