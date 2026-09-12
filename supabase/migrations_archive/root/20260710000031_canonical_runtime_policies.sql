-- =====================================================================
-- Car Launcher Pro — Kanonik: runtime_policies  (PR-SQL-2)
-- Migration 031: canlı DB'deki `runtime_policies` tablosunun kök
--   migration setinde KANONİK, FORWARD-ONLY, IDEMPOTENT karşılığı.
--
-- BAĞLAM/KURALLAR: bkz. 030 başlığı. Aynı ilkeler:
--   * BİREBİR temsil, DAVRANIŞ DEĞİŞMEZ, NON-DESTRUCTIVE (no DROP/REVOKE/backfill).
--   * anon USING(true) policy KORUNUR (scope daraltma PR-SQL-4).
--   * Legacy fazlalık anon GRANT REVOKE edilmez (PR-SQL-4); yalnız gerekli GRANT additive.
--
-- NOT: canlıda bu tabloda `created_at` YOK (yalnız `updated_at`) → birebir
--   temsil için created_at EKLENMEZ (tip/kolon düzeltmeleri PR-SQL-5 kapsamı).
-- =====================================================================

-- ── 1. Tablo (canlı kolon/tip/null'a birebir) ────────────────────────
CREATE TABLE IF NOT EXISTS public.runtime_policies (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text        NOT NULL,
  name        text        NOT NULL,
  category    text        NOT NULL,
  value       numeric     NOT NULL,
  min_value   numeric     NOT NULL,
  max_value   numeric     NOT NULL,
  unit        text        NOT NULL,
  description text        NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

-- Drift güvencesi (IF NOT EXISTS).
ALTER TABLE public.runtime_policies ADD COLUMN IF NOT EXISTS key         text;
ALTER TABLE public.runtime_policies ADD COLUMN IF NOT EXISTS name        text;
ALTER TABLE public.runtime_policies ADD COLUMN IF NOT EXISTS category    text;
ALTER TABLE public.runtime_policies ADD COLUMN IF NOT EXISTS value       numeric;
ALTER TABLE public.runtime_policies ADD COLUMN IF NOT EXISTS min_value   numeric;
ALTER TABLE public.runtime_policies ADD COLUMN IF NOT EXISTS max_value   numeric;
ALTER TABLE public.runtime_policies ADD COLUMN IF NOT EXISTS unit        text;
ALTER TABLE public.runtime_policies ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.runtime_policies ADD COLUMN IF NOT EXISTS updated_at  timestamptz;
ALTER TABLE public.runtime_policies ADD COLUMN IF NOT EXISTS updated_by  uuid;

-- `key` benzersiz (policy anahtarı).
CREATE UNIQUE INDEX IF NOT EXISTS runtime_policies_key_key ON public.runtime_policies (key);

-- ── 2. RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.runtime_policies ENABLE ROW LEVEL SECURITY;

-- ── 3. Policies (canlıya birebir — DAVRANIŞ DEĞİŞMEZ) ────────────────
-- anon: tüm policy satırlarını okur (USING(true)). ⚠️ scope daraltma PR-SQL-4.
DROP POLICY IF EXISTS "anon_read_policies" ON public.runtime_policies;
CREATE POLICY "anon_read_policies" ON public.runtime_policies
  FOR SELECT TO anon
  USING (true);

-- authenticated super_admin: tam yönetim.
DROP POLICY IF EXISTS "superadmin_all_policies" ON public.runtime_policies;
CREATE POLICY "superadmin_all_policies" ON public.runtime_policies
  FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin');

-- ── 4. GRANT (gerekli — additive; REVOKE YOK) ───────────────────────
GRANT SELECT                         ON public.runtime_policies TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.runtime_policies TO authenticated;
GRANT ALL                            ON public.runtime_policies TO service_role;

-- ── 5. Doğrulama (salt-okuma) ───────────────────────────────────────
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND table_name='runtime_policies' ORDER BY grantee;
-- SELECT rowsecurity FROM pg_tables WHERE tablename='runtime_policies';
-- SELECT policyname, roles, cmd FROM pg_policies WHERE tablename='runtime_policies';
