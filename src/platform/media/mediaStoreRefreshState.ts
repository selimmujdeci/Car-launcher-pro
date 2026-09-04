/**
 * F2 per-volume persistent refresh state.
 *
 * Rule that makes DELTA safe: **a failed scan may never advance persisted state.**
 * Only `saveRefreshState` — called exclusively after a fully applied reconcile —
 * moves version/generation forward. Anything unreadable, schema-mismatched or
 * structurally invalid is discarded, which makes the planner fail closed to
 * FULL_RECONCILE instead of silently trusting a half-written round.
 */
import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../utils/safeStorage';
import type { PersistedRefreshState, VolumeRefreshFact } from './mediaStoreRefreshPlanner';
import { normalizeVolumeIdentity } from './mediaIdentity';

export const REFRESH_STATE_KEY = 'music-mediastore-refresh';
export const REFRESH_STATE_SCHEMA = 1;

const isVolume = (v: unknown): v is VolumeRefreshFact => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.volumeName === 'string' && o.volumeName.length > 0
    && (o.version === null || typeof o.version === 'string')
    && (o.generation === null || (typeof o.generation === 'number' && Number.isFinite(o.generation)))
    && typeof o.available === 'boolean';
};

/** Pure parser — corrupt/foreign/older payloads become `null` (→ FULL_RECONCILE). */
export function parseRefreshState(raw: string | null): PersistedRefreshState | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    if (o.schema !== REFRESH_STATE_SCHEMA) return null;
    if (typeof o.permissionGranted !== 'boolean') return null;
    if (!Array.isArray(o.volumes) || !o.volumes.every(isVolume)) return null;
    const volumes = (o.volumes as VolumeRefreshFact[]).map((v) => Object.freeze({
      volumeName: normalizeVolumeIdentity(v.volumeName), version: v.version, generation: v.generation,
      available: v.available, lastSuccessfulRefreshAt: typeof v.lastSuccessfulRefreshAt === 'number' ? v.lastSuccessfulRefreshAt : null,
    }));
    return Object.freeze({
      schema: REFRESH_STATE_SCHEMA, permissionGranted: o.permissionGranted,
      volumes: Object.freeze(volumes),
      lastSuccessfulRefreshAt: typeof o.lastSuccessfulRefreshAt === 'number' ? o.lastSuccessfulRefreshAt : null,
    });
  } catch { return null; }
}

export function loadRefreshState(): PersistedRefreshState | null {
  try { return parseRefreshState(safeGetRaw(REFRESH_STATE_KEY)); } catch { return null; }
}

/** Fail-soft: a persistence failure costs one extra FULL_RECONCILE, never correctness. */
export function saveRefreshState(state: PersistedRefreshState): boolean {
  try { safeSetRaw(REFRESH_STATE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}

export function clearRefreshState(): void {
  try { safeRemoveRaw(REFRESH_STATE_KEY); } catch { /* fail-soft */ }
}

/** Builds the next persisted round; `observedAt` is supplied by the caller (no `Date.now` here). */
export function buildRefreshState(
  volumes: readonly VolumeRefreshFact[], permissionGranted: boolean, observedAt: number,
): PersistedRefreshState {
  return Object.freeze({
    schema: REFRESH_STATE_SCHEMA, permissionGranted,
    volumes: Object.freeze(volumes.map((v) => Object.freeze({
      volumeName: normalizeVolumeIdentity(v.volumeName), version: v.version, generation: v.generation,
      available: v.available, lastSuccessfulRefreshAt: observedAt,
    }))),
    lastSuccessfulRefreshAt: observedAt,
  });
}
