-- ═══════════════════════════════════════════════════════════════════════════
-- 064  DRIVER DNA ZİNCİRİ — UÇTAN UCA  (V-11)
--
--   MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres \
--     supabase_db_fleetval psql -U postgres -d postgres \
--     < supabase/tests/064_driver_dna_chain_matrix.sql
--
--   ya da:  npm run test:dna
--
-- ── NEDEN VAR ─────────────────────────────────────────────────────────────
-- V-11 prod ölçümü şunu gösterdi: 31 yolculuk yüklenmiş, hepsi
-- `driver_attribution_status = UNKNOWN`, 0 atama, 0 DNA satırı. Plan bundan
-- *"besleme köprüsü ZATEN VAR ve ÇALIŞIYOR — sunucuda; zincir yalnız ilk halkada
-- (sürücü hiç atanmamış) kopuyor"* sonucunu çıkardı.
--
-- **AMA BU BİR VARSAYIMDI.** Zincirin geri kalanının çalıştığı HİÇ GÖZLEMLENMEDİ:
-- üretimde `driver_attribution_status` bir kez bile `UNKNOWN` dışında olmadı ve
-- `driver_dna` tablosuna bir kez bile satır düşmedi. Yani *"yalnız veri eksik,
-- kod sağlam"* iddiasının ARKASINDA ÖLÇÜM YOKTU.
--
-- Bu dosya o varsayımı SINAR: sürücü oluşturur, araca atar, yolculuk yükler ve
-- zincirin her halkasını AYRI AYRI doğrular. Böylece yönetici üretimde gerçek bir
-- sürücü oluşturmadan ÖNCE, kodun sağlam olup olmadığı bilinir.
--
-- ── ÜRETİME DOKUNMAZ ──────────────────────────────────────────────────────
-- Yalnız YEREL veritabanında koşar ve `ROLLBACK` ile biter. Üretimde sahte bir
-- sürücü oluşturmak filo verisini kirletirdi — o adım BİLİNÇLİ olarak sahibinin
-- kararıdır, testin değil.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE FUNCTION pg_temp.login(p_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid::text)::text, true); END $$;

CREATE FUNCTION pg_temp.logout() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '', true); END $$;

CREATE TEMP TABLE dna_ids (k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE dna_key (k text PRIMARY KEY, v text);

-- ── Kurulum: şirket · yönetici · araç ────────────────────────────────────
DO $setup$
DECLARE
  c uuid; v uuid; admin_uid uuid := gen_random_uuid(); api text;
BEGIN
  INSERT INTO public.companies (name) VALUES ('DNA_TEST_CO') RETURNING id INTO c;

  INSERT INTO auth.users (id, email, instance_id, aud, role)
  VALUES (admin_uid, 'dna-admin@caros.local', '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated');

  /* `owner` GECERLI BIR ROL DEGILDIR: profiles_role_allowed yalnizca
     individual · member · observer · admin · super_admin kabul eder.
     Arac SAHIPLIGI ayri bir kavramdir (vehicles.owner_id). */
  UPDATE public.profiles SET company_id = c, role = 'admin', full_name = 'DNA_TEST_ADMIN'
   WHERE id = admin_uid;
  IF NOT FOUND THEN
    INSERT INTO public.profiles (id, company_id, role, full_name)
    VALUES (admin_uid, c, 'admin', 'DNA_TEST_ADMIN');
  END IF;

  /* `vehicles_single_owner_type`: bir arac AYNI ANDA hem sirkete hem kisiye ait
     OLAMAZ (owner_id ve company_id birlikte dolu olamaz). Driver DNA bir FILO
     kavramidir; arac SIRKETE ait kurulur. */
  api := 'dna_test_api_' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.vehicles (company_id, name, api_key)
  VALUES (c, 'DNA_TEST_VEHICLE', api)
  RETURNING id INTO v;

  INSERT INTO dna_ids VALUES ('company', c), ('admin', admin_uid), ('vehicle', v);
  INSERT INTO dna_key  VALUES ('api', api);
END
$setup$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 0 — ATAMA YOKKEN: zincir DÜRÜSTÇE kopmalı
-- ═════════════════════════════════════════════════════════════════════════
DO $ring0$
DECLARE api text; res jsonb;
BEGIN
  SELECT v INTO api FROM dna_key WHERE k = 'api';
  PERFORM pg_temp.logout();

  res := public.get_active_driver_assignment(api);
  /* "Atama yok" bir HATA DEĞİL, dürüst bir cevaptır; head unit bunu
     NO_ASSIGNMENT olarak raporlar (kütük #691). Burada patlarsa cihaz tarafı
     yolculuk başlangıcında çöker. */
  IF res IS NULL THEN
    RAISE EXCEPTION 'DNA HALKA 0 DUSTU -- atama yokken NULL dondu (dürüst cevap bekleniyordu)';
  END IF;
  RAISE NOTICE 'HALKA 0 gectI: atama yokken dürüst cevap: %', res;
END
$ring0$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 1 — SÜRÜCÜ OLUŞTUR + ARACA ATA (V-11'in "eksik veri" dediği adım)
-- ═════════════════════════════════════════════════════════════════════════
DO $ring1$
DECLARE admin_uid uuid; veh uuid; drv uuid; asg uuid; n int;
BEGIN
  SELECT v INTO admin_uid FROM dna_ids WHERE k = 'admin';
  SELECT v INTO veh       FROM dna_ids WHERE k = 'vehicle';
  PERFORM pg_temp.login(admin_uid);

  /* Donus anahtari `driverId`dir (camelCase), `driver_id` DEGIL. Yanlis anahtari
     okumak sessizce NULL verir ve "surucu olusmadi" gibi gorunurdu. */
  drv := (public.create_fleet_driver(
            'DNA_TEST_DRIVER', 'DNA-001', NULL, NULL, NULL, NULL, NULL
          ) ->> 'driverId')::uuid;
  IF drv IS NULL THEN
    RAISE EXCEPTION 'DNA HALKA 1 DUSTU -- create_fleet_driver surucu kimligi dondurmedi';
  END IF;

  /* Atama tipi BUYUK HARFTIR: PRIMARY | TEMPORARY | MANUAL (vda_type_valid).
     'primary' gonderilirse fonksiyon REJECTED/INVALID_TYPE doner — hata FIRLATMAZ,
     yani donus degeri okunmazsa kusur SESSIZ kalir. */
  asg := (public.create_vehicle_driver_assignment(
            veh, drv, now() - interval '1 hour', NULL, 'PRIMARY', 'V-11 zincir sinamasi', true
          ) ->> 'assignmentId')::uuid;
  IF asg IS NULL THEN
    RAISE EXCEPTION 'DNA HALKA 1 DUSTU -- create_vehicle_driver_assignment atama kimligi dondurmedi';
  END IF;

  SELECT count(*) INTO n FROM public.vehicle_driver_assignments WHERE vehicle_id = veh;
  IF n <> 1 THEN
    RAISE EXCEPTION 'DNA HALKA 1 DUSTU -- beklenen 1 atama, bulunan %', n;
  END IF;

  INSERT INTO dna_ids VALUES ('driver', drv), ('assignment', asg);
  PERFORM pg_temp.logout();
  RAISE NOTICE 'HALKA 1 gectI: surucu olusturuldu ve araca atandi';
END
$ring1$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 2 — CİHAZ ATAMAYI GÖRÜYOR MU (head unit okuma ucu)
-- ═════════════════════════════════════════════════════════════════════════
DO $ring2$
DECLARE api text; drv uuid; res jsonb;
BEGIN
  SELECT v INTO api FROM dna_key WHERE k = 'api';
  SELECT v INTO drv FROM dna_ids WHERE k = 'driver';
  PERFORM pg_temp.logout();

  /* RPC sozlesmesi bastan sona camelCase: `driverId`, `assignmentId`,
     `displayName`, `validFrom`. Cihaz tarafi bu anahtarlari okur. */
  res := public.get_active_driver_assignment(api);
  IF (res ->> 'driverId') IS DISTINCT FROM drv::text THEN
    RAISE EXCEPTION 'DNA HALKA 2 DUSTU -- cihaz atamayi GORMUYOR. donen: %', res;
  END IF;
  RAISE NOTICE 'HALKA 2 gectI: cihaz aktif atamayi goruyor';
END
$ring2$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 3 — YOLCULUK YÜKLE → ATIF TETİKLEYİCİSİ SÜRÜCÜYÜ BAĞLIYOR MU
--
-- V-11'in ÇEKİRDEK SORUSU. Prod'da 31 yolculuğun 31'i UNKNOWN'dı; bunun sebebi
-- "atama yoktu" diye VARSAYILDI. Burada atama VAR — statü hâlâ UNKNOWN kalırsa
-- sorun veri değil KODDUR ve V-11'in teşhisi baştan yanlıştır.
-- ═════════════════════════════════════════════════════════════════════════
DO $ring3$
DECLARE
  api text; drv uuid; veh uuid;
  t0 bigint; i int; st text; did uuid; n int; v_res jsonb;
BEGIN
  SELECT v INTO api FROM dna_key WHERE k = 'api';
  SELECT v INTO drv FROM dna_ids WHERE k = 'driver';
  SELECT v INTO veh FROM dna_ids WHERE k = 'vehicle';
  PERFORM pg_temp.logout();

  t0 := (extract(epoch FROM now()) * 1000)::bigint - 3600000;

  FOR i IN 1..3 LOOP
    /* Donus MUTLAKA okunur: REJECTED sessiz bir basarisizliktir. */
    v_res := public.upload_vehicle_trip(
      api,
      'dna_trip_key_' || i,
      'dna_trip_' || i,
      1,
      t0 + (i * 600000),
      t0 + (i * 600000) + 300000,
      /* METRIK ANAHTARLARI camelCase: distanceKm · harshBrakeCount ·
         harshAccelCount. snake_case gonderilirse fonksiyon HATA FIRLATMAZ,
         sessizce REJECTED/NO_DISTANCE doner — donus okunmazsa yolculuk
         "gonderildi" sanilir ama tabloya HIC dusmez. */
      jsonb_build_object(
        'distanceKm', 12.5 + i,
        'harshBrakeCount', i,
        'harshAccelCount', i,
        'durationMin', 5,
        'maxSpeedKmh', 90
      ),
      70 + i, 'HIGH',
      jsonb_build_object('distance', 'MEASURED'),
      '[]'::jsonb,
      jsonb_build_object('distance_source', 'MEASURED'),
      NULL, NULL, 1
    );
    /* Kabul durumlari: CREATED (yeni) veya UPDATED (revizyon). Tek reddedilen
       durum REJECTED'dir; ona gore sinanir ki yeni bir kabul durumu eklenince
       test yanlislikla kirmizi olmasin. */
    IF (v_res ->> 'state') = 'REJECTED' THEN
      RAISE EXCEPTION 'DNA HALKA 3 DUSTU -- yukleme % REDDEDILDI: %', i, v_res;
    END IF;
  END LOOP;

  SELECT count(*) INTO n FROM public.vehicle_trips WHERE vehicle_id = veh;
  IF n <> 3 THEN
    RAISE EXCEPTION 'DNA HALKA 3 DUSTU -- 3 yolculuk yuklendi, tabloda % satir', n;
  END IF;

  SELECT driver_attribution_status, driver_id INTO st, did
    FROM public.vehicle_trips WHERE vehicle_id = veh ORDER BY started_at LIMIT 1;

  IF st = 'UNKNOWN' OR did IS NULL THEN
    RAISE EXCEPTION
      'DNA HALKA 3 DUSTU -- ATAMA VARKEN bile statu=% driver_id=% . '
      'V-11in "yalniz veri eksik, kod saglam" teshisi YANLIS demektir.', st, did;
  END IF;
  IF did IS DISTINCT FROM drv THEN
    RAISE EXCEPTION 'DNA HALKA 3 DUSTU -- YANLIS surucu baglandi: % (beklenen %)', did, drv;
  END IF;
  RAISE NOTICE 'HALKA 3 gectI: atif tetikleyicisi surucuyu bagladi (statu=%)', st;
END
$ring3$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 4 — DNA BİRİKİYOR MU
-- ═════════════════════════════════════════════════════════════════════════
DO $ring4$
DECLARE drv uuid; n int; tc int;
BEGIN
  SELECT v INTO drv FROM dna_ids WHERE k = 'driver';

  SELECT count(*) INTO n FROM public.driver_dna WHERE driver_id = drv;
  IF n = 0 THEN
    RAISE EXCEPTION
      'DNA HALKA 4 DUSTU -- surucu bagli 3 yolculuk var ama driver_dna satiri YOK. '
      'DNA tetikleyicisi calismiyor demektir.';
  END IF;

  SELECT trip_count INTO tc FROM public.driver_dna WHERE driver_id = drv;
  IF tc IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'DNA HALKA 4 DUSTU -- trip_count=% (beklenen 3)', tc;
  END IF;
  RAISE NOTICE 'HALKA 4 gectI: driver_dna birikti, trip_count=%', tc;
END
$ring4$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 5 — TEKRAR YÜKLEME DNA'YI ŞİŞİRMEMELİ (idempotans)
--
-- Çevrimdışı kuyruk aynı yolculuğu yeniden gönderebilir. Sayaç her seferinde
-- artarsa sürücünün "deneyimi" uydurma olur ve güven skoru yalan söyler.
-- ═════════════════════════════════════════════════════════════════════════
DO $ring5$
DECLARE api text; drv uuid; t0 bigint; tc int; v_res jsonb;
BEGIN
  SELECT v INTO api FROM dna_key WHERE k = 'api';
  SELECT v INTO drv FROM dna_ids WHERE k = 'driver';
  PERFORM pg_temp.logout();
  t0 := (extract(epoch FROM now()) * 1000)::bigint - 3600000;

  /* DIKKAT: burada da camelCase SART. Ilk yazimda snake_case kullanilmisti ve
     yukleme REJECTED/NO_DISTANCE ile geri donuyordu — sayac "idempotans
     sayesinde" degil "yukleme HIC OLMADIGI icin" 3 kaliyordu. Yani halka
     YANLIS SEBEPLE geciyordu. Donus degeri de bu yuzden OKUNUR. */
  v_res := public.upload_vehicle_trip(
    api, 'dna_trip_key_1', 'dna_trip_1', 1,
    t0 + 600000, t0 + 900000,
    jsonb_build_object('distanceKm', 13.5, 'harshBrakeCount', 1,
                       'harshAccelCount', 1, 'durationMin', 5, 'maxSpeedKmh', 90),
    71, 'HIGH', jsonb_build_object('distance', 'MEASURED'), '[]'::jsonb,
    jsonb_build_object('distance_source', 'MEASURED'), NULL, NULL, 1
  );
  IF (v_res ->> 'state') = 'REJECTED' THEN
    RAISE EXCEPTION
      'DNA HALKA 5 DUSTU -- tekrar yukleme REDDEDILDI: % . Idempotans SINANMAMIS olur.', v_res;
  END IF;

  SELECT trip_count INTO tc FROM public.driver_dna WHERE driver_id = drv;
  IF tc IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION
      'DNA HALKA 5 DUSTU -- ayni yolculuk tekrar yuklenince trip_count % oldu (3 kalmaliydi)', tc;
  END IF;
  RAISE NOTICE 'HALKA 5 gectI: tekrar yukleme DNA sayacini sismedi';
END
$ring5$;

DO $done$ BEGIN RAISE NOTICE 'DRIVER DNA ZINCIRI: 6 HALKA DA GECTI.'; END $done$;

ROLLBACK;
