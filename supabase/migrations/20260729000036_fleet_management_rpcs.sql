-- =====================================================================
-- Migration 036: FİLO YÖNETİM RPC'LERİ (üyelik + araç ataması + okuma)
--
-- 035 yalnız `create_company` ve `add_company_member` kurdu. Bu migration
-- ürünün ihtiyaç duyduğu geri kalan sunucu-tarafı yetkilendirmeyi tamamlar.
--
-- ── ANAYASA ──────────────────────────────────────────────────────────
--  · Kimlik YALNIZ `auth.uid()` — istemciden actor user_id KABUL EDİLMEZ.
--  · Yetki her fonksiyonun İÇİNDE doğrulanır (UI görünürlüğü güvenlik değil).
--  · SON ADMIN korunur: kaldırılamaz, rolü düşürülemez.
--  · Cross-tenant erişim fail-closed reddedilir.
--  · SAHİPSİZ araç filoya ATANAMAZ — önce eşleştirme (pairing) gerekir.
--    (Production'da 240 sahipsiz araç var; aksi hâlde bir admin id bilerek
--     bunları filosuna çekebilirdi.)
--  · Observer SALT-OKUNUR: hiçbir yazma RPC'sinden geçemez.
--
-- İDEMPOTENT: CREATE OR REPLACE
-- =====================================================================

-- ── 0. ÖN DOĞRULAMA ───────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='create_company') THEN
    RAISE EXCEPTION '036 ÖN KONTROL: migration 035 uygulanmamış (create_company YOK)';
  END IF;
END $$;

-- ── 1. Ortak yardımcı: çağıranın şirketi + rolü ───────────────────────
-- STABLE + SECURITY DEFINER; yalnız kendi profilini okur.
CREATE OR REPLACE FUNCTION public.current_membership()
RETURNS TABLE (user_id uuid, company_id uuid, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
    SELECT p.id, p.company_id, p.role FROM public.profiles p WHERE p.id = v_uid;
END;
$function$;

-- ── 2. update_company ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_company(p_name text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_co   uuid;
  v_role text;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='P0001'; END IF;

  v_name := btrim(coalesce(p_name, ''));
  IF length(v_name) < 2 OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'invalid_company_name' USING ERRCODE='P0001';
  END IF;

  SELECT company_id, role INTO v_co, v_role FROM public.profiles WHERE id = v_uid;
  IF v_co IS NULL THEN RAISE EXCEPTION 'no_company' USING ERRCODE='P0001'; END IF;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'not_company_admin' USING ERRCODE='P0001';
  END IF;

  UPDATE public.companies SET name = v_name WHERE id = v_co;
  IF NOT FOUND THEN RAISE EXCEPTION 'company_deleted' USING ERRCODE='P0001'; END IF;

  RETURN jsonb_build_object('company_id', v_co, 'name', v_name);
END;
$function$;

-- ── 3. delete_company ─────────────────────────────────────────────────
-- Araçlar SİLİNMEZ; yalnız filodan ayrılır (owner_id korunur).
CREATE OR REPLACE FUNCTION public.delete_company()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_co        uuid;
  v_role      text;
  v_vehicles  integer;
  v_members   integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='P0001'; END IF;

  SELECT company_id, role INTO v_co, v_role FROM public.profiles WHERE id = v_uid;
  IF v_co IS NULL THEN RAISE EXCEPTION 'no_company' USING ERRCODE='P0001'; END IF;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'not_company_admin' USING ERRCODE='P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_co::text, 2));

  UPDATE public.vehicles SET company_id = NULL WHERE company_id = v_co;
  GET DIAGNOSTICS v_vehicles = ROW_COUNT;

  UPDATE public.profiles SET company_id = NULL, role = 'individual' WHERE company_id = v_co;
  GET DIAGNOSTICS v_members = ROW_COUNT;

  DELETE FROM public.companies WHERE id = v_co;

  RETURN jsonb_build_object(
    'company_id', v_co, 'detached_vehicles', v_vehicles, 'released_members', v_members
  );
END;
$function$;

-- ── 4. update_member_role — SON ADMIN KORUMASI ────────────────────────
CREATE OR REPLACE FUNCTION public.update_member_role(p_user_id uuid, p_role text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_co          uuid;
  v_role        text;
  v_target_co   uuid;
  v_target_role text;
  v_admin_count integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='P0001'; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='P0001'; END IF;
  IF p_role NOT IN ('member','observer','admin') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE='P0001';
  END IF;

  SELECT company_id, role INTO v_co, v_role FROM public.profiles WHERE id = v_uid;
  IF v_co IS NULL THEN RAISE EXCEPTION 'no_company' USING ERRCODE='P0001'; END IF;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'not_company_admin' USING ERRCODE='P0001';
  END IF;

  -- Yönetici kendi rolünü değiştiremez (kendini kilitleme kazası).
  IF p_user_id = v_uid THEN
    RAISE EXCEPTION 'cannot_modify_self_role' USING ERRCODE='P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_co::text, 2));

  SELECT company_id, role INTO v_target_co, v_target_role
  FROM public.profiles WHERE id = p_user_id;

  IF v_target_co IS NULL OR v_target_co <> v_co THEN
    RAISE EXCEPTION 'user_belongs_to_another_company' USING ERRCODE='P0001';
  END IF;

  -- SON ADMIN korunur: tek admin varsa rolü düşürülemez.
  IF v_target_role = 'admin' AND p_role <> 'admin' THEN
    SELECT count(*) INTO v_admin_count
    FROM public.profiles WHERE company_id = v_co AND role = 'admin';
    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'last_admin_protected' USING ERRCODE='P0001';
    END IF;
  END IF;

  UPDATE public.profiles SET role = p_role WHERE id = p_user_id;

  RETURN jsonb_build_object('user_id', p_user_id, 'company_id', v_co, 'role', p_role);
END;
$function$;

-- ── 5. remove_company_member — SON ADMIN KORUMASI ─────────────────────
CREATE OR REPLACE FUNCTION public.remove_company_member(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_co          uuid;
  v_role        text;
  v_target_co   uuid;
  v_target_role text;
  v_admin_count integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='P0001'; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='P0001'; END IF;

  SELECT company_id, role INTO v_co, v_role FROM public.profiles WHERE id = v_uid;
  IF v_co IS NULL THEN RAISE EXCEPTION 'no_company' USING ERRCODE='P0001'; END IF;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'not_company_admin' USING ERRCODE='P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_co::text, 2));

  SELECT company_id, role INTO v_target_co, v_target_role
  FROM public.profiles WHERE id = p_user_id;

  IF v_target_co IS NULL OR v_target_co <> v_co THEN
    RAISE EXCEPTION 'user_belongs_to_another_company' USING ERRCODE='P0001';
  END IF;

  IF v_target_role = 'admin' THEN
    SELECT count(*) INTO v_admin_count
    FROM public.profiles WHERE company_id = v_co AND role = 'admin';
    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'last_admin_protected' USING ERRCODE='P0001';
    END IF;
  END IF;

  -- Üye bireysel hâle döner. ARAÇLARI SİLİNMEZ; şirkete ait araçlar şirkette kalır.
  UPDATE public.profiles SET company_id = NULL, role = 'individual' WHERE id = p_user_id;

  RETURN jsonb_build_object('user_id', p_user_id, 'company_id', v_co, 'removed', true);
END;
$function$;

-- ── 6. assign_vehicle_to_company ──────────────────────────────────────
-- SAHİPSİZ araç ATANAMAZ (fail-closed): aracın sahibi ya çağıran ya da
-- aynı şirketin bir üyesi olmalıdır. Aksi hâlde bir admin, id'sini bildiği
-- herhangi bir sahipsiz aracı filosuna çekebilirdi.
CREATE OR REPLACE FUNCTION public.assign_vehicle_to_company(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_co       uuid;
  v_role     text;
  v_owner    uuid;
  v_veh_co   uuid;
  v_owner_co uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='P0001'; END IF;
  IF p_vehicle_id IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='P0001'; END IF;

  SELECT company_id, role INTO v_co, v_role FROM public.profiles WHERE id = v_uid;
  IF v_co IS NULL THEN RAISE EXCEPTION 'no_company' USING ERRCODE='P0001'; END IF;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'not_company_admin' USING ERRCODE='P0001';
  END IF;

  SELECT owner_id, company_id INTO v_owner, v_veh_co
  FROM public.vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_not_found' USING ERRCODE='P0001'; END IF;

  IF v_veh_co IS NOT NULL AND v_veh_co <> v_co THEN
    RAISE EXCEPTION 'vehicle_in_another_company' USING ERRCODE='P0001';
  END IF;

  -- Sahipsiz araç filoya çekilemez — önce pairing şart.
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'vehicle_owned_by_another_user' USING ERRCODE='P0001';
  END IF;

  SELECT company_id INTO v_owner_co FROM public.profiles WHERE id = v_owner;
  IF v_owner <> v_uid AND (v_owner_co IS NULL OR v_owner_co <> v_co) THEN
    RAISE EXCEPTION 'vehicle_owned_by_another_user' USING ERRCODE='P0001';
  END IF;

  UPDATE public.vehicles SET company_id = v_co WHERE id = p_vehicle_id;

  RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'company_id', v_co);
END;
$function$;

-- ── 7. remove_vehicle_from_company ────────────────────────────────────
-- Araç filodan ayrılır; `owner_id` KORUNUR (sahiplik devri değildir).
CREATE OR REPLACE FUNCTION public.remove_vehicle_from_company(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_co     uuid;
  v_role   text;
  v_veh_co uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='P0001'; END IF;
  IF p_vehicle_id IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='P0001'; END IF;

  SELECT company_id, role INTO v_co, v_role FROM public.profiles WHERE id = v_uid;
  IF v_co IS NULL THEN RAISE EXCEPTION 'no_company' USING ERRCODE='P0001'; END IF;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'not_company_admin' USING ERRCODE='P0001';
  END IF;

  SELECT company_id INTO v_veh_co FROM public.vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_not_found' USING ERRCODE='P0001'; END IF;
  IF v_veh_co IS DISTINCT FROM v_co THEN
    RAISE EXCEPTION 'vehicle_in_another_company' USING ERRCODE='P0001';
  END IF;

  UPDATE public.vehicles SET company_id = NULL WHERE id = p_vehicle_id;

  RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'company_id', NULL);
END;
$function$;

-- ── 8. Okuma RPC'leri (member.read / vehicle.read) ────────────────────
CREATE OR REPLACE FUNCTION public.list_company_members()
RETURNS TABLE (user_id uuid, full_name text, role text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_co  uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='P0001'; END IF;
  SELECT company_id INTO v_co FROM public.profiles WHERE id = v_uid;
  IF v_co IS NULL THEN RAISE EXCEPTION 'no_company' USING ERRCODE='P0001'; END IF;

  -- Yalnız KENDİ şirketinin üyeleri — cross-tenant okuma imkânsız.
  RETURN QUERY
    SELECT p.id, p.full_name, p.role, p.created_at
    FROM public.profiles p
    WHERE p.company_id = v_co
    ORDER BY p.created_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_company_vehicles()
RETURNS TABLE (vehicle_id uuid, name text, plate text, owner_id uuid, last_seen timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_co  uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='P0001'; END IF;
  SELECT company_id INTO v_co FROM public.profiles WHERE id = v_uid;
  IF v_co IS NULL THEN RAISE EXCEPTION 'no_company' USING ERRCODE='P0001'; END IF;

  RETURN QUERY
    SELECT v.id, v.name, v.plate, v.owner_id, v.last_seen
    FROM public.vehicles v
    WHERE v.company_id = v_co
    ORDER BY v.created_at;
END;
$function$;

-- ── 9. GRANT ──────────────────────────────────────────────────────────
-- Hepsi kimliği `auth.uid()`'den alır → authenticated'a açılabilir; anon ASLA.
REVOKE ALL ON FUNCTION public.current_membership()                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_company(text)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_company()                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_member_role(uuid, text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_company_member(uuid)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_vehicle_to_company(uuid)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_vehicle_from_company(uuid)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_company_members()                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_company_vehicles()                 FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_membership()              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_company(text)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_company()                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_member_role(uuid, text)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_company_member(uuid)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_vehicle_to_company(uuid)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_vehicle_from_company(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_company_members()            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_company_vehicles()           TO authenticated, service_role;

-- ── 10. DOĞRULAMA ─────────────────────────────────────────────────────
DO $$
DECLARE
  v_fn   text;
  v_miss text;
BEGIN
  SELECT string_agg(f, ', ') INTO v_miss
  FROM (SELECT unnest(ARRAY[
          'current_membership','update_company','delete_company','update_member_role',
          'remove_company_member','assign_vehicle_to_company','remove_vehicle_from_company',
          'list_company_members','list_company_vehicles']) AS f) x
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname = x.f
  );
  IF v_miss IS NOT NULL THEN
    RAISE EXCEPTION '036: oluşmayan fonksiyon(lar): %', v_miss;
  END IF;

  -- anon HİÇBİRİNİ çağıramamalı.
  FOREACH v_fn IN ARRAY ARRAY[
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
      RAISE EXCEPTION '036: % anon''a AÇIK — güvenlik ihlali', v_fn;
    END IF;
  END LOOP;

  RAISE NOTICE '036: filo yönetim RPC''leri kuruldu (son admin korumalı, cross-tenant kapalı)';
END $$;
