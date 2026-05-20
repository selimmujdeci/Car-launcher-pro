/**
 * CacheLRUManager — MapLibre tile interceptor + LRU önbellek yöneticisi.
 *
 * Protokol: caros-tile://<host>/<path>  →  https://<host>/<path>
 *   - İlk istek: ağdan indir, Cache Storage'a kaydet.
 *   - Sonraki istek: yerel blob dön (ağ isteği yok).
 *
 * Limit: 500 MB — aşılırsa koridor-korumasız tile'lar LRU sırasına göre silinir.
 * Koridor koruması: sürüş devam ederken CorridorSyncEngine tarafından işaretlenen
 *   tile'lar eviction'dan muaf tutulur.
 *
 * İstatistikler: getCacheStats() → DevInspector "Cache Hit Rate" metriği.
 */

import maplibregl from 'maplibre-gl';
import { useDebugStore } from '../../platform/debug/debugStore';

/* ── Sabitler ─────────────────────────────────────────────────────────────── */

const CACHE_NAME    = 'caros-tiles-v1';
const DB_NAME       = 'caros-tile-manifest-v1';
const DB_STORE      = 'tiles';
const MAX_BYTES     = 500 * 1_024 * 1_024;  // 500 MB
const EVICT_TARGET  = MAX_BYTES * 0.85;     // %85'e inin (15% headroom)
const FLUSH_MS      = 30_000;               // manifest IndexedDB flush aralığı
const STATS_MS      = 5_000;               // debug store güncelleme aralığı
const PROTOCOL      = 'caros-tile';

const _DEBUG_ACTIVE =
  typeof import.meta !== 'undefined' &&
  // @ts-ignore — Vite ortam değişkeni (tsc strict'te tanımsız olabilir)
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  (import.meta.env?.DEV || import.meta.env?.VITE_ENABLE_DEBUG_PANEL === 'true');

/* ── Manifest entry ───────────────────────────────────────────────────────── */

export interface TileManifestEntry {
  key:               string;   // 'z/x/y' tile kimliği
  url:               string;   // orijinal https:// URL
  size:              number;   // byte cinsinden boyut
  lastAccess:        number;   // ms timestamp — LRU sıralaması
  corridorProtected: boolean;  // sürüş bitene kadar silinemez
  insertedAt:        number;   // ilk eklenme zamanı
}

/* ── CacheLRUManager ─────────────────────────────────────────────────────── */

class CacheLRUManager {
  private _manifest    = new Map<string, TileManifestEntry>();
  private _totalBytes  = 0;
  private _hits        = 0;
  private _misses      = 0;
  private _db:         IDBDatabase | null = null;
  private _dirty       = false;
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  private _statsTimer: ReturnType<typeof setInterval> | null = null;
  private _registered  = false;

  /* ── Başlatma ───────────────────────────────────────────────────── */

  /** mapService.initializeMap() öncesinde çağrılır — idempotent. */
  init(): void {
    if (this._registered) return;
    this._registered = true;

    // IndexedDB'yi arka planda yükle — protokol kaydı bunu beklemez
    void this._openDB().then(() => this._loadManifest()).catch(() => {});

    // caros-tile:// protokolünü kaydet
    try { maplibregl.removeProtocol(PROTOCOL); } catch { /* henüz kayıtlı değil */ }
    maplibregl.addProtocol(
      PROTOCOL,
      async (params: maplibregl.RequestParameters, abortController: AbortController) => {
        const url = params.url.replace(`${PROTOCOL}://`, 'https://');
        return this._handleTileRequest(url, abortController.signal);
      },
    );

    // Debug modda 5s'de bir stats güncelle
    if (_DEBUG_ACTIVE && this._statsTimer === null) {
      this._statsTimer = setInterval(() => {
        useDebugStore.getState().updateCacheStats(this.getCacheStats());
      }, STATS_MS);
    }
  }

  /** Navigasyon bitti — tüm koridor korumalarını kaldır. */
  clearCorridorProtection(): void {
    for (const entry of this._manifest.values()) {
      if (entry.corridorProtected) {
        entry.corridorProtected = false;
        this._dirty = true;
      }
    }
    this._scheduleFlush();
  }

  /**
   * CorridorSyncEngine tarafından çağrılır.
   * Sürüş boyunca bu tile'lar LRU eviction'dan muaf tutulur.
   */
  markCorridorProtected(tileKeys: string[]): void {
    for (const key of tileKeys) {
      const entry = this._manifest.get(key);
      if (entry && !entry.corridorProtected) {
        entry.corridorProtected = true;
        this._dirty = true;
      }
    }
    if (this._dirty) this._scheduleFlush();
  }

  /** DevInspector için anlık istatistikler. */
  getCacheStats(): { hits: number; misses: number; hitRate: number; totalBytes: number; tileCount: number } {
    const total   = this._hits + this._misses;
    const hitRate = total > 0 ? Math.round((this._hits / total) * 100) : 0;
    return {
      hits:       this._hits,
      misses:     this._misses,
      hitRate,
      totalBytes: this._totalBytes,
      tileCount:  this._manifest.size,
    };
  }

  /* ── Protocol handler ───────────────────────────────────────────── */

  private async _handleTileRequest(
    url:    string,
    signal: AbortSignal,
  ): Promise<{ data: ArrayBuffer }> {
    // Cache Storage'da var mı?
    const cached = await this._getFromCache(url);
    if (cached) {
      this._hits++;
      this._touchLastAccess(url);
      return { data: cached };
    }

    // Cache miss → ağdan indir
    this._misses++;
    const res = await fetch(url, {
      signal,
      headers: { 'User-Agent': 'CarosPro/1.0 TileCache' },
    });
    if (!res.ok) throw new Error(`Tile HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    void this._putToCache(url, buffer);   // fire-and-forget
    return { data: buffer };
  }

  /* ── Cache Storage ──────────────────────────────────────────────── */

  private async _getFromCache(url: string): Promise<ArrayBuffer | null> {
    try {
      if (typeof caches === 'undefined') return null;
      const cache = await caches.open(CACHE_NAME);
      const resp  = await cache.match(url);
      if (!resp) return null;
      return resp.arrayBuffer();
    } catch {
      return null;
    }
  }

  private async _putToCache(url: string, data: ArrayBuffer): Promise<void> {
    try {
      if (typeof caches === 'undefined') return;
      const cache = await caches.open(CACHE_NAME);
      await cache.put(
        url,
        new Response(data, { headers: { 'Content-Type': 'image/png' } }),
      );

      const key   = _urlToKey(url);
      const now   = Date.now();
      const prev  = this._manifest.get(key);
      if (prev) {
        prev.lastAccess = now;
      } else {
        this._manifest.set(key, {
          key, url,
          size:               data.byteLength,
          lastAccess:         now,
          corridorProtected:  false,
          insertedAt:         now,
        });
        this._totalBytes += data.byteLength;
      }
      this._dirty = true;

      if (this._totalBytes > MAX_BYTES) void this._evictLRU();
      this._scheduleFlush();
    } catch { /* quota veya Cache Storage API yok */ }
  }

  private _touchLastAccess(url: string): void {
    const entry = this._manifest.get(_urlToKey(url));
    if (entry) { entry.lastAccess = Date.now(); this._dirty = true; }
  }

  /* ── LRU Eviction ───────────────────────────────────────────────── */

  private async _evictLRU(): Promise<void> {
    if (typeof caches === 'undefined') return;
    try {
      const cache = await caches.open(CACHE_NAME);

      // Koridor-korumasız tile'ları lastAccess ASC sırala
      const evictable = [...this._manifest.values()]
        .filter(e => !e.corridorProtected)
        .sort((a, b) => a.lastAccess - b.lastAccess);

      for (const entry of evictable) {
        if (this._totalBytes <= EVICT_TARGET) break;
        await cache.delete(entry.url);
        this._totalBytes -= entry.size;
        this._manifest.delete(entry.key);
        this._dirty = true;
      }
    } catch { /* sessiz */ }
  }

  /* ── IndexedDB — manifest kalıcılığı ───────────────────────────── */

  private _openDB(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') { resolve(); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(DB_STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => { this._db = req.result; resolve(); };
      req.onerror   = () => resolve(); // DB açılamazsa devam et
    });
  }

  private _loadManifest(): Promise<void> {
    if (!this._db) return Promise.resolve();
    return new Promise((resolve) => {
      const tx    = this._db!.transaction(DB_STORE, 'readonly');
      const store = tx.objectStore(DB_STORE);
      const req   = store.getAll();
      req.onsuccess = () => {
        const entries = (req.result ?? []) as TileManifestEntry[];
        this._manifest.clear();
        this._totalBytes = 0;
        for (const e of entries) {
          this._manifest.set(e.key, e);
          this._totalBytes += e.size;
        }
        resolve();
      };
      req.onerror = () => resolve();
    });
  }

  private _scheduleFlush(): void {
    if (this._flushTimer !== null) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      if (this._dirty) void this._flushManifest();
    }, FLUSH_MS);
  }

  private _flushManifest(): Promise<void> {
    if (!this._db || !this._dirty) return Promise.resolve();
    this._dirty = false;
    return new Promise((resolve) => {
      const tx    = this._db!.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      for (const entry of this._manifest.values()) store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
    });
  }
}

/* ── URL → tile key ───────────────────────────────────────────────────────── */

function _urlToKey(url: string): string {
  const m = url.match(/\/(\d+)\/(\d+)\/(\d+)\.png/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : url;
}

/* ── Singleton ────────────────────────────────────────────────────────────── */

export const cacheLRUManager = new CacheLRUManager();
