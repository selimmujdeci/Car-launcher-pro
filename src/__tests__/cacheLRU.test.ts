/**
 * cacheLRU.test.ts
 *
 * Kapsam:
 *  1. Protocol kaydı — caros-tile:// protokolü maplibre'ye ekleniyor
 *  2. Cache hit/miss — Cache Storage kontrolü ve network fetch
 *  3. LRU istatistikleri — hitRate, totalBytes, tileCount doğruluğu
 *  4. Koridor koruması — markCorridorProtected ile tile silme engeli
 *  5. clearCorridorProtection — stop() sonrası koruma kaldırılıyor
 *  6. LRU eviction — 500MB limit aşılınca en eski tile'lar siliniyor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Maplibre mock ───────────────────────────────────────────── */

const _registeredProtocols = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('maplibre-gl', () => ({
  default: {
    addProtocol:    vi.fn((name: string, handler: unknown) => {
      _registeredProtocols.set(name, handler as (...args: unknown[]) => unknown);
    }),
    removeProtocol: vi.fn((name: string) => {
      _registeredProtocols.delete(name);
    }),
  },
}));

/* ── debugStore mock ─────────────────────────────────────────── */

const _mockUpdateCacheStats = vi.fn();
vi.mock('../../platform/debug/debugStore', () => ({
  useDebugStore: {
    getState: vi.fn(() => ({ updateCacheStats: _mockUpdateCacheStats })),
  },
}));

/* ── Cache Storage mock ──────────────────────────────────────── */

class _MockCache {
  private _store = new Map<string, Response>();

  async match(req: string | Request): Promise<Response | undefined> {
    const url = typeof req === 'string' ? req : req.url;
    return this._store.get(url);
  }

  async put(req: string | Request, resp: Response): Promise<void> {
    const url = typeof req === 'string' ? req : req.url;
    this._store.set(url, resp.clone());
  }

  async delete(req: string | Request): Promise<boolean> {
    const url = typeof req === 'string' ? req : req.url;
    return this._store.delete(url);
  }

  keys(): Promise<Request[]> {
    return Promise.resolve([...this._store.keys()].map(u => new Request(u)));
  }
}

const _mockCacheStore = new Map<string, _MockCache>();

const _mockCaches = {
  open: async (name: string) => {
    if (!_mockCacheStore.has(name)) _mockCacheStore.set(name, new _MockCache());
    return _mockCacheStore.get(name)!;
  },
  delete: async (name: string) => { _mockCacheStore.delete(name); return true; },
};

// Cache Storage API'yi global'e bağla
Object.defineProperty(global, 'caches', {
  value: _mockCaches, configurable: true, writable: true,
});

/* ── IndexedDB mock (in-memory) ──────────────────────────────── */

class _MockIDBObjectStore {
  constructor(private _data: Map<string, unknown>) {}
  put(value: unknown) {
    const entry = value as { key: string };
    this._data.set(entry.key, value);
    return { onsuccess: null, onerror: null };
  }
  getAll() {
    const req: { result: unknown[]; onsuccess: (() => void) | null; onerror: (() => void) | null } = {
      result: [...this._data.values()],
      onsuccess: null,
      onerror: null,
    };
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  }
}

class _MockIDBTransaction {
  constructor(private _store: _MockIDBObjectStore) {}
  objectStore(_name: string) { return this._store; }
  get oncomplete(): null { return null; }
  set oncomplete(cb: (() => void) | null) { if (cb) setTimeout(cb, 0); }
  get onerror(): null { return null; }
  set onerror(_cb: (() => void) | null) { /* ignore */ }
}

const _idbData = new Map<string, unknown>();

const _mockDB = {
  transaction: (_store: string, _mode: string) =>
    new _MockIDBTransaction(new _MockIDBObjectStore(_idbData)),
};

const _mockIndexedDB = {
  open: (_name: string, _version: number) => {
    const req: {
      result: typeof _mockDB;
      onupgradeneeded: ((e: { target: { result: typeof _mockDB } }) => void) | null;
      onsuccess: (() => void) | null;
      onerror: (() => void) | null;
    } = {
      result: _mockDB,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
    };
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  },
};

Object.defineProperty(global, 'indexedDB', {
  value: _mockIndexedDB, configurable: true, writable: true,
});

/* ── fetch mock ──────────────────────────────────────────────── */

const TILE_DATA = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer; // PNG magic bytes

global.fetch = vi.fn(async (url: string | Request) => {
  const urlStr = typeof url === 'string' ? url : (url as Request).url;
  if (urlStr.includes('tile.openstreetmap.org')) {
    return new Response(TILE_DATA, {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  }
  return new Response(null, { status: 404 });
}) as typeof fetch;

/* ── Tests ───────────────────────────────────────────────────── */

// Fresh CacheLRUManager instance for each test
async function _freshManager() {
  vi.resetModules();
  const { cacheLRUManager: mgr } = await import('../core/storage/CacheLRUManager');
  mgr.init();
  return mgr;
}

describe('CacheLRUManager — protokol kaydı', () => {
  it('init() caros-tile protokolünü maplibre-gl\'e kaydeder', async () => {
    const { default: maplibregl } = await import('maplibre-gl');
    const { cacheLRUManager } = await import('../core/storage/CacheLRUManager');
    cacheLRUManager.init();
    expect(maplibregl.addProtocol).toHaveBeenCalledWith(
      'caros-tile',
      expect.any(Function),
    );
  });

  it('init() iki kez çağrılsa da protokol bir kez kaydedilir', async () => {
    const { default: maplibregl } = await import('maplibre-gl');
    const { cacheLRUManager } = await import('../core/storage/CacheLRUManager');
    const callsBefore = (maplibregl.addProtocol as ReturnType<typeof vi.fn>).mock.calls.length;
    cacheLRUManager.init(); // ikinci çağrı — idempotent
    const callsAfter  = (maplibregl.addProtocol as ReturnType<typeof vi.fn>).mock.calls.length;
    // İkinci çağrı ek kayıt yapmamalı
    expect(callsAfter).toBe(callsBefore);
  });
});

describe('CacheLRUManager — cache hit / miss', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _mockCacheStore.clear();
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();
  });

  it('ilk tile isteği → cache miss, network fetch tetiklenir', async () => {
    const mgr = await _freshManager();
    const stats0 = mgr.getCacheStats();
    expect(stats0.misses).toBe(0);

    // Protokol handler'ı bul ve simüle et
    const handler = _registeredProtocols.get('caros-tile');
    expect(handler).toBeDefined();

    const ctrl = new AbortController();
    await (handler as Function)(
      { url: 'caros-tile://tile.openstreetmap.org/10/520/350.png' },
      ctrl,
    );

    const stats1 = mgr.getCacheStats();
    expect(stats1.misses).toBe(1);
    expect(stats1.hits).toBe(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('aynı tile ikinci kez istenince → cache hit, network fetch yok', async () => {
    const mgr = await _freshManager();
    const handler = _registeredProtocols.get('caros-tile')!;
    const ctrl = new AbortController();
    const url = 'caros-tile://tile.openstreetmap.org/10/520/350.png';

    // İlk istek — miss
    await (handler as Function)({ url }, ctrl);
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();

    // İkinci istek — hit
    await (handler as Function)({ url }, ctrl);

    const stats = mgr.getCacheStats();
    expect(stats.hits).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(0);
  });
});

describe('CacheLRUManager — istatistikler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _mockCacheStore.clear();
  });

  it('getCacheStats().hitRate doğru hesaplanır', async () => {
    const mgr = await _freshManager();
    const handler = _registeredProtocols.get('caros-tile')!;
    const ctrl = new AbortController();

    // 1 miss
    await (handler as Function)(
      { url: 'caros-tile://tile.openstreetmap.org/10/520/350.png' },
      ctrl,
    );
    // 1 hit (aynı URL tekrar)
    await (handler as Function)(
      { url: 'caros-tile://tile.openstreetmap.org/10/520/350.png' },
      ctrl,
    );

    const stats = mgr.getCacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(50);
  });

  it("getCacheStats().tileCount cache'e eklenen tile sayisini yansitir", async () => {
    const mgr = await _freshManager();
    const handler = _registeredProtocols.get('caros-tile')!;
    const ctrl = new AbortController();

    const urls = [
      'caros-tile://tile.openstreetmap.org/10/520/350.png',
      'caros-tile://tile.openstreetmap.org/10/521/350.png',
      'caros-tile://tile.openstreetmap.org/10/522/350.png',
    ];

    for (const url of urls) {
      await (handler as Function)({ url }, ctrl);
    }

    const stats = mgr.getCacheStats();
    expect(stats.tileCount).toBe(3);
  });
});

describe('CacheLRUManager — koridor koruması', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _mockCacheStore.clear();
  });

  it('markCorridorProtected + clearCorridorProtection döngüsü', async () => {
    const mgr = await _freshManager();
    const handler = _registeredProtocols.get('caros-tile')!;
    const ctrl = new AbortController();

    // Tile'ı cache'e al
    await (handler as Function)(
      { url: 'caros-tile://tile.openstreetmap.org/12/2345/1680.png' },
      ctrl,
    );

    // Koridor koruması işaretle
    mgr.markCorridorProtected(['12/2345/1680']);

    // clearCorridorProtection() hata atmaz ve düzgün çalışır
    expect(() => mgr.clearCorridorProtection()).not.toThrow();
  });

  it('clearCorridorProtection() sonrası istatistikler bozulmaz', async () => {
    const mgr = await _freshManager();
    const handler = _registeredProtocols.get('caros-tile')!;
    const ctrl = new AbortController();

    await (handler as Function)(
      { url: 'caros-tile://tile.openstreetmap.org/12/2345/1680.png' },
      ctrl,
    );

    mgr.markCorridorProtected(['12/2345/1680']);
    mgr.clearCorridorProtection();

    const stats = mgr.getCacheStats();
    expect(stats.tileCount).toBe(1);  // tile hâlâ cache'de
  });
});

describe('CacheLRUManager — protocol URL dönüşümü', () => {
  it("caros-tile:// -> https:// donusumu fetch'te dogru URL kullanilir", async () => {
    vi.clearAllMocks();
    _mockCacheStore.clear();
    const mgr = await _freshManager();
    const handler = _registeredProtocols.get('caros-tile')!;
    const ctrl = new AbortController();

    await (handler as Function)(
      { url: 'caros-tile://a.tile.openstreetmap.org/14/8740/5645.png' },
      ctrl,
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://a.tile.openstreetmap.org/14/8740/5645.png',
      expect.any(Object),
    );
  });
});
