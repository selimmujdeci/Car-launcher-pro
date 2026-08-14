-- =====================================================================
-- DÜZELTİCİ 065-P5: VARSAYILAN AYRICALIK DARALTMA (bu noktadan SONRA
-- oluşturulacak public tabloları için)
--
-- ── NEDEN (prod'dan ölçüldü + temiz ortamda kırılma gözlendi) ────────
-- Supabase taze bir projede şunu kurar (prod `pg_default_acl` ile
-- SALT-OKUNUR doğrulandı, 2026-08-14):
--     defaclrole=postgres, nsp=public, objtype=r
--     acl = {postgres=arwdDxtm/postgres, anon=arwdDxtm/postgres,
--            authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres}
-- Yani `public` şemada oluşturulan HER YENİ TABLO otomatik olarak `anon` ve
-- `authenticated` rollerine TAM ayrıcalıkla açılır. Prod'daki 22 tablonun
-- 19'unda `anon` INSERT ayrıcalığı bu yüzden VARDIR (RLS kapıyı tutar; ama
-- migration 037'nin yazdığı gibi bu bir defense-in-depth AÇIĞIDIR).
--
-- ── ÖLÇÜLEN KUSUR ────────────────────────────────────────────────────
-- Filo/sürücü katmanının migration'ları bu gerçeği HESABA KATMAZ. Örnek:
-- `20260730000049_driver_presence_p1.sql` tabloyu kurduktan sonra
--     REVOKE ALL ON TABLE ... FROM anon, PUBLIC;   -- `authenticated` YOK
--     GRANT SELECT ON TABLE ... TO authenticated;
-- yapar ve ardından KENDİ fail-closed denetiminde
--     has_table_privilege('authenticated', ..., 'INSERT') → hata
-- kontrolünü koşar. Varsayılan ayrıcalıklar yüzünden `authenticated`'ın
-- INSERT'i DURUYORDUR → migration KENDİ KENDİNİ durdurur:
--     ERROR: 049 HATA: presence dogrudan yazilabiliyor (RPC disi)
-- Bu, GERÇEK bir Supabase projesinde kaçınılmazdır. Bugüne dek görünmemesinin
-- sebebi, yerel doğrulama fixture'ının (`supabase/verification/
-- local_baseline_fixture.sql`) `ALTER DEFAULT PRIVILEGES` kurmamasıdır —
-- yani doğrulama ortamı gerçek Supabase'den SAPMIŞTIR.
--
-- ── BU DOSYA NE YAPAR ────────────────────────────────────────────────
-- YALNIZ ileriye dönük varsayılanı kaldırır. Bu noktadan SONRA oluşturulan
-- tablolar `anon`/`authenticated`'a otomatik açılmaz; her migration ihtiyacı
-- kadarını AÇIKÇA GRANT eder (049–064 zaten bunu yapar).
--
-- ── NE YAPMAZ (bilinçli sınır) ───────────────────────────────────────
--   · MEVCUT tabloların ayrıcalıklarına DOKUNMAZ. `vehicles`,
--     `vehicle_commands`, `vehicle_locations`, `vehicle_events` head unit'in
--     anon anahtarıyla DOĞRUDAN eriştiği tablolardır (bkz. migration 037
--     "FAZ 2 — BLOKE"); onların daraltılması ayrı bir iştir ve ön koşulu
--     head unit erişiminin RPC'ye göçüdür.
--   · `service_role` varsayılanına DOKUNMAZ (sunucu tarafı erişim sürer).
--   · Politika/RLS DEĞİŞTİRMEZ.
--
-- ── İDEMPOTENT ───────────────────────────────────────────────────────
-- `ALTER DEFAULT PRIVILEGES ... REVOKE` var olmayan ayrıcalıkta no-op'tur.
-- =====================================================================

BEGIN;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

-- ── DOĞRULAMA (fail-closed) ──────────────────────────────────────────
DO $$
DECLARE
  v_acl text;
BEGIN
  SELECT defaclacl::text INTO v_acl
    FROM pg_default_acl
   WHERE defaclnamespace = 'public'::regnamespace
     AND defaclobjtype   = 'r'
     AND defaclrole      = (SELECT oid FROM pg_roles WHERE rolname = current_user);

  -- v_acl NULL olabilir: hiç varsayılan ayrıcalık kaydı yoksa (temiz kurulum)
  -- bu zaten hedef durumdur.
  IF v_acl IS NOT NULL AND (v_acl LIKE '%anon=a%' OR v_acl LIKE '%authenticated=a%') THEN
    RAISE EXCEPTION '065-P5 DOĞRULAMA: anon/authenticated varsayılan INSERT ayrıcalığı hâlâ duruyor: %', v_acl;
  END IF;

  RAISE NOTICE '065-P5 OK: bundan sonra oluşturulacak public tabloları anon/authenticated''a otomatik açılmayacak';
END $$;

COMMIT;
