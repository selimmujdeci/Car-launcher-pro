/**
 * deviceAutoPair.test.ts — boot-time otomatik eşleştirme (ensureDeviceRegistered).
 *
 * SORUN (saha/geliştirme fazı): eşlenmemiş cihaz hiçbir tanı/telemetri
 * gönderemiyordu — "Tanı Gönder" not_paired dönüyor, pushVehicleEvent
 * api_key yok diye event düşürüyor, admin tablosu boş kalıyordu. registerVehicle
 * yalnızca elle "Mobil Bağlantı"dan çağrılıyordu; kullanıcı eşleştirmezse
 * uzak tanı ölü.
 *
 * KİLİT: ensureDeviceRegistered boot'ta bir kez sessiz self-pair yapar →
 * cihaz api_key alınca MEVCUT hat (pushVehicleEvent → RPC → vehicle_events)
 * sunucu değişikliği olmadan uçtan uca akar.
 *
 * Kapsam:
 *  - Eşlenmemiş cihaz → register_vehicle çağrılır, api_key saklanır, eşli olur
 *  - Zaten eşli → register_vehicle ÇAĞRILMAZ (idempotent, linking code yok)
 *  - Offline/RPC hatası → false; guard sıfırlanır, sonraki boot yeniden dener
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  store: new Map<string, string>(),
}));

vi.mock('../platform/sensitiveKeyStore', () => ({
  sensitiveKeyStore: {
    get: vi.fn(async (k: string) => M.store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { M.store.set(k, v); }),
    remove: vi.fn(async (k: string) => { M.store.delete(k); }),
  },
}));

vi.mock('../platform/connectivityService', () => ({
  connectivityService: { enqueue: vi.fn(async () => {}) },
}));

function okRegisterFetch() {
  return vi.fn(async (url: string) => {
    if (String(url).includes('/rpc/register_vehicle')) {
      return { ok: true, json: async () => ({ vehicle_id: 'veh-123', api_key: 'auto_key_xyz' }) };
    }
    return { ok: false, json: async () => ({ message: 'unexpected_rpc' }) };
  });
}

beforeEach(() => {
  vi.resetModules();       // taze modül state (_apiKey / _autoPairTried sıfır)
  M.store = new Map();
  vi.stubGlobal('fetch', okRegisterFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ensureDeviceRegistered — boot-time self-pair', () => {
  it("ön koşul: Supabase env gömülü (yoksa self-pair no-op olur)", async () => {
    const vis = await import('../platform/vehicleIdentityService');
    expect(vis.getVehicleEventPipelineStatus().configured).toBe(true);
  });

  it('eşlenmemiş cihaz self-pair olur → api_key saklanır, isDevicePaired true', async () => {
    const vis = await import('../platform/vehicleIdentityService');
    expect(await vis.isDevicePaired()).toBe(false);

    const ok = await vis.ensureDeviceRegistered();

    expect(ok).toBe(true);
    expect(await vis.isDevicePaired()).toBe(true);
    expect(M.store.get('veh_api_key')).toBe('auto_key_xyz');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('zaten eşliyse register_vehicle ÇAĞRILMAZ (idempotent)', async () => {
    M.store.set('veh_api_key', 'existing_key');
    const vis = await import('../platform/vehicleIdentityService');

    const ok = await vis.ensureDeviceRegistered();

    expect(ok).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('offline (RPC hatası) → false, api_key saklanmaz, tekrar denenebilir', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const vis = await import('../platform/vehicleIdentityService');

    const ok1 = await vis.ensureDeviceRegistered();
    expect(ok1).toBe(false);
    expect(await vis.isDevicePaired()).toBe(false);

    // guard sıfırlandı → ikinci boot yeniden dener (fetch tekrar çağrılır)
    const ok2 = await vis.ensureDeviceRegistered();
    expect(ok2).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('self-pair sonrası pushVehicleEvent artık düşürmez (uçtan uca)', async () => {
    const vis = await import('../platform/vehicleIdentityService');
    const { connectivityService } = await import('../platform/connectivityService');

    await vis.ensureDeviceRegistered();
    await vis.pushVehicleEvent('support_snapshot', { source: 'dev_inspector' });

    expect(connectivityService.enqueue).toHaveBeenCalledTimes(1);
    const body = (connectivityService.enqueue as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0][3] as Record<string, unknown>;
    expect(body.p_api_key).toBe('auto_key_xyz');
    expect(body.p_type).toBe('support_snapshot');
    expect(vis.getVehicleEventPipelineStatus().droppedNoKeyCount).toBe(0);
  });
});
