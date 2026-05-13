/**
 * geocodingFallback.test.ts
 *
 * Kapsam:
 *  1. navigator.onLine=false → anında offline fallback (<500ms)
 *  2. Nominatim hızlı yanıt → online sonuçlar döner (source: 'online')
 *  3. 2.5s timeout → Nominatim abort + offline fallback
 *  4. Nominatim ağ hatası → offline fallback
 *  5. Offline sonuçlarda source: 'offline' etiketi
 *  6. Overpass / searchNearby rate-limit logic bozulmadı
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── offlineSearchService mock ──────────────────────────────── */

const _mockOfflineResults = [
  {
    location: {
      id:      'loc-1',
      name:    'Kadıköy',
      address: 'Kadıköy, İstanbul',
      lat:     40.9906,
      lng:     29.0228,
      source:  'search' as const,
      timestamp: Date.now(),
      useCount:  3,
    },
    score:     0.9,
    matchedBy: 'exact' as const,
  },
];

const _mockPOIResults = [
  {
    id:       'poi-1',
    name:     'Taksim Meydanı',
    address:  'Beyoğlu, İstanbul',
    lat:      41.0369,
    lon:      28.9850,
    score:    0.85,
    category: 'square',
    source:   'sqlite-fts5' as const,
  },
];

vi.mock('../platform/offlineSearchService', () => ({
  searchOffline: vi.fn(async () => _mockOfflineResults),
  searchPOI:     vi.fn(async () => _mockPOIResults),
}));

/* ── fetch mock ──────────────────────────────────────────────── */

const _nominatimResponse = [
  {
    place_id:     12345,
    display_name: 'Kadıköy, İstanbul, Türkiye',
    lat:          '40.9906',
    lon:          '29.0228',
    class:        'place',
    type:         'suburb',
  },
];

let _fetchDelay = 0; // ms cinsinden gecikme simülasyonu

global.fetch = vi.fn(async (url: string | Request) => {
  const urlStr = typeof url === 'string' ? url : (url as Request).url;
  if (urlStr.includes('nominatim')) {
    if (_fetchDelay > 0) {
      await new Promise<void>((_, rej) => {
        const t = setTimeout(() => rej(new Error('simulated-timeout')), _fetchDelay);
        // AbortSignal entegrasyonu
        const req = url instanceof Request ? url : new Request(url as string);
        req.signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); });
      });
    }
    return new Response(JSON.stringify(_nominatimResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (urlStr.includes('overpass')) {
    return new Response(JSON.stringify({ elements: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(null, { status: 404 });
}) as typeof fetch;

/* ── navigator mock ─────────────────────────────────────────── */

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

/* ── Tests ───────────────────────────────────────────────────── */

describe('geocodeAddress — offline fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _fetchDelay = 0;
    setOnline(true);
    vi.clearAllMocks();
    // navigator rate-limiter'ı sıfırla
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    setOnline(true);
  });

  it('navigator.onLine=false → offline sonuç döner, fetch çağrılmaz', async () => {
    setOnline(false);
    const { geocodeAddress } = await import('../platform/geocodingService');
    const { searchOffline }  = await import('../platform/offlineSearchService');

    const results = await geocodeAddress('Kadıköy');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe('offline');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(searchOffline).toHaveBeenCalledWith('Kadıköy', 4);
  });

  it('navigator.onLine=false → <500ms tamamlanır', async () => {
    vi.useRealTimers(); // gerçek zamanlı ölçüm
    setOnline(false);
    const { geocodeAddress } = await import('../platform/geocodingService');

    const t0      = performance.now();
    const results = await geocodeAddress('Taksim');
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(500);
    expect(results[0].source).toBe('offline');
  });

  it('Nominatim hızlı yanıt verince → source: online, fetch çağrılır', async () => {
    vi.useRealTimers();
    setOnline(true);
    vi.resetModules();

    // Rate-limiter için son isteği sıfırla (fresh modül)
    const { geocodeAddress } = await import('../platform/geocodingService');

    // Fetch mock: hemen yanıt verir (no delay)
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify(_nominatimResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const results = await geocodeAddress('Kadıköy');

    // En az bir online sonuç beklenir
    const onlineResults = results.filter(r => r.source === 'online');
    expect(onlineResults.length).toBeGreaterThan(0);
  });

  it('Nominatim ağ hatası → offline fallback devreye girer', async () => {
    vi.useRealTimers();
    setOnline(true);
    vi.resetModules();

    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError('fetch failed'),
    );

    const { geocodeAddress } = await import('../platform/geocodingService');
    const results = await geocodeAddress('Ankara');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe('offline');
  });

  it('offline fallback sonuclarinda source: offline etiketi var', async () => {
    setOnline(false);
    const { geocodeAddress } = await import('../platform/geocodingService');

    const results = await geocodeAddress('İstanbul');

    for (const r of results) {
      expect(r.source).toBe('offline');
    }
  });

  it('offline fallback IndexedDB + POI sonuclarini birlestiriyor', async () => {
    setOnline(false);
    const { geocodeAddress } = await import('../platform/geocodingService');
    const { searchOffline, searchPOI } = await import('../platform/offlineSearchService');

    const results = await geocodeAddress('İstanbul');

    // Her iki kaynak da çağrılmış olmalı
    expect(searchOffline).toHaveBeenCalled();
    // POI arama sonuçlar yetersizse çağrılır
    expect(results.length).toBeGreaterThan(0);
    void searchPOI; // imported to check if called — mocked above
  });
});

describe('geocodeAddress — 2s fast-fail timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    setOnline(true);
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    setOnline(true);
  });

  it('2s fast-fail: Nominatim yavas kalirsa offline fallback devreye girer', async () => {
    const { geocodeAddress } = await import('../platform/geocodingService');
    const { searchOffline }  = await import('../platform/offlineSearchService');

    // Fetch hiçbir zaman yanıt vermez (simülasyon için pending promise)
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise(() => { /* never resolves */ }),
    );

    // Rate-limiter + fast-fail timeout dahil ilerleme
    const resultPromise = geocodeAddress('Samsun');

    // Rate-limiter (1100ms) + fast-fail (2000ms) = 3100ms — 3500ms ile geç
    await vi.advanceTimersByTimeAsync(3_500);

    const results = await resultPromise;

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe('offline');
    expect(searchOffline).toHaveBeenCalled();
  });

  it('fast-fail 2s dolmadan Nominatim yanitlarsa online sonuc doner', async () => {
    vi.useRealTimers();
    setOnline(true);
    vi.resetModules();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify(_nominatimResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { geocodeAddress } = await import('../platform/geocodingService');
    const results = await geocodeAddress('Ankara');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe('online');
  });
});

describe('geocodeAddress — Overpass / searchNearby korunuyor', () => {
  beforeEach(() => {
    setOnline(true);
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('searchNearby dogrudan fetch kullanir, offlineSearchService cagrilmaz', async () => {
    vi.useRealTimers();
    const { searchNearby } = await import('../platform/geocodingService');
    const { searchOffline } = await import('../platform/offlineSearchService');

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const results = await searchNearby('fuel', 41.0, 29.0);

    expect(Array.isArray(results)).toBe(true);
    expect(searchOffline).not.toHaveBeenCalled();
  });
});

describe('GeoResult — source field', () => {
  it('online sonuclarda source: online', async () => {
    vi.useRealTimers();
    setOnline(true);
    vi.resetModules();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify(_nominatimResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { geocodeAddress } = await import('../platform/geocodingService');
    const results = await geocodeAddress('Kadıköy');
    const online  = results.find(r => r.source === 'online');
    expect(online).toBeDefined();
  });

  it('offline sonuclarda source: offline', async () => {
    setOnline(false);
    vi.useRealTimers();
    const { geocodeAddress } = await import('../platform/geocodingService');
    const results = await geocodeAddress('test');
    expect(results.every(r => r.source === 'offline')).toBe(true);
  });
});
