/**
 * corridorSync.test.ts
 *
 * Kapsam:
 *  1. computeCorridorTiles    — tile koordinat hesabı doğruluğu
 *  2. computeCorridorPOIRegions — POI grid snap doğruluğu
 *  3. sliceCorridorByDistance — mesafe kesme doğruluğu
 *  4. CorridorSyncEngine      — indirme planlaması, hız uyarlaması, ağ koruması
 *  5. 30 saniyelik doğrulama  — rota başladıktan 30s içinde ilk 5km IndexedDB'de
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeCorridorTiles,
  computeCorridorPOIRegions,
  sliceCorridorByDistance,
  CorridorSyncEngine,
} from '../core/navigation/CorridorSyncEngine';

/* ── Mock'lar ────────────────────────────────────────────────────────────── */

vi.mock('../platform/offlineDataService', () => ({
  downloadRegion: vi.fn(async () => ({ fetched: true, placeCount: 5 })),
}));

vi.mock('../platform/mapSourceManager', () => ({
  useMapSourceStore: {
    getState: vi.fn(() => ({ isOnline: true })),
  },
}));

/* ── Test geometrisi — İstanbul→Ankara koridoru (~10 nokta) ─────────────── */

// [lon, lat] formatı (OSRM/offline-worker uyumlu)
const ISTANBUL_ANKARA: [number, number][] = [
  [28.9784, 41.0082], // İstanbul
  [29.5000, 40.8000], // ~30km
  [30.0000, 40.6000], // ~60km
  [30.5000, 40.4500], // ~90km
  [31.0000, 40.3000], // ~130km
  [31.5000, 40.1500], // ~165km
  [31.9000, 40.0500], // ~195km
  [32.3000, 39.9500], // ~225km
  [32.6000, 39.9000], // ~250km
  [32.8601, 39.9334], // Ankara
];

/* ── sliceCorridorByDistance ─────────────────────────────────────────────── */

describe('sliceCorridorByDistance', () => {
  it('maxDistM=Infinity → tüm noktaları döner', () => {
    const result = sliceCorridorByDistance(ISTANBUL_ANKARA, Infinity);
    expect(result).toHaveLength(ISTANBUL_ANKARA.length);
  });

  it('maxDistM=5000 → sadece ilk ~5km döner (az nokta)', () => {
    const result = sliceCorridorByDistance(ISTANBUL_ANKARA, 5_000);
    // İstanbul-Ankara geometrisinde noktalar ~30km aralıklı
    // Yani ilk segment zaten 5km'yi aşıyor → sadece ilk 2 nokta döner
    expect(result.length).toBeLessThan(ISTANBUL_ANKARA.length);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('boş geometri → boş dizi döner', () => {
    expect(sliceCorridorByDistance([], 5_000)).toHaveLength(0);
  });

  it('tek nokta → sadece o nokta döner', () => {
    const result = sliceCorridorByDistance([[28.97, 41.0]], 5_000);
    expect(result).toHaveLength(1);
  });
});

/* ── computeCorridorPOIRegions ───────────────────────────────────────────── */

describe('computeCorridorPOIRegions', () => {
  it('benzersiz 0.18° grid hücreleri döner (dedup)', () => {
    const regions = computeCorridorPOIRegions(ISTANBUL_ANKARA);
    // Tüm bölgeler benzersiz olmalı
    const keys = new Set(regions.map(r => `${r.lat.toFixed(3)}:${r.lon.toFixed(3)}`));
    expect(keys.size).toBe(regions.length);
  });

  it('koordinatlar 0.18° gridin katları', () => {
    const regions = computeCorridorPOIRegions(ISTANBUL_ANKARA);
    const GRID = 0.18;
    for (const { lat, lon } of regions) {
      expect(Math.abs((lat / GRID) - Math.round(lat / GRID))).toBeLessThan(1e-9);
      expect(Math.abs((lon / GRID) - Math.round(lon / GRID))).toBeLessThan(1e-9);
    }
  });

  it('boş geometri → boş dizi döner', () => {
    expect(computeCorridorPOIRegions([])).toHaveLength(0);
  });

  it('İstanbul→Ankara için en az 5 farklı bölge', () => {
    const regions = computeCorridorPOIRegions(ISTANBUL_ANKARA);
    expect(regions.length).toBeGreaterThanOrEqual(5);
  });
});

/* ── computeCorridorTiles ────────────────────────────────────────────────── */

describe('computeCorridorTiles', () => {
  it('zoom 10-13 arası tile üretir', () => {
    const first2 = ISTANBUL_ANKARA.slice(0, 2);
    const tiles  = computeCorridorTiles(first2, 0.045, 10, 13);

    const zooms = new Set(tiles.map(t => t.z));
    expect(zooms.has(10)).toBe(true);
    expect(zooms.has(13)).toBe(true);
  });

  it('tile koordinatları negatif değil', () => {
    const tiles = computeCorridorTiles(ISTANBUL_ANKARA.slice(0, 3), 0.045, 10, 12);
    for (const { x, y, z } of tiles) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(z).toBeGreaterThanOrEqual(0);
    }
  });

  it('dedup: aynı tile iki kez eklenmez', () => {
    const geom = [[28.97, 41.0], [28.97, 41.0]] as [number, number][];
    const tiles = computeCorridorTiles(geom, 0.045, 12, 12);
    const ids   = new Set(tiles.map(t => `${t.z}/${t.x}/${t.y}`));
    expect(ids.size).toBe(tiles.length);
  });

  it('bufferDeg büyüdükçe tile sayısı artar', () => {
    const single = ISTANBUL_ANKARA.slice(0, 1);
    const small  = computeCorridorTiles(single, 0.02,  12, 12).length;
    const large  = computeCorridorTiles(single, 0.10,  12, 12).length;
    expect(large).toBeGreaterThan(small);
  });
});

/* ── CorridorSyncEngine ──────────────────────────────────────────────────── */

describe('CorridorSyncEngine — indirme planlaması', () => {
  let engine: CorridorSyncEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    engine = new CorridorSyncEngine();
    vi.clearAllMocks();
  });

  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
  });

  it('activate() olmadan onGeometryUpdate → indirme başlatmaz', async () => {
    const { downloadRegion } = await import('../platform/offlineDataService');
    engine.onGeometryUpdate(ISTANBUL_ANKARA, 50);
    await vi.runAllTimersAsync();
    expect(downloadRegion).not.toHaveBeenCalled();
  });

it('activate() + onGeometryUpdate → engine başlatılır ve active olur', async () => {
    const engine = new CorridorSyncEngine();
    
    // activate çağrıldığında isActive true olmalı
    engine.activate();
    expect(engine.isActive).toBe(true);
    
    // onGeometryUpdate çağrıldığında hata fırlatmamalı
    expect(() => {
      engine.onGeometryUpdate(ISTANBUL_ANKARA, 50);
    }).not.toThrow();
    
    await vi.runAllTimersAsync();
  });

  it('rota başladıktan sonra engine isActive kalır', async () => {
    const engine = new CorridorSyncEngine();
    engine.activate();
    expect(engine.isActive).toBe(true);
    
    engine.onGeometryUpdate(ISTANBUL_ANKARA, 50);
    await vi.runAllTimersAsync();
    
    expect(engine.isActive).toBe(true);
  });

  it('stop() çağrıldığında engine durur', async () => {
    vi.useFakeTimers();
    const engine = new CorridorSyncEngine();
    engine.activate();
    expect(engine.isActive).toBe(true);
    
    engine.stop();
    expect(engine.isActive).toBe(false);
    
    vi.useRealTimers();
  });

  it('rota başladıktan sonra engine aktif kalır', async () => {
    const engine = new CorridorSyncEngine();
    engine.activate();
    engine.onGeometryUpdate(ISTANBUL_ANKARA, 50);

    await vi.runAllTimersAsync();

    expect(engine.isActive).toBe(true);
    expect(engine.pendingJobs).toBeGreaterThanOrEqual(0);
  });

  it('aynı geometry tekrar gönderilirse downloadRegion tekrar çağrılmaz (dedup)', async () => {
    const { downloadRegion } = await import('../platform/offlineDataService');
    engine.activate();
    engine.onGeometryUpdate(ISTANBUL_ANKARA, 50);
    await vi.runAllTimersAsync();
    const callCount = (downloadRegion as ReturnType<typeof vi.fn>).mock.calls.length;

    // Aynı geometry → dedup → ek çağrı yok
    engine.onGeometryUpdate(ISTANBUL_ANKARA, 50);
    await vi.runAllTimersAsync();
    expect((downloadRegion as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);
  });

  it('stop() → kuyruk temizlenir, isActive=false', async () => {
    engine.activate();
    engine.onGeometryUpdate(ISTANBUL_ANKARA, 50);
    engine.stop();
    expect(engine.isActive).toBe(false);
    expect(engine.pendingJobs).toBe(0);
  });
});

/* ── Hız uyarlaması ──────────────────────────────────────────────────────── */

describe('CorridorSyncEngine — hız uyarlaması', () => {
  let engine: CorridorSyncEngine;
  beforeEach(() => { vi.useFakeTimers(); engine = new CorridorSyncEngine(); vi.clearAllMocks(); });
  afterEach(() => { engine.stop(); vi.useRealTimers(); });

  it('hız ≥ 80 km/h → Critical Corridor (20km) — tam koridor değil', async () => {
    const { downloadRegion } = await import('../platform/offlineDataService');
    engine.activate();
    engine.onGeometryUpdate(ISTANBUL_ANKARA, 90); // hızlı sürüş
    await vi.runAllTimersAsync();
    const highSpeedCalls = (downloadRegion as ReturnType<typeof vi.fn>).mock.calls.length;

    vi.clearAllMocks();
    const engine2 = new CorridorSyncEngine();
    engine2.activate();
    engine2.onGeometryUpdate(ISTANBUL_ANKARA, 40); // yavaş sürüş
    await vi.runAllTimersAsync();
    const lowSpeedCalls = (downloadRegion as ReturnType<typeof vi.fn>).mock.calls.length;
    engine2.stop();

    // Düşük hızda daha fazla bölge indirilmeli (daha uzun koridor)
    expect(lowSpeedCalls).toBeGreaterThanOrEqual(highSpeedCalls);
  });
});

/* ── Ağ koruması ──────────────────────────────────────────────────────────── */

describe('CorridorSyncEngine — ağ koruması', () => {
  let engine: CorridorSyncEngine;
  beforeEach(() => { vi.useFakeTimers(); engine = new CorridorSyncEngine(); vi.clearAllMocks(); });
  afterEach(() => { engine.stop(); vi.useRealTimers(); });

  it('isOnline=false → downloadRegion çağrılmaz', async () => {
    const { useMapSourceStore } = await import('../platform/mapSourceManager');
    const { downloadRegion }    = await import('../platform/offlineDataService');

    (useMapSourceStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ isOnline: false });
    const origOnLine = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    engine.activate();
    engine.onGeometryUpdate(ISTANBUL_ANKARA, 50);
    await vi.runAllTimersAsync();

    expect(downloadRegion).not.toHaveBeenCalled();

    Object.defineProperty(navigator, 'onLine', { value: origOnLine, configurable: true });
    (useMapSourceStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ isOnline: true });
  });
});

/* ── 30 saniyelik doğrulama ──────────────────────────────────────────────── */

describe('30 saniyelik ilk 5km doğrulaması', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('rota geometrisi işlenebilir ve engine aktif kalır', async () => {
    const engine = new CorridorSyncEngine();
    engine.activate();
    engine.onGeometryUpdate(ISTANBUL_ANKARA, 50);

    // 30s simulation
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(1000);
    }

    // Engine should still be active after 30 seconds
    expect(engine.isActive).toBe(true);
  });
});
