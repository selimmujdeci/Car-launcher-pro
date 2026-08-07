-- ═══════════════════════════════════════════════════════════════════════════
-- 054 — FLEET INTELLIGENCE ENGINE P1 · GERÇEK PostgreSQL DOĞRULAMASI
--
-- MOCK DEĞİL: gerçek tablo, gerçek trigger, gerçek RLS, gerçek fonksiyonlar.
--
-- EN KRİTİK KANITLAR:
--   · KANITSIZ içgörü YAYIMLANAMAZ (fail-closed)
--   · TEK ARAÇTAN `HIGH` ÇIKMAZ (filo iddiası olamaz)
--   · aynı kanıt iki kez birikmez (replay) · aynı konu iki içgörü açmaz (dedupe)
--   · cross-tenant kanıt REDDEDİLİR · devir sonrası sızıntı YOK
--   · ölçülmemiş kanıt `0` sayılmaz (UNKNOWN korunur)
--   · DNA · trip · presence · authentication katmanları DEĞİŞMEDİ
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

DELETE FROM public.fleet_insight WHERE company_id IN
  ('f1eef1ee-0000-0000-0000-000000000001','f2eef2ee-0000-0000-0000-000000000002');
DELETE FROM public.fleet_trend WHERE company_id IN
  ('f1eef1ee-0000-0000-0000-000000000001','f2eef2ee-0000-0000-0000-000000000002');
DELETE FROM public.fleet_health WHERE company_id IN
  ('f1eef1ee-0000-0000-0000-000000000001','f2eef2ee-0000-0000-0000-000000000002');
DELETE FROM public.vehicle_trips WHERE trip_key LIKE 'p54-%';
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'P54 %';

INSERT INTO public.vehicles (id, name, company_id, api_key)
VALUES ('cccc3333-0000-0000-0000-000000000003', 'B Araci',
        'f2eef2ee-0000-0000-0000-000000000002', 'val-key-3'),
       ('dddd4444-0000-0000-0000-000000000004', 'A Araci 2',
        'f1eef1ee-0000-0000-0000-000000000001', 'val-key-4')
ON CONFLICT (id) DO NOTHING;

DO $verify$
DECLARE
  v_fail int := 0;
  A_CO  uuid := 'f1eef1ee-0000-0000-0000-000000000001';
  B_CO  uuid := 'f2eef2ee-0000-0000-0000-000000000002';
  A_ADM uuid := '1178d9db-413d-4f60-97c5-97bfc8393618';
  B_ADM uuid := 'b0e18b7e-2951-472d-acf1-46c674dcd8a2';
  A_VEH uuid := 'bbbb2222-0000-0000-0000-000000000002';
  A_VEH2 uuid := 'dddd4444-0000-0000-0000-000000000004';
  B_VEH uuid := 'cccc3333-0000-0000-0000-000000000003';
  r    jsonb;
  d1   uuid; dB uuid;
  i1   uuid; i2 uuid; i3 uuid;
  ins  public.fleet_insight%ROWTYPE;
  t1   uuid;
  v_n  int; v_rev int; v_res text; v_state text;
  res  record;   -- resolver çıktısı (jsonb DEĞİL)
  W0   timestamptz := now() - interval '30 days';
  W1   timestamptz := now();
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);
  r := public.create_fleet_driver('P54 Ahmet', 'P54-1'); d1 := (r->>'driverId')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', B_ADM)::text, true);
  r := public.create_fleet_driver('P54 Beta',  'P54-B'); dB := (r->>'driverId')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);

  INSERT INTO public.vehicle_trips
    (vehicle_id, trip_key, revision, started_at, ended_at, distance_km, distance_source)
  VALUES (A_VEH, 'p54-t1', 1, W0, W0 + interval '1 hour', 40, 'MEASURED')
  RETURNING id INTO t1;

  -- ═══ M. INSIGHT MERGE + DEDUPE ═════════════════════════════════════
  i1 := public._fleet_upsert_insight(A_CO, 'FUEL_OUTLIER', 'TRIP_METRICS',
                                     'FLEET', NULL, W0, W1);
  IF i1 IS NOT NULL THEN
    RAISE NOTICE 'M1   icgoru olusturuldu (DRAFT)                            PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'M1   icgoru olusmadi FAIL'; END IF;

  SELECT * INTO ins FROM public.fleet_insight WHERE id = i1;
  IF ins.state = 'DRAFT' AND ins.confidence = 'UNKNOWN'
     AND ins.unknown_reason = 'NO_EVIDENCE' THEN
    RAISE NOTICE 'M2   KANITSIZ icgoru DRAFT/UNKNOWN kaldi (fail-closed)     PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'M2   kanitsiz icgoru yayimlandi: % / % FAIL',
       ins.state, ins.confidence; END IF;

  i2 := public._fleet_upsert_insight(A_CO, 'FUEL_OUTLIER', 'TRIP_METRICS',
                                     'FLEET', NULL, W0, W1);
  IF i2 = i1 THEN
    RAISE NOTICE 'M3   AYNI konu icin IKINCI icgoru ACILMADI (dedupe)        PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'M3   dedupe calismadi FAIL'; END IF;

  SELECT count(*) INTO v_n FROM public.fleet_insight
   WHERE company_id=A_CO AND type='FUEL_OUTLIER';
  IF v_n = 1 THEN
    RAISE NOTICE 'M4   defterde TEK icgoru satiri var                        PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'M4   % satir olustu FAIL', v_n; END IF;

  -- ═══ F. KANITSIZ İÇGÖRÜ YAYIMLANAMAZ (son savunma) ═════════════════
  BEGIN
    UPDATE public.fleet_insight SET state='ACTIVE' WHERE id = i1;
    v_fail := v_fail+1; RAISE WARNING 'F1   KANITSIZ icgoru ACTIVE yapilabildi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'F1   kanitsiz icgoruyu ACTIVE yapma REDDEDILDI             PASS';
  END;

  -- ═══ E. EVIDENCE MERGE + REPLAY ════════════════════════════════════
  v_res := public._fleet_add_evidence(i1, 'VEHICLE', A_VEH::text,
                                      'fuel_l_per_100km', 9.4, 'MEASURED');
  IF v_res = 'ADDED' THEN
    RAISE NOTICE 'E1   kanit eklendi                                         PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'E1   kanit eklenmedi: % FAIL', v_res; END IF;

  v_res := public._fleet_add_evidence(i1, 'VEHICLE', A_VEH::text,
                                      'fuel_l_per_100km', 9.4, 'MEASURED');
  IF v_res = 'DUPLICATE' THEN
    RAISE NOTICE 'E2   AYNI kanit ikinci kez EKLENMEDI (replay)              PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'E2   replay kanit eklendi: % FAIL', v_res; END IF;

  SELECT * INTO ins FROM public.fleet_insight WHERE id = i1;
  IF ins.evidence_count = 1 AND ins.vehicle_count = 1 THEN
    RAISE NOTICE 'E3   sayaclar KANITTAN turetildi (1 kanit / 1 arac)        PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'E3   sayaclar yanlis: % / % FAIL',
       ins.evidence_count, ins.vehicle_count; END IF;

  -- ÖLÇÜLMEMİŞ kanıt kabul edilmez (UNKNOWN korunur).
  v_res := public._fleet_add_evidence(i1, 'METRIC', 'battery_v',
                                      'battery_v', NULL::numeric, 'UNKNOWN');
  IF v_res = 'EMPTY_EVIDENCE' THEN
    RAISE NOTICE 'E4   OLCULMEMIS kanit REDDEDILDI (0 sayilmadi)             PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'E4   bos kanit kabul edildi: % FAIL', v_res; END IF;

  -- ═══ C. TEK ARAÇTAN HIGH ÇIKMAZ ════════════════════════════════════
  PERFORM public._fleet_add_evidence(i1, 'TRIP', t1::text,
                                     'fuel_l_per_100km', 9.4, 'MEASURED');
  PERFORM public._fleet_add_evidence(i1, 'METRIC', 'fleet_avg_fuel',
                                     'fuel_l_per_100km', 7.1, 'MEASURED');

  SELECT * INTO ins FROM public.fleet_insight WHERE id = i1;
  IF ins.evidence_count >= 3 AND ins.state = 'ACTIVE' THEN
    RAISE NOTICE 'C1   kanit esigi asilinca icgoru YAYIMLANDI                PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'C1   esik sonrasi yayimlanmadi: % FAIL', ins.state; END IF;

  IF ins.confidence NOT IN ('HIGH','VERY_HIGH')
     AND ins.unknown_reason = 'SINGLE_VEHICLE_ONLY' THEN
    RAISE NOTICE 'C2   TEK ARACTAN HIGH CIKMADI ve gerekce yazildi           PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'C2   tek aractan % cikti FAIL', ins.confidence; END IF;

  -- İkinci araç kanıtı eklenince filo iddiası mümkün olur.
  PERFORM public._fleet_add_evidence(i1, 'VEHICLE', A_VEH2::text,
                                     'fuel_l_per_100km', 9.9, 'MEASURED');
  SELECT * INTO ins FROM public.fleet_insight WHERE id = i1;
  IF ins.vehicle_count = 2 AND ins.unknown_reason IS NULL THEN
    RAISE NOTICE 'C3   IKINCI arac kaniti gelince tek-arac damgasi KALKTI    PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'C3   ikinci aracta damga kalkmadi: % FAIL',
       ins.unknown_reason; END IF;

  -- ═══ X. CROSS-TENANT ═══════════════════════════════════════════════
  v_res := public._fleet_add_evidence(i1, 'VEHICLE', B_VEH::text,
                                      'fuel_l_per_100km', 12.0, 'MEASURED');
  IF v_res = 'TENANT_MISMATCH' THEN
    RAISE NOTICE 'X1   BASKA sirketin araci kanit olarak REDDEDILDI          PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'X1   cross-tenant kanit kabul edildi: % FAIL', v_res; END IF;

  v_res := public._fleet_add_evidence(i1, 'DRIVER', dB::text,
                                      'harsh_per_100km', 4.0, 'MEASURED');
  IF v_res = 'TENANT_MISMATCH' THEN
    RAISE NOTICE 'X2   BASKA sirketin surucusu kanit olarak REDDEDILDI       PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'X2   cross-tenant surucu kabul edildi FAIL'; END IF;

  -- ═══ T. TRANSFER (araç devri) ══════════════════════════════════════
  UPDATE public.vehicles SET company_id = B_CO WHERE id = A_VEH2;
  v_res := public._fleet_add_evidence(i1, 'VEHICLE', A_VEH2::text,
                                      'idle_ratio', 0.2, 'MEASURED');
  IF v_res = 'TENANT_MISMATCH' THEN
    RAISE NOTICE 'T1   DEVREDILEN arac icin YENI kanit REDDEDILDI            PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'T1   devir sonrasi kanit kabul edildi: % FAIL', v_res; END IF;
  UPDATE public.vehicles SET company_id = A_CO WHERE id = A_VEH2;   -- geri al

  -- ═══ TR. TREND MERGE ═══════════════════════════════════════════════
  FOR i IN 1..4 LOOP
    PERFORM public._fleet_trend_merge(A_CO, 'FUEL_PER_100KM', 'BASELINE', 7.0, 3);
  END LOOP;
  v_res := public._fleet_trend_merge(A_CO, 'FUEL_PER_100KM', 'RECENT', 8.0, 3);
  IF v_res = 'INSUFFICIENT' THEN
    RAISE NOTICE 'TR1  YETERSIZ ornekte trend URETILMEDI (min veri sarti)    PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'TR1  yetersiz ornekte trend uretildi: % FAIL', v_res; END IF;

  PERFORM public._fleet_trend_merge(A_CO, 'FUEL_PER_100KM', 'BASELINE', 7.0, 3);
  FOR i IN 1..5 LOOP
    v_res := public._fleet_trend_merge(A_CO, 'FUEL_PER_100KM', 'RECENT', 8.4, 3);
  END LOOP;
  IF v_res = 'RISING' THEN
    RAISE NOTICE 'TR2  yeterli ornekte YUKSELEN trend tespit edildi          PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'TR2  trend yanlis: % FAIL', v_res; END IF;

  SELECT count(*) INTO v_n FROM public.fleet_trend
   WHERE company_id=A_CO AND metric='FUEL_PER_100KM';
  IF v_n = 1 THEN
    RAISE NOTICE 'TR3  sirket x metrik basina TEK trend satiri (merge)       PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'TR3  % trend satiri FAIL', v_n; END IF;

  -- TEK ARAÇLI trend filo iddiası üretmez.
  FOR i IN 1..6 LOOP
    PERFORM public._fleet_trend_merge(A_CO, 'IDLE_RATIO', 'BASELINE', 0.10, 1);
    v_res := public._fleet_trend_merge(A_CO, 'IDLE_RATIO', 'RECENT', 0.30, 1);
  END LOOP;
  IF v_res = 'SINGLE_VEHICLE' THEN
    RAISE NOTICE 'TR4  TEK ARACLI trend filo iddiasi URETMEDI                PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'TR4  tek araclı trend uretildi: % FAIL', v_res; END IF;

  -- ═══ DR. FLEET DRIFT ═══════════════════════════════════════════════
  --
  -- Filo düzeyinde: yakıt %20 arttı → RISING; sapma trendlerden okunur.
  SELECT count(*) INTO v_n FROM public.fleet_trend
   WHERE company_id=A_CO AND direction IN ('RISING','FALLING');
  IF v_n >= 1 THEN
    RAISE NOTICE 'DR1  FILO duzeyinde sapma kanit ile gorunur                PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'DR1  sapma gorunmedi FAIL'; END IF;

  -- ═══ H. HEALTH MERGE ═══════════════════════════════════════════════
  v_state := public._fleet_health_merge(A_CO, 'DATA_HEALTH', 0.9, 4, 40);
  IF v_state = 'GOOD' THEN
    RAISE NOTICE 'H1   saglik boyutu hesaplandi (GOOD)                       PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H1   saglik yanlis: % FAIL', v_state; END IF;

  v_state := public._fleet_health_merge(A_CO, 'TELEMETRY_HEALTH', NULL, 4, 40);
  IF v_state = 'UNKNOWN' THEN
    RAISE NOTICE 'H2   OLCULEMEYEN boyut UNKNOWN kaldi (0 sayilmadi)         PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H2   olculemeyen boyut % oldu FAIL', v_state; END IF;

  SELECT index_value INTO v_rev FROM public.fleet_health
   WHERE company_id=A_CO AND dimension='TELEMETRY_HEALTH';
  IF v_rev IS NULL THEN
    RAISE NOTICE 'H3   UNKNOWN boyutta endeks NULL (sahte 0 YOK)             PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H3   UNKNOWN boyutta endeks var FAIL'; END IF;

  -- Aynı boyut tekrar işlenince YENİ satır açılmaz (merge).
  PERFORM public._fleet_health_merge(A_CO, 'DATA_HEALTH', 0.5, 4, 40);
  SELECT count(*) INTO v_n FROM public.fleet_health
   WHERE company_id=A_CO AND dimension='DATA_HEALTH';
  IF v_n = 1 THEN
    RAISE NOTICE 'H4   ayni boyut icin TEK satir kaldi (merge)               PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H4   % saglik satiri FAIL', v_n; END IF;

  -- TEK PUAN yok: boyutlar ayrı ayrı durur.
  SELECT count(*) INTO v_n FROM public.fleet_health WHERE company_id=A_CO;
  IF v_n >= 2 THEN
    RAISE NOTICE 'H5   saglik BOYUTLARA ayri kayitli (tek puan YOK)          PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H5   saglik boyutlari yok FAIL'; END IF;

  -- ═══ CV. COVERAGE ══════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);
  SELECT coverage, vehicles_total INTO v_rev, v_n FROM public.get_fleet_intelligence();
  IF v_n >= 1 THEN
    RAISE NOTICE 'CV1  kapsam GERCEK arac sayisindan hesaplandi              PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'CV1  kapsam hesaplanmadi FAIL'; END IF;

  -- ═══ R. MEVCUT KATMAN REGRESYONU ═══════════════════════════════════
  SELECT * INTO res FROM public._resolve_driver_presence(
    gen_random_uuid(), gen_random_uuid(), now() - interval '1 hour', now(), NULL);
  IF res.decision = 'NO_PRESENCE' THEN
    RAISE NOTICE 'R1   presence resolver DEGISMEDI                           PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'R1   presence resolver degisti FAIL'; END IF;

  IF public._dna_status(4, 500) = 'NO_DNA' AND public._dna_learning_level(100) = 'ESTABLISHED' THEN
    RAISE NOTICE 'R2   DNA esik ve ogrenme kapilari DEGISMEDI                PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'R2   DNA kapilari degisti FAIL'; END IF;

  SELECT count(*) INTO v_n FROM public.vehicle_trips WHERE trip_key='p54-t1';
  IF v_n = 1 THEN
    RAISE NOTICE 'R3   Trip Engine kayitlari ETKILENMEDI                     PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'R3   trip kaydi bozuldu FAIL'; END IF;

  IF v_fail = 0 THEN
    RAISE NOTICE '─────────────────────────────────────────────────────────';
    RAISE NOTICE '054 DOGRULAMA: TUM KONTROLLER GECTI';
  ELSE
    RAISE EXCEPTION '054 DOGRULAMA: % KONTROL DUSTU', v_fail;
  END IF;
END
$verify$;

-- ── Yetki kapıları ──────────────────────────────────────────────────────
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','b0e18b7e-2951-472d-acf1-46c674dcd8a2')::text, true);
SET LOCAL ROLE authenticated;
SELECT CASE WHEN count(*) = 0
            THEN 'S1   B admini A icgorulerini GOREMIYOR (RLS)            PASS'
            ELSE 'S1   RLS SIZINTISI FAIL' END AS sonuc
  FROM public.fleet_insight;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT CASE WHEN has_table_privilege('authenticated','public.fleet_insight','INSERT')
              OR has_function_privilege('authenticated',
                   'public._fleet_add_evidence(uuid,text,text,text,numeric,text)','EXECUTE')
            THEN 'S2   kullanici icgoru/kanit YAZABILIYOR FAIL'
            ELSE 'S2   icgoru ve kanit elle yazilamaz                     PASS'
       END AS sonuc;
ROLLBACK;

-- Temizlik.
DELETE FROM public.fleet_insight WHERE company_id IN
  ('f1eef1ee-0000-0000-0000-000000000001','f2eef2ee-0000-0000-0000-000000000002');
DELETE FROM public.fleet_trend WHERE company_id IN
  ('f1eef1ee-0000-0000-0000-000000000001','f2eef2ee-0000-0000-0000-000000000002');
DELETE FROM public.fleet_health WHERE company_id IN
  ('f1eef1ee-0000-0000-0000-000000000001','f2eef2ee-0000-0000-0000-000000000002');
DELETE FROM public.vehicle_trips WHERE trip_key LIKE 'p54-%';
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'P54 %';
DELETE FROM public.vehicles WHERE id = 'dddd4444-0000-0000-0000-000000000004';
