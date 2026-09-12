-- =====================================================================
-- postapply_035_validation.sql — 035 UYGULANDIKTAN SONRA ZORUNLU DOĞRULAMA
--
-- SALT-OKUNURDUR: hiçbir şey değiştirmez. Her kontrol düşerse EXCEPTION atar.
-- Sonda "TÜM KONTROLLER GEÇTİ" yazmazsa 035 BAŞARILI SAYILMAZ.
--
-- KULLANIM: psql "<connection>" -f postapply_035_validation.sql
-- =====================================================================

DO $$
DECLARE
  v_blockers text;
  v_multi    text;
  v_orphan   bigint;
  v_allowed  int;
  v_ok       boolean;
  r          record;
BEGIN
  -- 1. Rol otoritesi TEK ve mevcut
  SELECT count(*) INTO v_allowed
  FROM pg_constraint
  WHERE conrelid='public.profiles'::regclass AND conname='profiles_role_allowed';
  IF v_allowed <> 1 THEN
    RAISE EXCEPTION 'KONTROL 1 DÜŞTÜ: profiles_role_allowed sayısı % (1 olmalı)', v_allowed;
  END IF;
  RAISE NOTICE 'KONTROL 1 GEÇTİ: profiles_role_allowed tek otorite';

  -- 2. 'individual'ı REDDEDEN hiçbir tek-sütunlu role kısıtı KALMAMALI
  --    (metin eşlemesi DEĞİL — ifade gerçekten değerlendirilir)
  v_blockers := '';
  FOR r IN
    SELECT c.conname, c.conbin, c.conrelid,
           (SELECT array_agg(a.attname) FROM pg_attribute a
             WHERE a.attrelid=c.conrelid AND a.attnum = ANY (c.conkey)) AS cols
    FROM pg_constraint c
    WHERE c.conrelid='public.profiles'::regclass AND c.contype='c'
  LOOP
    CONTINUE WHEN r.cols IS NULL OR NOT ('role' = ANY (r.cols)) OR array_length(r.cols,1) > 1;
    EXECUTE format('SELECT coalesce((%s), true) FROM (SELECT %L::text AS role) t',
                   pg_get_expr(r.conbin, r.conrelid), 'individual') INTO v_ok;
    IF NOT v_ok THEN v_blockers := v_blockers || r.conname || ' '; END IF;
  END LOOP;
  IF v_blockers <> '' THEN
    RAISE EXCEPTION 'KONTROL 2 DÜŞTÜ: role=''individual'' hâlâ reddediliyor: %', v_blockers;
  END IF;
  RAISE NOTICE 'KONTROL 2 GEÇTİ: individual''ı reddeden kısıt kalmadı';

  -- 3. Çok sütunlu role kısıtı sessizce eklenmemiş olmalı
  SELECT string_agg(c.conname, ', ') INTO v_multi
  FROM pg_constraint c
  WHERE c.conrelid='public.profiles'::regclass AND c.contype='c'
    AND c.conname <> 'profiles_role_allowed'
    AND (SELECT count(*) FROM pg_attribute a
          WHERE a.attrelid=c.conrelid AND a.attnum = ANY (c.conkey)) > 1
    AND EXISTS (SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid=c.conrelid AND a.attnum = ANY (c.conkey) AND a.attname='role');
  IF v_multi IS NOT NULL THEN
    RAISE NOTICE 'UYARI: role''e bağlı çok sütunlu kısıt(lar) duruyor (elle incelenmeli): %', v_multi;
  END IF;

  -- 4. Trigger kuruldu
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgrelid='auth.users'::regclass AND tgname='on_auth_user_created') THEN
    RAISE EXCEPTION 'KONTROL 4 DÜŞTÜ: on_auth_user_created tetikleyicisi YOK';
  END IF;
  RAISE NOTICE 'KONTROL 4 GEÇTİ: signup tetikleyicisi kurulu';

  -- 5. Kök neden kapandı: profilsiz kullanıcı KALMADI
  SELECT count(*) INTO v_orphan
  FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id WHERE p.id IS NULL;
  IF v_orphan > 0 THEN
    RAISE EXCEPTION 'KONTROL 5 DÜŞTÜ: % kullanıcı hâlâ profilsiz', v_orphan;
  END IF;
  RAISE NOTICE 'KONTROL 5 GEÇTİ: profilsiz kullanıcı yok';

  -- 6. pair_vehicle istemci rollerine KAPALI
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='pair_vehicle') THEN
    IF has_function_privilege('anon','public.pair_vehicle(text)','EXECUTE')
       OR has_function_privilege('authenticated','public.pair_vehicle(text)','EXECUTE') THEN
      RAISE EXCEPTION 'KONTROL 6 DÜŞTÜ: pair_vehicle hâlâ istemci rollerine AÇIK';
    END IF;
    IF NOT has_function_privilege('service_role','public.pair_vehicle(text)','EXECUTE') THEN
      RAISE EXCEPTION 'KONTROL 6 DÜŞTÜ: service_role pair_vehicle çağıramıyor — /api/pwa/pair KIRILIR';
    END IF;
    RAISE NOTICE 'KONTROL 6 GEÇTİ: pair_vehicle yalnız service_role';
  ELSE
    RAISE NOTICE 'KONTROL 6 ATLANDI: pair_vehicle bu veritabanında yok';
  END IF;

  -- 7. Geçici probe izleri kalmamalı
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname LIKE '\_m035%') THEN
    RAISE EXCEPTION 'KONTROL 7 DÜŞTÜ: _m035_* geçici nesne kalmış';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles
              WHERE id = '00000000-0000-4000-8000-00000000f035') THEN
    RAISE EXCEPTION 'KONTROL 7 DÜŞTÜ: probe profil satırı kalıcı olmuş';
  END IF;
  RAISE NOTICE 'KONTROL 7 GEÇTİ: kalıcı test izi yok';

  RAISE NOTICE '=== TÜM KONTROLLER GEÇTİ (035 post-apply) ===';
END $$;
