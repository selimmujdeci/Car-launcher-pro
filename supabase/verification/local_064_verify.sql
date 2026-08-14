-- ============================================================================
-- local_064_verify.sql — Migration 064'ün GERÇEK PostgreSQL doğrulaması.
--
-- Sıra: local_064_fixture.sql → 064 migration → bu dosya.
--
-- Sekiz kontrol. Her biri GERÇEK bir rol (`SET LOCAL ROLE authenticated`) ve
-- GERÇEK bir `auth.uid()` ile koşar — politika METNİNİ okumak kanıt değildir
-- (kütük #203–#208 dersi: fonksiyon tanımını okumak onu çalıştırmak değildir).
-- ============================================================================

\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set C '33333333-3333-3333-3333-333333333333'
\set V1 'ffffffff-0000-0000-0000-000000000001'
\set V2 'ffffffff-0000-0000-0000-000000000002'

-- ── 1. anon ayrıcalığı SIFIR ───────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.role_table_grants
  WHERE table_schema='public'
    AND table_name IN ('vehicle_fuel_logs','vehicle_service_records')
    AND grantee='anon';
  IF n <> 0 THEN RAISE EXCEPTION '064-1 DÜŞTÜ: anon ayrıcaligi %', n; END IF;
  RAISE NOTICE '064-1 PASS: anon ayrıcaligi 0';
END $$;

-- ── 2. A kendi aracına yazabilir ───────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'A', true);
INSERT INTO public.vehicle_fuel_logs (vehicle_id, created_by, filled_on, odometer_km, liters, price_per_liter)
VALUES (:'V1', :'A', current_date, 152340, 42.5, 44.10);
INSERT INTO public.vehicle_service_records (vehicle_id, created_by, service_key, performed_on, odometer_km)
VALUES (:'V1', :'A', 'oil', current_date, 152000);
COMMIT;
DO $$ BEGIN RAISE NOTICE '064-2 PASS: sahip kendi aracina yazdi'; END $$;

-- ── 3. A kendi kaydını okuyabilir ──────────────────────────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'A', true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.vehicle_fuel_logs;
  IF n <> 1 THEN RAISE EXCEPTION '064-3 DÜŞTÜ: sahip kendi kaydini goremedi (%)', n; END IF;
  RAISE NOTICE '064-3 PASS: sahip kendi kaydini okudu';
END $$;
COMMIT;

-- ── 4. KİLİT: yabancı kullanıcı (B) HİÇBİR ŞEY göremez ─────────────────────
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'B', true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.vehicle_fuel_logs;
  IF n <> 0 THEN RAISE EXCEPTION '064-4 DÜŞTÜ: CROSS-TENANT SIZINTI — yabanci % satir gordu', n; END IF;
  SELECT count(*) INTO n FROM public.vehicle_service_records;
  IF n <> 0 THEN RAISE EXCEPTION '064-4 DÜŞTÜ: servis kaydinda cross-tenant sizinti (%)', n; END IF;
  RAISE NOTICE '064-4 PASS: yabanci hicbir kayit goremedi';
END $$;
COMMIT;

-- ── 5. KİLİT: yabancı kullanıcı BAŞKASININ aracına YAZAMAZ ─────────────────
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'B', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.vehicle_fuel_logs (vehicle_id, filled_on, liters)
    VALUES ('ffffffff-0000-0000-0000-000000000001', current_date, 10);
    RAISE EXCEPTION '064-5 DÜŞTÜ: yabanci baskasinin aracina YAZDI.';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '064-5 PASS: yabanci yazamadi (RLS reddi)';
  END;
END $$;
COMMIT;

-- ── 6. Şirket üyesi (C) şirket aracının kaydını görebilir ──────────────────
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'C', true);
INSERT INTO public.vehicle_fuel_logs (vehicle_id, created_by, filled_on, liters)
VALUES (:'V2', :'C', current_date, 30.0);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.vehicle_fuel_logs;
  -- C yalnız şirket aracını (V2) görür; A'nın bireysel aracını (V1) GÖRMEZ.
  IF n <> 1 THEN RAISE EXCEPTION '064-6 DÜŞTÜ: sirket uyesi % satir gordu (1 bekleniyordu)', n; END IF;
  RAISE NOTICE '064-6 PASS: sirket uyesi yalniz sirket aracini gordu';
END $$;
COMMIT;

-- ── 7. KİLİT: sahte 0 kilometre ZORLANMAZ (NULL kabul edilir) ──────────────
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'A', true);
INSERT INTO public.vehicle_fuel_logs (vehicle_id, filled_on, liters, odometer_km)
VALUES (:'V1', current_date, 20.0, NULL);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.vehicle_fuel_logs WHERE odometer_km IS NULL;
  IF n < 1 THEN RAISE EXCEPTION '064-7 DÜŞTÜ: bilinmeyen kilometre saklanamadi.'; END IF;
  RAISE NOTICE '064-7 PASS: bilinmeyen kilometre NULL olarak saklandi (sahte 0 yok)';
END $$;
COMMIT;

-- ── 8. KİLİT: çift gönderim (aynı client_ref) İKİNCİ KEZ yazılmaz ──────────
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'A', true);
INSERT INTO public.vehicle_fuel_logs (vehicle_id, filled_on, liters, client_ref)
VALUES (:'V1', current_date, 15.0, 'offline-abc-123');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.vehicle_fuel_logs (vehicle_id, filled_on, liters, client_ref)
    VALUES ('ffffffff-0000-0000-0000-000000000001', current_date, 15.0, 'offline-abc-123');
    RAISE EXCEPTION '064-8 DÜŞTÜ: ayni client_ref IKI KEZ yazildi (kuyruk cift gonderimi korunmuyor).';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE '064-8 PASS: cift gonderim engellendi (unique_violation)';
  END;
END $$;
COMMIT;

DO $$ BEGIN RAISE NOTICE '=== 064 DOGRULAMA: 8/8 PASS ==='; END $$;
