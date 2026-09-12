-- ═══════════════════════════════════════════════════════════════════════════
-- 062 FLEET INSIGHT OKUMA + ARAÇ-KAPSAMLI AI İZNİ — GERÇEK PostgreSQL MATRİSİ
--
--   MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres \
--     supabase_db_fleetval psql -U postgres -d postgres \
--     < supabase/tests/062_insight_and_vehicle_scope_matrix.sql
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

DELETE FROM public.profiles WHERE full_name LIKE 'INS_TEST_%';
DELETE FROM auth.users WHERE email LIKE 'ins-test%@caros.local';
DELETE FROM public.vehicles WHERE company_id IN
  (SELECT id FROM public.companies WHERE name LIKE 'INS_TEST_%');
DELETE FROM public.companies WHERE name LIKE 'INS_TEST_%';

CREATE TEMP TABLE IF NOT EXISTS i_ids (k text PRIMARY KEY, v uuid);

DO $$
DECLARE ca uuid; cb uuid; va uuid; vb uuid;
        ua uuid := gen_random_uuid(); um uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.companies (name) VALUES ('INS_TEST_A') RETURNING id INTO ca;
  INSERT INTO public.companies (name) VALUES ('INS_TEST_B') RETURNING id INTO cb;
  INSERT INTO public.vehicles (name, company_id) VALUES ('ins-va', ca) RETURNING id INTO va;
  INSERT INTO public.vehicles (name, company_id) VALUES ('ins-vb', cb) RETURNING id INTO vb;

  INSERT INTO auth.users (id, email) VALUES (ua, 'ins-test-a@caros.local');
  INSERT INTO auth.users (id, email) VALUES (um, 'ins-test-m@caros.local');
  INSERT INTO auth.users (id, email) VALUES (ub, 'ins-test-b@caros.local');
  INSERT INTO public.profiles (id, full_name, role, company_id)
    VALUES (ua, 'INS_TEST_ADMIN_A', 'admin', ca)
  ON CONFLICT (id) DO UPDATE SET full_name='INS_TEST_ADMIN_A', role='admin', company_id=EXCLUDED.company_id;
  INSERT INTO public.profiles (id, full_name, role, company_id)
    VALUES (um, 'INS_TEST_MEMBER_A', 'member', ca)
  ON CONFLICT (id) DO UPDATE SET full_name='INS_TEST_MEMBER_A', role='member', company_id=EXCLUDED.company_id;
  INSERT INTO public.profiles (id, full_name, role, company_id)
    VALUES (ub, 'INS_TEST_ADMIN_B', 'admin', cb)
  ON CONFLICT (id) DO UPDATE SET full_name='INS_TEST_ADMIN_B', role='admin', company_id=EXCLUDED.company_id;

  INSERT INTO i_ids VALUES ('ca',ca),('cb',cb),('va',va),('vb',vb),
                           ('admin',ua),('member',um),('badmin',ub);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.id(k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM i_ids WHERE k = $1 $$;

CREATE TEMP TABLE IF NOT EXISTS i_res (code text PRIMARY KEY, ok boolean, detail text);

CREATE OR REPLACE FUNCTION pg_temp.chk(p_code text, p_ok boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO i_res VALUES (p_code, p_ok, p_detail)
  ON CONFLICT (code) DO UPDATE SET ok = EXCLUDED.ok, detail = EXCLUDED.detail;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.login(p_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid::text)::text, true); END $$;

CREATE OR REPLACE FUNCTION pg_temp.logout() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '', true); END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- A · INSIGHT OKUMA — FAIL-CLOSED + TENANT
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE n integer;
BEGIN
  PERFORM pg_temp.logout();
  SELECT count(*) INTO n FROM public.list_fleet_insights(50);
  PERFORM pg_temp.chk('A1', n = 0, format('oturumsuz icgoru=%s (0 olmali)', n));
END $$;

-- A2: gerçek içgörü + kanıt kur, sonra oku
DO $$
DECLARE ins uuid; ev uuid;
BEGIN
  /* ÖLÇÜLDÜ: motor `ACTIVE` içgörüyü KANITSIZ yayımlatmıyor
     (`_fleet_insight_evidence_guard` → FLEET_INSIGHT_WITHOUT_EVIDENCE).
     Bu DOĞRU davranıştır; fikstür de gerçek sırayı izler:
     DRAFT → kanıt bağla → ACTIVE. */
  INSERT INTO public.fleet_insight
    (company_id, type, source, state, confidence, subject_kind, subject_id,
     window_start, window_end, expires_at, unknown_reason)
  VALUES (pg_temp.id('ca'), 'FUEL_OUTLIER', 'TRIP_METRICS', 'DRAFT', 'MEDIUM',
          'VEHICLE', pg_temp.id('va'),
          now() - interval '7 days', now(), now() + interval '7 days',
          'SINGLE_VEHICLE_ONLY')
  RETURNING id INTO ins;

  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'), 'TRIP_ENGINE', 'FUEL', 'fuel_per_100km',
    pg_temp.id('va'), NULL, NULL, 'WARNING', 'MEASURED', 12.5, 8,
    now(), interval '30 days');
  SELECT id INTO ev FROM public.ai_evidence
   WHERE company_id = pg_temp.id('ca') AND metric = 'fuel_per_100km';

  /* ÖLÇÜLDÜ: `fleet_insight_evidence` `ai_evidence`'a FK ile BAĞLI DEĞİL —
     kendi defteridir (kind · ref_id · metric · value · provenance). */
  /* ÖLÇÜLDÜ: `_fleet_insight_evidence_guard` ACTIVE için EN AZ 3 kanıt ister
     (tek gözlemden "filo içgörüsü" yayımlanmasın diye). Fikstür bu gerçek
     eşiğe uyar — eşik GEVŞETİLMEZ. */
  INSERT INTO public.fleet_insight_evidence
    (insight_id, kind, ref_id, metric, value, provenance)
  VALUES
    (ins, 'VEHICLE', pg_temp.id('va')::text, 'fuel_per_100km', 12.5, 'MEASURED'),
    (ins, 'METRIC',  'fleet_avg_fuel',       'fuel_per_100km',  9.1, 'DERIVED'),
    (ins, 'TRIP',    'trip-sample-1',        'distance_km',    42.0, 'MEASURED')
  ON CONFLICT DO NOTHING;

  /* AI Evidence bağı AYRI yoldan: ai_evidence_chain. */
  INSERT INTO public.ai_evidence_chain (evidence_id, consumer, consumer_id)
  VALUES (ev, 'FLEET_INSIGHT', ins::text) ON CONFLICT DO NOTHING;

  -- Kanıt bağlandı → artık yayımlanabilir.
  UPDATE public.fleet_insight SET state = 'ACTIVE' WHERE id = ins;

  INSERT INTO i_ids VALUES ('ins', ins) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
  INSERT INTO i_ids VALUES ('ev', ev)  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
END $$;

DO $$
DECLARE r record;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('admin'));
  SELECT * INTO r FROM public.list_fleet_insights(50) LIMIT 1;
  PERFORM pg_temp.chk('A2',
    r.insight_id = pg_temp.id('ins') AND r.type = 'FUEL_OUTLIER'
    AND r.unknown_reason = 'SINGLE_VEHICLE_ONLY',
    format('tip=%s sinir=%s', r.type, r.unknown_reason));
END $$;

-- A3: B şirketi A'nın içgörüsünü GÖREMEZ
DO $$
DECLARE n integer;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('badmin'));
  SELECT count(*) INTO n FROM public.list_fleet_insights(50);
  PERFORM pg_temp.chk('A3', n = 0, format('B nin gordugu icgoru=%s (0 olmali)', n));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- B · KANIT ZİNCİRİ
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE n integer; d text;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('admin'));
  SELECT count(*) INTO n FROM public.get_fleet_insight_chain(pg_temp.id('ins'))
   WHERE direction IN ('LEDGER','EVIDENCE');
  SELECT direction INTO d FROM public.get_fleet_insight_chain(pg_temp.id('ins')) LIMIT 1;
  PERFORM pg_temp.chk('B1', n >= 2, format('ileri yon kanit=%s ilk yon=%s', n, coalesce(d,'YOK')));
END $$;

-- B2: cross-tenant zincir KAPALI
DO $$
DECLARE n integer;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('badmin'));
  SELECT count(*) INTO n FROM public.get_fleet_insight_chain(pg_temp.id('ins'));
  PERFORM pg_temp.chk('B2', n = 0, format('B nin gordugu zincir=%s (0 olmali)', n));
END $$;

-- B3: kanıtsız içgörü SAHTE zincir üretmez
DO $$
DECLARE ins2 uuid; n integer;
BEGIN
  INSERT INTO public.fleet_insight
    (company_id, type, source, state, confidence, subject_kind,
     window_start, window_end, expires_at, unknown_reason)
  VALUES (pg_temp.id('ca'), 'IDLE_PATTERN', 'FLEET_AGGREGATE', 'DRAFT', 'UNKNOWN', 'FLEET',
          now() - interval '3 days', now(), now() + interval '3 days', 'NO_EVIDENCE')
  RETURNING id INTO ins2;

  PERFORM pg_temp.login(pg_temp.id('admin'));
  SELECT count(*) INTO n FROM public.get_fleet_insight_chain(ins2);
  PERFORM pg_temp.chk('B3', n = 0, format('kanitsiz icgoru zinciri=%s (0 olmali)', n));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- C · ARAÇ-KAPSAMLI AI İZNİ
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE res text; r record;
BEGIN
  -- Temiz başlangıç
  DELETE FROM public.ai_gateway_access WHERE company_id = pg_temp.id('ca');
  INSERT INTO public.feature_flags (key, name, description, enabled, rollout_percent, target_scope)
  VALUES ('mavi_ai_gateway','AI Gateway','ana salter', true, 100, 'all')
  ON CONFLICT (key) DO UPDATE SET enabled = true;

  PERFORM pg_temp.login(pg_temp.id('admin'));
  res := public.set_ai_gateway_access(true, pg_temp.id('va'), 'kademeli');
  SELECT * INTO r FROM public.get_ai_gateway_access();
  -- Arac izni SIRKET iznini SESSIZCE globallestirmemeli.
  PERFORM pg_temp.chk('C1',
    res = 'GRANTED' AND r.vehicle_grant_count = 1
    AND r.company_granted = false AND r.effective = true,
    format('sonuc=%s aracIzni=%s sirketIzni=%s etkin=%s',
           res, r.vehicle_grant_count, r.company_granted, r.effective));
END $$;

-- C2: member araç izni VEREMEZ
DO $$
DECLARE res text;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('member'));
  res := public.set_ai_gateway_access(true, pg_temp.id('va'), 'member_deneme');
  PERFORM pg_temp.chk('C2', res = 'DENIED_ROLE', format('member sonucu=%s', res));
END $$;

-- C3: A admini B'nin aracına izin VEREMEZ
DO $$
DECLARE res text;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('admin'));
  res := public.set_ai_gateway_access(true, pg_temp.id('vb'), 'cross');
  PERFORM pg_temp.chk('C3', res = 'DENIED_VEHICLE_SCOPE', format('sonuc=%s', res));
END $$;

-- C4: araç izni geri alınınca etkin ANINDA kapanır
DO $$
DECLARE res text; r record;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('admin'));
  res := public.set_ai_gateway_access(false, pg_temp.id('va'), 'revoke');
  SELECT * INTO r FROM public.get_ai_gateway_access();
  PERFORM pg_temp.chk('C4',
    res = 'REVOKED' AND r.vehicle_grant_count = 0 AND r.effective = false,
    format('sonuc=%s aracIzni=%s etkin=%s', res, r.vehicle_grant_count, r.effective));
END $$;

-- C5: araç izni denetime yazılır
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.ai_gateway_audit
   WHERE company_id = pg_temp.id('ca') AND vehicle_id = pg_temp.id('va');
  PERFORM pg_temp.chk('C5', n >= 2, format('arac kapsamli denetim kaydi=%s (>=2)', n));
END $$;

-- C6: ana şalter kapanınca araç izni de ETKİSİZ
DO $$
DECLARE r record;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('admin'));
  PERFORM public.set_ai_gateway_access(true, pg_temp.id('va'), 'yeniden');
  UPDATE public.feature_flags SET enabled = false WHERE key = 'mavi_ai_gateway';
  SELECT * INTO r FROM public.get_ai_gateway_access();
  PERFORM pg_temp.chk('C6',
    r.vehicle_grant_count = 1 AND r.effective = false,
    format('aracIzni=%s etkin=%s (salter kapali → etkin FALSE)',
           r.vehicle_grant_count, r.effective));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- D · ANON KAPALI
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM information_schema.role_routine_grants
   WHERE grantee = 'anon'
     AND routine_name IN ('list_fleet_insights','get_fleet_insight_chain');
  PERFORM pg_temp.chk('D1', n = 0, format('anon EXECUTE=%s (0 olmali)', n));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
SELECT code, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS sonuc, detail
  FROM i_res ORDER BY code;
SELECT count(*) FILTER (WHERE ok) AS pass,
       count(*) FILTER (WHERE NOT ok) AS fail, count(*) AS toplam FROM i_res;
