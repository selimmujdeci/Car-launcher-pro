/**
 * MapManifestService — Tile delta hesaplama ve bütünlük doğrulama.
 *
 * Manifest formatı (manifest.json):
 *   { version, regionId, generatedAt, tiles: { "z/x/y": "crc32hex" } }
 *
 * CRC32 seçim sebebi:
 *   • Saf JS — crypto API veya WASM gerekmez
 *   • 32-bit → manifest başına < 1KB overhead (10k tile için ~340KB)
 *   • PNG bütünlüğü için yeterli — MD5/SHA gerekmez
 *
 * Delta hesaplama önceliği:
 *   toDelete → yeni versiyonda olmayan tile'lar
 *   toDownload → yeni veya hash'i farklı tile'lar
 *   toKeep → hash eşleşen tile'lar (kopyalanacak, indirilmeyecek)
 */

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { logError } from '../crashLogger';
import { isFeatureEnabled, recordFault } from '../safety/SafetyBrain';

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface TileManifest {
  version:     string;
  regionId:    string;
  generatedAt: number;
  /** Anahtar: "z/x/y", Değer: CRC32 hex string */
  tiles:       Record<string, string>;
}

export interface ManifestDelta {
  /** Uzak sunucudan indirilecek tile anahtarları */
  toDownload: string[];
  /** Mevcut versiyondan kopyalanacak tile anahtarları */
  toKeep:     string[];
  /** Silinecek (yeni versiyonda olmayan) tile anahtarları */
  toDelete:   string[];
}

/* ── CRC32 lookup table ───────────────────────────────────────────────────── */

const _CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[i] = c;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (const b of bytes) {
    crc = (_CRC_TABLE[(crc ^ b) & 0xFF] ?? 0) ^ (crc >>> 8);
  }
  return ((crc ^ 0xFFFFFFFF) >>> 0);
}

function crc32Hex(bytes: Uint8Array): string {
  return crc32(bytes).toString(16).padStart(8, '0');
}

/* ── PNG header validation ────────────────────────────────────────────────── */

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

export function isPngValid(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_MAGIC[i]) return false;
  }
  return true;
}

/* ── Filesystem helpers ───────────────────────────────────────────────────── */

const FS_DIR = Directory.Data;

async function _readBase64(path: string): Promise<Uint8Array | null> {
  try {
    const file = await Filesystem.readFile({ path, directory: FS_DIR });
    const b64  = typeof file.data === 'string' ? file.data : '';
    if (!b64) return null;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function _readJson<T>(path: string): Promise<T | null> {
  try {
    const file = await Filesystem.readFile({
      path,
      directory: FS_DIR,
      encoding:  Encoding.UTF8,
    });
    return JSON.parse(file.data as string) as T;
  } catch {
    return null;
  }
}

async function _writeJson(path: string, data: unknown): Promise<void> {
  await Filesystem.writeFile({
    path,
    data:      JSON.stringify(data),
    directory: FS_DIR,
    encoding:  Encoding.UTF8,
    recursive: true,
  });
}

/* ── Tile directory scanner ───────────────────────────────────────────────── */

/**
 * `offline_tiles/v{N}/` dizinindeki tüm tile'ları tarar, CRC32 hesaplar.
 * Yüksek tile sayısı için idleCallback batch'leri kullanır (UI dondurulmaz).
 */
export async function generateLocalManifest(
  regionId:  string,
  versionId: string,
): Promise<TileManifest> {
  const manifest: TileManifest = {
    version:     versionId,
    regionId,
    generatedAt: Date.now(),
    tiles:       {},
  };

  const rootPath = `offline_tiles/${versionId}`;

  try {
    const zDirs = await Filesystem.readdir({ path: rootPath, directory: FS_DIR });

    for (const zEntry of zDirs.files) {
      if (zEntry.type !== 'directory') continue;
      const z = parseInt(zEntry.name);
      if (isNaN(z)) continue;

      const xDirs = await Filesystem.readdir({
        path:      `${rootPath}/${zEntry.name}`,
        directory: FS_DIR,
      });

      for (const xEntry of xDirs.files) {
        if (xEntry.type !== 'directory') continue;
        const x = parseInt(xEntry.name);
        if (isNaN(x)) continue;

        const yFiles = await Filesystem.readdir({
          path:      `${rootPath}/${zEntry.name}/${xEntry.name}`,
          directory: FS_DIR,
        });

        for (const yEntry of yFiles.files) {
          if (!yEntry.name.endsWith('.png')) continue;
          const y = parseInt(yEntry.name.replace('.png', ''));
          if (isNaN(y)) continue;

          const tilePath = `${rootPath}/${z}/${x}/${y}.png`;
          const bytes    = await _readBase64(tilePath);
          if (!bytes) continue;

          manifest.tiles[`${z}/${x}/${y}`] = crc32Hex(bytes);
        }
      }
    }
  } catch (e) {
    logError('MapManifest:scan', e);
  }

  // Manifest'i versiyonlu dizine kaydet
  try {
    await _writeJson(`${rootPath}/manifest.json`, manifest);
  } catch (e) {
    logError('MapManifest:write', e);
  }

  return manifest;
}

/**
 * Manifest'i dosyadan yükle. Yoksa null döner.
 */
export async function loadManifest(versionId: string): Promise<TileManifest | null> {
  return _readJson<TileManifest>(`offline_tiles/${versionId}/manifest.json`);
}

/**
 * İki manifest arasındaki delta'yı hesapla.
 * localManifest: cihazda yüklü mevcut versiyon.
 * remoteManifest: sunucudan gelen yeni versiyon.
 */
export function computeDelta(
  localManifest:  TileManifest,
  remoteManifest: TileManifest,
): ManifestDelta {
  const localKeys  = new Set(Object.keys(localManifest.tiles));
  const remoteKeys = new Set(Object.keys(remoteManifest.tiles));

  const toDownload: string[] = [];
  const toKeep:     string[] = [];
  const toDelete:   string[] = [];

  // Uzak versiyonda olan her tile'ı kontrol et
  for (const key of remoteKeys) {
    if (!localKeys.has(key)) {
      // Yerel'de yok → indir
      toDownload.push(key);
    } else if (localManifest.tiles[key] !== remoteManifest.tiles[key]) {
      // Hash farklı → indir (değişmiş)
      toDownload.push(key);
    } else {
      // Hash aynı → kopyala
      toKeep.push(key);
    }
  }

  // Yerel'de olan ama uzak'ta olmayan tile'lar → sil
  for (const key of localKeys) {
    if (!remoteKeys.has(key)) {
      toDelete.push(key);
    }
  }

  return { toDownload, toKeep, toDelete };
}

/**
 * Tile key'i ("z/x/y") bileşenlerine ayır.
 */
export function parseTileKey(key: string): { z: number; x: number; y: number } | null {
  const parts = key.split('/');
  if (parts.length !== 3) return null;
  const z = parseInt(parts[0]!);
  const x = parseInt(parts[1]!);
  const y = parseInt(parts[2]!);
  if (isNaN(z) || isNaN(x) || isNaN(y)) return null;
  return { z, x, y };
}

/* ── Integrity check ──────────────────────────────────────────────────────── */

export interface IntegrityReport {
  ok:        boolean;
  total:     number;
  corrupted: string[];  // bozuk tile key'leri
  missing:   string[];  // eksik tile key'leri
}

/**
 * Belirli bir versiyonun tüm tile'larında PNG magic byte ve CRC32 doğrulaması yapar.
 * Corrupt veya eksik tile > 0 ise `ok: false` döner.
 */
export async function verifyIntegrity(versionId: string): Promise<IntegrityReport> {
  if (!isFeatureEnabled('mapManifestIntegrityVerify')) {
    return { ok: true, total: 0, corrupted: [], missing: [] };
  }

  const manifest = await loadManifest(versionId);
  const report: IntegrityReport = {
    ok:        true,
    total:     0,
    corrupted: [],
    missing:   [],
  };

  if (!manifest) {
    report.ok = false;
    recordFault('MAP_TILE_CRC_FAIL');
    return report;
  }

  const keys = Object.keys(manifest.tiles);
  report.total = keys.length;

  for (const key of keys) {
    const coord = parseTileKey(key);
    if (!coord) continue;

    const tilePath = `offline_tiles/${versionId}/${coord.z}/${coord.x}/${coord.y}.png`;
    const bytes    = await _readBase64(tilePath);

    if (!bytes) {
      report.missing.push(key);
      report.ok = false;
      continue;
    }

    if (!isPngValid(bytes)) {
      report.corrupted.push(key);
      report.ok = false;
      continue;
    }

    const expected = manifest.tiles[key];
    if (expected && crc32Hex(bytes) !== expected) {
      report.corrupted.push(key);
      report.ok = false;
    }
  }

  if (!report.ok) {
    recordFault('MAP_TILE_CRC_FAIL');
  }

  return report;
}
