import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { aiPostJson, isNativeHttpAvailable } from '../platform/ai/nativeHttp';

/* #699 — Anthropic CORS duvarı: cihazda ÖLÇÜLDÜ (2026-08-22)
 *   fetch  → THROW "Failed to fetch"  (HTTP durumu bile oluşmuyor)
 *   native → 401 {"error":{"message":"x-api-key header is required"}}
 * Kullanıcının anahtarı GEÇERLİYKEN (sk-ant…, 108 karakter) Haiku halkası bu
 * yüzden hiç çalışmıyordu. Bu testler taşıma sözleşmesini KİLİTLER. */

interface CapStub { isNativePlatform: () => boolean; Plugins: { CapacitorHttp?: unknown } }
function setCapacitor(v: CapStub | undefined): void {
  (globalThis as unknown as { Capacitor?: CapStub }).Capacitor = v;
}

describe('nativeHttp — AI taşıma katmanı (#699)', () => {
  beforeEach(() => { setCapacitor(undefined); });
  afterEach(() => { setCapacitor(undefined); vi.unstubAllGlobals(); });

  it('native YOKKEN fetch kullanılır (tarayıcı/dev davranışı AYNEN korunur)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ hi: 1 }) });
    vi.stubGlobal('fetch', fetchSpy);

    expect(isNativeHttpAvailable()).toBe(false);
    const r = await aiPostJson('https://api.anthropic.com/v1/messages', { 'x-api-key': 'k' }, { a: 1 }, 5000);
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ hi: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Gövde JSON olarak serileştirilir, başlıklar korunur
    const init = fetchSpy.mock.calls[0][1] as { body: string; headers: Record<string, string> };
    expect(JSON.parse(init.body)).toEqual({ a: 1 });
    expect(init.headers['x-api-key']).toBe('k');
  });

  it('native VARKEN CapacitorHttp kullanılır ve fetch HİÇ çağrılmaz (CORS duvarı aşılır)', async () => {
    const request = vi.fn().mockResolvedValue({ status: 401, data: { error: { message: 'x-api-key header is required' } } });
    setCapacitor({ isNativePlatform: () => true, Plugins: { CapacitorHttp: { request } } });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(isNativeHttpAvailable()).toBe(true);
    const r = await aiPostJson('https://api.anthropic.com/v1/messages', { 'x-api-key': 'k' }, { a: 1 }, 4500);
    expect(fetchSpy).not.toHaveBeenCalled();          // CORS'a giden yol KAPALI
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);                        // gerçek HTTP durumu geliyor
    // Süre bütçesi native alanlara taşınır (AbortSignal native isteği kesmez)
    expect(request.mock.calls[0][0]).toMatchObject({ connectTimeout: 4500, readTimeout: 4500, method: 'POST' });
  });

  it('native gövdeyi STRING döndürse de json() aynı sözleşmeyi verir', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, data: '{"ok":true}' });
    setCapacitor({ isNativePlatform: () => true, Plugins: { CapacitorHttp: { request } } });
    const r = await aiPostJson('https://x', {}, {}, 1000);
    expect(await r.json()).toEqual({ ok: true });
  });

  it('native platform DEĞİLSE eklenti kayıtlı olsa bile fetch kullanılır', async () => {
    const request = vi.fn();
    setCapacitor({ isNativePlatform: () => false, Plugins: { CapacitorHttp: { request } } });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchSpy);
    await aiPostJson('https://x', {}, {}, 1000);
    expect(request).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('native throw ederse fetch\'e DÜŞÜLMEZ (sessiz çift istek + çift fatura yasak)', async () => {
    const request = vi.fn().mockRejectedValue(new Error('native down'));
    setCapacitor({ isNativePlatform: () => true, Plugins: { CapacitorHttp: { request } } });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(aiPostJson('https://x', {}, {}, 1000)).rejects.toThrow('native down');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
