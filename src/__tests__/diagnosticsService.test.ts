/**
 * diagnosticsService.test.ts — erişilebilir tanı okuma (dilim 2).
 *
 * getRecentDiagnostics, super_admin GEREKTİRMEYEN get_recent_diagnostics
 * RPC'sini (migration 025) çağırır. Bu kilit: IncidentFilter → RPC parametre
 * eşlemesi doğru + dönüş getRemoteIncidents ile aynı IncidentQueryResult şekli
 * (hata sessiz [] değil, error alanında).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const M = vi.hoisted(() => ({
  rpcArgs: null as null | { fn: string; params: Record<string, unknown> },
  rpcReturn: { data: [] as unknown[], error: null as { message: string } | null },
}));

vi.mock('../admin/lib/supabaseClient', () => ({
  supabase: {
    rpc: vi.fn(async (fn: string, params: Record<string, unknown>) => {
      M.rpcArgs = { fn, params };
      return M.rpcReturn;
    }),
  },
}));

import { getRecentDiagnostics } from '../admin/services/diagnostics.service';

beforeEach(() => {
  M.rpcArgs = null;
  M.rpcReturn = { data: [], error: null };
  vi.clearAllMocks();
});

describe('getRecentDiagnostics — RPC eşlemesi', () => {
  it('doğru RPC adı + varsayılan parametrelerle çağırır', async () => {
    await getRecentDiagnostics();
    expect(M.rpcArgs?.fn).toBe('get_recent_diagnostics');
    expect(M.rpcArgs?.params).toEqual({
      p_type: null, p_vehicle_id: null, p_app_version: null,
      p_since: null, p_until: null, p_limit: 50, p_offset: 0,
    });
  });

  it('filtreleri RPC parametrelerine eşler', async () => {
    await getRecentDiagnostics({
      type: 'support_snapshot', vehicleId: 'veh-1', appVersion: '2.4.0',
      since: '2026-07-01T00:00:00Z', until: '2026-07-06T00:00:00Z',
      limit: 100, offset: 50,
    });
    expect(M.rpcArgs?.params).toEqual({
      p_type: 'support_snapshot', p_vehicle_id: 'veh-1', p_app_version: '2.4.0',
      p_since: '2026-07-01T00:00:00Z', p_until: '2026-07-06T00:00:00Z',
      p_limit: 100, p_offset: 50,
    });
  });

  it('başarı: rows döner, error null', async () => {
    M.rpcReturn = {
      data: [{ id: '1', vehicle_id: 'v', type: 'support_snapshot', metadata: {}, created_at: 't' }],
      error: null,
    };
    const res = await getRecentDiagnostics();
    expect(res.error).toBeNull();
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].type).toBe('support_snapshot');
  });

  it('hata: rows boş, error mesajı taşınır (sessiz [] değil)', async () => {
    M.rpcReturn = { data: [], error: { message: 'permission denied' } };
    const res = await getRecentDiagnostics();
    expect(res.rows).toEqual([]);
    expect(res.error).toBe('permission denied');
  });
});
