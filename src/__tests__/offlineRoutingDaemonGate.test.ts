/**
 * Katman 0 (localhost:5000 native OSRM daemon) — native tarafı YOK (2026-09-27):
 * native platformda bile yoklama isteği atılmaz; oturumun ilk rotası boş
 * localhost isteğini beklemez.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@capacitor/core', async (orig) => {
  const m = await orig<typeof import('@capacitor/core')>();
  return { ...m, Capacitor: { ...m.Capacitor, isNativePlatform: () => true } };
});

import { tryLocalDaemon, LOCAL_DAEMON_NATIVE_SUPPORT } from '../platform/offlineRoutingService';

afterEach(() => { vi.unstubAllGlobals(); });

describe('Katman 0 — native daemon yok', () => {
  it('native platformda localhost:5000\'e istek ATILMAZ', async () => {
    const f = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')));
    vi.stubGlobal('fetch', f);
    expect(LOCAL_DAEMON_NATIVE_SUPPORT).toBe(false);
    await expect(tryLocalDaemon(34.60, 36.80, 34.64, 36.80)).resolves.toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
