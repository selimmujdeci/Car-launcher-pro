/**
 * commandService.test.ts — Entegrasyon Testleri
 *
 * (a) Rota Gönderim Başarısı
 * (b) Offline Komut Zaman Aşımı
 * (c) Yetkisiz Erişim Reddi
 * (d) Koordinat Sınır Kontrolü
 * (e) TTL koruması
 * (f) Nonce idempotency
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as commandService from '../lib/commandService';
import * as routeEngine from '../lib/routeEngine';

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const channel = {
    on:          vi.fn(),
    subscribe:   vi.fn(),
    unsubscribe: vi.fn(),
  };
  const supabase = {
    auth: {
      getSession: vi.fn(),
      getUser:    vi.fn(),
    },
    from:          vi.fn(),
    rpc:           vi.fn(),
    channel:       vi.fn(),
    removeChannel: vi.fn(),
  };
  const ensurePwaSession = vi.fn(async () => 'test-access-token');
  return { channel, supabase, ensurePwaSession };
});

const mockChannel  = mocks.channel;
const mockSupabase = mocks.supabase;
const cleanupPolicy = vi.hoisted(() => ({
  evaluate: vi.fn<() =>
    | { allowed: true; generation: number }
    | { allowed: false; code: 'LOCKDOWN_ACTIVE' | 'RUNTIME_UNAVAILABLE' }
  >(() => ({ allowed: true, generation: 1 })),
}));

vi.mock('../lib/supabase', () => ({
  supabaseBrowser:      mocks.supabase,
  isSupabaseConfigured: true,
  /* PWA oturumu tek giriş noktasından alınır (#giriş-yok kararı): burada
     oturum HAZIR varsayılır — bu dosyanın kilitleri RLS ve TTL davranışıdır,
     oturumun nasıl elde edildiği `supabase.ts`in konusudur. */
  ensurePwaSession:     mocks.ensurePwaSession,
}));

vi.mock('../security/accountCleanup/accountCleanupRuntime', () => ({
  evaluateAccountScopedCapability: cleanupPolicy.evaluate,
}));

/* #672: `sendCommand` artık E2E gerektiren komutlarda (lock/unlock/...) araç
   public key'ini okuyup `ecdh_v1` zarfı üretiyor. BU DOSYANIN kilitleri RLS ve
   TTL davranışını korur — şifreleme onların konusu değil, yalnız önlerine
   geçen bir adım. Şifreleme başarılı VARSAYILIR; asıl kural aynen test edilir.
   E2E zarfının kendisi `e2eCommandCrypto.test.ts`te parite kilitleriyle
   doğrulanır. */
vi.mock('@/lib/e2eCommandCrypto', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchCarPublicKey: vi.fn(async () => ({ ok: true, publicKey: 'dGVzdC1rZXk=' })),
  encryptE2EPayload: vi.fn(async () => ({
    type: 'ecdh_v1', eph_pub: 'ZQ==', iv: 'aXY=', data: 'ZGF0YQ==', ts: Date.now(),
  })),
}));

// ── Test yardımcıları ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensurePwaSession.mockResolvedValue('test-access-token');
  cleanupPolicy.evaluate.mockReturnValue({ allowed: true, generation: 1 });
  mockSupabase.auth.getSession.mockResolvedValue({
    data: { session: { access_token: 'test-access-token' } },
  });
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'user-123' } },
  });
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
  mockChannel.on.mockReturnValue(mockChannel);
  mockChannel.subscribe.mockImplementation((cb?: (status: string) => void) => {
    cb?.('SUBSCRIBED');
    return mockChannel;
  });
  mockSupabase.channel.mockReturnValue(mockChannel);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('account cleanup lockdown', () => {
  it('Supabase/API-key yolunu başlatmadan komutu reddeder', async () => {
    cleanupPolicy.evaluate.mockReturnValue({
      allowed: false,
      code: 'LOCKDOWN_ACTIVE',
    });

    const result = await commandService.sendCommand('vehicle-1', 'horn', {});

    expect(result).toMatchObject({
      ok: false,
      code: 'ACCOUNT_CLEANUP_LOCKDOWN',
    });
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockSupabase.auth.getSession).not.toHaveBeenCalled();
  });

  it('lockdown sırasında command status subscription başlatmaz', () => {
    cleanupPolicy.evaluate.mockReturnValue({
      allowed: false,
      code: 'LOCKDOWN_ACTIVE',
    });

    const unsubscribe = commandService.subscribeCommandStatus(
      'command-1',
      vi.fn(),
    );

    expect(mockSupabase.channel).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });
});

function makeInsertChain(overrides: Partial<{ data: unknown; error: unknown }> = {}) {
  const chain = {
    data:   overrides.data   ?? { id: 'cmd-uuid-001' },
    error:  overrides.error  ?? null,
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: overrides.data ?? { id: 'cmd-uuid-001' }, error: overrides.error ?? null }),
  };
  return chain;
}

function makeSelectChain(overrides: Partial<{ count: number; data: unknown[]; error: unknown }> = {}) {
  const result = {
    data:  overrides.data  ?? [],
    count: overrides.count ?? 0,
    error: overrides.error ?? null,
  };
  return {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    // commandService.isVehicleOnline zinciri `.gte(...)` üzerinde await edilir.
    gte:    vi.fn().mockResolvedValue(result),
    gt:     vi.fn().mockReturnThis(),
    order:  vi.fn().mockReturnThis(),
    limit:  vi.fn().mockResolvedValue(result),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// (a) Rota Gönderim Başarısı
// ═══════════════════════════════════════════════════════════════════════════

describe('(a) Rota Gönderim Başarısı', () => {
  it('Geçerli koordinatlar ile route_send komutu gönderir', async () => {
    const insertChain = makeInsertChain({ data: { id: 'cmd-001' } });
    const locChain    = makeSelectChain({ count: 1 }); // araç online
    const routeInsert = makeInsertChain();

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'vehicle_telemetry') return locChain;
      if (table === 'vehicle_commands')  return insertChain;
      if (table === 'route_commands')    return routeInsert;
      return {};
    });

    const { result } = await routeEngine.sendRoute({
      vehicleId:   'vehicle-001',
      lat:          41.015137,
      lng:          28.979530,
      addressName: 'Taksim Meydanı, İstanbul',
      provider:    'google_maps',
    });

    expect(result.ok).toBe(true);
    expect(result.commandId).toBe('cmd-001');
    expect(result.queued).toBe(false); // araç online
    expect(mockSupabase.from).toHaveBeenCalledWith('vehicle_commands');
    expect(mockSupabase.from).toHaveBeenCalledWith('route_commands');
  });

  it('Araç offline iken komut sıraya alınır (queued: true)', async () => {
    const insertChain = makeInsertChain({ data: { id: 'cmd-002' } });
    const locChain    = makeSelectChain({ count: 0 }); // araç offline
    const routeInsert = makeInsertChain();

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'vehicle_telemetry') return locChain;
      if (table === 'vehicle_commands')  return insertChain;
      if (table === 'route_commands')    return routeInsert;
      return {};
    });

    const { result } = await routeEngine.sendRoute({
      vehicleId:   'vehicle-001',
      lat:          41.015137,
      lng:          28.979530,
      addressName: 'Kadıköy, İstanbul',
    });

    expect(result.ok).toBe(true);
    expect(result.queued).toBe(true); // offline flag
  });

  it('Google Maps intent URI doğru oluşturulur', () => {
    const uri = routeEngine.buildNavIntent(41.015, 28.979, 'Taksim', 'google_maps');
    expect(uri).toContain('geo:41.015,28.979');
    expect(uri).toContain('Taksim');
  });

  it('Waze intent URI doğru oluşturulur', () => {
    const uri = routeEngine.buildNavIntent(41.015, 28.979, 'Test', 'waze');
    expect(uri).toContain('waze://?ll=41.015,28.979');
    expect(uri).toContain('navigate=yes');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (b) Offline Komut Zaman Aşımı
// ═══════════════════════════════════════════════════════════════════════════

describe('(b) Offline Komut Zaman Aşımı', () => {
  it('subscribeCommandStatus, timeoutMs geçince expired döndürür', async () => {
    vi.useFakeTimers();
    const events: commandService.StatusEvent[] = [];

    // Realtime güncellemesi YOLLAMIYORUZ — sadece timeout bekliyoruz
    commandService.subscribeCommandStatus(
      'cmd-timeout-test',
      (ev) => events.push(ev),
      3_000,
    );

    vi.advanceTimersByTime(3_001);

    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('expired');
    expect(events[0].commandId).toBe('cmd-timeout-test');

    vi.useRealTimers();
  });

  it('Terminal status gelince cleanup tetiklenir ve timeout iptal olur', async () => {
    vi.useFakeTimers();
    const events: commandService.StatusEvent[] = [];
    let capturedCallback: ((arg: { new: Record<string, unknown> }) => void) | null = null;

    mockChannel.on.mockImplementation((_ev: string, _filter: unknown, cb: (arg: { new: Record<string, unknown> }) => void) => {
      capturedCallback = cb;
      return mockChannel;
    });

    const unsubscribe = commandService.subscribeCommandStatus(
      'cmd-terminal',
      (ev) => events.push(ev),
      10_000,
    );

    // Realtime 'completed' eventi simüle et
    (capturedCallback as ((arg: { new: Record<string, unknown> }) => void) | null)?.({ new: { status: 'completed' } });

    // 10s ileri sar — timeout gelmemeli
    vi.advanceTimersByTime(10_001);

    // Sadece 1 event (completed), expired gelmemiş
    const statuses = events.map((e) => e.status);
    expect(statuses).toContain('completed');
    expect(statuses).not.toContain('expired');

    unsubscribe();
    vi.useRealTimers();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (c) Yetkisiz Erişim Reddi
// ═══════════════════════════════════════════════════════════════════════════

describe('(c) Yetkisiz Erişim Reddi', () => {
  it('Supabase RLS hatası dönünce sendCommand ok:false döndürür', async () => {
    const errorChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data:  null,
        error: { message: 'new row violates row-level security policy' },
      }),
    };
    const locChain = makeSelectChain({ count: 1 });

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'vehicle_telemetry') return locChain;
      return errorChain;
    });

    const result = await commandService.sendCommand('unauthorized-vehicle', 'lock');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('row-level security');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (d) Koordinat Sınır Kontrolü (Sensor Resiliency)
// ═══════════════════════════════════════════════════════════════════════════

describe('(d) Koordinat Sınır Kontrolü', () => {
  it('Enlem > 90 reddedilir', async () => {
    await expect(
      routeEngine.sendRoute({ vehicleId: 'v1', lat: 91, lng: 28, addressName: 'Test' })
    ).rejects.toThrow('Geçersiz enlem');
  });

  it('Boylam < -180 reddedilir', async () => {
    await expect(
      routeEngine.sendRoute({ vehicleId: 'v1', lat: 41, lng: -181, addressName: 'Test' })
    ).rejects.toThrow('Geçersiz boylam');
  });

  it('NaN koordinat reddedilir', async () => {
    await expect(
      routeEngine.sendRoute({ vehicleId: 'v1', lat: NaN, lng: 28, addressName: 'Test' })
    ).rejects.toThrow('Geçersiz enlem');
  });

  it('Geçerli İstanbul koordinatları kabul edilir', async () => {
    const insertChain = makeInsertChain({ data: { id: 'cmd-ist' } });
    const locChain    = makeSelectChain({ count: 1 });
    const routeChain  = makeInsertChain();

    mockSupabase.from.mockImplementation((t: string) => {
      if (t === 'vehicle_telemetry') return locChain;
      if (t === 'vehicle_commands')  return insertChain;
      return routeChain;
    });

    const { result } = await routeEngine.sendRoute({
      vehicleId: 'v1', lat: 41.0082, lng: 28.9784, addressName: 'İstanbul'
    });
    expect(result.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (e) TTL Koruması
// ═══════════════════════════════════════════════════════════════════════════

describe('(e) TTL Koruması', () => {
  it('sendAndTrack süresi dolmuş komut için expired eventi alır', async () => {
    vi.useFakeTimers();
    const events: commandService.StatusEvent[] = [];
    const insertChain = makeInsertChain({ data: { id: 'cmd-ttl' } });
    const locChain    = makeSelectChain({ count: 1 });

    mockSupabase.from.mockImplementation((t: string) => {
      if (t === 'vehicle_telemetry') return locChain;
      return insertChain;
    });

    const { unsubscribe } = await commandService.sendAndTrack(
      'vehicle-001', 'horn', {},
      (ev) => events.push(ev),
    );

    // 15s (default timeout) geçsin
    vi.advanceTimersByTime(15_001);

    expect(events.some((e) => e.status === 'expired')).toBe(true);
    unsubscribe();
    vi.useRealTimers();
  });
});
