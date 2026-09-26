-- =====================================================================
-- P0 · İSTEMCİ ROLLERİNDEN TRUNCATE SINIFI AYRICALIKLARIN GERİ ALINMASI
--
-- ── ÖLÇÜLEN SORUN (prod baseline'dan, 2026-09-17) ────────────────────
-- `00000000000000_prod_baseline.sql` (canlı projeden SALT-OKUNUR türetildi)
-- 19 public tablosunda `anon` VE `authenticated` rollerine şunu veriyor:
--     GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER,
--           TRUNCATE, UPDATE ON TABLE public."<tablo>" TO anon;
-- Etkilenen tablolar (baseline satır 1850–1930): audit_logs · command_logs ·
-- companies · feature_flags · notifications · ota_releases · profiles ·
-- rollout_plans · route_commands · runtime_policies · telemetry_events ·
-- vehicle_commands · vehicle_events · vehicle_linking_codes ·
-- vehicle_locations · vehicle_pairings · vehicle_push_tokens ·
-- vehicle_telemetry · vehicles.
--
-- ── NEDEN BU BİR AÇIK (RLS BURADA KORUMAZ) ───────────────────────────
-- PostgreSQL'de satır düzeyi güvenlik `TRUNCATE` komutuna UYGULANMAZ
-- (RLS yalnız SELECT/INSERT/UPDATE/DELETE için satır süzer). Bir rol
-- TRUNCATE ayrıcalığına sahipse tabloyu politikalardan BAĞIMSIZ olarak
-- tamamen boşaltabilir. `anon` anahtarı hem PWA hem head unit içinde
-- istemci tarafında bulunur → anahtarı eline geçiren biri
-- `vehicle_commands`, `audit_logs`, `telemetry_events` gibi tabloları
-- silebilirdi. Mevcut RLS maruziyet matrisi (`supabase/tests/063_*.sql`)
-- yalnız SELECT/INSERT/UPDATE/DELETE prob'ladığı için bunu GÖRMÜYORDU.
--
-- `TRIGGER` ve `REFERENCES` de istemci rollerinin hiçbir ürün akışında
-- kullanmadığı DDL-komşusu ayrıcalıklardır; aynı turda kaldırılır.
-- `MAINTAIN` (PG17+) yalnız sunucuda varsa kaldırılır.
--
-- ── BU DOSYA NE YAPAR ────────────────────────────────────────────────
-- YALNIZ `TRUNCATE`, `TRIGGER`, `REFERENCES` (+ varsa `MAINTAIN`)
-- ayrıcalıklarını `anon` ve `authenticated` rollerinden geri alır.
--
-- ── NE YAPMAZ (BİLİNÇLİ SINIR — kırılganlık burada) ──────────────────
--   · `SELECT/INSERT/UPDATE/DELETE`'e DOKUNMAZ. Head unit (`commandListener.ts`,
--     `remoteCommandService.ts`) ve PWA, `vehicles` · `vehicle_commands` ·
--     `vehicle_locations` · `vehicle_telemetry` tablolarına anon/kullanıcı
--     anahtarıyla DOĞRUDAN erişir. Migration 037 bu tabloları bilerek
--     "FAZ 2 — BLOKE" bırakmıştır; o kapsam BU DOSYANIN DIŞINDADIR.
--   · `service_role`a DOKUNMAZ — sunucu tarafı bakım/temizlik işleri sürer.
--   · RLS politikası EKLEMEZ/SİLMEZ/DEĞİŞTİRMEZ.
--   · Varsayılan ayrıcalıklara DOKUNMAZ — ileriye dönük daraltmayı
--     migration 040 (`default_privileges_narrowing`) zaten yaptı.
--
-- ── GARANTİLER ───────────────────────────────────────────────────────
--   · İDEMPOTENT  — tekrar çalıştırılabilir; ikinci koşuda değişiklik yok.
--   · TRANSACTION — kısmi uygulama yok.
--   · FAIL-CLOSED — hem hedefin gerçekleştiği hem de head unit erişiminin
--                   BOZULMADIĞI doğrulanır; biri sağlanmazsa EXCEPTION.
--   · GERİ ALINABİLİR — bkz. dosya sonundaki ROLLBACK bölümü.
--
-- ⚠️  BU MIGRATION BU TURDA PRODUCTION'A UYGULANMADI.
--     Canlı doğrulama gereklidir (bkz. rapor: PRODUCTION VERIFICATION REQUIRED).
-- =====================================================================

BEGIN;

-- ── 0. ÖN KOŞUL: roller gerçekten var mı (yanlış ortamda durur) ──────
DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION '075 DURDU: `anon` rolü yok — bu bir Supabase projesi değil (fail-closed)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION '075 DURDU: `authenticated` rolü yok — beklenmeyen şema (fail-closed)';
  END IF;
END
$pre$;

-- ── 1. HEAD UNIT ERİŞİM TABANI — DEĞİŞİKLİK ÖNCESİ ÖLÇÜM ─────────────
-- Bu tablolarda anon'un okuma/yazma ayrıcalığı DEĞİŞMEMELİDİR. Önce
-- ölçülür, sonuna kadar saklanır ve en sonda yeniden karşılaştırılır.
CREATE TEMP TABLE _m075_baseline ON COMMIT DROP AS
SELECT t.tbl,
       has_table_privilege('anon',          format('public.%I', t.tbl), 'SELECT') AS anon_select,
       has_table_privilege('anon',          format('public.%I', t.tbl), 'INSERT') AS anon_insert,
       has_table_privilege('anon',          format('public.%I', t.tbl), 'UPDATE') AS anon_update,
       has_table_privilege('authenticated', format('public.%I', t.tbl), 'SELECT') AS auth_select,
       has_table_privilege('authenticated', format('public.%I', t.tbl), 'INSERT') AS auth_insert,
       has_table_privilege('authenticated', format('public.%I', t.tbl), 'UPDATE') AS auth_update
  FROM (VALUES ('vehicles'), ('vehicle_commands'), ('vehicle_locations'),
               ('vehicle_events'), ('vehicle_telemetry')) AS t(tbl)
 WHERE to_regclass(format('public.%I', t.tbl)) IS NOT NULL;

-- ── 2. GERİ ALMA ─────────────────────────────────────────────────────
-- Tek tek tablo adı YAZILMAZ: liste ileride büyürse bu dosya eskimesin
-- diye public şemadaki TÜM normal tablolar taranır. Ayrıcalık kümesi
-- dardır, bu yüzden kapsamı geniş tutmak güvenlidir.
DO $revoke$
DECLARE
  r            record;
  v_has_maint  boolean;
BEGIN
  -- `MAINTAIN` PG17'de geldi. Sunucu tanımıyorsa REVOKE sözdizimi hatası
  -- verir → önce yeteneği ölç, uydurma yapma.
  BEGIN
    PERFORM has_table_privilege('anon', 'pg_catalog.pg_class', 'MAINTAIN');
    v_has_maint := true;
  EXCEPTION WHEN OTHERS THEN
    v_has_maint := false;
  END;

  FOR r IN
    SELECT c.relname AS tbl
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
     ORDER BY 1
  LOOP
    EXECUTE format(
      'REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I FROM anon, authenticated',
      r.tbl);

    IF v_has_maint THEN
      EXECUTE format(
        'REVOKE MAINTAIN ON TABLE public.%I FROM anon, authenticated',
        r.tbl);
    END IF;
  END LOOP;

  RAISE NOTICE '075: TRUNCATE/TRIGGER/REFERENCES%s geri alındı (anon, authenticated)',
               CASE WHEN v_has_maint THEN '/MAINTAIN' ELSE '' END;
END
$revoke$;

-- ── 3. DOĞRULAMA A — HEDEF GERÇEKLEŞTİ Mİ (fail-closed) ──────────────
DO $verify_goal$
DECLARE
  r       record;
  v_left  text := '';
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, x.role
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN (VALUES ('anon'), ('authenticated')) AS x(role)
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND has_table_privilege(x.role, c.oid, 'TRUNCATE')
  LOOP
    v_left := v_left || format('%s:%s ', r.role, r.tbl);
  END LOOP;

  IF v_left <> '' THEN
    RAISE EXCEPTION '075 DOĞRULAMA A: istemci rolünde TRUNCATE hâlâ duruyor → %', v_left;
  END IF;

  RAISE NOTICE '075 DOĞRULAMA A OK: public şemada anon/authenticated TRUNCATE ayrıcalığı YOK';
END
$verify_goal$;

-- ── 4. DOĞRULAMA B — HEAD UNIT / PWA ERİŞİMİ BOZULMADI MI ────────────
-- Bu kapı olmasaydı, bu dosya sessizce aracın komut almasını kesebilirdi.
DO $verify_access$
DECLARE
  r       record;
  v_break text := '';
BEGIN
  FOR r IN SELECT * FROM _m075_baseline LOOP
    IF r.anon_select  IS DISTINCT FROM has_table_privilege('anon',          format('public.%I', r.tbl), 'SELECT')
    OR r.anon_insert  IS DISTINCT FROM has_table_privilege('anon',          format('public.%I', r.tbl), 'INSERT')
    OR r.anon_update  IS DISTINCT FROM has_table_privilege('anon',          format('public.%I', r.tbl), 'UPDATE')
    OR r.auth_select  IS DISTINCT FROM has_table_privilege('authenticated', format('public.%I', r.tbl), 'SELECT')
    OR r.auth_insert  IS DISTINCT FROM has_table_privilege('authenticated', format('public.%I', r.tbl), 'INSERT')
    OR r.auth_update  IS DISTINCT FROM has_table_privilege('authenticated', format('public.%I', r.tbl), 'UPDATE')
    THEN
      v_break := v_break || r.tbl || ' ';
    END IF;
  END LOOP;

  IF v_break <> '' THEN
    RAISE EXCEPTION '075 DOĞRULAMA B: araç/PWA erişim ayrıcalığı DEĞİŞTİ (kapsam ihlali) → %', v_break;
  END IF;

  RAISE NOTICE '075 DOĞRULAMA B OK: vehicles/vehicle_commands/vehicle_locations/vehicle_events/vehicle_telemetry SELECT+INSERT+UPDATE ayrıcalıkları DEĞİŞMEDİ';
END
$verify_access$;

-- ── 5. DOĞRULAMA C — service_role'e DOKUNULMADI ──────────────────────
DO $verify_service$
BEGIN
  IF NOT has_table_privilege('service_role', 'public.vehicle_commands', 'TRUNCATE') THEN
    RAISE EXCEPTION '075 DOĞRULAMA C: service_role TRUNCATE ayrıcalığı kaybolmuş — kapsam ihlali';
  END IF;
  RAISE NOTICE '075 DOĞRULAMA C OK: service_role ayrıcalıkları korundu';
END
$verify_service$;

COMMIT;

-- =====================================================================
-- ROLLBACK (yalnız acil durum; güvenlik açığını GERİ AÇAR)
-- ---------------------------------------------------------------------
--   BEGIN;
--   DO $$
--   DECLARE r record;
--   BEGIN
--     FOR r IN SELECT c.relname AS tbl FROM pg_class c
--                JOIN pg_namespace n ON n.oid = c.relnamespace
--               WHERE n.nspname='public' AND c.relkind='r'
--     LOOP
--       EXECUTE format('GRANT TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I TO anon, authenticated', r.tbl);
--     END LOOP;
--   END $$;
--   COMMIT;
-- =====================================================================
