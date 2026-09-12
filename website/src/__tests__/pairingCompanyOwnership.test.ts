/**
 * pairingCompanyOwnership.test.ts — PAIRING company_id + BİREYSEL SAHİPLİK (P1).
 *
 * ── ONARILAN KUSUR (bağımsız denetim) ───────────────────────────────────────
 * `/api/vehicle/link` yalnız `owner_id` yazıyor, `vehicles.company_id`'ye HİÇ
 * dokunmuyordu. `push_vehicle_event` ise `vehicle_locations` INSERT'ini
 * `company_id IS NOT NULL` şartına bağlamıştı → araç ONLINE görünüyor ama
 * haritada marker OLUŞMUYORDU. Ayrıca eşleştirme üç ayrı sorguydu (yarım
 * pairing mümkün) ve hiçbir üyelik/sahiplik kapısı yoktu.
 *
 * ── İKİ KATMAN, İKİ TEST TÜRÜ ───────────────────────────────────────────────
 * (a) DAVRANIŞ: gerçek `POST` route'u koşturulur; Supabase istemcisi taklit
 *     edilir. Route'un istemciden company_id/owner_id ALMADIĞI, tek atomik
 *     RPC çağırdığı ve hata dallarının fail-closed olduğu kilitlenir.
 * (b) SÖZLEŞME: migration SQL'i kaynak olarak okunur (veritabanı olmadan
 *     çalıştırılamaz) — limit sabiti, kilit, sahiplik kapıları, GRANT/RLS ve
 *     konum kapısının yeni koşulu METİN düzeyinde kilitlenir. Bu, SQL'in
 *     sessizce gevşetilmesini engeller.
 *
 * ⚠️ Gerçek Postgres davranışı burada KANITLANMAZ; kütük #165'teki canlı
 * doğrulama adımları zorunludur. Bu dosya "kod bunu iddia ediyor" der,
 * "üretimde çalıştı" DEMEZ.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/* ── Supabase taklidi ─────────────────────────────────────────────────────── */

const S = vi.hoisted(() => ({
  rpcCalls:  [] as Array<{ fn: string; args: Record<string, unknown> }>,
  fromCalls: [] as string[],
  rpcResult: { data: null as unknown, error: null as { message: string } | null },
  userId:    'user-1' as string | null,
}));

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true }));
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: {
    auth: { getUser: async () => ({ data: { user: S.userId ? { id: S.userId } : null } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      S.rpcCalls.push({ fn, args });
      return S.rpcResult;
    },
    from: (table: string) => {
      S.fromCalls.push(table);
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q, eq: () => q, is: () => q, gt: () => q, delete: () => q,
        update: () => q, upsert: async () => ({ error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      });
      return q;
    },
  },
}));

import { POST } from '@/app/api/vehicle/link/route';

function request(body: unknown, auth = 'Bearer t'): Request {
  return new Request('http://localhost/api/vehicle/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify(body),
  });
}

/* NextRequest yerine standart Request yeterli: route yalnız `json()` ve
   `headers.get()` kullanır (imza uyumu için tip daraltması). */
const post = (body: unknown, auth?: string) =>
  POST(request(body, auth) as unknown as Parameters<typeof POST>[0]);

const okRow = {
  vehicle_id: 'veh-1', name: 'Araç', device_id: 'dev-1',
  created_at: '2026-07-29T00:00:00Z', company_id: null, owner_id: 'user-1',
  role: 'owner', is_individual: true,
};

beforeEach(() => {
  S.rpcCalls.length = 0;
  S.fromCalls.length = 0;
  S.rpcResult = { data: okRow, error: null };
  S.userId = 'user-1';
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe('P1 · pairing endpoint — tek atomik RPC + sıfır istemci güveni', () => {
  it('1. eşleştirme TEK RPC ile yapılır (ayrı update/upsert sorgusu YOK)', async () => {
    const res = await post({ code: '123456' });
    expect(res.status).toBe(200);
    expect(S.rpcCalls.map((c) => c.fn)).toEqual(['pair_vehicle_to_user']);
    // Yarım pairing üretebilecek doğrudan tablo yazımları KALMADI
    expect(S.fromCalls).toEqual([]);
  });

  it('2. 🔒 istemciden gelen company_id / owner_id ASLA RPC\'ye taşınmaz', async () => {
    await post({
      code: '123456',
      company_id: 'attacker-company',
      owner_id: 'attacker-user',
      vehicle_count: 0,
    });
    const args = S.rpcCalls[0].args;
    expect(Object.keys(args).sort()).toEqual(['p_code', 'p_user_id']);
    expect(args.p_user_id).toBe('user-1');            // JWT'den, gövdeden DEĞİL
    expect(JSON.stringify(args)).not.toContain('attacker');
  });

  it('3. kimlik doğrulanmadan RPC ÇAĞRILMAZ', async () => {
    S.userId = null;
    const res = await post({ code: '123456' });
    expect(res.status).toBe(401);
    expect(S.rpcCalls).toEqual([]);
  });

  it('4. geçersiz kod formatı RPC\'ye bile gitmez', async () => {
    for (const code of ['12345', 'abcdef', '', '1234567']) {
      S.rpcCalls.length = 0;
      const res = await post({ code });
      expect(`${code}:${res.status}`).toBe(`${code}:400`);
      expect(S.rpcCalls).toEqual([]);
    }
  });

  it('5. 🔒 bireysel 4. araç reddi 403 + makine-okunur kod döner', async () => {
    S.rpcResult = { data: null, error: { message: 'individual_vehicle_limit_reached' } };
    const res = await post({ code: '123456' });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.code).toBe('individual_vehicle_limit_reached');
    expect(body.error).toMatch(/filo|şirket/i);       // kullanıcıya yol gösterilir
    expect(body.vehicle).toBeUndefined();             // yarım başarı YOK
  });

  it('6. 🔒 cross-tenant ve cross-owner claim 409 ile reddedilir', async () => {
    for (const [reason, code] of [
      ['vehicle_belongs_to_another_company', 'vehicle_belongs_to_another_company'],
      ['vehicle_owned_by_another_user',      'vehicle_owned_by_another_user'],
    ]) {
      S.rpcResult = { data: null, error: { message: reason } };
      const res = await post({ code: '123456' });
      const body = await res.json();
      expect(`${reason}:${res.status}`).toBe(`${reason}:409`);
      expect(body.code).toBe(code);
      expect(body.vehicle).toBeUndefined();
    }
  });

  it('7. süresi dolmuş / tekrar kullanılan / geçersiz kod 400 döner', async () => {
    S.rpcResult = { data: null, error: { message: 'invalid_or_expired_code' } };
    const res = await post({ code: '123456' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_or_expired_code');
  });

  it('8. beklenmeyen hata sessiz başarıya DÖNMEZ', async () => {
    S.rpcResult = { data: null, error: { message: 'deadlock detected' } };
    expect((await post({ code: '123456' })).status).toBe(500);
    S.rpcResult = { data: null, error: null };        // RPC boş döndü
    expect((await post({ code: '123456' })).status).toBe(500);
  });

  it('9. başarılı cevap company_id taşır (bireysel araçta null)', async () => {
    const body = await (await post({ code: '123456' })).json();
    expect(body.vehicle.id).toBe('veh-1');
    expect(body.vehicle.company_id).toBeNull();

    S.rpcResult = { data: { ...okRow, company_id: 'comp-9', is_individual: false }, error: null };
    const fleet = await (await post({ code: '123456' })).json();
    expect(fleet.vehicle.company_id).toBe('comp-9');
  });
});

/* ── SQL SÖZLEŞMESİ ───────────────────────────────────────────────────────── */

/* Migration deponun KÖKÜNDEDİR; test koşucusunun kökü `website/` olabilir →
   iki aday da denenir (kırılgan tek yol varsayımı yok). */
const MIGRATION = '20260729000034_pairing_company_and_owner_gps.sql';
const SQL_PATH = [
  resolve(process.cwd(), '..', 'supabase', 'migrations', MIGRATION),
  resolve(process.cwd(), 'supabase', 'migrations', MIGRATION),
].find((p) => existsSync(p));

const SQL = SQL_PATH ? readFileSync(SQL_PATH, 'utf8') : '';

describe('P1 · migration sözleşmesi (SQL kaynak kilidi)', () => {
  it('10. bireysel limit SABİTİ 3\'tür ve sunucu tarafında sayılır', () => {
    expect(SQL).toMatch(/c_individual_max\s+constant\s+integer\s*:=\s*3/);
    expect(SQL).toMatch(/SELECT count\(\*\) INTO v_owned_count[\s\S]*FROM public\.vehicles/);
    expect(SQL).toMatch(/WHERE owner_id = p_user_id[\s\S]*AND company_id IS NULL/);
  });

  it('11. 🔒 limit yalnız ŞİRKETSİZ kullanıcıya uygulanır', () => {
    expect(SQL).toMatch(/IF v_company IS NULL AND NOT v_already_paired THEN/);
  });

  it('12. 🔒 aynı aracın tekrar eşleşmesi limiti ARTIRMAZ', () => {
    expect(SQL).toMatch(/AND id <> v_vehicle\.id/);
    expect(SQL).toMatch(/v_already_paired\s*:=\s*EXISTS/);
  });

  it('13. 🔒 eşzamanlı iki pairing limiti aşamaz (kullanıcı bazlı kilit)', () => {
    expect(SQL).toMatch(/pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 0\)\)/);
    expect(SQL).toMatch(/FOR UPDATE/);
  });

  it('14. 🔒 şirket YALNIZ sunucuda doğrulanmış üyelikten çözülür', () => {
    expect(SQL).toMatch(/SELECT p\.company_id INTO v_company[\s\S]*FROM public\.profiles p[\s\S]*WHERE p\.id = p_user_id/);
    // İstemciden company_id alan bir parametre YOK
    expect(SQL).toMatch(/pair_vehicle_to_user\(\s*\n?\s*p_code\s+text,\s*\n?\s*p_user_id uuid\s*\n?\)/);
    expect(SQL).not.toMatch(/p_company_id/);
  });

  it('15. 🔒 sessiz sahiplik/tenant taşıması YASAK', () => {
    expect(SQL).toMatch(/RAISE EXCEPTION 'vehicle_belongs_to_another_company'/);
    expect(SQL).toMatch(/RAISE EXCEPTION 'vehicle_owned_by_another_user'/);
    // coalesce → mevcut owner/company EZİLMEZ
    expect(SQL).toMatch(/SET owner_id\s*=\s*coalesce\(owner_id, p_user_id\)/);
    expect(SQL).toMatch(/company_id\s*=\s*coalesce\(company_id, v_company\)/);
  });

  it('16. 🔒 kod tek kullanımlıktır (replay kapalı)', () => {
    expect(SQL).toMatch(/DELETE FROM public\.vehicle_linking_codes WHERE vehicle_id = v_vehicle\.id/);
    expect(SQL).toMatch(/vlc\.expires_at > now\(\)/);
    expect(SQL).toMatch(/RAISE EXCEPTION 'invalid_or_expired_code'/);
  });

  it('17. 🔒 bireysel araçta company_id NULL kalır; otomatik şirket ÜRETİLMEZ', () => {
    expect(SQL).not.toMatch(/INSERT INTO public\.companies/i);
    expect(SQL).toMatch(/vehicle_pairings \(user_id, vehicle_id, role, company_id\)/);
  });

  it('18. 🔒 GPS kapısı sahiplik duyarlı (güvenlik gevşetilmeden)', () => {
    expect(SQL).toMatch(
      /\(v_company_id IS NOT NULL OR \(v_company_id IS NULL AND v_owner_id IS NOT NULL\)\)/,
    );
    // Sahipsiz VE şirketsiz araç hâlâ konum yazamaz → eski koşul tek başına kalmadı
    expect(SQL).toMatch(/SELECT id, company_id, owner_id INTO v_vehicle_id, v_company_id, v_owner_id/);
    // RLS okuma politikaları bu migration'da DEĞİŞTİRİLMEDİ
    expect(SQL).not.toMatch(/CREATE POLICY .*vehicle_locations/i);
    expect(SQL).not.toMatch(/DROP POLICY/i);
  });

  it('19. 🔒 RPC istemci rollerine AÇILMAZ (kimlik taklidi kapısı)', () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.pair_vehicle_to_user\(text, uuid\) FROM anon/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.pair_vehicle_to_user\(text, uuid\) FROM authenticated/);
    expect(SQL).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.pair_vehicle_to_user\(text, uuid\) TO service_role/);
    expect(SQL).toMatch(/has_function_privilege\('anon'/);
  });

  it('20. 🔒 CLAUDE.md migration doğrulama şartları var (GRANT + RLS + kolon)', () => {
    expect(SQL).toMatch(/information_schema\.columns/);
    expect(SQL).toMatch(/rowsecurity = true/);
    expect(SQL).toMatch(/ALTER TABLE public\.vehicle_pairings ENABLE ROW LEVEL SECURITY/);
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public\.companies/);
  });

  it('21. ⚠️ YANLIŞLAMA: kilitler gerçekten bu dosyayı okuyor', () => {
    expect(SQL.length).toBeGreaterThan(3000);
    expect(SQL).toContain('pair_vehicle_to_user');
    expect(SQL).not.toContain('TODO');
  });
});
