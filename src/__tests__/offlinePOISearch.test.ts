/**
 * offlinePOISearch.test.ts
 *
 * Kapsam:
 *  1. decodePOISAB — SharedArrayBuffer doğru okunuyor mu?
 *  2. searchPOI    — <150ms performans ve worker dispatch entegrasyonu
 *  3. Edge cases   — boş sorgu, poi.db yok, SAB eksik
 *  4. caros:offline-data-missing — dbError + manifest → event dispatch
 *  5. MemoryWatchdog CRITICAL → closeWorkerDatabase kesin tetiklenmesi
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  decodePOISAB,
  searchPOI,
  POI_SAB_HEADER,
  POI_SAB_STRIDE,
  POI_SAB_MAX,
} from '../platform/offlineSearchService';

/* ── Bağımlı modül mock'ları (hoisted) ─────────────────────────────────── */

vi.mock('../utils/safeStorage', () => ({
  safeGetRaw:    vi.fn(() => null),  // varsayılan: manifest yok
  safeSetRaw:    vi.fn(),
  safeGetRaw_impl: undefined,
}));

vi.mock('../platform/memoryWatchdog', () => ({
  registerCachePurge: vi.fn(() => () => {}),
}));

/* ── Mock: offlineRoutingService ────────────────────────────────────────── */

// Worker dispatch + DB close mock — test ortamında gerçek Worker çalışmaz
vi.mock('../platform/offlineRoutingService', () => ({
  closeWorkerDatabase: vi.fn(),
  dispatchPOISearch: vi.fn(
    async (
      _query:      string,
      _lat:        number | undefined,
      _lon:        number | undefined,
      maxResults:  number,
      sab:         SharedArrayBuffer | null,
    ): Promise<{ count: number; results?: unknown[] }> => {
      const count = Math.min(3, maxResults);
      const enc   = new TextEncoder();
      const rows  = [
        { id: 'poi-1', name: 'İstanbul Havalimanı', address: 'Arnavutköy, İstanbul', lat: 41.2757, lon: 28.7519, score: 0.95, category: 'airport' },
        { id: 'poi-2', name: 'İstanbul Boğazı',     address: 'İstanbul',              lat: 41.0,   lon: 29.0,   score: 0.80, category: 'water'   },
        { id: 'poi-3', name: 'İstinye Park AVM',    address: 'Sarıyer, İstanbul',     lat: 41.1,   lon: 29.05,  score: 0.70, category: 'mall'    },
      ].slice(0, count);

      if (sab) {
        // Worker'ın SAB yazma davranışını simüle et
        const view  = new DataView(sab);
        const u8    = new Uint8Array(sab);
        const STRIDE = 256;
        const HEADER = 8;

        const writeStr = (base: number, off: number, len: number, s: string) => {
          const bytes = enc.encode(s);
          const start = base + off;
          u8.fill(0, start, start + len);
          u8.set(bytes.slice(0, len - 1), start);
        };

        rows.forEach((r, i) => {
          const base = HEADER + i * STRIDE;
          writeStr(base, 0,   64, r.name);
          writeStr(base, 64,  64, r.address);
          view.setFloat64(base + 128, r.lat,   true);
          view.setFloat64(base + 136, r.lon,   true);
          view.setFloat32(base + 144, r.score, true);
          writeStr(base, 148, 32, r.category);
          writeStr(base, 180, 32, r.id);
        });

        // Atomics yerine direkt yaz (test ortamı, tek thread)
        new Int32Array(sab)[0] = count;
        new Int32Array(sab)[1] = 0;
        return { count };
      }

      // JSON fallback
      return { count, results: rows };
    },
  ),
}));

/* ── decodePOISAB ────────────────────────────────────────────────────────── */

describe('decodePOISAB — SAB veri okuma', () => {
  it('count=0 → boş dizi döner', () => {
    const sab = new SharedArrayBuffer(POI_SAB_HEADER + POI_SAB_STRIDE);
    expect(decodePOISAB(sab, 0)).toHaveLength(0);
  });

  it('count > SAB_MAX → SAB_MAX ile sınırlar', () => {
    const sab = new SharedArrayBuffer(POI_SAB_HEADER + POI_SAB_MAX * POI_SAB_STRIDE);
    // SAB'a sadece 1 kayıt yazalım, count=999 isteyelim
    const results = decodePOISAB(sab, 999);
    expect(results.length).toBeLessThanOrEqual(POI_SAB_MAX);
  });

  it('koordinat ve isim doğru decode edilir', () => {
    const sab  = new SharedArrayBuffer(POI_SAB_HEADER + POI_SAB_STRIDE);
    const view = new DataView(sab);
    const u8   = new Uint8Array(sab);
    const enc  = new TextEncoder();

    const base  = POI_SAB_HEADER;
    const name  = enc.encode('Taksim Meydanı');
    u8.set(name.slice(0, 63), base + 0);          // name @ off=0
    const addr = enc.encode('Beyoğlu, İstanbul');
    u8.set(addr.slice(0, 63), base + 64);          // address @ off=64
    view.setFloat64(base + 128, 41.0369, true);    // lat
    view.setFloat64(base + 136, 28.9850, true);    // lon
    view.setFloat32(base + 144, 0.88,   true);     // score
    const cat = enc.encode('square');
    u8.set(cat.slice(0, 31), base + 148);          // category @ off=148
    const id  = enc.encode('poi-taksim');
    u8.set(id.slice(0, 31), base + 180);           // id @ off=180

    new Int32Array(sab)[0] = 1;
    new Int32Array(sab)[1] = 0;

    const results = decodePOISAB(sab, 1);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Taksim Meydanı');
    expect(results[0].address).toBe('Beyoğlu, İstanbul');
    expect(results[0].lat).toBeCloseTo(41.0369, 4);
    expect(results[0].lon).toBeCloseTo(28.9850, 4);
    expect(results[0].score).toBeCloseTo(0.88, 2);
    expect(results[0].category).toBe('square');
    expect(results[0].id).toBe('poi-taksim');
    expect(results[0].source).toBe('sqlite-fts5');
  });

  it('null-byte sonrası karakterleri okumaz (null-terminated)', () => {
    const sab = new SharedArrayBuffer(POI_SAB_HEADER + POI_SAB_STRIDE);
    const u8  = new Uint8Array(sab);
    const enc = new TextEncoder();

    const base = POI_SAB_HEADER;
    u8.set(enc.encode('ABC'), base + 0);
    u8[base + 3] = 0;           // null terminator
    u8.set(enc.encode('XYZ'), base + 4); // bu kısım okunmamalı

    new Int32Array(sab)[0] = 1;

    const results = decodePOISAB(sab, 1);
    expect(results[0].name).toBe('ABC');
  });
});

/* ── searchPOI — performans ve entegrasyon ───────────────────────────────── */

describe('searchPOI — worker entegrasyonu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('boş sorgu → boş dizi, worker çağrılmaz', async () => {
    const { dispatchPOISearch } = await import('../platform/offlineRoutingService');
    const results = await searchPOI('  ');
    expect(results).toHaveLength(0);
    expect(dispatchPOISearch).not.toHaveBeenCalled();
  });

  it('geçerli sorgu → sonuç listesi döner', async () => {
    const results = await searchPOI('istanbul', { lat: 41.0, lon: 29.0, maxResults: 3 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
    expect(results[0]).toMatchObject({
      name:   expect.any(String),
      lat:    expect.any(Number),
      lon:    expect.any(Number),
      source: 'sqlite-fts5',
    });
  });

  it('maxResults POI_SAB_MAX ile kısıtlanır', async () => {
    const results = await searchPOI('test', { maxResults: 999 });
    expect(results.length).toBeLessThanOrEqual(POI_SAB_MAX);
  });
});

/* ── performans: <150ms ──────────────────────────────────────────────────── */

describe('searchPOI — offline arama hızı < 150ms', () => {
  it('mock worker ile uçtan uca 150ms altında tamamlanır', async () => {
    const iterations = 5;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      await searchPOI('istanbul havalimanı', { lat: 41.27, lon: 28.75, maxResults: 10 });
      times.push(performance.now() - t0);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);

    // Ortalama ve en yavaş çalışma 150ms altında olmalı
    expect(avg).toBeLessThan(150);
    expect(max).toBeLessThan(150);
  });

  it('SAB decode tek başına < 5ms (saf decode yükü)', () => {
    const sab  = new SharedArrayBuffer(POI_SAB_HEADER + POI_SAB_MAX * POI_SAB_STRIDE);
    const view = new DataView(sab);
    const u8   = new Uint8Array(sab);
    const enc  = new TextEncoder();

    // POI_SAB_MAX kayıt doldur
    for (let i = 0; i < POI_SAB_MAX; i++) {
      const base = POI_SAB_HEADER + i * POI_SAB_STRIDE;
      u8.set(enc.encode(`Yer Adı ${i}`).slice(0, 63), base + 0);
      view.setFloat64(base + 128, 41.0 + i * 0.01, true);
      view.setFloat64(base + 136, 29.0 + i * 0.01, true);
      view.setFloat32(base + 144, 0.9 - i * 0.04, true);
    }
    new Int32Array(sab)[0] = POI_SAB_MAX;
    new Int32Array(sab)[1] = 0;

    const t0 = performance.now();
    const results = decodePOISAB(sab, POI_SAB_MAX);
    const elapsed = performance.now() - t0;

    expect(results).toHaveLength(POI_SAB_MAX);
    expect(elapsed).toBeLessThan(5);
  });
});

/* ═══════════════════════════════════════════════════════════════
   4. caros:offline-data-missing EVENT DISPATCH
═══════════════════════════════════════════════════════════════ */

describe('searchPOI — caros:offline-data-missing event dispatch', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it('dbError=true + manifest mevcutsa event dispatch edilir', async () => {
    const { dispatchPOISearch } = await import('../platform/offlineRoutingService');
    const { safeGetRaw }        = await import('../utils/safeStorage');

    // Worker db hatası simüle et
    (dispatchPOISearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      { count: 0, dbError: true },
    );
    // poi.db.manifest var
    (safeGetRaw as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => key === 'poi.db.manifest' ? '{"version":1,"ts":1700000000}' : null,
    );

    const fired: CustomEvent[] = [];
    const handler = (e: Event) => fired.push(e as CustomEvent);
    window.addEventListener('caros:offline-data-missing', handler);

    try {
      await searchPOI('benzinlik');
      expect(fired).toHaveLength(1);
      expect(fired[0].detail.source).toBe('poi.db');
      expect(fired[0].detail.manifest).toBeTruthy();
    } finally {
      window.removeEventListener('caros:offline-data-missing', handler);
    }
  });

  it('dbError=true ama manifest yoksa event dispatch edilmez', async () => {
    const { dispatchPOISearch } = await import('../platform/offlineRoutingService');
    const { safeGetRaw }        = await import('../utils/safeStorage');

    (dispatchPOISearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      { count: 0, dbError: true },
    );
    (safeGetRaw as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const fired: Event[] = [];
    const handler = (e: Event) => fired.push(e);
    window.addEventListener('caros:offline-data-missing', handler);

    try {
      await searchPOI('hastane');
      expect(fired).toHaveLength(0);
    } finally {
      window.removeEventListener('caros:offline-data-missing', handler);
    }
  });

  it('dbError=false ise manifest olsa bile event dispatch edilmez', async () => {
    const { dispatchPOISearch } = await import('../platform/offlineRoutingService');
    const { safeGetRaw }        = await import('../utils/safeStorage');

    (dispatchPOISearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      { count: 0, dbError: false },
    );
    (safeGetRaw as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => key === 'poi.db.manifest' ? '{"version":1}' : null,
    );

    const fired: Event[] = [];
    const handler = (e: Event) => fired.push(e);
    window.addEventListener('caros:offline-data-missing', handler);

    try {
      await searchPOI('otopark');
      expect(fired).toHaveLength(0);
    } finally {
      window.removeEventListener('caros:offline-data-missing', handler);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════
   5. MEMORYWATCHDOG CRITICAL → closeWorkerDatabase DOĞRULAMASI
═══════════════════════════════════════════════════════════════ */

describe('MemoryWatchdog CRITICAL — closeWorkerDatabase kesin tetiklenmesi', () => {
  it('registerCachePurge ile kaydedilen handler closeWorkerDatabase\'ı çağırır', async () => {
    // Modül yüklendiğinde registerCachePurge'e verilen handler'ı yakala
    const { registerCachePurge } = await import('../platform/memoryWatchdog');
    const capturedHandlers: Array<() => void> = [];

    (registerCachePurge as ReturnType<typeof vi.fn>).mockImplementation(
      (fn: () => void) => { capturedHandlers.push(fn); return () => {}; },
    );

    // offlineSearchService modülü modül düzeyinde registerCachePurge çağırır.
    // vi.resetModules + dinamik import ile taze modül yükle.
    vi.resetModules();

    // Bağımlılıkları yeniden mock'la (resetModules sonrası gerekli)
    vi.doMock('../platform/offlineRoutingService', () => ({
      closeWorkerDatabase: vi.fn(),
      dispatchPOISearch:   vi.fn(async () => ({ count: 0 })),
    }));
    vi.doMock('../utils/safeStorage',    () => ({ safeGetRaw: vi.fn(() => null) }));
    vi.doMock('../platform/memoryWatchdog', () => ({
      registerCachePurge: (fn: () => void) => { capturedHandlers.push(fn); return () => {}; },
    }));

    await import('../platform/offlineSearchService');

    // Modül yüklenince en az 1 handler kayıtlı olmalı
    expect(capturedHandlers.length).toBeGreaterThan(0);

    // CRITICAL simülasyonu: tüm purge handler'larını ateşle
    const { closeWorkerDatabase } = await import('../platform/offlineRoutingService');
    for (const fn of capturedHandlers) fn();

    expect(closeWorkerDatabase).toHaveBeenCalledTimes(capturedHandlers.length);
  });
});
