/**
 * F2 stable media identity. Pure: no I/O, no native call, no module state.
 *
 * Identity is `media:<volumeIdentity>:<mediaStoreId>` because a MediaStore `_ID`
 * is unique only WITHIN a volume: the same numeric id legitimately exists on
 * `external_primary` and on a removable volume at the same time. The legacy F2.0
 * shape (`media:<id>`) is migrated deterministically to the primary volume — the
 * only volume the legacy scanner ever queried.
 */
export const PRIMARY_VOLUME_IDENTITY = 'external_primary';
const SAFE = /[^a-z0-9_.-]/g;

/** MediaStore volume names are already lower-case tokens; unknown/absent → primary. */
export function normalizeVolumeIdentity(volumeName: string | null | undefined): string {
  const raw = (volumeName ?? '').trim().toLowerCase();
  if (!raw || raw === 'external') return PRIMARY_VOLUME_IDENTITY;
  const safe = raw.replace(SAFE, '_');
  return safe || PRIMARY_VOLUME_IDENTITY;
}

export function mediaTrackId(volumeIdentity: string, mediaStoreId: string | number): string {
  return `media:${normalizeVolumeIdentity(volumeIdentity)}:${String(mediaStoreId)}`;
}

export interface ParsedMediaTrackId { readonly volumeIdentity: string; readonly mediaStoreId: string; }

/** Accepts both the canonical and the legacy shape; anything else is not media identity. */
export function parseMediaTrackId(id: string): ParsedMediaTrackId | null {
  if (!id.startsWith('media:')) return null;
  const rest = id.slice(6);
  const sep = rest.indexOf(':');
  if (sep < 0) return rest ? { volumeIdentity: PRIMARY_VOLUME_IDENTITY, mediaStoreId: rest } : null;
  const volumeIdentity = rest.slice(0, sep); const mediaStoreId = rest.slice(sep + 1);
  return volumeIdentity && mediaStoreId ? { volumeIdentity, mediaStoreId } : null;
}

/** Deterministic compatibility for refs persisted before multi-volume identity. */
export function migrateLegacyMediaTrackId(id: string): string {
  const parsed = parseMediaTrackId(id);
  return parsed ? mediaTrackId(parsed.volumeIdentity, parsed.mediaStoreId) : id;
}

export function isLegacyMediaTrackId(id: string): boolean {
  return id.startsWith('media:') && !id.slice(6).includes(':');
}
