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

import { describe, it, expect, vi, beforeEach, afterEach as _afterEach } from 'vitest';

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
    await (handler as (...args: unknown[]) => Promise<unknown>)(
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
    await (handler as (...args: unknown[]) => Promise<unknown>)({ url }, ctrl);
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();

    // İkinci istek — hit
    await (handler as (...args: unknown[]) => Promise<unknown>)({ url }, ctrl);

    const stats = mgr.getCacheStats();
    expect(stats.hits).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(0);
  });
});

/* ── #613 — SIFIR BAYTLIK KARO ZEHRİ (SAHADA ÖLÇÜLDÜ 2026-08-17) ──────────
 *
 * Cihazda mini harita bomboş kalıyordu: `caros-tiles-v1` önbelleğinde vektör
 * karoları `200 / 0 bayt` olarak duruyordu (canlı ağda aynı karo 34 095 bayt).
 * `new ArrayBuffer(0)` truthy olduğu için eski `if (cached)` kapısı bunu GEÇERLİ
 * isabet sayıyor, MapLibre boş karoyu ayrıştırıp `loaded` diyor → sıfır özellik,
 * HATA YOK → sessiz beyaz harita (#609 mandalı da tetiklenmiyor). 0 baytlık girdi
 * `_totalBytes`i büyütmediği için LRU baskısıyla asla düşmüyor → zehir kalıcı.
 * BU KİLİTLER ZAYIFLATILMAZ.
 */
describe('CacheLRUManager — #613 sıfır baytlık karo zehri', () => {
  const HTTPS_URL = 'https://tile.openstreetmap.org/10/520/350.png';
  const PROTO_URL = 'caros-tile://tile.openstreetmap.org/10/520/350.png';

  beforeEach(() => {
    vi.clearAllMocks();
    _mockCacheStore.clear();
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();
  });

  it('0 baytlık önbellek girdisi İSABET SAYILMAZ — ağdan yeniden indirilir', async () => {
    const mgr = await _freshManager();
    const handler = _registeredProtocols.get('caros-tile')!;

    // Zehirli girdiyi ek — tam sahada ölçülen biçim: status 200, gövde boş
    const cache = await _mockCaches.open('caros-tiles-v1');
    await cache.put(HTTPS_URL, new Response(new ArrayBuffer(0), { status: 200 }));

    const res = await (handler as (...args: unknown[]) => Promise<{ data: ArrayBuffer }>)(
      { url: PROTO_URL }, new AbortController(),
    );

    // Boş veri DÖNMEZ; gerçek karo döner
    expect(res.data.byteLength).toBeGreaterThan(0);
    // İsabet sayılmadı, ağa çıkıldı
    expect(mgr.getCacheStats().hits).toBe(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('zehirli girdi TEMİZLENİR — sonraki istek 0 bayt görmez', async () => {
    await _freshManager();
    const handler = _registeredProtocols.get('caros-tile')!;
    const cache = await _mockCaches.open('caros-tiles-v1');
    await cache.put(HTTPS_URL, new Response(new ArrayBuffer(0), { status: 200 }));

    await (handler as (...args: unknown[]) => Promise<unknown>)({ url: PROTO_URL }, new AbortController());
    // Tembel onarım asenkron (fire-and-forget) — mikro görev kuyruğunu boşalt
    await new Promise(r => setTimeout(r, 0));

    const stored = await cache.match(HTTPS_URL);
    // Girdi ya silinmiş ya da gerçek veriyle değişmiş olmalı — 0 bayt KALMAMALI
    const bytes = stored ? (await stored.arrayBuffer()).byteLength : 0;
    expect(bytes).not.toBe(0);
  });

  it('ağdan 0 bayt gelirse HATA FIRLATIR — sessiz boş karo dönmez', async () => {
    await _freshManager();
    const handler = _registeredProtocols.get('caros-tile')!;
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => new Response(new ArrayBuffer(0), { status: 200 }),
    );

    await expect(
      (handler as (...args: unknown[]) => Promise<unknown>)({ url: PROTO_URL }, new AbortController()),
    ).rejects.toThrow();
  });

  it('0 baytlık gövde ÖNBELLEĞE YAZILMAZ', async () => {
    await _freshManager();
    const handler = _registeredProtocols.get('caros-tile')!;
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => new Response(new ArrayBuffer(0), { status: 200 }),
    );

    await (handler as (...args: unknown[]) => Promise<unknown>)({ url: PROTO_URL }, new AbortController())
      .catch(() => { /* fırlatması beklenen davranış — burada önbelleği ölçüyoruz */ });
    await new Promise(r => setTimeout(r, 0));

    const cache = await _mockCaches.open('caros-tiles-v1');
    expect(await cache.match(HTTPS_URL)).toBeUndefined();
  });

  /**
   * Zehrin GERÇEK kaynağı: MapLibre döndürülen ArrayBuffer'ı worker'a TRANSFER
   * eder → buffer bu iş parçacığında detach olur (byteLength 0). Fire-and-forget
   * `_putToCache` `await caches.open()` sırasında sıra bıraktığı için detach tam
   * o aralıkta gerçekleşir ve diske BOŞ gövde yazılırdı: karo ilk açılışta çizer,
   * sonraki her açılış 0 bayt servis eder. Önbelleğe kendi `slice(0)` kopyamız
   * yazılır — bu kilit o kopyayı korur.
   */
  it('döndürülen buffer TRANSFER/detach edilse bile önbellekteki kopya sağlam kalır', async () => {
    await _freshManager();
    const handler = _registeredProtocols.get('caros-tile')!;

    // Mock `caches.open()` anında çözülüyor ve yarışı GİZLİYOR (kilit sahte
    // olarak geçiyordu — doğrulandı). Gerçek cihazdaki sıralama şudur:
    // `_putToCache` `caches.open()` üzerinde sıra bırakır, tam o aralıkta
    // MapLibre buffer'ı transfer eder. Bu yüzden open bilinçli yavaşlatılır.
    const origOpen = _mockCaches.open;
    _mockCaches.open = (async (name: string) => {
      await new Promise(r => setTimeout(r, 5));
      return origOpen(name);
    }) as typeof _mockCaches.open;

    try {
      const res = await (handler as (...args: unknown[]) => Promise<{ data: ArrayBuffer }>)(
        { url: PROTO_URL }, new AbortController(),
      );
      // MapLibre'nin yaptığını birebir taklit et: buffer'ı transfer ederek detach et
      structuredClone(res.data, { transfer: [res.data] });
      expect(res.data.byteLength).toBe(0);          // detach gerçekleşti (ön koşul)

      await new Promise(r => setTimeout(r, 40));     // fire-and-forget yazımı bekle

      const cache  = await origOpen('caros-tiles-v1');
      const stored = await cache.match(HTTPS_URL);
      expect(stored).toBeDefined();
      expect((await stored!.arrayBuffer()).byteLength).toBeGreaterThan(0);
    } finally {
      _mockCaches.open = origOpen;
    }
  });

  it('vektör karosu PNG olarak DEĞİL, vektör içerik türüyle önbelleğe yazılır', async () => {
    await _freshManager();
    const handler = _registeredProtocols.get('caros-tile')!;
    const pbfProto = 'caros-tile://tile.openstreetmap.org/10/520/350.pbf';
    const pbfHttps = 'https://tile.openstreetmap.org/10/520/350.pbf';

    await (handler as (...args: unknown[]) => Promise<unknown>)({ url: pbfProto }, new AbortController());
    await new Promise(r => setTimeout(r, 0));

    const cache  = await _mockCaches.open('caros-tiles-v1');
    const stored = await cache.match(pbfHttps);
    expect(stored?.headers.get('content-type')).toBe('application/vnd.mapbox-vector-tile');
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
    await (handler as (...args: unknown[]) => Promise<unknown>)(
      { url: 'caros-tile://tile.openstreetmap.org/10/520/350.png' },
      ctrl,
    );
    // 1 hit (aynı URL tekrar)
    await (handler as (...args: unknown[]) => Promise<unknown>)(
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
      await (handler as (...args: unknown[]) => Promise<unknown>)({ url }, ctrl);
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
    await (handler as (...args: unknown[]) => Promise<unknown>)(
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

    await (handler as (...args: unknown[]) => Promise<unknown>)(
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
    await _freshManager();
    const handler = _registeredProtocols.get('caros-tile')!;
    const ctrl = new AbortController();

    await (handler as (...args: unknown[]) => Promise<unknown>)(
      { url: 'caros-tile://a.tile.openstreetmap.org/14/8740/5645.png' },
      ctrl,
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://a.tile.openstreetmap.org/14/8740/5645.png',
      expect.any(Object),
    );
  });
});
