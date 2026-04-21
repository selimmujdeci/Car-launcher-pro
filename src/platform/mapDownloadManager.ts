/**
 * Map Download Manager — bölgesel harita karolarını çevrimdışı kuyruğa alır.
 *
 * Mimari kısıtlar (CLAUDE.md):
 *   - Max 3 eş zamanlı ağ isteği → Mali-400 GPU'ya ek WebGL yükü vermez
 *   - Batch write: 20 tile biriktir → tek Filesystem.writeFile dizisi → 5s aralık
 *   - requestIdleCallback ile UI dondurulmaz (60fps korunur)
 *   - Her AbortController temizlenmeden önce tüm listener'lar cleanup edilir
 *
 * Kullanım:
 *   const abort = startDownload({ bbox, minZoom:10, maxZoom:15, regionName:'İstanbul' });
 *   // iptal: abort.abort() veya cancelDownload()
 */

import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';
import { logError }  from './crashLogger';

/* ── Types ────────────────────────────────────────────────── */

export interface BBox {
  west:  number; south: number;
  east:  number; north: number;
}

export type DownloadStatus =
  | 'idle' | 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled';

export interface DownloadState {
  status:           DownloadStatus;
  regionName:       string;
  totalTiles:       number;
  completedTiles:   number;
  failedTiles:      number;
  progressPercent:  number;
  downloadedBytes:  number;
  error:            string | null;
  startedAt:        number | null;
  completedAt:      number | null;
}

export interface DownloadOptions {
  bbox:          BBox;
  minZoom:       number;
  maxZoom:       number;
  regionName:    string;
  tileFormat?:   'png' | 'pbf';
  /** Max parallel fetch+write ops. Default 3 (Mali-400 safe). */
  maxConcurrent?: number;
  onProgress?:   (state: DownloadState) => void;
}

interface TileCoord { z: number; x: number; y: number; }

/* ── Tile math ────────────────────────────────────────────── */

function lngToTileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * Math.pow(2, z));
}

function latToTileY(lat: number, z: number): number {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      Math.pow(2, z),
  );
}

function buildTileList(bbox: BBox, minZ: number, maxZ: number): TileCoord[] {
  const tiles: TileCoord[] = [];
  for (let z = minZ; z <= maxZ; z++) {
    const n    = Math.pow(2, z);
    const xMin = Math.max(0, lngToTileX(bbox.west,  z));
    const xMax = Math.min(n - 1, lngToTileX(bbox.east,  z));
    const yMin = Math.max(0, latToTileY(bbox.north, z)); // north → smaller y
    const yMax = Math.min(n - 1, latToTileY(bbox.south, z));
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

/* ── State ────────────────────────────────────────────────── */

const INITIAL: DownloadState = {
  status:          'idle',
  regionName:      '',
  totalTiles:      0,
  completedTiles:  0,
  failedTiles:     0,
  progressPercent: 0,
  downloadedBytes: 0,
  error:           null,
  startedAt:       null,
  completedAt:     null,
};

const useDownloadStore = create<DownloadState>(() => ({ ...INITIAL }));

/* ── Tile fetch ────────────────────────────────────────────── */

const OSM_SUBDOMAINS = ['a', 'b', 'c'];

async function fetchTile(
  tile:   TileCoord,
  format: 'png' | 'pbf',
  signal: AbortSignal,
): Promise<ArrayBuffer | null> {
  if (format === 'pbf') {
    // Vector PBF — custom tile server required; env var or fallback empty
    const baseUrl = (import.meta.env['VITE_VECTOR_TILE_URL'] as string | undefined) ?? '';
    if (!baseUrl) return null;
    try {
      const resp = await fetch(
        `${baseUrl}/${tile.z}/${tile.x}/${tile.y}.pbf`,
        { signal },
      );
      return resp.ok ? resp.arrayBuffer() : null;
    } catch { return null; }
  }

  // Raster PNG — OSM
  const sub  = OSM_SUBDOMAINS[tile.x % 3];
  const url  = `https://${sub}.tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`;
  try {
    const resp = await fetch(url, { signal });
    return resp.ok ? resp.arrayBuffer() : null;
  } catch { return null; }
}

/* ── Filesystem write ─────────────────────────────────────── */

async function writeTileToFilesystem(
  tile:   TileCoord,
  buf:    ArrayBuffer,
  format: 'png' | 'pbf',
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const path = `maps/${tile.z}/${tile.x}/${tile.y}.${format}`;

  // ArrayBuffer → base64
  const bytes  = new Uint8Array(buf);
  let   binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const data = btoa(binary);

  await Filesystem.writeFile({
    path,
    data,
    directory:  Directory.Data,
    recursive:  true,
  });
}

/* ── Batch write (throttle) ───────────────────────────────── */

interface PendingTile {
  tile:   TileCoord;
  buf:    ArrayBuffer;
  format: 'png' | 'pbf';
}

const BATCH_SIZE        = 20;
const BATCH_INTERVAL_MS = 5000; // CLAUDE.md: max 1 disk flush / 5s
let   _pendingWrites: PendingTile[] = [];
let   _flushTimer:    ReturnType<typeof setTimeout> | null = null;
let   _lastFlushMs    = 0;

async function flushPendingWrites(): Promise<void> {
  if (_pendingWrites.length === 0) return;
  const batch = _pendingWrites.splice(0, BATCH_SIZE);

  // Sequential writes within the batch — avoid Filesystem overload
  for (const { tile, buf, format } of batch) {
    try {
      await writeTileToFilesystem(tile, buf, format);
    } catch (e) {
      logError('MapDownload:write', e);
    }
  }
  _lastFlushMs = Date.now();
}

function enqueueTileWrite(entry: PendingTile): void {
  _pendingWrites.push(entry);

  const now     = Date.now();
  const sinceMs = now - _lastFlushMs;

  if (_pendingWrites.length >= BATCH_SIZE && sinceMs >= BATCH_INTERVAL_MS) {
    // Flush immediately — batch full and throttle window expired
    if (_flushTimer !== null) { clearTimeout(_flushTimer); _flushTimer = null; }
    flushPendingWrites().catch((e) => logError('MapDownload:flush', e));
    return;
  }

  if (_flushTimer === null) {
    // Schedule next flush at throttle boundary
    const delay = Math.max(0, BATCH_INTERVAL_MS - sinceMs);
    _flushTimer = setTimeout(() => {
      _flushTimer = null;
      flushPendingWrites().catch((e) => logError('MapDownload:flush', e));
    }, delay);
  }
}

/* ── Concurrency pool ─────────────────────────────────────── */

async function runConcurrent<T>(
  tasks:     (() => Promise<T>)[],
  limit:     number,
  signal:    AbortSignal,
  onDone?:   (result: T | null, index: number) => void,
): Promise<void> {
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      if (signal.aborted) return;
      const i    = index++;
      const task = tasks[i];
      try {
        const result = await task();
        onDone?.(result, i);
      } catch {
        onDone?.(null, i);
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
}

/* ── Session control ─────────────────────────────────────── */

let _activeAbort: AbortController | null = null;
let _paused        = false;
let _pauseResolve: (() => void) | null = null;

function _waitIfPaused(): Promise<void> {
  if (!_paused) return Promise.resolve();
  return new Promise((res) => { _pauseResolve = res; });
}

/* ── Public API ───────────────────────────────────────────── */

/**
 * Verilen BBox + zoom aralığındaki tüm tile'ları indir.
 * Dönen AbortController ile iptal edilebilir.
 */
export function startDownload(opts: DownloadOptions): AbortController {
  // Önceki indirmeyi iptal et
  cancelDownload();

  const abort  = new AbortController();
  _activeAbort = abort;
  _paused      = false;

  const format      = opts.tileFormat ?? 'png';
  const concurrency = Math.min(opts.maxConcurrent ?? 3, 5); // en fazla 5

  const tiles = buildTileList(opts.bbox, opts.minZoom, opts.maxZoom);

  useDownloadStore.setState({
    status:          'downloading',
    regionName:      opts.regionName,
    totalTiles:      tiles.length,
    completedTiles:  0,
    failedTiles:     0,
    progressPercent: 0,
    downloadedBytes: 0,
    error:           null,
    startedAt:       Date.now(),
    completedAt:     null,
  });

  // Fire-and-forget — caller interacts via state / AbortController
  _runDownload(tiles, format, concurrency, abort, opts.onProgress).catch(
    (e) => logError('MapDownload:run', e),
  );

  return abort;
}

async function _runDownload(
  tiles:       TileCoord[],
  format:      'png' | 'pbf',
  concurrency: number,
  abort:       AbortController,
  onProgress?: (s: DownloadState) => void,
): Promise<void> {
  let completed = 0;
  let failed    = 0;
  let bytes     = 0;

  const tasks = tiles.map((tile) => async () => {
    await _waitIfPaused();
    if (abort.signal.aborted) return null;

    const buf = await fetchTile(tile, format, abort.signal);
    if (buf) {
      bytes += buf.byteLength;
      enqueueTileWrite({ tile, buf, format });
      completed++;
    } else {
      failed++;
    }

    const pct = Math.round(((completed + failed) / tiles.length) * 100);
    const partial: Partial<DownloadState> = {
      completedTiles:  completed,
      failedTiles:     failed,
      progressPercent: pct,
      downloadedBytes: bytes,
    };
    useDownloadStore.setState(partial);
    onProgress?.({ ...useDownloadStore.getState(), ...partial });

    // Yield to UI every 10 tiles → 60fps korunur
    if ((completed + failed) % 10 === 0) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }

    return buf;
  });

  await runConcurrent(tasks, concurrency, abort.signal);

  // Flush remaining writes
  if (_flushTimer !== null) { clearTimeout(_flushTimer); _flushTimer = null; }
  await flushPendingWrites();

  if (abort.signal.aborted) {
    useDownloadStore.setState({ status: 'cancelled', completedAt: Date.now() });
    return;
  }

  const finalStatus: DownloadStatus = failed === tiles.length ? 'error' : 'completed';
  const finalState: Partial<DownloadState> = {
    status:      finalStatus,
    completedAt: Date.now(),
    error:       finalStatus === 'error' ? 'Tüm karolar indirilemedi' : null,
  };
  useDownloadStore.setState(finalState);
  onProgress?.({ ...useDownloadStore.getState(), ...finalState });
}

/** İndirmeyi duraklat (mevcut tile biter, yenisi başlamaz). */
export function pauseDownload(): void {
  if (useDownloadStore.getState().status !== 'downloading') return;
  _paused = true;
  useDownloadStore.setState({ status: 'paused' });
}

/** Duraklatılmış indirmeyi devam ettir. */
export function resumeDownload(): void {
  if (useDownloadStore.getState().status !== 'paused') return;
  _paused = false;
  useDownloadStore.setState({ status: 'downloading' });
  if (_pauseResolve) { _pauseResolve(); _pauseResolve = null; }
}

/** Aktif indirmeyi iptal et ve state'i temizle. */
export function cancelDownload(): void {
  if (_activeAbort) {
    _activeAbort.abort();
    _activeAbort = null;
  }
  _paused       = false;
  _pauseResolve = null;
  if (_flushTimer !== null) { clearTimeout(_flushTimer); _flushTimer = null; }
  _pendingWrites = [];
  useDownloadStore.setState({ ...INITIAL, status: 'cancelled' });
}

/** Anlık indirme durumunu döndür (reactive değil). */
export function getDownloadState(): DownloadState {
  return useDownloadStore.getState();
}

/** React bileşenlerinde reaktif indirme durumu. */
export function useDownloadState(): DownloadState {
  return useDownloadStore();
}

/**
 * Tahmini tile sayısını hesapla — kullanıcıya önizleme için.
 * Gerçek indirme başlatmaz.
 */
export function estimateTileCount(
  bbox:    BBox,
  minZoom: number,
  maxZoom: number,
): number {
  return buildTileList(bbox, minZoom, maxZoom).length;
}
