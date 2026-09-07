/** Overture ortak provenance normalizasyonu — SAF, I/O ve saat yok. */

import { parseIsoEpochMs } from './adapterContract';

export interface OvertureSourceRef {
  readonly dataset?: string | null;
  readonly license?: string | null;
  readonly record_id?: string | null;
  readonly update_time?: string | null;
  readonly confidence?: number | null;
}

export interface NormalizedOvertureSources {
  readonly upstreamDatasets: readonly string[];
  readonly recordLicenses: readonly string[];
  readonly recordUpdatedAtEpochMs: number | null;
}

export function normalizeOvertureSources(
  rawSources: readonly OvertureSourceRef[] | null | undefined,
): NormalizedOvertureSources {
  const sources = Array.isArray(rawSources) ? rawSources : [];
  const upstreamDatasets = sources.map(
    (source) => (typeof source?.dataset === 'string' && source.dataset.length > 0
      ? source.dataset : 'UNKNOWN'),
  );
  const recordLicenses = [...new Set(
    sources
      .map((source) => source?.license)
      .filter((license): license is string => typeof license === 'string' && license.length > 0),
  )];
  let recordUpdatedAtEpochMs: number | null = null;
  for (const source of sources) {
    const parsed = parseIsoEpochMs(source?.update_time);
    if (parsed !== null && (recordUpdatedAtEpochMs === null || parsed > recordUpdatedAtEpochMs)) {
      recordUpdatedAtEpochMs = parsed;
    }
  }
  return { upstreamDatasets, recordLicenses, recordUpdatedAtEpochMs };
}
