/**
 * F2 artwork disk tier — bounded, persistent, LRU.
 *
 * Split of responsibility (deliberate, so the policy is testable and the bytes
 * never cross the bridge twice):
 *   · NATIVE owns the bytes: sampled decode, atomic `.tmp` → rename write into a
 *     schema-versioned cache directory, and deletion.
 *   · THIS MODULE owns the policy: deterministic key, byte/entry bounds, LRU
 *     eviction, invalidation, restart reuse and corrupt-entry recovery.
 *
 * Fail-soft is absolute: every failure here degrades to "no artwork". Artwork is
 * never allowed to affect MusicIndex or playback truth.
 */
import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../utils/safeStorage';

export type ArtworkUsage = 'thumbnail' | 'mini-player' | 'now-playing';

/** Native-decoded file descriptor. `key` is the native file identity, not the cache key. */
export interface ArtworkFileRef {
  readonly key: string; readonly path: string; readonly url: string;
  readonly bytes: number; readonly width: number; readonly height: number; readonly sampleSize: number;
}

/** Injection seam: production binds the native plugin, tests bind a fake. */
export interface ArtworkFilePort {
  resolve(identity: string, targetPx: number): Promise<ArtworkFileRef | null>;
  remove(keys: readonly string[]): Promise<void>;
}

export interface ArtworkDiskEntry {
  readonly cacheKey: string; readonly identity: string; readonly usage: ArtworkUsage;
  readonly nativeKey: string; readonly url: string; readonly bytes: number;
  readonly storedAt: number; readonly lastUsedAt: number;
}

export const ARTWORK_DISK_SCHEMA = 1;
export const ARTWORK_DISK_KEY = 'music-artwork-disk';
export const ARTWORK_DISK_MAX_BYTES = 24 * 1024 * 1024;
export const ARTWORK_DISK_MAX_ENTRIES = 512;

/** Deterministic: same identity + usage always maps to the same cache key. */
export const artworkCacheKey = (identity: string, usage: ArtworkUsage): string => `${usage}|${identity}`;

let port: ArtworkFilePort | null = null;
/** Insertion order is LRU order: a hit re-inserts at the tail. */
const index = new Map<string, ArtworkDiskEntry>();
let bytes = 0;
let hydrated = false;
let clock: () => number = () => Date.now();

export function setArtworkFilePort(next: ArtworkFilePort | null): void { port = next; }

function persist(): void {
  try {
    safeSetRaw(ARTWORK_DISK_KEY, JSON.stringify({ schema: ARTWORK_DISK_SCHEMA, entries: [...index.values()] }));
  } catch { /* fail-soft: the cache simply becomes cold on next boot */ }
}

const isEntry = (v: unknown): v is ArtworkDiskEntry => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.cacheKey === 'string' && typeof o.identity === 'string' && typeof o.nativeKey === 'string'
    && typeof o.url === 'string' && o.url.length > 0
    && typeof o.bytes === 'number' && Number.isFinite(o.bytes) && o.bytes >= 0
    && (o.usage === 'thumbnail' || o.usage === 'mini-player' || o.usage === 'now-playing')
    && typeof o.storedAt === 'number' && typeof o.lastUsedAt === 'number';
};

/** Restart reuse. A corrupt or foreign-schema index is discarded whole, not guessed at. */
export function hydrateArtworkDiskIndex(): void {
  if (hydrated) return;
  hydrated = true;
  let raw: string | null = null;
  try { raw = safeGetRaw(ARTWORK_DISK_KEY); } catch { raw = null; }
  if (!raw) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    const o = parsed as Record<string, unknown> | null;
    if (!o || o.schema !== ARTWORK_DISK_SCHEMA || !Array.isArray(o.entries)) { void purgeArtworkDisk('schema'); return; }
    const entries = (o.entries as unknown[]).filter(isEntry);
    entries.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    for (const e of entries) { index.set(e.cacheKey, e); bytes += e.bytes; }
    if (entries.length !== (o.entries as unknown[]).length) persist();
  } catch { void purgeArtworkDisk('corrupt'); }
}

function evict(): string[] {
  const dropped: string[] = [];
  while ((bytes > ARTWORK_DISK_MAX_BYTES || index.size > ARTWORK_DISK_MAX_ENTRIES) && index.size > 0) {
    const oldest = index.keys().next().value as string;
    const entry = index.get(oldest)!;
    index.delete(oldest); bytes -= entry.bytes; dropped.push(entry.nativeKey);
  }
  return dropped;
}

/** LRU read: a hit moves the entry to the tail so eviction stays deterministic. */
export function lookupArtworkDisk(identity: string, usage: ArtworkUsage): ArtworkDiskEntry | null {
  hydrateArtworkDiskIndex();
  const key = artworkCacheKey(identity, usage);
  const entry = index.get(key);
  if (!entry) return null;
  const touched: ArtworkDiskEntry = { ...entry, lastUsedAt: clock() };
  index.delete(key); index.set(key, touched); persist();
  return touched;
}

export function storeArtworkDisk(identity: string, usage: ArtworkUsage, ref: ArtworkFileRef): ArtworkDiskEntry {
  hydrateArtworkDiskIndex();
  const key = artworkCacheKey(identity, usage);
  const previous = index.get(key);
  if (previous) { index.delete(key); bytes -= previous.bytes; }
  const now = clock();
  const entry: ArtworkDiskEntry = Object.freeze({
    cacheKey: key, identity, usage, nativeKey: ref.key, url: ref.url,
    bytes: Math.max(0, ref.bytes), storedAt: now, lastUsedAt: now,
  });
  index.set(key, entry); bytes += entry.bytes;
  const dropped = evict();
  persist();
  if (dropped.length) void port?.remove(dropped).catch(() => {});
  return entry;
}

/** Corrupt/missing-file recovery: drop the claim, delete the file, force a re-decode. */
export function dropArtworkDiskEntry(cacheKey: string): void {
  hydrateArtworkDiskIndex();
  const entry = index.get(cacheKey);
  if (!entry) return;
  index.delete(cacheKey); bytes -= entry.bytes; persist();
  void port?.remove([entry.nativeKey]).catch(() => {});
}

export function invalidateArtworkDisk(identity: string): number {
  hydrateArtworkDiskIndex();
  const keys: string[] = []; const nativeKeys: string[] = [];
  for (const [key, entry] of index) if (entry.identity === identity) { keys.push(key); nativeKeys.push(entry.nativeKey); }
  for (const key of keys) { const entry = index.get(key)!; index.delete(key); bytes -= entry.bytes; }
  if (keys.length) { persist(); void port?.remove(nativeKeys).catch(() => {}); }
  return keys.length;
}

export async function purgeArtworkDisk(reason: string): Promise<string> {
  const nativeKeys = [...index.values()].map((e) => e.nativeKey);
  index.clear(); bytes = 0;
  try { safeRemoveRaw(ARTWORK_DISK_KEY); } catch { /* fail-soft */ }
  if (nativeKeys.length) { try { await port?.remove(nativeKeys); } catch { /* fail-soft */ } }
  return reason;
}

export function getArtworkDiskSnapshot(): Readonly<{
  schema: number; hydrated: boolean; entries: number; bytes: number; maxBytes: number; maxEntries: number;
}> {
  return Object.freeze({
    schema: ARTWORK_DISK_SCHEMA, hydrated, entries: index.size, bytes,
    maxBytes: ARTWORK_DISK_MAX_BYTES, maxEntries: ARTWORK_DISK_MAX_ENTRIES,
  });
}

/** @internal test seam; production never rewinds the clock or replaces the index. */
export function _resetArtworkDiskForTest(now?: () => number): void {
  index.clear(); bytes = 0; hydrated = false; port = null;
  clock = now ?? (() => Date.now());
  try { safeRemoveRaw(ARTWORK_DISK_KEY); } catch { /* ignore */ }
}
/** @internal forces the next read to re-hydrate from storage (restart simulation). */
export function _rehydrateArtworkDiskForTest(): void { index.clear(); bytes = 0; hydrated = false; hydrateArtworkDiskIndex(); }
