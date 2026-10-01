/**
 * buildInfo.ts — Çalışan paketin derleme damgası (vite define'larından).
 *
 * Kaynak: vite.config → `src/utils/buildStamp.ts` (tek kaynak). Damga yoksa
 * (ör. test ortamı) null döner — sahte commit GÖSTERİLMEZ.
 */

import { parseBuildStamp } from '../utils/buildStamp';
import type { BuildStamp } from '../utils/buildStamp';

export function getBuildStamp(): BuildStamp | null {
  const env = import.meta.env as Record<string, string | undefined>;
  const dirtyRaw = env['VITE_BUILD_DIRTY'];
  return parseBuildStamp({
    commit: env['VITE_BUILD_COMMIT'],
    dirty: dirtyRaw === 'true' ? true : dirtyRaw === 'false' ? false : null,
    branch: env['VITE_BUILD_BRANCH'] ?? 'unknown',
    time: env['VITE_BUILD_TIME'],
  });
}
