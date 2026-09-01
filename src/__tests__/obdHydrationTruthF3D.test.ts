import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/platform/canSnapshotService.ts'), 'utf8');
const hydration = source.slice(source.indexOf('function _buildPatch'), source.indexOf('/* ── Public API'));

describe('ARCH-02/F3-D · OBD/CAN hydration truth boundary', () => {
  it('never assigns a persisted snapshot a live source/session/connection claim', () => {
    expect(hydration).not.toContain("patch.source = 'real'");
    for (const forbidden of ['connectionState', 'transportConnected', 'dataFresh', 'lastSeenMs', 'lastRxAt']) {
      expect(hydration).not.toContain(`patch.${forbidden}`);
    }
  });

  it('keeps snapshot values as bounded historical cache candidates only', () => {
    expect(hydration).toContain('STALE_DYNAMIC_MS');
    expect(hydration).toContain('STALE_SEMI_STATIC_MS');
    expect(hydration).toContain('STALE_STATIC_MS');
    expect(source).toContain("source/transport/dataFresh gerçeği yalnız native session ingress'ten");
  });
});
