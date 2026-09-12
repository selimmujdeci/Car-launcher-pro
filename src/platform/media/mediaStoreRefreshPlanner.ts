/** Pure refresh policy. It is refresh metadata, never a second library or playback authority. */
export type RefreshDecision = 'UNCHANGED' | 'DELTA' | 'FULL_RECONCILE';
export interface VolumeRefreshFact { readonly volumeName: string; readonly version: string | null; readonly generation: number | null; readonly available: boolean;
  /** Persisted rounds carry it; a live observation does not. Never used as a decision input. */
  readonly lastSuccessfulRefreshAt?: number | null; }
export interface PersistedRefreshState { readonly schema: 1; readonly permissionGranted: boolean; readonly volumes: readonly VolumeRefreshFact[];
  readonly lastSuccessfulRefreshAt?: number | null; }
export interface RefreshPlan { readonly decision: RefreshDecision; readonly reason: string; readonly deltaVolumes: readonly string[]; }
export function planMediaStoreRefresh(previous: PersistedRefreshState | null, current: readonly VolumeRefreshFact[], permissionGranted: boolean): RefreshPlan {
  if (!permissionGranted) return { decision: 'FULL_RECONCILE', reason: 'permission_revoked', deltaVolumes: [] };
  if (!previous || previous.schema !== 1 || !previous.permissionGranted) return { decision: 'FULL_RECONCILE', reason: 'missing_or_invalid_state', deltaVolumes: [] };
  const old = new Map(previous.volumes.map((v) => [v.volumeName, v]));
  if (old.size !== current.length || current.some((v) => !old.has(v.volumeName) || old.get(v.volumeName)?.available !== v.available)) return { decision: 'FULL_RECONCILE', reason: 'volume_attach_detach', deltaVolumes: [] };
  const changed: string[] = [];
  for (const v of current) { const prior = old.get(v.volumeName)!; if (prior.version !== v.version || prior.generation === null || v.generation === null) return { decision: 'FULL_RECONCILE', reason: 'version_changed_or_generation_unavailable', deltaVolumes: [] }; if (v.generation < prior.generation) return { decision: 'FULL_RECONCILE', reason: 'generation_regressed', deltaVolumes: [] }; if (v.generation > prior.generation) changed.push(v.volumeName); }
  return changed.length ? { decision: 'DELTA', reason: 'generation_advanced_delete_requires_followup_reconcile', deltaVolumes: Object.freeze(changed) } : { decision: 'UNCHANGED', reason: 'version_and_generation_equal', deltaVolumes: [] };
}
