/**
 * Rota headers zaman aşımı (2026-09-27): 2 sn yavaş mobil veride sağlıklı
 * sunucuyu düşürüyordu → ilk sunucu 4 sn bekler; zincirde ıskalamadan sonra
 * sonraki sunucular eski 2 sn fail-fast ile denenir (ölü ağ bütçesi korunur).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../platform/offlineRoutingService', () => ({
  tryLocalDaemon: vi.fn(() => Promise.resolve(null)),
  computeOfflineRoute: vi.fn(() => Promise.resolve(null)),
  straightLineRoute: vi.fn((fromLat: number, fromLon: number, toLat: number, toLon: number) => ({
    geometry: [[fromLon, fromLat], [toLon, toLat]] as [number, number][],
    distanceM: 1000, durationS: 60, steps: [], source: 'straight-line',
  })),
}));
vi.mock('../platform/bridge', () => ({ isNative: false }));
vi.mock('../platform/ttsService', () => ({ speakNavigation: vi.fn() }));

import { fetchRoute, clearRoute } from '../platform/routingService';

/** Abort sinyaline uyan, kendiliğinden hiç dönmeyen fetch. */
function hangingFetch(_url: string, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_res, rej) => {
    init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
  });
}

describe('rota headers zaman aşımı', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(hangingFetch));
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
  });

  afterEach(() => {
    clearRoute();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ilk sunucu 2 sn\'de DÜŞÜRÜLMEZ, 4 sn bekler; sonraki sunucu 2 sn fail-fast', async () => {
    const p = fetchRoute(36.80, 34.60, 36.80, 34.64);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_999);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);   // eski 2 sn sınırı artık yok

    await vi.advanceTimersByTimeAsync(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);   // 4 sn → sonraki sunucu

    await vi.advanceTimersByTimeAsync(2_000);            // ikinci sunucu 2 sn'de kesilir
    await p;                                             // zincir biter (offline/düz hat)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });
});
