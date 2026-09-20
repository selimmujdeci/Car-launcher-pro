/**
 * criticalCommandServerAuthority.test.ts — MRI Wave 3 · N-2/N-3 (PWA tarafı)
 *
 * DB davranışı `supabase/tests/083_critical_authority_matrix.sql`te gerçek
 * rol/politika/trigger ile ölçülür. Burada PWA'nın o kapıya DOĞRU biçimde
 * bağlandığı kilitlenir:
 *   1. kritik komut PIN'siz sunucuya HİÇ gitmez;
 *   2. kritik komut yalnız `verify_and_send_critical_command(p_pin)` ile gider —
 *      doğrudan INSERT yok, `p_pin_hash` yok, istemci hash'i yok;
 *   3. sunucu `pin_not_set` derse PIN `set_vehicle_pin` ile kaydedilir ve komut
 *      BİR KEZ yeniden denenir; sonuç sunucunun döndürdüğüdür;
 *   4. yanlış PIN / kilit → sunucu gerekçesi kullanıcıya iner, komut yok;
 *   5. kritik olmayan doğrudan INSERT `critical_auth_verified` GÖNDERMEZ
 *      (istemci güvenlik kararı yazmaz);
 *   6. kritik komut listesi DB'deki `is_critical_command_type` ile aynı.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as commandService from '../lib/commandService';

const mocks = vi.hoisted(() => ({
  supabase: {
    auth: { getSession: vi.fn(), getUser: vi.fn() },
    from: vi.fn(),
    rpc:  vi.fn(),
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

vi.mock('../lib/supabase', () => ({
  supabaseBrowser:      mocks.supabase,
  isSupabaseConfigured: true,
  ensurePwaSession:     vi.fn(async () => 'tok'),
}));
vi.mock('../security/accountCleanup/accountCleanupRuntime', () => ({
  evaluateAccountScopedCapability: () => ({ allowed: true, generation: 1 }),
}));
vi.mock('@/lib/e2eCommandCrypto', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchCarPublicKey: vi.fn(async () => ({ ok: true, publicKey: 'dGVzdC1rZXk=' })),
  encryptE2EPayload: vi.fn(async () => ({ type: 'ecdh_v1', eph_pub: 'ZQ==', iv: 'aXY=', data: 'ZGF0YQ==', ts: Date.now() })),
}));

function offlineTelemetryChain() {
  const result = { data: [], count: 0, error: null };
  return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), gte: vi.fn().mockResolvedValue(result) };
}
function insertChain() {
  const chain = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'cmd-1' }, error: null }),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mocks.supabase.from.mockImplementation((table: string) => {
    if (table === 'vehicle_telemetry') return offlineTelemetryChain();
    if (table === 'vehicle_commands')  return insertChain();
    return {};
  });
  try { localStorage.clear(); } catch { /* jsdom */ }
});

describe('kritik komut → sunucu PIN kapısı', () => {
  it('1. PIN yoksa sunucuya hiç gitmez', async () => {
    const r = await commandService.sendCommand('veh-1', 'unlock', {}, { requireCriticalAuth: true });
    expect(r.ok).toBe(false);
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.supabase.from).not.toHaveBeenCalledWith('vehicle_commands');
  });

  it('2. yalnız verify_and_send_critical_command(p_pin) ile gider — INSERT/hash yok', async () => {
    mocks.supabase.rpc.mockResolvedValueOnce({ data: { ok: true, command_id: 'cmd-9' }, error: null });
    const r = await commandService.sendCommand('veh-1', 'unlock', {}, { requireCriticalAuth: true, pin: '1234' });
    expect(r).toMatchObject({ ok: true, commandId: 'cmd-9' });
    expect(mocks.supabase.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = mocks.supabase.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe('verify_and_send_critical_command');
    expect(args.p_pin).toBe('1234');
    expect(args).not.toHaveProperty('p_pin_hash');
    expect(args.p_vehicle_id).toBe('veh-1');
    expect(mocks.supabase.from).not.toHaveBeenCalledWith('vehicle_commands');
    expect(localStorage.getItem(commandService.CRITICAL_PIN_ENROLLED_KEY)).toBe('1');
  });

  it('3. pin_not_set → set_vehicle_pin → bir kez yeniden dener', async () => {
    mocks.supabase.rpc
      .mockResolvedValueOnce({ data: { ok: false, error: 'pin_not_set' }, error: null })
      .mockResolvedValueOnce({ data: { ok: true }, error: null })                        // set_vehicle_pin
      .mockResolvedValueOnce({ data: { ok: true, command_id: 'cmd-2' }, error: null }); // retry
    const r = await commandService.sendCommand('veh-1', 'alarm_off', {}, { requireCriticalAuth: true, pin: '4321' });
    expect(r).toMatchObject({ ok: true, commandId: 'cmd-2' });
    const names = mocks.supabase.rpc.mock.calls.map((c) => c[0]);
    expect(names).toEqual(['verify_and_send_critical_command', 'set_vehicle_pin', 'verify_and_send_critical_command']);
    const setArgs = mocks.supabase.rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(setArgs).toMatchObject({ p_vehicle_id: 'veh-1', p_pin: '4321' });
  });

  it('3b. set_vehicle_pin reddederse (gözlemci, mevcut PIN kanıtı yok) komut gitmez', async () => {
    mocks.supabase.rpc
      .mockResolvedValueOnce({ data: { ok: false, error: 'pin_not_set' }, error: null })
      .mockResolvedValueOnce({ data: { ok: false, error: 'pin_mismatch' }, error: null });
    const r = await commandService.sendCommand('veh-1', 'unlock', {}, { requireCriticalAuth: true, pin: '4321' });
    expect(r.ok).toBe(false);
    expect(mocks.supabase.rpc).toHaveBeenCalledTimes(2);
  });

  it('4. yanlış PIN / kilit → sunucu gerekçesi, komut yok, kayıt denemesi yok', async () => {
    mocks.supabase.rpc.mockResolvedValueOnce({ data: { ok: false, error: 'Yanlış PIN.' }, error: null });
    let r = await commandService.sendCommand('veh-1', 'unlock', {}, { requireCriticalAuth: true, pin: '0000' });
    expect(r).toMatchObject({ ok: false, error: 'Yanlış PIN.' });
    expect(mocks.supabase.rpc).toHaveBeenCalledTimes(1);

    mocks.supabase.rpc.mockResolvedValueOnce({ data: { ok: false, error: 'pin_locked' }, error: null });
    r = await commandService.sendCommand('veh-1', 'unlock', {}, { requireCriticalAuth: true, pin: '1234' });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/15 dakika/);
  });

  it('5. kritik olmayan INSERT critical_auth_verified göndermez', async () => {
    const chain = insertChain();
    mocks.supabase.from.mockImplementation((table: string) => {
      if (table === 'vehicle_telemetry') return offlineTelemetryChain();
      if (table === 'vehicle_commands')  return chain;
      return {};
    });
    const r = await commandService.sendCommand('veh-1', 'lock', {}, { requireCriticalAuth: true });
    expect(r.ok).toBe(true);
    const row = chain.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row).not.toHaveProperty('critical_auth_verified');
    expect(row).not.toHaveProperty('status');
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
  });
});

describe('kritik komut listesi paritesi (PWA ↔ DB)', () => {
  it('6. is_critical_command_type ile aynı küme', () => {
    const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/20260920000083_critical_command_server_authority.sql'), 'utf8');
    const m = sql.match(/is_critical_command_type[\s\S]*?SELECT p_type IN \(([^)]*)\)/);
    expect(m).not.toBeNull();
    const dbList = m![1].split(',').map((s) => s.trim().replace(/'/g, '')).sort();
    const all: commandService.CommandType[] = [
      'lock', 'unlock', 'horn', 'alarm_on', 'alarm_off', 'lights_on', 'route_send', 'navigation_start',
      'theme_change', 'layout_change', 'read_dtc', 'clear_dtc', 'read_voltage', 'set_speed_alert',
    ];
    const pwaList = all.filter((t) => commandService.isCriticalCommand(t)).sort();
    expect(pwaList).toEqual(dbList);
  });
});
