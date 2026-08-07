-- ═══════════════════════════════════════════════════════════════════════════
-- 051 — DRIVER PRESENCE DURABILITY P2 · GERÇEK PostgreSQL DOĞRULAMASI
--
-- MOCK DEĞİL: gerçek tablo, gerçek trigger, gerçek kısıt, gerçek `auth.uid()`.
--
-- EN KRİTİK KANITLAR:
--   · aynı segment İKİ KEZ KAPANMAZ (kapanış değişmezdir)
--   · TTL kapanışı İDEMPOTENT (ikinci çağrı hiçbir satırı etkilemez)
--   · gözlem BAŞKA ŞİRKETİN aracına / sürücüsüne yazılamaz (istemci iddiası)
--   · birebir aynı gözlem tekrar oynatılınca DUPLICATE geçmiş oluşmaz
--   · 049 RESOLVER'ı ve P0 attribution DEĞİŞMEDİ
--
-- FIXTURE (mevcut):
--   Şirket A f1eef1ee… · admin 1178d9db… · Araç A bbbb2222…
--   Şirket B f2eef2ee… · admin b0e18b7e… · Araç B cccc3333… (burada kurulur)
--
-- Gerçek NFC/BT kaynağı YOK; gözlemler testte ELLE yazılır (049 P19).
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

-- Test artefaktlarını temizle (tekrar çalıştırılabilirlik).
DELETE FROM public.vehicle_driver_presence_history WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P51 %');
DELETE FROM public.vehicle_driver_presence WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P51 %');
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'P51 %';

-- Şirket B'ye ait araç (cross-tenant kapıları için).
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
  IND_VEH uuid := 'aaaa1111-0000-0000-0000-000000000001';   -- bireysel (şirketsiz)
  r     jsonb;
  d1    uuid; d2 uuid; dB uuid;
  h     public.vehicle_driver_presence_history%ROWTYPE;
  h2    public.vehicle_driver_presence_history%ROWTYPE;
  res   record;
  v_n   int; v_n2 int;
  v_exp timestamptz; v_dur bigint; v_reason text;
  T0    timestamptz := date_trunc('hour', now()) - interval '40 hours';
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);
  r := public.create_fleet_driver('P51 Ahmet',  'P51-1'); d1 := (r->>'driverId')::uuid;
  r := public.create_fleet_driver('P51 Mehmet', 'P51-2'); d2 := (r->>'driverId')::uuid;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', B_ADM)::text, true);
  r := public.create_fleet_driver('P51 Beta',   'P51-B'); dB := (r->>'driverId')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);

  -- ═══ A. ARAÇ BAĞI (istemci iddiasına GÜVENME) ═══════════════════════
  --
  -- Bu blok P2'nin güvenlik çekirdeğidir: gözlem satırının `company_id`si
  -- İSTEMCİDEN gelir. Doğrulanmazsa A şirketi B'nin aracına gözlem yazar
  -- ve o gözlem B'nin filo ekranında görünürdü.

  BEGIN
    INSERT INTO public.vehicle_driver_presence
      (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
    VALUES (A_CO, B_VEH, d1, 'NFC', 'VERY_HIGH', T0, T0 + interval '8 hours');
    v_fail := v_fail+1;
    RAISE WARNING 'B1   BASKA SIRKETIN aracina gozlem YAZILDI FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'B1   yanlis arac REDDEDILDI (binding mismatch)             PASS';
  END;

  BEGIN
    INSERT INTO public.vehicle_driver_presence
      (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
    VALUES (A_CO, A_VEH, dB, 'NFC', 'VERY_HIGH', T0, T0 + interval '8 hours');
    v_fail := v_fail+1;
    RAISE WARNING 'B2   BASKA SIRKETIN surucusu gozlem uretti FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'B2   cross-tenant SURUCU REDDEDILDI                        PASS';
  END;

  BEGIN
    INSERT INTO public.vehicle_driver_presence
      (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
    VALUES (B_CO, A_VEH, d1, 'NFC', 'VERY_HIGH', T0, T0 + interval '8 hours');
    v_fail := v_fail+1;
    RAISE WARNING 'B3   sahte company_id ile gozlem yazildi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'B3   SAHTE company_id iddiasi REDDEDILDI                   PASS';
  END;

  BEGIN
    INSERT INTO public.vehicle_driver_presence
      (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
    VALUES (A_CO, IND_VEH, d1, 'NFC', 'VERY_HIGH', T0, T0 + interval '8 hours');
    v_fail := v_fail+1;
    RAISE WARNING 'B4   SIRKETSIZ araca filo gozlemi yazildi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'B4   bireysel (sirketsiz) arac REDDEDILDI                  PASS';
  END;

  BEGIN
    INSERT INTO public.vehicle_driver_presence
      (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
    VALUES (A_CO, gen_random_uuid(), d1, 'NFC', 'VERY_HIGH', T0, T0 + interval '8 hours');
    v_fail := v_fail+1;
    RAISE WARNING 'B5   VAR OLMAYAN araca gozlem yazildi FAIL';
  EXCEPTION WHEN foreign_key_violation OR check_violation THEN
    RAISE NOTICE 'B5   var olmayan arac REDDEDILDI                           PASS';
  END;

  -- DOĞRU bağ hâlâ çalışıyor mu (kapı yanlış tarafa kapanmadı).
  INSERT INTO public.vehicle_driver_presence
    (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
  VALUES (A_CO, A_VEH, d1, 'NFC', 'VERY_HIGH', T0, T0 + interval '8 hours');

  SELECT * INTO h FROM public.vehicle_driver_presence_history
   WHERE vehicle_id=A_VEH AND driver_id=d1 ORDER BY detected_at DESC LIMIT 1;
  IF FOUND AND h.expired_at IS NULL THEN
    RAISE NOTICE 'B6   DOGRU bag hala kabul ediliyor (acik segment acildi)   PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'B6   dogru bagli gozlem reddedildi FAIL'; END IF;

  -- ═══ C. DUPLICATE REPLAY (çevrimdışı kuyruk tekrar oynatması) ═══════
  --
  -- Çevrimdışı kuyruk aynı gözlemi 10 kez yükleyebilir. Bu, 10 segment
  -- DEĞİL, tek segmenttir; hatta birebir aynı gözlem hiç yeni satır
  -- üretmez (DB kısıtı fail-closed reddeder).

  SELECT count(*) INTO v_n FROM public.vehicle_driver_presence_history
   WHERE vehicle_id=A_VEH AND driver_id=d1;

  FOR i IN 1..10 LOOP
    BEGIN
      INSERT INTO public.vehicle_driver_presence
        (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
      VALUES (A_CO, A_VEH, d1, 'NFC', 'VERY_HIGH', T0, T0 + interval '8 hours');
    EXCEPTION WHEN unique_violation THEN NULL;   -- birebir replay: DB reddeder
    END;
  END LOOP;

  SELECT count(*) INTO v_n2 FROM public.vehicle_driver_presence_history
   WHERE vehicle_id=A_VEH AND driver_id=d1;
  IF v_n2 = v_n THEN
    RAISE NOTICE 'C1   10x REPLAY tek segment kaldi (duplicate YOK)          PASS';
  ELSE v_fail:=v_fail+1;
    RAISE WARNING 'C1   replay % yeni segment uretti FAIL', v_n2 - v_n; END IF;

  -- Tazeleme (aynı sürücü, İLERİ zaman) yeni satır ÜRETMEZ ama sayılır.
  INSERT INTO public.vehicle_driver_presence
    (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
  VALUES (A_CO, A_VEH, d1, 'NFC', 'VERY_HIGH',
          T0 + interval '10 minutes', T0 + interval '8 hours');

  SELECT * INTO h FROM public.vehicle_driver_presence_history
   WHERE vehicle_id=A_VEH AND driver_id=d1 AND expired_at IS NULL;
  IF FOUND AND h.refresh_count >= 1 THEN
    RAISE NOTICE 'C2   TAZELEME sayildi, yeni satir uretilmedi (refresh=%)   PASS', h.refresh_count;
  ELSE v_fail:=v_fail+1; RAISE WARNING 'C2   tazeleme sayilmadi FAIL'; END IF;

  -- ═══ D. KAPANIŞ İDEMPOTENSİ ═════════════════════════════════════════
  --
  -- Segmentin TTL'i geçmiş olsun; bakım fonksiyonu onu kapatır. İKİNCİ
  -- çağrı hiçbir satıra dokunmamalı ve kapanış DEĞİŞMEMELİ.

  -- Süresi geçmiş hâle getir (gözlemin kendi TTL'i geçmişte kalsın).
  UPDATE public.vehicle_driver_presence_history
     SET detected_at = now() - interval '10 hours',
         expires_at  = now() - interval '2 hours'
   WHERE id = h.id;

  SELECT public.settle_expired_presence_history() INTO v_n;
  SELECT * INTO h FROM public.vehicle_driver_presence_history WHERE id = h.id;
  v_exp := h.expired_at; v_dur := h.duration_ms; v_reason := h.close_reason;

  IF v_n >= 1 AND h.expired_at IS NOT NULL AND h.close_reason = 'TTL_EXPIRED'
     AND h.duration_ms IS NOT NULL THEN
    RAISE NOTICE 'D1   suresi gecen segment TTL ile KAPANDI                  PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'D1   TTL kapanisi olmadi FAIL'; END IF;

  -- Kapanış anı UYDURULMADI: gözlemin kendi TTL'i kullanıldı.
  IF h.expired_at = h.expires_at THEN
    RAISE NOTICE 'D2   kapanis ani = gozlemin TTL i (uydurma YOK)            PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'D2   kapanis ani uydurulmus FAIL'; END IF;

  SELECT public.settle_expired_presence_history() INTO v_n2;
  SELECT * INTO h FROM public.vehicle_driver_presence_history WHERE id = h.id;

  IF v_n2 = 0 THEN
    RAISE NOTICE 'D3   IKINCI cagri HICBIR satiri etkilemedi (idempotent)    PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'D3   ikinci cagri % satir kapatti FAIL', v_n2; END IF;

  IF h.expired_at = v_exp AND h.duration_ms = v_dur AND h.close_reason = v_reason THEN
    RAISE NOTICE 'D4   kapanis DEGERLERI degismedi (ayni segment 2x kapanmadi) PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'D4   kapanis degerleri degisti FAIL'; END IF;

  -- ═══ E. KAPANMIŞ SEGMENT DEĞİŞMEZ (son savunma) ═════════════════════
  BEGIN
    UPDATE public.vehicle_driver_presence_history
       SET expired_at = now(), duration_ms = 1, close_reason = 'CLEARED'
     WHERE id = h.id;
    v_fail := v_fail+1;
    RAISE WARNING 'E1   kapanmis segment YENIDEN KAPATILDI FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'E1   kapanmis segmenti degistirme REDDEDILDI               PASS';
  END;

  -- ═══ F. YARIŞ SENARYOSU (deterministik yeniden üretim) ══════════════
  --
  -- Gerçek yarış: bakım fonksiyonu segmenti TTL ile kapatırken aynı anda
  -- yeni bir gözlem gelir ve trigger onu `SUPERSEDED` ile kapatmak ister.
  -- Doğru davranış: İLK kapanış kazanır, ikincisi hiçbir şeyi DEĞİŞTİRMEZ
  -- ve yeni segment yine de açılır.

  INSERT INTO public.vehicle_driver_presence
    (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
  VALUES (A_CO, A_VEH, d2, 'NFC', 'VERY_HIGH', now(), now() + interval '8 hours');

  SELECT * INTO h2 FROM public.vehicle_driver_presence_history WHERE id = h.id;
  IF h2.expired_at = v_exp AND h2.close_reason = 'TTL_EXPIRED' THEN
    RAISE NOTICE 'F1   ONCE kapanan segment SUPERSEDED ile EZILMEDI          PASS';
  ELSE v_fail:=v_fail+1;
    RAISE WARNING 'F1   kapanmis segment yeniden kapandi: % / % FAIL',
      h2.close_reason, h2.expired_at; END IF;

  SELECT count(*) INTO v_n FROM public.vehicle_driver_presence_history
   WHERE vehicle_id=A_VEH AND expired_at IS NULL;
  IF v_n = 1 THEN
    RAISE NOTICE 'F2   yeni segment ACILDI ve TEK acik segment var           PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'F2   acik segment sayisi % FAIL', v_n; END IF;

  -- ═══ G. RESOLVER REGRESYONU (P2 hiçbir kararı değiştirmedi) ═════════
  --
  -- Defter sertleştirildi; KARAR katmanı aynı kalmalı.

  SELECT * INTO res FROM public._resolve_driver_presence(
    A_VEH, A_CO, now() + interval '1 hour', now() + interval '2 hours', NULL);
  IF res.decision = 'PRESENCE_ONLY' AND res.driver_id = d2 THEN
    RAISE NOTICE 'G1   RESOLVER kararlari AYNEN calisiyor (PRESENCE_ONLY)    PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'G1   resolver karari degisti: % FAIL', res.decision; END IF;

  SELECT * INTO res FROM public._resolve_driver_presence(
    gen_random_uuid(), gen_random_uuid(), now() - interval '1 hour', now(), NULL);
  IF res.decision = 'NO_PRESENCE' AND res.driver_id IS NULL THEN
    RAISE NOTICE 'G2   gozlemsiz aralikta NO_PRESENCE KORUNDU (fail-closed)  PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'G2   fail-closed bozuldu FAIL'; END IF;

  -- Kapanmış geçmiş kaydı resolver'a KANIT TAŞIMAZ: TTL'i geçmiş dönemde
  -- sorulunca cevap yine UNKNOWN tarafındadır (defter fallback ÜRETMEZ).
  SELECT * INTO res FROM public._resolve_driver_presence(
    A_VEH, A_CO, now() - interval '30 hours', now() - interval '29 hours', NULL);
  IF res.decision = 'NO_PRESENCE' AND res.driver_id IS NULL THEN
    RAISE NOTICE 'G3   GECMIS defter fallback URETMEDI (defter != karar)     PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'G3   defter karar uretti: % FAIL', res.decision; END IF;

  -- ═══ H. GEÇMİŞ DEFTERİ REGRESYONU ═══════════════════════════════════
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_driver_presence_history
                  WHERE expired_at IS NOT NULL
                    AND (duration_ms IS NULL OR close_reason IS NULL)) THEN
    RAISE NOTICE 'H1   kapanan her segmentin SURESI+GEREKCESI var            PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H1   yarim kapanis var FAIL'; END IF;

  IF NOT EXISTS (
    SELECT vehicle_id FROM public.vehicle_driver_presence_history
     WHERE expired_at IS NULL GROUP BY vehicle_id HAVING count(*) > 1) THEN
    RAISE NOTICE 'H2   arac basina TEK acik segment invaryanti KORUNDU       PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'H2   bir aracta birden fazla acik segment FAIL'; END IF;

  IF v_fail = 0 THEN
    RAISE NOTICE '─────────────────────────────────────────────────────────';
    RAISE NOTICE '051 DOGRULAMA: TUM KONTROLLER GECTI';
  ELSE
    RAISE EXCEPTION '051 DOGRULAMA: % KONTROL DUSTU', v_fail;
  END IF;
END
$verify$;

-- ── Cross-tenant OKUMA engeli (ayrı oturum) ─────────────────────────────
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','b0e18b7e-2951-472d-acf1-46c674dcd8a2')::text, true);
SET LOCAL ROLE authenticated;
SELECT CASE WHEN count(*) = 0
            THEN 'I1   B admini A gecmis kayitlarini GOREMIYOR (RLS)       PASS'
            ELSE 'I1   RLS SIZINTISI FAIL' END AS sonuc
  FROM public.vehicle_driver_presence_history
 WHERE vehicle_id = 'bbbb2222-0000-0000-0000-000000000002';
ROLLBACK;

-- ── Kullanıcı defteri KAPATAMAZ (bakım yalnız service_role) ─────────────
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','1178d9db-413d-4f60-97c5-97bfc8393618')::text, true);
SET LOCAL ROLE authenticated;
SELECT CASE WHEN has_function_privilege(
              'authenticated','public.settle_expired_presence_history()','EXECUTE')
            THEN 'I2   kullanici defteri KAPATABILIYOR FAIL'
            ELSE 'I2   kullanici defteri kapatamaz (yalniz service_role)   PASS'
       END AS sonuc;
ROLLBACK;

-- Temizlik.
DELETE FROM public.vehicle_driver_presence_history WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P51 %');
DELETE FROM public.vehicle_driver_presence WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P51 %');
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'P51 %';
