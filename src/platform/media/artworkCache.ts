/**
 * F2 artwork authority — the single resolver every artwork consumer goes through.
 *
 *   UI → resolveArtwork → memory (URL refs) → disk LRU → native sampled decode
 *
 * The UI never calls the native bridge for artwork, and never receives image bytes:
 * the main path hands back a local file URL (`Capacitor.convertFileSrc`) produced by
 * a native sampled decode. Base64 survives only as a compatibility fallback for
 * builds whose native side predates `resolveArtworkFile`.
 *
 * Artwork failure is always local: it can never mark a track missing, change
 * MusicIndex availability or touch playback truth.
 */
import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';
import { isNative } from '../bridge';
import {
  dropArtworkDiskEntry, getArtworkDiskSnapshot, hydrateArtworkDiskIndex, invalidateArtworkDisk,
  lookupArtworkDisk, setArtworkFilePort, storeArtworkDisk, artworkCacheKey,
  type ArtworkFilePort, type ArtworkUsage,
} from './artworkDiskCache';

export type { ArtworkUsage } from './artworkDiskCache';
export type ArtworkSource =
  'MEMORY' | 'DISK' | 'NATIVE' | 'FALLBACK_BASE64' | 'REMOTE' | 'MISSING';
export interface ArtworkResult { readonly key: string; readonly url: string | null; readonly source: ArtworkSource; }

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 256;
const cache = new Map<string, { url: string; bytes: number }>();
let bytes = 0;
const inFlight = new Map<string, Promise<ArtworkResult>>();
let nativeFileTierAvailable = true;
/** MUSIC F7.4 · uzak (sağlayıcı) kapak geçişi sayacı — yalnız GÖZLEM. */
let remoteResolved = 0;

const keyFor = artworkCacheKey;
export const artworkTargetPx = (usage: ArtworkUsage): number =>
  usage === 'thumbnail' ? 96 : usage === 'mini-player' ? 160 : 640;

function evict(): void {
  while ((bytes > MAX_BYTES || cache.size > MAX_ENTRIES) && cache.size) {
    const first = cache.entries().next().value as [string, { bytes: number }];
    cache.delete(first[0]); bytes -= first[1].bytes;
  }
}

function remember(key: string, url: string, byteCost: number): void {
  const old = cache.get(key);
  if (old) { cache.delete(key); bytes -= old.bytes; }
  cache.set(key, { url, bytes: byteCost }); bytes += byteCost; evict();
}

/** Native file tier. `convertFileSrc` is the Capacitor-sanctioned way to show a cache file. */
const nativePort: ArtworkFilePort = {
  async resolve(identity, targetPx) {
    const out = await CarLauncher.resolveArtworkFile({ uri: identity, targetPx });
    if (!out || !out.path) return null;
    return {
      key: out.key, path: out.path, url: Capacitor.convertFileSrc(out.path),
      bytes: out.bytes ?? 0, width: out.width ?? 0, height: out.height ?? 0, sampleSize: out.sampleSize ?? 1,
    };
  },
  async remove(keys) { if (keys.length) await CarLauncher.deleteArtworkFiles({ keys: [...keys] }); },
};

let port: ArtworkFilePort = nativePort;
setArtworkFilePort(nativePort);

/** @internal test seam — swaps both the resolver port and the disk tier's delete port. */
export function _setArtworkFilePortForTest(next: ArtworkFilePort): void { port = next; setArtworkFilePort(next); nativeFileTierAvailable = true; }

async function resolveUncached(identity: string, usage: ArtworkUsage, key: string): Promise<ArtworkResult> {
  const disk = lookupArtworkDisk(identity, usage);
  if (disk) { remember(key, disk.url, 128); return { key, url: disk.url, source: 'DISK' }; }

  if (nativeFileTierAvailable) {
    try {
      const ref = await port.resolve(identity, artworkTargetPx(usage));
      if (ref) { storeArtworkDisk(identity, usage, ref); remember(key, ref.url, 128); return { key, url: ref.url, source: 'NATIVE' }; }
      return { key, url: null, source: 'MISSING' };
    } catch {
      // A build without the native file tier must not keep paying for a failing call.
      nativeFileTierAvailable = false;
    }
  }

  // Compatibility fallback only: base64 is bounded by the memory tier and never persisted.
  try {
    const out = await CarLauncher.getMediaArtDataUri({ uri: identity, targetPx: artworkTargetPx(usage) });
    if (!out?.dataUri) return { key, url: null, source: 'MISSING' };
    remember(key, out.dataUri, out.dataUri.length * 2);
    return { key, url: out.dataUri, source: 'FALLBACK_BASE64' };
  } catch { return { key, url: null, source: 'MISSING' }; }
}

/**
 * MUSIC F7.4 · Uzak (sağlayıcı) kapak kimliği ZATEN çizilebilir bir URL'dir.
 *
 * ÖLÇÜLEN KUSUR: sağlayıcı sonuçlarının kapak kimliği bir `https://` küçük
 * resim adresidir (ör. YouTube `i.ytimg.com`). Bu kimlik native çözücüye
 * gönderiliyordu; o katman MediaStore `content://` URI'si bekler → çözüm
 * DÜŞÜYOR ve Now Playing kapağı BOŞ kalıyordu.
 *
 * SINIR: burada ikinci bir kapak otoritesi kurulmaz ve bayt SAKLANMAZ. Uzak
 * kapak yalnız GEÇİRİLİR; kaynak `REMOTE` olarak dürüstçe raporlanır
 * (yani "önbelleğe alındı" İDDİA EDİLMEZ — tazeleme WebView HTTP
 * önbelleğinindir). Disk katmanı yerel çözümler içindir; uzak baytlar oraya
 * YAZILMAZ.
 */
function isRemoteArtworkIdentity(identity: string): boolean {
  return identity.startsWith('https://') || identity.startsWith('http://');
}

export async function resolveArtwork(identity: string | null, usage: ArtworkUsage): Promise<ArtworkResult> {
  if (!identity) return { key: 'missing', url: null, source: 'MISSING' };
  const key = keyFor(identity, usage);

  if (isRemoteArtworkIdentity(identity)) {
    remoteResolved += 1;
    return { key, url: identity, source: 'REMOTE' };
  }

  const existing = cache.get(key);
  if (existing) { cache.delete(key); cache.set(key, existing); return { key, url: existing.url, source: 'MEMORY' }; }

  hydrateArtworkDiskIndex();
  if (!isNative) {
    const disk = lookupArtworkDisk(identity, usage);
    return disk ? { key, url: disk.url, source: 'DISK' } : { key, url: null, source: 'MISSING' };
  }

  // Coalesced: a list scrolling past 40 rows of one album decodes exactly once.
  const pending = inFlight.get(key);
  if (pending) return pending;
  const task = resolveUncached(identity, usage, key).finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

/**
 * The rendered URL failed to load (cache file cleared by the OS, truncated write).
 * Drop both tiers for that key so the next request decodes again — never render a
 * broken image and never claim the artwork is missing from the library.
 */
export function reportArtworkLoadFailure(identity: string, usage: ArtworkUsage): void {
  const key = keyFor(identity, usage);
  const entry = cache.get(key);
  if (entry) { cache.delete(key); bytes -= entry.bytes; }
  dropArtworkDiskEntry(key);
}

export function invalidateArtwork(identity: string): void {
  for (const [key, value] of cache) if (key.endsWith(`|${identity}`)) { cache.delete(key); bytes -= value.bytes; }
  invalidateArtworkDisk(identity);
}

export function getArtworkCacheSnapshot(): Readonly<{
  entries: number; bytes: number; maxBytes: number; maxEntries: number; inFlight: number;
  nativeFileTier: boolean; remoteResolved: number;
  disk: ReturnType<typeof getArtworkDiskSnapshot>;
}> {
  return Object.freeze({
    entries: cache.size, bytes, maxBytes: MAX_BYTES, maxEntries: MAX_ENTRIES, inFlight: inFlight.size,
    nativeFileTier: nativeFileTierAvailable, remoteResolved, disk: getArtworkDiskSnapshot(),
  });
}

export function _resetArtworkCacheForTest(): void {
  cache.clear(); bytes = 0; inFlight.clear(); nativeFileTierAvailable = true; remoteResolved = 0;
  port = nativePort; setArtworkFilePort(nativePort);
}
/** @internal deterministic memory fixture; production never supplies artwork bytes here. */
export function _seedArtworkCacheForTest(identity: string, usage: ArtworkUsage, url: string): void {
  remember(keyFor(identity, usage), url, url.length * 2);
}
