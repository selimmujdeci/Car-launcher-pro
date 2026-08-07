-- ═══════════════════════════════════════════════════════════════════════════
-- 049 — DRIVER PRESENCE P1 · GERÇEK PostgreSQL DOĞRULAMASI
--
-- EN KRİTİK KANIT: presence YOKKEN P0 attribution davranışı **DEĞİŞMEZ**.
-- Gerçek NFC/BT kaynağı bu pakette uygulanmadı; gözlemler testte ELLE
-- yazılır (üretimde bunu yazan bir yol YOKTUR).
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

DELETE FROM public.vehicle_trips WHERE trip_key LIKE 'p49-%';
DELETE FROM public.vehicle_driver_presence WHERE vehicle_id IN
  (SELECT id FROM public.vehicles WHERE id='bbbb2222-0000-0000-0000-000000000002');
DELETE FROM public.vehicle_driver_assignments WHERE note LIKE 'P49%';
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'P49 %';

DO $verify$
DECLARE
  v_fail int := 0;
  A_CO  uuid := 'f1eef1ee-0000-0000-0000-000000000001';
  A_ADM uuid := '1178d9db-413d-4f60-97c5-97bfc8393618';
  A_VEH uuid := 'bbbb2222-0000-0000-0000-000000000002';
  r   jsonb;
  d1  uuid; d2 uuid;
  t   public.vehicle_trips%ROWTYPE;
  res record;
  T0  timestamptz := date_trunc('hour', now()) - interval '20 hours';
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);

  r := public.create_fleet_driver('P49 Ahmet', 'P49-1');  d1 := (r->>'driverId')::uuid;
  r := public.create_fleet_driver('P49 Mehmet', 'P49-2'); d2 := (r->>'driverId')::uuid;

  -- ═══ A. PRESENCE YOKKEN P0 AYNEN ÇALIŞIR (en kritik kanıt) ══════════
  r := public.create_vehicle_driver_assignment(A_VEH, d1, T0, T0 + interval '4 hours',
        'PRIMARY', 'P49 atama');
  IF r->>'state' <> 'CREATED' THEN
    v_fail := v_fail+1; RAISE WARNING 'P0   atama olusturulamadi: % FAIL', r;
  END IF;

  INSERT INTO public.vehicle_trips (vehicle_id, trip_key, revision, started_at, ended_at, distance_km)
  VALUES (A_VEH, 'p49-noPresence', 1, T0 + interval '1 hour', T0 + interval '2 hours', 20);
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p49-noPresence';

  IF t.driver_id = d1 AND t.driver_attribution_status = 'ATTRIBUTED'
     AND t.driver_attribution_source = 'ACTIVE_ASSIGNMENT'
     AND t.driver_attribution_confidence = 'HIGH' THEN
    RAISE NOTICE 'P1   PRESENCE YOKKEN P0 attribution AYNEN calisti          PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'P1   P0 davranisi DEGISTI: % / % / % FAIL',
       t.driver_id, t.driver_attribution_status, t.driver_attribution_confidence; END IF;

  IF t.driver_presence_decision = 'NO_PRESENCE' AND t.driver_presence_id IS NULL THEN
    RAISE NOTICE 'P2   presence karari NO_PRESENCE olarak kaydedildi          PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'P2   presence karari yanlis: % FAIL', t.driver_presence_decision; END IF;

  -- Atamasız trip hâlâ UNKNOWN (fail-closed korundu).
  INSERT INTO public.vehicle_trips (vehicle_id, trip_key, revision, started_at, ended_at, distance_km)
  VALUES (A_VEH, 'p49-unknown', 1, T0 - interval '10 hours', T0 - interval '9 hours', 5);
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p49-unknown';
  IF t.driver_attribution_status = 'UNKNOWN' AND t.driver_id IS NULL THEN
    RAISE NOTICE 'P3   UNKNOWN fail-closed KORUNDU (fallback yok)             PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'P3   fail-closed bozuldu: % FAIL', t.driver_attribution_status; END IF;

  -- ═══ B. KAYNAK GÜVENİLİRLİĞİ ═══════════════════════════════════════
  -- HEAD_UNIT gözlemi kanıt SAYILMAZ (P0 kararı arkadan dolanılamaz).
  INSERT INTO public.vehicle_driver_presence
    (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
  VALUES (A_CO, A_VEH, d2, 'HEAD_UNIT', 'VERY_HIGH',
          T0 + interval '30 minutes', T0 + interval '8 hours');

  UPDATE public.vehicle_trips SET started_at = started_at WHERE trip_key='p49-noPresence';
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p49-noPresence';
  IF t.driver_id = d1 AND t.driver_presence_decision = 'NO_PRESENCE' THEN
    RAISE NOTICE 'P4   HEAD_UNIT gozlemi KANIT SAYILMADI (surucu degismedi)   PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'P4   head unit beyani surucuyu degistirdi: % FAIL', t.driver_id; END IF;

  -- İstemcinin iddia ettiği VERY_HIGH kabul EDİLMEZ (kaynak tavanı LOW).
  IF public._presence_source_ceiling('HEAD_UNIT') = 'LOW' THEN
    RAISE NOTICE 'P5   HEAD_UNIT guven tavani LOW (istemci yukseltemez)       PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'P5   head unit guven tavani yanlis FAIL'; END IF;

  DELETE FROM public.vehicle_driver_presence WHERE source='HEAD_UNIT';

  -- ═══ C. NFC — GEÇERLİ KANIT ════════════════════════════════════════
  INSERT INTO public.vehicle_driver_presence
    (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
  VALUES (A_CO, A_VEH, d1, 'NFC', 'VERY_HIGH',
          T0, T0 + interval '8 hours');

  UPDATE public.vehicle_trips SET started_at = started_at WHERE trip_key='p49-noPresence';
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p49-noPresence';
  /* ⚠️ POLITIKA DEGISTI (052 — DRIVER AUTHENTICATION P1):
     Bu kilit eskiden "NFC + atama -> VERY_HIGH" diyordu. Ama bir kartin
     okunmasi KARTI kanitlar, KISIYI degil (kart odunc verilebilir/kopyalanabilir).
     Artik `VERY_HIGH` yalniz KIMLIK DOGRULAMASI + fiziksel varlik birlikteyken
     mumkundur. Kilit KALDIRILMADI, yeni dogru davranisa TASINDI; pozitif
     VERY_HIGH senaryosu `local_052_driver_authentication_p1.sql` T5'te kilitli.
     Presence resolver'i DEGISMEDI: karari hala `PRESENCE_CONFIRMED`. */
  IF t.driver_id = d1 AND t.driver_presence_decision = 'PRESENCE_CONFIRMED'
     AND t.driver_attribution_confidence = 'HIGH'
     AND t.driver_attribution_source = 'NFC' THEN
    RAISE NOTICE 'P6   NFC + atama -> ATTRIBUTED · kimliksiz tavan HIGH        PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'P6   NFC yolu bozuldu: % / % FAIL',
       t.driver_presence_decision, t.driver_attribution_confidence; END IF;

  /* Kimlik dogrulanmadan VERY_HIGH VERILMEZ — yeni politikanin cekirdegi. */
  IF t.driver_attribution_confidence <> 'VERY_HIGH' THEN
    RAISE NOTICE 'P6b  KIMLIK DOGRULANMADAN VERY_HIGH VERILMEDI               PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'P6b  kimliksiz VERY_HIGH verildi FAIL'; END IF;

  -- ═══ D. ÇELİŞKİ — FAIL-CLOSED ══════════════════════════════════════
  UPDATE public.vehicle_driver_presence SET driver_id = d2 WHERE source='NFC';
  UPDATE public.vehicle_trips SET started_at = started_at WHERE trip_key='p49-noPresence';
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p49-noPresence';
  IF t.driver_attribution_status = 'CONFLICTED' AND t.driver_id IS NULL THEN
    RAISE NOTICE 'P7   presence != atama -> CONFLICTED, surucu YAZILMADI      PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'P7   celiskide surucu secildi: % / % FAIL',
       t.driver_attribution_status, t.driver_id; END IF;

  UPDATE public.vehicle_driver_presence SET driver_id = d1 WHERE source='NFC';

  -- ═══ E. SÜRE ═══════════════════════════════════════════════════════
  -- Trip'i kapsamayan (süresi trip'ten önce dolan) gözlem KANIT DEĞİL.
  UPDATE public.vehicle_driver_presence
     SET expires_at = T0 + interval '30 minutes' WHERE source='NFC';
  UPDATE public.vehicle_trips SET started_at = started_at WHERE trip_key='p49-noPresence';
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p49-noPresence';
  IF t.driver_presence_decision = 'NO_PRESENCE' AND t.driver_id = d1
     AND t.driver_attribution_source = 'ACTIVE_ASSIGNMENT' THEN
    RAISE NOTICE 'P8   SURESI GECMIS gozlem kanit degil -> P0 modeline dondu  PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'P8   bayat gozlem kullanildi: % FAIL', t.driver_presence_decision; END IF;

  -- Sınırsız TTL yasak.
  BEGIN
    INSERT INTO public.vehicle_driver_presence
      (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
    VALUES (A_CO, A_VEH, d1, 'NFC', 'HIGH', T0, T0 + interval '48 hours');
    v_fail := v_fail+1; RAISE WARNING 'P9   48 saatlik gozlem kabul edildi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'P9   SINIRSIZ TTL reddedildi (en fazla 24 sa)              PASS';
  END;

  -- Ters aralık yasak.
  BEGIN
    INSERT INTO public.vehicle_driver_presence
      (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
    VALUES (A_CO, A_VEH, d1, 'NFC', 'HIGH', T0, T0 - interval '1 hour');
    v_fail := v_fail+1; RAISE WARNING 'P10  ters aralik kabul edildi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'P10  ters aralik (expires < detected) REDDEDILDI            PASS';
  END;

  UPDATE public.vehicle_driver_presence
     SET expires_at = T0 + interval '8 hours' WHERE source='NFC';

  -- ═══ F. SÜRÜCÜ UYGUNLUĞU ═══════════════════════════════════════════
  -- Pasif sürücünün kartı kanıt olamaz.
  PERFORM public.update_fleet_driver(d1, p_status => 'INACTIVE');
  UPDATE public.vehicle_trips SET started_at = started_at WHERE trip_key='p49-noPresence';
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p49-noPresence';
  IF t.driver_presence_decision = 'NO_PRESENCE' THEN
    RAISE NOTICE 'P11  PASIF surucunun karti kanit sayilmadi                  PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'P11  pasif surucu kanit oldu: % FAIL', t.driver_presence_decision; END IF;
  PERFORM public.update_fleet_driver(d1, p_status => 'ACTIVE');

  -- ═══ G. ÇOKLU GÖZLEM ═══════════════════════════════════════════════
  INSERT INTO public.vehicle_driver_presence
    (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
  VALUES (A_CO, A_VEH, d2, 'NFC', 'VERY_HIGH', T0, T0 + interval '8 hours');
  UPDATE public.vehicle_trips SET started_at = started_at WHERE trip_key='p49-noPresence';
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p49-noPresence';
  IF t.driver_attribution_status = 'CONFLICTED' AND t.driver_id IS NULL THEN
    RAISE NOTICE 'P12  IKI FARKLI surucu gozlemi -> CONFLICTED                PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'P12  coklu gozlemde surucu secildi FAIL'; END IF;
  DELETE FROM public.vehicle_driver_presence WHERE driver_id = d2;

  -- ═══ H. PRESENCE_ONLY (atama yok) ══════════════════════════════════
  INSERT INTO public.vehicle_trips (vehicle_id, trip_key, revision, started_at, ended_at, distance_km)
  VALUES (A_VEH, 'p49-presenceOnly', 1, T0 + interval '5 hours', T0 + interval '6 hours', 12);
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p49-presenceOnly';
  IF t.driver_presence_decision = 'PRESENCE_ONLY' AND t.driver_id = d1
     AND t.driver_attribution_confidence = 'HIGH' THEN
    RAISE NOTICE 'P13  ATAMASIZ fiziksel kanit -> PRESENCE_ONLY, guven HIGH   PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'P13  presence-only yanlis: % / % FAIL',
       t.driver_presence_decision, t.driver_attribution_confidence; END IF;

  -- Plan desteği olmadan VERY_HIGH VERİLMEZ.
  IF t.driver_attribution_confidence <> 'VERY_HIGH' THEN
    RAISE NOTICE 'P14  plan destegi yokken VERY_HIGH VERILMEDI                PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'P14  atamasiz VERY_HIGH verildi FAIL'; END IF;

  -- ═══ I. MANUEL SONUÇ KORUNUR ═══════════════════════════════════════
  PERFORM public.manually_assign_trip_driver(A_VEH, 'p49-presenceOnly', d2, 'P49 elle');
  UPDATE public.vehicle_trips SET started_at = started_at WHERE trip_key='p49-presenceOnly';
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p49-presenceOnly';
  IF t.driver_id = d2 AND t.driver_attribution_source = 'MANUAL_TRIP_ASSIGNMENT' THEN
    RAISE NOTICE 'P15  MANUEL sonuc presence tarafindan EZILMEDI              PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'P15  manuel sonuc ezildi: % FAIL', t.driver_attribution_source; END IF;

  -- ═══ J. REPLAY ═════════════════════════════════════════════════════
  --
  -- ÖNCE durumu sabitle: yukarıdaki senaryolar (çelişki → düzelme) trip'i
  -- meşru biçimde değiştirdi. Replay ölçümü, sonuç ARTIK SABİTKEN
  -- yapılmalıdır — aksi halde ilk döngüdeki gerçek geçiş "şişme" sanılır.
  DECLARE v_rev int; v_rev2 int;
  BEGIN
    UPDATE public.vehicle_trips SET started_at = started_at WHERE trip_key='p49-noPresence';
    SELECT driver_attribution_revision INTO v_rev FROM public.vehicle_trips
     WHERE trip_key='p49-noPresence';

    FOR i IN 1..10 LOOP
      UPDATE public.vehicle_trips SET started_at = started_at WHERE trip_key='p49-noPresence';
    END LOOP;

    SELECT driver_attribution_revision INTO v_rev2 FROM public.vehicle_trips
     WHERE trip_key='p49-noPresence';
    IF v_rev2 = v_rev THEN
      RAISE NOTICE 'P16  10x REPLAY presence revizyonunu SISIRMEDI              PASS';
    ELSE v_fail := v_fail+1;
      RAISE WARNING 'P16  replay revizyonu sisirdi: % -> % FAIL', v_rev, v_rev2; END IF;
  END;

  IF v_fail = 0 THEN
    RAISE NOTICE '─────────────────────────────────────────────────────────';
    RAISE NOTICE '049 DOGRULAMA: TUM KONTROLLER GECTI';
  ELSE
    RAISE EXCEPTION '049 DOGRULAMA: % KONTROL DUSTU', v_fail;
  END IF;
END
$verify$;

-- ═══ K. RLS / İZİN ════════════════════════════════════════════════════
SELECT CASE WHEN NOT has_table_privilege('anon','public.vehicle_driver_presence','SELECT')
             AND NOT has_table_privilege('authenticated','public.vehicle_driver_presence','INSERT')
            THEN 'P17  ANON okuyamaz · authenticated DOGRUDAN yazamaz         PASS'
            ELSE 'P17  presence izinleri ACIK                    FAIL' END AS sonuc;

-- Cross-tenant okuma engeli.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','b0e18b7e-2951-472d-acf1-46c674dcd8a2')::text, true);
SET LOCAL ROLE authenticated;
SELECT CASE WHEN count(*) = 0 THEN 'P18  B admini A presence kayitlarini GOREMIYOR (RLS)       PASS'
            ELSE 'P18  presence RLS SIZINTISI                   FAIL' END AS sonuc
FROM public.vehicle_driver_presence;
ROLLBACK;

-- ÜRETİMDE presence YAZAN bir yol YOK (RPC yok — gerçek kaynak gelince eklenecek).
SELECT CASE WHEN NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname ILIKE '%record_driver_presence%')
            THEN 'P19  presence YAZAN RPC YOK (gercek kaynak gelmeden uretilmez) PASS'
            ELSE 'P19  presence yazma yolu acilmis              FAIL' END AS sonuc;

-- Temizlik.
DELETE FROM public.vehicle_trips WHERE trip_key LIKE 'p49-%';
DELETE FROM public.vehicle_driver_presence WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P49 %');
DELETE FROM public.vehicle_driver_assignments WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P49 %');
DELETE FROM public.fleet_driver_audit WHERE entity_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P49 %');
DELETE FROM public.trip_driver_attribution_revisions WHERE trip_key LIKE 'p49-%';
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'P49 %';
