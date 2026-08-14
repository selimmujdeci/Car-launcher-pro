-- ============================================================================
-- local_chain_full_verify.sql — TAM ZİNCİR + 063/064 DOĞRULAMASI
--
-- Bu betik, `supabase/migrations` zincirinin TAMAMI sıfırdan uygulanmış
-- TEMİZ bir veritabanında koşar. Mevcut `local_063_*` / `local_064_*`
-- betiklerinden FARKI: onlar kendi minimal fixture'ını kurar (ve
-- `DROP TABLE vehicle_commands CASCADE` yapar) — bu betik ise GERÇEK zincir
-- şemasının üzerinde ölçüm yapar. Yani "izole ortamda çalışıyor" değil,
-- "zincirin ürettiği şemada çalışıyor" kanıtı üretir.
--
-- Kullanım:
--   1) temiz PG + supabase preamble (roller · auth · storage · varsayılan ACL)
--   2) supabase/migrations/*.sql sırayla
--   3) bu dosya
--
-- Herhangi bir kontrol düşerse EXCEPTION atar — sessiz "geçti" YOKTUR.
-- ============================================================================

-- ── FIXTURE: gerçek kullanıcı/şirket/araç (FK'lar GERÇEK) ──────────────────
DO $fx$
DECLARE
  v_owner   uuid := '11111111-1111-1111-1111-111111111111';
  v_other   uuid := '22222222-2222-2222-2222-222222222222';
  v_co_a    uuid := '33333333-3333-3333-3333-333333333333';
  v_co_b    uuid := '44444444-4444-4444-4444-444444444444';
  v_veh     uuid := '55555555-5555-5555-5555-555555555555';
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_owner,'owner@test.local'), (v_other,'other@test.local')
    ON CONFLICT (id) DO NOTHING;
  -- NOT: kök zincirin `companies` tablosunda `slug` NOT NULL UNIQUE'tir
  -- (20260421000000_initial_schema). Prod'un `companies` tablosunda bu kolon
  -- YOKTUR (website/001_init) — bilinçli, kayıtlı ayrışma (kütük #582).
  INSERT INTO public.companies (id, name, slug) VALUES
    (v_co_a,'A Filo','a-filo'), (v_co_b,'B Filo','b-filo') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles (id, company_id) VALUES
    (v_owner, v_co_a), (v_other, v_co_b) ON CONFLICT (id) DO NOTHING;
  -- Araç: KİŞİSEL (company_id NULL) → şirket yolu kapalı, yalnız sahip erişir
  INSERT INTO public.vehicles (id, plate, brand, model, year, fuel_type, owner_id, company_id)
    VALUES (v_veh, '34TEST01', 'Test', 'Model', 2020, 'diesel', v_owner, NULL)
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.vehicle_users (user_id, vehicle_id, role)
    VALUES (v_owner, v_veh, 'owner') ON CONFLICT DO NOTHING;
END $fx$;

-- ══════════════════════════════════════════════════════════════════════════
-- A. ZİNCİR BÜTÜNLÜĞÜ — düzeltici migration'ların ürettiği PROD-PARİTESİ
-- ══════════════════════════════════════════════════════════════════════════
DO $a$
DECLARE v_ok int := 0; v_n int;
BEGIN
  -- A1: vehicles.owner_id (065-P1) — zincirin 11. migration'ını kıran kolon
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicles' AND column_name='owner_id' AND udt_name='uuid')
  THEN RAISE EXCEPTION 'A1 DÜŞTÜ: vehicles.owner_id yok'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicles_owner_id_fkey')
  THEN RAISE EXCEPTION 'A1 DÜŞTÜ: vehicles_owner_id_fkey yok'; END IF;
  v_ok := v_ok+1; RAISE NOTICE 'A1 PASS: vehicles.owner_id + FK (prod ile aynı)';

  -- A2: vehicles.api_key_hash (065-P1) — migration 024 buna bağımlı
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicles' AND column_name='api_key_hash')
  THEN RAISE EXCEPTION 'A2 DÜŞTÜ: vehicles.api_key_hash yok'; END IF;
  v_ok := v_ok+1; RAISE NOTICE 'A2 PASS: vehicles.api_key_hash var';

  -- A3: RPC aşırı-yüklemeleri tek imzaya indi (065-P1)
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='update_command_status';
  IF v_n <> 1 THEN RAISE EXCEPTION 'A3 DÜŞTÜ: update_command_status imza sayısı=%', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='push_vehicle_event';
  IF v_n <> 1 THEN RAISE EXCEPTION 'A3 DÜŞTÜ: push_vehicle_event imza sayısı=%', v_n; END IF;
  IF (SELECT prorettype FROM pg_proc WHERE oid=to_regprocedure('public.push_vehicle_event(text,text,jsonb)'))
     <> 'uuid'::regtype
  THEN RAISE EXCEPTION 'A3 DÜŞTÜ: push_vehicle_event uuid döndürmüyor'; END IF;
  v_ok := v_ok+1; RAISE NOTICE 'A3 PASS: tek imzalı RPC''ler (prod ile aynı)';

  -- A4: vehicle_events PROD gerçeği — vehicle_id TEXT, FK yok, sentry politikaları
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicle_events' AND column_name='vehicle_id' AND udt_name='text')
  THEN RAISE EXCEPTION 'A4 DÜŞTÜ: vehicle_events.vehicle_id TEXT değil (prod ile ayrışma)'; END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_vehicle_events_vehicle')
  THEN RAISE EXCEPTION 'A4 DÜŞTÜ: fk_vehicle_events_vehicle var (prod''da YOK)'; END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname='public' AND tablename='vehicle_events'
    AND policyname IN ('Kendi araç olaylarını oku','Kendi aracı için olay ekle');
  IF v_n <> 2 THEN RAISE EXCEPTION 'A4 DÜŞTÜ: sentry politikaları eksik (%)', v_n; END IF;
  v_ok := v_ok+1; RAISE NOTICE 'A4 PASS: vehicle_events prod gerçeğiyle aynı (text · FK yok · 2 politika)';

  -- A5: baseline nesneleri (065-P4)
  IF to_regclass('public.profiles') IS NULL
     OR to_regclass('public.vehicle_pairings') IS NULL
     OR to_regclass('public.vehicle_linking_codes') IS NULL
     OR to_regprocedure('public.auth_company_id()') IS NULL
  THEN RAISE EXCEPTION 'A5 DÜŞTÜ: baseline nesneleri eksik'; END IF;
  v_ok := v_ok+1; RAISE NOTICE 'A5 PASS: profiles · vehicle_pairings · vehicle_linking_codes · auth_company_id()';

  -- A6: varsayılan ayrıcalık daraltması (065-P5) gerçekten iş yaptı mı —
  --     049'un tablosunda authenticated INSERT OLMAMALI
  IF has_table_privilege('authenticated','public.vehicle_driver_presence','INSERT')
  THEN RAISE EXCEPTION 'A6 DÜŞTÜ: authenticated presence tablosuna doğrudan yazabiliyor'; END IF;
  IF NOT has_table_privilege('authenticated','public.vehicle_driver_presence','SELECT')
  THEN RAISE EXCEPTION 'A6 DÜŞTÜ: authenticated presence okuyamıyor (fazla daraltma)'; END IF;
  v_ok := v_ok+1; RAISE NOTICE 'A6 PASS: varsayılan ayrıcalık daraltması doğru (SELECT var · INSERT yok)';

  RAISE NOTICE '=== A ZİNCİR BÜTÜNLÜĞÜ: %/6 PASS ===', v_ok;
  IF v_ok <> 6 THEN RAISE EXCEPTION 'A DÜŞTÜ: %/6', v_ok; END IF;
END $a$;

-- ══════════════════════════════════════════════════════════════════════════
-- B. MIGRATION 063 — komut tipleri + result kolonu (GERÇEK zincir şemasında)
-- ══════════════════════════════════════════════════════════════════════════
DO $b$
DECLARE
  v_ok int := 0; v_t text; v_id uuid; v_result jsonb;
  v_owner uuid := '11111111-1111-1111-1111-111111111111';
  v_veh   uuid := '55555555-5555-5555-5555-555555555555';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicle_commands' AND column_name='result')
  THEN RAISE EXCEPTION '063-1 DÜŞTÜ: result kolonu yok'; END IF;
  v_ok := v_ok+1; RAISE NOTICE '063-1 PASS: result kolonu var';

  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicle_commands' AND column_name='result'
      AND (is_nullable <> 'YES' OR column_default IS NOT NULL))
  THEN RAISE EXCEPTION '063-2 DÜŞTÜ: result NULLABLE değil ya da varsayılanı var'; END IF;
  v_ok := v_ok+1; RAISE NOTICE '063-2 PASS: result NULLABLE, varsayılan yok';

  FOREACH v_t IN ARRAY ARRAY['layout_change','read_dtc','clear_dtc','read_voltage','set_speed_alert'] LOOP
    INSERT INTO public.vehicle_commands (vehicle_id, user_id, type) VALUES (v_veh, v_owner, v_t);
  END LOOP;
  v_ok := v_ok+1; RAISE NOTICE '063-3 PASS: beş yeni tip kabul edildi';

  FOREACH v_t IN ARRAY ARRAY['lock','unlock','horn','alarm_on','alarm_off',
                             'lights_on','route_send','navigation_start','theme_change'] LOOP
    INSERT INTO public.vehicle_commands (vehicle_id, user_id, type) VALUES (v_veh, v_owner, v_t);
  END LOOP;
  v_ok := v_ok+1; RAISE NOTICE '063-4 PASS: eski dokuz tip korundu';

  BEGIN
    INSERT INTO public.vehicle_commands (vehicle_id, user_id, type) VALUES (v_veh, v_owner, 'ecu_flash');
    RAISE EXCEPTION '063-5 DÜŞTÜ: bilinmeyen tip KABUL EDİLDİ';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '063-5 PASS: bilinmeyen tip reddedildi (23514)';
  END;
  v_ok := v_ok+1;

  SELECT id, result INTO v_id, v_result FROM public.vehicle_commands WHERE type='read_dtc' LIMIT 1;
  IF v_result IS NOT NULL THEN RAISE EXCEPTION '063-6 DÜŞTÜ: result varsayılan taşıyor: %', v_result; END IF;
  v_ok := v_ok+1; RAISE NOTICE '063-6 PASS: result NULL (okunmadı)';

  UPDATE public.vehicle_commands
     SET result = '{"dtcs":[{"code":"P0420"}],"partial":false}'::jsonb WHERE id = v_id;
  SELECT result INTO v_result FROM public.vehicle_commands WHERE id = v_id;
  IF v_result IS NULL OR v_result->>'partial' <> 'false'
  THEN RAISE EXCEPTION '063-7 DÜŞTÜ: result yazılıp okunamadı'; END IF;
  v_ok := v_ok+1; RAISE NOTICE '063-7 PASS: result jsonb yazıldı/okundu';

  -- 063-8 (EK): /api/pwa/dtc-result rotasının BİREBİR sorgusu
  PERFORM id, status, result, error_reason, created_at
     FROM public.vehicle_commands WHERE id = v_id;
  v_ok := v_ok+1; RAISE NOTICE '063-8 PASS: dtc-result rota sorgusu çalıştı (eskiden 42703)';

  RAISE NOTICE '=== 063 DOĞRULAMA: %/8 PASS ===', v_ok;
  IF v_ok <> 8 THEN RAISE EXCEPTION '063 DÜŞTÜ: %/8', v_ok; END IF;
END $b$;

-- ══════════════════════════════════════════════════════════════════════════
-- C. MIGRATION 064 — GRANT/RLS/POLICY + gerçek RLS davranışı
-- ══════════════════════════════════════════════════════════════════════════
DO $c$
DECLARE v_ok int := 0; v_n int;
BEGIN
  -- C1: RLS açık
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                  AND tablename='vehicle_fuel_logs' AND rowsecurity)
   OR NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                  AND tablename='vehicle_service_records' AND rowsecurity)
  THEN RAISE EXCEPTION 'C1 DÜŞTÜ: RLS kapalı'; END IF;
  v_ok := v_ok+1; RAISE NOTICE 'C1 PASS: iki tabloda da RLS açık';

  -- C2: anon SIFIR ayrıcalık (sızıntı yok)
  IF has_table_privilege('anon','public.vehicle_fuel_logs','SELECT')
   OR has_table_privilege('anon','public.vehicle_fuel_logs','INSERT')
   OR has_table_privilege('anon','public.vehicle_service_records','SELECT')
   OR has_table_privilege('anon','public.vehicle_service_records','INSERT')
  THEN RAISE EXCEPTION 'C2 DÜŞTÜ: anon ayrıcalığı VAR'; END IF;
  v_ok := v_ok+1; RAISE NOTICE 'C2 PASS: anon = 0 ayrıcalık';

  -- C3: authenticated 4/4 · service_role tam
  IF NOT (has_table_privilege('authenticated','public.vehicle_fuel_logs','SELECT')
      AND has_table_privilege('authenticated','public.vehicle_fuel_logs','INSERT')
      AND has_table_privilege('authenticated','public.vehicle_fuel_logs','UPDATE')
      AND has_table_privilege('authenticated','public.vehicle_fuel_logs','DELETE'))
  THEN RAISE EXCEPTION 'C3 DÜŞTÜ: authenticated 4/4 değil (fuel_logs)'; END IF;
  IF NOT (has_table_privilege('authenticated','public.vehicle_service_records','SELECT')
      AND has_table_privilege('authenticated','public.vehicle_service_records','INSERT')
      AND has_table_privilege('authenticated','public.vehicle_service_records','UPDATE')
      AND has_table_privilege('authenticated','public.vehicle_service_records','DELETE'))
  THEN RAISE EXCEPTION 'C3 DÜŞTÜ: authenticated 4/4 değil (service_records)'; END IF;
  IF NOT has_table_privilege('service_role','public.vehicle_fuel_logs','INSERT')
  THEN RAISE EXCEPTION 'C3 DÜŞTÜ: service_role yazamıyor'; END IF;
  v_ok := v_ok+1; RAISE NOTICE 'C3 PASS: authenticated 4/4 · service_role tam';

  -- C4: politikalar mevcut
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname='public'
    AND policyname IN ('vfl_access','vsr_access');
  IF v_n <> 2 THEN RAISE EXCEPTION 'C4 DÜŞTÜ: vfl_access/vsr_access eksik (%)', v_n; END IF;
  v_ok := v_ok+1; RAISE NOTICE 'C4 PASS: vfl_access + vsr_access';

  RAISE NOTICE '=== C GRANT/RLS/POLICY: %/4 PASS ===', v_ok;
  IF v_ok <> 4 THEN RAISE EXCEPTION 'C DÜŞTÜ: %/4', v_ok; END IF;
END $c$;

-- ── D. GERÇEK RLS DAVRANIŞI (authenticated rolüyle, JWT taklidi) ──────────
-- ⚠️ Tüm yazmalar `SET LOCAL ROLE authenticated` altında yapılır. Süper
-- kullanıcı RLS'i BYPASS ettiği için rol değişimi olmadan yapılan bir INSERT
-- hiçbir şey KANITLAMAZ. `SET LOCAL` yalnız transaction içinde geçerlidir;
-- bu yüzden her adım DO bloğunun (örtük transaction) içindedir.
DO $d$
DECLARE
  v_ok int := 0; v_n int; v_role text;
  v_owner text := '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  v_other text := '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
BEGIN
  -- D1: sahip kendi aracına yakıt kaydı yazar (authenticated rolüyle)
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', v_owner, true);
  SELECT current_user INTO v_role;
  IF v_role <> 'authenticated' THEN
    RESET ROLE;
    RAISE EXCEPTION 'D0 DÜŞTÜ: rol değişmedi (current_user=%) — RLS ölçümü geçersiz olurdu', v_role;
  END IF;
  INSERT INTO public.vehicle_fuel_logs (vehicle_id, filled_on, liters, client_ref, odometer_km)
  VALUES ('55555555-5555-5555-5555-555555555555', current_date, 42.5, 'ref-A1', NULL);
  RESET ROLE;

  -- D1 doğrulaması: kayıt gerçekten düştü ve odometer NULL (sahte 0 YOK)
  SELECT count(*) INTO v_n FROM public.vehicle_fuel_logs
   WHERE client_ref='ref-A1' AND odometer_km IS NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 'D1 DÜŞTÜ: kayıt yok ya da odometer sahte 0'; END IF;
  v_ok := v_ok+1; RAISE NOTICE 'D1 PASS: sahip yakıt kaydı yazdı (odometer NULL — sahte 0 yok)';

  -- D2: aynı client_ref ikinci kez → 23505 (çevrimdışı kuyruk idempotency dayanağı)
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', v_owner, true);
    INSERT INTO public.vehicle_fuel_logs (vehicle_id, filled_on, liters, client_ref)
    VALUES ('55555555-5555-5555-5555-555555555555', current_date, 10, 'ref-A1');
    RESET ROLE;
    RAISE EXCEPTION 'D2 DÜŞTÜ: aynı client_ref İKİNCİ KEZ kabul edildi';
  EXCEPTION WHEN unique_violation THEN
    RESET ROLE;
    RAISE NOTICE 'D2 PASS: aynı client_ref 23505 ile engellendi';
  END;
  v_ok := v_ok+1;

  -- D3: yabancı kullanıcı aynı araca YAZAMAZ (RLS)
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', v_other, true);
    INSERT INTO public.vehicle_fuel_logs (vehicle_id, filled_on, liters, client_ref)
    VALUES ('55555555-5555-5555-5555-555555555555', current_date, 10, 'ref-B1');
    RESET ROLE;
    RAISE EXCEPTION 'D3 DÜŞTÜ: yabancı kullanıcı YAZDI';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RAISE NOTICE 'D3 PASS: yabancı yazma RLS ile reddedildi (42501)';
  END;
  v_ok := v_ok+1;

  -- D4: yabancı kullanıcı sahibin KİŞİSEL aracının kaydını GÖREMEZ (0 satır)
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', v_other, true);
  SELECT count(*) INTO v_n FROM public.vehicle_fuel_logs;
  RESET ROLE;
  IF v_n <> 0 THEN RAISE EXCEPTION 'D4 DÜŞTÜ: yabancı % satır gördü', v_n; END IF;
  v_ok := v_ok+1; RAISE NOTICE 'D4 PASS: yabancı 0 satır gördü (kişisel araç — şirket yolu kapalı)';

  -- D5: sahip kendi kaydını GÖRÜR
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', v_owner, true);
  SELECT count(*) INTO v_n FROM public.vehicle_fuel_logs;
  RESET ROLE;
  IF v_n <> 1 THEN RAISE EXCEPTION 'D5 DÜŞTÜ: sahip % satır gördü (1 bekleniyordu)', v_n; END IF;
  v_ok := v_ok+1; RAISE NOTICE 'D5 PASS: sahip kendi kaydını gördü';

  -- D6: servis kaydı — odometer NULL ile yazılır (sahte 0 YOK)
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', v_owner, true);
  INSERT INTO public.vehicle_service_records (vehicle_id, service_key, performed_on, odometer_km, client_ref)
  VALUES ('55555555-5555-5555-5555-555555555555','oil_change', current_date, NULL, 'srv-A1');
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.vehicle_service_records
   WHERE client_ref='srv-A1' AND odometer_km IS NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 'D6 DÜŞTÜ: servis kaydı yazılamadı'; END IF;
  v_ok := v_ok+1; RAISE NOTICE 'D6 PASS: servis kaydı odometer NULL ile yazıldı';

  -- D7: sahip kendi kaydını SİLEBİLİR (B4 silme zincirinin DB ucu)
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', v_owner, true);
  DELETE FROM public.vehicle_service_records WHERE client_ref='srv-A1';
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.vehicle_service_records WHERE client_ref='srv-A1';
  IF v_n <> 0 THEN RAISE EXCEPTION 'D7 DÜŞTÜ: sahip kendi kaydını silemedi'; END IF;
  v_ok := v_ok+1; RAISE NOTICE 'D7 PASS: sahip kendi kaydını sildi';

  RAISE NOTICE '=== D RLS DAVRANIŞI: %/7 PASS ===', v_ok;
  IF v_ok <> 7 THEN RAISE EXCEPTION 'D DÜŞTÜ: %/7', v_ok; END IF;
  RAISE NOTICE '########## TAM ZİNCİR DOĞRULAMA: A 6/6 · 063 8/8 · C 4/4 · D 7/7 ##########';
END $d$;
