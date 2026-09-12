-- ═══════════════════════════════════════════════════════════════════════════
-- 061 AI GATEWAY KAPSAMLI ERİŞİM — GERÇEK PostgreSQL DOĞRULAMA MATRİSİ
--
--   MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres \
--     supabase_db_fleetval psql -U postgres -d postgres \
--     < supabase/tests/061_ai_gateway_access_matrix.sql
--
-- NE KANITLAR: AI erişiminin varsayılan KAPALI olduğunu, yalnız yetkili
-- admin'in açabildiğini, global bayrağın tek başına kimseyi AÇMADIĞINI ve
-- kapsamın şirket sınırını GEÇMEDİĞİNİ.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

DELETE FROM public.profiles WHERE full_name LIKE 'AIGW_TEST_%';
DELETE FROM auth.users WHERE email LIKE 'aigw-test%@caros.local';
DELETE FROM public.vehicles WHERE company_id IN
  (SELECT id FROM public.companies WHERE name LIKE 'AIGW_TEST_%');
DELETE FROM public.companies WHERE name LIKE 'AIGW_TEST_%';
DELETE FROM public.feature_flags WHERE key = 'mavi_ai_gateway';

CREATE TEMP TABLE IF NOT EXISTS g_ids (k text PRIMARY KEY, v uuid);

DO $$
DECLARE ca uuid; cb uuid; va uuid; vb uuid;
        u_admin uuid := gen_random_uuid();
        u_member uuid := gen_random_uuid();
        u_b uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.companies (name) VALUES ('AIGW_TEST_A') RETURNING id INTO ca;
  INSERT INTO public.companies (name) VALUES ('AIGW_TEST_B') RETURNING id INTO cb;
  INSERT INTO public.vehicles (name, company_id) VALUES ('aigw-va', ca) RETURNING id INTO va;
  INSERT INTO public.vehicles (name, company_id) VALUES ('aigw-vb', cb) RETURNING id INTO vb;

  INSERT INTO auth.users (id, email) VALUES (u_admin,  'aigw-test-admin@caros.local');
  INSERT INTO auth.users (id, email) VALUES (u_member, 'aigw-test-member@caros.local');
  INSERT INTO auth.users (id, email) VALUES (u_b,      'aigw-test-b@caros.local');

  INSERT INTO public.profiles (id, full_name, role, company_id)
    VALUES (u_admin, 'AIGW_TEST_ADMIN', 'admin', ca)
  ON CONFLICT (id) DO UPDATE SET full_name='AIGW_TEST_ADMIN', role='admin', company_id=EXCLUDED.company_id;
  INSERT INTO public.profiles (id, full_name, role, company_id)
    VALUES (u_member, 'AIGW_TEST_MEMBER', 'member', ca)
  ON CONFLICT (id) DO UPDATE SET full_name='AIGW_TEST_MEMBER', role='member', company_id=EXCLUDED.company_id;
  INSERT INTO public.profiles (id, full_name, role, company_id)
    VALUES (u_b, 'AIGW_TEST_B_ADMIN', 'admin', cb)
  ON CONFLICT (id) DO UPDATE SET full_name='AIGW_TEST_B_ADMIN', role='admin', company_id=EXCLUDED.company_id;

  INSERT INTO g_ids VALUES ('ca',ca),('cb',cb),('va',va),('vb',vb),
                           ('admin',u_admin),('member',u_member),('badmin',u_b);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.id(k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM g_ids WHERE k = $1 $$;

CREATE TEMP TABLE IF NOT EXISTS g_res (code text PRIMARY KEY, ok boolean, detail text);

CREATE OR REPLACE FUNCTION pg_temp.chk(p_code text, p_ok boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO g_res VALUES (p_code, p_ok, p_detail)
  ON CONFLICT (code) DO UPDATE SET ok = EXCLUDED.ok, detail = EXCLUDED.detail;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.login(p_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid::text)::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.logout() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '', true); END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- A · VARSAYILAN KAPALI
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE r record;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('admin'));
  SELECT * INTO r FROM public.get_ai_gateway_access();
  PERFORM pg_temp.chk('A1',
    r.effective = false AND r.company_granted = false AND r.kill_switch_on = false,
    format('etkin=%s izin=%s salter=%s (hepsi false olmali)',
           r.effective, r.company_granted, r.kill_switch_on));
END $$;

-- A2: oturumsuz OKUYAMAZ
DO $$
DECLARE n integer;
BEGIN
  PERFORM pg_temp.logout();
  SELECT count(*) INTO n FROM public.get_ai_gateway_access();
  PERFORM pg_temp.chk('A2', n = 0, format('oturumsuz satir=%s (0 olmali)', n));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- B · YETKİ — YALNIZ ADMIN AÇABİLİR
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE res text; n integer;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('member'));
  res := public.set_ai_gateway_access(true, NULL, 'member_deneme');
  PERFORM pg_temp.chk('B1', res = 'DENIED_ROLE', format('member sonucu=%s', res));

  -- Reddedilen deneme SESSİZCE YUTULMAZ — denetim kütüğüne yazılır.
  SELECT count(*) INTO n FROM public.ai_gateway_audit
   WHERE company_id = pg_temp.id('ca') AND action = 'DENIED';
  PERFORM pg_temp.chk('B2', n >= 1, format('DENIED denetim kaydi=%s (>=1 olmali)', n));

  -- Reddedilen deneme izin OLUŞTURMAZ.
  SELECT count(*) INTO n FROM public.ai_gateway_access
   WHERE company_id = pg_temp.id('ca') AND enabled = true;
  PERFORM pg_temp.chk('B3', n = 0, format('reddedilen denemeden sonra acik izin=%s (0 olmali)', n));
END $$;

DO $$
DECLARE res text;
BEGIN
  PERFORM pg_temp.logout();
  res := public.set_ai_gateway_access(true, NULL, 'oturumsuz');
  PERFORM pg_temp.chk('B4', res = 'DENIED_NO_SESSION', format('oturumsuz sonucu=%s', res));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- C · ADMIN AÇAR — AMA ANA ŞALTER KAPALIYKEN ETKİN OLMAZ
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE res text; r record;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('admin'));
  res := public.set_ai_gateway_access(true, NULL, 'admin_grant');
  SELECT * INTO r FROM public.get_ai_gateway_access();
  -- KRİTİK: izin VAR ama ana şalter KAPALI → ETKİN DEĞİL (cift kapi).
  PERFORM pg_temp.chk('C1',
    res = 'GRANTED' AND r.company_granted = true AND r.effective = false,
    format('sonuc=%s izin=%s etkin=%s (etkin FALSE olmali — salter kapali)',
           res, r.company_granted, r.effective));
END $$;

-- C2: ana şalter açılınca ETKİN olur
DO $$
DECLARE r record;
BEGIN
  INSERT INTO public.feature_flags (key, name, description, enabled, rollout_percent, target_scope)
  VALUES ('mavi_ai_gateway', 'AI Gateway', 'ana salter', true, 100, 'all')
  ON CONFLICT (key) DO UPDATE SET enabled = true;

  PERFORM pg_temp.login(pg_temp.id('admin'));
  SELECT * INTO r FROM public.get_ai_gateway_access();
  PERFORM pg_temp.chk('C2', r.effective = true,
    format('salter+izin ile etkin=%s (true olmali)', r.effective));
END $$;

-- C3: ana şalter TEK BAŞINA yetmez — B şirketinin izni yok
DO $$
DECLARE r record;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('badmin'));
  SELECT * INTO r FROM public.get_ai_gateway_access();
  PERFORM pg_temp.chk('C3',
    r.kill_switch_on = true AND r.company_granted = false AND r.effective = false,
    format('B: salter=%s izin=%s etkin=%s (global salter B yi ACMAMALI)',
           r.kill_switch_on, r.company_granted, r.effective));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- D · TENANT İZOLASYONU
-- ═══════════════════════════════════════════════════════════════════════════

-- D1: A admini B'nin aracına izin VEREMEZ
DO $$
DECLARE res text;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('admin'));
  res := public.set_ai_gateway_access(true, pg_temp.id('vb'), 'cross_tenant');
  PERFORM pg_temp.chk('D1', res = 'DENIED_VEHICLE_SCOPE',
    format('A admini B aracina izin sonucu=%s', res));
END $$;

-- D2: A'nın kendi aracına araç-kapsamlı izin verebilir (kademeli acilis)
DO $$
DECLARE res text; r record;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('admin'));
  res := public.set_ai_gateway_access(true, pg_temp.id('va'), 'kademeli');
  SELECT * INTO r FROM public.get_ai_gateway_access();
  PERFORM pg_temp.chk('D2', res = 'GRANTED' AND r.vehicle_grant_count >= 1,
    format('sonuc=%s arac_izni=%s', res, r.vehicle_grant_count));
END $$;

-- D3: B admini A'nin denetim kaydini GOREMEZ
DO $$
DECLARE n integer;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('badmin'));
  SELECT count(*) INTO n FROM public.get_ai_gateway_audit(100);
  PERFORM pg_temp.chk('D3', n = 0, format('B nin gordugu denetim kaydi=%s (0 olmali)', n));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- E · KAPATMA — ERİŞİM ANINDA KAPANIR
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE res text; r record;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('admin'));
  res := public.set_ai_gateway_access(false, NULL, 'revoke');
  -- Arac izni de kaldirilir ki "etkin" gercekten kapansin.
  PERFORM public.set_ai_gateway_access(false, pg_temp.id('va'), 'revoke_vehicle');
  SELECT * INTO r FROM public.get_ai_gateway_access();
  PERFORM pg_temp.chk('E1',
    res = 'REVOKED' AND r.company_granted = false AND r.effective = false,
    format('sonuc=%s izin=%s etkin=%s (kapanmali)', res, r.company_granted, r.effective));
END $$;

-- E2: kapatma denetime yazilir ve revoked damgasi dusér
DO $$
DECLARE n integer; rv timestamptz;
BEGIN
  SELECT count(*) INTO n FROM public.ai_gateway_audit
   WHERE company_id = pg_temp.id('ca') AND action = 'REVOKE';
  SELECT revoked_at INTO rv FROM public.ai_gateway_access
   WHERE company_id = pg_temp.id('ca') AND vehicle_id IS NULL;
  PERFORM pg_temp.chk('E2', n >= 1 AND rv IS NOT NULL,
    format('REVOKE kaydi=%s revoked_at=%s', n, coalesce(rv::text,'NULL')));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- F · ANON TAMAMEN KAPALI
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM information_schema.role_routine_grants
   WHERE grantee = 'anon'
     AND routine_name IN ('get_ai_gateway_access','set_ai_gateway_access','get_ai_gateway_audit');
  PERFORM pg_temp.chk('F1', n = 0, format('anon EXECUTE=%s (0 olmali)', n));

  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE grantee IN ('anon','authenticated')
     AND table_name IN ('ai_gateway_access','ai_gateway_audit');
  PERFORM pg_temp.chk('F2', n = 0,
    format('dogrudan tablo izni=%s (0 olmali — her sey RPC uzerinden)', n));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
SELECT code, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS sonuc, detail
  FROM g_res ORDER BY code;
SELECT count(*) FILTER (WHERE ok) AS pass,
       count(*) FILTER (WHERE NOT ok) AS fail, count(*) AS toplam
  FROM g_res;
