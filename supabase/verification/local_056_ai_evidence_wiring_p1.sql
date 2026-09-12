-- ═══════════════════════════════════════════════════════════════════════════
-- 056 — AI EVIDENCE PRODUCTION WIRING P1 · GERÇEK PostgreSQL DOĞRULAMASI
--
-- MOCK DEĞİL: gerçek trigger zinciri (trip → DNA → insight → evidence),
-- gerçek kısıtlar, gerçek RLS.
--
-- EN KRİTİK KANITLAR:
--   · gerçek trip KAPANIŞI kanıt üretir · 10× replay TEK kanıt
--   · ESTIMATED alan ölçülmüş gibi işaretlenmez · UNAVAILABLE kanıt üretmez
--   · trip güncellenince ESKİ kanıt DEĞİŞMEZ, yeni revizyon açılır
--   · DNA eşiği altında kanıt yok · eşik aşılınca kanıt var · RETRACTED düşer
--   · insight kanıtları ZİNCİRE bağlanır · replay duplicate zincir üretmez
--   · adaptör BAŞKA kaynağın kanıtını yazamaz
--   · kanıt yazımı düşse bile ANA İŞLEM bozulmaz (hata yalıtımı)
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

DELETE FROM public.ai_evidence WHERE company_id IN
  ('f1eef1ee-0000-0000-0000-000000000001','f2eef2ee-0000-0000-0000-000000000002');
DELETE FROM public.ai_evidence_retry;
DELETE FROM public.ai_evidence_adapter_state;
DELETE FROM public.fleet_insight WHERE company_id IN
  ('f1eef1ee-0000-0000-0000-000000000001','f2eef2ee-0000-0000-0000-000000000002');
DELETE FROM public.vehicle_trips WHERE trip_key LIKE 'p56-%';
DELETE FROM public.driver_dna WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P56 %');
DELETE FROM public.vehicle_driver_assignments WHERE note LIKE 'P56%';
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'P56 %';

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
  A_VEH uuid := 'bbbb2222-0000-0000-0000-000000000002';
  B_VEH uuid := 'cccc3333-0000-0000-0000-000000000003';
  r    jsonb;
  res  record;
  d1   uuid; d2 uuid;
  t1   uuid; t2 uuid;
  i1   uuid;
  ev   public.ai_evidence%ROWTYPE;
  v_n int; v_n2 int; v_res text; v_val numeric; v_prov text; v_dna uuid;
  T0   timestamptz := now() - interval '5 hours';
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);
  r := public.create_fleet_driver('P56 Ahmet',  'P56-1'); d1 := (r->>'driverId')::uuid;
  r := public.create_fleet_driver('P56 Mehmet', 'P56-2'); d2 := (r->>'driverId')::uuid;

  INSERT INTO public.vehicle_driver_assignments
    (company_id, vehicle_id, driver_id, starts_at, status, note)
  VALUES (A_CO, A_VEH, d1, T0 - interval '1 day', 'ACTIVE', 'P56 atama');

  -- ═══ T. TRIP → EVIDENCE ════════════════════════════════════════════
  --
  -- AÇIK yolculuk kanıt üretmez (devam eden ölçüm kanıt değildir).
  INSERT INTO public.vehicle_trips
    (vehicle_id, trip_key, revision, started_at, ended_at, distance_km, distance_source)
  VALUES (A_VEH, 'p56-open', 1, T0, NULL, 10, 'MEASURED')
  RETURNING id INTO t2;

  SELECT count(*) INTO v_n FROM public.ai_evidence WHERE trip_id = t2;
  IF v_n = 0 THEN
    RAISE NOTICE 'T1   ACIK yolculuk kanit URETMEDI                          PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'T1   acik yolculuk % kanit uretti FAIL', v_n; END IF;

  /* KAPANMIŞ yolculuk: ölçülen alanlar kanıt üretir, ölçülmeyenler ÜRETMEZ. */
  INSERT INTO public.vehicle_trips
    (vehicle_id, trip_key, revision, started_at, ended_at,
     distance_km, distance_source, duration_min, duration_source,
     idle_time_min, idle_source, moving_time_min, moving_source,
     harsh_brake_count, harsh_brake_source, harsh_accel_count, harsh_accel_source,
     max_rpm, max_rpm_source, max_engine_temp_c, max_temp_source,
     fuel_used_l, fuel_source, estimated_cost, cost_source, confidence)
  VALUES (A_VEH, 'p56-t1', 1, T0, T0 + interval '1 hour',
          40, 'MEASURED', 60, 'MEASURED',
          6, 'MEASURED', 54, 'MEASURED',
          3, 'MEASURED', 2, 'MEASURED',
          4200, 'MEASURED', 94, 'MEASURED',
          3.4, 'ESTIMATED', 120, 'UNAVAILABLE', 'HIGH')
  RETURNING id INTO t1;

  SELECT count(*) INTO v_n FROM public.ai_evidence
   WHERE trip_id = t1 AND source = 'TRIP_ENGINE' AND state = 'ACTIVE';
  IF v_n >= 9 THEN
    RAISE NOTICE 'T2   KAPANAN yolculuk kanit uretti (% metrik)              PASS', v_n;
  ELSE v_fail:=v_fail+1; RAISE WARNING 'T2   yetersiz kanit: % FAIL', v_n; END IF;

  /* UNAVAILABLE alan (maliyet) KANIT ÜRETMEZ. */
  SELECT count(*) INTO v_n FROM public.ai_evidence
   WHERE trip_id = t1 AND metric = 'estimated_cost';
  IF v_n = 0 THEN
    RAISE NOTICE 'T3   UNAVAILABLE alan kanit URETMEDI (0 sayilmadi)         PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'T3   olculmemis alan kanit uretti FAIL'; END IF;

  /* ESTIMATED alan ÖLÇÜLMÜŞ gibi işaretlenmez. */
  SELECT provenance, confidence INTO v_prov, v_res FROM public.ai_evidence
   WHERE trip_id = t1 AND metric = 'fuel_used_l';
  IF v_prov = 'ESTIMATED' AND v_res <> 'VERY_HIGH' THEN
    RAISE NOTICE 'T4   ESTIMATED yakit OLCULMUS gibi isaretlenmedi           PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'T4   estimated yanlis: % / % FAIL', v_prov, v_res; END IF;

  SELECT provenance INTO v_prov FROM public.ai_evidence
   WHERE trip_id = t1 AND metric = 'distance_km';
  IF v_prov = 'MEASURED' THEN
    RAISE NOTICE 'T5   MEASURED alan provenance i KORUNDU                    PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'T5   measured bozuldu: % FAIL', v_prov; END IF;

  -- ═══ RP. REPLAY ════════════════════════════════════════════════════
  SELECT count(*) INTO v_n FROM public.ai_evidence WHERE trip_id = t1;
  FOR i IN 1..10 LOOP
    UPDATE public.vehicle_trips SET distance_km = distance_km WHERE id = t1;
  END LOOP;
  SELECT count(*) INTO v_n2 FROM public.ai_evidence WHERE trip_id = t1;
  IF v_n2 = v_n THEN
    RAISE NOTICE 'RP1  10x REPLAY tek kanit kaldi (duplicate YOK)            PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'RP1  replay % -> % kanit FAIL', v_n, v_n2; END IF;

  SELECT refresh_count INTO v_n FROM public.ai_evidence
   WHERE trip_id = t1 AND metric = 'distance_km';
  IF v_n >= 10 THEN
    RAISE NOTICE 'RP2  tekrarlar refreshCount olarak SAYILDI (%)             PASS', v_n;
  ELSE v_fail:=v_fail+1; RAISE WARNING 'RP2  refresh sayaci yanlis: % FAIL', v_n; END IF;

  -- ═══ RV. REVİZYON (immutable eski kanıt) ═══════════════════════════
  SELECT value INTO v_val FROM public.ai_evidence
   WHERE trip_id = t1 AND metric = 'distance_km' AND subject_revision = 1;

  UPDATE public.vehicle_trips SET revision = 2, distance_km = 55 WHERE id = t1;

  SELECT value INTO v_res FROM public.ai_evidence
   WHERE trip_id = t1 AND metric='distance_km' AND subject_revision = 1;
  IF v_res::numeric = v_val THEN
    RAISE NOTICE 'RV1  ESKI revizyon kaniti DEGISMEDI (immutable)            PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'RV1  eski kanit degisti: % -> % FAIL', v_val, v_res; END IF;

  SELECT state INTO v_res FROM public.ai_evidence
   WHERE trip_id = t1 AND metric='distance_km' AND subject_revision = 1;
  IF v_res = 'SUPERSEDED' THEN
    RAISE NOTICE 'RV2  eski revizyon SUPERSEDED olarak iliskilendirildi      PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'RV2  eski revizyon durumu: % FAIL', v_res; END IF;

  SELECT value INTO v_val FROM public.ai_evidence
   WHERE trip_id = t1 AND metric='distance_km' AND subject_revision = 2;
  IF v_val = 55 THEN
    RAISE NOTICE 'RV3  YENI revizyon kaniti olusturuldu (55 km)              PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'RV3  yeni revizyon yok: % FAIL', v_val; END IF;

  -- ═══ D. DNA → EVIDENCE ═════════════════════════════════════════════
  SELECT id INTO v_dna FROM public.driver_dna WHERE driver_id = d1;
  SELECT count(*) INTO v_n FROM public.ai_evidence
   WHERE driver_id = d1 AND source = 'DRIVER_DNA';
  IF v_n = 0 THEN
    RAISE NOTICE 'D1   ESIK ALTINDA DNA kanit URETMEDI (fail-closed)         PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'D1   esik altinda % kanit FAIL', v_n; END IF;

  /* Eşiği aş: 5+ yolculuk ve 50+ km. */
  FOR i IN 2..8 LOOP
    INSERT INTO public.vehicle_trips
      (vehicle_id, trip_key, revision, started_at, ended_at, distance_km,
       distance_source, harsh_brake_count, harsh_brake_source)
    VALUES (A_VEH, 'p56-d' || i, 1, T0 + (i || ' minutes')::interval,
            T0 + ((i+30) || ' minutes')::interval, 30, 'MEASURED', 2, 'MEASURED');
  END LOOP;

  SELECT count(*) INTO v_n FROM public.ai_evidence
   WHERE driver_id = d1 AND source = 'DRIVER_DNA' AND state = 'ACTIVE';
  IF v_n >= 3 THEN
    RAISE NOTICE 'D2   ESIK ASILINCA DNA kaniti uretildi (%)                 PASS', v_n;
  ELSE v_fail:=v_fail+1; RAISE WARNING 'D2   DNA kaniti uretilmedi: % FAIL', v_n; END IF;

  /* Viraj/akü kanıtı ASLA üretilmez (kaynak yok). */
  SELECT count(*) INTO v_n FROM public.ai_evidence
   WHERE driver_id = d1 AND (metric LIKE '%cornering%' OR metric LIKE '%battery%');
  IF v_n = 0 THEN
    RAISE NOTICE 'D3   VIRAJ/AKU kaniti URETILMEDI (kaynak yok)              PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'D3   kaynaksiz DNA metrigi uretildi FAIL'; END IF;

  /* TEK GENEL SÜRÜCÜ PUANI üretilmez. */
  SELECT count(*) INTO v_n FROM public.ai_evidence
   WHERE driver_id = d1 AND metric IN ('dna_score','driver_score','dna_rating');
  IF v_n = 0 THEN
    RAISE NOTICE 'D4   TEK genel surucu puani URETILMEDI                     PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'D4   surucu puani uretildi FAIL'; END IF;

  -- RETRACTED DNA aktif güvenilir kanıt gibi kullanılmaz.
  UPDATE public.vehicle_trips SET driver_id = d2 WHERE trip_key = 'p56-d2';
  SELECT integrity_state INTO v_res FROM public.driver_dna WHERE id = v_dna;
  IF v_res = 'RETRACTED' THEN
    SELECT count(*) INTO v_n FROM public.ai_evidence
     WHERE driver_id = d1 AND source='DRIVER_DNA' AND state = 'ACTIVE';
    IF v_n = 0 THEN
      RAISE NOTICE 'D5   RETRACTED DNA kanitlari AKTIF kalmadi                 PASS';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'D5   retracted DNA % aktif kanit FAIL', v_n; END IF;

    SELECT count(*) INTO v_n FROM public.ai_evidence
     WHERE driver_id = d1 AND source='DRIVER_DNA' AND state = 'SUPERSEDED';
    IF v_n > 0 THEN
      RAISE NOTICE 'D6   RETRACTED kanitlar SILINMEDI (devredildi)             PASS';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'D6   retracted kanitlar silindi FAIL'; END IF;
  ELSE
    v_fail:=v_fail+1; RAISE WARNING 'D5/D6 DNA RETRACTED olmadi: % FAIL', v_res;
  END IF;

  -- ═══ FI. FLEET INTELLIGENCE → CHAIN ════════════════════════════════
  i1 := public._fleet_upsert_insight(A_CO, 'FUEL_OUTLIER', 'TRIP_METRICS',
                                     'VEHICLE', A_VEH, T0 - interval '1 day', now());
  PERFORM public._fleet_add_evidence(i1, 'VEHICLE', A_VEH::text, 'fuel_a', 9.4, 'MEASURED');
  PERFORM public._fleet_add_evidence(i1, 'TRIP', t1::text, 'fuel_b', 9.1, 'MEASURED');

  SELECT count(*) INTO v_n FROM public.ai_evidence_chain
   WHERE consumer='FLEET_INSIGHT' AND consumer_id = i1::text;
  IF v_n = 0 THEN
    RAISE NOTICE 'FI1  KANIT <3 iken ACTIVE zincir OLUSMADI                  PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'FI1  yetersiz kanitta zincir kuruldu: % FAIL', v_n; END IF;

  PERFORM public._fleet_add_evidence(i1, 'METRIC', 'fleet_avg', 'fuel_c', 7.2, 'MEASURED');

  SELECT count(*) INTO v_n FROM public.ai_evidence_chain
   WHERE consumer='FLEET_INSIGHT' AND consumer_id = i1::text;
  IF v_n >= 3 THEN
    RAISE NOTICE 'FI2  esik asilinca ZINCIR kuruldu (% bag)                  PASS', v_n;
  ELSE v_fail:=v_fail+1; RAISE WARNING 'FI2  zincir kurulmadi: % FAIL', v_n; END IF;

  /* Aynı insight tekrar işlenince duplicate zincir OLUŞMAZ. */
  FOR i IN 1..5 LOOP
    UPDATE public.fleet_insight SET evidence_count = evidence_count WHERE id = i1;
  END LOOP;
  SELECT count(*) INTO v_n2 FROM public.ai_evidence_chain
   WHERE consumer='FLEET_INSIGHT' AND consumer_id = i1::text;
  IF v_n2 = v_n THEN
    RAISE NOTICE 'FI3  insight REPLAY duplicate zincir URETMEDI              PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'FI3  zincir sisti: % -> % FAIL', v_n, v_n2; END IF;

  /* SINGLE_VEHICLE_ONLY etiketi KORUNUR. */
  SELECT count(*) INTO v_n FROM public.ai_evidence
   WHERE source='FLEET_INTELLIGENCE' AND metric LIKE '%single_vehicle_only%';
  IF v_n > 0 THEN
    RAISE NOTICE 'FI4  SINGLE_VEHICLE_ONLY etiketi kanita TASINDI            PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'FI4  tek-arac etiketi kaybedildi FAIL'; END IF;

  /* Kaynağı olmayan tipler kanıt üretmez. */
  DECLARE v_bat uuid;
  BEGIN
    v_bat := public._fleet_upsert_insight(A_CO, 'BATTERY_TREND', 'TRIP_METRICS',
                                          'VEHICLE', A_VEH, T0 - interval '2 days', now());
    PERFORM public._fleet_add_evidence(v_bat, 'VEHICLE', A_VEH::text, 'v1', 12.1, 'MEASURED');
    PERFORM public._fleet_add_evidence(v_bat, 'VEHICLE', A_VEH::text, 'v2', 12.2, 'MEASURED');
    PERFORM public._fleet_add_evidence(v_bat, 'VEHICLE', A_VEH::text, 'v3', 12.3, 'MEASURED');
    SELECT count(*) INTO v_n FROM public.ai_evidence_chain
     WHERE consumer='FLEET_INSIGHT' AND consumer_id = v_bat::text;
    IF v_n = 0 THEN
      RAISE NOTICE 'FI5  BATTERY_TREND icin kanit/zincir URETILMEDI            PASS';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FI5  kaynaksiz tip kanit uretti FAIL'; END IF;
  END;

  -- ═══ SO. KAYNAK SAHİPLİĞİ ══════════════════════════════════════════
  v_res := public._evidence_adapter_record(
    'TRIP_METRICS_ADAPTER', 'DRIVER_DNA', A_CO, 'DRIVER', 'sahte_metric',
    A_VEH, NULL, NULL, 'INFO', 'MEASURED', 1, 5);
  IF v_res = 'FOREIGN_SOURCE' THEN
    RAISE NOTICE 'SO1  adaptor BASKA kaynagin kanitini YAZAMADI              PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'SO1  kaynak sahipligi ihlali: % FAIL', v_res; END IF;

  v_res := public._evidence_adapter_record(
    'UYDURMA_ADAPTER', 'TRIP_ENGINE', A_CO, 'TRIP', 'sahte2',
    A_VEH, NULL, NULL, 'INFO', 'MEASURED', 1, 5);
  IF v_res = 'FOREIGN_SOURCE' THEN
    RAISE NOTICE 'SO2  TANINMAYAN adaptor kanit YAZAMADI                     PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'SO2  taninmayan adaptor yazdi: % FAIL', v_res; END IF;

  -- ═══ X. CROSS-TENANT + DEVİR ═══════════════════════════════════════
  INSERT INTO public.vehicle_trips
    (vehicle_id, trip_key, revision, started_at, ended_at, distance_km, distance_source)
  VALUES (B_VEH, 'p56-btrip', 1, T0, T0 + interval '1 hour', 20, 'MEASURED');

  SELECT count(*) INTO v_n FROM public.ai_evidence
   WHERE company_id = A_CO AND vehicle_id = B_VEH;
  IF v_n = 0 THEN
    RAISE NOTICE 'X1   BASKA sirketin araci A sirketine kanit YAZMADI        PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'X1   cross-tenant kanit olustu FAIL'; END IF;

  /* DEVİR: araç el değiştirse bile GEÇMİŞ kanıt erişilebilir kalır. */
  SELECT count(*) INTO v_n FROM public.ai_evidence WHERE trip_id = t1;
  UPDATE public.vehicles SET company_id = B_CO WHERE id = A_VEH;
  SELECT count(*) INTO v_n2 FROM public.ai_evidence WHERE trip_id = t1;
  IF v_n2 = v_n THEN
    RAISE NOTICE 'X2   DEVIR sonrasi GECMIS kanit SILINMEDI                  PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'X2   devirde kanit kayboldu: % -> % FAIL', v_n, v_n2; END IF;
  UPDATE public.vehicles SET company_id = A_CO WHERE id = A_VEH;

  -- ═══ IM. DEĞİŞMEZLİK (055 kuralı hâlâ geçerli) ═════════════════════
  SELECT * INTO ev FROM public.ai_evidence WHERE trip_id = t1 LIMIT 1;
  BEGIN
    UPDATE public.ai_evidence SET source='BLACKBOX' WHERE id = ev.id;
    v_fail:=v_fail+1; RAISE WARNING 'IM1  kaynak degistirilebildi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'IM1  kanit kaynagi DEGISTIRILEMEDI (immutable)             PASS';
  END;

  -- ═══ AD. ADAPTÖR DURUMU ════════════════════════════════════════════
  SELECT count(*) INTO v_n FROM public.ai_evidence_adapter_state
   WHERE source IN ('TRIP_ENGINE','DRIVER_DNA','FLEET_INTELLIGENCE');
  IF v_n = 3 THEN
    RAISE NOTICE 'AD1  UC adaptorun de durumu KAYDEDILDI                     PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'AD1  % adaptor durumu FAIL', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.ai_evidence_adapter_state
   WHERE reported_count > 0;
  IF v_n >= 2 THEN
    RAISE NOTICE 'AD2  REPORTED sayaclari GERCEK olaylardan artti            PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'AD2  sayaclar artmadi FAIL'; END IF;

  SELECT count(*) INTO v_n FROM public.ai_evidence_adapter_state
   WHERE deduped_count > 0;
  IF v_n >= 1 THEN
    RAISE NOTICE 'AD3  DEDUPED sayaci replay ile artti                       PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'AD3  dedupe sayilmadi FAIL'; END IF;

  -- ═══ FIso. HATA YALITIMI ═══════════════════════════════════════════
  --
  -- Adaptör patlasa bile ANA İŞLEM (trip yazımı) tamamlanmalı.
  DECLARE v_before int; v_after int;
  BEGIN
    SELECT count(*) INTO v_before FROM public.vehicle_trips WHERE trip_key LIKE 'p56-%';
    /* `_evidence_wire_safely` var olmayan özneyle çağrılır — patlamamalı. */
    v_res := public._evidence_wire_safely('TRIP_ENGINE', 'TRIP', gen_random_uuid());
    SELECT count(*) INTO v_after FROM public.vehicle_trips WHERE trip_key LIKE 'p56-%';
    IF v_after = v_before THEN
      RAISE NOTICE 'FI6  adaptor hatasi ANA ISLEMI bozmadi (yalitim)           PASS';
    ELSE v_fail:=v_fail+1; RAISE WARNING 'FI6  ana islem bozuldu FAIL'; END IF;
  END;

  /* Hata sessizce yutulmaz: sonuç bir DURUM olarak döner. */
  IF v_res IN ('REPORTED','DEDUPED','REJECTED','DEGRADED','RETRY_PENDING') THEN
    RAISE NOTICE 'FI7  sonuc bounded DURUM olarak dondu (% )                 PASS', v_res;
  ELSE v_fail:=v_fail+1; RAISE WARNING 'FI7  sessiz yutma: % FAIL', v_res; END IF;

  -- ═══ CH. ZİNCİR İLERİ/GERİ ═════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);
  SELECT count(*) INTO v_n FROM public.get_evidence_chain('FLEET_INSIGHT', i1::text);
  IF v_n >= 3 THEN
    RAISE NOTICE 'CH1  ILERI yon: icgorunun kanitlari okundu (%)             PASS', v_n;
  ELSE v_fail:=v_fail+1; RAISE WARNING 'CH1  ileri zincir okunamadi: % FAIL', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.ai_evidence_chain c
    JOIN public.ai_evidence e ON e.id = c.evidence_id
   WHERE e.trip_id = t1;
  IF v_n >= 1 THEN
    RAISE NOTICE 'CH2  GERI yon: kanitin besledigi cikti bulundu             PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'CH2  ters zincir yok FAIL'; END IF;

  SELECT count(*) INTO v_n FROM public.get_subject_evidence('TRIP', t1);
  IF v_n > 0 THEN
    RAISE NOTICE 'CH3  TRIP detayi icin kanit listesi okunabiliyor           PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'CH3  trip kanit listesi bos FAIL'; END IF;

  SELECT count(*) INTO v_n FROM public.get_subject_evidence('DRIVER', d1);
  IF v_n > 0 THEN
    RAISE NOTICE 'CH4  SURUCU profili icin kanit listesi okunabiliyor        PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'CH4  surucu kanit listesi bos FAIL'; END IF;

  -- ═══ R. REGRESYON ══════════════════════════════════════════════════
  SELECT * INTO res FROM public._resolve_driver_presence(
    gen_random_uuid(), gen_random_uuid(), now() - interval '1 hour', now(), NULL);
  IF res.decision = 'NO_PRESENCE' THEN
    RAISE NOTICE 'R1   presence resolver DEGISMEDI                           PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'R1   presence bozuldu FAIL'; END IF;

  IF public._dna_status(4,500)='NO_DNA'
     AND public._fleet_insight_confidence(50,1,100,50) NOT IN ('HIGH','VERY_HIGH')
     AND public._evidence_confidence('BLACKBOX','MEASURED',1)='MEDIUM' THEN
    RAISE NOTICE 'R2   DNA / FI / Evidence guven kapilari DEGISMEDI          PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'R2   guven kapilari degisti FAIL'; END IF;

  SELECT count(*) INTO v_n FROM public.vehicle_trips WHERE trip_key='p56-t1';
  IF v_n = 1 THEN
    RAISE NOTICE 'R3   Trip Engine kayitlari ETKILENMEDI                     PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'R3   trip kaydi bozuldu FAIL'; END IF;

  IF v_fail = 0 THEN
    RAISE NOTICE '─────────────────────────────────────────────────────────';
    RAISE NOTICE '056 DOGRULAMA: TUM KONTROLLER GECTI';
  ELSE
    RAISE EXCEPTION '056 DOGRULAMA: % KONTROL DUSTU', v_fail;
  END IF;
END
$verify$;

-- ── Yetki kapıları ──────────────────────────────────────────────────────
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','b0e18b7e-2951-472d-acf1-46c674dcd8a2')::text, true);
SET LOCAL ROLE authenticated;
/* NOT: B'nin KENDİ kanıtı olabilir (B aracının yolculuğu bu testte kanıt
   üretti) — doğru soru "B hiç kanıt görüyor mu" DEĞİL, **"B, A'nın
   kanıtlarını görüyor mu"**dur. */
SELECT CASE WHEN count(*) = 0
            THEN 'S1   B admini A kanitlarini GOREMIYOR (RLS)             PASS'
            ELSE 'S1   RLS SIZINTISI FAIL' END AS sonuc
  FROM public.ai_evidence
 WHERE company_id = 'f1eef1ee-0000-0000-0000-000000000001';
ROLLBACK;

BEGIN;
SET LOCAL ROLE anon;
SELECT CASE WHEN has_function_privilege('anon','public.get_subject_evidence(text,uuid)','EXECUTE')
              OR has_table_privilege('anon','public.ai_evidence','SELECT')
              OR has_table_privilege('anon','public.ai_evidence_adapter_state','SELECT')
            THEN 'S2   ANON kanit okuyabiliyor FAIL'
            ELSE 'S2   ANON hicbir kanit yuzeyine erisemez              PASS'
       END AS sonuc;
ROLLBACK;

-- Temizlik.
DELETE FROM public.ai_evidence WHERE company_id IN
  ('f1eef1ee-0000-0000-0000-000000000001','f2eef2ee-0000-0000-0000-000000000002');
DELETE FROM public.ai_evidence_retry;
DELETE FROM public.ai_evidence_adapter_state;
DELETE FROM public.fleet_insight WHERE company_id IN
  ('f1eef1ee-0000-0000-0000-000000000001','f2eef2ee-0000-0000-0000-000000000002');
DELETE FROM public.vehicle_trips WHERE trip_key LIKE 'p56-%';
DELETE FROM public.driver_dna WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P56 %');
DELETE FROM public.vehicle_driver_assignments WHERE note LIKE 'P56%';
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'P56 %';
