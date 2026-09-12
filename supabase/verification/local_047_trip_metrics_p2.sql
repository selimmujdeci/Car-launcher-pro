-- ═══════════════════════════════════════════════════════════════════════════
-- 047 — FLEET TRIP METRICS P2 · GERÇEK PostgreSQL DOĞRULAMASI
--
-- MOCK DEĞİL: gerçek tablo, gerçek RPC, gerçek RLS, gerçek `auth.uid()`.
-- Her kontrol PASS/FAIL basar; FAIL varsa sonda toplu RAISE ile düşer.
--
-- ÖN KOŞUL: 046 uygulanmış ve fixture araçları mevcut
--   · aaaa1111-… / `val-key-1` → owner_id dolu (bireysel sahiplik)
--   · bbbb2222-… / `val-key-2` → company_id dolu (filo)
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

DO $verify$
DECLARE
  v_fail    int := 0;
  v_owner   uuid;
  v_company uuid;
  v_veh     uuid := 'aaaa1111-0000-0000-0000-000000000001';
  v_veh_co  uuid := 'bbbb2222-0000-0000-0000-000000000002';
  r         jsonb;
  t         public.vehicle_trips%ROWTYPE;
  n         int;
  v_txt     text;

  PROCEDURE_NOOP int;   -- (kullanılmıyor; plpgsql DECLARE bloğu boş kalmasın)

  -- Yerel yardımcı yerine basit sayaç deseni kullanılır.
BEGIN
  SELECT owner_id INTO v_owner FROM public.vehicles WHERE id = v_veh;
  SELECT company_id INTO v_company FROM public.vehicles WHERE id = v_veh_co;

  -- ═══ A. MEVCUT 046 SATIRLARI BOZULMADI ═══════════════════════════════
  SELECT count(*) INTO n FROM public.vehicle_trips WHERE trip_key IN ('t-replay','t-sonra','t-co');
  IF n = 3 THEN RAISE NOTICE 'P1   046 satirlari KORUNDU (3/3)                          PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P1   046 satirlari KAYIP (%/3)                FAIL', n; END IF;

  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key = 't-replay';
  IF t.distance_km = 42.500 AND t.distance_source = 'MEASURED' AND t.confidence = 'HIGH' THEN
    RAISE NOTICE 'P2   eski satir DEGERLERI degismedi                       PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P2   eski satir degerleri BOZULDU             FAIL'; END IF;

  -- Eski satırlarda YENİ kolonlar NULL olmalı (uydurma 0 YOK).
  IF t.unknown_time_min IS NULL AND t.fuel_used_percent IS NULL
     AND t.price_source IS NULL AND t.metrics_version IS NULL
     AND t.max_rpm_source IS NULL THEN
    RAISE NOTICE 'P3   eski satirda P2 kolonlari NULL (sahte 0 YOK)         PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P3   eski satirda P2 kolonlari uydurulmus     FAIL'; END IF;

  -- ═══ B. _trip_source CANLI ÇALIŞIYOR ═════════════════════════════════
  IF public._trip_source('MEASURED') = 'MEASURED'
     AND public._trip_source('DERIVED') = 'DERIVED'
     AND public._trip_source('bozuk') IS NULL
     AND public._trip_source(NULL) IS NULL THEN
    RAISE NOTICE 'P4   _trip_source canli + uydurmuyor                      PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P4   _trip_source hatali                      FAIL'; END IF;

  -- ═══ C. TEK YAZMA İMZASI ═════════════════════════════════════════════
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
   WHERE nsp.nspname='public' AND p.proname='upload_vehicle_trip';
  IF n = 1 THEN RAISE NOTICE 'P5   upload_vehicle_trip TEK imza (P1 overload dusuruldu) PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P5   % imza var — P2 alanlari sessizce dusebilir FAIL', n; END IF;

  -- ═══ D. İLK YAZIM + P2 ALANLARI GERÇEKTEN YAZILDI ════════════════════
  r := public.upload_vehicle_trip(
    p_api_key  => 'val-key-1',
    p_trip_key => 'p2-trip-1',
    p_trip_id  => 'local-1',
    p_revision => 1,
    p_started_at_ms => (extract(epoch from now()) * 1000)::bigint - 600000,
    p_ended_at_ms   => (extract(epoch from now()) * 1000)::bigint,
    p_metrics  => jsonb_build_object(
      'distanceKm', 12.5, 'durationMin', 10,
      'movingTimeMin', 6, 'idleTimeMin', 2, 'unknownTimeMin', 1,
      'stopCount', 3, 'maxRpm', 3200, 'maxEngineTempC', 92,
      'harshBrakeCount', 2, 'harshAccelCount', 1,
      'fuelUsedPercent', 4.5, 'fuelUnit', 'L', 'fuelUsedL', 1.06,
      'estimatedCost', 47.70, 'averageSpeedKmh', 75, 'maximumSpeedKmh', 110),
    p_score => 88,
    p_confidence => 'VERY_HIGH',
    p_sources => jsonb_build_object('distance','MEASURED','fuel','DERIVED','cost','ESTIMATED'),
    p_provenance => jsonb_build_object(
      'duration','MEASURED','avgSpeed','DERIVED','maxSpeed','MEASURED',
      'idle','MEASURED','moving','MEASURED','stopCount','MEASURED',
      'maxRpm','MEASURED','maxTemp','MEASURED',
      'harshBrake','MEASURED','harshAccel','MEASURED',
      'speedViolation','UYDURMA_DEGER'),
    p_price => jsonb_build_object('unitPrice', 45, 'currency','TRY',
                                  'source','DEFAULT_FALLBACK',
                                  'capturedAtMs', (extract(epoch from now())*1000)::bigint - 600000),
    p_coverage => jsonb_build_object('speedSampleCount', 84, 'obdCoverage', 0.62,
                                     'timeCoverage', 0.9, 'dataGapCount', 1,
                                     'sourceSwitchCount', 2, 'limitedBy','timeCoverage'),
    p_metrics_version => 1,
    p_events => '[]'::jsonb);

  IF r->>'state' = 'CREATED' THEN RAISE NOTICE 'P6   ILK YAZIM CREATED                                    PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P6   ilk yazim CREATED degil: %              FAIL', r; END IF;

  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p2-trip-1';

  IF t.unknown_time_min = 1 AND t.moving_time_min = 6 AND t.idle_time_min = 2 THEN
    RAISE NOTICE 'P7   sure ayrisimi yazildi (moving/idle/UNKNOWN ayri)     PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P7   sure ayrisimi yazilmadi                  FAIL'; END IF;

  IF t.fuel_used_percent = 4.50 AND t.fuel_unit = 'L' THEN
    RAISE NOTICE 'P8   yakit YUZDE olcumu + birim yazildi                   PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P8   yakit yuzde/birim yazilmadi              FAIL'; END IF;

  IF t.fuel_unit_price = 45 AND t.currency = 'TRY'
     AND t.price_source = 'DEFAULT_FALLBACK' AND t.price_captured_at IS NOT NULL THEN
    RAISE NOTICE 'P9   FIYAT SNAPSHOT yazildi (kaynak+birim+an)             PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P9   fiyat snapshot yazilmadi                 FAIL'; END IF;

  IF t.speed_sample_count = 84 AND t.obd_coverage = 0.620 AND t.time_coverage = 0.900
     AND t.data_gap_count = 1 AND t.source_switch_count = 2
     AND t.confidence_limited_by = 'timeCoverage' THEN
    RAISE NOTICE 'P10  CONFIDENCE KANITI yazildi (denetlenebilir)           PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P10  confidence kaniti yazilmadi              FAIL'; END IF;

  IF t.duration_source='MEASURED' AND t.max_rpm_source='MEASURED'
     AND t.harsh_brake_source='MEASURED' AND t.moving_source='MEASURED' THEN
    RAISE NOTICE 'P11  METRIK BASINA provenance yazildi                     PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P11  metrik basina provenance yazilmadi       FAIL'; END IF;

  -- Tanınmayan provenance UYDURULMAMALI.
  IF t.speed_violation_source IS NULL THEN
    RAISE NOTICE 'P12  TANINMAYAN provenance uydurulmadi (NULL)             PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P12  taninmayan provenance uyduruldu: %       FAIL', t.speed_violation_source; END IF;

  -- Hız limiti kaynağı yok → ihlal ÜRETİLMEMELİ.
  IF t.speed_violations IS NULL THEN
    RAISE NOTICE 'P13  HIZ IHLALI uretilmedi (limit kaynagi YOK)            PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P13  hiz ihlali uyduruldu                     FAIL'; END IF;

  IF t.confidence = 'VERY_HIGH' THEN
    RAISE NOTICE 'P14  VERY_HIGH confidence KABUL edildi (046 reddediyordu)  PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P14  VERY_HIGH reddedildi: %                  FAIL', t.confidence; END IF;

  IF t.metrics_version = 1 THEN RAISE NOTICE 'P15  metrics_version yazildi                              PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P15  metrics_version yazilmadi                FAIL'; END IF;

  -- ═══ E. DEDUPE / REVİZYON / NULL KORUMASI ════════════════════════════
  r := public.upload_vehicle_trip('val-key-1','p2-trip-1','local-1',1,
        NULL,NULL, jsonb_build_object('distanceKm',12.5));
  IF r->>'state' = 'DUPLICATE' THEN RAISE NOTICE 'P16  AYNI revizyon -> DUPLICATE (yazma YOK)               PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P16  ayni revizyon DUPLICATE degil: %         FAIL', r; END IF;

  -- Daha yüksek revizyon: düzeltme; EKSİK alan eskiyi EZMEMELİ.
  r := public.upload_vehicle_trip('val-key-1','p2-trip-1','local-1',2,
        NULL,NULL, jsonb_build_object('distanceKm', 13.0));
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p2-trip-1';
  IF r->>'state' = 'UPDATED' AND t.distance_km = 13.000 THEN
    RAISE NOTICE 'P17  YUKSEK revizyon -> UPDATED (duzeltme uygulandi)      PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P17  yuksek revizyon UPDATED degil: %         FAIL', r; END IF;

  IF t.max_rpm = 3200 AND t.unknown_time_min = 1 AND t.price_source = 'DEFAULT_FALLBACK'
     AND t.speed_sample_count = 84 AND t.duration_source = 'MEASURED' THEN
    RAISE NOTICE 'P18  NULL PRESERVATION: eksik alan eskiyi EZMEDI          PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P18  eksik alan eski guvenilir metrigi EZDI   FAIL'; END IF;

  -- Eksik provenance gönderimi eski provenance'ı da ezmemeli.
  IF t.max_rpm_source = 'MEASURED' THEN
    RAISE NOTICE 'P19  eksik PROVENANCE eskiyi ezmedi                       PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P19  eksik provenance eskiyi ezdi             FAIL'; END IF;

  -- Daha düşük revizyon da DUPLICATE.
  r := public.upload_vehicle_trip('val-key-1','p2-trip-1','local-1',1,
        NULL,NULL, jsonb_build_object('distanceKm',99.0));
  SELECT distance_km INTO v_txt FROM public.vehicle_trips WHERE trip_key='p2-trip-1';
  IF r->>'state' = 'DUPLICATE' AND v_txt::numeric = 13.000 THEN
    RAISE NOTICE 'P20  DUSUK revizyon -> DUPLICATE, deger korundu           PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P20  dusuk revizyon degeri bozdu              FAIL'; END IF;

  -- ═══ F. OFFLINE REPLAY ═══════════════════════════════════════════════
  FOR n IN 1..10 LOOP
    PERFORM public.upload_vehicle_trip('val-key-1','p2-trip-1','local-1',2,
              NULL,NULL, jsonb_build_object('distanceKm',13.0));
  END LOOP;
  SELECT count(*) INTO n FROM public.vehicle_trips WHERE trip_key='p2-trip-1';
  SELECT distance_km INTO v_txt FROM public.vehicle_trips WHERE trip_key='p2-trip-1';
  IF n = 1 AND v_txt::numeric = 13.000 THEN
    RAISE NOTICE 'P21  OFFLINE REPLAY 10x -> TEK satir, deger bozulmadi     PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P21  replay satir cogaltti (%)                FAIL', n; END IF;

  -- ═══ G. KISITLAR ═════════════════════════════════════════════════════
  -- Süre invaryantı: moving+idle+unknown > duration+3 REDDEDİLMELİ.
  BEGIN
    INSERT INTO public.vehicle_trips
      (vehicle_id, trip_key, revision, started_at, distance_km, duration_min,
       moving_time_min, idle_time_min, unknown_time_min)
    VALUES (v_veh, 'p2-invariant-bad', 1, now(), 5, 10, 20, 20, 20);
    v_fail := v_fail + 1;
    RAISE WARNING 'P22  SURE INVARYANTI kisiti CALISMIYOR          FAIL';
    DELETE FROM public.vehicle_trips WHERE trip_key='p2-invariant-bad';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'P22  SURE INVARYANTI kisiti calisiyor (moving+idle+unk)   PASS';
  END;

  -- Geçersiz fuel_unit reddedilmeli.
  BEGIN
    INSERT INTO public.vehicle_trips
      (vehicle_id, trip_key, revision, started_at, distance_km, fuel_unit)
    VALUES (v_veh, 'p2-unit-bad', 1, now(), 5, 'GALON');
    v_fail := v_fail + 1;
    RAISE WARNING 'P23  fuel_unit kisiti CALISMIYOR                FAIL';
    DELETE FROM public.vehicle_trips WHERE trip_key='p2-unit-bad';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'P23  fuel_unit kisiti calisiyor (L/PERCENT)               PASS';
  END;

  -- Kapsama oranı 0–1 dışı reddedilmeli.
  BEGIN
    INSERT INTO public.vehicle_trips
      (vehicle_id, trip_key, revision, started_at, distance_km, obd_coverage)
    VALUES (v_veh, 'p2-cov-bad', 1, now(), 5, 1.5);
    v_fail := v_fail + 1;
    RAISE WARNING 'P24  kapsama 0-1 kisiti CALISMIYOR              FAIL';
    DELETE FROM public.vehicle_trips WHERE trip_key='p2-cov-bad';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'P24  kapsama 0-1 kisiti calisiyor                         PASS';
  END;

  -- Geçersiz provenance sınıfı reddedilmeli.
  BEGIN
    INSERT INTO public.vehicle_trips
      (vehicle_id, trip_key, revision, started_at, distance_km, max_rpm_source)
    VALUES (v_veh, 'p2-prov-bad', 1, now(), 5, 'GUESSED');
    v_fail := v_fail + 1;
    RAISE WARNING 'P25  provenance enum kisiti CALISMIYOR          FAIL';
    DELETE FROM public.vehicle_trips WHERE trip_key='p2-prov-bad';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'P25  provenance enum kisiti calisiyor                     PASS';
  END;

  -- Mesafesiz trip REDDEDİLMELİ (P1 davranışı korunuyor).
  r := public.upload_vehicle_trip('val-key-1','p2-nodist','x',1,NULL,NULL,'{}'::jsonb);
  SELECT count(*) INTO n FROM public.vehicle_trips WHERE trip_key='p2-nodist';
  IF r->>'reason' = 'NO_DISTANCE' AND n = 0 THEN
    RAISE NOTICE 'P26  MESAFESIZ trip reddedildi (satir YOK)                PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P26  mesafesiz trip kabul edildi              FAIL'; END IF;

  -- Geçersiz api_key REDDEDİLMELİ.
  BEGIN
    PERFORM public.upload_vehicle_trip('YANLIS-KEY','p2-bad','x',1,NULL,NULL,
              jsonb_build_object('distanceKm',5));
    v_fail := v_fail + 1;
    RAISE WARNING 'P27  GECERSIZ api_key kabul edildi              FAIL';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'P27  gecersiz api_key REDDEDILDI                          PASS';
  END;

  -- ═══ H. RLS / KAPSAM ═════════════════════════════════════════════════
  IF NOT has_table_privilege('anon','public.vehicle_trips','SELECT')
     AND NOT has_function_privilege('anon','public.list_vehicle_trips(uuid,integer)','EXECUTE') THEN
    RAISE NOTICE 'P28  ANON DENY: tablo SELECT=f, okuma RPC=f               PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P28  anon okuma yetkisi ACIK                  FAIL'; END IF;

  IF (SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='vehicle_trips') THEN
    RAISE NOTICE 'P29  RLS acik                                             PASS';
  ELSE v_fail := v_fail + 1; RAISE WARNING 'P29  RLS KAPALI                               FAIL'; END IF;

  IF v_fail = 0 THEN
    RAISE NOTICE '─────────────────────────────────────────────────────────';
    RAISE NOTICE '047 DOGRULAMA: TUM KONTROLLER GECTI';
  ELSE
    RAISE EXCEPTION '047 DOGRULAMA: % KONTROL DUSTU', v_fail;
  END IF;
END
$verify$;

-- ═══ I. OTURUM KAPSAMI (ayrı — auth.uid() gerektirir) ══════════════════
-- Owner oturumu: kendi aracının trip'ini GÖRMELİ.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT owner_id::text FROM public.vehicles
                            WHERE id='aaaa1111-0000-0000-0000-000000000001'))::text, true);
SET LOCAL ROLE authenticated;
SELECT CASE WHEN count(*) > 0 THEN 'P30  OWNER kendi trip ini GORUYOR                          PASS'
            ELSE 'P30  OWNER trip GOREMIYOR                       FAIL' END AS sonuc
FROM public.list_vehicle_trips('aaaa1111-0000-0000-0000-000000000001', 50);
ROLLBACK;

-- Yabancı kullanıcı: CROSS-TENANT reddi.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-dead-beef-0000-000000000099')::text, true);
SET LOCAL ROLE authenticated;
SELECT CASE WHEN count(*) = 0 THEN 'P31  CROSS-TENANT reddi (yabanci 0 satir)                 PASS'
            ELSE 'P31  CROSS-TENANT SIZINTI                       FAIL' END AS sonuc
FROM public.list_vehicle_trips('aaaa1111-0000-0000-0000-000000000001', 50);
ROLLBACK;

-- Oturumsuz: fail-closed.
BEGIN;
SELECT set_config('request.jwt.claims', NULL, true);
SET LOCAL ROLE authenticated;
SELECT CASE WHEN count(*) = 0 THEN 'P32  OTURUMSUZ 0 satir (fail-closed)                      PASS'
            ELSE 'P32  OTURUMSUZ SIZINTI                          FAIL' END AS sonuc
FROM public.list_vehicle_trips('aaaa1111-0000-0000-0000-000000000001', 50);
ROLLBACK;

-- Okuma RPC'si P2 alanlarını GERÇEKTEN döndürüyor mu.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT owner_id::text FROM public.vehicles
                            WHERE id='aaaa1111-0000-0000-0000-000000000001'))::text, true);
SET LOCAL ROLE authenticated;
SELECT CASE WHEN bool_and(
              unknown_time_min IS NOT NULL AND price_source IS NOT NULL
              AND speed_sample_count IS NOT NULL AND max_rpm_source IS NOT NULL
              AND metrics_version IS NOT NULL)
            THEN 'P33  OKUMA RPC si P2 alanlarini donduruyor                PASS'
            ELSE 'P33  okuma RPC si P2 alanlarini DUSURUYOR       FAIL' END AS sonuc
FROM public.list_vehicle_trips('aaaa1111-0000-0000-0000-000000000001', 50)
WHERE trip_key = 'p2-trip-1';
ROLLBACK;

-- Temizlik: bu koşumun ürettiği satır.
DELETE FROM public.vehicle_trips WHERE trip_key = 'p2-trip-1';
