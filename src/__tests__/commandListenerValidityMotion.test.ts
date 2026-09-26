/**
 * commandListenerValidityMotion.test.ts — MRI N-7 + F-03, uzak komut ZİNCİRİ
 * düzeyinde (gerçek `CommandListener.handleCommand`, sahte RPC/kripto/MCU).
 *
 * Kilitlenen davranışlar:
 *   N-7 · TTL kararı SUNUCU saatiyle verilir (head-unit saati sapmış olsa da)
 *       · decrypt'e sunucu saati + satırın `created_at`'i taşınır
 *       · `crypto_failed` → `failed` + gerçek gerekçe; retry YOK
 *       · aynı komut kimliği ikinci kez → ikinci icra YOK (executedIds)
 *   F-03 · hareket UNKNOWN → unlock `rejected` (motion_unverified), MCU çağrısı YOK
 *        · doğrulanmış duruyor → unlock icra edilir
 *        · lock politika `any` → hareket kapısına takılmaz
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

const M = vi.hoisted(() => ({
  statuses:   [] as Array<{ id: string; status: string; reason?: string }>,
  mcuCalls:   [] as string[],
  decryptOpts: [] as unknown[],
  snapshot:   {
    obdSpeedFreshKmh: null as number | null, obdConnected: false, obdLastSeenMs: 0, obdFreshWindowMs: 0,
    gpsSpeedMps: null as number | null, gpsAccuracyM: null as number | null, gpsFixAtMs: null as number | null,
    reverseSignal: false, ignition: 'unknown',
  },
  serverNow: null as number | null,
}));

vi.mock('../platform/vehicleIdentityService', () => ({
  callVehicleRpc: vi.fn(async () => []),
  updateRemoteCommandStatus: vi.fn(async (id: string, status: string, reason?: string) => {
    M.statuses.push({ id, status, reason });
  }),
}));

vi.mock('../platform/commandCrypto', () => ({
  loadOrCreateDeviceKey: vi.fn(async () => ({ pubKeyB64: 'TEST' })),
  getCarPrivateKey: vi.fn(() => ({} as CryptoKey)),
  isE2EPayload: vi.fn((p: unknown) => !!p && typeof p === 'object' && (p as { type?: string }).type === 'ecdh_v1'),
  isEncryptedPayload: vi.fn(() => false),
  decryptE2EPayload: vi.fn(async (p: { fail?: string }, _k: unknown, opts: unknown) => {
    M.decryptOpts.push(opts);
    if (p.fail) throw new Error(p.fail);
    return {};
  }),
  decryptPayload: vi.fn(async () => ({})),
}));

vi.mock('../platform/nativeCommandBridge', () => ({
  executeMcuCommand: vi.fn(async (type: string) => { M.mcuCalls.push(type); return 'completed'; }),
  checkCrossChannelNonceReplay: vi.fn(async () => undefined),
}));

vi.mock('../platform/assistant/maviVehicleSnapshotSource', () => ({
  captureMaviVehicleSnapshot: vi.fn(() => M.snapshot),
}));

vi.mock('../platform/serverClock', () => ({
  getServerNowMs: vi.fn(() => M.serverNow),
}));

vi.mock('../platform/supabaseClient', () => ({ getSupabaseClient: () => null }));

type Listener = {
  handleCommand: (cmd: Record<string, unknown>) => Promise<void>;
  _alive: boolean;
};

async function makeListener(): Promise<Listener> {
  const mod = await import('../platform/commandListener');
  const l = new mod.CommandListener('veh-1') as unknown as Listener;
  l._alive = true;
  return l;
}

function cmd(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const now = Date.now();
  return {
    id: 'cmd-1', vehicle_id: 'veh-1', type: 'unlock', status: 'pending', nonce: 'n1',
    ttl: new Date(now + 5 * 60_000).toISOString(),
    created_at: new Date(now - 2_000).toISOString(),
    payload: { type: 'ecdh_v1', eph_pub: 'a', iv: 'b', data: 'c', ts: now - 2_000 },
    ...over,
  };
}

describe('CommandListener · geçerlilik (N-7) ve hareket (F-03)', () => {
  /* Isınma: commandListener grafı ilk transform'da ~13–15 s sürer (HEAD'de de);
     paralel koşuda 20 s test sınırına çarpmasın diye tek sefer, uzun sınırla. */
  beforeAll(async () => { await import('../platform/commandListener'); }, 180_000);
  beforeEach(() => {
    vi.resetModules();
    M.statuses = []; M.mcuCalls = []; M.decryptOpts = []; M.serverNow = null;
    M.snapshot = {
      obdSpeedFreshKmh: null, obdConnected: false, obdLastSeenMs: 0, obdFreshWindowMs: 0,
      gpsSpeedMps: null, gpsAccuracyM: null, gpsFixAtMs: null, reverseSignal: false, ignition: 'unknown',
    };
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('F-03: hareket UNKNOWN → unlock REJECTED, MCU\'ya HİÇ gidilmez, gerekçe telefona yazılır', async () => {
    const l = await makeListener();
    await l.handleCommand(cmd());
    expect(M.mcuCalls).toEqual([]);
    const last = M.statuses.at(-1)!;
    expect(last.status).toBe('rejected');
    expect(last.reason).toContain('doğrulanamadı');
  });

  it('F-03: OBD taze 0 km/h (doğrulanmış duruyor) → unlock icra edilir', async () => {
    const now = Date.now();
    M.snapshot = { ...M.snapshot, obdSpeedFreshKmh: 0, obdConnected: true, obdLastSeenMs: now, obdFreshWindowMs: 10_000, ignition: 'on' };
    const l = await makeListener();
    await l.handleCommand(cmd());
    expect(M.mcuCalls).toEqual(['unlock']);
    expect(M.statuses.at(-1)!.status).toBe('completed');
  });

  it('F-03: OBD taze 40 km/h → unlock REJECTED (vehicle_moving)', async () => {
    const now = Date.now();
    M.snapshot = { ...M.snapshot, obdSpeedFreshKmh: 40, obdConnected: true, obdLastSeenMs: now, obdFreshWindowMs: 10_000, ignition: 'on' };
    const l = await makeListener();
    await l.handleCommand(cmd());
    expect(M.mcuCalls).toEqual([]);
    expect(M.statuses.at(-1)!.reason).toContain('hareket hâlinde');
  });

  it('F-03/16: lock politikası `any` → hareket UNKNOWN olsa da icra edilir (Mavi tablosuyla aynı)', async () => {
    const l = await makeListener();
    await l.handleCommand(cmd({ id: 'cmd-lock', type: 'lock' }));
    expect(M.mcuCalls).toEqual(['lock']);
  });

  it('N-7: decrypt\'e SUNUCU saati ve satırın created_at\'i taşınır', async () => {
    const now = Date.now();
    M.serverNow = now + 90_000;   // head-unit 90 s geride varsayalım → sunucu ileride
    M.snapshot = { ...M.snapshot, obdSpeedFreshKmh: 0, obdConnected: true, obdLastSeenMs: now, obdFreshWindowMs: 10_000 };
    const l = await makeListener();
    const c = cmd();
    await l.handleCommand(c);
    const opts = M.decryptOpts[0] as { validity: { serverNowMs: number; rowCreatedAtMs: number } };
    expect(opts.validity.serverNowMs).toBe(now + 90_000);
    expect(opts.validity.rowCreatedAtMs).toBe(Date.parse(c.created_at as string));
  });

  it('N-7/3: head-unit saati 4 dk İLERİDE → TTL sunucu saatiyle ölçülür, komut "TTL aşıldı" DEMEZ', async () => {
    const trueNow = Date.now();
    M.serverNow = trueNow;
    M.snapshot = { ...M.snapshot, obdSpeedFreshKmh: 0, obdConnected: true, obdLastSeenMs: trueNow + 4 * 60_000, obdFreshWindowMs: 10_000 };
    const huClock = vi.spyOn(Date, 'now').mockReturnValue(trueNow + 4 * 60_000);
    try {
      const l = await makeListener();
      await l.handleCommand(cmd({ ttl: new Date(trueNow + 3 * 60_000).toISOString() }));   // yerel saate göre "dolmuş"
      expect(M.statuses.some((s) => s.reason === 'TTL aşıldı')).toBe(false);
      expect(M.mcuCalls).toEqual(['unlock']);
    } finally { huClock.mockRestore(); }
  });

  it('N-7/4: sunucu saatine göre GERÇEKTEN dolmuş TTL → failed "TTL aşıldı", icra yok', async () => {
    const now = Date.now();
    M.serverNow = now + 10 * 60_000;
    const l = await makeListener();
    await l.handleCommand(cmd());
    expect(M.mcuCalls).toEqual([]);
    expect(M.statuses.at(-1)).toMatchObject({ status: 'failed', reason: 'TTL aşıldı' });
  });

  it('N-7/5,8: crypto reddi → failed + gerçek gerekçe, RETRY yok, ikinci teslimat icra ETMEZ', async () => {
    const now = Date.now();
    M.snapshot = { ...M.snapshot, obdSpeedFreshKmh: 0, obdConnected: true, obdLastSeenMs: now, obdFreshWindowMs: 10_000 };
    const l = await makeListener();
    const c = cmd({ payload: { type: 'ecdh_v1', eph_pub: 'a', iv: 'b', data: 'c', ts: now, fail: 'Replay Attack: nonce already used' } });
    await l.handleCommand(c);
    expect(M.mcuCalls).toEqual([]);
    expect(M.statuses.at(-1)).toMatchObject({ status: 'failed' });
    expect(M.statuses.at(-1)!.reason).toContain('Replay Attack');
    const before = M.statuses.length;
    await l.handleCommand(c);          // aynı id ikinci kez (duplicate delivery)
    expect(M.mcuCalls).toEqual([]);
    expect(M.statuses.length).toBe(before);   // executedIds: tekrar işlenmedi
  });

  it('N-7/6: aynı komut iki kez teslim edilirse fiziksel icra BİR kez', async () => {
    const now = Date.now();
    M.snapshot = { ...M.snapshot, obdSpeedFreshKmh: 0, obdConnected: true, obdLastSeenMs: now, obdFreshWindowMs: 10_000 };
    const l = await makeListener();
    const c = cmd();
    await l.handleCommand(c);
    await l.handleCommand(c);
    expect(M.mcuCalls).toEqual(['unlock']);
  });
});
