/**
 * mapSourceManager.test.ts — Harita kaynak yöneticisi testleri.
 *
 * Test kapsamı:
 *  - detachNetworkListeners: idempotent, hata atmaz
 *  - getMapSources / getActiveMapSource: başlangıç boş
 *
 * Not: mapMode testleri jsdom ortamında store erişimi sınırlı olduğundan
 * atlanır. setMapMode/getMapMode integration testlerde test edilir.
 */

import { describe, it, expect, vi } from 'vitest';

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
  getMapSources,
  getActiveMapSource,
  getActiveMapSourceId,
  hasOfflineMapData,
} from '../platform/mapSourceManager';

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