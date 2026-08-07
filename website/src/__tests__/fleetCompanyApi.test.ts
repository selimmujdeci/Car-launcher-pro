/**
 * fleetCompanyApi.test.ts — COMPANY API ROTALARI (davranış testleri).
 *
 * Gerçek route handler'ları koşturulur; Supabase taklit edilir.
 * Kilitlenenler:
 *   · kimlik YALNIZ oturumdan — istemciden actor user_id KABUL EDİLMEZ
 *   · observer/member yazma uçlarından geçemez (sunucu tarafı doğrulama)
 *   · son admin koruması ve cross-tenant reddi typed kodla döner
 *   · service_role kullanılmaz (kullanıcının kendi oturum istemcisi)
 *
 * ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const S = vi.hoisted(() => ({
  userId:     'user-1' as string | null,
  profile:    { company_id: null as string | null, role: 'individual' as string },
  rpcCalls:   [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult:  { data: null as unknown, error: null as { message: string } | null },
  tableRows:  {} as Record<string, unknown>,
  configured: true,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return S.configured; },
}));

vi.mock('@/lib/supabaseServer', () => ({
  createSupabaseServerClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: S.userId ? { id: S.userId } : null },
        error: S.userId ? null : { message: 'no session' },
      }),
    },
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: table === 'profiles' ? S.profile : (S.tableRows[table] ?? null),
          error: null,
        }),
      });
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      S.rpcCalls.push({ fn, args });
      return S.rpcResult;
    },
  }),
}));

import { POST as companyPost, GET as companyGet, PATCH as companyPatch, DELETE as companyDelete }
  from '@/app/api/company/route';
import { GET as membersGet, POST as membersPost } from '@/app/api/company/members/route';
import { PATCH as memberPatch, DELETE as memberDelete }
  from '@/app/api/company/members/[userId]/route';
import { POST as assignPost }  from '@/app/api/company/vehicles/assign/route';
import { POST as removePost }  from '@/app/api/company/vehicles/remove/route';

function req(body?: unknown): Request {
  return new Request('http://localhost/api/company', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  S.userId     = 'user-1';
  S.profile    = { company_id: null, role: 'individual' };
  S.rpcCalls   = [];
  S.rpcResult  = { data: null, error: null };
  S.tableRows  = {};
  S.configured = true;
});

/* ── Kimlik ───────────────────────────────────────────────────────────── */

describe('company API · kimlik', () => {
  it('oturum yoksa 401 döner', async () => {
    S.userId = null;
    const res = await companyPost(req({ name: 'Filo' }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('unauthenticated');
  });

  it('istemciden gelen actor user_id KABUL EDİLMEZ', async () => {
    S.rpcResult = { data: { company_id: 'co-1', name: 'Filo', role: 'admin' }, error: null };
    await companyPost(req({ name: 'Filo', userId: 'saldirgan', actorId: 'saldirgan' }));
    expect(S.rpcCalls[0].fn).toBe('create_company');
    // Yalnız p_name gider — kimlik sunucudaki auth.uid()'den okunur.
    expect(Object.keys(S.rpcCalls[0].args)).toEqual(['p_name']);
  });

  it('Supabase yapılandırılmamışsa 401 (fail-closed)', async () => {
    S.configured = false;
    const res = await companyGet();
    expect(res.status).toBe(401);
  });
});

/* ── Şirket oluşturma ─────────────────────────────────────────────────── */

describe('company API · oluşturma', () => {
  it('geçerli istekte 201 döner', async () => {
    S.rpcResult = { data: { company_id: 'co-1', name: 'Filo', role: 'admin' }, error: null };
    const res = await companyPost(req({ name: 'Yılmaz Nakliyat' }));
    expect(res.status).toBe(201);
    expect((await res.json()).company.role).toBe('admin');
  });

  it('ikinci şirket oluşturma reddedilir (409)', async () => {
    S.rpcResult = { data: null, error: { message: 'already_member_of_company' } };
    const res = await companyPost(req({ name: 'İkinci Filo' }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('already_member_of_company');
  });

  it('geçersiz ad reddedilir (RPC bile çağrılmaz)', async () => {
    const res = await companyPost(req({ name: '   ' }));
    expect(res.status).toBe(400);
    expect(S.rpcCalls).toHaveLength(0);
  });

  it('bozuk gövde reddedilir', async () => {
    const bad = new Request('http://localhost/api/company', { method: 'POST', body: 'değil-json' });
    const res = await companyPost(bad);
    expect(res.status).toBe(400);
  });
});

/* ── Şirket okuma / güncelleme / silme ────────────────────────────────── */

describe('company API · okuma ve yönetim', () => {
  it('şirketi olmayan kullanıcı hata DEĞİL, bireysel durum döner', async () => {
    const res = await companyGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.company).toBeNull();
    expect(body.role).toBe('individual');
  });

  it('member şirket adını GÜNCELLEYEMEZ (403)', async () => {
    S.profile = { company_id: 'co-1', role: 'member' };
    const res = await companyPatch(req({ name: 'Yeni Ad' }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('permission_denied');
    expect(S.rpcCalls).toHaveLength(0); // sunucuya hiç gitmez
  });

  it('observer şirket adını GÜNCELLEYEMEZ (403)', async () => {
    S.profile = { company_id: 'co-1', role: 'observer' };
    const res = await companyPatch(req({ name: 'Yeni Ad' }));
    expect(res.status).toBe(403);
  });

  it('admin şirket adını güncelleyebilir', async () => {
    S.profile   = { company_id: 'co-1', role: 'admin' };
    S.rpcResult = { data: { company_id: 'co-1', name: 'Yeni Ad' }, error: null };
    const res = await companyPatch(req({ name: 'Yeni Ad' }));
    expect(res.status).toBe(200);
    expect(S.rpcCalls[0].fn).toBe('update_company');
  });

  it('yalnız admin şirketi silebilir', async () => {
    S.profile = { company_id: 'co-1', role: 'member' };
    expect((await companyDelete()).status).toBe(403);

    S.profile   = { company_id: 'co-1', role: 'admin' };
    S.rpcResult = { data: { company_id: 'co-1', detached_vehicles: 3, released_members: 2 }, error: null };
    const res = await companyDelete();
    expect(res.status).toBe(200);
    expect(S.rpcCalls.at(-1)?.fn).toBe('delete_company');
  });

  it('silinmiş şirket 410 döner', async () => {
    S.profile = { company_id: 'co-1', role: 'admin' };
    S.tableRows = {};              // companies satırı yok
    const res = await companyGet();
    expect(res.status).toBe(410);
    expect((await res.json()).code).toBe('company_deleted');
  });
});

/* ── Üyelik ───────────────────────────────────────────────────────────── */

describe('company API · üyelik', () => {
  it('şirketi olmayan kullanıcı üye listeleyemez (404 no_company)', async () => {
    const res = await membersGet();
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('no_company');
  });

  it('observer üye LİSTELEYEBİLİR ama EKLEYEMEZ', async () => {
    S.profile   = { company_id: 'co-1', role: 'observer' };
    S.rpcResult = { data: [], error: null };
    expect((await membersGet()).status).toBe(200);

    const res = await membersPost(req({ userId: 'u2', role: 'member' }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('permission_denied');
  });

  it('member üye EKLEYEMEZ (yetkisiz ekleme reddi)', async () => {
    S.profile = { company_id: 'co-1', role: 'member' };
    const res = await membersPost(req({ userId: 'u2', role: 'member' }));
    expect(res.status).toBe(403);
    expect(S.rpcCalls).toHaveLength(0);
  });

  it('admin üye ekleyebilir', async () => {
    S.profile   = { company_id: 'co-1', role: 'admin' };
    S.rpcResult = { data: { user_id: 'u2', company_id: 'co-1', role: 'member' }, error: null };
    const res = await membersPost(req({ userId: 'u2', role: 'member' }));
    expect(res.status).toBe(201);
    expect(S.rpcCalls[0].args).toEqual({ p_user_id: 'u2', p_role: 'member' });
  });

  it('geçersiz rol reddedilir — RPC çağrılmaz', async () => {
    S.profile = { company_id: 'co-1', role: 'admin' };
    const res = await membersPost(req({ userId: 'u2', role: 'kral' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_role');
    expect(S.rpcCalls).toHaveLength(0);
  });

  it('individual rolü ATANAMAZ', async () => {
    S.profile = { company_id: 'co-1', role: 'admin' };
    const res = await membersPost(req({ userId: 'u2', role: 'individual' }));
    expect(res.status).toBe(400);
  });

  it('cross-tenant üye ekleme sunucuda reddedilir (409)', async () => {
    S.profile   = { company_id: 'co-1', role: 'admin' };
    S.rpcResult = { data: null, error: { message: 'user_belongs_to_another_company' } };
    const res = await membersPost(req({ userId: 'u2', role: 'member' }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('user_belongs_to_another_company');
  });

  it('üye listesi admin sayısını da döndürür', async () => {
    S.profile   = { company_id: 'co-1', role: 'admin' };
    S.rpcResult = { data: [
      { user_id: 'a', full_name: null, role: 'admin',  created_at: '' },
      { user_id: 'b', full_name: null, role: 'member', created_at: '' },
    ], error: null };
    const body = await (await membersGet()).json();
    expect(body.adminCount).toBe(1);
  });
});

/* ── Rol değiştirme / üye kaldırma ────────────────────────────────────── */

describe('company API · rol ve kaldırma', () => {
  const ctx = { params: { userId: 'u2' } };

  it('member rol değiştiremez', async () => {
    S.profile = { company_id: 'co-1', role: 'member' };
    const res = await memberPatch(req({ role: 'admin' }), ctx);
    expect(res.status).toBe(403);
    expect(S.rpcCalls).toHaveLength(0);
  });

  it('admin rol değiştirebilir', async () => {
    S.profile   = { company_id: 'co-1', role: 'admin' };
    S.rpcResult = { data: { user_id: 'u2', company_id: 'co-1', role: 'observer' }, error: null };
    const res = await memberPatch(req({ role: 'observer' }), ctx);
    expect(res.status).toBe(200);
    expect(S.rpcCalls[0]).toEqual({
      fn: 'update_member_role', args: { p_user_id: 'u2', p_role: 'observer' },
    });
  });

  it('SON ADMIN rolü düşürülemez (409)', async () => {
    S.profile   = { company_id: 'co-1', role: 'admin' };
    S.rpcResult = { data: null, error: { message: 'last_admin_protected' } };
    const res = await memberPatch(req({ role: 'member' }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('last_admin_protected');
  });

  it('SON ADMIN kaldırılamaz (409)', async () => {
    S.profile   = { company_id: 'co-1', role: 'admin' };
    S.rpcResult = { data: null, error: { message: 'last_admin_protected' } };
    const res = await memberDelete(req(), ctx);
    expect(res.status).toBe(409);
  });

  it('admin kendi rolünü değiştiremez (409)', async () => {
    S.profile   = { company_id: 'co-1', role: 'admin' };
    S.rpcResult = { data: null, error: { message: 'cannot_modify_self_role' } };
    const res = await memberPatch(req({ role: 'member' }), { params: { userId: 'user-1' } });
    expect(res.status).toBe(409);
  });

  it('observer üye kaldıramaz', async () => {
    S.profile = { company_id: 'co-1', role: 'observer' };
    const res = await memberDelete(req(), ctx);
    expect(res.status).toBe(403);
  });

  it('admin üye kaldırabilir', async () => {
    S.profile   = { company_id: 'co-1', role: 'admin' };
    S.rpcResult = { data: { user_id: 'u2', removed: true }, error: null };
    const res = await memberDelete(req(), ctx);
    expect(res.status).toBe(200);
    expect(S.rpcCalls[0].fn).toBe('remove_company_member');
  });
});

/* ── Araç atama ───────────────────────────────────────────────────────── */

describe('company API · araç atama', () => {
  it('member araç atayamaz', async () => {
    S.profile = { company_id: 'co-1', role: 'member' };
    const res = await assignPost(req({ vehicleId: 'v1' }));
    expect(res.status).toBe(403);
    expect(S.rpcCalls).toHaveLength(0);
  });

  it('admin araç atayabilir', async () => {
    S.profile   = { company_id: 'co-1', role: 'admin' };
    S.rpcResult = { data: { vehicle_id: 'v1', company_id: 'co-1' }, error: null };
    const res = await assignPost(req({ vehicleId: 'v1' }));
    expect(res.status).toBe(200);
    expect(S.rpcCalls[0]).toEqual({
      fn: 'assign_vehicle_to_company', args: { p_vehicle_id: 'v1' },
    });
  });

  it('başka filoya ait araç reddedilir (409)', async () => {
    S.profile   = { company_id: 'co-1', role: 'admin' };
    S.rpcResult = { data: null, error: { message: 'vehicle_in_another_company' } };
    const res = await assignPost(req({ vehicleId: 'v1' }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('vehicle_in_another_company');
  });

  it('sahipsiz araç atanamaz (sunucu reddi)', async () => {
    S.profile   = { company_id: 'co-1', role: 'admin' };
    S.rpcResult = { data: null, error: { message: 'vehicle_owned_by_another_user' } };
    const res = await assignPost(req({ vehicleId: 'v-sahipsiz' }));
    expect(res.status).toBe(409);
  });

  it('araç filodan çıkarılabilir — yalnız admin', async () => {
    S.profile = { company_id: 'co-1', role: 'observer' };
    expect((await removePost(req({ vehicleId: 'v1' }))).status).toBe(403);

    S.profile   = { company_id: 'co-1', role: 'admin' };
    S.rpcResult = { data: { vehicle_id: 'v1', company_id: null }, error: null };
    const res = await removePost(req({ vehicleId: 'v1' }));
    expect(res.status).toBe(200);
    expect(S.rpcCalls.at(-1)?.fn).toBe('remove_vehicle_from_company');
  });

  it('araç kimliği eksikse RPC çağrılmaz', async () => {
    S.profile = { company_id: 'co-1', role: 'admin' };
    const res = await assignPost(req({}));
    expect(res.status).toBe(400);
    expect(S.rpcCalls).toHaveLength(0);
  });
});
