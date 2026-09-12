-- ═══════════════════════════════════════════════════════════════════════════
-- 053 — DRIVER DNA P1 · GERÇEK PostgreSQL DOĞRULAMASI
--
-- MOCK DEĞİL: gerçek tablo, gerçek trigger, gerçek attribution zinciri.
--
-- EN KRİTİK KANITLAR:
--   · aynı yolculuk DNA'ya İKİ KEZ katkı vermez (replay)
--   · ÖLÇÜLMEMİŞ alan `0` sayılmaz (UNKNOWN korunur)
--   · yetersiz kanıtta DNA OLUŞMAZ (fail-closed)
--   · sürücü değişince katkı ESKİ DNA'dan geri alınır ve bu GİZLENMEZ
--   · cross-tenant DNA oluşmaz · devir sonrası sızıntı yok
--   · attribution zinciri (P0/presence/authentication) DEĞİŞMEDİ
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

DELETE FROM public.vehicle_trips WHERE trip_key LIKE 'p53-%';
DELETE FROM public.driver_dna WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P53 %');
DELETE FROM public.vehicle_driver_assignments WHERE note LIKE 'P53%';
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'P53 %';

INSERT INTO public.vehicles (id, name, company_id, api_key)
VALUES ('cccc3333-0000-0000-0000-000000000003', 'B Araci',
        'f2eef2ee-0000-0000-0000-000000000002', 'val-key-3')
ON CONFLICT (id) DO NOTHING;

DO $verify$
DECLARE
  v_fail int := 0;
  A_CO  uuid := 'f1eef1ee-0000-0000-0000-000000000001';
  B_CO  uuid := 'f2eef2ee-0000-0000-0000-000000000002';
  A_ADM uuid := '1178d9db-413d-4f60-97c5-97bfc8393618';
  B_ADM uuid := 'b0e18b7e-2951-472d-acf1-46c674dcd8a2';
  A_VEH uuid := 'bbbb2222-0000-0000-0000-000000000002';
  B_VEH uuid := 'cccc3333-0000-0000-0000-000000000003';
  r    jsonb;
  d1   uuid; d2 uuid; dB uuid;
  dna  public.driver_dna%ROWTYPE;
  t    public.vehicle_trips%ROWTYPE;
  v_n  int; v_rev int; v_km numeric;
  v_status text;
  T0   timestamptz := now() - interval '30 days';
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);
  r := public.create_fleet_driver('P53 Ahmet',  'P53-1'); d1 := (r->>'driverId')::uuid;
  r := public.create_fleet_driver('P53 Mehmet', 'P53-2'); d2 := (r->>'driverId')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', B_ADM)::text, true);
  r := public.create_fleet_driver('P53 Beta',   'P53-B'); dB := (r->>'driverId')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);

  INSERT INTO public.vehicle_driver_assignments
    (company_id, vehicle_id, driver_id, starts_at, status, note)
  VALUES (A_CO, A_VEH, d1, T0 - interval '1 day', 'ACTIVE', 'P53 atama');

  -- ═══ M. MERGE (kanıt birikimi) ═════════════════════════════════════
  INSERT INTO public.vehicle_trips
    (vehicle_id, trip_key, revision, started_at, ended_at, distance_km,
     distance_source, harsh_brake_count, harsh_brake_source,
     harsh_accel_count, harsh_accel_source)
  VALUES (A_VEH, 'p53-t1', 1, T0, T0 + interval '1 hour', 40,
          'MEASURED', 4, 'MEASURED', 2, 'MEASURED');

  SELECT * INTO dna FROM public.driver_dna WHERE driver_id = d1;
  IF FOUND AND dna.trip_count = 1 AND dna.total_distance_km = 40
     AND dna.brake_sum = 4 AND dna.brake_count = 1 THEN
    RAISE NOTICE 'M1   yolculuk DNA ya islendi (kanit birikti)              PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'M1   merge olmadi: % / % FAIL', dna.trip_count, dna.brake_sum; END IF;

  IF dna.brake_measured_only THEN
    RAISE NOTICE 'M2   MEASURED kanit provenance i korundu                  PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'M2   provenance bozuldu FAIL'; END IF;

  -- ═══ U. UNKNOWN KORUNMASI (en kritik dürüstlük kapısı) ═════════════
  --
  -- Yakıt HİÇ ölçülmemiş bir yolculuk, yakıt birikimini 0 ile KİRLETMEMELİ.
  INSERT INTO public.vehicle_trips
    (vehicle_id, trip_key, revision, started_at, ended_at, distance_km,
     distance_source, fuel_used_l, fuel_source)
  VALUES (A_VEH, 'p53-t2', 1, T0 + interval '2 hours', T0 + interval '3 hours', 30,
          'MEASURED', NULL, 'UNAVAILABLE');

  SELECT * INTO dna FROM public.driver_dna WHERE driver_id = d1;
  IF dna.fuel_count = 0 AND dna.fuel_sum = 0 AND dna.fuel_km = 0 THEN
    RAISE NOTICE 'U1   OLCULMEMIS yakit birikime GIRMEDI (0 sayilmadi)      PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'U1   olculmemis alan 0 olarak sayildi FAIL'; END IF;

  IF dna.trip_count = 2 AND dna.total_distance_km = 70 THEN
    RAISE NOTICE 'U2   olculen alanlar birikmeye DEVAM etti                 PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'U2   birikim durdu: % FAIL', dna.trip_count; END IF;

  -- Sert fren ölçülmemişse fren sayacı ARTMAZ ama yolculuk sayılır.
  IF dna.brake_count = 1 THEN
    RAISE NOTICE 'U3   olculmeyen sinyalin sayaci ARTMADI                   PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'U3   olculmeyen sinyal sayildi: % FAIL', dna.brake_count; END IF;

  -- ═══ R. REPLAY ═════════════════════════════════════════════════════
  SELECT revision INTO v_rev FROM public.driver_dna WHERE driver_id = d1;
  FOR i IN 1..10 LOOP
    UPDATE public.vehicle_trips SET distance_km = distance_km WHERE trip_key = 'p53-t1';
  END LOOP;

  SELECT * INTO dna FROM public.driver_dna WHERE driver_id = d1;
  IF dna.trip_count = 2 AND dna.total_distance_km = 70 AND dna.brake_sum = 4 THEN
    RAISE NOTICE 'R1   10x REPLAY DNA yi SISIRMEDI (idempotent)             PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'R1   replay DNA yi sisirdi: % / % FAIL',
       dna.trip_count, dna.total_distance_km; END IF;

  SELECT count(*) INTO v_n FROM public.driver_dna_trip dt
    JOIN public.vehicle_trips vt ON vt.id = dt.trip_id WHERE vt.trip_key = 'p53-t1';
  IF v_n = 1 THEN
    RAISE NOTICE 'R2   yolculuk defterde TEK kez kayitli                    PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'R2   % katki kaydi FAIL', v_n; END IF;

  -- ═══ F. FAIL-CLOSED (eşik altında DNA YOK) ═════════════════════════
  SELECT * INTO dna FROM public.driver_dna WHERE driver_id = d1;
  v_status := public._dna_status(dna.trip_count, dna.total_distance_km);
  IF v_status = 'NO_DNA' THEN
    RAISE NOTICE 'F1   2 yolculuk / 70 km -> DNA OLUSMADI (fail-closed)     PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'F1   yetersiz kanitta DNA olustu: % FAIL', v_status; END IF;

  -- ═══ L. LEARNING (zaman içinde öğrenme) ════════════════════════════
  FOR i IN 3..12 LOOP
    INSERT INTO public.vehicle_trips
      (vehicle_id, trip_key, revision, started_at, ended_at, distance_km,
       distance_source, harsh_brake_count, harsh_brake_source,
       harsh_accel_count, harsh_accel_source)
    VALUES (A_VEH, 'p53-t' || i, 1, T0 + (i || ' hours')::interval,
            T0 + ((i+1) || ' hours')::interval, 25,
            'MEASURED', 2, 'MEASURED', 1, 'MEASURED');
  END LOOP;

  SELECT * INTO dna FROM public.driver_dna WHERE driver_id = d1;
  IF dna.trip_count = 12 AND dna.total_distance_km = 320 THEN
    RAISE NOTICE 'L1   12 yolculuk birikti (320 km)                         PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'L1   birikim yanlis: % / % FAIL',
       dna.trip_count, dna.total_distance_km; END IF;

  IF public._dna_status(dna.trip_count, dna.total_distance_km) = 'FORMING' THEN
    RAISE NOTICE 'F2   esik asilinca DNA OLUSTU (FORMING)                   PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'F2   esik sonrasi durum yanlis FAIL'; END IF;

  IF public._dna_learning_level(1) = 'NASCENT'
     AND public._dna_learning_level(dna.trip_count) = 'DEVELOPING'
     AND public._dna_learning_level(100) = 'ESTABLISHED'
     AND public._dna_learning_level(1000) = 'MATURE' THEN
    RAISE NOTICE 'L2   ogrenme seviyeleri 1 / 10 / 100 / 1000 ayrisiyor     PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'L2   ogrenme seviyeleri yanlis FAIL'; END IF;

  IF dna.baseline_rate_count > 0 AND array_length(dna.recent_rates,1) > 0 THEN
    RAISE NOTICE 'L3   taban ve son pencere KANITI birikti                  PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'L3   sapma pencereleri bos FAIL'; END IF;

  -- ═══ D. DRIFT (davranış değişimi) ══════════════════════════════════
  --
  -- İlk 12 yolculukta oran ~12/100km; şimdi ÇOK daha agresif yolculuklar.
  FOR i IN 13..25 LOOP
    INSERT INTO public.vehicle_trips
      (vehicle_id, trip_key, revision, started_at, ended_at, distance_km,
       distance_source, harsh_brake_count, harsh_brake_source,
       harsh_accel_count, harsh_accel_source)
    VALUES (A_VEH, 'p53-t' || i, 1, T0 + (i || ' hours')::interval,
            T0 + ((i+1) || ' hours')::interval, 25,
            'MEASURED', 12, 'MEASURED', 10, 'MEASURED');
  END LOOP;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p53-t25';
  SELECT drift_state, drift_baseline, drift_recent INTO v_status, v_km, v_rev
    FROM public.get_driver_dna(d1);

  IF v_status = 'DRIFTING' THEN
    RAISE NOTICE 'D1   davranis DEGISIMI tespit edildi (DRIFTING)           PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'D1   sapma tespit edilmedi: % FAIL', v_status; END IF;

  -- ═══ C. CROSS-TENANT ═══════════════════════════════════════════════
  --
  -- B şirketinin sürücüsü A'nın aracındaki yolculuktan DNA ÖĞRENEMEZ.
  UPDATE public.vehicle_trips SET driver_id = dB, driver_attribution_status='ATTRIBUTED'
   WHERE trip_key = 'p53-t2';
  PERFORM public._dna_merge_trip((SELECT id FROM public.vehicle_trips WHERE trip_key='p53-t2'));

  SELECT count(*) INTO v_n FROM public.driver_dna WHERE driver_id = dB;
  IF v_n = 0 THEN
    RAISE NOTICE 'C1   CROSS-TENANT surucu icin DNA OLUSMADI                PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'C1   cross-tenant DNA olustu FAIL'; END IF;

  -- Okuma tarafı da kapalı olmalı (A admini B sürücüsünün DNA'sını göremez).
  SELECT count(*) INTO v_n FROM public.get_driver_dna(dB);
  IF v_n = 0 THEN
    RAISE NOTICE 'C2   baska tenant DNA si OKUNAMIYOR                       PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'C2   cross-tenant DNA okundu FAIL'; END IF;

  -- ═══ X. DRIVER CHANGE (yeniden atama) ══════════════════════════════
  SELECT trip_count INTO v_n FROM public.driver_dna WHERE driver_id = d1;
  UPDATE public.vehicle_trips
     SET driver_id = d2, driver_attribution_status = 'ATTRIBUTED'
   WHERE trip_key = 'p53-t1';

  SELECT * INTO dna FROM public.driver_dna WHERE driver_id = d1;
  IF dna.trip_count = v_n - 1 THEN
    RAISE NOTICE 'X1   sürücü degisince katki ESKI DNA dan GERI ALINDI      PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'X1   geri alma olmadi: % -> % FAIL', v_n, dna.trip_count; END IF;

  IF dna.integrity_state = 'RETRACTED' AND dna.retracted_trip_count >= 1 THEN
    RAISE NOTICE 'X2   geri alma GIZLENMEDI (integrity_state=RETRACTED)     PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'X2   geri alma gizlendi: % FAIL', dna.integrity_state; END IF;

  SELECT * INTO dna FROM public.driver_dna WHERE driver_id = d2;
  IF FOUND AND dna.trip_count = 1 THEN
    RAISE NOTICE 'X3   katki YENI surucunun DNA sina gecti                  PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'X3   yeni DNA olusmadi FAIL'; END IF;

  SELECT count(*) INTO v_n FROM public.driver_dna_trip dt
    JOIN public.vehicle_trips vt ON vt.id = dt.trip_id WHERE vt.trip_key='p53-t1';
  IF v_n = 1 THEN
    RAISE NOTICE 'X4   yolculuk AYNI ANDA tek DNA ya ait                    PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'X4   yolculuk % DNA ya ait FAIL', v_n; END IF;

  -- ═══ T. TRANSFER (araç devri) ══════════════════════════════════════
  --
  -- Araç başka şirkete devredilse bile GEÇMİŞ DNA sürücüde kalır ve yeni
  -- şirkete SIZMAZ; devirden sonraki yolculuklar eski sürücüye işlenmez.
  UPDATE public.vehicles SET company_id = B_CO WHERE id = A_VEH;
  INSERT INTO public.vehicle_trips
    (vehicle_id, trip_key, revision, started_at, ended_at, distance_km,
     distance_source, harsh_brake_count, harsh_brake_source)
  VALUES (A_VEH, 'p53-after-transfer', 1, now() - interval '1 hour', now(), 50,
          'MEASURED', 3, 'MEASURED');

  SELECT count(*) INTO v_n FROM public.driver_dna_trip dt
    JOIN public.vehicle_trips vt ON vt.id = dt.trip_id
   WHERE vt.trip_key = 'p53-after-transfer';
  IF v_n = 0 THEN
    RAISE NOTICE 'T1   DEVIR sonrasi yolculuk eski DNA ya ISLENMEDI         PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'T1   devir sonrasi sizinti FAIL'; END IF;

  SELECT * INTO dna FROM public.driver_dna WHERE driver_id = d1;
  IF dna.company_id = A_CO THEN
    RAISE NOTICE 'T2   DNA sahipligi surucude/sirketinde KALDI              PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'T2   DNA sahipligi degisti FAIL'; END IF;
  UPDATE public.vehicles SET company_id = A_CO WHERE id = A_VEH;   -- geri al

  -- ═══ A. ATTRIBUTION ZİNCİRİ REGRESYONU ═════════════════════════════
  INSERT INTO public.vehicle_trips (vehicle_id, trip_key, revision, started_at, ended_at, distance_km)
  VALUES (A_VEH, 'p53-noattr', 1, T0 + interval '100 hours', T0 + interval '101 hours', 10);
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p53-noattr';
  IF t.driver_id = d1 AND t.driver_attribution_source = 'ACTIVE_ASSIGNMENT' THEN
    RAISE NOTICE 'A1   P0 atama modeli DNA dan ETKILENMEDI                  PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'A1   attribution bozuldu: % FAIL', t.driver_attribution_source; END IF;

  IF t.driver_auth_decision = 'NO_AUTHENTICATION'
     AND t.driver_presence_decision = 'NO_PRESENCE' THEN
    RAISE NOTICE 'A2   presence/authentication kararlari KORUNDU            PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'A2   kimlik zinciri bozuldu FAIL'; END IF;

  IF v_fail = 0 THEN
    RAISE NOTICE '─────────────────────────────────────────────────────────';
    RAISE NOTICE '053 DOGRULAMA: TUM KONTROLLER GECTI';
  ELSE
    RAISE EXCEPTION '053 DOGRULAMA: % KONTROL DUSTU', v_fail;
  END IF;
END
$verify$;

-- ── Yetki kapıları ──────────────────────────────────────────────────────
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','b0e18b7e-2951-472d-acf1-46c674dcd8a2')::text, true);
SET LOCAL ROLE authenticated;
SELECT CASE WHEN count(*) = 0
            THEN 'S1   B admini A DNA larini GOREMIYOR (RLS)              PASS'
            ELSE 'S1   RLS SIZINTISI FAIL' END AS sonuc
  FROM public.driver_dna;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT CASE WHEN has_table_privilege('authenticated','public.driver_dna','UPDATE')
            THEN 'S2   DNA elle DEGISTIRILEBILIYOR FAIL'
            ELSE 'S2   DNA elle degistirilemez (yalniz trigger)          PASS'
       END AS sonuc;
ROLLBACK;

-- Temizlik.
DELETE FROM public.vehicle_trips WHERE trip_key LIKE 'p53-%';
DELETE FROM public.driver_dna WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P53 %');
DELETE FROM public.vehicle_driver_assignments WHERE note LIKE 'P53%';
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'P53 %';
