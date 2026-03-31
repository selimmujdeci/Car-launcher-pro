/**
 * Offline Tile Downloader — Türkiye bölgesi için toplu tile indirici.
 *
 * Strateji:
 *  - OSM tile sunucusundan fetch → Service Worker otomatik IndexedDB'ye yazar
 *  - SW sonraki isteklerde IndexedDB'den servise eder → tam offline çalışır
 *  - OSM kullanım politikası: max 2 eşzamanlı istek, User-Agent header
 *  - İndirme iptal edilebilir (AbortController)
 */

/* ── Bölge tanımları ─────────────────────────────────────── */

export interface TileBbox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface TileRegionPreset {
  id: string;
  name: string;
  bbox: TileBbox;
  minZoom: number;
  maxZoom: number;
}

/** Türkiye için önceden tanımlı bölge paketleri */
export const TILE_PRESETS: TileRegionPreset[] = [
  {
    id: 'turkey-overview',
    name: 'Türkiye Genel',
    bbox: { minLat: 35.8, maxLat: 42.2, minLon: 25.6, maxLon: 44.9 },
    minZoom: 5,
    maxZoom: 9,
  },
  {
    id: 'istanbul',
    name: 'İstanbul',
    bbox: { minLat: 40.8, maxLat: 41.35, minLon: 28.5, maxLon: 29.6 },
    minZoom: 10,
    maxZoom: 13,
  },
  {
    id: 'ankara',
    name: 'Ankara',
    bbox: { minLat: 39.75, maxLat: 40.15, minLon: 32.5, maxLon: 33.1 },
    minZoom: 10,
    maxZoom: 13,
  },
  {
    id: 'izmir',
    name: 'İzmir',
    bbox: { minLat: 38.2, maxLat: 38.55, minLon: 26.9, maxLon: 27.35 },
    minZoom: 10,
    maxZoom: 13,
  },
];

/* ── Tile koordinat hesabı ───────────────────────────────── */

function latLonToTileXY(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n  = 2 ** zoom;
  const x  = Math.floor(((lon + 180) / 360) * n);
  const lr = (lat * Math.PI) / 180;
  const y  = Math.floor(((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2) * n);
  return { x, y };
}

export interface TileCoord { z: number; x: number; y: number }

export function getTilesForPreset(preset: TileRegionPreset): TileCoord[] {
  const tiles: TileCoord[] = [];
  for (let z = preset.minZoom; z <= preset.maxZoom; z++) {
    const { x: x1, y: y1 } = latLonToTileXY(preset.bbox.maxLat, preset.bbox.minLon, z);
    const { x: x2, y: y2 } = latLonToTileXY(preset.bbox.minLat, preset.bbox.maxLon, z);
    for (let x = x1; x <= x2; x++) {
      for (let y = y1; y <= y2; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

/** Tahmini tile sayısını hesaplar (indirmeden önce göstermek için) */
export function estimateTileCount(preset: TileRegionPreset): number {
  return getTilesForPreset(preset).length;
}

/* ── İndirme durumu ──────────────────────────────────────── */

export type DownloadStatus = 'idle' | 'downloading' | 'paused' | 'done' | 'error' | 'cancelled';

export interface DownloadState {
  status:      DownloadStatus;
  presetId:    string | null;
  presetName:  string | null;
  done:        number;
  total:       number;
  failedCount: number;
  errorMsg:    string | null;
  startedAt:   number | null;
}

const INITIAL_STATE: DownloadState = {
  status:      'idle',
  presetId:    null,
  presetName:  null,
  done:        0,
  total:       0,
  failedCount: 0,
  errorMsg:    null,
  startedAt:   null,
};

let _state: DownloadState = { ...INITIAL_STATE };
const _listeners = new Set<(s: DownloadState) => void>();

function push(partial: Partial<DownloadState>): void {
  _state = { ..._state, ...partial };
  _listeners.forEach((fn) => fn(_state));
}

export function getDownloadState(): DownloadState { return _state; }

export function subscribeDownloadState(fn: (s: DownloadState) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/* ── Aktif indirme kontrolü ──────────────────────────────── */

let _abortController: AbortController | null = null;

/** Aktif indirmeyi iptal eder */
export function cancelTileDownload(): void {
  _abortController?.abort();
  push({ status: 'cancelled' });
}

/* ── OSM fetch yardımcısı ────────────────────────────────── */

const OSM_HOSTS = ['a', 'b', 'c'] as const;
let _osmHostIdx = 0;

function nextOsmHost(): string {
  const host = OSM_HOSTS[_osmHostIdx % OSM_HOSTS.length];
  _osmHostIdx++;
  return `${host}.tile.openstreetmap.org`;
}

async function fetchTile(
  z: number, x: number, y: number, signal: AbortSignal,
): Promise<boolean> {
  const host = nextOsmHost();
  const url  = `https://${host}/${z}/${x}/${y}.png`;
  try {
    const resp = await fetch(url, {
      signal,
      headers: { 'Accept': 'image/png,image/*,*/*;q=0.8' },
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/* ── Toplu indirme ───────────────────────────────────────── */

/**
 * Bir preset bölgesi için tüm tile'ları indirir.
 * Service Worker aktifse her fetch otomatik IndexedDB'ye kaydedilir.
 * @returns İndirilen tile sayısı
 */
export async function downloadTileRegion(presetId: string): Promise<void> {
  if (_state.status === 'downloading') return; // zaten çalışıyor

  const preset = TILE_PRESETS.find((p) => p.id === presetId);
  if (!preset) {
    push({ status: 'error', errorMsg: 'Bilinmeyen preset: ' + presetId });
    return;
  }

  const tiles = getTilesForPreset(preset);
  _abortController = new AbortController();
  const { signal } = _abortController;

  push({
    status:      'downloading',
    presetId:    preset.id,
    presetName:  preset.name,
    done:        0,
    total:       tiles.length,
    failedCount: 0,
    errorMsg:    null,
    startedAt:   Date.now(),
  });

  // OSM politikası: max 2 eşzamanlı istek
  const CONCURRENCY = 2;
  let   done        = 0;
  let   failed      = 0;

  try {
    for (let i = 0; i < tiles.length; i += CONCURRENCY) {
      if (signal.aborted) break;

      const batch = tiles.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async ({ z, x, y }) => {
          if (signal.aborted) return;
          const ok = await fetchTile(z, x, y, signal);
          if (!ok) failed++;
          done++;
          push({ done, failedCount: failed });
        }),
      );

      // OSM'u yormamak için kısa bekleme
      if (!signal.aborted && i + CONCURRENCY < tiles.length) {
        await new Promise<void>((res) => setTimeout(res, 150));
      }
    }

    if (signal.aborted) {
      push({ status: 'cancelled' });
    } else {
      push({ status: 'done' });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'İndirme hatası';
    push({ status: 'error', errorMsg: msg });
  } finally {
    _abortController = null;
  }
}

/* ── IndexedDB tile sayısı ───────────────────────────────── */

/** Service Worker'ın IndexedDB'sinde kaç tile olduğunu sayar */
export async function getCachedTileCount(): Promise<number> {
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('offline-tiles', 1);
      req.onsuccess  = () => resolve(req.result as IDBDatabase);
      req.onerror    = () => reject(req.error);
      req.onupgradeneeded = (e) => {
        const d = (e.target as IDBOpenDBRequest).result;
        if (!d.objectStoreNames.contains('offline_tiles_cache')) {
          d.createObjectStore('offline_tiles_cache', { keyPath: 'key' });
        }
      };
    });
    return await new Promise<number>((resolve, reject) => {
      const tx  = db.transaction('offline_tiles_cache', 'readonly');
      const req = tx.objectStore('offline_tiles_cache').count();
      req.onsuccess = () => resolve(req.result as number);
      req.onerror   = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}

/** IndexedDB'deki tüm tile'ları siler */
export async function clearCachedTiles(): Promise<void> {
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('offline-tiles', 1);
      req.onsuccess = () => resolve(req.result as IDBDatabase);
      req.onerror   = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx  = db.transaction('offline_tiles_cache', 'readwrite');
      const req = tx.objectStore('offline_tiles_cache').clear();
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  } catch { /* ignore */ }
}
