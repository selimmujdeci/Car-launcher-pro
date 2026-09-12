-- =====================================================================
-- local_rls_matrix.sql — GERÇEK RLS / PRIVILEGE MATRİSİ.
--
-- Policy METNİ okumaz. Her kombinasyon için GERÇEK SQL çalıştırır:
-- rol değiştirilir (`SET LOCAL ROLE`), JWT claim'i taklit edilir
-- (`request.jwt.claims` — `auth.uid()` bunu okur), operasyon denenir,
-- SQLSTATE ve satır sayısı kaydedilir.
--
-- Her deneme kendi SAVEPOINT'inde koşar → yazma testleri veriyi kalıcı
-- kirletmez, bir hata sonraki testi düşürmez.
--
-- Sonuç kodları:
--   ALLOW · DENY_GRANT · DENY_RLS · DENY_FUNCTION · DENY_VALIDATION
--   DENY_OWNERSHIP · DENY_LAST_ADMIN · DENY_CROSS_TENANT · ERROR
-- =====================================================================

\set ON_ERROR_STOP on

CREATE TEMP TABLE matrix (
  seq        serial,
  actor      text,
  target     text,
  op         text,
  expected   text,
  actual     text,
  rows_seen  int,
  sqlstate   text,
  detail     text
);

-- ── Aktör tanımları ──────────────────────────────────────────────────
CREATE TEMP TABLE actors (name text PRIMARY KEY, db_role text, uid uuid);
INSERT INTO actors VALUES
  ('anon',            'anon',          NULL),
  ('admin_alfa',      'authenticated', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('admin2_alfa',     'authenticated', 'aaaaaaaa-0000-0000-0000-000000000004'),
  ('member_alfa',     'authenticated', 'aaaaaaaa-0000-0000-0000-000000000002'),
  ('observer_alfa',   'authenticated', 'aaaaaaaa-0000-0000-0000-000000000003'),
  ('admin_beta',      'authenticated', 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('individual',      'authenticated', 'cccccccc-0000-0000-0000-000000000001'),
  ('individual2',     'authenticated', 'cccccccc-0000-0000-0000-000000000002'),
  ('service_role',    'service_role',  NULL);

/**
 * Tek denemeyi koşar ve sonucu sınıflandırır.
 *
 * FAIL-CLOSED SINIFLANDIRMA: tanınmayan hata `ERROR` olur, ASLA "izin
 * verildi" veya "reddedildi" varsayılmaz — belirsizlik gizlenmez.
 */
CREATE OR REPLACE FUNCTION pg_temp.try_as(
  p_actor    text,
  p_target   text,
  p_op       text,
  p_expected text,
  p_sql      text
) RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_role    text;
  v_uid     uuid;
  v_rows    int := NULL;
  v_state   text := NULL;
  v_msg     text := NULL;
  v_actual  text;
BEGIN
  SELECT db_role, uid INTO v_role, v_uid FROM actors WHERE name = p_actor;

  BEGIN
    -- Kimlik: JWT claim'i (auth.uid() BUNU okur — argümandan DEĞİL).
    IF v_uid IS NULL THEN
      PERFORM set_config('request.jwt.claims', json_build_object('role', v_role)::text, true);
    ELSE
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_uid::text, 'role', v_role)::text, true);
    END IF;

    EXECUTE format('SET LOCAL ROLE %I', v_role);

    EXECUTE p_sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    -- 🔴 YAN ETKİYİ GERİ AL.
    -- Postgres'te plpgsql bloğu ancak İSTİSNA ile geri alınır (savepoint yok).
    -- Bu yüzden başarılı deneme bilerek bir istisnayla sonlandırılır: bu bloğun
    -- yaptığı TÜM yazmalar geri alınır, ölçüm ise istisna mesajıyla dışarı taşınır.
    --
    -- NEDEN ZORUNLU: ilk sürümde başarılı yazmalar KALICIYDI. Bir `member`
    -- kendi rolünü `admin` yapabildiğinde sonraki testler onu admin sanıyor,
    -- matris kendi kendini kirletip YANLIŞ "ALLOW" üretiyordu.
    RAISE EXCEPTION 'PROBE_OK:%', COALESCE(v_rows, -1) USING ERRCODE = 'P0001';

  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_state := SQLSTATE;
    v_msg   := SQLERRM;

    -- Kendi geri-alma sinyalimiz: deneme BAŞARILIYDI.
    IF v_msg LIKE 'PROBE_OK:%' THEN
      v_rows  := NULLIF(substring(v_msg FROM 10), '-1')::int;
      v_state := NULL;
      v_msg   := NULL;
      -- SIFIR satır etkilendi = RLS süzdü (GRANT vardı, satır görünmedi).
      -- UPDATE/DELETE için de geçerli: "0 satır güncellendi" izin verildiği
      -- ANLAMINA GELMEZ — hiçbir şey değişmemiştir.
      IF v_rows IS NULL OR (v_rows = 0 AND p_op IN ('SELECT','UPDATE','DELETE')) THEN
        v_actual := 'DENY_RLS';
      ELSE
        v_actual := 'ALLOW';
      END IF;

      INSERT INTO matrix (actor, target, op, expected, actual, rows_seen, sqlstate, detail)
      VALUES (p_actor, p_target, p_op, p_expected, v_actual, v_rows, NULL, '');
      RETURN;
    END IF;

    v_actual := CASE
      -- Fonksiyon EXECUTE reddi ile tablo GRANT reddi AYRI raporlanır.
      WHEN v_state = '42501' AND v_msg ILIKE '%function%'        THEN 'DENY_FUNCTION'
      WHEN v_state = '42501' AND v_msg ILIKE '%row-level security%' THEN 'DENY_RLS'
      WHEN v_state = '42501'                                     THEN 'DENY_GRANT'
      WHEN v_state = '42883'                                     THEN 'DENY_FUNCTION'
      -- RPC'lerin typed RAISE'leri (fail-closed sözleşmesi).
      WHEN v_msg ILIKE '%last_admin%'                            THEN 'DENY_LAST_ADMIN'
      -- Kiracı sınırı ihlali: hedef BAŞKA şirkete ait ya da çağıran o
      -- şirketin yöneticisi değil. Sahiplik reddinden AYRI tutulur.
      WHEN v_msg ILIKE '%not_company_admin%'
        OR v_msg ILIKE '%permission_denied%'
        OR v_msg ILIKE '%user_belongs_to_another_company%'
        OR v_msg ILIKE '%vehicle_in_another_company%'             THEN 'DENY_CROSS_TENANT'
      -- Sahiplik reddi: araç başka KULLANICIYA ait ya da sahipsiz.
      WHEN v_msg ILIKE '%owned_by_another%'
        OR v_msg ILIKE '%vehicle_not_owned%'
        OR v_msg ILIKE '%vehicle_has_no_owner%'
        OR v_msg ILIKE '%unowned%'                               THEN 'DENY_OWNERSHIP'
      WHEN v_msg ILIKE '%invalid%'
        OR v_msg ILIKE '%not_found%'
        OR v_msg ILIKE '%unauthenticated%'
        OR v_msg ILIKE '%already_member%'
        OR v_msg ILIKE '%cannot_modify_self%'                    THEN 'DENY_VALIDATION'
      ELSE 'ERROR'
    END;
  END;

  INSERT INTO matrix (actor, target, op, expected, actual, rows_seen, sqlstate, detail)
  VALUES (p_actor, p_target, p_op, p_expected, v_actual, v_rows, v_state, left(COALESCE(v_msg,''), 120));
END;
$fn$;

/** Geriye uyumluluk sarmalayıcısı — tüm izolasyon `try_as` içindedir. */
CREATE OR REPLACE FUNCTION pg_temp.probe(
  p_actor text, p_target text, p_op text, p_expected text, p_sql text
) RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM pg_temp.try_as(p_actor, p_target, p_op, p_expected, p_sql);
END;
$fn$;

-- =====================================================================
-- BÖLÜM A — TABLO ERİŞİMİ
-- =====================================================================

DO $$
DECLARE
  a record;
  v_expected text;
BEGIN
  -- A1. anon HİÇBİR filo tablosunu okuyamamalı.
  --     profiles/companies → 037 sonrası DENY_GRANT.
  --     Diğerleri → GRANT duruyor ama RLS süzer (DENY_RLS).
  PERFORM pg_temp.probe('anon','profiles','SELECT','DENY_GRANT',
    'SELECT * FROM public.profiles');
  PERFORM pg_temp.probe('anon','companies','SELECT','DENY_GRANT',
    'SELECT * FROM public.companies');
  PERFORM pg_temp.probe('anon','vehicles','SELECT','DENY_RLS',
    'SELECT * FROM public.vehicles');
  PERFORM pg_temp.probe('anon','vehicle_pairings','SELECT','DENY_RLS',
    'SELECT * FROM public.vehicle_pairings');
  PERFORM pg_temp.probe('anon','vehicle_linking_codes','SELECT','DENY_RLS',
    'SELECT * FROM public.vehicle_linking_codes');
  PERFORM pg_temp.probe('anon','vehicle_locations','SELECT','DENY_RLS',
    'SELECT * FROM public.vehicle_locations');
  PERFORM pg_temp.probe('anon','vehicle_commands','SELECT','DENY_RLS',
    'SELECT * FROM public.vehicle_commands');
  PERFORM pg_temp.probe('anon','vehicle_events','SELECT','DENY_RLS',
    'SELECT * FROM public.vehicle_events');
  PERFORM pg_temp.probe('anon','vehicle_telemetry','SELECT','DENY_RLS',
    'SELECT * FROM public.vehicle_telemetry');

  -- A2. anon YAZMA — hiçbir tabloya.
  PERFORM pg_temp.probe('anon','profiles','INSERT','DENY_GRANT',
    'INSERT INTO public.profiles(id,role,company_id) VALUES (gen_random_uuid(),''admin'',NULL)');
  PERFORM pg_temp.probe('anon','companies','INSERT','DENY_GRANT',
    'INSERT INTO public.companies(name) VALUES (''Sahte'')');
  PERFORM pg_temp.probe('anon','vehicles','UPDATE','DENY_RLS',
    'UPDATE public.vehicles SET name=''ele geçirildi'' WHERE id=''dddd0001-0000-0000-0000-000000000001''');
  PERFORM pg_temp.probe('anon','vehicles','DELETE','DENY_RLS',
    'DELETE FROM public.vehicles WHERE id=''dddd0001-0000-0000-0000-000000000001''');
  PERFORM pg_temp.probe('anon','vehicle_linking_codes','SELECT','DENY_RLS',
    'SELECT code FROM public.vehicle_linking_codes');

  -- A3. Kendi kapsamını okuma (POZİTİF).
  PERFORM pg_temp.probe('admin_alfa','profiles','SELECT','ALLOW',
    'SELECT * FROM public.profiles WHERE id = auth.uid()');
  PERFORM pg_temp.probe('admin_alfa','companies','SELECT','ALLOW',
    'SELECT * FROM public.companies WHERE id = ''11111111-1111-1111-1111-111111111111''');
  PERFORM pg_temp.probe('admin_alfa','vehicles','SELECT','ALLOW',
    'SELECT * FROM public.vehicles WHERE id = ''dddd0001-0000-0000-0000-000000000001''');
  PERFORM pg_temp.probe('member_alfa','vehicles','SELECT','ALLOW',
    'SELECT * FROM public.vehicles WHERE id = ''dddd0001-0000-0000-0000-000000000001''');
  PERFORM pg_temp.probe('observer_alfa','vehicles','SELECT','ALLOW',
    'SELECT * FROM public.vehicles WHERE id = ''dddd0001-0000-0000-0000-000000000001''');
  PERFORM pg_temp.probe('admin_alfa','vehicle_locations','SELECT','ALLOW',
    'SELECT * FROM public.vehicle_locations WHERE vehicle_id = ''dddd0001-0000-0000-0000-000000000001''');

  -- A4. CROSS-TENANT — Beta admini Alfa verisini GÖREMEZ.
  PERFORM pg_temp.probe('admin_beta','vehicles','SELECT','DENY_RLS',
    'SELECT * FROM public.vehicles WHERE id = ''dddd0001-0000-0000-0000-000000000001''');
  PERFORM pg_temp.probe('admin_beta','companies','SELECT','DENY_RLS',
    'SELECT * FROM public.companies WHERE id = ''11111111-1111-1111-1111-111111111111''');
  PERFORM pg_temp.probe('admin_beta','profiles','SELECT','DENY_RLS',
    'SELECT * FROM public.profiles WHERE id = ''aaaaaaaa-0000-0000-0000-000000000001''');
  PERFORM pg_temp.probe('admin_beta','vehicle_locations','SELECT','DENY_RLS',
    'SELECT * FROM public.vehicle_locations WHERE vehicle_id = ''dddd0001-0000-0000-0000-000000000001''');
  PERFORM pg_temp.probe('admin_beta','vehicle_commands','SELECT','DENY_RLS',
    'SELECT * FROM public.vehicle_commands WHERE vehicle_id = ''dddd0001-0000-0000-0000-000000000001''');
  PERFORM pg_temp.probe('admin_beta','vehicles','UPDATE','DENY_RLS',
    'UPDATE public.vehicles SET name=''çalındı'' WHERE id=''dddd0001-0000-0000-0000-000000000001''');

  -- A5. Bireysel kullanıcı — yalnız KENDİ aracı.
  PERFORM pg_temp.probe('individual','vehicles','SELECT','ALLOW',
    'SELECT * FROM public.vehicles WHERE id = ''dddd0003-0000-0000-0000-000000000003''');
  PERFORM pg_temp.probe('individual2','vehicles','SELECT','DENY_RLS',
    'SELECT * FROM public.vehicles WHERE id = ''dddd0003-0000-0000-0000-000000000003''');
  PERFORM pg_temp.probe('individual2','vehicles','UPDATE','DENY_RLS',
    'UPDATE public.vehicles SET name=''çalındı'' WHERE id=''dddd0003-0000-0000-0000-000000000003''');
  PERFORM pg_temp.probe('individual','vehicles','SELECT','DENY_RLS',
    'SELECT * FROM public.vehicles WHERE id = ''dddd0001-0000-0000-0000-000000000001''');

  -- A6. Sahipsiz araç kimseye görünmez.
  PERFORM pg_temp.probe('admin_alfa','vehicles','SELECT','DENY_RLS',
    'SELECT * FROM public.vehicles WHERE id = ''dddd0004-0000-0000-0000-000000000004''');
  PERFORM pg_temp.probe('individual','vehicles','SELECT','DENY_RLS',
    'SELECT * FROM public.vehicles WHERE id = ''dddd0004-0000-0000-0000-000000000004''');

  -- A7. YETKİ YÜKSELTME — kullanıcı KENDİ rolünü admin YAPAMAZ.
  -- Migration 038 öncesi bu GERÇEKTEN mümkündü (matris ölçtü: ALLOW, 1 satır).
  -- 038 sonrası kolon-düzeyi UPDATE grant'i olmadığı için DENY_GRANT.
  PERFORM pg_temp.probe('member_alfa','profiles','UPDATE','DENY_GRANT',
    'UPDATE public.profiles SET role=''admin'' WHERE id=''aaaaaaaa-0000-0000-0000-000000000002''');
  PERFORM pg_temp.probe('observer_alfa','profiles','UPDATE','DENY_GRANT',
    'UPDATE public.profiles SET role=''admin'' WHERE id=''aaaaaaaa-0000-0000-0000-000000000003''');
  -- Başka şirkete kendini taşıyamaz.
  PERFORM pg_temp.probe('member_alfa','profiles','UPDATE','DENY_GRANT',
    'UPDATE public.profiles SET company_id=''22222222-2222-2222-2222-222222222222'' WHERE id=''aaaaaaaa-0000-0000-0000-000000000002''');
  -- Başkasının profilini de değiştiremez.
  PERFORM pg_temp.probe('member_alfa','profiles','UPDATE','DENY_GRANT',
    'UPDATE public.profiles SET role=''admin'' WHERE id=''aaaaaaaa-0000-0000-0000-000000000001''');
  -- POZİTİF: zararsız kolon HÂLÂ güncellenebilir (038 ürünü kırmamalı).
  PERFORM pg_temp.probe('member_alfa','profiles','UPDATE','ALLOW',
    'UPDATE public.profiles SET full_name=''Yeni Ad'' WHERE id=''aaaaaaaa-0000-0000-0000-000000000002''');

  -- A8. Eşleştirme kodu HİÇBİR istemciye görünmez (yalnız RPC).
  PERFORM pg_temp.probe('admin_alfa','vehicle_linking_codes','SELECT','DENY_RLS',
    'SELECT code FROM public.vehicle_linking_codes');
  PERFORM pg_temp.probe('individual','vehicle_linking_codes','SELECT','DENY_RLS',
    'SELECT code FROM public.vehicle_linking_codes');

  -- A9. service_role — sunucu tarafı tam erişim (BYPASSRLS).
  PERFORM pg_temp.probe('service_role','profiles','SELECT','ALLOW',
    'SELECT * FROM public.profiles');
  PERFORM pg_temp.probe('service_role','vehicles','SELECT','ALLOW',
    'SELECT * FROM public.vehicles');
END $$;

-- =====================================================================
-- BÖLÜM B — RPC (EXECUTE) MATRİSİ
-- =====================================================================

DO $$
BEGIN
  -- B1. anon HİÇBİR filo RPC'sini çağıramaz.
  PERFORM pg_temp.probe('anon','create_company','EXECUTE','DENY_FUNCTION',
    'SELECT public.create_company(''Sahte Filo'')');
  PERFORM pg_temp.probe('anon','add_company_member','EXECUTE','DENY_FUNCTION',
    'SELECT public.add_company_member(''cccccccc-0000-0000-0000-000000000002''::uuid, ''member'')');
  PERFORM pg_temp.probe('anon','list_company_members','EXECUTE','DENY_FUNCTION',
    'SELECT public.list_company_members()');
  PERFORM pg_temp.probe('anon','list_company_vehicles','EXECUTE','DENY_FUNCTION',
    'SELECT public.list_company_vehicles()');
  PERFORM pg_temp.probe('anon','update_member_role','EXECUTE','DENY_FUNCTION',
    'SELECT public.update_member_role(''aaaaaaaa-0000-0000-0000-000000000002''::uuid, ''admin'')');
  PERFORM pg_temp.probe('anon','remove_company_member','EXECUTE','DENY_FUNCTION',
    'SELECT public.remove_company_member(''aaaaaaaa-0000-0000-0000-000000000002''::uuid)');
  PERFORM pg_temp.probe('anon','assign_vehicle_to_company','EXECUTE','DENY_FUNCTION',
    'SELECT public.assign_vehicle_to_company(''dddd0003-0000-0000-0000-000000000003''::uuid)');
  PERFORM pg_temp.probe('anon','pair_vehicle_to_user','EXECUTE','DENY_FUNCTION',
    'SELECT public.pair_vehicle_to_user(''CODE-ALFA'', ''cccccccc-0000-0000-0000-000000000002''::uuid)');

  -- B2. authenticated → pair_vehicle_to_user YASAK (034 REVOKE etti).
  PERFORM pg_temp.probe('individual2','pair_vehicle_to_user','EXECUTE','DENY_FUNCTION',
    'SELECT public.pair_vehicle_to_user(''CODE-ALFA'', ''cccccccc-0000-0000-0000-000000000002''::uuid)');

  -- B3. Okuma RPC'leri — üye okur, cross-tenant sızdırmaz.
  PERFORM pg_temp.probe('admin_alfa','list_company_members','EXECUTE','ALLOW',
    'SELECT public.list_company_members()');
  PERFORM pg_temp.probe('member_alfa','list_company_members','EXECUTE','ALLOW',
    'SELECT public.list_company_members()');
  PERFORM pg_temp.probe('observer_alfa','list_company_vehicles','EXECUTE','ALLOW',
    'SELECT public.list_company_vehicles()');

  -- B4. YAZMA RPC'leri — YALNIZ admin.
  PERFORM pg_temp.probe('member_alfa','update_member_role','EXECUTE','DENY_CROSS_TENANT',
    'SELECT public.update_member_role(''aaaaaaaa-0000-0000-0000-000000000003''::uuid, ''admin'')');
  PERFORM pg_temp.probe('observer_alfa','update_member_role','EXECUTE','DENY_CROSS_TENANT',
    'SELECT public.update_member_role(''aaaaaaaa-0000-0000-0000-000000000002''::uuid, ''admin'')');
  PERFORM pg_temp.probe('observer_alfa','remove_company_member','EXECUTE','DENY_CROSS_TENANT',
    'SELECT public.remove_company_member(''aaaaaaaa-0000-0000-0000-000000000002''::uuid)');
  PERFORM pg_temp.probe('member_alfa','remove_company_member','EXECUTE','DENY_CROSS_TENANT',
    'SELECT public.remove_company_member(''aaaaaaaa-0000-0000-0000-000000000003''::uuid)');
  PERFORM pg_temp.probe('observer_alfa','assign_vehicle_to_company','EXECUTE','DENY_CROSS_TENANT',
    'SELECT public.assign_vehicle_to_company(''dddd0003-0000-0000-0000-000000000003''::uuid)');

  -- B5. CROSS-TENANT RPC — Beta admini Alfa üyesine dokunamaz.
  PERFORM pg_temp.probe('admin_beta','update_member_role','EXECUTE','DENY_CROSS_TENANT',
    'SELECT public.update_member_role(''aaaaaaaa-0000-0000-0000-000000000002''::uuid, ''observer'')');
  PERFORM pg_temp.probe('admin_beta','remove_company_member','EXECUTE','DENY_CROSS_TENANT',
    'SELECT public.remove_company_member(''aaaaaaaa-0000-0000-0000-000000000002''::uuid)');

  -- B6. SON ADMIN KORUMASI — kendi rolünü düşüremez / kendini çıkaramaz.
  PERFORM pg_temp.probe('admin_alfa','update_member_role','EXECUTE','DENY_VALIDATION',
    'SELECT public.update_member_role(''aaaaaaaa-0000-0000-0000-000000000001''::uuid, ''member'')');

  -- B7. SAHİPSİZ araç filoya ATANAMAZ (admin id bilse bile).
  PERFORM pg_temp.probe('admin_alfa','assign_vehicle_to_company','EXECUTE','DENY_OWNERSHIP',
    'SELECT public.assign_vehicle_to_company(''dddd0004-0000-0000-0000-000000000004''::uuid)');

  -- B8. BAŞKASININ aracı filoya ATANAMAZ.
  PERFORM pg_temp.probe('admin_alfa','assign_vehicle_to_company','EXECUTE','DENY_OWNERSHIP',
    'SELECT public.assign_vehicle_to_company(''dddd0003-0000-0000-0000-000000000003''::uuid)');
  -- Beta admini Alfa aracını atamaya çalışır: araç BAŞKA ŞİRKETE ait →
  -- kiracı sınırı reddi (sahiplik reddi değil).
  PERFORM pg_temp.probe('admin_beta','assign_vehicle_to_company','EXECUTE','DENY_CROSS_TENANT',
    'SELECT public.assign_vehicle_to_company(''dddd0001-0000-0000-0000-000000000001''::uuid)');

  -- B9. Zaten şirketi olan kullanıcı yeni şirket KURAMAZ.
  PERFORM pg_temp.probe('admin_alfa','create_company','EXECUTE','DENY_VALIDATION',
    'SELECT public.create_company(''İkinci Filo'')');
END $$;

-- =====================================================================
-- BÖLÜM C — SECURITY DEFINER HİJYENİ
-- =====================================================================

\echo ''
\echo '== C. SECURITY DEFINER hijyeni (search_path sabit mi) =='
SELECT
  p.proname AS fonksiyon,
  p.prosecdef AS security_definer,
  COALESCE(array_to_string(p.proconfig, ', '), '(YOK)') AS config,
  CASE
    WHEN NOT p.prosecdef THEN 'PASS (invoker)'
    WHEN p.proconfig IS NOT NULL
     AND array_to_string(p.proconfig,',') ILIKE '%search_path%' THEN 'PASS'
    ELSE '🔴 FAIL — sabit search_path YOK'
  END AS sonuc
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'create_company','add_company_member','update_member_role','remove_company_member',
    'assign_vehicle_to_company','remove_vehicle_from_company','update_company',
    'delete_company','list_company_members','list_company_vehicles','current_membership',
    'pair_vehicle_to_user','handle_new_user'
  )
ORDER BY p.proname;

\echo ''
\echo '== C2. anon/PUBLIC EXECUTE sızıntısı (beklenen: 0 satır) =='
SELECT p.proname, r.rolname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL (VALUES ('anon'),('public')) AS r(rolname)
WHERE n.nspname='public'
  AND p.proname IN (
    'create_company','add_company_member','update_member_role','remove_company_member',
    'assign_vehicle_to_company','remove_vehicle_from_company','update_company',
    'delete_company','list_company_members','list_company_vehicles','pair_vehicle_to_user'
  )
  AND has_function_privilege(r.rolname, p.oid, 'EXECUTE');

-- =====================================================================
-- SONUÇ
-- =====================================================================

\echo ''
\echo '== MATRİS SONUÇLARI =='
SELECT
  CASE WHEN actual = expected THEN 'PASS' ELSE '🔴 FAIL' END AS s,
  actor, target, op, expected, actual, COALESCE(rows_seen::text,'-') AS rows, sqlstate
FROM matrix
ORDER BY seq;

\echo ''
\echo '== ÖZET =='
SELECT
  count(*) FILTER (WHERE actual = expected) AS pass,
  count(*) FILTER (WHERE actual <> expected) AS fail,
  count(*) AS toplam
FROM matrix;

\echo ''
\echo '== 🔴 BEKLENMEYEN SONUÇLAR (boş olmalı) =='
SELECT actor, target, op, expected, actual, detail
FROM matrix WHERE actual <> expected ORDER BY seq;

\echo ''
\echo '== 🔴 BEKLENMEYEN ALLOW (güvenlik ihlali — kesinlikle boş olmalı) =='
SELECT actor, target, op, expected, actual
FROM matrix WHERE actual = 'ALLOW' AND expected <> 'ALLOW' ORDER BY seq;
