-- ═══════════════════════════════════════════════════════════════════════════
-- 050 — DRIVER PRESENCE HISTORY · GERÇEK PostgreSQL DOĞRULAMASI
--
-- EN KRİTİK KANITLAR:
--   · geçmiş defteri 049 RESOLVER'INI ve P0 attribution'ı DEĞİŞTİRMEDİ
--   · aynı presence tekrar history ÜRETMEZ (dedupe)
--   · süresi dolan segment DÜZGÜN kapanır (sahte süre YOK)
--   · doğrulanmamış kaynak (HEAD_UNIT) geçmişte de KİMLİK SIZDIRMAZ
--
-- Gerçek NFC/BT kaynağı YOK; gözlemler testte ELLE yazılır (üretimde bunu
-- yazan bir yol YOKTUR — 049 P19).
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

DELETE FROM public.vehicle_trips WHERE trip_key LIKE 'p50-%';
DELETE FROM public.vehicle_driver_presence_history WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P50 %');
DELETE FROM public.vehicle_driver_presence WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P50 %');
DELETE FROM public.vehicle_driver_assignments WHERE note LIKE 'P50%';
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'P50 %';

DO $verify$
DECLARE
  v_fail int := 0;
  A_CO  uuid := 'f1eef1ee-0000-0000-0000-000000000001';
  A_ADM uuid := '1178d9db-413d-4f60-97c5-97bfc8393618';
  A_VEH uuid := 'bbbb2222-0000-0000-0000-000000000002';
  r    jsonb;
  d1   uuid; d2 uuid;
  h    public.vehicle_driver_presence_history%ROWTYPE;
  t    public.vehicle_trips%ROWTYPE;
  res  record;
  v_n  int; v_n2 int;
  v_id uuid;
  T0   timestamptz := date_trunc('hour', now()) - interval '30 hours';
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);

  r := public.create_fleet_driver('P50 Ahmet', 'P50-1');  d1 := (r->>'driverId')::uuid;
  r := public.create_fleet_driver('P50 Mehmet', 'P50-2'); d2 := (r->>'driverId')::uuid;

  -- ═══ A. İLK SEGMENT ════════════════════════════════════════════════
  INSERT INTO public.vehicle_driver_presence
    (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
  VALUES (A_CO, A_VEH, d1, 'NFC', 'VERY_HIGH', T0, T0 + interval '8 hours');

  SELECT * INTO h FROM public.vehicle_driver_presence_history
   WHERE vehicle_id=A_VEH AND driver_id=d1 ORDER BY detected_at DESC LIMIT 1;

  IF FOUND AND h.driver_id = d1 AND h.source='NFC' THEN
    RAISE NOTICE 'H1   presence degisimi HISTORY uretti                       PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H1   history uretilmedi FAIL'; END IF;

  -- Açık segment: süre ve kapanış NULL — sahte 0 YASAK.
  IF h.expired_at IS NULL AND h.duration_ms IS NULL AND h.close_reason IS NULL THEN
    RAISE NOTICE 'H2   ACIK segment sahte sure/kapanis URETMEDI               PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H2   acik segmentte sahte deger: % / % FAIL',
       h.duration_ms, h.close_reason; END IF;

  -- İstenen alanların tamamı taşınıyor mu.
  IF h.driver_id IS NOT NULL AND h.vehicle_id IS NOT NULL AND h.source IS NOT NULL
     AND h.confidence IS NOT NULL AND h.detected_at IS NOT NULL THEN
    RAISE NOTICE 'H3   istenen alanlar (driver/source/conf/detected/vehicle)  PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H3   alan eksik FAIL'; END IF;

  -- ═══ B. DEDUPE — AYNI PRESENCE TEKRAR HISTORY URETMEZ ══════════════
  SELECT count(*) INTO v_n FROM public.vehicle_driver_presence_history
   WHERE vehicle_id=A_VEH AND driver_id=d1;

  FOR i IN 1..5 LOOP
    INSERT INTO public.vehicle_driver_presence
      (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
    VALUES (A_CO, A_VEH, d1, 'NFC', 'VERY_HIGH',
            T0 + (i || ' minutes')::interval, T0 + interval '8 hours');
  END LOOP;

  SELECT count(*) INTO v_n2 FROM public.vehicle_driver_presence_history
   WHERE vehicle_id=A_VEH AND driver_id=d1;
  IF v_n2 = v_n THEN
    RAISE NOTICE 'H4   5x AYNI presence YENI segment URETMEDI (dedupe)        PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H4   dedupe calismadi: % -> % FAIL', v_n, v_n2; END IF;

  SELECT * INTO h FROM public.vehicle_driver_presence_history
   WHERE vehicle_id=A_VEH AND driver_id=d1 ORDER BY detected_at DESC LIMIT 1;
  IF h.refresh_count = 5 THEN
    RAISE NOTICE 'H5   tekrar gozlemler SAYILDI (sessiz yutma yok)            PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H5   refresh_count yanlis: % FAIL', h.refresh_count; END IF;

  -- Birebir aynı gözlem (aynı an) veritabanı seviyesinde de tekilleşir.
  BEGIN
    INSERT INTO public.vehicle_driver_presence_history
      (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
    VALUES (A_CO, A_VEH, d1, 'NFC', 'VERY_HIGH', T0, T0 + interval '8 hours');
    v_fail:=v_fail+1; RAISE WARNING 'H6   ayni gozlem ikinci kez yazildi FAIL';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'H6   birebir ayni gozlem DB seviyesinde REDDEDILDI          PASS';
  END;

  -- ═══ C. DEVİR (SUPERSEDED) ═════════════════════════════════════════
  INSERT INTO public.vehicle_driver_presence
    (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
  VALUES (A_CO, A_VEH, d2, 'NFC', 'VERY_HIGH',
          T0 + interval '2 hours', T0 + interval '10 hours');

  SELECT * INTO h FROM public.vehicle_driver_presence_history
   WHERE vehicle_id=A_VEH AND driver_id=d1 ORDER BY detected_at DESC LIMIT 1;
  IF h.close_reason='SUPERSEDED' AND h.expired_at = T0 + interval '2 hours'
     AND h.duration_ms = 7200000 THEN
    RAISE NOTICE 'H7   onceki segment DEVREDILDI, sure OLCULDU (2 sa)         PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H7   devir yanlis: % / % / % FAIL',
       h.close_reason, h.expired_at, h.duration_ms; END IF;

  -- Bir araçta AYNI ANDA tek açık segment olabilir.
  SELECT count(*) INTO v_n FROM public.vehicle_driver_presence_history
   WHERE vehicle_id=A_VEH AND expired_at IS NULL;
  IF v_n = 1 THEN
    RAISE NOTICE 'H8   ayni anda TEK acik segment (iki surucu birden YOK)     PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H8   % acik segment var FAIL', v_n; END IF;

  -- ═══ D. SÜRESİ DOLAN SEGMENT DÜZGÜN KAPANIR ════════════════════════
  -- d2'nin gözlemi T0+10sa'te dolar; sonraki gözlem T0+12sa'te gelir.
  INSERT INTO public.vehicle_driver_presence
    (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
  VALUES (A_CO, A_VEH, d1, 'BLUETOOTH', 'HIGH',
          T0 + interval '12 hours', T0 + interval '20 hours');

  SELECT * INTO h FROM public.vehicle_driver_presence_history
   WHERE vehicle_id=A_VEH AND driver_id=d2 ORDER BY detected_at DESC LIMIT 1;
  IF h.close_reason='TTL_EXPIRED' AND h.expired_at = T0 + interval '10 hours'
     AND h.duration_ms = 28800000 THEN
    RAISE NOTICE 'H9   SURESI DOLAN segment TTL ile kapandi (8 sa)            PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H9   TTL kapanisi yanlis: % / % FAIL',
       h.close_reason, h.duration_ms; END IF;

  -- Kapanış anı gözlemin TTL'idir, yeni gözlemin anı DEĞİL (uydurma yok).
  IF h.expired_at <> T0 + interval '12 hours' THEN
    RAISE NOTICE 'H10  kapanis ani UYDURULMADI (TTL kullanildi)               PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H10  kapanis ani uyduruldu FAIL'; END IF;

  -- ═══ E. YARIM KAPANIŞ YASAK ════════════════════════════════════════
  BEGIN
    INSERT INTO public.vehicle_driver_presence_history
      (company_id, vehicle_id, driver_id, source, confidence,
       detected_at, expires_at, expired_at)
    VALUES (A_CO, A_VEH, d1, 'NFC', 'HIGH',
            T0 - interval '5 hours', T0 - interval '4 hours', T0 - interval '4 hours');
    v_fail:=v_fail+1; RAISE WARNING 'H11  suresiz/gerekcesiz kapanis kabul edildi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'H11  YARIM kapanis REDDEDILDI (sure+gerekce zorunlu)        PASS';
  END;

  -- Kapanış başlangıçtan önce olamaz.
  BEGIN
    INSERT INTO public.vehicle_driver_presence_history
      (company_id, vehicle_id, driver_id, source, confidence,
       detected_at, expires_at, expired_at, duration_ms, close_reason)
    VALUES (A_CO, A_VEH, d1, 'PHONE', 'MEDIUM',
            T0 - interval '5 hours', T0 - interval '4 hours',
            T0 - interval '6 hours', 1000, 'CLEARED');
    v_fail:=v_fail+1; RAISE WARNING 'H12  ters kapanis kabul edildi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'H12  baslangictan ONCE kapanis REDDEDILDI                   PASS';
  END;

  -- ═══ F. GEÇ GELEN ESKİ GÖZLEM (cevrimdisi replay) ══════════════════
  -- T0+13sa'te açık bir segment varken T0+3sa'lik gözlem gelirse, YENİ
  -- segment bozulmamalı; eski dönem KAPALI kaydedilmeli.
  SELECT id INTO v_id FROM public.vehicle_driver_presence_history
   WHERE vehicle_id=A_VEH AND expired_at IS NULL;

  INSERT INTO public.vehicle_driver_presence
    (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
  VALUES (A_CO, A_VEH, d2, 'BLUETOOTH', 'HIGH',
          T0 + interval '3 hours', T0 + interval '11 hours');

  SELECT * INTO h FROM public.vehicle_driver_presence_history
   WHERE vehicle_id=A_VEH AND driver_id=d2 AND source='BLUETOOTH'
   ORDER BY detected_at DESC LIMIT 1;
  IF FOUND AND h.close_reason='SUPERSEDED' AND h.expired_at IS NOT NULL THEN
    RAISE NOTICE 'H13  GEC GELEN eski gozlem KAPALI kaydedildi (replay)       PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H13  gec gozlem yanlis islendi FAIL'; END IF;

  IF EXISTS (SELECT 1 FROM public.vehicle_driver_presence_history
              WHERE id = v_id AND expired_at IS NULL) THEN
    RAISE NOTICE 'H14  gec gozlem YENI segmenti BOZMADI                       PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H14  gec gozlem acik segmenti bozdu FAIL'; END IF;

  -- ═══ G. GÜVEN TAVANI GECMISTE DE UYGULANIR ═════════════════════════
  INSERT INTO public.vehicle_driver_presence
    (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
  VALUES (A_CO, A_VEH, d2, 'HEAD_UNIT', 'VERY_HIGH',
          T0 + interval '25 hours', T0 + interval '30 hours');

  SELECT * INTO h FROM public.vehicle_driver_presence_history
   WHERE vehicle_id=A_VEH AND source='HEAD_UNIT' ORDER BY detected_at DESC LIMIT 1;
  IF FOUND AND h.confidence = 'LOW' THEN
    RAISE NOTICE 'H15  HEAD_UNIT gecmiste de LOW (istemci yukseltemez)        PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H15  gecmiste guven tavani uygulanmadi: % FAIL',
       h.confidence; END IF;

  -- ═══ H. 049 RESOLVER + P0 ATTRIBUTION BOZULMADI ════════════════════
  -- Aynı veri üzerinde 049 resolver'ı hâlâ kendi kararını veriyor mu.
  SELECT * INTO res FROM public._resolve_driver_presence(
    A_VEH, A_CO, T0 + interval '13 hours', T0 + interval '14 hours', NULL);
  IF res.decision = 'PRESENCE_ONLY' AND res.driver_id = d1 THEN
    RAISE NOTICE 'H16  049 RESOLVER kararlari AYNEN calisiyor (PRESENCE_ONLY) PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H16  resolver davranisi degisti: % / % FAIL',
       res.decision, res.driver_id; END IF;

  -- Gözlem KAPSAMAYAN aralıkta hâlâ NO_PRESENCE (P0 modeline dönüş).
  SELECT * INTO res FROM public._resolve_driver_presence(
    A_VEH, A_CO, T0 - interval '20 hours', T0 - interval '19 hours', NULL);
  IF res.decision = 'NO_PRESENCE' THEN
    RAISE NOTICE 'H17  gozlemsiz aralikta NO_PRESENCE KORUNDU                 PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H17  fail-closed bozuldu: % FAIL', res.decision; END IF;

  -- P0 attribution: atamasız trip hâlâ UNKNOWN, sürücü UYDURULMUYOR.
  INSERT INTO public.vehicle_trips (vehicle_id, trip_key, revision, started_at, ended_at, distance_km)
  VALUES (A_VEH, 'p50-unknown', 1, T0 - interval '25 hours', T0 - interval '24 hours', 5);
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p50-unknown';
  IF t.driver_attribution_status='UNKNOWN' AND t.driver_id IS NULL
     AND t.driver_presence_decision='NO_PRESENCE' THEN
    RAISE NOTICE 'H18  P0 fail-closed KORUNDU (gecmis fallback URETMEDI)      PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H18  P0 bozuldu: % / % FAIL',
       t.driver_attribution_status, t.driver_presence_decision; END IF;

  -- Geçmişte kayıt VARKEN bile attribution yalnız resolver'a bakar.
  INSERT INTO public.vehicle_trips (vehicle_id, trip_key, revision, started_at, ended_at, distance_km)
  VALUES (A_VEH, 'p50-presence', 1, T0 + interval '13 hours', T0 + interval '14 hours', 30);
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p50-presence';
  IF t.driver_id = d1 AND t.driver_presence_decision='PRESENCE_ONLY'
     AND t.driver_attribution_confidence='HIGH' THEN
    RAISE NOTICE 'H19  attribution kararini HALA RESOLVER veriyor (defter degil) PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H19  attribution degisti: % / % FAIL',
       t.driver_presence_decision, t.driver_attribution_confidence; END IF;

  -- ═══ I. TEMBEL KAPANIŞ ═════════════════════════════════════════════
  -- Süresi geçmiş açık segment kalıcı olarak kapatılabilir.
  SELECT public.settle_expired_presence_history() INTO v_n;
  SELECT count(*) INTO v_n2 FROM public.vehicle_driver_presence_history
   WHERE vehicle_id=A_VEH AND expired_at IS NULL AND expires_at <= now();
  IF v_n2 = 0 THEN
    RAISE NOTICE 'H20  suresi gecmis ACIK segmentler KAPATILDI (% adet)       PASS', v_n;
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H20  % segment hala acik FAIL', v_n2; END IF;

  -- Kapanan segmentin süresi HESAPLANDI, uydurulmadı.
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_driver_presence_history
                  WHERE vehicle_id=A_VEH AND expired_at IS NOT NULL AND duration_ms IS NULL) THEN
    RAISE NOTICE 'H21  kapanan her segmentin SURESI var (yarim kapanis yok)   PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H21  suresiz kapali segment var FAIL'; END IF;

  IF v_fail = 0 THEN
    RAISE NOTICE '─────────────────────────────────────────────────────────';
    RAISE NOTICE '050 DOGRULAMA: TUM KONTROLLER GECTI';
  ELSE
    RAISE EXCEPTION '050 DOGRULAMA: % KONTROL DUSTU', v_fail;
  END IF;
END
$verify$;

-- ═══ J. OKUMA RPC'Sİ — DOĞRULANMAMIŞ KAYNAK KİMLİK SIZDIRMAZ ══════════
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','1178d9db-413d-4f60-97c5-97bfc8393618')::text, true);
SET LOCAL ROLE authenticated;

SELECT CASE WHEN bool_and(driver_id IS NULL AND driver_name IS NULL
                          AND identity_verifying = false)
            THEN 'H22  HEAD_UNIT kaydi gecmiste KIMLIK SIZDIRMADI            PASS'
            ELSE 'H22  dogrulanmamis kaynak kimlik sizdirdi     FAIL' END AS sonuc
FROM public.list_vehicle_presence_history(
  'bbbb2222-0000-0000-0000-000000000002'::uuid, 100)
WHERE source = 'HEAD_UNIT';

SELECT CASE WHEN bool_and(driver_id IS NOT NULL AND identity_verifying = true)
            THEN 'H23  NFC/BT kaydinda kimlik OKUNABILIYOR                   PASS'
            ELSE 'H23  dogrulanmis kaynak kimligi kayip        FAIL' END AS sonuc
FROM public.list_vehicle_presence_history(
  'bbbb2222-0000-0000-0000-000000000002'::uuid, 100)
WHERE source IN ('NFC','BLUETOOTH');

-- Açık olmayan hiçbir segment `OPEN` gösterilmez.
SELECT CASE WHEN NOT EXISTS (
         SELECT 1 FROM public.list_vehicle_presence_history(
           'bbbb2222-0000-0000-0000-000000000002'::uuid, 100)
          WHERE status = 'OPEN' AND expires_at <= now())
            THEN 'H24  suresi gecmis segment OPEN GOSTERILMEDI               PASS'
            ELSE 'H24  bayat segment acik gosterildi          FAIL' END AS sonuc;
ROLLBACK;

-- ═══ K. RLS / İZİN ════════════════════════════════════════════════════
SELECT CASE WHEN NOT has_table_privilege('anon','public.vehicle_driver_presence_history','SELECT')
             AND NOT has_table_privilege('authenticated','public.vehicle_driver_presence_history','INSERT')
             AND NOT has_table_privilege('authenticated','public.vehicle_driver_presence_history','UPDATE')
             AND NOT has_table_privilege('authenticated','public.vehicle_driver_presence_history','DELETE')
            THEN 'H25  ANON okuyamaz · authenticated defteri DEGISTIREMEZ    PASS'
            ELSE 'H25  gecmis izinleri ACIK                    FAIL' END AS sonuc;

-- Cross-tenant okuma engeli.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','b0e18b7e-2951-472d-acf1-46c674dcd8a2')::text, true);
SET LOCAL ROLE authenticated;
SELECT CASE WHEN count(*) = 0 THEN 'H26  B admini A gecmisini GOREMIYOR (RLS)                  PASS'
            ELSE 'H26  gecmis RLS SIZINTISI                    FAIL' END AS sonuc
FROM public.vehicle_driver_presence_history;
ROLLBACK;

-- Üretimde geçmişi yazan/silen bir RPC YOK (defter yalnız trigger ile dolar).
SELECT CASE WHEN NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public'
            AND (p.proname ILIKE '%record_presence_history%'
              OR p.proname ILIKE '%delete_presence_history%'))
            THEN 'H27  gecmisi ELLE yazan/silen RPC YOK                      PASS'
            ELSE 'H27  gecmis elle degistirilebilir            FAIL' END AS sonuc;

-- Temizlik.
DELETE FROM public.vehicle_trips WHERE trip_key LIKE 'p50-%';
DELETE FROM public.trip_driver_attribution_revisions WHERE trip_key LIKE 'p50-%';
DELETE FROM public.vehicle_driver_presence_history WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P50 %');
DELETE FROM public.vehicle_driver_presence WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P50 %');
DELETE FROM public.vehicle_driver_assignments WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P50 %');
DELETE FROM public.fleet_driver_audit WHERE entity_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P50 %');
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'P50 %';
