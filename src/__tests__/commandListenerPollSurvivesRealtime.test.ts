/**
 * KİLİT — Komut yoklaması realtime aboneliğinden BAĞIMSIZ yaşar (2026-09-12).
 *
 * Saha kusuru: aynı topic'li kanal istemcide kayıtlı kalınca realtime-js
 * `channel(topic)` MEVCUT kanalı döndürür ve `.on()` "cannot add
 * `postgres_changes` callbacks … after `subscribe()`" fırlatır. `connect()`
 * bu istisnada ölüyor, `startPolling()` hiç çağrılmıyordu → head-unit
 * komutları TTL dolana dek `pending` kalıyordu (telemetri çalışırken).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  rpcCalls: [] as string[],
  onThrows: false,
  removed:  [] as string[],
}));

vi.mock('../platform/vehicleIdentityService', () => ({
  callVehicleRpc: vi.fn(async (fn: string) => { M.rpcCalls.push(fn); return fn === 'fetch_pending_vehicle_commands' ? [] : { ok: true }; }),
  updateRemoteCommandStatus: vi.fn(async () => {}),
}));

vi.mock('../platform/commandCrypto', () => ({
  loadOrCreateDeviceKey: vi.fn(async () => ({ pubKeyB64: 'TEST' })),
  getCarPrivateKey: vi.fn(() => null),
  isE2EPayload: vi.fn(() => false),
  isEncryptedPayload: vi.fn(() => false),
  decryptE2EPayload: vi.fn(async () => ({})),
  decryptPayload: vi.fn(async () => ({})),
}));

vi.mock('../platform/supabaseClient', () => {
  const makeChannel = (topic: string) => {
    const ch = {
      topic: `realtime:${topic}`,
      on: () => {
        if (M.onThrows) throw new Error(`cannot add \`postgres_changes\` callbacks for realtime:${topic} after \`subscribe()\`.`);
        return ch;
      },
      subscribe: () => ch,
    };
    return ch;
  };
  const channels: Array<{ topic: string }> = [];
  const client = {
    channel: (topic: string) => {
      const ex = channels.find((c) => c.topic === `realtime:${topic}`);
      if (ex) return ex;
      const ch = makeChannel(topic); channels.push(ch); return ch;
    },
    getChannels: () => channels,
    removeChannel: async (ch: { topic: string }) => {
      M.removed.push(ch.topic);
      /* Sahadaki kusur: unsubscribe 'ok' dönmez → kanal KAYITLI KALIR. */
      return 'error';
    },
  };
  return { getSupabaseClient: () => client };
});

describe('CommandListener · yoklama realtime hatasında da başlar', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); M.rpcCalls = []; M.removed = []; M.onThrows = false; });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('KİLİT: `.on()` fırlatsa bile connect() ölmez ve periyodik yoklama kurulur', async () => {
    const mod = await import('../platform/commandListener');
    const listener = new mod.CommandListener('veh-hu');

    /* İlk bağlantı: kanal kaydedilir. */
    await listener.connect();
    /* İkinci bağlantı (reconnect): aynı topic kayıtlı → gerçek realtime-js `.on()` fırlatır. */
    M.onThrows = true;
    await expect(listener.connect()).resolves.toBeUndefined();

    /* Takılı kanal önce SÖKÜLMEYE çalışıldı (yeniden kullanılmadı). */
    expect(M.removed).toContain('realtime:vehicle-cmds:veh-hu');

    const before = M.rpcCalls.filter((f) => f === 'fetch_pending_vehicle_commands').length;
    await vi.advanceTimersByTimeAsync(15_000 * 2 + 100);
    const after = M.rpcCalls.filter((f) => f === 'fetch_pending_vehicle_commands').length;
    /* Yoklama timer'ı canlı: 30 sn içinde en az 2 yeni çekme. */
    expect(after - before).toBeGreaterThanOrEqual(2);

    listener.disconnect();
  });
});
