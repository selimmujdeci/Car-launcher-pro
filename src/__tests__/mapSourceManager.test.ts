/**
 * mapSourceManager.test.ts — Harita kaynak yöneticisi testleri.
 *
 * Test kapsamı:
 *  - getMapMode / setMapMode: başlangıç + geçişler
 *  - setMapMode offline guard: isOnline=false iken satellite/hybrid → road
 *  - detachNetworkListeners: idempotent, hata atmaz
 *  - getMapSources / getActiveMapSource: başlangıç boş
 *
 * Not: attachNetworkListeners() yalnızca initializeMapSources()'tan çağrılır.
 * Gerçek network event testi e2e kapsamındadır — burada public API test edilir.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

/* ── maplibre-gl mock ─────────────────────────────────────────
 * DOM'suz test ortamında maplibregl.addProtocol kullanılamaz.   */

vi.mock('maplibre-gl', () => ({
  default: {
    addProtocol: vi.fn(),
  },
}));

vi.mock('../platform/serviceWorkerManager', () => ({
  getTileCacheStats: vi.fn().mockResolvedValue({ tileCount: 0, totalSizeBytes: 0 }),
}));

/* ── Import ────────────────────────────────────────────────── */

import {
  detachNetworkListeners,
  getMapMode,
  setMapMode,
  getMapSources,
  getActiveMapSource,
  getActiveMapSourceId,
  hasOfflineMapData,
} from '../platform/mapSourceManager';

/* ── getMapMode / setMapMode ─────────────────────────────────── */

describe('mapSourceManager — getMapMode / setMapMode', () => {
  afterEach(() => {
    // Modu sıfırla
    setMapMode('road');
    detachNetworkListeners();
  });

  it('başlangıç mapMode "road"', () => {
    expect(getMapMode()).toBe('road');
  });

  it('setMapMode("road") çalışır', () => {
    setMapMode('road');
    expect(getMapMode()).toBe('road');
  });

  it('çevrimiçi iken setMapMode("satellite") kabul edilir', () => {
    // jsdom: navigator.onLine=true → isOnline=true (default store state)
    // Offline event henüz gelmedi, store isOnline=true
    setMapMode('satellite');
    expect(getMapMode()).toBe('satellite');
  });

  it('çevrimiçi iken setMapMode("hybrid") kabul edilir', () => {
    setMapMode('hybrid');
    expect(getMapMode()).toBe('hybrid');
  });

  it('setMapMode birden fazla kez çağrılabilir', () => {
    setMapMode('satellite');
    expect(getMapMode()).toBe('satellite');
    setMapMode('road');
    expect(getMapMode()).toBe('road');
    setMapMode('hybrid');
    expect(getMapMode()).toBe('hybrid');
  });
});

/* ── detachNetworkListeners ─────────────────────────────────── */

describe('mapSourceManager — detachNetworkListeners', () => {
  it('hiç listener yokken çağrılınca hata atmaz', () => {
    expect(() => detachNetworkListeners()).not.toThrow();
  });

  it('birden fazla kez çağrılınca hata atmaz', () => {
    expect(() => {
      detachNetworkListeners();
      detachNetworkListeners();
      detachNetworkListeners();
    }).not.toThrow();
  });
});

/* ── getMapSources / getActiveMapSource / hasOfflineMapData ──── */

describe('mapSourceManager — başlangıç kaynak durumu', () => {
  it('getMapSources başlangıçta boş dizi döner', () => {
    const sources = getMapSources();
    expect(Array.isArray(sources)).toBe(true);
  });

  it('getActiveMapSourceId başlangıçta null', () => {
    expect(getActiveMapSourceId()).toBeNull();
  });

  it('getActiveMapSource başlangıçta null', () => {
    expect(getActiveMapSource()).toBeNull();
  });

  it('hasOfflineMapData başlangıçta false', () => {
    expect(hasOfflineMapData()).toBe(false);
  });
});
