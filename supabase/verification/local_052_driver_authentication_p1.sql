-- ═══════════════════════════════════════════════════════════════════════════
-- 052 — DRIVER AUTHENTICATION P1 · GERÇEK PostgreSQL DOĞRULAMASI
--
-- MOCK DEĞİL: gerçek tablo, gerçek trigger, gerçek kısıt, gerçek `auth.uid()`.
--
-- EN KRİTİK KANITLAR:
--   · aynı oturum İKİ KEZ yazılamaz (duplicate)
--   · eski/tekrarlanmış doğrulama mesajı REDDEDİLİR (replay)
--   · doğrulama BAŞKA ŞİRKETİN aracına / sürücüsüne yazılamaz
--   · süresi geçen doğrulama KANIT DEĞİLDİR
--   · **presence TEK BAŞINA `VERY_HIGH` ÜRETEMEZ**
--   · **doğrulama + presence birlikte `VERY_HIGH` ÜRETİR**
--   · 049 presence resolver'ı ve P0 atama modeli DEĞİŞMEDİ
--
-- FIXTURE: Şirket A f1eef1ee… · admin 1178d9db… · Araç A bbbb2222…
--          Şirket B f2eef2ee… · admin b0e18b7e… · Araç B cccc3333…
--
-- Gerçek NFC/PIN/BT/telefon kaynağı YOK; kayıtlar testte ELLE yazılır.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

DELETE FROM public.vehicle_trips WHERE trip_key LIKE 'p52-%';
DELETE FROM public.vehicle_driver_authentication WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P52 %');
DELETE FROM public.vehicle_driver_presence_history WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P52 %');
DELETE FROM public.vehicle_driver_presence WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P52 %');
DELETE FROM public.vehicle_driver_assignments WHERE note LIKE 'P52%';
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'P52 %';

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
  IND_VEH uuid := 'aaaa1111-0000-0000-0000-000000000001';
  r    jsonb;
  d1   uuid; d2 uuid; dB uuid;
  t    public.vehicle_trips%ROWTYPE;
  res  record;
  a    public.vehicle_driver_authentication%ROWTYPE;
  v_n  int;
  /* Trip penceresi: doğrulama `verified_at <= started_at` istediği ve yazma
     kapısı 24 saatten eski mesajı reddettiği için PENCERE YAKIN GEÇMİŞTEDİR. */
  T0   timestamptz := now() - interval '3 hours';
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);
  r := public.create_fleet_driver('P52 Ahmet',  'P52-1'); d1 := (r->>'driverId')::uuid;
  r := public.create_fleet_driver('P52 Mehmet', 'P52-2'); d2 := (r->>'driverId')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', B_ADM)::text, true);
  r := public.create_fleet_driver('P52 Beta',   'P52-B'); dB := (r->>'driverId')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);

  -- ═══ A. YAZMA KAPILARI ═════════════════════════════════════════════
  BEGIN
    INSERT INTO public.vehicle_driver_authentication
      (company_id, vehicle_id, driver_id, source, level, verified_at, expires_at, session_id)
    VALUES (A_CO, B_VEH, d1, 'NFC', 'VERIFIED', T0, T0 + interval '4 hours', 'p52-s-wrongveh');
    v_fail := v_fail+1; RAISE WARNING 'A1   BASKA SIRKETIN aracina dogrulama yazildi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'A1   yanlis arac REDDEDILDI (binding mismatch)             PASS';
  END;

  BEGIN
    INSERT INTO public.vehicle_driver_authentication
      (company_id, vehicle_id, driver_id, source, level, verified_at, expires_at, session_id)
    VALUES (A_CO, A_VEH, dB, 'NFC', 'VERIFIED', T0, T0 + interval '4 hours', 'p52-s-xtenant');
    v_fail := v_fail+1; RAISE WARNING 'A2   cross-tenant surucu dogrulandi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'A2   cross-tenant SURUCU REDDEDILDI                        PASS';
  END;

  BEGIN
    INSERT INTO public.vehicle_driver_authentication
      (company_id, vehicle_id, driver_id, source, level, verified_at, expires_at, session_id)
    VALUES (B_CO, A_VEH, d1, 'NFC', 'VERIFIED', T0, T0 + interval '4 hours', 'p52-s-fakeco');
    v_fail := v_fail+1; RAISE WARNING 'A3   sahte company_id kabul edildi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'A3   SAHTE company_id iddiasi REDDEDILDI                   PASS';
  END;

  BEGIN
    INSERT INTO public.vehicle_driver_authentication
      (company_id, vehicle_id, driver_id, source, level, verified_at, expires_at, session_id)
    VALUES (A_CO, IND_VEH, d1, 'NFC', 'VERIFIED', T0, T0 + interval '4 hours', 'p52-s-ind');
    v_fail := v_fail+1; RAISE WARNING 'A4   sirketsiz araca dogrulama yazildi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'A4   bireysel (sirketsiz) arac REDDEDILDI                  PASS';
  END;

  BEGIN
    INSERT INTO public.vehicle_driver_authentication
      (company_id, vehicle_id, driver_id, source, level, verified_at, expires_at, session_id)
    VALUES (A_CO, A_VEH, d1, 'NFC', 'VERIFIED', T0, T0 + interval '20 hours', 'p52-s-ttl');
    v_fail := v_fail+1; RAISE WARNING 'A5   SINIRSIZ oturum kabul edildi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'A5   20 saatlik oturum REDDEDILDI (tavan 12 sa)            PASS';
  END;

  BEGIN
    INSERT INTO public.vehicle_driver_authentication
      (company_id, vehicle_id, driver_id, source, level, verified_at, expires_at, session_id)
    VALUES (A_CO, A_VEH, d1, 'NFC', 'VERIFIED', now() + interval '2 hours',
            now() + interval '5 hours', 'p52-s-future');
    v_fail := v_fail+1; RAISE WARNING 'A6   GELECEK tarihli dogrulama kabul edildi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'A6   gelecek tarihli dogrulama REDDEDILDI (saat oynatma)   PASS';
  END;

  BEGIN
    INSERT INTO public.vehicle_driver_authentication
      (company_id, vehicle_id, driver_id, source, level, verified_at, expires_at, session_id)
    VALUES (A_CO, A_VEH, d1, 'NFC', 'VERIFIED', '   ', now(), '');
    v_fail := v_fail+1; RAISE WARNING 'A7   OTURUMSUZ dogrulama kabul edildi FAIL';
  EXCEPTION WHEN check_violation OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE NOTICE 'A7   oturumsuz/bozuk dogrulama REDDEDILDI                  PASS';
  END;

  -- ═══ B. SEVİYE TAVANI (istemci yükseltemez) ════════════════════════
  INSERT INTO public.vehicle_driver_authentication
    (company_id, vehicle_id, driver_id, source, level, verified_at, expires_at, session_id)
  VALUES (A_CO, A_VEH, d2, 'BLUETOOTH', 'VERIFIED', T0, T0 + interval '4 hours', 'p52-s-bt');

  SELECT * INTO a FROM public.vehicle_driver_authentication WHERE session_id='p52-s-bt';
  IF a.level = 'PARTIAL' THEN
    RAISE NOTICE 'B1   BLUETOOTH VERIFIED iddiasi PARTIAL a DUSURULDU        PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'B1   istemci seviyesini yukseltti: % FAIL', a.level; END IF;

  SELECT * INTO res FROM public._resolve_driver_authentication(
    A_VEH, A_CO, T0 + interval '1 hour', T0 + interval '2 hours');
  IF res.decision = 'PARTIALLY_AUTHENTICATED' AND res.driver_id IS NULL THEN
    RAISE NOTICE 'B2   PARTIAL kimlik KANITI SAYILMADI (yakinlik != kisi)    PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'B2   partial kanit sayildi: % FAIL', res.decision; END IF;

  DELETE FROM public.vehicle_driver_authentication WHERE session_id='p52-s-bt';

  -- ═══ C. DUPLICATE + REPLAY ═════════════════════════════════════════
  INSERT INTO public.vehicle_driver_authentication
    (company_id, vehicle_id, driver_id, source, level, verified_at, expires_at, session_id)
  VALUES (A_CO, A_VEH, d1, 'NFC', 'VERIFIED', T0, T0 + interval '4 hours', 'p52-s-1');

  BEGIN
    INSERT INTO public.vehicle_driver_authentication
      (company_id, vehicle_id, driver_id, source, level, verified_at, expires_at, session_id)
    VALUES (A_CO, A_VEH, d1, 'NFC', 'VERIFIED', T0, T0 + interval '4 hours', 'p52-s-1');
    v_fail := v_fail+1; RAISE WARNING 'C1   AYNI oturum iki kez yazildi FAIL';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'C1   DUPLICATE oturum REDDEDILDI                           PASS';
  END;

  /* REPLAY: aynı oturum kimliği FARKLI zamanla yeniden oynatılıyor. */
  BEGIN
    INSERT INTO public.vehicle_driver_authentication
      (company_id, vehicle_id, driver_id, source, level, verified_at, expires_at, session_id)
    VALUES (A_CO, A_VEH, d1, 'NFC', 'VERIFIED', now() - interval '1 minute',
            now() + interval '3 hours', 'p52-s-1');
    v_fail := v_fail+1; RAISE WARNING 'C2   REPLAY (ayni oturum, yeni zaman) kabul edildi FAIL';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'C2   REPLAY REDDEDILDI (oturum tekrar kullanilamaz)        PASS';
  END;

  /* REPLAY: çok eski bir mesajın bugün oynatılması. */
  BEGIN
    INSERT INTO public.vehicle_driver_authentication
      (company_id, vehicle_id, driver_id, source, level, verified_at, expires_at, session_id)
    VALUES (A_CO, A_VEH, d1, 'NFC', 'VERIFIED', now() - interval '30 hours',
            now() - interval '27 hours', 'p52-s-old');
    v_fail := v_fail+1; RAISE WARNING 'C3   COK ESKI mesaj kabul edildi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'C3   COK ESKI dogrulama mesaji REDDEDILDI                  PASS';
  END;

  SELECT count(*) INTO v_n FROM public.vehicle_driver_authentication
   WHERE driver_id = d1 AND session_id = 'p52-s-1';
  IF v_n = 1 THEN
    RAISE NOTICE 'C4   tekrarlara ragmen TEK kayit kaldi                     PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'C4   % kayit olustu FAIL', v_n; END IF;

  -- ═══ D. OTORİTE KARARLARI ══════════════════════════════════════════
  SELECT * INTO res FROM public._resolve_driver_authentication(
    A_VEH, A_CO, T0 + interval '1 hour', T0 + interval '2 hours');
  IF res.decision = 'AUTHENTICATED' AND res.driver_id = d1 AND res.level = 'VERIFIED' THEN
    RAISE NOTICE 'D1   gecerli NFC dogrulamasi -> AUTHENTICATED              PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'D1   otorite karari yanlis: % FAIL', res.decision; END IF;

  /* SÜRE: trip doğrulamanın penceresi DIŞINDAysa kanıt değildir. */
  SELECT * INTO res FROM public._resolve_driver_authentication(
    A_VEH, A_CO, T0 + interval '10 hours', T0 + interval '11 hours');
  IF res.decision = 'NO_AUTHENTICATION' AND res.driver_id IS NULL THEN
    RAISE NOTICE 'D2   SURESI GECMIS dogrulama kanit SAYILMADI               PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'D2   suresi gecmis dogrulama kullanildi FAIL'; END IF;

  /* PASİF sürücünün doğrulaması kanıt olamaz. */
  UPDATE public.fleet_drivers SET status='INACTIVE' WHERE id=d1;
  SELECT * INTO res FROM public._resolve_driver_authentication(
    A_VEH, A_CO, T0 + interval '1 hour', T0 + interval '2 hours');
  IF res.decision = 'NO_AUTHENTICATION' THEN
    RAISE NOTICE 'D3   PASIF surucunun dogrulamasi kanit sayilmadi           PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'D3   pasif surucu kanit uretti FAIL'; END IF;
  UPDATE public.fleet_drivers SET status='ACTIVE' WHERE id=d1;

  /* ÇELİŞKİ: iki farklı kişi aynı aralıkta doğrulanmışsa BİLİNEMEZ. */
  INSERT INTO public.vehicle_driver_authentication
    (company_id, vehicle_id, driver_id, source, level, verified_at, expires_at, session_id)
  VALUES (A_CO, A_VEH, d2, 'PIN', 'VERIFIED', T0, T0 + interval '4 hours', 'p52-s-2');
  SELECT * INTO res FROM public._resolve_driver_authentication(
    A_VEH, A_CO, T0 + interval '1 hour', T0 + interval '2 hours');
  IF res.decision = 'AUTHENTICATION_CONFLICT' AND res.driver_id IS NULL THEN
    RAISE NOTICE 'D4   IKI FARKLI kimlik -> CONFLICT (fail-closed)           PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'D4   coklu kimlikte secim yapildi: % FAIL', res.decision; END IF;
  DELETE FROM public.vehicle_driver_authentication WHERE session_id='p52-s-2';

  -- ═══ T. PRESENCE × AUTHENTICATION (asıl politika) ══════════════════
  --
  -- Atama: d1 aracı sürecek şekilde planlanmış.
  INSERT INTO public.vehicle_driver_assignments
    (company_id, vehicle_id, driver_id, starts_at, status, note)
  VALUES (A_CO, A_VEH, d1, T0 - interval '1 hour', 'ACTIVE', 'P52 atama');

  -- (T1) Yalnız PRESENCE — kimlik doğrulaması KAPSAMAYAN pencere.
  DELETE FROM public.vehicle_driver_authentication WHERE session_id='p52-s-1';
  INSERT INTO public.vehicle_driver_presence
    (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
  VALUES (A_CO, A_VEH, d1, 'NFC', 'VERY_HIGH', T0, T0 + interval '8 hours');

  INSERT INTO public.vehicle_trips (vehicle_id, trip_key, revision, started_at, ended_at, distance_km)
  VALUES (A_VEH, 'p52-presenceOnly', 1, T0 + interval '1 hour', T0 + interval '2 hours', 10);
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p52-presenceOnly';

  IF t.driver_id = d1 AND t.driver_attribution_status = 'ATTRIBUTED'
     AND t.driver_presence_decision = 'PRESENCE_CONFIRMED' THEN
    RAISE NOTICE 'T1   presence + atama -> surucu ATANDI (P1 davranisi surdu) PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'T1   presence yolu bozuldu: % / % FAIL',
       t.driver_attribution_status, t.driver_presence_decision; END IF;

  IF t.driver_attribution_confidence = 'HIGH' THEN
    RAISE NOTICE 'T2   PRESENCE TEK BASINA VERY_HIGH URETMEDI (tavan HIGH)   PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'T2   kimliksiz guven: % FAIL', t.driver_attribution_confidence; END IF;

  IF t.driver_auth_decision = 'NO_AUTHENTICATION' AND t.driver_auth_id IS NULL THEN
    RAISE NOTICE 'T3   dogrulama izi DURUSTCE NO_AUTHENTICATION yazildi      PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'T3   dogrulama izi yanlis: % FAIL', t.driver_auth_decision; END IF;

  -- (T4/T5) PRESENCE + AUTHENTICATION → VERY_HIGH mümkün.
  INSERT INTO public.vehicle_driver_authentication
    (company_id, vehicle_id, driver_id, source, level, verified_at, expires_at, session_id)
  VALUES (A_CO, A_VEH, d1, 'NFC', 'VERIFIED', T0, T0 + interval '4 hours', 'p52-s-3');

  UPDATE public.vehicle_trips SET started_at = started_at WHERE trip_key='p52-presenceOnly';
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p52-presenceOnly';

  IF t.driver_auth_decision = 'AUTHENTICATED' AND t.driver_auth_level = 'VERIFIED'
     AND t.driver_auth_id IS NOT NULL THEN
    RAISE NOTICE 'T4   dogrulama trip e ISLENDI (kanit izi var)              PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'T4   dogrulama izi yazilmadi: % FAIL', t.driver_auth_decision; END IF;

  IF t.driver_id = d1 AND t.driver_attribution_confidence = 'VERY_HIGH' THEN
    RAISE NOTICE 'T5   KIMLIK + VARLIK -> VERY_HIGH (yalnizca birlikte)      PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'T5   birlikte VERY_HIGH uretilmedi: % FAIL',
       t.driver_attribution_confidence; END IF;

  -- (T6) ÇELİŞKİ: kartı d1 okutmuş, PIN'i d2 girmiş → sürücü YAZILMAZ.
  INSERT INTO public.vehicle_driver_authentication
    (company_id, vehicle_id, driver_id, source, level, verified_at, expires_at, session_id)
  VALUES (A_CO, A_VEH, d2, 'PIN', 'VERIFIED', T0, T0 + interval '4 hours', 'p52-s-4');

  UPDATE public.vehicle_trips SET started_at = started_at WHERE trip_key='p52-presenceOnly';
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p52-presenceOnly';
  IF t.driver_attribution_status = 'CONFLICTED' AND t.driver_id IS NULL THEN
    RAISE NOTICE 'T6   kimlik-varlik CELISKISI -> CONFLICTED, surucu YOK     PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'T6   celiskide surucu secildi: % FAIL', t.driver_attribution_status; END IF;
  DELETE FROM public.vehicle_driver_authentication WHERE session_id='p52-s-4';

  -- (T7) YALNIZ AUTHENTICATION (presence yok) → tavan HIGH.
  DELETE FROM public.vehicle_driver_presence WHERE driver_id = d1;
  DELETE FROM public.vehicle_driver_presence_history WHERE driver_id = d1;
  INSERT INTO public.vehicle_trips (vehicle_id, trip_key, revision, started_at, ended_at, distance_km)
  VALUES (A_VEH, 'p52-authOnly', 1, T0 + interval '1 hour', T0 + interval '2 hours', 8);
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p52-authOnly';

  IF t.driver_id = d1 AND t.driver_attribution_status = 'ATTRIBUTED'
     AND t.driver_attribution_confidence = 'HIGH'
     AND t.driver_presence_decision = 'NO_PRESENCE' THEN
    RAISE NOTICE 'T7   YALNIZ kimlik -> ATANDI ama tavan HIGH                PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'T7   auth-only yanlis: % / % FAIL',
       t.driver_attribution_status, t.driver_attribution_confidence; END IF;

  -- ═══ R. REGRESYON ══════════════════════════════════════════════════
  -- (R1) Kanıt YOKKEN P0 atama modeli AYNEN çalışır.
  DELETE FROM public.vehicle_driver_authentication WHERE driver_id IN (d1, d2);
  INSERT INTO public.vehicle_trips (vehicle_id, trip_key, revision, started_at, ended_at, distance_km)
  VALUES (A_VEH, 'p52-p0', 1, T0 + interval '1 hour', T0 + interval '2 hours', 5);
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p52-p0';
  IF t.driver_id = d1 AND t.driver_attribution_source = 'ACTIVE_ASSIGNMENT'
     AND t.driver_auth_decision = 'NO_AUTHENTICATION' THEN
    RAISE NOTICE 'R1   kanit yokken P0 atama modeli AYNEN calisti            PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'R1   P0 modeli bozuldu: % / % FAIL',
       t.driver_id, t.driver_attribution_source; END IF;

  -- (R2) Presence resolver'ı DEĞİŞMEDİ.
  SELECT * INTO res FROM public._resolve_driver_presence(
    gen_random_uuid(), gen_random_uuid(), now() - interval '1 hour', now(), NULL);
  IF res.decision = 'NO_PRESENCE' AND res.driver_id IS NULL THEN
    RAISE NOTICE 'R2   presence resolver DEGISMEDI (NO_PRESENCE korundu)     PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'R2   presence resolver degisti FAIL'; END IF;

  -- (R3) MANUEL sonuç doğrulama tarafından da EZİLMEZ.
  PERFORM public.manually_assign_trip_driver(A_VEH, 'p52-p0', d2, 'P52 elle');
  INSERT INTO public.vehicle_driver_authentication
    (company_id, vehicle_id, driver_id, source, level, verified_at, expires_at, session_id)
  VALUES (A_CO, A_VEH, d1, 'NFC', 'VERIFIED', T0, T0 + interval '4 hours', 'p52-s-5');
  UPDATE public.vehicle_trips SET started_at = started_at WHERE trip_key='p52-p0';
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p52-p0';
  IF t.driver_id = d2 AND t.driver_attribution_source = 'MANUAL_TRIP_ASSIGNMENT' THEN
    RAISE NOTICE 'R3   MANUEL sonuc dogrulama tarafindan EZILMEDI            PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'R3   manuel sonuc ezildi: % FAIL', t.driver_attribution_source; END IF;

  -- (R4) 10x replay attribution revizyonunu ŞİŞİRMEZ.
  INSERT INTO public.vehicle_trips (vehicle_id, trip_key, revision, started_at, ended_at, distance_km)
  VALUES (A_VEH, 'p52-replay', 1, T0 + interval '1 hour', T0 + interval '2 hours', 5);
  SELECT driver_attribution_revision INTO v_n FROM public.vehicle_trips WHERE trip_key='p52-replay';
  FOR i IN 1..10 LOOP
    UPDATE public.vehicle_trips SET started_at = started_at WHERE trip_key='p52-replay';
  END LOOP;
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='p52-replay';
  IF t.driver_attribution_revision = v_n THEN
    RAISE NOTICE 'R4   10x REPLAY revizyonu SISIRMEDI (idempotent)           PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'R4   revizyon sisti: % -> % FAIL', v_n, t.driver_attribution_revision; END IF;

  IF v_fail = 0 THEN
    RAISE NOTICE '─────────────────────────────────────────────────────────';
    RAISE NOTICE '052 DOGRULAMA: TUM KONTROLLER GECTI';
  ELSE
    RAISE EXCEPTION '052 DOGRULAMA: % KONTROL DUSTU', v_fail;
  END IF;
END
$verify$;

-- ── Cross-tenant OKUMA engeli + doğrudan yazma kapalı ───────────────────
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','b0e18b7e-2951-472d-acf1-46c674dcd8a2')::text, true);
SET LOCAL ROLE authenticated;
SELECT CASE WHEN count(*) = 0
            THEN 'S1   B admini A dogrulamalarini GOREMIYOR (RLS)          PASS'
            ELSE 'S1   RLS SIZINTISI FAIL' END AS sonuc
  FROM public.vehicle_driver_authentication;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT CASE WHEN has_table_privilege(
              'authenticated','public.vehicle_driver_authentication','INSERT')
            THEN 'S2   authenticated DOGRUDAN dogrulama yazabiliyor FAIL'
            ELSE 'S2   ANON/authenticated DOGRUDAN yazamaz               PASS'
       END AS sonuc;
ROLLBACK;

-- Temizlik.
DELETE FROM public.vehicle_trips WHERE trip_key LIKE 'p52-%';
DELETE FROM public.vehicle_driver_authentication WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P52 %');
DELETE FROM public.vehicle_driver_presence_history WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P52 %');
DELETE FROM public.vehicle_driver_presence WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P52 %');
DELETE FROM public.vehicle_driver_assignments WHERE note LIKE 'P52%';
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'P52 %';
