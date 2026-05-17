import { Capacitor } from '@capacitor/core';
import type { MapSource } from './mapSourceTypes';
import { NATIVE_MAPS_SUBDIRS, OFFLINE_PREF_KEY } from './mapSourceTypes';

/**
 * AbortSignal.timeout() polyfill — Chrome 103+ natively, older Android WebViews need fallback.
 */
export function signalWithTimeout(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

/** Converts lng/lat to TMS tile x/y at a given zoom level (Web Mercator). */
export function lngLatToTile(lng: number, lat: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

interface TileMetadata {
  minzoom?: number;
  maxzoom?: number;
  /** TileJSON 2.x bounds: [west, south, east, north] in WGS-84 */
  bounds?: [number, number, number, number];
  /** TileJSON 2.x center: [lng, lat, zoom] */
  center?: [number, number, number];
}

/**
 * Tries to read TileJSON metadata from /maps/.
 * Supports metadata.json (MBTiles export) and tiles.json (TileJSON 2.x).
 * Returns null if neither file is present or parseable.
 */
export async function readLocalTileMetadata(): Promise<TileMetadata | null> {
  for (const path of ['/maps/metadata.json', '/maps/tiles.json']) {
    try {
      const resp = await fetch(path, { signal: signalWithTimeout(2000) });
      if (resp.ok) return (await resp.json()) as TileMetadata;
    } catch {
      // not found or parse error — try next
    }
  }
  return null;
}

/**
 * Build a small list of probe tile coordinates from TileJSON metadata.
 * Uses bounds center + corners, or center point, or falls back to tile 0/0/0.
 */
export function buildMetadataProbes(meta: TileMetadata): Array<{ z: number; x: number; y: number }> {
  const probes: Array<{ z: number; x: number; y: number }> = [];
  const minZ = meta.minzoom ?? 4;
  const maxZ = meta.maxzoom ?? 14;

  if (meta.bounds) {
    const [west, south, east, north] = meta.bounds;
    const cLng = (west + east) / 2;
    const cLat = (south + north) / 2;
    for (const z of [minZ, Math.min(minZ + 2, maxZ), Math.min(8, maxZ)]) {
      probes.push({ z, ...lngLatToTile(cLng, cLat, z) });
    }
    // Also try SW and NE corners at minZoom
    probes.push({ z: minZ, ...lngLatToTile(west, south, minZ) });
    probes.push({ z: minZ, ...lngLatToTile(east, north, minZ) });
    return probes;
  }

  if (meta.center) {
    const [lng, lat] = meta.center;
    probes.push({ z: minZ, ...lngLatToTile(lng, lat, minZ) });
    if (minZ + 2 <= maxZ) probes.push({ z: minZ + 2, ...lngLatToTile(lng, lat, minZ + 2) });
    return probes;
  }

  // Metadata exists but no location hints — try 0/0/0 at minZoom
  probes.push({ z: minZ, x: 0, y: 0 });
  return probes;
}

/**
 * Probe /maps/ for local tile data.  Country-agnostic.
 *
 * Format desteği: .png (raster) ve .pbf (vector) — her ikisi de denenir.
 *
 * Order:
 *   1. metadata.json / tiles.json → compute exact tiles from bounds/center
 *   2. Exhaustive z=0..2 scan (21 tiles max, covers whole world)
 *   3. Sampled z=4 grid (16 samples, covers regional tile sets)
 *
 * Returns true on first HTTP 200.
 */
export const TILE_EXTENSIONS = ['.png', '.pbf'];

export async function probeOneTile(z: number, x: number, y: number, timeoutMs: number): Promise<boolean> {
  // Her iki format için paralel probe — hangisi önce 200 dönerse kazanır
  const probes = TILE_EXTENSIONS.map(async (ext) => {
    const r = await fetch(`/maps/${z}/${x}/${y}${ext}`, {
      method: 'HEAD',
      signal: signalWithTimeout(timeoutMs),
    });
    if (!r.ok) throw new Error('not found');
    return true;
  });
  try {
    return await Promise.any(probes);
  } catch {
    return false;
  }
}

/**
 * Yerel tile varlığını tespit eder.
 *
 * Optimizasyon: sekansiyel fetch yerine tüm probe'lar paralel çalışır.
 * Promise.any() ile ilk başarılı sonuç anında döner — kalan fetch'ler iptal edilmez
 * ama sonuçları yoksayılır (yerel istekler için düşük maliyet).
 *
 * Ortalama süre (yerel SSD / APK asset):
 *   Önce: ~300ms (21 tile × ~14ms/tile seri)
 *   Sonra: ~15ms  (paralel, ilk hit anında döner)
 */
export async function probeLocalTiles(): Promise<boolean> {
  // ── Strateji 1: Metadata rehberli (hedefli, en hızlı) ─────
  const meta = await readLocalTileMetadata();
  if (meta) {
    const probes = buildMetadataProbes(meta);
    const results = await Promise.allSettled(
      probes.map(({ z, x, y }) => probeOneTile(z, x, y, 2000)),
    );
    return results.some((r) => r.status === 'fulfilled' && r.value);
  }

  // ── Strateji 2: z=0..2 tam tarama — paralel (21 tile) ─────
  const tilesZ02: Array<{ z: number; x: number; y: number }> = [];
  for (let z = 0; z <= 2; z++) {
    const n = Math.pow(2, z);
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) tilesZ02.push({ z, x, y });
    }
  }
  try {
    await Promise.any(
      tilesZ02.map(({ z, x, y }) =>
        probeOneTile(z, x, y, 1500).then((ok) => {
          if (!ok) throw new Error('miss');
          return true;
        }),
      ),
    );
    return true;
  } catch { /* tüm z=0-2 probe başarısız */ }

  // ── Strateji 3: z=4 örneklenmiş grid — paralel (16 tile) ──
  try {
    const tilesZ4 = Array.from({ length: 4 }, (_, xi) =>
      Array.from({ length: 4 }, (__, yi) => ({ z: 4, x: xi * 4, y: yi * 4 })),
    ).flat();
    await Promise.any(
      tilesZ4.map(({ z, x, y }) =>
        probeOneTile(z, x, y, 1000).then((ok) => {
          if (!ok) throw new Error('miss');
          return true;
        }),
      ),
    );
    return true;
  } catch {
    return false;
  }
}

// ── Capacitor Filesystem tile reader ────────────────────────
// Native modda: harici SD kart veya /data/data/... içinden tile okur.
// Böylece tile'lar APK içine paketlenmez — APK boyutu ~%80 azalır.
//
// Harici tile yolu önceliği:
//   1. ExternalStorage/Android/data/com.cockpitos.pro/maps/  (SD kart)
//   2. Data/maps/                                               (iç depo)
//   3. /maps/ (APK public/ asset — fallback)
//
// Tile dosya ismi: {z}/{x}/{y}.png (aynı yapı)

export async function readTileFromFilesystem(
  z: string, x: string, y: string,
  ext = '.png',
): Promise<ArrayBuffer | null> {
  if (!Capacitor.isNativePlatform()) return null;

  // Lazy import — Filesystem yalnızca native modda yüklenir.
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const tilePath = `${z}/${x}/${y}${ext}`;

  // ExternalStorage dene (SD kart)
  for (const subdir of NATIVE_MAPS_SUBDIRS) {
    try {
      const result = await Filesystem.readFile({
        path:      `${subdir}/${tilePath}`,
        directory: Directory.ExternalStorage,
      });
      // Capacitor base64 döner — ArrayBuffer'a çevir
      if (typeof result.data === 'string') {
        const bin = atob(result.data);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return buf.buffer;
      }
      if (result.data instanceof Blob) return result.data.arrayBuffer();
    } catch {
      // Bu dizinde yok — sonraki dene
    }
  }

  // Data directory dene (iç depo)
  try {
    const result = await Filesystem.readFile({
      path:      `maps/${tilePath}`,
      directory: Directory.Data,
    });
    if (typeof result.data === 'string') {
      const bin = atob(result.data);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      return buf.buffer;
    }
    if (result.data instanceof Blob) return result.data.arrayBuffer();
  } catch {
    // iç depoda da yok
  }

  return null;
}

/**
 * Harici tile varlığını kontrol eder — probeLocalTiles() ile aynı amaç,
 * sadece Capacitor Filesystem üzerinden.
 */
export async function probeFilesystemTiles(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  // z=0 tile — try both formats; either one proves the tile store exists
  for (const ext of ['.png', '.pbf']) {
    const buf = await readTileFromFilesystem('0', '0', '0', ext);
    if (buf !== null) return true;
  }
  return false;
}

// ── Offline preference helpers ──────────────────────────────

export function readOfflinePref(): boolean {
  try {
    return localStorage.getItem(OFFLINE_PREF_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeOfflinePref(value: boolean): void {
  try {
    if (value) localStorage.setItem(OFFLINE_PREF_KEY, 'true');
    else        localStorage.removeItem(OFFLINE_PREF_KEY);
  } catch {
    // localStorage unavailable — ignore
  }
}

export interface LocalSourceDetectionResult {
  /** Detected local source (filesystem or cached pref), or null if none found. */
  source: MapSource | null;
  /** True if localStorage indicated local tiles were present on a previous run. */
  hadLocalBefore: boolean;
}

/**
 * Detect available local tile source at app startup.
 * Checks Capacitor Filesystem (native) then localStorage preference.
 * Pure — no store imports; returns data for the manager to act on.
 *
 * Priority:
 *   1. Capacitor Filesystem (SD kart / iç depo) — native modda önce
 *   2. localStorage tercih (optimistic offline-first, web/native)
 */
export async function detectLocalSources(): Promise<LocalSourceDetectionResult> {
  // 1. Capacitor Filesystem probe (native modda)
  if (Capacitor.isNativePlatform()) {
    const fsAvailable = await probeFilesystemTiles();
    if (fsAvailable) {
      writeOfflinePref(true);
      return {
        source: {
          id: 'local',
          name: 'Harici Harita (SD / Depo)',
          type: 'offline',
          description: 'SD kart veya dahili depodan okunan offline harita',
          isAvailable: true,
        },
        hadLocalBefore: true,
      };
    }
  }

  // 2. localStorage tercih kontrolü (optimistic offline-first)
  const hadLocalBefore = readOfflinePref();
  if (hadLocalBefore) {
    return {
      source: {
        id: 'local',
        name: 'Yerel Harita',
        type: 'offline',
        description: 'Cihazda yüklü offline harita verileri',
        isAvailable: true,
      },
      hadLocalBefore: true,
    };
  }

  return { source: null, hadLocalBefore: false };
}
