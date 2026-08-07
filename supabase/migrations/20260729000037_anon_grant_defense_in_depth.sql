-- =====================================================================
-- Migration 037: ANON GRANT DARALTMA — DEFENSE-IN-DEPTH (TASLAK)
--
-- ⚠️  BU MIGRATION PRODUCTION'A UYGULANMADI. Yerel/geçici PostgreSQL'de
--     doğrulanmak üzere hazırlanmıştır. Uygulama kararı ayrı bir runbook'a
--     tabidir (docs/db/RUNBOOK_037_ANON_GRANT.md).
--
-- ── SORUN (R4) ───────────────────────────────────────────────────────
-- `anon` rolü filo tablolarında SELECT ayrıcalığı taşıyor. Bu ayrıcalık
-- hiçbir migration dosyasında AÇIKÇA verilmedi — Supabase'in `public`
-- şemasındaki varsayılan ayrıcalıklarından geliyor. RLS açıkken tek başına
-- veri sızdırmaz; ama tek bir hatalı `USING (true)` politikası tüm tabloyu
-- anonim internete açar. Defense-in-depth: politika yanlış olsa BİLE anon
-- tabloyu okuyamamalı.
--
-- ── 🔴 KRİTİK SAHA GERÇEĞİ — NEDEN İKİ FAZ VAR ───────────────────────
-- Head unit (araç içi uygulama) Supabase'e **anon key** ile bağlanır ve
-- bazı tablolara DOĞRUDAN erişir (RPC üzerinden değil):
--
--   · src/platform/commandListener.ts:293  → vehicles       UPSERT (e2e_public_key)
--   · src/platform/commandListener.ts:378  → vehicle_commands SELECT (pending komut)
--   · src/platform/commandListener.ts:464  → vehicle_commands SELECT (retry)
--   · src/platform/remoteCommandService.ts:453 → vehicle_commands
--
-- Bu tablolarda anon ayrıcalığı geri alınırsa **araç komut almayı bırakır**
-- ve E2E anahtar yayını durur. Bu yüzden 037 YALNIZ head unit'in
-- DOKUNMADIĞI tabloları daraltır. Araç tabloları FAZ 2'ye bırakılmıştır ve
-- ön koşulu head unit erişiminin SECURITY DEFINER RPC'ye taşınmasıdır.
--
-- ── KAPSAM (FAZ 1 — bu dosya) ────────────────────────────────────────
--   profiles · companies  → anon'un hiçbir meşru kullanımı YOK
--
-- ── KAPSAM DIŞI (FAZ 2 — BLOKE) ──────────────────────────────────────
--   vehicles · vehicle_commands · vehicle_locations · vehicle_events
--   Ön koşul: head unit doğrudan tablo erişiminin RPC'ye göçü + saha testi.
--
-- ── GARANTİLER ───────────────────────────────────────────────────────
--   · İDEMPOTENT   — tekrar çalıştırılabilir, ikinci koşuda değişiklik yok.
--   · FAIL-CLOSED  — beklenmeyen şema durumunda EXCEPTION ile durur.
--   · TRANSACTION  — kısmi uygulama yok (tek işlem).
--   · RLS'e DOKUNMAZ — hiçbir politika eklenmez/silinmez/değiştirilmez.
--   · GERİ ALINABİLİR — bkz. "ROLLBACK" bölümü (dosya sonu).
-- =====================================================================

BEGIN;

-- ── 0. ÖN KOŞULLAR ───────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='profiles'
  ) THEN
    RAISE EXCEPTION '037 DURDU: public.profiles YOK — yanlış şema';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='companies'
  ) THEN
    RAISE EXCEPTION '037 DURDU: public.companies YOK — yanlış şema';
  END IF;

  -- RLS zaten açık OLMALI. Kapalıysa GRANT daraltmak yanlış güven verir:
  -- asıl arıza RLS'tir, önce o düzeltilmelidir.
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname='public' AND tablename IN ('profiles','companies')
      AND rowsecurity = false
  ) THEN
    RAISE EXCEPTION
      '037 DURDU [RLS_KAPALI]: profiles/companies üzerinde RLS kapalı. '
      'GRANT daraltma RLS''in YERİNE GEÇMEZ — önce RLS açılmalı.';
  END IF;
END $$;

-- ── 1. MEVCUT DURUMU KAYDET (uygulama ÖNCESİ kanıt) ──────────────────
DO $$
DECLARE
  v_before text;
BEGIN
  SELECT string_agg(format('%s:%s', table_name, privilege_type), ', ' ORDER BY table_name, privilege_type)
    INTO v_before
  FROM information_schema.role_table_grants
  WHERE table_schema='public'
    AND grantee='anon'
    AND table_name IN ('profiles','companies');

  RAISE NOTICE '037 ÖNCESİ anon ayrıcalıkları: %', COALESCE(v_before, '(yok)');
END $$;

-- ── 2. DARALTMA ──────────────────────────────────────────────────────
-- Yalnız `anon`. `authenticated` ve `service_role` DOKUNULMAZ.
-- `PUBLIC` rolünden de alınır: anon PUBLIC üzerinden dolaylı ayrıcalık
-- devralabilir, tek başına anon'dan almak yetersiz kalırdı.
REVOKE ALL ON public.profiles  FROM anon;
REVOKE ALL ON public.companies FROM anon;
REVOKE ALL ON public.profiles  FROM PUBLIC;
REVOKE ALL ON public.companies FROM PUBLIC;

-- Gelecekte bu şemada oluşturulacak tablolar için varsayılanı da daralt.
-- (Yalnız bu migration'ı çalıştıran rolün varsayılanlarını etkiler.)
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- ── 3. UYGULAMA SONRASI DOĞRULAMA (fail-closed) ──────────────────────
DO $$
DECLARE
  v_left int;
  v_auth int;
BEGIN
  -- 3a. anon'da ayrıcalık KALMAMALI.
  SELECT count(*) INTO v_left
  FROM information_schema.role_table_grants
  WHERE table_schema='public' AND grantee='anon'
    AND table_name IN ('profiles','companies');

  IF v_left > 0 THEN
    RAISE EXCEPTION '037 DOĞRULAMA DÜŞTÜ: anon''da hâlâ % ayrıcalık var', v_left;
  END IF;

  -- 3b. `authenticated` ayrıcalıkları KORUNMUŞ olmalı — bu daraltma
  --     oturum açmış kullanıcıyı ETKİLEMEMELİDİR.
  SELECT count(*) INTO v_auth
  FROM information_schema.role_table_grants
  WHERE table_schema='public' AND grantee='authenticated'
    AND table_name IN ('profiles','companies')
    AND privilege_type = 'SELECT';

  IF v_auth < 2 THEN
    RAISE EXCEPTION
      '037 DOĞRULAMA DÜŞTÜ [YAN HASAR]: authenticated SELECT ayrıcalığı '
      'beklenen 2 tablodan %''sinde var. Daraltma yanlış rolü etkilemiş.', v_auth;
  END IF;

  RAISE NOTICE '037 OK: anon daraltıldı, authenticated korundu.';
END $$;

-- ── 4. FAZ 2 BORCUNU GÖRÜNÜR KIL ─────────────────────────────────────
DO $$
DECLARE
  v_vehicle_anon int;
BEGIN
  SELECT count(*) INTO v_vehicle_anon
  FROM information_schema.role_table_grants
  WHERE table_schema='public' AND grantee='anon'
    AND table_name IN ('vehicles','vehicle_commands','vehicle_locations','vehicle_events');

  IF v_vehicle_anon > 0 THEN
    RAISE NOTICE
      '037 AÇIK BORÇ [FAZ 2]: araç tablolarında anon''un % ayrıcalığı DURUYOR. '
      'Bu bilinçlidir — head unit anon key ile doğrudan erişiyor '
      '(commandListener.ts). Ön koşul: RPC göçü + saha testi.', v_vehicle_anon;
  END IF;
END $$;

COMMIT;

-- =====================================================================
-- ROLLBACK (geri alma) — yalnız FAZ 1 kapsamı:
--
--   BEGIN;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles  TO anon;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO anon;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
--   COMMIT;
--
-- NOT: Geri alma, R4 güvenlik bulgusunu YENİDEN AÇAR. Yalnız anon erişimine
-- gerçekten bağımlı bir üretim akışı KANITLANIRSA kullanılmalıdır — ve o
-- durumda doğru çözüm GRANT geri vermek değil, o akışı RPC'ye taşımaktır.
-- =====================================================================
