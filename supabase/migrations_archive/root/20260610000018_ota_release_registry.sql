-- ============================================================
-- OTA v1 / Commit 2 — Release Registry + Rollout Plans
--
-- 1. rollout_plans: superadmin.service.ts:589 JSDoc'taki ELLE SQL
--    bağımlılığı kaldırıldı — tablo artık gerçek migration (denetim
--    bulgusu #18: "admin tabloları migration'da yok").
-- 2. ota_releases: cihazların "benden yenisi var mı?" sorgusu için
--    sürüm kayıt defteri (OTA istemcisi Commit 4-6'da bağlanacak).
--
-- CLAUDE.md SUPABASE kuralları: GRANT + RLS + POLICY + verification —
-- dördü de bu dosyada, istisnasız.
-- ============================================================

-- ── 1. rollout_plans ─────────────────────────────────────────
-- Kolonlar src/admin/types/superadmin.ts RolloutPlan arayüzü ve
-- createRolloutPlan insert alanlarıyla birebir (ekran kırılmaz).

CREATE TABLE IF NOT EXISTS public.rollout_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  version     text NOT NULL,
  description text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','pending_review','approved','rolling','paused','complete','reverted')),
  stages      jsonb NOT NULL DEFAULT '[]',
  rollback_to text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  approved_by uuid,
  approved_at timestamptz
);

-- GRANT (CLAUDE.md şablonu). anon'a yalnız SELECT: policy'si olmadığı için
-- RLS sıfır satır gösterir — "permission denied" sınıfı crash yerine boş sonuç.
GRANT SELECT ON public.rollout_plans TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rollout_plans TO authenticated;
GRANT ALL ON public.rollout_plans TO service_role;

ALTER TABLE public.rollout_plans ENABLE ROW LEVEL SECURITY;

-- Yalnız super_admin (JWT app_metadata — kullanıcı değiştiremez, service_role atar).
DROP POLICY IF EXISTS "superadmin_rollouts" ON public.rollout_plans;
CREATE POLICY "superadmin_rollouts" ON public.rollout_plans
  FOR ALL TO authenticated
  USING      ((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin');

-- ── 2. ota_releases ──────────────────────────────────────────
-- Cihaz sorgusu (anon + RLS): status='active' AND channel=X AND
-- version_code > kurulu → en yenisi. sha256 indirme bütünlüğü,
-- apk_path Storage (ota_apks bucket) yolu.

CREATE TABLE IF NOT EXISTS public.ota_releases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_code    integer NOT NULL UNIQUE CHECK (version_code > 0),
  version_name    text NOT NULL,
  channel         text NOT NULL DEFAULT 'production'
                  CHECK (channel IN ('internal','pilot','production')),
  apk_path        text NOT NULL,
  apk_size        bigint NOT NULL CHECK (apk_size > 0),
  sha256          text NOT NULL CHECK (char_length(sha256) = 64),
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','active','paused','revoked')),
  release_notes   text NOT NULL DEFAULT '',
  rollout_plan_id uuid REFERENCES public.rollout_plans(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid
);

-- Cihaz sorgu deseni için indeks (channel+status filtre, version_code sıralama)
CREATE INDEX IF NOT EXISTS idx_ota_releases_device_query
  ON public.ota_releases (channel, status, version_code DESC);

-- GRANT: cihazlar anon key ile OKUR; yazma admin (authenticated süper-admin
-- policy'li) + publish pipeline (service_role).
GRANT SELECT ON public.ota_releases TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ota_releases TO authenticated;
GRANT ALL ON public.ota_releases TO service_role;

ALTER TABLE public.ota_releases ENABLE ROW LEVEL SECURITY;

-- Cihaz okuma: yalnız aktif release görünür (draft/paused/revoked GİZLİ —
-- pause = yayılma anında durur, cihazlar yeni sürümü göremez olur).
DROP POLICY IF EXISTS "ota_releases_device_read" ON public.ota_releases;
CREATE POLICY "ota_releases_device_read" ON public.ota_releases
  FOR SELECT TO anon
  USING (status = 'active');

-- Admin: super_admin her durumu görür ve yönetir; diğer authenticated
-- kullanıcılar cihazla aynı görünürlüğe sahiptir (yalnız active).
DROP POLICY IF EXISTS "ota_releases_auth_read_active" ON public.ota_releases;
CREATE POLICY "ota_releases_auth_read_active" ON public.ota_releases
  FOR SELECT TO authenticated
  USING (status = 'active');

DROP POLICY IF EXISTS "ota_releases_superadmin_all" ON public.ota_releases;
CREATE POLICY "ota_releases_superadmin_all" ON public.ota_releases
  FOR ALL TO authenticated
  USING      ((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin');

-- ── 3. Verification (CLAUDE.md zorunlu) ──────────────────────
-- Migration kendini doğrular: GRANT/RLS/policy eksikse FAIL eder —
-- "sessizce yarım şema" production'a sızamaz.

DO $$
DECLARE
  grant_count  integer;
  policy_count integer;
  rls_ok       boolean;
BEGIN
  -- GRANT teyidi: her iki tabloda anon SELECT + authenticated 4-DML + service_role
  SELECT count(*) INTO grant_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('rollout_plans', 'ota_releases')
    AND grantee IN ('anon', 'authenticated', 'service_role');
  IF grant_count < 12 THEN  -- 2 tablo × (anon 1 + authenticated 4 + service_role ≥1)
    RAISE EXCEPTION 'OTA migration: GRANT eksik (bulunan: %)', grant_count;
  END IF;

  -- RLS teyidi
  SELECT bool_and(rowsecurity) INTO rls_ok
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename IN ('rollout_plans', 'ota_releases');
  IF NOT coalesce(rls_ok, false) THEN
    RAISE EXCEPTION 'OTA migration: RLS kapalı tablo var';
  END IF;

  -- Policy teyidi
  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename IN ('rollout_plans', 'ota_releases');
  IF policy_count < 4 THEN
    RAISE EXCEPTION 'OTA migration: policy eksik (bulunan: %)', policy_count;
  END IF;

  RAISE NOTICE 'OTA release registry: GRANT=% policy=% RLS=OK', grant_count, policy_count;
END $$;
