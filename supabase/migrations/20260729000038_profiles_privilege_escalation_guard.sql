-- =====================================================================
-- Migration 038: PROFİL YETKİ YÜKSELTME KAPISI (TASLAK)
--
-- ⚠️  BU MIGRATION PRODUCTION'A UYGULANMADI. Yerel/geçici PostgreSQL'de
--     doğrulanmak üzere hazırlanmıştır.
--
-- ── KÖK NEDEN (gerçek RLS matrisi ile ÖLÇÜLDÜ, tahmin DEĞİL) ─────────
-- `supabase/verification/local_rls_matrix.sql` koşumunda:
--
--     member_alfa | profiles | UPDATE | beklenen DENY | GERÇEK: ALLOW (1 satır)
--
-- Yani `member` rolündeki bir kullanıcı şunu çalıştırabiliyordu:
--
--     UPDATE public.profiles SET role = 'admin' WHERE id = auth.uid();
--
-- "Kendi satırını güncelleyebilir" politikası (`id = auth.uid()`) HANGİ
-- KOLONLARIN değişebileceğini kısıtlamaz. `profiles.role` ve
-- `profiles.company_id` filo otoritesinin TEMELİDİR: 035/036'nın tüm
-- RPC'leri "admin mi?" sorusunu bu kolonlardan okur. Kullanıcı kendi
-- rolünü yazabiliyorsa **tüm filo güvenlik modeli çöker** — observer
-- kendini admin yapıp üye çıkarabilir, başka şirkete geçebilir.
--
-- Bu, RLS'in tek başına yeterli olmadığının kanıtıdır: satır görünürlüğü
-- doğruydu, KOLON yazılabilirliği yanlıştı.
--
-- ── ÇÖZÜM: İKİ BAĞIMSIZ KATMAN (defense-in-depth) ───────────────────
--   1. KOLON-DÜZEYİ GRANT — `authenticated`/`anon` `role` ve `company_id`
--      kolonlarına UPDATE yetkisi ALMAZ. (Politika hatalı yazılsa bile
--      Postgres yazmayı reddeder.)
--   2. TRIGGER — kolon grant'i bir gün yanlışlıkla geri verilse bile
--      `role`/`company_id` değişimi yalnız yetkili yoldan (SECURITY
--      DEFINER RPC'ler) geçebilir; doğrudan istemci UPDATE'i REDDEDİLİR.
--
-- RPC'ler (SECURITY DEFINER, sahibi tablo sahibi) bu kapılardan ETKİLENMEZ:
-- kolon GRANT'i tablo sahibini bağlamaz ve trigger yetkili bayrağı görür.
--
-- ── BU MIGRATION YAPMAZ ─────────────────────────────────────────────
--   · Mevcut politikaları silmez/yeniden yazmaz.
--   · Rol değerlerine dokunmaz (veri YAZILMAZ).
--   · 035'in `profiles_role_allowed` kısıtına dokunmaz.
--   · `service_role` yolunu kısıtlamaz (sunucu tarafı yönetim korunur).
-- =====================================================================

BEGIN;

-- ── 0. ÖN KOŞULLAR ───────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='profiles') THEN
    RAISE EXCEPTION '038 DURDU: public.profiles YOK — yanlış şema';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='role'
  ) THEN
    RAISE EXCEPTION '038 DURDU: profiles.role kolonu YOK — yanlış şema';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='company_id'
  ) THEN
    RAISE EXCEPTION '038 DURDU: profiles.company_id kolonu YOK — yanlış şema';
  END IF;
END $$;

-- ── 1. KATMAN 1 — KOLON DÜZEYİNDE UPDATE YETKİSİ ─────────────────────
-- Önce tablo düzeyindeki geniş UPDATE'i geri al, sonra YALNIZ zararsız
-- kolonlara geri ver. Böylece `role` ve `company_id` dışarıda kalır.
--
-- NOT: `REVOKE UPDATE` tablo düzeyinde alınmazsa kolon düzeyi grant
-- eklemek işe yaramaz — geniş yetki dar yetkiyi kapsar.
REVOKE UPDATE ON public.profiles FROM authenticated;
REVOKE UPDATE ON public.profiles FROM anon;

DO $$
DECLARE
  v_col text;
BEGIN
  -- Kullanıcının kendi düzenleyebileceği "zararsız" kolonlar.
  -- Şemada olmayan kolon sessizce atlanır (şema sürümlerine dayanıklı).
  FOREACH v_col IN ARRAY ARRAY['full_name','avatar_url','phone','locale','updated_at'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='profiles' AND column_name = v_col
    ) THEN
      EXECUTE format('GRANT UPDATE (%I) ON public.profiles TO authenticated', v_col);
    END IF;
  END LOOP;
END $$;

-- ── 2. KATMAN 2 — TRIGGER (grant bir gün geri verilse bile) ──────────
CREATE OR REPLACE FUNCTION public.guard_profile_authority_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
BEGIN
  -- Otorite kolonları değişmiyorsa yapılacak bir şey yok.
  IF NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN
    RETURN NEW;
  END IF;

  -- Yetkili yollar: sunucu tarafı roller ve SECURITY DEFINER RPC'ler
  -- (bunlar tablo sahibi olarak çalışır). Doğrudan istemci UPDATE'i DEĞİL.
  IF current_user IN ('service_role', 'postgres')
     OR pg_has_role(current_user, 'service_role', 'MEMBER')
     OR current_user = (
          SELECT pg_get_userbyid(c.relowner)
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'profiles'
        )
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'permission_denied: profiles.role/company_id doğrudan değiştirilemez'
    USING ERRCODE = 'P0001';
END;
$fn$;

DROP TRIGGER IF EXISTS profiles_authority_guard ON public.profiles;
CREATE TRIGGER profiles_authority_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_authority_columns();

-- ── 3. DOĞRULAMA (fail-closed) ───────────────────────────────────────
DO $$
DECLARE
  v_role_grant int;
  v_trigger    int;
BEGIN
  -- 3a. `authenticated` role/company_id kolonlarına UPDATE yetkisi TAŞIMAMALI.
  SELECT count(*) INTO v_role_grant
  FROM information_schema.column_privileges
  WHERE table_schema='public' AND table_name='profiles'
    AND grantee IN ('authenticated','anon')
    AND privilege_type='UPDATE'
    AND column_name IN ('role','company_id');

  IF v_role_grant > 0 THEN
    RAISE EXCEPTION
      '038 DOĞRULAMA DÜŞTÜ: role/company_id üzerinde hâlâ % UPDATE grant''ı var', v_role_grant;
  END IF;

  -- 3b. Trigger kurulmuş olmalı.
  SELECT count(*) INTO v_trigger
  FROM pg_trigger
  WHERE tgrelid = 'public.profiles'::regclass
    AND tgname = 'profiles_authority_guard'
    AND NOT tgisinternal;

  IF v_trigger <> 1 THEN
    RAISE EXCEPTION '038 DOĞRULAMA DÜŞTÜ: profiles_authority_guard trigger''ı kurulmadı';
  END IF;

  RAISE NOTICE '038 OK: profiles.role/company_id iki katmanla korunuyor.';
END $$;

COMMIT;

-- =====================================================================
-- ROLLBACK (geri alma):
--
--   BEGIN;
--   DROP TRIGGER IF EXISTS profiles_authority_guard ON public.profiles;
--   DROP FUNCTION IF EXISTS public.guard_profile_authority_columns();
--   GRANT UPDATE ON public.profiles TO authenticated;
--   COMMIT;
--
-- ⚠️ Geri alma YETKİ YÜKSELTME AÇIĞINI YENİDEN AÇAR. Yalnız profil
-- güncelleme akışının kırıldığı KANITLANIRSA kullanılmalıdır; o durumda
-- doğru çözüm grant'i geri vermek değil, eksik kolonu §1'deki zararsız
-- kolon listesine eklemektir.
-- =====================================================================
