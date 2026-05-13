/**
 * offlineTileServer — Versiyonlu atomik tile depolama ve servis katmanı.
 *
 * Dizin yapısı:
 *   offline_tiles/
 *     current_version.txt   → "v2" gibi aktif versiyon ID
 *     previous_version.txt  → "v1" (rollback için)
 *     v1/z/x/y.png
 *     v2/z/x/y.png
 *     staging/              → download sırasındaki geçici dizin
 *
 * Atomik swap:
 *   1. staging/v_next/ içine yazılır (verifyIntegrity geçtikten sonra)
 *   2. commitUpdate() → previous=current, current=next, staging/ silinir
 *   3. Rollback: current=previous (staging dokunulmaz)
 *
 * MapLibre tile error guard:
 *   10 ardışık hata → otomatik rollbackToPreviousVersion()
 */

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { logError } from './crashLogger';
import { verifyIntegrity } from './maps/MapManifestService';
import type { IntegrityReport } from './maps/MapManifestService';
import { isFeatureEnabled, recordFault } from './safety/SafetyBrain';

/* ── Constants ────────────────────────────────────────────────────────────── */

const FS_DIR              = Directory.Data;
const ROOT                = 'offline_tiles';
const CURRENT_FILE        = `${ROOT}/current_version.txt`;
const PREVIOUS_FILE       = `${ROOT}/previous_version.txt`;
const STAGING_DIR         = `${ROOT}/staging`;
const MAX_TILE_ERRORS     = 10;

/* ── State ────────────────────────────────────────────────────────────────── */

let _tileServerReady      = false;
let _consecutiveTileErrors = 0;
let _rollbackInProgress   = false;

/* ── Filesystem helpers ───────────────────────────────────────────────────── */

async function _readText(path: string): Promise<string | null> {
  try {
    const f = await Filesystem.readFile({ path, directory: FS_DIR, encoding: Encoding.UTF8 });
    return (f.data as string).trim();
  } catch {
    return null;
  }
}

async function _writeText(path: string, text: string): Promise<void> {
  await Filesystem.writeFile({
    path,
    data:      text,
    directory: FS_DIR,
    encoding:  Encoding.UTF8,
    recursive: true,
  });
}

async function _readBase64(path: string): Promise<ArrayBuffer | null> {
  try {
    const f   = await Filesystem.readFile({ path, directory: FS_DIR });
    const b64 = typeof f.data === 'string' ? f.data : '';
    if (!b64) return null;
    const bin  = atob(b64);
    const out  = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  } catch {
    return null;
  }
}

async function _writeBase64(path: string, data: ArrayBuffer): Promise<void> {
  const bytes  = new Uint8Array(data);
  let   binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  await Filesystem.writeFile({
    path,
    data:      b64,
    directory: FS_DIR,
    recursive: true,
  });
}

async function _deleteDir(path: string): Promise<void> {
  try {
    await Filesystem.rmdir({ path, directory: FS_DIR, recursive: true });
  } catch {
    /* silently ignore — may not exist */
  }
}

/* ── Version management ───────────────────────────────────────────────────── */

/** Aktif versiyon ID'sini döndür (ör. "v2"). Yoksa null. */
export async function getCurrentVersionId(): Promise<string | null> {
  return _readText(CURRENT_FILE);
}

/** Önceki versiyon ID'sini döndür (rollback hedefi). */
export async function getPreviousVersionId(): Promise<string | null> {
  return _readText(PREVIOUS_FILE);
}

/**
 * Mevcut versiyondan bir sonrakini üretir.
 * "v3" → "v4", null → "v1"
 */
export function nextVersionId(current: string | null): string {
  if (!current) return 'v1';
  const n = parseInt(current.replace('v', ''));
  return `v${isNaN(n) ? 1 : n + 1}`;
}

/** Staging dizin yolu — mapDownloadManager tarafından kullanılır. */
export function getStagingPath(versionId: string): string {
  return `${STAGING_DIR}/${versionId}`;
}

/** Versiyonlu tile dizin yolu. */
export function getVersionPath(versionId: string): string {
  return `${ROOT}/${versionId}`;
}

/* ── Server init ──────────────────────────────────────────────────────────── */

/**
 * Offline tile server'ı başlatır.
 * Mevcut versiyon dizini doğrulanır; protocol handler kaydedilir.
 */
export async function initializeOfflineTileServer(): Promise<void> {
  try {
    // Root dir oluştur (zaten varsa hata yok)
    await Filesystem.mkdir({
      path:      ROOT,
      directory: FS_DIR,
      recursive: true,
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.toLowerCase().includes('exist')) logError('offlineTileServer:mkdir', e);
    });

    _registerTileProtocolHandler();
    _tileServerReady = true;
  } catch (err) {
    logError('offlineTileServer:initialize', err);
  }
}

export function isOfflineTileServerReady(): boolean {
  return _tileServerReady;
}

/* ── Protocol handler ─────────────────────────────────────────────────────── */

function _registerTileProtocolHandler(): void {
  const originalFetch = globalThis.fetch;

  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async function (
    input:  RequestInfo | URL,
    init?:  RequestInit,
  ): Promise<Response> {
    const url = input.toString();

    if (url.startsWith('tile://')) {
      return _serveTileFromLocal(url);
    }

    const osmMatch = url.match(/\/tiles\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (osmMatch) {
      const [, z, x, y] = osmMatch;
      const buf = await getTileFromLocal(parseInt(z!), parseInt(x!), parseInt(y!));
      if (buf) {
        return new Response(buf, {
          status:  200,
          headers: { 'Content-Type': 'image/png' },
        });
      }
    }

    return originalFetch.call(this, input, init);
  };
}

async function _serveTileFromLocal(url: string): Promise<Response> {
  try {
    const m = url.match(/tile:\/\/(\d+)\/(\d+)\/(\d+)/);
    if (!m) return new Response('Invalid tile URL', { status: 400 });

    const buf = await getTileFromLocal(parseInt(m[1]!), parseInt(m[2]!), parseInt(m[3]!));
    if (buf) {
      _consecutiveTileErrors = 0;
      return new Response(buf, {
        status:  200,
        headers: {
          'Content-Type':  'image/png',
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    }

    _onTileError();
    return new Response('Tile not found', { status: 404 });
  } catch (err) {
    _onTileError();
    logError('offlineTileServer:serve', err);
    return new Response('Server error', { status: 500 });
  }
}

/* ── Tile error guard ─────────────────────────────────────────────────────── */

function _onTileError(): void {
  _consecutiveTileErrors++;
  if (
    _consecutiveTileErrors >= MAX_TILE_ERRORS &&
    !_rollbackInProgress &&
    isFeatureEnabled('offlineTileAutoRollback')
  ) {
    console.warn('[TILE_SERVER] 10 ardışık hata → otomatik rollback');
    rollbackToPreviousVersion().catch((e) => logError('offlineTileServer:autoRollback', e));
  }
}

/** MapLibre tile hatasında çağrılır (dış bileşenlerden). */
export function reportMapLibreTileError(): void {
  _onTileError();
}

/** Başarılı tile serve sonrası sayacı sıfırla. */
export function resetTileErrorCounter(): void {
  _consecutiveTileErrors = 0;
}

/* ── Tile reader ──────────────────────────────────────────────────────────── */

/**
 * Aktif versiyondan tile okur.
 * Aktif versiyon yoksa staging'den okumaya çalışmaz — sadece aktif serve edilir.
 */
export async function getTileFromLocal(z: number, x: number, y: number): Promise<ArrayBuffer | null> {
  const versionId = await getCurrentVersionId();
  if (versionId) {
    const buf = await _readBase64(`${ROOT}/${versionId}/${z}/${x}/${y}.png`);
    if (buf) return buf;
  }
  // Eski path uyumluluğu: versiyonsuz 'maps/' dizini
  return _readBase64(`maps/${z}/${x}/${y}.png`);
}

/* ── Tile writer ──────────────────────────────────────────────────────────── */

/**
 * Tile'ı belirli bir versiyonun staging dizinine yazar.
 * mapDownloadManager tarafından kullanılır.
 */
export async function writeTileToVersion(
  versionId: string,
  z:         number,
  x:         number,
  y:         number,
  data:      ArrayBuffer,
  staging:   boolean = true,
): Promise<void> {
  const base = staging ? `${STAGING_DIR}/${versionId}` : `${ROOT}/${versionId}`;
  await _writeBase64(`${base}/${z}/${x}/${y}.png`, data);
}

/**
 * Bir tile'ı mevcut versiyondan staging'e kopyala (delta modda değişmeyenler).
 * Büyük tile paketlerinde ağ yerine local kopya — disk I/O ama ağ tasarrufu.
 */
export async function copyTileToStaging(
  fromVersionId: string,
  toVersionId:   string,
  z:             number,
  x:             number,
  y:             number,
): Promise<boolean> {
  const buf = await _readBase64(`${ROOT}/${fromVersionId}/${z}/${x}/${y}.png`);
  if (!buf) return false;
  await _writeBase64(`${STAGING_DIR}/${toVersionId}/${z}/${x}/${y}.png`, buf);
  return true;
}

/* ── Atomic swap ──────────────────────────────────────────────────────────── */

/**
 * Staging'deki yeni versiyonu aktif hale getirir.
 *
 * Akış:
 *   1. verifyIntegrity(newVersionId) — PNG header + CRC32
 *   2. staging/v_next → offline_tiles/v_next (rename simulation via pointer)
 *   3. previous_version.txt ← eski current
 *   4. current_version.txt ← newVersionId
 *   5. staging/ temizlenir
 *
 * @throws Error — integrity kontrolü başarısız olursa commit yapılmaz.
 */
export async function commitUpdate(newVersionId: string): Promise<IntegrityReport> {
  // Staging manifest'e göre integrity doğrula
  const report = await verifyIntegrity(newVersionId);
  if (!report.ok) {
    const detail = [
      report.corrupted.length > 0 ? `${report.corrupted.length} bozuk tile` : '',
      report.missing.length   > 0 ? `${report.missing.length} eksik tile`   : '',
    ].filter(Boolean).join(', ');
    throw new Error(`Integrity check başarısız — ${detail}. Commit iptal edildi.`);
  }

  // Önceki versiyonu kaydet (rollback için)
  const current = await getCurrentVersionId();
  if (current) {
    await _writeText(PREVIOUS_FILE, current);
  }

  // Pointer güncelle — atomic (tek dosya write)
  await _writeText(CURRENT_FILE, newVersionId);

  // Staging'i temizle
  await _deleteDir(STAGING_DIR);

  _consecutiveTileErrors = 0;
  console.info(`[TILE_SERVER] commitUpdate: ${current ?? 'none'} → ${newVersionId}`);
  return report;
}

/* ── Rollback ─────────────────────────────────────────────────────────────── */

/**
 * Önceki versiyona geri döner.
 * Sadece current_version.txt güncellenir — hiçbir tile silinmez.
 */
export async function rollbackToPreviousVersion(): Promise<boolean> {
  if (_rollbackInProgress) return false;
  _rollbackInProgress = true;

  try {
    const previous = await getPreviousVersionId();
    if (!previous) {
      console.warn('[TILE_SERVER] Rollback hedefi yok — önceki versiyon bulunamadı');
      return false;
    }

    const current = await getCurrentVersionId();
    await _writeText(CURRENT_FILE, previous);
    if (current) await _writeText(PREVIOUS_FILE, current);

    _consecutiveTileErrors = 0;
    console.info(`[TILE_SERVER] rollback: ${current ?? '?'} → ${previous}`);
    recordFault('TILE_ROLLBACK');
    return true;
  } catch (e) {
    logError('offlineTileServer:rollback', e);
    return false;
  } finally {
    _rollbackInProgress = false;
  }
}

/* ── Garbage collection ───────────────────────────────────────────────────── */

/**
 * N-1'den eski versiyonları siler.
 * Her zaman son 2 versiyon korunur: current + previous.
 * @param keepCount Saklanacak versiyon sayısı (varsayılan 2)
 */
export async function garbageCollectOldVersions(keepCount = 2): Promise<number> {
  let deletedCount = 0;

  try {
    const rootFiles = await Filesystem.readdir({ path: ROOT, directory: FS_DIR });

    // vN formatındaki dizinleri filtrele ve sırala
    const versions = rootFiles.files
      .filter((f) => f.type === 'directory' && /^v\d+$/.test(f.name))
      .map((f) => ({ name: f.name, n: parseInt(f.name.replace('v', '')) }))
      .sort((a, b) => a.n - b.n); // küçükten büyüğe

    if (versions.length <= keepCount) return 0;

    const current  = await getCurrentVersionId();
    const previous = await getPreviousVersionId();
    const safeSet = new Set([current, previous].filter(Boolean) as string[]);

    // En eski (keepCount kadar dışında kalan) versiyonları sil
    const toDelete = versions.slice(0, versions.length - keepCount);

    for (const v of toDelete) {
      if (safeSet.has(v.name)) continue; // current/previous'a dokunma
      await _deleteDir(`${ROOT}/${v.name}`);
      deletedCount++;
      console.info(`[TILE_SERVER] GC: ${v.name} silindi`);
    }
  } catch (e) {
    logError('offlineTileServer:gc', e);
  }

  return deletedCount;
}

/* ── Legacy saveTile (bootstrapOfflineTiles uyumluluğu) ──────────────────── */

/**
 * Eski API: tile'ı versiyonsuz 'default' dizinine yazar.
 * Yeni kod writeTileToVersion() kullanmalı.
 */
export async function saveTile(
  z:       number,
  x:       number,
  y:       number,
  data:    ArrayBuffer | Blob,
  source?: string,
): Promise<void> {
  const sourceName = source ?? 'default';
  let buf: ArrayBuffer;

  if (data instanceof Blob) {
    buf = await data.arrayBuffer();
  } else {
    buf = data;
  }

  const bytes  = new Uint8Array(buf);
  let   binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);

  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const path = `${ROOT}/${sourceName}/${z}/${x}/${y}.png`;
  await Filesystem.writeFile({
    path,
    data:      b64,
    directory: Directory.Data,
    recursive: true,
  }).catch(() => {});
}

/* ── Legacy compat ────────────────────────────────────────────────────────── */

export interface TileSource {
  name:     string;
  minZoom:  number;
  maxZoom:  number;
  bounds?:  { north: number; south: number; east: number; west: number };
}

let _activeTileSource: TileSource | null = null;

export function setActiveTileSource(source: TileSource | null): void {
  _activeTileSource = source;
}

export function getActiveTileSource(): TileSource | null {
  return _activeTileSource;
}

export async function hasOfflineTiles(): Promise<boolean> {
  const vId = await getCurrentVersionId();
  return vId !== null;
}

export function createOfflineMapSource(sourceName?: string): {
  type: string; tiles: string[]; tileSize: number; attribution: string;
  minzoom: number; maxzoom: number;
} {
  const src = sourceName ?? 'default';
  return {
    type:        'raster',
    tiles:       [`tile://${src}/{z}/{x}/{y}`],
    tileSize:    256,
    attribution: 'Offline Map Data',
    minzoom:     0,
    maxzoom:     18,
  };
}
