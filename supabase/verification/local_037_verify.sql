-- =====================================================================
-- local_037_verify.sql — 037 UYGULAMA SONRASI DOĞRULAMA (yerel/geçici DB).
--
-- Kullanım (geçici konteyner):
--   docker run -d --name caros_fleet_037_test -e POSTGRES_PASSWORD=test \
--     -e POSTGRES_DB=carostest postgres:16-alpine
--   psql -f local_037_fixture.sql
--   psql -f ../migrations/20260729000037_anon_grant_defense_in_depth.sql
--   psql -f local_037_verify.sql      ← bu dosya
--
-- Beklenen: HER satır PASS. Tek bir FAIL varsa 037 uygulanmış SAYILMAZ.
-- =====================================================================

\echo '== 1. anon ayrıcalıkları (profiles/companies) — beklenen: 0 =='
SELECT
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS sonuc,
  count(*) AS kalan_ayricalik
FROM information_schema.role_table_grants
WHERE table_schema='public' AND grantee='anon'
  AND table_name IN ('profiles','companies');

\echo '== 2. authenticated ayrıcalıkları KORUNDU mu — beklenen: 8 (2 tablo × 4) =='
SELECT
  CASE WHEN count(*) = 8 THEN 'PASS' ELSE 'FAIL' END AS sonuc,
  count(*) AS ayricalik
FROM information_schema.role_table_grants
WHERE table_schema='public' AND grantee='authenticated'
  AND table_name IN ('profiles','companies');

\echo '== 3. RLS hâlâ AÇIK mı (037 RLS''e dokunmamalı) — beklenen: PASS =='
SELECT
  CASE WHEN bool_and(rowsecurity) THEN 'PASS' ELSE 'FAIL' END AS sonuc
FROM pg_tables
WHERE schemaname='public' AND tablename IN ('profiles','companies');

\echo '== 4. FAZ 2 kapsamı DOKUNULMAMIŞ mı (head unit kırılmamalı) — beklenen: PASS =='
SELECT
  CASE WHEN count(*) > 0 THEN 'PASS' ELSE 'FAIL (head unit erişimi kırılmış olabilir)' END AS sonuc,
  count(*) AS arac_tablosu_anon_ayricaligi
FROM information_schema.role_table_grants
WHERE table_schema='public' AND grantee='anon'
  AND table_name IN ('vehicles','vehicle_commands');

\echo '== 5. GERÇEK ERİŞİM TESTİ — anon profiles okuyabiliyor mu (okuyamamalı) =='
DO $$
DECLARE
  v_ok boolean := false;
BEGIN
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM count(*) FROM public.profiles;
    -- Buraya ulaşıldıysa anon okuyabildi → BAŞARISIZ.
  EXCEPTION
    WHEN insufficient_privilege THEN v_ok := true;
  END;
  RESET ROLE;

  IF v_ok THEN
    RAISE NOTICE '5. PASS — anon profiles okuyamıyor (permission denied)';
  ELSE
    RAISE EXCEPTION '5. FAIL — anon HÂLÂ profiles okuyabiliyor';
  END IF;
END $$;

\echo '== 6. GERÇEK ERİŞİM TESTİ — anon companies okuyabiliyor mu (okuyamamalı) =='
DO $$
DECLARE
  v_ok boolean := false;
BEGIN
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM count(*) FROM public.companies;
  EXCEPTION
    WHEN insufficient_privilege THEN v_ok := true;
  END;
  RESET ROLE;

  IF v_ok THEN
    RAISE NOTICE '6. PASS — anon companies okuyamıyor (permission denied)';
  ELSE
    RAISE EXCEPTION '6. FAIL — anon HÂLÂ companies okuyabiliyor';
  END IF;
END $$;
