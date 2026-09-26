/**
 * queueNoSecrets.test — çevrimdışı kuyruk diske SIR yazmaz.
 *
 * 2026-09-25 (CodeQL js/clear-text-storage incelemesi): araç API anahtarı
 * `p_api_key` gövdeye konup kuyruk IndexedDB'ye DÜZ METİN yazılıyordu. Artık
 * gövdede yer tutucu durur; gerçek değer yalnız gönderim anında çözülür,
 * çözülemezse istek GİTMEZ ve kuyrukta bekler.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus:   vi.fn(async () => ({ connected: true })),
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
  },
}));
vi.mock('../platform/debug', () => ({ logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));

import {
  connectivityService, VEHICLE_API_KEY_SLOT, setQueueVehicleApiKeyResolver,
} from '../platform/connectivityService';

/** Bellek içi IndexedDB — yazılan kayıtlar `data` üzerinden OKUNABİLİR. */
function installFakeIDB(): Map<string, { id: string; body: string }> {
  const data = new Map<string, { id: string; body: string }>();
  const makeStore = () => ({
    createIndex: () => {},
    getAll: () => {
      const req: Record<string, unknown> = { result: undefined, onsuccess: null, onerror: null };
      queueMicrotask(() => { req.result = [...data.values()]; (req.onsuccess as (() => void) | null)?.(); });
      return req;
    },
    put:    (e: { id: string; body: string }) => { data.set(e.id, JSON.parse(JSON.stringify(e))); },
    delete: (id: string) => { data.delete(id); },
  });
  const makeTx = () => {
    const tx: Record<string, unknown> = { objectStore: () => makeStore(), oncomplete: null, onerror: null };
    queueMicrotask(() => { (tx.oncomplete as (() => void) | null)?.(); });
    return tx;
  };
  const db = { createObjectStore: () => makeStore(), transaction: () => makeTx(), close: () => {}, onclose: null, onversionchange: null };
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open: () => {
      const req: Record<string, unknown> = { result: db, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => { (req.onupgradeneeded as (() => void) | null)?.(); (req.onsuccess as (() => void) | null)?.(); });
      return req;
    },
  };
  return data;
}

async function flush(n = 16): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

const URL = 'https://x.test/rest/v1/rpc/push_vehicle_event';
let idb: Map<string, { id: string; body: string }>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  idb = installFakeIDB();
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '"ok"' }));
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  await connectivityService.init();
});
afterEach(() => {
  connectivityService.destroy();
  setQueueVehicleApiKeyResolver(null);
  idb.clear();
  vi.restoreAllMocks();
});

describe('kuyrukta sır yok', () => {
  it('🔒 diske yazılan kayıtta anahtar YOK; gönderimde gerçek anahtar eklenir', async () => {
    setQueueVehicleApiKeyResolver(async () => 'veh_SECRET_123');
    fetchMock.mockImplementationOnce(async () => { throw new Error('ağ yok'); });   // ilk deneme düşsün → kayıt diskte kalsın
    await connectivityService.enqueue(URL, 'POST', {}, { p_api_key: VEHICLE_API_KEY_SLOT, p_type: 't' }, 'normal', 'telemetry');
    await flush();
    const stored = [...idb.values()].map((e) => e.body).join('|');
    expect(stored).toContain(VEHICLE_API_KEY_SLOT);
    expect(stored).not.toContain('veh_SECRET_123');
    const sent = String((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(sent).toContain('"p_api_key":"veh_SECRET_123"');
    expect(sent).not.toContain(VEHICLE_API_KEY_SLOT);
  });

  it('🔒 anahtar çözülemezse istek GİTMEZ ve kuyrukta bekler (sahte başarı yok)', async () => {
    setQueueVehicleApiKeyResolver(async () => null);
    await connectivityService.enqueue(URL, 'POST', {}, { p_api_key: VEHICLE_API_KEY_SLOT }, 'normal', 'telemetry');
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await connectivityService.queueSize()).toBe(1);
  });

  it('yer tutucusuz gövde değişmeden gider', async () => {
    await connectivityService.enqueue(URL, 'POST', {}, { p: 1 }, 'normal', 'telemetry');
    await flush();
    expect(String((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toBe('{"p":1}');
  });
});
