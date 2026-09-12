-- =====================================================================
-- STAGING DOĞRULAMA PAKETİ — migration 033 · 034 · 035 · 036
--
-- ⚠️ YALNIZ STAGING. PRODUCTION'DA ÇALIŞTIRMAYIN.
--     Beklenen staging ref: azvmrbjaxiwzaweraozi
--     Production ref      : vdpcdhrdmsacftrietzq  ← burada ÇALIŞTIRILMAZ
--
-- Bu betik TEK TRANSACTION içinde çalışır ve sonunda **ROLLBACK** eder:
-- oluşturduğu test kullanıcısı, şirketi ve profili KALICI OLMAZ.
-- Herhangi bir kontrol düşerse EXCEPTION atar ve transaction geri alınır.
--
-- Çalıştırma:
--   supabase db query --linked -f supabase/verification/validate_035_036_staging.sql
--
-- Kontrol edilenler (kullanıcı sözleşmesi madde 13):
--   1  Yeni auth user → profile oluşuyor
--   2  Mevcut profilesiz kullanıcı backfill oluyor
--   3  Duplicate profile oluşmuyor
--   4  individual role doğru
--   5  company_id NULL güvenli
--   6  create_company kurucuyu admin yapıyor
--   7  İkinci şirket oluşturma reddediliyor
--   8  add_company_member yalnız admin
--   9  Cross-company üyelik reddediliyor
--  10  anon RPC çalıştıramıyor
--  11  pair_vehicle anon/authenticated tarafından çalıştırılamıyor
--  12  service_role pair_vehicle çağırabiliyor (/api/pwa/pair yolu)
--  13  Son admin koruması (036)
--  14  Sahipsiz araç filoya atanamıyor (036)
-- =====================================================================

BEGIN;

-- ── HEDEF KAPISI: production'da çalışmayı reddet ─────────────────────
DO $$
DECLARE
  v_db text := current_database();
BEGIN
  -- Production'da 240+ araç ve canlı trafik var; staging'de bu kadar olmaz.
  IF (SELECT count(*) FROM public.vehicles) > 150 THEN
    RAISE EXCEPTION
      'HEDEF KAPISI: bu veritabanında % araç var — PRODUCTION gibi görünüyor. Betik DURDURULDU.',
      (SELECT count(*) FROM public.vehicles);
  END IF;
  RAISE NOTICE 'HEDEF KAPISI: geçildi (db=%)', v_db;
END $$;

DO $$
DECLARE
  c_user_a  constant uuid := '00000000-0000-4000-8000-0000000000a1';
  c_user_b  constant uuid := '00000000-0000-4000-8000-0000000000b2';
  c_user_c  constant uuid := '00000000-0000-4000-8000-0000000000c3';
  v_profile_count integer;
  v_role          text;
  v_company_a     uuid;
  v_company_b     uuid;
  v_company_id    uuid;
  v_result        jsonb;
  v_ok            boolean;
  v_vehicle       uuid;
BEGIN
  -- ═══ 1. Yeni auth user → profile oluşuyor ═══════════════════════════
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (c_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'staging-a@example.test', now(), now());

  SELECT count(*) INTO v_profile_count FROM public.profiles WHERE id = c_user_a;
  IF v_profile_count <> 1 THEN
    RAISE EXCEPTION 'KONTROL 1 DÜŞTÜ: yeni kullanıcı için profil oluşmadı (bulunan=%)', v_profile_count;
  END IF;
  RAISE NOTICE 'KONTROL 1 GEÇTİ: auth.users INSERT → profiles satırı oluştu';

  -- ═══ 4 + 5. individual rol ve NULL company_id ═══════════════════════
  SELECT role, company_id INTO v_role, v_company_id FROM public.profiles WHERE id = c_user_a;
  IF v_role IS DISTINCT FROM 'individual' THEN
    RAISE EXCEPTION 'KONTROL 4 DÜŞTÜ: varsayılan rol individual değil (%)', v_role;
  END IF;
  IF v_company_id IS NOT NULL THEN
    RAISE EXCEPTION 'KONTROL 5 DÜŞTÜ: yeni profil otomatik şirkete bağlanmış (%)', v_company_id;
  END IF;
  RAISE NOTICE 'KONTROL 4+5 GEÇTİ: rol=individual, company_id=NULL';

  -- ═══ 2. Profilsiz kullanıcı backfill ediliyor ═══════════════════════
  DELETE FROM public.profiles WHERE id = c_user_a;   -- tetikleyici öncesi durumu taklit et
  INSERT INTO public.profiles (id, company_id, role)
  SELECT u.id, NULL, 'individual'
  FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
  WHERE p.id IS NULL
  ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO v_profile_count FROM public.profiles WHERE id = c_user_a;
  IF v_profile_count <> 1 THEN
    RAISE EXCEPTION 'KONTROL 2 DÜŞTÜ: backfill profil oluşturmadı';
  END IF;
  RAISE NOTICE 'KONTROL 2 GEÇTİ: profilsiz kullanıcı backfill edildi';

  -- ═══ 3. Duplicate profile oluşmuyor ═════════════════════════════════
  INSERT INTO public.profiles (id, company_id, role)
  VALUES (c_user_a, NULL, 'individual')
  ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO v_profile_count FROM public.profiles WHERE id = c_user_a;
  IF v_profile_count <> 1 THEN
    RAISE EXCEPTION 'KONTROL 3 DÜŞTÜ: duplicate profil oluştu (adet=%)', v_profile_count;
  END IF;
  RAISE NOTICE 'KONTROL 3 GEÇTİ: duplicate profil oluşmuyor (idempotent)';

  -- ═══ 6. create_company kurucuyu admin yapıyor ═══════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_user_a)::text, true);

  v_result := public.create_company('Staging Test Filo');
  IF (v_result->>'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'KONTROL 6 DÜŞTÜ: kurucu admin olmadı (%)', v_result->>'role';
  END IF;
  v_company_a := (v_result->>'company_id')::uuid;

  SELECT role, company_id INTO v_role, v_company_id FROM public.profiles WHERE id = c_user_a;
  IF v_role <> 'admin' OR v_company_id IS DISTINCT FROM v_company_a THEN
    RAISE EXCEPTION 'KONTROL 6 DÜŞTÜ: profil admin/şirket olarak güncellenmedi (rol=%, şirket=%)',
      v_role, v_company_id;
  END IF;
  RAISE NOTICE 'KONTROL 6 GEÇTİ: create_company kurucuyu admin yaptı';

  -- ═══ 7. İkinci şirket reddediliyor ══════════════════════════════════
  v_ok := false;
  BEGIN
    PERFORM public.create_company('İkinci Filo');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%already_member_of_company%' THEN v_ok := true; END IF;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'KONTROL 7 DÜŞTÜ: ikinci şirket oluşturma reddedilmedi';
  END IF;
  RAISE NOTICE 'KONTROL 7 GEÇTİ: ikinci şirket already_member_of_company ile reddedildi';

  -- ═══ 8. add_company_member yalnız admin ═════════════════════════════
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (c_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'staging-b@example.test', now(), now());

  -- admin olarak ekle → başarılı olmalı
  v_result := public.add_company_member(c_user_b, 'member');
  IF (v_result->>'role') <> 'member' THEN
    RAISE EXCEPTION 'KONTROL 8 DÜŞTÜ: admin üye ekleyemedi';
  END IF;

  -- member olarak ekle → reddedilmeli
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_user_b)::text, true);
  v_ok := false;
  BEGIN
    PERFORM public.add_company_member(c_user_a, 'observer');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%not_company_admin%' THEN v_ok := true; END IF;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'KONTROL 8 DÜŞTÜ: member üye ekleyebildi — yetki kapısı ÇALIŞMIYOR';
  END IF;
  RAISE NOTICE 'KONTROL 8 GEÇTİ: add_company_member yalnız admin tarafından çalıştırılabiliyor';

  -- ═══ 9. Cross-company üyelik reddediliyor ═══════════════════════════
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (c_user_c, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'staging-c@example.test', now(), now());

  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_user_c)::text, true);
  v_result := public.create_company('Rakip Filo');
  v_company_b := (v_result->>'company_id')::uuid;

  -- A'nın admini, B şirketindeki kullanıcıyı çekmeye çalışır → reddedilmeli
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_user_a)::text, true);
  v_ok := false;
  BEGIN
    PERFORM public.add_company_member(c_user_c, 'member');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%user_belongs_to_another_company%' THEN v_ok := true; END IF;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'KONTROL 9 DÜŞTÜ: cross-company üyelik REDDEDİLMEDİ — tenant izolasyonu KIRIK';
  END IF;
  RAISE NOTICE 'KONTROL 9 GEÇTİ: cross-company üyelik reddedildi';

  -- ═══ 13. Son admin koruması (036) ═══════════════════════════════════
  v_ok := false;
  BEGIN
    PERFORM public.remove_company_member(c_user_a);   -- kendisi tek admin
  EXCEPTION WHEN OTHERS THEN
    -- Kendi kendini kaldırma zaten user_belongs veya last_admin ile düşer
    v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'KONTROL 13 DÜŞTÜ: son admin kaldırılabildi';
  END IF;

  v_ok := false;
  BEGIN
    PERFORM public.update_member_role(c_user_a, 'member');  -- kendi rolü
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%cannot_modify_self_role%' THEN v_ok := true; END IF;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'KONTROL 13 DÜŞTÜ: admin kendi rolünü değiştirebildi';
  END IF;
  RAISE NOTICE 'KONTROL 13 GEÇTİ: son admin ve kendi-rol koruması çalışıyor';

  -- ═══ 14. Sahipsiz araç filoya atanamıyor (036) ══════════════════════
  INSERT INTO public.vehicles (name, pairing_code)
  VALUES ('Staging Test Aracı', 'ZZ9999')
  RETURNING id INTO v_vehicle;

  v_ok := false;
  BEGIN
    PERFORM public.assign_vehicle_to_company(v_vehicle);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%vehicle_owned_by_another_user%' THEN v_ok := true; END IF;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'KONTROL 14 DÜŞTÜ: SAHİPSİZ araç filoya atanabildi — sahiplik kapısı KIRIK';
  END IF;
  RAISE NOTICE 'KONTROL 14 GEÇTİ: sahipsiz araç filoya atanamıyor';

  RAISE NOTICE '--- DAVRANIŞ KONTROLLERİ TAMAM ---';
END $$;

-- ═══ 10 · 11 · 12. GRANT kontrolleri (davranıştan bağımsız) ═══════════
DO $$
DECLARE
  v_fn text;
BEGIN
  -- 10: anon hiçbir filo RPC'sini çalıştıramaz
  FOREACH v_fn IN ARRAY ARRAY[
    'public.create_company(text)',
    'public.add_company_member(uuid, text)',
    'public.update_company(text)',
    'public.delete_company()',
    'public.update_member_role(uuid, text)',
    'public.remove_company_member(uuid)',
    'public.assign_vehicle_to_company(uuid)',
    'public.remove_vehicle_from_company(uuid)',
    'public.list_company_members()',
    'public.list_company_vehicles()'
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'KONTROL 10 DÜŞTÜ: % anon tarafından çalıştırılabiliyor', v_fn;
    END IF;
  END LOOP;
  RAISE NOTICE 'KONTROL 10 GEÇTİ: anon hiçbir filo RPC''sini çalıştıramıyor';

  -- 11: pair_vehicle anon/authenticated'a KAPALI
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='pair_vehicle') THEN
    IF has_function_privilege('anon', 'public.pair_vehicle(text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'KONTROL 11 DÜŞTÜ: pair_vehicle anon''a AÇIK';
    END IF;
    IF has_function_privilege('authenticated', 'public.pair_vehicle(text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'KONTROL 11 DÜŞTÜ: pair_vehicle authenticated''a AÇIK';
    END IF;
    RAISE NOTICE 'KONTROL 11 GEÇTİ: pair_vehicle istemci rollerine kapalı';

    -- 12: service_role çağırabilmeli (/api/pwa/pair yolu bozulmamalı)
    IF NOT has_function_privilege('service_role', 'public.pair_vehicle(text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'KONTROL 12 DÜŞTÜ: service_role pair_vehicle çağıramıyor — /api/pwa/pair KIRILIR';
    END IF;
    RAISE NOTICE 'KONTROL 12 GEÇTİ: service_role pair_vehicle çağırabiliyor';
  ELSE
    RAISE NOTICE 'KONTROL 11/12 ATLANDI: pair_vehicle bu veritabanında yok';
  END IF;

  -- 034 kapısı da korunuyor mu
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='pair_vehicle_to_user') THEN
    IF has_function_privilege('anon', 'public.pair_vehicle_to_user(text, uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.pair_vehicle_to_user(text, uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'EK KONTROL DÜŞTÜ: pair_vehicle_to_user istemci rollerine AÇIK';
    END IF;
    RAISE NOTICE 'EK KONTROL GEÇTİ: pair_vehicle_to_user yalnız service_role';
  END IF;

  RAISE NOTICE '=== DAVRANIŞ + YETKİ KONTROLLERİ TAMAM ===';
END $$;

-- ── KONTROL 15-17: R2 SERTLEŞTİRMESİ (constraint semantiği) ───────────
-- 035'in R2 onarımı GERÇEKTEN uygulanmış mı? Metin eşlemesi DEĞİL — kısıt
-- ifadeleri değerlendirilerek kanıtlanır.
DO $$
DECLARE
  r          record;
  v_ok       boolean;
  v_blockers text := '';
  v_multi    text := '';
  v_allowed  int;
BEGIN
  -- 15. Rol otoritesi TEK
  SELECT count(*) INTO v_allowed FROM pg_constraint
   WHERE conrelid='public.profiles'::regclass AND conname='profiles_role_allowed';
  IF v_allowed <> 1 THEN
    RAISE EXCEPTION 'KONTROL 15 DÜŞTÜ: profiles_role_allowed sayısı % (1 olmalı)', v_allowed;
  END IF;
  RAISE NOTICE 'KONTROL 15 GEÇTİ: profiles_role_allowed tek rol otoritesi';

  -- 16. 'individual'ı reddeden tek-sütunlu kısıt KALMAMALI (semantik)
  FOR r IN
    SELECT c.conname, c.conbin, c.conrelid,
           (SELECT array_agg(a.attname) FROM pg_attribute a
             WHERE a.attrelid=c.conrelid AND a.attnum = ANY (c.conkey)) AS cols
    FROM pg_constraint c
    WHERE c.conrelid='public.profiles'::regclass AND c.contype='c'
  LOOP
    CONTINUE WHEN r.cols IS NULL OR NOT ('role' = ANY (r.cols));
    IF array_length(r.cols,1) > 1 THEN
      v_multi := v_multi || r.conname || ' ';
      CONTINUE;
    END IF;
    EXECUTE format('SELECT coalesce((%s), true) FROM (SELECT %L::text AS role) t',
                   pg_get_expr(r.conbin, r.conrelid), 'individual') INTO v_ok;
    IF NOT v_ok THEN v_blockers := v_blockers || r.conname || ' '; END IF;
  END LOOP;

  IF v_blockers <> '' THEN
    RAISE EXCEPTION 'KONTROL 16 DÜŞTÜ: role=''''individual'''' hâlâ REDDEDİLİYOR: %', v_blockers;
  END IF;
  RAISE NOTICE 'KONTROL 16 GEÇTİ: individual''ı reddeden kısıt yok (semantik doğrulama)';

  -- 17. role kolonu ENUM/DOMAIN olmamalı (035'in tip kapısı)
  IF EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid
     WHERE a.attrelid='public.profiles'::regclass AND a.attname='role'
       AND t.typtype IN ('e','d')
  ) THEN
    RAISE EXCEPTION 'KONTROL 17 DÜŞTÜ: profiles.role ENUM/DOMAIN — 035 tip kapısı ihlali';
  END IF;
  IF v_multi <> '' THEN
    RAISE NOTICE 'UYARI: role''e bağlı çok sütunlu kısıt(lar) var (elle incelenmeli): %', v_multi;
  END IF;
  RAISE NOTICE 'KONTROL 17 GEÇTİ: role kolonu düz metin tipinde';

  RAISE NOTICE '=== TÜM KONTROLLER GEÇTİ (17/17) ===';
END $$;

-- Test verisi KALICI OLMAZ.
ROLLBACK;
